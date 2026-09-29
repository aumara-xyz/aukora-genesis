import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RoomMessage, RoomPage } from './room-types.ts'

const MAX_BYTES = 16_384
const PAGE_BYTES = 256 * 1024
const TAIL_CHUNK_BYTES = 16 * 1024
const O_EXLOCK = 0x20 // macOS: flock(LOCK_EX) on the room fd, shared with room_core.py.
const SPEAKERS = new Set(['PETER', 'AUMA', 'CLAUDE', 'CODEX-DESKTOP', 'AUMA-CODEX', 'GROK'])
// Only one blocking open may enter libuv at a time, leaving workers free to write/sync/close.
let appends: Promise<void> = Promise.resolve()

class RoomError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function code(error: unknown): unknown {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

async function readRange(file: FileHandle, start: number, end: number): Promise<Buffer> {
  const bytes = Buffer.alloc(end - start)
  let used = 0
  while (used < bytes.length) {
    const { bytesRead } = await file.read(bytes, used, bytes.length - used, start + used)
    if (bytesRead === 0) break
    used += bytesRead
  }
  return bytes.subarray(0, used)
}

function pageOf(bytes: Buffer, start: number, reset: boolean): RoomPage {
  const messages: RoomMessage[] = []
  let used = 0
  for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, used)) {
    const index = start + used
    const line = bytes.subarray(used, end).toString('utf8')
    used = end + 1
    let row: unknown
    try { row = JSON.parse(line) } catch { continue }
    if (row === null || typeof row !== 'object' || 'ack' in row) continue
    const record = row as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.at !== 'string'
      || typeof record.from !== 'string' || !SPEAKERS.has(record.from) || typeof record.msg !== 'string') continue
    messages.push({ index, id: record.id, at: record.at, from: record.from, msg: record.msg })
    if (messages.length > 300) messages.shift()
  }
  return { messages, cursor: start + used, reset }
}

/** Last 300 complete physical lines, with a hard byte budget even for corrupt giant records. */
async function tailOf(file: FileHandle, size: number, reset: boolean): Promise<RoomPage> {
  const chunks: Buffer[] = []
  const floor = Math.max(0, size - PAGE_BYTES)
  let start = size
  let newlines = 0
  while (start > floor && newlines <= 300) {
    const from = Math.max(floor, start - TAIL_CHUNK_BYTES)
    const chunk = await readRange(file, from, start)
    // A concurrent truncation invalidates the backward scan's byte positions; retry next poll.
    if (chunk.length !== start - from) throw new Error('room-changed-during-read')
    chunks.unshift(chunk)
    for (const byte of chunk) if (byte === 10) newlines++
    start = from
  }
  const bytes = Buffer.concat(chunks)
  let first = 0
  // With no preceding boundary in the window, discard its first (possibly partial) record.
  if (start > 0) {
    first = bytes.indexOf(10) + 1
    if (first === 0) return { messages: [], cursor: null, reset }
    newlines--
  }
  while (newlines > 300) {
    first = bytes.indexOf(10, first) + 1
    newlines--
  }
  return pageOf(bytes.subarray(first), start + first, reset)
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function bodyOf(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const cleanup = (): void => {
      req.off('data', data).off('end', end).off('error', failed).off('aborted', failed)
    }
    const failed = (): void => { cleanup(); reject(new RoomError(400, 'invalid-body')) }
    const data = (chunk: Buffer): void => {
      size += chunk.length
      if (size > MAX_BYTES) {
        cleanup()
        req.resume()
        reject(new RoomError(413, 'message-too-large'))
      } else chunks.push(chunk)
    }
    const end = (): void => {
      cleanup()
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(new RoomError(400, 'invalid-body')) }
    }
    req.on('data', data).on('end', end).on('error', failed).on('aborted', failed)
  })
}

function localISO(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const local = new Date(date.getTime() + offset * 60_000).toISOString().slice(0, -1)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${local}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

/** In-process room I/O. Both handlers are registered behind the host's requestRejection gate. */
export class RoomHttp {
  private readonly room: string

  constructor(roomLogPath = '~/aukora-live/room.log') {
    this.room = roomLogPath.startsWith('~/') ? join(homedir(), roomLogPath.slice(2)) : roomLogPath
  }

  private append(record: object): Promise<void> {
    const line = Buffer.from(`${JSON.stringify(record)}\n`)
    const result = appends.then(async () => {
      const file = await open(this.room, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | O_EXLOCK, 0o600)
      try {
        for (let offset = 0; offset < line.length;) {
          const { bytesWritten } = await file.write(line, offset, line.length - offset)
          if (bytesWritten === 0) throw new Error('short-room-write')
          offset += bytesWritten
        }
        await file.sync()
      } finally { await file.close() }
    })
    appends = result.catch(() => {})
    return result
  }

  readonly recent = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET')
      json(res, 405, { error: 'method-not-allowed' })
      return
    }
    try {
      const afterText = new URL(req.url ?? '/', 'http://localhost').searchParams.get('after')
      const after = afterText === null ? null : Number(afterText)
      if (afterText !== null && (!/^(?:0|[1-9]\d*)$/.test(afterText) || !Number.isSafeInteger(after))) {
        throw new RoomError(400, 'invalid-cursor')
      }
      let file: FileHandle
      try { file = await open(this.room, 'r') }
      catch (error) {
        if (code(error) !== 'ENOENT') throw error
        json(res, 200, { messages: [], cursor: 0, reset: after !== null && after > 0 } satisfies RoomPage)
        return
      }
      let page: RoomPage
      try {
        const { size } = await file.stat()
        const reset = after !== null && size < after
        if (after === null || reset) page = await tailOf(file, size, reset)
        else {
          const bytes = await readRange(file, after, Math.min(size, after + PAGE_BYTES))
          page = pageOf(bytes, after, false)
          if (page.cursor === after && size > after + PAGE_BYTES) {
            // A record larger than a poll cannot be parsed. Resync at the bounded tail's
            // next line boundary (at most another PAGE_BYTES); never consume an unfinished line.
            const tail = await tailOf(file, size, false)
            if (tail.cursor !== null) page = tail
          }
        }
      } finally { await file.close() }
      json(res, 200, page)
    } catch (error) { this.failure(res, error) }
  }

  readonly post = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST')
      json(res, 405, { error: 'method-not-allowed' })
      return
    }
    try {
      const body = await bodyOf(req)
      const msg = body !== null && typeof body === 'object' ? (body as Record<string, unknown>).msg : undefined
      if (typeof msg !== 'string' || msg.trim().length === 0) throw new RoomError(400, 'invalid-message')
      if (Buffer.byteLength(msg) > MAX_BYTES) throw new RoomError(413, 'message-too-large')
      const now = new Date()
      const record = {
        id: `PETER-${now.getTime()}-${randomBytes(2).toString('hex')}`,
        at: localISO(now), from: 'PETER', to: 'ALL', msg, origin: 'aukora-room-app',
      }
      await this.append(record)
      json(res, 201, { id: record.id })
    } catch (error) { this.failure(res, error) }
  }

  private failure(res: ServerResponse, error: unknown): void {
    json(res, error instanceof RoomError ? error.status : 503,
      { error: error instanceof RoomError ? error.message : 'room-unavailable' })
  }
}
