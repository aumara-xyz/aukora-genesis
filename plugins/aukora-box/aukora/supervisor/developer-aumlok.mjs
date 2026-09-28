/**
 * Parent-owned AUMLOK projection and proposal-specific development delegations.
 *
 * @module @aukora/supervisor/developer-aumlok
 */
import { randomBytes } from 'node:crypto'
import { createSubjectAuthorityContext } from '../broker/subject-authority.mjs'
import { identityControlDigest, parseIdentityControlState } from '../identity/control.mjs'
import { createDelegationClaim, delegationClaimDigest } from '../identity/delegation.mjs'
import { LOCAL_AUMLOK_CUSTODY_CLASS } from '../identity/local-control-store.mjs'
import {
  readAukoraId,
  readClosedDataRecord,
  readDigest,
  readExactAtom,
  readNonNegativeInteger,
} from '../identity/validation.mjs'
import { GRANT_DOMAIN_V5 } from '../host-dsh/src/grant-v5.mjs'

import { isGovernedEffect } from '../broker/effect-definition.mjs'
const PROJECTION_FIELDS = Object.freeze([
  'subject',
  'epoch',
  'activeControlDigest',
  'grantDomain',
  'custodyClass',
])

/** Environment field carrying the serialized non-secret AUMLOK Web projection. */
export const DEVELOPER_AUMLOK_PROJECTION_ENV = 'AUKORA_WEB_AUMLOK_CONTROL_PROJECTION_JSON'

function freshDigest() {
  return randomBytes(32).toString('hex')
}

function readControl(control) {
  if (control === null || typeof control !== 'object') {
    throw new TypeError('developer AUMLOK: local control is required')
  }
  const activeControl = parseIdentityControlState(control.activeControl)
  const activeControlDigest = identityControlDigest(activeControl)
  if (activeControl.revoked) throw new TypeError('developer AUMLOK: active control is revoked')
  if (control.subject !== activeControl.subject) {
    throw new TypeError('developer AUMLOK: local subject does not match active control')
  }
  if (control.activeControlDigest !== activeControlDigest) {
    throw new TypeError('developer AUMLOK: local control digest does not match active control')
  }
  if (control.record?.custodyClass !== LOCAL_AUMLOK_CUSTODY_CLASS) {
    throw new TypeError('developer AUMLOK: local custody class is not recognized')
  }
  return Object.freeze({ activeControl, activeControlDigest })
}

function readProjection(projection) {
  const fields = readClosedDataRecord(
    projection,
    PROJECTION_FIELDS,
    'developer AUMLOK projection',
  )
  if (fields.grantDomain !== GRANT_DOMAIN_V5) {
    throw new TypeError(`developer AUMLOK projection.grantDomain: must equal ${GRANT_DOMAIN_V5}`)
  }
  if (fields.custodyClass !== LOCAL_AUMLOK_CUSTODY_CLASS) {
    throw new TypeError(
      `developer AUMLOK projection.custodyClass: must equal ${LOCAL_AUMLOK_CUSTODY_CLASS}`,
    )
  }
  return Object.freeze({
    subject: readAukoraId(fields.subject, 'developer AUMLOK projection.subject'),
    epoch: readNonNegativeInteger(fields.epoch, 'developer AUMLOK projection.epoch'),
    activeControlDigest: readDigest(
      fields.activeControlDigest,
      'developer AUMLOK projection.activeControlDigest',
    ),
    grantDomain: GRANT_DOMAIN_V5,
    custodyClass: LOCAL_AUMLOK_CUSTODY_CLASS,
  })
}

/**
 * Project one local controller into the exact non-secret fields safe for a Web client.
 * @param {import('../identity/local-control-store.mjs').LocalAumlokControl} control - authenticated local controller.
 * @returns {Readonly<Record<string, string | number>>} immutable five-field projection.
 */
export function projectDeveloperAumlok(control) {
  const { activeControl, activeControlDigest } = readControl(control)
  return Object.freeze({
    subject: activeControl.subject,
    epoch: activeControl.epoch,
    activeControlDigest,
    grantDomain: GRANT_DOMAIN_V5,
    custodyClass: LOCAL_AUMLOK_CUSTODY_CLASS,
  })
}

/**
 * Serialize exactly the five public controller fields for a child Web process.
 * @param {unknown} projection - candidate non-secret AUMLOK projection.
 * @returns {string} canonical JSON with no additional fields.
 */
export function serializeDeveloperAumlokProjection(projection) {
  return JSON.stringify(readProjection(projection))
}

/**
 * Create a parent selector for proposal-specific v5 authority.
 * @param {import('../identity/local-control-store.mjs').LocalAumlokControl} control - authenticated local controller.
 * @param {{audience: string}} bindingInput - exact broker audience.
 * @returns {Readonly<Record<string, unknown>>} safe projection, broker expectation, and abortable selector.
 */
export function createDeveloperAumlokAuthority(control, bindingInput) {
  const { activeControl, activeControlDigest } = readControl(control)
  const binding = readClosedDataRecord(
    bindingInput,
    ['audience'],
    'developer AUMLOK binding',
  )
  const subjectAuthorityExpectation = Object.freeze({
    subject: activeControl.subject,
    activeControlDigest,
    audience: readExactAtom(binding.audience, 'developer AUMLOK binding.audience', 256),
  })
  const projection = projectDeveloperAumlok(control)

  /** Select one fresh session-to-Agent delegation for an exact broker request. */
  async function selectSubjectAuthority(request, signal) {
    signal.throwIfAborted()
    await Promise.resolve()
    signal.throwIfAborted()
    if (request.audience !== subjectAuthorityExpectation.audience) {
      throw new TypeError('developer AUMLOK: authority request audience mismatch')
    }
    if (!isGovernedEffect(request.toolName)) throw new TypeError('developer AUMLOK: unknown effect')
    const now = Math.floor(Date.now() / 1000)
    if (!Number.isSafeInteger(request.expiresAt) || request.expiresAt <= now) {
      throw new TypeError('developer AUMLOK: authority request expiry is not in the future')
    }
    const parent = createDelegationClaim({
      subject: activeControl.subject,
      kind: 'session',
      parentDigest: freshDigest(),
      controlDigest: activeControlDigest,
      childKeyId: freshDigest(),
      operations: [request.toolName],
      resources: [request.resource],
      audiences: [request.audience],
      activationDigests: [request.activationDigest],
      budgets: {
        calls: 2,
        bytes: request.budget.bytes,
        computeMs: request.budget.computeMs,
        costMicrounits: request.budget.costMicrounits,
      },
      notBefore: now,
      expiresAt: request.expiresAt,
      revocationId: `developer:session:${freshDigest()}`,
      nonce: freshDigest(),
    })
    const agent = createDelegationClaim({
      subject: activeControl.subject,
      kind: 'agent',
      parentDigest: delegationClaimDigest(parent),
      controlDigest: activeControlDigest,
      childKeyId: freshDigest(),
      operations: [request.toolName],
      resources: [request.resource],
      audiences: [request.audience],
      activationDigests: [request.activationDigest],
      budgets: {
        calls: request.budget.calls,
        bytes: request.budget.bytes,
        computeMs: request.budget.computeMs,
        costMicrounits: request.budget.costMicrounits,
      },
      notBefore: now,
      expiresAt: request.expiresAt,
      revocationId: `developer:agent:${freshDigest()}`,
      nonce: freshDigest(),
    })
    signal.throwIfAborted()
    return createSubjectAuthorityContext({
      subject: activeControl.subject,
      activeControlDigest,
      activationDigest: request.activationDigest,
      audience: request.audience,
      parentDelegationClaim: parent,
      delegationClaim: agent,
    })
  }

  return Object.freeze({
    projection,
    subjectAuthorityExpectation,
    selectSubjectAuthority,
  })
}
