/**
 * M2b metal — SSH-signed candidate commits (focused court).
 * Self-contained: generates an ephemeral ED25519 key in os.tmpdir(); does not
 * read ~/aukora-live or any owner key. Flag-off path stays unsigned.
 * Hostile harden: BIND_DIGEST fixture only in MODE=test; non-test requires proof.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertCommitSignBind, signCommitBytes, sha256Hex,
} from '../scripts/owner/commit-ssh-sign.mjs'
import { _resetCommitBindSeenForTests } from '../scripts/owner/commit-ssh-airlock-bind.mjs'
import { writeCandidateCommit } from '../scripts/aukora/commit-ssh-candidate.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'aukora-commit-ssh-'))
const key = join(scratch, 'commit-test')
const allowed = join(scratch, 'allowed_signers')
const repo = join(scratch, 'repo')
mkdirSync(repo)

const CUSTODY_ENV = [
  'AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID',
  'AUKORA_COMMIT_BIND_PROOF_DIR',
  'AUKORA_COMMIT_BIND_PROOF_UID',
]
const savedCustodyEnv = new Map(CUSTODY_ENV.map((name) => [name, process.env[name]]))
for (const name of CUSTODY_ENV) delete process.env[name]

const cleanEnv = {
  PATH: '/usr/bin:/bin',
  HOME: scratch,
  TMPDIR: scratch,
  LANG: 'C',
  LC_ALL: 'C',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
}

const stubProof = (operationDigest) => ({
  challenge: randomBytes(32).toString('hex'),
  operationDigest,
  decisionSignature: 'stub-decision-signature-' + 'x'.repeat(32),
  expiresAt: Math.floor(Date.now() / 1000) + 120,
})

try {
  execFileSync('/usr/bin/ssh-keygen', ['-t', 'ed25519', '-f', key, '-N', '', '-C', 'aukora-m2b-test'], {
    encoding: 'utf8', env: cleanEnv, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const pub = readFileSync(`${key}.pub`, 'utf8').trim().split(/\s+/).slice(0, 2).join(' ')
  writeFileSync(allowed, `* namespaces="git" ${pub}\n`)

  const gitRaw = (args, input, extraEnv = {}) => execFileSync('/usr/bin/git', ['-C', repo, ...args], {
    input, encoding: 'utf8',
    env: {
      ...cleanEnv,
      GIT_AUTHOR_NAME: 'Auma Approved Change', GIT_AUTHOR_EMAIL: 'approved@localhost',
      GIT_COMMITTER_NAME: 'Auma Approved Change', GIT_COMMITTER_EMAIL: 'approved@localhost',
      GIT_AUTHOR_DATE: '2026-09-28T10:00:00+0800', GIT_COMMITTER_DATE: '2026-09-28T10:00:00+0800',
      ...extraEnv,
    },
  }).trim()

  gitRaw(['init', '-q', '--initial-branch=main'])
  const tree = gitRaw(['mktree'], '')
  const root = gitRaw(['commit-tree', tree, '-m', 'root'])
  gitRaw(['update-ref', 'HEAD', root])

  // --- helper bind + sign ---
  const unsignedOid = gitRaw(['commit-tree', tree, '-p', root, '-m', 'helper preimage'])
  const unsignedBytes = Buffer.from(execFileSync('/usr/bin/git', ['-C', repo, 'cat-file', 'commit', unsignedOid], {
    encoding: 'buffer', env: cleanEnv,
  }))
  const goodDigest = sha256Hex(unsignedBytes)

  assert.throws(() => assertCommitSignBind(unsignedBytes, ''), /approval-digest-missing/)
  assert.throws(() => assertCommitSignBind(unsignedBytes, 'ab'.repeat(32)), /bind-mismatch/)
  assertCommitSignBind(unsignedBytes, goodDigest)

  process.env.AUKORA_COMMIT_SIGN_MODE = 'test'
  process.env.AUKORA_COMMIT_SIGN_KEY = key
  const armor = signCommitBytes({ unsignedBytes, approvalDigest: goodDigest })
  assert.match(armor, /BEGIN SSH SIGNATURE/)
  console.log('PASS helper signs when bind=sha256(unsigned) and MODE=test')

  assert.throws(() => signCommitBytes({ unsignedBytes, approvalDigest: 'cd'.repeat(32) }), /bind-mismatch/)
  console.log('PASS helper refuses bind mismatch')

  delete process.env.AUKORA_COMMIT_SIGN_KEY
  assert.throws(() => signCommitBytes({ unsignedBytes, approvalDigest: goodDigest }), /key-missing/)
  process.env.AUKORA_COMMIT_SIGN_KEY = key
  process.env.AUKORA_COMMIT_SIGN_MODE = 'prod'
  assert.throws(() => signCommitBytes({ unsignedBytes, approvalDigest: goodDigest }), /mode-refused/)
  process.env.AUKORA_COMMIT_SIGN_MODE = 'test'
  console.log('PASS helper refuses missing key and non-spike/test mode')

  // Fixture override: ONLY when MODE=test
  process.env.AUKORA_COMMIT_SIGN_MODE = 'test'
  process.env.AUKORA_COMMIT_BIND_DIGEST = 'ef'.repeat(32)
  assert.throws(() => assertCommitSignBind(unsignedBytes, goodDigest), /bind-mismatch/)
  assertCommitSignBind(unsignedBytes, 'ef'.repeat(32))
  delete process.env.AUKORA_COMMIT_BIND_DIGEST
  console.log('PASS AUKORA_COMMIT_BIND_DIGEST fixture override in MODE=test only')

  // Hostile: BIND_DIGEST refused outside MODE=test (spike)
  process.env.AUKORA_COMMIT_SIGN_MODE = 'spike'
  process.env.AUKORA_COMMIT_BIND_DIGEST = 'ef'.repeat(32)
  assert.throws(() => assertCommitSignBind(unsignedBytes, 'ef'.repeat(32)), /bind-digest-refused/)
  assert.throws(
    () => signCommitBytes({ unsignedBytes, approvalDigest: 'ef'.repeat(32), proof: stubProof('ef'.repeat(32)) }),
    /bind-digest-refused/,
  )
  delete process.env.AUKORA_COMMIT_BIND_DIGEST
  console.log('PASS AUKORA_COMMIT_BIND_DIGEST refused unless MODE=test')

  // Non-test (spike): proof required; stub ok
  _resetCommitBindSeenForTests()
  process.env.AUKORA_COMMIT_SIGN_MODE = 'spike'
  process.env.AUKORA_COMMIT_SIGN_KEY = key
  assert.throws(() => signCommitBytes({ unsignedBytes, approvalDigest: goodDigest }), /proof-missing/)
  const proof = stubProof(goodDigest)
  const armorSpike = signCommitBytes({ unsignedBytes, approvalDigest: goodDigest, proof })
  assert.match(armorSpike, /BEGIN SSH SIGNATURE/)
  // replay same challenge refused
  assert.throws(
    () => signCommitBytes({ unsignedBytes, approvalDigest: goodDigest, proof }),
    /proof-replay|commit-bind:proof-replay/,
  )
  console.log('PASS non-test mode requires proof (stub); replay refused')

  process.env.AUKORA_COMMIT_SIGN_MODE = 'test'

  // --- writeCandidateCommit flag OFF (default unsigned) ---
  delete process.env.AUKORA_REQUIRE_COMMIT_SSH
  delete process.env.AUKORA_COMMIT_SIGN_KEY
  delete process.env.AUKORA_COMMIT_ALLOWED_SIGNERS
  const message = 'unsigned path\n\nApproved-by: did:key:zTest\nApproval-digest: ' + 'a'.repeat(64)
    + '\nOperation-digest: ' + 'b'.repeat(64) + '\nCandidate-digest: ' + 'c'.repeat(64) + '\n'
  const unsignedCommit = writeCandidateCommit(repo, { tree, base: root, message })
  assert.match(unsignedCommit, /^[0-9a-f]{40}$/)
  const cat = execFileSync('/usr/bin/git', ['-C', repo, 'cat-file', 'commit', unsignedCommit], {
    encoding: 'utf8', env: cleanEnv,
  })
  assert.ok(!cat.includes('gpgsig'), 'flag-off commit has no gpgsig')
  console.log('PASS flag-off writeCandidateCommit stays unsigned (no gpgsig)')

  // --- writeCandidateCommit flag ON + verify-commit Good ---
  process.env.AUKORA_REQUIRE_COMMIT_SSH = '1'
  process.env.AUKORA_COMMIT_SIGN_KEY = key
  process.env.AUKORA_COMMIT_ALLOWED_SIGNERS = allowed
  const signedMessage = 'signed path\n\nApproved-by: did:key:zTest\nApproval-digest: ' + 'a'.repeat(64)
    + '\nOperation-digest: ' + 'b'.repeat(64) + '\nCandidate-digest: ' + 'c'.repeat(64) + '\n'
  const signed = writeCandidateCommit(repo, { tree, base: root, message: signedMessage })
  assert.match(signed, /^[0-9a-f]{40}$/)
  execFileSync('/usr/bin/git', [
    '-C', repo, '-c', `gpg.ssh.allowedSignersFile=${allowed}`, 'verify-commit', signed,
  ], { encoding: 'utf8', env: cleanEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  const signedCat = execFileSync('/usr/bin/git', ['-C', repo, 'cat-file', 'commit', signed], {
    encoding: 'utf8', env: cleanEnv,
  })
  assert.ok(signedCat.includes('gpgsig') || signedCat.includes('BEGIN SSH SIGNATURE'), 'signed commit carries sshsig')
  assert.equal(
    execFileSync('/usr/bin/git', ['-C', repo, 'rev-parse', `${signed}^{tree}`], { encoding: 'utf8', env: cleanEnv }).trim(),
    tree,
  )
  console.log('PASS flag-on writeCandidateCommit verifies Good and tree matches', signed.slice(0, 12))

  // --- refuse: flag on, key missing ---
  delete process.env.AUKORA_COMMIT_SIGN_KEY
  assert.throws(
    () => writeCandidateCommit(repo, { tree, base: root, message: signedMessage }),
    /candidate:commit-signing-not-configured/,
  )
  process.env.AUKORA_COMMIT_SIGN_KEY = key
  console.log('PASS flag-on without key denies commit-signing-not-configured')

  // --- refuse: wrong allowed signers → verify fails ---
  const badAllowed = join(scratch, 'bad_allowed')
  const decoy = join(scratch, 'decoy')
  execFileSync('/usr/bin/ssh-keygen', ['-t', 'ed25519', '-f', decoy, '-N', '', '-C', 'decoy'], {
    encoding: 'utf8', env: cleanEnv, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const decoyPub = readFileSync(`${decoy}.pub`, 'utf8').trim().split(/\s+/).slice(0, 2).join(' ')
  writeFileSync(badAllowed, `* namespaces="git" ${decoyPub}\n`)
  process.env.AUKORA_COMMIT_ALLOWED_SIGNERS = badAllowed
  assert.throws(
    () => writeCandidateCommit(repo, { tree, base: root, message: signedMessage + 'x' }),
    /candidate:commit-signature-invalid/,
  )
  console.log('PASS flag-on with mismatched allowedSigners denies commit-signature-invalid')

  console.log('PASS aukora-commit-ssh-sign focused court')
} finally {
  for (const name of [
    'AUKORA_REQUIRE_COMMIT_SSH', 'AUKORA_COMMIT_SIGN_KEY', 'AUKORA_COMMIT_ALLOWED_SIGNERS',
    'AUKORA_COMMIT_SIGN_MODE', 'AUKORA_COMMIT_BIND_DIGEST',
    ...CUSTODY_ENV,
  ]) delete process.env[name]
  rmSync(scratch, { recursive: true, force: true })
  for (const [name, value] of savedCustodyEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}
