/**
 * Hash-linked observer journal for one cycle-memory run.
 *
 * Every event carries its sequence, kind, details, the previous event's hash,
 * and its own SHA-256 over the canonical encoding of the first three fields
 * plus the previous hash. The chain verifies end to end; an edited or
 * reordered event breaks every later hash. The journal records what the run
 * observed — including failures — and proves nothing about model cognition,
 * billing, or any clock other than the observer's own.
 *
 * @module @aukora/core/cycle/journal
 */
import { createHash } from 'node:crypto'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'

/** Closed observer event kinds for one cycle-memory run. */
export const CYCLE_JOURNAL_KINDS = Object.freeze([
  'run-begin',
  'preflight',
  'budget',
  'recall',
  'prompt',
  'model-request',
  'model-response',
  'proposal-invalid',
  'validation',
  'execution',
  'outcome-staged',
  'outcome-settled',
  'outcome-refused',
  'outcome-unrepresentable',
  'cycle-end',
  'task-end',
  'arm-end',
  'check',
  'run-end',
])

/** One hash-linked journal event. */
export class CycleJournal {
  /** Verified event chain in sequence order. */
  #events = []

  /**
   * Append one event and return its frozen record.
   * @param {string} kind - one of {@link CYCLE_JOURNAL_KINDS}.
   * @param {unknown} details - bounded lossless-JSON details.
   * @returns {Readonly<{sequence: number, kind: string, details: unknown, previous: string | null, hash: string}>}
   */
  emit(kind, details) {
    if (!CYCLE_JOURNAL_KINDS.includes(/** @type {never} */ (kind))) {
      throw new TypeError(`cycle.journal: unknown event kind ${kind}`)
    }
    const previous = this.#events.at(-1)?.hash ?? null
    const detached = JSON.parse(canonicalJSON(details))
    const candidate = {
      sequence: this.#events.length + 1,
      kind,
      details: detached,
      previous,
    }
    const hash = createHash('sha256').update(canonicalJSON(candidate), 'utf8').digest('hex')
    const event = Object.freeze({ ...candidate, hash })
    this.#events.push(event)
    return event
  }

  /** @returns {readonly Readonly<{sequence: number, kind: string, details: unknown, previous: string | null, hash: string}>[]} the frozen chain. */
  events() {
    return Object.freeze([...this.#events])
  }
}

/**
 * Verify one closed journal: hashes must chain, sequences must be contiguous,
 * kinds must be known, and details must be lossless JSON data.
 * @param {unknown} input - candidate journal events.
 * @returns {{ok: true, count: number, head: string | null} | {ok: false, reason: string}}
 */
export function verifyCycleJournal(input) {
  if (!Array.isArray(input)) return { ok: false, reason: 'journal-not-array' }
  let previous = null
  for (let index = 0; index < input.length; index += 1) {
    const entry = input[index]
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, reason: 'journal-entry-not-plain' }
    }
    const record = /** @type {Record<string, unknown>} */ (entry)
    const keys = Object.keys(record)
    if (keys.length !== 5 || !['sequence', 'kind', 'details', 'previous', 'hash'].every(key => keys.includes(key))) {
      return { ok: false, reason: 'journal-entry-inexact' }
    }
    if (record.sequence !== index + 1) return { ok: false, reason: 'journal-sequence-gap' }
    if (!CYCLE_JOURNAL_KINDS.includes(/** @type {never} */ (record.kind))) {
      return { ok: false, reason: 'journal-kind-unknown' }
    }
    if (typeof record.hash !== 'string' || !/^[0-9a-f]{64}$/.test(record.hash)) {
      return { ok: false, reason: 'journal-fields-malformed' }
    }
    if (record.previous !== previous) return { ok: false, reason: 'journal-chain-broken' }
    let details
    try {
      details = JSON.parse(canonicalJSON(record.details))
    } catch {
      return { ok: false, reason: 'journal-details-not-json' }
    }
    const candidate = { sequence: record.sequence, kind: record.kind, details, previous }
    const expected = createHash('sha256').update(canonicalJSON(candidate), 'utf8').digest('hex')
    if (expected !== record.hash) return { ok: false, reason: 'journal-hash-mismatch' }
    previous = record.hash
  }
  return { ok: true, count: input.length, head: previous }
}
