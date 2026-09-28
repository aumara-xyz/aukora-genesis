/**
 * Receipt v3 — the portable, repository-free field-reading verifier.
 *
 * A v3 document carries its own evidence: the settlement receipt as issued, the
 * grant as signed, the Aura entry as appended, and a signed statement of the
 * chain head after that append. File paths are absent by design, so this module
 * reads one document plus the keys it names and opens nothing else.
 *
 * STATIC IMPORTS ARE EXACTLY `node:crypto`. That is the whole trust argument
 * for reading a stranger's document: the verifier is inside the RECIPIENT's
 * trusted path (the way any parser is), and outside the broker's. A v3 document
 * is not made trustworthy by this module; this module only refuses to be the
 * reason a reader cannot check one. The import-purity row measures the rule by
 * parsing this file with comments stripped, so prose here cannot satisfy it.
 *
 * WHAT A `CONFORMING` VERDICT MEANS, PRECISELY. Every signature the document
 * names verifies under the keys supplied, every embedded digest recomputes, and
 * every relationship the document asserts between its own parts holds. It does
 * NOT establish completeness of the chain, freshness, absence of a conflicting
 * history, or that the observed bytes are on disk now.
 *
 * THE VERIFIER NEVER THROWS ON A DOCUMENT. A hostile or malformed input
 * produces a named reason, never an exception.
 *
 * Canonical encoding is RFC 8785 (JCS) under an integer-only profile: keys
 * sorted by UTF-16 code units at every depth, `JSON.stringify` scalar
 * formatting, and any number that is not a safe integer refused by name.
 *
 * @module @aukora/receipt-v3/verify
 */
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto'

/** Domain separating a v3 document signature from every other signed message. */
export const RECEIPT_V3_DOMAIN = 'aukora:receipt:v3'

/** Domain separating the signed head statement. */
export const HEAD_STATEMENT_DOMAIN = 'aukora:aura-head:v1'

/**
 * The Aura record domain. A v3 document does not choose this value: it is the
 * separator `aukora/aura/record.mjs` writes into every entry preimage, restated
 * here because a repository import would defeat the point of the module.
 */
export const AURA_RECORD_DOMAIN = 'aukora:aura-record:v1'

/**
 * The approval artifact domain and its signed-message separator, as
 * `aukora/approval/artifact.mjs` defines them. Deep's approval signature covers
 * the ARTIFACT digest, not this document: `approvalSignedMessage(digest)` is
 * `"aukora:approval-artifact:v1:signed <digest>"`. A v3 approval block therefore
 * carries `artifactDigest` so a recipient can recompute the artifact digest from
 * the artifact fields and check the signature that names it.
 */
export const APPROVAL_ARTIFACT_DOMAIN = 'aukora:approval-artifact:v1'

/** The separator between the approval signed-message domain and its digest. */
export const APPROVAL_SIGNED_DOMAIN = 'aukora:approval-artifact:v1:signed'

/**
 * The two grant domains this tree knows. A grant claim set is byte-identical
 * across them; only what the root's key covers differs, which is exactly why
 * they are separate domains rather than one versioned family.
 */
export const GRANT_DOMAIN_V3 = 'aukora:tool-grant:v3'
export const GRANT_DOMAIN_V4 = 'aukora:tool-grant:v4'

/** The evidence profile kind. */
export const RECEIPT_V3_KIND = 'aukora-receipt/v3'

/** The fixture profile kind. A fixture is never evidence. */
export const RECEIPT_V3_FIXTURE_KIND = 'aukora-receipt/v3-fixture'

/** The three approval classes. A receipt cannot be silent about which one it is. */
/**
 * The four approval classes.
 *
 * `scripted` and `unattributed` are NOT the same absence. `scripted` means the
 * settlement came from a fixture path, and its `kind` must say so. A real
 * settlement with no owner signature is not a fixture: its approval evidence is
 * MISSING, and the honest word for that is `unattributed`. An earlier version
 * reported such a settlement as `scripted`, which asserted a provenance the
 * evidence did not show.
 */
export const APPROVAL_CLASSES = Object.freeze(['human-ceremony', 'delegated', 'scripted', 'unattributed'])

/** The classes that may appear under the EVIDENCE kind. A fixture may not, and neither may unattributed. */
export const EVIDENCE_CLASSES = Object.freeze(['human-ceremony', 'delegated'])

/** The four renderer domains. No value closes KERNEL_TRUSTED; this labels, it does not close. */
export const RENDERER_DOMAINS = Object.freeze([
  'same-process', 'separate-process', 'separate-device', 'independent-signer',
])

/** Key custody classes. `C` is operator-custodied and is never human-ceremony. */
export const KEY_CLASSES = Object.freeze(['A', 'B', 'C'])

/** The exact own data fields of one v3 document. Closed set: an unknown key refuses. */
export const RECEIPT_V3_FIELDS = Object.freeze([
  'kind', 'domain', 'nonce', 'operation', 'resource', 'definitionId', 'settlement', 'action',
  'authorization', 'approval', 'delegation', 'publication', 'effect', 'times', 'timesSources',
  'aura', 'head', 'ceilings', 'issuerKeyId', 'signature',
])

/** Fields covered by the document signature. Everything a reader is asked to believe. */
export const RECEIPT_V3_SIGNED_FIELDS = Object.freeze([
  'kind', 'domain', 'nonce', 'operation', 'resource', 'definitionId', 'settlement', 'action',
  'authorization', 'approval', 'delegation', 'publication', 'effect', 'times', 'timesSources',
  'aura', 'head', 'ceilings', 'issuerKeyId',
])

/** The v1 settlement receipt's own field inventory, in the order its preimage uses. */
export const SETTLEMENT_V1_FIELDS = Object.freeze([
  'requestDigest', 'definitionId', 'nonce', 'sequence', 'path', 'bytes', 'contentSha256', 'inode',
  'mtimeNs', 'confinement',
])

/** The fields a v1 receipt's own signature covers, in order. */
const SETTLEMENT_V1_KEYS = Object.freeze([...SETTLEMENT_V1_FIELDS, 'signature'])

/** The exact own data fields of the embedded grant payload. */
export const GRANT_PAYLOAD_FIELDS = Object.freeze([
  'domain', 'tool', 'digest', 'nonce', 'exp', 'definitionId', 'operationDigest', 'receiptKeyId',
])

/** The exact own data fields of one approval block, per class. */
const HUMAN_APPROVAL_FIELDS = Object.freeze([
  'class', 'at', 'challenge', 'signerKeyId', 'keyClass', 'ceremony', 'artifactDigest', 'signature', 'renderer',
])

/** The artifact fields a human-ceremony approval block carries, so its digest can be recomputed. */
export const APPROVAL_ARTIFACT_FIELDS = Object.freeze([
  'version', 'operationArguments', 'operationCanonicalBytes', 'operationDigest', 'semanticProjection',
  'definitionId', 'activationDigest', 'occurrenceId', 'expiry', 'rendererId', 'oneUse',
])
const DELEGATED_APPROVAL_FIELDS = Object.freeze(['class', 'at'])
const SCRIPTED_APPROVAL_FIELDS = Object.freeze(['class', 'at'])
const UNATTRIBUTED_APPROVAL_FIELDS = Object.freeze(['class', 'at'])

/** Named refusals. A closed vocabulary: this module never prints a reason it did not measure. */
export const RECEIPT_V3_REFUSE = Object.freeze({
  FIELD_SET: 'receipt:field-set',
  SIGNATURE: 'receipt:signature',
  GRANT_SIGNATURE: 'grant:signature',
  GRANT_BINDING: 'grant:binding',
  ACTION_DIGEST: 'action:digest',
  APPROVAL_CLASS: 'approval:class',
  APPROVAL_SIGNATURE: 'approval:signature',
  APPROVAL_CHALLENGE: 'approval:challenge',
  TIMES_ORDER: 'times:order',
  AURA_HASH: 'aura:hash',
  AURA_ENTRY_SIGNATURE: 'aura:entry-signature',
  AURA_ENTRY_BINDS: 'aura:entry-binds-receipt',
  HEAD_SIGNATURE: 'head:signature',
  EFFECT_OBSERVED: 'effect:observed',
  CEILINGS_PRESENT: 'ceilings:present',
  KEY_CLASS: 'approval:key-class',
  CLASS_KIND_MISMATCH: 'receipt:class-kind-mismatch',
  OWNER_KEY_UNREGISTERED: 'approval:owner-key-unregistered',
  CHALLENGE_UNBOUND: 'approval:challenge-unbound',
  TIME_UNSOURCED: 'receipt:time-unsourced',
  SETTLEMENT_SIGNATURE: 'settlement:signature',
  INCONSISTENT: 'receipt:inconsistent',
  NUMBER_NOT_INTEGER: 'receipt:number-not-integer',
  MALFORMED: 'receipt:malformed',
})

/**
 * Ceilings this verifier adds because it measured the condition, never because a
 * document asked it to. Printing a ceiling the document supplied would let a
 * document choose its own limits.
 */
export const MEASURED_CEILINGS = Object.freeze([
  'HOST_CLOCK_TRUSTED_FOR_EXPIRY',
])

/**
 * The value a time or source carries when the evidence does not contain it.
 * Mirrors `TIMES_UNAVAILABLE` in `aukora/receipt-v3/export.mjs`; declared here
 * too because the verifier must not import from the producer.
 */
export const TIMES_UNAVAILABLE = 'unavailable'

/** The closed vocabulary of instant provenances a document may name. */
export const TIME_SOURCES = Object.freeze([
  'grant-expiry-seconds',
  'approval-recorded',
  'aura-entry-measured',
  'export-instant',
  'fixture-coherent',
])

/** The four instants a v3 document names. */
export const RECEIPT_V3_TIME_FIELDS = Object.freeze(['issuedAt', 'approvedAt', 'settledAt', 'expiresAt'])

/** The v1 settlement receipt preimage domain, as `aukora/broker/receipt.mjs` fixes it. */
const SETTLEMENT_V1_DOMAIN = 'aukora:settlement-receipt:v1'

const HEX_SHA256 = /^[0-9a-f]{64}$/

/**
 * The nonce alphabet and length, identical to `SAFE_NONCE` in
 * `aukora/broker/receipt.mjs`: `[a-zA-Z0-9_-]{1,128}`.
 *
 * It is deliberately NOT a 32-hex rule. `newNonce()` is 12 random bytes rendered
 * hex, so a real settlement nonce is 24 characters. Requiring 32 here made the
 * verifier refuse every genuine document, while the checked-in fixture hid that
 * by carrying a 32-character nonce the broker would never mint.
 */
const SAFE_NONCE = /^[a-zA-Z0-9_-]{1,128}$/

/**
 * A canonical Base64 Ed25519 signature: 64 bytes encoded as 88 characters with
 * `==` padding. The alphabet and padding are checked by re-encoding rather than
 * by a pattern, so a single flipped character still reaches cryptographic
 * verification and is reported as a bad SIGNATURE instead of a malformed field.
 * A court cannot tell those two apart if the shape check refuses first.
 */
const SIGNATURE_LENGTH = 88

/**
 * RFC 8785 JCS under the integer-only profile.
 *
 * Keys are ordered by UTF-16 code units, which is what `Array.prototype.sort`
 * does by default and is NOT code-point order: an astral key sorts before a BMP
 * key in U+E000..U+FFFF here and after it under Python's `sort_keys=True`. Both
 * behaviors are measured by `V3.canonical-parity`.
 *
 * @param {unknown} value - JSON data.
 * @returns {string} canonical JSON text.
 * @throws {TypeError} `receipt:number-not-integer` for any non-safe-integer number.
 */
export function canonicalJSONV3(value) {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError(RECEIPT_V3_REFUSE.NUMBER_NOT_INTEGER)
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJSONV3).join(',')}]`
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJSONV3(value[key])}`).join(',')}}`
  }
  throw new TypeError(`${RECEIPT_V3_REFUSE.MALFORMED} — ${typeof value} is not JSON data`)
}

/** The bytes a v3 document signature covers. */
export function receiptV3Preimage(core) {
  return Buffer.from(`${RECEIPT_V3_DOMAIN}\n${canonicalJSONV3(core)}`, 'utf8')
}

/** The bytes a head statement signature covers. */
export function headStatementPreimage({ seq, hash, at, keyId }) {
  return Buffer.from(`${HEAD_STATEMENT_DOMAIN}\n${canonicalJSONV3({ seq, hash, at, keyId })}`, 'utf8')
}

/** The core a document signature covers: every field a reader is asked to believe. */
export function receiptV3Core(document) {
  const core = {}
  for (const field of RECEIPT_V3_SIGNED_FIELDS) core[field] = document[field]
  return core
}

/** Stable identity of one Ed25519 public key: sha256 over its canonical SPKI DER bytes. */
export function keyIdForPublicKey(publicKey) {
  const key = publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey)
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex')
}

/**
 * Parse exactly the canonical PEM encoding of an Ed25519 public key.
 *
 * `createPublicKey()` accepts a private PEM and derives its public half, which
 * is unsafe at a trust-anchor boundary: a caller could hand a verifier a signing
 * secret. Only the canonical re-encoding is accepted.
 *
 * @param {unknown} value - candidate PEM text.
 * @returns {{key: import('node:crypto').KeyObject, keyId: string} | null} the key and its identity.
 */
export function canonicalExecutorKey(value) {
  if (typeof value !== 'string') return null
  try {
    const key = createPublicKey(value)
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') return null
    if (key.export({ type: 'spki', format: 'pem' }).toString() !== value) return null
    return { key, keyId: keyIdForPublicKey(key) }
  } catch {
    return null
  }
}

/** Snapshot one candidate anchor: either canonical PEM text or a `{ keyId, pem }` pair. */
function anchorEntries(anchors) {
  /** @type {{keyId: string | null, pem: string}[]} */
  const entries = []
  const list = anchors === undefined || anchors === null
    ? []
    : Array.isArray(anchors) ? anchors : [anchors]
  for (const entry of list) {
    if (typeof entry === 'string') entries.push({ keyId: null, pem: entry })
    else if (entry !== null && typeof entry === 'object' && typeof entry.pem === 'string') {
      entries.push({ keyId: typeof entry.keyId === 'string' ? entry.keyId : null, pem: entry.pem })
    }
  }
  return entries
}

/** Find the anchor a document names, by key id when it supplies one. */
function findAnchor(anchors, keyId) {
  for (const entry of anchorEntries(anchors)) {
    const canonical = canonicalExecutorKey(entry.pem)
    if (canonical === null) continue
    if (entry.keyId !== null && entry.keyId !== keyId) continue
    if (canonical.keyId === keyId) return canonical
  }
  return null
}

/** True when every supplied anchor parses, so an unparsable key set cannot silently mean "no keys". */
function anchorsAreCanonical(anchors) {
  const entries = anchorEntries(anchors)
  return entries.length > 0 && entries.every((entry) => canonicalExecutorKey(entry.pem) !== null)
}

/** Verify one base64 Ed25519 signature over one message, reporting only a boolean. */
function signatureHolds(publicKey, message, signatureBase64) {
  if (typeof signatureBase64 !== 'string' || signatureBase64.length !== SIGNATURE_LENGTH) return false
  const bytes = Buffer.from(signatureBase64, 'base64')
  if (bytes.length !== 64 || bytes.toString('base64') !== signatureBase64) return false
  try {
    return edVerify(null, message, publicKey, bytes)
  } catch {
    return false
  }
}

/** Snapshot the own enumerable data fields of one plain object without invoking accessors. */
function snapshotPlain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null
    const snapshot = Object.create(null)
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return null
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null
      snapshot[key] = descriptor.value
    }
    return snapshot
  } catch {
    return null
  }
}

/** True when `value` is a plain object whose own data keys are exactly `expected`. */
function hasExactFields(value, expected) {
  const snapshot = snapshotPlain(value)
  if (snapshot === null) return null
  const keys = Object.keys(snapshot)
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) return null
  return snapshot
}

/** A positive safe integer, or null. */
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0 ? value : null

/** A sha256 hex string, or null. */
const sha256Hex = (value) => typeof value === 'string' && HEX_SHA256.test(value) ? value : null

/**
 * A v3 document's fixture `kind` for one approval class: scripted is a fixture,
 * and every other class is evidence. The pair is checked in both directions.
 *
 * @param {unknown} kind - the document's `kind`.
 * @param {unknown} approvalClass - the document's `approval.class`.
 * @returns {boolean} true when the pair is coherent.
 */
export function classMatchesKind(kind, approvalClass) {
  if (approvalClass === 'scripted') return kind === RECEIPT_V3_FIXTURE_KIND
  return kind === RECEIPT_V3_KIND && EVIDENCE_CLASSES.includes(approvalClass)
}

/**
 * The signed messages a grant claim set can arrive under.
 *
 * THIS TREE SIGNS TWO DIFFERENT MESSAGES and a verifier that knows only one
 * refuses every genuine grant from the other path. Measured against a real
 * broker, the grant reaching `settleGrantRequest` is signed by `grantPreimage`:
 *
 *   v3 form  `canonicalJSON({domain:'aukora:tool-grant:v3', tool, digest, nonce,
 *             exp, definitionId, operationDigest, receiptKeyId})` — the domain is
 *             a FIELD INSIDE the canonical object, and the signature is over
 *             those bytes directly.
 *
 *   v4 form  `"aukora:tool-grant:v4\n" + sha256(canonicalJSON({domain:
 *             'aukora:tool-grant:v4', tool, ...}))` — the same claims, but the
 *             root signs a digest so it can authorize a grant it never receives
 *             the preimage of.
 *
 * A reader is given the claims and the signature and must try both, because the
 * document does not say which family produced it. Accepting either is not a
 * weakening: each is a domain-separated signature over these exact claims, and a
 * signature that verifies under neither still refuses.
 *
 * @param {Record<string, unknown>} payload - the grant claims, already canonical.
 * @param {string} canonical - `canonicalJSONV3(payload)`.
 * @returns {Buffer[]} the candidate signed messages, in v3-then-v4 order.
 */
function grantSignedMessageCandidates(payload, canonical) {
  const claims = { ...payload }
  return [
    Buffer.from(canonicalJSONV3({
      domain: GRANT_DOMAIN_V3,
      tool: claims.tool,
      digest: claims.digest,
      nonce: claims.nonce,
      exp: claims.exp,
      definitionId: claims.definitionId,
      operationDigest: claims.operationDigest,
      receiptKeyId: claims.receiptKeyId,
    }), 'utf8'),
    Buffer.from(`${GRANT_DOMAIN_V4}\n${createHash('sha256').update(`${GRANT_DOMAIN_V4}\n${canonical}`, 'utf8').digest('hex')}`, 'utf8'),
  ]
}

/** The class line a reader sees under the verdict. */
function classLine({ approvalClass }) {
  if (approvalClass === 'scripted') return 'SCRIPTED — NOT EVIDENCE'
  if (approvalClass === 'human-ceremony') return 'OWNER_KEY_SIGNED / ATTENDANCE_REPORTED_NOT_PROVEN'
  if (approvalClass === 'unattributed') return 'NO APPROVAL EVIDENCE — NOT EVIDENCE'
  return 'DELEGATED — NOT EVIDENCE'
}

/**
 * Verify one v3 document against the keys it names.
 *
 * THREE KEY SETS, because a v3 document names three different keys and the
 * recipient must anchor each one separately:
 *
 *   executorPublicKeys  signs the document core (`issuerKeyId`) and the head
 *                       statement (`head.keyId`). This is the settlement party.
 *   issuerPublicKeys    signs the embedded grant (`authorization.keyId`). A v4
 *                       authorization is signed by the issuer ROOT, whose key is
 *                       deliberately unavailable to the executor process, so
 *                       checking it against the executor's set could never pass
 *                       for a real settlement. Defaults to the executor set when
 *                       omitted, which is correct only for a single-key fixture.
 *   ownerPublicKeys     signs the approval (`approval.signerKeyId`), required for
 *                       a `human-ceremony` document and ignored otherwise.
 *
 * @param {object} params
 * @param {unknown} params.document - the parsed v3 document.
 * @param {unknown} params.executorPublicKeys - the executor public key set. Each entry is
 *   canonical Ed25519 PEM text or `{ keyId, pem }`. Signatures are checked against the
 *   entry whose key id the document names.
 * @param {unknown} [params.issuerPublicKeys] - the issuer root set that signs embedded grants.
 * @param {unknown} [params.ownerPublicKeys] - the owner public key set, required for a
 *   `human-ceremony` document and ignored otherwise.
 * @returns {{
 *   verdict: 'CONFORMING' | 'NON-CONFORMING',
 *   reasons: string[],
 *   ceilings: string[],
 *   approvalClass: string | null,
 *   lines: string[],
 * }} the verdict, every named reason, every ceiling, and the printed lines.
 */
export function verifyReceiptV3({
  document,
  executorPublicKeys,
  issuerPublicKeys = executorPublicKeys,
  ownerPublicKeys,
} = {}) {
  /** @type {string[]} */
  const reasons = []
  /** @type {string[]} */
  const ceilings = []
  /** @type {string[]} */
  const lines = []
  const refuse = (name, detail) => {
    if (!reasons.includes(name)) reasons.push(name)
    lines.push(`REFUSED ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
  const ceiling = (name) => {
    if (!ceilings.includes(name)) ceilings.push(name)
  }

  // 1. receipt:field-set — a closed document. An unknown key is a rider this
  //    verifier cannot see the meaning of, so the whole document refuses.
  const top = hasExactFields(document, RECEIPT_V3_FIELDS)
  if (top === null) {
    refuse(RECEIPT_V3_REFUSE.FIELD_SET, 'the document is not an object with exactly the v3 field set')
    return { verdict: 'NON-CONFORMING', reasons, ceilings, approvalClass: null, lines }
  }
  if (top.kind !== RECEIPT_V3_KIND && top.kind !== RECEIPT_V3_FIXTURE_KIND) {
    refuse(RECEIPT_V3_REFUSE.FIELD_SET, `kind=${String(top.kind)} is not a v3 profile kind`)
    return { verdict: 'NON-CONFORMING', reasons, ceilings, approvalClass: null, lines }
  }
  if (top.domain !== RECEIPT_V3_DOMAIN) {
    refuse(RECEIPT_V3_REFUSE.FIELD_SET, `domain=${String(top.domain)}`)
    return { verdict: 'NON-CONFORMING', reasons, ceilings, approvalClass: null, lines }
  }
  if (!Array.isArray(top.ceilings) || top.ceilings.length === 0) {
    refuse(RECEIPT_V3_REFUSE.CEILINGS_PRESENT, 'a document with no named limit claims to have none')
  } else {
    for (const name of top.ceilings) {
      if (typeof name !== 'string' || name.length === 0) {
        refuse(RECEIPT_V3_REFUSE.CEILINGS_PRESENT, 'a ceiling name is not a non-empty string')
        break
      }
      ceiling(name)
    }
  }

  const approvalClass = top.approval !== null && typeof top.approval === 'object'
    ? top.approval.class
    : null
  const approvalClassIsKnown = APPROVAL_CLASSES.includes(approvalClass)

  // The class-versus-kind pair is judged before any signature: it decides what
  // the document is graded as, and a mismatch means the document is lying about
  // its own category rather than failing a cryptographic check.
  if (approvalClassIsKnown && !classMatchesKind(top.kind, approvalClass)) {
    refuse(RECEIPT_V3_REFUSE.CLASS_KIND_MISMATCH,
      `kind=${top.kind} with approval.class=${String(approvalClass)}`)
  }

  // 16. approval:key-class — class C is operator-custodied and can never be
  //     graded human-ceremony. This is the honesty rule at schema level.
  if (approvalClass === 'human-ceremony' && top.approval.keyClass === 'C') {
    refuse(RECEIPT_V3_REFUSE.KEY_CLASS, 'keyClass C is operator-custodied and is never human-ceremony')
  }

  // Canonicalization runs before signatures, because every preimage depends on
  // it. A document carrying a non-integer number anywhere refuses by name here
  // rather than throwing out of the verifier.
  let canonicalCore
  try {
    canonicalCore = canonicalJSONV3(receiptV3Core(top))
  } catch (error) {
    refuse(error?.message === RECEIPT_V3_REFUSE.NUMBER_NOT_INTEGER
      ? RECEIPT_V3_REFUSE.NUMBER_NOT_INTEGER
      : RECEIPT_V3_REFUSE.MALFORMED,
    'the document core is not canonical-JSON data')
    return { verdict: 'NON-CONFORMING', reasons, ceilings, approvalClass, lines }
  }

  // 2. receipt:signature — the document's own signature over its core.
  const issuerKeyId = sha256Hex(top.issuerKeyId)
  if (issuerKeyId === null) {
    refuse(RECEIPT_V3_REFUSE.SIGNATURE, 'issuerKeyId is not a sha256 hex key id')
  } else {
    const anchor = findAnchor(executorPublicKeys, issuerKeyId)
    if (anchor === null) {
      refuse(RECEIPT_V3_REFUSE.SIGNATURE,
        anchorsAreCanonical(executorPublicKeys)
          ? `no supplied executor key has keyId ${issuerKeyId}`
          : 'the executor public key set is empty or not canonical Ed25519 PEM')
    } else if (!signatureHolds(anchor.key, Buffer.from(`${RECEIPT_V3_DOMAIN}\n${canonicalCore}`, 'utf8'), top.signature)) {
      refuse(RECEIPT_V3_REFUSE.SIGNATURE, 'the document signature does not verify over its core')
    }
  }

  const authorization = hasExactFields(top.authorization, ['payload', 'signature', 'keyId'])
  const payload = authorization === null ? null : hasExactFields(authorization.payload, GRANT_PAYLOAD_FIELDS)

  // 3. grant:signature — the embedded grant verifies under the key id it names.
  //    v3 documents carry grant family v4, whose signed message is the sha256 of
  //    the canonical claims preimage, so the preimage is never transmitted.
  let payloadCanonical = null
  if (payload === null || authorization === null) {
    refuse(RECEIPT_V3_REFUSE.GRANT_SIGNATURE, 'the authorization block or its payload is not an exact field set')
  } else {
    try {
      payloadCanonical = canonicalJSONV3(payload)
    } catch {
      refuse(RECEIPT_V3_REFUSE.NUMBER_NOT_INTEGER, 'the grant payload carries a non-integer number')
    }
    if (payloadCanonical !== null) {
      const grantKeyId = sha256Hex(authorization.keyId)
      // The grant is checked against the ISSUER set, never the executor set. A
      // v4 authorization is signed by the issuer root, whose key is deliberately
      // unavailable to the executor process that writes the receipt, so a
      // document whose grant were checked against the executor's keys could
      // never pass for a real settlement.
      const grantAnchor = grantKeyId === null ? null : findAnchor(issuerPublicKeys, grantKeyId)
      if (grantKeyId === null) {
        refuse(RECEIPT_V3_REFUSE.GRANT_SIGNATURE, 'authorization.keyId is not a sha256 hex key id')
      } else if (grantAnchor === null) {
        refuse(RECEIPT_V3_REFUSE.GRANT_SIGNATURE,
          anchorsAreCanonical(issuerPublicKeys)
            ? `no supplied issuer key has keyId ${grantKeyId}`
            : 'the issuer public key set is empty or not canonical Ed25519 PEM')
      } else {
        const candidates = grantSignedMessageCandidates(payload, payloadCanonical)
        if (!candidates.some((message) => signatureHolds(grantAnchor.key, message, authorization.signature))) {
          refuse(RECEIPT_V3_REFUSE.GRANT_SIGNATURE,
            'the embedded grant signature verifies under neither the v3 nor the v4 signed message')
        }
      }
    }
  }

  const action = hasExactFields(top.action, ['canonical', 'digest'])
  const effect = hasExactFields(top.effect, ['observedDigest', 'observedAt'])
  const times = hasExactFields(top.times, [...RECEIPT_V3_TIME_FIELDS])
  const timesSources = hasExactFields(top.timesSources, [...RECEIPT_V3_TIME_FIELDS])
  const aura = hasExactFields(top.aura, ['seq', 'prev', 'hash', 'entry'])
  const settlement = hasExactFields(top.settlement, SETTLEMENT_V1_KEYS)

  // The embedded v1 receipt is the document's own account of the settlement.
  // Its digest must be the one the Aura entry already records, and its observed
  // content digest must be the one the effect block reports: a document that
  // carries two different accounts of one settlement is refused as inconsistent
  // rather than graded on whichever copy the reader happened to open first.
  if (settlement === null) {
    refuse(RECEIPT_V3_REFUSE.FIELD_SET, 'the settlement block is not an exact v1 receipt field set')
  } else {
    let recomputed = null
    try {
      const ordered = {}
      for (const field of SETTLEMENT_V1_KEYS) ordered[field] = settlement[field] ?? null
      recomputed = createHash('sha256').update(canonicalJSONV3(ordered), 'utf8').digest('hex')
    } catch {
      refuse(RECEIPT_V3_REFUSE.NUMBER_NOT_INTEGER, 'the settlement block carries a non-integer number')
    }
    if (recomputed !== null) {
      const declared = aura === null ? undefined : snapshotPlain(aura.entry)?.receiptSha256
      if (sha256Hex(declared) === null) {
        // Reported by check 12 as well; named here so a document whose entry
        // names no digest cannot pass this check by having nothing to compare.
        refuse(RECEIPT_V3_REFUSE.AURA_ENTRY_BINDS, 'the entry names no receipt digest to bind the settlement to')
      } else if (declared !== recomputed) {
        refuse(RECEIPT_V3_REFUSE.INCONSISTENT,
          `sha256(settlement)=${recomputed.slice(0, 16)} but the Aura entry names ${String(declared).slice(0, 16)}`)
      }
    }
    if (settlement.nonce !== top.nonce) {
      refuse(RECEIPT_V3_REFUSE.INCONSISTENT, 'the settlement nonce differs from the document nonce')
    }
    if (settlement.definitionId !== top.definitionId) {
      refuse(RECEIPT_V3_REFUSE.INCONSISTENT, 'the settlement definitionId differs from the document definitionId')
    }
    if (effect !== null && settlement.contentSha256 !== effect.observedDigest) {
      refuse(RECEIPT_V3_REFUSE.INCONSISTENT,
        `the settlement content digest ${String(settlement.contentSha256).slice(0, 16)} differs from effect.observedDigest ${String(effect.observedDigest).slice(0, 16)}`)
    }

    // THE EMBEDDED V1 RECEIPT'S OWN SIGNATURE IS VERIFIED, NOT MERELY HASHED.
    //
    // Hashing it inside another signed document proves only that whoever wrote
    // that document also wrote this block: an exporter could invent a settlement
    // and sign the wrapper. The v1 signature is what makes the block the
    // executor's statement, and it is checked over the receipt's own frozen
    // preimage under the executor key set — the same party that signs this
    // document's core and head statement, because both are minted with
    // `brokerPrivateKey`.
    if (typeof settlement.signature !== 'string') {
      refuse(RECEIPT_V3_REFUSE.SETTLEMENT_SIGNATURE, 'the settlement block carries no signature')
    } else {
      const orderedClaims = {}
      for (const field of SETTLEMENT_V1_FIELDS) orderedClaims[field] = settlement[field] ?? null
      const receiptKeyId = sha256Hex(top.issuerKeyId)
      const receiptAnchor = receiptKeyId === null ? null : findAnchor(executorPublicKeys, receiptKeyId)
      if (receiptAnchor === null) {
        refuse(RECEIPT_V3_REFUSE.SETTLEMENT_SIGNATURE,
          `no supplied executor key has keyId ${String(top.issuerKeyId)}`)
      } else {
        let preimage = null
        try {
          preimage = Buffer.from(`${SETTLEMENT_V1_DOMAIN}\n${canonicalJSONV3(
            SETTLEMENT_V1_FIELDS.map((field) => [field, orderedClaims[field]]),
          )}`, 'utf8')
        } catch {
          refuse(RECEIPT_V3_REFUSE.NUMBER_NOT_INTEGER, 'the settlement claims are not canonical-JSON data')
        }
        if (preimage !== null && !signatureHolds(receiptAnchor.key, preimage, settlement.signature)) {
          refuse(RECEIPT_V3_REFUSE.SETTLEMENT_SIGNATURE,
            'the embedded v1 receipt signature does not verify under the executor key that signs this document')
        }
      }
    }
  }

  // 5. action:digest — the digest recomputes over the exact approved bytes.
  if (action === null || typeof action.canonical !== 'string') {
    refuse(RECEIPT_V3_REFUSE.ACTION_DIGEST, 'the action block is not an exact field set')
  } else {
    const recomputed = createHash('sha256').update(action.canonical, 'utf8').digest('hex')
    if (recomputed !== action.digest) {
      refuse(RECEIPT_V3_REFUSE.ACTION_DIGEST, `sha256(action.canonical)=${recomputed.slice(0, 16)} but action.digest=${String(action.digest).slice(0, 16)}`)
    }
  }

  // 6. approval:class — one of three, with exactly the fields that class carries.
  if (top.approval === null || typeof top.approval !== 'object' || Array.isArray(top.approval)) {
    refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, 'the approval block is absent or not an object')
  } else if (!approvalClassIsKnown) {
    refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, `class=${String(approvalClass)} is not one of the three`)
  } else {
    const required = approvalClass === 'human-ceremony'
      ? HUMAN_APPROVAL_FIELDS
      : approvalClass === 'delegated' ? DELEGATED_APPROVAL_FIELDS
        : approvalClass === 'scripted' ? SCRIPTED_APPROVAL_FIELDS : UNATTRIBUTED_APPROVAL_FIELDS
    const approval = hasExactFields(top.approval, required)
    if (approval === null) {
      const present = Object.keys(snapshotPlain(top.approval) ?? {}).join(',')
      refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS,
        `approval.class=${approvalClass} requires exactly ${required.join(',')}; the document carries ${present || 'none'}`)
    } else {
      if (!Number.isSafeInteger(approval.at)) {
        refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, 'approval.at is not an integer')
      }
      if (approvalClass === 'human-ceremony') {
        if (!KEY_CLASSES.includes(approval.keyClass)) {
          refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, `keyClass=${String(approval.keyClass)} is not A, B or C`)
        }
        if (approval.ceremony !== 'reported' && approval.ceremony !== 'evidenced') {
          refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, `ceremony=${String(approval.ceremony)} is not reported or evidenced`)
        }
        if (sha256Hex(approval.artifactDigest) === null) {
          refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, 'approval.artifactDigest is not a sha256')
        }
        const renderer = hasExactFields(approval.renderer, ['id', 'domain'])
        if (renderer === null) {
          refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, 'approval.renderer is not an exact {id, domain} field set')
        } else {
          if (sha256Hex(renderer.id) === null) {
            refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, 'renderer.id is not a source sha256')
          }
          if (!RENDERER_DOMAINS.includes(renderer.domain)) {
            refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, `renderer.domain=${String(renderer.domain)} is not one of the four`)
          }
          // renderer.id is SELF-REPORTED. Nothing here measures the renderer;
          // the field is a label a reader weighs, never a check that passed.
          if (renderer.domain === 'independent-signer') ceiling('SIGNER_DEVICE_TRUSTED')
        }
      }
    }
  }

  const approvalSnapshot = top.approval !== null && typeof top.approval === 'object'
    ? snapshotPlain(top.approval)
    : null
  const approvalAt = approvalSnapshot !== null && Number.isSafeInteger(approvalSnapshot.at) ? approvalSnapshot.at : null

  // 9. times:order — every instant is either a sourced integer or explicitly
  //    unavailable, the sourced ones are ordered, and every duplicated value
  //    agrees with its top-level copy.
  //
  //    AN UNAVAILABLE INSTANT IS NOT A FAILURE. A real settlement carries no
  //    settlement clock, no issuance instant and no recorded approval instant,
  //    so a document that named numbers there would be inventing history. The
  //    check is therefore conditional on availability, and `timesSources` must
  //    declare the provenance of every instant so the condition is auditable.
  if (times === null) {
    refuse(RECEIPT_V3_REFUSE.TIMES_ORDER, 'the times block is not an exact field set')
  } else if (timesSources === null) {
    refuse(RECEIPT_V3_REFUSE.TIMES_ORDER, 'the timesSources block is not an exact field set')
  } else {
    const ordered = [...RECEIPT_V3_TIME_FIELDS]
    for (const name of ordered) {
      const value = times[name]
      const source = timesSources[name]
      const available = Number.isSafeInteger(value)
      // A number must name a known provenance; unavailable must be declared as
      // such. A number paired with `unavailable`, or a sentinel paired with a
      // real source, is a document contradicting itself about whether it knows.
      if (available && !TIME_SOURCES.includes(source)) {
        refuse(RECEIPT_V3_REFUSE.TIME_UNSOURCED,
          `${name}=${value} carries source ${JSON.stringify(source)}, which is not a known provenance`)
      } else if (!available && value !== TIMES_UNAVAILABLE) {
        refuse(RECEIPT_V3_REFUSE.TIMES_ORDER, `${name} is neither an integer nor ${TIMES_UNAVAILABLE}`)
      } else if (!available && source !== TIMES_UNAVAILABLE) {
        refuse(RECEIPT_V3_REFUSE.TIME_UNSOURCED,
          `${name} is unavailable but names source ${JSON.stringify(source)}`)
      }
    }
    // Order is enforced only across instants the document claims to know, in the
    // sequence they would occur. An unavailable instant is skipped, not treated
    // as zero.
    const held = ordered.filter((name) => Number.isSafeInteger(times[name])).map((name) => [name, times[name]])
    for (let index = 1; index < held.length; index += 1) {
      if (held[index - 1][1] > held[index][1]) {
        refuse(RECEIPT_V3_REFUSE.TIMES_ORDER,
          `${held[index - 1][0]}=${held[index - 1][1]} is after ${held[index][0]}=${held[index][1]}`)
      }
    }
    if (!held.some(([name]) => name === 'expiresAt')) {
      refuse(RECEIPT_V3_REFUSE.TIMES_ORDER, 'no expiry instant is available, so the grant bounds nothing')
    }
    if (approvalAt !== null && Number.isSafeInteger(times.approvedAt) && times.approvedAt !== approvalAt) {
      refuse(RECEIPT_V3_REFUSE.INCONSISTENT,
        `approval.at=${approvalAt} differs from times.approvedAt=${times.approvedAt}`)
    }
    if (payload !== null) {
      // THE TWO COPIES ARE IN DIFFERENT UNITS, deliberately and by inheritance.
      // A v4 grant payload's `exp` is Unix SECONDS (`Math.floor(Date.now()/1000)`
      // at mint time); a v3 document's `times` are integer MILLISECONDS. So the
      // duplicated value is compared after conversion, not literally, and the
      // mismatch is reported only when neither reading agrees. Comparing them
      // literally refuses every genuine document with `receipt:inconsistent`.
      if (Number.isSafeInteger(payload.exp) && Number.isSafeInteger(times.expiresAt)
        && payload.exp !== times.expiresAt
        && payload.exp * 1000 !== times.expiresAt) {
        refuse(RECEIPT_V3_REFUSE.INCONSISTENT,
          `grant payload exp=${payload.exp} (seconds) differs from times.expiresAt=${times.expiresAt} (milliseconds)`)
      }
    }
    // expiresAt cannot be checked against true time: this verifier does not read
    // a clock it does not trust, so it names the limit instead of pretending.
    ceiling('HOST_CLOCK_TRUSTED_FOR_EXPIRY')
  }

  // 4. grant:binding — the grant binds this nonce, this action digest, this
  //    operation and this resource. A grant that authorizes something else is
  //    evidence of something else.
  if (payload !== null) {
    const bindings = [
      [payload.digest === (action === null ? undefined : action.digest), 'grant payload digest does not equal action.digest'],
      [payload.nonce === top.nonce, 'grant payload nonce does not equal the document nonce'],
      [payload.tool === top.operation, 'grant payload tool does not equal operation'],
      [payload.definitionId === top.definitionId, 'grant payload definitionId does not equal the document definitionId'],
      [payload.domain === 'aukora:tool-grant:v4', 'grant payload domain is not the v4 authorization domain'],
    ]
    for (const [held, detail] of bindings) if (!held) refuse(RECEIPT_V3_REFUSE.GRANT_BINDING, detail)
    if (typeof top.nonce !== 'string' || !SAFE_NONCE.test(top.nonce)) {
      refuse(RECEIPT_V3_REFUSE.GRANT_BINDING, 'the document nonce is not a 32-hex value')
    }
    if (sha256Hex(top.definitionId) === null) {
      refuse(RECEIPT_V3_REFUSE.GRANT_BINDING, 'definitionId is not a sha256')
    }
  }

  // 7. approval:signature — for human-ceremony, the human signature under a
  //    REGISTERED owner key. No owner key exists yet, so this refuses by name
  //    rather than passing a document whose approval nobody can check.
  if (approvalClass === 'human-ceremony') {
    const owners = anchorEntries(ownerPublicKeys)
    if (owners.length === 0 || !anchorsAreCanonical(ownerPublicKeys)) {
      refuse(RECEIPT_V3_REFUSE.OWNER_KEY_UNREGISTERED, 'no owner public key is registered')
    } else {
      const signerKeyId = approvalSnapshot === null ? null : sha256Hex(approvalSnapshot.signerKeyId)
      const owner = signerKeyId === null ? null : findAnchor(ownerPublicKeys, signerKeyId)
      if (signerKeyId === null) {
        refuse(RECEIPT_V3_REFUSE.APPROVAL_SIGNATURE, 'approval.signerKeyId is not a sha256 hex key id')
      } else if (owner === null) {
        refuse(RECEIPT_V3_REFUSE.OWNER_KEY_UNREGISTERED, `no registered owner key has keyId ${signerKeyId}`)
      } else {
        // The approval signature covers `approvalSignedMessage(artifactDigest)`,
        // NOT this document's core. Checking it over the core would be a check
        // that can never pass, which is indistinguishable from a check that is
        // never run.
        const message = Buffer.from(`${APPROVAL_SIGNED_DOMAIN} ${approvalSnapshot.artifactDigest}`, 'utf8')
        if (!signatureHolds(owner.key, message, approvalSnapshot.signature)) {
          refuse(RECEIPT_V3_REFUSE.APPROVAL_SIGNATURE, 'the approval signature does not verify under the named owner key')
        }
      }
    }
    // An owner key on the executor's host is readable by the executor's uid, so
    // class B is the best such a key can be. This is printed, never hidden.
    if (approvalSnapshot !== null && approvalSnapshot.keyClass === 'B') ceiling('OWNER_KEY_SAME_UID')
    ceiling('SIGNER_DEVICE_TRUSTED')
  }

  // 8. approval:challenge — the challenge in the approval must be the challenge
  //    the grant bound. THIS GRANT FAMILY CARRIES NO CHALLENGE. A v4
  //    authorization payload is exactly domain, tool, digest, nonce, exp,
  //    definitionId, operationDigest and receiptKeyId; there is no challenge
  //    field to compare against. So an approval challenge is unbound, and the
  //    verifier says that by name instead of reporting a comparison it cannot
  //    perform. Binding a challenge to the approval is step 3 work.
  if (approvalClass === 'human-ceremony' && approvalSnapshot !== null) {
    const challenge = approvalSnapshot.challenge
    if (typeof challenge !== 'string' || challenge.length === 0) {
      refuse(RECEIPT_V3_REFUSE.APPROVAL_CHALLENGE, 'the approval carries no challenge')
    } else if (payload === null || typeof payload.challenge !== 'string') {
      refuse(RECEIPT_V3_REFUSE.CHALLENGE_UNBOUND,
        'the grant payload carries no challenge, so the approval challenge binds to nothing')
    } else if (payload.challenge !== challenge) {
      refuse(RECEIPT_V3_REFUSE.APPROVAL_CHALLENGE, 'the approval challenge differs from the grant challenge')
    }
  }

  // 10. aura:hash — the embedded entry hashes to the embedded hash, over its
  //     own predecessor and under the record domain.
  let entryCanonical = null
  if (aura === null) {
    refuse(RECEIPT_V3_REFUSE.AURA_HASH, 'the aura block is not an exact field set')
  } else {
    const seq = positiveInteger(aura.seq)
    const prev = typeof aura.prev === 'string' && aura.prev.length > 0 ? aura.prev : null
    const hash = sha256Hex(aura.hash)
    const entry = snapshotPlain(aura.entry)
    if (seq === null || prev === null || hash === null || entry === null) {
      refuse(RECEIPT_V3_REFUSE.AURA_HASH, 'the aura block is missing a seq, prev, hash or entry object')
    } else {
      const body = {}
      for (const key of Object.keys(entry)) {
        if (key === 'hash' || key === 'prev' || key === 'domain') {
          refuse(RECEIPT_V3_REFUSE.AURA_HASH, `the entry body carries the reserved name ${key}`)
          break
        }
        body[key] = entry[key]
      }
      try {
        const recomputed = createHash('sha256')
          .update(canonicalJSONV3({ prev, ...body, domain: AURA_RECORD_DOMAIN }), 'utf8')
          .digest('hex')
        entryCanonical = body
        if (recomputed !== hash) {
          refuse(RECEIPT_V3_REFUSE.AURA_HASH, `recomputed entry hash ${recomputed.slice(0, 16)} differs from aura.hash ${hash.slice(0, 16)}`)
        }
      } catch (error) {
        refuse(error?.message === RECEIPT_V3_REFUSE.NUMBER_NOT_INTEGER
          ? RECEIPT_V3_REFUSE.NUMBER_NOT_INTEGER
          : RECEIPT_V3_REFUSE.AURA_HASH,
        'the entry body is not canonical-JSON data')
      }
    }
  }

  // 11. aura:entry-signature — the ENTRY carries no signature in Deep today.
  //     `readVerifiedChain` authenticates the chain by recomputation only, and
  //     record.mjs says so: no signature binds a body to its producer. This
  //     verifier therefore reports the property it actually measured instead of
  //     inventing a check the document cannot satisfy.
  if (entryCanonical !== null) {
    const hasEntrySignature = typeof entryCanonical.signature === 'string'
    // SAY THIS PLAINLY, because the difference matters to a reader.
    //
    // A HASH AND A SIGNED HEAD STATEMENT ARE NOT AN INDIVIDUAL ENTRY SIGNATURE.
    // The entry carries neither today: `aukora/aura/record.mjs` authenticates
    // the chain by RECOMPUTATION — each entry hashes its predecessor — and its
    // own documentation states that no signature binds a body to its producer.
    // The signed head statement covers the head, not this entry. So the verifier
    // reports exactly which property it measured instead of printing a pass for
    // a check no chain can satisfy.
    lines.push(`MEASURED aura:entry-signature none-present entrySignature=${hasEntrySignature}`
      + ' chainAuthenticated=by-recomputation headStatementCovers=head-only'
      + ' note=an-entry-carries-no-individual-signature-in-this-tree')
    ceiling('SAME_UID_WITNESS')
  }

  // 12. aura:entry-binds-receipt — the entry names this nonce and this receipt digest.
  if (entryCanonical !== null) {
    if (typeof entryCanonical.nonce !== 'string' || entryCanonical.nonce !== top.nonce) {
      refuse(RECEIPT_V3_REFUSE.AURA_ENTRY_BINDS, 'the entry does not name this nonce')
    }
    const digest = entryCanonical.receiptSha256
    if (sha256Hex(digest) === null) {
      refuse(RECEIPT_V3_REFUSE.AURA_ENTRY_BINDS, 'the entry names no receipt digest')
    }
  }

  // 13. head:signature — the head statement verifies, and it is the head the
  //     entry produced. A head for a different seq or hash is a different chain.
  const head = hasExactFields(top.head, ['seq', 'hash', 'at', 'keyId', 'signature'])
  if (head === null) {
    refuse(RECEIPT_V3_REFUSE.HEAD_SIGNATURE, 'the head block is not an exact field set')
  } else {
    if (aura !== null && (head.seq !== aura.seq || head.hash !== aura.hash)) {
      refuse(RECEIPT_V3_REFUSE.HEAD_SIGNATURE,
        `head {seq:${String(head.seq)},hash:${String(head.hash).slice(0, 16)}} does not match the aura entry {seq:${String(aura.seq)},hash:${String(aura.hash).slice(0, 16)}}`)
    }
    if (!Number.isSafeInteger(head.at)) {
      refuse(RECEIPT_V3_REFUSE.HEAD_SIGNATURE, 'head.at is not an integer')
    }
    const headKeyId = sha256Hex(head.keyId)
    if (headKeyId === null) {
      refuse(RECEIPT_V3_REFUSE.HEAD_SIGNATURE, 'head.keyId is not a sha256 hex key id')
    } else {
      const anchor = findAnchor(executorPublicKeys, headKeyId)
      if (anchor === null) {
        refuse(RECEIPT_V3_REFUSE.HEAD_SIGNATURE, `no supplied executor key has keyId ${headKeyId}`)
      } else if (!signatureHolds(anchor.key, headStatementPreimage({
        seq: head.seq, hash: head.hash, at: head.at, keyId: head.keyId,
      }), head.signature)) {
        refuse(RECEIPT_V3_REFUSE.HEAD_SIGNATURE, 'the head statement signature does not verify')
      }
    }
  }

  // 14. effect:observed — the observation is well formed and does not claim a
  //     time after the authority it observed under had already expired.
  //
  //     THE UPPER BOUND IS THE ONE THAT CARRIES MEANING HERE. An observation
  //     taken after the grant expired describes a different act than the one
  //     this document claims. A lower bound against `settledAt` is enforced only
  //     when the document claims to know when settlement happened; a real
  //     settlement does not, so inventing that instant to satisfy a bound would
  //     be the defect, not the fix.
  //
  //     THIS IS NOT A FRESH INSPECTION OF OBJECT BYTES. `observedDigest` is
  //     copied from the v1 receipt's own post-dispatch observation, and the
  //     verifier says so rather than implying it looked at a disk.
  if (effect === null) {
    refuse(RECEIPT_V3_REFUSE.EFFECT_OBSERVED, 'the effect block is not an exact field set')
  } else {
    if (sha256Hex(effect.observedDigest) === null) {
      refuse(RECEIPT_V3_REFUSE.EFFECT_OBSERVED, 'effect.observedDigest is not a sha256')
    }
    if (!Number.isSafeInteger(effect.observedAt)) {
      refuse(RECEIPT_V3_REFUSE.EFFECT_OBSERVED, 'effect.observedAt is not an integer')
    } else if (times !== null) {
      if (Number.isSafeInteger(times.expiresAt) && effect.observedAt > times.expiresAt) {
        refuse(RECEIPT_V3_REFUSE.EFFECT_OBSERVED,
          `effect.observedAt=${effect.observedAt} is after expiresAt=${times.expiresAt}`)
      }
      if (Number.isSafeInteger(times.settledAt) && effect.observedAt < times.settledAt) {
        refuse(RECEIPT_V3_REFUSE.EFFECT_OBSERVED,
          `effect.observedAt=${effect.observedAt} is before settledAt=${times.settledAt}`)
      }
    }
    // Whether the observed bytes are what the approved action committed to is a
    // property of the v1 receipt embedded in the document, not of this field.
  }

  // Delegation embeds its parent by scheme, ref, hash and nonce. Deep has no
  // signed delegation today, so `signed: false` is carried and printed rather
  // than implied away.
  if (approvalClass === 'delegated') {
    const delegation = hasExactFields(top.delegation, ['scheme', 'ref', 'hash', 'parentNonce', 'signed'])
    if (delegation === null) {
      refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS,
        'class=delegated requires exactly scheme, ref, hash, parentNonce, signed')
    } else {
      if (typeof delegation.scheme !== 'string' || delegation.scheme.length === 0) {
        refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, 'delegation.scheme is absent')
      }
      if (typeof delegation.ref !== 'string' || delegation.ref.length === 0) {
        refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, 'delegation.ref is absent')
      }
      if (sha256Hex(delegation.hash) === null) {
        refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, 'delegation.hash is not a sha256')
      }
      if (typeof delegation.parentNonce !== 'string' || !SAFE_NONCE.test(delegation.parentNonce)) {
        refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, 'delegation.parentNonce is not a 32-hex nonce')
      }
      if (delegation.signed === false) ceiling('DELEGATION_UNSIGNED')
      else if (delegation.signed !== true) {
        refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, 'delegation.signed is not a boolean')
      }
    }
  } else if (top.delegation !== null) {
    refuse(RECEIPT_V3_REFUSE.APPROVAL_CLASS, `delegation is present under class=${String(approvalClass)}`)
  }

  // A verbatim publication publishes path, inode, mtime and the confinement
  // record covered by the executor's settlement signature. There is no
  // redacted-and-verified middle, so the ceiling is named.
  if (top.publication === 'verbatim') ceiling('LOCAL_METADATA_DISCLOSED')
  else refuse(RECEIPT_V3_REFUSE.FIELD_SET, `publication=${String(top.publication)} has no profile in v3`)

  for (const name of MEASURED_CEILINGS) ceiling(name)

  const verdict = reasons.length === 0 ? 'CONFORMING' : 'NON-CONFORMING'
  lines.push(`VERDICT ${verdict}`)
  lines.push(`CLASS ${classLine({ approvalClass })}`)
  for (const name of reasons) lines.push(`REASON ${name}`)
  for (const name of ceilings) lines.push(`CEILING ${name}`)
  // ONE FILE IS NOT ONE TRUST ANCHOR. A v3 document names up to three distinct
  // signers, and a recipient must anchor each separately, so the count is printed
  // rather than left for a reader to infer from a claim about portability.
  const anchorRoles = []
  if (anchorsAreCanonical(executorPublicKeys)) anchorRoles.push('executor')
  if (anchorsAreCanonical(issuerPublicKeys)) anchorRoles.push('issuer')
  if (anchorsAreCanonical(ownerPublicKeys)) anchorRoles.push('owner')
  lines.push(`PORTABILITY one-document=true trustedKeySets=${anchorRoles.length}`
    + ` roles=${anchorRoles.join(',') || 'none'}`
    + ' note=one-file-portability-is-not-one-trusted-key')
  lines.push('NOT ESTABLISHED completeness, freshness, absence of a conflicting history, current disk state')
  lines.push('effect.observedDigest is a signed observation taken at settlement, not a fresh inspection')

  return { verdict, reasons, ceilings, approvalClass, lines }
}

/** Exit status a CLI should use for one verdict. */
export const exitStatusFor = (verdict) => verdict === 'CONFORMING' ? 0 : 1
