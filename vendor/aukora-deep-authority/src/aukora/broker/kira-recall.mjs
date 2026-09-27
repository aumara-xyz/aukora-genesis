/**
 * Broker-owned KIRA recall over the governed memory object store.
 *
 * The caller supplies only an optional record kind. The broker supplies the
 * subject and permitted privacy classes from its launch configuration, reads
 * the content-addressed store without following symbolic-link leaves, verifies
 * the complete Aura chain and local sequence witness, and returns citations to
 * the exact settlement entries that support each record. A missing, malformed,
 * or unverifiable store is `undetermined`; it is never reported as empty.
 *
 * @module @aukora/broker/kira-recall
 */
import { createHash } from 'node:crypto'
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { compareObjectInventory, readVerifiedChain } from '../aura/record.mjs'
import { effectBody } from './effect-body.mjs'
import { selectMemoryEntries } from './memory-entries.mjs'
import {
  KIRA_RECALL_MAX_RECORDS,
  KIRA_RECALL_MAX_RESULT_BYTES,
  KIRA_RECALL_MAX_SUBJECT_BYTES,
  kiraRecordContentSha256,
  recallKiraMemoryRecords,
} from '../kira/recall.mjs'
import { KIRA_PRIVACY_CLASSES, KIRA_RECORD_ID } from '../kira/stage.mjs'

/** Maximum key projections inspected by one recall. */
export const KIRA_RECALL_MAX_INDEX_ENTRIES = 4_096

/** Maximum bytes read from the Aura chain for one recall. */
export const KIRA_RECALL_MAX_AURA_BYTES = 16 * 1024 * 1024

const POINTER_MAX_BYTES = 512
const OBJECT_MAX_BYTES = 16 * 1024
const OBJECT_STORE_MAX_BYTES = KIRA_RECALL_MAX_INDEX_ENTRIES * OBJECT_MAX_BYTES
const CONTENT_DIGEST = /^[0-9a-f]{64}$/

class RecallStateError extends Error {
  /** @param {'memory-unavailable'|'memory-corrupt'|'memory-unverified'} reason */
  constructor(reason) {
    super(reason)
    this.name = 'RecallStateError'
    this.reason = reason
  }
}

/** Return one closed undetermined result. */
function undetermined(reason) {
  return Object.freeze({ status: 'undetermined', reason })
}

/** Observe a path without treating an I/O error as absence. */
function inspect(path) {
  try {
    return { present: true, stat: lstatSync(path) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { present: false, stat: null }
    throw new RecallStateError('memory-unavailable')
  }
}

/** Read one regular non-symbolic-link file with a byte ceiling. */
function readBoundFile(path, limit) {
  let descriptor
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stat = fstatSync(descriptor)
    if (!stat.isFile()) throw new RecallStateError('memory-corrupt')
    if (stat.size > limit) throw new RecallStateError('memory-unavailable')
    const body = readFileSync(descriptor)
    if (body.length > limit) throw new RecallStateError('memory-unavailable')
    return body
  } catch (error) {
    if (error instanceof RecallStateError) throw error
    throw new RecallStateError(error?.code === 'ENOENT' ? 'memory-unverified' : 'memory-unavailable')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** Read the local sequence witness without following its leaf. */
function readSequence(stateDir) {
  const path = join(stateDir, 'seq')
  const state = inspect(path)
  if (!state.present) return 0
  const raw = readBoundFile(path, 32).toString('utf8')
  if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) throw new RecallStateError('memory-corrupt')
  const sequence = Number(raw)
  if (!Number.isSafeInteger(sequence)) throw new RecallStateError('memory-corrupt')
  return sequence
}

/** Read and verify the complete locally witnessed Aura history. */
function readAura(stateDir) {
  const path = join(stateDir, 'aura.jsonl')
  const state = inspect(path)
  if (!state.present) {
    if (readSequence(stateDir) !== 0) throw new RecallStateError('memory-unverified')
    return { count: 0, lastChainHash: null, entries: [] }
  }
  if (!state.stat.isFile() || state.stat.isSymbolicLink()) {
    throw new RecallStateError('memory-corrupt')
  }
  if (state.stat.size > KIRA_RECALL_MAX_AURA_BYTES) {
    throw new RecallStateError('memory-unavailable')
  }
  const verified = readVerifiedChain(path)
  if (!verified.ok) {
    throw new RecallStateError(
      verified.reason === 'record:unavailable' ? 'memory-unavailable' : 'memory-unverified',
    )
  }
  if (verified.entries.length > KIRA_RECALL_MAX_INDEX_ENTRIES) {
    throw new RecallStateError('memory-unavailable')
  }
  for (let index = 0; index < verified.entries.length; index += 1) {
    if (verified.entries[index]?.sequence !== index + 1) {
      throw new RecallStateError('memory-unverified')
    }
  }
  if (readSequence(stateDir) !== verified.count) {
    throw new RecallStateError('memory-unverified')
  }
  return verified
}

/** Parse one exact key projection. */
function readProjection(path, filename) {
  const text = readBoundFile(path, POINTER_MAX_BYTES).toString('utf8')
  let pointer
  try {
    pointer = JSON.parse(text)
  } catch {
    throw new RecallStateError('memory-corrupt')
  }
  if (typeof pointer !== 'object' || pointer === null || Array.isArray(pointer)
    || Object.getPrototypeOf(pointer) !== Object.prototype
    || Object.keys(pointer).length !== 2
    || typeof pointer.key !== 'string'
    || typeof pointer.contentSha256 !== 'string'
    || !CONTENT_DIGEST.test(pointer.contentSha256)
    || filename !== `${pointer.key}.json`
    || text !== `${JSON.stringify({ key: pointer.key, contentSha256: pointer.contentSha256 })}\n`) {
    throw new RecallStateError('memory-corrupt')
  }
  return pointer
}

/** Parse and verify one content-addressed memory object. */
function readObject(stateDir, pointer) {
  const path = join(stateDir, 'memory', 'objects', `${pointer.contentSha256}.json`)
  const body = readBoundFile(path, OBJECT_MAX_BYTES)
  if (createHash('sha256').update(body).digest('hex') !== pointer.contentSha256) {
    throw new RecallStateError('memory-unverified')
  }
  const text = body.toString('utf8')
  let stored
  try {
    stored = JSON.parse(text)
  } catch {
    throw new RecallStateError('memory-corrupt')
  }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)
    || Object.keys(stored).length !== 2 || stored.key !== pointer.key) {
    throw new RecallStateError('memory-corrupt')
  }
  try {
    if (effectBody({ key: stored.key, value: stored.value }) !== text) {
      throw new RecallStateError('memory-unverified')
    }
  } catch (error) {
    if (error instanceof RecallStateError) throw error
    throw new RecallStateError('memory-corrupt')
  }
  return { key: pointer.key, value: stored.value, bytes: body.length }
}

/** Read the current key projection snapshot and its object bytes. */
function readBacking(stateDir, memoryEntries) {
  const keysDir = join(stateDir, 'memory', 'keys')
  const state = inspect(keysDir)
  if (!state.present) {
    if (memoryEntries.length === 0) return []
    throw new RecallStateError('memory-unverified')
  }
  if (!state.stat.isDirectory() || state.stat.isSymbolicLink()) {
    throw new RecallStateError('memory-corrupt')
  }
  let entries
  try {
    entries = readdirSync(keysDir, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name))
  } catch {
    throw new RecallStateError('memory-unavailable')
  }
  if (entries.length > KIRA_RECALL_MAX_INDEX_ENTRIES) {
    throw new RecallStateError('memory-unavailable')
  }
  const latestByKey = new Map()
  for (const entry of memoryEntries) {
    if (entry?.verdict !== 'settled'
      || typeof entry.key !== 'string'
      || typeof entry.contentSha256 !== 'string'
      || !CONTENT_DIGEST.test(entry.contentSha256)) {
      throw new RecallStateError('memory-unverified')
    }
    latestByKey.set(entry.key, entry.contentSha256)
  }
  const backing = []
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new RecallStateError('memory-corrupt')
    const pointer = readProjection(join(keysDir, entry.name), entry.name)
    if (latestByKey.get(pointer.key) !== pointer.contentSha256) {
      throw new RecallStateError('memory-unverified')
    }
    backing.push(readObject(stateDir, pointer))
  }
  if (backing.length !== latestByKey.size) throw new RecallStateError('memory-unverified')
  return backing
}

/** Bound the object directory before the complete inventory verifier reads it. */
function preflightObjectBounds(stateDir, auraCount) {
  const objectsDir = join(stateDir, 'memory', 'objects')
  const state = inspect(objectsDir)
  if (!state.present) {
    if (auraCount === 0) return
    throw new RecallStateError('memory-unverified')
  }
  if (!state.stat.isDirectory() || state.stat.isSymbolicLink()) {
    throw new RecallStateError('memory-corrupt')
  }
  let entries
  try {
    entries = readdirSync(objectsDir, { withFileTypes: true })
  } catch {
    throw new RecallStateError('memory-unavailable')
  }
  if (entries.length > KIRA_RECALL_MAX_INDEX_ENTRIES) {
    throw new RecallStateError('memory-unavailable')
  }
  let bytes = 0
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new RecallStateError('memory-corrupt')
    const object = inspect(join(objectsDir, entry.name))
    if (!object.present || !object.stat.isFile() || object.stat.isSymbolicLink()) {
      throw new RecallStateError('memory-corrupt')
    }
    if (object.stat.size > OBJECT_MAX_BYTES) throw new RecallStateError('memory-unavailable')
    bytes += object.stat.size
    if (bytes > OBJECT_STORE_MAX_BYTES) throw new RecallStateError('memory-unavailable')
  }
}

/** Find the earliest settlement supporting one current projection. */
function citationFor(recordId, contentSha256, memoryEntries, verifiedHead) {
  for (let index = 0; index < memoryEntries.length; index += 1) {
    const entry = memoryEntries[index]
    if (entry?.verdict === 'settled'
      && entry.key === recordId
      && entry.contentSha256 === contentSha256
      && Number.isSafeInteger(entry.sequence)
      && typeof entry.hash === 'string'
      && CONTENT_DIGEST.test(entry.hash)) {
      return Object.freeze({
        recordId,
        contentSha256,
        auraSequence: entry.sequence,
        auraEntryHash: entry.hash,
        verifiedHead,
      })
    }
  }
  throw new RecallStateError('memory-unverified')
}

/**
 * Read KIRA memory for one broker-owned subject and privacy policy.
 *
 * @param {string} stateDir - broker-owned state directory.
 * @param {{subject: string, kind?: string, permittedPrivacy: readonly string[]}} query - effective parent-owned query.
 * @returns {Readonly<Record<string, unknown>>} one found, empty, or undetermined result.
 */
export function readBrokerKiraRecall(stateDir, query) {
  let effectiveQuery
  let privacy
  const bounds = Object.freeze({
    maxRecords: KIRA_RECALL_MAX_RECORDS,
    maxBytes: KIRA_RECALL_MAX_RESULT_BYTES,
  })
  try {
    if (typeof query?.subject !== 'string' || query.subject === ''
      || Buffer.byteLength(query.subject, 'utf8') > KIRA_RECALL_MAX_SUBJECT_BYTES
      || !Array.isArray(query.permittedPrivacy)
      || query.permittedPrivacy.length === 0
      || query.permittedPrivacy.some(value => !KIRA_PRIVACY_CLASSES.includes(value))) {
      throw new TypeError('broker: invalid KIRA recall configuration')
    }
    privacy = Object.freeze([...new Set(query.permittedPrivacy)].toSorted())
    effectiveQuery = Object.freeze({
      subject: query.subject,
      ...(query.kind === undefined ? {} : { kind: query.kind }),
    })
    const aura = readAura(stateDir)
    const selected = selectMemoryEntries(aura.entries)
    if (!selected.ok) throw new RecallStateError('memory-unverified')
    preflightObjectBounds(stateDir, selected.entries.length)
    const inventory = compareObjectInventory(stateDir, selected.entries)
    if (!inventory.ok) throw new RecallStateError('memory-unverified')
    const backing = readBacking(stateDir, selected.entries)
    const recalled = recallKiraMemoryRecords(
      { subject: query.subject, ...(query.kind === undefined ? {} : { kind: query.kind }) },
      backing.map(({ key, value }) => ({ key, value })),
    )
    if (recalled.status === 'undetermined') {
      return Object.freeze({
        query: effectiveQuery,
        privacy,
        bounds,
        citations: Object.freeze([]),
        result: recalled,
      })
    }
    if (recalled.status === 'empty') {
      return Object.freeze({
        query: effectiveQuery,
        privacy,
        bounds,
        citations: Object.freeze([]),
        result: Object.freeze({ status: 'empty' }),
      })
    }
    const permitted = new Set(privacy)
    const visible = recalled.records.filter(record => permitted.has(record.privacy))
    if (visible.length === 0) {
      return Object.freeze({
        query: effectiveQuery,
        privacy,
        bounds,
        citations: Object.freeze([]),
        result: Object.freeze({ status: 'empty' }),
      })
    }
    if (visible.length > KIRA_RECALL_MAX_RECORDS) {
      return Object.freeze({
        query: effectiveQuery,
        privacy,
        bounds,
        citations: Object.freeze([]),
        result: undetermined('memory-unavailable'),
      })
    }
    const byKey = new Map(backing.map(entry => [entry.key, entry]))
    let resultBytes = 0
    const citations = visible.map((record) => {
      const stored = byKey.get(record.recordId)
      if (stored === undefined || !KIRA_RECORD_ID.test(record.recordId)) {
        throw new RecallStateError('memory-unverified')
      }
      resultBytes += stored.bytes
      if (resultBytes > KIRA_RECALL_MAX_RESULT_BYTES) {
        throw new RecallStateError('memory-unavailable')
      }
      const contentSha256 = kiraRecordContentSha256(record)
      return citationFor(record.recordId, contentSha256, selected.entries, aura.lastChainHash)
    })
    return Object.freeze({
      query: effectiveQuery,
      privacy,
      bounds,
      citations: Object.freeze(citations),
      result: Object.freeze({ status: 'found', records: Object.freeze(visible) }),
    })
  } catch (error) {
    if (error instanceof RecallStateError && effectiveQuery !== undefined && privacy !== undefined) {
      return Object.freeze({
        query: effectiveQuery,
        privacy,
        bounds,
        citations: Object.freeze([]),
        result: undetermined(error.reason),
      })
    }
    throw error
  }
}
