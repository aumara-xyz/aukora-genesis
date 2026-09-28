/**
 * Hybrid root-control history for one stable AUKORA subject.
 *
 * The module verifies rare identity-controller rotations and terminal
 * revocation. It does not issue action grants or expose recovery material.
 *
 * @module @aukora/identity/control
 */
import { createHash } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { aukoraIdFromGenesis, parseIdentityGenesis } from './genesis.mjs'
import {
  readAukoraId,
  readClosedDataRecord,
  readDigest,
  readNonNegativeInteger,
} from './validation.mjs'

export const AUMLOK_ROOT_CONTROL_SUITE = 'aumlok-ed25519-ml-dsa-65-v1'
export const ROOT_CONTROL_STATE_DOMAIN = 'aukora:root-control-state:v1'
export const ROOT_CONTROL_AUTHORIZATION_DOMAIN = 'aukora:root-control-authorization:v1'
export const SIGNED_ROOT_CONTROL_PROMOTION_DOMAIN = 'aukora:signed-root-control-promotion:v1'
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

/** @typedef {{ed25519: string, mlDsa65: string}} HybridPublicKeysV1 */
/** @typedef {{ed25519: string, mlDsa65: string}} HybridSignaturesV1 */
/** @typedef {{domain: string, suite: string, subject: string, epoch: number, rootKeySetId: string, publicKeys: HybridPublicKeysV1, authorizedAt: number, revoked: boolean, predecessorControlDigest: string | null}} RootControlStateV1 */
/** @typedef {{domain: string, suite: string, subject: string, predecessorControlDigest: string, predecessorRootKeySetId: string, predecessorEpoch: number, predecessorRevoked: boolean, nextRootKeySetId: string, nextPublicKeys: HybridPublicKeysV1, nextEpoch: number, nextRevoked: boolean, authorizedAt: number, nonce: string}} RootControlAuthorizationV1 */
/** @typedef {{domain: string, suite: string, authorization: RootControlAuthorizationV1, signatures: HybridSignaturesV1}} SignedRootControlPromotionV1 */

function digestCanonical(domain, value) {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(canonicalJSON(value), 'utf8')
    .digest('hex')
}

function readSuite(value, label) {
  if (value !== AUMLOK_ROOT_CONTROL_SUITE) {
    throw new TypeError(`${label}: must equal ${AUMLOK_ROOT_CONTROL_SUITE}`)
  }
  return value
}

function readBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label}: must be a boolean`)
  return value
}

function readLowerHex(value, length, label) {
  if (typeof value !== 'string' || value.length !== length || !LOWER_HEX.test(value)) {
    throw new TypeError(`${label}: must be ${length} lowercase hexadecimal characters`)
  }
  return value
}

function readEd25519PublicKey(value, label) {
  const encoded = readLowerHex(value, ED25519_PUBLIC_KEY_HEX_LENGTH, label)
  let point
  try {
    point = ed25519.Point.fromBytes(Buffer.from(encoded, 'hex'), false)
  } catch {
    throw new TypeError(`${label}: must encode a prime-order Ed25519 point`)
  }
  if (point.isSmallOrder() || !point.isTorsionFree()) {
    throw new TypeError(`${label}: must encode a prime-order Ed25519 point`)
  }
  return encoded
}

function readNullableDigest(value, label) {
  return value === null ? null : readDigest(value, label)
}

function readPublicKeys(value, label) {
  const fields = readClosedDataRecord(value, PUBLIC_KEY_FIELDS, label)
  return Object.freeze({
    ed25519: readEd25519PublicKey(fields.ed25519, `${label}.ed25519`),
    mlDsa65: readLowerHex(fields.mlDsa65, ML_DSA_65_PUBLIC_KEY_HEX_LENGTH, `${label}.mlDsa65`),
  })
}

function readSignatures(value, label) {
  const fields = readClosedDataRecord(value, SIGNATURE_FIELDS, label)
  return Object.freeze({
    ed25519: readLowerHex(fields.ed25519, ED25519_SIGNATURE_HEX_LENGTH, `${label}.ed25519`),
    mlDsa65: readLowerHex(fields.mlDsa65, ML_DSA_65_SIGNATURE_HEX_LENGTH, `${label}.mlDsa65`),
  })
}

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

function freezePromotion(authorization, signatures) {
  return Object.freeze({
    domain: SIGNED_ROOT_CONTROL_PROMOTION_DOMAIN,
    suite: AUMLOK_ROOT_CONTROL_SUITE,
    authorization,
    signatures,
  })
}

/**
 * Derive the identifier of one exact hybrid public-key set.
 * @param {unknown} input - closed Ed25519 and ML-DSA-65 public-key record.
 * @returns {string} domain-separated SHA-256 key-set identifier.
 */
export function rootKeySetId(input) {
  const publicKeys = readPublicKeys(input, 'root public keys')
  return digestCanonical(ROOT_KEY_SET_ID_DOMAIN, {
    suite: AUMLOK_ROOT_CONTROL_SUITE,
    publicKeys,
  })
}

/**
 * Create epoch zero for an identity whose genesis commits to this key set.
 * @param {unknown} genesisInput - immutable identity genesis record.
 * @param {unknown} input - exact suite, public keys, and authorization time.
 * @returns {Readonly<RootControlStateV1>} immutable initial control head.
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
 * @returns {Readonly<RootControlStateV1>} detached immutable state.
 */
export function parseIdentityControlState(input) {
  const fields = readClosedDataRecord(input, CONTROL_STATE_FIELDS, 'root control state')
  if (fields.domain !== ROOT_CONTROL_STATE_DOMAIN) {
    throw new TypeError(`root control state.domain: must equal ${ROOT_CONTROL_STATE_DOMAIN}`)
  }
  readSuite(fields.suite, 'root control state.suite')
  const publicKeys = readPublicKeys(fields.publicKeys, 'root control state.publicKeys')
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
 * @param {unknown} input - candidate control state.
 * @returns {string} domain-separated SHA-256 control-head digest.
 */
export function identityControlDigest(input) {
  return digestCanonical(ROOT_CONTROL_DIGEST_DOMAIN, parseIdentityControlState(input))
}

/**
 * Create the exact authorization signed by the current hybrid root.
 * @param {unknown} input - closed transition authorization fields.
 * @returns {Readonly<RootControlAuthorizationV1>} immutable authorization.
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
 * @returns {Readonly<RootControlAuthorizationV1>} detached immutable authorization.
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
 * @param {unknown} input - candidate root-control authorization.
 * @returns {Uint8Array} domain-separated canonical signing bytes.
 */
export function rootControlAuthorizationBytes(input) {
  const authorization = parseRootControlAuthorization(input)
  return Buffer.from(`${ROOT_CONTROL_SIGNATURE_DOMAIN}\0${canonicalJSON(authorization)}`, 'utf8')
}

/**
 * Create a signed promotion envelope without signing inside the verifier.
 * @param {unknown} input - exact authorization and hybrid signatures.
 * @returns {Readonly<SignedRootControlPromotionV1>} immutable signed envelope.
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
 * @returns {Readonly<SignedRootControlPromotionV1>} detached immutable envelope.
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

function verifyEd25519(publicKey, message, signature) {
  return ed25519.verify(
    Buffer.from(signature, 'hex'),
    message,
    Buffer.from(publicKey, 'hex'),
    { zip215: false },
  )
}

function verifyMlDsa65(publicKey, message, signature) {
  return ml_dsa65.verify(
    Buffer.from(signature, 'hex'),
    message,
    Buffer.from(publicKey, 'hex'),
    { context: Buffer.from(AUMLOK_ROOT_CONTROL_CONTEXT, 'utf8') },
  )
}

/**
 * Verify and apply one exact next control head.
 *
 * The function is pure. A state owner must compare-and-swap the predecessor
 * digest atomically; this function cannot prevent two concurrent applications.
 *
 * @param {unknown} currentInput - current serialized control head.
 * @param {unknown} promotionInput - signed next-head authorization.
 * @returns {Readonly<{ok: true, state: Readonly<RootControlStateV1>, controlDigest: string} | {ok: false, reason: string}>} verification verdict.
 */
export function verifyAndApplyRootControlPromotion(currentInput, promotionInput) {
  let current
  let promotion
  try {
    current = parseIdentityControlState(currentInput)
    promotion = parseSignedRootControlPromotion(promotionInput)
  } catch {
    return Object.freeze({ ok: false, reason: 'control:malformed' })
  }
  const authorization = promotion.authorization
  const predecessorDigest = identityControlDigest(current)
  if (authorization.subject !== current.subject) {
    return Object.freeze({ ok: false, reason: 'control:subject-mismatch' })
  }
  if (authorization.predecessorControlDigest !== predecessorDigest) {
    return Object.freeze({ ok: false, reason: 'control:predecessor-digest-mismatch' })
  }
  if (authorization.predecessorRootKeySetId !== current.rootKeySetId) {
    return Object.freeze({ ok: false, reason: 'control:predecessor-root-mismatch' })
  }
  if (authorization.predecessorEpoch !== current.epoch) {
    return Object.freeze({ ok: false, reason: 'control:predecessor-epoch-mismatch' })
  }
  if (authorization.predecessorRevoked !== current.revoked) {
    return Object.freeze({ ok: false, reason: 'control:predecessor-revocation-mismatch' })
  }
  if (current.revoked) return Object.freeze({ ok: false, reason: 'control:predecessor-revoked' })
  if (rootKeySetId(authorization.nextPublicKeys) !== authorization.nextRootKeySetId) {
    return Object.freeze({ ok: false, reason: 'control:next-key-set-id-mismatch' })
  }
  if (authorization.nextEpoch !== current.epoch + 1) {
    return Object.freeze({ ok: false, reason: 'control:epoch-not-next' })
  }
  if (authorization.authorizedAt <= current.authorizedAt) {
    return Object.freeze({ ok: false, reason: 'control:authorization-time-not-increasing' })
  }
  if (!authorization.nextRevoked && authorization.nextRootKeySetId === current.rootKeySetId) {
    return Object.freeze({ ok: false, reason: 'control:rotation-key-unchanged' })
  }
  if (authorization.nextRevoked && authorization.nextRootKeySetId !== current.rootKeySetId) {
    return Object.freeze({ ok: false, reason: 'control:revocation-key-changed' })
  }
  const message = rootControlAuthorizationBytes(authorization)
  if (!verifyEd25519(current.publicKeys.ed25519, message, promotion.signatures.ed25519)) {
    return Object.freeze({ ok: false, reason: 'control:ed25519-signature-invalid' })
  }
  if (!verifyMlDsa65(current.publicKeys.mlDsa65, message, promotion.signatures.mlDsa65)) {
    return Object.freeze({ ok: false, reason: 'control:ml-dsa-65-signature-invalid' })
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
