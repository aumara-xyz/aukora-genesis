/** Short-lived authorization to reverse an exact Web activation upgrade without reverting effects. */
import { createHash, randomBytes } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { activationDigest } from './statement.mjs'
import { identityControlDigest, parseIdentityControlState } from '../identity/control.mjs'
import { readAukoraId, readClosedDataRecord, readDigest, readNonNegativeInteger } from '../identity/validation.mjs'
import { UPGRADED_BINDING_DOMAIN, parseSignedWebUpgrade, parseWebUpgrade, verifyWebUpgradeRecord } from './web-upgrade-record.mjs'

/** Exact rollback operation domain, distinct from effect grants. */
export const WEB_ROLLBACK_DOMAIN = 'aukora:web-activation-rollback:v1'
/** Domain for both controller signatures over the rollback operation. */
export const WEB_ROLLBACK_SIGNATURE_DOMAIN = 'aukora:web-activation-rollback-signature:v1'
/** Signed authorization; its presence alone does not establish rollback completion. */
export const SIGNED_WEB_ROLLBACK_DOMAIN = 'aukora:signed-web-activation-rollback:v1'
/** Portable recovery material containing no private keys. */
export const WEB_ROLLBACK_BUNDLE_DOMAIN = 'aukora:web-activation-rollback-bundle:v1'
/** Maximum serialized recovery bundle accepted before any activation mutation. */
export const MAX_WEB_ROLLBACK_BUNDLE_BYTES = 1024 * 1024
const FIELDS = ['domain', 'upgradeOperationSha256', 'previousBindingSha256', 'previousActivation',
  'subject', 'controlDigest', 'receiptKeyId', 'storeDigest', 'nonce', 'issuedAt', 'expiresAt']
const digest = value => createHash('sha256').update(value).digest('hex')

/**
 * Parse detached rollback fields; the recovery window cannot exceed fifteen minutes.
 * @param {unknown} value - untrusted rollback operation.
 * @returns {Readonly<Record<string, unknown>>} immutable operation, without signature verification.
 */
export function parseWebRollback(value) {
  const input = readClosedDataRecord(value, FIELDS, 'Web rollback')
  if (input.domain !== WEB_ROLLBACK_DOMAIN) throw new Error('rollback:domain-invalid')
  const result = { domain: WEB_ROLLBACK_DOMAIN, subject: readAukoraId(input.subject, 'Web rollback.subject'),
    issuedAt: readNonNegativeInteger(input.issuedAt, 'Web rollback.issuedAt'),
    expiresAt: readNonNegativeInteger(input.expiresAt, 'Web rollback.expiresAt') }
  for (const name of FIELDS.filter(name => !['domain', 'subject', 'issuedAt', 'expiresAt'].includes(name))) {
    result[name] = readDigest(input[name], `Web rollback.${name}`)
  }
  if (result.expiresAt <= result.issuedAt || result.expiresAt - result.issuedAt > 900) {
    throw new Error('rollback:window-invalid')
  }
  return Object.freeze(result)
}

/**
 * Require the exact retained bytes named by the authenticated forward operation.
 *
 * The predecessor is whichever binding format the store actually held: the one-time
 * legacy v1 record, or an upgraded record a previous transition wrote. Both are matched
 * by digest against `previousBindingSha256` first, so the bytes restored on rollback are
 * the bytes the operator approved replacing — never a reconstruction. The format then
 * only decides how the activation that record names is read.
 */
function verifyPreviousBinding(previousBinding, upgrade) {
  if (typeof previousBinding !== 'string' || Buffer.byteLength(previousBinding) > 256 * 1024
    || digest(previousBinding) !== upgrade.previousBindingSha256) throw new Error('rollback:previous-binding-mismatch')
  const parsed = JSON.parse(previousBinding)
  if (parsed?.domain === UPGRADED_BINDING_DOMAIN) {
    // Structural parse only. The predecessor's own controller signatures are verified
    // where a controller is available — `readActivationBinding` on every read of the
    // restored binding, and `verifyWebRollbackBundle` for the forward record — so
    // checking them here would duplicate that without a controller to check against.
    const previous = parseSignedWebUpgrade(parsed)
    if (canonicalJSON(parsed) !== previousBinding
      || activationDigest(previous.operation.nextStatement) !== upgrade.previousActivation) {
      throw new Error('rollback:previous-binding-mismatch')
    }
    return
  }
  const previous = readClosedDataRecord(parsed, ['domain', 'activationDigest'], 'previous binding')
  if (previous.domain !== 'aukora:activation-binding:v1'
    || readDigest(previous.activationDigest, 'previous activation') !== upgrade.previousActivation) {
    throw new Error('rollback:previous-binding-mismatch')
  }
}

/**
 * Prepare recovery authorization alongside an unsigned forward operation, before owner approval.
 * @param {unknown} upgradeInput - exact forward operation presented to the owner.
 * @param {string} previousBinding - retained legacy activation bytes, never reconstructed.
 * @returns {Readonly<Record<string, unknown>>} rollback operation; no authorization is signed or persisted.
 */
export function createWebActivationRollback(upgradeInput, previousBinding) {
  const upgrade = parseWebUpgrade(upgradeInput)
  verifyPreviousBinding(previousBinding, upgrade)
  const issuedAt = Math.floor(Date.now() / 1000)
  return parseWebRollback({ domain: WEB_ROLLBACK_DOMAIN,
    upgradeOperationSha256: digest(canonicalJSON(upgrade)), previousBindingSha256: upgrade.previousBindingSha256,
    previousActivation: upgrade.previousActivation, subject: upgrade.subject, controlDigest: upgrade.controlDigest,
    receiptKeyId: upgrade.receiptKeyId, storeDigest: upgrade.storeDigest, nonce: randomBytes(32).toString('hex'),
    issuedAt, expiresAt: upgrade.issuedAt + 900 })
}

/**
 * Produce domain-separated bytes; these authorize activation recovery, not an effect.
 * @param {unknown} operation - exact rollback fields.
 * @returns {Buffer} signing preimage.
 */
export function webRollbackBytes(operation) {
  return Buffer.from(`${WEB_ROLLBACK_SIGNATURE_DOMAIN}\0${canonicalJSON(parseWebRollback(operation))}`, 'utf8')
}

/**
 * Verify both authorizations, their common controller and exact previous binding.
 * Historical verification does not check expiry; execution must check it again under the writer lease.
 * @param {unknown} value - recovery bundle, including the signed forward transition.
 * @param {unknown} controlInput - independently loaded retained controller.
 * @returns {Readonly<Record<string, unknown>>} detached verified bundle.
 */
export function verifyWebRollbackBundle(value, controlInput) {
  const input = readClosedDataRecord(value, ['domain', 'previousBinding', 'upgrade', 'rollback'], 'rollback bundle')
  if (input.domain !== WEB_ROLLBACK_BUNDLE_DOMAIN) throw new Error('rollback:bundle-domain-invalid')
  const upgrade = parseSignedWebUpgrade(input.upgrade)
  const forward = verifyWebUpgradeRecord(upgrade, controlInput)
  verifyPreviousBinding(input.previousBinding, forward)
  const signed = readClosedDataRecord(input.rollback, ['domain', 'operation', 'signatures'], 'signed rollback')
  if (signed.domain !== SIGNED_WEB_ROLLBACK_DOMAIN) throw new Error('rollback:signature-domain-invalid')
  const operation = parseWebRollback(signed.operation)
  if (operation.upgradeOperationSha256 !== digest(canonicalJSON(forward))
    || ['previousBindingSha256', 'previousActivation', 'subject', 'controlDigest', 'receiptKeyId', 'storeDigest']
      .some(name => operation[name] !== forward[name])
    || operation.issuedAt < forward.issuedAt || operation.expiresAt > forward.issuedAt + 900) {
    throw new Error('rollback:upgrade-mismatch')
  }
  const control = parseIdentityControlState(controlInput)
  if (control.revoked || control.subject !== operation.subject
    || identityControlDigest(control) !== operation.controlDigest) throw new Error('rollback:controller-mismatch')
  const signatures = readClosedDataRecord(signed.signatures, ['ed25519', 'mlDsa65'], 'rollback signatures')
  for (const [name, length] of [['ed25519', 128], ['mlDsa65', 6618]]) {
    if (typeof signatures[name] !== 'string' || signatures[name].length !== length
      || !/^[0-9a-f]+$/u.test(signatures[name])) throw new Error('rollback:signature-invalid')
  }
  const bytes = webRollbackBytes(operation)
  if (!ed25519.verify(Buffer.from(signatures.ed25519, 'hex'), bytes, Buffer.from(control.publicKeys.ed25519, 'hex'), { zip215: false })
    || !ml_dsa65.verify(Buffer.from(signatures.mlDsa65, 'hex'), bytes, Buffer.from(control.publicKeys.mlDsa65, 'hex'),
      { context: Buffer.from(WEB_ROLLBACK_SIGNATURE_DOMAIN) })) throw new Error('rollback:signature-invalid')
  const bundle = Object.freeze({ domain: WEB_ROLLBACK_BUNDLE_DOMAIN, previousBinding: input.previousBinding, upgrade,
    rollback: Object.freeze({ domain: SIGNED_WEB_ROLLBACK_DOMAIN, operation,
      signatures: Object.freeze({ ed25519: signatures.ed25519, mlDsa65: signatures.mlDsa65 }) }) })
  if (Buffer.byteLength(canonicalJSON(bundle)) > MAX_WEB_ROLLBACK_BUNDLE_BYTES) throw new Error('rollback:bundle-too-large')
  return bundle
}
