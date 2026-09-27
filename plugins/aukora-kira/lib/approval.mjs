/**
 * Owner approval: Kira refuses to write until AUMLOK's approval ARTIFACT for the EXACT content
 * being settled verifies.
 *
 * WHY THIS EXISTS. `kira_settle` used to settle on a grant alone. A grant is minted by
 * `bin/kira-grant.mjs`, which mints whenever it is run — by a person, by a script, or by the agent
 * itself. So every layer of the governed transition checked out and the composition still had a
 * hole: "authorization" and "output" could both come from the same turn, and `confirm: true` stood
 * in for an owner act. Measured on the pre-change module: a settlement succeeded with no approval
 * of any kind, and the receipt it wrote could not tell that apart from an approved one.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 * THE WIRE, RECONCILED. This module consumes ONE document: the `aukora:approval-receipt:v1` record
 * that `scripts/aumlok/approve-operation` writes. Both lanes were built in parallel and each was
 * green alone; where they met, three things were undefined and two of them disagreed:
 *
 *   1. THE OPERATION DIGEST. Kira computed `sha256(canonicalJSON({key, value}))` over the
 *      `memory.put` arguments. Aumlok signs
 *      `sha256(utf8("aukora:operation-content:v1") ‖ 0x00 ‖ contentBytes)`. Different preimages, so
 *      Aumlok's signature did not bind what Kira settled. RESOLVED IN AUMLOK'S FAVOUR — the digest
 *      rule is {@link operationDigestFor}, which is AUMLOK's `operationDigestOf` applied to
 *      {@link operationPreimage}, Kira's own effect bytes. A `sha256(canonicalJSON(...))` here would
 *      not have been domain-separated, and the approving lane's rule is the one its stranger-side
 *      verifier (`scripts/aumlok/verify-approval`, run from an empty directory) already checks.
 *
 *   2. THE SUBJECT GRAMMAR. Aumlok's `owner-approval.mjs` and `approval-receipt.mjs` require
 *      `aukora:1:<64 hex>` (`readAukoraId`) on BOTH the producing and the parsing side; Kira's
 *      memory layer treats a subject as an opaque string. RESOLVED IN AUMLOK'S FAVOUR, because the
 *      grammar is a property of the approval record, not of memory: a subject this lane accepts and
 *      Aumlok refuses is a subject nobody can approve. This module compares the artifact's subject
 *      to the expectation as exact text and does not restate the grammar, so the day Aumlok's
 *      changes, the producer refuses first and this stays a comparison of one string to one string.
 *
 *   3. THE ARTIFACT SHAPE. Kira read an `aukora-kira-owner-approval-bundle/v1`
 *      (`{kind, source, request, response, approverDid}`) that NO shipped command produced; Aumlok
 *      wrote the flat receipt. RESOLVED BY DELETING KIRA'S SHAPE. The artifact is now parsed by
 *      Aumlok's own `parseApprovalReceipt`, so "what an approval is" has one address again, and the
 *      document `scripts/aumlok/approve-operation --artifact-out` drops on disk is byte-for-byte
 *      what this verifier consumes.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 * THE PREIMAGE, STATED EXACTLY SO A THIRD PARTY HOLDING ONLY THE CONTENT CAN RE-DERIVE IT:
 *
 *     content         = canonicalJSON({ "key": <recordId>, "value": <record> }) ‖ "\n"
 *                       — byte-for-byte the object Kira stores at objects/<sha256(content)>.json,
 *                         and the bytes the grant's `effectDigest` already binds;
 *     operationDigest = sha256( utf8("aukora:operation-content:v1") ‖ 0x00 ‖ utf8(content) )
 *
 * The extra `\n` is not decoration: it is the record format's own terminator (`memoryEffectBody`),
 * and using it means the approval's digest, the grant's effect digest and the object's content
 * address all cover ONE byte string. A third party with the content file and nothing else computes
 * `sha256("aukora:operation-content:v1" ‖ 0x00 ‖ file)` and gets the digest in the artifact.
 *
 * WHAT IT CHECKS, in order, each one a NAMED refusal rather than prose:
 *
 *   1. the document is one closed `aukora:approval-receipt:v1` record (Aumlok's parser decides);
 *   2. the operation digest is RE-COMPUTED here from the bytes about to be settled and must equal
 *      the digest the approval names — a caller-supplied digest is never read, and there is no
 *      "also accept the other convention" branch, because a fail-open superset is how two different
 *      byte strings come to share a digest;
 *   3. the artifact's `signedBytesDigest` must equal the digest of the bytes its OWN fields derive,
 *      so an artifact internally inconsistent with itself is refused before a signature is checked;
 *   4. the claim boundaries the artifact carries are refused when they are claims this lane cannot
 *      stand behind: `human-ceremony` (no enrolment register exists here), an `attendance` other
 *      than `reported-not-proven`, and `identityBound: true`;
 *   5. the request is REBUILT from the artifact's own fields and the Ed25519 signature is verified
 *      over Aumlok's `approvalSigningBytes` — never over bytes the document supplied;
 *   6. the key is DECODED from `approvalKeyDid` and the DID re-derived from the raw key, so the
 *      identifier cannot be asserted independently of the key whose signature is checked;
 *   7. the request's `subject` is the subject this owner serves;
 *   8. the window has not closed.
 *
 * WHAT IT IS NOT, and this is a MEASURED limit rather than a caution. An approval receipt's
 * `approvalClass`, `keyClass`, `attendance`, `identityBound` and `ceilings` are NOT inside the
 * signed preimage — only the seven request fields are. So the class on an artifact is a LABEL
 * ANYONE CAN REWRITE without breaking its signature, and this module therefore REFUSES the labels
 * it cannot stand behind (checks 4) instead of printing them as if they were earned. A signature
 * proves a key signed these bytes. It never proves a person attended, and nothing here says one did.
 * `memory-owner.mjs` is what turns a verified approval into exactly one write, and it consumes the
 * approval so it can happen once.
 *
 * @module @aukora/dsh-plugin-kira/approval
 */
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto'
import {
  approvalSigningBytes,
  createApprovalRequest,
} from '../../aukora-aumlok/lib/owner-approval.mjs'
import { OPERATION_CONTENT_DOMAIN, operationDigestOf } from '../../aukora-aumlok/lib/operation-approval.mjs'
import {
  APPROVAL_RECEIPT_DOMAIN,
  OWNER_KEY_SIGNED,
  parseApprovalReceipt,
} from '../../aukora-aumlok/lib/approval-receipt.mjs'
import { canonicalJSON } from '../../aukora-aumlok/lib/canonical.mjs'
// THE SUBJECT GRAMMAR, RE-EXPORTED FOR THE WRITER. `memory-owner.mjs` needs the approving lane's own
// subject reader so the two sides cannot drift — one grammar, one implementation — but this package's
// write boundary admits that cross-lane prefix to exactly ONE module, and that module is this one. The
// writer therefore reads it FROM HERE instead of reaching across the lane itself: widening the rule for
// the whole writer would trade a narrow allowance a reader can check for a broad one nobody can.
import { parseSubject } from '../../aukora-aumlok/lib/subject.mjs'
export { parseSubject }
import { didKeyFromEd25519PublicKey, ed25519PublicKeyFromDidKey } from '../../aukora-aumlok/lib/did-key.mjs'
import { memoryEffectBody } from './record.mjs'

/**
 * The modules this lane reads the wire from. Named constants, asserted in the approval suite, so
 * that "whose bytes define an approval" is a stated dependency with a single address each instead
 * of a convention spread across two lanes. If the Aumlok lane moves or renames one of these, the
 * verification module fails to load and the breakage is immediate and legible; the alternative —
 * copying their constants into this lane — is a copy that drifts silently and then agrees with
 * itself forever.
 *
 *   owner-approval.mjs      the request/response records and the bytes an owner key signs
 *   approval-receipt.mjs    the ARTIFACT — the one document this consumer is handed
 *   operation-approval.mjs  the operation-digest rule, re-exported below and never restated
 */
export const AUMLOK_APPROVAL_MODULE = 'plugins/aukora-aumlok/lib/owner-approval.mjs'
export const AUMLOK_RECEIPT_MODULE = 'plugins/aukora-aumlok/lib/approval-receipt.mjs'
export const AUMLOK_DIGEST_MODULE = 'plugins/aukora-aumlok/lib/operation-approval.mjs'

/** The domain of the one artifact this consumer accepts. AUMLOK's constant, not a copy of it. */
export const ARTIFACT_DOMAIN = APPROVAL_RECEIPT_DOMAIN

/** The ONE operation-digest domain, re-exported so no second spelling of it exists in this lane. */
export { OPERATION_CONTENT_DOMAIN }

/** The approval classes Aumlok can mint, and the one this lane refuses however it arrives. */
export const UNSUPPORTED_APPROVAL_CLASS = 'human-ceremony'

/** The only `attendance` value an artifact may carry and this lane will consume. */
export const REQUIRED_ATTENDANCE = 'reported-not-proven'

/** The exact top-level fields of one approval receipt; anything else is refused by the parser. */
export const ARTIFACT_FIELDS = Object.freeze([
  'domain', 'verdict', 'keyClass', 'keyClassMeaning', 'approvalClass', 'subject', 'activeControlDigest',
  'approvalKeyDid', 'operationDigest', 'challenge', 'issuedAt', 'expiresAt', 'signature',
  'signedBytesDigest', 'verifiedAt', 'attendance', 'signerDeviceTrusted', 'succession', 'identityBound',
  'ceilings',
])

/**
 * Named ceilings, returned on every verified approval.
 *
 * These are the limits of what the checks above ESTABLISH, printed beside the verdict rather than
 * left to a reader's assumption. The first two are generated from the artifact's OWN labels; the
 * rest are properties of this verification.
 *
 * @param {Readonly<Record<string, unknown>>} receipt - a parsed approval receipt.
 * @returns {readonly string[]} ceiling lines, one per limit.
 */
export function approvalCeilings(receipt) {
  return Object.freeze([
    `SCRIPTED_APPROVAL: the artifact LABELS itself approvalClass=${String(receipt.approvalClass)} `
    + `keyClass=${String(receipt.keyClass)} (${String(receipt.keyClassMeaning)}), and labels are NOT signed: `
    + 'only the seven request fields are inside the preimage, so this class can be rewritten without '
    + 'breaking the signature. A green says these bytes were approved by a key — never that a person attended',
    `ATTENDANCE: ${String(receipt.attendance)} — the artifact reports it and nothing here proves it; `
    + `an artifact claiming anything other than ${REQUIRED_ATTENDANCE} is refused by name`,
    `APPROVAL_KEY_LOCAL: the registered approver key is held by a separate process, but that process runs `
    + 'on this host under this uid, so an approval proves the installation that holds the key — not custody',
    `NO_IDENTITY_BINDING: the approval names the subject its controller derives; it binds no identity, `
    + `performs no ceremony, and IDENTITY_BOUND reads ${String(receipt.identityBound)}`,
    'VERIFICATION_IS_NOT_AUTHORIZATION: this module establishes that a signed artifact covers these '
    + 'exact bytes; the exactly-once write and its receipt are `memory-owner.mjs`',
    'APPROVER_PINNED: the pinned approver key is checked only when the composition names one. With no '
    + 'pinned key the verdict says that a key the artifact NAMES signed these bytes, which a freshly '
    + 'generated key can also satisfy; binding an approval to a registered identity is the '
    + 'composition\'s act, and its absence is stated here rather than implied',
  ])
}

/**
 * The did:key a composition may PIN as the only approver this owner accepts.
 *
 * WHY THIS EXISTS. Without it, verification answers "a key the artifact names signed these bytes" —
 * which is what a disposable store needs and all it can offer. An approval that proves only THAT is
 * one anyone holding a freshly generated key can produce, and `approvalKeyDid` is then a label
 * rather than a binding. Naming the registered key here turns it into a check: an artifact whose
 * approver is a different key is refused by name, whatever else about it is valid.
 *
 * It is OPTIONAL because a disposable store has no registered key, and its absence is a NAMED
 * ceiling (`APPROVER_PINNED` carries it) rather than a silent widening.
 */
export const DID_KEY_SHAPE = /^did:key:z[1-9A-HJ-NP-Za-km-z]+$/

/** A named approval refusal; every refusal carries one stable code. */
export class ApprovalRefusal extends Error {
  /** Stable machine-readable code, e.g. `APPROVAL_CONTENT_MISMATCH`. */
  code

  /**
   * @param {string} code - stable refusal code.
   * @param {string} reason - what was wrong, without echoing caller data wholesale.
   */
  constructor(code, reason) {
    super(`${code}: ${reason}`)
    this.name = 'ApprovalRefusal'
    this.code = code
  }
}

/** @param {string} code @param {string} reason @returns {never} */
function refuse(code, reason) {
  throw new ApprovalRefusal(code, reason)
}

/** A 64-character lowercase hex digest, the shape both approval records use for every digest field. */
const DIGEST = /^[0-9a-f]{64}$/

/** DER prefix of an Ed25519 SPKI document; the 32 raw key bytes follow it verbatim. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/**
 * THE EXACT BYTES the operation digest covers: the effect body of one `memory.put`.
 *
 * This is the same discipline `auraEntryPreimage` follows in `memory-owner.mjs`, and it is the same
 * BYTE STRING for a different reason: `memoryEffectBody` is what the settlement writes to
 * `objects/<sha256>.json` and what the grant's `effectDigest` already binds, so naming it here means
 * the approval, the grant and the store all speak about one string rather than three.
 *
 * The rule is exposed as its own value so a court can compare it against a LITERAL restatement; a
 * verifier that shares its arithmetic with the producer agrees by construction, and agreement is not
 * verification. Note that the Kira-side courts CANNOT detect a digest drift on their own — their
 * approver imports {@link operationDigestFor} from this very module, so both sides move together. The
 * control for that lives where the REAL producer is on the other side: the wire acceptance court,
 * `kira-approval-wire.test.mjs`, which runs `scripts/aumlok/approve-operation` as a separate process
 * and re-runs itself against a mutated copy of this module.
 *
 * The court is NAMED here, not pathed: `kira-recall.test.mjs`'s boundary scan forbids the
 * disposable-test-adapter directory's own name as a substring anywhere under this plugin, and that
 * rule cannot tell prose from an import specifier. A boundary that fires on a comment is a boundary
 * somebody turns off, so the comment moves rather than the boundary.
 *
 * @param {Readonly<{key: string, value: unknown}>} memoryPut - the effect arguments.
 * @returns {string} the exact content bytes, as text: canonical `{"key":…,"value":…}` and one `\n`.
 */
export function operationPreimage(memoryPut) {
  // ── THE ARGUMENTS ARE READ AS DATA, ONCE ────────────────────────────────────────────────────────
  // MEASURED DEFECT, found by a separate read-only reviewer agent (same operator) in the pre-reconciliation revision and carried onto
  // this one. `memoryPut` is caller-supplied and `value` may be an accessor: the approval digest, the
  // grant digest and the object body each read it again, so a caller could have one value approved and
  // another written. `plainMemoryPut` reads each field ONCE, from a property descriptor, and refuses an
  // accessor rather than reading it and hoping.
  //
  // This is the INTEGRATION of two changes that were made independently: the reconciliation above fixed
  // WHAT the bytes are (`memoryEffectBody`, the record format's own terminator), the audit fixed HOW
  // MANY TIMES they are read. Both are required — a rule stated over bytes that can differ between the
  // check and the write binds nothing.
  const plain = plainMemoryPut(memoryPut)
  try {
    // `memoryEffectBody` refuses a key that is not a name and a value with no canonical form
    // (floats, `undefined`, class instances), so a parameter that cannot be given one digest by both
    // lanes fails HERE by name instead of silently digesting to something only this module computes.
    return memoryEffectBody(plain)
  } catch (error) {
    refuse('APPROVAL_INPUT_NOT_CANONICAL',
      `the effect being settled has no content bytes to bind: ${error?.message ?? 'not canonical'}`)
  }
}

/**
 * The operation digest an approval must name to authorize one `memory.put`.
 *
 * AUMLOK'S RULE, APPLIED TO KIRA'S BYTES. It is `sha256( utf8("aukora:operation-content:v1") ‖ 0x00
 * ‖ contentBytes )` — the approving lane's own `operationDigestOf`, imported rather than restated,
 * over {@link operationPreimage}. It is computed HERE, from the effect arguments, and never read from
 * the document being checked: the whole point of the binding is that the approver's digest and this
 * one are computed from the same bytes by different code, so an artifact cannot choose its own
 * preimage. It can only name a digest, and this module decides what that digest is.
 *
 * @param {Readonly<{key: string, value: unknown}>} memoryPut - the exact effect arguments being settled.
 * @returns {string} lowercase hex SHA-256 over `domain ‖ 0x00 ‖ content`.
 */
export function operationDigestFor(memoryPut) {
  return operationDigestOf(operationPreimage(memoryPut))
}

/**
 * The approval's identity: a digest of THE SIGNED PAIR, and of nothing else.
 *
 * ══ WHERE THIS COMES FROM, BECAUSE TWO CHANGES MET HERE ══
 * The reconciliation derived this from the whole parsed artifact. A separate read-only reviewer agent (same operator) then MEASURED
 * that a whole-document identity is a defect: the one-use key covered fields the signature does not,
 * so editing an unsigned one minted a NEW identity for the SAME challenge and the SAME signature, the
 * replay registry saw a fresh approval, and ONE owner approval authorized TWO writes. Measured on the
 * pre-fix bytes of the bundle this replaces: "signature unchanged: true | challenge unchanged: true |
 * approvalId before: 8056801e… | approvalId after: ef9eae15… | second call (fresh grant, edited
 * source): WROTE seq=2".
 *
 * That defect is a property of the RULE, not of the bundle, and the reconciled artifact has the same
 * shape of hole: `approvalClass`, `keyClass`, `keyClassMeaning`, `attendance` and `identityBound` sit
 * OUTSIDE the signed preimage (only the seven request fields are signed — see the module comment), so
 * on this artifact too a whole-document digest lets an unsigned edit buy a second write. The audit's
 * rule therefore lands ON TOP of the reconciliation's artifact: the identity is the signed pair —
 * `challenge`, which is one of the signed request fields, and `signature`, which covers the bytes those
 * fields derive — and no unsigned field can move it.
 *
 * What is KEPT from the reconciliation is the domain and the interface: `ARTIFACT_DOMAIN` is the
 * receipt's own `aukora:approval-receipt:v1`, not the deleted bundle's kind, and the argument is the
 * parsed receipt rather than `{request, response}`, because the bundle shape no longer exists anywhere
 * in this lane. Deriving from the PARSED record and not the file's bytes is also kept, and still
 * matters: two serializations of one receipt (different whitespace, different key order) are one
 * approval and must spend one marker, so a caller cannot re-use an approval by re-indenting it.
 *
 * The identity is EXPORTED so a court can check it directly — `approvalIdOf(receipt)` must not move
 * when an unsigned field does — and so the mutation that reverses this fix has somewhere to land.
 *
 * @param {Readonly<Record<string, unknown>>} receipt - a receipt from {@link readArtifact}.
 * @returns {string} lowercase hex SHA-256 over the domain, the challenge and the signature.
 */
export function approvalIdOf(receipt) {
  return createHash('sha256')
    .update(`${ARTIFACT_DOMAIN}\0${receipt.challenge}\0${receipt.signature}`, 'utf8')
    .digest('hex')
}

/**
 * Read ONE approval artifact as a closed record, using the approving lane's own parser.
 *
 * There is no second shape. A document that is not an `aukora:approval-receipt:v1` — including the
 * `aukora-kira-owner-approval-bundle/v1` this lane used to read, and including a receipt with one
 * extra field — is refused by name at the door rather than at the signature.
 *
 * @param {unknown} input - candidate document, e.g. the parsed contents of the artifact file.
 * @returns {Readonly<Record<string, unknown>>} the parsed receipt.
 */
export function readArtifact(input) {
  try {
    return parseApprovalReceipt(input)
  } catch (error) {
    refuse('APPROVAL_MALFORMED', `the artifact is not an ${ARTIFACT_DOMAIN} record: ${error?.message ?? 'malformed'}`)
  }
}

/**
 * Read the effect arguments as PLAIN DATA, once, and return the copy every later check uses.
 *
 * MEASURED DEFECT, same audit. `memoryPut` is caller-supplied, and `value` may be an accessor: the
 * approval digest, the grant digest and the object body each read it again, so a caller could approve
 * one value and have another written. Measured on the old bytes: "owner.settle(memoryPut with accessor
 * `value`): WROTE seq=1 … reads of memoryPut.value during settle: 3 … OBJECT ACTUALLY WRITTEN (note):
 * Cedar endpoint listens on port 8098 | note the approval was issued for: Rollback runbook lives in
 * ops/rollback.md".
 *
 * A value that cannot be copied as data — an accessor, a proxy-refusing getter, a class instance — is
 * REFUSED rather than read once and hoped for: "this argument is not data" is a named refusal, and a
 * caller that supplies one has not supplied the bytes an approval could bind.
 *
 * @param {unknown} memoryPut - candidate `{key, value}` effect arguments.
 * @returns {Readonly<{key: string, value: unknown}>} a detached plain-data copy.
 */
export function plainMemoryPut(memoryPut) {
  if (memoryPut === null || typeof memoryPut !== 'object' || Array.isArray(memoryPut)) {
    refuse('APPROVAL_INPUT_MALFORMED', 'the effect arguments to digest must be one plain object')
  }
  const key = readOwnData(memoryPut, 'key')
  if (typeof key !== 'string' || key === '') {
    refuse('APPROVAL_INPUT_MALFORMED', 'the effect arguments name no record key')
  }
  return Object.freeze({ key, value: readOwnData(memoryPut, 'value') })
}

/**
 * One own data property, read exactly once, refusing accessors and exotic objects.
 *
 * `Object.getOwnPropertyDescriptor` is what makes the TOCTOU closed: a descriptor with a `get` is not
 * data, and `Object.getOwnPropertyDescriptor` on a Proxy invokes no trap that can return a different
 * value on a second read because there is no second read.
 *
 * @param {object} record - the object to read from.
 * @param {string} name - the property name.
 * @returns {unknown} the value held in the descriptor.
 */
function readOwnData(record, name) {
  const descriptor = Object.getOwnPropertyDescriptor(record, name)
  if (descriptor === undefined) refuse('APPROVAL_INPUT_MALFORMED', `the effect arguments carry no \`${name}\``)
  if (!Object.hasOwn(descriptor, 'value')) {
    refuse('APPROVAL_INPUT_NOT_CANONICAL',
      `the effect arguments' \`${name}\` is an accessor; an approval binds BYTES, and a value that is computed on each read is not one`)
  }
  return descriptor.value
}

/**
 * Verify one approval artifact against the EXACT content about to be written.
 *
 * @param {unknown} document - the parsed approval artifact.
 * @param {{subject: string, memoryPut: Readonly<{key: string, value: unknown}>, now?: number, approverDid?: string}} expectation -
 *   the subject this owner serves, the effect arguments being settled, an optional clock
 *   (unix SECONDS, the same unit the artifact's window uses), and the optional REGISTERED approver
 *   `did:key` this owner accepts.
 * @returns {Readonly<Record<string, unknown>>} the verified approval: its id, challenge, approver, the
 *   operation digest it bound, the labels the artifact carried, the window, and the ceilings.
 */
export function verifyApproval(document, expectation) {
  const receipt = readArtifact(document)
  if (expectation === null || typeof expectation !== 'object') {
    refuse('APPROVAL_INPUT_MALFORMED', 'verifying an approval requires the content it is claimed to cover')
  }
  if (typeof expectation.subject !== 'string' || expectation.subject === '') {
    refuse('APPROVAL_INPUT_MALFORMED', 'verifying an approval requires the subject this owner serves')
  }

  // ══ 2. THE DIGEST COMES FROM THE BYTES BEING SETTLED, NEVER FROM THE ARTIFACT. ══
  // This is the binding. A document that merely CARRIES an `operationDigest` field is refused the
  // moment the field names other bytes, and there is no branch that accepts the other convention.
  // It is computed from a PLAIN-DATA copy of the arguments (`plainMemoryPut`, inside
  // `operationDigestFor`) read ONCE from a property descriptor — the same discipline the caller's copy
  // follows — so an accessor cannot answer the digest and then answer the write differently.
  const expectedOperationDigest = operationDigestFor(expectation.memoryPut)

  // ══ 4. THE CLAIMS THIS LANE CANNOT STAND BEHIND, refused before a signature is checked. ══
  // These fields are outside the signed preimage (see the module comment), so they are labels. A
  // label this lane cannot earn is refused BY NAME rather than printed beside a green.
  if (receipt.approvalClass === UNSUPPORTED_APPROVAL_CLASS) {
    refuse('APPROVAL_CLASS_UNSUPPORTED',
      `the artifact claims approvalClass=${UNSUPPORTED_APPROVAL_CLASS}; that class requires a key enrolled by a `
      + 'recorded human ceremony, no such enrolment register exists here, and the field is not signed — so this '
      + 'lane refuses the claim instead of repeating it')
  }
  if (receipt.attendance !== REQUIRED_ATTENDANCE) {
    refuse('APPROVAL_ATTENDANCE_UNSUPPORTED',
      `the artifact records attendance=${JSON.stringify(receipt.attendance)}; the only attendance value this lane `
      + `will consume is ${JSON.stringify(REQUIRED_ATTENDANCE)}, because a signature cannot show anyone was present `
      + 'and the field is not signed')
  }
  if (receipt.identityBound !== false) {
    refuse('APPROVAL_IDENTITY_BOUND_UNSUPPORTED',
      'the artifact claims identityBound:true. No ceremony in this repository binds an approval to an identity, '
      + 'the field is not signed, and this lane performs no such binding')
  }

  if (receipt.operationDigest !== expectedOperationDigest) {
    refuse(
      'APPROVAL_CONTENT_MISMATCH',
      `the approval binds operation digest ${receipt.operationDigest} but the content being settled digests to `
      + `${expectedOperationDigest}; an approval binds the bytes it was issued for`,
    )
  }
  if (receipt.subject !== expectation.subject) {
    refuse(
      'APPROVAL_SUBJECT_MISMATCH',
      `the approval names subject ${JSON.stringify(receipt.subject)} and this owner serves ${JSON.stringify(expectation.subject)}`,
    )
  }

  // The request is REBUILT from the artifact's own fields. Nothing below trusts a preimage the
  // document supplied: `createApprovalRequest` closes the field set, and `approvalSigningBytes`
  // derives the signed bytes from the parsed record by the approving lane's own rule.
  let request
  try {
    request = createApprovalRequest({
      subject: receipt.subject,
      activeControlDigest: receipt.activeControlDigest,
      operationDigest: receipt.operationDigest,
      challenge: receipt.challenge,
      issuedAt: receipt.issuedAt,
      expiresAt: receipt.expiresAt,
    })
  } catch (error) {
    refuse('APPROVAL_MALFORMED', `the artifact's own fields do not build a request: ${error?.message ?? 'malformed'}`)
  }
  const bytes = approvalSigningBytes(request)

  // ══ 3. THE ARTIFACT MUST AGREE WITH ITSELF. ══
  // `signedBytesDigest` is the minting broker's own digest of the bytes its request derived. It is a
  // separate computation from the signature and it must land on the same bytes; a receipt whose
  // fields do not derive the digest it prints is internally inconsistent, whatever its signature says.
  const derivedSignedBytes = createHash('sha256').update(bytes).digest('hex')
  if (receipt.signedBytesDigest !== derivedSignedBytes) {
    refuse('APPROVAL_ARTIFACT_INCONSISTENT',
      `the artifact prints signedBytesDigest ${receipt.signedBytesDigest} but its own fields derive `
      + `${derivedSignedBytes}; the artifact does not describe the bytes it was signed over`)
  }

  // ══ 6. THE KEY IS DERIVED FROM THE DID, and the signature must verify under it. ══
  let rawKeyHex
  try {
    rawKeyHex = ed25519PublicKeyFromDidKey(receipt.approvalKeyDid)
  } catch (error) {
    refuse('APPROVAL_KEY_MISMATCH', `the approver key does not decode out of the artifact's did:key: ${error?.message ?? 'invalid'}`)
  }
  // The DID is RE-DERIVED from the raw key, and an artifact whose string does not round-trip to the
  // same key is refused. A string match alone would accept a DID that no key derives.
  if (didKeyFromEd25519PublicKey(rawKeyHex) !== receipt.approvalKeyDid) {
    refuse('APPROVAL_KEY_MISMATCH', 'the approver DID is not the canonical did:key of the key it decodes to')
  }
  // AND THE PIN, when the composition named one: the approver must BE the registered key, not merely
  // a key that signs. Checked after the round trip, so the comparison is between two canonical DIDs.
  if (expectation.approverDid !== undefined) {
    if (typeof expectation.approverDid !== 'string' || !DID_KEY_SHAPE.test(expectation.approverDid)) {
      refuse('APPROVAL_INPUT_MALFORMED', 'the pinned approver must be a did:key identifier')
    }
    if (receipt.approvalKeyDid !== expectation.approverDid) {
      refuse('APPROVAL_APPROVER_NOT_REGISTERED',
        `the approval was signed by ${receipt.approvalKeyDid} and this owner accepts only ${expectation.approverDid}`)
    }
  }
  // ── AND THE CURRENT CONTROL HEAD, WHEN THE COMPOSITION NAMED ONE ────────────────────────────────
  //
  // MEASURED GAP, 2026-09-21. `activeControlDigest` is a SIGNED field, so an approval cannot be
  // re-pointed at another head without breaking its signature — but nothing compared it to the head
  // the deployment CURRENTLY serves, and `settleAuthorized` had no controller input at all. Measured
  // on a disposable controller: the controller served `811340dc…`, the approval named `a7811fe9…`,
  // and the settlement WROTE (`sequence 1`, one receipt, one Aura entry). An approval is therefore
  // admitted by a control that may since have been rotated or revoked.
  //
  // The pin mirrors `approverDid` exactly: optional, supplied by the composition from the controller
  // it already trusts, and a NAMED ceiling on the verdict rather than a silent widening when absent.
  // Shape is checked before comparison so a malformed pin is a usage fault, not a mismatch.
  if (expectation.activeControlDigest !== undefined) {
    if (typeof expectation.activeControlDigest !== 'string' || !DIGEST.test(expectation.activeControlDigest)) {
      refuse('APPROVAL_INPUT_MALFORMED', 'the pinned control head must be a digest')
    }
    if (receipt.activeControlDigest !== expectation.activeControlDigest) {
      refuse('APPROVAL_CONTROL_NOT_CURRENT',
        `the approval was signed under control head ${receipt.activeControlDigest} and this owner serves `
        + `${expectation.activeControlDigest}; an approval does not outlive the control that issued it`)
    }
  }
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(rawKeyHex, 'hex')]),
    format: 'der',
    type: 'spki',
  })
  if (!edVerify(null, bytes, key, Buffer.from(receipt.signature, 'hex'))) {
    refuse('APPROVAL_SIGNATURE_INVALID', 'the approval signature does not verify under the key its did:key names')
  }

  // ══ 8. THE WINDOW. ══
  const now = expectation.now ?? Math.floor(Date.now() / 1000)
  if (receipt.expiresAt <= now) {
    refuse('APPROVAL_EXPIRED', `the approval window closed at ${receipt.expiresAt} (now ${now})`)
  }
  if (!DIGEST.test(receipt.activeControlDigest)) refuse('APPROVAL_MALFORMED', 'activeControlDigest is not a digest')

  return Object.freeze({
    verdict: 'approved',
    approvalId: approvalIdOf(receipt),
    artifactDomain: receipt.domain,
    artifactVerdict: OWNER_KEY_SIGNED,
    challenge: receipt.challenge,
    subject: receipt.subject,
    approverDid: receipt.approvalKeyDid,
    activeControlDigest: receipt.activeControlDigest,
    operationDigest: receipt.operationDigest,
    signedBytesDigest: receipt.signedBytesDigest,
    approvalClass: receipt.approvalClass,
    keyClass: receipt.keyClass,
    keyClassMeaning: receipt.keyClassMeaning,
    attendance: receipt.attendance,
    identityBound: receipt.identityBound,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
    signature: receipt.signature,
    approverPinned: expectation.approverDid !== undefined,
    controlPinned: expectation.activeControlDigest !== undefined,
    ceilings: approvalCeilings(receipt),
  })
}

/**
 * The approval's identity and binding, as a receipt carries it.
 *
 * Written into the receipt body so the signed receipt names WHICH approval authorized this write,
 * which subject it was for, which effect digest it bound, and — since the artifact's class labels are
 * not signed — what the artifact LABELLED itself, so a reader can see the label was only ever a label.
 * It deliberately does NOT re-check the approval's window: an approval is consumed when the write
 * happens, and asking whether its window is still open later would accuse a genuine receipt of being
 * false because time passed.
 *
 * @param {Readonly<Record<string, unknown>>} verified - the result of `verifyApproval`.
 * @returns {Readonly<Record<string, unknown>>} the receipt's approval block.
 */
export function receiptApprovalBlock(verified) {
  return Object.freeze({
    approvalId: verified.approvalId,
    artifactDomain: verified.artifactDomain,
    challenge: verified.challenge,
    subject: verified.subject,
    approverDid: verified.approverDid,
    operationDigest: verified.operationDigest,
    signature: verified.signature,
    approvalClass: verified.approvalClass,
    keyClass: verified.keyClass,
  })
}

/**
 * The fields a receipt's approval block must carry, and the shapes they must have.
 * Exported so `memory-owner.mjs` and the courts check the same closed list.
 */
export const RECEIPT_APPROVAL_FIELDS = Object.freeze([
  'approvalId', 'artifactDomain', 'challenge', 'subject', 'approverDid', 'operationDigest', 'signature',
  'approvalClass', 'keyClass',
])
