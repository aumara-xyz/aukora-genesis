/**
 * The KIRA memory artifact verifier for one settled governed `memory.put`.
 *
 * It reads one self-contained artifact and a caller-supplied trusted chain
 * head, and recomputes every derivable fact from the artifact's own bytes: the
 * KIRA record identifier, the content-addressed object body and its digest,
 * the Aura chain link by link, and the settlement entry that binds the two. It
 * imports no broker, issuer, Aura, or store code. It does reuse KIRA's current
 * record verifier and the shared canonical JSON encoder, so record identity is
 * not independently reimplemented here. Aura entry hashing and chain parsing
 * are restated locally.
 *
 * Three protocol constants are assumed out of band and are not derived from the
 * artifact: the Aura record domain separator {@link AURA_RECORD_DOMAIN}, the
 * canonical JSON encoding of a hash preimage, and the chain line encoding — one
 * `JSON.stringify` of the entry per line, which is what lets the bytes of a line
 * be compared against the value its hash covers. A producer that changes any of
 * the three produces artifacts this verifier refuses.
 *
 * The function is total: every input, hostile or not, returns one closed
 * verdict. It never throws and never partially reports.
 *
 * @module @aukora/verifier/kira-memory-artifact-verifier
 */
import { createHash } from 'node:crypto'
import { types } from 'node:util'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { verifyKiraMemoryRecord } from '../kira/stage.mjs'

/** The artifact kind this verifier accepts; a different kind is refused, never guessed. */
export const KIRA_MEMORY_ARTIFACT_KIND = 'aukora:kira-memory-artifact:v1'

/**
 * Aura's entry-preimage domain separator, restated here rather than imported.
 * The verifier must recompute the chain under the protocol's rule, not under
 * whatever rule the installed record module currently implements.
 */
export const AURA_RECORD_DOMAIN = 'aukora:aura-record:v1'

/** Emission order of the verdict rows; a complete verdict carries all nine. */
export const KIRA_MEMORY_ARTIFACT_CHECKS = Object.freeze([
  'inputs',
  'record-identity',
  'key-binds-record',
  'object-body',
  'content-address',
  'chain',
  'settlement-entry',
  'head-anchor',
  'recall-honesty',
])

/** Every named refusal this module and its CLI can report. */
export const KIRA_MEMORY_ARTIFACT_REFUSE = Object.freeze({
  ARTIFACT_NOT_PLAIN: 'artifact-not-plain',
  ARTIFACT_NOT_JSON_DATA: 'artifact-not-json-data',
  ARTIFACT_FIELD_UNKNOWN: 'artifact-field-unknown',
  ARTIFACT_FIELD_MISSING: 'artifact-field-missing',
  ARTIFACT_FIELD_INVALID: 'artifact-field-invalid',
  ARTIFACT_KIND_UNKNOWN: 'artifact-kind-unknown',
  ARTIFACT_UNREADABLE: 'artifact-unreadable',
  ARTIFACT_NOT_JSON: 'artifact-not-json',
  OPTIONS_NOT_PLAIN: 'options-not-plain',
  OPTIONS_FIELD_UNKNOWN: 'options-field-unknown',
  TRUSTED_HEAD_MISSING: 'trusted-head-missing',
  TRUSTED_HEAD_NOT_HEX: 'trusted-head-not-hex',
  RECORD_MALFORMED: 'record-malformed',
  RECORD_IDENTITY_MISMATCH: 'record-identity-mismatch',
  KEY_NOT_RECORD_ID: 'key-not-record-id',
  OBJECT_BODY_UNPARSEABLE: 'object-body-unparseable',
  OBJECT_BODY_NOT_CANONICAL: 'object-body-not-canonical',
  OBJECT_BODY_MISMATCH: 'object-body-mismatch',
  OBJECT_BODY_NOT_RECORD: 'object-body-not-record',
  OBJECT_ADDRESS_MISMATCH: 'object-address-mismatch',
  CONTENT_DIGEST_MISMATCH: 'content-digest-mismatch',
  PROJECTION_KEY_MISMATCH: 'projection-key-mismatch',
  CHAIN_TRUNCATED: 'chain-truncated',
  CHAIN_EMPTY: 'chain-empty',
  CHAIN_UNPARSEABLE: 'chain-unparseable',
  CHAIN_NOT_CANONICAL: 'chain-not-canonical',
  CHAIN_RESERVED_FIELD: 'chain-reserved-field',
  CHAIN_BROKEN_LINK: 'chain-broken-link',
  CHAIN_TAMPERED: 'chain-tampered',
  SETTLEMENT_ABSENT: 'settlement-absent',
  HEAD_NOT_AS_CLAIMED: 'head-not-as-claimed',
  HEAD_MISMATCH: 'head-mismatch',
  RECALL_STATUS_UNKNOWN: 'recall-status-unknown',
  RECALL_REASON_MISSING: 'recall-reason-missing',
  RECALL_REASON_UNKNOWN: 'recall-reason-unknown',
  RECALL_LIES: 'recall-lies',
  VERIFIER_INTERNAL_REFUSAL: 'verifier-internal-refusal',
  USAGE: 'usage',
})

/**
 * What an `ok: true` verdict does NOT establish. Carried in every verdict so a
 * reader never has to look the limits up somewhere else.
 */
export const KIRA_MEMORY_ARTIFACT_CEILING = Object.freeze([
  'KIRA record identity and canonical JSON are checked through shared production modules, not an independent implementation',
  'no signature is checked: the settlement receipt is signed by the broker and is never persisted, so entry.receiptSha256 commits to bytes this verifier cannot reconstruct and cannot check without both the receipt and a pinned broker public key',
  'no authorization is proven: no grant signature is retained anywhere, so entry.nonce shows which nonce was spent and nothing about whether a valid root-signed grant existed',
  'no human approval is proven: approval happens at the issuer and leaves no artifact in this evidence',
  'no latestness is proven: the trusted head fixes one point in the chain, and nothing here shows that point is the current head',
  'no protection against a coherent same-uid rewrite: a process that can rewrite the chain and also choose the delivered trusted head defeats the anchor entirely',
  'no filesystem facts are checked: entry.path, entry.inode, and entry.mtimeNs are observations, not functions of content, and are not reproducible from an artifact',
  'no confinement is attested: entry.confinement is the broker self-report about its own euid, state ownership, and seal class',
  'recall honesty is bounded by this artifact: a found reply may name further records, and those are checked only for recomputed identity and query fit — the verifier has no evidence about what else the store held',
  'no on-disk byte fidelity beyond the supplied bytes: the artifact is a copy, and this verifier attests to the copy it was given',
])

/**
 * Names the entry envelope and the hash preimage own. A body carrying one
 * cannot mean what it says, because the line would state a value the digest
 * does not cover. Mirrors the producer's own reserved-name refusal in
 * `aukora/aura/record.mjs`. The refusal raised here is deliberately a different
 * mark from the producer's `record:reserved-field`, which stays SUBJECT_ONLY
 * because no chain content can produce it.
 */
const RESERVED_ENTRY_NAMES = Object.freeze(['hash', 'prev', 'domain'])

const SHA256_HEX = /^[0-9a-f]{64}$/
const ARTIFACT_FIELDS = Object.freeze(['kind', 'record', 'memoryPut', 'object', 'projection', 'aura', 'head', 'recall'])
const RECALL_STATES = Object.freeze(['found', 'empty', 'undetermined'])
const UNDETERMINED_REASONS = Object.freeze([
  'memory-unavailable',
  'memory-corrupt',
  'memory-unverified',
])
const MAX_SNAPSHOT_DEPTH = 256
const MAX_SNAPSHOT_NODES = 200_000

/**
 * Name the first field outside one writer-owned record field set.
 * @param {Record<string, unknown>} record - detached record to inspect.
 * @param {readonly string[]} allowed - exact fields the writer can emit.
 * @returns {string | null} the first unknown field, or null when the record is closed.
 */
function firstUnknownField(record, allowed) {
  return Object.keys(record).find(key => !allowed.includes(key)) ?? null
}

/**
 * Read one plain data record without invoking accessors or entering a proxy.
 * @param {unknown} value - candidate from an untrusted artifact.
 * @returns {Record<string, unknown> | null} detached own data-property values, or null when the value is not one plain record.
 */
function readPlain(value) {
  // isProxy runs before Array.isArray: IsArray on a revoked proxy throws an
  // incidental TypeError, and this module must produce only named refusals.
  if (value === null || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return null
  const result = /** @type {Record<string, unknown>} */ ({})
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return null
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) return null
    // defineProperty, never assignment: `result.__proto__ = v` reaches the
    // Object.prototype setter, silently dropping the field and retargeting the
    // prototype. JSON.parse makes `__proto__` a real own key, so assignment
    // here would hide from every downstream check a field KIRA itself refuses.
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    })
  }
  return result
}

/**
 * Detach one bounded lossless-JSON value without invoking accessors.
 *
 * Everything downstream of this function operates on inert data, which is what
 * makes canonical encoding, hashing, and comparison total operations.
 *
 * @param {unknown} value - candidate node.
 * @param {WeakSet<object>} ancestors - objects on the current descent path.
 * @param {{nodes: number}} budget - total visited-node allowance.
 * @param {number} depth - current nesting depth.
 * @returns {{ok: true, value: unknown} | {ok: false, detail: string}} the detached copy, or the named reason it is not JSON data.
 */
function snapshotJsonData(value, ancestors, budget, depth) {
  budget.nodes += 1
  if (budget.nodes > MAX_SNAPSHOT_NODES) return { ok: false, detail: 'value exceeds the node limit' }
  if (depth > MAX_SNAPSHOT_DEPTH) return { ok: false, detail: 'value exceeds the depth limit' }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return { ok: true, value }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) return { ok: false, detail: 'value contains a non-JSON number' }
    return { ok: true, value }
  }
  if (typeof value !== 'object' || types.isProxy(value)) return { ok: false, detail: 'value is not lossless JSON data' }
  const node = /** @type {object} */ (value)
  if (ancestors.has(node)) return { ok: false, detail: 'value contains a cycle' }
  ancestors.add(node)
  try {
    if (Array.isArray(node)) {
      if (Object.getPrototypeOf(node) !== Array.prototype) return { ok: false, detail: 'array carries a custom prototype' }
      const keys = Reflect.ownKeys(node)
      const expected = [...Array.from({ length: node.length }, (_, index) => String(index)), 'length']
      if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        return { ok: false, detail: 'array carries fields outside its dense elements' }
      }
      const items = []
      for (let index = 0; index < node.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(node, String(index))
        if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
          return { ok: false, detail: 'array is not a dense data array' }
        }
        const item = snapshotJsonData(descriptor.value, ancestors, budget, depth + 1)
        if (!item.ok) return item
        items.push(item.value)
      }
      return { ok: true, value: items }
    }
    const record = readPlain(node)
    if (record === null) return { ok: false, detail: 'object is not one plain data record' }
    const result = /** @type {Record<string, unknown>} */ ({})
    for (const key of Object.keys(record)) {
      const child = snapshotJsonData(record[key], ancestors, budget, depth + 1)
      if (!child.ok) return child
      Object.defineProperty(result, key, { configurable: true, enumerable: true, value: child.value, writable: true })
    }
    return { ok: true, value: result }
  } finally {
    ancestors.delete(node)
  }
}

/**
 * @param {unknown} value - candidate JSON text.
 * @returns {{ok: true, value: unknown} | {ok: false}} the parsed and detached value, or a parse refusal.
 */
function parseJsonData(value) {
  if (typeof value !== 'string') return { ok: false }
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    // JSON.parse throws only SyntaxError here; an unparseable line is a refusal.
    return { ok: false }
  }
  const snapshot = snapshotJsonData(parsed, new WeakSet(), { nodes: 0 }, 0)
  return snapshot.ok ? { ok: true, value: snapshot.value } : { ok: false }
}

/**
 * The Aura entry hash, recomputed under the protocol rule.
 * @param {string} prev - the predecessor's hash, or the record domain at genesis.
 * @param {Record<string, unknown>} fields - the entry body without `hash` and `prev`.
 * @returns {string} lowercase hex digest.
 */
function auraEntryHash(prev, fields) {
  return createHash('sha256')
    // The domain is written after the spread so an entry body carrying its own
    // `domain` field cannot shadow the separator. canonicalJSON sorts, so this
    // changes no digest for a body without that field.
    .update(canonicalJSON({ prev, ...fields, domain: AURA_RECORD_DOMAIN }), 'utf8')
    .digest('hex')
}

/**
 * Walk the chain text: exactly one terminal newline, one JSON object per line,
 * no empty lines, each line the producer's `JSON.stringify` encoding of the
 * entry it parses to, every `prev` links, every hash recomputes.
 * @param {string} text - the exact `aura.jsonl` bytes as UTF-8 text.
 * @returns {{ok: boolean, reason: string | null, line: number, entries: Array<Record<string, unknown>>, head: string | null}}
 *   the verified prefix, its head, and the first named break.
 */
function walkChain(text) {
  const entries = []
  if (text !== '' && !text.endsWith('\n')) {
    return { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_TRUNCATED, line: 0, entries, head: null }
  }
  if (text === '') {
    return { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_EMPTY, line: 0, entries, head: null }
  }
  const lines = text.slice(0, -1).split('\n')
  const blankLine = lines.indexOf('')
  if (blankLine !== -1) {
    return {
      ok: false,
      reason: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_NOT_CANONICAL,
      line: blankLine + 1,
      entries,
      head: null,
    }
  }
  let prev = AURA_RECORD_DOMAIN
  let head = null
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseJsonData(lines[index])
    const entry = parsed.ok ? readPlain(parsed.value) : null
    if (entry === null) {
      return { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_UNPARSEABLE, line: index + 1, entries, head }
    }
    // The hash below covers the parse result, not these bytes: `JSON.parse`
    // keeps the last of two duplicate keys, so a line reading
    // `"verdict":"refused","verdict":"settled"` rehashes clean and anchors to
    // the genuine head while a human or any first-wins reader sees the decoy.
    // `entry` re-serializes byte-identically to the raw parse result, because
    // readPlain and snapshotJsonData rebuild in own-key order, the order
    // `JSON.stringify` itself emits.
    if (JSON.stringify(entry) !== lines[index]) {
      return { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_NOT_CANONICAL, line: index + 1, entries, head }
    }
    const { hash, prev: link, ...fields } = entry
    // `domain` is written into the preimage AFTER the body spread, so a
    // `domain` key on the wire is discarded before hashing: the stored hash,
    // every link, and the trusted head all match a record that never carried
    // it. This is the one edit the head anchor cannot see, and this verifier
    // requires a trusted head precisely because self-consistency proves
    // nothing — so the anchor has to be backed by refusing the name. The
    // producer refuses to emit it (`record:reserved-field`); this reader
    // refuses to accept it. Ordinary extra fields stay covered by the digest
    // and break the hash below.
    if (RESERVED_ENTRY_NAMES.some(reserved => Object.hasOwn(fields, reserved))) {
      return { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_RESERVED_FIELD, line: index + 1, entries, head }
    }
    if (link !== prev) {
      return { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_BROKEN_LINK, line: index + 1, entries, head }
    }
    if (auraEntryHash(/** @type {string} */ (link), fields) !== hash) {
      return { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_TAMPERED, line: index + 1, entries, head }
    }
    prev = /** @type {string} */ (hash)
    head = /** @type {string} */ (hash)
    entries.push(entry)
  }
  return { ok: true, reason: null, line: 0, entries, head }
}

/**
 * @param {string} reason - the named refusal.
 * @param {string} detail - what was wrong, without echoing artifact data wholesale.
 * @returns {{ok: false, reason: string, detail: string}} one input refusal.
 */
function inputRefusal(reason, detail) {
  return { ok: false, reason, detail }
}

/**
 * Validate the artifact and the trusted head, and detach everything downstream reads.
 * @param {unknown} artifact - the self-contained artifact.
 * @param {unknown} options - the caller's out-of-band inputs.
 * @returns {{ok: true, artifact: Record<string, unknown>, trustedHead: string} | {ok: false, reason: string, detail: string}}
 *   the detached inputs, or the first named input refusal.
 */
function readInputs(artifact, options) {
  const settings = options === undefined ? {} : readPlain(options)
  if (settings === null) return inputRefusal(KIRA_MEMORY_ARTIFACT_REFUSE.OPTIONS_NOT_PLAIN, 'options must be one plain data record')
  const unknownOption = firstUnknownField(settings, ['trustedHead'])
  if (unknownOption !== null) {
    return inputRefusal(KIRA_MEMORY_ARTIFACT_REFUSE.OPTIONS_FIELD_UNKNOWN, 'options carries a field outside trustedHead')
  }
  if (!('trustedHead' in settings)) {
    return inputRefusal(KIRA_MEMORY_ARTIFACT_REFUSE.TRUSTED_HEAD_MISSING, 'a trusted chain head is required; self-consistency alone proves nothing')
  }
  const trustedHead = settings.trustedHead
  if (typeof trustedHead !== 'string' || !SHA256_HEX.test(trustedHead)) {
    return inputRefusal(KIRA_MEMORY_ARTIFACT_REFUSE.TRUSTED_HEAD_NOT_HEX, 'options.trustedHead must be a lowercase 64-character sha256 hex digest')
  }
  const detached = snapshotJsonData(artifact, new WeakSet(), { nodes: 0 }, 0)
  if (!detached.ok) return inputRefusal(KIRA_MEMORY_ARTIFACT_REFUSE.ARTIFACT_NOT_JSON_DATA, detached.detail)
  const root = readPlain(detached.value)
  if (root === null) return inputRefusal(KIRA_MEMORY_ARTIFACT_REFUSE.ARTIFACT_NOT_PLAIN, 'artifact must be one plain data record')
  for (const key of Object.keys(root)) {
    if (!ARTIFACT_FIELDS.includes(key)) {
      return inputRefusal(KIRA_MEMORY_ARTIFACT_REFUSE.ARTIFACT_FIELD_UNKNOWN, `artifact carries a field outside ${ARTIFACT_FIELDS.join(', ')}`)
    }
  }
  for (const key of ARTIFACT_FIELDS) {
    if (!(key in root)) return inputRefusal(KIRA_MEMORY_ARTIFACT_REFUSE.ARTIFACT_FIELD_MISSING, `artifact must carry ${key}`)
  }
  if (root.kind !== KIRA_MEMORY_ARTIFACT_KIND) {
    return inputRefusal(KIRA_MEMORY_ARTIFACT_REFUSE.ARTIFACT_KIND_UNKNOWN, `artifact.kind must be ${KIRA_MEMORY_ARTIFACT_KIND}`)
  }
  const invalid = readArtifactFields(root)
  if (invalid !== null) return inputRefusal(invalid.reason, invalid.detail)
  return { ok: true, artifact: root, trustedHead }
}

/**
 * Require the field types the nine checks read, so no check has to defend itself.
 * @param {Record<string, unknown>} root - the detached artifact.
 * @returns {{reason: string, detail: string} | null} the first invalid-field refusal, or null when every field is usable.
 */
function readArtifactFields(root) {
  /** @param {string} detail */
  const invalid = detail => ({ reason: KIRA_MEMORY_ARTIFACT_REFUSE.ARTIFACT_FIELD_INVALID, detail })
  /** @param {string} detail */
  const unknown = detail => ({ reason: KIRA_MEMORY_ARTIFACT_REFUSE.ARTIFACT_FIELD_UNKNOWN, detail })
  if (readPlain(root.record) === null) return invalid('artifact.record must be one plain data record')
  const memoryPut = readPlain(root.memoryPut)
  if (memoryPut === null) return invalid('artifact.memoryPut must be one plain data record')
  if (firstUnknownField(memoryPut, ['key', 'value']) !== null) return unknown('artifact.memoryPut carries a field outside key, value')
  if (typeof memoryPut.key !== 'string' || !('value' in memoryPut)) return invalid('artifact.memoryPut must carry a string key and a value')
  const object = readPlain(root.object)
  if (object === null) return invalid('artifact.object must be one plain data record')
  if (firstUnknownField(object, ['name', 'body']) !== null) return unknown('artifact.object carries a field outside name, body')
  if (typeof object.name !== 'string' || typeof object.body !== 'string') return invalid('artifact.object must carry a string name and string body')
  const projection = readPlain(root.projection)
  if (projection === null) return invalid('artifact.projection must be one plain data record')
  if (firstUnknownField(projection, ['key', 'contentSha256']) !== null) {
    return unknown('artifact.projection carries a field outside key, contentSha256')
  }
  if (typeof projection.key !== 'string' || typeof projection.contentSha256 !== 'string') {
    return invalid('artifact.projection must carry a string key and string contentSha256')
  }
  if (typeof root.aura !== 'string') return invalid('artifact.aura must be the exact aura.jsonl text')
  if (typeof root.head !== 'string') return invalid('artifact.head must be the producer-claimed chain head')
  const recall = readPlain(root.recall)
  if (recall === null) return invalid('artifact.recall must be one plain data record')
  const query = readPlain(recall.query)
  if (query === null || typeof query.subject !== 'string') return invalid('artifact.recall.query must carry a string subject')
  if ('kind' in query && typeof query.kind !== 'string') return invalid('artifact.recall.query.kind must be a string when present')
  // Closed like every other artifact record: a field this verifier does not
  // read is a field a producer could carry past it, and the answer set is
  // decided from subject and kind alone.
  for (const key of Object.keys(query)) {
    if (key !== 'subject' && key !== 'kind') return unknown('artifact.recall.query carries a field outside subject, kind')
  }
  if (typeof recall.status !== 'string') return invalid('artifact.recall.status must be a string')
  const recallFields = recall.status === 'found'
    ? ['query', 'status', 'records']
    : recall.status === 'empty'
      ? ['query', 'status']
      : recall.status === 'undetermined'
        ? ['query', 'status', 'reason']
        : ['query', 'status', 'records', 'reason']
  if (firstUnknownField(recall, recallFields) !== null) {
    return unknown(`artifact.recall carries a field outside ${recallFields.join(', ')}`)
  }
  if ('records' in recall && !Array.isArray(recall.records)) return invalid('artifact.recall.records must be an array when present')
  if ('reason' in recall && typeof recall.reason !== 'string') return invalid('artifact.recall.reason must be a string when present')
  return null
}

/**
 * @param {string} check - the row's check name.
 * @param {boolean} ok - the predicate's verdict.
 * @param {string} detail - what the predicate compared.
 * @param {string} [reason] - the named refusal, present only on a failing row.
 * @returns {{check: string, ok: boolean, detail: string, reason?: string}} one verdict row.
 */
function row(check, ok, detail, reason) {
  return ok ? { check, ok, detail } : { check, ok, detail, reason: /** @type {string} */ (reason) }
}

/**
 * Decide whether one verified KIRA record answers the artifact's recall query.
 * @param {Record<string, unknown>} record - a verified KIRA record.
 * @param {Record<string, unknown>} query - the recall query's subject and optional kind.
 * @returns {boolean} whether the record is in the query's answer set.
 */
function matchesQuery(record, query) {
  return record.subject === query.subject && (!('kind' in query) || record.kind === query.kind)
}

/**
 * Judge the artifact's own recall claim against the record the artifact carries.
 *
 * The law is one-directional: a recall may under-claim (`undetermined` is
 * always admissible) and may never over-claim. A `found` reply must name only
 * records that recompute their own identifier and answer the query, and must
 * include the record this artifact proves was settled; an `empty` reply must
 * not be contradicted by that same record; and a stored record that does not
 * verify forces `undetermined`.
 *
 * A `found` reply may name further records: this artifact describes one
 * settlement and carries no evidence about the rest of the store, so those are
 * checked for well-formedness and query fit and nothing more.
 *
 * @param {Record<string, unknown>} recall - the detached recall claim.
 * @param {Record<string, unknown>} query - the recall query.
 * @param {unknown} storedValue - the value parsed out of the stored object body, or undefined when the body was unreadable.
 * @returns {{ok: boolean, reason: string | null, detail: string}} the recall verdict.
 */
function judgeRecall(recall, query, storedValue) {
  if (!RECALL_STATES.includes(/** @type {never} */ (recall.status))) {
    return { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_STATUS_UNKNOWN, detail: `recall.status must be one of ${RECALL_STATES.join(', ')}` }
  }
  const storedVerdict = verifyKiraMemoryRecord(storedValue)
  if (!storedVerdict.verified && recall.status !== 'undetermined') {
    return { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_LIES, detail: `the stored record does not verify (${storedVerdict.reason}), so recall must be undetermined` }
  }
  if (recall.status === 'undetermined') {
    if (typeof recall.reason !== 'string' || recall.reason === '') {
      return { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_REASON_MISSING, detail: 'an undetermined recall must name its reason' }
    }
    return UNDETERMINED_REASONS.includes(/** @type {never} */ (recall.reason))
      ? { ok: true, reason: null, detail: 'undetermined names one closed memory availability reason' }
      : { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_REASON_UNKNOWN, detail: `an undetermined recall reason must be one of ${UNDETERMINED_REASONS.join(', ')}` }
  }
  if (recall.status === 'empty') {
    return storedVerdict.verified && matchesQuery(storedVerdict.record, query)
      ? { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_LIES, detail: 'the artifact stores a verified record answering the query it reported empty' }
      : { ok: true, reason: null, detail: 'no record in this artifact answers the query' }
  }
  const claimed = Array.isArray(recall.records) ? recall.records : []
  if (claimed.length === 0) {
    return { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_LIES, detail: 'a found recall must name at least one record' }
  }
  // A `found` reply reached here only with a verified stored record: the
  // unverified case returned above.
  const storedCanonical = canonicalJSON(storedVerdict.record)
  let storedWasRecalled = false
  for (const candidate of claimed) {
    const verdict = verifyKiraMemoryRecord(candidate)
    if (!verdict.verified) {
      return { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_LIES, detail: `a recalled record does not verify (${verdict.reason})` }
    }
    if (!matchesQuery(verdict.record, query)) {
      return { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_LIES, detail: 'a recalled record does not answer the recall query' }
    }
    storedWasRecalled ||= canonicalJSON(verdict.record) === storedCanonical
  }
  if (!storedWasRecalled && matchesQuery(storedVerdict.record, query)) {
    return { ok: false, reason: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_LIES, detail: 'the recall omitted the settled record this artifact proves answers the query' }
  }
  return {
    ok: true,
    reason: null,
    detail: storedWasRecalled
      ? `all ${claimed.length} recalled records verify and answer the query, and the settled record is among them`
      : `all ${claimed.length} recalled records verify and answer the query; the settled record does not answer it`,
  }
}

/**
 * Verify one settled governed `memory.put` from its artifact bytes alone.
 *
 * The verdict is closed: `ok: true` with every row green, or `ok: false` with
 * `failed` naming the first red row's refusal. Rows are emitted in
 * {@link KIRA_MEMORY_ARTIFACT_CHECKS} order and every reachable row is evaluated, so
 * a failing verdict still shows what else was wrong. An input refusal is the
 * one exception: it returns a single `inputs` row, because nothing after it can
 * be read.
 *
 * @param {unknown} artifact - one self-contained artifact of kind
 *   {@link KIRA_MEMORY_ARTIFACT_KIND}, from an untrusted boundary.
 * @param {unknown} [options] - `{trustedHead}`, the out-of-band chain head this
 *   artifact must anchor to. It is required: a chain that only agrees with
 *   itself distinguishes nothing.
 * @returns {{ok: true, checks: ReadonlyArray<{check: string, ok: boolean, detail: string, reason?: string}>, ceiling: readonly string[]}
 *   | {ok: false, failed: string, checks: ReadonlyArray<{check: string, ok: boolean, detail: string, reason?: string}>, ceiling: readonly string[]}}
 *   one closed verdict; this function never throws.
 */
export function verifyKiraMemoryArtifact(artifact, options) {
  try {
    return judgeArtifact(artifact, options)
  } catch (error) {
    // Reaching here means a bound (recursion depth, allocation) was exceeded
    // inside an operation this module treats as total; report it, never throw.
    return {
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.VERIFIER_INTERNAL_REFUSAL,
      checks: [row('inputs', false, String(error?.message ?? error), KIRA_MEMORY_ARTIFACT_REFUSE.VERIFIER_INTERNAL_REFUSAL)],
      ceiling: KIRA_MEMORY_ARTIFACT_CEILING,
    }
  }
}

/**
 * The nine checks, evaluated in emission order over detached inputs.
 * @param {unknown} artifact - the artifact as supplied.
 * @param {unknown} options - the options as supplied.
 * @returns {{ok: true, checks: Array<{check: string, ok: boolean, detail: string, reason?: string}>, ceiling: readonly string[]}
 *   | {ok: false, failed: string, checks: Array<{check: string, ok: boolean, detail: string, reason?: string}>, ceiling: readonly string[]}}
 *   the closed verdict.
 */
function judgeArtifact(artifact, options) {
  const inputs = readInputs(artifact, options)
  if (!inputs.ok) {
    return {
      ok: false,
      failed: inputs.reason,
      checks: [row('inputs', false, inputs.detail, inputs.reason)],
      ceiling: KIRA_MEMORY_ARTIFACT_CEILING,
    }
  }
  const root = inputs.artifact
  const memoryPut = /** @type {{key: string, value: unknown}} */ (readPlain(root.memoryPut))
  const object = /** @type {{name: string, body: string}} */ (readPlain(root.object))
  const projection = /** @type {{key: string, contentSha256: string}} */ (readPlain(root.projection))
  const recall = /** @type {Record<string, unknown>} */ (readPlain(root.recall))
  const query = /** @type {Record<string, unknown>} */ (readPlain(recall.query))
  const checks = [row('inputs', true, `artifact ${KIRA_MEMORY_ARTIFACT_KIND} with a 64-hex trusted head`)]

  const record = verifyKiraMemoryRecord(root.record)
  checks.push(record.verified
    ? row('record-identity', true, 'recordId recomputes from the record fields')
    : row('record-identity', false, `recordId does not recompute from the record fields (${record.reason})`,
        record.reason === 'malformed' ? KIRA_MEMORY_ARTIFACT_REFUSE.RECORD_MALFORMED : KIRA_MEMORY_ARTIFACT_REFUSE.RECORD_IDENTITY_MISMATCH))

  const claimedRecordId = record.verified ? record.record.recordId : null
  checks.push(memoryPut.key === claimedRecordId
    ? row('key-binds-record', true, 'memory.put key === recomputed recordId')
    : row('key-binds-record', false, 'memory.put key === recomputed recordId', KIRA_MEMORY_ARTIFACT_REFUSE.KEY_NOT_RECORD_ID))

  const body = parseJsonData(object.body)
  const stored = body.ok ? readPlain(body.value) : null
  checks.push(judgeObjectBody(object.body, stored, memoryPut, record.verified ? record.record : null))

  const contentSha256 = createHash('sha256').update(object.body, 'utf8').digest('hex')
  checks.push(judgeContentAddress(contentSha256, object.name, projection, memoryPut.key))

  const chain = walkChain(/** @type {string} */ (root.aura))
  checks.push(chain.ok
    ? row('chain', true, `every one of ${chain.entries.length} entries links from the record domain and rehashes`)
    : row('chain', false, `chain breaks at line ${chain.line} of the supplied aura.jsonl`, /** @type {string} */ (chain.reason)))

  const settled = chain.entries.filter(entry => entry.verdict === 'settled'
    && entry.key === memoryPut.key
    && entry.contentSha256 === contentSha256)
  checks.push(settled.length > 0
    ? row('settlement-entry', true, `${settled.length} verified settled entry binds this key and content digest`)
    : row('settlement-entry', false, 'a verified settled entry must bind this key and recomputed content digest', KIRA_MEMORY_ARTIFACT_REFUSE.SETTLEMENT_ABSENT))

  checks.push(judgeHead(chain.head, /** @type {string} */ (root.head), inputs.trustedHead))

  const verdict = judgeRecall(recall, query, stored === null ? undefined : stored.value)
  checks.push(verdict.ok
    ? row('recall-honesty', true, verdict.detail)
    : row('recall-honesty', false, verdict.detail, /** @type {string} */ (verdict.reason)))

  const failed = checks.find(entry => !entry.ok)
  return failed === undefined
    ? { ok: true, checks, ceiling: KIRA_MEMORY_ARTIFACT_CEILING }
    : { ok: false, failed: /** @type {string} */ (failed.reason), checks, ceiling: KIRA_MEMORY_ARTIFACT_CEILING }
}

/**
 * The stored object body is the canonical encoding of the arguments and holds the record.
 * @param {string} text - the exact object-file text.
 * @param {Record<string, unknown> | null} stored - the parsed `{key, value}` body, or null when unparseable.
 * @param {{key: string, value: unknown}} memoryPut - the claimed effect arguments.
 * @param {Readonly<Record<string, unknown>> | null} record - the re-staged record, or null when it did not verify.
 * @returns {{check: string, ok: boolean, detail: string, reason?: string}} the `object-body` row.
 */
function judgeObjectBody(text, stored, memoryPut, record) {
  if (stored === null || typeof stored.key !== 'string' || !('value' in stored)) {
    return row('object-body', false, 'the object body must parse as one {key, value} record', KIRA_MEMORY_ARTIFACT_REFUSE.OBJECT_BODY_UNPARSEABLE)
  }
  if (`${canonicalJSON({ key: stored.key, value: stored.value })}\n` !== text) {
    return row('object-body', false, 'the object body must be the canonical encoding of its own {key, value} plus a terminal newline', KIRA_MEMORY_ARTIFACT_REFUSE.OBJECT_BODY_NOT_CANONICAL)
  }
  if (stored.key !== memoryPut.key || canonicalJSON(stored.value) !== canonicalJSON(memoryPut.value)) {
    return row('object-body', false, 'the object body must encode the claimed memory.put arguments', KIRA_MEMORY_ARTIFACT_REFUSE.OBJECT_BODY_MISMATCH)
  }
  if (record === null || canonicalJSON(stored.value) !== canonicalJSON(record)) {
    return row('object-body', false, 'the stored value must be the verified KIRA record', KIRA_MEMORY_ARTIFACT_REFUSE.OBJECT_BODY_NOT_RECORD)
  }
  return row('object-body', true, 'canonical body encodes the claimed arguments and stores the verified record')
}

/**
 * The object is stored at its own digest and the projection points there.
 * @param {string} contentSha256 - the digest recomputed over the object body.
 * @param {string} name - the object file's name as recorded in the artifact.
 * @param {{key: string, contentSha256: string}} projection - the key projection.
 * @param {string} key - the claimed memory.put key.
 * @returns {{check: string, ok: boolean, detail: string, reason?: string}} the `content-address` row.
 */
function judgeContentAddress(contentSha256, name, projection, key) {
  if (name !== `${contentSha256}.json`) {
    return row('content-address', false, 'the object must be stored at <sha256(body)>.json', KIRA_MEMORY_ARTIFACT_REFUSE.OBJECT_ADDRESS_MISMATCH)
  }
  if (projection.contentSha256 !== contentSha256) {
    return row('content-address', false, 'the projection must point at sha256(body)', KIRA_MEMORY_ARTIFACT_REFUSE.CONTENT_DIGEST_MISMATCH)
  }
  if (projection.key !== key) {
    return row('content-address', false, 'the projection must be filed under the claimed memory.put key', KIRA_MEMORY_ARTIFACT_REFUSE.PROJECTION_KEY_MISMATCH)
  }
  return row('content-address', true, 'object name, projection digest, and projection key all follow sha256(body)')
}

/**
 * The recomputed head matches the artifact's claim and the out-of-band anchor.
 * @param {string | null} computed - the head recomputed from the verified prefix.
 * @param {string} claimed - the head the artifact states.
 * @param {string} trusted - the head the caller obtained out of band.
 * @returns {{check: string, ok: boolean, detail: string, reason?: string}} the `head-anchor` row.
 */
function judgeHead(computed, claimed, trusted) {
  if (computed !== claimed) {
    return row('head-anchor', false, 'the recomputed head must equal the head the artifact claims', KIRA_MEMORY_ARTIFACT_REFUSE.HEAD_NOT_AS_CLAIMED)
  }
  if (computed !== trusted) {
    return row('head-anchor', false, 'the recomputed head must equal the trusted out-of-band head', KIRA_MEMORY_ARTIFACT_REFUSE.HEAD_MISMATCH)
  }
  return row('head-anchor', true, 'the recomputed head equals both the claimed head and the trusted out-of-band head')
}
