/**
 * The broker side of D2: ask an isolated signer, then verify what comes back.
 *
 * D2: "Transport is a local Unix socket… The broker verifies it under the
 * registered key before settlement. Absence reports `channel-unavailable`; the app
 * and inspection remain mounted."
 *
 * THE ORDER MATTERS, AND IT IS THE WHOLE DESIGN. Every approval goes through the
 * same five steps, in this order:
 *
 *   1. ADMIT the public control projection against the pinned expectation. A
 *      rotated, revoked, replaced or unbound identity is refused before any socket
 *      is opened, so a launch-pinned expectation can never be inherited by a
 *      differently controlled identity.
 *   2. BUILD the request over a FRESH 32-byte challenge and an expiry that is still
 *      in the future.
 *   3. SEND it, and treat every transport outcome as a named refusal. There is no
 *      path from "the socket was not there" to "approved".
 *   4. VERIFY the signature over the bytes the broker re-derives from ITS OWN
 *      request — never over bytes the signer returned — under the key named by
 *      `projection.approvalKeyDid`. The DID is decoded back to a key rather than
 *      matched as a string, which is D1's rule: the verifier derives the DID from
 *      the key whose signature it verified.
 *   5. CONSUME the challenge exactly once.
 *
 * NEITHER `approve` NOR `accept` THROWS. A caller rendering an application must be
 * able to show "the signer is absent" without an exception unwinding its render
 * path. Every failure on those two paths is a returned verdict with a stable name.
 * Construction is the one place that throws, and only for a socket path that is not
 * a usable string — a configuration error, not an operational one.
 *
 * WHAT A SUCCESSFUL VERDICT MEANS, AND WHAT IT DOES NOT. It means: at this instant,
 * the registered key signed these exact bytes, over this operation digest, inside
 * this window, for the identity that was pinned. It does NOT mean a person saw
 * anything — the signer may be an automated process holding a key — and it does not
 * bind an identity. `owner-approval-ceilings` prints those limits beside every
 * verdict.
 *
 * @module @aukora/dsh-plugin-aumlok/signer-channel
 */
import { randomBytes } from 'node:crypto'
import { createConnection } from 'node:net'
import { nodeCryptoVerifierCapabilities } from './control.mjs'
import { ed25519PublicKeyFromDidKey } from './did-key.mjs'
import {
  APPROVAL_REFUSE,
  approvalSigningBytes,
  createApprovalRequest,
  parseApprovalResponse,
  serializeApprovalResponse,
} from './owner-approval.mjs'
import { admitPublicControl } from './projection.mjs'
import { readDigest, readNonNegativeInteger } from './validation.mjs'
import { isNotReadyRefusal } from './signer-refusal.mjs'

/** The two names that mean "this machine is not ready to sign" rather than "the owner said no" live in
 * `signer-refusal.mjs`, beside the names themselves, so this reader and the shipped operator path
 * cannot drift apart. */

/** Longest single protocol line accepted in either direction. */
export const MAX_APPROVAL_LINE_BYTES = 64 * 1024

/** Refusals this module produces by name. */
export const SIGNER_SOCKET_PATH_REFUSE = Object.freeze({
  /**
   * The socket path is longer than the platform's `sun_path` can hold.
   *
   * ITS OWN NAME, BECAUSE THE KERNEL'S ANSWER IS A LIE BY OMISSION. MEASURED on this machine
   * (darwin, Node 22, TMPDIR 48 bytes) with `.scratch/probe-socket-path-limit.mjs` and
   * `.scratch/probe-socket-path-truncation.mjs`: a 130-byte path does NOT fail at `listen` — the bind
   * SUCCEEDS and the socket appears on disk under a TRUNCATED 104-byte name — while `lstat` and
   * `chmod` on the path that was asked for fail `ENOENT`, and a dialer using the same long path
   * CONNECTS (it truncates identically). So the failures surface as a MISSING FILE, and the two
   * guards that keep this socket the owner's are what fail first: `lstatSync` cannot see an existing
   * socket, so `aumlok:signer-socket-held` never fires, and the 0600 `chmod` cannot run at all. A
   * refusal that says "too long" is the only honest one; "no such file" sends its reader to look for
   * a file that exists under another name.
   */
  PATH_TOO_LONG: 'aumlok:signer-socket-path-too-long',
})

/**
 * How many BYTES of path this platform's `sun_path` can hold, NUL excluded.
 *
 * `struct sockaddr_un` declares `char sun_path[104]` on Darwin and `[108]` on Linux, and the kernel
 * needs one byte of it for the terminating NUL. THE DARWIN NUMBER IS MEASURED HERE; the Linux number
 * is read from the header and is NOT measured on this machine — if this lane ever ships on Linux,
 * that is the number to measure first, because a limit that is too small refuses a path that works
 * and a limit that is too large lets the truncation through.
 *
 * Anything that is neither Darwin nor Linux gets the smaller limit: being wrong in this direction
 * costs a shorter path, and being wrong in the other costs a socket nobody can find.
 * @param {string} [platform] - `process.platform`, injectable so a court can assert both numbers.
 * @returns {number} the largest usable path length, in bytes.
 */
export function socketPathLimitBytes(platform = process.platform) {
  return platform === 'linux' ? 107 : 103
}

/**
 * The named problem with a socket path, or null when it fits.
 *
 * THE REMEDY IS PART OF THE REFUSAL, because the condition is not something a reader can guess from
 * the failure: the kernel accepted the path, so nothing in the error says "shorten this".
 * @param {unknown} socketPath - the path a caller is about to bind or dial.
 * @param {string} [platform] - `process.platform`, injectable.
 * @returns {{code: string, bytes: number, limit: number, platform: string, detail: string} | null} the problem.
 */
export function socketPathLengthProblem(socketPath, platform = process.platform) {
  // NOT THIS CHECK'S BUSINESS. A missing or non-string path is refused by whatever resolves it, and a
  // second refusal about a path that does not exist would be a worse message than the first.
  if (typeof socketPath !== 'string' || socketPath.length === 0) return null
  const bytes = Buffer.byteLength(socketPath, 'utf8')
  const limit = socketPathLimitBytes(platform)
  if (bytes <= limit) return null
  return Object.freeze({
    code: SIGNER_SOCKET_PATH_REFUSE.PATH_TOO_LONG,
    bytes,
    limit,
    platform,
    detail: `the signer socket path is ${String(bytes)} bytes and ${platform}'s sun_path holds `
      + `${String(limit)} (104 bytes of struct sockaddr_un on Darwin, 108 on Linux, minus the NUL). `
      + 'THIS IS NOT A MISSING FILE, although the kernel reports it as one: a longer path does not fail '
      + 'to bind — it is TRUNCATED to its first bytes, so the socket is created under a DIFFERENT name '
      + 'and the lstat that checks for an existing socket and the chmod that keeps it owner-only both '
      + 'fail ENOENT against the name you asked for. Naming the remedy: use a path of at most '
      + `${String(limit)} bytes — set AUKORA_SIGNER_SOCKET to a short path such as `
      + '/tmp/aukora-signer.sock, or point the shell\'s state root at a shorter directory.',
  })
}

/**
 * Default time a broker waits for one signature.
 *
 * A PERSON IS ON THE OTHER END OF THIS, AND FIVE SECONDS IS NOT A PERSON. This default was 5_000 ms and
 * it was SHORTER THAN THE PRESENTATION IT WAS WAITING ON. The signer's human-facing approver is `popup`
 * in `scripts/aumlok/signer.mjs`, and that dialog waits up to 300_000 ms for a person to read the exact
 * bytes and answer it. MEASURED 2026-09-21 on the first attended run: it failed with
 *
 *     REFUSED: aumlok:channel-timeout / DETAIL: no reply within 5000ms
 *
 * **while the dialog was still on screen.** The person could answer and nothing was listening, and the
 * refusal code blamed the channel — a default that makes the documented attended path unable to succeed
 * is worse than a loud failure, because it reports a transport defect that is not there. The same
 * measurement is why `scripts/aumlok/approve-operation` waits `OPERATOR_SIGNER_TIMEOUT_MS` = 310_000 ms
 * on its own path.
 *
 * SO THIS DEFAULT IS SET ABOVE THAT DIALOG RATHER THAN BELOW IT, and it agrees with the operator
 * command's number instead of being a second opinion about how long a person has: 310_000 ms, which is
 * the dialog's 300_000 ms wait plus the ten seconds the round trip itself may take. `timeoutMs` still
 * overrides it per call, and a court that needs a fast refusal passes a short one.
 *
 * WHAT IT IS NOT. It is not an approval window: the window is the request's own `expiresAt`, checked by
 * the signer AND re-checked by the broker after the round trip, and a request that expired is refused
 * by name regardless of this number. This bounds only how long a broker holds a socket open.
 */
export const DEFAULT_SIGNER_TIMEOUT_MS = 310_000

const verifyEd25519 = nodeCryptoVerifierCapabilities().verifyEd25519

/**
 * Open one session against one identity and one signer socket.
 *
 * The projection is re-admitted on EVERY approval rather than captured once, so a
 * rotation or revocation that happens between two approvals is caught by the second
 * one. That is the check-at-use property the broker state module states as its
 * reason for re-reading at each check.
 *
 * @param {object} options - the pinned identity, the socket, and the clock.
 * @param {unknown} options.projection - result of `projectPublicControl`.
 * @param {unknown} options.expectation - the launch-pinned `{subject, activeControlDigest, epoch?}`.
 * @param {string} options.socketPath - local Unix socket the signer is listening on.
 * @param {number} [options.timeoutMs] - per-request wait.
 * @param {() => number} [options.now] - unix seconds; injectable so expiry is testable.
 * @returns {Readonly<Record<string, unknown>>} frozen session.
 */
export function createOwnerApprovalSession({
  projection,
  expectation,
  socketPath,
  timeoutMs = DEFAULT_SIGNER_TIMEOUT_MS,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  if (typeof socketPath !== 'string' || socketPath.length === 0) {
    throw new TypeError('owner approval session: socketPath must be a non-empty string')
  }
  const spent = new Set()

  /** Verify one response against the request the broker itself built. */
  function accept({ request, response, at = now() }) {
    let parsed
    try {
      parsed = parseApprovalResponse(response)
    } catch (cause) {
      return refuse(APPROVAL_REFUSE.CHANNEL_PROTOCOL, cause instanceof Error ? cause.message : String(cause))
    }
    if (parsed.kind === 'refused') {
      // AN UNREADY SIGNER IS NOT A DECISION, AND COLLAPSING THE TWO TELLS A PERSON SOMETHING UNTRUE.
      // "The owner declined" and "this machine holds no root to sign with" both arrive as `refused`,
      // and only one of them is true at a time. The not-ready names pass through as their OWN reasons
      // rather than being reported as a refusal that never happened.
      if (isNotReadyRefusal(parsed.refusal)) {
        return refuse(parsed.refusal, `the signer is not ready: ${parsed.refusal}`)
      }
      return refuse(APPROVAL_REFUSE.REFUSED, `the signer refused with ${parsed.refusal}`)
    }
    if (parsed.challenge !== request.challenge) {
      return refuse(
        APPROVAL_REFUSE.CHALLENGE_MISMATCH,
        `the response names challenge ${parsed.challenge}, not the one that was sent`,
      )
    }
    if (at >= request.expiresAt) {
      return refuse(
        APPROVAL_REFUSE.EXPIRED,
        `the approval window closed at ${String(request.expiresAt)} and it is now ${String(at)}`,
      )
    }
    if (spent.has(request.challenge)) {
      return refuse(APPROVAL_REFUSE.REPLAYED, `challenge ${request.challenge} has already been accepted once`)
    }
    // The challenge is consumed before verification, not after: a response that
    // failed verification must not leave its challenge reusable, or a caller could
    // retry a tampered response indefinitely against one challenge.
    spent.add(request.challenge)
    let registeredPublicKeyHex
    try {
      registeredPublicKeyHex = ed25519PublicKeyFromDidKey(projection?.approvalKeyDid)
    } catch (cause) {
      return refuse(
        APPROVAL_REFUSE.UNAVAILABLE,
        `the projection names no usable approval key: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
    if (!verifyEd25519(registeredPublicKeyHex, approvalSigningBytes(request), parsed.signature)) {
      return refuse(
        APPROVAL_REFUSE.SIGNATURE_INVALID,
        `the signature does not verify under the registered key ${String(projection?.approvalKeyDid)}`,
      )
    }
    return Object.freeze({
      ok: true,
      subject: request.subject,
      activeControlDigest: request.activeControlDigest,
      approvalKeyDid: projection.approvalKeyDid,
      operationDigest: request.operationDigest,
      challenge: request.challenge,
      signature: parsed.signature,
      verifiedAt: at,
    })
  }

  return Object.freeze({
    spentChallenges: () => [...spent],
    accept,
    /**
     * Ask the signer for one approval and verify what comes back.
     * @param {{operationDigest: unknown, expiresAt: unknown}} input - the operation digest and the window.
     * @returns {Promise<Readonly<Record<string, unknown>>>} verdict, never an exception.
     */
    async approve({ operationDigest, expiresAt } = /** @type {never} */ ({})) {
      const admitted = admitPublicControl({ projection, expected: expectation })
      if (!admitted.ok) {
        return refuse(APPROVAL_REFUSE.UNAVAILABLE, `${admitted.reason}: ${admitted.detail}`)
      }
      let digest
      let window
      try {
        digest = readDigest(operationDigest, 'owner approval operationDigest')
        window = readNonNegativeInteger(expiresAt, 'owner approval expiresAt')
      } catch (cause) {
        return refuse(APPROVAL_REFUSE.MALFORMED, cause instanceof Error ? cause.message : String(cause))
      }
      const issuedAt = now()
      if (window <= issuedAt) {
        return refuse(
          APPROVAL_REFUSE.EXPIRED,
          `expiresAt ${String(window)} is not in the future (it is ${String(issuedAt)})`,
        )
      }
      const request = createApprovalRequest({
        subject: admitted.subject,
        activeControlDigest: admitted.activeControlDigest,
        operationDigest: digest,
        challenge: randomBytes(32).toString('hex'),
        issuedAt,
        expiresAt: window,
      })
      const exchange = await exchangeLine({
        socketPath,
        line: `${JSON.stringify(request)}\n`,
        timeoutMs,
      })
      if (!exchange.ok) return refuse(exchange.reason, exchange.detail)
      let response
      try {
        response = JSON.parse(exchange.text)
      } catch (cause) {
        return refuse(
          APPROVAL_REFUSE.CHANNEL_PROTOCOL,
          `the signer's reply is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
      // `now()` again: the round trip took time, and the window may have closed in it.
      return accept({ request, response })
    },
  })
}

/**
 * Send one line to a Unix socket and read one line back.
 *
 * Bounded in both directions and bounded in time. An over-long reply is a protocol
 * failure rather than a truncation, because a truncated JSON document that happens
 * to parse is how a partial signature becomes a whole one.
 *
 * @param {{socketPath: string, line: string, timeoutMs: number}} options - where, what, how long.
 * @returns {Promise<{ok: true, text: string} | {ok: false, reason: string, detail: string}>} the reply text or a named channel refusal.
 */
export function exchangeLine({ socketPath, line, timeoutMs }) {
  return new Promise(resolve => {
    // CHECKED BEFORE THE CONNECT, WITH THE SAME FUNCTION THE BINDER USES. A dial to a truncated path
    // CONNECTS (measured), so this is not about the socket being absent — but everything else about
    // such a path fails as ENOENT, and `aumlok:channel-unavailable` would send its reader to start a
    // signer that is already running under a name they cannot see.
    const problem = socketPathLengthProblem(socketPath)
    if (problem !== null) {
      resolve({ ok: false, reason: problem.code, detail: problem.detail })
      return
    }
    let settled = false
    let received = ''
    const socket = createConnection(socketPath)
    /** Settle once, and always tear the socket down. */
    const finish = verdict => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(verdict)
    }
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => socket.write(line))
    socket.on('data', chunk => {
      received += chunk.toString('utf8')
      // THE CEILING PRINTS ITSELF WHEN IT BINDS. `MAX_APPROVAL_LINE_BYTES` was enforced here and named
      // nowhere: the refusal said "the reply exceeded the line limit" and gave neither the limit nor the
      // size it bound against, so a reader met `aumlok:channel-protocol` and could not tell a limit from
      // a malformed peer, could not tell 65 KiB from 6 MiB, and had no number to change. The bytes
      // observed are read from the same accumulator the check just read, so the message describes the
      // comparison that actually happened rather than a second measurement of it.
      const observedBytes = Buffer.byteLength(received, 'utf8')
      if (observedBytes > MAX_APPROVAL_LINE_BYTES) {
        finish({
          ok: false,
          reason: APPROVAL_REFUSE.CHANNEL_PROTOCOL,
          detail: `the reply exceeded the line limit of ${String(MAX_APPROVAL_LINE_BYTES)} bytes; `
            + `${String(observedBytes)} bytes had arrived when the ceiling bound`,
        })
        return
      }
      const newline = received.indexOf('\n')
      if (newline !== -1) finish({ ok: true, text: received.slice(0, newline) })
    })
    socket.on('end', () => {
      // THE SAME TREATMENT FOR THE NEIGHBOURING REFUSAL. "The signer closed without a reply line" is a
      // fact ABOUT how much arrived — a peer that sent nothing, a peer that sent 97 bytes and stopped,
      // and a peer that sent 60 KiB of unterminated JSON are three different faults, and the count is
      // what tells them apart. Zero is printed as zero rather than omitted.
      const arrivedBytes = Buffer.byteLength(received, 'utf8')
      finish(received.includes('\n')
        ? { ok: true, text: received.slice(0, received.indexOf('\n')) }
        : {
            ok: false,
            reason: APPROVAL_REFUSE.CHANNEL_PROTOCOL,
            detail: `the signer closed without a reply line; ${String(arrivedBytes)} bytes had arrived `
              + `and none of them was a newline`,
          })
    })
    socket.on('timeout', () => {
      finish({
        ok: false,
        reason: APPROVAL_REFUSE.CHANNEL_TIMEOUT,
        detail: `no reply within ${String(timeoutMs)}ms`,
      })
    })
    socket.on('error', error => {
      finish({
        ok: false,
        reason: APPROVAL_REFUSE.CHANNEL_UNAVAILABLE,
        detail: `${String(error?.code ?? 'error')}: ${error instanceof Error ? error.message : String(error)}`,
      })
    })
  })
}

/**
 * Serialize one response the way the daemon writes it.
 * @param {unknown} response - candidate response record.
 * @returns {string} one newline-terminated line.
 */
export function encodeApprovalResponse(response) {
  return serializeApprovalResponse(response)
}

/** One named refusal verdict. */
function refuse(reason, detail) {
  return Object.freeze({ ok: false, reason, detail })
}
