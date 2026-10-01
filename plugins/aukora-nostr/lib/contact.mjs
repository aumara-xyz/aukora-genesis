/**
 * THE FOUR CONTACT STATES, AND THE SHORT STRING TWO PEOPLE COMPARE OUT OF BAND.
 *
 * A npub on its own proves nothing. Anyone can generate a keypair, and anyone can claim any npub, so
 * "I have an npub for my friend" is a statement about bytes and not about a person.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE TRUST ANCHOR IS THE CONTACT RECORD, NOT THIS MACHINE'S CONTROLLER.
 *
 * A contact record is `{npub, peerControllerKey, label?}`, where `peerControllerKey` is the peer's
 * AUMLOK ed25519 PUBLIC key as 64 hex characters, exchanged out of band — read aloud, scanned, or
 * carried on paper when the two people first meet. That key is the anchor: a binding for this contact
 * verifies against IT, by `verifyBindingWithKey`. The controller record on this machine is consulted
 * only for bindings WE issued, which is a different question ("did our own controller sign this?")
 * and a different function (`verifyBinding`).
 *
 * Resolving a friend's binding against our own controller answered the second question and asked
 * nobody's permission to do so: a binding signed by the friend's controller reported
 * `nostr:binding-signature-invalid` — correctly, because our key is not its signer — so EVERY peer
 * contact landed in FOREIGN and no SAS could ever be shown. The binding was fine. The anchor was wrong.
 *
 *   VERIFIED  a binding verifies under THIS CONTACT's `peerControllerKey`, and it is not TEST-labelled.
 *             The recorded peer key vouched for this npub and this subject.
 *   TEST      the same, but TEST-labelled — every binding this project can currently produce, because
 *             the only enrolled controller is disposable. The claim is structurally sound and is not
 *             yet a claim about a person.
 *   UNBOUND   no binding was presented at all. We hold an npub and no claim about whose it is. We can
 *             still exchange encrypted bytes; we just cannot say who is on the other end.
 *   FOREIGN   a binding was presented and it does NOT attest to this contact. TWO DISTINCT FACTS live
 *             here, each with its own named reason, because a caller may act differently on each:
 *               (a) the signature verifies, under a controller key that is NOT the one this contact
 *                   records — "signed by controller X, this contact records Y". Someone signed for
 *                   this npub and it was not the key we agreed to trust;
 *               (b) the signature does not verify under the contact's controller key at all — a
 *                   forged, corrupt or re-pointed document.
 *             FOREIGN is deliberately distinct from UNBOUND: "nobody vouched" and "somebody vouched
 *             for something else" are different facts, and the second is what an impersonation
 *             attempt looks like.
 *
 * A contact record whose `peerControllerKey` is not 64 hex characters is refused BY NAME
 * (`contact:peer-controller-key-malformed`), never quietly reported as FOREIGN: a typo in the anchor
 * is a different fact from a peer's binding that fails to verify, and reporting the first as the
 * second would send someone hunting an attacker when they should be re-reading a key.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE SAS: WHY IT EXISTS, AND WHAT COMPARING IT ACTUALLY PROVES.
 *
 * The binding chain has a floor: it proves "controller K vouches for npub N", never "K is the owner". No
 * amount of local verification can close that, because the missing fact is out in the world — that K
 * really is the friend's key. The only cheap thing that closes it is the two people comparing
 * something short out of band: by voice, or in person, once.
 *
 * So the face shows a short authentication string derived from the CONTACT's `peerControllerKey` and
 * the npub, and the owner and their friend read it to each other. Because both halves are in the preimage,
 * a match confirms the WHOLE contact: the key that will vouch for this identity, and the npub the
 * messages are actually encrypted to. Two npubs under one controller differ; one npub under two
 * controllers differ.
 *
 * A SAS IS PRODUCED ONLY FOR TEST AND VERIFIED. An UNBOUND or FOREIGN contact gets `sas: null` and
 * `sasFor` throws its named refusal. That is not an omission: showing one would invite two people to
 * compare and "confirm" an identity that was never proven, which is worse than showing nothing,
 * because it launders a guess into a ritual.
 *
 * This is the WEAK version of the step on purpose. `VOUCH-NETWORK-PLAN.md` describes the mutual vouch
 * ceremony — two controllers signing each other's keys — which is the stronger form of the same idea
 * and is explicitly out of scope for this lane.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * @module @aukora/dsh-plugin-nostr/contact
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ownerController, verifySasConfirmationDetailed } from './confirmation.mjs'
import { publicKeyOf } from './event.mjs'
import {
  verifyBinding, verifyBindingWithKey, verifyBindingUnderItsSigner, signerKeyOf, NOSTR_BINDING_DOMAIN, NOSTR_REFUSE,
  assertContactFields, npubDecode, npubEncode, NOSTR_SAFETY_VERSION,
} from './identity.mjs'

/** The four states. A caller routes on these; none of them is prose to parse. */
export const CONTACT_STATE = Object.freeze({
  VERIFIED: 'VERIFIED',
  // A BINDING THAT VERIFIED, WITH NO SIGNED CONFIRMATION BEHIND IT: the claim is structurally sound
  // and nobody has yet done anything about it. This is the most an unsigned label can earn.
  BOUND: 'BOUND',
  TEST: 'TEST',
  UNBOUND: 'UNBOUND',
  FOREIGN: 'FOREIGN',
})

/** Why a contact landed in FOREIGN, or why a SAS could not be produced. */
export const CONTACT_REFUSE = Object.freeze({
  NO_SAS_UNBOUND: 'contact:no-sas-without-a-binding',
  NO_SAS_FOREIGN: 'contact:no-sas-for-a-failed-binding',
  NO_NPUB: 'contact:npub-malformed',
  NO_CONTROLLER: 'contact:no-controller-record-named',
  NO_PEER_KEY: 'contact:peer-controller-key-malformed',
  NO_TRUST_ANCHOR: 'contact:no-trust-anchor-named',
  NO_LOCAL_BINDING: 'contact:local-identity-unbound',
  SAFETY_VERSION: 'contact:safety-version-mismatch',
  // The two FOREIGN facts, kept apart on purpose: a caller may act differently on "someone else's key
  // signed this" than on "nobody signed this".
  SIGNED_BY_ANOTHER_CONTROLLER: 'contact:binding-signed-by-another-controller',
  DIFFERENT_NPUB: 'contact:binding-for-a-different-npub',
})

/** The domain separator for the SAS, so the string cannot collide with any other hash in this lane. */
const SAS_DOMAIN = 'aukora:nostr-sas:v1'

/** The label that means "this binding is structurally sound and is not yet a real claim". */
export const TEST_LABEL = 'TEST'

const refuse = (code, message) => Object.assign(new Error(message), { code })

/**
 * The controller's ed25519 key, as hex, from the `did:key:` string a binding carries.
 *
 * READ FROM THE DOCUMENT LEVEL, NOT FROM `statement.approvalKeyDid`, AND THAT IS B5's CORRECTION. The
 * signed statement is the ruled five keys `{subject, npub, nostrPubkeyHex, handle, createdAt}` and
 * carries no signer, so a reader pointed into it answers null for every binding this product now
 * produces — and the FOREIGN branch below, the one that names a substituted signer, stops firing.
 * The signer rides on the DOCUMENT, as an ordinary enumerable own property, because the wire is JSON
 * and `JSON.stringify` does not serialise non-enumerable properties: a name kept out of the wire
 * format kept the in-memory arms green while every binding that actually crossed the wire arrived
 * anonymous.
 *
 * The name is a ROUTE, not an anchor: `verifyBindingUnderItsSigner` proves it by verifying the
 * signature UNDER the named key, so a document naming a key it cannot sign for fails there.
 * @param {unknown} binding - the binding document.
 * @returns {string|null} 64 lowercase hex characters, or null when there is none to read.
 */
export function controllerKeyOf(binding) {
  const did = binding?.approvalKeyDid
  if (typeof did !== 'string' || !did.startsWith('did:key:')) return null
  const hex = did.slice('did:key:'.length)
  return /^[0-9a-f]{64}$/i.test(hex) ? hex.toLowerCase() : null
}

/**
 * The short authentication string for a verified contact.
 *
 * Six decimal digits, rendered as two groups of three, because that is what two people can read to
 * each other accurately over a bad line. The digest is taken modulo 10^6 from a 64-bit slice, so the
 * bias toward low values is about one part in 1.8e13 and is not worth a rejection loop.
 *
 * @param {object} spec - `{controllerKeyHex, npub}`.
 * @returns {{digits: string, spoken: string, algorithm: string}} the SAS.
 * @throws {Error} `contact:npub-malformed` if the npub is not a string.
 */
export function sasFingerprint({ controllerKeyHex, npub }) {
  assertContactFields({ controllerKeyHex, npub })
  npubDecode(npub)
  if (typeof controllerKeyHex !== 'string' || !/^[0-9a-f]{64}$/iu.test(controllerKeyHex)) {
    throw refuse(CONTACT_REFUSE.NO_PEER_KEY, 'a SAS needs a valid controller public key')
  }
  if (typeof npub !== 'string' || npub.length === 0) {
    throw refuse(CONTACT_REFUSE.NO_NPUB, 'a SAS needs the npub it is binding')
  }
  const key = typeof controllerKeyHex === 'string' ? controllerKeyHex.toLowerCase() : ''
  const digest = createHash('sha256').update(`${SAS_DOMAIN}\n${key}\n${npub}`, 'utf8').digest('hex')
  const digits = (BigInt(`0x${digest.slice(0, 16)}`) % 1_000_000n).toString().padStart(6, '0')
  return Object.freeze({
    digits,
    spoken: `${digits.slice(0, 3)} ${digits.slice(3)}`,
    algorithm: 'sha256(aukora:nostr-sas:v1 ‖ controllerKey ‖ npub) mod 10^6',
  })
}

function boundParty({ npub, controllerKeyHex, binding }) {
  assertContactFields({ npub, controllerKeyHex, binding })
  npubDecode(npub)
  if (typeof controllerKeyHex !== 'string' || !/^[0-9a-f]{64}$/iu.test(controllerKeyHex)) {
    throw refuse(CONTACT_REFUSE.NO_PEER_KEY, 'a safety number needs a bound controller public key')
  }
  const key = controllerKeyHex.toLowerCase()
  if (binding?.statement?.npub !== npub
    || (binding.approvalKeyDid !== undefined && signerKeyOf(binding) !== key)
    || verifyBindingWithKey(binding, { controllerKeyHex: key }).verdict !== 'verified') {
    throw refuse(CONTACT_REFUSE.NO_SAS_UNBOUND, 'a safety number needs a verified binding for each identity')
  }
  return `${key}\n${npub}`
}

// Each identity has ~116 bits independently. Concatenation preserves that second-preimage
// cost against a MITM choosing two keys; hashing the pair down would invite a birthday attack.
function fingerprint(party) {
  const digest = createHash('sha256').update(JSON.stringify(['aukora:nostr-identity-fingerprint:v2', party]), 'utf8').digest('hex')
  const digits = (BigInt(`0x${digest}`) % (10n ** 35n)).toString().padStart(35, '0')
  return Object.freeze({ digits, spoken: digits.match(/.{5}/gu).join(' ') })
}

/** A bound identity's own fingerprint, distinct from any pair's safety number. */
export function identityFingerprint(identity) {
  return fingerprint(boundParty(identity))
}

/** Read-only local roots: neither a caller-supplied local key nor an unsigned identity file is an anchor. */
export function safetyNumber({ stateDir, controllerDir, npub, peerControllerKey, binding }) {
  assertContactFields({ stateDir, controllerDir, npub, peerControllerKey, binding })
  if (typeof stateDir !== 'string' || !stateDir || typeof controllerDir !== 'string' || !controllerDir) {
    throw refuse(CONTACT_REFUSE.NO_CONTROLLER, 'a safety number needs the local identity and controller roots')
  }
  let local, localVersion
  try {
    const key = JSON.parse(readFileSync(join(stateDir, 'nostr', 'identity.json'), 'utf8'))
    const localNpub = npubEncode(publicKeyOf(key.secretKeyHex))
    const localBinding = JSON.parse(readFileSync(join(stateDir, 'nostr', 'binding.json'), 'utf8'))
    local = boundParty({ npub: localNpub, controllerKeyHex: ownerController(controllerDir, signerKeyOf(localBinding)).publicHex, binding: localBinding })
    localVersion = localBinding.statement.safetyVersion
  } catch {
    // Parser/crypto errors can quote the private identity file. Never forward those bytes.
    throw refuse(CONTACT_REFUSE.NO_LOCAL_BINDING, 'the local identity has no usable controller binding')
  }
  const peer = boundParty({ npub, controllerKeyHex: peerControllerKey, binding })
  // This capability is inside each signed binding, never read from unsigned contact metadata.
  if (localVersion !== NOSTR_SAFETY_VERSION || binding.statement.safetyVersion !== NOSTR_SAFETY_VERSION) {
    throw refuse(CONTACT_REFUSE.SAFETY_VERSION, 'both identity bindings must name the current safety protocol')
  }
  const localDigits = fingerprint(local).digits
  const peerDigits = fingerprint(peer).digits
  const digits = [localDigits, peerDigits].sort().join('')
  return Object.freeze({ digits, spoken: digits.match(/.{5}/gu).join(' '),
    // Legacy wire metadata identifies the local half; it never selects a shorter comparison.
    comparisonGroupIndex: localDigits <= peerDigits ? 0 : 7 })
}

/**
 * Reduce a contact record plus whatever vouches for it to one of the four states.
 *
 * ORDERING IS THE CONTRACT, and it is the same rule the rest of this lane follows: authenticate
 * before you route. The binding is verified FIRST, against the CONTACT's `peerControllerKey`, and only
 * a binding that verifies is allowed to contribute a subject, a controller key, or a SAS. A malformed
 * or forged document is reported as FOREIGN with the underlying refusal kept in `reason` and `code`,
 * never as UNBOUND — collapsing those two would hide an impersonation attempt behind the word
 * "unknown".
 *
 * THE TWO FOREIGN REASONS ARE DIFFERENT FACTS AND STAY DIFFERENT. Because the binding is checked
 * against the recorded peer key, the resolver knows whether the signature was good before it knows
 * whose key signed it:
 *   - signature good, signer is NOT the recorded key  → `contact:binding-signed-by-another-controller`
 *     (with the two keys named), which is what a re-pointed contact or a substituted signer looks
 *     like;
 *   - signature bad under the recorded key            → the verifier's own `NOSTR_REFUSE.SIGNATURE`
 *     refusal, which is what a forged or corrupt document looks like.
 *
 * THE NPUB IS CHECKED HERE, NOT IN THE VERIFIER, AND THAT IS A REAL HOLE IF IT IS SKIPPED. The
 * verifier answers "is this statement authentic under the key I was given, and is it about the
 * subject I expect" — it has no opinion about which npub THIS CONTACT is. So an authentic binding
 * under the right key but a DIFFERENT npub verifies cleanly, and a caller that trusted that verdict
 * would attach another key's identity to this contact. Measured by the court's `different-npub` arm,
 * which was GREEN before this comparison existed and is the reason it does now.
 *
 * @param {object} input - `{npub, peerControllerKey?, binding?, expectSubject?, controllerDir?}`.
 *   `peerControllerKey` is the peer's Aumlok ed25519 public key as 64 hex characters — THE TRUST
 *   ANCHOR — and is required to resolve a peer contact. `controllerDir` is this node's own controller
 *   record and is consulted ONLY when no peer key is named, which is the self-issued case
 *   (`verifyBinding`). `expectSubject` is the routing check, applied only when supplied.
 *   A PREVIOUS shape, `expectation: {controllerDir, expectSubject?}`, was read for one revision while
 *   the face moved its call site; it is now REMOVED, because there is no remaining caller and an
 *   unread compatibility path is a second contract nobody tests. The face passes the flat fields.
 * @returns {Readonly<object>} `{state, reason, code, npub, subject, controllerKeyHex, sas, binding, verdict}`.
 */
export function resolveContact({ npub, peerControllerKey, binding, expectSubject, controllerDir, confirmation, ownerControllerDir, ownerStateDir } = {}) {
  assertContactFields({ npub, peerControllerKey, binding, expectSubject, confirmation })
  npubDecode(npub)
  if (typeof npub !== 'string' || npub.length === 0) {
    throw refuse(CONTACT_REFUSE.NO_NPUB, 'a contact needs an npub')
  }
  // THE ANCHOR IS CHECKED BEFORE THE BINDING, and never silently ignored: a contact record with a
  // truncated or mistyped key is a different fact from a peer whose binding fails to verify, and
  // reporting it as FOREIGN would send someone hunting an attacker instead of re-reading a key.
  let peerKeyHex = null
  if (peerControllerKey !== undefined && peerControllerKey !== null) {
    if (typeof peerControllerKey !== 'string' || !/^[0-9a-f]{64}$/i.test(peerControllerKey)) {
      throw refuse(CONTACT_REFUSE.NO_PEER_KEY,
        `a contact's peerControllerKey must be the peer's ed25519 public key as 64 hex characters, and this one is ${JSON.stringify(peerControllerKey)}`)
    }
    peerKeyHex = peerControllerKey.toLowerCase()
  }
  const selfIssued = peerKeyHex === null
  if (selfIssued && (typeof controllerDir !== 'string' || controllerDir.length === 0)) {
    throw refuse(CONTACT_REFUSE.NO_TRUST_ANCHOR,
      "resolving a contact needs the key this node trusts for it: the contact's peerControllerKey (the peer's ed25519 public key, hex), or controllerDir for a binding this node issued itself")
  }
  const base = { npub, subject: null, controllerKeyHex: null, sas: null, safetyNumber: null, verdict: null }

  // (1) Nothing presented. We hold a key and no claim about whose it is.
  if (binding === undefined || binding === null) {
    return Object.freeze({ ...base, state: CONTACT_STATE.UNBOUND, reason: 'no binding was presented', binding: 'absent' })
  }

  // (2) Something was presented, so it must earn its place — against the CONTACT's key, so that the
  //     verdict answers "is this my friend's npub?" and not "did I issue this?".
  //     `expectSubject` is added ONLY when the caller supplied one: `undefined` is not a subject, and
  //     passing it as one would refuse every binding whose subject nobody asked about.
  const verdict = selfIssued
    ? verifyBinding(binding, expectSubject === undefined ? { controllerDir } : { controllerDir, expectSubject })
    : verifyBindingWithKey(binding, expectSubject === undefined
      ? { controllerKeyHex: peerKeyHex }
      : { controllerKeyHex: peerKeyHex, expectSubject })
  if (verdict.verdict !== 'verified') {
    // THE TWO FOREIGN FACTS ARE DIFFERENT AND MUST NOT SHARE A REASON. A binding signed by another
    // controller and a binding nobody signed both fail under the contact's key, so the signature
    // result alone cannot tell them apart. Asking the document the narrower question — "did the key
    // it NAMES as its signer actually sign it?" — does: if it did, this is a substituted signer
    // (case a); if it did not, the document is not internally authentic at all (case b). The check
    // is for CLASSIFICATION ONLY and never decides the trust outcome: the state is FOREIGN either
    // way, and the refusal that reaches `reason`/`code` is always the one made against the key this
    // contact records.
    if (verdict.code === NOSTR_REFUSE.SIGNATURE && !selfIssued) {
      const signerKeyHex = signerKeyOf(binding)
      const underOwnSigner = signerKeyHex === null ? null : verifyBindingUnderItsSigner(binding)
      if (underOwnSigner?.verdict === 'verified') {
        return Object.freeze({
          ...base,
          state: CONTACT_STATE.FOREIGN,
          reason: `signed by controller ${signerKeyHex}, this contact records ${peerKeyHex}`,
          code: CONTACT_REFUSE.SIGNED_BY_ANOTHER_CONTROLLER,
          binding: 'refused',
      // A REFUSED CONTACT CARRIES NO STRING, and says so with `null` rather than by omitting the
      // field: a caller reading `.sas` must not have to tell "no string" from "no field".
      sas: null,
          signerKeyHex,
          verdict,
        })
      }
    }
    return Object.freeze({
      ...base,
      state: CONTACT_STATE.FOREIGN,
      reason: `${verdict.code}: ${verdict.detail}`,
      code: verdict.code,
      binding: 'refused',
      // A REFUSED CONTACT CARRIES NO STRING, and says so with `null` rather than by omitting the
      // field: a caller reading `.sas` must not have to tell "no string" from "no field".
      sas: null,
      verdict,
    })
  }

  // (3) HOW THE SIGNER CLAIM IS HELD HONEST NOW THAT IT IS OUTSIDE THE SIGNED BYTES.
  //     `approvalKeyDid` is a DOCUMENT-LEVEL field since B5, so editing it does not move the preimage
  //     and does not break the signature — the protection the signature used to give is gone BY
  //     CONSTRUCTION, and pretending otherwise would be the unsafe reading. Two checks replace it, and
  //     both are MEASURED by arms in `tests/aukora-nostr-contact.test.mjs`:
  //       · a document that names a key which did NOT sign it fails `verifyBindingUnderItsSigner` in the
  //         FOREIGN branch above — that is the classification's own route;
  //       · a document that verifies under the contact's key while naming a DIFFERENT key is refused by
  //         the coherence check in (4) below, which is what a re-pointed name looks like.
  //     Neither is an anchor: the anchor is always the contact's recorded key.

  // (4) Authentic, verified under the contact's recorded key, and about THIS npub?
  //
  // THE COHERENCE CHECK COMES FIRST, AND B5 MADE IT NECESSARY. The signer name is now a DOCUMENT-LEVEL
  // field, outside the signed bytes, so it no longer breaks the signature when it is edited (that is
  // the price of taking it out of the statement, and of closing the statement to five keys). What
  // replaces the protection the signature used to give is this comparison: the name the document gives
  // ITSELF must be the key the contact actually trusts. Without it a verified contact reported
  // `controllerKeyHex` as whatever the document SAID — so a binding signed by the peer's key but
  // carrying a stranger's name resolved VERIFIED carrying the STRANGER's name, which is a substituted
  // signer recorded as though it had vouched. MEASURED by the court's re-point arm; the earlier draft
  // of this function let that document through.
  //
  // IT PERMITS A DOCUMENT THAT NAMES NOBODY, because that is the honest reading rather than a hole:
  // the signature was proved under the contact's own key, so we know who signed whatever the document
  // calls them, and the caller is handed THAT key (`controllerKeyHex` below is the anchor, not the
  // name). What is refused is a document naming a DIFFERENT key — a claim it cannot support.
  //
  // AND IT IS A PEER-PATH RULE, DELIBERATELY. On the self-issued path the anchor is this machine's own
  // controller record, so a document that verifies under it was signed by this machine and its name
  // cannot substitute anybody: there is no third party for the name to smuggle in. Applying the
  // comparison there would only re-derive, from the document, a key the record already proved — and it
  // would read the document's name as a constraint on a record it has no authority over.
  const namedSignerHex = controllerKeyOf(binding)
  if (!selfIssued && namedSignerHex !== null && namedSignerHex !== peerKeyHex) {
    return Object.freeze({
      ...base,
      state: CONTACT_STATE.FOREIGN,
      reason: `the binding names controller ${namedSignerHex} as its signer and verifies under this contact's recorded controller ${peerKeyHex}, so its own account of who signed it is not the one we trust`,
      code: CONTACT_REFUSE.SIGNED_BY_ANOTHER_CONTROLLER,
      binding: 'refused',
      // A REFUSED CONTACT CARRIES NO STRING, and says so with `null` rather than by omitting the
      // field: a caller reading `.sas` must not have to tell "no string" from "no field".
      sas: null,
      signerKeyHex: namedSignerHex,
      verdict,
    })
  }
  if (verdict.npub !== npub) {
    return Object.freeze({
      ...base,
      state: CONTACT_STATE.FOREIGN,
      reason: `the binding is authentic and is for a DIFFERENT npub: it names ${verdict.npub} and this contact is ${npub}`,
      code: CONTACT_REFUSE.DIFFERENT_NPUB,
      binding: 'refused',
      // A REFUSED CONTACT CARRIES NO STRING, and says so with `null` rather than by omitting the
      // field: a caller reading `.sas` must not have to tell "no string" from "no field".
      sas: null,
      verdict,
    })
  }

  // (5) Only now does anything inside the statement become usable.
  const subject = typeof binding.statement?.subject === 'string' ? binding.statement.subject : null
  // THE LABEL IS A DOCUMENT-LEVEL FIELD, AND AN ABSENT LABEL MEANS `TEST`. Both halves are deliberate:
  // B5 removed the label from the signed statement, and the conservative reading of "no label" is the
  // one that cannot invent a claim about a person. A document that says nothing is TEST-labelled; only
  // a document that SAYS `VERIFIED` is treated as more than that.
  const label = typeof binding.label === 'string' ? binding.label : TEST_LABEL
  // THE SIGNER IS READ FROM TWO PLACES ON PURPOSE. `controllerKeyOf` reads `did:key:` from the
  // statement in EVERY document shape; the verdict's own field covers a self-issued verdict whose
  // statement carried no `did:key:`. Either way this names the controller that vouched, never the
  // contact's expectation.
  const controllerKeyHex = controllerKeyOf(binding)
    ?? (typeof verdict.controllerKeyHex === 'string' ? verdict.controllerKeyHex : null)
  // THE SAS IS DERIVED FROM THE ANCHOR, NOT FROM WHOEVER HAPPENED TO SIGN. Reaching here means the
  // binding verified under the contact's recorded key — the two are the same key by construction,
  // including for the self-issued path, where the controller record IS the anchor — and anchoring on
  // the recorded key keeps the string a statement about the contact both people agreed on.
  let safe = null
  let safetyRefusal = CONTACT_REFUSE.NO_LOCAL_BINDING
  if (ownerStateDir && ownerControllerDir) {
    try {
      safe = safetyNumber({ stateDir: ownerStateDir, controllerDir: ownerControllerDir,
        npub, peerControllerKey: peerKeyHex ?? controllerKeyHex, binding })
    } catch (error) {
      if (error?.code === CONTACT_REFUSE.SAFETY_VERSION) safetyRefusal = CONTACT_REFUSE.SAFETY_VERSION
    }
  }

  // (6) VERIFIED IS A SIGNED ACT, NOT A LABEL. THIS IS THE ONLY SITE THAT DECIDES A TRUST OUTCOME,
  // and until now it decided it from a string that `identity.mjs` says outright is NOT SIGNED — so
  // `label: "VERIFIED"` was a claim anybody could type. The label now earns at most BOUND. VERIFIED
  // requires a confirmation the OWNER signed over these exact values: this npub, this controller key,
  // and all 70 digits compared over a trusted out-of-band channel. The receipt attests the owner's
  // approval; the verifier cannot establish human attendance or an honest renderer.
  const confirmed = verifySasConfirmationDetailed(confirmation, {
    npub,
    controllerKeyHex: peerKeyHex ?? controllerKeyHex,
    subject,
    sasDigits: safe?.digits ?? null,
    safetyVersion: safe ? NOSTR_SAFETY_VERSION : null,
    ownerControllerDir,
  })
  const state = confirmed.verdict === 'verified'
    ? CONTACT_STATE.VERIFIED
    // A CONFIRMATION PRESENT AND NOT VERIFYING IS A REFUSAL, not a lesser claim — the same reading
    // this lane takes of a tampered binding.
    : confirmed.verdict === 'refused'
      ? CONTACT_STATE.FOREIGN
      // STALE IS NOT A REFUSAL. The owner confirmed this contact, and the binding has moved since — so
      // the confirmation is genuine and about a key that is no longer the one on the row. That is
      // exactly what BOUND means, and calling it FOREIGN would name a real signature a forgery.
      : confirmed.verdict === 'stale'
        ? CONTACT_STATE.BOUND
        : label === TEST_LABEL ? CONTACT_STATE.TEST : CONTACT_STATE.BOUND
  return Object.freeze({
    npub,
    subject,
    controllerKeyHex,
    // A REFUSED CONTACT CARRIES NO STRING, whichever way it was refused. The early FOREIGN returns
    // above say `sas: null` explicitly; this one reaches FOREIGN through the confirmation check, and it
    // must say the same thing — a caller must never read a string off a contact whose confirmation did
    // not verify. Arm 22 found this by asserting it.
    sas: state === CONTACT_STATE.FOREIGN ? null : safe,
    safetyNumber: state === CONTACT_STATE.FOREIGN ? null : safe,
    verdict,
    state,
    // THREE STATES REACH THIS RETURN AND EACH NEEDS ITS OWN SENTENCE. BOUND and VERIFIED both mean
    // "the binding verified", and if they shared a reason a caller could not tell an unconfirmed key
    // from a confirmed person without inspecting the state — which is exactly the distinction this
    // whole change exists to make. The contacts court caught the collision by counting distinct reasons.
    reason: state === CONTACT_STATE.TEST
      ? 'the binding verifies under this contact’s recorded controller key and is TEST-labelled, so it is not yet a claim about a person'
      : state === CONTACT_STATE.BOUND
        ? 'the binding verifies under this contact’s recorded controller key, and NOBODY HAS CONFIRMED IT: the person has not compared the digits, so this is a key and not yet a person'
        : state === CONTACT_STATE.FOREIGN
          ? 'the binding verifies under this contact’s recorded controller key, but the supplied confirmation did not verify for this contact under the owner’s controller key'
          : 'the binding verifies under this contact’s recorded controller key and the owner SIGNED a confirmation over this npub, this controller key and this two-party safety number',
    code: safe ? null : safetyRefusal,
    binding: 'verified',
  })
}

/**
 * The SAS for a resolved contact, or a NAMED refusal when there is none to show.
 *
 * Separate from `resolveContact` so a caller cannot accidentally render a placeholder where a real
 * comparison belongs. See the module header: a SAS that is shown for an unproven contact launders a
 * guess into a ritual.
 *
 * @param {object} contact - a result from {@link resolveContact}.
 * @returns {object} the SAS.
 * @throws {Error} `contact:no-sas-without-a-binding` or `contact:no-sas-for-a-failed-binding`.
 */
export function sasFor(contact) {
  if (contact?.sas !== null && contact?.sas !== undefined) return contact.sas
  if (contact?.state === CONTACT_STATE.UNBOUND) {
    throw refuse(CONTACT_REFUSE.NO_SAS_UNBOUND,
      'nothing vouches for this npub, so there is no string to compare — comparing one would confirm a guess')
  }
  throw refuse(CONTACT_REFUSE.NO_SAS_FOREIGN,
    'the binding did not verify, so any string derived from it would be meaningless')
}

/** @returns {boolean} whether the claim about this contact's owner is currently backed by anything. */
export const isProven = contact => contact?.state === CONTACT_STATE.VERIFIED

/** @returns {boolean} whether we can encrypt a message to this contact at all. */
export const canAddress = contact => contact?.state !== undefined && contact.state !== CONTACT_STATE.FOREIGN

/** Re-exported so a caller can reason about the binding domain without importing two modules. */
export { NOSTR_BINDING_DOMAIN }
