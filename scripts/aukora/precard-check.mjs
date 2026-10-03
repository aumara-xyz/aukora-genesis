import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const gitEnvironment = home => ({
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, LANG: 'C.UTF-8',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1',
})
const gitOptions = ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.attributesFile=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.warnAmbiguousRefs=true']

// Only an explicit null base means a new main. Resolve once, then compare immutable
// objects in private Git metadata: neither checkout attributes nor diff drivers apply.
export function measureCard({ repo, tree, base, timeoutMs = 180_000 }) {
  if (base !== null && (typeof base !== 'string' || !base)) throw new Error('explicit landing base required')
  if (typeof tree !== 'string' || !tree) throw new Error('candidate tree required')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('invalid check deadline')
  const deadline = Date.now() + timeoutMs
  const temporary = mkdtempSync(join(tmpdir(), 'aukora-composition-'))
  try {
    const home = join(temporary, 'home'), isolated = join(temporary, 'git')
    mkdirSync(home)
    const git = (args, cwd = resolve(repo), input) => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('check deadline exceeded')
      const result = spawnSync('/usr/bin/git', [...gitOptions, ...args], {
        cwd, env: gitEnvironment(home), input, timeout: remaining, maxBuffer: 64 * 1024 * 1024,
      })
      if (result.error) throw result.error
      // rev-parse can succeed while warning that a ref is ambiguous; refuse that too.
      if (result.status !== 0 || result.stderr.length) throw new Error(`git ${args[0]} refused: ${result.stderr.toString('utf8').trim() || result.signal || result.status}`)
      return result.stdout
    }
    const oid = revision => {
      const value = git(['rev-parse', '--verify', '--end-of-options', revision]).toString('ascii').trim()
      if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value)) throw new Error('invalid Git object ID')
      return value
    }
    const object = oid(`${tree}^{object}`), exactTree = oid(`${object}^{tree}`)
    let exactBase = base === null ? null : oid(`${base}^{tree}`)
    const objects = git(['rev-parse', '--path-format=absolute', '--git-path', 'objects']).toString('utf8').replace(/\n$/u, '')
    if (!objects || /[\r\n]/u.test(objects)) throw new Error('invalid object directory')
    git(['init', '-q', '--bare', '--template=', `--object-format=${exactTree.length === 64 ? 'sha256' : 'sha1'}`, isolated], temporary)
    writeFileSync(join(isolated, 'objects', 'info', 'alternates'), `${objects}\n`)
    if (exactBase === null) exactBase = git(['hash-object', '-t', 'tree', '-w', '--stdin'], isolated, Buffer.alloc(0)).toString('ascii').trim()
    const diff = ['diff-tree', '-r', '--no-commit-id', '--no-renames', '--no-ext-diff', '--no-textconv',
      '--diff-algorithm=myers', '--no-indent-heuristic']
    const records = bytes => {
      if (!bytes.length) return []
      if (bytes.at(-1) !== 0) throw new Error('unterminated Git path records')
      // Latin-1 preserves every pathname byte; only ASCII policy terms are matched.
      return bytes.subarray(0, -1).toString('latin1').split('\0')
    }
    let product = 0, proof = 0
    for (const record of records(git([...diff, '--numstat', '-z', exactBase, exactTree, '--'], isolated))) {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/u.exec(record)
      if (!match || (match[1] === '-') !== (match[2] === '-')) throw new Error('invalid Git line counts')
      const [, added, deleted, path] = match
      // Git gives binary blobs no line count; they still count as added test files.
      const lines = added === '-' ? 0 : Number(added) + Number(deleted)
      const name = path.slice(path.lastIndexOf('/') + 1)
      if (path.startsWith('tests/') || path.startsWith('docs/') || path.endsWith('.md')
        || /court|proof|evidence|witness-report|harness|lane-report/u.test(name)) proof += lines
      else product += lines
      if (!Number.isSafeInteger(product) || !Number.isSafeInteger(proof)) throw new Error('Git line counts exceed safe integers')
    }
    // Additions are separate from line counts: empty new tests still count as files.
    const newTests = records(git([...diff, '--name-only', '--diff-filter=A', '-z', exactBase, exactTree, '--'], isolated))
      .filter(path => path.startsWith('tests/')).length
    const passed = proof <= product && newTests <= 1 && product > 0
    const reasons = [
      newTests > 1 && `new test-file count ${newTests} exceeds maximum 1`,
      proof > product && `proof lines ${proof} exceed product lines ${product}`,
      product === 0 && `product lines ${product} must be greater than 0`,
    ].filter(Boolean)
    return { tree: exactTree, base: exactBase, object, product, proof, newTests, passed,
      composition: `product ${product} lines, proof ${proof} lines`,
      failure: passed ? '' : `REFUSED: ${reasons.join('; ')}.` }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

// THE CHECKS RUN UNDER THIS PROFILE ON macOS: no network beyond loopback, no AUKORA state or signer socket, no keys or
// credentials; writes only in the candidate checkout/home and its disposable fixture scratch. The candidate's code runs here before anyone has approved it.
const quote = path => `"${path.replace(/[\\"]/gu, m => `\\${m}`)}"`
const ancestors = path => { const list = []; for (let at = dirname(path); at !== dirname(at); at = dirname(at)) list.push(at); return list }
// readablePaths re-opens exactly those subtrees after the secret deny (a self-change candidate's Git object directory),
// plus stat-only access to each ancestor so Git can realpath it; no listing or reading of anything beside them.
export function checkSandboxProfile({ home = homedir(), support = join(home, 'Library', 'Application Support', 'AUKORA'), protectedPaths = [], writablePaths = [], unixSocketPaths = [], readablePaths = [] } = {}) {
  const secret = [support, join(home, '.ssh'), join(home, 'Library', 'Keychains'), join(home, '.config', 'gh'),
    join(home, 'aukora-private'), join(home, '.codex'), join(home, '.claude')]
  return ['(version 1)', '(allow default)',
    '(deny network-outbound)', '(allow network-outbound (remote ip "localhost:*"))',
    ...(unixSocketPaths.length ? [`(allow network-outbound ${unixSocketPaths.map(path => `(remote unix-socket (subpath ${quote(path)}))`).join(' ')})`] : []),
    `(deny file-read* ${secret.map(path => `(subpath ${quote(path)})`).join(' ')} (literal ${quote(join(home, '.git-credentials'))}))`,
    ...(readablePaths.length ? [`(allow file-read* ${readablePaths.map(path => `(subpath ${quote(path)})`).join(' ')})`,
      `(allow file-read-metadata ${[...new Set(readablePaths.flatMap(ancestors))].map(path => `(literal ${quote(path)})`).join(' ')})`] : []),
    '(deny file-write*)',
    '(allow file-write* (literal "/dev/null"))',
    `(deny file-write* (subpath ${quote(home)}))`,
    ...(protectedPaths.length ? [`(deny file-write* ${protectedPaths.map(path => `(subpath ${quote(path)})`).join(' ')})`] : []),
    ...(writablePaths.length ? [`(allow file-write* ${writablePaths.map(path => `(subpath ${quote(path)})`).join(' ')})`] : []),
    '(deny signal)', '(allow signal (target self) (target children) (target same-sandbox))',
    '(deny process-info*)', '(allow process-info* (target self) (target children) (target same-sandbox))',
    '(deny mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd"))', ''].join('\n')
}

// Only these audited runner bodies may execute on the host. Check registrations
// can vary in a trusted base; every candidate check still goes through Seatbelt.
const runnerBodies = new Set([
  '9c7031b6b7a7462c90920430a14d87d27fca3ffbce29a9293861e73c822546be',
  'a2b8f7962867327c0d516ff9a8b720ce84dcfb83fd23488b84cbc36698ca5182',
  '67b97651f419ff1e8333906d6a5cbd998e085463e15b2588f91db1f818c78c88',
  'fbc28a032558fc2aa10397db3f5cd6a2f7bbf806fc2c11402e119d3f8e17dc20',
  'ad371aabe989f652d94e6b13b589a71d46f42681585c35bd62f874ee1a7abcb6',
])
const selfConfined = ['scripts/aukora/box-confinement-check.mjs',
  'scripts/aukora/caged-worker.mjs', 'scripts/aukora/caged-broker-effect.mjs']
// Conservative complete closure of the three baseline fixtures: their relative
// modules, noble resolver/packages, and package metadata. No candidate preload,
// config, cwd, Node options or package hook is inherited by the host processes.
const confinementClosure = [...selfConfined, 'plugins/aukora-box', 'vendor/authority',
  'tests/noble-map.mjs', 'package.json', 'node_modules']
const knownRunner = source => runnerBodies.has(createHash('sha256').update(
  source.replace(/^check(?:_self_confined|_darwin)? '[^\n]+'\n/gmu, '')).digest('hex'))
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`

// This controller is generated by the trusted caller outside the candidate tree.
// The baseline runner calls it; candidate children get a clean PATH without it.
// In particular, no candidate script is ever allowed to run on the host merely
// because its filename says it confines itself.
function dispatcherSource({ checkout, baseline, control, home, node, python, path, deadline, profile }) {
  const fixed = JSON.stringify({ checkout, baseline, control, home, node, python, path, deadline, selfConfined, profile })
  return `import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
const fixed = ${fixed}
const [tool, ...args] = process.argv.slice(2)
const env = { PATH: fixed.path, HOME: fixed.home, LANG: 'C.UTF-8',
  TMPDIR: process.env.TMPDIR, PYTHONDONTWRITEBYTECODE: '1',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' }
let command, argv, cwd = fixed.checkout, directory
if (tool === 'sh' && args.length === 2 && args[0] === '-c'
  && fixed.selfConfined.some(file => args[1] === 'node ' + file)) {
  command = fixed.node; argv = [args[1].slice(5)]; cwd = fixed.baseline
} else {
  if (!['sh', 'node', 'python3'].includes(tool)) throw new Error('unknown base interpreter')
  // Protect baseline code, dispatcher, profile and ALL runner rows/logs. Only
  // the candidate checkout/home and the fixture scratch can be written.
  const scratch = realpathSync.native(env.TMPDIR || fixed.home)
  directory = mkdtempSync(join(fixed.control, 'policy-'))
  const literal = value => JSON.stringify(value)
  const text = fixed.profile + '\\n(deny file-write* (subpath ' + literal(dirname(scratch)) + '))\\n'
    + '(allow file-write* (subpath ' + literal(scratch) + '))\\n'
    + '(allow network-outbound (remote unix-socket (subpath ' + literal(scratch) + ')))\\n'
  const policy = join(directory, 'candidate.sb')
  writeFileSync(policy, text)
  command = '/usr/bin/sandbox-exec'
  argv = ['-f', policy, tool === 'sh' ? '/bin/sh' : tool === 'node' ? fixed.node : fixed.python, ...args]
}
try {
  const remaining = fixed.deadline - Date.now()
  if (remaining <= 0) throw new Error('check deadline exceeded')
  const baselineOnly = cwd === fixed.baseline
  const result = spawnSync(command, argv, { cwd, env, stdio: baselineOnly ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: remaining, killSignal: 'SIGKILL' })
  if (baselineOnly) {
    const output = (result.stdout || '') + (result.stderr || '')
    writeFileSync(join(fixed.control, argv[0].split('/').at(-1) + '.txt'), output)
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '')
  }
  if (result.error) throw result.error
  process.exitCode = baselineOnly && /NOT RUN|SKIPPED/u.test(result.stdout || '') ? 2 : result.status ?? 1
} finally { if (directory) rmSync(directory, { recursive: true, force: true }) }
`
}

// Only the runner's one final report is accepted. Skip rows do not become passes.
function parseCheckTotal(output) {
  const lines = output.split(/\r?\n/u)
  if (lines.at(-1) === '') lines.pop()
  if (lines.filter(line => /^TOTAL\b/u.test(line)).length !== 1) throw new Error('missing or duplicate TOTAL line')
  const total = /^TOTAL \d+(?:\.\d+)?s \| ([1-9]\d*)\/([1-9]\d*) passed(?: \| (0|[1-9]\d*) skipped \(see SKIP lines\))?$/u.exec(lines.at(-1))
  if (!total || total[1] !== total[2] || /^FAIL\b/mu.test(output)) throw new Error('missing, malformed or failing final TOTAL line')
  const skips = lines.filter(line => /^SKIP\b/u.test(line)).length
  if (skips !== Number(total[3] ?? 0)) throw new Error('SKIP rows disagree with final TOTAL')
  return total
}

// Check an immutable candidate without borrowing the shared checkout or its environment.
export async function precardCheck({ repo, tree, base, evidence, timeoutMs = 180_000 }) {
  const deadline = Date.now() + timeoutMs
  let temporary, output = '', failure = '', summary = ''
  let log, logFd, measured, control
  const baselineLogs = new Map()
  try {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('invalid check deadline')
    measured = measureCard({ repo, tree, base, timeoutMs: deadline - Date.now() })
    if (!measured.passed) throw new Error(measured.failure)
    temporary = realpathSync.native(mkdtempSync(join(tmpdir(), 'aukora-precard-')))
    const checkout = join(temporary, 'checkout'), home = join(temporary, 'home')
    mkdirSync(checkout); mkdirSync(home)
    const env = {
      PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: home,
      LANG: 'C.UTF-8',
    }
    const run = (command, args, cwd, fd, childEnv = env, raw = false) => new Promise((fulfill, reject) => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return reject(new Error('check deadline exceeded'))
      let stdout = '', stderr = '', expired = false
      const child = spawn(command, args, {
        cwd, env: childEnv, detached: true, stdio: ['ignore', fd ?? 'pipe', fd ?? 'pipe'],
      })
      child.stdout?.on('data', chunk => { stdout += chunk })
      child.stderr?.on('data', chunk => { stderr += chunk })
      const timer = setTimeout(() => {
        expired = true
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* Already gone, or not yet grouped. */ }
        try { child.kill('SIGKILL') } catch { /* Already gone. */ }
      }, remaining)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      // The check writes to a file: grandchildren cannot hold an output pipe open.
      child.once(fd === undefined ? 'close' : 'exit', (code, signal) => {
        clearTimeout(timer)
        // Nothing the candidate started may still write to the log once it is read.
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* The group is already gone. */ }
        if (expired) reject(new Error('check deadline exceeded (SIGKILL)'))
        else if (code !== 0) reject(new Error(`${command} ${signal ? `signal ${signal}` : `exit ${code}`}${stderr ? `: ${stderr.trim()}` : ''}`))
        else fulfill(raw ? stdout : stdout.trim())
      })
    })
    const git = (args, cwd = resolve(repo)) => run('/usr/bin/git', [...gitOptions, ...args], cwd, undefined, gitEnvironment(home))
    const exactTree = measured.tree
    const named = await git(['rev-parse', '--path-format=absolute', '--git-path', 'objects'])
    if (!named || /[\r\n]/u.test(named)) throw new Error('invalid object directory')
    // The alternate names the real directory, so Git's realpath walk touches exactly the components Seatbelt is told about.
    const objects = realpathSync.native(named)
    if (/[\r\n]/u.test(objects)) throw new Error('invalid object directory')
    let head
    try { head = await git(['rev-parse', '--verify', '--end-of-options', `${measured.object}^{commit}`]) }
    catch { head = await git(['rev-parse', '--verify', 'HEAD']) }

    // Keep enough isolated Git metadata for the existing suite's scratch clones.
    // info/attributes has highest precedence, so archive never omits or rewrites tracked bytes.
    const gitDir = join(checkout, '.git')
    mkdirSync(join(gitDir, 'objects', 'info'), { recursive: true })
    mkdirSync(join(gitDir, 'refs'), { recursive: true })
    mkdirSync(join(gitDir, 'info'))
    writeFileSync(join(gitDir, 'HEAD'), `${head}\n`)
    writeFileSync(join(gitDir, 'config'), exactTree.length === 64
      ? '[core]\nrepositoryformatversion = 1\nbare = false\n[extensions]\nobjectFormat = sha256\n'
      : '[core]\nrepositoryformatversion = 0\nbare = false\n')
    writeFileSync(join(gitDir, 'objects', 'info', 'alternates'), `${objects}\n`)
    writeFileSync(join(gitDir, 'info', 'attributes'), '* -export-ignore -export-subst\n')
    const archive = join(temporary, 'candidate.tar')
    await git(['archive', '--format=tar', `--output=${archive}`, exactTree], checkout)
    await run('tar', ['-xf', archive, '-C', checkout], temporary)
    await git(['read-tree', exactTree], checkout)
    // THE HARNESS COMES FROM THE BASE, NOT THE CANDIDATE: its check list and its TOTAL line are code nobody has approved
    // otherwise. The candidate's tests still run, and the card names every check file this change edits.
    const baseHarness = await run('/usr/bin/git', [...gitOptions, 'cat-file', 'blob', `${measured.base}:scripts/check.sh`],
      checkout, undefined, gitEnvironment(home), true)
      .catch(() => { throw new Error('the base has no scripts/check.sh to run this candidate with') })
    writeFileSync(join(checkout, 'scripts', 'check.sh'), baseHarness)
    const listed = new Set([...baseHarness.matchAll(/^check(?:_self_confined|_darwin)? '(?:node|python3) ([^' ]+)/gmu)].map(m => m[1]))
    const changed = (await git(['diff-tree', '-r', '--no-renames', '--name-only', '-z', measured.base, exactTree], checkout))
      .split('\0').filter(path => path === 'scripts/check.sh' || path.startsWith('tests/') || listed.has(path))
    let confinement = 'UNCONFINED: no Seatbelt on this OS'
    let checkCommand = '/bin/sh', checkArgs = ['scripts/check.sh'], checkCwd = checkout, checkEnv = env
    if (process.platform === 'darwin') {
      if (!existsSync('/usr/bin/sandbox-exec')) throw new Error('/usr/bin/sandbox-exec is missing, so the checks cannot be confined')
      const profile = join(temporary, 'checks.sb')
      control = join(temporary, 'controller')
      mkdirSync(control, { mode: 0o700 })
      // A self-change candidate repository lives in the AUKORA support root, which the checks may not read; the checkout's
      // alternate needs its object directory, so that one directory (and nothing else there) is re-opened read-only.
      const support = join(homedir(), 'Library', 'Application Support', 'AUKORA')
      const realSupport = existsSync(support) ? realpathSync.native(support) : support
      const readablePaths = objects.startsWith(`${realSupport}/`) ? [objects] : []
      const policy = checkSandboxProfile({ support, protectedPaths: [temporary], writablePaths: [checkout, home], unixSocketPaths: [checkout, home], readablePaths })
      writeFileSync(profile, policy)
      // Validate actual Seatbelt admission. An env hook/executable's presence is
      // never evidence, and a kernel refusal is not retried or relabeled green.
      await run('/usr/bin/sandbox-exec', ['-f', profile, '/usr/bin/true'], checkout)
      if (knownRunner(baseHarness)) {
        const closureChanges = (await git(['diff-tree', '-r', '--no-renames', '--name-only', '-z',
          measured.base, exactTree, '--', ...confinementClosure], checkout)).split('\0').filter(Boolean)
        if (closureChanges.length) throw new Error(`self-confined checks NOT TESTED: candidate changes their trusted baseline closure: ${closureChanges.join(', ')}`)
        const baseline = join(control, 'base')
        mkdirSync(baseline)
        const baseArchive = join(control, 'base.tar')
        await git(['archive', '--format=tar', `--output=${baseArchive}`, measured.base], checkout)
        await run('/usr/bin/tar', ['-xf', baseArchive, '-C', baseline], control)
        const bin = join(control, 'bin')
        mkdirSync(bin)
        const python = await run('/bin/sh', ['-c', 'command -v python3'], control)
        if (!python.startsWith('/') || /[\r\n]/u.test(python)) throw new Error('invalid Python interpreter')
        const dispatcher = join(control, 'dispatch.mjs')
        writeFileSync(dispatcher, dispatcherSource({ checkout, baseline, control, home,
          node: process.execPath, python, path: env.PATH, deadline, profile: policy }))
        for (const tool of ['sh', 'node', 'python3']) {
          const wrapper = join(bin, tool)
          writeFileSync(wrapper, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(dispatcher)} ${shellQuote(tool)} "$@"\n`)
          chmodSync(wrapper, 0o700)
        }
        // The copied script is byte-for-byte from the base. Its inline Perl/shell
        // controller is trusted; its node/python/sh children are dispatched into
        // Seatbelt, except for the equality-pinned baseline confinement fixtures.
        checkCwd = baseline
        checkEnv = { ...env, PATH: `${bin}:${env.PATH}` }
        confinement = 'Seatbelt per candidate check; baseline-only cage supervisors (unchanged closure)'
      } else {
        // Unrecognized older/custom runners remain wholly confined. No heuristic
        // rewrite or "already confined" claim grants host execution.
        checkCommand = '/usr/bin/sandbox-exec'
        checkArgs = ['-f', profile, '/bin/sh', 'scripts/check.sh']
        confinement = 'Seatbelt: loopback only, no AUKORA state, keys or home writes'
      }
    }
    log = join(temporary, 'check-output.txt')
    logFd = openSync(log, 'w')
    await run(checkCommand, checkArgs, checkCwd, logFd, checkEnv)
    output = readFileSync(log, 'utf8')
    if (Date.now() > deadline) throw new Error('check deadline exceeded')
    const total = parseCheckTotal(output)
    summary = `checks: TOTAL ${total[1]}/${total[2]} passed on this exact tree (base harness; ${confinement})`
      + (Number(total[3]) ? `; ${total[3]} skipped (see SKIP lines)` : '')
      + (changed.length ? `; this change edits ${changed.length} check file(s): ${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ', …' : ''}` : '')
  } catch (error) {
    if (logFd !== undefined) output = readFileSync(log, 'utf8')
    const failed = output.split('\n').filter(line => /^FAIL\b/u.test(line)).map(line =>
      /^FAIL[^|]*\|\s*([^|]+)\|/u.exec(line)?.[1].trim() ?? line.trim())
    failure = measured?.failure || `precard checks refused: ${failed.length ? failed.join(', ') : String(error.message ?? error).replace(/\s+/gu, ' ')}`
    output += `${output.endsWith('\n') || !output ? '' : '\n'}${failure}\n`
  } finally {
    if (logFd !== undefined) closeSync(logFd)
    if (control) for (const script of selfConfined) {
      const name = script.split('/').at(-1) + '.txt', source = join(control, name)
      if (existsSync(source)) baselineLogs.set(name, readFileSync(source, 'utf8'))
    }
    if (temporary) rmSync(temporary, { recursive: true, force: true })
  }
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(evidence, 'precard-check.txt'), output)
  for (const [name, contents] of baselineLogs) writeFileSync(join(evidence, name), contents)
  return { passed: !failure, summary, composition: measured?.composition ?? '', proofRefused: measured?.passed === false, failure }
}
