/**
 * The Nostr lane's public surface.
 *
 * `package.json` names this as `main` and as the `.` export. It re-exports rather than implements, so
 * a reader can see the whole lane in one screen and knows which module owns what:
 *
 *   identity   the per-node secp256k1 key, npub, and the Aumlok-signed binding that says who owns it
 *              (verified against THIS node's controller record, or against a peer's controller key
 *              handed over out of band — two anchors, two questions, one set of structural rules)
 *   event      NIP-01 ids and BIP-340 signatures — the layer every signed object here is built on
 *   nip44      the payload encryption, interoperable and proven against the published vectors
 *   giftwrap   NIP-59 rumor/seal/wrap and the NIP-17 direct-message composition
 *   relay      publishing and reading over public relays, with offline as a named state
 *   contact    the four contact states, resolved against a contact's recorded peer controller key,
 *              and the short string two people compare out of band
 *
 * Nothing here has default exports and nothing here is a class, deliberately: every entry point is a
 * plain function whose failure is a NAMED code on the thrown error, so a caller routes on a string
 * rather than parsing prose.
 *
 * @module @aukora/dsh-plugin-nostr
 */
export {
  NOSTR_BINDING_DOMAIN,
  NOSTR_REFUSE,
  NOSTR_CEILINGS,
  npubEncode,
  npubDecode,
  loadOrCreateNostrKey,
  bindingPreimage,
  createBinding,
  verifyBinding,
  verifyBindingWithKey,
  verifyBindingUnderItsSigner,
  signerKeyOf,
} from './identity.mjs'

export {
  EVENT_REFUSE,
  isHex32,
  isHexSignature,
  publicKeyOf,
  randomSecretKey,
  assertEventShape,
  serializeForId,
  eventId,
  signEvent,
  verifyEvent,
  isValidEvent,
} from './event.mjs'

export {
  NIP44_VERSION,
  NIP44_REFUSE,
  calcPaddedLen,
  conversationKey,
  encrypt as nip44Encrypt,
  decrypt as nip44Decrypt,
} from './nip44.mjs'

export {
  GIFT_REFUSE,
  SEAL_KIND,
  GIFT_WRAP_KIND,
  EPHEMERAL_GIFT_WRAP_KIND,
  CHAT_MESSAGE_KIND,
  createRumor,
  sealRumor,
  wrapEvent,
  openGiftWrap,
  composeDirectMessage,
  isGiftWrap,
} from './giftwrap.mjs'

export {
  CONTACT_STATE,
  CONTACT_REFUSE,
  TEST_LABEL,
  controllerKeyOf,
  sasFingerprint,
  resolveContact,
  sasFor,
  isProven,
  canAddress,
} from './contact.mjs'

export {
  RELAY_STATE,
  RELAY_REFUSE,
  DEFAULT_RELAYS,
  publishToRelays,
  fetchGiftWraps,
  relaySummary,
} from './relay.mjs'
