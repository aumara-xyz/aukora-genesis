/** Loopback owner UI over the existing authenticated two-stage review transport. */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { renderApprovalArtifact } from '../approval/render.mjs'
import { ARTIFACT_REVIEW_TIMEOUT_MS, connectWebReviewRenderer, REVIEW_TIMEOUT_MS } from './developer-review.mjs'

const BOOTSTRAP_TTL_MS = 5 * 60_000
const SESSION_TTL_MS = 8 * 60 * 60_000
const BROWSER_ABSENCE_MS = 10_000
// The view deadline the owner sees must match the window the transport is actually
// enforcing for that stage. Both numbers are imported rather than restated: a local copy
// that drifts above its transport twin shows a countdown the transport will not honour,
// and one that drifts below silently becomes the real deadline.
const BODY_LIMIT = 1024
/** Automatic reconnection after an unexpected transport disconnect: bounded attempts with exponential delay. */
const RECONNECT_BASE_MS = 250
const RECONNECT_CEILING_MS = 4_000
const RECONNECT_ATTEMPT_LIMIT = 6
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * Serve the owner API used by the existing chat popup, never a signing-key endpoint.
 * The one-use URL is an owner credential: deliver it outside agent chat/logs.
 * Possession authenticates a browser session, not human attendance or OS custody.
 * Closing the owner service disconnects review only, not broker/issuer/guest.
 * An unexpected transport disconnect finishes any pending view as denied and then re-attaches the
 * same configured transport on a bounded backoff; the paired browser session and its token survive.
 * @param {{config: import('./developer-review.mjs').WebReviewConfig, privateKeyPath: string, port?: number, appOrigin?: string, reviewWindowMs?: number, issuerWindowMs?: number}} options - pinned transport, loopback port, exact chat origin, and the two stage view windows, each at most its transport twin.
 * @returns {Promise<{url: string, ownerUrl: string, close(): Promise<void>}>} listening owner UI and private one-use pairing URL.
 */
export async function startOwnerReview({ config, privateKeyPath, port = 0, appOrigin,
  reviewWindowMs = ARTIFACT_REVIEW_TIMEOUT_MS, issuerWindowMs = REVIEW_TIMEOUT_MS }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('aukora:owner-review:port-invalid')
  if (!Number.isInteger(reviewWindowMs) || reviewWindowMs <= 0 || reviewWindowMs > ARTIFACT_REVIEW_TIMEOUT_MS
    || !Number.isInteger(issuerWindowMs) || issuerWindowMs <= 0 || issuerWindowMs > REVIEW_TIMEOUT_MS) {
    throw new Error('aukora:owner-review:review-window-invalid')
  }
  if (appOrigin !== undefined) {
    const app = new URL(appOrigin)
    if (app.origin !== appOrigin || app.protocol !== 'http:' || app.hostname !== '127.0.0.1' || app.port === '') {
      throw new Error('aukora:owner-review:app-origin-invalid')
    }
  }
  let bootstrap = randomBytes(32).toString('hex')
  const bootstrapExpires = Date.now() + BOOTSTRAP_TTL_MS
  let sessionToken = null
  let sessionExpires = 0
  let browserSeenAt = 0
  let pending = null
  let lastResult = null
  let connection = null
  let connectionState = 'disconnected'
  let connecting = null
  let closing = null
  let reconnectTimer = null
  let reconnectAttempts = 0

  const finish = (decision, message) => {
    if (pending === null) return
    const current = pending
    pending = null
    current.signal.removeEventListener('abort', current.cancel)
    lastResult = message
    current.resolve(decision)
  }
  const review = (stage, request, signal) => {
    if (signal.aborted || closing || pending !== null || sessionToken === null
      || Date.now() >= sessionExpires || Date.now() - browserSeenAt > BROWSER_ABSENCE_MS) {
      return Promise.resolve('denied')
    }
    const prompt = stage === 'parent'
      ? renderApprovalArtifact(request.artifact, randomBytes(8).toString('hex')) : request.prompt
    const view = Object.freeze({ id: randomBytes(32).toString('hex'), stage, prompt,
      expiresAt: Math.min(Date.now() + (stage === 'parent' ? reviewWindowMs : issuerWindowMs),
        request.expiresAt * 1000), reviewId: request.reviewId,
      authorizationDigest: request.authorizationDigest,
      ...(stage === 'parent' ? { artifactDigest: request.artifactDigest } : {}) })
    lastResult = null
    return new Promise(resolve => {
      const cancel = () => finish('denied', 'Request cancelled or expired. No approval sent.')
      pending = { view, signal, cancel, resolve }
      signal.addEventListener('abort', cancel, { once: true })
    })
  }
  const clearReconnect = () => {
    if (reconnectTimer === null) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  /**
   * Retry the same configured, authenticated transport after an unexpected disconnect.
   * The attempt budget is fixed, so a transport that stays unreachable settles at
   * 'disconnected' instead of retrying indefinitely; a successful attach resets it.
   * Only the transport attachment is retried: no request is replayed, no identity,
   * key, or socket is substituted, and the paired browser session is untouched.
   */
  const scheduleReconnect = () => {
    if (closing || reconnectTimer !== null) return
    if (reconnectAttempts >= RECONNECT_ATTEMPT_LIMIT) {
      connectionState = 'disconnected'
      return
    }
    connectionState = 'connecting'
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_CEILING_MS)
    reconnectAttempts += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect().then(() => { reconnectAttempts = 0 }, () => { scheduleReconnect() })
    }, delay)
  }
  const connect = () => {
    if (closing) return Promise.reject(new Error('aukora:owner-review:closed'))
    if (connecting) return connecting
    if (connection) return Promise.resolve()
    connectionState = 'connecting'
    connecting = connectWebReviewRenderer(config, privateKeyPath, {
      review: (request, signal) => review('parent', request, signal),
      reviewIssuer: (request, signal) => review('issuer', request, signal),
    }).then(async client => {
      if (closing) { await client.close(); return }
      connection = client
      connectionState = 'connected'
      void client.closed.then(() => {
        if (connection !== client) return
        connection = null
        connectionState = 'disconnected'
        finish('denied', 'Approval connection lost. No pending approval retained.')
        if (!closing) scheduleReconnect()
      })
    }, error => {
      connectionState = 'disconnected'
      throw error
    }).finally(() => { connecting = null })
    return connecting
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) reply(response, 400, { error: 'request-invalid' })
      else response.end()
    })
  })
  server.headersTimeout = 5000
  server.requestTimeout = 5000
  server.maxConnections = 32
  server.on('clientError', (_error, socket) => socket.destroy())

  function reply(response, status, data) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(data))
  }
  async function body(request) {
    let bytes = 0
    const parts = []
    for await (const part of request) {
      bytes += part.length
      if (bytes > BODY_LIMIT) throw new Error('body-too-large')
      parts.push(part)
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)))
  }
  async function handle(request, response) {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
    if (request.headers.host !== new URL(origin).host || request.socket.remoteAddress !== '127.0.0.1') {
      reply(response, 403, { error: 'host-refused' }); return
    }
    const browserOrigin = appOrigin ?? origin
    if (request.headers.origin !== undefined && request.headers.origin !== browserOrigin) {
      reply(response, 403, { error: 'origin-refused' }); return
    }
    if (request.headers.origin === browserOrigin) {
      response.setHeader('Access-Control-Allow-Origin', browserOrigin)
      response.setHeader('Vary', 'Origin')
    }
    if (request.method === 'OPTIONS') {
      if (request.headers.origin !== browserOrigin
        || !['GET', 'POST'].includes(request.headers['access-control-request-method'])) {
        reply(response, 403, { error: 'origin-refused' }); return
      }
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST')
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Aukora-Review')
      response.writeHead(204); response.end(); return
    }
    if (closing) { reply(response, 503, { error: 'closed' }); return }
    const post = request.method === 'POST'
    if (post && (request.headers.origin !== browserOrigin || request.headers['x-aukora-review'] !== '1'
      || request.headers['content-type'] !== 'application/json')) {
      reply(response, 403, { error: 'origin-refused' }); return
    }
    if (post && request.url === '/api/pair') {
      const value = await body(request)
      if (!exact(value, ['token']) || bootstrap === null || Date.now() >= bootstrapExpires || !equal(value.token, bootstrap)) {
        reply(response, 401, { error: 'pairing-unavailable' }); return
      }
      bootstrap = null
      sessionToken = randomBytes(32).toString('hex')
      sessionExpires = Date.now() + SESSION_TTL_MS
      browserSeenAt = Date.now()
      reply(response, 200, { sessionToken }); return
    }
    // Cookies are shared across ports and would be sent to the guest's HTTP server.
    // A per-origin browser token travels only in explicit owner requests instead.
    if (sessionToken === null || Date.now() >= sessionExpires
      || !equal(request.headers.authorization, `Bearer ${sessionToken}`)) {
      reply(response, 401, { error: 'owner-session-required' }); return
    }
    if (request.method === 'GET' && request.url === '/api/state') {
      browserSeenAt = Date.now()
      reply(response, 200, { subject: config.subject, connection: connectionState, pending: pending?.view ?? null, lastResult }); return
    }
    if (post && request.url === '/api/decision') {
      const value = await body(request)
      if (!exact(value, ['id', 'decision']) || !['approved', 'denied'].includes(value.decision)) {
        reply(response, 400, { error: 'decision-invalid' }); return
      }
      if (pending === null || !equal(value.id, pending.view.id) || pending.signal.aborted
        || Date.now() >= pending.view.expiresAt || connectionState !== 'connected') {
        reply(response, 409, { error: 'request-no-longer-pending' }); return
      }
      const stage = pending.view.stage
      finish(value.decision, value.decision === 'denied' ? 'Operation denied.' : stage === 'parent'
        ? 'Parent approval sent. Separate issuer confirmation is still required.'
        : 'Issuer approval sent. Settlement and receipt verification are not yet confirmed.')
      reply(response, 200, { ok: true }); return
    }
    if (post && request.url === '/api/reconnect') {
      if (!exact(await body(request), [])) { reply(response, 400, { error: 'request-invalid' }); return }
      // Clearing the budget replaces the pending ladder with this attempt; it does
      // not end recovery. A manual attempt that fails re-arms the ladder from zero,
      // so a transport that returns afterwards is re-attached without a second
      // operator action. Without this the owner is parked at 'disconnected' by their
      // own click: the UI enables Reconnect during backoff, because the client maps
      // a server 'connecting' to its own 'unavailable'.
      clearReconnect()
      reconnectAttempts = 0
      try { await connect(); reply(response, 200, { ok: true }) }
      catch {
        if (!closing) scheduleReconnect()
        reply(response, 503, { error: 'connection-unavailable' })
      }
      return
    }
    reply(response, 404, { error: 'not-found' })
  }
  await new Promise((resolve, reject) => {
    const onError = error => reject(error)
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => { server.off('error', onError); resolve() })
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const heartbeat = setInterval(() => {
    if (pending !== null && (Date.now() - browserSeenAt > BROWSER_ABSENCE_MS || Date.now() >= pending.view.expiresAt)) {
      finish('denied', 'Owner window unavailable or request expired. No approval sent.')
    }
  }, 500)
  async function close() {
    if (!closing) closing = (async () => {
      clearReconnect()
      clearInterval(heartbeat)
      bootstrap = null
      sessionToken = null
      finish('denied', 'Owner review service closed.')
      const closedServer = new Promise(resolve => server.close(resolve))
      server.closeAllConnections()
      await connecting?.catch(() => {})
      await connection?.close()
      await closedServer
    })()
    return closing
  }
  try { await connect() } catch (error) { await close(); throw error }
  return { url: origin, ownerUrl: `${appOrigin ?? origin}/#owner-review=${encodeURIComponent(origin)}&pair=${bootstrap}`, close }
}
