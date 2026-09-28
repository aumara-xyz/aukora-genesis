/**
 * The one grant minter. Lives beside the issuer daemon because it is the only
 * place Ed25519 signing is allowed to run; nothing inside the Harness process
 * imports this module. Every caller — issuer daemon, courts — gets identical
 * grants: bound to the payload, the definition, and the WYSIWYS operation
 * digest.
 *
 * @module @aukora/issuer/mint
 */
import { sign as edSign } from 'node:crypto'
import { grantPreimage, payloadDigest, newNonce, MAX_TTL_SECONDS } from '../host-dsh/src/grant.mjs'
import { definitionDigest, MEMORY_PUT } from '../broker/effect-definition.mjs'
import { buildOperation, operationDigest } from '../broker/operation.mjs'
import { isExactMemoryPutArgs, KEY_SHAPE } from '../broker/memory-put-args.mjs'

/**
 * Mint one single-use grant for one approved memory.put.
 * @param {object} params
 * @param {import('node:crypto').KeyObject} params.rootPrivateKey - the root's Ed25519 private KeyObject.
 * @param {{key: string, value: unknown}} params.args - the exact call arguments.
 * @param {number} params.exp - expiry, unix seconds; future, within MAX_TTL_SECONDS.
 * @param {string} params.receiptKeyId - sha256 identity of the permitted receipt-signing key.
 * @returns {{grant: Record<string, unknown>, operation: Record<string, unknown>, operationDigestValue: string}}
 * @throws {TypeError | RangeError} when the key, arguments, or expiry cannot be signed.
 */
export function mintGrant({ rootPrivateKey, args, exp, receiptKeyId }) {
  if (rootPrivateKey?.type !== 'private' || rootPrivateKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('mintGrant: rootPrivateKey must be an Ed25519 private key')
  }
  if (!isExactMemoryPutArgs(args)) throw new TypeError('mint:arguments-not-exact')
  if (!KEY_SHAPE.test(args.key)) throw new TypeError('mint:key-not-a-name')
  if (!Number.isInteger(exp)) throw new TypeError('mintGrant: integer exp required')
  if (typeof receiptKeyId !== 'string' || !/^[0-9a-f]{64}$/.test(receiptKeyId)) {
    throw new TypeError('mintGrant: valid receiptKeyId required')
  }
  const nowSec = Math.floor(Date.now() / 1000)
  if (exp <= nowSec) throw new RangeError('mintGrant: expiry is not in the future')
  if (exp > nowSec + MAX_TTL_SECONDS) throw new RangeError(`mintGrant: expiry exceeds MAX_TTL_SECONDS (${MAX_TTL_SECONDS})`)
  const operation = buildOperation(args, exp)
  const claims = {
    toolName: MEMORY_PUT,
    digest: payloadDigest(MEMORY_PUT, args),
    nonce: newNonce(),
    exp,
    definitionId: definitionDigest(),
    operationDigest: operationDigest(operation),
    receiptKeyId,
  }
  const signature = edSign(null, grantPreimage(claims), rootPrivateKey).toString('base64')
  return { grant: { ...claims, signature }, operation, operationDigestValue: claims.operationDigest }
}

/** Issue-request shape served by the issuer daemon. */
export function issueRequest(args, expiry) {
  return { op: 'issue', toolName: MEMORY_PUT, arguments: args, expiry }
}
