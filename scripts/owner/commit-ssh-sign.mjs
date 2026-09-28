#!/usr/bin/env node
/**
 * Owner commit-SSH-sign helper (v1 metal).
 *
 * Accepts exact unsigned commit object bytes + an approvalDigest that must bind
 * to those bytes, then returns SSHSIG armor (namespace `git`) suitable for
 * gpgsig / `git verify-commit`.
 *
 * BIND RULE (v1 test/spike — NOT production Airlock):
 *   approvalDigest MUST equal sha256(unsignedCommitBytes) as lowercase hex,
 *   OR, when AUKORA_COMMIT_BIND_DIGEST is set to a 64-hex value (fixtures only),
 *   approvalDigest must equal that env value. Unsigned bytes are still what
 *   get signed either way.
 * Production (P3): Airlock one-use approval covering exactly these bytes
 * replaces this bind. Helper must never become an oracle over arbitrary
 * app-authored preimages.
 *
 * v1 signing gate:
 *   AUKORA_COMMIT_SIGN_MODE must be `spike` or `test`
 *   AUKORA_COMMIT_SIGN_KEY must point at an SSH private key (outside app UID /
 *   outside repo in production). Never logged.
 *
 * Airlock fill-in stub: pass `proof` (opaque) for a future one-use receipt;
 * v1 ignores proof contents after the digest bind succeeds.
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
 * Enforce the v1 bind rule (see file header). Does not touch key material.
 */
export function assertCommitSignBind(unsignedBytes, approvalDigest) {
  if (!Buffer.isBuffer(unsignedBytes) && typeof unsignedBytes !== 'string') fail('commit-sign:unsigned-missing')
  if (typeof approvalDigest !== 'string' || !HEX64.test(approvalDigest)) fail('commit-sign:approval-digest-missing')
  const bindEnv = process.env.AUKORA_COMMIT_BIND_DIGEST
  const expected = (typeof bindEnv === 'string' && HEX64.test(bindEnv))
    ? bindEnv
    : sha256Hex(Buffer.from(unsignedBytes))
  if (approvalDigest !== expected) fail('commit-sign:bind-mismatch')
}

/**
 * Sign exact unsigned commit bytes. Returns SSH signature armor text.
 * @param {{ unsignedBytes: Buffer|string, approvalDigest: string, proof?: unknown }} args
 */
export function signCommitBytes({ unsignedBytes, approvalDigest, proof: _proof }) {
  assertCommitSignBind(unsignedBytes, approvalDigest)
  const mode = process.env.AUKORA_COMMIT_SIGN_MODE
  if (mode !== 'spike' && mode !== 'test') fail('commit-sign:mode-refused')
  const key = process.env.AUKORA_COMMIT_SIGN_KEY
  if (typeof key !== 'string' || key.length === 0) fail('commit-sign:key-missing')
  if (!existsSync(key)) fail('commit-sign:key-missing')

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
