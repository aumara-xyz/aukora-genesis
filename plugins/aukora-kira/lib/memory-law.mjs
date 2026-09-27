/**
 * THE ORIGINAL MEMORY LAW, CALLED RATHER THAN RESTATED.
 *
 * The law is aumara-xyz/aukora `packages/memory` at def297f, vendored byte for byte in
 * `vendor/aukora-packages/src/packages/memory` and type-stripped into `vendor/aukora-packages/lib` by that directory's
 * `transpile.mjs` (PROVENANCE.json records every emitted byte and the two import rewrites). Nothing here re-implements
 * it: the two rules Kira's live path must hold are decided by the law's own functions.
 *
 *  1. TIERS. A memory is ADVISORY by construction (`memoryGrantsAuthority()` is the constant `false`), and a write that
 *     presents no capability is QUARANTINED by the ingest gate (`qualifyMemoryIngest`), never accepted as trusted. A
 *     remembered note is captured with no approval at all, so the law quarantines it: it is the UNSIGNED tier. Its chain
 *     entries therefore go to the unsigned tier's own chain (`remembered/aura.jsonl`) and never to the approved chain
 *     (`aura.jsonl`), which is the only chain the public evidence export copies (`scripts/kira/public-evidence.mjs`).
 *  2. FORGETTING. A forget leaves the law's CONTENT-FREE tombstone, `tombstoneCommitment({recordId, at})` =
 *     `{kind: 'tombstone', recordId, at}`, hashed with the kernel's canonical hash. Never the words, and never a caller's
 *     free-text reason, because free text is exactly where the words would ride into an append-only journal.
 *
 * Pure: no I/O, no clock. The vendored modules it imports are pure too.
 *
 * @module @aukora/dsh-plugin-kira/memory-law
 */
import { memoryGrantsAuthority, tombstoneCommitment } from '../../../vendor/aukora-packages/lib/packages/memory/src/envelope.js'
import { qualifyMemoryIngest } from '../../../vendor/aukora-packages/lib/packages/memory/src/ingestGate.js'
import { canonicalHash } from '../../../vendor/authority/lib/canonical.js'

/** A named refusal: a record the law will not admit, or a tombstone with nothing to name. */
export class KiraMemoryLawError extends Error {
  /**
   * @param {string} code - stable machine-readable refusal code suffix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`kira.law: ${message}`)
    this.name = 'KiraMemoryLawError'
    this.code = `kira.law:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new KiraMemoryLawError(code, message)
}

/**
 * Admit one note to the UNSIGNED tier, by the law, or refuse it.
 *
 * The capture path presents NO capability (nobody approved the note), and Kira's notes are local-private, so the law is
 * asked about a `private` write with `capabilityValid: false`. Its answer must be `quarantine`: anything else would mean a
 * capture was about to be treated as trusted. A note that claims authority is refused before the law is even asked.
 *
 * @param {Readonly<Record<string, unknown>>} note - a note built by `buildRememberedNote`.
 * @returns {{decision: 'quarantine', consent: string, provenance: string}} the law's qualification.
 */
export function qualifyUnsignedNote(note) {
  if (note === null || typeof note !== 'object') refuse('note-missing', 'there is no note to qualify')
  if (note.grantsAuthority !== memoryGrantsAuthority()) {
    refuse('note-claims-authority', 'a remembered note is advisory by construction (grantsAuthority: false); a note that claims authority is refused, not stored')
  }
  if (note.tier !== 'remembered') {
    refuse('note-not-unsigned', `only the unsigned tier is written by capture; a note of tier ${JSON.stringify(note.tier)} does not belong here`)
  }
  const qualification = qualifyMemoryIngest({ consent: 'private', capabilityValid: false })
  if (qualification.decision !== 'quarantine') {
    refuse('law-did-not-quarantine', `the ingest gate answered ${JSON.stringify(qualification.decision)} for a write with no capability`)
  }
  return qualification
}

/**
 * The law's content-free tombstone for a forgotten record, and its kernel canonical hash.
 *
 * It names the record by id and the moment it was forgotten, and nothing else: no text, no quote, no source, no reason.
 *
 * @param {{id: string, at: string}} input
 * @returns {Readonly<{tombstone: Readonly<{kind: 'tombstone', recordId: string, at: string}>, hash: string}>}
 */
export function contentFreeTombstone(input) {
  const { id, at } = input ?? {}
  if (typeof id !== 'string' || id === '') refuse('tombstone-id-missing', 'a tombstone names the record it replaces')
  if (typeof at !== 'string' || at === '') refuse('tombstone-at-missing', 'a tombstone names when the record was forgotten')
  const tombstone = Object.freeze(tombstoneCommitment({ recordId: id, at }))
  return Object.freeze({ tombstone, hash: canonicalHash(tombstone) })
}
