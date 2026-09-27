/** Operator-side join between authenticated broker reviews and the issuer's raw approval carrier. */
import { createServer } from 'node:net'
import { assertOperatorChannel } from '../aukora/issuer/approval-carrier.mjs'
import { installIssuerApprovalBridge } from '../aukora/supervisor/issuer-approval-bridge.mjs'
import { connectReviewTransport } from './launchd-review-transport.mjs'
import { listenPrivateSocket } from './launchd-socket-listener.mjs'

/**
 * Attach one terminal to an existing broker and serve one issuer connection.
 * The caller verifies the broker route, protects the operator directory, and
 * provisions any issuer-only group. Raw issuer bytes are never displayed;
 * reviewIssuer receives only a prompt matched to this terminal's prior approval.
 * Any channel failure closes both connections; reconnecting inherits no approvals.
 * @param {import('./launchd-issuer-review.mjs').IssuerReviewOptions} options - pinned routes and terminal callbacks.
 * @returns {Promise<import('./launchd-issuer-review.mjs').IssuerReviewConnection>} operator listener and complete close status.
 */
export async function connectIssuerReview({ issuerSocketPath, issuerSocketMode = 0o600, issuerSocketGid, ...options }) {
  const terminal = await connectReviewTransport(options)
  let publication
  let closing
  let ready = false
  let problem
  let finishClosed
  const closed = new Promise(resolve => { finishClosed = resolve })
  const peers = new Map()
  const close = (error) => {
    if (error !== undefined) problem ??= error instanceof Error ? error : new Error(String(error))
    closing ??= Promise.resolve().then(async () => {
      ready = false
      for (const peer of peers.keys()) peer.destroy()
      const results = await Promise.allSettled([terminal.close(), publication?.close(), ...peers.values()])
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
      if (errors.length) { problem ??= new AggregateError(errors, 'aukora:issuer-review:cleanup-failed'); throw problem }
    }).finally(finishClosed)
    return closing
  }
  const stop = error => {
    if (closing) return
    void close(error).catch(() => { /* close records the error for the terminal owner. */ })
  }
  const listener = createServer(socket => {
    if (!ready || closing || peers.size !== 0) { socket.destroy(); return }
    peers.set(socket, new Promise(resolve => socket.once('close', resolve)))
    socket.once('close', () => { peers.delete(socket); stop(new Error('aukora:issuer-review:issuer-disconnected')) })
    socket.on('error', stop)
    installIssuerApprovalBridge({ stdin: socket, stderr: socket,
      once: socket.once.bind(socket), removeListener: socket.removeListener.bind(socket) },
    (request, signal) => terminal.requestIssuerReview(request, signal),
    () => { /* Raw diagnostics are unvalidated; only the bound renderer may display a prompt. */ }, stop)
  })
  try {
    publication = await listenPrivateSocket(listener, { socketPath: issuerSocketPath, socketMode: issuerSocketMode,
      ...(issuerSocketGid === undefined ? {} : { socketGid: issuerSocketGid }) })
    assertOperatorChannel(issuerSocketPath, process.geteuid())
    ready = true
    void terminal.closed.then(() => stop(new Error('aukora:issuer-review:broker-disconnected')))
    return { closed, close: () => close(), error: () => problem }
  } catch (error) {
    await close(error)
    throw error
  }
}
