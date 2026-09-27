/**
 * Launch-pinned subject authority consumed by the broker proposal route.
 *
 * The object authenticates no control history by itself. Its authority comes
 * from the trusted launcher selecting it and the issuer signing each v5 action
 * that binds its exact digests. The broker revalidates it at check-at-use.
 *
 * @module @aukora/broker/subject-authority
 */
import {
  delegationClaimDigest,
  parseDelegationClaim,
  verifyDelegationAttenuation,
} from '../identity/delegation.mjs'
import {
  readAukoraId,
  readClosedDataRecord,
  readDigest,
  readExactAtom,
} from '../identity/validation.mjs'

const CONTEXT_FIELDS = Object.freeze([
  'subject',
  'activeControlDigest',
  'activationDigest',
  'audience',
  'parentDelegationClaim',
  'delegationClaim',
])
const RESOLVED_CONTEXT_FIELDS = Object.freeze([
  ...CONTEXT_FIELDS,
  'parentDigest',
  'delegationDigest',
])
const EXPECTATION_FIELDS = Object.freeze([
  'subject',
  'activeControlDigest',
  'activationDigest',
  'audience',
])

/**
 * Validate the public identity fields a broker child may pin before asking its
 * launch parent for one proposal-specific delegation.
 * @param {unknown} input - serialized expectation supplied by the launch parent.
 * @returns {Readonly<Record<string, string>>} canonical expectation.
 */
export function createSubjectAuthorityExpectation(input) {
  const fields = readClosedDataRecord(input, EXPECTATION_FIELDS, 'subject authority expectation')
  return Object.freeze({
    subject: readAukoraId(fields.subject, 'subject authority expectation.subject'),
    activeControlDigest: readDigest(
      fields.activeControlDigest,
      'subject authority expectation.activeControlDigest',
    ),
    activationDigest: readDigest(
      fields.activationDigest,
      'subject authority expectation.activationDigest',
    ),
    audience: readExactAtom(fields.audience, 'subject authority expectation.audience', 256),
  })
}

/**
 * Validate and detach one exact parent-selected subject authority context.
 * @param {unknown} input - serialized context supplied by the launch parent.
 * @returns {Readonly<Record<string, unknown>>} canonical context.
 */
export function createSubjectAuthorityContext(input) {
  const hasResolvedDigests = input !== null
    && typeof input === 'object'
    && Object.hasOwn(input, 'parentDigest')
  const fields = readClosedDataRecord(
    input,
    hasResolvedDigests ? RESOLVED_CONTEXT_FIELDS : CONTEXT_FIELDS,
    'subject authority context',
  )
  const subject = readAukoraId(fields.subject, 'subject authority context.subject')
  const activeControlDigest = readDigest(
    fields.activeControlDigest,
    'subject authority context.activeControlDigest',
  )
  const activationDigest = readDigest(
    fields.activationDigest,
    'subject authority context.activationDigest',
  )
  const audience = readExactAtom(fields.audience, 'subject authority context.audience', 256)
  const parentDelegationClaim = parseDelegationClaim(fields.parentDelegationClaim)
  const delegationClaim = parseDelegationClaim(fields.delegationClaim)
  const attenuation = verifyDelegationAttenuation(parentDelegationClaim, delegationClaim, {
    subject,
    controlDigest: activeControlDigest,
  })
  if (!attenuation.ok) {
    throw new TypeError(`subject authority context: ${attenuation.reason}`)
  }
  if (parentDelegationClaim.kind !== 'session' || delegationClaim.kind !== 'agent') {
    throw new TypeError('subject authority context: requires one session-to-agent delegation')
  }
  if (!delegationClaim.activationDigests.includes(activationDigest)) {
    throw new TypeError('subject authority context: activation is not delegated')
  }
  if (!delegationClaim.audiences.includes(audience)) {
    throw new TypeError('subject authority context: audience is not delegated')
  }
  const parentDigest = delegationClaimDigest(parentDelegationClaim)
  const delegationDigest = delegationClaimDigest(delegationClaim)
  if (hasResolvedDigests) {
    if (readDigest(fields.parentDigest, 'subject authority context.parentDigest') !== parentDigest) {
      throw new TypeError('subject authority context: parent digest mismatch')
    }
    if (readDigest(fields.delegationDigest, 'subject authority context.delegationDigest') !== delegationDigest) {
      throw new TypeError('subject authority context: delegation digest mismatch')
    }
  }
  return Object.freeze({
    subject,
    activeControlDigest,
    activationDigest,
    audience,
    parentDigest,
    delegationDigest,
    parentDelegationClaim,
    delegationClaim,
  })
}

/**
 * Encode a validated context for the broker child's explicit environment.
 * @param {unknown} input - subject authority context.
 * @returns {string} canonical Base64 JSON.
 */
export function encodeSubjectAuthorityContext(input) {
  const context = createSubjectAuthorityContext(input)
  return Buffer.from(JSON.stringify({
    subject: context.subject,
    activeControlDigest: context.activeControlDigest,
    activationDigest: context.activationDigest,
    audience: context.audience,
    parentDelegationClaim: context.parentDelegationClaim,
    delegationClaim: context.delegationClaim,
  }), 'utf8').toString('base64')
}

/**
 * Decode the broker child's explicit subject-authority environment value.
 * @param {unknown} encoded - canonical Base64 JSON.
 * @returns {Readonly<Record<string, unknown>>} validated context.
 */
export function decodeSubjectAuthorityContext(encoded) {
  if (typeof encoded !== 'string' || encoded === '') {
    throw new TypeError('subject authority context: encoded value is required')
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== encoded) {
    throw new TypeError('subject authority context: encoded value is not canonical Base64')
  }
  return createSubjectAuthorityContext(JSON.parse(bytes.toString('utf8')))
}

/**
 * Encode one validated dynamic-authority expectation for the broker child.
 * @param {unknown} input - public subject-authority expectation.
 * @returns {string} canonical Base64 JSON.
 */
export function encodeSubjectAuthorityExpectation(input) {
  const expectation = createSubjectAuthorityExpectation(input)
  return Buffer.from(JSON.stringify(expectation), 'utf8').toString('base64')
}

/**
 * Decode the broker child's explicit dynamic-authority expectation value.
 * @param {unknown} encoded - canonical Base64 JSON.
 * @returns {Readonly<Record<string, string>>} validated expectation.
 */
export function decodeSubjectAuthorityExpectation(encoded) {
  if (typeof encoded !== 'string' || encoded === '') {
    throw new TypeError('subject authority expectation: encoded value is required')
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== encoded) {
    throw new TypeError('subject authority expectation: encoded value is not canonical Base64')
  }
  return createSubjectAuthorityExpectation(JSON.parse(bytes.toString('utf8')))
}
