/**
 * NIP-44 v2 ENCRYPTION — the payload layer NIP-17 wraps its messages in.
 *
 * WHY THE CURVE IS VENDORED AND THE HASHES ARE NOT. `createHmac` and `randomBytes` are Node's own and
 * are correct here. Two primitives this lane needs are NOT in Node, and both are measured facts
 * rather than assumptions — tests/aukora-nostr-vendor-pin.test.mjs pins both so a future reader
 * cannot rediscover them by surprise:
 *
 *   1. BIP-340 Schnorr. `crypto.sign(d, msg, { scheme: 'schnorr' })` does NOT fail — it silently
 *      returns a DER ECDSA signature (70/71/72 bytes, never BIP-340's fixed 64) and `verify` with
 *      the same option returns `true` for it. A silent fail-open, not a missing function.
 *      Supplied by the vendored @noble/curves.
 *
 *   2. IETF ChaCha20 (RFC 8439). Node's `chacha20` is the OpenSSL ORIGINAL with a 128-bit IV: a
 *      12-byte nonce is rejected outright (`ERR_CRYPTO_INVALID_IV`), and a 16-byte IV reproduces
 *      NEITHER byte order of the RFC 8439 §2.4.2 ciphertext (`51448c64…`, `1a7481d7…` where the RFC
 *      says `6e2e359a…`). Unlike (1) this one throws, but it is absent either way. Supplied by the
 *      vendored @noble/ciphers, proven against that same §2.4.2 vector.
 *
 * Note what is deliberately NOT used: `chacha20-poly1305`. The AEAD authenticates a different byte
 * range than NIP-44 specifies, which uses a bare ChaCha20 stream plus a SEPARATE HMAC-SHA256, each
 * keyed from its own slice of one HKDF expansion. So the composition below is `chacha20(…)` +
 * `createHmac('sha256', …)`, which IS the spec.
 *
 * The cipher call is a plain function — `chacha20(key, nonce, data, output?, counter = 0)` — NOT a
 * cipher object, and its inputs must be plain `Uint8Array`s rather than `Buffer`s. Counter 0 is
 * correct and is also the default, so NIP-44 does not pass it. Both gotchas cost a debugging cycle.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THREE DEFECTS A ROUND TRIP COULD NOT SEE, FOUND BY THE PUBLISHED VECTORS. This module first
 * passed its own smoke test — encrypt, decrypt, compare — while being wrong in three ways at once,
 * because a round trip agrees with itself even when both halves are wrong. The published
 * `nip44.vectors.json` (sha256 `269ed0f6…`, vendored at tests/vectors/) caught all three:
 *
 *   (a) HKDF WAS USED AS extract+expand, NOT AS THE SPEC DIRECTS. Node's `hkdfSync` always does
 *       extract-then-expand. NIP-44 wants **extract only** for the conversation key
 *       (`HKDF-Extract(salt='nip44-v2', IKM=shared_x)`, used directly as the 32-byte key) and
 *       **expand only** for the message keys (`HKDF-Expand(PRK=conversation_key, info=nonce, L=76)`).
 *       Feeding either through `hkdfSync` inserts an extra HMAC the far end does not perform, so
 *       every payload would have been unreadable by every other NIP-44 implementation — including
 *       nostr-tools and the relays' clients — while looking perfect locally.
 *
 *   (b) PADDING WAS "NEXT POWER OF TWO". It is not. The spec buckets a power-of-two range into
 *       eighths (32-byte chunks below 257) so that short messages leak less length. `calc_padded_len`
 *       is reproduced verbatim below; the vectors pin 24 boundary cases, e.g. 65 -> 96 and
 *       200 -> 224, where a naive power-of-two gives 128 and 256.
 *
 *   (c) THE LENGTH PREFIX IS 6 BYTES AT 65536 AND ABOVE, not 2. Two leading zero bytes signal the
 *       extended form, and the decoder must reject a 6-byte prefix that names a length below the
 *       threshold — otherwise a padded block has two valid encodings.
 *
 * The lesson is the same one the BIP-340 arm records: a self-consistent test proves the two halves
 * agree with each other, not that either is right. Only a published vector is outside evidence.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * @module @aukora/dsh-plugin-nostr/nip44
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { secp256k1 } from './vendor/noble-curves/curves/secp256k1.js'
import { chacha20 } from './vendor/noble-ciphers/chacha.js'

/** NIP-44's version byte. v2 is the only version this file speaks. */
export const NIP44_VERSION = 2

/** Named refusals. A caller routes on these; none of them is prose to parse. */
export const NIP44_REFUSE = Object.freeze({
  VERSION: 'nip44:unsupported-version',
  PAYLOAD: 'nip44:payload-malformed',
  MAC: 'nip44:mac-invalid',
  PADDING: 'nip44:padding-invalid',
  NONCE: 'nip44:nonce-malformed',
  PLAINTEXT: 'nip44:plaintext-not-utf8',
  KEY: 'nip44:key-malformed',
})

/** The domain separator NIP-44 salts the conversation key with. Lowercase, exactly this string. */
const SALT = Buffer.from('nip44-v2', 'utf8')

/** `extended_prefix_threshold`: at and above this length the prefix is 6 bytes, not 2. */
const EXTENDED_PREFIX_THRESHOLD = 65536

/** `max_plaintext_size` is 2^32 - 1. */
const MAX_PLAINTEXT = 0xffffffff

/** Spec minimum sizes, validated BEFORE allocating, so a hostile payload cannot be a DoS. */
const MIN_BASE64_CHARS = 132
const MIN_DECODED_BYTES = 99

const refuse = (code, message) => Object.assign(new Error(message), { code })

/**
 * HKDF-Extract (RFC 5869 §2.2): a single HMAC. NIP-44 uses the PRK itself as the conversation key,
 * so this is the whole of step 1 — it is NOT `hkdfSync`, which would add an expand on top.
 * @param {Buffer} salt - the `nip44-v2` domain separator.
 * @param {Buffer} ikm - the raw 32-byte ECDH x-coordinate.
 * @returns {Buffer} the 32-byte PRK, used directly as the conversation key.
 */
function hkdfExtract(salt, ikm) {
  return createHmac('sha256', salt).update(ikm).digest()
}

/**
 * HKDF-Expand (RFC 5869 §2.3): T(i) = HMAC(PRK, T(i-1) ‖ info ‖ i), concatenated and truncated.
 * @param {Buffer} prk - the conversation key, used directly as the HMAC key.
 * @param {Buffer} info - the 32-byte message nonce.
 * @param {number} length - 76 for NIP-44's key material.
 * @returns {Buffer} `length` bytes of output key material.
 */
function hkdfExpand(prk, info, length) {
  const out = Buffer.alloc(length)
  let previous = Buffer.alloc(0)
  let offset = 0
  for (let counter = 1; offset < length; counter++) {
    previous = createHmac('sha256', prk)
      .update(Buffer.concat([previous, info, Buffer.from([counter])]))
      .digest()
    previous.copy(out, offset)
    offset += previous.length
  }
  return out
}

/**
 * `calc_padded_len` from the NIP-44 spec, reproduced exactly. The padded length is the containing
 * power-of-two bucket divided into eighths — 32-byte chunks while the bucket is at most 256 — which
 * leaks less length than a plain power of two for short messages.
 *
 * Uses `2 ** k`, not `1 << k`: the exponent reaches 32, and a JS shift is taken modulo 32, so
 * `1 << 32` is 1. The spec warns that the arithmetic must not wrap at 32 bits.
 *
 * @param {number} unpaddedLen - plaintext length in bytes, 1 to 2^32-1.
 * @returns {number} the padded length, excluding the length prefix.
 */
export function calcPaddedLen(unpaddedLen) {
  if (unpaddedLen <= 32) return 32
  // 2 ** (floor(log2(unpaddedLen - 1)) + 1): the smallest power of two >= unpaddedLen.
  const nextPower = 2 ** (32 - Math.clz32(unpaddedLen - 1))
  const chunk = nextPower <= 256 ? 32 : nextPower / 8
  return chunk * (Math.floor((unpaddedLen - 1) / chunk) + 1)
}

/**
 * The conversation key two parties share: ECDH, then HKDF-EXTRACT under `nip44-v2` — nothing more.
 *
 * The x-coordinate only — not the compressed point. NIP-44 is explicit, and a 33-byte point here
 * would produce a key nobody else computes, failing at the far end rather than at this one. Note
 * also that the x-coordinate is NOT hashed: some libraries do, and those libraries cannot talk to
 * this one.
 *
 * @param {Uint8Array|Buffer} secretKey - the sender's 32-byte secp256k1 secret.
 * @param {Uint8Array|Buffer} publicKey - the peer's 32-byte x-only public key.
 * @returns {Buffer} 32-byte conversation key, `conv(a, B) === conv(b, A)`.
 * @throws {Error} `nip44:key-malformed` if either key is not a valid BIP-340 scalar or point.
 */
export function conversationKey(secretKey, publicKey) {
  // A hex STRING secret must be read as hex. `Buffer.from('ab'.repeat(32))` is 64 bytes of UTF-8,
  // which noble then rejects as an unusable scalar — so a perfectly good nsec fails here unless the
  // string form is decoded first. Raw Uint8Array/Buffer secrets are still accepted unchanged.
  const secret = typeof secretKey === 'string' ? Buffer.from(secretKey, 'hex') : Buffer.from(secretKey)
  const xonly = Buffer.from(publicKey)
  if (secret.length !== 32) throw refuse(NIP44_REFUSE.KEY, 'the secret key must be exactly 32 bytes')
  if (xonly.length !== 32) throw refuse(NIP44_REFUSE.KEY, 'the peer public key must be 32 bytes of x-only')
  let shared
  try {
    // Re-attach the even-y prefix: an x-only key names the point whose y is even, which is the
    // convention both BIP-340 and NIP-44 use. noble validates the scalar range and that the point
    // is on-curve and non-zero, which is exactly the validation NIP-44 requires.
    const point = Buffer.concat([Buffer.from([0x02]), xonly])
    shared = secp256k1.getSharedSecret(secret, point)
  } catch (cause) {
    throw refuse(NIP44_REFUSE.KEY, `not a usable secp256k1 key pair: ${cause.message}`)
  }
  // Compressed point is 0x02|0x03 ‖ X, so bytes 1..33 are the unhashed x-coordinate.
  return hkdfExtract(SALT, Buffer.from(shared).subarray(1, 33))
}

/** The per-message keys: HKDF-EXPAND to 76 bytes, sliced 32 / 12 / 32. */
function messageKeys(convKey, nonce) {
  if (convKey.length !== 32) throw refuse(NIP44_REFUSE.KEY, 'the conversation key must be 32 bytes')
  if (nonce.length !== 32) throw refuse(NIP44_REFUSE.NONCE, 'the nonce must be 32 bytes')
  const expanded = hkdfExpand(convKey, nonce, 76)
  return {
    chachaKey: expanded.subarray(0, 32),
    chachaNonce: expanded.subarray(32, 44),
    hmacKey: expanded.subarray(44, 76),
  }
}

/**
 * Pad plaintext: a length prefix, the UTF-8 bytes, then zeros to `calcPaddedLen`.
 * @param {string} plaintext - at least 1 byte when UTF-8 encoded.
 * @returns {Buffer} the padded block, prefix included.
 */
function pad(plaintext) {
  const bytes = Buffer.from(plaintext, 'utf8')
  const len = bytes.length
  if (len < 1) throw refuse(NIP44_REFUSE.PADDING, 'empty plaintext has no NIP-44 padding')
  if (len > MAX_PLAINTEXT) throw refuse(NIP44_REFUSE.PADDING, 'plaintext exceeds the maximum NIP-44 length')
  // Two leading zero bytes signal the extended form; a u16 length of 0 is otherwise invalid because
  // valid plaintext is at least one byte.
  const prefix = Buffer.alloc(len >= EXTENDED_PREFIX_THRESHOLD ? 6 : 2)
  if (len >= EXTENDED_PREFIX_THRESHOLD) prefix.writeUInt32BE(len, 2)
  else prefix.writeUInt16BE(len, 0)
  const out = Buffer.alloc(prefix.length + calcPaddedLen(len))
  prefix.copy(out, 0)
  bytes.copy(out, prefix.length)
  return out
}

/**
 * Remove padding. Validates that the block is EXACTLY the canonical padding for its length, so a
 * padded block has one accepted encoding rather than several.
 * @param {Buffer} padded - the decrypted padded block.
 * @returns {string} the plaintext.
 */
function unpad(padded) {
  if (padded.length < 2) throw refuse(NIP44_REFUSE.PADDING, 'padded plaintext is too short to carry a prefix')
  const firstTwo = padded.readUInt16BE(0)
  let len
  let prefixLen
  if (firstTwo === 0) {
    if (padded.length < 6) throw refuse(NIP44_REFUSE.PADDING, 'extended prefix is truncated')
    len = padded.readUInt32BE(2)
    // A 6-byte prefix naming a length the 2-byte form could have carried is non-canonical.
    if (len < EXTENDED_PREFIX_THRESHOLD) throw refuse(NIP44_REFUSE.PADDING, `extended prefix names ${len}, below the threshold`)
    prefixLen = 6
  } else {
    len = firstTwo
    prefixLen = 2
  }
  if (len === 0) throw refuse(NIP44_REFUSE.PADDING, 'padded length 0 is never valid')
  if (padded.length !== prefixLen + calcPaddedLen(len)) {
    throw refuse(NIP44_REFUSE.PADDING, `padded block is ${padded.length} bytes and padding for ${len} is ${prefixLen + calcPaddedLen(len)}`)
  }
  const slice = padded.subarray(prefixLen, prefixLen + len)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(slice)
  } catch {
    throw refuse(NIP44_REFUSE.PLAINTEXT, 'the padding named a length that is not valid UTF-8')
  }
}

/** Strict base64: the spec says base64 WITH padding, so a lenient decoder must not be used. */
function isCanonicalBase64(text) {
  return text.length > 0 && text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text)
}

/**
 * Decode `version ‖ nonce ‖ ciphertext ‖ mac`, validating sizes and version before anything is
 * allocated or decrypted.
 * @param {string} payload - the base64 payload.
 * @returns {{nonce: Buffer, ciphertext: Buffer, mac: Buffer}} the three fields.
 */
function decodePayload(payload) {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw refuse(NIP44_REFUSE.PAYLOAD, 'payload is empty')
  }
  // `#` is the spec's future-proof flag for a non-base64 encoding. It is in the base64 alphabet's
  // place but not the alphabet, so it must report an unsupported VERSION, not a malformed payload.
  if (payload[0] === '#') throw refuse(NIP44_REFUSE.VERSION, 'payload uses a non-base64 encoding this reader does not support')
  if (payload.length < MIN_BASE64_CHARS) {
    throw refuse(NIP44_REFUSE.PAYLOAD, `payload is ${payload.length} chars and NIP-44 requires at least ${MIN_BASE64_CHARS}`)
  }
  if (!isCanonicalBase64(payload)) throw refuse(NIP44_REFUSE.PAYLOAD, 'payload is not canonical base64')
  const raw = Buffer.from(payload, 'base64')
  if (raw.length < MIN_DECODED_BYTES) {
    throw refuse(NIP44_REFUSE.PAYLOAD, `payload decodes to ${raw.length} bytes and NIP-44 requires at least ${MIN_DECODED_BYTES}`)
  }
  if (raw[0] !== NIP44_VERSION) throw refuse(NIP44_REFUSE.VERSION, `payload version ${raw[0]} is not ${NIP44_VERSION}`)
  return {
    nonce: raw.subarray(1, 33),
    ciphertext: raw.subarray(33, raw.length - 32),
    mac: raw.subarray(raw.length - 32),
  }
}

/**
 * Encrypt plaintext for a peer. Returns the base64 NIP-44 payload.
 * @param {string} plaintext - the UTF-8 text to encrypt.
 * @param {Buffer} convKey - the conversation key from {@link conversationKey}.
 * @param {Buffer} [nonce] - a 32-byte nonce; random unless a court injects one.
 * @returns {string} base64 of `version ‖ nonce ‖ ciphertext ‖ mac`.
 */
export function encrypt(plaintext, convKey, nonce = randomBytes(32)) {
  const { chachaKey, chachaNonce, hmacKey } = messageKeys(convKey, Buffer.from(nonce))
  // Counter 0, which is noble's default and what NIP-44 uses. NOT the AEAD: NIP-44 authenticates
  // with a separate HMAC over `nonce ‖ ciphertext`, and the AEAD would both shift the counter and
  // authenticate a different byte range.
  const ciphertext = Buffer.from(chacha20(new Uint8Array(chachaKey), new Uint8Array(chachaNonce), new Uint8Array(pad(plaintext))))
  const mac = createHmac('sha256', hmacKey).update(Buffer.concat([Buffer.from(nonce), ciphertext])).digest()
  return Buffer.concat([Buffer.from([NIP44_VERSION]), Buffer.from(nonce), ciphertext, mac]).toString('base64')
}

/**
 * Decrypt a NIP-44 payload. Every failure is a NAMED refusal, and the MAC is checked BEFORE the
 * ciphertext is decrypted — a reader must never act on unauthenticated plaintext.
 * @param {string} payload - base64 NIP-44 payload.
 * @param {Buffer} convKey - the conversation key from {@link conversationKey}.
 * @returns {string} the plaintext.
 */
export function decrypt(payload, convKey) {
  const { nonce, ciphertext, mac } = decodePayload(payload)
  const { chachaKey, chachaNonce, hmacKey } = messageKeys(convKey, nonce)
  const expected = createHmac('sha256', hmacKey).update(Buffer.concat([nonce, ciphertext])).digest()
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
    throw refuse(NIP44_REFUSE.MAC, 'the payload MAC does not verify under this conversation key')
  }
  // ChaCha20 is its own inverse: the same call decrypts.
  const padded = Buffer.from(chacha20(new Uint8Array(chachaKey), new Uint8Array(chachaNonce), new Uint8Array(ciphertext)))
  return unpad(padded)
}
