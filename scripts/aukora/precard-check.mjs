import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// Check an immutable candidate without borrowing the shared checkout or its environment.
export async function precardCheck({ repo, tree, evidence, timeoutMs = 180_000 }) {
  const deadline = Date.now() + timeoutMs
  let temporary, output = '', failure = '', summary = ''
  let log, logFd
  try {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('invalid check deadline')
    temporary = mkdtempSync(join(tmpdir(), 'aukora-precard-'))
    const checkout = join(temporary, 'checkout'), home = join(temporary, 'home')
    mkdirSync(checkout); mkdirSync(home)
    const env = {
      PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: home,
      LANG: 'C.UTF-8',
    }
    const run = (command, args, cwd, fd) => new Promise((fulfill, reject) => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return reject(new Error('check deadline exceeded'))
      let stdout = '', stderr = '', expired = false
      const child = spawn(command, args, {
        cwd, env, detached: true, stdio: ['ignore', fd ?? 'pipe', fd ?? 'pipe'],
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
    const git = (args, cwd = resolve(repo)) => run('git', ['--no-replace-objects',
      '-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null', '-c', 'core.fsmonitor=false', ...args,
    ], cwd)
    const exactTree = await git(['rev-parse', '--verify', '--end-of-options', `${tree}^{tree}`])
    const objects = await git(['rev-parse', '--path-format=absolute', '--git-path', 'objects'])
    if (!objects || /[\r\n]/u.test(objects)) throw new Error('invalid object directory')
    let head
    try { head = await git(['rev-parse', '--verify', '--end-of-options', `${tree}^{commit}`]) }
    catch { head = await git(['rev-parse', '--verify', 'HEAD']) }

    // Keep enough isolated Git metadata for the existing suite's scratch clones.
    // info/attributes has highest precedence, so archive never omits or rewrites tracked bytes.
    const gitDir = join(checkout, '.git')
    mkdirSync(join(gitDir, 'objects', 'info'), { recursive: true })
    mkdirSync(join(gitDir, 'refs'), { recursive: true })
    mkdirSync(join(gitDir, 'info'))
    writeFileSync(join(gitDir, 'HEAD'), `${head}\n`)
    writeFileSync(join(gitDir, 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\n')
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
    failure = `precard checks refused: ${failed.length ? failed.join(', ') : String(error.message ?? error).replace(/\s+/gu, ' ')}`
    output += `${output.endsWith('\n') || !output ? '' : '\n'}${failure}\n`
  } finally {
    if (logFd !== undefined) closeSync(logFd)
    if (temporary) rmSync(temporary, { recursive: true, force: true })
  }
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(evidence, 'precard-check.txt'), output)
  return { passed: !failure, summary, failure }
}
