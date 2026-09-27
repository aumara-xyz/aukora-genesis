#!/usr/bin/env node
/** Attended device-only seal recovery for the installed broker; never repairs leases or starts 5173. */
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { createConnection } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { acquireInstallerLock, releaseInstallerLock } from './install-launchd-custody-pair.mjs'
import { assertNoExtendedAclAncestors } from './launchd-custody-acl.mjs'
import { inspectSealRecovery, recoverSealDevice } from './launchd-seal-recover.mjs'
import { createTerminalLines } from '../aukora/supervisor/developer-terminal.mjs'

const STATE = '/private/var/db/aukora/broker'
const PLIST = '/Library/LaunchDaemons/com.aukora.broker.plist'
const TARGET = 'system/com.aukora.broker'
const SOCKET = '/private/var/db/aukora/run/broker/broker.sock'
const BACKUPS = '/private/var/db/aukora/recovery'
const usage = 'usage: node scripts/launchd-seal-recover-bin.mjs (--check|--apply)'
  + ' --uid UID --inode INODE --from-device OLD_DEV --to-device CURRENT_DEV'
const fail = reason => { throw new Error(`seal-recovery:${reason}`) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fingerprint = stat => ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']
  .map(key => String(stat[key])).join(':')

function argumentsFor(args) {
  if (args.length !== 9 || !['--check', '--apply'].includes(args[0])
    || args[1] !== '--uid' || args[3] !== '--inode'
    || args[5] !== '--from-device' || args[7] !== '--to-device') fail('arguments-not-exact')
  const values = [args[2], args[4], args[6], args[8]]
  if (!values.every(value => /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)))) {
    fail('positive-safe-integers-required')
  }
  const [uid, ino, fromDev, toDev] = values.map(Number)
  if (fromDev === toDev) fail('device-change-required')
  return { apply: args[0] === '--apply', expected: { uid, ino, fromDev, toDev } }
}

function command(program, args, input, timeout = 15_000) {
  const result = spawnSync(program, args, {
    input, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C' },
  })
  if (result.error || result.signal || result.status === null) fail('host-command-unobserved')
  return result
}

function directory(path, privateMode = false) {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path || stat.uid !== 0
    || (privateMode ? (stat.mode & 0o7777) !== 0o700 : (stat.mode & 0o022) !== 0)) fail('root-directory-required')
  assertNoExtendedAclAncestors(path)
}

/** Pin root-controlled launch bytes without exposing their environment values. */
function jobSnapshot(expected) {
  directory('/Library/LaunchDaemons')
  assertNoExtendedAclAncestors(PLIST)
  const before = lstatSync(PLIST, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.uid !== 0n
    || (before.mode & 0o022n) !== 0n || before.size > 128n * 1024n) fail('job-custody-invalid')
  const fd = openSync(PLIST, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  let bytes
  try {
    if (fingerprint(before) !== fingerprint(fstatSync(fd, { bigint: true }))) fail('job-changed')
    bytes = readFileSync(fd)
    if (fingerprint(before) !== fingerprint(fstatSync(fd, { bigint: true }))) fail('job-changed')
  } finally { closeSync(fd) }
  if (fingerprint(before) !== fingerprint(lstatSync(PLIST, { bigint: true }))) fail('job-changed')
  const result = command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], bytes)
  if (result.status !== 0) fail('job-parse-failed')
  let job
  try { job = JSON.parse(result.stdout) } catch { fail('job-parse-failed') }
  const argv = job?.ProgramArguments
  if (job?.Label !== 'com.aukora.broker' || job.UserName !== '_aukora_broker'
    || job.GroupName !== '_aukora_broker_route' || job.WorkingDirectory !== STATE
    || job.EnvironmentVariables?.AUKORA_STATE_DIR !== STATE || job.EnvironmentVariables?.AUKORA_SOCKET !== SOCKET
    || !Array.isArray(argv) || argv.length !== 2 || argv[0] !== '/usr/local/bin/node'
    || typeof argv[1] !== 'string'
    || !/^\/private\/var\/db\/aukora\/implementation\/[0-9a-f]{64}\/scripts\/launchd-broker-entry\.mjs$/.test(argv[1])
    || (job.Program !== undefined && job.Program !== argv[0])) fail('job-configuration-invalid')
  const identity = command('/usr/bin/id', ['-u', job.UserName])
  if (identity.status !== 0 || identity.stdout.trim() !== String(expected.uid)) fail('job-uid-mismatch')
  return { sha256: hash(bytes), identity: fingerprint(before), argv }
}

function sameJob(expected, pinned) {
  const observed = jobSnapshot(expected)
  if (observed.sha256 !== pinned.sha256 || observed.identity !== pinned.identity) fail('job-changed')
}

function jobState(timeout) {
  const result = command('/bin/launchctl', ['print', TARGET], undefined, timeout)
  if (result.status === 113 && result.stdout === ''
    && result.stderr.includes('Could not find service "com.aukora.broker" in domain for system')) return null
  if (result.status !== 0 || result.stderr !== '') fail('job-state-unobserved')
  return result.stdout
}

function requireStopped(expected) {
  if (jobState() !== null) fail('broker-still-loaded')
  const result = command('/bin/ps', ['-axo', 'pid=,uid='])
  if (result.status !== 0 || result.stderr !== '') fail('processes-unobserved')
  for (const line of result.stdout.trim().split('\n')) {
    const match = /^\s*([0-9]+)\s+([0-9]+)\s*$/.exec(line)
    if (match === null) fail('processes-unobserved')
    if (Number(match[2]) === expected.uid) fail('broker-process-remains')
  }
}

function stopBroker(expected) {
  if (jobState() !== null) {
    const result = command('/bin/launchctl', ['bootout', TARGET])
    if (result.status !== 0) fail('broker-bootout-failed')
  }
  requireStopped(expected)
}

/** A bounded read-only status exchange; resolve only after the diagnostic socket closes. */
function respondsToStatus(pid, deadline, signal) {
  if (signal.aborted || Date.now() >= deadline) return Promise.resolve(false)
  return new Promise(resolve => {
    const socket = createConnection(SOCKET)
    let bytes = Buffer.alloc(0)
    let settled = false
    let answer = false
    const finish = value => {
      if (settled) return
      settled = true
      answer = value
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      socket.destroy()
    }
    const cancel = () => finish(false)
    const timer = setTimeout(cancel, Math.max(1, deadline - Date.now()))
    signal.addEventListener('abort', cancel, { once: true })
    socket.once('error', cancel)
    socket.once('end', cancel)
    socket.once('close', () => { finish(false); resolve(answer) })
    socket.once('connect', () => { if (!settled) socket.write('{"id":1,"op":"status"}\n') })
    socket.on('data', chunk => {
      if (settled) return
      if (bytes.length + chunk.length > 64 * 1024) { finish(false); return }
      bytes = Buffer.concat([bytes, chunk])
      const newline = bytes.indexOf(10)
      if (newline < 0) return
      let response
      try { response = JSON.parse(bytes.subarray(0, newline).toString('utf8')) }
      catch { finish(false); return }
      finish(Date.now() < deadline && response?.id === 1 && response.ok === true && response.pid === Number(pid))
    })
  })
}

async function observeStarted(expected, pinned, signal) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (signal.aborted) fail('operator-interrupted')
    const state = jobState(Math.max(1, deadline - Date.now()))
    const pid = /^\s*pid = ([0-9]+)\s*$/m.exec(state ?? '')?.[1]
    const phase = /^\s*state = ([^\r\n]+)$/m.exec(state ?? '')?.[1].trim()
    const activeCount = /^\s*active count = ([0-9]+)\s*$/m.exec(state ?? '')?.[1]
    if (pid !== undefined && phase === 'running' && activeCount === '1') {
      const process = command('/bin/ps', ['-ww', '-p', pid, '-o', 'uid=,command='], undefined,
        Math.max(1, deadline - Date.now()))
      if (process.status !== 0) { await delay(250); continue }
      if (process.stdout.trim() !== `${expected.uid} ${pinned.argv.join(' ')}`) fail('running-process-mismatch')
      let socket
      try { socket = lstatSync(SOCKET) } catch (error) {
        if (error?.code !== 'ENOENT') fail('broker-socket-unobserved')
      }
      if (socket?.isSocket() && socket.uid === expected.uid && (socket.mode & 0o7777) === 0o660) {
        if (await respondsToStatus(pid, deadline, signal)) {
          if (signal.aborted) fail('operator-interrupted')
          const after = jobState(Math.max(1, deadline - Date.now())) ?? ''
          if (/^\s*pid = ([0-9]+)\s*$/m.exec(after)?.[1] === pid
            && /^\s*state = ([^\r\n]+)$/m.exec(after)?.[1].trim() === 'running'
            && /^\s*active count = ([0-9]+)\s*$/m.exec(after)?.[1] === '1' && Date.now() < deadline) {
            return { status: 'broker-running', pid: Number(pid), statusResponded: true, kiraChecked: false }
          }
        }
      }
    }
    await delay(250)
  }
  fail('broker-start-not-observed')
}

let lock
let terminal
let stopped = false
let startupAttempted = false
let expected
let recovery
const interruption = new AbortController()
const interrupt = () => interruption.abort()
process.once('SIGINT', interrupt)
process.once('SIGTERM', interrupt)
try {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    process.stdout.write(`${usage}\n`)
  } else {
    const parsed = argumentsFor(process.argv.slice(2))
    expected = parsed.expected
    if (process.platform !== 'darwin') fail('darwin-required')
    if (parsed.apply && process.geteuid() !== 0) fail('root-required')
    if (parsed.apply && (!process.stdin.isTTY || !process.stderr.isTTY)) fail('attended-terminal-required')
    const pinned = jobSnapshot(expected)
    const inspection = inspectSealRecovery(STATE, expected)
    if (!parsed.apply) {
      process.stdout.write(`${JSON.stringify({ status: 'inspected', inspection, jobSha256: pinned.sha256,
        historicalVolumeIdentity: 'UNVERIFIED', authority: 'NONE' })}\n`)
    } else {
      const challenge = randomBytes(8).toString('hex')
      process.stderr.write(`DEVICE RE-ANCHOR — historical volume identity is NOT verified.\n`
        + `Operator acceptance does not prove continuity or protected human presence.\n`
        + `${JSON.stringify({ inspection, jobSha256: pinned.sha256 })}\n`
        + `This stops only ${TARGET}, preserves the old seal, changes only stateDev, then attempts restart.\n`
        + `Type "reanchor ${challenge}" to accept these exact bytes and this historical-identity limitation: `)
      terminal = createTerminalLines()
      const timeout = AbortSignal.timeout(120_000)
      let answer
      try { answer = await terminal.read(AbortSignal.any([timeout, interruption.signal])) }
      catch {
        if (interruption.signal.aborted) fail('operator-interrupted')
        if (timeout.aborted) fail('approval-expired')
        fail('approval-input-closed')
      }
      if (interruption.signal.aborted) fail('operator-interrupted')
      if (answer !== `reanchor ${challenge}`) fail('operator-declined')
      terminal.close()
      directory('/private/var/db/aukora')
      sameJob(expected, pinned)
      if (JSON.stringify(inspectSealRecovery(STATE, expected)) !== JSON.stringify(inspection)) fail('inspection-stale')
      lock = acquireInstallerLock()
      sameJob(expected, pinned)
      if (JSON.stringify(inspectSealRecovery(STATE, expected)) !== JSON.stringify(inspection)) fail('inspection-stale')
      stopBroker(expected)
      stopped = true
      directory('/private/var/db/aukora')
      try { mkdirSync(BACKUPS, { mode: 0o700 }) }
      catch (error) { if (error?.code !== 'EEXIST') fail('backup-parent-unavailable') }
      directory(BACKUPS, true)
      recovery = recoverSealDevice({ inspection, backupDir: BACKUPS, assertStopped: () => {
        if (interruption.signal.aborted) fail('operator-interrupted')
        sameJob(expected, pinned)
        requireStopped(expected)
      } })
      process.stdout.write(`${JSON.stringify(recovery)}\n`)
      if (interruption.signal.aborted) fail('operator-interrupted')
      sameJob(expected, pinned)
      requireStopped(expected)
      startupAttempted = true
      const result = command('/bin/launchctl', ['bootstrap', 'system', PLIST])
      if (result.status !== 0) fail('broker-bootstrap-failed')
      const running = await observeStarted(expected, pinned, interruption.signal)
      sameJob(expected, pinned)
      startupAttempted = false
      stopped = false
      process.stdout.write(`${JSON.stringify(running)}\n`)
    }
  }
} catch (error) {
  if (startupAttempted) {
    try { stopBroker(expected); stopped = true }
    catch { stopped = false }
  }
  const message = String(error?.message ?? '')
  const known = /^(seal-recovery|launchd-install):[a-z0-9-]+/.exec(message)?.[0]
  const reason = known ?? (['EACCES', 'EPERM', 'ENOENT', 'ELOOP'].includes(error?.code)
    ? `seal-recovery:${error.code.toLowerCase()}` : 'seal-recovery:operation-failed')
  process.stderr.write(`${JSON.stringify({ status: 'failed', reason,
    sealRecovery: recovery !== undefined ? 'recovered' : (error?.sealRecovery ?? 'not-applied'),
    backupDir: recovery?.backupDir ?? error?.backupDir,
    broker: stopped ? 'stopped' : 'not-established', kiraChecked: false })}\n`)
  process.exitCode = 1
} finally {
  terminal?.close()
  if (lock !== undefined) {
    try { releaseInstallerLock(lock) }
    catch { process.stderr.write('seal-recovery:installer-lock-release-indeterminate\n'); process.exitCode = 1 }
  }
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
}
