/**
 * MEMORY TIERS — TRACKED, NOT APPROVED. (Fable's kira-121 Part B item 1; the authority is now
 * `~/aukora-private/reviews/memory-design-2026-09-26.md` §2, revision 2, which OVERRIDES contract v0 in two ways:
 * the tier called "trusted" is renamed "SIGNED", and new signing does not ship at all until the presence gate exists.)
 *
 * WHAT CHANGED, AND WHY THIS FILE EXISTS AT ALL. Kira as built asked a person to approve every memory, so nothing was
 * ever remembered: three records settled, a hundred and thirty waiting, and an owner who never knew he was supposed to
 * approve anything. Peter's direction is that a memory is TRACKED CRYPTOGRAPHICALLY: it is written as soon as a turn
 * produces it, it is recallable at once, and what makes it trustworthy is that anyone can go back to the exact session
 * event it came from and check the bytes — not that somebody clicked.
 *
 * THE FOUR TIERS, and the one asymmetry that matters:
 *
 *   remembered  AUTOMATIC, UNSIGNED, receipt-backed. Usable in recall at once, labelled UNREVIEWED, and it grants no
 *               authority ever (`grantsAuthority: false`, §2.1). No approval, no signature, no queue.
 *   signed      notes the owner read in the signer sheet and signed. Can act as a standing instruction. **NEW SIGNING
 *               DOES NOT SHIP** (§2.4): until the presence gate requires the owner in person AND the signer check
 *               passes, `markSigned` refuses, and a rule the owner asks for is stored as a note marked NOT IN EFFECT.
 *               Wherever the word "signed" appears, the ceiling `SIGNING_KEY_READABLE_BY_SAME_USER` is printed with it.
 *   proposal    a candidate rule, from the weekly dream or the owner's "make this a rule". Only once the gate exists.
 *   forgotten   tombstoned: it leaves recall, and the tombstone stays so that its absence is auditable rather than
 *               indistinguishable from "never existed".
 *
 * THE TWO TIERS LIVE IN DIFFERENT STORES (§2.1): `remembered` in the new `kira-memory/remembered/`, and `signed` in the
 * existing settled store. That is not a detail — it is why a capture bug cannot write authority.
 *
 * WHAT THIS MODULE IS NOT. It does not read, write, or know where anything is stored; it does not import a session
 * service, a clock, or a store. It builds and validates RECORDS, and the caller supplies the bytes.
 *
 * @module @aukora/dsh-plugin-kira/memory-tiers
 */
import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto'
import { contentFreeTombstone } from './memory-law.mjs'

/** The closed tier vocabulary. The design's §2.1: "trusted" was renamed "signed" in revision 2. */
export const MEMORY_TIER = Object.freeze({ remembered: 'remembered', signed: 'signed', proposal: 'proposal', forgotten: 'forgotten' })
export const MEMORY_TIERS = Object.freeze(Object.values(MEMORY_TIER))
// Storage/provenance names are not authority tiers. In particular, an index hit is
// never a signed record, and a historical queue item imports as remembered only.
export const MEMORY_STORAGE = Object.freeze({
  remembered: 'remembered', // Canonical automatic capture; unsigned, also the old per-ID vector layout.
  governed: 'governed',     // Historical settled-record projection; its directory grants no authority.
  room: 'room',             // Legacy external notes; imported as unlinked, advisory data.
  content: 'content',       // Rebuildable vectors keyed by exact statement hash; never canonical history.
  queue: 'queue',           // Historical proposals; reconciled to unsigned history, never silently deleted.
})
export const MEMORY_STORAGE_TIERS = Object.freeze(Object.values(MEMORY_STORAGE))

/** The tier name revision 1 used. REFUSED rather than aliased: a silent alias would hide the rename from every caller. */
export const RENAMED_TIER = Object.freeze({ trusted: 'signed' })

/**
 * THE NOTE VOCABULARY — the kinds a remembered NOTE can carry, from `.agents/live/MEMORY-CONTRACT-v0.md` line 4.
 *
 * *** NAMED `noteKind` BECAUSE KIRA HAS TWO CLOSED KIND LISTS AND THEY WERE INDISTINGUISHABLE BY NAME (Fable's row 51). ***
 * The other is `recordKind` in `record.mjs`: the kinds a RECORD in the store can carry, from the KIRA memory specification.
 * Two vocabularies, two specs, two names.
 *
 * *** AND THEY OVERLAP, WHICH IS A FACT RATHER THAN AN OVERSIGHT: `preference` and `observation` are legitimate members of
 * both. *** The arm that follows asserts the overlap is EXACTLY those two, so a third one arriving unnoticed fails a court
 * instead of quietly making a rendered kind ambiguous. If Fable wants the vocabularies disjoint instead, that is a spec change
 * in one of the two documents and I will make it in one commit — `recordKind` is the specification's closed set and cannot
 * lose a member on my word.
 */
export const noteKind = Object.freeze(['fact', 'preference', 'decision', 'commitment', 'person', 'project', 'observation'])

/** The tiers that appear in recall (§2.1): Remembered labelled `unreviewed`, Signed labelled `signed`. */
export const RECALL_TIERS = Object.freeze([MEMORY_TIER.remembered, MEMORY_TIER.signed])

/** How recall labels each tier when Auma speaks (§2.1). Auma never says "verified" or "confirmed" (§2.3). */
export const TIER_LABELS = Object.freeze({ remembered: 'unreviewed', signed: 'signed' })
/** The receipt state of a note whose source is cited but could not be found. A NAMED STATE, so a missing digest cannot be mistaken for it. */
export const UNLINKED_RECEIPT = 'UNLINKED'
/** What recall and the face say for such a note: the tier AND the receipt state, because either alone would mislead. */
export const UNLINKED_LABEL = 'remembered, source not found'

/**
 * THE CEILING THAT MUST BE PRINTED WHEREVER "SIGNED" APPEARS (§2.4). Fact F1: today a signature proves only that some
 * same-user process had the key, so a signed note is not yet proof that the owner was present.
 */
export const SIGNING_CEILING = 'SIGNING_KEY_READABLE_BY_SAME_USER'

/**
 * THE CEILINGS A RECALL REPLY MUST CARRY (§10.2). *"Ceilings (printed in service replies, the app's More section and the docs)"* — and every name here is copied
 * character-for-character from that table, because a ceiling a reader cannot look up is a ceiling that tells them nothing. The `kira-ceilings-vocabulary` court exists
 * precisely because one spelling drifted before (`SAME_UID_APPROVAL` → `SIGNING_KEY_READABLE_BY_SAME_USER`), and it is red today.
 *
 * The three are the ones true of ANY reply this service can give:
 *   LEXICAL_RECALL_MISSES_PARAPHRASE — recall is word-based; a note phrased differently will not be found, so an empty reply is not evidence of absence.
 *   REMEMBERED_IS_UNREVIEWED          — the notes were extracted by rules rather than checked by a person, and may be wrong.
 *   STATEMENT_IS_MODEL_WORDING        — the quote is the owner's; the statement beside it is not.
 */
export const RECALL_CEILINGS = Object.freeze([
  'LEXICAL_RECALL_MISSES_PARAPHRASE',
  'REMEMBERED_IS_UNREVIEWED',
  'STATEMENT_IS_MODEL_WORDING',
])

/**
 * WHETHER NEW SIGNING SHIPS. FALSE, and it is a constant rather than a flag on purpose: §2.4 says no batch signing,
 * promote, signed erase or re-sign ships until (F1) the presence gate requires the owner in person and (F6) the signer
 * check confirms `aumlok-signer.mjs` serves in the running release. Flipping this is a decision with evidence behind it,
 * not a configuration change.
 */
export const SIGNING_ENABLED = false

/** A named refusal. Refusals are for malformed or unauthorised input, never for "nothing to remember". */
export class KiraMemoryTierError extends Error {
  /**
   * @param {string} code - stable machine-readable refusal code suffix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`kira.memory: ${message}`)
    this.name = 'KiraMemoryTierError'
    this.code = `kira.memory:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new KiraMemoryTierError(code, message)
}

/** The tier name to use, refusing the one revision 1 used so the rename cannot pass silently. */
function tierName(tier) {
  if (typeof tier === 'string' && RENAMED_TIER[tier] !== undefined) {
    refuse('tier-renamed', `the tier ${JSON.stringify(tier)} was renamed ${JSON.stringify(RENAMED_TIER[tier])} in the memory design's revision 2; use the new name`)
  }
  return tier
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const HEX64 = /^[0-9a-f]{64}$/
/** The SPKI prefix for a raw 32-byte Ed25519 public key, so node:crypto can read one. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/**
 * A deterministic canonical encoding: JCS-shaped, and SORTED AT EVERY DEPTH.
 *
 * **THE DEFECT THIS REPLACES, MEASURED 2026-09-26.** The first version sorted the TOP-LEVEL keys and then handed each
 * value to `JSON.stringify`, which preserves an object's INSERTION order — so a nested `source` written
 * `{sessionId, sessionTitle}` and one written `{sessionTitle, sessionId}` produced different bytes and therefore
 * different ids. The research pass found the id unrecomputable in two of three key orders; measured against the
 * committed code it was unrecomputable in ALL THREE, including the one it was built with, because the builder hashed
 * the caller's `source` (no `sessionTitle`) while storing one with `sessionTitle` defaulted in. An id a reader cannot
 * recompute from the record is an id you have to take on faith, which is the thing this tier exists to avoid.
 *
 * THE GRAMMAR, exactly: `null`; strings as JSON strings; booleans; finite numbers (a non-finite number is REFUSED
 * rather than serialised to something that cannot be read back); arrays in order; objects with keys sorted by code
 * unit and `undefined` members dropped. No whitespace anywhere.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalOf(value) {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) refuse('canonical-not-finite', `a canonical form cannot carry ${String(value)}: it would not read back as the same number`)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(one => canonicalOf(one)).join(',')}]`
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalOf(value[key])}`).join(',')}}`
  }
  refuse('canonical-unsupported', `a canonical form cannot carry a ${typeof value}`)
}

/** @param {string} text @returns {string} the hex sha256 of a UTF-8 string. */
export function sha256Hex(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
}

/** The first `max` UTF-16 units of `text`, minus a trailing high surrogate: a cut never stores half an emoji, which the
 * strict reader refuses (json:lone-surrogate) and which would mark the whole store incomplete. */
export function cutText(text, max) {
  const cut = String(text ?? '').slice(0, max)
  return /[\uD800-\uDBFF]$/u.test(cut) ? cut.slice(0, -1) : cut
}

/**
 * THE HARNESS'S `time` IS MILLISECONDS AND A RECEIPT'S `at` IS SECONDS — the conversion, so no caller has to know.
 *
 * **MEASURED against a real session event on 2026-09-26.** A stored event carries `time: 1789951036324`, and a caller who
 * passes `new Date(event.time).toISOString()` produces `…T06:00:00.000Z`, which `captureTurn` correctly REFUSES as
 * `kira.capture:digest-malformed`: the contract's `at` is a canonical SECONDS-precision UTC instant. The refusal is right —
 * a receipt whose instant depends on which formatter a caller used cannot be compared with another — but the conversion had
 * to live somewhere, and until it did, every caller deriving `at` from an event's own time would hit the refusal and guess.
 *
 * It accepts milliseconds (the harness's form), seconds (a caller who already converted) and an ISO string, because all
 * three are things a caller plausibly holds. Anything else is refused rather than coerced.
 * @param {number|string} time - milliseconds, seconds, or an ISO instant.
 * @returns {string} a `YYYY-MM-DDTHH:MM:SSZ` instant.
 */
export function canonicalInstant(time) {
  const ms = typeof time === 'number'
    ? (time > 1e11 ? time : time * 1000)   // 1e11 ms is 1973; anything smaller is seconds
    : Date.parse(String(time))
  // THE CLASS NAME IS REAL, checked against the module rather than assumed: my first version threw `KiraTierError`, which does
  // not exist here, so the helper would have raised a ReferenceError instead of the refusal it promises.
  if (!Number.isFinite(ms)) throw new KiraMemoryTierError('instant-unreadable', `cannot read an instant from ${JSON.stringify(time)}`)
  return `${new Date(ms).toISOString().slice(0, 19)}Z`
}

/**
 * The record id: content-addressed over the fields that determine what this record IS.
 * @param {Record<string, unknown>} fields
 * @returns {string}
 */
export function memoryRecordId(fields) {
  return sha256Hex(canonicalOf(fields))
}

/**
 * A `remembered` record: automatic, unsigned, receipt-backed, usable at once, and granting NO authority.
 *
 * NO SIGNATURE IS ASKED FOR AND NONE IS ACCEPTED as a substitute for the receipt. What makes this record checkable is
 * `source.sha256` — the digest of the exact canonical session event line — and `aura`, the chain entry the record's own
 * hash was appended to. `grantsAuthority` is false HERE, at construction, so no later layer can decide otherwise.
 *
 * @param {{kind: string, text: string, createdAt: string, source: {sessionId: string, sessionTitle?: string, seq: number, at: string, sha256: string}, aura: {index: number, entryHash: string}, subject: string, privacy: string}} input
 * @returns {Readonly<Record<string, unknown>>}
 */
export function buildRememberedRecord(input) {
  const { kind, text, createdAt, source, aura, subject, privacy } = input ?? {}
  if (!noteKind.includes(/** @type {never} */ (kind))) {
    refuse('kind-unknown', `kind ${JSON.stringify(kind)} is not one of the contract's kinds: ${noteKind.join(', ')}`)
  }
  if (typeof text !== 'string' || text.trim() === '') refuse('text-empty', 'a memory with no text is not a memory')
  if (typeof createdAt !== 'string' || !INSTANT.test(createdAt)) {
    refuse('createdAt-not-canonical', '`createdAt` must be a canonical seconds-precision UTC instant; no local clock participates')
  }
  if (typeof subject !== 'string' || subject === '') refuse('subject-missing', 'the host read-owner subject is never supplied by the model, and it is required')
  if (typeof privacy !== 'string' || privacy === '') refuse('privacy-missing', 'the privacy class comes from the host policy, and it is required')
  if (source === null || typeof source !== 'object') refuse('source-missing', 'a remembered record carries the session event it came from')
  if (typeof source.sessionId !== 'string' || source.sessionId === '') refuse('source-session-missing', 'the source must name the session it came from')
  if (!Number.isInteger(source.seq) || source.seq < 0) refuse('source-seq-missing', 'the source must carry the event sequence number')
  if (typeof source.at !== 'string' || !INSTANT.test(source.at)) refuse('source-at-not-canonical', 'the source must carry the event instant in canonical form')
  if (typeof source.sha256 !== 'string' || !HEX64.test(source.sha256)) {
    refuse('source-digest-missing', 'the source must carry the sha256 of the exact canonical event line — without it the record cannot be verified later, which is the whole point of this tier')
  }
  if (aura === null || typeof aura !== 'object' || !Number.isInteger(aura.index) || typeof aura.entryHash !== 'string' || !HEX64.test(aura.entryHash)) {
    refuse('aura-entry-missing', 'the record must name the Aura chain entry its own hash was appended to')
  }
  const storedSource = Object.freeze({ sessionTitle: '', ...source })
  // *** THE ID IS TAKEN OVER THE BYTES AS STORED, AND OVER NOTHING THAT MOVES. *** Two corrections, both measured on
  // 2026-09-26. First, the id used to be taken over the CALLER'S `source` while a `sessionTitle`-defaulted one was
  // stored, so not even the record's own fields recomputed it. Second, the id used to include `tier`, which
  // `markSigned` and `forgetRecord` both change — so a signed or forgotten record could never recompute its own id.
  // The id covers what the record IS: kind, text, createdAt and the source receipt. Tier moves are recorded BESIDE it.
  const id = memoryRecordId({ kind, text, createdAt, source: storedSource })
  return Object.freeze({
    id,
    tier: 'remembered',
    kind,
    text,
    createdAt,
    source: storedSource,
    aura: Object.freeze({ index: aura.index, entryHash: aura.entryHash }),
    subject,
    privacy,
    // §2.1: "None, ever". Set at construction so that no downstream frame can promote a captured note by accident.
    grantsAuthority: false,
    label: TIER_LABELS.remembered,
  })
}

/**
 * node:crypto's answer for a raw 32-byte Ed25519 public key over a message and signature.
 * AGENTS.md names node:crypto as the sanctioned second opinion, and this is the default the signature check uses.
 * @param {{pub: Uint8Array, message: Uint8Array, signature: Uint8Array}} input
 * @returns {boolean}
 */
export function defaultSignatureCheck({ pub, message, signature }) {
  if (!(pub instanceof Uint8Array) || !(signature instanceof Uint8Array)) return false
  if (pub.length !== 32 || signature.length !== 64) return false
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pub)]), format: 'der', type: 'spki' })
    return cryptoVerify(null, Buffer.from(message), key, Buffer.from(signature))
  } catch {
    return false
  }
}

/**
 * A rule the owner asked for while signing is off: STORED AS A NOTE MARKED NOT IN EFFECT (§2.4's interim rule).
 *
 * This is not a weaker signature check — it is the answer the design gives while there is no presence gate. The note
 * exists, the owner can see it, and `inEffect: false` plus `grantsAuthority: false` mean nothing may act on it.
 * @param {{text: string, createdAt: string, subject: string, privacy: string, askedFor: string}} input
 * @returns {Readonly<Record<string, unknown>>}
 */
export function notInEffectNote(input) {
  const { text, createdAt, subject, privacy, askedFor } = input ?? {}
  if (typeof text !== 'string' || text.trim() === '') refuse('text-empty', 'a rule note with no text is not a note')
  if (typeof createdAt !== 'string' || !INSTANT.test(createdAt)) refuse('createdAt-not-canonical', '`createdAt` must be a canonical UTC instant')
  if (typeof subject !== 'string' || subject === '') refuse('subject-missing', 'the host read-owner subject is required')
  if (typeof privacy !== 'string' || privacy === '') refuse('privacy-missing', 'the privacy class comes from the host policy')
  const id = memoryRecordId({ tier: 'proposal', text, createdAt, askedFor: String(askedFor ?? '') })
  return Object.freeze({
    id,
    tier: 'proposal',
    text,
    createdAt,
    subject,
    privacy,
    askedFor: String(askedFor ?? ''),
    inEffect: false,
    grantsAuthority: false,
    why: 'signing needs the owner in person, so this is noted and NOT in effect',
    ceiling: SIGNING_CEILING,
  })
}

/**
 * Mark a `remembered` record `signed` — the tier that can act as authority, and the ONLY one that needs a signature.
 *
 * IT REFUSES TWICE, ON PURPOSE. First because NEW SIGNING DOES NOT SHIP (§2.4): until the presence gate requires the
 * owner in person and the signer check confirms the organ serves, this throws `kira.memory:signing-gate-closed` — and
 * the caller stores a NOT-IN-EFFECT note instead. Second, even with the gate open, because a caller's assurance is not
 * a signature: a missing signature, or one that does not verify over the record's own id, is refused by name. A court
 * below removes the signature check and shows the arm that depends on it go red.
 *
 * @param {Readonly<Record<string, unknown>>} record
 * @param {{signer: string, at: string, approvalDigest: string, pub?: Uint8Array, signature?: Uint8Array, check?: (input: {pub: Uint8Array, message: Uint8Array, signature: Uint8Array}) => boolean, gateOpen?: boolean}} approval
 * @returns {Readonly<Record<string, unknown>>}
 */
export function markSigned(record, approval) {
  if (record === null || typeof record !== 'object') refuse('record-missing', 'there is no record to sign')
  const tier = tierName(record.tier)
  if (tier === 'forgotten') refuse('record-forgotten', 'a forgotten record is tombstoned and is not re-signed')
  const { signer, at, approvalDigest, pub, signature, check = defaultSignatureCheck, gateOpen = SIGNING_ENABLED } = approval ?? {}
  if (gateOpen !== true) {
    refuse('signing-gate-closed', `new signing does not ship until the owner is required in person (§2.4) and the signer check passes; the ceiling is ${SIGNING_CEILING}. Store a not-in-effect note instead.`)
  }
  if (typeof signer !== 'string' || signer === '') refuse('signer-missing', 'a signed record names who signed it')
  if (typeof at !== 'string' || !INSTANT.test(at)) refuse('signed-at-not-canonical', '`at` must be a canonical UTC instant')
  if (typeof approvalDigest !== 'string' || approvalDigest === '') {
    refuse('approval-digest-missing', 'the Aumlok approval digest is recorded beside the signature')
  }
  // *** THE SIGNATURE CHECK. THE ONE THING THAT MAKES `signed` MEAN ANYTHING. ***
  if (!(pub instanceof Uint8Array) || !(signature instanceof Uint8Array)) {
    refuse('signature-missing', 'the signed tier cannot be reached without a signature over the record')
  }
  let verified = false
  try {
    verified = check({ pub, message: Buffer.from(String(record.id), 'utf8'), signature }) === true
  } catch {
    verified = false
  }
  if (!verified) refuse('signature-invalid', 'the signature does not verify over this record\'s own id, so the signed tier is not reached')
  return Object.freeze({
    ...record,
    tier: 'signed',
    signed: Object.freeze({ signer, at, approvalDigest, ceiling: SIGNING_CEILING }),
    grantsAuthority: true,
    label: TIER_LABELS.signed,
  })
}

/**
 * Forget a record: it leaves recall, and a CONTENT-FREE tombstone stays so its absence is auditable.
 *
 * THE TOMBSTONE IS THE ORIGINAL MEMORY LAW'S (`memory-law.mjs` → vendored `tombstoneCommitment`): `{kind: 'tombstone',
 * recordId, at}`, hashed with the kernel's canonical hash. This used to return `{...record, tier: 'forgotten', …}` — the
 * whole record, statement, quote and source included — so a "forgotten" note kept its words wherever the tombstone was
 * written. Nothing of the record survives here but its id, and a caller's `reason` is not kept either: free text is where
 * the words would ride back in.
 *
 * @param {Readonly<Record<string, unknown>>} record
 * @param {{at: string}} when
 * @returns {Readonly<Record<string, unknown>>}
 */
export function forgetRecord(record, when) {
  if (record === null || typeof record !== 'object') refuse('record-missing', 'there is no record to forget')
  if (typeof record.id !== 'string' || record.id === '') refuse('record-id-missing', 'a tombstone names the record it replaces, and this record has no id')
  const { at } = when ?? {}
  if (typeof at !== 'string' || !INSTANT.test(at)) refuse('forgot-at-not-canonical', '`at` must be a canonical UTC instant')
  const { tombstone, hash } = contentFreeTombstone({ id: record.id, at })
  return Object.freeze({
    id: record.id,
    tier: 'forgotten',
    grantsAuthority: false,
    tombstone,
    forgotten: Object.freeze({ at, tombstoneHash: hash }),
  })
}

/**
 * Whether a record is used in recall. `remembered` and `signed` are; `proposal` and `forgotten` are not, and a
 * tombstoned record is excluded however it is labelled — the tier is set by `forgetRecord`, so this reads the tier
 * rather than a flag a caller could leave behind.
 * @param {Readonly<Record<string, unknown>>} record
 * @returns {boolean}
 */
export function isUsableInRecall(record) {
  return record !== null && typeof record === 'object' && RECALL_TIERS.includes(/** @type {never} */ (record.tier))
}

/** The recall label for a record, or null when the tier is not spoken at all. */
export function labelFor(record) {
  return isUsableInRecall(record) ? TIER_LABELS[record.tier] : null
}

/**
 * The fields a record's id is taken over, read FROM THE RECORD ITSELF.
 *
 * THIS IS WHAT MAKES "the id recomputes" A CHECK RATHER THAN A HOPE: it reads the record's stored fields and nothing
 * else — no tier, because a tier move is recorded beside the id rather than inside it, and no field the caller could
 * pass instead. A verifier calls this and compares.
 * @param {Readonly<Record<string, unknown>>} record
 * @returns {string}
 */
export function recomputeRecordId(record) {
  if (record === null || typeof record !== 'object') refuse('record-missing', 'there is no record whose id could be recomputed')
  return memoryRecordId({ kind: record.kind, text: record.text, createdAt: record.createdAt, source: record.source })
}

// ─── DESIGN §3.6: THE REMEMBERED NOTE ────────────────────────────────────────────────────────────────────────────────
// The design's record is RICHER than contract v0's, and it is the shape AK-UI and AUMA build against. It is added BESIDE
// the v0 builder rather than replacing it, so the capture path keeps working while the app lane moves onto this one.

/** The design's record version (`"v":1`). */
export const NOTE_VERSION = 1

/** Who the note is attributed to (design §3.6). A closed set: a new value needs a new format version. */
export const ATTRIBUTIONS = Object.freeze(['owner', 'owner-voice', 'owner-edit', 'backfill', 'lane-requester', 'dream', 'agent'])

/** The sensitivity ladder the design names. */
export const SENSITIVITIES = Object.freeze(['none', 'health', 'financial', 'intimate'])

/** 32 random bytes as hex, for the salt the design requires the id to cover. */
export function newSalt() {
  return randomBytes(32).toString('hex')
}

/**
 * A `remembered` note, exactly as design §3.6 describes it.
 *
 * THE SALT IS INSIDE THE ID, which is the point of "sha256 over canonical envelope incl. salt": two notes with the same
 * words are still different notes, and the id cannot be guessed from the statement. The salt is STORED, so the id stays
 * recomputable from the record — the property the research pass measured missing in the v0 builder.
 *
 * EVIDENCE IS REQUIRED AND IMMUTABLE: a note with no quote is a note with no provenance, and an edit does not rewrite
 * one — `editedNote` makes a NEW note attributed to `owner-edit` and keeps the original quote as what it was.
 *
 * @param {{category: string, statement: string, attributedTo: string, evidence: ReadonlyArray<{log: string, turn: number, turnDigest: string, quote: string}>, validFrom: string, observedAt: string, confidence: number, sensitivity: string, privacy: string, subject: string, scope?: string, links?: ReadonlyArray<{relation: string, id: string}>, origin?: {by: string, model?: string, run?: string}, salt?: string, validTo?: string|null}} input
 * @returns {Readonly<Record<string, unknown>>}
 */
export function buildRememberedNote(input) {
  const {
    category, statement, attributedTo, evidence, validFrom, observedAt, confidence, sensitivity, privacy,
    subject, scope = 'owner', links = [], origin = { by: 'kira-extract/v1' }, salt = newSalt(), validTo = null, source, possibleChange = false,
  } = input ?? {}
  if (typeof statement !== 'string' || statement.trim() === '') refuse('statement-empty', 'a note with no statement is not a note')
  if (typeof category !== 'string' || category === '') refuse('category-missing', 'a note carries the category the harness accepted it under')
  // *** A NOTE WITHOUT A RECEIPT IS NOT A REMEMBERED NOTE. *** The §3.6 note carries `evidence[]`, and the verifier reads
  // `source{sessionId, seq, at, sha256}`. Measured 2026-09-26 by running the new VERIFY command against a store the engine
  // itself had written: the note came back UNVERIFIABLE — "this record carries no source" — because the two shapes
  // disagreed about WHERE THE RECEIPT LIVES. Both belong on the record: `evidence` is the quote a person reads, `source`
  // is the event a verifier re-reads, and the id covers both because the receipt is part of what the record IS.
  // *** AN UNLINKED RECEIPT IS A DECLARED STATE, NOT A MISSING FIELD (Fable, kira-122 decision 1). *** The 137 queued records
  // cite a session and a turn whose events this store cannot produce, so no digest can be minted for them — and minting one
  // from the `.broken-single-frame` sibling would be a receipt for bytes nobody can re-read. They migrate anyway, as
  // REMEMBERED records whose source is CITED AND NOT FOUND: the citation is kept, the state says UNLINKED, and the verifier
  // can never answer VERIFIED for one. THE STATE WINS OVER ANY OTHER FIELD, which is why it is checked FIRST and returns.
  const unlinked = source !== null && typeof source === 'object' && source.state === UNLINKED_RECEIPT
  if (unlinked) {
    // *** TWO FACTS, NOT ONE, BECAUSE FIVE OF THE 137 QUEUED RECORDS NEVER CITED ANYTHING. *** 132 cite a session and a turn the
    // store cannot produce — the source is CITED AND NOT FOUND. Five recorded no turn at all, so nothing was looked for and
    // nothing is missing; saying "not found" about those would be a small lie in a field a person reads. `cited` says which.
    if (typeof source.cited !== 'boolean') {
      refuse('receipt-unlinked-undeclared', 'an UNLINKED receipt says whether it CITED anything (`cited`), because "not found" and "never cited" are different facts')
    }
    if (typeof source.because !== 'string' || source.because === '') {
      refuse('receipt-unlinked-unreasoned', 'an UNLINKED receipt says WHY it could not be linked, so a reader can act on it')
    }
    const hasSession = typeof source.sessionId === 'string' && source.sessionId !== ''
    const hasTurn = Number.isInteger(source.citedTurn)
    if (source.cited && (!hasSession || !hasTurn)) {
      refuse('receipt-unlinked-partial', 'a receipt that says it cited something must cite BOTH the session and the turn: a half citation is a fault in the record, not a fact about the store')
    }
    if (!source.cited && (hasSession || hasTurn)) {
      refuse('receipt-unlinked-contradictory', 'a receipt that says it cited nothing must not carry a session or a turn: that contradiction is how a real citation gets lost')
    }
  } else   if (source === null || typeof source !== 'object' || typeof source.sha256 !== 'string' || !HEX64.test(source.sha256)) {
    refuse('receipt-missing', 'a remembered note carries the receipt {sessionId, seq, at, sha256 of the exact canonical event line}; without it nothing can be re-read and the note is not checkable')
  }
  if (!ATTRIBUTIONS.includes(/** @type {never} */ (attributedTo))) {
    refuse('attribution-unknown', `attributedTo ${JSON.stringify(attributedTo)} is not one of the design's values: ${ATTRIBUTIONS.join(', ')}`)
  }
  if (!Array.isArray(evidence) || evidence.length === 0) {
    refuse('evidence-missing', 'a remembered note carries the quote it came from; without evidence there is nothing to check it against')
  }
  for (const one of evidence) {
    if (one === null || typeof one !== 'object' || typeof one.log !== 'string' || !Number.isInteger(one.turn) || typeof one.turnDigest !== 'string' || typeof one.quote !== 'string') {
      refuse('evidence-malformed', 'each evidence entry is {log, turn, turnDigest, quote} and nothing less')
    }
  }
  if (typeof validFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(validFrom)) refuse('validFrom-malformed', '`validFrom` is a calendar date; the design stores the observation date, not a model guess')
  if (typeof observedAt !== 'string' || !INSTANT.test(observedAt)) refuse('observedAt-not-canonical', '`observedAt` must be a canonical seconds-precision UTC instant')
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) refuse('confidence-out-of-range', '`confidence` is a number between 0 and 1')
  if (!SENSITIVITIES.includes(/** @type {never} */ (sensitivity))) {
    refuse('sensitivity-unknown', `sensitivity ${JSON.stringify(sensitivity)} is not one of: ${SENSITIVITIES.join(', ')}`)
  }
  if (typeof privacy !== 'string' || privacy === '') refuse('privacy-missing', 'the privacy class comes from the host policy')
  if (typeof subject !== 'string' || subject === '') refuse('subject-missing', 'the host read-owner subject is never supplied by the model')
  if (typeof salt !== 'string' || !HEX64.test(salt)) refuse('salt-malformed', 'the salt is 32 random bytes as hex; it is stored so the id stays recomputable')

  const envelope = {
    v: NOTE_VERSION, subject, scope, category, statement, attributedTo, evidence, validFrom, validTo, observedAt,
    confidence, sensitivity, privacy, links, origin, source,
    possibleChange: possibleChange === true,
    // §2.1: a remembered note grants no authority, and it says so in the bytes the id covers.
    grantsAuthority: false, salt,
  }
  return Object.freeze({
    ...envelope,
    id: `rem:${memoryRecordId(envelope)}`,
    tier: MEMORY_TIER.remembered,
    contentHash: sha256Hex(statement),
    // *** THE CONTRACT'S THREE NAMES LIVE HERE NOW, NOT ONLY IN THE CAPTURE HOOK. *** `.agents/live/MEMORY-CONTRACT-v0.md` calls
    // these `kind`, `text` and `createdAt`; §3.6 and my envelope call them `category`, `statement` and `observedAt`. The hook added
    // the aliases after building, so the MIGRATED notes — built directly by the backfill — had `category` and no `text` at all:
    // measured by reading one of the 138 real notes out of Peter's store, where `kind` was `undefined`. A note the contract
    // describes must carry the contract's names however it was built.
    kind: String(category),
    text: String(statement),
    createdAt: String(observedAt),
    label: unlinked ? UNLINKED_LABEL : TIER_LABELS.remembered,
    receiptState: unlinked ? UNLINKED_RECEIPT : 'LINKED',
    evidence: Object.freeze(evidence.map(one => Object.freeze({ ...one }))),
    source: Object.freeze({ ...source }),
    possibleChange: possibleChange === true,
    links: Object.freeze(links.map(one => Object.freeze({ ...one }))),
    origin: Object.freeze({ ...origin }),
  })
}

/**
 * The id of a note, recomputed from the note itself — the design's envelope, without the id or the derived fields.
 * @param {Readonly<Record<string, unknown>>} note
 * @returns {string}
 */
export function recomputeNoteId(note) {
  if (note === null || typeof note !== 'object') refuse('record-missing', 'there is no note whose id could be recomputed')
  const envelope = {
    v: note.v, subject: note.subject, scope: note.scope, category: note.category, statement: note.statement,
    attributedTo: note.attributedTo, evidence: note.evidence, validFrom: note.validFrom, validTo: note.validTo,
    observedAt: note.observedAt, confidence: note.confidence, sensitivity: note.sensitivity, privacy: note.privacy,
    links: note.links, origin: note.origin, source: note.source, grantsAuthority: note.grantsAuthority, salt: note.salt,
    // THE ID MUST RECOMPUTE FROM THE NOTE, so every field the builder puts in its envelope must be read back here.
    // Measured 2026-09-26: adding `possibleChange` to the builder alone moved every note's id and broke this — the tiers
    // court's id arm caught it, which is exactly what it exists for.
    possibleChange: note.possibleChange === true,
  }
  return `rem:${memoryRecordId(envelope)}`
}

/**
 * An edit does NOT rewrite a note: it makes a NEW one attributed to `owner-edit`, and the original quote stays visible
 * as what it was. §3.6: "The app shows it as 'edited by you on …' and it loses the 'you said' label."
 * @param {Readonly<Record<string, unknown>>} note
 * @param {{statement: string, observedAt: string}} edited
 * @returns {Readonly<Record<string, unknown>>}
 */
export function editedNote(note, edited) {
  if (note === null || typeof note !== 'object') refuse('record-missing', 'there is no note to edit')
  const { statement, observedAt } = edited ?? {}
  if (typeof statement !== 'string' || statement.trim() === '') refuse('statement-empty', 'an edit with no statement is not an edit')
  const next = buildRememberedNote({
    category: note.category, statement, attributedTo: 'owner-edit', evidence: note.evidence,
    validFrom: note.validFrom, observedAt, confidence: note.confidence, sensitivity: note.sensitivity,
    privacy: note.privacy, subject: note.subject, scope: note.scope, links: note.links, origin: note.origin,
    // AN EDIT KEEPS THE ORIGINAL RECEIPT: it is still a claim about the same event, and the quote it came from is carried
    // in `editedFrom`. Dropping the source would make an edited note uncheckable — which the VERIFY command found.
    source: note.source,
    salt: newSalt(),
  })
  return Object.freeze({ ...next, editedFrom: Object.freeze({ id: note.id, statement: note.statement, originallyCapturedFrom: note.evidence?.[0]?.quote ?? null }) })
}
