#!/usr/bin/env node
/**
 * Owner commit-SSH-sign helper (v1 metal + hostile harden).
 *
 * Accepts exact unsigned commit object bytes + an approvalDigest that must bind
 * to those bytes, then returns SSHSIG armor (namespace `git`) suitable for
 * gpgsig / `git verify-commit`.
 *
 * BIND RULE:
 *   approvalDigest MUST equal sha256(unsignedCommitBytes) as lowercase hex.
 *   Fixture AUKORA_COMMIT_BIND_DIGEST (64-hex) is honoured ONLY when
 *   AUKORA_COMMIT_SIGN_MODE=test; any other mode refuses bind-digest-refused
 *   (hostile: fixture must not delete the bind outside the court).
 *
 * PROOF RULE:
 *   Non-test mode (spike today; later production) REQUIRES `proof` and runs
 *   assertOneUseCommitBind (stub ok — digest bind + in-process one-use).
 *   Test mode: proof optional; if present, still validated by the stub.
 *
 * Signing gate:
 *   AUKORA_COMMIT_SIGN_MODE must be `spike` or `test`
 *   AUKORA_COMMIT_SIGN_KEY must point at an SSH private key (outside app UID /
 *   outside repo in production). Never logged.
 *
 * Production (P3): Airlock one-use approval covering exact unsigned bytes
 * replaces the test fixture; helper must never become an oracle over arbitrary
 * app-authored preimages. Signer hashes bytes itself for the bind check —
 * caller cannot forge provenance by supplying a mismatched digest alone.
 *
 *   import { signCommitBytes, assertCommitSignBind } from './commit-ssh-sign.mjs'
 *   node scripts/owner/commit-ssh-sign.mjs --unsigned-file PATH --approval-digest HEX
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertOneUseCommitBind } from './commit-ssh-airlock-bind.mjs'
import { assertCommitKeyCustody } from '../../plugins/aukora-owner-daemon/lib/commit-bind-custody.mjs'

const HEX64 = /^[0-9a-f]{64}$/u
const fail = (code) => {
  const err = new Error(code)
  err.code = code
  throw err
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Enforce the bind rule (see file header). Does not touch key material.
 * Signer-side hash: expected digest is computed HERE from unsignedBytes unless
 * the test-only fixture is active.
 */
export function assertCommitSignBind(unsignedBytes, approvalDigest) {
  if (!Buffer.isBuffer(unsignedBytes) && typeof unsignedBytes !== 'string') fail('commit-sign:unsigned-missing')
  if (typeof approvalDigest !== 'string' || !HEX64.test(approvalDigest)) fail('commit-sign:approval-digest-missing')

  const bindEnv = process.env.AUKORA_COMMIT_BIND_DIGEST
  if (typeof bindEnv === 'string' && bindEnv.length > 0) {
    // Hostile harden: fixture deletes the byte-hash bind — allow ONLY in MODE=test.
    if (process.env.AUKORA_COMMIT_SIGN_MODE !== 'test') fail('commit-sign:bind-digest-refused')
    if (!HEX64.test(bindEnv)) fail('commit-sign:bind-digest-refused')
    if (approvalDigest !== bindEnv) fail('commit-sign:bind-mismatch')
    return
  }

  const expected = sha256Hex(Buffer.from(unsignedBytes))
  if (approvalDigest !== expected) fail('commit-sign:bind-mismatch')
}

/**
 * Sign exact unsigned commit bytes. Returns SSH signature armor text.
 * @param {{ unsignedBytes: Buffer|string, approvalDigest: string, proof?: object }} args
 */
export function signCommitBytes({ unsignedBytes, approvalDigest, proof }) {
  // Mode gate BEFORE bind/fixture so BIND_DIGEST cannot outrank MODE.
  const mode = process.env.AUKORA_COMMIT_SIGN_MODE
  if (mode !== 'spike' && mode !== 'test') fail('commit-sign:mode-refused')

  assertCommitSignBind(unsignedBytes, approvalDigest)

  // Non-test: proof required (stub verifier ok). Test: optional.
  if (mode !== 'test') {
    if (proof == null) fail('commit-sign:proof-missing')
    assertOneUseCommitBind({ unsignedBytes, approvalDigest, proof })
  } else if (proof != null) {
    assertOneUseCommitBind({ unsignedBytes, approvalDigest, proof })
  }

  const key = process.env.AUKORA_COMMIT_SIGN_KEY
  if (typeof key !== 'string' || key.length === 0) fail('commit-sign:key-missing')
  if (!existsSync(key)) fail('commit-sign:key-missing')
  // R1: optional separate-UID/key custody refuse; UID pin is shared with PROOF_DIR. Default off.
  assertCommitKeyCustody({ keyPath: key })

  const dir = mkdtempSync(join(tmpdir(), 'aukora-commit-sign-'))
  try {
    const preimage = join(dir, 'unsigned')
    writeFileSync(preimage, Buffer.from(unsignedBytes))
    // ssh-keygen writes <preimage>.sig; isolate HOME; never print key path contents.
    execFileSync('/usr/bin/ssh-keygen', ['-Y', 'sign', '-n', 'git', '-f', key, preimage], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', HOME: dir, LANG: 'C', LC_ALL: 'C' },
    })
    const armor = readFileSync(`${preimage}.sig`, 'utf8')
    if (!armor.includes('BEGIN SSH SIGNATURE')) fail('commit-sign:sign-failed')
    return armor
  } catch (error) {
    if (typeof error?.code === 'string' && error.code.startsWith('commit-sign:')) throw error
    if (typeof error?.code === 'string' && error.code.startsWith('commit-bind:')) throw error
    fail('commit-sign:sign-failed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function main(argv) {
  const fileFlag = argv.indexOf('--unsigned-file')
  const digestFlag = argv.indexOf('--approval-digest')
  if (fileFlag < 0 || digestFlag < 0 || !argv[fileFlag + 1] || !argv[digestFlag + 1]) {
    process.stderr.write('usage: commit-ssh-sign.mjs --unsigned-file PATH --approval-digest HEX64\n')
    process.exit(2)
  }
  const unsignedBytes = readFileSync(argv[fileFlag + 1])
  const approvalDigest = argv[digestFlag + 1]
  try {
    process.stdout.write(signCommitBytes({ unsignedBytes, approvalDigest }))
  } catch (error) {
    process.stderr.write(`${error?.code ?? error?.message ?? 'commit-sign:failed'}\n`)
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
