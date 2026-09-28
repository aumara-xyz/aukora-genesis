// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// One restore check through the real approval adapter; every write stays in scratch.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as aumlok from '../plugins/aukora-aumlok/lib/index.mjs'
import { decideApproval, resolveWitnessDir } from '../scripts/aukora/decide.mjs'
import { codeChain } from '../scripts/aukora/aura-code.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const scratch = mkdtempSync(join(tmpdir(), 'aukora-trusted-'))
const saved = { HOME: process.env.HOME, AUKORA_WITNESS_DIR: process.env.AUKORA_WITNESS_DIR, AUKORA_WITNESS_TEST: process.env.AUKORA_WITNESS_TEST }
process.env.HOME = join(scratch, 'home')
mkdirSync(process.env.HOME, { mode: 0o700 })
process.env.AUKORA_WITNESS_DIR = join(scratch, 'witness')
process.env.AUKORA_WITNESS_TEST = '1'

function approval(base, challenge) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const approverDid = aumlok.didKeyFromEd25519PublicKey(Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex'))
  const request = aumlok.createApprovalRequest({
    subject: `aukora:1:${'1'.repeat(64)}`, activeControlDigest: '2'.repeat(64),
    operationDigest: '3'.repeat(64), challenge: challenge.repeat(64), issuedAt: 100, expiresAt: 300,
  })
  const receipt = aumlok.createApprovalReceipt({
    request, keyClass: 'B', approvalClass: 'scripted',
    approval: { ok: true, operationDigest: request.operationDigest, challenge: request.challenge,
      signature: sign(null, aumlok.approvalSigningBytes(request), privateKey).toString('hex'), verifiedAt: 200 },
    projection: { domain: 'aukora:public-control:v1', subject: request.subject, epoch: 1,
      activeControlDigest: request.activeControlDigest, revoked: false, approvalKeyDid: approverDid, custodyClass: 'B' },
  })
  const approvalPath = join(base, `approval-${challenge}.json`)
  writeFileSync(approvalPath, JSON.stringify(receipt), { mode: 0o600 })
  return { approvalPath, approverDid, operationDigest: request.operationDigest, subject: request.subject,
    controlDigest: request.activeControlDigest, nowSeconds: 200 }
}

function fixture(name, challenge = '6') {
  const stateRoot = join(scratch, name)
  const chain = codeChain(stateRoot)
  return { ...approval(scratch, challenge), stateRoot, consumedIdsPath: chain.consumedIds, createConsumedIds: true }
}

function assertRecovery(outcome, path) {
  assert.equal(outcome.decision, 'DENY', JSON.stringify(outcome))
  assert.ok(outcome.detail.includes(path), outcome.detail)
  assert.match(outcome.detail, /\nRecovery: [^\n]+$/u)
  assert.match(outcome.detail, /(?:remove|restore|reset|repair|replace|chmod|recover)/iu)
}

function cliArgs(args) {
  return [join(ROOT, 'scripts/aukora/decide.mjs'), '--approval', args.approvalPath,
    '--approver-did', args.approverDid, '--operation-digest', args.operationDigest,
    '--subject', args.subject, '--control-digest', args.controlDigest,
    '--consumed-ids', args.consumedIdsPath, '--state-root', args.stateRoot,
    '--create-consumed-ids', '--now', String(args.nowSeconds), '--json']
}

function runChild(args) {
  return new Promise((resolveChild, reject) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, TMPDIR: scratch } })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', status => resolveChild({ status, stdout, stderr }))
  })
}

function adapterCopy(name, transformPort = value => value, transformAdapter = value => value) {
  const modules = join(scratch, name)
  mkdirSync(modules, { mode: 0o700 })
  for (const file of ['trusted-state-store.mjs', 'approval-state-store.mjs', 'decide.mjs']) {
    let source = readFileSync(join(ROOT, 'scripts/aukora', file), 'utf8')
      .replaceAll("'../../vendor/authority/lib/index.js'", JSON.stringify(pathToFileURL(join(ROOT, 'vendor/authority/lib/index.js')).href))
      .replaceAll("'../../plugins/aukora-kira/lib/strict-read.mjs'", JSON.stringify(pathToFileURL(join(ROOT, 'plugins/aukora-kira/lib/strict-read.mjs')).href))
    if (file === 'trusted-state-store.mjs') source = transformPort(source)
    if (file === 'decide.mjs') {
      const rootLine = "const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')"
      assert.equal(source.split(rootLine).length, 2)
      source = transformAdapter(source.replace(rootLine, `const ROOT = ${JSON.stringify(ROOT)}`))
    }
    writeFileSync(join(modules, file), source)
  }
  return join(modules, 'decide.mjs')
}

function restoreArm(decide) {
  const stateRoot = join(scratch, 'state')
  const chain = codeChain(stateRoot)
  const consumedIdsPath = chain.consumedIds
  const witnessPath = join(process.env.AUKORA_WITNESS_DIR, 'kernel-high-water.json')
  const backup = join(scratch, 'backup')
  const args = { ...approval(scratch, '4'), consumedIdsPath, stateRoot, createConsumedIds: true }
  assert.equal(existsSync(witnessPath), false)
  const first = decide(args)
  assert.equal(first.decision, 'ALLOW', JSON.stringify(first))
  const firstRecord = JSON.parse(readFileSync(consumedIdsPath, 'utf8'))
  assert.equal(firstRecord.storeSchema, 1)
  assert.equal(firstRecord.state.receiptHead.count, 1)
  assert.equal(firstRecord.prepared[0].consumptionId, first.approvalId)
  assert.deepEqual(Object.values(JSON.parse(readFileSync(witnessPath, 'utf8')).heads), [1])
  assert.equal(statSync(witnessPath).mode & 0o777, 0o600)
  assert.equal(statSync(process.env.AUKORA_WITNESS_DIR).mode & 0o777, 0o700)
  assert.equal(chain.closeUnused()[0].approvalId, first.approvalId)
  console.log('PASS first consume: ALLOW; journalled state and external high-water created')

  // A backup in the old plain-state format also exercises in-place migration.
  writeFileSync(consumedIdsPath, JSON.stringify(firstRecord.state), { mode: 0o600 })
  rmSync(witnessPath)
  cpSync(stateRoot, backup, { recursive: true })
  const next = { ...args, ...approval(scratch, '5'), createConsumedIds: false }
  const consumed = decide(next)
  assert.equal(consumed.decision, 'ALLOW', JSON.stringify(consumed))
  const record = JSON.parse(readFileSync(consumedIdsPath, 'utf8'))
  assert.deepEqual(record.state.consumedIds, [first.approvalId, consumed.approvalId])
  assert.equal(record.state.receiptHead.count, 2)
  assert.deepEqual(Object.values(JSON.parse(readFileSync(witnessPath, 'utf8')).heads), [2])
  assert.equal(decide(next).reason, 'kernel:replay')
  console.log('PASS legacy migration: prior spend retained; next consume ALLOW; replay DENY kernel:replay')

  const witnessBytes = readFileSync(witnessPath)
  rmSync(stateRoot, { recursive: true })
  cpSync(backup, stateRoot, { recursive: true })
  const restored = decide(next)
  console.log(`RESTORE ARM: ${restored.decision} ${restored.reason}`)
  assert.equal(restored.reason, 'kernel:rollback-refused', `RESTORE ARM: ${restored.decision} ${restored.reason}`)
  assertRecovery(restored, witnessPath)
  assert.match(restored.detail, /restore the newer state/u)
  assert.deepEqual(readFileSync(witnessPath), witnessBytes)
  assert.deepEqual(readFileSync(consumedIdsPath), readFileSync(join(backup, 'home/aura-code/consumed-ids.json')))

  rmSync(consumedIdsPath)
  const missing = decide({ ...next, createConsumedIds: true })
  assert.equal(missing.reason, 'kernel:rollback-refused')
  assertRecovery(missing, witnessPath)
  assert.equal(existsSync(consumedIdsPath), false)
  console.log('PASS restored-away state: DENY kernel:rollback-refused, even with creation enabled')
}

try {
  if (process.argv[2] === '--restore-with') {
    const alternate = await import(pathToFileURL(process.argv[3]).href)
    restoreArm(alternate.decideApproval)
  } else {
    const reference = join(ROOT, 'vendor/authority/reference')
    const provenance = JSON.parse(readFileSync(join(reference, 'PROVENANCE.json'), 'utf8'))
    for (const file of provenance.files) {
      const bytes = readFileSync(join(reference, file.path))
      assert.equal(bytes.length, file.bytes)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
    }
    restoreArm(decideApproval)

    // Resolution is read-only: production must ignore both a forged HOME and an ungated override.
    assert.equal(resolveWitnessDir(), process.env.AUKORA_WITNESS_DIR)
    for (const flag of [undefined, 'true', '0']) {
      if (flag === undefined) delete process.env.AUKORA_WITNESS_TEST
      else process.env.AUKORA_WITNESS_TEST = flag
      assert.equal(resolveWitnessDir(), join(userInfo().homedir, '.aukora-witness'))
    }
    process.env.AUKORA_WITNESS_TEST = '1'
    console.log('PASS witness location: test override requires AUKORA_WITNESS_TEST=1; production uses OS home (resolution only)')

    const malformed = fixture('duplicate-state')
    const legacy = { schema: 'aukora-trusted-state-v1', salama: { active: false, reason: null }, trustedRoots: [], consumedIds: [], receiptHead: { count: 0, headHash: null } }
    const duplicate = JSON.stringify(legacy).replace('"salama":', '"salama":{"active":true},"salama":')
    for (const bytes of [duplicate, `{"storeSchema":1,"state":${duplicate},"prepared":[]}`]) {
      writeFileSync(malformed.consumedIdsPath, bytes, { mode: 0o600 })
      const denied = decideApproval(malformed)
      assert.equal(denied.decision, 'DENY')
      assert.equal(denied.reason, 'adapter:consumed-ids-unreadable', JSON.stringify(denied))
      assert.match(denied.detail, /json:duplicate-key/u)
      assert.equal(readFileSync(malformed.consumedIdsPath, 'utf8'), bytes)
    }
    console.log('PASS duplicate-key state: DENY adapter:consumed-ids-unreadable (json:duplicate-key), legacy and wrapped SALAMA unchanged')

    const witnessPath = join(process.env.AUKORA_WITNESS_DIR, 'kernel-high-water.json')
    const witnessBytes = readFileSync(witnessPath)
    const witnessArgs = fixture('bad-witness', '7')
    writeFileSync(witnessPath, '{"schema":1,"heads":{},"heads":{}}', { mode: 0o600 })
    const badWitness = decideApproval(witnessArgs)
    assert.equal(badWitness.reason, 'adapter:witness-unreadable', JSON.stringify(badWitness))
    assert.match(badWitness.detail, /json:duplicate-key/u)
    assertRecovery(badWitness, witnessPath)
    writeFileSync(witnessPath, witnessBytes)
    chmodSync(witnessPath, 0o644)
    assertRecovery(decideApproval(witnessArgs), witnessPath)
    chmodSync(witnessPath, 0o600)
    console.log('PASS corrupt/unsafe witness: DENY with exact witness path and recovery')

    const lockedArgs = fixture('locked-state', '8')
    const stateLock = `${lockedArgs.consumedIdsPath}.lock`
    const opening = `${stateLock}.opening`
    writeFileSync(opening, '2147483647', { mode: 0o600 })
    const orphaned = decideApproval(lockedArgs)
    assertRecovery(orphaned, opening)
    assert.match(orphaned.detail, /2147483647/u)
    rmSync(opening)
    writeFileSync(stateLock, String(process.pid), { mode: 0o600 })
    let started = Date.now()
    const stateLocked = decideApproval(lockedArgs)
    assert.equal(stateLocked.reason, 'adapter:consumed-ids-locked')
    assertRecovery(stateLocked, stateLock)
    assert.ok(Date.now() - started < 2_000, 'state-root lock must still refuse without witness backoff')
    rmSync(stateLock)
    console.log('PASS orphaned .opening and state lock: DENY with exact paths, pid and recovery; state lock does not wait')

    const writerLock = join(process.env.AUKORA_WITNESS_DIR, 'writer.lock')
    writeFileSync(writerLock, String(process.pid), { mode: 0o600 })
    const released = runChild(['-e', 'setTimeout(() => require("node:fs").rmSync(process.argv[1]), 300)', writerLock])
    started = Date.now()
    const waited = decideApproval(lockedArgs)
    assert.equal(waited.decision, 'ALLOW', JSON.stringify(waited))
    assert.ok(Date.now() - started >= 250, 'a held witness lock must be retried')
    assert.equal((await released).status, 0)
    writeFileSync(writerLock, String(process.pid), { mode: 0o600 })
    started = Date.now()
    const timedOut = decideApproval(lockedArgs)
    const elapsed = Date.now() - started
    assert.equal(timedOut.reason, 'adapter:consumed-ids-locked')
    assertRecovery(timedOut, writerLock)
    assert.ok(elapsed >= 14_500 && elapsed < 20_000, `witness retry must stop at 15 s (observed ${elapsed} ms)`)
    assert.equal(readFileSync(writerLock, 'utf8'), String(process.pid))
    rmSync(writerLock)
    console.log('PASS global witness lock: waits then ALLOW after release; held lock DENY after bounded 15 s with recovery')

    const parallelArgs = fixture('parallel', '9')
    const parallel = await Promise.all(Array.from({ length: 6 }, () => runChild(cliArgs(parallelArgs))))
    assert.equal(parallel.filter(result => result.status === 0 && /^ALLOW kernel:allowed$/mu.test(result.stdout)).length, 1, JSON.stringify(parallel))
    // Under contention a loser may meet the held state lock before it can see the spend: both are named refusals.
    assert.equal(parallel.filter(result => result.status === 1 && /^DENY (?:kernel:replay|adapter:consumed-ids-locked)$/mu.test(result.stdout)).length, 5, JSON.stringify(parallel))
    for (const result of parallel) {
      assert.ok(result.stderr.split('\n').some(line => /^(?:ALLOW|DENY) /u.test(line) && line.includes(witnessPath)), result.stderr)
    }
    console.log('PASS six parallel decides: 1 ALLOW, 5 DENY (kernel:replay or adapter:consumed-ids-locked); every CLI decision stderr names the witness')

    const noConsumeAdapter = adapterCopy('kernel-without-consume', undefined, source => {
      const kernelLine = "const kernel = await import(pathToFileURL(join(ROOT, 'vendor', 'authority', 'lib', 'index.js')).href)"
      assert.equal(source.split(kernelLine).length, 2)
      return source.replace(kernelLine, `${kernelLine.replace('const kernel =', 'const genuineKernel =')}
const kernel = { ...genuineKernel, decide(...args) {
  const result = genuineKernel.decide(...args)
  return { ...result, nextState: { ...result.nextState, consumedIds: result.nextState.consumedIds.filter(id => id !== args[0].consumptionId) } }
} }`)
    })
    const noConsume = (await import(pathToFileURL(noConsumeAdapter).href)).decideApproval(fixture('no-consume', 'a'))
    assert.equal(noConsume.decision, 'DENY')
    assert.equal(noConsume.reason, 'adapter:kernel-did-not-consume', JSON.stringify(noConsume))
    console.log('PASS kernel allowed without consumption: DENY adapter:kernel-did-not-consume')

    // Remove just the loaded-state comparison in a disposable copy. The identical
    // refusal assertion must exit nonzero; this ALLOW is reported as a failing arm.
    const comparisonRemoved = adapterCopy('comparison-removed', port => {
      const comparison = 'if (rec.state.receiptHead.count < highWater) {'
      assert.equal(port.split(comparison).length, 2)
      return port.replace(comparison, 'if (false) { // Disposable negative control')
    })
    const failed = spawnSync(process.execPath, [SELF, '--restore-with', comparisonRemoved], {
      encoding: 'utf8', timeout: 5_000, env: { ...process.env, TMPDIR: scratch },
    })
    assert.equal(failed.status, 1, failed.stderr)
    assert.match(failed.stdout, /^RESTORE ARM: ALLOW kernel:allowed$/mu)
    assert.match(failed.stderr, /AssertionError/)
    console.log('EXPECTED FAIL (high-water comparison removed): RESTORE ARM: ALLOW kernel:allowed; refusal assertion exited 1')
    console.log('TRUSTED STATE: restore protection verified in scratch; installed app not verified')
  }
} finally {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  rmSync(scratch, { recursive: true, force: true })
}
