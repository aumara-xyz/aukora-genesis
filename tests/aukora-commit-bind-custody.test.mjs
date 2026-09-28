/**
 * M2-R1 custody court — refuse when PROOF_DIR / commit key is not owned by the
 * pinned issuer UID or when callers try to inject custody facts.
 * Default-off: without AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID, no refuse.
 * Does not require a live second macOS account (mocked stat / temp dirs).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertProofDirCustody, assertCommitKeyCustody, separateUidRequired,
} from '../plugins/aukora-owner-daemon/lib/commit-bind-custody.mjs'
import {
  mintCommitBindProof, consumeCommitBindProof, sha256Hex, _resetProofStoreForTests,
} from '../plugins/aukora-owner-daemon/lib/commit-bind-proof-store.mjs'

const ENV = [
  'AUKORA_COMMIT_SIGN_MODE',
  'AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID',
  'AUKORA_COMMIT_BIND_PROOF_DIR',
  'AUKORA_COMMIT_BIND_PROOF_UID',
]
const savedEnv = new Map(ENV.map((name) => [name, process.env[name]]))
for (const name of ENV) delete process.env[name]

const scratch = mkdtempSync(join(tmpdir(), 'aukora-custody-'))
const storeDir = join(scratch, 'store')
mkdirSync(storeDir, { recursive: true, mode: 0o700 })
chmodSync(storeDir, 0o700)
const keyPath = join(scratch, 'id_ed25519')
writeFileSync(keyPath, 'NOT-A-REAL-KEY\n', { mode: 0o600 })
chmodSync(keyPath, 0o600)

const me = process.getuid()
const otherUid = me === 0 ? 501 : me + 1
const mockStat = (uid, mode, isDir = true) => () => ({
  uid,
  mode: 0o100000 | mode,
  isDirectory: () => isDir,
  isFile: () => !isDir,
})

try {
  assert.equal(separateUidRequired(false), false)
  assert.equal(separateUidRequired(undefined), false)
  console.log('PASS separateUidRequired default-off + explicit false')

  const off = assertProofDirCustody({
    storeDir, callerEuid: me, requireSeparateUid: false,
  })
  assert.equal(off.enforced, false)
  console.log('PASS proof-dir custody no-op when requireSeparateUid=false')

  process.env.AUKORA_COMMIT_SIGN_MODE = 'test'
  process.env.AUKORA_COMMIT_BIND_PROOF_UID = String(otherUid)
  assert.throws(
    () => assertProofDirCustody({
      storeDir, callerEuid: me, requireSeparateUid: true,
    }),
    (err) => err && err.code === 'proof-store:same-uid',
  )
  console.log('PASS proof-dir same-uid refused when required')

  const ok = assertProofDirCustody({
    storeDir, callerEuid: me, requireSeparateUid: true,
    statSync: mockStat(otherUid, 0o700, true),
  })
  assert.equal(ok.enforced, true)
  assert.equal(ok.uid, otherUid)
  console.log('PASS proof-dir separate uid accepted only by test seam')

  assert.throws(
    () => assertProofDirCustody({
      storeDir, callerEuid: me, requireSeparateUid: true,
      statSync: mockStat(otherUid + 1, 0o700, true),
    }),
    (err) => err && err.code === 'proof-store:owner-uid',
  )
  console.log('PASS proof-dir owner UID pin refused mismatch')

  process.env.AUKORA_COMMIT_SIGN_MODE = 'spike'
  assert.throws(
    () => assertProofDirCustody({
      storeDir, callerEuid: me, requireSeparateUid: true,
      statSync: mockStat(otherUid, 0o700, true),
    }),
    (err) => err && err.code === 'proof-store:stat-injection-refused',
  )
  console.log('PASS proof-dir stat injection refused outside MODE=test')

  process.env.AUKORA_COMMIT_SIGN_MODE = 'test'
  assert.throws(
    () => assertCommitKeyCustody({
      keyPath, callerEuid: me, requireSeparateUid: true,
    }),
    (err) => err && err.code === 'commit-sign:key-same-uid',
  )
  console.log('PASS commit-key same-uid refused when required')

  const keyOk = assertCommitKeyCustody({
    keyPath, callerEuid: me, requireSeparateUid: true,
    statSync: mockStat(otherUid, 0o600, false),
  })
  assert.equal(keyOk.enforced, true)
  assert.equal(keyOk.uid, otherUid)
  console.log('PASS commit-key separate uid accepted only by test seam')

  assert.throws(
    () => assertCommitKeyCustody({
      keyPath, callerEuid: me, requireSeparateUid: true,
      statSync: mockStat(otherUid, 0o640, false),
    }),
    (err) => err && err.code === 'commit-sign:key-mode',
  )
  console.log('PASS commit-key key-mode refused')

  process.env.AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID = '1'
  process.env.AUKORA_COMMIT_BIND_PROOF_DIR = storeDir
  const now = Math.floor(Date.now() / 1000)
  const ch = 'ab'.repeat(32)
  assert.throws(
    () => mintCommitBindProof({
      challenge: ch,
      bindDigest: sha256Hex(Buffer.from('x')),
      decisionSignature: 'decision-signature-placeholder-' + 'y'.repeat(32),
      issuedAt: now, expiresAt: now + 120, storeDir,
    }),
    (err) => err && err.code === 'proof-store:same-uid',
  )
  console.log('PASS mint refuses same-uid store when REQUIRE_SEPARATE_UID=1')

  delete process.env.AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID
  const bytes = Buffer.from('unsigned-for-custody-court')
  const D = sha256Hex(bytes)
  const ch2 = 'cd'.repeat(32)
  mintCommitBindProof({
    challenge: ch2, bindDigest: D,
    decisionSignature: 'decision-signature-placeholder-' + 'y'.repeat(32),
    issuedAt: now, expiresAt: now + 120, storeDir,
  })
  const consumed = consumeCommitBindProof({ challenge: ch2, unsignedBytes: bytes, storeDir })
  assert.equal(consumed.bindDigest, D)
  console.log('PASS mint/consume still work on same-uid temp when flag unset')

  console.log('PASS aukora-commit-bind-custody focused court')
} finally {
  for (const name of ENV) delete process.env[name]
  try { _resetProofStoreForTests(storeDir) } catch { /* ok */ }
  rmSync(scratch, { recursive: true, force: true })
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}
