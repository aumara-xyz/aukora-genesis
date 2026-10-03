#!/usr/bin/env node
/**
 * AUMLOK — the stranger side of the approval receipt.
 *
 *   node tests/aukora-aumlok-verify.test.mjs
 *
 * WHO THIS COURT IS FOR. Someone handed a receipt JSON and a public key, with nothing else: no
 * checkout, no controller, no key of their own, no network. Every arm here runs the shipped
 * `scripts/aumlok/verify-approval` **from a fresh empty directory** containing exactly those two
 * files, and asserts the directory is unchanged afterwards.
 *
 * THE ORDER OF THE CHECKS IS THE POINT, SO IT IS TESTED AS ORDER. Rules that can be decided without
 * the signature are decided first. To prove that rather than assert it, the order-sensitive
 * fixtures here carry a **deliberately corrupted signature**: if the verifier reached the signature
 * before the identity and class rules, those arms would report a signature failure. They must
 * report the named identity or class refusal instead, and an arm asserts exactly that.
 *
 * WHAT A PASS MEANS, AND DOES NOT. The key supplied signed exactly those bytes. Not that anyone
 * attended — `reported-not-proven` is a field the stranger reads, not a courtesy — not that the key
 * is current, not that the history behind the receipt was not rewritten, and not that any identity
 * is bound. The court asserts the verifier prints those limits rather than only the verdict.
 *
 * DISPOSABLE KEYS ONLY. Two labelled test identities are generated into `$TMPDIR` and deleted with
 * the tree. No key of the owner's is read, written or referenced anywhere in this file.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createPublicKey } from 'node:crypto'
import { tmpdir } from 'node:os'
import { sawSomething } from './helpers/vacuity.mjs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ADAPTER_DIR = join(ROOT, 'plugins', 'aukora-aumlok', 'lib')
const BUILDER = join(ROOT, 'scripts', 'aumlok', 'make-disposable-identity.mjs')
const SIGNER = join(ROOT, 'scripts', 'aumlok', 'signer.mjs')
const VERIFY = process.env.AUKORA_COURT_VERIFY ?? join(ROOT, 'scripts', 'aumlok', 'verify-approval')

// ── MUTATION MODE, BEFORE THE VERIFIER IS RUN ────────────────────────────────────────────────────────
// THE TWO THINGS A STRANGER'S VERIFIER MAY NOT DO, BROKEN IN A COPY OF THE SHIPPED SCRIPT: accept a receipt
// whose `approvalKeyDid` is not the DID of the key they hold (the forged-identifier arm), and accept a signature
// that does not verify. Both are refused BY NAME in the real script, so each mutation must make a named refusal
// disappear — which is what the arms assert. A stale pattern is NOT-APPLICABLE and counts as a finding.
if (process.argv.includes('--mutate')) {
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const MUTATIONS = [
    { name: 'the DID check (a receipt naming another key is accepted)',
      find: "if (receipt.approvalKeyDid !== derivedDid) {\n",
      replace: "if (false) {\n" },
    { name: 'the signature check (an unverifiable signature is accepted)',
      find: "if (!verified) {\n  refuse('signature', REFUSE.SIGNATURE_INVALID,\n",
      replace: "if (false) {\n  refuse('signature', REFUSE.SIGNATURE_INVALID,\n" },
  ]
  const scratch = mkdtempSync(join(tmpdir(), 'verify-mutations-'))
  const survivors = []
  const inapplicable = []
  try {
    const source = readFileSync(VERIFY, 'utf8')
    for (const [index, mutation] of MUTATIONS.entries()) {
      const matches = source.split(mutation.find).length - 1
      if (matches === 0) {
        inapplicable.push(mutation.name)
        console.log(`  NOT-APPLICABLE  ${mutation.name} — the pattern matched 0 times`)
        continue
      }
      const mutated = join(scratch, `verify-approval-${String(index)}`)
      writeFileSync(mutated, source.replace(mutation.find, mutation.replace), { mode: 0o755 })
      const run = spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], {
        encoding: 'utf8', timeout: 900_000, env: { ...process.env, AUKORA_COURT_VERIFY: mutated },
      })
      // **A NON-ZERO EXIT IS NOT A CATCH, MEASURED.** A mutant that breaks the court's own module graph makes
      // the court exit non-zero with NO arm failing — measured on this tree: a syntax error in an imported
      // module produced zero tests and exit 1, which this harness would have recorded as CAUGHT. The court must
      // be shown to have NOTICED, so the child's own failing-arm marker is required, and a crash is reported as
      // its own verdict rather than counted as coverage.
      const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
      const armFailed = /(^|\n)(\s*(FAIL|not ok)|\s*# fail [1-9])/u.test(output)
      const caught = run.status !== 0 && armFailed
      const crashed = run.status !== 0 && !armFailed
      if (!caught) survivors.push(mutation.name)
      console.log(`  ${caught ? 'CAUGHT        ' : crashed ? 'CRASH-NOT-A-CATCH' : 'SURVIVOR      '}  ${mutation.name}${caught ? '' : crashed ? '  <- non-zero exit with NO failing arm: the court never noticed' : '  <- no arm notices this protection is gone'}`)
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  const findings = survivors.length + inapplicable.length
  console.log(findings === 0
    ? '\nVERIFY MUTATIONS: every protection is covered by an arm that fails without it.'
    : `\nVERIFY MUTATIONS: ${String(findings)} FINDING(S) — ${[...survivors, ...inapplicable.map(name => `${name} (stale pattern)`)].join('; ')}`)
  process.exit(findings === 0 ? 0 : 1)
}

/** Labelled TEST-ONLY seeds. Not anyone's keys; they exist only in this file and only for this run. */
const SEED_RECEIPT = '5a'.repeat(32)
const SEED_OTHER = 'b5'.repeat(32)
const CLOCK = 1_800_000_000
const OPERATION_DIGEST = 'ab'.repeat(32)

const adapter = await import(pathToFileURL(join(ADAPTER_DIR, 'index.mjs')).href)

let arms = 0
let missed = 0

/** Record one arm. */
function arm(label, check) {
  arms += 1
  try {
    check()
    console.log(`  ok    ${label}`)
  } catch (error) {
    missed += 1
    console.log(`  FAIL  ${label}`)
    console.log(`        ${String(error?.message ?? error).split('\n')[0]}`)
  }
}

const work = mkdtempSync(join(tmpdir(), 'aukora-aumlok-verify-'))
const running = []

/** Build one disposable controller and everything a producer or a verifier needs from it. */
function buildIdentity(name, seed) {
  const directory = join(work, name)
  const built = spawnSync(process.execPath, [BUILDER, '--directory', directory, '--ed25519-seed-hex', seed],
    { encoding: 'utf8' })
  if (built.status !== 0) throw new Error(`builder failed for ${name}: ${built.stderr}`)
  const record = JSON.parse(readFileSync(join(directory, adapter.LOCAL_AUMLOK_CONTROL_FILENAME), 'utf8'))
  const keyPath = join(directory, 'test-key.pem')
  writeFileSync(keyPath, record.ed25519PrivateKeyPem, { mode: 0o600 })
  const { projection } = adapter.loadLocalAumlokPublicControl(directory)
  return {
    directory,
    keyPath,
    projection,
    registeredKeyHex: record.activeControl.publicKeys.ed25519,
    publicKeyPem: createPublicKey(record.ed25519PrivateKeyPem).export({ type: 'spki', format: 'pem' }).toString(),
  }
}

/** Start the signer daemon for one identity and wait for READY. */
function startSigner(identity, signerDir) {
  mkdirSync(signerDir, { recursive: true, mode: 0o700 })
  const socketPath = join(signerDir, 'signer.sock')
  const child = spawn(process.execPath, [
    SIGNER, '--socket', socketPath, '--key-file', identity.keyPath,
    '--registered-key-hex', identity.registeredKeyHex, '--approve', 'test-all',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  running.push({ kind: 'process', child })
  let out = ''
  child.stdout.on('data', chunk => { out += chunk.toString('utf8') })
  return new Promise((resolveReady, reject) => {
    const deadline = Date.now() + 10_000
    const poll = setInterval(() => {
      if (out.includes('SIGNER_READY')) { clearInterval(poll); resolveReady({ child, socketPath, stdout: () => out }) }
      else if (child.exitCode !== null) { clearInterval(poll); reject(new Error(`signer exited ${String(child.exitCode)}`)) }
      else if (Date.now() > deadline) { clearInterval(poll); reject(new Error('signer never ready')) }
    }, 25)
  })
}

/** Run the shipped verifier from a directory the stranger stands in. */
function strangerRun(receiptName, keyName) {
  return spawnSync(process.execPath, [VERIFY, receiptName, '--pub', keyName],
    { cwd: strangerDir, encoding: 'utf8' })
}

console.log('AUMLOK — the stranger side of the approval receipt\n')
console.log(`repository : ${ROOT}`)

// ── produce one real receipt, from a real daemon ──────────────────────────────────────────────
const identity = buildIdentity('identity', SEED_RECEIPT)
const other = buildIdentity('other', SEED_OTHER)
const signer = await startSigner(identity, join(work, 'signer-dir'))

const session = adapter.createOwnerApprovalSession({
  projection: identity.projection,
  expectation: { subject: identity.projection.subject, activeControlDigest: identity.projection.activeControlDigest },
  socketPath: signer.socketPath,
  now: () => CLOCK,
})
const approval = await session.approve({ operationDigest: OPERATION_DIGEST, expiresAt: CLOCK + 300 })
if (approval.ok !== true) throw new Error(`the producer could not obtain an approval: ${JSON.stringify(approval)}`)
const request = adapter.createApprovalRequest({
  subject: identity.projection.subject,
  activeControlDigest: identity.projection.activeControlDigest,
  operationDigest: OPERATION_DIGEST,
  challenge: approval.challenge,
  issuedAt: CLOCK,
  expiresAt: CLOCK + 300,
})
const receipt = adapter.createApprovalReceipt({ approval, projection: identity.projection, keyClass: 'B', request })

// ── the stranger's directory: the receipt, one key, and nothing else ─────────────────────────
const strangerDir = join(work, 'stranger')
mkdirSync(strangerDir, { recursive: true })
writeFileSync(join(strangerDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
writeFileSync(join(strangerDir, 'registered-key.pem'), identity.publicKeyPem)
writeFileSync(join(strangerDir, 'other-key.pem'), other.publicKeyPem)

/** A mutated copy of the receipt, written into the stranger's directory. */
function fixture(name, mutate) {
  const copy = JSON.parse(JSON.stringify(receipt))
  mutate(copy)
  writeFileSync(join(strangerDir, name), `${JSON.stringify(copy, null, 2)}\n`)
}
const CORRUPT = '00'.repeat(64)
fixture('forged-did.json', copy => { copy.approvalKeyDid = 'did:key:z6MkforgedForTheArm1111111111111111111111'; copy.signature = CORRUPT })
fixture('wrong-signature.json', copy => { copy.signature = '11'.repeat(64) })
fixture('class-c-human.json', copy => {
  copy.approvalClass = 'human-ceremony'; copy.keyClass = 'C'; copy.keyClassMeaning = 'operator-custodied'; copy.signature = CORRUPT
})
fixture('class-b-human.json', copy => {
  copy.approvalClass = 'human-ceremony'; copy.keyClass = 'B'; copy.keyClassMeaning = 'software-held'; copy.signature = CORRUPT
})
fixture('extra-field.json', copy => { copy.ceiling = 'none' })
fixture('other-digest.json', copy => { copy.operationDigest = 'cd'.repeat(32) })
// Metadata changed CONSISTENTLY — class and its meaning together, signature untouched. This is the
// fixture that proves the REPORTED state is earned: if the signature covered the class, this would
// fail; it must not, because the class is not in the preimage.
fixture('class-rewritten.json', copy => { copy.keyClass = 'C'; copy.keyClassMeaning = 'operator-custodied' })

const before = readdirSync(strangerDir).sort()

// ── 1. the verdict ────────────────────────────────────────────────────────────────────────────
console.log('\n── 1. one receipt and one registered key, from an empty directory ──')
const verified = strangerRun('receipt.json', 'registered-key.pem')
arm('the shipped verifier exits 0 on a receipt produced by a real daemon', 
  () => assert.equal(verified.status, 0, verified.stdout + verified.stderr))
arm('it prints OWNER_KEY_SIGNED, the key class, the class, attendance and the device ceiling',
  () => {
    for (const line of ['VERDICT: OWNER_KEY_SIGNED', 'KEY_CLASS: B (software-held)',
      'APPROVAL_CLASS: delegated', 'ATTENDANCE: reported-not-proven',
      'SIGNER_DEVICE_TRUSTED: not-established', 'SUCCESSION: unmeasured', 'IDENTITY_BOUND: false']) {
      assert.ok(verified.stdout.includes(line), `missing: ${line}`)
    }
  })
arm('it prints every ceiling rather than only the verdict',
  () => {
    for (const ceiling of adapter.signerCeilingLines()) {
      assert.ok(verified.stdout.includes(`  ${ceiling}`), `missing ceiling: ${ceiling}`)
    }
  })
arm('and it states what it did NOT check, so a pass cannot be read as attendance',
  () => assert.ok(/NOT CHECKED:.*attended/u.test(verified.stdout), verified.stdout.slice(-200)))
arm('the stranger\'s directory gained nothing: the run wrote no state',
  () => assert.deepEqual(readdirSync(strangerDir).sort(), before))

// ── 2. the refusals, each by name ─────────────────────────────────────────────────────────────
console.log('\n── 2. refusals, by name ──')
const forged = strangerRun('forged-did.json', 'registered-key.pem')
arm('a forged did:key is refused by name, not by signature',
  () => {
    assert.equal(forged.status, 1)
    assert.ok(forged.stdout.includes('REFUSED: aukora:verify-did-mismatch'), forged.stdout)
    // …and it is refused BEFORE signature work: this fixture's signature is corrupt, so a verifier
    // that checked the signature first would report SIGNATURE_INVALID here instead.
    assert.ok(!forged.stdout.includes('verify-signature-invalid'), forged.stdout)
  })
const wrongKey = strangerRun('receipt.json', 'other-key.pem')
arm('a wrong key is refused by name, and the DID is RE-DERIVED from it rather than matched',
  () => {
    assert.equal(wrongKey.status, 1)
    assert.ok(wrongKey.stdout.includes('REFUSED: aukora:verify-did-mismatch'), wrongKey.stdout)
    assert.ok(wrongKey.stdout.includes('derives did:key:'), wrongKey.stdout)
  })
const badSig = strangerRun('wrong-signature.json', 'registered-key.pem')
arm('a signature that is not this key\'s is refused as INVALID, after the identity checks pass',
  () => {
    assert.equal(badSig.status, 1)
    assert.ok(badSig.stdout.includes('REFUSED: aukora:verify-signature-invalid'), badSig.stdout)
  })
const classC = strangerRun('class-c-human.json', 'registered-key.pem')
arm('human-ceremony under keyClass C is refused by name, before signature work',
  () => {
    assert.equal(classC.status, 1)
    assert.ok(classC.stdout.includes('REFUSED: aukora:verify-human-ceremony-with-class-c'), classC.stdout)
    assert.ok(!classC.stdout.includes('verify-signature-invalid'), classC.stdout)
  })
const classB = strangerRun('class-b-human.json', 'registered-key.pem')
arm('human-ceremony under keyClass B is refused as unestablishable — no register is held here',
  () => {
    assert.equal(classB.status, 1)
    assert.ok(classB.stdout.includes('REFUSED: aukora:verify-human-ceremony-not-establishable'), classB.stdout)
  })
const extra = strangerRun('extra-field.json', 'registered-key.pem')
arm('a receipt with an extra field is refused as malformed — the record is CLOSED',
  () => {
    assert.equal(extra.status, 1)
    assert.ok(extra.stdout.includes('REFUSED: aukora:verify-receipt-malformed'), extra.stdout)
  })
const digest = strangerRun('other-digest.json', 'registered-key.pem')
arm('a receipt whose fields derive different bytes than it claims is refused as a PREIMAGE mismatch',
  () => {
    assert.equal(digest.status, 1)
    assert.ok(digest.stdout.includes('REFUSED: aukora:verify-preimage-mismatch'), digest.stdout)
  })
arm('no refusal ever printed the verdict line',
  () => {
    for (const run_ of [forged, wrongKey, badSig, classC, classB, extra, digest]) {
      assert.ok(!sawSomething(run_.stdout, 'the run output').includes('VERDICT: OWNER_KEY_SIGNED'), run_.stdout.slice(0, 120))
    }
  })

// ── 3. T5: eight separate results, and unsigned metadata is never shown as verified ──────────
console.log('\n── 3. T5 — separate structured results ──')
const ITEMS = ['parse', 'signature', 'trusted_key', 'scope', 'digest', 'attendance', 'custody', 'presence']
const stateOf = (text, item) => new RegExp(`RESULT ${item}: (\\S+)`, 'u').exec(text)?.[1]

arm('all eight questions are answered separately on the accepting path',
  () => {
    for (const item of ITEMS) {
      assert.ok(stateOf(verified.stdout, item) !== undefined, `no RESULT line for ${item}`)
    }
    // The identity question is answered BEFORE the signature is touched, so the printed order
    // carries the same information the refusal order does. The class RULES also run first — that is
    // proven by the refusal arms in section 2 (a corrupt-signature fixture refuses on the class, not
    // on the signature), NOT by where `custody` is reported, which happens after verification
    // because reporting what the record claims is only meaningful once the record is verified.
    const order = ITEMS.map(item => verified.stdout.indexOf(`RESULT ${item}:`))
    assert.ok(order.every(index => index >= 0))
    assert.ok(verified.stdout.indexOf('RESULT trusted_key:') < verified.stdout.indexOf('RESULT signature:'),
      'trusted_key must be printed before signature')
  })
arm('parse, digest and signature are VERIFIED — those three this program actually checked',
  () => {
    for (const item of ['parse', 'digest', 'signature']) {
      assert.equal(stateOf(verified.stdout, item), 'VERIFIED', item)
    }
  })
arm('trusted_key is NOT_ESTABLISHED: the binding holds, the registration cannot be checked here',
  () => assert.equal(stateOf(verified.stdout, 'trusted_key'), 'NOT_ESTABLISHED'))
arm('scope, attendance and custody are REPORTED — unsigned metadata, never shown as verified',
  () => {
    for (const item of ['scope', 'attendance', 'custody']) {
      assert.equal(stateOf(verified.stdout, item), 'REPORTED', item)
      assert.ok(!new RegExp(`RESULT ${item}: VERIFIED`, 'u').test(sawSomething(verified.stdout, 'the verification output')), `${item} was shown as VERIFIED`)
    }
  })
arm('the verifier names the SIGNED fields and the UNSIGNED ones rather than leaving it to prose',
  () => {
    assert.match(verified.stdout, /SIGNED_FIELDS: subject, activeControlDigest, operationDigest, challenge, issuedAt, expiresAt/u)
    for (const field of ['keyClass', 'attendance', 'ceiling', 'identityBound']) {
      assert.ok(new RegExp(`UNSIGNED_FIELDS:.*${field}`, 'u').test(verified.stdout), field)
    }
  })
// The state is EARNED, not asserted: rewrite the class consistently and the signature still verifies,
// which is exactly why the class may only ever be REPORTED.
const rewritten = strangerRun('class-rewritten.json', 'registered-key.pem')
arm('a receipt whose key class is rewritten still verifies — so the class CANNOT be shown as verified',
  () => {
    assert.equal(rewritten.status, 0, rewritten.stdout + rewritten.stderr)
    assert.equal(stateOf(rewritten.stdout, 'signature'), 'VERIFIED')
    assert.equal(stateOf(rewritten.stdout, 'custody'), 'REPORTED')
    assert.match(rewritten.stdout, /KEY_CLASS: C \(operator-custodied\)/u)
  })
arm('--json carries the same eight results and the same states, for a machine consumer',
  () => {
    const json = spawnSync(process.execPath, [VERIFY, 'receipt.json', '--pub', 'registered-key.pem', '--json'],
      { cwd: strangerDir, encoding: 'utf8' })
    const payload = JSON.parse(json.stdout.slice(json.stdout.indexOf('{')))
    // As a SET, not a sequence: the execution order is deliberately the security-relevant one
    // (identity and class rules before signature work), and pinning the listing order here would
    // quietly forbid that.
    assert.deepEqual([...payload.results.map(r => r.item)].sort(), [...ITEMS].sort())
    assert.deepEqual(payload.results.filter(r => r.state === 'REPORTED').map(r => r.item),
      ['scope', 'attendance', 'custody'])
    assert.ok(payload.unsignedFields.includes('keyClass'))
    // …and the order that DOES matter is asserted rather than left implicit.
    const order = payload.results.map(r => r.item)
    assert.ok(order.indexOf('trusted_key') < order.indexOf('signature'),
      `trusted_key must be answered before signature work: ${order.join(',')}`)
  })
arm('a refusal still prints the results it had reached, so a caller sees WHICH question refused',
  () => {
    for (const run_ of [forged, classC, digest]) {
      assert.match(run_.stdout, /RESULT \w+: REFUSED/u, run_.stdout.slice(0, 200))
    }
  })

for (const job of running) {
  try {
    job.child.kill('SIGTERM')
  } catch {
    /* already stopped */
  }
}
rmSync(work, { recursive: true, force: true })

console.log('')
if (missed === 0) {
  console.log(`  ${String(arms)}/${String(arms)} arms green\n`)
  console.log('  What this did NOT show you: the receipt proves that a key signed bytes, and the key')
  console.log('  is a labelled disposable test key. No person attended, the device is not trusted, no')
  console.log('  platform custody was measured, succession is UNMEASURED and no identity is bound. The')
  console.log('  verifier reads those limits from the receipt; it does not establish them. Nothing here')
  console.log('  is a receipt-v3 conformance claim.\n')
  console.log('  AUMLOK VERIFY APPROVAL: GREEN')
  process.exit(0)
}
console.log(`  ${String(missed)} of ${String(arms)} arms FAILED\n`)
console.log('  AUMLOK VERIFY APPROVAL: RED')
process.exit(1)
