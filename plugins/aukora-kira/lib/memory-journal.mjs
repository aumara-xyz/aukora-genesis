/**
 * THE JOURNAL — append-only, hash-chained, and the reason a migration can be undone. (Design §3.6.)
 *
 * WHAT IT IS FOR. Every change to a Remembered note is an ENTRY: added, superseded, kept, hidden, expired, restored,
 * forgotten, edited, archived. Each entry carries the hash of the one before it, so the store cannot quietly lose a
 * change or reorder one — and because the entries are the record of what happened, a migration written into this journal
 * is a migration someone can reverse by reading it.
 *
 * THE HALF THAT LIVES HERE IS PURE: entry shape, the chain, and the reading of a damaged tail. THE APPEND ITSELF LIVES
 * IN `strict-read.mjs`, because that file is this plugin's ONE audited I/O boundary (Fable's ruling A) and a second
 * module that could open the store for writing would be a second door onto it.
 *
 * **A TORN LAST LINE IS DAMAGED, AND DAMAGED IS REPORTED.** The design is explicit: the tail is never silently
 * truncated. A process killed mid-append leaves a partial line, and the honest reading of that is "the last entry is
 * incomplete", not "the entry is gone" and not a thrown SyntaxError that names nothing. `verifyChain` returns the index
 * and the reason, and a caller decides; what it must never do is carry on as though the line had not been there.
 *
 * @module @aukora/dsh-plugin-kira/memory-journal
 */
import { canonicalOf, sha256Hex } from './memory-tiers.mjs'

/** The twelve operations §3.6 admits. Closed: a thirteenth needs a new format version. */
export const JOURNAL_OPS = Object.freeze([
  'turn', 'add', 'supersede', 'possible-change', 'keep', 'hide', 'unhide', 'expire', 'restore', 'forget', 'edit', 'archive',
])

/** The `prev` of the first entry: sixty-four zeros, so a first entry is verifiable rather than special-cased. */
export const GENESIS_PREV = '0'.repeat(64)

const HEX64 = /^[0-9a-f]{64}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/

/** A named refusal. Refusals are for malformed entries, never for a damaged tail (that is a reported answer). */
export class KiraJournalError extends Error {
  /**
   * @param {string} code - stable machine-readable refusal code suffix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`kira.journal: ${message}`)
    this.name = 'KiraJournalError'
    this.code = `kira.journal:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new KiraJournalError(code, message)
}

/** The hash of one entry: sha256 over its canonical form, so any reader recomputes it. */
export function entryHashOf(entry) {
  return sha256Hex(canonicalOf({
    seq: entry.seq, prev: entry.prev, at: entry.at, op: entry.op, id: entry.id,
    objectDigest: entry.objectDigest, actor: entry.actor, reason: entry.reason,
  }))
}

/**
 * The next entry in a chain.
 * @param {{previous?: Readonly<Record<string, unknown>>|null, op: string, id: string, objectDigest: string, actor: string, reason?: string, at: string}} input
 * @returns {Readonly<Record<string, unknown>>} the entry, carrying `seq`, `prev` and `hash`.
 */
export function nextEntry(input) {
  const { previous = null, op, id, objectDigest, actor, reason = '', at } = input ?? {}
  if (!JOURNAL_OPS.includes(/** @type {never} */ (op))) {
    refuse('op-unknown', `op ${JSON.stringify(op)} is not one of the design's twelve: ${JOURNAL_OPS.join(', ')}`)
  }
  if (typeof id !== 'string' || id === '') refuse('id-missing', 'an entry names the note it is about')
  if (typeof objectDigest !== 'string' || !HEX64.test(objectDigest)) {
    refuse('object-digest-missing', 'an entry carries the digest of the object it wrote, or a reader cannot tell WHAT was written')
  }
  if (typeof actor !== 'string' || actor === '') refuse('actor-missing', 'an entry names who made the change')
  if (typeof at !== 'string' || !INSTANT.test(at)) refuse('at-not-canonical', '`at` must be a canonical UTC instant; no local clock participates')
  const seq = previous === null || previous === undefined ? 0 : Number(previous.seq) + 1
  if (previous !== null && previous !== undefined) {
    if (typeof previous.hash !== 'string' || !HEX64.test(previous.hash)) refuse('previous-unhashed', 'the entry before this one carries no hash, so the chain would have a hole')
    if (entryHashOf(previous) !== previous.hash) refuse('previous-tampered', 'the entry before this one does not hash to what it claims, so appending would chain onto a lie')
  }
  const base = {
    seq, prev: previous === null || previous === undefined ? GENESIS_PREV : String(previous.hash),
    at, op, id, objectDigest, actor, reason: String(reason ?? ''),
  }
  return Object.freeze({ ...base, hash: entryHashOf(base) })
}

/**
 * Read a chain and answer whether it holds.
 *
 * `damaged` is a REPORTED ANSWER, not an exception: `{ok: false, damagedAt: n, why}`. A tail that does not parse is
 * damaged; a line whose `prev` does not match the previous entry's hash is damaged; a line whose own hash does not
 * recompute is damaged. Nothing here drops a line to make the rest look whole.
 * @param {ReadonlyArray<string|Readonly<Record<string, unknown>>>} lines - raw lines (text or already-parsed entries), in file order.
 * @returns {{ok: boolean, count: number, head: string|null, damagedAt: number|null, why: string|null}}
 */
export function verifyChain(lines) {
  if (!Array.isArray(lines)) refuse('lines-missing', 'verifying a chain needs its lines')
  let previous = null
  for (const [index, raw] of lines.entries()) {
    let entry = raw
    if (typeof raw === 'string') {
      if (raw.trim() === '') continue
      try {
        entry = JSON.parse(raw)
      } catch {
        return { ok: false, count: index, head: previous?.hash ?? null, damagedAt: index, why: 'the line does not parse: a torn append, reported rather than truncated' }
      }
    }
    if (entry === null || typeof entry !== 'object') {
      return { ok: false, count: index, head: previous?.hash ?? null, damagedAt: index, why: 'the line is not an entry object' }
    }
    if (entryHashOf(entry) !== entry.hash) {
      return { ok: false, count: index, head: previous?.hash ?? null, damagedAt: index, why: 'the entry does not hash to what it claims, so something changed it' }
    }
    const expectedPrev = previous === null ? GENESIS_PREV : String(previous.hash)
    if (String(entry.prev) !== expectedPrev) {
      return { ok: false, count: index, head: previous?.hash ?? null, damagedAt: index, why: `the entry's prev is not the previous entry's hash, so the chain has a hole at ${String(index)}` }
    }
    if (Number(entry.seq) !== index) {
      return { ok: false, count: index, head: previous?.hash ?? null, damagedAt: index, why: `the entry's seq is ${String(entry.seq)} and the chain expects ${String(index)}` }
    }
    previous = entry
  }
  return { ok: true, count: lines.filter(one => String(one).trim() !== '').length, head: previous?.hash ?? null, damagedAt: null, why: null }
}

/**
 * The entry that records a note's arrival from the queue, which is the migration's only write (§6 and item 6).
 * @param {{previous?: Readonly<Record<string, unknown>>|null, id: string, objectDigest: string, at: string, actor?: string, reason?: string}} input
 * @returns {Readonly<Record<string, unknown>>}
 */
export function migratedEntry(input) {
  return nextEntry({ ...input, op: 'add', actor: input?.actor ?? 'migration/queue-v1', reason: input?.reason ?? 'the queued record became a remembered note, with its receipt where a source could be found' })
}
