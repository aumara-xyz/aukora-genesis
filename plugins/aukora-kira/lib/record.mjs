/**
 * The canonical KIRA memory record contract, staged into inert governed-memory
 * arguments.
 *
 * KIRA produces records. It does not approve, mint, settle, read a key, hold a
 * nonce book, contact an issuer, open broker state, or perform an effect. The
 * caller must submit the returned `memoryPut` arguments through the admitted
 * memory path; the deterministic `recordId` names the record and proves nothing
 * about authorization or Aura inclusion.
 *
 * Ported from the pinned Deep source `aukora/kira/stage.mjs` (sha256
 * `81ca34244419ce76a10f273664d97c5d834c5b16a03a8652963c181eefe8a288`) and the
 * two primitives its identifier depends on, `aukora/kernel-seed/canonical-json.mjs`
 * and `aukora/broker/effect-body.mjs`. The record contract, the refusal codes,
 * and the digest inputs are unchanged; `kiraRecordContentSha256` is moved here
 * from `aukora/kira/recall.mjs` because the object body and the identifier are
 * one contract and this plugin has no broker half. See `PROVENANCE.md`.
 *
 * @module @aukora/dsh-plugin-kira/record
 */
import { createHash } from 'node:crypto'
import { types } from 'node:util'

/** Fixed record domain; changing it changes every KIRA record identifier. */
export const KIRA_RECORD_DOMAIN = 'aukora:kira-memory-record:v0'

/**
 * The v1 record domain. A SEPARATE CONSTANT ON PURPOSE: `recordIdOf` below is a mutation anchor for
 * the out-of-process acceptance selftest, and moving the v0 separator would move every stored record's
 * identity and every digest-pinned fixture with it. v1 is additive; v0 is untouched.
 */
export const KIRA_RECORD_DOMAIN_V1 = 'aukora:kira-memory-record:v1'

/** The record formats this module can write. `v0` is the default so nothing flips by surprise. */
export const KIRA_RECORD_FORMATS = Object.freeze(['v0', 'v1'])

/**
 * THE EXACT ENCODERS, NAMED — because Genesis has more than one and they disagree.
 *
 * This module's own encoder accepts any finite JSON number, so `1.5` has a form here. The three other
 * canonicalizers in this tree do not: `plugins/aukora-aumlok/lib/canonical.mjs` and the composition gate
 * both refuse anything but a safe integer, and the vendored cold consumer's `jcs.py` refuses floats
 * outright ("integer-only JCS"). A digest that does not say WHICH encoder produced it is a digest a
 * second lane will recompute with the other rule and disagree about — so `canon` is a NAME rather than
 * a version number, and this table is the only place the names are defined.
 */
export const KIRA_CANONS = Object.freeze({
  // The v0 encoder: JSON.stringify's number form, so decimals are admissible.
  'aukora:canon-json:v0-ecmascript-number': 'v0',
  // The v1 encoder: safe integers only, matching the aumlok/gate/cold-consumer subset.
  'aukora:canon-json:v1-safe-integer': 'v1',
})

/** The v1 envelope's closed field set, and the only digest algorithm it may name. */
export const ENVELOPE_FIELDS = Object.freeze(['format', 'canon', 'algs'])
export const ENVELOPE_ALGS = Object.freeze({ digest: 'sha256' })

/** The envelope every v1 record carries. Closed, so a caller cannot invent a field into the preimage. */
export const KIRA_ENVELOPE_V1 = Object.freeze({
  format: 'v1',
  canon: 'aukora:canon-json:v1-safe-integer',
  algs: ENVELOPE_ALGS,
})

/**
 * Refusal-code prefix for staging. Not the model-facing tool name — that is
 * `kira_stage` (`KIRA_STAGE_TOOL_NAME` in `tools.mjs`).
 */
export const KIRA_STAGE_TOOL = 'kira.stage'

/**
 * Refusal-code prefix for recall. Not the model-facing tool name — that is
 * `kira_recall` (`KIRA_RECALL_TOOL_NAME` in `tools.mjs`).
 */
export const KIRA_RECALL_TOOL = 'kira.recall'

/** KIRA records are proposals and never authority artifacts. */
export const KIRA_STAGE_GRANTS_AUTHORITY = false

/** Closed record kinds from the KIRA memory specification. */
export const recordKind = Object.freeze([
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

/** Grammar of `memory.put` keys, restated from `aukora/broker/memory-put-args.mjs`. */
export const MEMORY_PUT_KEY_SHAPE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/

const SHA256_HEX = /^[0-9a-f]{64}$/
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/
const MAX_JSON_DEPTH = 64
const MAX_JSON_NODES = 10_000
const NON_JSON_TYPES = new Set(['undefined', 'function', 'symbol', 'bigint'])

const CANDIDATE_FIELDS = Object.freeze([
  'subject', 'kind', 'source', 'content', 'links', 'privacy', 'createdAt',
])
const RECORD_FIELDS = Object.freeze([
  'domain', 'grantsAuthority', 'recordId', ...CANDIDATE_FIELDS,
])

/**
 * Whether an admitted memory producer is configured for this build.
 *
 * Kira stages proposals and never writes. The durable path that would turn a
 * proposal into a settled record — the one that carries Aura evidence — does
 * not exist yet, and this build does NOT substitute the disposable test adapter
 * for it. Until that path lands, live memory settlement is UNAVAILABLE: a staged
 * record has been named, not stored, and no recall will find it. Reporting this
 * as a fact of the result rather than as prose is the point: an unavailable
 * producer must never read as a working one.
 */
/** Settlement status when no admitted memory owner is configured. */
export const KIRA_SETTLEMENT_UNAVAILABLE = Object.freeze({
  available: false,
  reason: 'no-admitted-memory-producer',
  detail: 'Staging names a record; it does not store it. No admitted memory owner is configured for this composition, so a staged record is not recallable. The disposable test adapter is test-only and never stands in for that path.',
})

/** Settlement status when an admitted memory owner IS configured. */
export const KIRA_SETTLEMENT_AVAILABLE = Object.freeze({
  available: true,
  reason: 'admitted-memory-owner-configured',
  detail: 'An admitted memory owner is configured. A staged record can be settled by presenting TWO operator documents: a one-use grant that binds the exact effect bytes, and a verified owner approval for exactly those bytes. Neither substitutes for the other, both are consumed once, and the accepted transition emits a signed receipt naming the approval and appends one Aura entry. Being available is not being authorized: this flag says a producer exists, and the approval plus the grant are what authorize one write.',
})

/**
 * The settlement status a composition reports, from whether it configured an
 * owner. Availability is a fact about configuration, never about a proposal.
 * @param {boolean} configured - whether an admitted memory owner is configured.
 * @returns {Readonly<Record<string, unknown>>} the status object carried by every stage result.
 */
export function settlementStatus(configured) {
  return configured ? KIRA_SETTLEMENT_AVAILABLE : KIRA_SETTLEMENT_UNAVAILABLE
}

/** Backwards-compatible alias for the unconfigured build. */
export const KIRA_SETTLEMENT = KIRA_SETTLEMENT_UNAVAILABLE

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
 * Encode one JSON-compatible value with lexicographically sorted object keys.
 * Restated from the pinned shared encoder so this package has no runtime
 * dependency on the authority tree.
 * @param {unknown} value - value to encode.
 * @returns {string} deterministic compact JSON.
 */
export function canonicalJSON(value) {
  if (value === undefined || NON_JSON_TYPES.has(typeof value)) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${Array.from(value).map(item => NON_JSON_TYPES.has(typeof item) ? 'null' : canonicalJSON(item)).join(',')}]`
  }
  const record = /** @type {Record<string, unknown>} */ (value)
  const keys = Object.keys(record).filter(key => !NON_JSON_TYPES.has(typeof record[key])).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`).join(',')}}`
}

/**
 * Encode one value the way the OTHER THREE canonicalizers in this tree do: safe integers only.
 *
 * WHY A SECOND ENCODER RATHER THAN A STRICTER FLAG. `canonicalJSON` above is the v0 rule and its bytes
 * are pinned by stored records and published fixtures; tightening it in place would move every v0
 * identity. So the integer-only rule is a second function, and a record DECLARES which one its
 * identifier used. The rule is restated from `plugins/aukora-aumlok/lib/canonical.mjs` and the gate's
 * `canonicalize` — both refuse a non-safe integer and negative zero — and it is restated rather than
 * imported because this package's write boundary admits no cross-plugin import.
 *
 * A DECIMAL IS REFUSED, NEVER ROUNDED. Rounding would give one value two canonical forms and make the
 * digest depend on which one a producer happened to pick, which is the failure the envelope exists to
 * prevent. A caller holding a decimal supplies its decimal STRING instead.
 * @param {unknown} value - value to encode.
 * @returns {string} deterministic compact JSON, integer-only.
 * @throws {KiraStageError} `content-unsupported-number` on a number this subset cannot carry.
 */
export function canonicalJSONSafeInteger(value) {
  if (value === undefined || NON_JSON_TYPES.has(typeof value)) return 'null'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      refuse('content-unsupported-number',
        'content carries a number outside the safe-integer subset this record format declares; send it as a string instead')
    }
    return String(value)
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${Array.from(value).map(item => (NON_JSON_TYPES.has(typeof item) ? 'null' : canonicalJSONSafeInteger(item))).join(',')}]`
  }
  const record = /** @type {Record<string, unknown>} */ (value)
  const keys = Object.keys(record).filter(key => !NON_JSON_TYPES.has(typeof record[key])).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJSONSafeInteger(record[key])}`).join(',')}}`
}

/**
 * The exact content-addressed object-body text for one `memory.put` pair.
 * @param {{key: string, value: unknown}} args - effect arguments.
 * @returns {string} the UTF-8 body text hashed, reviewed, and written.
 * @throws {TypeError} when the key grammar is invalid.
 */
export function memoryEffectBody(args) {
  if (!MEMORY_PUT_KEY_SHAPE.test(args.key)) throw new TypeError('memoryEffectBody: key-not-a-name')
  return `${canonicalJSON({ key: args.key, value: args.value })}\n`
}

/**
 * Compute the content-addressed object digest for one KIRA record.
 * @param {Readonly<Record<string, unknown>>} record - record whose `recordId` names the object key.
 * @returns {string} lowercase SHA-256 digest of the exact memory object bytes.
 */
export function kiraRecordContentSha256(record) {
  return createHash('sha256')
    .update(memoryEffectBody({ key: record.recordId, value: record }), 'utf8')
    .digest('hex')
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
 * @param {'v0'|'v1'} format - the record format this candidate is being staged as.
 * @returns {Record<string, unknown>} detached identity fields without recordId.
 */
function readCandidate(input, format) {
  const fields = readClosedObject(input, CANDIDATE_FIELDS, ['transform'], 'candidate')
  const subject = readName(fields.subject, 'subject')
  if (typeof fields.kind !== 'string' || !recordKind.includes(/** @type {never} */ (fields.kind))) {
    refuse('kind-invalid', `kind must be one of ${recordKind.join(', ')}`)
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
    domain: format === 'v1' ? KIRA_RECORD_DOMAIN_V1 : KIRA_RECORD_DOMAIN,
    grantsAuthority: KIRA_STAGE_GRANTS_AUTHORITY,
    // THE ENVELOPE IS IN THE PREIMAGE, so a record cannot declare one encoding and be identified under
    // another: the declaration and the identifier move together, and a verifier reading the envelope is
    // reading a field the digest already covers.
    ...(format === 'v1' ? { envelope: KIRA_ENVELOPE_V1 } : {}),
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
 * The v1 identifier: the bumped domain and the INTEGER-ONLY encoder its envelope names.
 *
 * A SECOND FUNCTION rather than a branch inside `recordIdOf`, because that function's body is the
 * mutation anchor the out-of-process acceptance selftest edits to prove identity still binds; a shared
 * body would make that control fire on the wrong rule.
 * @param {Record<string, unknown>} identity - detached identity fields including `envelope`.
 * @returns {string} deterministic domain-separated record identifier.
 */
function recordIdOfV1(identity) {
  const digest = createHash('sha256')
    .update(KIRA_RECORD_DOMAIN_V1, 'utf8')
    .update('\0', 'utf8')
    .update(canonicalJSONSafeInteger(identity), 'utf8')
    .digest('hex')
  return `kira:${digest}`
}

/**
 * Read the closed v1 envelope, or name the reason it is not one.
 *
 * A NAME IS RETURNED FOR EVERY FAILURE so a caller that cannot accept the envelope can say which rule
 * it broke. `malformed` is reserved for an envelope that is not an object at all, because a record
 * whose domain says v1 and which carries no envelope is a record from a format that does not exist.
 * @param {unknown} value - candidate envelope.
 * @returns {{ok: true} | {ok: false, reason: string}} the verdict.
 */
function readEnvelopeV1(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)) {
    return { ok: false, reason: 'malformed' }
  }
  const envelope = /** @type {Record<string, unknown>} */ (value)
  const own = Object.keys(envelope)
  if (own.length !== ENVELOPE_FIELDS.length || ENVELOPE_FIELDS.some(field => !own.includes(field))) {
    return { ok: false, reason: 'envelope-field-set' }
  }
  if (envelope.format !== 'v1') return { ok: false, reason: 'envelope-format-unknown' }
  const canon = envelope.canon
  // THE NAMED ENCODER MUST BE THIS FORMAT'S ENCODER. A v1 record that names the v0 canon names a real
  // encoder that computes a DIFFERENT digest for a value both accept — so accepting it would let a
  // record declare one rule and be verified under another. Refused, by the same name.
  if (typeof canon !== 'string' || !Object.hasOwn(KIRA_CANONS, canon) || KIRA_CANONS[canon] !== 'v1') {
    return { ok: false, reason: 'envelope-canon-unknown' }
  }
  const algs = envelope.algs
  if (algs === null || typeof algs !== 'object' || Array.isArray(algs)
    || Object.keys(algs).length !== 1 || /** @type {Record<string, unknown>} */ (algs).digest !== ENVELOPE_ALGS.digest) {
    return { ok: false, reason: 'envelope-algs-unsupported' }
  }
  return { ok: true }
}

/**
 * Convert one exact KIRA memory candidate into inert governed-memory arguments.
 *
 * The identifier hashes every record field except `recordId`, so it is stable
 * under object-key reordering and changes with any meaningful field change.
 * `createdAt` is caller-supplied canonical seconds-precision UTC data; no
 * local clock participates.
 *
 * @param {unknown} input - closed candidate with exactly `subject`, `kind`,
 *   `source`, `content`, `links`, `privacy`, `createdAt`, and optionally
 *   `transform`, from an untrusted boundary.
 * @param {{format?: 'v0'|'v1'}} [options] - the record format. `v0` (the default) keeps every stored
 *   record's identity exactly as it was; `v1` bumps the domain, carries the closed envelope, and
 *   encodes integer-only, so a decimal in content is refused by name.
 * @returns {{recordId: string, record: Readonly<Record<string, unknown>>, memoryPut: Readonly<{key: string, value: Readonly<Record<string, unknown>>}>}}
 *   deterministic record identifier, the complete frozen record, and detached
 *   `memory.put` arguments for the admitted memory path.
 * @throws {KiraStageError} when the candidate is not one closed bounded
 *   lossless-JSON record, or carries a number the chosen format cannot encode.
 */
export function stageKiraMemoryRecord(input, options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    refuse('format-unknown', 'the staging options must be one plain object')
  }
  const format = options.format ?? 'v0'
  if (!KIRA_RECORD_FORMATS.includes(/** @type {never} */ (format))) {
    refuse('format-unknown', `format must be one of ${KIRA_RECORD_FORMATS.join(', ')}`)
  }
  const identity = readCandidate(input, format)
  const recordId = format === 'v1' ? recordIdOfV1(identity) : recordIdOf(identity)
  const record = Object.freeze({
    domain: identity.domain,
    grantsAuthority: identity.grantsAuthority,
    recordId,
    ...(format === 'v1' ? { envelope: KIRA_ENVELOPE_V1 } : {}),
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
    fields = readClosedObject(value, RECORD_FIELDS, ['transform', 'envelope'], 'record')
  } catch {
    // readClosedObject throws only KiraStageError; unreadable means malformed.
    return { verified: false, reason: 'malformed' }
  }
  if (fields.grantsAuthority !== false || typeof fields.recordId !== 'string') {
    return { verified: false, reason: 'malformed' }
  }
  // ── THE LEGACY BRANCH, AND WHY IT IS A BRANCH RATHER THAN A DEFAULT ─────────────────────────────
  // A v0 record carries no envelope and was identified under the v0 domain with the ECMAScript-number
  // encoder. EVERY RECORD ALREADY IN A STORE IS ONE OF THESE, so this path is preserved exactly — the
  // same identifier rule, the same encoder — and a v1 record is verified only through its own branch.
  // A v0 record that has grown an envelope is refused rather than reinterpreted: an envelope is a
  // declaration about the encoding, and accepting one on a record whose identifier never covered it
  // would let a document describe itself as something its own digest disagrees with.
  let format
  if (fields.domain === KIRA_RECORD_DOMAIN) {
    if ('envelope' in fields) return { verified: false, reason: 'envelope-not-in-v0' }
    format = 'v0'
  } else if (fields.domain === KIRA_RECORD_DOMAIN_V1) {
    const envelope = readEnvelopeV1(fields.envelope)
    // A v1 domain with NO usable envelope is `malformed` — the format it names does not exist — while
    // an envelope that IS an envelope and names something unusable is refused by ITS OWN name.
    if (!envelope.ok) return { verified: false, reason: envelope.reason }
    format = 'v1'
  } else {
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
    }, { format })
  } catch {
    // A refusal here is a record whose content the declared format cannot encode — a decimal under an
    // integer-only envelope, for instance — and that is a record that does not verify.
    return { verified: false, reason: 'malformed' }
  }
  if (staged.recordId !== fields.recordId) {
    return { verified: false, reason: 'identity-mismatch' }
  }
  return { verified: true, record: staged.record }
}
