/**
 * THE AGENT'S SIDE OF THE SETTLE SOCKET — one place that writes a proposal to the daemon.
 *
 * THE BYTES ARE SERIALISED ONCE, HERE, AND THE DIGEST THE DAEMON REPLIES WITH IS OVER EXACTLY THESE BYTES.
 * The caller hands over the operation as data; this module turns it into the one canonical line the daemon
 * freezes. A second caller building its own JSON would be a second spelling of the same proposal, and the
 * approval the owner answers would bind whichever spelling arrived.
 *
 * IT HOLDS NO AUTHORITY. It writes a proposal and reads a digest and a nonce back. It cannot approve, cannot
 * settle, and has no path to `approve.sock` — that socket is inside a directory this uid cannot traverse.
 *
 * NO FALLBACK, AND THAT IS THE POINT OF THE FUNCTION'S SHAPE: it either reaches the daemon or it throws a
 * NAMED error. A caller that caught a transport failure and settled anyway would be the shell approving
 * itself, which is the claim the daemon exists to retire.
 */
import { connect } from 'node:net'
/**
 * The most a reply may accumulate before it is refused.
 *
 * **A TIMEOUT BOUNDS DURATION, NOT MEMORY (CODEX R10, FINDING 6).** MEASURED: this accumulated
 * `received += chunk` until a newline arrived, with nothing bounding the total — so a peer that sent bytes
 * and never a newline **grew this process's heap for as long as the timeout allowed.** **A peer that can make
 * you allocate is a peer that can stop you**, and `received.indexOf` on an ever-growing string is a second
 * cost on the same input.
 *
 * It matches the frame ceiling the LISTENER already refuses at, so the two ends of one protocol agree on what
 * a frame may be; a client that accepted what its own server would refuse would be measuring neither.
 */
const MAX_REPLY_BYTES = 64 * 1024


/** The refusal a caller sees when the daemon could not be reached. */
export const OWNER_CLIENT_UNREACHABLE = 'aukora-owner:submit-unreachable'

/** How long to wait for the daemon to freeze a proposal. Freezing is local and fast; this is generous. */
export const SUBMIT_TIMEOUT_MS = 10_000

/** How long a proposal stays approvable. The person has to see it, so this is minutes rather than seconds. */
export const PROPOSAL_WINDOW_SECONDS = 600

/**
 * The exact bytes a proposal freezes, so a caller and a court can compute the same thing independently.
 * @param {{intent: unknown, words: unknown, operation?: string}} input
 * @returns {string} the canonical text.
 */
export function settleBytesFor(input) {
  return JSON.stringify({ intent: input?.intent ?? null, words: input?.words ?? null })
}

/**
 * Submit one proposal to the daemon and return what it froze.
 *
 * @param {{socketPath: string, bytes: string, operation: string, scope: string, ledgerId: string,
 *   expiresAt?: number, timeoutMs?: number, now?: number}} input
 * @returns {Promise<Readonly<{ok: true, digest: string, nonce: string, expiresAt: number}>>}
 * @throws {Error} `aukora-owner:submit-unreachable`, or the daemon's own named refusal.
 */
export function submitProposal(input) {
  const timeoutMs = input.timeoutMs ?? SUBMIT_TIMEOUT_MS
  const expiresAt = input.expiresAt
    ?? Math.floor((input.now ?? Date.now()) / 1000) + PROPOSAL_WINDOW_SECONDS
  const request = {
    op: 'submit',
    bytes: String(input.bytes),
    operation: String(input.operation),
    scope: String(input.scope),
    ledgerId: String(input.ledgerId),
    expiresAt,
  }
  return new Promise((resolvePromise, rejectPromise) => {
    let received = ''
    let settled = false
    const socket = connect(input.socketPath)
    const fail = cause => {
      if (settled) return
      settled = true
      socket.destroy()
      const error = new Error(`${OWNER_CLIENT_UNREACHABLE}: no owner daemon answered at `
        + `${String(input.socketPath)} (${String(cause)}); a proposal that could not be frozen is not `
        + 'approved, and there is no in-process fallback')
      error.code = OWNER_CLIENT_UNREACHABLE
      rejectPromise(error)
    }
    const finish = reply => {
      if (settled) return
      settled = true
      socket.destroy()
      if (reply?.ok === true) resolvePromise(Object.freeze(reply))
      else {
        const code = String(reply?.reason ?? OWNER_CLIENT_UNREACHABLE)
        const error = new Error(`${code}: the daemon refused the proposal`)
        error.code = code
        rejectPromise(error)
      }
    }
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', chunk => {
      received += chunk.toString('utf8')
      // ── AND THE ACCUMULATION IS BOUNDED (CODEX R10, FINDING 6) ───────────────────────────────────
      //
      // **MEASURED: THIS APPENDED UNTIL A NEWLINE ARRIVED, WITH NO CEILING AND NO NEWLINE EVER REQUIRED.**
      // The timeout bounded how LONG a peer could do it, not how MUCH it could make this process hold — so a
      // peer that sent bytes and no newline grew the heap for the whole timeout window. **A peer that can
      // make you allocate is a peer that can stop you.**
      if (received.length > MAX_REPLY_BYTES) {
        fail(`the reply passed ${String(MAX_REPLY_BYTES)} bytes without a newline, so it was refused rather `
          + 'than accumulated')
        return
      }
      const newline = received.indexOf('\n')
      if (newline === -1) return
      try { finish(JSON.parse(received.slice(0, newline))) } catch (cause) { fail(cause) }
    })
    socket.on('error', cause => fail(cause?.code ?? cause))
    socket.on('close', () => fail('the daemon closed without answering'))
    setTimeout(() => fail(`no answer within ${String(timeoutMs)} ms`), timeoutMs)
  })
}
