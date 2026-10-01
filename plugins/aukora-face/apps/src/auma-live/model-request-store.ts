/**
 * HER MODEL REQUESTS, IN HER OWN FILE — because writing them into a lane's session log made that thread
 * UNLOADABLE, and that is the outage this module exists to end.
 *
 * **THE DEFECT, EXACTLY.** `http.ts` did `session.append('auma-live/model-request', request)` into whichever LANE
 * session she was bound to. That type is not in `KNOWN_SESSION_EVENT_TYPES`, and `append` cannot set
 * `ignorable: true`. `session-persistence/src/storage-contract.ts:75` refuses to interpret a log containing an
 * unknown type that is not marked ignorable — **so after ANY backend restart the harness refused to load that
 * thread.** ALPHA, KIRA, AURA, AUMLOK and one other all broke, and the repairs were made frame by frame because
 * the first zstd frame must be exactly the header line.
 *
 * **REMOTE_PROVIDER_EGRESS: EVERY RECORD IN THIS FILE WAS PROCESSED OFF THIS MACHINE.** The store keeps what she
 * sent and what came back, and both halves crossed the network to a remote model provider to exist at all. **The
 * wording Peter types, the lane titles and the replies are all in that payload.** Nothing here redacts, and nothing
 * here asks first — the egress is the mechanism, not an incident, so it is a ceiling a reader must be told rather
 * than a failure this store could report.
 *
 * **THE RULE THIS ENCODES: A PRIVATE RECORD DOES NOT GO IN SOMEBODY ELSE'S LOG.** What she sent to a model is her
 * business and belongs in her own file. A lane's session log holds what the harness knows how to read, and
 * nothing else, so no restart can ever be refused because of something she wrote.
 *
 * **THE LEGACY PATH IS READ-ONLY AND STAYS THAT WAY.** Threads repaired by hand still hold those lines, marked
 * ignorable, and her prior turns must still come back from them. Reading them is supported forever; writing one
 * more is not.
 *
 * @module model-request-store
 */

import { chmodSync, closeSync, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** The directory under the DSH home that belongs to her. Created 0700, explicitly. */
export const STORE_DIRECTORY = 'auma-live'

/** The type the LEGACY events carry. Read, never written. */
export const LEGACY_EVENT_TYPE = 'auma-live/model-request'

/**
 * The little of a session event this module reads.
 *
 * **DECLARED HERE RATHER THAN IMPORTED.** Importing the harness's own type would make this module unresolvable
 * from a clean shell, and a court that cannot import the store cannot measure it — which is how the store's own
 * behaviour would go unchecked.
 */
export interface LegacyEventLike {
  readonly type?: unknown
  readonly time?: unknown
  readonly ignorable?: unknown
  readonly data?: unknown
}

/** The messages out of a legacy event's payload, or undefined when it does not carry any. */
function messagesOf(data: unknown): readonly unknown[] | undefined {
  const body = (data as { body?: { messages?: unknown; body?: { messages?: unknown } } } | undefined)?.body
  // **THE NESTED SHAPE IS STILL READ, BECAUSE RECORDS WERE WRITTEN THAT WAY.** Fixing the writer does not un-write
  // what is already on disk, and a reader that dropped them would lose exactly the turns the fix exists to keep.
  for (const candidate of [body?.messages, body?.body?.messages]) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate
  }
  return undefined
}

/** What a stored request reduces to. */
export interface StoredRequest {
  readonly messages: readonly unknown[]
  readonly spokenAt: number
}

/**
 * Where one session's requests live.
 *
 * **THE SESSION ID IS A PATH COMPONENT, SO IT IS NOT TRUSTED AS ONE.** A `/` or a `..` in an id would write
 * outside the store — and a store that can be aimed is not a private file. Anything outside `[A-Za-z0-9._-]` is
 * replaced, so the name is always one directory entry.
 *
 * @param dshHome - the DSH home, always passed and never assumed.
 * @param sessionId - the session the requests belong to.
 * @returns the absolute path of that session's file.
 */
/**
 * Forget one session's recorded requests, by deleting its file.
 *
 * **A STORE WITH NO FORGET IS A STORE THAT KEEPS EVERYTHING, AND THAT IS A PRIVACY PROPERTY RATHER THAN A
 * CONVENIENCE.** `<dshHome>/auma-live/<session>.jsonl` holds the full text of every request she has made in that
 * session — **private conversation content, on disk, forever, with no way to take it back.** "Peter's rule is that
 * private conversations stay in the user's computer" is satisfied by *where* the file is; it is not satisfied if the
 * file can never be removed.
 *
 * **EMPTY HOME FORGETS NOTHING RATHER THAN EVERYTHING.** An unset home is not a store (see P1), and resolving it to
 * the working directory here would delete files in the repository.
 *
 * @param options.dshHome - the DSH home, always passed and never assumed.
 * @param options.sessionId - the session to forget.
 * @returns whether a file was actually removed.
 */
export function forgetModelRequests(options: { dshHome: string; sessionId: string }): boolean {
  if (options.dshHome.trim() === '') return false
  const path = storePath(options.dshHome, options.sessionId)
  // `statSync` first so the return value distinguishes "removed" from "there was nothing" — **a forget that reports
  // success on an absent file cannot be told from one that failed to find it.**
  try {
    if (!statSync(path).isFile()) return false
  } catch { return false }
  try { rmSync(path); return true } catch { return false }
}

/**
 * Remove every recorded session older than a retention window.
 *
 * **RETENTION IS THE HALF THAT RUNS WITHOUT ANYONE ASKING.** A forget operation is only used by someone who already
 * decided to use it; **a file that ages out on its own is the protection for the owner who never thinks about it**,
 * which is most of them and, at 3 a.m., everyone.
 *
 * @param options.dshHome - the DSH home.
 * @param options.olderThanMs - the window; files not modified within it are removed.
 * @param options.now - clock sample, injected so the arm can age a file instead of waiting.
 * @returns the file names removed.
 */
export function pruneModelRequests(options: {
  dshHome: string
  olderThanMs: number
  now?: number
}): readonly string[] {
  if (options.dshHome.trim() === '') return []
  const now = options.now ?? Date.now()
  const directory = join(options.dshHome, STORE_DIRECTORY)
  const removed: string[] = []
  let entries: string[]
  try { entries = readdirSync(directory) } catch { return [] }
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue
    const path = join(directory, entry)
    try {
      const stat = statSync(path)
      if (!stat.isFile()) continue
      if (now - stat.mtimeMs > options.olderThanMs) { rmSync(path); removed.push(entry) }
    } catch { /* a file that vanished under us is already gone, which is the outcome asked for */ }
  }
  return removed
}

export function storePath(dshHome: string, sessionId: string): string {
  const safe = String(sessionId).replace(/[^A-Za-z0-9._-]/gu, '_')
  if (safe === '' || safe === '.' || safe === '..') {
    throw new Error(`model-request-store: refusing to use ${JSON.stringify(sessionId)} as a file name`)
  }
  return join(dshHome, STORE_DIRECTORY, `${safe}.jsonl`)
}

/**
 * Create the store directory, owner-only.
 *
 * **THE MODE IS SET, NOT HOPED FOR.** `mkdirSync`'s mode is filtered through the process umask, so a umask of
 * 022 would leave this world-readable while the code read as though it were private. The consequence of trusting
 * the umask is that a directory holding the full text of every request she has ever made is readable by every
 * account on the machine.
 *
 * @param dshHome - the DSH home.
 * @returns the directory path.
 */
export function ensureStoreDirectory(dshHome: string): string {
  const directory = join(dshHome, STORE_DIRECTORY)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  // Re-asserted even when the directory already existed: an existing directory keeps whatever mode it was made
  // with, so `recursive: true` silently does nothing about permissions on the second run.
  try {
    chmodSync(directory, 0o700)
  } catch { /* chmod is best-effort on exotic filesystems; the create above still applied the mode */ }
  return directory
}

/**
 * Append one request, durably.
 *
 * **`fsync` BEFORE RETURNING, BECAUSE THE POINT OF THE RECORD IS SURVIVING THE CRASH THAT LOSES THE ANSWER.**
 * A write that is still in the page cache when the process dies is not a record of anything. The record is
 * flushed before dispatch for exactly that reason; a buffered append would quietly undo it.
 *
 * @param options - the home, the session, the request payload and the time it was recorded.
 * @returns the path written to.
 */
export interface ModelRequestReceipt {
  readonly sessionId: string
  readonly line: string
  readonly turn: number
  readonly spokenAt: number
}

function requestPayload(request: unknown): unknown {
  return (request as { body?: { messages?: unknown } } | undefined)?.body?.messages === undefined
    ? request
    : (request as { body: unknown }).body
}

export function appendModelRequest(options: {
  dshHome: string
  sessionId: string
  request: unknown
  spokenAt?: number
}): string {
  appendModelRequestReceipt(options)
  return storePath(options.dshHome, options.sessionId)
}

/** Append durably and locate this append's unique line, never the session's newest line. */
function appendModelRequestReceipt({ dshHome, sessionId, request, spokenAt = Date.now() }: {
  dshHome: string
  sessionId: string
  request: unknown
  spokenAt?: number
}): ModelRequestReceipt {
  if (typeof dshHome !== 'string' || dshHome === '') {
    throw new Error('model-request-store: dshHome is required and is never assumed; pass the home this app was configured with')
  }
  ensureStoreDirectory(dshHome)
  const path = storePath(dshHome, sessionId)
  // **WHAT IS STORED IS THE REQUEST BODY, NOT THE ENVELOPE AROUND IT.** The caller hands over
  // `{ sessionId, endpoint, body }` — the engine's request envelope — so the messages live at `request.body`.
  // Wrapping the envelope in another `body` wrote `body.body.messages` while the reader looked for
  // `body.messages`, and **every record was then skipped on read: her memory was saved and silently not
  // restored.** Normalising here rather than teaching the reader about one caller's nesting keeps the file's
  // shape equal to the shape it is read as, which is the property a durable format has to hold.
  if (!Number.isFinite(spokenAt) || Math.abs(spokenAt) > 8.64e15) throw new Error('model-request-store: invalid time')
  const payload = requestPayload(request)
  // An append identifier distinguishes identical bodies written in the same millisecond.
  // It binds this local receipt; it is not a signature or an identity attestation.
  const canonical = JSON.stringify({ type: LEGACY_EVENT_TYPE, spokenAt, requestId: randomUUID(), body: payload })
  const line = `${canonical}\n`
  // `'a'` plus an explicit `fchmod`: the file may be created by this call, and `open`'s mode is umask-filtered
  // for the same reason the directory's is.
  const descriptor = openSync(path, 'a', 0o600)
  try {
    fchmodSync(descriptor, 0o600)
    if (writeSync(descriptor, line) !== Buffer.byteLength(line)) {
      throw new Error('model-request-store: incomplete append; dispatch refused')
    }
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  const lines = readFileSync(path, 'utf8').split('\n')
  const index = lines.indexOf(canonical)
  if (index < 0 || lines.lastIndexOf(canonical) !== index) {
    throw new Error('model-request-store: appended line cannot be bound uniquely; dispatch refused')
  }
  return Object.freeze({ sessionId, line: canonical, turn: index + 1, spokenAt })
}

/** Validate a recorder's result against the exact request before provider dispatch. */
export function modelRequestReceiptMatches(receipt: unknown, request: { sessionId: string; body: unknown }): receipt is ModelRequestReceipt {
  if (receipt === null || typeof receipt !== 'object') return false
  const record = receipt as ModelRequestReceipt
  if (record.sessionId !== request.sessionId || !Number.isSafeInteger(record.turn) || record.turn < 1
      || !Number.isFinite(record.spokenAt) || Math.abs(record.spokenAt) > 8.64e15
      || typeof record.line !== 'string' || /[\r\n]/u.test(record.line)) return false
  try {
    const event = JSON.parse(record.line) as { type?: unknown; spokenAt?: unknown; requestId?: unknown; body?: unknown }
    return event.type === LEGACY_EVENT_TYPE && event.spokenAt === record.spokenAt
      && typeof event.requestId === 'string' && /^[0-9a-f-]{36}$/u.test(event.requestId)
      && JSON.stringify(event.body) === JSON.stringify(request.body)
  } catch { return false }
}

/** Recheck the captured physical position. Never substitute another line when it is missing or changed. */
export function readRecordedModelRequest({ dshHome, sessionId, receipt }: {
  dshHome: string
  sessionId: string
  receipt: ModelRequestReceipt | undefined
}): ModelRequestReceipt | undefined {
  if (typeof dshHome !== 'string' || dshHome === '' || receipt === undefined) return undefined
  try {
    const body = (JSON.parse(receipt.line) as { body: unknown }).body
    if (!modelRequestReceiptMatches(receipt, { sessionId, body })) return undefined
    const line = readFileSync(storePath(dshHome, sessionId), 'utf8').split('\n')[receipt.turn - 1]
    return line === receipt.line ? receipt : undefined
  } catch { return undefined }
}

/**
 * The newest restorable request for one session, from HER file.
 *
 * A malformed line is skipped in favour of the next-newest rather than throwing: the payload crossed a durable
 * file boundary, and a damaged tail must not cost her the whole conversation.
 *
 * @param options - the home and the session.
 * @returns `{ messages, spokenAt }`, or undefined when there is nothing readable.
 */
export function readNewestModelRequest({ dshHome, sessionId }: {
  dshHome: string
  sessionId: string
}): StoredRequest | undefined {
  if (typeof dshHome !== 'string' || dshHome === '') return undefined
  let raw
  try {
    raw = readFileSync(storePath(dshHome, sessionId), 'utf8')
  } catch {
    // A missing file and an unreadable one are the same answer here — nothing to restore — and the caller
    // distinguishes them by whether a turn was carried, not by this.
    return undefined
  }
  return newestRecordIn(raw)
}

/**
 * The newest usable record in a JSONL body.
 *
 * Exported because it is the part with the decision in it, and a court can drive it without a filesystem.
 *
 * @param raw - the file's text.
 * @returns `{ messages, spokenAt }`, or undefined.
 */
export function newestRecordIn(raw: string): StoredRequest | undefined {
  const lines = String(raw).split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    // `lines[index]` is `string | undefined` under `noUncheckedIndexedAccess`, and the index is a loop counter
    // rather than an assumption about the array.
    const line = lines[index]?.trim() ?? ''
    if (line === '') continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const messages = messagesOf(parsed?.body === undefined ? undefined : { body: parsed.body })
    if (messages === undefined) continue
    return { messages, spokenAt: typeof parsed.spokenAt === 'number' ? parsed.spokenAt : 0 }
  }
  return undefined
}

/**
 * Is this session event one of the LEGACY records, marked ignorable?
 *
 * **BOTH HALVES ARE REQUIRED.** The type alone is not enough: an event of this type that is NOT marked ignorable
 * is a broken thread, and treating it as readable would hide the very condition the harness refuses to load.
 * Reading it here would make this module complicit in the defect it was written to end.
 *
 * @param event - one session event, of unknown shape.
 * @returns true when it is a legacy record this module may read.
 */
export function isLegacyModelRequest(event: LegacyEventLike | undefined): boolean {
  return event?.type === LEGACY_EVENT_TYPE && event?.ignorable === true
}

/**
 * The newest legacy request in a session's events, read-only.
 *
 * Scans from the end, because the newest dispatch is the one that reproduces the conversation.
 *
 * @param events - one session's contiguous event log.
 * @returns `{ messages, spokenAt }`, or undefined.
 */
export function newestLegacyModelRequest(events: readonly LegacyEventLike[] | undefined): StoredRequest | undefined {
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || !isLegacyModelRequest(event)) continue
    const messages = messagesOf(event.data)
    if (messages === undefined) continue
    return { messages, spokenAt: typeof event.time === 'number' ? event.time : 0 }
  }
  return undefined
}

/**
 * Record one dispatch, or REFUSE it.
 *
 * **THIS IS A FAIL-CLOSED BOUNDARY, AND IT HAS TO THROW TO BE ONE.** The engine awaits its recording callback
 * BEFORE the provider call and treats a rejection as "do not dispatch": it writes a sentence saying the turn could
 * not be secured and returns. The HTTP adapter's callback did neither — it returned early when no home was
 * configured and caught append failures — so **it always resolved, and the engine dispatched every turn believing
 * it had been recorded.** An advertised boundary that the only implementation cannot fail is not a boundary.
 *
 * @param options - the home, the session and the request about to be sent.
 * @returns this append's canonical line and physical position.
 */
export function recordOrRefuse(options: { dshHome: string; sessionId: string; request: unknown }): ModelRequestReceipt {
  if (typeof options.dshHome !== 'string' || options.dshHome === '') {
    throw new Error('model-request-store: no home is configured, so this dispatch cannot be secured before it is '
      + 'sent and must not be sent')
  }
  // The append already throws on a filesystem failure; it is deliberately NOT caught here. Catching it is what
  // made the boundary unable to fail.
  return appendModelRequestReceipt(options)
}

/**
 * **THE NEWEST RECORD AS THE STORE HOLDS IT — THE LINE ITSELF, AND WHICH LINE IT IS.**
 *
 * `readNewestModelRequest` answers *"what should she remember"* and returns the parsed body. **KIRA's turn-finished
 * consumer needs two different things from the same file, and neither is the body:**
 *
 * - **`line`** — *"the EXACT canonical event line, byte for byte."* **A receipt is a digest of those bytes**, so a
 *   reconstructed line mints a receipt that reads CHANGED the first time anyone verifies it, **which looks like
 *   tampering rather than a mismatch.** This returns the line as it was written, not a re-serialisation of it.
 * - **`turn`** — the key a LATER verifier uses to find that line. `memory-verify.mjs` calls
 *   `readEventLine({sessionId, citedTurn})` and a record whose line cannot be produced **verifies as MISSING.**
 *
 * **THE INDEX IS THE KEY, AND IT IS ONE-BASED.** A line's position in an append-only file is monotonic, **stable
 * across restarts because it is a property of the file rather than of any process**, and derivable by a reader that
 * can count to it. **A process-local counter has none of those three properties** — it resets, repeats, and a repeat is
 * dropped by the consumer as a duplicate turn.
 *
 * **A DAMAGED TAIL IS SKIPPED RATHER THAN THROWING**, matching `readNewestModelRequest`: the payload crossed a durable
 * file boundary, and one bad line must not cost her the conversation. **But the INDEX RETURNED IS THE DAMAGED LINE'S
 * OWN POSITION** — not a re-count of the good ones — **because it has to match what a verifier counting the same file
 * will compute.**
 *
 * @param options - the home and the session.
 * @returns the line, its one-based position, and the instant it carries; or undefined when nothing is readable.
 */
export function readNewestModelRequestLine({ dshHome, sessionId }: {
  dshHome: string
  sessionId: string
}): { readonly line: string; readonly turn: number; readonly spokenAt: number } | undefined {
  if (typeof dshHome !== 'string' || dshHome === '') return undefined
  let raw: string
  try {
    raw = readFileSync(storePath(dshHome, sessionId), 'utf8')
  } catch {
    return undefined
  }
  const lines = raw.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line === undefined || line.trim() === '') continue
    try {
      const parsed = JSON.parse(line) as { spokenAt?: unknown }
      if (typeof parsed.spokenAt !== 'number') continue
      // **`index + 1` COUNTS EVERY PHYSICAL LINE INCLUDING BLANK ONES BEFORE IT**, so the number a verifier computes
      // by reading the same file is the number this returns.
      return { line, turn: index + 1, spokenAt: parsed.spokenAt }
    } catch {
      // A malformed line is skipped in favour of the next-newest, for the reason `readNewestModelRequest` records.
      continue
    }
  }
  return undefined
}
