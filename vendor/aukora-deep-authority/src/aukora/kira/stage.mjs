/**
 * Deterministic KIRA memory-record staging for the governed memory route.
 *
 * KIRA produces inert records. It does not approve, mint, settle, read a key,
 * hold a nonce book, contact the issuer, open broker state, or perform an
 * effect. The caller must submit the returned `memoryPut` arguments through
 * the existing AUKORA proposal and parent-review path; the deterministic
 * `recordId` names the record and proves nothing about authorization or Aura
 * inclusion.
 *
 * @module @aukora/kira/stage
 */
import { createHash } from 'node:crypto'
import { types } from 'node:util'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'

/** Fixed record domain; changing it changes every KIRA record identifier. */
export const KIRA_RECORD_DOMAIN = 'aukora:kira-memory-record:v0'

/** Model-facing staging route name for the governed memory proposal path. */
export const KIRA_STAGE_TOOL = 'kira.stage'

/** KIRA records are proposals and never authority artifacts. */
export const KIRA_STAGE_GRANTS_AUTHORITY = false

/** Closed record kinds from the KIRA memory specification. */
export const KIRA_RECORD_KINDS = Object.freeze([
  'observation',
  'summary',
  'claim',
  'preference',
  'plan',
  'training-slice',
  'erasure',
])

/** Closed privacy classes from the KIRA memory specification. */
export const KIRA_PRIVACY_CLASSES = Object.freeze(['local', 'exportable', 'private'])

/** Grammar of a deterministic KIRA record identifier. */
export const KIRA_RECORD_ID = /^kira:[0-9a-f]{64}$/

const SHA256_HEX = /^[0-9a-f]{64}$/
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/
const MAX_JSON_DEPTH = 64
const MAX_JSON_NODES = 10_000
const CANDIDATE_FIELDS = Object.freeze([
  'subject', 'kind', 'source', 'content', 'links', 'privacy', 'createdAt',
])
const RECORD_FIELDS = Object.freeze([
  'domain', 'grantsAuthority', 'recordId', ...CANDIDATE_FIELDS,
])

/** A named staging refusal; every refusal carries one stable code. */
export class KiraStageError extends Error {
  /** Stable machine-readable refusal code, e.g. `kira.stage:content-cycle`. */
  code

  /**
   * @param {string} code - stable refusal code suffix, without the tool prefix.
   * @param {string} message - human-readable refusal, free of caller data echoes.
   */
  constructor(code, message) {
    super(`${KIRA_STAGE_TOOL}: ${message}`)
    this.name = 'KiraStageError'
    this.code = `${KIRA_STAGE_TOOL}:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new KiraStageError(code, message)
}

/**
 * Read one closed plain-data object without invoking accessors or proxies.
 * @param {unknown} input - candidate object from an untrusted boundary.
 * @param {readonly string[]} required - own field names that must all appear.
 * @param {readonly string[]} optional - own field names that may appear.
 * @param {string} label - refusal-code and message subject for this object.
 * @returns {Record<string, unknown>} detached own data-property values.
 */
function readClosedObject(input, required, optional, label) {
  // isProxy runs before Array.isArray: IsArray on a revoked proxy throws an
  // incidental TypeError, and every refusal here must be a named one.
  if (input === null || typeof input !== 'object' || types.isProxy(input) || Array.isArray(input)) {
    refuse(`${label}-not-plain`, `${label} must be one plain data record`)
  }
  const record = /** @type {Record<string, unknown>} */ (input)
  const prototype = Object.getPrototypeOf(record)
  if (prototype !== Object.prototype && prototype !== null) {
    refuse(`${label}-not-plain`, `${label} must not carry a custom prototype`)
  }
  const ownKeys = Reflect.ownKeys(record)
  const allowed = new Set([...required, ...optional])
  const result = /** @type {Record<string, unknown>} */ ({})
  for (const key of ownKeys) {
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
 * Detach one bounded lossless-JSON value without retaining caller references.
 * @param {unknown} value - candidate content node.
 * @param {WeakSet<object>} ancestors - objects on the current descent path.
 * @param {{nodes: number}} state - total visited-node budget.
 * @param {number} depth - current nesting depth.
 * @returns {unknown} frozen detached copy with sorted object keys.
 */
function snapshotJson(value, ancestors, state, depth) {
  state.nodes += 1
  if (state.nodes > MAX_JSON_NODES) refuse('content-nodes', 'content exceeds the node limit')
  if (depth > MAX_JSON_DEPTH) refuse('content-depth', 'content exceeds the depth limit')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      refuse('content-not-json', 'content contains a non-JSON number')
    }
    return value
  }
  if (typeof value !== 'object' || types.isProxy(value)) {
    refuse('content-not-json', 'content must be lossless JSON data')
  }
  const node = /** @type {object} */ (value)
  if (ancestors.has(node)) refuse('content-cycle', 'content contains a cycle')
  ancestors.add(node)
  try {
    if (Array.isArray(node)) {
      if (Object.getPrototypeOf(node) !== Array.prototype) {
        refuse('content-not-plain', 'content arrays must not carry a custom prototype')
      }
      if (node.length > MAX_JSON_NODES - state.nodes) {
        refuse('content-nodes', 'content exceeds the node limit')
      }
      const keys = Reflect.ownKeys(node)
      const expected = [...Array.from({ length: node.length }, (_, index) => String(index)), 'length']
      if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        refuse('content-not-plain', 'content arrays must be dense data arrays')
      }
      const descriptors = Object.getOwnPropertyDescriptors(node)
      const result = Array.from({ length: node.length }, (_, index) => {
        const descriptor = descriptors[String(index)]
        if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
          refuse('content-not-plain', 'content arrays must contain enumerable data properties')
        }
        return snapshotJson(descriptor.value, ancestors, state, depth + 1)
      })
      return Object.freeze(result)
    }
    const prototype = Object.getPrototypeOf(node)
    if (prototype !== Object.prototype && prototype !== null) {
      refuse('content-not-plain', 'content objects must be plain data records')
    }
    const keys = Reflect.ownKeys(node)
    if (keys.length > MAX_JSON_NODES - state.nodes) {
      refuse('content-nodes', 'content exceeds the node limit')
    }
    if (keys.some(key => typeof key !== 'string')) {
      refuse('content-not-plain', 'content objects cannot contain symbol fields')
    }
    const descriptors = Object.getOwnPropertyDescriptors(node)
    const result = {}
    for (const key of /** @type {string[]} */ (keys).toSorted()) {
      const descriptor = descriptors[key]
      if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
        refuse('content-not-plain', 'content objects must contain enumerable data properties')
      }
      Object.defineProperty(result, key, {
        configurable: false,
        enumerable: true,
        value: snapshotJson(descriptor.value, ancestors, state, depth + 1),
        writable: false,
      })
    }
    return Object.freeze(result)
  } finally {
    ancestors.delete(node)
  }
}

/**
 * Require one unambiguous single-line name: non-empty, no control characters.
 * @param {unknown} value - candidate field value.
 * @param {string} field - refusal-code and message subject.
 * @returns {string} the validated string.
 */
function readName(value, field) {
  if (typeof value !== 'string' || value === '') {
    refuse(`${field}-invalid`, `${field} must be a non-empty string`)
  }
  if (CONTROL_CHARACTERS.test(value)) {
    refuse(`${field}-invalid`, `${field} must not contain control characters`)
  }
  return value
}

/**
 * Read one dense array of closed reference objects.
 * @param {unknown} value - candidate array.
 * @param {string} field - refusal-code and message subject.
 * @param {(entry: unknown, index: number) => unknown} readEntry - per-entry reader.
 * @returns {readonly unknown[]} frozen detached entries.
 */
function readRefArray(value, field, readEntry) {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    refuse(`${field}-invalid`, `${field} must be a plain array`)
  }
  const list = /** @type {unknown[]} */ (value)
  if (list.length > MAX_JSON_NODES) {
    refuse(`${field}-invalid`, `${field} exceeds the entry limit`)
  }
  const keys = Reflect.ownKeys(list)
  const expected = [...Array.from({ length: list.length }, (_, index) => String(index)), 'length']
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    refuse(`${field}-invalid`, `${field} must be a dense data array`)
  }
  const descriptors = Object.getOwnPropertyDescriptors(list)
  return Object.freeze(Array.from({ length: list.length }, (_, index) => {
    const descriptor = descriptors[String(index)]
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
      refuse(`${field}-invalid`, `${field} must contain enumerable data properties`)
    }
    return readEntry(descriptor.value, index)
  }))
}

/**
 * @param {unknown} entry - candidate source reference.
 * @returns {Readonly<{recordId: string}>} frozen detached source reference.
 */
function readSourceRef(entry) {
  const fields = readClosedObject(entry, ['recordId'], [], 'source')
  if (typeof fields.recordId !== 'string' || !KIRA_RECORD_ID.test(fields.recordId)) {
    refuse('source-invalid', 'source.recordId must be a deterministic KIRA record identifier')
  }
  return Object.freeze({ recordId: fields.recordId })
}

/**
 * @param {unknown} entry - candidate link.
 * @returns {Readonly<{recordId: string, relation: string}>} frozen detached link.
 */
function readLink(entry) {
  const fields = readClosedObject(entry, ['recordId', 'relation'], [], 'links')
  if (typeof fields.recordId !== 'string' || !KIRA_RECORD_ID.test(fields.recordId)) {
    refuse('links-invalid', 'links.recordId must be a deterministic KIRA record identifier')
  }
  return Object.freeze({ recordId: fields.recordId, relation: readName(fields.relation, 'links-relation') })
}

/**
 * @param {unknown} value - candidate transform reference.
 * @returns {Readonly<Record<string, string>>} frozen detached transform reference.
 */
function readTransform(value) {
  const fields = readClosedObject(value, ['name', 'version', 'outputDigest'], ['model', 'parametersDigest'], 'transform')
  const result = /** @type {Record<string, string>} */ ({
    name: readName(fields.name, 'transform-name'),
    version: readName(fields.version, 'transform-version'),
  })
  if ('model' in fields) result.model = readName(fields.model, 'transform-model')
  if ('parametersDigest' in fields) {
    if (typeof fields.parametersDigest !== 'string' || !SHA256_HEX.test(fields.parametersDigest)) {
      refuse('transform-invalid', 'transform.parametersDigest must be a lowercase SHA-256 hex digest')
    }
    result.parametersDigest = fields.parametersDigest
  }
  if (typeof fields.outputDigest !== 'string' || !SHA256_HEX.test(fields.outputDigest)) {
    refuse('transform-invalid', 'transform.outputDigest must be a lowercase SHA-256 hex digest')
  }
  result.outputDigest = fields.outputDigest
  return Object.freeze(result)
}

/**
 * Test one canonical seconds-precision UTC instant. Fractional seconds are
 * refused so one instant has exactly one encoding, and lenient calendar
 * rollover is refused so digest inputs cannot alias.
 * @param {string} value - candidate `createdAt` string.
 * @returns {boolean} whether the instant is a real UTC calendar time.
 */
function readInstant(value) {
  if (!CREATED_AT.test(value)) return false
  const time = Date.parse(value)
  if (Number.isNaN(time)) return false
  return new Date(time).toISOString() === `${value.slice(0, 19)}.000Z`
}

/**
 * Validate one candidate and build its complete detached record fields.
 * @param {unknown} input - closed staging candidate.
 * @returns {Record<string, unknown>} detached identity fields without recordId.
 */
function readCandidate(input) {
  const fields = readClosedObject(input, CANDIDATE_FIELDS, ['transform'], 'candidate')
  const subject = readName(fields.subject, 'subject')
  if (typeof fields.kind !== 'string' || !KIRA_RECORD_KINDS.includes(/** @type {never} */ (fields.kind))) {
    refuse('kind-invalid', `kind must be one of ${KIRA_RECORD_KINDS.join(', ')}`)
  }
  if (typeof fields.privacy !== 'string' || !KIRA_PRIVACY_CLASSES.includes(/** @type {never} */ (fields.privacy))) {
    refuse('privacy-invalid', `privacy must be one of ${KIRA_PRIVACY_CLASSES.join(', ')}`)
  }
  if (typeof fields.createdAt !== 'string' || !readInstant(fields.createdAt)) {
    refuse('created-at-invalid', 'createdAt must be one canonical seconds-precision UTC instant with a Z suffix')
  }
  const source = readRefArray(fields.source, 'source', readSourceRef)
  const links = readRefArray(fields.links, 'links', readLink)
  const content = snapshotJson(fields.content, new WeakSet(), { nodes: 0 }, 0)
  const identity = /** @type {Record<string, unknown>} */ ({
    domain: KIRA_RECORD_DOMAIN,
    grantsAuthority: KIRA_STAGE_GRANTS_AUTHORITY,
    subject,
    kind: fields.kind,
    source,
    content,
    links,
    privacy: fields.privacy,
    createdAt: fields.createdAt,
  })
  if ('transform' in fields) {
    // A derived view must record the records it derives from (spec section 4).
    if (source.length === 0) {
      refuse('transform-without-source', 'a transform requires at least one source record reference')
    }
    identity.transform = readTransform(fields.transform)
  }
  return identity
}

/**
 * @param {Record<string, unknown>} identity - detached identity fields.
 * @returns {string} deterministic domain-separated record identifier.
 */
function recordIdOf(identity) {
  const digest = createHash('sha256')
    .update(KIRA_RECORD_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(canonicalJSON(identity), 'utf8')
    .digest('hex')
  return `kira:${digest}`
}

/**
 * Convert one exact KIRA memory candidate into inert governed-memory arguments.
 *
 * The identifier hashes every record field except `recordId`, so it is stable
 * under object-key reordering and changes with any meaningful field change.
 * `createdAt` is caller-supplied canonical seconds-precision UTC data; no
 * local clock participates. Content carries depth and node ceilings and the
 * reference arrays carry an entry ceiling; byte ceilings belong to the broker
 * review limit at the door.
 *
 * @param {unknown} input - closed candidate with exactly `subject`, `kind`,
 *   `source`, `content`, `links`, `privacy`, `createdAt`, and optionally
 *   `transform`, from an untrusted boundary.
 * @returns {{recordId: string, record: Readonly<Record<string, unknown>>, memoryPut: Readonly<{key: string, value: Readonly<Record<string, unknown>>}>}}
 *   deterministic record identifier, the complete frozen record, and detached
 *   `memory.put` arguments for the existing proposal route.
 * @throws {KiraStageError} when the candidate is not one closed bounded
 *   lossless-JSON record.
 */
export function stageKiraMemoryRecord(input) {
  const identity = readCandidate(input)
  const recordId = recordIdOf(identity)
  const record = Object.freeze({
    domain: identity.domain,
    grantsAuthority: identity.grantsAuthority,
    recordId,
    subject: identity.subject,
    kind: identity.kind,
    source: identity.source,
    content: identity.content,
    links: identity.links,
    privacy: identity.privacy,
    createdAt: identity.createdAt,
    ...('transform' in identity ? { transform: identity.transform } : {}),
  })
  return Object.freeze({
    recordId,
    record,
    memoryPut: Object.freeze({ key: recordId, value: record }),
  })
}

/**
 * Re-check one stored value against the deterministic record contract.
 *
 * Digest is identity: a record is verified only when its own `recordId`
 * recomputes from its other fields. Verification never throws for bad data
 * and never proves authorization or Aura inclusion.
 *
 * @param {unknown} value - stored value read back from governed memory.
 * @returns {{verified: true, record: Readonly<Record<string, unknown>>} | {verified: false, reason: 'malformed' | 'identity-mismatch'}}
 *   the detached re-staged record, or the named verification failure.
 */
export function verifyKiraMemoryRecord(value) {
  let fields
  try {
    fields = readClosedObject(value, RECORD_FIELDS, ['transform'], 'record')
  } catch {
    // readClosedObject throws only KiraStageError; unreadable means malformed.
    return { verified: false, reason: 'malformed' }
  }
  if (fields.domain !== KIRA_RECORD_DOMAIN || fields.grantsAuthority !== false
    || typeof fields.recordId !== 'string') {
    return { verified: false, reason: 'malformed' }
  }
  let staged
  try {
    staged = stageKiraMemoryRecord({
      subject: fields.subject,
      kind: fields.kind,
      source: fields.source,
      content: fields.content,
      links: fields.links,
      privacy: fields.privacy,
      createdAt: fields.createdAt,
      ...('transform' in fields ? { transform: fields.transform } : {}),
    })
  } catch {
    // stageKiraMemoryRecord throws only KiraStageError; refusal means malformed.
    return { verified: false, reason: 'malformed' }
  }
  if (staged.recordId !== fields.recordId) {
    return { verified: false, reason: 'identity-mismatch' }
  }
  return { verified: true, record: staged.record }
}
