/**
 * M2b proof-store court — independent one-use commit-bind store.
 * Digests at consume come FROM the store, not the caller (Alpha 2 anti-oracle).
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mintCommitBindProof, consumeCommitBindProof, sha256Hex, _resetProofStoreForTests,
} from '../plugins/aukora-owner-daemon/lib/commit-bind-proof-store.mjs'
import {
  assertOneUseCommitBind, _resetCommitBindSeenForTests,
} from '../scripts/owner/commit-ssh-airlock-bind.mjs'

const ENV = ['AUKORA_COMMIT_SIGN_MODE', 'AUKORA_COMMIT_BIND_PROOF_DIR',
  'AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID', 'AUKORA_COMMIT_BIND_PROOF_UID']
const savedEnv = new Map(ENV.map((name) => [name, process.env[name]]))
for (const name of ENV) delete process.env[name]

const scratch = mkdtempSync(join(tmpdir(), 'aukora-proof-store-'))
const storeDir = join(scratch, 'store')

const challenge = () => randomBytes(32).toString('hex')
const sig = 'decision-signature-placeholder-' + 'y'.repeat(32)

try {
  const bytesX = Buffer.from('unsigned-commit-bytes-for-X')
  const bytesY = Buffer.from('unsigned-commit-bytes-for-Y')
  const Dx = sha256Hex(bytesX)
  const Dy = sha256Hex(bytesY)
  assert.notEqual(Dx, Dy)

  const ch = challenge()
  const now = Math.floor(Date.now() / 1000)
  mintCommitBindProof({
    challenge: ch, bindDigest: Dx, decisionSignature: sig,
    issuedAt: now, expiresAt: now + 120, storeDir,
  })
  assert.throws(
    () => mintCommitBindProof({
      challenge: ch, bindDigest: Dx, decisionSignature: sig,
      issuedAt: now, expiresAt: now + 120, storeDir,
    }),
    /proof-store:challenge-exists/,
  )
  console.log('PASS mint exclusive; duplicate challenge refused')

  const consumed = consumeCommitBindProof({ challenge: ch, unsignedBytes: bytesX, storeDir })
  assert.equal(consumed.bindDigest, Dx)
  assert.throws(
    () => consumeCommitBindProof({ challenge: ch, unsignedBytes: bytesX, storeDir }),
    /proof-store:replay/,
  )
  console.log('PASS consume returns store D; replay refused')

  const ch2 = challenge()
  mintCommitBindProof({
    challenge: ch2, bindDigest: Dx, decisionSignature: sig,
    issuedAt: now, expiresAt: now + 120, storeDir,
  })
  assert.throws(
    () => consumeCommitBindProof({ challenge: ch2, unsignedBytes: bytesY, storeDir }),
    /proof-store:digest-not-bound/,
  )
  console.log('PASS store Dx cannot authorize bytes Y (anti-oracle)')

  _resetCommitBindSeenForTests()
  process.env.AUKORA_COMMIT_SIGN_MODE = 'spike'
  process.env.AUKORA_COMMIT_BIND_PROOF_DIR = storeDir
  const ch3 = challenge()
  mintCommitBindProof({
    challenge: ch3, bindDigest: Dx, decisionSignature: sig,
    issuedAt: now, expiresAt: now + 120, storeDir,
  })
  const got = assertOneUseCommitBind({
    unsignedBytes: bytesX,
    approvalDigest: Dx,
    proof: { challenge: ch3 },
  })
  assert.equal(got.source, 'store')
  assert.equal(got.bindDigest, Dx)
  console.log('PASS assertOneUseCommitBind consumes store; caller operationDigest optional')

  // Separate-UID mode must not silently downgrade to the caller-authored stub.
  delete process.env.AUKORA_COMMIT_BIND_PROOF_DIR
  process.env.AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID = '1'
  assert.throws(
    () => assertOneUseCommitBind({
      unsignedBytes: bytesX, approvalDigest: Dx, proof: { challenge: challenge() },
    }),
    /commit-bind:proof-dir-missing/,
  )
  console.log('PASS REQUIRE_SEPARATE_UID without PROOF_DIR refuses (D1)')

  // With the flag unset, spike still uses stub (default-off compatibility).
  delete process.env.AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID
  _resetCommitBindSeenForTests()
  const stub = assertOneUseCommitBind({
    unsignedBytes: bytesX,
    approvalDigest: Dx,
    proof: { challenge: challenge(), operationDigest: Dx, decisionSignature: sig, expiresAt: now + 60 },
  })
  assert.equal(stub.source, 'stub')
  console.log('PASS spike without PROOF_DIR falls back to stub Map (compat)')

  console.log('PASS aukora-commit-bind-proof-store focused court')
} finally {
  for (const name of ENV) delete process.env[name]
  try { _resetProofStoreForTests(storeDir) } catch { /* dir may be incomplete */ }
  rmSync(scratch, { recursive: true, force: true })
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}
