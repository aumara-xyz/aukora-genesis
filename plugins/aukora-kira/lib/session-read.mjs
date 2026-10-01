/**
 * THE SESSION READERS — split out of the strict reader so the shared reader can be compared with its other copies.
 *
 * **FABLE'S ROW 21, AND THE REASON IS THE PARITY STEP RATHER THAN TIDINESS.** The parity court compares the strict readers FILE
 * AGAINST FILE, and this one had grown KIRA's own session readers — a store layout, a compressed file name, a streaming bound.
 * A byte comparison against any other copy was therefore impossible and the step was red in CI.
 *
 * *** A SPLIT FOLLOWS THE CALLS AND CARRIES THE NAMES THEY NEED. *** My first attempt moved the wrapper without the reader it
 * wraps, and the second moved both but not `readdirSync`, which failed SILENTLY: the ReferenceError was swallowed by a caller's
 * guard and surfaced as "the event could not be read as a line" — a sentence about the session rather than about the import.
 * Both streaming readers are here, and the import list is COMPUTED FROM THIS TEXT rather than written by hand, so it cannot be
 * incomplete about the code it carries.
 *
 * THE DEPENDENCY RUNS ONE WAY: this imports the strict primitive from `strict-read.mjs`, and `strict-read.mjs` does not import
 * this. A reader that could reach back into its own consumers would not be a boundary.
 *
 * @module @aukora/dsh-plugin-kira/session-read
 */
import { closeSync, constants as FS, fstatSync, openSync, readFileSync, readSync, readdirSync, lstatSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

import { MAX_ARTIFACT_BYTES } from './strict-read.mjs'




/**
 * THE MOST BYTES ANY STRICT READ WILL ACCUMULATE.
 *
 * **CODEX SWEEP, FINDING 5.** The loop read chunks until EOF and then concatenated them, so the peak cost of a
 * read was TWICE the file — and nothing bounded the file. A large regular file, or one that keeps growing while
 * it is being read, could exhaust memory or monopolize the process; the nesting limit far below checks a STRING
 * that had already been built, so it protected nothing. 64 MiB is far past any document this store writes and far
 * short of what a 16 GiB machine can afford to lose to one read.
 */


/**
 * THE SESSION EVENTS, READ FROM WHERE THE HARNESS ACTUALLY KEEPS THEM.
 *
 * **MEASURED 2026-09-26, after a migration dry run reported zero linkable records for the wrong reason.** The store is
 * `sessions/<project-slug>/session-<id>/session.jsonl.zstd`: one directory per session inside a per-project directory,
 * and the events are **ZSTD-COMPRESSED JSONL** inside it. A reader that looks for `*.jsonl` under `sessions/` finds
 * NOTHING AT ALL and then reports every record as unlinkable — a fact about the search wearing the clothes of a fact
 * about the memories. `node:zlib` has `zstdDecompressSync` (verified on this machine's Node), so no dependency is added.
 *
 * THE `line` RETURNED IS THE EXACT DECOMPRESSED LINE, and that is the whole point: a receipt's digest is taken over the
 * bytes a verifier will re-read, so this returns the line itself rather than a re-serialisation that would verify
 * against itself.
 *
 * ENOENT STILL PASSES THROUGH AS AN ORDINARY ANSWER — `null`, not a refusal — because a session that is gone is exactly
 * what the verifier's MISSING word exists for.
 *
 * @param {{stateRoot: string, sessionId: string}} input
 * @returns {string|null} the path of the session file, or null when this state root does not hold it.
 */
export function findSessionFile({ stateRoot, sessionId }) {
  if (typeof stateRoot !== 'string' || stateRoot === '') throw new Error('kira.read: a state root is required')
  if (typeof sessionId !== 'string' || sessionId === '') throw new Error('kira.read: a session id is required')
  const root = `${stateRoot}/sessions`
  let projects
  try {
    projects = readdirSync(root)
  } catch {
    return null
  }
  // TWO NAMES, BECAUSE THIS MACHINE HAS TWO STORES AND THEY DISAGREE. Measured 2026-09-26: the lane store under
  // DSH_HOME (`AUKORA/state/home/sessions/--Users-<owner>-aukora-genesis--`) writes `session.v3.jsonl.zstd` — 167
  // sessions, some tens of megabytes each — while the face's dsh-home writes the older `session.jsonl.zstd`. A reader
  // that knows one name finds ZERO sessions in the other store and then reports every record unlinkable, which is a fact
  // about the name it looked for wearing the clothes of a fact about the memories. Newest name first.
  const names = [`${sessionId}/session.v3.jsonl.zstd`, `${sessionId}/session.jsonl.zstd`]
  for (const project of projects) {
    for (const name of names) {
      const candidate = `${root}/${project}/${name}`
      try {
        // CLOSED (2026-09-27 review): this runs on every turn now, and the unclosed descriptor leaked one per call (200 calls, 200 fds).
        const fd = openSync(candidate, 'r')
        try { if (fstatSync(fd).isFile()) return candidate } finally { closeSync(fd) }
      } catch {
        // Not this project or not this name: keep looking rather than failing the caller's whole read.
      }
    }
  }
  return null
}


/**
 * Every event of one session, in file order.
 *
 * **THE DECOMPRESSION IS BOUNDED, AND A SESSION TOO LARGE TO DECOMPRESS IN ONE PIECE IS REFUSED BY NAME.** The lane
 * store's sessions run to tens of megabytes compressed, and `zstdDecompressSync` on one of those would build hundreds of
 * megabytes of text to answer a question about ONE event. `maxOutputLength` is passed so the limit is the engine's rather
 * than a hope, and exceeding it raises a refusal that names what is owed: a streaming reader. Silently returning a
 * truncation would be far worse — a truncated session looks like a shorter history, and a record citing an event past the
 * cut would report MISSING for the wrong reason.
 *
 * @param {{stateRoot: string, sessionId: string, decompress?: (buffer: Buffer, options?: {maxOutputLength: number}) => Buffer, maxBytes?: number}} input
 * @returns {ReadonlyArray<{seq: number|null, at: string, line: string}>|null} null when the session file is not here.
 */
export function readSessionEvents({ stateRoot, sessionId, decompress, maxBytes = MAX_ARTIFACT_BYTES }) {
  const file = findSessionFile({ stateRoot, sessionId })
  if (file === null) return null
  const gunzip = decompress ?? zstdDecompressSync
  let text
  try {
    text = gunzip(readFileSync(file), { maxOutputLength: maxBytes }).toString('utf8')
  } catch (error) {
    if (String(error?.code ?? '').includes('ERR_BUFFER_TOO_LARGE') || /maxOutputLength|too large/iu.test(String(error?.message ?? ''))) {
      throw new Error(`kira.read:session-too-large — ${file} decompresses past ${String(maxBytes)} bytes, so it cannot be read in one piece; a streaming reader is owed for sessions this size, and TRUNCATING it here would make the session look shorter than it is`)
    }
    throw error
  }
  const events = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      // A TORN OR UNPARSEABLE LINE IS KEPT AS A LINE AND MARKED. Dropping it silently would make a session look
      // shorter than it is, and a record citing the missing event would report MISSING for the wrong reason.
      events.push({ seq: null, at: '', line, unparsed: true })
      continue
    }
    events.push({ seq: Number.isInteger(parsed?.seq) ? parsed.seq : null, at: String(parsed?.at ?? parsed?.time ?? ''), line })
  }
  return events
}


/**
 * ONE event, by sequence number — what a verifier re-reads and what a receipt's digest is taken over.
 * @param {{stateRoot: string, sessionId: string, seq: number, decompress?: (buffer: Buffer) => Buffer}} input
 * @returns {{seq: number, at: string, line: string}|null|undefined} the event, `null` when the session is absent, `undefined` when the session exists and holds no such event.
 */
/**
 * THE STREAMING READER — because the lane store's sessions are MULTI-FRAME and the sync read sees only the FIRST.
 *
 * **MEASURED 2026-09-26.** Reading a real lane session through `zstdDecompressSync` returned ONE event with no `seq`: the
 * synchronous API decodes a single FRAME, and these files carry several — the same session directory holds a
 * `.broken-single-frame` sibling, the migration that produced this format. Reporting one event for a session with
 * thousands is the worst kind of wrong here: a record citing a later event would answer MISSING, and a reader would
 * conclude the memory had been tampered with.
 *
 * IT STOPS WHEN IT HAS WHAT WAS ASKED FOR. A session runs to tens of megabytes compressed and far more decompressed, and
 * both callers want a bounded set: a verifier wants ONE sequence number, and the migration wants the handful of turns its
 * queue cites. `forSeqs` ends the stream once every wanted event has been seen, so the cost follows the question rather
 * than the size of the conversation. Without `forSeqs` it reads the whole stream, under the same cap.
 *
 * THE CAP REFUSES RATHER THAN TRUNCATES: past `maxBytes` the stream is destroyed and `kira.read:session-too-large` is
 * thrown, because a truncated session looks like a shorter history and every MISSING that followed would be a lie.
 *
 * @param {{stateRoot: string, sessionId: string, forSeqs?: Iterable<number>, maxBytes?: number}} input
 * @returns {Promise<ReadonlyArray<{seq: number|null, at: string, line: string}>|null>} null when the session file is not here.
 */
export async function readSessionEventsStreamed({ stateRoot, sessionId, forSeqs, maxBytes = MAX_STREAM_BYTES }) {
  const file = findSessionFile({ stateRoot, sessionId })
  if (file === null) return null
  const wanted = forSeqs === undefined ? null : new Set([...forSeqs])
  const events = []
  const seen = new Set()
  let total = 0
  let remainder = ''
  // FRAME BY FRAME (`frameStarts`), keeping only the wanted events when `forSeqs` is given.
  for (const chunk of frameTexts(file)) {
    total += chunk.length
    if (total > maxBytes) {
      throw new Error(`kira.read:session-too-large — ${file} decompresses past ${String(maxBytes)} bytes; narrow forSeqs rather than reading a prefix`)
    }
    remainder += chunk.toString('utf8')
    let cut = remainder.indexOf('\n')
    while (cut !== -1) {
      const line = remainder.slice(0, cut)
      remainder = remainder.slice(cut + 1)
      cut = remainder.indexOf('\n')
      if (line.trim() === '') continue
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        // KEPT AND MARKED, exactly as the sync reader does: dropping it would make the session look shorter.
        events.push({ seq: null, at: '', line, unparsed: true })
        continue
      }
      const seq = Number.isInteger(parsed?.seq) ? parsed.seq : null
      if (wanted !== null && !wanted.has(seq)) continue
      events.push({ seq, at: String(parsed?.at ?? parsed?.time ?? ''), line })
      if (seq !== null && wanted !== null) seen.add(seq)
    }
    if (wanted !== null && seen.size === wanted.size) return events
  }
  return events
}


/** A session's whole stream may be large, so this cap is a safety net rather than a working limit: callers ask for
 * specific events and the reader stops when it has them. */
export const MAX_STREAM_BYTES = 512 * 1024 * 1024

export const MAX_TAIL_BYTES = 64 * 1024 * 1024
const frameScans = new Map()

/**
 * THE FRAMES OF A SESSION LOG (measured 2026-09-27 on the backend's node, v22.23.0): `zstdDecompressSync` and `createZstdDecompress`
 * BOTH STOP AFTER THE FIRST FRAME, and a DSH log is one frame per append whose first frame is the header alone, so these readers saw
 * one event. This walks frame and block headers by positioned reads (vendor/dsh `scanZstdFrames`' layout), keeping one offset per
 * frame and resuming where the last scan ended; a torn last frame is left for the next scan.
 */
function frameStarts(fd, file) {
  const { ino, size } = fstatSync(fd)
  let scan = frameScans.get(file)
  if (scan === undefined || scan.ino !== ino || scan.end > size) scan = { ino, end: 0, starts: [] }
  const head = Buffer.alloc(5)
  let fresh = scan.end === 0
  while (scan.end + 5 <= size) {
    readSync(fd, head, 0, 5, scan.end)
    if (head.readUInt32LE(0) !== 0xfd2fb528) {
      // A FILE REWRITTEN IN PLACE (same inode, larger) puts a cached offset mid-frame: walk once from byte 0 before refusing.
      if (!fresh) { fresh = true; scan = { ino, end: 0, starts: [] }; continue }
      throw new Error(`kira.read:zstd-frame — no frame magic at byte ${String(scan.end)} of ${file}`)
    }
    const flags = head[4]
    const fcs = flags >>> 6
    let next = scan.end + 5 + (flags & 0x20 ? 0 : 1) + [0, 1, 2, 4][flags & 3] + (fcs === 0 ? (flags & 0x20 ? 1 : 0) : 1 << fcs)
    let last = false
    while (!last && next + 3 <= size) {
      readSync(fd, head, 0, 3, next)
      const block = head.readUIntLE(0, 3)
      last = (block & 1) === 1
      next += 3 + (((block >>> 1) & 3) === 1 ? 1 : block >>> 3)
    }
    if (flags & 4) next += 4
    if (!last || next > size) break
    scan.starts.push(scan.end)
    scan.end = next
  }
  frameScans.delete(file)
  frameScans.set(file, scan)
  if (frameScans.size > 32) frameScans.delete(frameScans.keys().next().value)
  return scan
}

function* frameTexts(file, reverse = false, maxBytes = MAX_TAIL_BYTES) {
  const fd = openSync(file, 'r')
  try {
    const { starts, end } = frameStarts(fd, file)
    for (let n = 0; n < starts.length; n += 1) {
      const at = reverse ? starts.length - 1 - n : n
      const size = (starts[at + 1] ?? end) - starts[at]
      if (size > maxBytes) throw new Error('kira.read:session-frame-limit')
      const bytes = Buffer.alloc(size)
      readSync(fd, bytes, 0, bytes.length, starts[at])
      yield zstdDecompressSync(bytes, { maxOutputLength: maxBytes }).toString('utf8')
    }
  } finally {
    closeSync(fd)
  }
}

/**
 * The last `user/message` whose source is `user` (a person or the lane door) and its exact line, from the raw log's TAIL: frames last
 * to first, stopping at the first found or past `maxBytes`. null: no session file; undefined: none in reach.
 */
export function readLastUserMessage({ stateRoot, sessionId, maxBytes = MAX_TAIL_BYTES }) {
  const file = findSessionFile({ stateRoot, sessionId })
  if (file === null) return null
  let scanned = 0
  for (const text of frameTexts(file, true)) {
    const lines = text.split('\n')
    for (let at = lines.length - 1; at >= 0; at -= 1) {
      if (!lines[at].includes('"user/message"')) continue
      let event
      try { event = JSON.parse(lines[at]) } catch { continue }
      if (event?.type === 'user/message' && event?.data?.source?.kind === 'user') return { event, line: lines[at] }
    }
    scanned += text.length
    if (scanned > maxBytes) return undefined
  }
  return undefined
}


/** Bounded tail of the stopping turn. Only committed assistant text and the actual
 * preceding user event are eligible; plugin snapshots and tool results are never findings. */
export function readMemoryTurn({ stateRoot, sessionId, turn, beforeSeq = Infinity, maxBytes = MAX_TAIL_BYTES }) {
  const file = findSessionFile({ stateRoot, sessionId })
  if (file === null) return null
  const findings = []
  let selectedTurn = turn
  let scanned = 0
  for (const text of frameTexts(file, true, maxBytes)) {
    scanned += Buffer.byteLength(text)
    if (scanned > maxBytes) throw new Error('kira.read:memory-turn-tail-limit')
    for (const line of text.split('\n').reverse()) {
      let event
      try { event = JSON.parse(line) } catch { continue }
      if (Number.isInteger(event?.seq) && event.seq >= beforeSeq) continue
      if (event?.type === 'user/message' && event?.data?.source?.kind !== 'plugin') {
        return { ask: event?.data?.source?.kind === 'user' ? { event, line } : null,
          findings: findings.reverse(), turn: selectedTurn, boundarySeq: event.seq }
      }
      if (event?.type === 'turn/start' && (selectedTurn === undefined || event.data?.turn === selectedTurn)) {
        return { ask: null, findings: findings.reverse(), turn: selectedTurn ?? event.data?.turn, boundarySeq: event.seq }
      }
      if (event?.type !== 'assistant/message' || event.data?.interrupted === true) continue
      if (selectedTurn === undefined && Number.isInteger(event.data?.turn)) selectedTurn = event.data.turn
      if (event.data?.turn !== selectedTurn) continue
      const message = event.data?.message
      if (message?.role !== 'assistant' || message?.source?.kind === 'plugin') continue
      const content = message.content
      if (!Array.isArray(content) || !content.some(part => part?.type === 'text' && part.text?.trim())) continue
      // Tool requests, reasoning and failed attempts are not reports of what was found.
      if (content.some(part => part?.type === 'tool-call')) continue
      if (findings.length === 0) findings.push({ event, line })
    }
  }
  return { ask: null, findings: findings.reverse(), turn: selectedTurn } // Native child sessions may start from a delegated message.
}


/**
 * ONE event through the streaming reader — the path a verifier uses, bounded because it stops at what it was asked for
 * rather than reading a whole conversation to find one line.
 * @param {{stateRoot: string, sessionId: string, seq: number, maxBytes?: number}} input
 * @returns {Promise<{seq: number, at: string, line: string}|null|undefined>}
 */
export async function readSessionEventStreamed({ stateRoot, sessionId, seq, maxBytes }) {
  const events = await readSessionEventsStreamed({ stateRoot, sessionId, forSeqs: [seq], maxBytes })
  if (events === null) return null
  return events.find(one => one.seq === seq)
}

/** Receipts name one format. Untagged historical receipts retain the session reader;
 * never search a second store until a digest happens to match. Voice seq is the
 * one-based physical request line, including blank or malformed preceding lines. */
export async function readCaptureEventStreamed({ stateRoot, source, maxBytes = MAX_ARTIFACT_BYTES }) {
  const { kind, sessionId, seq } = source ?? {}
  if (kind === undefined) return readSessionEventStreamed({ stateRoot, sessionId, seq, maxBytes })
  if (kind !== 'auma-live/model-request') throw new Error('kira.read:capture-source-unsupported')
  if (typeof stateRoot !== 'string' || !stateRoot.startsWith('/') || typeof sessionId !== 'string'
    || !Number.isSafeInteger(seq) || seq < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('kira.read:capture-source-invalid')
  // Same filename mapping as the maintained Apps model-request writer.
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/gu, '_')
  if (!safe || safe === '.' || safe === '..') throw new Error('kira.read:capture-source-invalid')
  let fd
  try { fd = openSync(`${stateRoot}/auma-live/${safe}.jsonl`, FS.O_RDONLY | FS.O_NOFOLLOW | FS.O_NONBLOCK) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  try {
    if (!fstatSync(fd).isFile()) throw new Error('kira.read:capture-source-nonregular')
    const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes)), pieces = []
    let scanned = 0, physicalLine = 1
    while (scanned < maxBytes) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, maxBytes - scanned), null)
      if (!count) return undefined // A torn final line is not a committed receipt.
      scanned += count
      let start = 0
      for (let end = 0; end < count; end++) if (buffer[end] === 10) {
        if (physicalLine === seq) {
          pieces.push(Buffer.from(buffer.subarray(start, end)))
          const line = Buffer.concat(pieces).toString('utf8')
          let event
          try { event = JSON.parse(line) } catch { return undefined }
          if (event?.type !== 'auma-live/model-request' || !Number.isFinite(event.spokenAt)) return undefined
          return { seq, at: event.spokenAt, line }
        }
        physicalLine++; start = end + 1
      }
      if (physicalLine === seq) pieces.push(Buffer.from(buffer.subarray(start, count)))
    }
    throw new Error('kira.read:capture-source-limit')
  } finally { closeSync(fd) }
}


export function readSessionEvent({ stateRoot, sessionId, seq, decompress }) {
  const events = readSessionEvents({ stateRoot, sessionId, decompress })
  if (events === null) return null
  return events.find(one => one.seq === seq)
}


/** Discovery reads only canonical session headers under the configured home.
 * Newest 64 files, at most 64 KiB per header; callers further restrict project identity. */
export function recentSessionHeaders(stateRoot, limit = 64) {
  const root = `${stateRoot}/sessions`
  const files = []
  let projects
  try { projects = readdirSync(root, { withFileTypes: true }) } catch { return [] }
  for (const project of projects.filter(one => one.isDirectory()).slice(0, 256)) {
    const dir = `${root}/${project.name}`
    for (const session of readdirSync(dir, { withFileTypes: true }).filter(one => one.isDirectory())) {
      for (const name of ['session.v3.jsonl.zstd', 'session.jsonl.zstd']) {
        const file = `${dir}/${session.name}/${name}`
        try {
          const stat = lstatSync(file)
          if (stat.isFile()) { files.push({ file, mtime: stat.mtimeMs, id: session.name }); break }
        } catch { /* No canonical log in this directory. */ }
      }
    }
  }
  const headers = []
  for (const { file, id } of files.sort((a, b) => b.mtime - a.mtime).slice(0, limit)) {
    try {
      for (const text of frameTexts(file, false, 64 * 1024)) {
        const header = JSON.parse(text.split('\n')[0])
        if (header?.type === 'session' && header.id === id && typeof header.cwd === 'string') headers.push(header)
        break
      }
    } catch { /* An unreadable header is not a project identity. */ }
  }
  return headers
}
