/**
 * NIP-59 GIFT WRAP + NIP-17 PRIVATE DIRECT MESSAGES.
 *
 * Three layers, and the whole point is that each one hides something the layer outside it would
 * otherwise leak:
 *
 *   rumor     kind 14   UNSIGNED. The message, its real author, its real time. Unsigned means that
 *                       if it leaks it cannot be authenticated — that is deniability, not an
 *                       oversight. It still carries an `id`, computed but not signed.
 *   seal      kind 13   signed by the REAL author, encrypted to the recipient. Reveals who wrote,
 *                       never to whom or what. Tags MUST be empty.
 *   gift wrap kind 1059 signed by a FRESH RANDOM key, encrypted to the recipient, with the only
 *                       `p` tag in the stack. Reveals the recipient to the relay that serves it —
 *                       which is exactly why NIP-17 tells relays to gate 1059 behind NIP-42 AUTH.
 *
 * THE ONE CHECK THAT MAKES THIS SAFE, AND WHY IT IS NOT OPTIONAL. The recipient can decrypt the wrap
 * and the seal, so they learn `seal.pubkey` — a key that really did sign something. They then read
 * the rumor, which carries its own `pubkey` field that nothing has signed. If those two are not
 * compared, ANY sender can put ANY pubkey in the rumor and be believed: the seal proves the sealer
 * wrote *a* rumor, not that the rumor says who wrote it. NIP-17 states this as a MUST. It is the
 * `SENDER_MISMATCH` refusal below, and it is checked after the seal's signature, never before.
 *
 * ORDERING IS PART OF THE CONTRACT. `openGiftWrap` refuses structurally, then checks the wrap is for
 * us, then decrypts — and only then verifies signatures and the sender binding. Authenticate before
 * you route: an impersonation attempt must report `SENDER_MISMATCH`, not a routing error that would
 * tell the attacker which recipient they guessed wrong.
 *
 * @module @aukora/dsh-plugin-nostr/giftwrap
 */
import { conversationKey, encrypt, decrypt, NIP44_REFUSE } from './nip44.mjs'
import { assertEventShape, eventId, isValidEvent, publicKeyOf, randomSecretKey, signEvent, verifyEvent } from './event.mjs'
import { npubDecode } from './identity.mjs'

/** Named refusals. A caller routes on these; none of them is prose to parse. */
export const GIFT_REFUSE = Object.freeze({
  WRAP_KIND: 'nostr:wrap-kind-unknown',
  WRAP_MALFORMED: 'nostr:wrap-malformed',
  WRAP_TIME: 'nostr:wrap-time-invalid',
  WRAP_NOT_FOR_US: 'nostr:wrap-not-for-us',
  WRAP_UNREADABLE: 'nostr:wrap-unreadable',
  SEAL_KIND: 'nostr:seal-kind-unknown',
  SEAL_TAGS: 'nostr:seal-has-tags',
  SEAL_UNREADABLE: 'nostr:seal-unreadable',
  RUMOR_MALFORMED: 'nostr:rumor-malformed',
  RUMOR_TIME: 'nostr:rumor-time-invalid',
  RUMOR_SIGNED: 'nostr:rumor-signed',
  RUMOR_ID: 'nostr:rumor-id-mismatch',
  SENDER_MISMATCH: 'nostr:sender-mismatch',
  RECIPIENT_MISMATCH: 'nostr:recipient-mismatch',
  SENDER_EXPECTATION: 'nostr:sender-expectation-malformed',
})

const refuse = (code, message) => Object.assign(new Error(message), { code })

function assertRumorTime(at) {
  if (!Number.isSafeInteger(at) || at < 0 || at > Math.floor(Date.now() / 1000) + 900) {
    throw refuse(GIFT_REFUSE.RUMOR_TIME, 'the rumor timestamp must be a non-negative integer no more than 900 seconds ahead')
  }
}

/** Sealed rumors, per NIP-59. */
export const SEAL_KIND = 13
/** Persistent gift wraps, per NIP-59 — the ones NIP-17 uses. */
export const GIFT_WRAP_KIND = 1059
/** Ephemeral gift wraps: same shape, and relays MUST NOT store them. */
export const EPHEMERAL_GIFT_WRAP_KIND = 21059
/** NIP-17 chat message. */
export const CHAT_MESSAGE_KIND = 14

/** NIP-17: timestamps SHOULD be randomised into the two days before now, to defeat grouping. */
const TWO_DAYS = 2 * 24 * 60 * 60

/**
 * A timestamp somewhere in the last two days. `random` is injectable so a court can be deterministic
 * without the production path becoming deterministic.
 * @param {number} [now] - seconds; defaults to the real clock.
 * @param {() => number} [random] - returns [0,1).
 * @returns {number} seconds since the epoch, in the past.
 */
function randomPastTime(now = Math.floor(Date.now() / 1000), random = Math.random) {
  return Math.round(now - random() * TWO_DAYS)
}

/**
 * Build a RUMOR: an event with a computed id and NO signature.
 * @param {object} spec - `{kind, content, tags, secretKey, createdAt}`.
 * @returns {object} the rumor, carrying `id` and never carrying `sig`.
 */
export function createRumor({ kind, content, tags = [], secretKey, createdAt }) {
  const pubkey = publicKeyOf(secretKey)
  const rumor = {
    kind,
    content,
    tags,
    pubkey,
    created_at: createdAt ?? Math.floor(Date.now() / 1000),
  }
  assertEventShape(rumor, 'the rumor')
  assertRumorTime(rumor.created_at)
  rumor.id = eventId(rumor)
  return rumor
}

/**
 * Seal a rumor: encrypt it to the recipient with the AUTHOR's real key, then sign it with that key.
 *
 * The signature is the whole reason the seal exists — it is what lets the recipient conclude
 * "the holder of this pubkey sent me something" without the relay learning anything at all.
 *
 * @param {object} rumor - from {@link createRumor}.
 * @param {object} spec - `{senderSecretKey, recipientPubkey, createdAt, now, random}`.
 * @returns {object} a signed kind-13 event with empty tags.
 */
export function sealRumor(rumor, { senderSecretKey, recipientPubkey, createdAt, now, random }) {
  if (rumor.sig !== undefined) throw refuse(GIFT_REFUSE.RUMOR_SIGNED, 'a rumor must be unsigned before sealing')
  const senderPubkey = publicKeyOf(senderSecretKey)
  // If the rumor claims a different author than the key doing the sealing, the seal would attest to
  // something the sender is not. Refuse here rather than emit a wrap that the recipient must reject.
  if (rumor.pubkey !== senderPubkey) {
    throw refuse(GIFT_REFUSE.SENDER_MISMATCH,
      `the rumor is authored by ${rumor.pubkey} and is being sealed by ${senderPubkey}`)
  }
  return signEvent({
    kind: SEAL_KIND,
    // Tags MUST be empty on a kind 13; any tag here would leak to whoever can see the seal.
    tags: [],
    content: encrypt(JSON.stringify(rumor), conversationKey(senderSecretKey, Buffer.from(recipientPubkey, 'hex'))),
    created_at: createdAt ?? randomPastTime(now, random),
    pubkey: senderPubkey,
  }, senderSecretKey)
}

/**
 * Gift wrap a sealed event under a fresh random key.
 *
 * The ephemeral key is generated per message and never reused. Reusing it would link every message
 * to one visible pubkey and undo the wrap entirely, so `ephemeralSecretKey` exists only so a court
 * can reproduce the published vector — production callers omit it.
 *
 * @param {object} event - the seal, or any signed event.
 * @param {object} spec - `{recipientPubkey, ephemeralSecretKey, createdAt, now, random, kind}`.
 * @returns {object} a signed kind-1059 (or 21059) event with one `p` tag.
 */
export function wrapEvent(event, { recipientPubkey, ephemeralSecretKey, createdAt, now, random, kind = GIFT_WRAP_KIND }) {
  verifyEvent(event, 'the event being wrapped')
  const secret = ephemeralSecretKey ?? randomSecretKey()
  const wrapperPubkey = publicKeyOf(secret)
  // A wrap signed by the real author would defeat its own purpose; a wrap reusing the sealed key is
  // always a bug and is cheap to catch here.
  if (wrapperPubkey === event.pubkey) {
    throw refuse(GIFT_REFUSE.WRAP_MALFORMED, 'the wrapping key is the author\'s own key, which would leak the author')
  }
  return signEvent({
    kind,
    tags: [['p', recipientPubkey]],
    content: encrypt(JSON.stringify(event), conversationKey(secret, Buffer.from(recipientPubkey, 'hex'))),
    created_at: createdAt ?? randomPastTime(now, random),
    pubkey: wrapperPubkey,
  }, secret)
}

/**
 * Accept a sender expectation written either as an `npub` or as 32 bytes of hex.
 *
 * MEASURED, and it cost a real debugging cycle: this comparison used to be hex-only, so a caller who
 * passed the friendly `npub` — the form a contact record and the face actually hold — matched nothing
 * and EVERY genuine message was refused as `sender-mismatch`. It fails closed rather than open, so it
 * was not a security hole, but it is the worst kind of correct: the conversation is simply empty and
 * the reason blames the sender.
 *
 * @param {string} expected - an `npub1…` string or 64 hex characters.
 * @returns {string} the expected sender as lowercase hex.
 * @throws {Error} `nostr:sender-expectation-malformed` if it is neither form.
 */
function normaliseSenderExpectation(expected) {
  const text = String(expected).trim()
  if (/^[0-9a-fA-F]{64}$/.test(text)) return text.toLowerCase()
  if (text.startsWith('npub1')) {
    try {
      return npubDecode(text)
    } catch (cause) {
      throw refuse(GIFT_REFUSE.SENDER_EXPECTATION, `the expected sender is not a valid npub: ${cause?.message ?? cause}`)
    }
  }
  throw refuse(GIFT_REFUSE.SENDER_EXPECTATION,
    `the expected sender must be an npub or 32 bytes of hex, and it is ${JSON.stringify(text.slice(0, 24))}`)
}

/**
 * Open a gift wrap addressed to us: unwrap, unseal, and verify the sender binding.
 *
 * @param {object} wrap - the kind-1059 event as received.
 * @param {object} spec - `{recipientSecretKey, expectSender?}`. `expectSender` accepts an `npub` or hex.
 * @returns {{rumor: object, seal: object, sender: string}} the message, and the key that provably sent it.
 * @throws {Error} a named `GIFT_REFUSE` code; see the module header for the ordering contract.
 */
export function openGiftWrap(wrap, { recipientSecretKey, expectSender }) {
  const us = publicKeyOf(recipientSecretKey)

  // (1) Structural, before any key is derived. A wrap with no p tag cannot be routed at all.
  if (wrap === null || typeof wrap !== 'object') throw refuse(GIFT_REFUSE.WRAP_MALFORMED, 'the gift wrap must be an object')
  if (!Number.isSafeInteger(wrap.created_at) || wrap.created_at < 0 || wrap.created_at > Math.floor(Date.now() / 1000)) {
    throw refuse(GIFT_REFUSE.WRAP_TIME, 'the gift wrap timestamp must not be in the future')
  }
  if (wrap.kind !== GIFT_WRAP_KIND && wrap.kind !== EPHEMERAL_GIFT_WRAP_KIND) {
    throw refuse(GIFT_REFUSE.WRAP_KIND, `kind ${wrap.kind} is not a gift wrap (${GIFT_WRAP_KIND} or ${EPHEMERAL_GIFT_WRAP_KIND})`)
  }
  if (!Array.isArray(wrap.tags)) throw refuse(GIFT_REFUSE.WRAP_MALFORMED, 'the gift wrap has no tags array')
  // (2) Integrity of the bytes we actually received, before anything is routed on them.
  //
  //     This verifies the WRAPPER's signature, which is a random one-time key — so it proves NOTHING
  //     about who sent the message. It proves that the event is the event that was signed and has
  //     not been altered since, which is what NIP-01 requires of any event a client acts on. The
  //     sender is established later, by the seal, and only there.
  //
  //     Verified before the routing check so a corrupted event is refused on its own terms rather
  //     than being reported as "not for us", which would misdescribe it.
  verifyEvent(wrap, 'the gift wrap')
  const recipients = wrap.tags.filter(t => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string').map(t => t[1].toLowerCase())

  // (3) Is it for us? Checked before decrypting: a wrap for somebody else is not our message to
  //     attempt, and attempting it would burn a MAC comparison on every wrap on the relay.
  if (!recipients.includes(us)) {
    throw refuse(GIFT_REFUSE.WRAP_NOT_FOR_US, `the gift wrap is addressed to ${recipients.join(', ') || 'nobody'} and we are ${us}`)
  }

  // (4) Now decrypt. The MAC is checked inside NIP-44, before any plaintext exists.
  let seal
  try {
    seal = JSON.parse(decrypt(wrap.content, conversationKey(recipientSecretKey, Buffer.from(wrap.pubkey, 'hex'))))
  } catch (cause) {
    throw refuse(GIFT_REFUSE.WRAP_UNREADABLE, `the gift wrap did not decrypt or was not JSON: ${cause.code ?? cause.message}`)
  }

  // (4) The seal must be a seal. Empty tags are a MUST, and a tag here would have leaked in the clear.
  if (seal === null || typeof seal !== 'object') throw refuse(GIFT_REFUSE.SEAL_KIND, 'the gift wrap contained no seal object')
  if (seal.kind !== SEAL_KIND) throw refuse(GIFT_REFUSE.SEAL_KIND, `the wrapped event is kind ${seal.kind}, not ${SEAL_KIND}`)
  if (!Array.isArray(seal.tags) || seal.tags.length !== 0) {
    throw refuse(GIFT_REFUSE.SEAL_TAGS, 'a kind 13 seal must carry no tags')
  }
  // The seal's signature is what authenticates the sender. Everything below depends on it.
  verifyEvent(seal, 'the seal')

  let rumor
  try {
    rumor = JSON.parse(decrypt(seal.content, conversationKey(recipientSecretKey, Buffer.from(seal.pubkey, 'hex'))))
  } catch (cause) {
    throw refuse(GIFT_REFUSE.SEAL_UNREADABLE, `the seal did not decrypt or was not JSON: ${cause.code ?? cause.message}`)
  }

  // (5) THE MUST. The seal proves `seal.pubkey` wrote something; only this comparison makes the
  //     rumor's own `pubkey` field trustworthy. Without it any sender impersonates any author.
  if (rumor === null || typeof rumor !== 'object') throw refuse(GIFT_REFUSE.RUMOR_MALFORMED, 'the seal contained no rumor object')
  if (rumor.sig !== undefined) throw refuse(GIFT_REFUSE.RUMOR_SIGNED, 'a rumor must never be signed')
  if (typeof rumor.pubkey !== 'string' || rumor.pubkey.toLowerCase() !== seal.pubkey.toLowerCase()) {
    throw refuse(GIFT_REFUSE.SENDER_MISMATCH,
      `the seal was signed by ${seal.pubkey} and the rumor claims ${rumor.pubkey}`)
  }
  // The rumor is unsigned, so its id is the only integrity check available on its own contents.
  assertEventShape(rumor, 'the rumor')
  assertRumorTime(rumor.created_at)
  const computed = eventId(rumor)
  if (rumor.id !== undefined && rumor.id.toLowerCase() !== computed) {
    throw refuse(GIFT_REFUSE.RUMOR_ID, `the rumor id is ${rumor.id} and its contents hash to ${computed}`)
  }
  rumor.id = computed

  // (6) Only now, with the sender proven, is the caller's expectation consulted.
  if (expectSender !== undefined) {
    const expected = normaliseSenderExpectation(expectSender)
    if (rumor.pubkey.toLowerCase() !== expected) {
      throw refuse(GIFT_REFUSE.RECIPIENT_MISMATCH, `the message is from ${rumor.pubkey} and ${expected} was expected`)
    }
  }

  return { rumor, seal, sender: rumor.pubkey }
}

/**
 * Send a NIP-17 direct message. Returns one gift wrap per recipient, and one for the sender.
 *
 * NIP-17 requires a wrap to each receiver AND to the sender individually, so the sender keeps a
 * readable copy of their own message — there is no shared room and no server-side history.
 *
 * @param {object} spec - `{text, senderSecretKey, recipientPubkeys, subject?, now, random}`.
 * @returns {{rumor: object, wraps: Array<{recipient: string, wrap: object}>}} the rumor and its wraps.
 */
export function composeDirectMessage({ text, senderSecretKey, recipientPubkeys, subject, now, random, replyTo }) {
  if (typeof text !== 'string' || text.length === 0) {
    throw refuse(GIFT_REFUSE.RUMOR_MALFORMED, 'a NIP-17 message must have non-empty plain text')
  }
  if (!Array.isArray(recipientPubkeys) || recipientPubkeys.length === 0) {
    throw refuse(GIFT_REFUSE.RECIPIENT_MISMATCH, 'a direct message needs at least one recipient')
  }
  const senderPubkey = publicKeyOf(senderSecretKey)
  // NIP-17: `p` tags identify the receivers, and a reply adds an `e` tag naming its parent.
  const tags = recipientPubkeys.map(pk => ['p', pk])
  if (replyTo !== undefined) tags.push(['e', replyTo])
  if (subject !== undefined) tags.push(['subject', subject])
  const rumor = createRumor({
    kind: CHAT_MESSAGE_KIND,
    content: text,
    tags,
    secretKey: senderSecretKey,
    createdAt: now ?? Math.floor(Date.now() / 1000),
  })
  // The sender's own copy is wrapped to the sender, which is how the sent message is recoverable.
  const recipients = [...new Set([...recipientPubkeys, senderPubkey])]
  const wraps = recipients.map(recipient => ({
    recipient,
    wrap: wrapEvent(sealRumor(rumor, { senderSecretKey, recipientPubkey: recipient, now, random }),
      { recipientPubkey: recipient, now, random }),
  }))
  return { rumor, wraps }
}

/** @returns {boolean} whether `event` is a gift wrap of either kind. */
export const isGiftWrap = event => event !== null && typeof event === 'object'
  && (event.kind === GIFT_WRAP_KIND || event.kind === EPHEMERAL_GIFT_WRAP_KIND)

/** Re-exported so a caller can branch on NIP-44 failures without importing two modules. */
export { NIP44_REFUSE, isValidEvent }
