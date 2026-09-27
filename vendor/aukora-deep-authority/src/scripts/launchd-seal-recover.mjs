/**
 * Offline operator recovery of a device-only seal mismatch. No boot path calls
 * this module. Rebinding is an operator decision, not proof of historical volume
 * identity. The original seal and decision are retained outside broker custody.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync, constants, fchmodSync, fchownSync, fstatSync, fsyncSync, lstatSync,
  mkdtempSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { isAbsolute, join, resolve, relative } from 'node:path'
import { acquireStateLease } from '../aukora/broker/broker.mjs'

const SEAL = 'confinement.seal'
const KEYS = 'class,euid,platform,sealedAt,stateDev,stateIno,stateMode,stateUid'
const fail = reason => { throw new Error(`seal-recovery:${reason}`) }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function directory(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path
    || realpathSync(path) !== path) fail('canonical-directory-required')
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('directory-required')
  return { uid: stat.uid, gid: stat.gid, dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o7777 }
}

function identity(stat) {
  return { uid: stat.uid, gid: stat.gid, dev: stat.dev, ino: stat.ino,
    mode: stat.mode & 0o7777, nlink: stat.nlink, size: stat.size,
    mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }
}

function readSeal(stateDir) {
  const path = join(stateDir, SEAL)
  const before = lstatSync(path)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
    || before.size < 1 || before.size > 4096 || (before.mode & 0o7777) !== 0o400) {
    fail('private-single-link-seal-required')
  }
  if (!constants.O_NOFOLLOW) fail('no-follow-unavailable')
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!same(identity(before), identity(fstatSync(fd)))) fail('seal-changed')
    const buffer = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, length)
      if (count === 0) break
      length += count
    }
    const bytes = buffer.subarray(0, length)
    if (!same(identity(before), identity(fstatSync(fd)))
      || !same(identity(before), identity(lstatSync(path))) || bytes.length !== before.size) fail('seal-changed')
    let seal
    try { seal = JSON.parse(bytes.toString('utf8')) }
    catch { fail('seal-malformed') }
    if (seal === null || typeof seal !== 'object' || Array.isArray(seal)
      || Object.keys(seal).sort().join(',') !== KEYS
      || !['state-owned', 'peer-separated'].includes(seal.class)
      || seal.platform !== process.platform || typeof seal.sealedAt !== 'string'
      || !Number.isFinite(Date.parse(seal.sealedAt))) fail('seal-malformed')
    return { bytes, seal, sealFile: identity(before) }
  } finally { closeSync(fd) }
}

/**
 * Read and pin one device-only mismatch without changing files or granting permission.
 * @param {string} stateDir - canonical existing broker directory.
 * @param {{uid: number, ino: number, fromDev: number, toDev: number}} expected - exact operator-supplied metadata.
 * @returns {object} serializable metadata and seal hashes to bind an attended decision.
 */
export function inspectSealRecovery(stateDir, expected) {
  if (expected === null || typeof expected !== 'object'
    || Object.keys(expected).sort().join(',') !== 'fromDev,ino,toDev,uid'
    || !Object.values(expected).every(value => Number.isSafeInteger(value) && value > 0)
    || expected.fromDev === expected.toDev) fail('expected-metadata-required')
  const current = directory(stateDir)
  if (current.uid !== expected.uid || current.ino !== expected.ino || current.dev !== expected.toDev
    || current.mode !== 0o700) fail('directory-mismatch')
  const { bytes, seal, sealFile } = readSeal(stateDir)
  if (seal.stateUid !== expected.uid || seal.euid !== expected.uid || seal.stateIno !== expected.ino
    || seal.stateDev !== expected.fromDev || seal.stateMode !== '0700'
    || sealFile.uid !== current.uid || sealFile.gid !== current.gid) fail('seal-mismatch')
  const next = Buffer.from(`${JSON.stringify({ ...seal, stateDev: current.dev })}\n`)
  return { stateDir, expected: { uid: expected.uid, ino: expected.ino, fromDev: expected.fromDev, toDev: expected.toDev },
    current, sealFile, seal, sealSha256: sha256(bytes), nextSealSha256: sha256(next),
    historicalVolumeIdentity: 'unverified', storeVerified: false }
}

function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

function exclusiveFile(path, bytes, uid, gid) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400)
  try {
    fchownSync(fd, uid, gid)
    fchmodSync(fd, 0o400)
    writeFileSync(fd, bytes)
    fsyncSync(fd)
    return identity(fstatSync(fd))
  } finally { closeSync(fd) }
}

function revalidate(inspection) {
  if (!same(inspectSealRecovery(inspection.stateDir, inspection.expected), inspection)) fail('inspection-stale')
}

/**
 * Replace only stateDev after an external operator decision and stopped-writer check.
 * The caller supplies operator authorization and managed-writer quiescence;
 * importing this service supplies neither. An existing writer lease always refuses. Publication
 * uncertainty retains the recovery lease and backup, without rollback or restart.
 * A retained-state check failure after verified publication reports `published`
 * and keeps the recovery lease; it does not verify the retained state.
 * A lease-release failure after verified publication reports recovery separately;
 * the lease may already be absent, and the CLI must keep the service stopped.
 * @param {object} options
 * @param {ReturnType<typeof inspectSealRecovery>} options.inspection - exact approved observation.
 * @param {string} options.backupDir - existing private directory owned by the recovery process, outside state.
 * @param {() => void} options.assertStopped - synchronous check that the caller's managed writer remains stopped.
 * @param {() => void} [options.beforeRelease] - synchronous retained-state check under the recovery lease; failure retains the lease.
 * @returns {object} confirmed replacement and retained backup location, not broker health or verified memory.
 */
export function recoverSealDevice({ inspection, backupDir, assertStopped, beforeRelease }) {
  if (typeof assertStopped !== 'function') fail('stopped-check-required')
  assertStopped()
  revalidate(inspection)
  const actorUid = process.geteuid()
  if (actorUid !== 0 && actorUid !== inspection.current.uid) fail('operator-uid-required')
  const backupParent = directory(backupDir)
  const within = relative(inspection.stateDir, backupDir)
  if (backupParent.uid !== actorUid || backupParent.mode !== 0o700
    || within === '' || (!within.startsWith('../') && !isAbsolute(within))) fail('private-external-backup-required')
  const release = acquireStateLease(inspection.stateDir)
  const lockPath = join(inspection.stateDir, '.broker-active.lock')
  const lock = identity(lstatSync(lockPath))
  let temporary
  let temporaryIdentity
  let publicationAttempted = false
  let publicationVerified = false
  let completed = false
  let archive
  try {
    assertStopped()
    revalidate(inspection)
    if (!same(directory(backupDir), backupParent)) fail('backup-directory-changed')
    archive = realpathSync(mkdtempSync(join(backupDir, 'seal-')))
    const before = readSeal(inspection.stateDir).bytes
    if (sha256(before) !== inspection.sealSha256) fail('inspection-stale')
    const after = Buffer.from(`${JSON.stringify({ ...inspection.seal, stateDev: inspection.current.dev })}\n`)
    if (sha256(after) !== inspection.nextSealSha256) fail('inspection-stale')
    exclusiveFile(join(archive, 'before.seal'), before, actorUid, process.getegid())
    exclusiveFile(join(archive, 'after.seal'), after, actorUid, process.getegid())
    exclusiveFile(join(archive, 'decision.json'), `${JSON.stringify({
      schema: 'aukora:operator-seal-recovery:v1', actorUid, recordedAt: new Date().toISOString(),
      decision: 'operator-authorized-device-rebind', historicalVolumeIdentity: 'unverified',
      stateDir: inspection.stateDir, expected: inspection.expected, sealClass: inspection.seal.class,
      beforeSha256: sha256(before), afterSha256: sha256(after),
    })}\n`, actorUid, process.getegid())
    syncDirectory(archive)
    syncDirectory(backupDir)
    temporary = join(inspection.stateDir, `.confinement.seal.recover-${randomBytes(12).toString('hex')}`)
    temporaryIdentity = exclusiveFile(temporary, after, inspection.current.uid, inspection.current.gid)
    assertStopped()
    revalidate(inspection)
    if (!same(identity(lstatSync(lockPath)), lock)) fail('recovery-lease-changed')
    if (!same(identity(lstatSync(temporary)), temporaryIdentity)) fail('replacement-changed')
    publicationAttempted = true
    renameSync(temporary, join(inspection.stateDir, SEAL))
    temporary = undefined
    syncDirectory(inspection.stateDir)
    const readback = readSeal(inspection.stateDir)
    if (sha256(readback.bytes) !== inspection.nextSealSha256
      || !same(directory(inspection.stateDir), inspection.current)
      || readback.sealFile.uid !== inspection.current.uid || readback.sealFile.gid !== inspection.current.gid) {
      fail('readback-mismatch')
    }
    publicationVerified = true
    beforeRelease?.()
    completed = true
    return { status: 'seal-recovered', stateDir: inspection.stateDir, backupDir: archive,
      previousSealSha256: inspection.sealSha256, sealSha256: inspection.nextSealSha256,
      historicalVolumeIdentity: 'unverified', storeVerified: false }
  } catch (error) {
    if (publicationVerified) {
      const refusal = new Error('seal-recovery:post-publication-check-failed', { cause: error })
      refusal.sealRecovery = 'published'
      refusal.backupDir = archive
      throw refusal
    }
    if (publicationAttempted) {
      const refusal = new Error('seal-recovery:publication-indeterminate', { cause: error })
      refusal.sealRecovery = 'indeterminate'
      refusal.backupDir = archive
      throw refusal
    }
    throw error
  } finally {
    if (!publicationAttempted || completed) {
      if (temporary !== undefined && temporaryIdentity !== undefined) {
        if (!same(identity(lstatSync(temporary)), temporaryIdentity)) fail('replacement-changed')
        unlinkSync(temporary)
      }
      try {
        if (!same(identity(lstatSync(lockPath)), lock)) fail('recovery-lease-changed')
        release()
      } catch (error) {
        const refusal = new Error('seal-recovery:lease-release-indeterminate', { cause: error })
        refusal.sealRecovery = completed ? 'recovered' : 'not-applied'
        refusal.backupDir = archive
        throw refusal
      }
    }
  }
}
