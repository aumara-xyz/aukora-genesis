#!/usr/bin/env node
// Scratch-only verification of the shipped self-change gate. No signer, Git, or live state is invoked.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { createApprover } from './kira-approval-standin.mjs'
import { childEnv } from './helpers/child-env.mjs'
import { canonicalJSON } from '../plugins/aukora-aumlok/lib/canonical.mjs'
import { didKeyFromEd25519PublicKey } from '../plugins/aukora-aumlok/lib/did-key.mjs'
import { APPROVAL_REQUEST_DOMAIN, APPROVAL_SIGNATURE_DOMAIN } from '../plugins/aukora-aumlok/lib/owner-approval.mjs'

// check.sh shows only a failing check's last line: make that line name the failure.
process.on('uncaughtException', (error) => { console.log(`FAIL dual approval verifier: ${String(error?.message ?? error).split('\n')[0]}`); process.exit(1) })

const started = performance.now()
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const scratch = mkdtempSync(join(tmpdir(), 'aukora-dual-'))
const hash = value => createHash('sha256').update(value).digest('hex')
const now = 2_000_000_000
const subject = `aukora:1:${hash('dual-verifier disposable subject')}`
const fixture = createApprover({ subject })
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const rawPublicKeyHex = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex')
const approver = { ...fixture, rawPublicKeyHex, did: didKeyFromEd25519PublicKey(rawPublicKeyHex) }
const operation = Buffer.from('AUKORA code card\nScratch-only operation; no repository writes.\n')
const operationDigest = hash(Buffer.concat([Buffer.from('aukora:operation-content:v1\0'), operation]))
const operationFile = join(scratch, 'operation.txt')
const pinnedPem = join(scratch, 'approver.pub')
writeFileSync(operationFile, operation)
writeFileSync(pinnedPem, approver.rawPublicKeyHex)
const payload = { key: 'scratch', value: 'dual-verifier' }
// A disposable test key can sign malformed string mutants without relaxing the producer.
const resign = receipt => {
  const request = { domain: APPROVAL_REQUEST_DOMAIN }
  for (const field of ['subject', 'activeControlDigest', 'operationDigest', 'challenge', 'issuedAt', 'expiresAt']) request[field] = receipt[field]
  const bytes = Buffer.from(`${APPROVAL_SIGNATURE_DOMAIN}\0${canonicalJSON(request)}`)
  return { ...receipt, approvalKeyDid: approver.did, signedBytesDigest: hash(bytes), signature: sign(null, bytes, privateKey).toString('hex') }
}
const mint = (overrides = {}) => resign(fixture.approve(payload, { now, operationDigest, ...overrides }))
const base = mint()
const serialized = JSON.stringify(base)
const route = readFileSync(join(root, 'scripts/aukora/self-change.mjs'), 'utf8')
const start = route.indexOf('// 3. VERIFY THE APPROVAL BEFORE ANYTHING IS COMMITTED')
const end = route.indexOf('try { checkCandidatePreview(candidate)', start)
assert.ok(start >= 0 && end > start, 'the production approval gate must remain discoverable')
assert.ok(end < route.indexOf('chain.locked(() =>', end), 'verification precedes authorization and commit')
const gate = route.slice(start, end)
const condition = "nodeVerdict !== 'ACCEPT' || coldVerdict !== 'ACCEPT'"
assert.equal(gate.split(condition).length, 2, 'exactly one dual-verifier decision')
const nodeOnly = gate.replace(condition, "nodeVerdict !== 'ACCEPT'")
const windowSeconds = Number(route.match(/^const WINDOW_SECONDS = (\d+)$/mu)?.[1])
assert.equal(windowSeconds, 300, 'production card window')
const env = childEnv({ PYTHONDONTWRITEBYTECODE: '1' })
let sequence = 0

// Only the actual pre-commit gate runs. A marker stands for reaching the next step;
// a refusal must throw before it. Cached subprocess results allow decision fault injection.
function runGate(text, source = gate, cached = null, at = now) {
  const evidence = join(scratch, String(sequence++))
  mkdirSync(evidence)
  const artifact = join(evidence, 'approval.json')
  writeFileSync(artifact, text)
  const runs = []
  const calls = []
  const journals = []
  const context = {
    artifact, evidence, operationFile, operationDigest, subject, pinnedPem,
    approverDid: approver.did, controlDigest: approver.projection.activeControlDigest,
    VERIFY: join(root, 'scripts/aumlok/verify-approval'),
    COLD_VERIFY: join(root, 'scripts/aumlok/verify-approval-cold.py'),
    WINDOW_SECONDS: windowSeconds,
    process: { execPath: process.execPath }, Date: { now: () => at * 1000 }, join, writeFileSync,
    spawnSync(command, args, options) {
      calls.push({ command, args: Array.from(args), options: { ...options } })
      assert.equal(options.killSignal, 'SIGKILL', 'both verifier deadlines must hard-kill')
      assert.equal(options.timeout, 10_000, 'both verifiers have a bounded deadline')
      assert.equal(args[args.indexOf('--max-window') + 1], '300')
      assert.equal(args[args.indexOf('--max-skew') + 1], '60')
      if (runs.length === 1) {
        assert.equal(command, '/usr/bin/python3', 'cold verifier uses the pinned system interpreter')
        assert.deepEqual(Array.from(args.slice(0, 3)), ['-I', '-B', context.COLD_VERIFY])
        assert.deepEqual({ ...options.env }, { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, 'cold environment contains only two fixed entries')
      }
      const run = cached?.[runs.length] ?? spawnSync(command, args, { ...options, env: options.env ?? env })
      runs.push(run)
      return run
    },
    journal: (...entry) => journals.push(entry),
    fail(message) { throw Object.assign(new Error(message), { gateRefusal: true }) },
    reachedNextStep: false,
  }
  let refusal = null
  try { runInNewContext(`${source}\nreachedNextStep = true`, context) }
  catch (error) { if (!error.gateRefusal) throw error; refusal = error.message }
  assert.equal(runs.length, 2, 'both independent implementations must run even when one refuses')
  for (const name of ['verify-approval.txt', 'verify-approval-cold.txt']) {
    assert.match(readFileSync(join(evidence, name), 'utf8'), /VERIFIER .+; exit=/u)
  }
  if (refusal) {
    assert.match(refusal, /Node=.+; Python=.+/u, 'refusal names both verdicts')
    assert.equal(journals[0]?.[0], 'APPROVAL_REFUSED')
  }
  return { runs, calls, refusal, reachedNextStep: context.reachedNextStep }
}

function verdict(run, cold = false) {
  if (run.status === 0) return 'ACCEPT'
  const code = run.stdout?.match(cold ? /^REFUSE (\S+)/mu : /^REFUSED: (\S+)/mu)?.[1]
  assert.ok(code, `missing named refusal: ${run.stdout ?? ''}${run.stderr ?? ''}`)
  return `REFUSE ${code}`
}

// Accepted sentinels discover the production invocations without spawning. Run
// those calls in parallel, then exercise the unchanged gate over their real results.
const accepted = [{ status: 0, stdout: 'VERIFIED:\n' }, { status: 0, stdout: 'ACCEPT\n' }]
function invoke({ command, args, options }) {
  return new Promise(resolve => {
    const child = spawn(command, args, { ...options, env: options.env ?? env })
    let stdout = '', stderr = '', error
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', cause => { error = cause })
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr, error }))
  })
}
async function evaluate(text, at = now) {
  const prepared = runGate(text, gate, accepted, at)
  const runs = await Promise.all(prepared.calls.map(invoke))
  return runGate(text, gate, runs, at)
}

try {
  const duplicate = `{"subject":"aukora:1:${hash('forged scratch subject')}",${serialized.slice(1)}`
  const zero = JSON.stringify(mint({ now: 0 }))
  const decimal = (field, token, text = serialized) => {
    const mutated = text.replace(new RegExp(`"${field}":\\d+`, 'u'), `"${field}":${token}`)
    assert.notEqual(mutated, text)
    return mutated
  }
  const future = JSON.stringify(mint({ now: now + 61 }))
  const hugeWindow = JSON.stringify(resign({ ...base, expiresAt: Number.MAX_SAFE_INTEGER }))
  const cases = [
    ['base', serialized],
    ['bad signature', JSON.stringify({ ...base, signature: `${base.signature[0] === '0' ? '1' : '0'}${base.signature.slice(1)}` })],
    ['wrong operation digest', JSON.stringify(mint({ operationDigest: hash('different operation') }))],
    ['wrong approver', JSON.stringify(createApprover({ subject, controlDigest: approver.projection.activeControlDigest }).approve(payload, { now, operationDigest }))],
    ['expired', JSON.stringify(mint({ now: now - 600 }))],
    ['human-ceremony', JSON.stringify({ ...base, approvalClass: 'human-ceremony' })],
    ["attendance:'proven'", JSON.stringify({ ...base, attendance: 'proven' })],
    ['identityBound:true', JSON.stringify({ ...base, identityBound: true })],
    ['duplicate subject (forged first)', duplicate],
    ['lone surrogate', JSON.stringify({ ...base, ceilings: [...base.ceilings, '\ud800'] })],
    ['signature trailing newline', JSON.stringify({ ...base, signature: `${base.signature}\n` })],
    ['challenge trailing newline (re-signed)', JSON.stringify(resign({ ...base, challenge: `${base.challenge}\n` }))],
    ['signerDeviceTrusted trailing newline', JSON.stringify({ ...base, signerDeviceTrusted: `${base.signerDeviceTrusted}\n` })],
    ['succession trailing newline', JSON.stringify({ ...base, succession: `${base.succession}\n` })],
    ['issuedAt -0 (signed over 0)', decimal('issuedAt', '-0', zero), 0],
    ['issuedAt decimal token', decimal('issuedAt', `${now}.0`)],
    ['issuedAt exponent token', decimal('issuedAt', '2e9')],
    ['expiresAt decimal token', decimal('expiresAt', `${now + 300}.0`)],
    ['verifiedAt decimal token', decimal('verifiedAt', `${now}.0`)],
    ['escaped issuedAt decimal token', decimal('issuedAt', `${now}.0`).replace('"issuedAt":', '"issued\\u0041t":')],
    ['future issuedAt (max-skew 60)', future],
    ['huge expiresAt (max-window 300)', hugeWindow],
  ]
  const refusals = {
    'bad signature': ['signature-invalid', 'APPROVAL_SIGNATURE_INVALID'],
    'wrong operation digest': ['operation-mismatch', 'APPROVAL_CONTENT_MISMATCH'],
    'wrong approver': ['did-mismatch', 'APPROVAL_KEY_MISMATCH'],
    expired: ['expired', 'APPROVAL_EXPIRED'],
    'human-ceremony': ['human-ceremony-not-establishable', 'APPROVAL_CLASS_UNSUPPORTED'],
    "attendance:'proven'": ['attendance-unsupported', 'APPROVAL_ATTENDANCE_UNSUPPORTED'],
    'identityBound:true': ['identity-bound-unsupported', 'APPROVAL_IDENTITY_BOUND_UNSUPPORTED'],
    'duplicate subject (forged first)': ['receipt-malformed', 'json-duplicate-key'],
    'lone surrogate': ['receipt-malformed', 'APPROVAL_LONE_SURROGATE'],
    'future issuedAt (max-skew 60)': ['issued-in-future', 'APPROVAL_FUTURE'],
    'huge expiresAt (max-window 300)': ['window-exceeded', 'APPROVAL_WINDOW_EXCEEDED'],
  }
  const results = new Map()
  let nextCase = 0
  const evaluated = new Array(cases.length)
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (nextCase < cases.length) {
      const index = nextCase++
      evaluated[index] = await evaluate(cases[index][1], cases[index][2])
    }
  }))
  for (const [index, [name]] of cases.entries()) {
    const result = evaluated[index]
    const node = verdict(result.runs[0])
    const cold = verdict(result.runs[1], true)
    const codes = refusals[name] ?? ['receipt-malformed', 'APPROVAL_MALFORMED']
    assert.equal(node, name === 'base' ? 'ACCEPT' : `REFUSE aukora:verify-${codes[0]}`, `${name}: Node`)
    assert.equal(cold, name === 'base' ? 'ACCEPT' : `REFUSE ${codes[1]}`, `${name}: Python`)
    assert.equal(result.reachedNextStep, name === 'base', `${name}: production decision`)
    results.set(name, result)
    console.log(`${name} | Node ${node} | Python ${cold} | gate ${result.refusal ? 'REFUSE' : 'ACCEPT'}`)
  }

  const unsigned = await evaluate(JSON.stringify({ ...base, approvalClass: 'scripted', keyClass: 'A', keyClassMeaning: 'device-bound',
    signerDeviceTrusted: 'claimed', ceilings: ['scratch edited ceiling'], verifiedAt: now + 1 }))
  assert.equal(unsigned.reachedNextStep, true)
  console.log(`REPORTED-NOT-SIGNED: approvalClass/keyClass/signerDeviceTrusted/ceilings/verifiedAt editable | Node ${verdict(unsigned.runs[0])} | Python ${verdict(unsigned.runs[1], true)} | gate ACCEPT`)

  for (const name of ['future issuedAt (max-skew 60)', 'huge expiresAt (max-window 300)']) {
    const withoutLimits = await Promise.all(results.get(name).calls.map(({ command, args, options }) => {
      const unbounded = args.filter((value, index) => !['--max-window', '--max-skew'].includes(value) && !['--max-window', '--max-skew'].includes(args[index - 1]))
      return invoke({ command, args: unbounded, options })
    }))
    assert.equal(verdict(withoutLimits[0]), 'ACCEPT')
    assert.equal(verdict(withoutLimits[1], true), 'ACCEPT')
    console.log(`compatibility without limit flags: ${name} | Node ACCEPT | Python ACCEPT`)
  }

  const expectedFailure = (name, text, runs) => {
    assert.equal(runGate(text, gate, runs).reachedNextStep, false)
    assert.throws(() => assert.equal(runGate(text, nodeOnly, runs).reachedNextStep, false), assert.AssertionError)
    console.log(`EXPECTED FAILURE: cold decision removed: ${name} reaches next step`)
  }
  // Inject the former Node numeric-reader regression; the independent cold refusal still gates it.
  expectedFailure('verifiedAt decimal WITH injected Node numeric-reader regression', cases.find(([name]) => name === 'verifiedAt decimal token')[1],
    [results.get('base').runs[0], results.get('verifiedAt decimal token').runs[1]])
  // Current Node already rejects duplicate keys. Explicitly simulate its strict-reader
  // regressing to JSON.parse: only that Node input is normalized, while cold sees original bytes.
  expectedFailure('duplicate subject WITH injected Node JSON.parse regression', duplicate,
    [results.get('base').runs[0], results.get('duplicate subject (forged first)').runs[1]])
  console.log('Current Node alone still REFUSES duplicate subject; that gap requires the stated injected regression.')
  const failure = (code, signal = null) => ({ status: null, signal, stdout: '', stderr: '', error: Object.assign(new Error(`scratch ${code}`), { code }) })
  for (const [name, run] of [
    ['crash', { status: 1, stdout: '', stderr: 'scratch crash' }],
    ['hang', failure('ETIMEDOUT', 'SIGKILL')],
    ['junk stdout', { status: 0, stdout: 'junk', stderr: '' }],
    ['missing python3 / executable', failure('ENOENT')],
    ['ENOBUFS', failure('ENOBUFS', 'SIGKILL')],
    ['SIGSEGV', { status: null, signal: 'SIGSEGV', stdout: '', stderr: '' }],
    ['zero exit without verdict', { status: 0, stdout: '', stderr: '' }],
  ]) {
    for (const index of [0, 1]) {
      const injected = [...results.get('base').runs]
      injected[index] = run
      const result = runGate(serialized, gate, injected)
      assert.equal(result.reachedNextStep, false)
      console.log(`${index === 0 ? 'Node' : 'Python'} injected ${name} | ${result.refusal.split('. NOTHING')[0]} | gate REFUSE before kernel/Git`)
      if (index === 1) expectedFailure(name, serialized, injected)
    }
  }

  const marker = join(scratch, 'usercustomize-loaded')
  const poisonHome = join(scratch, 'poison-home')
  mkdirSync(poisonHome)
  writeFileSync(join(poisonHome, 'usercustomize.py'), `from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text('loaded')\n`)
  const control = spawnSync('/usr/bin/python3', ['-B', '-c', 'pass'], {
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: poisonHome, PYTHONPATH: poisonHome }, encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL',
  })
  assert.equal(control.status, 0)
  assert.equal(existsSync(marker), true, 'Python startup loads the harmless planted module without isolation')
  rmSync(marker)
  const poisoned = { HOME: poisonHome, PYTHONPATH: poisonHome, PYTHONHOME: poisonHome, PYTHONUSERBASE: poisonHome }
  const saved = Object.fromEntries(Object.keys(poisoned).map(name => [name, process.env[name]]))
  try {
    Object.assign(process.env, poisoned)
    const { command, args, options } = results.get('bad signature').calls[1]
    const isolated = spawnSync(command, args, options)
    assert.equal(verdict(isolated, true), verdict(results.get('bad signature').runs[1], true))
    assert.equal(existsSync(marker), false, 'isolated production invocation never loads usercustomize')
    console.log('isolation: planted usercustomize control loaded; production ignores poisoned HOME/PYTHONPATH/PYTHONHOME/PYTHONUSERBASE | Python REFUSE APPROVAL_SIGNATURE_INVALID')
  } finally {
    for (const [name, value] of Object.entries(saved)) value === undefined ? delete process.env[name] : process.env[name] = value
  }

  const evidenceStart = route.indexOf('const evidenceRoot =')
  const evidenceEnd = route.indexOf('\nconst ', route.indexOf('const evidence =', evidenceStart) + 1)
  assert.ok(evidenceStart >= 0 && evidenceEnd > evidenceStart)
  const evidenceSource = route.slice(evidenceStart, evidenceEnd)
  const evidencePaths = new Set()
  for (let attempt = 0; attempt < 2; attempt++) {
    const context = { STATE: scratch, operationDigest, Date: class extends Date { constructor() { super(now * 1000) } }, join, mkdirSync, mkdtempSync }
    const path = runInNewContext(`${evidenceSource}\nevidence`, context)
    assert.ok(existsSync(path))
    evidencePaths.add(path)
  }
  assert.equal(evidencePaths.size, 2, 'same-second reraises must reserve distinct evidence directories')
  console.log('same-second same-operation reraises | unique scratch evidence directories; no reused wx path')
  console.log(`PASS dual approval verifier: ${(performance.now() - started).toFixed(0)} ms; pinned isolated Python, SIGKILL deadlines; scratch only, no Git or live app effects`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
