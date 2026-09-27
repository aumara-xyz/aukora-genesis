/**
 * The read-owner boundary.
 *
 * KIRA holds no store route. A composition that owns a governed read surface
 * passes in one read owner; that owner — not this package, not the model, and
 * not the question text — supplies the subject and the permitted privacy
 * classes. The tool's model-visible parameters have no subject and no privacy
 * field at all, and every snapshot the owner returns is re-checked here against
 * the policy the owner itself declared.
 *
 * The owner also supplies, per record, the canonical KIRA record, a retrieval
 * text projection of that record, and a citation. This module re-derives the
 * record identity and the content digest from the record's own bytes, so a
 * citation cannot name a record that does not hash to it. The Aura evidence a
 * citation names is checked against the owner's store by the Kira memory
 * artifact verifier, not by this module.
 *
 * @module @aukora/dsh-plugin-kira/read-owner
 */
import { createHash } from 'node:crypto'
import { types } from 'node:util'
import {
  KIRA_PRIVACY_CLASSES,
  KIRA_RECORD_ID,
  canonicalJSON,
  kiraRecordContentSha256,
  verifyKiraMemoryRecord,
} from './record.mjs'
import { RETRIEVAL_CEILING, RETRIEVAL_LIMITS, STORE_AVAILABILITY } from './retrieval.mjs'

const SHA256_HEX = /^[0-9a-f]{64}$/
const UNDETERMINED_REASONS = Object.freeze(['memory-unavailable', 'memory-corrupt', 'memory-unverified', 'integrity'])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

/** A named read-owner refusal; every refusal carries one stable code. */
export class KiraReadOwnerError extends Error {
  /** Stable machine-readable refusal code, e.g. `kira.read-owner:snapshot-widens-subject`. */
  code

  /**
   * @param {string} code - stable refusal code suffix.
   * @param {string} message - human-readable refusal, free of caller data echoes.
   */
  constructor(code, message) {
    super(`kira.read-owner: ${message}`)
    this.name = 'KiraReadOwnerError'
    this.code = `kira.read-owner:${code}`
  }
}

/**
 * @param {string} code @param {string} message @returns {never}
 */
function refuse(code, message) {
  throw new KiraReadOwnerError(code, message)
}

/**
 * Read one closed plain-data object without invoking accessors or proxies.
 * @param {unknown} input - candidate object.
 * @param {readonly string[]} required - own field names that must appear.
 * @param {readonly string[]} optional - own field names that may appear.
 * @param {string} label - refusal-code and message subject.
 * @returns {Record<string, unknown>} detached own data-property values.
 */
function readClosedObject(input, required, optional, label) {
  if (input === null || typeof input !== 'object' || types.isProxy(input) || Array.isArray(input)) {
    refuse(`${label}-not-plain`, `${label} must be one plain data record`)
  }
  const record = /** @type {Record<string, unknown>} */ (input)
  const prototype = Object.getPrototypeOf(record)
  if (prototype !== Object.prototype && prototype !== null) {
    refuse(`${label}-not-plain`, `${label} must not carry a custom prototype`)
  }
  const allowed = new Set([...required, ...optional])
  const result = /** @type {Record<string, unknown>} */ ({})
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      refuse(`${label}-field-unknown`, `${label} carries a field outside ${[...allowed].join(', ')}`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
      refuse(`${label}-field-not-data`, `${label}.${key} must be an enumerable data property`)
    }
    result[key] = descriptor.value
  }
  for (const key of required) {
    if (!(key in result)) refuse(`${label}-field-missing`, `${label} must carry ${key}`)
  }
  return result
}

/**
 * @param {unknown} value - candidate string.
 * @param {string} label - refusal-code and message subject.
 * @param {number} maxLength - character ceiling.
 * @returns {string} the validated string.
 */
function readLabel(value, label, maxLength) {
  if (typeof value !== 'string' || value === '' || [...value].length > maxLength) {
    refuse(`${label}-invalid`, `${label} must be a non-empty string of at most ${maxLength} characters`)
  }
  if (CONTROL_CHARACTERS.test(value)) {
    refuse(`${label}-invalid`, `${label} must not contain control characters`)
  }
  return value
}

/**
 * The privacy classes and subject one owner currently grants.
 *
 * @typedef {Readonly<{subject: string, policyRevision: string, permittedPrivacy: readonly string[]}>} KiraReadPolicy
 */

/**
 * Validate one owner-declared policy.
 * @param {unknown} value - candidate policy from the read owner.
 * @returns {KiraReadPolicy} detached frozen policy.
 */
export function readOwnerPolicy(value) {
  const fields = readClosedObject(value, ['subject', 'policyRevision', 'permittedPrivacy'], [], 'policy')
  const subject = readLabel(fields.subject, 'policy-subject', 1024)
  const policyRevision = readLabel(fields.policyRevision, 'policy-revision', 256)
  if (!Array.isArray(fields.permittedPrivacy) || fields.permittedPrivacy.length === 0) {
    refuse('policy-privacy-invalid', 'policy.permittedPrivacy must be a non-empty array')
  }
  const permitted = [...new Set(fields.permittedPrivacy)].toSorted()
  if (permitted.some(value => typeof value !== 'string' || !KIRA_PRIVACY_CLASSES.includes(/** @type {never} */ (value)))) {
    refuse('policy-privacy-invalid', `policy.permittedPrivacy must be drawn from ${KIRA_PRIVACY_CLASSES.join(', ')}`)
  }
  return Object.freeze({ subject, policyRevision, permittedPrivacy: Object.freeze(permitted) })
}

/**
 * Validate one citation.
 * @param {unknown} value - candidate citation.
 * @returns {{recordId: string, contentSha256: string, auraSequence: number, auraEntryHash: string, verifiedHead: string}} detached citation.
 */
function readCitation(value) {
  const fields = readClosedObject(
    value,
    ['recordId', 'contentSha256', 'auraSequence', 'auraEntryHash', 'verifiedHead'],
    [],
    'citation',
  )
  if (typeof fields.recordId !== 'string' || !KIRA_RECORD_ID.test(fields.recordId)) {
    refuse('citation-invalid', 'citation.recordId must be a deterministic KIRA record identifier')
  }
  for (const field of ['contentSha256', 'auraEntryHash', 'verifiedHead']) {
    if (typeof fields[field] !== 'string' || !SHA256_HEX.test(fields[field])) {
      refuse('citation-invalid', `citation.${field} must be a lowercase SHA-256 hex digest`)
    }
  }
  if (!Number.isSafeInteger(fields.auraSequence) || fields.auraSequence < 1) {
    refuse('citation-invalid', 'citation.auraSequence must be a positive safe integer')
  }
  return {
    recordId: fields.recordId,
    contentSha256: fields.contentSha256,
    auraSequence: fields.auraSequence,
    auraEntryHash: fields.auraEntryHash,
    verifiedHead: fields.verifiedHead,
  }
}

/**
 * Validate one record entry and bind it to the declared policy.
 *
 * The record's own bytes are the arbiter of its identity: the recomputed
 * `recordId` and the recomputed content digest must both match what the entry
 * and its citation claim. A mismatch is `memory-unverified`, never a mismatch
 * the caller can widen past.
 *
 * @param {unknown} value - candidate entry.
 * @param {KiraReadPolicy} policy - the policy the owner declared for this read.
 * @returns {Readonly<Record<string, unknown>>} frozen detached entry.
 */
function readEntry(value, policy) {
  const fields = readClosedObject(value, ['record', 'text', 'citation'], ['truncated', 'settlement'], 'record-entry')
  const verdict = verifyKiraMemoryRecord(fields.record)
  if (verdict.verified !== true) {
    refuse('record-unverified', `record entry does not verify: ${verdict.reason}`)
  }
  const record = verdict.record
  const citation = readCitation(fields.citation)
  if (citation.recordId !== record.recordId) {
    refuse('citation-mismatch', 'citation.recordId does not name the entry record')
  }
  if (kiraRecordContentSha256(record) !== citation.contentSha256) {
    refuse('citation-mismatch', 'citation.contentSha256 does not digest the entry record')
  }
  if (record.subject !== policy.subject) {
    refuse('record-subject-mismatch', 'a returned record names a subject outside the declared policy')
  }
  if (!policy.permittedPrivacy.includes(/** @type {string} */ (record.privacy))) {
    refuse('record-privacy-not-permitted', 'a returned record carries a privacy class outside the declared policy')
  }
  if (typeof fields.text !== 'string') {
    refuse('record-text-invalid', 'record entry text must be a string')
  }
  if (fields.truncated !== undefined && fields.truncated !== true && fields.truncated !== false) {
    refuse('record-text-invalid', 'record entry truncated must be a boolean when present')
  }
  let settlement
  if (fields.settlement !== undefined) {
    const signed = readClosedObject(fields.settlement, ['issuedAt', 'approverDid'], [], 'record-settlement')
    if (!Number.isFinite(signed.issuedAt) || (signed.approverDid !== null && typeof signed.approverDid !== 'string')) {
      refuse('record-settlement-invalid', 'settlement must name a signing time and an approving key or null')
    }
    settlement = Object.freeze({ issuedAt: signed.issuedAt, approverDid: signed.approverDid })
  }
  return Object.freeze({
    record,
    recordId: record.recordId,
    text: fields.text,
    citation: Object.freeze(citation),
    ...(settlement === undefined ? {} : { settlement }),
    ...(fields.truncated === undefined ? {} : { truncated: fields.truncated }),
  })
}

/**
 * Validate one retrieval-text projection identity.
 * @param {unknown} value - candidate projection reference.
 * @returns {Readonly<{name: string, version: string, digest: string}>} detached projection identity.
 */
function readProjection(value) {
  const fields = readClosedObject(value, ['name', 'version', 'digest'], [], 'projection')
  return Object.freeze({
    name: readLabel(fields.name, 'projection-name', 128),
    version: readLabel(fields.version, 'projection-version', 64),
    digest: typeof fields.digest === 'string' && SHA256_HEX.test(fields.digest)
      ? fields.digest
      : refuse('projection-invalid', 'projection.digest must be a lowercase SHA-256 hex digest'),
  })
}

/**
 * Validate one complete read-owner snapshot and bind it to the declared policy.
 *
 * A snapshot that carries records under an availability other than `found` is
 * refused: "memory was unavailable" and "here are records" cannot both be true,
 * and a consumer must never have to choose which half to believe.
 *
 * @param {unknown} value - snapshot returned by the read owner.
 * @param {KiraReadPolicy} policy - the policy the owner declared for this read.
 * @param {string} scope - host-supplied scope key, for the digest only.
 * @returns {Readonly<Record<string, unknown>>} frozen detached snapshot.
 */
export function readOwnerSnapshot(value, policy, scope) {
  const fields = readClosedObject(
    value,
    ['availability', 'subject', 'policyRevision', 'projection', 'records'],
    ['reason'],
    'snapshot',
  )
  if (typeof fields.availability !== 'string' || !STORE_AVAILABILITY.includes(/** @type {never} */ (fields.availability))) {
    refuse('snapshot-availability-invalid', `snapshot.availability must be one of ${STORE_AVAILABILITY.join(', ')}`)
  }
  const subject = readLabel(fields.subject, 'snapshot-subject', 1024)
  const policyRevision = readLabel(fields.policyRevision, 'snapshot-policy-revision', 256)
  // The read owner cannot widen what it declared: the subject and the policy
  // revision are the owner's own words, and a snapshot that contradicts them is
  // a read of a different authority than the one this call was admitted under.
  if (subject !== policy.subject) {
    refuse('snapshot-widens-subject', 'snapshot.subject does not match the declared read policy subject')
  }
  if (policyRevision !== policy.policyRevision) {
    refuse('snapshot-policy-changed', 'snapshot.policyRevision does not match the policy the owner declared for this read')
  }
  if (!Array.isArray(fields.records)) {
    refuse('snapshot-records-invalid', 'snapshot.records must be an array')
  }
  if (fields.availability !== 'found' && fields.records.length > 0) {
    refuse('snapshot-unavailable-with-records', 'a snapshot that is not found cannot carry records')
  }
  if (fields.availability === 'undetermined') {
    if (typeof fields.reason !== 'string' || !UNDETERMINED_REASONS.includes(fields.reason)) {
      refuse('snapshot-reason-invalid', `an undetermined snapshot must name one of ${UNDETERMINED_REASONS.join(', ')}`)
    }
  } else if (fields.reason !== undefined) {
    refuse('snapshot-reason-unexpected', 'only an undetermined snapshot may carry a reason')
  }
  const projection = readProjection(fields.projection)
  const records = []
  const seen = new Set()
  if (fields.records.length > RETRIEVAL_LIMITS.records) {
    refuse('snapshot-too-large', `snapshot exceeds ${RETRIEVAL_LIMITS.records} records`)
  }
  for (const entry of fields.records) {
    const read = readEntry(entry, policy)
    if (seen.has(read.recordId)) refuse('snapshot-duplicate-record', 'snapshot carries a duplicate record identifier')
    seen.add(read.recordId)
    records.push(read)
  }
  const snapshot = Object.freeze({
    availability: fields.availability,
    subject,
    policyRevision,
    projection,
    records: Object.freeze(records),
    ...(fields.reason === undefined ? {} : { reason: fields.reason }),
    work: Object.freeze({ scope }),
  })
  if (Buffer.byteLength(JSON.stringify(snapshot)) > RETRIEVAL_LIMITS.corpusBytes) {
    refuse('snapshot-too-large', `snapshot exceeds ${RETRIEVAL_LIMITS.corpusBytes} bytes`)
  }
  return snapshot
}

/**
 * Digest one snapshot as a cache key and an invalidation witness.
 *
 * The digest covers the validated snapshot and the retrieval method, so a
 * changed record byte, a changed projection, a changed subject, or a changed
 * effective privacy set all produce a different key. The digest is a cache key,
 * not an authority token.
 *
 * @param {Readonly<Record<string, unknown>>} snapshot - validated snapshot.
 * @param {string} transformDigest - digest of the retrieval method in force.
 * @returns {string} lowercase SHA-256 hex digest.
 */
export function snapshotDigest(snapshot, transformDigest) {
  return createHash('sha256')
    .update(canonicalJSON({ transform: transformDigest, snapshot }), 'utf8')
    .digest('hex')
}

/**
 * Load one read owner from an explicit module path.
 *
 * The module must export `createReadOwner(options)`. The returned owner must be
 * a plain-data-checkable object with `describe` and `read` functions; anything
 * else is a named failure at load time, so a misconfigured composition fails
 * loudly instead of answering `undetermined` forever.
 *
 * @param {{module: string, options?: unknown}} config - owner configuration from the composition.
 * @param {(specifier: string) => Promise<unknown>} [importer] - module importer, for tests.
 * @returns {Promise<Readonly<{describe: () => Promise<unknown>, read: (request: unknown) => Promise<unknown>}>>} the loaded owner.
 */
export async function loadReadOwner(config, importer = specifier => import(specifier)) {
  const fields = readClosedObject(config, ['module'], ['options'], 'read-owner')
  const specifier = readLabel(fields.module, 'read-owner-module', 4096)
  let module
  try {
    module = await importer(specifier)
  } catch (error) {
    refuse('module-unresolved', `read owner module ${JSON.stringify(specifier)} could not be imported: ${error?.message ?? 'import failed'}`)
  }
  const create = /** @type {Record<string, unknown> | null} */ (module)?.['createReadOwner']
  if (typeof create !== 'function') {
    refuse('module-shape-invalid', `read owner module ${JSON.stringify(specifier)} must export createReadOwner`)
  }
  const owner = await create(fields.options)
  if (owner === null || typeof owner !== 'object' || types.isProxy(owner)) {
    refuse('owner-shape-invalid', 'createReadOwner must return one owner object')
  }
  if (typeof owner.describe !== 'function' || typeof owner.read !== 'function') {
    refuse('owner-shape-invalid', 'a read owner must provide describe() and read()')
  }
  return Object.freeze({ describe: () => owner.describe(), read: request => owner.read(request) })
}

/** The ceiling text every reply carries; re-exported so tools need one import. */
export const READ_OWNER_CEILING = RETRIEVAL_CEILING
