/**
 * Launch an intentionally modified broker copy for a test-only mutation arm.
 *
 * This helper is deliberately outside the product module: it accepts a caller
 * selected entry and waits for its ordinary status response. This is only
 * test readiness, not an authority claim. Product launch uses `spawnBroker()`
 * instead, which owns its entry and waits for an exact child IPC readiness
 * frame. Neither helper path is cryptographic peer authentication.
 */
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import {
  BROKER_REVIEW_CANCEL,
  BROKER_REVIEW_DECISION,
  BROKER_REVIEW_REQUEST,
  scrubEnv,
} from '../../../aukora/broker/broker.mjs'
import { PEER_TOKEN_PATH_ENV, PEER_TOKEN_SHA256_ENV } from '../../../aukora/broker/confinement.mjs'

/**
 * Launch a copied broker source only for a test mutation.
 *
 * @param {object} options
 * @param {string} options.entry - absolute path to the court's copied broker module.
 * @param {string} options.socketPath - socket path owned by the court temp tree.
 * @param {string} options.stateDir - broker state directory in the court temp tree.
 * @param {string} options.rootPublicKeyPem - ephemeral court root public key.
 * @param {string} [options.issuerSocket] - test-owned issuer route for proposal mutations.
 * @param {(request: object, signal: AbortSignal) => Promise<'approved'|'denied'>|'approved'|'denied'} [options.review] -
 *   test-owned parent review, defaults to approval for proposal mutation courts.
 * @param {Record<string, string | undefined>} [options.env] - source environment.
 * @param {string} [options.peerTokenPath] - peer-token path used by a confinement mutation.
 * @param {string} [options.peerTokenSha256] - peer-token digest used by a confinement mutation.
 * @param {string} [options.activationDigest] - activation digest this copied broker must serve.
 * @param {string} [options.rendererId] - SHA-256 identity of the parent renderer for the approval artifact.
 * @param {boolean} [options.skipScrub] - deliberately preserve preloads for a mutation arm.
 * @param {number} [options.timeoutMs] - maximum wait for test socket readiness.
 * @returns {Promise<import('node:child_process').ChildProcess>} the copied child.
 */
export async function spawnMutantBroker({ entry, socketPath, stateDir, rootPublicKeyPem, issuerSocket, review = async () => 'approved', env = process.env, peerTokenPath, peerTokenSha256, activationDigest, rendererId, skipScrub = false, timeoutMs = 5000 }) {
  const childEnv = skipScrub ? { ...env } : { ...scrubEnv(env) }
  childEnv.AUKORA_SOCKET = socketPath
  childEnv.AUKORA_STATE_DIR = stateDir
  childEnv.AUKORA_ROOT_PEM = rootPublicKeyPem
  if (activationDigest !== undefined) childEnv.AUKORA_ACTIVATION_DIGEST = activationDigest
  if (rendererId !== undefined) childEnv.AUKORA_RENDERER_ID = rendererId
  if (issuerSocket !== undefined) {
    childEnv.AUKORA_ISSUER_SOCKET = issuerSocket
    childEnv.AUKORA_PARENT_REVIEW = '1'
  }
  if (peerTokenPath !== undefined) childEnv[PEER_TOKEN_PATH_ENV] = peerTokenPath
  if (peerTokenSha256 !== undefined) childEnv[PEER_TOKEN_SHA256_ENV] = peerTokenSha256
  const child = spawn(process.execPath, ['--', entry], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  if (issuerSocket !== undefined) {
    const active = new Map()
    const sendDecision = (request, decision) => {
      if (!child.connected || child.exitCode !== null || child.signalCode !== null) return
      try {
        child.send({
          type: BROKER_REVIEW_DECISION,
          reviewId: request.reviewId,
          proposalId: request.proposalId,
          artifactDigest: request.artifactDigest,
          operationDigest: request.operationDigest,
          authorizationDigest: request.authorizationDigest,
          decision,
        }, () => {})
      } catch {
        // A copied child exit owns this test-helper race.
      }
    }
    const onMessage = (request) => {
      if (request?.type === BROKER_REVIEW_CANCEL) {
        const controller = active.get(request.reviewId)
        active.delete(request.reviewId)
        controller?.abort('copied broker stopped waiting for review')
        return
      }
      if (request?.type !== BROKER_REVIEW_REQUEST) return
      if (active.has(request.reviewId)) return
      const controller = new AbortController()
      active.set(request.reviewId, controller)
      void Promise.resolve().then(() => review(request, controller.signal)).then(
        (decision) => {
          if (!controller.signal.aborted) sendDecision(request, decision)
        },
        () => {
          if (!controller.signal.aborted) sendDecision(request, 'invalid')
        },
      ).finally(() => { active.delete(request.reviewId) })
    }
    child.on('message', onMessage)
    child.once('exit', () => {
      child.removeListener('message', onMessage)
      for (const controller of active.values()) controller.abort('copied broker exited')
      active.clear()
    })
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await accepts(socketPath)) return child
    if (child.exitCode !== null) throw new Error(`mutant broker exited early with code ${child.exitCode}`)
    await delay(20)
  }
  child.kill()
  throw new Error(`mutant broker socket did not accept a connection within ${timeoutMs}ms`)
}

/** @param {string} socketPath @returns {Promise<boolean>} whether the copied broker finished serving. */
function accepts(socketPath) {
  return new Promise((resolve) => {
    const socket = connect(socketPath)
    let output = ''
    const done = (answer) => { socket.destroy(); resolve(answer) }
    socket.once('connect', () => socket.write('{"op":"status"}\n'))
    socket.on('data', (chunk) => {
      output += chunk
      const newline = output.indexOf('\n')
      if (newline === -1) return
      try {
        done(JSON.parse(output.slice(0, newline))?.ok === true)
      } catch {
        done(false)
      }
    })
    socket.once('error', () => done(false))
  })
}
