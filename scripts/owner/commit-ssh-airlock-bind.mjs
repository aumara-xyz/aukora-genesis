#!/usr/bin/env node
/**
 * One-use Airlock bind check for commit SSH sign.
 *
 * With AUKORA_COMMIT_BIND_PROOF_DIR set:
 *   Digests compared come FROM the independent proof store via consume —
 *   not from the caller's proof.operationDigest. Challenge is a locator only.
 *   Closes Alpha 2 anti-oracle refuse (jobs/M2b-PROOF-STORE.md).
 *
 * Without store dir (MODE=spike|test):
 *   Legacy in-process Map + caller proof fields. Compatible with landed court.
 *   Not an independent store — production MUST set PROOF_DIR (see protocol).
 *
 * NOT wired into aumlok-candidate-authority (fence:authority-path).
 */
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { consumeCommitBindProof } from '../../plugins/aukora-owner-daemon/lib/commit-bind-proof-store.mjs'
import { separateUidRequired } from '../../plugins/aukora-owner-daemon/lib/commit-bind-custody.mjs'

const HEX64 = /^[0-9a-f]{64}$/u
const fail = (code) => {
  const err = new Error(code)
  err.code = code
  throw err
}

const seen = new Map() // challenge -> expiresAt; FALLBACK when PROOF_DIR unset

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * @param {{ unsignedBytes: Buffer|string, approvalDigest: string, proof: {
 *   challenge: string, operationDigest?: string, decisionSignature?: string,
 *   expiresAt?: number
 * }}} args
 * @returns {{ bindDigest: string, challenge: string, source: 'store'|'stub' }}
 */
export function assertOneUseCommitBind({ unsignedBytes, approvalDigest, proof }) {
  if (!Buffer.isBuffer(unsignedBytes) && typeof unsignedBytes !== 'string') fail('commit-bind:unsigned-missing')
  if (typeof approvalDigest !== 'string' || !HEX64.test(approvalDigest)) fail('commit-bind:approval-digest-missing')
  if (!proof || typeof proof !== 'object') fail('commit-bind:proof-missing')

  const mode = process.env.AUKORA_COMMIT_SIGN_MODE
  if (mode !== 'spike' && mode !== 'test') fail('commit-bind:mode-refused')

  const bindDigest = sha256Hex(Buffer.from(unsignedBytes))
  if (approvalDigest !== bindDigest) fail('commit-bind:bind-mismatch')

  const { challenge } = proof
  if (typeof challenge !== 'string' || !HEX64.test(challenge)) fail('commit-bind:proof-invalid')

  const storeDir = process.env.AUKORA_COMMIT_BIND_PROOF_DIR
  // Separate-UID mode is store-only; never downgrade to the caller-authored stub.
  if (separateUidRequired() && (typeof storeDir !== 'string' || storeDir.length === 0)) {
    fail('commit-bind:proof-dir-missing')
  }
  if (typeof storeDir === 'string' && storeDir.length > 0) {
    let consumed
    try {
      consumed = consumeCommitBindProof({ challenge, unsignedBytes, storeDir })
    } catch (error) {
      const code = error?.code
      if (typeof code === 'string' && code.startsWith('proof-store:')) {
        if (code === 'proof-store:missing') fail('commit-bind:proof-missing')
        if (code === 'proof-store:replay') fail('commit-bind:proof-replay')
        if (code === 'proof-store:expired') fail('commit-bind:proof-expired')
        if (code === 'proof-store:digest-not-bound') fail('commit-bind:digest-not-bound')
        fail(code)
      }
      throw error
    }
    // Cross-check only: caller-supplied operationDigest, if present, must equal store D.
    if (typeof proof.operationDigest === 'string' && proof.operationDigest.length > 0) {
      if (!HEX64.test(proof.operationDigest) || proof.operationDigest !== consumed.bindDigest) {
        fail('commit-bind:digest-not-bound')
      }
    }
    if (consumed.bindDigest !== bindDigest) fail('commit-bind:digest-not-bound')
    return { bindDigest: consumed.bindDigest, challenge, source: 'store' }
  }

  // Fallback stub Map (not independent — production sets PROOF_DIR).
  const { operationDigest, decisionSignature, expiresAt } = proof
  if (typeof operationDigest !== 'string' || !HEX64.test(operationDigest)) fail('commit-bind:proof-invalid')
  if (operationDigest !== bindDigest) fail('commit-bind:digest-not-bound')
  if (typeof decisionSignature !== 'string' || decisionSignature.length < 32) fail('commit-bind:proof-invalid')

  const now = Math.floor(Date.now() / 1000)
  for (const [k, exp] of seen) if (exp <= now) seen.delete(k)
  if (typeof expiresAt === 'number' && now >= expiresAt) fail('commit-bind:proof-expired')
  if (seen.has(challenge)) fail('commit-bind:proof-replay')
  if (seen.size >= 4096) fail('commit-bind:busy')
  seen.set(challenge, typeof expiresAt === 'number' ? expiresAt : now + 300)

  return { bindDigest, challenge, source: 'stub' }
}

/** Clear stub seen-map (tests only). */
export function _resetCommitBindSeenForTests() {
  seen.clear()
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stderr.write('commit-ssh-airlock-bind.mjs: library; import assertOneUseCommitBind\n')
  process.exit(2)
}
