/** Bounded issuer prompt framing over owner-supplied streams; no launcher or signing authority. */
import { StringDecoder } from 'node:string_decoder'
import { DeveloperLaunchError } from './developer-launch-error.mjs'

const ISSUER_PROMPT_START = /^  \+- (?:AUTHORIZE DIGEST -+|MEMORY\.WRITE -+|-{60})\n/mu
const ISSUER_PROMPT = /^  \+- approve\? type "yes ([0-9a-f]{16})": /mu
const MAX_ISSUER_PROMPT_BYTES = 128 * 1024
const ISSUER_APPROVAL_CEILING_MS = 25_000

/**
 * Forward complete issuer prompts and write only explicit parent decisions.
 * An unavailable reviewer leaves stdin untouched and the issuer's own deadline
 * active. Malformed or oversized prompts and callback failures fail the assembly.
 * Exit, close, or stream teardown aborts active review and discards queued prompts.
 * @param {import('./issuer-approval-bridge.mjs').IssuerApprovalStreams} child - issuer with parent-owned pipes.
 * @param {import('./issuer-approval-bridge.mjs').DeveloperIssuerApproval} approve - decision for the exact prompt.
 * @param {(text: string) => void} sink - synchronous consumer of raw unvalidated diagnostics, not an approval renderer.
 * @param {(error: DeveloperLaunchError) => void} failAssembly - owner that stops the assembly on bridge failure.
 * @returns {void}
 */
export function installIssuerApprovalBridge(child, approve, sink, failAssembly) {
  const decoder = new StringDecoder('utf8')
  let buffer = ''
  let active = Promise.resolve()
  let activeController
  let failed = false
  let ended = false
  const hasEnded = () => ended
    || (child.exitCode !== null && child.exitCode !== undefined)
    || (child.signalCode !== null && child.signalCode !== undefined)
    || child.stdin.destroyed || child.stderr.destroyed || child.stderr.readableEnded
  const fail = (error) => {
    if (failed) return
    failed = true
    stop()
    failAssembly(error)
  }
  const stop = () => {
    if (ended) return
    ended = true
    buffer = ''
    child.removeListener('exit', stop)
    child.removeListener('close', stop)
    child.stdin.removeListener('error', onStdinError)
    child.stdin.removeListener('close', stop)
    child.stderr.removeListener('data', onData)
    child.stderr.removeListener('end', stop)
    child.stderr.removeListener('close', stop)
    activeController?.abort('issuer process exited')
  }
  const onStdinError = error => fail(new DeveloperLaunchError(
    'supervisor:issuer-input-failed',
    error instanceof Error ? error.message : String(error),
  ))
  const onData = (chunk) => {
    if (failed || ended) return
    const text = typeof chunk === 'string' ? chunk : decoder.write(chunk)
    try {
      const projection = sink(text)
      if (projection !== undefined) {
        if (typeof projection?.then === 'function') {
          void Promise.resolve(projection).catch(() => {
            // The async result is unsupported and already failed the assembly.
          })
        }
        throw new TypeError('issuerStderr must complete synchronously')
      }
    } catch (error) {
      fail(new DeveloperLaunchError(
        'supervisor:issuer-stderr-sink-failed',
        error instanceof Error ? error.message : String(error),
      ))
      return
    }
    buffer += text
    for (;;) {
      const start = ISSUER_PROMPT_START.exec(buffer)
      if (start !== null) buffer = buffer.slice(start.index)
      const match = ISSUER_PROMPT.exec(buffer)
      const end = match === null ? buffer.length : match.index + match[0].length
      if (Buffer.byteLength(buffer.slice(0, end), 'utf8') > MAX_ISSUER_PROMPT_BYTES) {
        fail(new DeveloperLaunchError('supervisor:issuer-prompt-too-large', 'issuer prompt exceeds 131072 UTF-8 bytes'))
        return
      }
      if (start === null) {
        if (match !== null) {
          fail(new DeveloperLaunchError('supervisor:issuer-prompt-malformed', 'approval challenge has no complete issuer frame'))
          return
        }
        buffer = buffer.slice(buffer.lastIndexOf('\n') + 1)
        break
      }
      if (match === null) break
      const challenge = match[1]
      const prompt = buffer.slice(0, end)
      let authorizationDigest
      if (prompt.startsWith('  +- AUTHORIZE DIGEST ')) {
        const digests = [...prompt.matchAll(/^  \| authorizationDigest: ([0-9a-f]{64})$/gmu)]
        if (digests.length !== 1) {
          fail(new DeveloperLaunchError('supervisor:issuer-prompt-malformed', 'digest prompt must contain one authorization digest'))
          return
        }
        authorizationDigest = digests[0][1]
      }
      const request = Object.freeze({
        challenge,
        prompt,
        ...(authorizationDigest === undefined ? {} : { authorizationDigest }),
      })
      buffer = buffer.slice(end)
      active = active.then(async () => {
        if (failed) return
        if (hasEnded()) { stop(); return }
        const controller = new AbortController()
        activeController = controller
        try {
          const decision = await boundedIssuerApproval((input, signal) => {
            if (hasEnded()) { stop(); return 'unavailable' }
            return approve(input, signal)
          }, request, controller)
          if (failed || hasEnded() || decision === 'unavailable') return
          await writeIssuerInput(child, decision === 'approved' ? `yes ${challenge}\n` : 'no\n')
        } finally {
          activeController = undefined
        }
      }).catch((error) => {
        fail(error instanceof DeveloperLaunchError
          ? error
          : new DeveloperLaunchError(
              'supervisor:issuer-approval-channel-failed',
              error instanceof Error ? error.message : String(error),
            ))
      })
    }
  }
  child.once('exit', stop)
  child.once('close', stop)
  child.stdin.on('error', onStdinError)
  child.stdin.once('close', stop)
  child.stderr.on('data', onData)
  child.stderr.once('end', stop)
  child.stderr.once('close', stop)
  if (hasEnded()) stop()
}

/** Bound one parent approval callback below the issuer's own prompt timeout. */
function boundedIssuerApproval(approve, request, controller) {
  return new Promise((resolveDecision, rejectDecision) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', onExit)
      callback(value)
    }
    const onExit = () => {
      finish(rejectDecision, new DeveloperLaunchError(
        'supervisor:issuer-approval-cancelled',
        'issuer exited while parent approval was pending',
      ))
    }
    const timer = setTimeout(() => {
      finish(rejectDecision, new DeveloperLaunchError(
        'supervisor:issuer-approval-timeout',
        `parent approval did not settle within ${String(ISSUER_APPROVAL_CEILING_MS)}ms`,
      ))
      controller.abort('issuer approval callback timed out')
    }, ISSUER_APPROVAL_CEILING_MS)
    controller.signal.addEventListener('abort', onExit, { once: true })
    if (controller.signal.aborted) { onExit(); return }
    Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) throw new DeveloperLaunchError(
          'supervisor:issuer-approval-cancelled', 'issuer exited before parent approval began',
        )
        return approve(request, controller.signal)
      })
      .then(
        decision => decision === 'approved' || decision === 'denied' || decision === 'unavailable'
          ? finish(resolveDecision, decision)
          : finish(rejectDecision, new DeveloperLaunchError(
              'supervisor:issuer-approval-outcome-unknown',
              'approval callback returned neither approved, denied, nor unavailable',
            )),
        error => finish(rejectDecision, new DeveloperLaunchError(
          'supervisor:issuer-approval-channel-failed',
          error instanceof Error ? error.message : String(error),
        )),
      )
  })
}

/** Write one issuer answer with an observed completion callback. */
function writeIssuerInput(child, answer) {
  return new Promise((resolveWritten, reject) => {
    child.stdin.write(answer, error => error === null || error === undefined ? resolveWritten() : reject(error))
  })
}
