import { spawn, spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
    return { tree: exactTree, base: exactBase, object, product, proof, newTests, passed,
      composition: `product ${product} lines, proof ${proof} lines`,
      failure: passed ? '' : `REFUSED: this card is mostly proof (${proof} proof lines, ${product} product lines). Ship working code.` }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

// Check an immutable candidate without borrowing the shared checkout or its environment.
export async function precardCheck({ repo, tree, base, evidence, timeoutMs = 180_000 }) {
  const deadline = Date.now() + timeoutMs
  let temporary, output = '', failure = '', summary = ''
  let log, logFd, measured
  try {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('invalid check deadline')
    measured = measureCard({ repo, tree, base, timeoutMs: deadline - Date.now() })
    if (!measured.passed) throw new Error(measured.failure)
    temporary = mkdtempSync(join(tmpdir(), 'aukora-precard-'))
    const checkout = join(temporary, 'checkout'), home = join(temporary, 'home')
    mkdirSync(checkout); mkdirSync(home)
    const env = {
      PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: home,
      LANG: 'C.UTF-8',
    }
    const run = (command, args, cwd, fd, childEnv = env) => new Promise((fulfill, reject) => {
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
        if (expired) reject(new Error('check deadline exceeded (SIGKILL)'))
        else if (code !== 0) reject(new Error(`${command} ${signal ? `signal ${signal}` : `exit ${code}`}${stderr ? `: ${stderr.trim()}` : ''}`))
        else fulfill(stdout.trim())
      })
    })
    const git = (args, cwd = resolve(repo)) => run('/usr/bin/git', [...gitOptions, ...args], cwd, undefined, gitEnvironment(home))
    const exactTree = measured.tree
    const objects = await git(['rev-parse', '--path-format=absolute', '--git-path', 'objects'])
    if (!objects || /[\r\n]/u.test(objects)) throw new Error('invalid object directory')
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
    log = join(temporary, 'check-output.txt')
    logFd = openSync(log, 'w')
    await run('sh', ['scripts/check.sh'], checkout, logFd)
    output = readFileSync(log, 'utf8')
    if (Date.now() > deadline) throw new Error('check deadline exceeded')
    const last = output.replace(/\r?\n$/u, '').split('\n').at(-1)
    const total = /^TOTAL \d+(?:\.\d+)?s \| ([1-9]\d*)\/([1-9]\d*) passed$/u.exec(last)
    if (!total || total[1] !== total[2] || /^FAIL\b/mu.test(output)) throw new Error('missing, malformed or failing final TOTAL line')
    summary = `checks: TOTAL ${total[1]}/${total[2]} passed on this exact tree`
  } catch (error) {
    if (logFd !== undefined) output = readFileSync(log, 'utf8')
    const failed = output.split('\n').filter(line => /^FAIL\b/u.test(line)).map(line =>
      /^FAIL[^|]*\|\s*([^|]+)\|/u.exec(line)?.[1].trim() ?? line.trim())
    failure = measured?.failure || `precard checks refused: ${failed.length ? failed.join(', ') : String(error.message ?? error).replace(/\s+/gu, ' ')}`
    output += `${output.endsWith('\n') || !output ? '' : '\n'}${failure}\n`
  } finally {
    if (logFd !== undefined) closeSync(logFd)
    if (temporary) rmSync(temporary, { recursive: true, force: true })
  }
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(evidence, 'precard-check.txt'), output)
  return { passed: !failure, summary, composition: measured?.composition ?? '', proofRefused: measured?.passed === false, failure }
}
