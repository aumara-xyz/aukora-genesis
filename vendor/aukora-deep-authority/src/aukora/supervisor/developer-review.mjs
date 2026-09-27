/** Reconnectable owner review for the existing same-UID Web assembly. */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { BROKER_REFUSE } from '../broker/broker.mjs'
import { connectReviewTransport, createReviewTransportServer } from '../../scripts/launchd-review-transport.mjs'
import { createTerminalLines, reviewApprovalArtifact, reviewIssuerChallenge } from './developer-terminal.mjs'

const DOMAIN = 'aukora:web-review-config:v1'
const ROLE = 'web-owner'
/**
 * Issuer-leg window. It must finish before the bridge's 25-second callback ceiling.
 * Exported so the owner UI shows this exact deadline rather than a second copy of it.
 */
export const REVIEW_TIMEOUT_MS = 20_000
// The artifact leg has no such ceiling: nothing downstream of it is waiting on a signed
// deadline, only the broker's own IPC wait. A reader must see a MEMORY.WRITE body and
// decide, so it gets the larger window. This is a bounded mitigation for an observed
// 20-second refusal, not a measured usability figure.
export const ARTIFACT_REVIEW_TIMEOUT_MS = 30_000
/** Measured approval implementation for the reconnectable Web route. */
export const WEB_REVIEW_RENDERER_ID = createHash('sha256').update(JSON.stringify([
  './developer-review.mjs', './developer-terminal.mjs',
  '../../scripts/launchd-review-transport.mjs', '../../scripts/aukora-web-review.mjs',
  '../../scripts/launchd-socket-listener.mjs',
  './owner-review-server.mjs',
  '../../packages/client/ui-conversation/src/client/owner-review.ts',
  '../../packages/client/ui-conversation/src/client/skeleton/OwnerReviewPanel.tsx',
  '../../packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.tsx',
  '../../packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.module.css',
].map(path => createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex')))).digest('hex')
const TRANSPORT_UNAVAILABLE = new Set([
  'channel-unavailable', 'timed-out', 'cancelled', 'review-busy',
  'issuer-binding-unavailable', 'review-unavailable',
].map(reason => `aukora:review-transport:${reason}`))

/**
 * Read owner-managed configuration, not a discovered review socket.
 * @param {string} path - private JSON file containing the route and terminal public key.
 * @returns {Readonly<import('./developer-review.mjs').WebReviewConfig>} authenticated transport options and controller subject.
 */
export function readWebReviewConfig(path) {
  const bytes = readPrivateFile(path)
  let value
  try { value = JSON.parse(bytes) } catch { throw new Error('aukora:web-review:config-malformed') }
  const fields = ['domain', 'socketPath', 'subject', 'terminalPublicKeyPem']
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== fields.sort().join(',')
    || value.domain !== DOMAIN
    || typeof value.subject !== 'string' || !/^aukora:1:[0-9a-f]{64}$/u.test(value.subject)
    || typeof value.socketPath !== 'string' || !isAbsolute(value.socketPath)
    || resolve(value.socketPath) !== value.socketPath || value.socketPath.includes('\0')
    || typeof value.terminalPublicKeyPem !== 'string') {
    throw new Error('aukora:web-review:config-malformed')
  }
  assertPrivateDirectory(dirname(value.socketPath))
  let key
  try { key = createPublicKey(value.terminalPublicKeyPem) } catch { throw new Error('aukora:web-review:public-key-invalid') }
  if (key.asymmetricKeyType !== 'ed25519'
    || key.export({ type: 'spki', format: 'pem' }).toString() !== value.terminalPublicKeyPem) {
    throw new Error('aukora:web-review:public-key-invalid')
  }
  const canonical = JSON.stringify({ domain: DOMAIN, socketPath: value.socketPath,
    subject: value.subject, terminalPublicKeyPem: value.terminalPublicKeyPem })
  return Object.freeze({ socketPath: value.socketPath, subject: value.subject,
    terminalPublicKeyPem: value.terminalPublicKeyPem, role: ROLE,
    serverId: createHash('sha256').update(canonical).digest('hex') })
}

/**
 * Bind both approval stages without making terminal presence a service lifetime.
 * @param {ReturnType<typeof readWebReviewConfig>} config - owner-pinned route.
 * @param {string} subject - current AUMLOK controller subject.
 * @returns {Promise<import('./developer-review.mjs').WebReview>} existing assembly callbacks and an owned close operation.
 */
export async function createWebReview(config, subject) {
  if (config.subject !== subject) throw new Error('aukora:web-review:subject-mismatch')
  const transport = await createReviewTransportServer({ ...config, timeoutMs: REVIEW_TIMEOUT_MS, reviewTimeoutMs: ARTIFACT_REVIEW_TIMEOUT_MS })
  return {
    async review(request, signal) {
      try { return await transport.requestReview(request, signal) } catch (error) {
        if (signal.aborted) throw new Error(BROKER_REFUSE.STOPPING, { cause: error })
        if (error?.message === 'aukora:review-transport:timed-out') {
          throw new Error(BROKER_REFUSE.REVIEW_TIMED_OUT, { cause: error })
        }
        throw new Error(BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE, { cause: error })
      }
    },
    async issuerApproval(request, signal) {
      try { return await transport.requestIssuerReview(request, signal) } catch (error) {
        if (signal.aborted || TRANSPORT_UNAVAILABLE.has(error?.message)) return 'unavailable'
        throw error
      }
    },
    close: () => transport.close(),
  }
}

/**
 * Connect a separate operator terminal; neither this key nor stdin belongs in the service.
 * @param {ReturnType<typeof readWebReviewConfig>} config - independently selected route.
 * @param {string} privateKeyPath - private Ed25519 terminal authentication key, not the issuer key.
 * @returns {Promise<import('../../scripts/launchd-review-transport.mjs').ReviewTransportClient>} connection completion and close operation.
 */
export async function connectWebReview(config, privateKeyPath) {
  const terminal = createTerminalLines()
  let connection
  try {
    connection = await connectWebReviewRenderer(config, privateKeyPath, {
      review: (request, signal) => reviewApprovalArtifact(terminal, request, signal),
      reviewIssuer: (request, signal) => {
        process.stderr.write(request.prompt)
        return reviewIssuerChallenge(terminal, request, signal)
      },
    })
  } catch (error) {
    terminal.close()
    throw error
  }
  // Readline consumes TTY Ctrl-C itself; EOF must release the same connection.
  void terminal.closed.then(() => connection.close())
  return {
    closed: connection.closed.finally(() => terminal.close()),
    async close() { terminal.close(); await connection.close() },
  }
}

/**
 * Connect an owner renderer after checking its key and the pinned socket.
 * Renderer callbacks must wait for an explicit decision and honor cancellation.
 * @param {ReturnType<typeof readWebReviewConfig>} config - owner-pinned route.
 * @param {string} privateKeyPath - private owner authentication key, never an issuer key.
 * @param {Pick<import('../../scripts/launchd-review-transport.mjs').ReviewClientOptions, 'review' | 'reviewIssuer'>} renderer - separate parent and issuer renderers.
 * @returns {Promise<import('../../scripts/launchd-review-transport.mjs').ReviewTransportClient>} authenticated owner connection.
 */
export async function connectWebReviewRenderer(config, privateKeyPath, renderer) {
  const key = createPrivateKey(readPrivateFile(privateKeyPath))
  if (key.asymmetricKeyType !== 'ed25519'
    || createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString() !== config.terminalPublicKeyPem) {
    throw new Error('aukora:web-review:terminal-key-mismatch')
  }
  const socket = lstatSync(config.socketPath)
  if (!socket.isSocket() || socket.uid !== process.geteuid?.() || (socket.mode & 0o777) !== 0o600) {
    throw new Error('aukora:web-review:socket-not-private')
  }
  return connectReviewTransport({ ...config, timeoutMs: REVIEW_TIMEOUT_MS, reviewTimeoutMs: ARTIFACT_REVIEW_TIMEOUT_MS, terminalPrivateKey: key,
    review: renderer.review, reviewIssuer: renderer.reviewIssuer })
}

function assertPrivateDirectory(path) {
  const state = lstatSync(path)
  if (!state.isDirectory() || state.isSymbolicLink() || state.uid !== process.geteuid?.()
    || (state.mode & 0o777) !== 0o700 || realpathSync(path) !== path) {
    throw new Error('aukora:web-review:directory-not-private')
  }
}

function readPrivateFile(path) {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error('aukora:web-review:path-invalid')
  assertPrivateDirectory(dirname(path))
  let descriptor
  try { descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
  catch { throw new Error('aukora:web-review:file-not-private') }
  try {
    const state = fstatSync(descriptor)
    if (!state.isFile() || state.nlink !== 1 || state.uid !== process.geteuid?.()
      || (state.mode & 0o777) !== 0o600 || state.size > 8192) {
      throw new Error('aukora:web-review:file-not-private')
    }
    const bytes = readFileSync(descriptor)
    if (bytes.length > 8192) throw new Error('aukora:web-review:file-not-private')
    return bytes.toString('utf8')
  } finally { closeSync(descriptor) }
}
