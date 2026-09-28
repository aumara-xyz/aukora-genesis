/**
 * Closed, canonical ActivationStatement and its load-bearing digest.
 *
 * One activation records the authority-relevant selections a parent measured
 * before any child started: the authority-core digest manifest, the assembled
 * composition, explicit executable and resolver anchors, the proposal cell,
 * the trusted renderer, the model-emission policy, and the issuer and broker
 * identities it will accept. The statement names all of them together so that
 * changing any recorded selection produces a different activation digest.
 * A manifest is not evidence that an unlisted dynamic or platform dependency
 * was measured; the launcher that constructs it owns that coverage claim.
 *
 * The digest is the only value that crosses a process frame. A consumer that
 * holds the digest can compare, never reconstruct: the statement itself never
 * travels, so a child cannot widen an activation by presenting a longer one.
 *
 * @module @aukora/activation/statement
 */
import { createHash } from 'node:crypto'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import {
  readClosedDataRecord,
  readDigest,
  readExactAtom,
  readNonNegativeInteger,
} from '../identity/validation.mjs'

/** Domain separating activation statements from every other AUKORA preimage. */
export const ACTIVATION_STATEMENT_DOMAIN = 'aukora:activation-statement:v1'

/** Domain separating the activation digest from the statement encoding itself. */
export const ACTIVATION_DIGEST_DOMAIN = 'aukora:activation-digest:v1'

/** Named refusals. Every rejection below names exactly one of these. */
export const ACTIVATION_REFUSE = Object.freeze({
  FIELDS_NOT_EXACT: 'activation:fields-not-exact',
  DOMAIN_MISMATCH: 'activation:domain-mismatch',
  EPOCH_INVALID: 'activation:epoch-invalid',
  DIGEST_INVALID: 'activation:digest-invalid',
  ATOM_INVALID: 'activation:atom-invalid',
  MANIFEST_INVALID: 'activation:digest-manifest-invalid',
  MANIFEST_EMPTY: 'activation:digest-manifest-empty',
  MANIFEST_OVERSIZE: 'activation:digest-manifest-oversize',
  FRAME_MALFORMED: 'activation:frame-malformed',
  FRAME_OVERSIZE: 'activation:frame-oversize',
  FRAME_NOT_CANONICAL: 'activation:frame-not-canonical',
  DIGEST_MISMATCH: 'activation:digest-mismatch',
})

const STATEMENT_FIELDS = Object.freeze([
  'brokerId',
  'closure',
  'compositionDigest',
  'coreManifest',
  'domain',
  'epoch',
  'issuerId',
  'modelEmissionPolicy',
  'proposalCellSha256',
  'rendererId',
])
const CLOSURE_FIELDS = Object.freeze(['executable', 'resolver'])
const MAX_MANIFEST_ENTRIES = 256
const MAX_MANIFEST_KEY_BYTES = 512
const MAX_ATOM_BYTES = 256
const MAX_FRAME_BYTES = 128 * 1024

/**
 * @typedef {Readonly<Record<string, string>>} ActivationDigestManifest
 * @typedef {Readonly<{executable: ActivationDigestManifest, resolver: ActivationDigestManifest}>} ActivationClosure
 * @typedef {Readonly<{
 *   domain: string,
 *   epoch: number,
 *   coreManifest: ActivationDigestManifest,
 *   compositionDigest: string,
 *   closure: ActivationClosure,
 *   proposalCellSha256: string,
 *   rendererId: string,
 *   modelEmissionPolicy: string,
 *   issuerId: string,
 *   brokerId: string,
 * }>} ActivationStatementV1
 */

/** A named activation refusal. */
export class ActivationError extends Error {
  /**
   * @param {string} reason - Stable refusal reason from `ACTIVATION_REFUSE`.
   * @param {string} detail - Human-readable detail.
   */
  constructor(reason, detail) {
    super(`${reason}: ${detail}`)
    this.name = 'ActivationError'
    this.reason = reason
  }
}

/**
 * Run one strict reader, converting its structural TypeError into a named refusal.
 * @param {string} reason - Refusal reason to attribute a rejection to.
 * @param {() => unknown} read - Strict reader invocation.
 * @returns {unknown} the reader's accepted value.
 */
function named(reason, read) {
  try {
    return read()
  } catch (error) {
    if (error instanceof ActivationError) throw error
    throw new ActivationError(reason, error instanceof Error ? error.message : String(error))
  }
}

/**
 * Read one closed path-to-digest manifest with at least one entry.
 *
 * Keys are exact atoms rather than absolute paths: an activation must not
 * change because a checkout moved. Absolute-path custody is measured against
 * the filesystem separately, by `@aukora/activation/measure`.
 *
 * @param {unknown} value - candidate manifest.
 * @param {string} label - diagnostic subject.
 * @returns {ActivationDigestManifest} frozen manifest.
 */
function readDigestManifest(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ActivationError(ACTIVATION_REFUSE.MANIFEST_INVALID, `${label} must be a plain data record`)
  }
  const keys = Object.keys(/** @type {Record<string, unknown>} */ (value))
  if (keys.length === 0) {
    throw new ActivationError(ACTIVATION_REFUSE.MANIFEST_EMPTY, `${label} must name at least one member`)
  }
  if (keys.length > MAX_MANIFEST_ENTRIES) {
    throw new ActivationError(ACTIVATION_REFUSE.MANIFEST_OVERSIZE, `${label} exceeds ${String(MAX_MANIFEST_ENTRIES)} members`)
  }
  const fields = /** @type {Record<string, unknown>} */ (
    named(ACTIVATION_REFUSE.MANIFEST_INVALID, () => readClosedDataRecord(value, keys, label))
  )
  /** @type {Record<string, string>} */
  const manifest = {}
  for (const key of keys) {
    named(ACTIVATION_REFUSE.MANIFEST_INVALID, () => readExactAtom(key, `${label} member name`, MAX_MANIFEST_KEY_BYTES))
    manifest[key] = /** @type {string} */ (
      named(ACTIVATION_REFUSE.DIGEST_INVALID, () => readDigest(fields[key], `${label}.${key}`))
    )
  }
  return Object.freeze(manifest)
}

/**
 * Validate one complete ActivationStatement and detach it from its input.
 *
 * Unknown and missing fields both refuse: the statement is closed, so a value
 * this version does not understand can never ride along unmeasured.
 *
 * @param {unknown} value - candidate statement.
 * @returns {ActivationStatementV1} frozen validated statement.
 */
export function parseActivationStatement(value) {
  const fields = /** @type {Record<string, unknown>} */ (
    named(ACTIVATION_REFUSE.FIELDS_NOT_EXACT, () => readClosedDataRecord(value, STATEMENT_FIELDS, 'activation statement'))
  )
  if (fields.domain !== ACTIVATION_STATEMENT_DOMAIN) {
    throw new ActivationError(ACTIVATION_REFUSE.DOMAIN_MISMATCH, `expected ${ACTIVATION_STATEMENT_DOMAIN}`)
  }
  const closureFields = /** @type {Record<string, unknown>} */ (
    named(ACTIVATION_REFUSE.FIELDS_NOT_EXACT, () => readClosedDataRecord(fields.closure, CLOSURE_FIELDS, 'activation statement.closure'))
  )
  return Object.freeze({
    domain: ACTIVATION_STATEMENT_DOMAIN,
    epoch: /** @type {number} */ (
      named(ACTIVATION_REFUSE.EPOCH_INVALID, () => readNonNegativeInteger(fields.epoch, 'activation statement.epoch'))
    ),
    coreManifest: readDigestManifest(fields.coreManifest, 'activation statement.coreManifest'),
    compositionDigest: /** @type {string} */ (
      named(ACTIVATION_REFUSE.DIGEST_INVALID, () => readDigest(fields.compositionDigest, 'activation statement.compositionDigest'))
    ),
    closure: Object.freeze({
      executable: readDigestManifest(closureFields.executable, 'activation statement.closure.executable'),
      resolver: readDigestManifest(closureFields.resolver, 'activation statement.closure.resolver'),
    }),
    proposalCellSha256: /** @type {string} */ (
      named(ACTIVATION_REFUSE.DIGEST_INVALID, () => readDigest(fields.proposalCellSha256, 'activation statement.proposalCellSha256'))
    ),
    rendererId: /** @type {string} */ (
      named(ACTIVATION_REFUSE.DIGEST_INVALID, () => readDigest(fields.rendererId, 'activation statement.rendererId'))
    ),
    modelEmissionPolicy: /** @type {string} */ (
      named(ACTIVATION_REFUSE.ATOM_INVALID, () => readExactAtom(fields.modelEmissionPolicy, 'activation statement.modelEmissionPolicy', MAX_ATOM_BYTES))
    ),
    issuerId: /** @type {string} */ (
      named(ACTIVATION_REFUSE.DIGEST_INVALID, () => readDigest(fields.issuerId, 'activation statement.issuerId'))
    ),
    brokerId: /** @type {string} */ (
      named(ACTIVATION_REFUSE.DIGEST_INVALID, () => readDigest(fields.brokerId, 'activation statement.brokerId'))
    ),
  })
}

/**
 * Encode one validated statement as its single canonical byte sequence.
 * @param {unknown} statement - candidate statement.
 * @returns {string} canonical JSON with lexicographically sorted keys.
 */
export function encodeActivationStatement(statement) {
  return canonicalJSON(parseActivationStatement(statement))
}

/**
 * Compute the one activation digest that binds every selection above.
 *
 * The domain prefix is carried in the hash input rather than the encoding, so
 * an activation preimage can never be read as some other AUKORA preimage that
 * happens to serialize identically.
 *
 * @param {unknown} statement - candidate statement.
 * @returns {string} lowercase SHA-256 activation digest.
 */
export function activationDigest(statement) {
  return createHash('sha256')
    .update(ACTIVATION_DIGEST_DOMAIN, 'utf8')
    .update(' ', 'utf8')
    .update(encodeActivationStatement(statement), 'utf8')
    .digest('hex')
}

/**
 * Read one statement from a wire frame that must already be canonical.
 *
 * A frame whose bytes differ from the canonical encoding of the value it
 * parses to refuses, so an alternate serialization of the same selections
 * cannot be presented as a second, differently-hashed activation.
 *
 * @param {unknown} text - candidate UTF-8 frame.
 * @returns {ActivationStatementV1} frozen validated statement.
 */
export function parseActivationStatementFrame(text) {
  if (typeof text !== 'string') {
    throw new ActivationError(ACTIVATION_REFUSE.FRAME_MALFORMED, 'activation frame must be a string')
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_FRAME_BYTES) {
    throw new ActivationError(ACTIVATION_REFUSE.FRAME_OVERSIZE, `activation frame exceeds ${String(MAX_FRAME_BYTES)} bytes`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ActivationError(ACTIVATION_REFUSE.FRAME_MALFORMED, error instanceof Error ? error.message : String(error))
  }
  const statement = parseActivationStatement(parsed)
  if (canonicalJSON(statement) !== text) {
    throw new ActivationError(ACTIVATION_REFUSE.FRAME_NOT_CANONICAL, 'activation frame is not the canonical encoding of its own value')
  }
  return statement
}

/**
 * Require one statement to carry an expected activation digest.
 * @param {unknown} statement - candidate statement.
 * @param {unknown} expected - expected lowercase SHA-256 activation digest.
 * @returns {string} the confirmed activation digest.
 */
export function assertActivationDigest(statement, expected) {
  const wanted = /** @type {string} */ (
    named(ACTIVATION_REFUSE.DIGEST_INVALID, () => readDigest(expected, 'expected activation digest'))
  )
  const actual = activationDigest(statement)
  if (actual !== wanted) {
    throw new ActivationError(ACTIVATION_REFUSE.DIGEST_MISMATCH, `statement digests to ${actual}`)
  }
  return actual
}
