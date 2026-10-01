#!/usr/bin/env node
// One focused gate check. Every fixture script, Git object, remote and state file is disposable.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
const { tmpdir } = os
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

// Real OS proof, separate from the VM recursion below; every socket is fixture-owned.
if (process.argv.includes('--unix-boundary')) {
  assert.equal(process.platform, 'darwin', 'Unix boundary proof requires macOS Seatbelt')
  const { createServer } = await import('node:net')
  const { checkSandboxProfile } = await import('../scripts/aukora/precard-check.mjs')
  const directory = fs.realpathSync.native(fs.mkdtempSync('/tmp/precard-unix-'))
  const home = join(directory, 'home'), privateRoot = join(directory, 'private')
  fs.mkdirSync(home); fs.mkdirSync(privateRoot)
  const outside = join(directory, 'owner-fixture.sock'), inside = join(privateRoot, 'fixture.sock')
  const policy = join(directory, 'candidate.sb'), servers = [], observations = []
  const received = { outside: 0, inside: 0 }
  try {
    for (const [label, path] of [['outside', outside], ['inside', inside]]) {
      const server = createServer(socket => {
        socket.on('error', () => {})
        socket.on('data', bytes => { received[label] += bytes.length; socket.end('fixture-ok') })
      })
      servers.push(server)
      await new Promise((fulfill, reject) => { server.once('error', reject); server.listen(path, fulfill) })
    }
    const alias = join(privateRoot, 'outside-alias.sock')
    fs.symlinkSync(outside, alias)
    const hardlink = join(privateRoot, 'outside-hardlink-control.sock')
    let hardlinkCreated = false
    try {
      fs.linkSync(outside, hardlink)
      hardlinkCreated = true
      console.log('HARDLINK fixture creation succeeded; denied connection required')
    } catch (error) {
      assert.ok(['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code), error)
      console.log(`HARDLINK fixture creation refused: ${error.code}; hardlink connection NOT TESTED`)
    }
    fs.writeFileSync(policy, checkSandboxProfile({ home, support: join(home, 'support'),
      writablePaths: [privateRoot], unixSocketPaths: [privateRoot] }))
    const client = `import errno, os, socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(2)
try:
    if len(sys.argv) > 2:
        try: os.link(sys.argv[2], sys.argv[1])
        except OSError as error:
            print('LINK_CREATION_REFUSED ' + errno.errorcode.get(error.errno, str(error.errno))); sys.exit(5)
        print('LINK_CREATED')
    s.connect(sys.argv[1]); s.sendall(b'fixture-only'); reply = s.recv(64)
    print('CONNECTED ' + reply.decode()); sys.exit(0 if reply == b'fixture-ok' else 4)
except OSError as error:
    print(errno.errorcode.get(error.errno, str(error.errno))); sys.exit(3)
finally:
    s.close()
`
    for (const [label, path] of [['outside', outside], ['inside', inside], ['outside-alias', alias],
      ['outside-hardlink', join(privateRoot, 'outside-hardlink.sock')],
      ...(hardlinkCreated ? [['outside-hardlink-connect', hardlink]] : [])]) {
      const result = await new Promise((fulfill, reject) => {
        const child = spawn('/usr/bin/sandbox-exec', ['-f', policy, '/usr/bin/python3', '-c', client, path,
          ...(label === 'outside-hardlink' ? [outside] : [])],
          { env: { PATH: '/usr/bin:/bin', HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = '', stderr = ''
        const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
        child.stdout.on('data', bytes => { stdout += bytes }); child.stderr.on('data', bytes => { stderr += bytes })
        child.once('error', error => { clearTimeout(timeout); reject(error) })
        child.once('close', status => { clearTimeout(timeout); fulfill({ label, status, stdout: stdout.trim(), stderr: stderr.trim() }) })
      })
      console.log('UNIX FIXTURE', JSON.stringify({ ...result, received: { ...received } }))
      if (result.stderr.includes('sandbox-exec:')) throw new Error(result.stderr)
      observations.push(result)
    }
    for (const label of ['outside', 'outside-alias', ...(hardlinkCreated ? ['outside-hardlink-connect'] : [])]) {
      const result = observations.find(row => row.label === label)
      assert.equal(result.status, 3, `${label}: host socket must be refused`)
      assert.match(result.stdout, /^(?:EPERM|EACCES)$/u)
    }
    const attemptedLink = observations.find(row => row.label === 'outside-hardlink')
    if (attemptedLink.status === 5) {
      assert.match(attemptedLink.stdout, /^LINK_CREATION_REFUSED (?:EPERM|EACCES)$/u)
      console.log('HARDLINK candidate creation refused; connection was not attempted in this arm')
    } else {
      assert.equal(attemptedLink.status, 3, 'created hardlink: host connection must be refused')
      assert.match(attemptedLink.stdout, /^LINK_CREATED\n(?:EPERM|EACCES)$/u)
    }
    assert.equal(received.outside, 0, 'outside host socket received no fixture bytes')
    assert.equal(observations.find(row => row.label === 'inside').status, 0, 'private socket must work')
    assert.equal(received.inside, Buffer.byteLength('fixture-only'))
    console.log('PASS real Unix boundary: outside and symlink denied; private fixture exchanged bytes; '
      + (hardlinkCreated ? 'created hardlink connection denied' : 'hardlink connection NOT TESTED (fixture creation refused)'))
  } finally {
    for (const server of servers) await new Promise(fulfill => server.close(fulfill))
    fs.rmSync(directory, { recursive: true, force: true })
  }
  process.exit(0)
}
// Suite recursion models only sandbox launch in a VM. All other production gate
// code and disposable Git/timeout effects are real. This is not OS enforcement
// evidence: the separate full precard run must enter actual Seatbelt.
const helper = fs.readFileSync(new URL('../scripts/aukora/precard-check.mjs', import.meta.url), 'utf8')
const fixtureSpawn = (command, args, options) => command === '/usr/bin/sandbox-exec'
  ? spawn(args[2], args.slice(3), options) : spawn(command, args, options)
const { precardCheck, measureCard } = runInNewContext(`(() => {
${helper.slice(helper.indexOf('const gitEnvironment')).replace(/^export /gmu, '')}
return { precardCheck, measureCard }
})()`, { ...fs, ...os, spawn: fixtureSpawn, spawnSync, createHash,
  dirname, join, resolve, process, Buffer, setTimeout, clearTimeout })
console.log('PRECARD FIXTURES: VM sandbox-launch mock; OS enforcement is NOT TESTED here')
// This mode calls only precardCheck with harmless disposable Git/shell fixtures.
// It never reads or executes the advance/self-change/become entry points below.
async function directRepairCheck() {
  const directory = fs.mkdtempSync(join(tmpdir(), 'precard-direct-repair-'))
  const repo = join(directory, 'repo')
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: directory,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  const git = args => {
    const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 10_000 })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const harness = '#!/bin/sh\nexec /bin/sh lib/fixture.sh\n' // Deliberately ignores the environment hook.
  const writeFixture = body => {
    fs.writeFileSync(join(repo, 'scripts/check.sh'), harness)
    fs.writeFileSync(join(repo, 'lib/fixture.sh'), body)
    git(['add', 'scripts/check.sh', 'lib/fixture.sh'])
    return git(['write-tree'])
  }
  let failures = 0, sequence = 0
  const expect = async (name, test) => {
    try { await test(); console.log(`PASS direct repair: ${name}`) }
    catch (error) { failures++; console.error(`FAIL direct repair: ${name}: ${error.message}`) }
  }
  try {
    fs.mkdirSync(join(repo, 'scripts'), { recursive: true })
    fs.mkdirSync(join(repo, 'lib'))
    git(['init', '-q', '--template='])
    const baseTree = writeFixture('#!/bin/sh\n# synthetic baseline fixture\n')
    const base = git(['-c', 'user.name=Synthetic fixture', '-c', 'user.email=fixture@example.invalid',
      'commit-tree', baseTree, '-m', 'Synthetic direct-check baseline'])
    git(['update-ref', 'HEAD', base])
    const run = async body => {
      const tree = writeFixture(body)
      return precardCheck({ repo, tree, base, evidence: join(directory, `evidence-${sequence++}`), timeoutMs: 15_000 })
    }
    // These rows are simulated runner output, not a Linux or aggregate suite run.
    for (const [name, report, passed] of [
      ['legacy TOTAL', 'TOTAL 0.01s | 42/42 passed', true],
      ['TOTAL with three platform skips', 'TOTAL 0.01s | 39/39 passed | 3 skipped (see SKIP lines)', true],
      ['explicit zero skips', 'TOTAL 0s | 1/1 passed | 0 skipped (see SKIP lines)', true],
      ['unequal pass count', 'TOTAL 0.01s | 39/40 passed | 2 skipped (see SKIP lines)', false],
      ['negative skip count', 'TOTAL 0.01s | 40/40 passed | -2 skipped (see SKIP lines)', false],
      ['signed skip count', 'TOTAL 0.01s | 40/40 passed | +2 skipped (see SKIP lines)', false],
      ['fractional skip count', 'TOTAL 0.01s | 40/40 passed | 2.0 skipped (see SKIP lines)', false],
      ['noncanonical skip count', 'TOTAL 0.01s | 40/40 passed | 02 skipped (see SKIP lines)', false],
      ['unsupported skip suffix', 'TOTAL 0.01s | 40/40 passed | 2 skipped', false],
      ['duplicate reports', 'TOTAL 0.01s | 1/1 passed\nTOTAL 0.01s | 1/1 passed', false],
      ['malformed earlier report', 'TOTAL\tmalformed\nTOTAL 0.01s | 1/1 passed', false],
      ['FAIL row with passing report', 'FAIL 0s | synthetic-only | refused\nTOTAL 0.01s | 1/1 passed', false],
      ['unreported skips', 'SKIP | synthetic-only\nTOTAL 0.01s | 1/1 passed', false],
      ['invented skip count', 'TOTAL 0.01s | 1/1 passed | 1 skipped (see SKIP lines)', false],
      ['trailing output', 'TOTAL 0.01s | 1/1 passed\ntrailing synthetic output', false],
    ]) {
      await expect(name, async () => {
        // Fixed grammar data contains no shell metacharacters or private content.
        const rows = name === 'TOTAL with three platform skips' ? 'SKIP | synthetic-only-1\nSKIP | synthetic-only-2\nSKIP | synthetic-only-3\n' : ''
        const result = await run(`#!/bin/sh\nprintf '%s\n' '${rows}${report}'\n`)
        assert.equal(result.passed, passed, `${name}: ${result.failure || result.summary}`)
      })
    }
    for (const [count, content, failure] of [
      [2, '', 'REFUSED: new test-file count 2 exceeds maximum 1.'],
      [1, '// proof\n'.repeat(3), 'REFUSED: proof lines 3 exceed product lines 2.'],
    ]) await expect(`composition diagnostic: ${failure}`, () => {
      git(['read-tree', baseTree])
      writeFixture('#!/bin/sh\n# candidate\n')
      fs.mkdirSync(join(repo, 'tests'), { recursive: true })
      const files = Array.from({ length: count }, (_, i) => `tests/diagnostic-${count}-${i}.mjs`)
      for (const file of files) fs.writeFileSync(join(repo, file), content)
      git(['add', ...files])
      const result = measureCard({ repo, tree: git(['write-tree']), base })
      assert.equal(result.passed, false)
      assert.equal(result.failure, failure)
    })
    console.log('NOT TESTED direct repair: real Seatbelt admission (VM fixtures only)')
    assert.equal(failures, 0, `${failures} direct repair case(s) failed`)
    console.log('PASS precard direct repair focused test; synthetic evidence only')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

if (process.argv.includes('--direct-repair')) {
  await directRepairCheck()
} else {
const scan = await import('../scripts/aukora/snapshot-scan.mjs')
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
// The harness is the base's and stays fixed; the candidate varies the check it runs (lib/fixture.sh).
const harness = '#!/bin/sh\nexec sh lib/fixture.sh\n'
function fixture(body, label, candidateHarness = harness) {
  fs.mkdirSync(join(repo, 'lib'), { recursive: true })
  fs.writeFileSync(join(repo, 'scripts', 'check.sh'), candidateHarness)
  fs.writeFileSync(join(repo, 'lib', 'fixture.sh'), script(body))
  git(['add', 'scripts/check.sh', 'lib/fixture.sh'])
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
  // A candidate that rewrites the harness to print a passing TOTAL while its check fails.
  const forged = fixture(failBody, 'forged', "#!/bin/sh\nprintf 'TOTAL 0.01s | 1/1 passed\\n'\n")
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
  fs.writeFileSync(join(repo, 'lib', 'fixture.sh'), script(failBody))
  const poisoned = { PATH: '/no-precard-tools-here', HOME: '/no-precard-home-here', AUKORA_PRECARD_TEST: 'poison', GIT_DIR: '/no-precard-git-here', NODE_OPTIONS: '--no-such-node-option', NODE_PATH: '/no-node-hooks', PERL5LIB: '/no-perl-hooks', AUKORA_CHECK_SANDBOX: '/no-forged-profile', AUKORA_SUPPORT_ROOT: '/no-forged-support' }
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
  const line = /^checks: TOTAL 1\/1 passed on this exact tree \(base harness; [^)]+\)$/mu
  assert.match(checked.summary, line)
  assert.equal(checked.composition, 'product 1 lines, proof 0 lines')
  const output = evidenceOutput(evidence)
  assert.doesNotMatch(output, /^(?:AUKORA_|GIT_|NODE_OPTIONS=|NODE_PATH=|PERL5LIB=)/mu)
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
  assert.match(green.card, line)
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
  const forgedRun = await advance(forged.commit)
  assert.equal(forgedRun.popups, 0, 'a candidate harness printing a passing TOTAL must not reach the popup')
  assert.match(evidenceOutput(forgedRun.evidence), /fixture-broken/u)
  console.log('PASS candidate-rewritten harness ignored: the base harness ran its failing check; no popup')

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

}
