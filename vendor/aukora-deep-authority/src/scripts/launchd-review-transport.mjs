/**
 * Local transport for existing broker reviews, not proof of human identity or
 * authorization. The caller pins the terminal's public key and protects the
 * socket directory and daemon identity; the terminal alone holds its key.
 * Issuer prompts require an earlier artifact approval on the same connection;
 * grant signing remains in the issuer.
 */
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto'
import { createConnection, createServer } from 'node:net'
import { isAbsolute, normalize } from 'node:path'
import { BROKER_REVIEW_REQUEST, BROKER_REVIEW_DECISION, BROKER_REVIEW_CANCEL } from '../aukora/broker/broker.mjs'
import { approvalArtifactDigest, parseApprovalArtifact } from '../aukora/approval/artifact.mjs'
import { renderApprovalArtifact } from '../aukora/approval/render.mjs'
import { listenPrivateSocket, SUN_PATH_MAX_BYTES } from './launchd-socket-listener.mjs'

export { SUN_PATH_MAX_BYTES } from './launchd-socket-listener.mjs'

const PREFIX = 'aukora:review-transport:'
const HELLO = `${PREFIX}hello:v1`
const AUTH = `${PREFIX}auth:v1`
const READY = `${PREFIX}ready:v1`
const MESSAGE = `${PREFIX}message:v1`
const ISSUER_REQUEST = `${PREFIX}issuer-request:v1`
const ISSUER_DECISION = `${PREFIX}issuer-decision:v1`
const ISSUER_CANCEL = `${PREFIX}issuer-cancel:v1`
const MAX_BYTES = 128 * 1024
const echoKeys = ['reviewId', 'proposalId', 'artifactDigest', 'operationDigest', 'authorizationDigest']
const issuerEchoKeys = ['reviewId', 'authorizationDigest', 'challenge', 'promptDigest', 'expiresAt']
const failure = reason => new Error(`${PREFIX}${reason}`)
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value)
const signedBytes = (kind, hello, message = null) => Buffer.from(JSON.stringify([`${PREFIX}${kind}:v1`, hello, message]))
/**
 * Largest artifact-stage window: the broker must still be listening when the deadline
 * lands, so this stays five seconds inside `BROKER_REVIEW_TIMEOUT_MS` (35s, broker.mjs).
 * That constant is deliberately NOT imported. broker.mjs is inside the frozen authority
 * graph whose digest `FROZEN_VERIFIER_SHA256` pins, and editing it to export one number
 * would move that digest and force the installed custody pair to be restaged — a governed
 * authority change bought for a stylistic gain. The relationship is pinned by test instead.
 * The issuer stage keeps the tighter `timeoutMs` ceiling because its own approval deadline
 * is a security invariant.
 */
const ARTIFACT_REVIEW_CEILING_MS = 30_000

const issuerRequest = request => request.type === ISSUER_REQUEST
const requestEchoKeys = request => issuerRequest(request) ? issuerEchoKeys : echoKeys
const decisionFrame = (request, decision) => ({ type: issuerRequest(request) ? ISSUER_DECISION : BROKER_REVIEW_DECISION,
  ...Object.fromEntries(requestEchoKeys(request).map(key => [key, request[key]])), decision })
const promptDigest = prompt => createHash('sha256').update(prompt).digest('hex')

/** Match the issuer's complete projection to the operation approved on this connection. */
function validIssuerPrompt(input, approved) {
  if (!hex(input.authorizationDigest, 64) || !hex(input.challenge, 16)
    || typeof input.prompt !== 'string' || Buffer.byteLength(input.prompt, 'utf8') > 32 * 1024
    || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(input.prompt)) return false
  const digestPrompt = '  +- AUTHORIZE DIGEST -----------------------------------------\n'
    + '  | DIGEST APPROVAL - the operation behind this digest is NOT shown\n'
    + '  | and cannot be recovered from it. Confirm only if you know why\n'
    + '  | this digest was admitted.\n  | \n'
    + `  | authorizationDigest: ${input.authorizationDigest}\n  +- approve? type "yes ${input.challenge}": `
  return input.prompt === digestPrompt || input.prompt === renderApprovalArtifact(approved.artifact, input.challenge)
}

/** The original artifact's deadline applies to both approval stages. */
function issuerReviewRequest(value, approved) {
  if (!exact(value, ['type', ...issuerEchoKeys, 'prompt']) || value.type !== ISSUER_REQUEST
    || !hex(value.reviewId, 32) || !hex(value.promptDigest, 64) || approved === undefined
    || value.authorizationDigest !== approved.authorizationDigest || value.expiresAt !== approved.expiresAt
    || value.expiresAt * 1000 <= Date.now() || !validIssuerPrompt(value, approved)
    || promptDigest(value.prompt) !== value.promptDigest) throw failure('issuer-request-invalid')
  return Object.freeze({ ...value })
}

/** Consume exactly one matching, unexpired artifact before invoking an issuer renderer. */
function takeIssuerReview(input, bindings) {
  const suppliedDigest = Object.hasOwn(input ?? {}, 'authorizationDigest')
  if (!exact(input, suppliedDigest ? ['authorizationDigest', 'challenge', 'prompt'] : ['challenge', 'prompt'])
    || (suppliedDigest && !hex(input.authorizationDigest, 64))) throw failure('issuer-request-invalid')
  const matches = [...bindings.values()].filter(approved => approved.expiresAt * 1000 > Date.now()
    && (suppliedDigest ? approved.authorizationDigest === input.authorizationDigest : true)
    && validIssuerPrompt({ ...input, authorizationDigest: approved.authorizationDigest }, approved)
    && (suppliedDigest || input.prompt === renderApprovalArtifact(approved.artifact, input.challenge)))
  if (matches.length !== 1) throw failure('issuer-binding-unavailable')
  const approved = matches[0]
  const request = issuerReviewRequest({ ...input, type: ISSUER_REQUEST, reviewId: randomBytes(16).toString('hex'),
    authorizationDigest: approved.authorizationDigest, promptDigest: promptDigest(input.prompt), expiresAt: approved.expiresAt }, approved)
  bindings.delete(approved.authorizationDigest)
  return request
}

function configuration({ socketPath, role, serverId, timeoutMs, reviewTimeoutMs }) {
  if (typeof socketPath !== 'string' || !isAbsolute(socketPath) || normalize(socketPath) !== socketPath
    || socketPath.includes('\0') || !/^[a-z0-9.-]{1,64}$/.test(role) || !hex(serverId, 64)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 25_000
    || !Number.isInteger(reviewTimeoutMs) || reviewTimeoutMs < timeoutMs
    || reviewTimeoutMs > ARTIFACT_REVIEW_CEILING_MS) throw failure('configuration-invalid')
  if (Buffer.byteLength(socketPath, 'utf8') > SUN_PATH_MAX_BYTES) throw failure('socket-path-too-long')
}

function publicVerifier(pem) {
  try {
    const key = createPublicKey(pem)
    if (key.asymmetricKeyType !== 'ed25519'
      || key.export({ type: 'spki', format: 'pem' }).toString() !== pem) throw failure('key-invalid')
    return key
  } catch { throw failure('public-key-invalid') }
}

function authentic(key, signature, bytes) {
  return typeof signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(signature)
    && Buffer.from(signature, 'base64').toString('base64') === signature
    && verify(null, bytes, key, Buffer.from(signature, 'base64'))
}

function reviewRequest(value) {
  if (!exact(value, ['type', ...echoKeys, 'artifact', 'expiresAt']) || value.type !== BROKER_REVIEW_REQUEST
    || !echoKeys.every(key => hex(value[key], key.endsWith('Id') ? 32 : 64))
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt * 1000 <= Date.now()) throw failure('request-invalid')
  const artifact = parseApprovalArtifact(value.artifact)
  if (approvalArtifactDigest(artifact) !== value.artifactDigest || artifact.operationDigest !== value.operationDigest
    || artifact.expiry !== value.expiresAt) throw failure('request-invalid')
  return Object.freeze({ ...value, artifact })
}

/** A failed frame closes the entire session; callers never resynchronize past it. */
function channel(socket, onFrame, onClose) {
  let buffer = Buffer.alloc(0)
  let stopped = false
  const done = new Promise(resolve => socket.once('close', resolve))
  const fail = () => { if (!stopped) { stopped = true; onClose(); socket.destroy() } }
  socket.on('error', fail)
  socket.on('end', fail)
  socket.on('close', fail)
  socket.on('data', chunk => {
    try {
      if (stopped || buffer.length + chunk.length > MAX_BYTES) throw failure('frame-oversize')
      buffer = Buffer.concat([buffer, chunk])
      let cut
      while (!stopped && (cut = buffer.indexOf(10)) !== -1) {
        const line = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, cut))
        buffer = buffer.subarray(cut + 1)
        onFrame(JSON.parse(line))
      }
    } catch { fail() }
  })
  return { socket, done, fail, send(frame) {
    const bytes = Buffer.from(`${JSON.stringify(frame)}\n`)
    if (stopped || bytes.length > MAX_BYTES || socket.writableLength + bytes.length > MAX_BYTES) throw failure('channel-unavailable')
    socket.write(bytes)
  } }
}

/**
 * Listen for one authenticated terminal and dispatch broker and issuer reviews.
 * The caller owns an exclusive, non-replaceable Unix-socket parent directory.
 * No existing path is removed. Closing cancels reviews and awaits socket exit.
 * Each connection admits at most 256 distinct review IDs before renewal.
 * Issuer review consumes an earlier approved artifact on that connection.
 * @param {import('./launchd-review-transport.mjs').ReviewServerOptions} options pinned route and terminal verifier
 * @returns {Promise<import('./launchd-review-transport.mjs').ReviewTransportServer>} listening transport
 */
export async function createReviewTransportServer({ socketPath, terminalPublicKeyPem, role, serverId, timeoutMs = 25_000, reviewTimeoutMs = timeoutMs, socketMode = 0o600 }) {
  configuration({ socketPath, role, serverId, timeoutMs, reviewTimeoutMs })
  if (socketMode !== 0o600 && socketMode !== 0o660) throw failure('socket-mode-invalid')
  const key = publicVerifier(terminalPublicKeyPem)
  const peers = new Set()
  let terminal = null
  let closing
  const listener = createServer(socket => {
    if (closing || peers.size >= 8) { socket.destroy(); return }
    const hello = { type: HELLO, sessionId: randomBytes(32).toString('hex'), role, serverId, socketPath }
    const used = new Set()
    let authenticated = false
    let pending = null
    const timer = setTimeout(() => peer.fail(), timeoutMs)
    const peer = channel(socket, frame => {
      if (!authenticated) {
        if (terminal !== null || !exact(frame, ['type', 'sessionId', 'signature']) || frame.type !== AUTH
          || frame.sessionId !== hello.sessionId || !authentic(key, frame.signature, signedBytes('auth', hello))) throw failure('authentication-failed')
        clearTimeout(timer)
        authenticated = true
        terminal = { peer, hello, used, bindings: new Map(), current: () => pending, set: value => { pending = value } }
        peer.send({ type: READY, sessionId: hello.sessionId })
        return
      }
      if (!exact(frame, ['type', 'sessionId', 'message', 'signature']) || frame.type !== MESSAGE
        || frame.sessionId !== hello.sessionId || pending === null) throw failure('decision-invalid')
      const message = frame.message
      const fields = requestEchoKeys(pending.request)
      if (!exact(message, ['type', ...fields, 'decision'])
        || message.type !== (issuerRequest(pending.request) ? ISSUER_DECISION : BROKER_REVIEW_DECISION)
        || !fields.every(field => message[field] === pending.request[field])
        || (message.decision !== 'approved' && message.decision !== 'denied')
        || !authentic(key, frame.signature, signedBytes('decision', hello, decisionFrame(pending.request, message.decision)))
        || pending.request.expiresAt * 1000 <= Date.now()) throw failure('decision-invalid')
      pending.finish(null, message.decision)
    }, () => {
      clearTimeout(timer)
      if (terminal?.peer === peer) terminal = null
      pending?.finish(failure('channel-unavailable'))
      peers.delete(peer)
    })
    peers.add(peer)
    peer.send(hello)
  })
  const publication = await listenPrivateSocket(listener, { socketPath, socketMode })
  const dispatchReview = (request, signal, session) => {
    if (closing || session === null) return Promise.reject(failure('channel-unavailable'))
    if (signal.aborted) return Promise.reject(failure('cancelled'))
    if (session.current() !== null || session.used.has(request.reviewId) || session.used.size >= 256) return Promise.reject(failure('review-unavailable'))
    session.used.add(request.reviewId)
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, decision) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', cancel)
        session.set(null)
        if (error) reject(error)
        else {
          if (!issuerRequest(request) && decision === 'approved') session.bindings.set(request.authorizationDigest, request)
          resolve(decision)
        }
      }
      const cancel = () => {
        if (settled) return
        const message = issuerRequest(request)
          ? { type: ISSUER_CANCEL, reviewId: request.reviewId, authorizationDigest: request.authorizationDigest }
          : { type: BROKER_REVIEW_CANCEL, reviewId: request.reviewId, proposalId: request.proposalId }
        try { session.peer.send({ type: MESSAGE, sessionId: session.hello.sessionId, message }) }
        catch { /* Closure below invalidates the session. */ }
        finish(failure(signal.aborted ? 'cancelled' : 'timed-out'))
        if (terminal === session) terminal = null
        session.peer.socket.end(() => session.peer.fail())
      }
      const stageMs = issuerRequest(request) ? timeoutMs : reviewTimeoutMs
      const timer = setTimeout(cancel, Math.min(stageMs, request.expiresAt * 1000 - Date.now()))
      session.set({ request, finish })
      signal.addEventListener('abort', cancel, { once: true })
      try { session.peer.send({ type: MESSAGE, sessionId: session.hello.sessionId, message: request }) }
      catch { session.peer.fail() }
    })
  }
  return {
    requestReview(input, signal) {
      let request
      try { request = reviewRequest(input) } catch { return Promise.reject(failure('request-invalid')) }
      return dispatchReview(request, signal, terminal)
    },
    requestIssuerReview(input, signal) {
      const session = terminal
      if (closing || session === null) return Promise.reject(failure('channel-unavailable'))
      if (signal.aborted) return Promise.reject(failure('cancelled'))
      if (session.current() !== null) return Promise.reject(failure('review-unavailable'))
      let request
      try { request = takeIssuerReview(input, session.bindings) }
      catch (error) { return Promise.reject(error) }
      return dispatchReview(request, signal, session)
    },
    close() {
      closing ??= Promise.all([publication.close(), ...[...peers].map(peer => {
        peer.fail()
        return peer.done
      })]).then(() => {})
      return closing
    },
  }
}

/**
 * Authenticate a terminal session and delegate every review to its renderer.
 * The caller must verify daemon/socket ownership before connecting. Private
 * key possession authenticates this session, not a person or an approval.
 * Cancellation closes the connection and aborts the callback; late answers
 * cannot be sent. Callbacks must honor abort before accepting another prompt.
 * @param {import('./launchd-review-transport.mjs').ReviewClientOptions} options terminal key, pinned route and renderer callback
 * @returns {Promise<import('./launchd-review-transport.mjs').ReviewTransportClient>} authenticated client with disconnect completion
 */
export async function connectReviewTransport({ socketPath, terminalPrivateKey, role, serverId, review, reviewIssuer, timeoutMs = 25_000, reviewTimeoutMs = timeoutMs }) {
  configuration({ socketPath, role, serverId, timeoutMs, reviewTimeoutMs })
  if (typeof review !== 'function') throw failure('review-callback-invalid')
  if (reviewIssuer !== undefined && typeof reviewIssuer !== 'function') throw failure('issuer-review-callback-invalid')
  const key = typeof terminalPrivateKey === 'string' ? createPrivateKey(terminalPrivateKey) : terminalPrivateKey
  if (key?.type !== 'private' || key.asymmetricKeyType !== 'ed25519') throw failure('private-key-invalid')
  let hello = null
  let ready = false
  let closed = false
  let active = null
  const seen = new Set()
  const bindings = new Map()
  const socket = createConnection(socketPath)
  let accept
  let refuse
  const connected = new Promise((resolve, reject) => { accept = resolve; refuse = reject })
  const timer = setTimeout(() => peer.fail(), timeoutMs)
  const peer = channel(socket, frame => {
    if (hello === null) {
      if (!exact(frame, ['type', 'sessionId', 'role', 'serverId', 'socketPath']) || frame.type !== HELLO
        || !hex(frame.sessionId, 64) || frame.role !== role || frame.serverId !== serverId || frame.socketPath !== socketPath) throw failure('hello-invalid')
      hello = { type: HELLO, sessionId: frame.sessionId, role, serverId, socketPath }
      peer.send({ type: AUTH, sessionId: hello.sessionId, signature: sign(null, signedBytes('auth', hello), key).toString('base64') })
      return
    }
    if (!ready) {
      if (!exact(frame, ['type', 'sessionId']) || frame.type !== READY || frame.sessionId !== hello.sessionId) throw failure('ready-invalid')
      ready = true
      clearTimeout(timer)
      accept()
      return
    }
    if (!exact(frame, ['type', 'sessionId', 'message']) || frame.type !== MESSAGE || frame.sessionId !== hello.sessionId) throw failure('message-invalid')
    const message = frame.message
    if (message?.type === BROKER_REVIEW_CANCEL || message?.type === ISSUER_CANCEL) {
      const isIssuer = message.type === ISSUER_CANCEL
      const field = isIssuer ? 'authorizationDigest' : 'proposalId'
      if (!exact(message, ['type', 'reviewId', field]) || active === null
        || isIssuer !== issuerRequest(active.request)
        || message.reviewId !== active.request.reviewId || message[field] !== active.request[field]) throw failure('cancel-invalid')
      peer.fail()
      return
    }
    const isIssuer = message?.type === ISSUER_REQUEST
    const request = isIssuer
      ? issuerReviewRequest(message, bindings.get(message.authorizationDigest))
      : reviewRequest(message)
    if (active !== null || seen.has(request.reviewId) || seen.size >= 256) throw failure('review-unavailable')
    if (isIssuer && reviewIssuer === undefined) throw failure('issuer-review-callback-unavailable')
    if (isIssuer) bindings.delete(request.authorizationDigest)
    seen.add(request.reviewId)
    const controller = new AbortController()
    const stageMs = isIssuer ? timeoutMs : reviewTimeoutMs
    const expiry = setTimeout(() => peer.fail(), Math.min(stageMs, request.expiresAt * 1000 - Date.now()))
    active = { request, controller, expiry }
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) throw failure('cancelled')
      return (isIssuer ? reviewIssuer : review)(request, controller.signal)
    }).then(decision => {
      if (controller.signal.aborted) return
      if (decision !== 'approved' && decision !== 'denied') throw failure('decision-invalid')
      const response = decisionFrame(request, decision)
      peer.send({ type: MESSAGE, sessionId: hello.sessionId, message: response,
        signature: sign(null, signedBytes('decision', hello, response), key).toString('base64') })
      if (!isIssuer && decision === 'approved') bindings.set(request.authorizationDigest, request)
      clearTimeout(expiry)
      active = null
    }).catch(() => peer.fail())
  }, () => {
    closed = true
    bindings.clear()
    clearTimeout(timer)
    if (active !== null) { clearTimeout(active.expiry); active.controller.abort(); active = null }
    refuse(failure('channel-unavailable'))
  })
  await connected
  return {
    closed: peer.done,
    requestIssuerReview(input, signal) {
      if (closed) return Promise.reject(failure('channel-unavailable'))
      if (signal.aborted) return Promise.reject(failure('cancelled'))
      if (active !== null || seen.size >= 256) return Promise.reject(failure('review-unavailable'))
      if (reviewIssuer === undefined) return Promise.reject(failure('issuer-review-callback-unavailable'))
      let request
      try { request = takeIssuerReview(input, bindings) }
      catch (error) { return Promise.reject(error) }
      seen.add(request.reviewId)
      return new Promise((resolve, reject) => {
        const deadline = Math.min(Date.now() + timeoutMs, request.expiresAt * 1000)
        const controller = new AbortController()
        let settled = false
        const finish = (error, decision) => {
          if (settled) return
          settled = true
          clearTimeout(expiry)
          signal.removeEventListener('abort', cancel)
          controller.signal.removeEventListener('abort', disconnect)
          if (active?.controller === controller) active = null
          if (error) { controller.abort(); reject(error) }
          else resolve(decision)
        }
        const disconnect = () => finish(failure('channel-unavailable'))
        const cancel = () => { finish(failure('cancelled')); peer.fail() }
        const expire = () => { finish(failure('timed-out')); peer.fail() }
        const expiry = setTimeout(expire, Math.max(0, deadline - Date.now()))
        active = { request, controller, expiry }
        signal.addEventListener('abort', cancel, { once: true })
        controller.signal.addEventListener('abort', disconnect, { once: true })
        void Promise.resolve().then(() => {
          if (controller.signal.aborted) throw failure('cancelled')
          return reviewIssuer(request, controller.signal)
        }).then(decision => {
          if (settled) return
          if (Date.now() >= deadline) { expire(); return }
          if (decision !== 'approved' && decision !== 'denied') throw failure('decision-invalid')
          finish(null, decision)
        }).catch(error => { finish(error); peer.fail() })
      })
    },
    close() { peer.fail(); return peer.done },
  }
}
