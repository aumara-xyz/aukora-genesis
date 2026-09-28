/**
 * Subject-bound action grants over one immediate attenuated delegation.
 *
 * V5 is a separate domain from v3 and v4. It binds the stable AUKORA subject,
 * active control head, immediate parent and agent-delegation digests,
 * activation, audience, resource, and one-call budget into the signature.
 *
 * @module @aukora/host-dsh/grant-v5
 */
import {
  createHash,
  verify as edVerify,
} from 'node:crypto'
import { canonicalJSON } from '../../kernel-seed/canonical-json.mjs'
import {
  delegationClaimDigest,
  parseDelegationClaim,
  verifyDelegationAttenuation,
} from '../../identity/delegation.mjs'
import {
  readAukoraId,
  readClosedDataRecord,
  readDigest,
  readExactAtom,
  readNonNegativeInteger,
} from '../../identity/validation.mjs'
import {
  canonicalEd25519PublicKey,
  payloadDigest,
  REFUSE,
} from './grant.mjs'

export const GRANT_DOMAIN_V5 = 'aukora:tool-grant:v5'

/** One v5 action grant remains bounded to one hour. */
export const MAX_TTL_SECONDS_V5 = 3600

const SAFE_NONCE = /^[A-Za-z0-9_-]{1,128}$/u
const BUDGET_KEYS = Object.freeze(['calls', 'bytes', 'computeMs', 'costMicrounits'])

/** Exact unsigned fields covered by one v5 signature. */
export const AUTHORIZATION_V5_CLAIM_KEYS = Object.freeze([
  'toolName',
  'digest',
  'nonce',
  'exp',
  'definitionId',
  'operationDigest',
  'receiptKeyId',
  'subject',
  'parentDigest',
  'delegationDigest',
  'controlDigest',
  'delegationKind',
  'activationDigest',
  'audience',
  'resource',
  'budget',
])

/** Exact serialized v5 artifact fields. */
export const GRANT_V5_KEYS = Object.freeze([...AUTHORIZATION_V5_CLAIM_KEYS, 'signature'])

/** Named v5 refusals in addition to the shared action-grant vocabulary. */
export const REFUSE_V5 = Object.freeze({
  ...REFUSE,
  SUBJECT_MISMATCH: 'grant:subject-mismatch',
  PARENT_MISMATCH: 'grant:parent-mismatch',
  DELEGATION_MISMATCH: 'grant:delegation-mismatch',
  CONTROL_MISMATCH: 'grant:control-mismatch',
  ROLE_MISMATCH: 'grant:delegation-role-mismatch',
  ACTIVATION_MISMATCH: 'grant:activation-mismatch',
  AUDIENCE_MISMATCH: 'grant:audience-mismatch',
  RESOURCE_MISMATCH: 'grant:resource-mismatch',
  DELEGATION_MALFORMED: 'grant:delegation-malformed',
  DELEGATION_INVALID: 'grant:delegation-invalid',
  DELEGATION_OPERATION_DENIED: 'grant:delegation-operation-denied',
  DELEGATION_RESOURCE_DENIED: 'grant:delegation-resource-denied',
  DELEGATION_AUDIENCE_DENIED: 'grant:delegation-audience-denied',
  DELEGATION_ACTIVATION_DENIED: 'grant:delegation-activation-denied',
  DELEGATION_NOT_YET_VALID: 'grant:delegation-not-yet-valid',
  DELEGATION_EXPIRED: 'grant:delegation-expired',
  GRANT_OUTLIVES_DELEGATION: 'grant:outlives-delegation',
  BUDGET_MALFORMED: 'grant:budget-malformed',
  BUDGET_MISMATCH: 'grant:budget-mismatch',
  BUDGET_CALLS_EXCEEDED: 'grant:budget-calls-exceeded',
  BUDGET_BYTES_EXCEEDED: 'grant:budget-bytes-exceeded',
  BUDGET_COMPUTE_EXCEEDED: 'grant:budget-compute-exceeded',
  BUDGET_COST_EXCEEDED: 'grant:budget-cost-exceeded',
})

/** Private association for the exact v5 claim set approved by signature verification. */
const verifiedClaims = new WeakMap()

function refusal(reason) {
  return Object.freeze({ ok: false, reason })
}

function readBudget(value, label) {
  const fields = readClosedDataRecord(value, BUDGET_KEYS, label)
  return Object.freeze({
    calls: readNonNegativeInteger(fields.calls, `${label}.calls`),
    bytes: readNonNegativeInteger(fields.bytes, `${label}.bytes`),
    computeMs: readNonNegativeInteger(fields.computeMs, `${label}.computeMs`),
    costMicrounits: readNonNegativeInteger(fields.costMicrounits, `${label}.costMicrounits`),
  })
}

function parseAuthorizationClaims(value, label) {
  const fields = readClosedDataRecord(value, AUTHORIZATION_V5_CLAIM_KEYS, label)
  if (typeof fields.toolName !== 'string' || fields.toolName === '') {
    throw new TypeError(`${label}.toolName: must be a non-empty string`)
  }
  if (typeof fields.nonce !== 'string' || !SAFE_NONCE.test(fields.nonce)) {
    throw new TypeError(`${label}.nonce: malformed`)
  }
  if (!Number.isSafeInteger(fields.exp)) throw new TypeError(`${label}.exp: malformed`)
  return Object.freeze({
    toolName: fields.toolName,
    digest: readDigest(fields.digest, `${label}.digest`),
    nonce: fields.nonce,
    exp: fields.exp,
    definitionId: readDigest(fields.definitionId, `${label}.definitionId`),
    operationDigest: readDigest(fields.operationDigest, `${label}.operationDigest`),
    receiptKeyId: readDigest(fields.receiptKeyId, `${label}.receiptKeyId`),
    subject: readAukoraId(fields.subject, `${label}.subject`),
    parentDigest: readDigest(fields.parentDigest, `${label}.parentDigest`),
    delegationDigest: readDigest(fields.delegationDigest, `${label}.delegationDigest`),
    controlDigest: readDigest(fields.controlDigest, `${label}.controlDigest`),
    delegationKind: readExactAtom(fields.delegationKind, `${label}.delegationKind`, 16),
    activationDigest: readDigest(fields.activationDigest, `${label}.activationDigest`),
    audience: readExactAtom(fields.audience, `${label}.audience`, 256),
    resource: readExactAtom(fields.resource, `${label}.resource`, 256),
    budget: readBudget(fields.budget, `${label}.budget`),
  })
}

function claimsFromGrant(grant) {
  const claims = {}
  for (const key of AUTHORIZATION_V5_CLAIM_KEYS) claims[key] = grant[key]
  return claims
}

function equalBudget(left, right) {
  return BUDGET_KEYS.every(key => left[key] === right[key])
}

function attenuationRefusal(reason) {
  switch (reason) {
    case 'delegation:subject-mismatch': return REFUSE_V5.SUBJECT_MISMATCH
    case 'delegation:control-mismatch': return REFUSE_V5.CONTROL_MISMATCH
    case 'delegation:parent-mismatch': return REFUSE_V5.PARENT_MISMATCH
    case 'delegation:role-transition-invalid': return REFUSE_V5.ROLE_MISMATCH
    case 'delegation:malformed': return REFUSE_V5.DELEGATION_MALFORMED
    default: return REFUSE_V5.DELEGATION_INVALID
  }
}

function budgetRefusal(claimBudget, actionBudget) {
  if (actionBudget.calls !== 1 || actionBudget.calls > claimBudget.calls) {
    return REFUSE_V5.BUDGET_CALLS_EXCEEDED
  }
  if (actionBudget.bytes > claimBudget.bytes) return REFUSE_V5.BUDGET_BYTES_EXCEEDED
  if (actionBudget.computeMs > claimBudget.computeMs) return REFUSE_V5.BUDGET_COMPUTE_EXCEEDED
  if (actionBudget.costMicrounits > claimBudget.costMicrounits) return REFUSE_V5.BUDGET_COST_EXCEEDED
  return null
}

/**
 * Check one unsigned claim set against an exact immediate delegation and action.
 *
 * This check grants no authority. The issuer signs only the digest of a claim
 * set that passed it, and the broker repeats it immediately before settlement.
 *
 * @param {object} params - candidate claims and every launch-owned expectation.
 * @returns {Readonly<{ok: true, claims: object, authority: object} | {ok: false, reason: string}>} verdict.
 */
export function inspectAuthorizationClaimsV5(params) {
  let claims
  let parent
  let delegation
  let expectedBudget
  let expectedSubject
  let expectedControlDigest
  let expectedParentDigest
  let expectedActivationDigest
  let expectedAudience
  let expectedResource
  try {
    claims = parseAuthorizationClaims(params?.claims, 'v5 authorization')
  } catch {
    return refusal(REFUSE.MALFORMED)
  }
  try {
    parent = parseDelegationClaim(params?.parentDelegationClaim)
    delegation = parseDelegationClaim(params?.delegationClaim)
  } catch {
    return refusal(REFUSE_V5.DELEGATION_MALFORMED)
  }
  try {
    expectedBudget = readBudget(params?.expectedBudget, 'v5 expected budget')
  } catch {
    return refusal(REFUSE_V5.BUDGET_MALFORMED)
  }
  try {
    expectedSubject = readAukoraId(params?.expectedSubject, 'v5 expected subject')
    expectedControlDigest = readDigest(params?.expectedControlDigest, 'v5 expected control digest')
    expectedParentDigest = readDigest(params?.expectedParentDigest, 'v5 expected parent digest')
    expectedActivationDigest = readDigest(params?.expectedActivationDigest, 'v5 expected activation digest')
    expectedAudience = readExactAtom(params?.expectedAudience, 'v5 expected audience', 256)
    expectedResource = readExactAtom(params?.expectedResource, 'v5 expected resource', 256)
  } catch {
    return refusal(REFUSE.MALFORMED)
  }
  if (!Number.isSafeInteger(params?.now)) return refusal(REFUSE.MALFORMED)
  if (typeof params?.toolName !== 'string' || params.toolName === '') return refusal(REFUSE.TOOL_MISMATCH)
  if (typeof params?.expectedDefinitionId !== 'string') return refusal(REFUSE.DEFINITION_MISMATCH)
  if (typeof params?.expectedOperationDigest !== 'string') return refusal(REFUSE.NO_OPERATION_BOUND)
  if (typeof params?.expectedReceiptKeyId !== 'string') return refusal(REFUSE.NO_RECEIPT_KEY_BOUND)

  const attenuation = verifyDelegationAttenuation(parent, delegation, {
    subject: expectedSubject,
    controlDigest: expectedControlDigest,
  })
  if (!attenuation.ok) return refusal(attenuationRefusal(attenuation.reason))
  if (parent.kind !== 'session' || delegation.kind !== 'agent') return refusal(REFUSE_V5.ROLE_MISMATCH)
  if (claims.delegationKind !== 'agent') return refusal(REFUSE_V5.ROLE_MISMATCH)
  if (delegation.parentDigest !== expectedParentDigest) return refusal(REFUSE_V5.PARENT_MISMATCH)
  if (claims.subject !== expectedSubject || delegation.subject !== expectedSubject) {
    return refusal(REFUSE_V5.SUBJECT_MISMATCH)
  }
  if (claims.controlDigest !== expectedControlDigest || delegation.controlDigest !== expectedControlDigest) {
    return refusal(REFUSE_V5.CONTROL_MISMATCH)
  }
  if (claims.parentDigest !== expectedParentDigest) return refusal(REFUSE_V5.PARENT_MISMATCH)
  if (claims.delegationDigest !== delegationClaimDigest(delegation)) {
    return refusal(REFUSE_V5.DELEGATION_MISMATCH)
  }
  if (claims.activationDigest !== expectedActivationDigest) return refusal(REFUSE_V5.ACTIVATION_MISMATCH)
  if (claims.audience !== expectedAudience) return refusal(REFUSE_V5.AUDIENCE_MISMATCH)
  if (claims.resource !== expectedResource) return refusal(REFUSE_V5.RESOURCE_MISMATCH)
  if (!equalBudget(claims.budget, expectedBudget)) return refusal(REFUSE_V5.BUDGET_MISMATCH)

  if (!delegation.operations.includes(params.toolName)) {
    return refusal(REFUSE_V5.DELEGATION_OPERATION_DENIED)
  }
  if (!delegation.resources.includes(expectedResource)) return refusal(REFUSE_V5.DELEGATION_RESOURCE_DENIED)
  if (!delegation.audiences.includes(expectedAudience)) return refusal(REFUSE_V5.DELEGATION_AUDIENCE_DENIED)
  if (!delegation.activationDigests.includes(expectedActivationDigest)) {
    return refusal(REFUSE_V5.DELEGATION_ACTIVATION_DENIED)
  }
  const exceeded = budgetRefusal(delegation.budgets, expectedBudget)
  if (exceeded !== null) return refusal(exceeded)

  const nowSeconds = Math.floor(params.now / 1000)
  if (nowSeconds < delegation.notBefore) return refusal(REFUSE_V5.DELEGATION_NOT_YET_VALID)
  if (nowSeconds >= delegation.expiresAt) return refusal(REFUSE_V5.DELEGATION_EXPIRED)
  if (claims.exp > delegation.expiresAt) return refusal(REFUSE_V5.GRANT_OUTLIVES_DELEGATION)

  if (claims.toolName !== params.toolName) return refusal(REFUSE.TOOL_MISMATCH)
  if (claims.digest !== payloadDigest(params.toolName, params.args)) return refusal(REFUSE.PAYLOAD_MISMATCH)
  if (claims.definitionId !== params.expectedDefinitionId) return refusal(REFUSE.DEFINITION_MISMATCH)
  if (claims.operationDigest !== params.expectedOperationDigest) return refusal(REFUSE.OPERATION_MISMATCH)
  if (claims.receiptKeyId !== params.expectedReceiptKeyId) return refusal(REFUSE.RECEIPT_KEY_MISMATCH)
  if (claims.exp * 1000 <= params.now) return refusal(REFUSE.EXPIRED)
  if (claims.exp > nowSeconds + MAX_TTL_SECONDS_V5) return refusal(REFUSE.TTL_UNBOUNDED)

  return Object.freeze({
    ok: true,
    claims,
    authority: Object.freeze({
      grantDomain: GRANT_DOMAIN_V5,
      subject: claims.subject,
      parentDigest: claims.parentDigest,
      delegationDigest: claims.delegationDigest,
      controlDigest: claims.controlDigest,
      activationDigest: claims.activationDigest,
      audience: claims.audience,
      resource: claims.resource,
      budget: claims.budget,
      authorizationDigest: authorizationDigestV5(claims),
    }),
  })
}

/**
 * Return the exact canonical v5 preimage.
 * @param {unknown} claims - exact closed unsigned claims.
 * @returns {Buffer} canonical UTF-8 bytes.
 */
export function authorizationPreimageV5(claims) {
  const exact = parseAuthorizationClaims(claims, 'v5 authorization')
  return Buffer.from(canonicalJSON({ domain: GRANT_DOMAIN_V5, ...exact }), 'utf8')
}

/**
 * Hash one closed v5 claim set for broker-to-issuer transport.
 * @param {unknown} claims - exact closed unsigned claims.
 * @returns {string} lowercase SHA-256 digest.
 */
export function authorizationDigestV5(claims) {
  return createHash('sha256').update(authorizationPreimageV5(claims)).digest('hex')
}

/**
 * Build the domain-separated bytes the root signs for v5.
 * @param {string} digest - lowercase authorization digest.
 * @returns {Buffer} tagged signed message.
 */
export function authorizationSignedMessageV5FromHex(digest) {
  const exact = readDigest(digest, 'v5 authorization digest')
  return Buffer.concat([Buffer.from(`${GRANT_DOMAIN_V5}\0`, 'utf8'), Buffer.from(exact, 'hex')])
}

function verifyArtifact(params) {
  if (!params?.rootPublicKeyPem) return refusal(REFUSE.NO_ROOT)
  if (!params?.grant) return refusal(REFUSE.NO_GRANT)
  let fields
  let signatureBytes
  try {
    fields = readClosedDataRecord(params.grant, GRANT_V5_KEYS, 'v5 grant')
    if (typeof fields.signature !== 'string') throw new TypeError('v5 grant.signature: malformed')
    signatureBytes = Buffer.from(fields.signature, 'base64')
    if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== fields.signature) {
      throw new TypeError('v5 grant.signature: malformed')
    }
  } catch {
    return refusal(REFUSE.MALFORMED)
  }
  const inspected = inspectAuthorizationClaimsV5({
    ...params,
    claims: claimsFromGrant(fields),
  })
  if (!inspected.ok) return inspected
  const root = canonicalEd25519PublicKey(params.rootPublicKeyPem)
  if (root === null) return refusal(REFUSE.ROOT_KEY_TYPE)
  let signatureValid = false
  try {
    signatureValid = edVerify(
      null,
      authorizationSignedMessageV5FromHex(authorizationDigestV5(inspected.claims)),
      root,
      signatureBytes,
    )
  } catch {
    return refusal(REFUSE.BAD_SIGNATURE)
  }
  if (!signatureValid) return refusal(REFUSE.BAD_SIGNATURE)
  const verified = Object.freeze({
    ok: true,
    digest: inspected.claims.digest,
    operationDigest: inspected.claims.operationDigest,
    receiptKeyId: inspected.claims.receiptKeyId,
    authority: inspected.authority,
  })
  verifiedClaims.set(verified, inspected.claims)
  return verified
}

/**
 * Inspect a freshly assembled v5 artifact without consuming its nonce.
 * @param {object} params - grant, delegation, call, root, and launch expectations.
 * @returns {Readonly<object>} named verdict.
 */
export function verifyIssuedGrantV5(params) {
  return verifyArtifact(params)
}

/**
 * Verify and atomically reserve a v5 artifact immediately before settlement.
 * A supplied claim callback owns replay and uncertainty diagnosis; only true admits.
 * @param {object} params - grant, delegation, call, root, launch expectations, and nonce book.
 * @returns {Readonly<object>} named verdict with authority evidence on success.
 */
export function verifyGrantV5(params) {
  const verified = verifyArtifact(params)
  if (!verified.ok) return verified
  if (params.seenNonces === undefined && params.claimNonce === undefined) {
    return refusal(REFUSE.NO_NONCE_BOOK)
  }
  const claims = verifiedClaims.get(verified)
  if (claims === undefined) return refusal(REFUSE.MALFORMED)
  if (params.claimNonce !== undefined) {
    const result = params.claimNonce(claims.nonce, claims.exp)
    if (result === 'malformed') return refusal(REFUSE.MALFORMED)
    if (result === false) return refusal(REFUSE.REPLAYED)
    if (result !== true) return refusal(REFUSE.NONCE_UNCERTAIN)
  } else {
    if (params.seenNonces?.has(claims.nonce)) return refusal(REFUSE.REPLAYED)
    params.seenNonces.add(claims.nonce)
  }
  return verified
}
