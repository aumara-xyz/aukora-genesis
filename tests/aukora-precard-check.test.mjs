#!/usr/bin/env node
// One focused gate check. Every fixture script, Git object, remote and state file is disposable.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { precardCheck } from '../scripts/aukora/precard-check.mjs'
import { failClosedIfFriend } from '../scripts/aukora/friend-guard.mjs'
import * as scan from '../scripts/aukora/snapshot-scan.mjs'
const ROOT_FOR_REASON = new URL('..', import.meta.url).pathname

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = fs.mkdtempSync(join(tmpdir(), 'precard-test-'))
const repo = join(scratch, 'repo'), remote = join(scratch, 'remote.git')
const env = { PATH: process.env.PATH, HOME: scratch, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
const git = (args, cwd = repo) => {
  const run = spawnSync('/usr/bin/git', args, { cwd, env, encoding: 'utf8', timeout: 30_000 })
  assert.equal(run.status, 0, `scratch git ${args[0]}: ${run.stderr}`)
  return run.stdout.trim()
}
const deadline = setTimeout(() => { console.error('FAIL precard test exceeded 45 seconds'); process.exit(1) }, 45_000)
let sequence = 0
const evidenceAt = () => join(scratch, `evidence-${sequence++}`)
const passBody = "printf 'PASS 0.01s | fixture-only | ok\nTOTAL 0.01s | 1/1 passed\n'\n"
const failBody = "printf 'FAIL 0.01s | fixture-broken | bad\nTOTAL 0.01s | 0/1 passed\n'\nexit 1\n"
const script = body => '#!/bin/sh\nset -eu\nprintf "fixture-directory=%s\\nfixture-home=%s\\n" "$PWD" "$HOME"\nenv\n' + body
let parent
function fixture(body, label) {
  fs.writeFileSync(join(repo, 'scripts', 'check.sh'), script(body))
  git(['add', 'scripts/check.sh'])
  const tree = git(['write-tree'])
  const commit = git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', label])
  if (!parent) { parent = commit; git(['update-ref', 'HEAD', commit]) }
  return { tree, commit }
}
const evidenceOutput = evidence => fs.readFileSync(join(evidence, 'precard-check.txt'), 'utf8')
function removedMaterialization(output) {
  const directory = /^fixture-directory=(.+)$/mu.exec(output)?.[1]
  const home = /^fixture-home=(.+)$/mu.exec(output)?.[1]
  assert.ok(directory && home, 'fake suite actually ran in its materialized tree')
  assert.equal(fs.existsSync(directory), false, 'temporary checkout removed')
  assert.equal(fs.existsSync(home), false, 'temporary home removed')
  assert.equal(fs.existsSync(repo), true, 'source repository retained')
}

try {
  fs.mkdirSync(join(repo, 'scripts'), { recursive: true })
  git(['init', '-q'])
  const base = fixture(passBody, 'base')
  const pass = fixture(passBody + '# candidate\n', 'pass')
  const fail = fixture(failBody, 'fail')
  const hang = fixture("printf 'hang-started\\n'\nwhile :; do sleep 60; done\n", 'hang')
  const malformed = fixture("printf 'TOTAL 0.01s | one/one passed\\n'\n", 'malformed')
  const nonzero = fixture(passBody + 'exit 7\n', 'nonzero')
  git(['init', '-q', '--bare', remote])
  fs.writeFileSync(join(remote, 'objects', 'info', 'alternates'), `${join(repo, '.git', 'objects')}\n`)
  git(['--git-dir', remote, 'update-ref', 'refs/heads/main', base.commit])
  git(['remote', 'add', 'origin', remote])
  const remoteBefore = git(['--git-dir', remote, 'rev-parse', 'refs/heads/main'])
  const consumed = join(scratch, 'consumed')
  const untouched = () => {
    assert.equal(fs.existsSync(consumed), false, 'no approval consumed')
    assert.equal(git(['--git-dir', remote, 'rev-parse', 'refs/heads/main']), remoteBefore, 'scratch remote unchanged')
  }

  // Dirty source and hostile caller variables must not alter the archived candidate.
  fs.writeFileSync(join(repo, 'scripts', 'check.sh'), script(failBody))
  const poisoned = { PATH: '/no-precard-tools-here', HOME: '/no-precard-home-here', AUKORA_PRECARD_TEST: 'poison', GIT_DIR: '/no-precard-git-here', NODE_OPTIONS: '--no-such-node-option' }
  const before = Object.fromEntries(Object.keys(poisoned).map(name => [name, process.env[name]]))
  const evidence = evidenceAt()
  let checked
  try {
    Object.assign(process.env, poisoned)
    checked = await precardCheck({ repo, tree: pass.tree, base: base.commit, evidence, timeoutMs: 20_000 })
  } finally {
    for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  }
  assert.equal(checked.passed, true, checked.failure)
  assert.equal(checked.summary, 'checks: TOTAL 1/1 passed on this exact tree')
  assert.equal(checked.composition, 'product 1 lines, proof 0 lines')
  const output = evidenceOutput(evidence)
  assert.doesNotMatch(output, /^(?:AUKORA_|GIT_|NODE_OPTIONS=)/mu)
  assert.doesNotMatch(output, /no-precard-tools-here|no-precard-home-here/u)
  removedMaterialization(output)
  console.log('PASS exact candidate tree, clean environment, full evidence and temporary cleanup')

  const sources = Object.fromEntries(['self-change', 'advance'].map(name => [name, fs.readFileSync(join(root, 'scripts', 'aukora', `${name}.mjs`), 'utf8')]))
  for (const [name, source] of Object.entries(sources)) {
    const start = source.indexOf('// PRECARD CHECK:'), end = source.indexOf('// PRECARD CHECK END', start)
    assert.ok(start >= 0 && end > start, `${name}: discoverable production gate`)
    assert.ok(end < source.indexOf('const asked = spawnSync'), `${name}: checks before signer`)
    assert.ok(end < source.indexOf('// ONE USE'), `${name}: checks before consumption`)
    assert.equal(source.split('await precardCheck(').length, 2, `${name}: exactly one check call`)
    assert.ok(end < source.indexOf('content.length > MAX_SHOWN_CHARS'), `${name}: final card length checked after summary`)
  }

  async function advance(target, source = sources.advance, timeoutMs = 20_000) {
    const home = join(scratch, `advance-${sequence++}`), support = join(home, 'support')
    fs.mkdirSync(support, { recursive: true })
    // Public-shaped placeholder only; no signer key exists in this test.
    let number = BigInt('0xed01' + '00'.repeat(32)), did = ''
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    while (number) { did = alphabet[Number(number % 58n)] + did; number /= 58n }
    fs.writeFileSync(join(support, 'kira-deployment-overlay.patch.yml'), `subject: fixture\nactiveControlDigest: fixture\napproverDid: did:key:z${did}\n`)
    const state = { popups: 0, log: '', card: '', evidence: null }
    const context = {
      ...fs, ...scan, join, resolve, dirname, fileURLToPath, Buffer, createHash,
      createPublicKey: () => ({ export: () => 'fixture public placeholder\n' }), homedir: () => home, shownLimit: () => 1650,
      process: { execPath: process.execPath, argv: ['node', 'advance.mjs', 'fixture change', 'origin', target], env: { ...env, AUKORA_SUPPORT_ROOT: support },
        stdout: { write: value => { state.log += value } }, stderr: { write: value => { state.log += value } },
        exit: code => { throw Object.assign(new Error('route exit'), { routeExit: code }) } },
      codeChain: () => ({ locked: fn => fn(), closeUnused: () => [], read: () => [], closedKeys: () => new Set(), consumedIds: consumed,
        append: () => { fs.writeFileSync(consumed, 'unexpected'); throw new Error('unexpected chain append') } }),
      precardCheck: async options => { state.evidence = options.evidence; return precardCheck({ ...options, timeoutMs }) },
      failClosedIfFriend,
      spawnSync: (command, args, options) => {
        if (args[0]?.endsWith('/approve-operation')) {
          state.popups++; state.card = fs.readFileSync(args[args.indexOf('--operation') + 1], 'utf8')
          return { status: 1, stdout: 'stub popup refused\n', stderr: '' }
        }
        assert.ok(command === 'git' && args[0] !== 'push', 'only scratch Git reads before stub popup')
        return spawnSync(command, args, { ...options, timeout: 30_000 })
      },
    }
    const body = source.replace(/^#!.*\n/u, '').replace(/^import .*\n/gmu, '').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(join(repo, 'scripts', 'aukora', 'advance.mjs')).href))
    try { await runInNewContext(`(async () => { ${body}\n})()`, context, { timeout: 30_000 }) }
    catch (error) { if (error.routeExit !== 1) throw error }
    untouched()
    return state
  }

  const green = await advance(pass.commit)
  assert.equal(green.popups, 1)
  assert.match(green.card, /^checks: TOTAL 1\/1 passed on this exact tree$/mu)
  assert.match(green.card, /^product 1 lines, proof 0 lines$/mu)
  assert.ok(green.card.length <= 1650)
  removedMaterialization(evidenceOutput(green.evidence))
  console.log('PASS advance PASS tree reaches stub popup with checks line within shown limit')
  const red = await advance(fail.commit)
  assert.equal(red.popups, 0, 'FAIL tree must not reach popup')
  assert.match(red.log, /fixture-broken/u)
  assert.match(evidenceOutput(red.evidence), /FAIL 0\.01s \| fixture-broken \| bad/u)
  removedMaterialization(evidenceOutput(red.evidence))
  console.log('PASS advance FAIL tree refused before popup; evidence written, nothing consumed, remote unmoved')

  // Run self-change's actual gate through its second staging and card-size check.
  const selfStart = sources['self-change'].indexOf('// PRECARD CHECK:')
  const selfEnd = sources['self-change'].indexOf('const operationDigest =', selfStart)
  for (const [target, expected] of [[pass, true], [fail, false]]) {
    const selfEvidence = evidenceAt(), candidate = { worktree: repo, tree: target.tree, base: base.commit, digest: 'fixture' }
    const state = { popup: false, reason: '' }
    const context = { candidate, evidence: selfEvidence, REPO: repo, SUPPORT: scratch, paths: ['scripts/check.sh'], generated: [], why: 'fixture',
      previews: new Set(), PENDING_INTENT_SCHEMA: 'fixture', MAX_SHOWN_CHARS: 1650, Buffer,
      precardCheck, candidateStep: fn => fn(),
      stageCandidatePreview: options => { state.reason = options.why; return { ...candidate } },
      qualifyCandidateCrossing: () => [], candidateOperation: (_candidate, why) => { assert.equal(why, state.reason); return why },
      deriveApprovalWitness: bytes => ({ words: bytes.toString() }),
      process: { stderr: { write: () => {} }, exit: () => { throw Object.assign(new Error('composition refused'), { refused: true }) } },
      fail: message => { throw Object.assign(new Error(message), { refused: true }) },
      popup: content => { state.popup = true; assert.match(content, /checks: TOTAL 1\/1 passed on this exact tree/u); assert.match(content, /^product 1 lines, proof 0 lines$/mu) },
    }
    try { await runInNewContext(`(async () => { ${sources['self-change'].slice(selfStart, selfEnd)}\npopup(content) })()`, context, { timeout: 30_000 }) }
    catch (error) { if (!error.refused) throw error }
    assert.equal(state.popup, expected)
    assert.ok(fs.existsSync(join(selfEvidence, 'precard-check.txt')))
    untouched()
  }
  console.log('PASS self-change PASS/FAIL gates; check line bound into restaged candidate operation')

  const started = Date.now(), hanging = await advance(hang.commit, sources.advance, 5000)
  assert.equal(hanging.popups, 0)
  assert.match(evidenceOutput(hanging.evidence), /deadline.*SIGKILL/u)
  assert.ok(Date.now() - started < 20_000, 'hang refused within generous test ceiling')
  removedMaterialization(evidenceOutput(hanging.evidence))
  console.log('PASS hanging check refused at 5000 ms deadline with SIGKILL; no popup')
  for (const target of [malformed, nonzero]) {
    const refused = await advance(target.commit)
    assert.equal(refused.popups, 0)
    assert.match(evidenceOutput(refused.evidence), /precard checks refused:/u)
  }
  console.log('PASS malformed TOTAL and exit 7 despite passing TOTAL refused before popup')

  const call = /const checked = await precardCheck\(\{ repo: REPO, tree: to, base: from, evidence \}\)/u
  assert.match(sources.advance, call)
  const mutant = await advance(fail.commit, sources.advance.replace(call, "const checked = { passed: true, summary: '' }"))
  assert.equal(mutant.popups, 1, 'removing advance call must expose red tree to popup')
  assert.throws(() => assert.equal(mutant.popups, 0, 'FAIL tree must not reach popup'), /FAIL tree must not reach popup/u)
  console.log('EXPECTED FAILURE with advance precard call removed: FAIL tree must not reach popup (actual: 1)')
  {
  // The restaged candidate's reason must be the reason presented at commit, or the adapter refuses
  // candidate:commit-not-authorized after the kernel has spent the approval (seen live on 2026-09-28).
  const source = fs.readFileSync(join(ROOT_FOR_REASON, 'scripts/aukora/self-change.mjs'), 'utf8')
  const staged = /stageCandidatePreview\(\{[^}]*why: (\w+)[^}]*\}\)\)\s*\npreviews\.add/u.exec(source)?.[1]
  const committed = /commitCandidateTree\(candidate, \{ why(?:: (\w+))?,/u.exec(source)
  assert.ok(staged, 'self-change restages its candidate with a named reason')
  assert.ok(committed, 'self-change commits the candidate')
  assert.equal(committed[1] ?? 'why', staged, 'self-change commits with the same reason it restaged the candidate with')
  console.log(`PASS self-change commits with the restaged reason (${staged})`)
}
console.log('PASS precard gate focused test')
} finally {
  clearTimeout(deadline)
  fs.rmSync(scratch, { recursive: true, force: true })
}
