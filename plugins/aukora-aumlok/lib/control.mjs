/**
 * Hybrid root-control history for one stable AUKORA subject.
 *
 * PORTED FROM Deep `aukora/identity/control.mjs` at
 * `c417f7c5752bf14b8e927986cd995f2e086f4189`: the domain strings, field
 * inventories, transition rules, refusal names and digest preimages are
 * unchanged, so a control head this lane accepts and digests is the same object
 * Deep digests. `scripts/aumlok/PROVENANCE.md` records the port and
 * `tests/aukora-aumlok.test.mjs` measures the digest equality against heads Deep
 * itself computed and signed at that pin.
 *
 * WHAT THIS MODULE IS, AND WHAT IT IS NOT. It is the rare identity-controller
 * transition: epoch, key-set identity, predecessor binding, terminal revocation.
 * It is NOT the action signer. Genesis's Ed25519 action signer
 * (`scripts/composition/ed25519.py`, `scripts/composition/grant.py`) signs grants
 * over exact operation bytes under a registered key; this module signs nothing
 * and authorizes nothing. The two layers meet at exactly one measured point:
 * Deep's `broker-state.admitIdentityControl` requires the action-signing key to
 * equal the active control head's `publicKeys.ed25519`, so the registered
 * approval key IS the Ed25519 half of the root control key. That mapping is the
 * only place the layers are joined, it is measured in the court, and neither
 * layer was changed to make it hold.
 *
 * THE CRYPTOGRAPHIC BOUNDARY, STATED PLAINLY RATHER THAN SKIPPED. This lane's
 * standalone closure carries no curve library — `node:crypto` (OpenSSL) is the
 * vetted Ed25519 primitive, and AGENTS.md forbids a new curve implementation.
 * Two checks Deep performs are therefore not performed here by default:
 *
 *   1. `@noble/curves` rejects Ed25519 public keys that are small-order or
 *      torsion. Parsing here checks length and hex only. That is a *superset* of
 *      Deep's accepted inputs, and it is fail-open, so it is never allowed to
 *      reach a verdict: {@link verifyAndApplyRootControlPromotion} REFUSES unless
 *      a point validator is supplied.
 *   2. `@noble/post-quantum` verifies the ML-DSA-65 half. Nothing in this closure
 *      can, so a promotion REFUSES with a named reason rather than verifying one
 *      half of a two-half signature and calling it verified.
 *
 * Fail-closed on both, by name, so "missing control evidence remains unavailable"
 * is a property of the code and not a sentence in a README.
 *
 * @module @aukora/dsh-plugin-aumlok/control
 */
import { createPublicKey, verify as nodeVerify } from 'node:crypto'
import { canonicalJSON, digestCanonical } from './canonical.mjs'
import { aukoraIdFromGenesis, parseIdentityGenesis } from './genesis.mjs'
import {
  readAukoraId,
  readClosedDataRecord,
  readDigest,
  readNonNegativeInteger,
} from './validation.mjs'

/** The only supported root-control suite. */
export const AUMLOK_ROOT_CONTROL_SUITE = 'aumlok-ed25519-ml-dsa-65-v1'
/** Domain of one serialized control head. */
export const ROOT_CONTROL_STATE_DOMAIN = 'aukora:root-control-state:v1'
/** Domain of one serialized transition authorization. */
export const ROOT_CONTROL_AUTHORIZATION_DOMAIN = 'aukora:root-control-authorization:v1'
/** Domain of one signed transition envelope. */
export const SIGNED_ROOT_CONTROL_PROMOTION_DOMAIN = 'aukora:signed-root-control-promotion:v1'
/** ML-DSA-65 domain separator, identical to Deep's. */
export const AUMLOK_ROOT_CONTROL_CONTEXT = 'aukora-root-control-v1'

const ROOT_KEY_SET_ID_DOMAIN = 'aukora:root-key-set:v1'
const ROOT_CONTROL_DIGEST_DOMAIN = 'aukora:root-control-head:v1'
const ROOT_CONTROL_SIGNATURE_DOMAIN = 'aukora:root-control-signature:v1'
const ED25519_PUBLIC_KEY_HEX_LENGTH = 64
const ED25519_SIGNATURE_HEX_LENGTH = 128
const ML_DSA_65_PUBLIC_KEY_HEX_LENGTH = 3904
const ML_DSA_65_SIGNATURE_HEX_LENGTH = 6618
const LOWER_HEX = /^[0-9a-f]+$/u

const INITIAL_CONTROL_INPUT_FIELDS = Object.freeze(['suite', 'publicKeys', 'authorizedAt'])
const PUBLIC_KEY_FIELDS = Object.freeze(['ed25519', 'mlDsa65'])
const SIGNATURE_FIELDS = Object.freeze(['ed25519', 'mlDsa65'])
const CONTROL_STATE_FIELDS = Object.freeze([
  'domain',
  'suite',
  'subject',
  'epoch',
  'rootKeySetId',
  'publicKeys',
  'authorizedAt',
  'revoked',
  'predecessorControlDigest',
])
const AUTHORIZATION_FIELDS = Object.freeze([
  'domain',
  'suite',
  'subject',
  'predecessorControlDigest',
  'predecessorRootKeySetId',
  'predecessorEpoch',
  'predecessorRevoked',
  'nextRootKeySetId',
  'nextPublicKeys',
  'nextEpoch',
  'nextRevoked',
  'authorizedAt',
  'nonce',
])
const AUTHORIZATION_INPUT_FIELDS = Object.freeze(AUTHORIZATION_FIELDS.filter(field => field !== 'domain'))
const PROMOTION_FIELDS = Object.freeze(['domain', 'suite', 'authorization', 'signatures'])
const PROMOTION_INPUT_FIELDS = Object.freeze(['authorization', 'signatures'])

/** Refusals this lane adds that Deep has no equivalent for. */
export const AUMLOK_CONTROL_REFUSE = Object.freeze({
  ED25519_POINT_VALIDATOR_UNAVAILABLE: 'aumlok:ed25519-point-validator-unavailable',
  ML_DSA_65_VERIFIER_UNAVAILABLE: 'aumlok:ml-dsa-65-verifier-unavailable',
})

/**
 * @typedef {Readonly<{ed25519: string, mlDsa65: string}>} HybridPublicKeysV1
 */

/**
 * The cryptographic capabilities one verification needs.
 *
 * Every member is optional at the type level and every gap is a refusal, never a
 * skipped check. `scripts/aumlok/` and the court supply a `verifyMlDsa65` and a
 * `validateEd25519Point` explicitly, and label them as injected.
 * @typedef {Readonly<{
 *   verifyEd25519?: (publicKeyHex: string, message: Uint8Array, signatureHex: string) => boolean,
 *   validateEd25519Point?: (publicKeyHex: string) => boolean,
 *   verifyMlDsa65?: (publicKeyHex: string, message: Uint8Array, signatureHex: string) => boolean,
 * }>} AumlokVerifierCapabilities
 */

/**
 * The capabilities available from `node:crypto` alone.
 *
 * Real Ed25519 verification (OpenSSL), and deliberately no point validator and
 * no post-quantum verifier: this function does not pretend to have them.
 * @returns {AumlokVerifierCapabilities} Ed25519 verification only.
 */
export function nodeCryptoVerifierCapabilities() {
  return Object.freeze({
    verifyEd25519(publicKeyHex, message, signatureHex) {
      try {
        const key = createPublicKey({
          key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKeyHex, 'hex').toString('base64url') },
          format: 'jwk',
        })
        return nodeVerify(null, message, key, Buffer.from(signatureHex, 'hex'))
      } catch {
        return false
      }
    },
  })
}

/**
 * Derive the identifier of one exact hybrid public-key set.
 *
 * Pure SHA-256 over canonical JSON: no curve arithmetic is involved, so this is
 * one of the parts of the hybrid suite this closure CAN compute exactly.
 * @param {unknown} input - closed Ed25519 and ML-DSA-65 public-key record.
 * @returns {string} domain-separated SHA-256 key-set identifier.
 */
export function rootKeySetId(input) {
  const publicKeys = readPublicKeys(input, 'root public keys')
  return digestCanonical(ROOT_KEY_SET_ID_DOMAIN, { suite: AUMLOK_ROOT_CONTROL_SUITE, publicKeys })
}

/**
 * Create epoch zero for an identity whose genesis commits to this key set.
 * @param {unknown} genesisInput - immutable identity genesis record.
 * @param {unknown} input - exact suite, public keys, and authorization time.
 * @returns {Readonly<Record<string, unknown>>} immutable initial control head.
 */
export function createInitialIdentityControl(genesisInput, input) {
  const genesis = parseIdentityGenesis(genesisInput)
  const fields = readClosedDataRecord(input, INITIAL_CONTROL_INPUT_FIELDS, 'initial root control')
  readSuite(fields.suite, 'initial root control.suite')
  const publicKeys = readPublicKeys(fields.publicKeys, 'initial root control.publicKeys')
  const keySetId = rootKeySetId(publicKeys)
  if (keySetId !== genesis.initialRootKeySetId) {
    throw new TypeError('initial root control: key set does not match identity genesis')
  }
  return freezeControlState({
    subject: aukoraIdFromGenesis(genesis),
    epoch: 0,
    rootKeySetId: keySetId,
    publicKeys,
    authorizedAt: readNonNegativeInteger(fields.authorizedAt, 'initial root control.authorizedAt'),
    revoked: false,
    predecessorControlDigest: null,
  })
}

/**
 * Parse a serialized root-control head.
 * @param {unknown} input - candidate serialized state.
 * @param {AumlokVerifierCapabilities} [capabilities] - supplies `validateEd25519Point` when available.
 * @returns {Readonly<Record<string, unknown>>} detached immutable state.
 */
export function parseIdentityControlState(input, capabilities) {
  const fields = readClosedDataRecord(input, CONTROL_STATE_FIELDS, 'root control state')
  if (fields.domain !== ROOT_CONTROL_STATE_DOMAIN) {
    throw new TypeError(`root control state.domain: must equal ${ROOT_CONTROL_STATE_DOMAIN}`)
  }
  readSuite(fields.suite, 'root control state.suite')
  const publicKeys = readPublicKeys(fields.publicKeys, 'root control state.publicKeys', capabilities)
  const rootId = readDigest(fields.rootKeySetId, 'root control state.rootKeySetId')
  const epoch = readNonNegativeInteger(fields.epoch, 'root control state.epoch')
  const revoked = readBoolean(fields.revoked, 'root control state.revoked')
  const predecessorControlDigest = readNullableDigest(
    fields.predecessorControlDigest,
    'root control state.predecessorControlDigest',
  )
  if (rootKeySetId(publicKeys) !== rootId) {
    throw new TypeError('root control state: key-set identifier mismatch')
  }
  // Epoch zero is the genesis head: it has no predecessor and cannot already be
  // revoked. Every later epoch has a predecessor. Anything else is two claims
  // about one history that cannot both be true.
  if ((epoch === 0) !== (predecessorControlDigest === null) || (epoch === 0 && revoked)) {
    throw new TypeError('root control state: epoch, predecessor, and revocation are incoherent')
  }
  return freezeControlState({
    subject: readAukoraId(fields.subject, 'root control state.subject'),
    epoch,
    rootKeySetId: rootId,
    publicKeys,
    authorizedAt: readNonNegativeInteger(fields.authorizedAt, 'root control state.authorizedAt'),
    revoked,
    predecessorControlDigest,
  })
}

/**
 * Digest one validated root-control head for predecessor binding.
 *
 * This digest is what an epoch's successor names as its predecessor, which is
 * what makes the history a chain rather than a set of heads. It covers every
 * field of the head, so a head cannot be altered without changing the digest its
 * successor committed to — and therefore cannot be altered without invalidating
 * that successor.
 * @param {unknown} input - candidate control state.
 * @param {AumlokVerifierCapabilities} [capabilities] - supplies `validateEd25519Point` when available.
 * @returns {string} domain-separated SHA-256 control-head digest.
 */
export function identityControlDigest(input, capabilities) {
  return digestCanonical(ROOT_CONTROL_DIGEST_DOMAIN, parseIdentityControlState(input, capabilities))
}

/**
 * Create the exact authorization signed by the current hybrid root.
 * @param {unknown} input - closed transition authorization fields.
 * @returns {Readonly<Record<string, unknown>>} immutable authorization.
 */
export function createRootControlAuthorization(input) {
  const fields = readClosedDataRecord(input, AUTHORIZATION_INPUT_FIELDS, 'root control authorization input')
  readSuite(fields.suite, 'root control authorization input.suite')
  return freezeAuthorization({
    subject: readAukoraId(fields.subject, 'root control authorization input.subject'),
    predecessorControlDigest: readDigest(
      fields.predecessorControlDigest,
      'root control authorization input.predecessorControlDigest',
    ),
    predecessorRootKeySetId: readDigest(
      fields.predecessorRootKeySetId,
      'root control authorization input.predecessorRootKeySetId',
    ),
    predecessorEpoch: readNonNegativeInteger(
      fields.predecessorEpoch,
      'root control authorization input.predecessorEpoch',
    ),
    predecessorRevoked: readBoolean(
      fields.predecessorRevoked,
      'root control authorization input.predecessorRevoked',
    ),
    nextRootKeySetId: readDigest(fields.nextRootKeySetId, 'root control authorization input.nextRootKeySetId'),
    nextPublicKeys: readPublicKeys(fields.nextPublicKeys, 'root control authorization input.nextPublicKeys'),
    nextEpoch: readNonNegativeInteger(fields.nextEpoch, 'root control authorization input.nextEpoch'),
    nextRevoked: readBoolean(fields.nextRevoked, 'root control authorization input.nextRevoked'),
    authorizedAt: readNonNegativeInteger(fields.authorizedAt, 'root control authorization input.authorizedAt'),
    nonce: readDigest(fields.nonce, 'root control authorization input.nonce'),
  })
}

/**
 * Parse a serialized root-control authorization.
 * @param {unknown} input - candidate authorization.
 * @returns {Readonly<Record<string, unknown>>} detached immutable authorization.
 */
export function parseRootControlAuthorization(input) {
  const fields = readClosedDataRecord(input, AUTHORIZATION_FIELDS, 'root control authorization')
  if (fields.domain !== ROOT_CONTROL_AUTHORIZATION_DOMAIN) {
    throw new TypeError(`root control authorization.domain: must equal ${ROOT_CONTROL_AUTHORIZATION_DOMAIN}`)
  }
  return createRootControlAuthorization({
    suite: fields.suite,
    subject: fields.subject,
    predecessorControlDigest: fields.predecessorControlDigest,
    predecessorRootKeySetId: fields.predecessorRootKeySetId,
    predecessorEpoch: fields.predecessorEpoch,
    predecessorRevoked: fields.predecessorRevoked,
    nextRootKeySetId: fields.nextRootKeySetId,
    nextPublicKeys: fields.nextPublicKeys,
    nextEpoch: fields.nextEpoch,
    nextRevoked: fields.nextRevoked,
    authorizedAt: fields.authorizedAt,
    nonce: fields.nonce,
  })
}

/**
 * Encode one validated authorization for both required signatures.
 *
 * Both halves sign THESE bytes, in this order, with the domain prefix. That is
 * the exact-bytes contract that makes "verified" mean anything: the verifier
 * re-derives the bytes from the parsed authorization rather than accepting a
 * preimage the signer supplied.
 * @param {unknown} input - candidate root-control authorization.
 * @returns {Buffer} domain-separated canonical signing bytes.
 */
export function rootControlAuthorizationBytes(input) {
  const authorization = parseRootControlAuthorization(input)
  return Buffer.from(`${ROOT_CONTROL_SIGNATURE_DOMAIN}\0${canonicalJSON(authorization)}`, 'utf8')
}

/**
 * Create a signed promotion envelope without signing inside the verifier.
 * @param {unknown} input - exact authorization and hybrid signatures.
 * @returns {Readonly<Record<string, unknown>>} immutable signed envelope.
 */
export function createSignedRootControlPromotion(input) {
  const fields = readClosedDataRecord(input, PROMOTION_INPUT_FIELDS, 'signed root control promotion input')
  return freezePromotion(
    parseRootControlAuthorization(fields.authorization),
    readSignatures(fields.signatures, 'signed root control promotion input.signatures'),
  )
}

/**
 * Parse a serialized signed root-control promotion.
 * @param {unknown} input - candidate signed envelope.
 * @returns {Readonly<Record<string, unknown>>} detached immutable envelope.
 */
export function parseSignedRootControlPromotion(input) {
  const fields = readClosedDataRecord(input, PROMOTION_FIELDS, 'signed root control promotion')
  if (fields.domain !== SIGNED_ROOT_CONTROL_PROMOTION_DOMAIN) {
    throw new TypeError(`signed root control promotion.domain: must equal ${SIGNED_ROOT_CONTROL_PROMOTION_DOMAIN}`)
  }
  readSuite(fields.suite, 'signed root control promotion.suite')
  return freezePromotion(
    parseRootControlAuthorization(fields.authorization),
    readSignatures(fields.signatures, 'signed root control promotion.signatures'),
  )
}

/**
 * Verify and apply one exact next control head.
 *
 * The function is pure. A state owner must compare-and-swap the predecessor
 * digest atomically; this function cannot prevent two concurrent applications.
 *
 * REFUSES rather than half-verifies. A promotion carries two signatures over one
 * preimage and the suite is named for both. With no `validateEd25519Point` it
 * refuses `aumlok:ed25519-point-validator-unavailable`; with no `verifyMlDsa65` it
 * refuses `aumlok:ml-dsa-65-verifier-unavailable`. The structural transition rules
 * run first and keep Deep's own refusal names, so a caller can tell a rule
 * violation from an unavailable primitive.
 *
 * @param {unknown} currentInput - current serialized control head.
 * @param {unknown} promotionInput - signed next-head authorization.
 * @param {AumlokVerifierCapabilities} [capabilities] - cryptographic primitives to use.
 * @returns {Readonly<{ok: true, state: Readonly<Record<string, unknown>>, controlDigest: string} | {ok: false, reason: string}>} verification verdict.
 */
export function verifyAndApplyRootControlPromotion(currentInput, promotionInput, capabilities) {
  let current
  let promotion
  try {
    current = parseIdentityControlState(currentInput)
    promotion = parseSignedRootControlPromotion(promotionInput)
  } catch {
    return refusal('control:malformed')
  }
  const authorization = promotion.authorization
  const predecessorDigest = identityControlDigest(current)
  if (authorization.subject !== current.subject) return refusal('control:subject-mismatch')
  if (authorization.predecessorControlDigest !== predecessorDigest) {
    return refusal('control:predecessor-digest-mismatch')
  }
  if (authorization.predecessorRootKeySetId !== current.rootKeySetId) {
    return refusal('control:predecessor-root-mismatch')
  }
  if (authorization.predecessorEpoch !== current.epoch) return refusal('control:predecessor-epoch-mismatch')
  if (authorization.predecessorRevoked !== current.revoked) {
    return refusal('control:predecessor-revocation-mismatch')
  }
  if (current.revoked) return refusal('control:predecessor-revoked')
  if (rootKeySetId(authorization.nextPublicKeys) !== authorization.nextRootKeySetId) {
    return refusal('control:next-key-set-id-mismatch')
  }
  if (authorization.nextEpoch !== current.epoch + 1) return refusal('control:epoch-not-next')
  if (authorization.authorizedAt <= current.authorizedAt) {
    return refusal('control:authorization-time-not-increasing')
  }
  if (!authorization.nextRevoked && authorization.nextRootKeySetId === current.rootKeySetId) {
    return refusal('control:rotation-key-unchanged')
  }
  if (authorization.nextRevoked && authorization.nextRootKeySetId !== current.rootKeySetId) {
    return refusal('control:revocation-key-changed')
  }
  // ── the cryptographic boundary ────────────────────────────────────────────────
  // Nothing below this line is optional. A gap is a named refusal.
  const validatePoint = capabilities?.validateEd25519Point
  if (typeof validatePoint !== 'function') {
    return refusal(AUMLOK_CONTROL_REFUSE.ED25519_POINT_VALIDATOR_UNAVAILABLE)
  }
  if (!validatePoint(current.publicKeys.ed25519) || !validatePoint(authorization.nextPublicKeys.ed25519)) {
    return refusal('control:ed25519-public-key-invalid')
  }
  const verifyEd25519 = capabilities?.verifyEd25519
  if (typeof verifyEd25519 !== 'function') {
    return refusal('aumlok:ed25519-verifier-unavailable')
  }
  const message = rootControlAuthorizationBytes(authorization)
  if (!verifyEd25519(current.publicKeys.ed25519, message, promotion.signatures.ed25519)) {
    return refusal('control:ed25519-signature-invalid')
  }
  const verifyMlDsa65 = capabilities?.verifyMlDsa65
  if (typeof verifyMlDsa65 !== 'function') {
    return refusal(AUMLOK_CONTROL_REFUSE.ML_DSA_65_VERIFIER_UNAVAILABLE)
  }
  if (!verifyMlDsa65(current.publicKeys.mlDsa65, message, promotion.signatures.mlDsa65)) {
    return refusal('control:ml-dsa-65-signature-invalid')
  }
  const state = freezeControlState({
    subject: current.subject,
    epoch: authorization.nextEpoch,
    rootKeySetId: authorization.nextRootKeySetId,
    publicKeys: authorization.nextPublicKeys,
    authorizedAt: authorization.authorizedAt,
    revoked: authorization.nextRevoked,
    predecessorControlDigest: predecessorDigest,
  })
  return Object.freeze({ ok: true, state, controlDigest: identityControlDigest(state) })
}

/** One named refusal. */
function refusal(reason) {
  return Object.freeze({ ok: false, reason })
}

/** Read the suite, which must be the only supported one. */
function readSuite(value, label) {
  if (value !== AUMLOK_ROOT_CONTROL_SUITE) {
    throw new TypeError(`${label}: must equal ${AUMLOK_ROOT_CONTROL_SUITE}`)
  }
  return value
}

/** Read one boolean. */
function readBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label}: must be a boolean`)
  return value
}

/** Read one fixed-length lowercase-hex string. */
function readLowerHex(value, length, label) {
  if (typeof value !== 'string' || value.length !== length || !LOWER_HEX.test(value)) {
    throw new TypeError(`${label}: must be ${String(length)} lowercase hexadecimal characters`)
  }
  return value
}

/** Read a digest or an explicit null. */
function readNullableDigest(value, label) {
  return value === null ? null : readDigest(value, label)
}

/**
 * Read one hybrid public-key record.
 *
 * Without `capabilities.validateEd25519Point` the Ed25519 half is checked for
 * length and hex only; Deep additionally rejects small-order and torsion points
 * via `@noble/curves`. See the module comment and the lane ceiling
 * `ED25519_POINT_UNVALIDATED`.
 * @param {unknown} value - candidate public-key record.
 * @param {string} label - diagnostic subject.
 * @param {AumlokVerifierCapabilities} [capabilities] - supplies `validateEd25519Point` when available.
 * @returns {HybridPublicKeysV1} frozen public keys.
 */
function readPublicKeys(value, label, capabilities) {
  const fields = readClosedDataRecord(value, PUBLIC_KEY_FIELDS, label)
  const ed25519 = readLowerHex(fields.ed25519, ED25519_PUBLIC_KEY_HEX_LENGTH, `${label}.ed25519`)
  const validatePoint = capabilities?.validateEd25519Point
  if (typeof validatePoint === 'function' && !validatePoint(ed25519)) {
    throw new TypeError(`${label}.ed25519: must encode a prime-order Ed25519 point`)
  }
  return Object.freeze({
    ed25519,
    mlDsa65: readLowerHex(fields.mlDsa65, ML_DSA_65_PUBLIC_KEY_HEX_LENGTH, `${label}.mlDsa65`),
  })
}

/** Read one hybrid signature record. */
function readSignatures(value, label) {
  const fields = readClosedDataRecord(value, SIGNATURE_FIELDS, label)
  return Object.freeze({
    ed25519: readLowerHex(fields.ed25519, ED25519_SIGNATURE_HEX_LENGTH, `${label}.ed25519`),
    mlDsa65: readLowerHex(fields.mlDsa65, ML_DSA_65_SIGNATURE_HEX_LENGTH, `${label}.mlDsa65`),
  })
}

/** Freeze one control head into its canonical field order. */
function freezeControlState(record) {
  return Object.freeze({
    domain: ROOT_CONTROL_STATE_DOMAIN,
    suite: AUMLOK_ROOT_CONTROL_SUITE,
    subject: record.subject,
    epoch: record.epoch,
    rootKeySetId: record.rootKeySetId,
    publicKeys: record.publicKeys,
    authorizedAt: record.authorizedAt,
    revoked: record.revoked,
    predecessorControlDigest: record.predecessorControlDigest,
  })
}

/** Freeze one authorization into its canonical field order. */
function freezeAuthorization(record) {
  return Object.freeze({
    domain: ROOT_CONTROL_AUTHORIZATION_DOMAIN,
    suite: AUMLOK_ROOT_CONTROL_SUITE,
    subject: record.subject,
    predecessorControlDigest: record.predecessorControlDigest,
    predecessorRootKeySetId: record.predecessorRootKeySetId,
    predecessorEpoch: record.predecessorEpoch,
    predecessorRevoked: record.predecessorRevoked,
    nextRootKeySetId: record.nextRootKeySetId,
    nextPublicKeys: record.nextPublicKeys,
    nextEpoch: record.nextEpoch,
    nextRevoked: record.nextRevoked,
    authorizedAt: record.authorizedAt,
    nonce: record.nonce,
  })
}

/** Freeze one signed promotion envelope. */
function freezePromotion(authorization, signatures) {
  return Object.freeze({
    domain: SIGNED_ROOT_CONTROL_PROMOTION_DOMAIN,
    suite: AUMLOK_ROOT_CONTROL_SUITE,
    authorization,
    signatures,
  })
}
