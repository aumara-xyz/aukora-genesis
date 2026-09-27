/** Terminal-owned review helpers shared by parent source launchers. */
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { approvalArtifactDigest, parseApprovalArtifact } from '../approval/artifact.mjs'
import { renderApprovalArtifact } from '../approval/render.mjs'

/** Share one line reader across both approvals, echoing terminal edits to stderr. */
export function createTerminalLines() {
  const lines = []
  const waiters = []
  let closedError
  let finishClosed
  const closed = new Promise((resolve) => { finishClosed = resolve })
  const input = createInterface({ input: process.stdin, output: process.stderr, crlfDelay: Infinity, terminal: process.stdin.isTTY })
  input.on('line', (line) => {
    const waiter = waiters.shift()
    if (waiter === undefined) lines.push(line)
    else waiter.resolve(line)
  })
  input.once('close', () => {
    closedError = new Error('supervisor: approval input closed')
    for (const waiter of waiters.splice(0)) waiter.reject(closedError)
    finishClosed()
  })
  return {
    closed,
    read(signal) {
      if (signal.aborted) return Promise.reject(new Error('supervisor: approval cancelled'))
      const line = lines.shift()
      if (line !== undefined) return Promise.resolve(line)
      if (closedError !== undefined) return Promise.reject(closedError)
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject }
        const onAbort = () => {
          const index = waiters.indexOf(waiter)
          if (index !== -1) waiters.splice(index, 1)
          reject(new Error('supervisor: approval cancelled'))
        }
        waiter.resolve = (value) => {
          signal.removeEventListener('abort', onAbort)
          resolve(value)
        }
        waiter.reject = (error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        }
        signal.addEventListener('abort', onAbort, { once: true })
        waiters.push(waiter)
      })
    },
    close() { input.close() },
  }
}

/** Render one exact operation in the parent and require its fresh challenge. */
export async function reviewApprovalArtifact(terminal, request, signal) {
  let artifact
  try {
    artifact = parseApprovalArtifact(request?.artifact)
  } catch {
    return 'denied'
  }
  if (approvalArtifactDigest(artifact) !== request?.artifactDigest) return 'denied'
  const challenge = randomBytes(8).toString('hex')
  process.stderr.write(renderApprovalArtifact(artifact, challenge))
  return await terminal.read(signal) === `yes ${challenge}` ? 'approved' : 'denied'
}

/** Require the issuer's independently rendered fresh challenge. */
export async function reviewIssuerChallenge(terminal, request, signal) {
  return await terminal.read(signal) === `yes ${request.challenge}` ? 'approved' : 'denied'
}
