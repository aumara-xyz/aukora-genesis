/** Hybrid-signed, one-time v1 Web activation upgrade; not an action grant. */
import { ed25519 } from '@noble/curves/ed25519.js'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { identityControlDigest, parseIdentityControlState } from '../identity/control.mjs'
import { readAukoraId, readClosedDataRecord, readDigest, readNonNegativeInteger } from '../identity/validation.mjs'
import { activationDigest, encodeActivationStatement, parseActivationStatementFrame } from './statement.mjs'

/** Exact old-to-new activation authorization fields. */
export const WEB_UPGRADE_DOMAIN = 'aukora:web-activation-upgrade:v1'
/** Signing domain distinct from action grants and review answers. */
export const WEB_UPGRADE_SIGNATURE_DOMAIN = 'aukora:web-activation-upgrade-signature:v1'
/** Durable replacement for the one-time v1 activation binding. */
export const UPGRADED_BINDING_DOMAIN = 'aukora:activation-binding:upgraded-web:v1'
const FIELDS = ['domain', 'previousActivation', 'previousBindingSha256', 'nextStatement', 'subject',
  'controlDigest', 'receiptKeyId', 'storeDigest', 'nonce', 'issuedAt', 'expiresAt']

/**
 * Parse the exact, detached operation shown to the operator.
 * @param {unknown} value - proposed one-time transition.
 * @returns {Readonly<Record<string, unknown>>} canonical immutable fields.
 */
export function parseWebUpgrade(value) {
  const input = readClosedDataRecord(value, FIELDS, 'Web upgrade')
  if (input.domain !== WEB_UPGRADE_DOMAIN) throw new Error('upgrade:domain-invalid')
  const nextStatement = parseActivationStatementFrame(encodeActivationStatement(input.nextStatement))
  if (!nextStatement.closure.resolver['owner-review-configuration']
    || nextStatement.modelEmissionPolicy !== 'aukora:model-emission:parent-staged-web:v1') {
    throw new Error('upgrade:reconnectable-web-required')
  }
  const result = { domain: WEB_UPGRADE_DOMAIN, nextStatement,
    subject: readAukoraId(input.subject, 'Web upgrade.subject'),
    issuedAt: readNonNegativeInteger(input.issuedAt, 'Web upgrade.issuedAt'),
    expiresAt: readNonNegativeInteger(input.expiresAt, 'Web upgrade.expiresAt') }
  for (const field of ['previousActivation', 'previousBindingSha256', 'controlDigest', 'receiptKeyId', 'storeDigest', 'nonce']) {
    result[field] = readDigest(input[field], `Web upgrade.${field}`)
  }
  if (result.expiresAt <= result.issuedAt || result.expiresAt - result.issuedAt > 120
    || activationDigest(nextStatement) === result.previousActivation
    || nextStatement.brokerId !== result.receiptKeyId) throw new Error('upgrade:operation-invalid')
  return Object.freeze(result)
}

/**
 * Domain-separated bytes signed by both current controller keys.
 * @param {unknown} operation - exact transition fields.
 * @returns {Buffer} signing preimage, never interchangeable with a review or grant.
 */
export function webUpgradeBytes(operation) {
  return Buffer.from(`${WEB_UPGRADE_SIGNATURE_DOMAIN}\0${canonicalJSON(parseWebUpgrade(operation))}`, 'utf8')
}

/**
 * Verify a durable transition against the retained controller; expiry is checked at commit, not historical read.
 * @param {unknown} value - signed binding record.
 * @param {unknown} controlInput - independently loaded current controller head.
 * @returns {Readonly<Record<string, unknown>>} verified operation.
 */
export function verifyWebUpgradeRecord(value, controlInput) {
  const record = parseSignedWebUpgrade(value)
  const operation = record.operation
  const control = parseIdentityControlState(controlInput)
  if (control.revoked || operation.subject !== control.subject
    || operation.controlDigest !== identityControlDigest(control)) throw new Error('upgrade:controller-mismatch')
  const signatures = record.signatures
  const bytes = webUpgradeBytes(operation)
  if (!ed25519.verify(Buffer.from(signatures.ed25519, 'hex'), bytes, Buffer.from(control.publicKeys.ed25519, 'hex'), { zip215: false })
    || !ml_dsa65.verify(Buffer.from(signatures.mlDsa65, 'hex'), bytes, Buffer.from(control.publicKeys.mlDsa65, 'hex'),
      { context: Buffer.from(WEB_UPGRADE_SIGNATURE_DOMAIN) })) throw new Error('upgrade:signature-invalid')
  return operation
}

/**
 * Detach a closed signed record before verification or persistence.
 * @param {unknown} value - untrusted signed record.
 * @returns {Readonly<Record<string, unknown>>} immutable operation and signature bytes, without signature verification.
 */
export function parseSignedWebUpgrade(value) {
  const record = readClosedDataRecord(value, ['domain', 'operation', 'signatures'], 'upgraded binding')
  if (record.domain !== UPGRADED_BINDING_DOMAIN) throw new Error('upgrade:binding-domain-invalid')
  const operation = parseWebUpgrade(record.operation)
  const signatures = readClosedDataRecord(record.signatures, ['ed25519', 'mlDsa65'], 'upgrade signatures')
  for (const [name, length] of [['ed25519', 128], ['mlDsa65', 6618]]) {
    if (typeof signatures[name] !== 'string' || signatures[name].length !== length
      || !/^[0-9a-f]+$/u.test(signatures[name])) throw new Error('upgrade:signature-invalid')
  }
  return Object.freeze({ domain: UPGRADED_BINDING_DOMAIN, operation,
    signatures: Object.freeze({ ed25519: signatures.ed25519, mlDsa65: signatures.mlDsa65 }) })
}
