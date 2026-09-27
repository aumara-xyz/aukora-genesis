/**
 * base58btc, the multibase encoding `did:key` uses (D1).
 *
 * This is an ALPHABET TRANSLATION, not a curve implementation: base58 is
 * base-conversion plus a leading-zero rule, and it is the only new encoder this
 * lane introduces. It is deliberately the strictest form — `decode(encode(x))`
 * round-trips for every byte string, and both directions refuse anything outside
 * the alphabet rather than skipping it.
 *
 * The leading-zero rule is the classic base58 mistake: a leading `0x00` byte has
 * no representation in the numeric conversion (leading zeros do not change a
 * number), so it is emitted as a literal `1` per leading zero byte and restored
 * on decode. Without it, `0x00 || key` and `key` would encode to the same string
 * and two different public keys would share a DID.
 *
 * @module @aukora/dsh-plugin-aumlok/base58
 */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const RADIX = 58n
/** Reverse lookup, built once. Excludes 0, O, I and l, which base58 omits. */
const VALUES = new Map([...ALPHABET].map((character, index) => [character, BigInt(index)]))

/** A string that is not base58btc, or bytes that are not a byte string. */
export class Base58Error extends TypeError {}

/**
 * Encode bytes as base58btc.
 * @param {Uint8Array} bytes - byte string.
 * @returns {string} base58btc text with one leading `1` per leading zero byte.
 */
export function base58btcEncode(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Base58Error('base58btc: input must be a Uint8Array')
  let leadingZeros = 0
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1
  let value = 0n
  for (const byte of bytes) value = value * 256n + BigInt(byte)
  let encoded = ''
  while (value > 0n) {
    const remainder = value % RADIX
    value /= RADIX
    encoded = ALPHABET[Number(remainder)] + encoded
  }
  return '1'.repeat(leadingZeros) + encoded
}

/**
 * Decode base58btc text to bytes.
 * @param {string} text - base58btc text.
 * @returns {Buffer} decoded bytes, with one leading zero byte per leading `1`.
 */
export function base58btcDecode(text) {
  if (typeof text !== 'string') throw new Base58Error('base58btc: input must be a string')
  let leadingZeros = 0
  while (leadingZeros < text.length && text[leadingZeros] === '1') leadingZeros += 1
  let value = 0n
  for (const character of text) {
    const digit = VALUES.get(character)
    if (digit === undefined) throw new Base58Error(`base58btc: "${character}" is not in the base58btc alphabet`)
    value = value * RADIX + digit
  }
  const body = []
  while (value > 0n) {
    body.unshift(Number(value % 256n))
    value /= 256n
  }
  return Buffer.from([...new Array(leadingZeros).fill(0), ...body])
}
