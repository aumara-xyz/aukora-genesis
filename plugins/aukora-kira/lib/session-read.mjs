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
import { fstatSync, openSync, readFileSync, readdirSync } from 'node:fs'
import { createZstdDecompress, zstdDecompressSync } from 'node:zlib'

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
        if (fstatSync(openSync(candidate, 'r')).isFile()) return candidate
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
  const stream = createZstdDecompress({ maxOutputLength: maxBytes })
  const events = []
  const seen = new Set()
  let total = 0
  let remainder = ''
  stream.end(readFileSync(file))
  for await (const chunk of stream) {
    total += chunk.length
    if (total > maxBytes) {
      stream.destroy()
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
      events.push({ seq, at: String(parsed?.at ?? parsed?.time ?? ''), line })
      if (seq !== null && wanted !== null && wanted.has(seq)) seen.add(seq)
    }
    if (wanted !== null && seen.size === wanted.size) {
      stream.destroy()
      return events
    }
  }
  return events
}


/** A session's whole stream may be large, so this cap is a safety net rather than a working limit: callers ask for
 * specific events and the reader stops when it has them. */
export const MAX_STREAM_BYTES = 512 * 1024 * 1024


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


export function readSessionEvent({ stateRoot, sessionId, seq, decompress }) {
  const events = readSessionEvents({ stateRoot, sessionId, decompress })
  if (events === null) return null
  return events.find(one => one.seq === seq)
}
