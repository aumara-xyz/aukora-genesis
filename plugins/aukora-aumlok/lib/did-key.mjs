/**
 * `did:key` for the registered Ed25519 approval key (Genesis plan D1).
 *
 * D1: "The receipt owner identifier is `did:key` derived from the registered
 * Ed25519 public key using multicodec `ed25519-pub` and multibase `base58btc`. No
 * registry, network lookup or curve change."  This module is that derivation and
 * its inverse, and nothing else. It resolves nothing and calls nothing.
 *
 * THE RULE THIS MODULE EXISTS TO MAKE CHECKABLE. D1: "The stranger verifier
 * derives the DID from the actual key whose signature it verifies and refuses an
 * owner-field mismatch."  So the verifier-side direction is the primary one:
 * {@link didKeyFromEd25519PublicKey} takes the key the signature actually
 * verified under, and the caller compares that DID to the owner field. The
 * reverse direction ({@link ed25519PublicKeyFromDidKey}) exists so the comparison
 * is a bijection rather than a string match, and so a consumer can name the key a
 * projection refers to.
 *
 * WHY A DID IS NOT AUTHORITY. `did:key` is `base58btc(0xed01 || key)` with no
 * registry: every DID is a public key and nothing is attested about who holds it.
 * A matching DID proves that two statements name the same key. It proves nothing
 * about registration, custody or attendance, and this lane never treats it as a
 * permission — `admitPublicControl` is a consistency check, not an authorization.
 *
 * Encoder provenance: the multibase/multicodec construction is published
 * (W3C did:key v0.9, multicodec `ed25519-pub` = 0xed) and the vectors in
 * tests/aukora-aumlok.test.mjs are the specification's own published DID plus an
 * independent second-language decode.
 *
 * @module @aukora/dsh-plugin-aumlok/did-key
 */
import { createPublicKey } from 'node:crypto'
import { base58btcDecode, base58btcEncode } from './base58.mjs'

/** The `did:key` method prefix. */
export const DID_KEY_PREFIX = 'did:key:'

/** Multicodec `ed25519-pub`, varint-encoded: 0xed needs two bytes, 0xed 0x01. */
export const ED25519_PUB_MULTICODEC = Buffer.from([0xed, 0x01])

/** Multibase `base58btc` prefix character. */
export const BASE58BTC_MULTIBASE = 'z'

const ED25519_PUBLIC_KEY_BYTES = 32
const LOWER_HEX_64 = /^[0-9a-f]{64}$/u

/** A value that cannot be a `did:key` Ed25519 identifier. */
export class DidKeyError extends TypeError {}

/**
 * Derive the `did:key` of one raw 32-byte Ed25519 public key.
 * @param {string} rawHex - 64 lowercase hex characters of the raw Ed25519 public key.
 * @returns {string} `did:key:z…`.
 */
export function didKeyFromEd25519PublicKey(rawHex) {
  return `${DID_KEY_PREFIX}${BASE58BTC_MULTIBASE}${base58btcEncode(
    Buffer.concat([ED25519_PUB_MULTICODEC, readRawPublicKeyHex(rawHex)]),
  )}`
}

/**
 * Recover the raw Ed25519 public key a `did:key` identifier names.
 * @param {unknown} did - candidate identifier.
 * @returns {string} 64 lowercase hex characters.
 */
export function ed25519PublicKeyFromDidKey(did) {
  if (typeof did !== 'string' || !did.startsWith(DID_KEY_PREFIX)) {
    throw new DidKeyError(`did:key: must start with ${DID_KEY_PREFIX}`)
  }
  const multibase = did.slice(DID_KEY_PREFIX.length)
  if (!multibase.startsWith(BASE58BTC_MULTIBASE)) {
    throw new DidKeyError(`did:key: only the ${BASE58BTC_MULTIBASE} (base58btc) multibase prefix is supported`)
  }
  const decoded = base58btcDecode(multibase.slice(1))
  if (decoded.length !== ED25519_PUB_MULTICODEC.length + ED25519_PUBLIC_KEY_BYTES) {
    throw new DidKeyError(
      `did:key: expected ${String(ED25519_PUB_MULTICODEC.length + ED25519_PUBLIC_KEY_BYTES)} bytes for an Ed25519 key, decoded ${String(decoded.length)}`,
    )
  }
  if (!decoded.subarray(0, ED25519_PUB_MULTICODEC.length).equals(ED25519_PUB_MULTICODEC)) {
    throw new DidKeyError('did:key: multicodec header is not ed25519-pub (0xed01)')
  }
  return decoded.subarray(ED25519_PUB_MULTICODEC.length).toString('hex')
}

/**
 * Read the raw Ed25519 public key named by a PEM SPKI document.
 *
 * The PEM is re-exported and compared to the input, so a document carrying
 * trailing content, unusual whitespace or a different key class is refused rather
 * than accepted because a parser was lenient about it.
 * @param {unknown} pem - candidate PEM text.
 * @returns {string} 64 lowercase hex characters.
 */
export function ed25519PublicKeyFromPem(pem) {
  if (typeof pem !== 'string') throw new DidKeyError('did:key: Ed25519 public key PEM must be a string')
  let key
  try {
    key = createPublicKey(pem)
  } catch (cause) {
    throw new DidKeyError('did:key: Ed25519 public key PEM did not parse', { cause })
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    throw new DidKeyError(`did:key: expected an Ed25519 public key, received ${String(key.asymmetricKeyType)}`)
  }
  if (key.export({ type: 'spki', format: 'pem' }).toString() !== pem) {
    throw new DidKeyError('did:key: Ed25519 public key PEM is not the canonical re-export')
  }
  const jwk = key.export({ format: 'jwk' })
  if (typeof jwk.x !== 'string') throw new DidKeyError('did:key: Ed25519 public key has no JWK x coordinate')
  const raw = Buffer.from(jwk.x, 'base64url')
  if (raw.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new DidKeyError(`did:key: expected a ${String(ED25519_PUBLIC_KEY_BYTES)}-byte Ed25519 key`)
  }
  return raw.toString('hex')
}

/**
 * Derive the `did:key` of the Ed25519 public key inside a PEM SPKI document.
 * @param {unknown} pem - candidate PEM text.
 * @returns {string} `did:key:z…`.
 */
export function didKeyFromPublicKeyPem(pem) {
  return didKeyFromEd25519PublicKey(ed25519PublicKeyFromPem(pem))
}

/**
 * Read one raw Ed25519 public key as lowercase hex.
 * @param {unknown} value - candidate key.
 * @returns {Buffer} the 32 raw bytes.
 */
function readRawPublicKeyHex(value) {
  if (typeof value !== 'string' || !LOWER_HEX_64.test(value)) {
    throw new DidKeyError('did:key: Ed25519 public key must be 64 lowercase hexadecimal characters')
  }
  return Buffer.from(value, 'hex')
}
