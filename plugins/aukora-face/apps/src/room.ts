import { randomBytes } from 'node:crypto'
import { closeSync, fstatSync, fsyncSync, linkSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { RoomMessage, RoomPage } from './room-types.ts'

const MAX_BYTES = 16_384
const SPEAKERS = new Set(['PETER', 'AUMA', 'CLAUDE', 'CODEX-DESKTOP', 'AUMA-CODEX', 'GROK'])

class RoomError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function code(error: unknown): unknown {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

type LockIdentity = { dev: bigint; ino: bigint }

/** Keep the owning fd open until release so its inode cannot be recycled underneath this identity. */
function removeLock(lock: string, owner: LockIdentity, contents?: string): void {
  const matches = (path: string): boolean => {
    const fd = openSync(path, 'r')
    try {
      const found = fstatSync(fd, { bigint: true })
      return found.dev === owner.dev && found.ino === owner.ino
        && (contents === undefined || readFileSync(fd, 'utf8') === contents)
    } finally { closeSync(fd) }
  }
  try {
    if (!matches(lock)) return
    const tomb = `${lock}.stale.${process.pid}:${randomBytes(8).toString('hex')}`
    renameSync(lock, tomb)
    let ours = false
    try { ours = matches(tomb) }
    finally {
      if (!ours) {
        // Like room_core, restore a replacement caught by the rename without overwriting a newer lock.
        try { linkSync(tomb, lock) }
        catch (error) { if (code(error) !== 'EEXIST') throw error }
      }
      unlinkSync(tomb)
    }
  } catch (error) { if (code(error) !== 'ENOENT') throw error }
}

function writeAll(fd: number, bytes: Buffer): void {
  for (let offset = 0; offset < bytes.length;) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset)
    if (written === 0) throw new Error('short-room-write')
    offset += written
  }
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

  private async acquire(): Promise<{ fd: number; owner: LockIdentity }> {
    const lock = `${this.room}.lock`
    const deadline = Date.now() + 5_000
    while (true) {
      if (Date.now() >= deadline) throw new RoomError(503, 'room-busy')
      let fd: number
      try { fd = openSync(lock, 'wx', 0o600) }
      catch (error) {
        if (code(error) !== 'EEXIST') throw error
        let held: number | undefined
        try {
          held = openSync(lock, 'r')
          const owner = fstatSync(held, { bigint: true })
          const contents = readFileSync(held, 'utf8')
          // room_core also accepts PID-only locks; newer helpers write PID:token.
          const holder = Number(contents.trim().split(':')[0])
          if (Number.isSafeInteger(holder) && holder > 0 && holder <= 2_147_483_647) {
            try { process.kill(holder, 0) }
            catch (probe) {
              if (code(probe) === 'ESRCH') removeLock(lock, owner, contents)
            }
          }
        } catch { /* A vanished or unreadable holder still takes the yielding retry path. */ }
        finally { if (held !== undefined) closeSync(held) }
        await delay(20)
        continue
      }
      let owner: LockIdentity | undefined
      try {
        owner = fstatSync(fd, { bigint: true })
        writeAll(fd, Buffer.from(String(process.pid)))
        return { fd, owner }
      } catch (error) {
        try { if (owner) removeLock(lock, owner) }
        finally { closeSync(fd) }
        throw error
      }
    }
  }

  private async append(record: object): Promise<void> {
    const line = Buffer.from(`${JSON.stringify(record)}\n`)
    const held = await this.acquire()
    try {
      const fd = openSync(this.room, 'a', 0o600)
      try {
        writeAll(fd, line)
        fsyncSync(fd)
      } finally { closeSync(fd) }
    } finally {
      try {
        try { removeLock(`${this.room}.lock`, held.owner) }
        finally { closeSync(held.fd) }
      } catch { /* Cleanup must not turn a durable append into a failure that invites a duplicate retry. */ }
    }
  }

  readonly recent = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET')
      json(res, 405, { error: 'method-not-allowed' })
      return
    }
    try {
      const afterText = new URL(req.url ?? '/', 'http://localhost').searchParams.get('after')
      const after = afterText === null ? -1 : Number(afterText)
      if (afterText !== null && (!/^(?:-1|0|[1-9]\d*)$/.test(afterText) || !Number.isSafeInteger(after))) {
        throw new RoomError(400, 'invalid-cursor')
      }
      let data: string
      try { data = await readFile(this.room, 'utf8') }
      catch (error) { if (code(error) !== 'ENOENT') throw error; data = '' }
      // Only newline-terminated physical lines advance the cursor. A partial final write is never exposed.
      const complete = data.slice(0, data.lastIndexOf('\n') + 1)
      const lines = complete === '' ? [] : complete.slice(0, -1).split('\n')
      const cursor = lines.length - 1
      const reset = after > cursor
      const messages: RoomMessage[] = []
      for (let index = reset ? 0 : after + 1; index < lines.length; index++) {
        let row: unknown
        try { row = JSON.parse(lines[index]!) } catch { continue }
        if (row === null || typeof row !== 'object' || 'ack' in row) continue
        const record = row as Record<string, unknown>
        if (typeof record.id !== 'string' || typeof record.at !== 'string'
          || typeof record.from !== 'string' || !SPEAKERS.has(record.from) || typeof record.msg !== 'string') continue
        messages.push({ index, id: record.id, at: record.at, from: record.from, msg: record.msg })
        if (messages.length > 300) messages.shift()
      }
      json(res, 200, { messages, cursor, reset } satisfies RoomPage)
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
