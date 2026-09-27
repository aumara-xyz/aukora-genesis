/**
 * The isolated owner signer: it holds one key, decides, and signs — nothing else.
 *
 * D2: "one isolated signer process holds the owner key, and the broker requests a
 * signature over the exact operation preimage… The signer presents the operation
 * and returns a signature or a refusal."
 *
 * THIS MODULE IS THE CORE, NOT THE PROCESS. `scripts/aumlok/signer.mjs` wraps it in
 * a Unix-socket server; keeping the decision-and-sign step separate is what lets the
 * court drive refusals without a socket, and lets a future hardware-backed key
 * source (D3) replace the key without touching the protocol.
 *
 * IT REFUSES MORE THAN IT SIGNS. Every failure path returns a named refusal rather
 * than an exception, because "the signer declined", "the request had expired" and
 * "this challenge was already used" are facts the broker must be able to report
 * without parsing prose:
 *
 *   signer:request-malformed        the record is not a request
 *   signer:request-expired          the window had closed before it arrived
 *   signer:challenge-already-seen   this exact preimage was already signed
 *   signer:no-reviewer              no decision procedure is configured
 *   signer:declined                 the review procedure said no
 *
 * THE REVIEWER IS MANDATORY AND HAS NO DEFAULT. `signer:no-reviewer` exists so that
 * a signer can never be talked into approving because nobody configured a decision.
 * What a reviewer *is* depends on the deployment — D2's "presents the operation" and
 * D3's hardware custody — and this lane ships only the labelled test approver in
 * `scripts/aumlok/signer.mjs`. It does not ship, and does not imply, a human.
 *
 * WHAT THE CONSTRUCTOR REFUSES. A signer whose own public key does not equal the
 * registered key throws at construction: it is the wrong key for this identity, and
 * signing with it would produce something the broker must reject. Failing at
 * construction means the mismatch cannot be discovered only when a signature is
 * refused, which is the moment it costs the most.
 *
 * @module @aukora/dsh-plugin-aumlok/owner-signer
 */
import { createPublicKey, sign as nodeSign } from 'node:crypto'
import {
  ApprovalError,
  approvalSigningBytes,
  createRefusedApprovalResponse,
  createSignedApprovalResponse,
  parseApprovalRequest,
  SIGNER_REFUSE,
} from './owner-approval.mjs'

/**
 * Create one signer bound to one key and one decision procedure.
 *
 * @param {object} options - the key, the identity it must already be registered under, the reviewer, and a clock.
 * @param {import('node:crypto').KeyObject} options.privateKey - Ed25519 private key.
 * @param {string} options.registeredPublicKeyHex - raw hex of the key the broker will verify with.
 * @param {(facts: {request: Readonly<Record<string, unknown>>}) => {approve: boolean}} options.review - decision procedure; no default exists.
 * @param {Set<string>} [options.seen] - challenges already signed, for a caller that owns longer-lived state.
 * @param {() => number} [options.now] - unix seconds; injectable so expiry is testable.
 * @returns {Readonly<Record<string, unknown>>} frozen signer.
 */
export function createOwnerSigner({
  privateKey,
  registeredPublicKeyHex,
  review,
  seen = new Set(),
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  const ownPublicKeyHex = rawEd25519PublicKeyHex(privateKey)
  if (ownPublicKeyHex !== registeredPublicKeyHex) {
    throw new ApprovalError(
      `owner signer: this key derives ${ownPublicKeyHex}, which is not the registered ${String(registeredPublicKeyHex)}`,
    )
  }
  /** The refusal names a REVIEWER may choose from, and nothing else. Closed, so a reviewer cannot put
   * `aumlok:locked` on the wire and blame the owner's own machine for its own failure. */
  const ASK_REFUSALS = Object.freeze([SIGNER_REFUSE.DECLINED, SIGNER_REFUSE.ASK_UNAVAILABLE])

  /** The parse, expiry, replay and reviewer checks every path shares. */
  function precheck(requestInput) {
    let request
    try {
      // `operationContent` IS A FIELD ON THE LINE, NOT OF THE RECORD. It is the eighth key a caller
      // sends so a person can be shown what they are approving, and it must never be signed — but
      // `parseApprovalRequest` is a CLOSED-RECORD reader and refuses an eighth field by name, so a
      // request carrying it is refused as `signer:request-malformed` and the caller is told its record
      // is broken when the truth is that this reader was handed the line rather than the record.
      // MEASURED, not inferred: precheck received KEYS ["domain","subject","activeControlDigest",
      // "operationDigest","challenge","issuedAt","expiresAt","operationContent"] — seven correct fields
      // plus the content — and refused it on the field list alone. The desktop signer lifts the same
      // field off before the organ call (`apps/aukora-desktop/aumlok-signer.mjs`, `signedRecord`);
      // this path — the one `scripts/aumlok/signer.mjs` actually loads — never did.
      const signedInput = requestInput !== null && typeof requestInput === 'object' && !Array.isArray(requestInput)
        ? Object.fromEntries(Object.entries(requestInput).filter(([field]) => field !== 'operationContent'))
        : requestInput
      request = parseApprovalRequest(signedInput)
    } catch {
      // AN EXPIRY THAT IS ABSENT IS NAMED FOR WHAT IT IS (Z1, 2026-09-23). `parseApprovalRequest`
      // refuses a missing `expiresAt` as a malformed record, which is true and useless: it sends the
      // caller to look at its encoding while the fact is that no window was named. The check is on the
      // OWN presence of the field, before the parser, so the refusal says the one thing missing — and
      // it is decided HERE, before any reviewer is called, so no window can open for it.
      const absent = requestInput === null || typeof requestInput !== 'object'
        || !Object.hasOwn(requestInput, 'expiresAt') || requestInput.expiresAt === null
        || requestInput.expiresAt === undefined
      return {
        response: createRefusedApprovalResponse({
          challenge: null,
          refusal: absent ? SIGNER_REFUSE.REQUEST_NO_EXPIRY : SIGNER_REFUSE.REQUEST_MALFORMED,
        }),
      }
    }
    if (now() >= request.expiresAt) {
      return { response: createRefusedApprovalResponse({ challenge: request.challenge, refusal: SIGNER_REFUSE.REQUEST_EXPIRED }) }
    }
    if (seen.has(request.challenge)) {
      return { response: createRefusedApprovalResponse({ challenge: request.challenge, refusal: SIGNER_REFUSE.CHALLENGE_ALREADY_SEEN }) }
    }
    if (typeof review !== 'function') {
      return { response: createRefusedApprovalResponse({ challenge: request.challenge, refusal: SIGNER_REFUSE.NO_REVIEWER }) }
    }
    return { request }
  }

  /** A refusal for a decision that was not a yes, with the reviewer's own name when it named one. */
  function refusalFor(request, decision) {
    const named = typeof decision?.refusal === 'string' && ASK_REFUSALS.includes(decision.refusal)
    return createRefusedApprovalResponse({
      challenge: request.challenge,
      refusal: named ? decision.refusal : SIGNER_REFUSE.DECLINED,
    })
  }

  /** Sign one request, having decided to. The clock is read AGAIN: an awaited answer took time. */
  function sign(request) {
    if (now() >= request.expiresAt) {
      return createRefusedApprovalResponse({ challenge: request.challenge, refusal: SIGNER_REFUSE.REQUEST_EXPIRED })
    }
    const signature = nodeSign(null, approvalSigningBytes(request), privateKey).toString('hex')
    seen.add(request.challenge)
    return createSignedApprovalResponse({ challenge: request.challenge, signature })
  }

  /**
   * Wait for a decision, but never past the request's OWN WINDOW.
   *
   * THE BOUND IS THE REQUEST'S `expiresAt`, NOT A NEW KNOB. A person who walks away must not leave the
   * signer holding a request open: after that instant the request is expired anyway, so waiting longer
   * can only produce a signature for a window that has closed. The clock is POLLED rather than a timer
   * computed from it, because this lane injects its clock and a duration computed from an injected
   * clock measures nothing.
   */
  function withinRequestWindow(pending, request) {
    return new Promise(settle => {
      let done = false
      const finish = value => { if (!done) { done = true; clearInterval(poll); settle(value) } }
      // NOT `unref()`ed. An unref'd timer does not keep the event loop alive, so a signer waiting with
      // nothing else to do would let the process exit mid-decision instead of answering — and the
      // interval is cleared on settle, so it cannot outlive the wait it bounds.
      const poll = setInterval(() => { if (now() >= request.expiresAt) finish(EXPIRED) }, 25)
      Promise.resolve(pending).then(finish, error => finish({ thrown: error }))
    })
  }

  return Object.freeze({
    registeredPublicKeyHex: ownPublicKeyHex,
    challengesSigned: () => seen.size,
    /**
     * Decide one request and either sign it or refuse it by name. SYNCHRONOUS, for a reviewer that
     * already knows its answer.
     * @param {unknown} requestInput - candidate request record.
     * @param {Readonly<{operationContent?: Buffer}>} [facts] - OPTIONAL facts ABOUT the request that are not part of it: today, the operation's own content bytes, so a reviewer can describe what is being approved. It is never signed and never returned, and a reviewer that ignores it changes nothing.
     * @returns {Readonly<Record<string, unknown>>} a response record.
     */
    approve(requestInput, facts = {}) {
      const pre = precheck(requestInput)
      if (pre.response !== undefined) return pre.response
      const { request } = pre
      const decision = review({ request, operationContent: facts?.operationContent })
      // A REVIEWER THAT MUST ASK A PERSON CANNOT BE ANSWERED HERE. Returning its promise would be a
      // truthy object that is not `{approve:true}`, so it would read as a decline at best — and at
      // worst a caller could mistake the pending object for consent. Refused by name instead.
      if (decision !== null && typeof decision?.then === 'function') {
        return createRefusedApprovalResponse({
          challenge: request.challenge, refusal: SIGNER_REFUSE.ASK_REQUIRES_AWAIT,
        })
      }
      if (decision?.approve !== true) return refusalFor(request, decision)
      return sign(request)
    },
    /**
     * Decide one request, AWAITING a reviewer that has to ask someone.
     * @param {unknown} requestInput - candidate request record.
     * @param {Readonly<{operationContent?: Buffer}>} [facts] - OPTIONAL facts ABOUT the request that are not part of it: today, the operation's own content bytes. Never signed, never returned.
     * @returns {Promise<Readonly<Record<string, unknown>>>} a response record; never a rejection.
     */
    async approveAsync(requestInput, facts = {}) {
      const pre = precheck(requestInput)
      if (pre.response !== undefined) return pre.response
      const { request } = pre
      let decision
      try {
        decision = await withinRequestWindow(
          review({ request, operationContent: facts?.operationContent }),
          request,
        )
      } catch (cause) {
        // A REVIEWER THAT THREW COULD NOT ASK. That is not the owner declining, and it must not unwind
        // the socket handler either — the peer is waiting for one line and gets a named refusal.
        return createRefusedApprovalResponse({
          challenge: request.challenge, refusal: SIGNER_REFUSE.ASK_UNAVAILABLE,
        })
      }
      if (decision === EXPIRED) {
        return createRefusedApprovalResponse({ challenge: request.challenge, refusal: SIGNER_REFUSE.REQUEST_EXPIRED })
      }
      if (decision?.thrown !== undefined) {
        return createRefusedApprovalResponse({
          challenge: request.challenge, refusal: SIGNER_REFUSE.ASK_UNAVAILABLE,
        })
      }
      if (decision?.approve !== true) return refusalFor(request, decision)
      return sign(request)
    },
  })
}

/** The sentinel that says the request's window closed while the reviewer was still deciding. */
const EXPIRED = Object.freeze({ expired: true })

/**
 * The registered test approver: approves every request it is shown.
 *
 * LABELLED, AND ONLY THAT. It exists so the court can drive the accepting path
 * without a human and without a fake signature. It carries no claim that anyone
 * reviewed anything — `ATTENDANCE_REPORTED_NOT_PROVEN` is printed beside every
 * signature it produces, and `scripts/aumlok/signer.mjs` names it on the command
 * line so a reader cannot mistake it for a configured policy.
 * @returns {(facts: {request: Readonly<Record<string, unknown>>}) => {approve: boolean}} the test approver.
 */
export function createTestApprover() {
  return () => ({ approve: true })
}

/** The labelled test decliner, so the refusal path is drivable end to end. */
export function createTestDecliner() {
  return () => ({ approve: false })
}

/** The raw 32-byte Ed25519 public key inside one private key, as lowercase hex. */
export function rawEd25519PublicKeyHex(privateKey) {
  if (privateKey === null || typeof privateKey !== 'object' || privateKey.type !== 'private') {
    throw new ApprovalError('owner signer: privateKey must be a private KeyObject')
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new ApprovalError(
      `owner signer: privateKey must be an Ed25519 key, received ${String(privateKey.asymmetricKeyType)}`,
    )
  }
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' })
  if (typeof jwk.x !== 'string') throw new ApprovalError('owner signer: derived public key has no JWK x coordinate')
  const raw = Buffer.from(jwk.x, 'base64url')
  if (raw.length !== 32) throw new ApprovalError('owner signer: derived Ed25519 public key is not 32 bytes')
  return raw.toString('hex')
}
