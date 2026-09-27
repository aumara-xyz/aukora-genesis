/**
 * The memory.put executor, observation reader, and derived key-index rebuild.
 *
 * Memory objects are content-addressed; the broker's shared settlement path
 * records their observations alongside other named effects. A receipt does
 * not prove this invocation created an object that already existed with
 * identical bytes.
 *
 * @module @aukora/broker/effect
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync, constants, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync,
  rmSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { compareObjectInventory, readVerifiedChain } from '../aura/record.mjs'
import { effectBody } from './effect-body.mjs'
import { isExactMemoryPutArgs, KEY_SHAPE } from './memory-put-args.mjs'
import { selectMemoryEntries } from './memory-entries.mjs'

export { definitionDigest, MEMORY_PUT, MEMORY_PUT_DEFINITION } from './effect-definition.mjs'

/**
 * Perform the write and report what is true afterwards.
 *
 * The broker API publishes the value as a content-addressed object and never
 * overwrites a valid object; the key projection is a pointer that is atomically
 * replaced. A later value for the same key therefore leaves earlier objects in
 * place during ordinary API use. This is not filesystem immutability against
 * the state-owning UID.
 *
 * @param {string} stateDir - the broker's own directory.
 * @param {{key: string, value: unknown}} args - the call, exactly as the grant bound it.
 * @returns {{path: string, bytes: number, contentSha256: string, inode: number, mtimeNs: string}}
 *   post-dispatch evidence over the object. An idempotent object may pre-exist.
 * @throws {Error} when the arguments are not exact or the key is not a name.
 */
export function memoryPut(stateDir, args) {
  if (!isExactMemoryPutArgs(args)) throw new TypeError('memory.put:arguments-not-exact')
  const { key } = args
  if (typeof key !== 'string' || !KEY_SHAPE.test(key)) {
    // Rejected at the executor, not sanitised: a key that is not a name is a
    // caller trying to choose a path, and the answer is no, not a rewrite.
    throw new Error(`memory.put: key is not a name: ${JSON.stringify(key)}`)
  }
  const body = effectBody(args)
  const contentSha256 = createHash('sha256').update(body).digest('hex')
  const memoryDir = join(stateDir, 'memory')
  const objectsDir = join(stateDir, 'memory', 'objects')
  ensureDirectory(memoryDir)
  ensureDirectory(objectsDir)
  const path = join(objectsDir, `${contentSha256}.json`)
  const objectState = inspectEntry(path)
  if (!objectState.present) {
    const staging = `${path}.staging-${process.pid}-${randomBytes(12).toString('hex')}`
    let descriptor
    try {
      descriptor = openSync(staging, 'wx', 0o600)
      writeFileSync(descriptor, body, 'utf8')
      closeSync(descriptor)
      descriptor = undefined
      try {
        // Publish without replacing an entry that appeared concurrently. A
        // loser verifies the winner below; it never overwrites it.
        linkSync(staging, path)
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
      try { unlinkSync(staging) } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
  }
  verifyObject(path, body, contentSha256)
  const keysDir = join(stateDir, 'memory', 'keys')
  ensureDirectory(keysDir)
  const projectionPath = join(keysDir, `${key}.json`)
  const pointer = `${JSON.stringify({ key, contentSha256 })}\n`
  const pointerStaging = `${projectionPath}.staging-${process.pid}-${randomBytes(12).toString('hex')}`
  let projectionDescriptor
  try {
    projectionDescriptor = openSync(pointerStaging, 'wx', 0o600)
    writeFileSync(projectionDescriptor, pointer, 'utf8')
    closeSync(projectionDescriptor)
    projectionDescriptor = undefined
    renameSync(pointerStaging, projectionPath)
  } finally {
    if (projectionDescriptor !== undefined) closeSync(projectionDescriptor)
    try { unlinkSync(pointerStaging) } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  const stat = lstatSync(path, { bigint: true })
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('memory.put: object path is not a regular file')
  return {
    path,
    bytes: Buffer.byteLength(body, 'utf8'),
    contentSha256,
    inode: Number(stat.ino),
    mtimeNs: String(stat.mtimeNs),
  }
}

/** Create or validate one broker-owned directory without following a symbolic link. */
function ensureDirectory(path) {
  const before = inspectEntry(path)
  if (!before.present) mkdirSync(path, { mode: 0o700 })
  const after = inspectEntry(path)
  if (!after.present || !after.stat.isDirectory() || after.stat.isSymbolicLink()) {
    throw new Error('memory.put: state path is not a directory')
  }
}

/** Observe an entry without converting a dangling link or I/O failure into absence. */
function inspectEntry(path) {
  try {
    return { present: true, stat: lstatSync(path) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { present: false, stat: null }
    throw new Error('memory.put: state path is unavailable')
  }
}

/** Require a digest-named object to be one regular file containing the exact body. */
function verifyObject(path, body, contentSha256) {
  const state = inspectEntry(path)
  if (!state.present || !state.stat.isFile() || state.stat.isSymbolicLink()) {
    throw new Error('memory.put: object path is not a regular file')
  }
  const existing = readFileSync(path)
  const actual = createHash('sha256').update(existing).digest('hex')
  if (actual !== contentSha256 || existing.toString('utf8') !== body) {
    throw new Error('memory.put: object content does not match its digest name')
  }
}

/**
 * Rebuild memory key projections from the record. Before changing the derived
 * index, verify the complete Aura chain, validate its effect identities, and compare
 * objects/ with its memory entries in both directions. An unexplained directory entry, a missing recorded object,
 * or an unavailable object directory refuses before keys/ changes. Then delete
 * keys/ and replay the chain's entries newest-last so the latest entry per key
 * wins. A preflight refusal leaves the existing projection untouched.
 *
 * @param {string} stateDir - the broker's own directory.
 * @returns {{ok: true, projections: number} | {ok: false, reason: string}}
 */
export function rebuildIndex(stateDir) {
  const chainFile = join(stateDir, 'aura.jsonl')
  const chain = readVerifiedChain(chainFile)
  if (!chain.ok) return { ok: false, reason: `rebuild: aura invalid (${chain.reason})` }
  const selected = selectMemoryEntries(chain.entries)
  if (!selected.ok) return { ok: false, reason: `rebuild: ${selected.reason}` }
  const entries = selected.entries
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, reason: `rebuild: malformed entry at index ${index + 1}` }
    }
    if (typeof entry.key !== 'string' || !KEY_SHAPE.test(entry.key)) {
      return { ok: false, reason: `rebuild: entry key is not a name at index ${index + 1}: ${JSON.stringify(entry.key)}` }
    }
  }
  const inventory = compareObjectInventory(stateDir, entries)
  if (!inventory.ok) {
    return { ok: false, reason: `rebuild: ${inventory.reason}` }
  }
  const keysDir = join(stateDir, 'memory', 'keys')
  rmSync(keysDir, { recursive: true, force: true })
  mkdirSync(keysDir, { recursive: true, mode: 0o700 })
  let projections = 0
  for (const entry of entries) {
    writeFileSync(join(keysDir, `${entry.key}.json`), `${JSON.stringify({ key: entry.key, contentSha256: entry.contentSha256 })}\n`, { encoding: 'utf8', mode: 0o600 })
    projections++
  }
  return { ok: true, projections }
}

/**
 * Re-observe a written file without confusing absence with unreadable or wrong-type state.
 *
 * @param {string} path - the file the receipt names.
 * @returns {{status: 'observed', bytes: number, contentSha256: string, inode: number, mtimeNs: string}
 *   | {status: 'absent'} | {status: 'unobservable'}} one discriminated observation.
 */
export function observe(path) {
  let descriptor
  let stat
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  } catch (error) {
    return { status: error?.code === 'ENOENT' ? 'absent' : 'unobservable' }
  }
  try {
    stat = fstatSync(descriptor, { bigint: true })
    if (!stat.isFile()) return { status: 'unobservable' }
    const body = readFileSyncBound(descriptor)
    return {
      status: 'observed',
      bytes: body.length,
      contentSha256: createHash('sha256').update(body).digest('hex'),
      inode: Number(stat.ino),
      mtimeNs: String(stat.mtimeNs),
    }
  } catch {
    return { status: 'unobservable' }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** Bound at call time so a poisoned parent cannot pre-empt this module's import. */
function readFileSyncBound(source) {
  // No encoding: readFileSync returns a Buffer, so body.length below is BYTES.
  // With 'utf8' it returns a string and .length counts UTF-16 code units, which
  // under-reports every astral character. The sha256 is unchanged either way -
  // update(string) encodes utf8 - so only the byte count was ever wrong.
  // eslint-disable-next-line no-undef
  return process.getBuiltinModule('fs').readFileSync(source)
}
