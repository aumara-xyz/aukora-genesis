// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara LLC
/**
 * macOS restrictions for the prepared, keyless 8088 guest.
 * Adapted from aukora-cordis at 626310e2cbd76eff87a6ab306dbc083ae5527618;
 * source details and retained license are in confinement-provenance.md.
 * @module @aukora/supervisor/guest-confinement
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'

/** Explicit mode; other platforms refuse instead of launching without restrictions. */
export const GUEST_CONFINEMENT_MODE = 'macos-seatbelt'
/** Guest exclusion does not separate the same-UID trusted authorities. */
export const CONFINED_OBSERVATION_CLASS = 'MACOS_SEATBELT_GUEST / SAME_UID_AUTHORITIES / NO_CUSTODY_CLAIM'
const SANDBOX = '/usr/bin/sandbox-exec'
const SYSTEM_READS = ['/System/Library', '/usr/lib', '/dev/null', '/dev/urandom']
const SYSCTLS = ['kern.ostype', 'kern.osrelease', 'kern.osversion', 'kern.version', 'kern.hostname', 'kern.argmax', 'sysctl.proc_translated']

/** Refusal before a requested confined guest is admitted. */
export class GuestConfinementError extends Error {
  /**
   * @param {string} reason - Stable diagnostic.
   * @param {string} detail - Failed observation.
   */
  constructor(reason, detail) {
    super(`${reason}: ${detail}`)
    this.name = 'GuestConfinementError'
    this.reason = reason
  }
}

/**
 * Require the named platform mechanism before creating an assembly.
 * @param {string} mode - Requested restriction.
 * @returns {void}
 */
export function requireGuestConfinement(mode) {
  if (mode !== GUEST_CONFINEMENT_MODE) throw new GuestConfinementError('confined:mode-unsupported', String(mode))
  if (process.platform !== 'darwin') throw new GuestConfinementError('confined:platform-unsupported', process.platform)
  let executable
  try { executable = lstatSync(SANDBOX) } catch {
    // An absent or inaccessible platform executable cannot enforce the requested mode.
    throw new GuestConfinementError('confined:sandbox-unavailable', SANDBOX)
  }
  if (!executable.isFile()) throw new GuestConfinementError('confined:sandbox-unavailable', SANDBOX)
}

function canonical(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || normalize(path) !== path || /[\x00-\x1f\x7f]/u.test(path)) {
    throw new GuestConfinementError('confined:path-invalid', 'paths must be absolute, normalized, and control-free')
  }
  return realpathSync.native(path)
}
function contains(root, path) { return root === path || path.startsWith(`${root}/`) }
function overlaps(left, right) { return contains(left, right) || contains(right, left) }
function unique(paths) { return [...new Set(paths)].sort() }
function literal(path) { return `(literal ${JSON.stringify(path)})` }
function subpath(path) { return `(subpath ${JSON.stringify(path)})` }
function ancestors(path) {
  const result = [path]
  while (dirname(path) !== path) { path = dirname(path); result.push(path) }
  return result
}

/** Installation aliases add no read grant; private and external targets refuse. */
function inspectReadClosure(roots, sourceRoot, protectedPaths) {
  let count = 0
  const walk = (entry) => {
    if (++count > 200_000) throw new GuestConfinementError('confined:read-closure-too-large', entry)
    const state = lstatSync(entry)
    if (state.isSymbolicLink()) {
      const target = canonical(entry)
      if (protectedPaths.some(path => overlaps(path, target))
        || (!contains(sourceRoot, target) && !roots.some(path => contains(path, target)))) {
        throw new GuestConfinementError('confined:read-alias-escapes', entry)
      }
      if (lstatSync(target).isFile() && lstatSync(target).nlink !== 1) {
        throw new GuestConfinementError('confined:hardlinked-read-file', entry)
      }
    } else if (state.isFile()) {
      if (state.nlink !== 1) throw new GuestConfinementError('confined:hardlinked-read-file', entry)
    } else if (state.isDirectory()) {
      for (const child of readdirSync(entry)) walk(join(entry, child))
    } else throw new GuestConfinementError('confined:nonregular-read-path', entry)
  }
  for (const root of roots.filter(path => !roots.some(other => other !== path && contains(other, path)))) walk(root)
}

/**
 * Prepare the fixed writable scratch root and render host-selected code reads.
 * No file under the activation home or implementation tree is writable.
 * @param {{root: string, paths: object, issuerKey: string}} options - Trusted launch selections.
 * @returns {{text: string, sha256: string, scratch: string, cwd: string, brokerSocket: string, issuerSocket: string, issuerKey: string, stateDir: string, profileDir: string}} policy and probe targets.
 */
export function prepareGuestConfinement({ root, paths, issuerKey }) {
  requireGuestConfinement(GUEST_CONFINEMENT_MODE)
  const scratch = join(paths.guestHome, 'confined-scratch')
  mkdirSync(scratch, { recursive: true, mode: 0o700 })
  const scratchState = lstatSync(scratch)
  if (!scratchState.isDirectory() || scratchState.isSymbolicLink()
    || scratchState.uid !== process.geteuid() || (scratchState.mode & 0o777) !== 0o700) {
    throw new GuestConfinementError('confined:scratch-unavailable', scratch)
  }
  const profileDir = canonical(join(paths.activationHome, 'profiles', '8088-inside-out'))
  const command = canonical(process.execPath)
  const codeRoots = [
    join(root, 'aukora'), join(root, 'apps', 'cli', 'lib'), join(root, 'apps', 'cli', 'node_modules'),
    join(root, 'node_modules'), join(root, 'packages'), join(root, 'vendor'),
    profileDir, join(paths.activationHome, 'profiles', 'node_modules'),
  ].map(canonical)
  const key = canonical(issuerKey)
  const stateDir = canonical(paths.stateDir)
  if (lstatSync(key).nlink !== 1) throw new GuestConfinementError('confined:hardlinked-private-key', key)
  for (const read of codeRoots) {
    if (overlaps(read, key) || overlaps(read, stateDir) || overlaps(read, canonical(scratch))) {
      throw new GuestConfinementError('confined:protected-path-granted', read)
    }
  }
  inspectReadClosure(unique(codeRoots), canonical(root), [key, stateDir, canonical(scratch)])
  const reads = unique([...codeRoots, ...SYSTEM_READS, command, canonical(scratch)])
  const exactReads = unique([canonical(root), canonical(join(root, 'package.json'))])
  const filters = reads.map(path => lstatSync(path).isDirectory() ? subpath(path) : literal(path))
  const metadata = unique([...reads, ...exactReads].flatMap(ancestors))
  const brokerSocket = join(canonical(dirname(paths.brokerSocket)), basename(paths.brokerSocket))
  const issuerSocket = join(canonical(dirname(paths.issuerSocket)), basename(paths.issuerSocket))
  const text = [
    '(version 1)', '(deny default)',
    `(allow process-exec ${literal(command)})`, '(deny process-fork)',
    `(allow sysctl-read (sysctl-name-regex #"^hw[.]") ${SYSCTLS.map(name => `(sysctl-name ${JSON.stringify(name)})`).join(' ')})`,
    `(allow file-read-data ${literal('/')} ${exactReads.map(literal).join(' ')} ${filters.join(' ')})`,
    `(allow file-read-metadata ${metadata.map(literal).join(' ')} ${filters.join(' ')})`,
    `(allow file-write* ${subpath(canonical(scratch))} ${literal('/dev/null')})`,
    `(deny file-read* ${literal(key)} ${subpath(stateDir)})`,
    `(deny file-write* ${literal(key)} ${subpath(stateDir)} ${subpath(canonical(paths.activationHome))})`,
    '(deny network*)',
    `(allow network-outbound (remote unix-socket ${literal(brokerSocket)}))`,
    '(deny mach-lookup)', '(deny mach-register)', '(deny ipc-posix-shm*)',
    '(deny process-info*)', '(deny signal)', '',
  ].join('\n')
  return Object.freeze({ text, sha256: createHash('sha256').update(text).digest('hex'),
    scratch: canonical(scratch), cwd: canonical(root), brokerSocket, issuerSocket,
    issuerKey: key, stateDir, profileDir })
}

/**
 * Launch plain Node with only standard pipes and its direct-parent IPC descriptor.
 * @param {object} policy - Prepared policy.
 * @param {readonly string[]} args - Trusted Node arguments.
 * @param {NodeJS.ProcessEnv} env - Closed environment selected by the supervisor.
 * @returns {import('node:child_process').ChildProcess} tracked child, with no fork permission.
 */
export function spawnConfinedGuest(policy, args, env) {
  return spawn(SANDBOX, ['-p', policy.text, '--', process.execPath, ...args], {
    cwd: policy.cwd, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
}

/**
 * Require actual kernel denial and successful scratch, broker, and parent IPC use.
 * The private test file is owned by this invocation and never replaces state.
 * @param {object} policy - Exact policy used by the subsequent guest.
 * @param {NodeJS.ProcessEnv} env - Exact guest environment.
 * @returns {Promise<void>} resolves only after the restricted probe exits successfully.
 */
export async function verifyGuestConfinement(policy, env) {
  const canary = join(policy.stateDir, `confinement-canary-${createHash('sha256').update(String(process.hrtime.bigint())).digest('hex')}`)
  writeFileSync(canary, 'host-private-canary', { mode: 0o600, flag: 'wx' })
  const probe = `
    const fs=require('node:fs'),cp=require('node:child_process'),net=require('node:net');
    const denied=fn=>{try{fn();return false}catch(e){return ['EPERM','EACCES'].includes(e.code)}};
    const connect=endpoint=>new Promise(resolve=>{const socket=net.connect(endpoint);socket.once('connect',()=>{socket.destroy();resolve('allowed')});socket.once('error',e=>resolve(e.code));socket.setTimeout(1500,()=>{socket.destroy();resolve('timeout')})});
    (async()=>{
      fs.writeFileSync(${JSON.stringify(join(policy.scratch, 'enforcement-positive'))},'allowed');
      const observations={
        read:denied(()=>fs.readFileSync(${JSON.stringify(policy.issuerKey)})),
        state:denied(()=>fs.readFileSync(${JSON.stringify(canary)})),
        write:denied(()=>fs.writeFileSync(${JSON.stringify(canary)},'escaped')),
        startup:denied(()=>fs.writeFileSync(${JSON.stringify(join(policy.profileDir, 'forbidden-startup'))},'escaped')),
        fork:['EPERM','EACCES'].includes(cp.spawnSync(process.execPath,['-e','']).error?.code),
        broker:await connect({path:${JSON.stringify(policy.brokerSocket)}}),
        issuer:await connect({path:${JSON.stringify(policy.issuerSocket)}}),
        network:await connect({host:'127.0.0.1',port:9})
      };
      process.send(observations,()=>process.disconnect());
    })().catch(()=>process.exit(2));`
  try {
    const child = spawnConfinedGuest(policy, ['-e', probe], env)
    let observation
    let stderr = ''
    child.stdout.resume()
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(0, 2048) })
    child.on('message', message => { observation = message })
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL') }, 8_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
    })
    if (result.code !== 0 || result.signal !== null || stderr !== ''
      || observation?.read !== true || observation?.state !== true || observation?.write !== true
      || observation?.startup !== true || observation?.fork !== true || observation?.broker !== 'allowed'
      || !['EPERM', 'EACCES'].includes(observation?.issuer)
      || !['EPERM', 'EACCES'].includes(observation?.network)
      || readFileSync(canary, 'utf8') !== 'host-private-canary') {
      throw new GuestConfinementError('confined:enforcement-unavailable',
        `exit=${String(result.code)} signal=${String(result.signal)} observed=${JSON.stringify(observation)} stderr=${stderr}`)
    }
  } finally {
    rmSync(canary)
  }
}
