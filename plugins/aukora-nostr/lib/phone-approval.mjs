/**
 * PHONE APPROVAL — a signature made on a separate device, verified here.
 *
 * WHAT THIS IS FOR. The shell draws what a person approves and can therefore lie about it, and a
 * shell-supplied boolean is a claim by the agent's own uid. This module is the other end of a path
 * where neither is true: a phone, running its own signer, displays an approval event and signs it with
 * a key that lives only there. The agent may CARRY that signature — it cannot produce one, because it
 * has neither the key nor the display.
 *
 * WHAT THIS MODULE DOES NOT DO. No transport. The relay choice (Clave's third-party relay versus
 * self-hosting) waits on Peter's phone and his trust decision, and nothing here assumes one. This is
 * the verification half: given an event, a pinned key and a frozen proposal, say yes or refuse by name.
 *
 * NO CRYPTO OF ITS OWN. Signing and verification go through `event.mjs`, which goes through the
 * vendored, pinned BIP-340 implementation. THAT IS NOT A STYLE CHOICE. `node:crypto` has secp256k1 but
 * NOT BIP-340 — measured on node v22.23.0, `sign('schnorr')` is ERR_CRYPTO_INVALID_DIGEST — and it will
 * happily verify an ECDSA signature over the same curve, which is the wrong algorithm producing a
 * confident answer. `identity.mjs:8` already records that near-miss in this lane. Reaching for
 * `node:crypto` here would be reaching for the trap.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { eventId, publicKeyOf, serializeForId, signEvent, verifyEvent } from './event.mjs'

/** The application-owned kind this deployment pins. 27235 is NIP-98's and is not available. */
export const PHONE_APPROVAL_KIND = 30333

/** The `d` tag value, so one kind can carry more than one approval family later. */
export const PHONE_APPROVAL_D_TAG = 'aukora-approval-v1'

/** Every way a phone approval can be refused, by name. */
export const PHONE_APPROVAL_REFUSE = Object.freeze({
  /** The event is not shaped like an approval at all. */
  MALFORMED: 'phone:approval-malformed',
  /** The kind is not the one this deployment pins. */
  WRONG_KIND: 'phone:approval-wrong-kind',
  /** The signing key is not the enrolled phone key. */
  UNPINNED_SIGNER: 'phone:approval-unpinned-signer',
  /** The signature does not verify under the pinned key. */
  SIGNATURE_INVALID: 'phone:approval-signature-invalid',
  /** THE SENTENCE AND THE TAGS DISAGREE — the human-readable line is not a rendering of these tags. */
  CONTENT_MISMATCH: 'phone:approval-content-mismatch',
  /** The validity window has passed. */
  EXPIRED: 'phone:approval-expired',
  /** This nonce has already been consumed. */
  NONCE_SEEN: 'phone:approval-nonce-seen',
  /** The event names an operation, scope, ledger or digest the frozen proposal does not carry. */
  SCOPE_MISMATCH: 'phone:approval-scope-mismatch',
  /** No proposal by that nonce is frozen here. */
  PROPOSAL_ABSENT: 'phone:approval-proposal-absent',
})

const refuse = (code, detail) => Object.assign(new Error(detail), { code })
const HEX64 = /^[0-9a-f]{64}$/u
const HEX128 = /^[0-9a-f]{128}$/u

/**
 * Pull one tag's value, requiring EXACTLY ONE, or undefined when absent.
 *
 * DUPLICATES ARE REFUSED RATHER THAN RESOLVED. The first version took the first match, and "first wins" is
 * a rule the SIGNER does not know: an event carrying two `digest` tags reads one way here and another way
 * to a phone that displayed the second, or to a later reader that takes the last. A tag that appears twice
 * is not a value with a precedence rule; it is an event whose meaning is ambiguous, and it is refused.
 */
const tagValue = (tags, name) => {
  const found = tags.filter(tag => Array.isArray(tag) && tag[0] === name)
  if (found.length > 1) {
    throw refuse(PHONE_APPROVAL_REFUSE.MALFORMED,
      `the approval carries ${String(found.length)} ${name} tags. An event whose meaning depends on which `
      + 'one a reader picks is ambiguous, and this refuses rather than choosing')
  }
  return found.length === 0 ? undefined : found[0][1]
}

/** The UTC clock a person reads, derived from the same seconds the tag carries. */
function clockOf(seconds) {
  return new Date(seconds * 1000).toISOString().slice(11, 16)
}

/**
 * THE SENTENCE, AND IT IS THE WHOLE TRICK.
 *
 * No mainstream NIP-46 signer renders an application-defined kind as a human summary: Amber shows the
 * RAW JSON of the event and lists that as its own UI limitation, and Clave renders kinds it knows. So
 * this module does not ask the phone to be clever. It puts a sentence in `content`, which means a
 * signer showing raw JSON is showing something a person can actually read.
 *
 * IT IS DERIVED, NEVER SUPPLIED. `verifyPhoneApproval` recomputes this from the tags and requires the
 * content to equal it, so the line a person reads cannot describe a different operation from the tags
 * the machine acts on. That is what `phone:approval-content-mismatch` exists for.
 *
 * @param {{operation: string, count: number, digest: string, expires: number}} parts - the same values the tags carry.
 * @returns {string} the one line the phone displays.
 */
/**
 * **THE PHONE SHOWS A DIGEST PREFIX, NOT THE CONTENT — AND THE CEILING SAYS SO (AUMLOK-113).**
 *
 * {@link approvalSentence} prints `digest ${digest.slice(0, 8)}`: **eight hex characters, and nothing of what
 * the operation actually does.** A person holding the phone is asked to approve from a prefix and an
 * operation name, while the record's own text — the sentence the desktop window exists to show — is not on
 * that screen at all.
 *
 * **THIS IS A REAL LIMIT AND NOT AN OVERSIGHT TO BE QUIET ABOUT.** The prefix is enough to tell two
 * DIFFERENT operations apart and to match the line against the digest the desktop showed, **and it is not
 * enough to decide whether the operation is the one you meant.** Anyone reading this ceiling should know
 * which of those two questions the phone answers.
 *
 * **PRINT IT WHEREVER THE SENTENCE IS SHOWN**, so the limit travels with the thing it limits: *a limit that
 * is not printed beside a result reads as a claim that the limit does not apply.*
 */
export const PHONE_SHOWS_DIGEST_PREFIX_NOT_CONTENT = 'PHONE_SHOWS_DIGEST_PREFIX_NOT_CONTENT'

export function approvalSentence({ operation, count, digest, expires }) {
  const records = `${String(count)} record${count === 1 ? '' : 's'}`
  return `APPROVE ${operation} ${records} · digest ${digest.slice(0, 8)} · expires ${clockOf(expires)} UTC`
}

/**
 * Build and sign an approval event. THIS IS THE PHONE'S HALF, and it exists here so the courts can
 * produce one without a phone; a real signer does the same thing with a key this process never sees.
 *
 * @param {object} input - the approval's parts plus the phone's secret key.
 * @returns {object} a signed kind-30333 event.
 */
export function buildPhoneApproval(input) {
  const tags = [
    ['d', PHONE_APPROVAL_D_TAG],
    ['op', input.operation],
    ['digest', input.digest],
    ['nonce', input.nonce],
    ['scope', input.scope],
    ['ledger', input.ledgerId],
    ['expires', String(input.expires)],
    // THE COUNT IS A TAG, NOT DECORATION. It appears in the sentence a person reads, so it has to be
    // covered by the same derivation as everything else — otherwise the line could say "3 records"
    // while the tags described another number, and the sentence check would never notice.
    ['count', String(input.count)],
    ['p', input.ownerPubkey],
  ]
  const event = {
    // THE PUBKEY IS SET BEFORE SIGNING, because the id is computed over it — the event id covers the
    // signer as well as the content, so a signer cannot be swapped after the fact.
    pubkey: publicKeyOf(input.phoneSecretKey),
    kind: PHONE_APPROVAL_KIND,
    created_at: input.createdAt,
    tags,
    content: approvalSentence({
      operation: input.operation, count: input.count, digest: input.digest, expires: input.expires,
    }),
  }
  return signEvent(event, input.phoneSecretKey)
}

/**
 * Verify a phone approval and turn it into the bound record `authoriseSettlement` consumes.
 *
 * @param {object} input - the event, the pinned key, the frozen proposal, and the spent set.
 * @returns {Readonly<object>} the bound approval record.
 * @throws {Error} one of `PHONE_APPROVAL_REFUSE`, by name.
 */
export function verifyPhoneApproval(input) {
  const { event, pinnedPubkey, proposal, now, isSpent } = input
  // NOW AND ISSPENT ARE REQUIRED, NOT DEFAULTED, AND A DEFAULT IS THE DEFECT RATHER THAN A CONVENIENCE.
  // `isSpent = () => false` made replay protection OPTIONAL AT THE CALL SITE while looking complete: a
  // caller who forgot the dependency got an approval that could be spent twice, and nothing said so. An
  // omitted `isSpent`, or a `now` that is missing or not finite, refuses BY NAME — the caller is told which
  // dependency it failed to supply rather than being given a verifier that quietly checks less.
  if (typeof isSpent !== 'function') {
    throw refuse(PHONE_APPROVAL_REFUSE.MALFORMED,
      'verifyPhoneApproval requires an isSpent dependency. Defaulting it to "nothing is spent" would make '
      + 'replay protection optional at the call site while looking present, and an approval spendable twice '
      + 'is not an approval')
  }
  if (!Number.isFinite(now)) {
    throw refuse(PHONE_APPROVAL_REFUSE.MALFORMED,
      `verifyPhoneApproval requires a finite now and got ${String(now)}. An expiry checked against an absent `
      + 'clock is a check that cannot fail')
  }
  if (event === null || typeof event !== 'object' || !Array.isArray(event.tags)) {
    throw refuse(PHONE_APPROVAL_REFUSE.MALFORMED, 'an approval is a signed event with tags, and this is not one')
  }
  if (event.kind !== PHONE_APPROVAL_KIND) {
    throw refuse(PHONE_APPROVAL_REFUSE.WRONG_KIND,
      `this deployment pins kind ${String(PHONE_APPROVAL_KIND)} for approvals and the event is kind ${String(event.kind)}`)
  }
  // THE PINNED KEY IS CHECKED BEFORE THE SIGNATURE, and the order is the honest one: the question
  // "is this even our phone?" is answerable without any cryptography, and answering it first means a
  // signature by a stranger is reported as a stranger rather than as a bad signature.
  if (typeof event.pubkey !== 'string' || event.pubkey !== pinnedPubkey) {
    throw refuse(PHONE_APPROVAL_REFUSE.UNPINNED_SIGNER,
      `the event was signed by ${String(event.pubkey).slice(0, 16)}… and this deployment has enrolled `
      + `${String(pinnedPubkey).slice(0, 16)}…. A key that is not the enrolled phone is not an approval, `
      + 'whoever holds it')
  }
  if (typeof event.sig !== 'string' || !HEX128.test(event.sig) || event.id !== eventId(event)) {
    throw refuse(PHONE_APPROVAL_REFUSE.SIGNATURE_INVALID, 'the event id does not match its own bytes')
  }
  // BIP-340, THROUGH THE VENDORED IMPLEMENTATION. Never `node:crypto`: it has no Schnorr, and its
  // secp256k1 ECDSA path would verify a DIFFERENT algorithm over the same curve.
  //
  // AND THE REFUSAL IS TRANSLATED, WHICH THE COURT FOUND BY FAILING. `verifyEvent` THROWS its own
  // `nostr:event-signature-invalid` rather than returning false, so a bad signature used to escape this
  // function under THAT name — and every caller catching `phone:approval-*` would have missed it, while
  // an ECDSA-shaped signature (exactly the wrong-algorithm case this module exists to refuse) arrived
  // looking like a generic event error. A VERIFIER SITS AT A BOUNDARY AND OWES ITS OWN NAMES.
  let signatureOk = false
  try {
    signatureOk = verifyEvent(event) === true
  } catch {
    signatureOk = false
  }
  if (!signatureOk) {
    throw refuse(PHONE_APPROVAL_REFUSE.SIGNATURE_INVALID,
      'the BIP-340 signature does not verify under the enrolled phone key')
  }

  const digest = tagValue(event.tags, 'digest')
  const nonce = tagValue(event.tags, 'nonce')
  const operation = tagValue(event.tags, 'op')
  const scope = tagValue(event.tags, 'scope')
  const ledgerId = tagValue(event.tags, 'ledger')
  const expiresRaw = tagValue(event.tags, 'expires')
  const count = Number(tagValue(event.tags, 'count') ?? 0)
  const expires = Number(expiresRaw)
  if (!HEX64.test(digest ?? '') || (nonce ?? '') === '' || (operation ?? '') === '' || (scope ?? '') === ''
    || (ledgerId ?? '') === '' || !Number.isInteger(expires)) {
    throw refuse(PHONE_APPROVAL_REFUSE.MALFORMED,
      'the approval is missing one of op, digest, nonce, scope, ledger or a whole-number expires')
  }

  // THE d AND p TAGS ARE VALIDATED AGAINST THE EXPECTED CONSTANTS, not merely read. `d` names the approval
  // family and `p` names the daemon this is for: an event addressed to another deployment's daemon, or of
  // another family under the same kind, is not this deployment's approval even with a perfect signature.
  const family = tagValue(event.tags, 'd')
  if (family !== PHONE_APPROVAL_D_TAG) {
    throw refuse(PHONE_APPROVAL_REFUSE.MALFORMED,
      `the approval is of family ${JSON.stringify(family)} and this deployment pins `
      + `${JSON.stringify(PHONE_APPROVAL_D_TAG)}`)
  }
  const recipient = tagValue(event.tags, 'p')
  if (typeof input.expectedRecipient === 'string' && recipient !== input.expectedRecipient) {
    throw refuse(PHONE_APPROVAL_REFUSE.MALFORMED,
      `the approval is addressed to ${String(recipient).slice(0, 16)}… and this deployment's daemon is `
      + `${input.expectedRecipient.slice(0, 16)}…`)
  }
  // RANGE-CHECKED BEFORE ANY DATE IS RENDERED FROM THEM. `clockOf` builds a Date from `expires`, and a
  // number outside the representable range produces "Invalid Date" rather than an error — a sentence that
  // displays nothing while every check passes.
  if (expires < 0 || expires > 8_640_000_000_000 || !Number.isSafeInteger(count) || count < 0) {
    throw refuse(PHONE_APPROVAL_REFUSE.MALFORMED,
      `expires ${String(expires)} or count ${String(count)} is outside the range this verifier can render`)
  }

  // THE SENTENCE MUST BE A RENDERING OF THESE TAGS. Recomputed here — in full, count included — from
  // the tags the machine will act on, so a person cannot be shown one operation while a different one is
  // settled. EQUALITY, NOT A PREFIX MATCH: the first version of this checked a prefix and a suffix and
  // left the middle unexamined, which is the count.
  const expected = approvalSentence({ operation, count, digest, expires })
  const content = String(event.content ?? '')
  if (content !== expected) {
    throw refuse(PHONE_APPROVAL_REFUSE.CONTENT_MISMATCH,
      `the line shown to the person reads ${JSON.stringify(content)} and the tags describe `
      + `${JSON.stringify(expected)}. The sentence is what a human reviews, so a sentence that is not a `
      + 'rendering of these tags is a review of something else')
  }

  if (expires <= now) {
    throw refuse(PHONE_APPROVAL_REFUSE.EXPIRED,
      `this approval expired at ${String(expires)} and it is now ${String(now)}`)
  }
  if (isSpent(nonce)) {
    throw refuse(PHONE_APPROVAL_REFUSE.NONCE_SEEN,
      'this nonce has already been consumed. An approval that can be spent twice is not an approval, and '
      + 'this is refused by its own name rather than by whatever check happens to run first')
  }
  if (proposal === null || proposal === undefined) {
    throw refuse(PHONE_APPROVAL_REFUSE.PROPOSAL_ABSENT,
      `no frozen proposal carries nonce ${nonce.slice(0, 12)}…`)
  }
  // THE NONCE, THE EXPIRY AND THE COUNT ARE BOUND TOO, AND BINDING ONLY THE DIGEST WAS NOT ENOUGH. A
  // digest binds the BYTES; the nonce is what the daemon spends, the expiry is how long the owner's answer
  // lasts, and the count is what the ceiling prints. An approval carrying the right digest and A DIFFERENT
  // NONCE would be consumed against the wrong proposal's one-use budget, and one with a LATER EXPIRY would
  // outlive the window the daemon froze.
  if (nonce !== proposal.nonce) {
    throw refuse(PHONE_APPROVAL_REFUSE.SCOPE_MISMATCH,
      `the approval carries nonce ${nonce.slice(0, 12)}… and the frozen proposal carries `
      + `${String(proposal.nonce).slice(0, 12)}…: the nonce is what gets spent, so it is bound like the bytes`)
  }
  if (proposal.expires !== undefined && expires !== proposal.expires) {
    throw refuse(PHONE_APPROVAL_REFUSE.SCOPE_MISMATCH,
      `the approval expires at ${String(expires)} and the frozen proposal at ${String(proposal.expires)}: an `
      + 'approval that outlives its proposal is an answer to a question no longer being asked')
  }
  if (proposal.count !== undefined && count !== proposal.count) {
    throw refuse(PHONE_APPROVAL_REFUSE.SCOPE_MISMATCH,
      `the approval names ${String(count)} records and the frozen proposal ${String(proposal.count)}`)
  }
  if (approval_mismatch({ digest, operation, scope, ledgerId }, proposal)) {
    throw refuse(PHONE_APPROVAL_REFUSE.SCOPE_MISMATCH,
      `the approval names ${operation}/${scope} ledger ${ledgerId} digest ${digest.slice(0, 12)}… and the `
      + `frozen proposal is ${String(proposal.operation)}/${String(proposal.scope)} ledger `
      + `${String(proposal.ledgerId)} digest ${String(proposal.digest).slice(0, 12)}…`)
  }

  // THE BOUND RECORD, in the shape `authoriseSettlement` already consumes. That function deliberately
  // contains no cryptography: the seam is that this module PROVES where the approval came from and hands
  // over a record, and the daemon decides what may be settled. Nothing here settles anything.
  return Object.freeze({
    nonce,
    digest,
    operation,
    scope,
    ledgerId,
    expires,
    count,
    /** WHERE THE APPROVAL CAME FROM, carried so a caller can say it rather than infer it. */
    attendance: 'phone',
    phonePubkey: event.pubkey,
    eventId: event.id,
  })
}

/** True when the approval and the frozen proposal disagree about anything the digest does not cover. */
function approval_mismatch(approval, proposal) {
  return approval.digest !== proposal.digest
    || approval.operation !== proposal.operation
    || approval.scope !== proposal.scope
    || approval.ledgerId !== proposal.ledgerId
}

/** The preimage an approval signature covers, exposed so a court can assert what is signed. */
export const phoneApprovalPreimage = serializeForId

/**
 * THE ENROLMENT SLOT — where the pinned phone key lives.
 *
 * THIS SITS BESIDE AUMLOK'S ATTENDANCE SLOT, NOT INSIDE IT, and the separation is the point: that one
 * answers "did a person attend", this one answers "which key is the phone". A phone approval is ONE
 * MORE AUTHENTICATED APPROVAL INPUT into `authoriseSettlement` in
 * `plugins/aukora-owner-daemon/lib/binding.mjs` — which reads `nonce`, `digest`, `operation`, `scope`
 * and `ledgerId` off an approval and deliberately contains no cryptography of its own. `verifyPhoneApproval`
 * returns exactly that shape, so the daemon needs no knowledge of this module and no change to accept it.
 *
 * WHAT ENROLMENT DOES NOT PROVE, and it belongs here rather than only in a plan: pinning a key says
 * "this key is the phone". It does not say the person holding the phone is who they claim, and it does
 * not survive the phone being unlocked by someone else. The pin is the anchor for everything in §5 of
 * `.agents/live/plans/beta-phone-approval.md`, and its limits are those limits.
 *
 * @param {string} stateDir - the deployment state directory.
 * @returns {string} the enrolled x-only pubkey.
 */
export function enrolledPhonePath(stateDir) {
  return join(stateDir, 'gate-state', 'phone-approval.json')
}

/**
 * Read the enrolled phone key, or null when no phone has been enrolled.
 *
 * A MALFORMED ENROLMENT IS NOT A MISSING ONE and is refused rather than read as null: "no phone is
 * enrolled, so nothing can be approved" and "an enrolment file exists and makes no sense" are different
 * facts, and the second one is the one a person needs to hear.
 *
 * @param {string} stateDir - the deployment state directory.
 * @returns {string|null} the enrolled pubkey, or null.
 * @throws {Error} `phone:approval-malformed` when the file exists and cannot be read.
 */
export function readEnrolledPhone(stateDir) {
  const file = enrolledPhonePath(stateDir)
  if (!existsSync(file)) return null
  let record
  try {
    record = JSON.parse(readFileSync(file, 'utf8'))
  } catch (cause) {
    throw refuse(PHONE_APPROVAL_REFUSE.MALFORMED,
      `${file} exists and is not JSON, so this deployment cannot say which phone it trusts: ${String(cause?.message ?? cause)}`)
  }
  const pubkey = record?.phonePubkey
  if (!HEX64.test(pubkey ?? '')) {
    throw refuse(PHONE_APPROVAL_REFUSE.MALFORMED,
      `${file} names ${String(pubkey).slice(0, 16)}… and an x-only secp256k1 pubkey is 64 lowercase hex`)
  }
  return pubkey
}
