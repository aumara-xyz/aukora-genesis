#!/usr/bin/env node
// One scratch-only check of the four-history become gate and its removed-guard arm.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Script } from 'node:vm'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { root } from '../scripts/aukora/aura-merkle.mjs'
import { createReceiptLog } from '../plugins/aukora-action-gate/lib/receipts.mjs'

const started = performance.now()
const scratch = mkdtempSync(join(tmpdir(), 'aukora-witness-four-'))
const support = join(scratch, 'support')
// Apple's Python redirects its stdlib cache with HOME. Reuse that read-only cache; every verifier runs with -B.
const python = spawnSync('python3', ['-B', '-c', 'import json, sys; print(json.dumps(sys.pycache_prefix))'], { encoding: 'utf8' })
assert.equal(python.status, 0)
const pythonCache = JSON.parse(python.stdout)
const environment = { HOME: join(scratch, 'home'), TMPDIR: join(scratch, 'tmp'), AUKORA_SUPPORT_ROOT: support,
  ...(typeof pythonCache === 'string' ? { PYTHONPYCACHEPREFIX: pythonCache } : {}) }
const before = Object.fromEntries(Object.keys(environment).map((name) => [name, process.env[name]]))
for (const [name, value] of Object.entries(environment)) {
  if (name !== 'PYTHONPYCACHEPREFIX') mkdirSync(value, { recursive: true })
  process.env[name] = value
}

try {
  const { chainPaths, retainedPath, auraLeaves, membraneObservation, membraneRefusal, membraneConflicts, retainMembrane } =
    await import('../scripts/aukora/become.mjs')
  assert.deepEqual(chainPaths, { code: 'aura-code/aura.jsonl', actions: 'aura-actions/aura.jsonl',
    memory: 'kira-memory/aura.jsonl', remembered: 'kira-memory/remembered/aura.jsonl' })
  const names = Object.keys(chainPaths)
  const paths = Object.fromEntries(names.map((name) => [name, join(support, 'state/home', chainPaths[name])]))
  const contents = (name, count) => Array.from({ length: count }, (_, index) =>
    JSON.stringify({ sequence: index + 1, fixture: `${name}-${index}` })).join('\n') + '\n'
  const writeChains = (count) => {
    for (const name of names) {
      mkdirSync(dirname(paths[name]), { recursive: true })
      writeFileSync(paths[name], contents(name, count))
    }
  }
  writeChains(3)
  const tailBytes = '{"unfinished":'
  writeFileSync(paths.memory, contents('memory', 3) + tailBytes)
  const first = membraneObservation(support)
  for (const row of Object.values(first.chains)) {
    assert.equal(row.verdict, 'UNDETERMINED'); assert.equal(row.reason, 'missing_prior_observation')
  }
  assert.equal(membraneRefusal(first), null)
  assert.equal(retainMembrane(support, first, 'planned'), false)
  assert.equal(existsSync(retainedPath(support)), false)
  assert.equal(retainMembrane(support, first, 'live'), true)
  const retainedBytes = readFileSync(retainedPath(support), 'utf8')
  for (const head of Object.values(JSON.parse(retainedBytes).chains)) assert.equal(head.treeSize, 3)
  assert.equal(first.chains.memory.presentedSize, 3)
  assert.equal(first.chains.memory.unterminatedTailBytes, Buffer.byteLength(tailBytes))
  assert.equal(auraLeaves(support, 'memory').length, 3)
  console.log('PASS first observation: four UNDETERMINED missing_prior_observation, retained only after success')
  console.log('PASS unterminated tail: reported separately; only three LF-terminated records retained')
  writeChains(5)
  const extended = membraneObservation(support)
  for (const row of Object.values(extended.chains)) {
    assert.equal(row.verdict, 'APPEND_ONLY'); assert.equal(row.reason, 'valid_append_only_extension')
    assert.equal(row.retainedSize, 3); assert.equal(row.presentedSize, 5)
  }
  assert.equal(membraneRefusal(extended), null)
  for (const outcome of ['planned', 'refused', 'rolled-back', 'booted']) {
    assert.equal(retainMembrane(support, extended, outcome), false)
    assert.equal(readFileSync(retainedPath(support), 'utf8'), retainedBytes)
  }
  console.log('PASS code/actions/memory/remembered: 3 -> 5 APPEND_ONLY, permitted')

  writeFileSync(retainedPath(support), JSON.stringify(JSON.parse(retainedBytes).chains.code))
  const legacy = membraneObservation(support)
  assert.equal(legacy.chains.code.verdict, 'APPEND_ONLY')
  assert.equal(legacy.chains.code.retainedSize, 3)
  for (const name of ['actions', 'memory', 'remembered']) {
    assert.equal(legacy.chains[name].reason, 'missing_prior_observation')
    assert.equal(legacy.chains[name].retainedSize, 0)
  }
  writeFileSync(retainedPath(support), retainedBytes)
  console.log('PASS old one-head format: code retained 3 -> 5 APPEND_ONLY; other histories missing_prior_observation')

  writeFileSync(paths.memory, contents('rewritten-memory', 5))
  const rewritten = membraneObservation(support)
  assert.deepEqual(membraneConflicts(rewritten), ['memory'])
  assert.equal(rewritten.chains.memory.verdict, 'OBSERVATION_CONFLICT')
  assert.match(membraneRefusal(rewritten), /memory/)
  assert.equal(retainMembrane(support, rewritten, 'live'), false)
  console.log(`PASS rewritten memory: OBSERVATION_CONFLICT ${rewritten.chains.memory.reason}, refused`)

  const source = membraneRefusal.toString()
  const conflictBranch = /if \((\w+)\.verdict === 'OBSERVATION_CONFLICT'\)/u
  assert.match(source, conflictBranch, 'the failing arm must remove the actual conflict branch')
  const withoutConflict = new Script(`(${source.replace(conflictBranch, 'if (false)')})`)
    .runInNewContext({ chainPaths, membraneConflicts })
  assert.equal(withoutConflict(rewritten), null, 'removing the conflict branch must admit the rewritten chain')
  assert.throws(() => assert.notEqual(withoutConflict(rewritten), null), { code: 'ERR_ASSERTION' })
  console.log('EXPECTED FAILURE with conflict check removed: rewritten memory chain accepted')

  const unavailable = membraneObservation(support, { verifier: join(scratch, 'missing-verifier.py') })
  for (const row of Object.values(unavailable.chains)) assert.equal(row.verdict, 'UNDETERMINED')
  assert.match(membraneRefusal(unavailable), /code.*verifier/)
  console.log(`PASS missing verifier: ${unavailable.chains.code.reason}, refused`)

  rmSync(paths.memory)
  mkdirSync(paths.memory)
  // One observation exercises independent errors; a valid printed result cannot mask a crash or extra output.
  const verifier = join(scratch, 'fixture-verifier.py')
  writeFileSync(verifier, `import sys
name = sys.argv[4]
if name == 'remembered':
    print('VERDICT: UNKNOWN\\nREASON : fixture')
else:
    print('VERDICT: APPEND_ONLY\\nREASON : valid_append_only_extension')
    if name == 'code': print('ERROR: unexpected output')
sys.exit(9 if name == 'actions' else 0)
`)
  const errors = membraneObservation(support, { verifier })
  for (const [name, reason] of Object.entries({ code: 'verifier_unknown_output', actions: 'verifier_exit_9',
    memory: 'chain_not_regular', remembered: 'verifier_unknown_output' })) {
    const row = errors.chains[name]
    assert.equal(row.verdict, 'UNDETERMINED'); assert.equal(row.reason, reason)
    const refusal = membraneRefusal({ chains: { ...extended.chains, [name]: row } })
    assert.ok(refusal.includes(name) && refusal.includes(reason), 'each failed history must independently refuse')
    console.log(`PASS ${name}: ${reason}, refused`)
  }
  rmSync(paths.memory, { recursive: true })
  writeFileSync(paths.memory, contents('memory', 5))
  assert.equal(readFileSync(retainedPath(support), 'utf8'), retainedBytes, 'observations never retain heads')
  const saveHeads = () => writeFileSync(retainedPath(support), JSON.stringify({ chains:
    Object.fromEntries(names.map((name) => {
      const leaves = auraLeaves(support, name)
      return [name, { treeSize: leaves.length, root: root(leaves) }]
    })) }))
  writeChains(8); saveHeads()
  const eightHeads = readFileSync(retainedPath(support), 'utf8')
  for (const [index, name] of names.entries()) writeFileSync(paths[name], contents(name, [9, 12, 16, 17][index]))
  const powers = membraneObservation(support)
  for (const [index, name] of names.entries()) {
    assert.equal(powers.chains[name].retainedSize, 8)
    assert.equal(powers.chains[name].presentedSize, [9, 12, 16, 17][index])
    assert.equal(powers.chains[name].verdict, 'APPEND_ONLY')
    assert.equal(powers.chains[name].reason, 'valid_append_only_extension')
  }
  console.log('PASS power-of-two retained 8: honest growth to 9, 12, 16, 17 is APPEND_ONLY')
  writeFileSync(paths.memory, contents('memory', 16).replace('memory-0', 'memory-X'))
  writeFileSync(paths.remembered, contents('forged-remembered', 20))
  const powerRewrites = membraneObservation(support)
  for (const name of ['memory', 'remembered']) {
    const row = powerRewrites.chains[name]
    assert.equal(row.reason, 'POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE')
    assert.match(membraneRefusal({ chains: { ...powers.chains, [name]: row } }), new RegExp(name))
  }
  assert.equal(retainMembrane(support, powerRewrites, 'live'), false)
  assert.equal(readFileSync(retainedPath(support), 'utf8'), eightHeads)
  console.log('PASS power-of-two retained 8: byte flip plus appends and 20 forged records both refused; heads preserved')

  writeChains(5)
  rmSync(paths.actions)
  const actionDir = dirname(paths.actions)
  const receipts = createReceiptLog({ auraDir: actionDir })
  for (let index = 0; index < 3; index += 1) receipts.append({ op: 'fixture', index })
  saveHeads()
  const beforeRotation = readFileSync(retainedPath(support), 'utf8')
  const rotating = createReceiptLog({ auraDir: actionDir, rotateBytes: 1 })
  rotating.append({ op: 'fixture', index: 3 }); rotating.append({ op: 'fixture', index: 4 })
  const segmentBytes = readFileSync(paths.actions, 'utf8')
  const segment = JSON.parse(segmentBytes.split('\n')[0])
  assert.equal(segment.reason, 'rotated')
  const rotation = membraneObservation(support)
  assert.equal(membraneRefusal(rotation), null)
  assert.equal(rotation.chains.actions.reason, 'missing_prior_observation')
  assert.equal(rotation.chains.actions.rotation.previousVerdict, 'APPEND_ONLY')
  assert.equal(retainMembrane(support, rotation, 'live'), true)
  assert.equal(JSON.parse(readFileSync(retainedPath(support), 'utf8')).chains.actions.treeSize, 2)
  console.log('PASS actions rotation: retained 3 -> archived 4 APPEND_ONLY, linked new segment first observed and retained')

  writeFileSync(retainedPath(support), beforeRotation)
  const previousFile = join(actionDir, segment.previousFile)
  renameSync(previousFile, `${previousFile}.aside`)
  const absent = membraneObservation(support)
  assert.match(membraneRefusal(absent), /actions rotation.*Recovery:.*restore/)
  assert.equal(retainMembrane(support, absent, 'live'), false)
  renameSync(`${previousFile}.aside`, previousFile)
  writeFileSync(paths.actions, segmentBytes.replace(`"previousSequence":${segment.previousSequence}`,
    `"previousSequence":${segment.previousSequence + 1}`))
  const mismatched = membraneObservation(support)
  assert.match(membraneRefusal(mismatched), /actions rotation.*Recovery:.*restore/)
  assert.equal(retainMembrane(support, mismatched, 'live'), false)
  assert.equal(readFileSync(retainedPath(support), 'utf8'), beforeRotation)
  console.log('PASS actions rotation: missing archive and mismatched previousSequence refused with rotation recovery; heads preserved')

  rmSync(paths.actions)
  const beforeTear = createReceiptLog({ auraDir: actionDir })
  for (let index = 0; index < 3; index += 1) beforeTear.append({ op: 'fixture-torn', index })
  saveHeads()
  writeFileSync(paths.actions, readFileSync(paths.actions, 'utf8') + 'invalid-json-record\n' + tailBytes)
  createReceiptLog({ auraDir: actionDir }).append({ op: 'after-torn-tail' })
  const tornRotation = membraneObservation(support)
  assert.equal(membraneRefusal(tornRotation), null)
  assert.equal(tornRotation.chains.actions.rotation.reason, 'previous-tail-unusable')
  assert.equal(tornRotation.chains.actions.rotation.previousVerdict, 'APPEND_ONLY')
  assert.equal(tornRotation.chains.actions.rotation.previousUnterminatedTailBytes, Buffer.byteLength(tailBytes))
  console.log('PASS actions torn-tail rotation: full archive SHA256 and retained LF-record head verified; tail reported')

  const becomePath = fileURLToPath(new URL('../scripts/aukora/become.mjs', import.meta.url))
  const witnessPath = fileURLToPath(new URL('../scripts/aukora/witness.mjs', import.meta.url))
  const emptyPath = join(scratch, 'empty-path'); mkdirSync(emptyPath)
  const noPython = { ...process.env, PATH: emptyPath }
  const runNode = (argv, env = process.env) => {
    const checked = spawnSync(process.execPath, argv, { env, encoding: 'utf8', timeout: 10_000 })
    assert.equal(checked.error, undefined)
    return { status: checked.status, text: `${checked.stdout}${checked.stderr}` }
  }
  const missingPython = runNode([witnessPath, '--support', support], noPython)
  assert.notEqual(missingPython.status, 0)
  assert.match(missingPython.text, /verifier_ENOENT/)
  const plan = runNode([becomePath, '--commit', 'HEAD', '--plan'], noPython)
  assert.equal(plan.status, 1); assert.match(plan.text, /BECOME REFUSED:.*verifier_ENOENT/)
  assert.equal(JSON.parse(readFileSync(join(support, 'state/home/become/last.json'), 'utf8')).outcome, 'refused')
  console.log('PASS python3 missing: witness exits nonzero; scratch become --plan REFUSED')
  writeFileSync(paths.code, contents('code', 2))
  const truncated = runNode([witnessPath, '--support', support])
  assert.notEqual(truncated.status, 0)
  assert.match(truncated.text, /code size=2 UNDETERMINED invalid_tree_sizes/)
  console.log('PASS truncation: witness exits nonzero for become refusal (invalid_tree_sizes)')

  // Execute the production final guard/finalizer with scratch rescue files; never enter become's main/restart path.
  const becomeSource = readFileSync(becomePath, 'utf8')
  const putBackSource = becomeSource.slice(becomeSource.indexOf('const putBack ='), becomeSource.indexOf('/** The heavy-run lock'))
  const finalizerSource = becomeSource.slice(becomeSource.indexOf('function guardMembrane()'), becomeSource.indexOf('/** Put everything back'))
  const restoreSource = becomeSource.slice(becomeSource.indexOf('  const restore ='), becomeSource.indexOf("  step('backup'"))
  const rescueSource = becomeSource.slice(becomeSource.indexOf('  const done ='), becomeSource.indexOf('  // THE NEW APPROVAL'))
  const rollbackPaths = ['config.json', 'first.patch.yml', 'second.patch.yml', 'state/gate-state/gate-config.json',
    'state/gate-state/plugin-set-approval.json'].map((path) => join(scratch, 'rollback', path))
  const oldBytes = new Map(rollbackPaths.map((path) => [path, `OLD release in ${path}\n`]))
  const manifest = rollbackPaths.map((path) => {
    const copy = `${path}.backup`
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(copy, oldBytes.get(path))
    return { path, copy }
  })
  const runFinalGuard = async (source) => {
    for (const path of rollbackPaths) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'NEW release\n') }
    let observations = 0, restores = 0, exitCode
    const transient = structuredClone(extended)
    transient.chains.code = { ...transient.chains.code, verdict: 'UNDETERMINED', reason: 'verifier_ETIMEDOUT' }
    const state = await new Script(`(async () => {
      let rescue = null, rescuing = null;
      let result = { previousRelease: 'OLD', release: 'NEW' }, confinementProbed = true;
      const PLAN = false;
      ${putBackSource}
      ${restoreSource}
      ${rescueSource}
      ${source}
      try { guardMembrane(); throw new Error('injected guard did not refuse') }
      catch (error) { if (!(error instanceof BecomeOutcome)) throw error; await finishOutcome(error.outcome, error.message) }
      return { result, rescue };
    })()`).runInNewContext({
      manifest, copyFileSync: (from, to) => { restores += 1; copyFileSync(from, to) },
      membraneObservation: () => {
        observations += 1
        if (observations === 1) return transient
        for (const [path, bytes] of oldBytes) assert.equal(readFileSync(path, 'utf8'), bytes,
          'the first refusal must restore OLD before a second, now-clean observation')
        return extended
      },
      membraneRefusal, codeChain: () => ({ locked: (fn) => fn(), append: () => {} }),
      dropHeavy: () => {}, step: () => {}, say: () => {}, writeResult: () => {}, releaseLock: () => {},
      retainMembrane: () => {}, bodyState: () => ({}), stamp: () => 'fixture', SUPPORT: support, STATE: join(support, 'state'),
      process: { exit: (code) => { exitCode = code } },
    })
    assert.equal(state.result.outcome, 'refused'); assert.equal(state.rescue, null)
    assert.equal(observations, 2); assert.equal(restores, manifest.length); assert.equal(exitCode, 1)
  }
  await runFinalGuard(finalizerSource)
  console.log('PASS transient final-guard refusal: config, both patches, gate-config and approval restored to OLD before second clean observation')
  const rollbackCheck = "if (outcome === 'refused') await putBack()"
  assert.ok(finalizerSource.includes(rollbackCheck))
  await assert.rejects(runFinalGuard(finalizerSource.replace(rollbackCheck, '')), { code: 'ERR_ASSERTION' })
  console.log('EXPECTED FAILURE with first-refusal rollback removed: second clean observation still sees NEW release')
  console.log(`PASS four-history witness check (${((performance.now() - started) / 1000).toFixed(2)}s; scratch only)`)
} finally {
  for (const [name, value] of Object.entries(before)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  rmSync(scratch, { recursive: true, force: true })
}
