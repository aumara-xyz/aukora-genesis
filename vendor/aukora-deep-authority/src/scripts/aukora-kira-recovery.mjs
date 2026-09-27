#!/usr/bin/env node
/** Read-only lease observations; neither verifies retained memory nor authorizes lease removal. */
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_LEASE_BYTES = 4096
const fail = reason => { throw new Error(`kira-recovery:${reason}`) }

function unchanged(left, right) {
  return ['dev', 'ino', 'mode', 'uid', 'nlink', 'size', 'mtimeNs', 'ctimeNs']
    .every(key => left[key] === right[key])
}

function entry(path) {
  try { return lstatSync(path, { bigint: true }) }
  catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function directory(stateDir) {
  if (!isAbsolute(stateDir) || resolve(stateDir) !== stateDir) fail('canonical-state-required')
  const stat = entry(stateDir)
  if (stat === null) fail('state-directory-missing')
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('state-directory-required')
  if (realpathSync(stateDir) !== stateDir) fail('canonical-state-required')
  return stat
}

function readLease(path, expected) {
  if (!expected.isFile() || expected.nlink !== 1n) fail('regular-single-link-lease-required')
  if (expected.size === 0n || expected.size > BigInt(MAX_LEASE_BYTES)) fail('lease-size-invalid')
  if (!constants.O_NOFOLLOW) fail('no-follow-unavailable')
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!unchanged(expected, fstatSync(descriptor, { bigint: true }))) fail('observation-changed')
    const bytes = Buffer.alloc(Number(expected.size))
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count === 0) fail('observation-changed')
      offset += count
    }
    if (readSync(descriptor, Buffer.alloc(1), 0, 1, offset) !== 0
      || !unchanged(expected, fstatSync(descriptor, { bigint: true }))) fail('observation-changed')
    return bytes
  } finally { closeSync(descriptor) }
}

function parseLease(bytes) {
  let value
  try { value = JSON.parse(bytes.toString('utf8')) }
  catch { fail('lease-malformed') }
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'pid,startedAt'
    || !Number.isSafeInteger(value.pid) || value.pid <= 0 || value.pid > 2 ** 31 - 1
    || !Number.isSafeInteger(value.startedAt) || value.startedAt < 0
    || bytes.toString('utf8') !== `${JSON.stringify({ pid: value.pid, startedAt: value.startedAt })}\n`) {
    fail('lease-malformed')
  }
  return value
}

function observePid(pid) {
  try { process.kill(pid, 0); return { status: 'occupied', reason: 'pid-exists-identity-unverified' } }
  catch (error) {
    if (error?.code === 'ESRCH') return { status: 'not-observed', reason: 'pid-not-observed' }
    return { status: 'undetermined', reason: error?.code === 'EPERM' ? 'pid-probe-denied' : 'pid-probe-failed' }
  }
}

/**
 * Inspect only the existing writer lease and a signal-zero PID observation.
 * Never creates, removes or rewrites files; PID absence does not prove a safe release.
 * @param {string} stateDir - exact canonical absolute broker state directory.
 * @returns {object} bounded observations; undetermined results retain no lease fields.
 */
export function inspectKiraRecovery(stateDir) {
  const report = { schema: 'aukora:kira-recovery-inspection:v1', stateDir,
    observationClass: 'SAME_UID_ADVISORY / NOT_RELEASE_AUTHORITY',
    storeVerified: false, releaseAllowed: false, lease: null, process: null,
    status: 'undetermined', reason: 'kira-recovery:inspection-unavailable' }
  try {
    const root = directory(stateDir)
    const path = join(stateDir, '.broker-active.lock')
    const stat = entry(path)
    if (stat === null) {
      if (!unchanged(root, directory(stateDir)) || entry(path) !== null) fail('observation-changed')
      return { ...report, status: 'lease-absent', reason: 'kira-recovery:no-lease-observed' }
    }
    const bytes = readLease(path, stat)
    const record = parseLease(bytes)
    const observation = observePid(record.pid)
    const after = entry(path)
    if (after === null || !unchanged(stat, after) || !unchanged(root, directory(stateDir))
      || !bytes.equals(readLease(path, after))) fail('observation-changed')
    if (observation.status === 'undetermined') fail(observation.reason)
    return { ...report, status: observation.status === 'occupied' ? 'pid-present' : 'pid-not-observed',
      reason: observation.status === 'occupied' ? 'kira-recovery:pid-exists-identity-unverified'
        : 'kira-recovery:operator-recovery-required',
      lease: { ...record, sha256: createHash('sha256').update(bytes).digest('hex'),
        dev: String(stat.dev), ino: String(stat.ino) },
      process: { ...observation, identity: 'unverified' } }
  } catch (error) {
    const reason = typeof error?.message === 'string' && error.message.startsWith('kira-recovery:')
      ? error.message : `kira-recovery:inspection-${['ENOENT', 'EACCES', 'EPERM', 'ELOOP'].includes(error?.code)
        ? error.code.toLowerCase() : 'unavailable'}`
    return { ...report, reason }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--state-dir' || !isAbsolute(args[1])) {
    process.stderr.write('usage: node scripts/aukora-kira-recovery.mjs --state-dir CANONICAL_ABSOLUTE_STATE\n')
    process.exitCode = 2
  } else {
    const report = inspectKiraRecovery(args[1])
    process.stdout.write(`${JSON.stringify(report)}\n`)
    process.exitCode = report.status === 'undetermined' ? 2 : 0
  }
}
