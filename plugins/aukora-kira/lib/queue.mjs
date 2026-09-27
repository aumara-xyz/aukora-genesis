/**
 * THE PENDING REVIEW QUEUE — the shape of one staged record waiting for a person.
 *
 * WHY A QUEUE EXISTS. Kira stages proposals and writes no memory, and every settlement
 * needs two operator documents minted outside the model. That is the right authority
 * design and it left a human-factors hole: a record worth keeping is staged inside a turn
 * and then *evaporates* when the turn ends, because nothing durable named it. The operator
 * could not review what nobody had written down. This module is the written-down half.
 *
 * WHAT THIS MODULE IS, AND IS NOT. It is PURE: it derives an entry from a staged record,
 * encodes and decodes the entry text, and re-verifies a decoded entry against the record
 * contract. It holds NO filesystem route at all — not a read, not a write. That is not a
 * stylistic split: this package's write boundary allows a filesystem route in exactly one
 * module, and allows `node:fs`/`node:path` to NO other module, so a queue that touched its
 * own directory here would be refused by the boundary court rather than by review. The
 * owner module holds the directory; this module holds the contract, and a court can drive
 * the contract with no disk and no store.
 *
 * A QUEUED ENTRY IS NOT A MEMORY. It is not recallable, it grants nothing, and it carries
 * no authority material. It is a note that says: here are the exact bytes a person may
 * choose to settle. Deleting the whole queue directory loses nothing that was ever
 * promised — which is why the queue is safe to treat as disposable and why the settlement
 * path never reads its decisions from here.
 *
 * AN ENTRY THAT DOES NOT VERIFY IS A NAMED STATE, NEVER A DROPPED ROW. The listing is the
 * one place a person looks to decide what to approve, so a queued file whose bytes no
 * longer reproduce its own `recordId` — edited on disk, truncated, half-written — must
 * surface as `unreadable` with its reason. Silently skipping it would make a tampered
 * queue read as a shorter queue, which is the failure this whole contract exists to make
 * impossible.
 *
 * @module @aukora/dsh-plugin-kira/queue
 */
import {
  KIRA_RECORD_ID,
  canonicalJSON,
  kiraRecordContentSha256,
  verifyKiraMemoryRecord,
} from './record.mjs'

/** The queue entry format version. A new field changes this, not the record domain. */
export const QUEUE_ENTRY_VERSION = 1

/** The closed field set of one queue entry. */
export const QUEUE_ENTRY_FIELDS = Object.freeze([
  'version', 'recordId', 'subject', 'kind', 'createdAt', 'privacy', 'record',
])

/** Most entries one listing returns. Beyond this the reply says so rather than truncating quietly. */
export const MAX_QUEUE_LIST = 100

/** Most characters of a record's own text one listing carries, so a person can review quickly. */
export const MAX_REVIEW_TEXT = 280

/** A named queue refusal; every refusal carries one stable code. */
export class KiraQueueError extends Error {
  /** Stable machine-readable refusal code, e.g. `kira.queue:record-unverified`. */
  code

  /**
   * @param {string} code - stable refusal code suffix.
   * @param {string} message - human-readable refusal, free of caller data echoes.
   */
  constructor(code, message) {
    super(`kira.queue: ${message}`)
    this.name = 'KiraQueueError'
    this.code = `kira.queue:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new KiraQueueError(code, message)
}

/**
 * Derive the durable entry for one staged record.
 *
 * THE RECORD IS RE-VERIFIED HERE, ON THE WAY IN. `stageKiraMemoryRecord` already computed
 * this record, so this looks redundant; it is not. The entry is what a person will read
 * weeks later and what an operator command will mint a grant against, so the bytes that
 * reach the disk are the bytes that verify, checked at the boundary where they leave the
 * turn — not assumed from the fact that a tool called a staging function.
 *
 * @param {Readonly<{recordId: string, record: Readonly<Record<string, unknown>>}>} staged - output of `stageKiraMemoryRecord`.
 * @returns {Readonly<Record<string, unknown>>} the frozen queue entry, fields in a fixed order.
 * @throws {KiraQueueError} when the staged record does not verify against its own identifier.
 */
export function queueEntryFor(staged) {
  if (staged === null || typeof staged !== 'object') {
    refuse('record-unverified', 'a queue entry can only be derived from a staged record')
  }
  const verdict = verifyKiraMemoryRecord(staged.record)
  if (verdict.verified !== true) {
    refuse('record-unverified', `the staged record does not verify (${verdict.reason}); nothing was queued`)
  }
  if (verdict.record.recordId !== staged.recordId) {
    refuse('record-unverified', 'the staged record verifies to a different identifier than the one it was queued under')
  }
  const record = verdict.record
  return Object.freeze({
    version: QUEUE_ENTRY_VERSION,
    recordId: record.recordId,
    subject: record.subject,
    kind: record.kind,
    createdAt: record.createdAt,
    privacy: record.privacy,
    record,
  })
}

/**
 * The exact bytes one entry occupies on disk.
 *
 * Canonical, so the same staged bytes always produce the same entry text and a re-stage is
 * byte-identical rather than a near-duplicate a reviewer has to compare by eye.
 * @param {Readonly<Record<string, unknown>>} entry - a `queueEntryFor` result.
 * @returns {string} deterministic entry text, newline-terminated.
 */
export function queueEntryText(entry) {
  return `${canonicalJSON(entry)}\n`
}

/**
 * Decode one queued file and re-establish what it claims.
 *
 * FOUR ANSWERS, AND "UNREADABLE" IS NOT "GONE": a caller gets `pending` with the verified
 * record, or `unreadable` with the reason it could not be established. There is no branch
 * that returns nothing for a file that exists.
 *
 * @param {string} text - the file's contents.
 * @returns {{state: 'pending', entry: Readonly<Record<string, unknown>>} | {state: 'unreadable', reason: string}} the decoded entry or the named reason it failed.
 */
export function readQueueEntry(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { state: 'unreadable', reason: 'not-json' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { state: 'unreadable', reason: 'not-a-record' }
  }
  const own = Object.keys(parsed)
  if (own.length !== QUEUE_ENTRY_FIELDS.length || QUEUE_ENTRY_FIELDS.some(field => !own.includes(field))) {
    return { state: 'unreadable', reason: 'field-set-mismatch' }
  }
  if (parsed.version !== QUEUE_ENTRY_VERSION) return { state: 'unreadable', reason: 'version-unknown' }
  if (typeof parsed.recordId !== 'string' || !KIRA_RECORD_ID.test(parsed.recordId)) {
    return { state: 'unreadable', reason: 'record-id-invalid' }
  }
  // THE TEXT MUST BE ITS OWN CANONICAL FORM. `JSON.parse` keeps the LAST of two identical keys, so a file can
  // say one thing to a person reading it with `cat` and another to the tools that approve it — the display and
  // the decision coming from the same bytes and disagreeing. Re-serializing what was parsed and comparing the
  // RESULT WITH THE BYTES is what closes that: a reordered key, a duplicate key, a number spelled `1e2` where
  // the canonical form says `100`, or trailing whitespace all fail here, by name, rather than being silently
  // normalized into agreement.
  if (queueEntryText(parsed) !== text) {
    return { state: 'unreadable', reason: 'text-not-canonical' }
  }
  // THE RECORD IS THE EVIDENCE, so it is re-verified rather than believed. A file whose
  // record no longer reproduces the identifier in its own header is exactly the tampering
  // this state exists to report.
  const verdict = verifyKiraMemoryRecord(parsed.record)
  if (verdict.verified !== true) return { state: 'unreadable', reason: verdict.reason }
  if (verdict.record.recordId !== parsed.recordId) {
    return { state: 'unreadable', reason: 'identity-mismatch' }
  }
  // THE HEADER IS A PURE FUNCTION OF THE RECORD, so it is CHECKED against the verified record rather
  // than trusted or silently corrected. `queueEntryFor` copies every header field out of the record it
  // just verified, so a file whose header disagrees with its own record can only be one that was
  // EDITED after it was written. Restating the record's values over the file's would produce a truthful
  // row while erasing the evidence that anything was touched — this contract reports the edit instead.
  const expected = {
    recordId: verdict.record.recordId,
    subject: verdict.record.subject,
    kind: verdict.record.kind,
    createdAt: verdict.record.createdAt,
    privacy: verdict.record.privacy,
  }
  for (const [field, value] of Object.entries(expected)) {
    if (parsed[field] !== value) return { state: 'unreadable', reason: 'header-mismatch' }
  }
  return {
    state: 'pending',
    entry: Object.freeze({
      version: QUEUE_ENTRY_VERSION,
      recordId: expected.recordId,
      subject: expected.subject,
      kind: expected.kind,
      createdAt: expected.createdAt,
      privacy: expected.privacy,
      record: verdict.record,
    }),
  }
}

/**
 * The short text a person reads when deciding, taken from the record's own content.
 *
 * A RECORD HAS NO OBLIGATORY PROSE. `content` is caller-shaped lossless JSON, so the only
 * thing that can be projected for certain is the canonical form of whatever is there — and
 * for the common case a `note` string is the whole point of the record, so it is preferred
 * and the truncation is REPORTED rather than silent.
 * @param {Readonly<Record<string, unknown>>} entry - a verified entry.
 * @returns {{text: string, truncated: boolean, omittedChars: number}} the review text, whether it was cut, and BY HOW MUCH.
 */
export function reviewTextOf(entry) {
  const content = entry?.record?.content
  const full = content !== null && typeof content === 'object' && !Array.isArray(content)
    && typeof content.note === 'string'
    ? content.note
    : canonicalJSON(content)
  // COUNTED IN CODE POINTS, the same unit the recall snippet uses, so a row and a snippet clip a record
  // the same way and neither can cut a character in half. And the quantity travels WITH the flag: a row
  // that says "cut" and not "by how much" is the defect this closes, one layer below where it was first
  // fixed for recall — MEASURED on the live row, which read `truncated:true` with no count.
  const characters = [...full]
  if (characters.length <= MAX_REVIEW_TEXT) return { text: full, truncated: false, omittedChars: 0 }
  const omittedChars = characters.length - MAX_REVIEW_TEXT
  return { text: characters.slice(0, MAX_REVIEW_TEXT).join(''), truncated: true, omittedChars }
}

/**
 * The one review row for a verified entry: identity, the record's own instant, and its text.
 *
 * `settled` IS DERIVED, NEVER STORED. A queued record that has since been settled must stop reading as
 * something to approve, or a person is asked to approve the same bytes twice — and the second approval
 * would be a second authorization for a write that already happened. The caller establishes it from the
 * store (the entry is settled when the store holds its object), so nothing has to REMOVE a queue entry
 * for the queue to be correct. That is why there is no dequeue action anywhere: deletion would be a
 * second source of truth about the same fact, and the two could disagree.
 *
 * @param {Readonly<Record<string, unknown>>} entry - a verified entry.
 * @param {number} [queueMtimeMs] - the filesystem's own modification time for the entry file, when the caller has it.
 * @param {boolean} [settled] - whether the store already holds this record.
 * @param {boolean} [declined] - whether the store's content-scoped declined document names these bytes.
 * @returns {Readonly<Record<string, unknown>>} a bounded row for a listing.
 */
export function queueRowOf(entry, queueMtimeMs, settled, declined) {
  const { text, truncated, omittedChars } = reviewTextOf(entry)
  return Object.freeze({
    // A DECLINED RECORD IS NOT WAITING FOR ANYONE. Derived like `settled`, and for the same reason: the
    // decision lives in the store's own declined document, so nothing has to be deleted and the two
    // cannot disagree. PRECEDENCE IS SETTLED > DECLINED > PENDING, because a record that was declined
    // and then WRITTEN — a later approval, a fresh grant — is a record the store holds, and answering
    // `declined` about bytes that exist would invite a second review of something already decided.
    state: settled === true ? 'settled' : (declined === true ? 'declined' : 'pending'),
    settled: settled === true,
    declined: declined === true,
    recordId: entry.recordId,
    kind: entry.kind,
    // ── THE CLASSIFICATION, ON THE ROW A PERSON READS ───────────────────────────────────────────────
    // MEASURED 2026-09-24: a lane's instruction to another agent was auto-staged as a `preference`, and
    // the row a reviewer saw carried no classification at all — so the one label that would have told
    // them "this is not Peter's wish" existed in the store and nowhere they would meet it. A
    // classification nobody can see changes nothing. Absent for entries staged without one (the model's
    // own `kira_stage` carries no classifier), so this is an addition and never a rewrite.
    ...(typeof entry.record?.content?.category === 'string' ? { classification: entry.record.content.category } : {}),
    ...(typeof entry.record?.content?.ceiling === 'string' ? { classificationCeiling: entry.record.content.ceiling } : {}),
    createdAt: entry.createdAt,
    privacy: entry.privacy,
    text,
    truncated,
    omittedChars,
    // ── WHICH BYTES AN APPROVAL WOULD BIND ──────────────────────────────────────────────────────────
    // The row a person reviews named no digest at all, so "what exactly would I be approving?" had to be
    // computed outside the tool whose job that is. This is the digest the decline path already writes
    // into `declined.json`, and it is the SAME number as `kiraRecordContentSha256`: the sha256 of the
    // exact `{key, value}` effect body the grant and the approval bind. One number, one meaning — and
    // DERIVED from the record here rather than carried in the entry, so a row cannot report a digest its
    // own bytes do not have.
    proposalDigest: kiraRecordContentSha256(/** @type {Record<string, unknown>} */ (entry.record)),
    // THE FILESYSTEM'S CLOCK, NAMED AS SUCH. The record carries a caller-supplied
    // `createdAt`, which is a claim; this is when the entry file was last written, which is
    // an observation. They are different facts and only one of them is a claim, so they
    // travel in differently-named fields rather than being merged into one "time".
    ...(typeof queueMtimeMs === 'number' && Number.isFinite(queueMtimeMs) ? { queueMtimeMs } : {}),
  })
}
