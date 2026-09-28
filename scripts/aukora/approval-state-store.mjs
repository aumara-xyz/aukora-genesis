// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Genesis integration of the port in trusted-state-store.mjs. The one consumed-state path stays where it
 * already lives; only its retained high-water moves outside state/. The original journal and prepare
 * transaction remain the implementation. This file adds legacy-shape migration, an external witness and
 * fail-closed path/durability handling. Nothing imports the TypeScript reference at runtime.
 *
 * NOT ENFORCED: both files still belong to the same UID. A process rewriting state and witness together
 * defeats this comparison. The Airlock user holding the witness is the planned close. A software approval
 * key and this local store do not enforce GitHub main or prove who clicked.
 */
import { createHash } from 'node:crypto'
import {
  openSync, closeSync, writeSync, fsyncSync, fstatSync, fchmodSync,
  mkdirSync, renameSync, rmSync, realpathSync, constants as FS,
} from 'node:fs'
import {
  TrustedStateStore, STORE_SCHEMA_VERSION, WriterLockedError,
  TrustedStoreCorruptError, TrustedStoreUnsafePathError,
} from './trusted-state-store.mjs'
import { readBytesStrict, parseStrictText, StrictReadRefusal } from '../../plugins/aukora-kira/lib/strict-read.mjs'

const NOFOLLOW = FS.O_NOFOLLOW ?? 0
const DIRECTORY = FS.O_DIRECTORY ?? 0
const NONBLOCK = FS.O_NONBLOCK ?? 0
const WITNESS = 'kernel-high-water.json'
const WITNESS_TMP = 'kernel-high-water.tmp'
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const parentOf = path => path.slice(0, path.lastIndexOf('/')) || '/'
const leafOf = path => path.slice(path.lastIndexOf('/') + 1)
const childOf = (dir, name) => `${dir === '/' ? '' : dir}/${name}`

/** Inputs are absolute POSIX paths; only the same path normalization node:path.resolve would do is needed. */
function absolute(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) {
    throw new TrustedStoreUnsafePathError('trusted state and witness paths must be absolute POSIX paths')
  }
  const parts = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

/** Resolve existing ancestors without requiring the final directory/file to have been created yet. */
function canonicalPlace(path) {
  try { return realpathSync(path) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    if (path === '/') throw error
    return childOf(canonicalPlace(parentOf(path)), leafOf(path))
  }
}

/** A new directory's entry belongs to its parent; fsyncing only the child does not retain that entry. */
function syncParent(path) {
  const fd = openSync(canonicalPlace(parentOf(path)), FS.O_RDONLY | DIRECTORY | NOFOLLOW)
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

function writeAll(fd, text) {
  const bytes = Buffer.from(text)
  let offset = 0
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset)
    if (written === 0) throw new Error('kernel witness journal write made no progress')
    offset += written
  }
}

function readRegular(path, ownerOnly = false) {
  // The shared strict reader bounds bytes and decodes UTF-8 on the same no-follow, regular-file fd.
  return readBytesStrict(path, { validateStat(info) {
    if (!info.isFile() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
      throw Object.assign(new TrustedStoreUnsafePathError(`trusted store file is not an owner-held regular file: ${path}`), { path })
    }
    if (ownerOnly && (info.mode & 0o077) !== 0) {
      throw Object.assign(new TrustedStoreUnsafePathError(`kernel witness is not owner-only (0600 required): ${path}`), { path })
    }
  } }).text
}

function withRecovery(error, path, recovery) {
  if (!error.recoveryPath) {
    error.message = `${error.message} (${path})\nRecovery: ${recovery}`
    error.recoveryPath = path
  }
  return error
}

function lockHolder(path) {
  try {
    const raw = readRegular(path).trim()
    const pid = Number(raw)
    return /^\d+$/u.test(raw) && Number.isSafeInteger(pid) && pid > 0 ? pid : null
  } catch { return null }
}

function lockRecovery(error, path, holder = lockHolder(path)) {
  return withRecovery(error, path, holder === null
    ? `inspect ${path}; remove it only after confirming no writer or opener is running.`
    : `remove ${path} after confirming pid ${holder} is gone.`)
}

function witnessRecovery(error, path) {
  return withRecovery(error, path,
    `restore a verified owner-only witness at ${path}; reset it only if you intend to accept rollback.`)
}

/**
 * The original reclaim algorithm is retained, but serialized: two openers must never both observe a dead
 * pid and then unlink each other's newly acquired lock. An orphan .opening guard is deliberately NOT
 * reclaimed automatically; interrupted lock acquisition refuses until the owner reviews that guard.
 */
class SafeOpenStore extends TrustedStateStore {
  readNoFollow(path) { return readRegular(path) }
  pidAlive(pid) {
    try { process.kill(pid, 0); return true } catch (error) { return error?.code !== 'ESRCH' }
  }
  openProtectedDir() {
    if (this.dirFd !== null) { this.assertDir(); return }
    super.openProtectedDir()
  }
  open() {
    this.openProtectedDir()
    const guard = this.p(`${this.lockFile}.opening`)
    let guardFd
    try {
      this.assertDir()
      try { guardFd = openSync(guard, FS.O_CREAT | FS.O_EXCL | FS.O_WRONLY | NOFOLLOW, 0o600) }
      catch (error) {
        if (error?.code === 'EEXIST') {
          const holder = lockHolder(guard)
          const refusal = lockRecovery(new WriterLockedError('trusted store opener is active or interrupted'), guard, holder)
          refusal.retryable = holder === null || this.pidAlive(holder)
          throw refusal
        }
        throw lockRecovery(error, guard)
      }
      writeSync(guardFd, String(process.pid))
      fsyncSync(guardFd)
      try { super.open() } catch (error) { throw lockRecovery(error, error.path ?? this.p(this.lockFile)) }
    } catch (error) {
      throw lockRecovery(error, guard)
    } finally {
      if (guardFd !== undefined) {
        try { this.assertDir(); rmSync(guard) }
        catch (error) { throw lockRecovery(error, guard) }
        finally { closeSync(guardFd) }
      }
      if (!this.locked) this.releaseDirFd()
    }
  }
}

class WitnessStore extends SafeOpenStore {
  readNoFollow(path) {
    if (path !== this.p(WITNESS)) return readRegular(path)
    try { return readRegular(path, true) }
    catch (error) { throw witnessRecovery(error, path) }
  }
  openProtectedDir() {
    try { return super.openProtectedDir() }
    catch (error) { throw witnessRecovery(error, this.dir) }
  }
  assertDir() {
    try { return super.assertDir() }
    catch (error) { throw witnessRecovery(error, this.dir) }
  }
  protectedRead(fileName) {
    try { return super.protectedRead(fileName) }
    catch (error) { throw witnessRecovery(error, error.path ?? this.p(fileName)) }
  }
  open() {
    const deadline = performance.now() + 15_000
    const sleeper = new Int32Array(new SharedArrayBuffer(4))
    let delay = 10
    for (;;) {
      try { return super.open() } catch (error) {
        const remaining = deadline - performance.now()
        if (!(error instanceof WriterLockedError) || error.retryable === false || remaining <= 0) throw error
        Atomics.wait(sleeper, 0, 0, Math.min(delay, remaining))
        delay = Math.min(delay * 2, 250)
      }
    }
  }
}

export class MissingTrustedStateError extends Error {}
export class WitnessUnreadableError extends TrustedStoreCorruptError {}

/**
 * @param {{statePath:string,witnessDir:string,stateRoot?:string,createConsumedIds?:boolean,
 *   onMigration?:(message:string)=>void,decide?:Function,crashHook?:(label:string)=>void}} options
 */
export class ApprovalStateStore extends SafeOpenStore {
  constructor({ statePath, witnessDir, stateRoot, createConsumedIds = false, onMigration, decide, crashHook }) {
    const path = absolute(statePath)
    const name = leafOf(path)
    if (!name) throw new TrustedStoreUnsafePathError('trusted state path must name a file')
    let store
    super(parentOf(path), {
      stateFile: name, lockFile: `${name}.lock`, decide, crashHook, journalWrite: writeAll,
      highWater: { read: () => store.readWitnessCount(), write: count => store.writeWitnessCount(count) },
    })
    store = this
    this.statePath = path
    this.stateRoot = absolute(stateRoot ?? parentOf(path))
    this.witnessDir = absolute(witnessDir)
    this.createConsumedIds = createConsumedIds
    this.onMigration = onMigration
    this.witness = new WitnessStore(this.witnessDir)
    this.witnessRecord = null
    this.stateKey = null
    this.loadedAbsent = false
    this.assertWitnessOutside()
  }

  assertWitnessOutside() {
    const root = canonicalPlace(this.stateRoot)
    let witness
    try { witness = canonicalPlace(this.witnessDir) }
    catch (error) { throw witnessRecovery(error, error.path ?? this.witnessDir) }
    const stateDir = canonicalPlace(this.dir)
    if (!(stateDir === root || stateDir.startsWith(`${root === '/' ? '' : root}/`))) {
      throw new TrustedStoreUnsafePathError('trusted state file must be inside the named restore root')
    }
    if (witness === root || witness.startsWith(`${root === '/' ? '' : root}/`)) {
      throw withRecovery(new TrustedStoreUnsafePathError('kernel witness must be outside the state restore root'), this.witnessDir,
        `keep the witness at ${this.witnessDir} outside the restored state folder; choose a state root that does not contain it.`)
    }
  }

  /** Existing aura-code was created with the default umask; tighten only its verified owner-held inode. */
  provisionStateDir() {
    try { mkdirSync(this.dir, { mode: 0o700 }) } catch (error) { if (error?.code !== 'EEXIST') throw error }
    let fd
    try { fd = openSync(this.dir, FS.O_RDONLY | DIRECTORY | NOFOLLOW) } catch (error) {
      if (error?.code === 'ELOOP' || error?.code === 'ENOTDIR') throw new TrustedStoreUnsafePathError('trusted state directory is a symlink or not a directory')
      throw error
    }
    try {
      const info = fstatSync(fd)
      if (!info.isDirectory() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
        throw new TrustedStoreUnsafePathError('trusted state directory is not owned by this UID')
      }
      if ((info.mode & 0o777) !== 0o700) { fchmodSync(fd, 0o700); fsyncSync(fd) }
      syncParent(this.dir)
    } finally { closeSync(fd) }
  }

  open() {
    this.assertWitnessOutside()
    this.witness.open() // One witness writer across all state histories; always acquire this lock first.
    try {
      this.witness.assertDir()
      syncParent(this.witnessDir)
      this.provisionStateDir()
      super.open()
      this.assertWitnessOutside()
      this.stateKey = createHash('sha256').update(childOf(canonicalPlace(this.dir), this.stateFile)).digest('hex')
      this.witnessRecord = this.readWitnessRecord()
    } catch (error) { super.close(); this.witness.close(); throw error }
  }

  readWitnessRecord() {
    const path = this.witness.p(WITNESS)
    let record
    try {
      const text = this.witness.protectedRead(WITNESS)
      if (text === null) return { schema: 1, heads: {} }
      record = parseStrictText(text, path)
    } catch (error) {
      if (!(error instanceof StrictReadRefusal)) throw error
      throw witnessRecovery(Object.assign(new WitnessUnreadableError(error.message), { recoveryPath: error.recoveryPath }), path)
    }
    if (!record || typeof record !== 'object' || Array.isArray(record) || record.schema !== 1 ||
        Object.keys(record).sort().join(',') !== 'heads,schema' || !record.heads ||
        typeof record.heads !== 'object' || Array.isArray(record.heads) ||
        Object.entries(record.heads).some(([key, count]) => !/^[0-9a-f]{64}$/u.test(key) || !Number.isSafeInteger(count) || count < 0)) {
      throw witnessRecovery(new WitnessUnreadableError('kernel witness has an invalid schema or count'), path)
    }
    return record
  }

  readWitnessCount() {
    if (!this.witness.locked || !this.witnessRecord || !this.stateKey) throw new WriterLockedError('kernel witness is not opened and locked')
    return this.witnessRecord.heads[this.stateKey] ?? 0
  }

  writeWitnessCount(count) {
    const previous = this.readWitnessCount()
    if (!Number.isSafeInteger(count) || count < 0) throw witnessRecovery(new WitnessUnreadableError('kernel witness count is invalid'), this.witness.p(WITNESS))
    const record = { schema: 1, heads: { ...this.witnessRecord.heads, [this.stateKey]: Math.max(previous, count) } }
    const tmp = this.witness.p(WITNESS_TMP)
    let stepPath = tmp
    try {
      this.crash('witness-write')
      this.witness.assertDir()
      const fd = openSync(tmp, FS.O_CREAT | FS.O_WRONLY | FS.O_TRUNC | NOFOLLOW | NONBLOCK, 0o600)
      try {
        const info = fstatSync(fd)
        if (!info.isFile() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new TrustedStoreUnsafePathError('kernel witness journal is not an owner-held regular file')
        fchmodSync(fd, 0o600)
        writeAll(fd, JSON.stringify(record))
        this.crash('witness-fsync')
        fsyncSync(fd)
      } finally { closeSync(fd) }
      this.crash('witness-rename')
      this.witness.assertDir()
      renameSync(tmp, this.witness.p(WITNESS))
      this.crash('witness-dir-fsync')
      stepPath = this.witnessDir
      fsyncSync(this.witness.dirFd) // Required: a failed durability step can never return ALLOW.
      this.witnessRecord = record
    } catch (error) { throw witnessRecovery(error, error.path ?? stepPath) }
  }

  protectedRead(fileName) {
    const text = super.protectedRead(fileName)
    if (fileName !== this.stateFile) return text
    this.loadedAbsent = text === null
    if (text === null) return null
    const value = parseStrictText(text, this.statePath)
    if (value?.schema === 'aukora-trusted-state-v1' && !own(value, 'storeSchema')) {
      return JSON.stringify({ storeSchema: STORE_SCHEMA_VERSION, state: value, prepared: [] })
    }
    return text
  }

  load(genesis) {
    const record = super.load(genesis) // Includes rollback comparison, even when the state file is missing.
    if (this.loadedAbsent && !this.createConsumedIds) {
      throw new MissingTrustedStateError(`${this.statePath} does not exist; explicit creation is required`)
    }
    const first = !own(this.witnessRecord.heads, this.stateKey)
    const count = record.state.receiptHead.count
    if (first || count > this.readWitnessCount()) this.writeWitnessCount(count)
    if (first) this.onMigration?.(`MIGRATED kernel witness from current state (receipt count ${count}); same UID can rewrite both state and witness`)
    return record
  }

  close() {
    super.close()
    this.witness.close()
  }
}
