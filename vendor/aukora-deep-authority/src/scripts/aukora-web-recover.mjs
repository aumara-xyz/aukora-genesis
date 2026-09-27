/** Offline developer-store recovery. No boot path imports this module; no services or activation are changed. */
import { createHash } from 'node:crypto'
import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  mkdtempSync, openSync, readSync, readdirSync, realpathSync, renameSync, writeFileSync,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { readVerifiedChain, compareObjectInventory } from '../aukora/aura/record.mjs'
import { inspectSealRecovery, recoverSealDevice } from './launchd-seal-recover.mjs'
import { inspectKiraRecovery } from './aukora-kira-recovery.mjs'

const LEASE = '.broker-active.lock'
const SEAL = 'confinement.seal'
const MAX_ENTRIES = 8192
const MAX_BYTES = 128 * 1024 * 1024
const fail = reason => { throw new Error(`web-recovery:${reason}`) }
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

function identity(stat) {
  return { uid: String(stat.uid), gid: String(stat.gid), dev: String(stat.dev), ino: String(stat.ino),
    mode: String(stat.mode), nlink: String(stat.nlink), size: String(stat.size),
    mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) }
}

function privateDirectory(path) {
  if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path) fail('canonical-directory-required')
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.uid !== process.geteuid() || (stat.mode & 0o7777) !== 0o700) fail('private-directory-required')
  return { uid: stat.uid, gid: stat.gid, dev: stat.dev, ino: stat.ino, mode: stat.mode }
}

function readBounded(path, limit) {
  const stat = lstatSync(path, { bigint: true })
  if (!stat.isFile() || stat.nlink !== 1n || stat.uid !== BigInt(process.geteuid())
    || (stat.mode & 0o7077n) !== 0n) fail('private-single-link-file-required')
  if (stat.size > BigInt(limit)) fail('store-too-large')
  if (!constants.O_NOFOLLOW) fail('no-follow-unavailable')
  const id = identity(stat)
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!same(id, identity(fstatSync(fd, { bigint: true })))) fail('store-changed')
    const bytes = Buffer.alloc(Number(stat.size) + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length)
      if (!count) break
      length += count
    }
    if (length !== Number(stat.size) || !same(id, identity(fstatSync(fd, { bigint: true })))
      || !same(id, identity(lstatSync(path, { bigint: true })))) fail('store-changed')
    return { id, bytes: bytes.subarray(0, length) }
  } finally { closeSync(fd) }
}

function inventory(stateDir, skipMutable = false) {
  const rows = []
  let total = 0
  const visit = path => {
    if (rows.length >= MAX_ENTRIES) fail('store-too-large')
    const full = join(stateDir, path)
    const stat = lstatSync(full)
    if (stat.isDirectory()) {
      rows.push({ path, kind: 'directory', ...privateDirectory(full) })
      for (const name of readdirSync(full).sort()) {
        if (path === '' && skipMutable && [LEASE, SEAL].includes(name)) continue
        if (!(path === '' && name === LEASE) && (name.endsWith('.lock') || name.includes('.staging-')
          || name.startsWith('.nonce-candidate-') || name.startsWith('.activation-upgrade-')
          || name.startsWith('.confinement.seal.recover-'))) fail('unresolved-residue')
        visit(path ? `${path}/${name}` : name)
      }
    } else {
      const { id, bytes } = readBounded(full, MAX_BYTES - total)
      total += bytes.length
      rows.push({ path, kind: 'file', ...id, sha256: digest(bytes) })
    }
  }
  visit('')
  return rows
}

function assertDead(pid) {
  try { process.kill(pid, 0) }
  catch (error) {
    if (error?.code === 'ESRCH') return
    fail('writer-state-undetermined')
  }
  fail('writer-alive')
}

function staleLease(stateDir) {
  const observed = inspectKiraRecovery(stateDir)
  if (observed.status === 'pid-present') fail('writer-alive')
  if (observed.status !== 'pid-not-observed' || observed.lease === null) fail('writer-state-undetermined')
  const { id, bytes } = readBounded(join(stateDir, LEASE), 1024)
  if ((Number(id.mode) & 0o7777) !== 0o600) fail('lease-mode-invalid')
  if (digest(bytes) !== observed.lease.sha256 || id.dev !== observed.lease.dev || id.ino !== observed.lease.ino) fail('lease-changed')
  return { pid: observed.lease.pid, startedAt: observed.lease.startedAt, identity: id, sha256: observed.lease.sha256 }
}

function history(stateDir, expectedHead) {
  const chain = readVerifiedChain(join(stateDir, 'aura.jsonl'))
  if (!chain.ok || chain.count === 0 || chain.lastChainHash !== expectedHead) fail('history-head-mismatch')
  const sequence = readBounded(join(stateDir, 'seq'), 32).bytes.toString('utf8')
  if (sequence !== String(chain.count) || chain.entries.some((entry, index) => entry.sequence !== index + 1)) fail('sequence-mismatch')
  if (!compareObjectInventory(stateDir, chain.entries).ok) fail('objects-unverified')
  return { head: chain.lastChainHash, entries: chain.count }
}

/**
 * Pin a populated developer store, dead writer lease and device-only seal mismatch without writes.
 * Hash verification does not verify issuer signatures or historical volume identity.
 * @param {{dataDir: string, expectedHead: string}} options - canonical data root and operator's prior Aura head.
 * @returns {object} exact observation to display before terminal confirmation; no key or record contents.
 */
export function inspectWebRecovery({ dataDir, expectedHead }) {
  if (typeof process.geteuid !== 'function' || process.geteuid() === 0) fail('developer-owner-required')
  if (typeof expectedHead !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedHead)) fail('expected-head-required')
  const dataIdentity = privateDirectory(dataDir)
  const stateDir = join(dataDir, 'broker-state')
  const current = privateDirectory(stateDir)
  const lease = staleLease(stateDir)
  const rows = inventory(stateDir)
  const { bytes: sealBytes } = readBounded(join(stateDir, SEAL), 4096)
  let seal
  try { seal = JSON.parse(sealBytes.toString('utf8')) }
  catch { fail('seal-malformed') }
  if (seal === null || typeof seal !== 'object' || Array.isArray(seal)) fail('seal-malformed')
  const inspection = inspectSealRecovery(stateDir, {
    uid: current.uid, ino: current.ino, fromDev: seal.stateDev, toDev: current.dev,
  })
  const retained = history(stateDir, expectedHead)
  for (const required of ['activation.json', 'keys/broker.json']) {
    if (!rows.some(row => row.path === required && row.kind === 'file')) fail('retained-state-incomplete')
  }
  if (!same(rows, inventory(stateDir)) || !same(lease, staleLease(stateDir))) fail('store-changed')
  return { dataDir, dataIdentity, stateDir, expectedHead, inspection, lease, retained, rows,
    historicalVolumeIdentity: 'unverified', issuerSignaturesVerified: false, brokerStarted: false }
}

function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

function writeExclusive(path, bytes, mode = 0o400) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode)
  try { fchmodSync(fd, mode); writeFileSync(fd, bytes); fsyncSync(fd) }
  finally { closeSync(fd) }
  if (!readBounded(path, MAX_BYTES).bytes.equals(Buffer.from(bytes))) fail('backup-readback-mismatch')
}

/**
 * Back up all retained files, archive a proven-dead lease, and replace only the seal's device number.
 * The caller owns terminal authorization. This function grants no protected human-presence proof.
 * Backups include private keys; failures retain backups and report whether the old lease was archived.
 * No automatic rollback, activation upgrade, service launch, or socket removal occurs.
 * @param {ReturnType<typeof inspectWebRecovery>} plan - exact approved preflight observation.
 * @returns {object} offline recovery measurements, not live recall or broker health.
 */
export function recoverWebStore(plan) {
  let archive
  let leaseArchived = false
  try {
    if (!same(plan, inspectWebRecovery(plan))) fail('inspection-stale')
    const parent = join(plan.dataDir, 'recovery')
    try { mkdirSync(parent, { mode: 0o700 }) }
    catch (error) { if (error?.code !== 'EEXIST') throw error }
    const parentIdentity = privateDirectory(parent)
    if (parentIdentity.dev !== plan.inspection.current.dev) fail('backup-filesystem-mismatch')
    archive = realpathSync(mkdtempSync(join(parent, 'web-store-')))
    const copied = join(archive, 'state')
    for (const row of plan.rows) {
      const destination = join(copied, row.path)
      if (row.kind === 'directory') mkdirSync(destination, { mode: 0o700 })
      else {
        const file = readBounded(join(plan.stateDir, row.path), MAX_BYTES)
        if (digest(file.bytes) !== row.sha256) fail('store-changed')
        writeExclusive(destination, file.bytes, Number(row.mode) & 0o777)
      }
    }
    writeExclusive(join(archive, 'decision.json'), `${JSON.stringify({
      schema: 'aukora:developer-store-recovery:v1', actorUid: process.geteuid(),
      recordedAt: new Date().toISOString(), plan, backupContainsPrivateKeys: true,
    })}\n`)
    for (const row of [...plan.rows].reverse()) {
      if (row.kind === 'directory') syncDirectory(join(copied, row.path))
    }
    syncDirectory(archive)
    syncDirectory(parent)
    syncDirectory(plan.dataDir)
    if (!same(plan, inspectWebRecovery(plan)) || !same(parentIdentity, privateDirectory(parent))) fail('inspection-stale')
    const archivedLease = join(archive, 'stale-writer.lock')
    renameSync(join(plan.stateDir, LEASE), archivedLease)
    leaseArchived = true
    const oldLease = readBounded(archivedLease, 1024)
    // Renaming changes ctime; the archived inode and bytes must still be the approved lease.
    if (oldLease.id.ino !== plan.lease.identity.ino || oldLease.id.dev !== plan.lease.identity.dev
      || digest(oldLease.bytes) !== plan.lease.sha256) fail('archived-lease-mismatch')
    syncDirectory(archive)
    syncDirectory(plan.stateDir)
    const retainedRows = plan.rows.filter(row => ![LEASE, SEAL].includes(row.path))
    const assertRetained = () => {
      if (!same(inventory(plan.stateDir, true), retainedRows)) fail('retained-state-changed')
    }
    assertRetained()
    const result = recoverSealDevice({ inspection: plan.inspection, backupDir: archive,
      assertStopped: () => assertDead(plan.lease.pid),
      beforeRelease: () => {
        assertRetained()
        if (!same(history(plan.stateDir, plan.expectedHead), plan.retained)) fail('history-changed')
      },
    })
    return { status: 'WEB_STORE_RECOVERED', backupDir: archive, sealBackupDir: result.backupDir,
      sealSha256: result.sealSha256, leaseArchived, retained: plan.retained,
      activationUnchanged: true, brokerStarted: false, liveRecall: false,
      historicalVolumeIdentity: 'unverified', issuerSignaturesVerified: false }
  } catch (cause) {
    const error = new Error(`web-recovery:failed:${cause.message}`, { cause })
    error.backupDir = archive
    error.leaseArchived = leaseArchived
    error.sealRecovery = cause.sealRecovery ?? 'not-applied'
    throw error
  }
}
