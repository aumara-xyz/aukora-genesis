/**
 * NIP-01 EVENTS: canonical id, and BIP-340 signing over the vendored curve.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE GIFT WRAP. Three layers of NIP-17 — rumor, seal, gift wrap —
 * are all "an event" with the same id rule and the same signature rule, and they differ only in
 * which key signs them and whether they are signed at all. Putting the id and signature rules here
 * means the impersonation check in `giftwrap.mjs` can be stated against one implementation instead
 * of three, and means the published NIP-59 example can be checked layer by layer.
 *
 * THE ID IS NOT A HASH OF THE JSON YOU HAPPEN TO PRODUCE. It is sha256 over a canonical
 * serialization — `[0, pubkey, created_at, kind, tags, content]` — with those six elements in that
 * order and no `id` or `sig` field. Two encoders that emit different whitespace or different key
 * order still agree on the id, which is what makes ids portable. Note this is NOT the same string as
 * the event JSON: `JSON.stringify` is applied to the ARRAY, not the object.
 *
 * @module @aukora/dsh-plugin-nostr/event
 */
import { createHash } from 'node:crypto'
import { secp256k1, schnorr } from './vendor/noble-curves/curves/secp256k1.js'

/** Named refusals. A caller routes on these; none of them is prose to parse. */
export const EVENT_REFUSE = Object.freeze({
  MALFORMED: 'nostr:event-malformed',
  PUBKEY: 'nostr:event-pubkey-malformed',
  ID: 'nostr:event-id-mismatch',
  SIGNATURE: 'nostr:event-signature-invalid',
  SECRET: 'nostr:event-secret-malformed',
})

const refuse = (code, message) => Object.assign(new Error(message), { code })

/** A 32-byte x-only key in lowercase hex. Uppercase is accepted on input and normalised. */
const HEX32 = /^[0-9a-fA-F]{64}$/

/**
 * A BIP-340 signature: 64 BYTES, which is 128 hex characters.
 *
 * Not the same width as a key or an id. Reusing the 32-byte pattern here rejects every genuine
 * signature with "must be 64 bytes of hex" about a 128-character string — which is how this
 * constant came to exist.
 */
const HEX_SIG = /^[0-9a-fA-F]{128}$/

/** @returns {boolean} whether `value` is a 32-byte hex string. */
export const isHex32 = value => typeof value === 'string' && HEX32.test(value)

/** @returns {boolean} whether `value` is a 64-byte hex string, the width of a BIP-340 signature. */
export const isHexSignature = value => typeof value === 'string' && HEX_SIG.test(value)

/**
 * A secret key as raw bytes, from either hex or raw form.
 *
 * `Buffer.from('ab'.repeat(32))` is 64 BYTES of UTF-8, not 32 bytes of key — a string secret must
 * always be read as hex. Getting this wrong produces "secret key must be exactly 32 bytes" for a
 * perfectly good nsec, which is how this helper came to exist.
 */
function toSecretBytes(secretKey, what = 'a secret key') {
  const secret = typeof secretKey === 'string' ? Buffer.from(secretKey, 'hex') : Buffer.from(secretKey)
  if (secret.length !== 32) throw refuse(EVENT_REFUSE.SECRET, `${what} must be exactly 32 bytes`)
  return secret
}

/** @returns {string} the lowercase hex x-only public key for a secret key, given as hex or bytes. */
export function publicKeyOf(secretKey) {
  const secret = toSecretBytes(secretKey)
  try {
    return Buffer.from(schnorr.getPublicKey(new Uint8Array(secret))).toString('hex')
  } catch (cause) {
    throw refuse(EVENT_REFUSE.SECRET, `not a usable secp256k1 secret: ${cause.message}`)
  }
}

/** @returns {string} a fresh 32-byte secret key as lowercase hex. */
export function randomSecretKey() {
  return Buffer.from(secp256k1.utils.randomSecretKey()).toString('hex')
}

/**
 * Validate the shape of an event before any of its bytes are hashed.
 *
 * Every field is checked because the id is a hash of all of them: an event missing `tags` would
 * serialise as `[0,pk,ts,kind,null,""]`, hash to something, and produce an id that no other
 * implementation computes — a failure that surfaces at a relay rather than here.
 *
 * @param {object} event - the event to check.
 * @param {string} [what] - a label for the refusal message.
 * @throws {Error} `nostr:event-malformed` or `nostr:event-pubkey-malformed`.
 */
export function assertEventShape(event, what = 'event') {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    throw refuse(EVENT_REFUSE.MALFORMED, `${what} must be an object`)
  }
  if (!isHex32(event.pubkey)) throw refuse(EVENT_REFUSE.PUBKEY, `${what} pubkey must be 32 bytes of hex`)
  if (!Number.isInteger(event.created_at) || event.created_at < 0) {
    throw refuse(EVENT_REFUSE.MALFORMED, `${what} created_at must be a non-negative integer`)
  }
  if (!Number.isInteger(event.kind) || event.kind < 0) {
    throw refuse(EVENT_REFUSE.MALFORMED, `${what} kind must be a non-negative integer`)
  }
  if (typeof event.content !== 'string') throw refuse(EVENT_REFUSE.MALFORMED, `${what} content must be a string`)
  if (!Array.isArray(event.tags)) throw refuse(EVENT_REFUSE.MALFORMED, `${what} tags must be an array`)
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag.length === 0 || tag.some(v => typeof v !== 'string')) {
      throw refuse(EVENT_REFUSE.MALFORMED, `${what} has a tag that is not a non-empty array of strings`)
    }
  }
}

/**
 * The canonical NIP-01 serialization the id is hashed from.
 * @param {object} event - an event whose shape has been checked.
 * @returns {string} the JSON of `[0, pubkey, created_at, kind, tags, content]`.
 */
export function serializeForId(event) {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
}

/**
 * The event id: sha256 of the canonical serialization, as lowercase hex.
 * @param {object} event - the event.
 * @returns {string} 64 hex characters.
 */
export function eventId(event) {
  assertEventShape(event)
  return createHash('sha256').update(serializeForId(event)).digest('hex')
}

/**
 * Sign an event in place: computes `id`, then a BIP-340 signature over it.
 *
 * `id` is signed as 32 raw bytes, not as its hex text — signing the text produces a signature that
 * verifies nowhere, and it verifies here only if the verifier makes the same mistake.
 *
 * @param {object} event - the event to sign; must not carry its own `sig`.
 * @param {string|Uint8Array} secretKey - 32 bytes, hex or raw.
 * @returns {object} the same object, now carrying `id` and `sig`.
 */
export function signEvent(event, secretKey) {
  assertEventShape(event, 'the event being signed')
  const secret = toSecretBytes(secretKey)
  // The signer's key must be the key the event claims, or the signature proves something other than
  // what the event says. This is cheap here and is the whole of impersonation if it is missing.
  const claimed = publicKeyOf(secret)
  if (claimed !== event.pubkey.toLowerCase()) {
    throw refuse(EVENT_REFUSE.PUBKEY, `event claims pubkey ${event.pubkey} and the signing key is ${claimed}`)
  }
  event.pubkey = claimed
  event.id = eventId(event)
  event.sig = Buffer.from(schnorr.sign(Buffer.from(event.id, 'hex'), new Uint8Array(secret))).toString('hex')
  return event
}

/**
 * Verify an event's id and signature.
 * @param {object} event - the event to verify.
 * @param {string} [what] - a label for refusal messages.
 * @returns {true} if valid.
 * @throws {Error} `nostr:event-id-mismatch` or `nostr:event-signature-invalid`.
 */
export function verifyEvent(event, what = 'event') {
  assertEventShape(event, what)
  if (!isHex32(event.id)) throw refuse(EVENT_REFUSE.MALFORMED, `${what} id must be 32 bytes of hex`)
  if (!isHexSignature(event.sig)) throw refuse(EVENT_REFUSE.MALFORMED, `${what} sig must be 64 bytes of hex`)
  const computed = eventId(event)
  if (computed !== event.id.toLowerCase()) {
    throw refuse(EVENT_REFUSE.ID, `${what} id is ${event.id} and its contents hash to ${computed}`)
  }
  let ok
  try {
    ok = schnorr.verify(Buffer.from(event.sig, 'hex'), Buffer.from(event.id, 'hex'), Buffer.from(event.pubkey, 'hex'))
  } catch (cause) {
    throw refuse(EVENT_REFUSE.SIGNATURE, `${what} signature is malformed: ${cause.message}`)
  }
  if (ok !== true) throw refuse(EVENT_REFUSE.SIGNATURE, `${what} signature does not verify under ${event.pubkey}`)
  return true
}

/** @returns {boolean} whether the event verifies; the boolean form, for callers that only branch. */
export function isValidEvent(event) {
  try { verifyEvent(event); return true } catch { return false }
}
