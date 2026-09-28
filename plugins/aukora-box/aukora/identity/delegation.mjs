/**
 * Canonical delegation claims and multidimensional attenuation checks.
 *
 * These claims contain no signature and grant no authority by themselves.
 *
 * @module @aukora/identity/delegation
 */
import { createHash } from 'node:crypto'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import {
  readAukoraId,
  readClosedDataRecord,
  readDigest,
  readDigestSet,
  readExactAtom,
  readExactAtomSet,
  readNonNegativeInteger,
} from './validation.mjs'

export const DELEGATION_CLAIM_DOMAIN = 'aukora:delegation-claim:v1'
const DELEGATION_DIGEST_DOMAIN = 'aukora:delegation-digest:v1'
const KINDS = Object.freeze(['root', 'device', 'session', 'agent'])
const CLAIM_FIELDS = Object.freeze([
  'domain', 'subject', 'kind', 'parentDigest', 'controlDigest', 'childKeyId',
  'operations', 'resources', 'audiences', 'activationDigests', 'budgets',
  'notBefore', 'expiresAt', 'revocationId', 'nonce',
])
const INPUT_FIELDS = Object.freeze(CLAIM_FIELDS.filter(field => field !== 'domain'))
const BUDGET_FIELDS = Object.freeze(['calls', 'bytes', 'computeMs', 'costMicrounits'])

/** @typedef {'root' | 'device' | 'session' | 'agent'} DelegationKind */

function readKind(value, label) {
  if (typeof value !== 'string' || !KINDS.includes(value)) {
    throw new TypeError(`${label}: must be one of ${KINDS.join(', ')}`)
  }
  return /** @type {DelegationKind} */ (value)
}

function readParentDigest(value, kind, label) {
  if (kind === 'root') {
    if (value !== null) throw new TypeError(`${label}: root claims require null`)
    return null
  }
  return readDigest(value, label)
}

function nextKind(kind) {
  switch (kind) {
    case 'root': return 'device'
    case 'device': return 'session'
    case 'session': return 'agent'
    case 'agent': return null
  }
}

function readBudgets(value) {
  const fields = readClosedDataRecord(value, BUDGET_FIELDS, 'delegation claim.budgets')
  return Object.freeze({
    calls: readNonNegativeInteger(fields.calls, 'delegation claim.budgets.calls'),
    bytes: readNonNegativeInteger(fields.bytes, 'delegation claim.budgets.bytes'),
    computeMs: readNonNegativeInteger(fields.computeMs, 'delegation claim.budgets.computeMs'),
    costMicrounits: readNonNegativeInteger(fields.costMicrounits, 'delegation claim.budgets.costMicrounits'),
  })
}

function parseFields(fields, requireSorted) {
  const kind = readKind(fields.kind, 'delegation claim.kind')
  // Delegation time uses Unix seconds, matching executable action grants.
  const notBefore = readNonNegativeInteger(fields.notBefore, 'delegation claim.notBefore')
  const expiresAt = readNonNegativeInteger(fields.expiresAt, 'delegation claim.expiresAt')
  if (expiresAt <= notBefore) throw new TypeError('delegation claim: expiresAt must be greater than notBefore')
  return Object.freeze({
    domain: DELEGATION_CLAIM_DOMAIN,
    subject: readAukoraId(fields.subject, 'delegation claim.subject'),
    kind,
    parentDigest: readParentDigest(fields.parentDigest, kind, 'delegation claim.parentDigest'),
    controlDigest: readDigest(fields.controlDigest, 'delegation claim.controlDigest'),
    childKeyId: readDigest(fields.childKeyId, 'delegation claim.childKeyId'),
    operations: readExactAtomSet(fields.operations, 'delegation claim.operations', 64, 128, requireSorted),
    resources: readExactAtomSet(fields.resources, 'delegation claim.resources', 128, 256, requireSorted),
    audiences: readExactAtomSet(fields.audiences, 'delegation claim.audiences', 64, 256, requireSorted),
    activationDigests: readDigestSet(fields.activationDigests, 'delegation claim.activationDigests', requireSorted),
    budgets: readBudgets(fields.budgets),
    notBefore,
    expiresAt,
    revocationId: readExactAtom(fields.revocationId, 'delegation claim.revocationId', 256),
    nonce: readDigest(fields.nonce, 'delegation claim.nonce'),
  })
}

/**
 * Create a canonical unsigned delegation claim from trusted inputs.
 * @param {unknown} input - exact delegation fields without the fixed domain.
 * @returns {Readonly<Record<string, unknown>>} immutable canonical claim.
 */
export function createDelegationClaim(input) {
  const fields = readClosedDataRecord(input, INPUT_FIELDS, 'delegation claim input')
  return parseFields(fields, false)
}

/**
 * Parse a serialized delegation claim and require canonical set order.
 * @param {unknown} input - candidate claim.
 * @returns {Readonly<Record<string, unknown>>} detached immutable claim.
 */
export function parseDelegationClaim(input) {
  const fields = readClosedDataRecord(input, CLAIM_FIELDS, 'delegation claim')
  if (fields.domain !== DELEGATION_CLAIM_DOMAIN) {
    throw new TypeError(`delegation claim.domain: must equal ${DELEGATION_CLAIM_DOMAIN}`)
  }
  return parseFields(fields, true)
}

/**
 * Hash one canonical unsigned delegation claim.
 * @param {unknown} input - candidate claim.
 * @returns {string} lowercase SHA-256 digest.
 */
export function delegationClaimDigest(input) {
  const claim = parseDelegationClaim(input)
  return createHash('sha256')
    .update(DELEGATION_DIGEST_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(canonicalJSON(claim), 'utf8')
    .digest('hex')
}

function subset(parent, child) {
  const allowed = new Set(parent)
  return child.every(value => allowed.has(value))
}

function properSubset(parent, child) {
  return child.length < parent.length && subset(parent, child)
}

function refusal(reason) {
  return Object.freeze({ ok: false, reason })
}

/**
 * Verify that one child claim is a strict attenuation of its immediate parent.
 * @param {unknown} parentInput - serialized parent claim.
 * @param {unknown} childInput - serialized child claim.
 * @param {unknown} expectedInput - exact active subject and control-history digest.
 * @returns {Readonly<{ok: true, childDigest: string} | {ok: false, reason: string}>} named verdict.
 */
export function verifyDelegationAttenuation(parentInput, childInput, expectedInput) {
  let parent
  let child
  let expected
  try {
    parent = parseDelegationClaim(parentInput)
    child = parseDelegationClaim(childInput)
    const fields = readClosedDataRecord(expectedInput, ['subject', 'controlDigest'], 'delegation expectation')
    expected = {
      subject: readAukoraId(fields.subject, 'delegation expectation.subject'),
      controlDigest: readDigest(fields.controlDigest, 'delegation expectation.controlDigest'),
    }
  } catch {
    return refusal('delegation:malformed')
  }
  if (parent.subject !== expected.subject || child.subject !== expected.subject) {
    return refusal('delegation:subject-mismatch')
  }
  if (parent.controlDigest !== expected.controlDigest || child.controlDigest !== expected.controlDigest) {
    return refusal('delegation:control-mismatch')
  }
  if (child.parentDigest !== delegationClaimDigest(parent)) return refusal('delegation:parent-mismatch')
  if (nextKind(parent.kind) !== child.kind) return refusal('delegation:role-transition-invalid')
  if (!subset(parent.operations, child.operations)) return refusal('delegation:operation-widened')
  if (!subset(parent.resources, child.resources)) return refusal('delegation:resource-widened')
  if (!subset(parent.audiences, child.audiences)) return refusal('delegation:audience-widened')
  if (!subset(parent.activationDigests, child.activationDigests)) return refusal('delegation:activation-widened')
  for (const key of BUDGET_FIELDS) {
    if (child.budgets[key] > parent.budgets[key]) return refusal(`delegation:budget-${key}-widened`)
  }
  if (child.notBefore < parent.notBefore || child.expiresAt > parent.expiresAt) {
    return refusal('delegation:time-widened')
  }
  const strictlyNarrower = properSubset(parent.operations, child.operations)
    || properSubset(parent.resources, child.resources)
    || properSubset(parent.audiences, child.audiences)
    || properSubset(parent.activationDigests, child.activationDigests)
    || BUDGET_FIELDS.some(key => child.budgets[key] < parent.budgets[key])
    || child.notBefore > parent.notBefore
    || child.expiresAt < parent.expiresAt
  if (!strictlyNarrower) return refusal('delegation:not-attenuated')
  return Object.freeze({ ok: true, childDigest: delegationClaimDigest(child) })
}
