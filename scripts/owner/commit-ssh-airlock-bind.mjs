#!/usr/bin/env node
/**
 * P3 stub — one-use Airlock bind check for commit SSH sign.
 *
 * Production: owner daemon verifies decision signature + consumes challenge.
 * This stub (MODE=spike|test only) enforces the *digest bind* half so the
 * helper cannot become an oracle: proof.operationDigest MUST equal
 * sha256(unsignedCommitBytes) AND approvalDigest. Challenge one-use is
 * tracked in-process (Map); real Airlock uses airlock-protocol seen-map.
 *
 * NOT wired into aumlok-candidate-authority (fence:authority-path).
 * See ~/aukora-live/jobs/M2b-P3-BIND.md.
 */
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const HEX64 = /^[0-9a-f]{64}$/u
const fail = (code) => {
  const err = new Error(code)
  err.code = code
  throw err
}

const seen = new Map() // challenge -> expiresAt (unix sec); stub only

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * @param {{ unsignedBytes: Buffer|string, approvalDigest: string, proof: {
 *   challenge: string, operationDigest: string, decisionSignature?: string,
 *   expiresAt?: number
 * }}} args
 * @returns {{ bindDigest: string, challenge: string }}
 */
export function assertOneUseCommitBind({ unsignedBytes, approvalDigest, proof }) {
  if (!Buffer.isBuffer(unsignedBytes) && typeof unsignedBytes !== 'string') fail('commit-bind:unsigned-missing')
  if (typeof approvalDigest !== 'string' || !HEX64.test(approvalDigest)) fail('commit-bind:approval-digest-missing')
  if (!proof || typeof proof !== 'object') fail('commit-bind:proof-missing')

  const mode = process.env.AUKORA_COMMIT_SIGN_MODE
  if (mode !== 'spike' && mode !== 'test') fail('commit-bind:mode-refused')

  const bindDigest = sha256Hex(Buffer.from(unsignedBytes))
  if (approvalDigest !== bindDigest) fail('commit-bind:bind-mismatch')

  const { challenge, operationDigest, decisionSignature, expiresAt } = proof
  if (typeof challenge !== 'string' || !HEX64.test(challenge)) fail('commit-bind:proof-invalid')
  if (typeof operationDigest !== 'string' || !HEX64.test(operationDigest)) fail('commit-bind:proof-invalid')
  if (operationDigest !== bindDigest) fail('commit-bind:digest-not-bound')

  // Spike/test: require a non-empty decisionSignature placeholder; real verify is owner-daemon.
  if (typeof decisionSignature !== 'string' || decisionSignature.length < 32) fail('commit-bind:proof-invalid')

  const now = Math.floor(Date.now() / 1000)
  for (const [k, exp] of seen) if (exp <= now) seen.delete(k)
  if (typeof expiresAt === 'number' && now >= expiresAt) fail('commit-bind:proof-expired')
  if (seen.has(challenge)) fail('commit-bind:proof-replay')
  if (seen.size >= 4096) fail('commit-bind:busy')
  seen.set(challenge, typeof expiresAt === 'number' ? expiresAt : now + 300)

  return { bindDigest, challenge }
}

/** Clear stub seen-map (tests only). */
export function _resetCommitBindSeenForTests() {
  seen.clear()
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stderr.write('commit-ssh-airlock-bind.mjs: library stub; import assertOneUseCommitBind\n')
  process.exit(2)
}
