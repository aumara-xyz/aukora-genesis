#!/usr/bin/env node
/**
 * THE CLIENT SIDE OF THE SIGNER SOCKET — ONE PLACE THAT SPEAKS THE WIRE.
 *
 * THE LIVE BINDING ALREADY WORKS THIS WAY AND THE CONFIRM PATH MUST USE THE SAME ONE. The request travels
 * as a separate backend process over the signer's unix socket — `reissue-binding.mjs` → `askTheSigner` →
 * `signer.sock` → the signer's one-bit window — and NOT through any renderer IPC. `aumlok-bridge.mjs`
 * exports no operation channel at all (`APPROVAL_CHANNELS` is STATE/DRAW/SUBMIT/ASK/ANSWER), so a Confirm
 * button reaches the signer exactly as the re-binding does: a backend process, this function, the socket,
 * and Peter's sheet as the guard.
 *
 * WHY IT WAS EXTRACTED RATHER THAN COPIED. This function lived inside `plugins/aukora-nostr/bin/reissue-binding.mjs`.
 * A second caller copying it would be a second spelling of one wire — the timeout, the line ceiling, the
 * "every transport failure is ONE named refusal" rule and the one-compact-JSON-line protocol are all
 * decided here, and two copies of a protocol drift. `reissue-binding.mjs` now imports this, unchanged in
 * behaviour.
 *
 * IT SIGNS NOTHING AND READS NO KEY. The caller's request is serialised, written, and one line of answer
 * is parsed. Nothing in this file can produce a signature on its own, so a caller that imports it has
 * gained a transport and not an authority.
 *
 * EVERY TRANSPORT FAILURE IS ONE NAMED REFUSAL, because from the operator's side they are one fact:
 * nothing answered, so nothing may be written. A missing socket, a refused connection, a connection that
 * closes without a newline, a reply over the ceiling, a reply that is not JSON, and the timeout all
 * collapse into `unreachable` / `malformed`, which the CALLER names — see below.
 *
 * THE CALLER SUPPLIES ITS OWN NAMES, DELIBERATELY. `reissue-binding.mjs` refuses with
 * `nostr:reissue-signer-unreachable` and `nostr:reissue-signer-reply-malformed`, and those names are on
 * screens and in courts; a shared module that forced its own vocabulary would have made that caller's
 * refusals change under it. So the names are parameters and the defaults are this module's own.
 */
import { connect } from 'node:net'

/** The names this module refuses with when the caller does not supply its own. */
export const SIGNER_CLIENT_REFUSE = Object.freeze({
  /** Nothing answered: no socket, a refused connection, a close with no newline, or the timeout. */
  UNREACHABLE: 'aumlok:signer-unreachable',
  /** Something answered and it was not this protocol's response record. */
  REPLY_MALFORMED: 'aumlok:signer-reply-malformed',
})

/** The ceiling on one reply line, matching the signer's own read limit. */
export const MAX_SIGNER_REPLY_BYTES = 64 * 1024

/** How long to wait for an answer. The signer's own window is 300 s, so this outlasts a person deciding. */
export const SIGNER_CLIENT_TIMEOUT_MS = 310_000

/** One named refusal, as an `Error` whose `code` is the name. */
function namedRefusal(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

/**
 * Ask the signer one question over its socket and read ONE line of answer.
 *
 * @param {Readonly<Record<string, unknown>>} request - the wire request. It MUST carry `operation`; the
 *   signer dispatches on that name and refuses an unknown one with `aumlok:signer-operation-unknown`.
 * @param {string} socketPath - where to dial.
 * @param {Readonly<{unreachable?: string, malformed?: string, timeoutMs?: number, maxBytes?: number}>} [names]
 *   - the refusal names to use, and the two limits.
 * @returns {Promise<Readonly<Record<string, unknown>>>} the parsed reply record. A reply can be a REFUSAL
 *   record (`{domain, challenge, refusal}`) and it is returned rather than thrown: the signer answered, so
 *   the transport succeeded, and telling a refusal from a failure is the caller's business.
 * @throws {Error} the caller's `unreachable` name, or its `malformed` name.
 */
export function askSignerOperation(request, socketPath, names = {}) {
  const unreachableName = names.unreachable ?? SIGNER_CLIENT_REFUSE.UNREACHABLE
  const malformedName = names.malformed ?? SIGNER_CLIENT_REFUSE.REPLY_MALFORMED
  const timeoutMs = names.timeoutMs ?? SIGNER_CLIENT_TIMEOUT_MS
  const maxBytes = names.maxBytes ?? MAX_SIGNER_REPLY_BYTES
  return new Promise((resolvePromise, rejectPromise) => {
    const unreachable = cause => namedRefusal(unreachableName,
      `no signer answered at ${socketPath} (${cause}); start the AUKORA shell, whose signer binds this socket`)
    let received = ''
    let settled = false
    const socket = connect(socketPath)
    const finish = (error, reply) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error !== null) rejectPromise(error)
      else resolvePromise(reply)
    }
    const timer = setTimeout(() => finish(unreachable(`no answer within ${Math.round(timeoutMs / 1000)} s`), null), timeoutMs)
    socket.on('connect', () => {
      // ONE COMPACT JSON LINE, because that is the protocol: the signer reads up to the first newline and
      // parses exactly those bytes.
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on('data', chunk => {
      received += chunk.toString('utf8')
      if (received.length > maxBytes) {
        finish(namedRefusal(malformedName,
          `the signer's reply exceeded ${maxBytes} bytes, which is not a response record`), null)
        return
      }
      const newline = received.indexOf('\n')
      if (newline === -1) return
      let reply
      try {
        reply = JSON.parse(received.slice(0, newline))
      } catch (cause) {
        finish(namedRefusal(malformedName, `the signer's reply is not JSON: ${String(cause?.message ?? cause)}`), null)
        return
      }
      if (reply === null || typeof reply !== 'object') {
        finish(namedRefusal(malformedName, "the signer's reply is not a record"), null)
        return
      }
      finish(null, reply)
    })
    // A MISSING SOCKET ARRIVES HERE, AS AN ASYNC `error` EVENT, not as a throw from `connect`. It is also
    // where a socket that exists with no listener lands.
    socket.on('error', cause => finish(unreachable(String(cause?.code ?? cause?.message ?? cause)), null))
    socket.on('close', () => finish(unreachable('the signer closed the connection without answering'), null))
  })
}

/**
 * The request record for a `confirm-nostr-sas`, built here so two callers cannot disagree about its shape.
 *
 * THE FIELD NAMES ARE BETA'S, FROM `plugins/aukora-nostr/lib/confirmation.mjs` — `confirmedAt`, not
 * `issuedAt`. The signer re-derives the preimage from exactly these six fields, one line each in this
 * order, so a caller that spells one differently gets `signer:request-malformed` rather than a signature
 * over different bytes.
 *
 * @param {{subject: string, npub: string, controllerKeyHex: string, sasDigits: string, confirmedAt: string, safetyVersion: 2, challenge?: string}} input
 * @returns {Readonly<Record<string, unknown>>} the wire request.
 */
export function confirmNostrSasRequest(input) {
  // An old caller must migrate deliberately: never upgrade an unversioned comparison by adding a default.
  if (!input || input.safetyVersion !== 2 || typeof input.sasDigits !== 'string' || !/^[0-9]{70}$/u.test(input.sasDigits)) {
    throw namedRefusal('signer:request-malformed', 'the confirmation requires safety protocol 2 and 70 digits')
  }
  return Object.freeze({
    operation: 'confirm-nostr-sas',
    subject: input.subject,
    npub: input.npub,
    controllerKeyHex: input.controllerKeyHex,
    sasDigits: input.sasDigits,
    confirmedAt: input.confirmedAt,
    safetyVersion: input.safetyVersion,
    // THE CALLER'S CHALLENGE IS ADOPTED WHEN SENT, and the signer mints its own only when it is absent.
    // SENDING ONE IS WHAT MAKES A REPLAY DETECTABLE: the signer refuses a challenge it has already signed,
    // so a caller that lets the signer choose has nothing to detect a duplicate with.
    ...(input.challenge === undefined ? {} : { challenge: input.challenge }),
  })
}
