/**
 * VERIFY A REMEMBERED RECORD AGAINST THE EVENT IT CAME FROM. (Fable's kira-121 Part B item 3; the contract is
 * `.agents/live/MEMORY-CONTRACT-v0.md`, line 9.)
 *
 * WHY THIS IS THE WHOLE POINT OF THE TIER. A `remembered` record is unsigned by design, so what makes it worth
 * anything is that anyone can go back to the exact session event it cites and check the bytes. This module answers
 * that question with one of three words and never with a shrug:
 *
 *   VERIFIED  the event was re-read and its digest is the one the record recorded.
 *   CHANGED   the event was re-read and its digest is NOT the recorded one — the source bytes moved under the record.
 *   MISSING   the event cannot be re-read at all: the session is gone, the line was deleted, or the reader refused.
 *
 * A FORGED RECEIPT IS REFUSED RATHER THAN ANSWERED. A record whose recorded digest is not itself a sha256 — or which
 * carries no source at all — is malformed evidence, not a memory whose source changed, and the difference matters: a
 * CHANGED answer implies there was something to change. Refusing is a named fault, and the caller reports it as one.
 *
 * WHAT IT DOES NOT DO: it does not read the session itself. The reader is INJECTED, because this plugin's file reads
 * belong to one audited boundary (`strict-read.mjs`) and a module that answered "VERIFIED" from its own private file
 * access would be a second, unaudited door onto the same store. A court can therefore drive all three answers with no
 * store at all, and a reader that throws is a MISSING rather than a crash.
 *
 * @module @aukora/dsh-plugin-kira/memory-verify
 */
import * as tiers from './memory-tiers.mjs'
import { sha256Hex } from './memory-tiers.mjs'

/** The closed answer vocabulary. `.agents/live/MEMORY-CONTRACT-v0.md`, line 9. */
export const VERIFY_ANSWERS = Object.freeze(['VERIFIED', 'CHANGED', 'MISSING'])

/** A named refusal: malformed evidence, never an answer about a source. */
export class KiraVerifyError extends Error {
  /**
   * @param {string} code - stable machine-readable refusal code suffix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`kira.verify: ${message}`)
    this.name = 'KiraVerifyError'
    this.code = `kira.verify:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new KiraVerifyError(code, message)
}

const HEX64 = /^[0-9a-f]{64}$/

/**
 * Answer VERIFIED, CHANGED or MISSING for one record — and VERIFIED REQUIRES THREE CHECKS, NOT ONE.
 *
 * **THE DEFECT THIS REPLACES, MEASURED 2026-09-26.** The first version hashed only the source event line. A record whose
 * TEXT had been edited — the reproduction was "I approved spending $400" — answered VERIFIED, because the event it cited
 * was untouched and nothing compared the record against itself. A swapped Aura entry answered VERIFIED for the same
 * reason. That is the exact failure the receipt exists to prevent: the event proves what was SAID, and only the id and
 * the chain prove that the record in front of you is the record that was made from it.
 *
 *  1. THE ID RECOMPUTES from the record's own stored fields (`recomputeRecordId`) — so an edited `text`, `kind`,
 *     `createdAt` or source receipt changes the id and cannot pass.
 *  2. THE SOURCE EVENT re-hashes to the recorded digest — so a session whose bytes moved is caught.
 *  3. THE AURA CHAIN ENTRY matches the recorded one — so a record cannot be lifted out of the chain it names.
 *
 * A failure of 1 or 3 is CHANGED with the failing check named; an event that cannot be re-read is still MISSING.
 * THE CHAIN READER IS REQUIRED: an unchecked third of the answer is not the answer, so a caller that supplies none is
 * refused by name rather than handed a VERIFIED that skipped it.
 *
 * @param {Readonly<Record<string, unknown>>} record - a record carrying `id`, `kind`, `text`, `createdAt`, `source{sessionId, seq, sha256}` and `aura{index, entryHash}`.
 * @param {(source: Readonly<Record<string, unknown>>) => (string|null|undefined)} readEventLine - the exact canonical event line, or null/undefined when it cannot be re-read. It may throw; a throw is a MISSING.
 * @param {(aura: Readonly<Record<string, unknown>>) => (string|null|undefined)} readChainEntry - the entry hash the Aura chain holds at `aura.index`, or null/undefined when the chain has no such entry. It may throw; a throw is a MISSING.
 * @returns {{id: string, source: string, recorded: string, recomputed: string|null, failed?: string}} the contract's answer shape, with the failing check named when the answer is CHANGED.
 * @throws {KiraVerifyError} when the record carries no usable receipt, or no chain reader is supplied.
 */
export function verifyRecord(record, readEventLine, readChainEntry) {
  if (record === null || typeof record !== 'object') refuse('record-missing', 'there is no record to verify')
  if (typeof readEventLine !== 'function') refuse('reader-missing', 'verification needs a reader for the session event; without one, nothing can be re-read and no answer would be honest')
  if (typeof readChainEntry !== 'function') {
    refuse('chain-reader-missing', 'verification needs a reader for the Aura chain entry: a VERIFIED that checked only the event line is the defect this answers, not the answer')
  }
  const source = record.source
  if (source === null || typeof source !== 'object') {
    refuse('receipt-missing', 'this record carries no source, so there is no event to re-read and no receipt to check')
  }
  // A DECLARED UNLINKED RECEIPT HAS NO DIGEST TO BE FORGED: it says so itself. Anything else that lacks a digest is still a
  // forgery rather than a stale receipt, which is why this guard is NARROWED rather than removed.
  const declaredUnlinked = source.state === 'UNLINKED'
  const recorded = declaredUnlinked ? null : source.sha256
  if (!declaredUnlinked && (typeof recorded !== 'string' || !HEX64.test(recorded))) {
    // A FORGED RECEIPT IS NOT A CHANGED SOURCE. Answering CHANGED here would imply the bytes moved, when what is
    // actually wrong is that the receipt was never a digest.
    refuse('receipt-forged', `the recorded digest ${JSON.stringify(recorded)} is not a sha256, so this receipt is forged rather than stale`)
  }

  // 1. THE RECORD AGAINST ITSELF. An edited text, kind, createdAt or source field changes the recomputed id.
  //
  // *** AND THE ID MUST BE RECOMPUTED IN THE SHAPE THE RECORD ACTUALLY IS. *** Measured 2026-09-26 by running the VERIFY
  // command against a store the engine had written: the note came back CHANGED with `id-recomputes` — because the id was
  // recomputed with the CONTRACT-V0 formula while the note was a §3.6 note whose id covers its own envelope. The receipt
  // was right and the checker was reading the wrong shape: the same class of gap as the missing `source`, one level
  // deeper. The shape is chosen by what the record carries, which is deterministic — a §3.6 note has a version and
  // evidence, a v0 record has kind and text — and never by trying both until one agrees, which would accept a record
  // whose id matches under a formula it does not claim.
  let idMatches = false
  try {
    const isNote = record.v !== undefined && Array.isArray(record.evidence)
    idMatches = (isNote ? tiers.recomputeNoteId(record) : tiers.recomputeRecordId(record)) === record.id
  } catch {
    idMatches = false
  }
  if (!idMatches) {
    return { id: String(record.id ?? ''), source: 'CHANGED', recorded, recomputed: null, failed: 'id-recomputes' }
  }
  if (record.contentHash !== undefined && sha256Hex(String(record.statement ?? record.text ?? "")) !== record.contentHash) {
    return { id: String(record.id ?? ''), source: 'CHANGED', recorded, recomputed: null, failed: 'content-hash-mismatch' }
  }
  // *** A DECLARED UNLINKED RECEIPT ANSWERS MISSING AND STOPS HERE (Fable, kira-122 decision 1: "it is NEVER verified"). ***
  // The check is FIRST and it RETURNS, so a digest pasted onto an unlinked record later cannot reach the comparisons below:
  // the record's own declaration outranks any field a later edit could add. MISSING rather than a refusal, because the
  // contract's three answers must stay three, and "the source is cited but not found" is exactly what MISSING means.
  if (source.state === 'UNLINKED') {
    return {
      id: String(record.id ?? ''), source: 'MISSING', recorded: null, recomputed: null,
      failed: 'source-not-found',
      because: typeof source.because === 'string' && source.because !== ''
        ? source.because
        : `the record cites session ${String(source.sessionId ?? 'unknown')} turn ${String(source.citedTurn ?? 'unknown')}, and the events for it are not in this store`,
    }
  }

  // 2. THE EVENT IT CITES. A session store that cannot produce the line is MISSING — the third word exists for that.
  let line
  try {
    line = readEventLine(source)
  } catch {
    line = null
  }
  if (line === null || line === undefined) {
    return { id: String(record.id ?? ''), source: 'MISSING', recorded, recomputed: null }
  }
  if (typeof line !== 'string') {
    refuse('reader-not-text', 'the reader must return the exact canonical event line as text, or null when it cannot be read')
  }
  const recomputed = sha256Hex(line)
  if (recomputed !== recorded) {
    return { id: String(record.id ?? ''), source: 'CHANGED', recorded, recomputed, failed: 'source-event' }
  }

  // 3. THE CHAIN ENTRY. A record that names an Aura entry the chain does not hold has been moved or was never chained.
  let chained
  try {
    chained = readChainEntry(record.aura ?? {})
  } catch {
    chained = null
  }
  if (chained === null || chained === undefined) {
    return { id: String(record.id ?? ''), source: 'MISSING', recorded, recomputed }
  }
  if (typeof chained !== 'string') {
    refuse('chain-reader-not-text', 'the chain reader must return the entry hash as text, or null when the chain has no such entry')
  }
  if (chained !== (record.aura?.entryHash ?? null)) {
    return { id: String(record.id ?? ''), source: 'CHANGED', recorded, recomputed, failed: 'aura-entry' }
  }

  return { id: String(record.id ?? ''), source: 'VERIFIED', recorded, recomputed, verbatim: verbatimOf(record, readEventLine) }
}

/**
 * The command-line shape: answer for many records, and refuse the whole run when a receipt is forged.
 * A forged receipt is a fault in the store rather than a memory whose source moved, so it is reported by name.
 * @param {ReadonlyArray<Readonly<Record<string, unknown>>>} records
 * @param {(source: Readonly<Record<string, unknown>>) => (string|null|undefined)} readEventLine
 * @param {(aura: Readonly<Record<string, unknown>>) => (string|null|undefined)} readChainEntry
 * @returns {{answers: ReadonlyArray<ReturnType<typeof verifyRecord>>, counts: Readonly<Record<string, number>>}}
 */
/**
 * Whether a record's own text appears in the event it cites — §3.5's fourth check, as a FLAG.
 * *** NOT A FAILURE. *** §3.5 marks it "(a flag, not a failure)": a record may be a paraphrase or an extraction whose words do not appear in the turn it cites, so this never touches the
 * verdict. `null` when the event cannot be read, because "does the text appear" has no answer when there is no event to look in.
 * @param {Readonly<Record<string, unknown>>} record
 * @param {(source: Readonly<Record<string, unknown>>) => (string|null|undefined)} readEventLine
 * @returns {boolean|null}
 */
function verbatimOf(record, readEventLine) {
  const text = typeof record?.text === 'string' ? record.text : null
  if (text === null || text === '') return null
  let line
  try { line = readEventLine(record.source ?? {}) } catch { return null }
  if (typeof line !== 'string' || line === '') return null
  let event
  try { event = JSON.parse(line) } catch { return null }
  return typeof event?.text === 'string' ? event.text.includes(text) : null
}

export function verifyRecords(records, readEventLine, readChainEntry) {
  if (!Array.isArray(records)) refuse('records-missing', 'the command needs the records to check')
  const answers = []
  for (const record of records) answers.push(verifyRecord(record, readEventLine, readChainEntry))
  const counts = { VERIFIED: 0, CHANGED: 0, MISSING: 0 }
  for (const answer of answers) counts[answer.source] += 1
  return { answers: Object.freeze(answers), counts: Object.freeze(counts) }
}

/**
 * PERCENTILES OF A SAMPLE, NEAREST-RANK, WITH THE METHOD AS PART OF THE ANSWER.
 *
 * The research pass's KIRA plan ends with *"honest records on the live store are 100% intact with p50/p95 reported"* — and a percentile without
 * its method is a number a reader cannot check. Nearest-rank is what this returns: the ⌈p·n⌉-th smallest sample, 1-based, NO interpolation, so
 * every reported figure IS one of the measured samples and nothing is invented between them. A trimmed mean or an interpolating quantile would
 * report a value no record ever took.
 *
 * An empty sample set returns nulls rather than zeros: `0` would read as "measurably instant", which is a stronger claim than "nothing was
 * measured", and this tree has spent the night removing stronger-than-earned claims.
 *
 * @param {ReadonlyArray<number>} samples
 * @returns {{count: number, p50: number|null, p95: number|null, min: number|null, max: number|null}}
 */
export function percentiles(samples) {
  const clean = (Array.isArray(samples) ? samples : [])
    .map(Number)
    .filter(one => Number.isFinite(one))
    .sort((a, b) => a - b)
  if (clean.length === 0) return Object.freeze({ count: 0, p50: null, p95: null, min: null, max: null })
  const at = p => clean[Math.min(clean.length - 1, Math.max(0, Math.ceil(p * clean.length) - 1))]
  return Object.freeze({ count: clean.length, p50: at(0.5), p95: at(0.95), min: clean[0], max: clean[clean.length - 1] })
}
