/**
 * Read-only KIRA recall over one caller-supplied governed-memory snapshot.
 *
 * KIRA holds no store route: the composition that owns a governed read
 * surface passes the entries it read, and recall only classifies them. The
 * reply is exactly one of three states — `found` with verified records,
 * `empty` when memory was readable and nothing matched, or `undetermined`
 * with a named reason when memory was missing, corrupt, or unverified.
 * `undetermined` never collapses into `empty`: "no memory found" and "memory
 * could not be verified" are different truths.
 *
 * @module @aukora/kira/recall
 */
import { createHash } from 'node:crypto'
import { types } from 'node:util'
import { effectBody } from '../broker/effect-body.mjs'
import {
  KIRA_RECORD_KINDS,
  verifyKiraMemoryRecord,
} from './stage.mjs'

/** Prefix of every governed-memory key that names a KIRA record. */
const KIRA_KEY_PREFIX = 'kira:'

/** Model-facing recall route name for broker-owned governed reads. */
export const KIRA_RECALL_TOOL = 'kira.recall'

/** Maximum records returned by one broker recall. */
export const KIRA_RECALL_MAX_RECORDS = 16

/** Maximum combined object-body bytes returned by one broker recall. */
export const KIRA_RECALL_MAX_RESULT_BYTES = 48 * 1024

/** Maximum UTF-8 bytes accepted for one parent-owned recall subject. */
export const KIRA_RECALL_MAX_SUBJECT_BYTES = 1024

/** Closed recall states; the recall reply vocabulary is a public contract. */
export const KIRA_RECALL_STATES = Object.freeze(['found', 'empty', 'undetermined'])

/** Closed reasons an undetermined recall names. */
export const KIRA_RECALL_UNDETERMINED_REASONS = Object.freeze([
  'memory-unavailable',
  'memory-corrupt',
  'memory-unverified',
])

/** A named recall-query refusal; every refusal carries one stable code. */
export class KiraRecallError extends Error {
  /** Stable machine-readable refusal code, e.g. `kira.recall:query-not-plain`. */
  code

  /**
   * @param {string} code - stable refusal code suffix, without the route prefix.
   * @param {string} message - human-readable refusal, free of caller data echoes.
   */
  constructor(code, message) {
    super(`kira.recall: ${message}`)
    this.name = 'KiraRecallError'
    this.code = `kira.recall:${code}`
  }
}

/**
 * Compute the content-addressed object digest for one verified KIRA record.
 *
 * @param {Readonly<Record<string, unknown>>} record - KIRA record whose recordId names the object key.
 * @returns {string} lowercase SHA-256 digest of the exact memory object bytes.
 */
export function kiraRecordContentSha256(record) {
  return createHash('sha256')
    .update(effectBody({ key: record.recordId, value: record }), 'utf8')
    .digest('hex')
}

/** @param {'memory-unavailable' | 'memory-corrupt' | 'memory-unverified'} reason @returns {Readonly<{status: 'undetermined', reason: string}>} */
function undetermined(reason) {
  return Object.freeze({ status: 'undetermined', reason })
}

/**
 * Read one closed `{subject, kind?}` query without invoking accessors.
 * @param {unknown} query - recall query from an untrusted boundary.
 * @returns {{subject: string, kind?: string}} detached validated query.
 */
function readQuery(query) {
  // isProxy runs before Array.isArray: IsArray on a revoked proxy throws an
  // incidental TypeError, and every refusal here must be a named one.
  if (query === null || typeof query !== 'object' || types.isProxy(query) || Array.isArray(query)) {
    throw new KiraRecallError('query-not-plain', 'query must be one plain data record')
  }
  const record = /** @type {Record<string, unknown>} */ (query)
  const prototype = Object.getPrototypeOf(record)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new KiraRecallError('query-not-plain', 'query must not carry a custom prototype')
  }
  const result = /** @type {{subject?: string, kind?: string}} */ ({})
  for (const key of Reflect.ownKeys(record)) {
    if (key !== 'subject' && key !== 'kind') {
      throw new KiraRecallError('query-field-unknown', 'query carries a field outside subject, kind')
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new KiraRecallError('query-field-not-data', `query.${key} must be an enumerable data property`)
    }
    result[key] = /** @type {string} */ (descriptor.value)
  }
  if (typeof result.subject !== 'string' || result.subject === '') {
    throw new KiraRecallError('query-subject-invalid', 'query.subject must be a non-empty string')
  }
  if ('kind' in result && !KIRA_RECORD_KINDS.includes(/** @type {never} */ (result.kind))) {
    throw new KiraRecallError('query-kind-invalid', `query.kind must be one of ${KIRA_RECORD_KINDS.join(', ')}`)
  }
  return /** @type {{subject: string, kind?: string}} */ (result)
}

/**
 * Read one backing entry as a closed `{key, value}` pair.
 * @param {unknown} entry - snapshot entry.
 * @returns {{key: string, value: unknown} | null} the pair, or null when unreadable.
 */
function readEntry(entry) {
  if (entry === null || typeof entry !== 'object' || types.isProxy(entry) || Array.isArray(entry)) return null
  const record = /** @type {Record<string, unknown>} */ (entry)
  const prototype = Object.getPrototypeOf(record)
  if (prototype !== Object.prototype && prototype !== null) return null
  const ownKeys = Reflect.ownKeys(record)
  if (ownKeys.length !== 2 || !ownKeys.includes('key') || !ownKeys.includes('value')) return null
  const key = Object.getOwnPropertyDescriptor(record, 'key')
  const value = Object.getOwnPropertyDescriptor(record, 'value')
  if (key === undefined || value === undefined) return null
  if (!('value' in key) || key.enumerable !== true || !('value' in value) || value.enumerable !== true) return null
  if (typeof key.value !== 'string') return null
  return { key: key.value, value: value.value }
}

/**
 * Recall verified KIRA memory records for one subject.
 *
 * Non-KIRA entries (keys outside the `kira:` prefix) are ignored: governed
 * memory legitimately holds other values. Every KIRA-keyed entry must verify
 * — one malformed entry makes the whole snapshot `memory-corrupt`, and one
 * identity mismatch (record bytes that do not recompute their own
 * `recordId`, or a record stored under a different key) makes it
 * `memory-unverified` — because a store that failed once cannot certify what
 * it did not fail on.
 *
 * @param {unknown} query - closed `{subject, kind?}` recall query.
 * @param {unknown} backing - snapshot of governed-memory entries as a plain
 *   array of `{key, value}` pairs, or `undefined`/`null` when the store
 *   could not be read at all.
 * @returns {Readonly<{status: 'found', records: readonly unknown[]}> | Readonly<{status: 'empty'}> | Readonly<{status: 'undetermined', reason: string}>}
 *   exactly one of the three public recall states.
 * @throws {KiraRecallError} when the query itself is not one closed record.
 */
export function recallKiraMemoryRecords(query, backing) {
  const wanted = readQuery(query)
  if (backing === undefined || backing === null) return undetermined('memory-unavailable')
  if (types.isProxy(backing) || !Array.isArray(backing)
    || Object.getPrototypeOf(backing) !== Array.prototype) {
    return undetermined('memory-corrupt')
  }
  const entries = /** @type {unknown[]} */ (backing)
  const verified = new Map()
  for (let index = 0; index < entries.length; index += 1) {
    if (!Object.hasOwn(entries, index)) return undetermined('memory-corrupt')
    const entry = readEntry(entries[index])
    if (entry === null) return undetermined('memory-corrupt')
    if (!entry.key.startsWith(KIRA_KEY_PREFIX)) continue
    const verdict = verifyKiraMemoryRecord(entry.value)
    if (verdict.verified !== true) {
      return undetermined(verdict.reason === 'malformed' ? 'memory-corrupt' : 'memory-unverified')
    }
    if (verdict.record.recordId !== entry.key) return undetermined('memory-unverified')
    verified.set(verdict.record.recordId, verdict.record)
  }
  const matches = [...verified.values()]
    .filter(record => record.subject === wanted.subject
      && (wanted.kind === undefined || record.kind === wanted.kind))
    .toSorted((left, right) => left.recordId < right.recordId ? -1 : 1)
  if (matches.length === 0) return Object.freeze({ status: 'empty' })
  return Object.freeze({ status: 'found', records: Object.freeze(matches) })
}
