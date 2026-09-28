/**
 * The immutable approval artifact: one closed record carrying everything a
 * human is shown and everything the issuer independently rechecks before it
 * signs.
 *
 * The artifact is DATA, never authority. Holding one grants nothing. Its
 * value is that every party derives the same digest from the same bytes:
 * the trusted parent renders it, the issuer recomputes the operation, the
 * projection, and the digest from the artifact's own raw arguments, and a
 * mismatch anywhere refuses by name. Nothing here trusts a digest, a
 * projection, or a byte count supplied by the caller.
 *
 * The recomputation is what makes render-A/authorize-B impossible: the
 * issuer never displays or signs a projection it was handed, only the one it
 * derived itself from `operationArguments`.
 *
 * @module @aukora/approval/artifact
 */
import { createHash } from 'node:crypto'
import { types } from 'node:util'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { buildOperation, operationDigest } from '../broker/operation.mjs'
import { isExactMemoryPutArgs, KEY_SHAPE } from '../broker/memory-put-args.mjs'
import { COMPUTE_JOB, definitionDigest, MEMORY_PUT, WORKSPACE_PATCH } from '../broker/effect-definition.mjs'
import { isExactComputeJobArgs } from '../broker/compute-job-args.mjs'
import { isExactWorkspacePatchArgs } from '../broker/workspace-patch-args.mjs'
import { reviewProjectionLines } from '../broker/review.mjs'
import { readClosedDataRecord, readDigest, readNonNegativeInteger } from '../identity/validation.mjs'

/** Domain separating approval-artifact digests from every other AUKORA digest. */
export const APPROVAL_ARTIFACT_DOMAIN = 'aukora:approval-artifact:v1'

/** Domain separating the issuer's approval signature from grant v3/v4 messages. */
export const APPROVAL_SIGNED_DOMAIN = 'aukora:approval-artifact:v1:signed'

/** The only artifact version this module reads or produces. */
export const APPROVAL_ARTIFACT_VERSION = 1

/** The exact field inventory of one approval artifact. */
export const APPROVAL_ARTIFACT_FIELDS = Object.freeze([
  'version',
  'operationArguments',
  'operationCanonicalBytes',
  'operationDigest',
  'semanticProjection',
  'definitionId',
  'activationDigest',
  'occurrenceId',
  'expiry',
  'rendererId',
  'oneUse',
])

/**
 * Named approval refusals. Each names one cause; no two causes share a name,
 * so a caller can tell a truncated projection from a substituted renderer.
 */
export const REFUSE_APPROVAL = Object.freeze({
  MALFORMED: 'approval:artifact-malformed',
  VERSION_UNSUPPORTED: 'approval:version-unsupported',
  ARGUMENTS_NOT_EXACT: 'approval:arguments-not-exact',
  VALUE_NOT_JSON: 'approval:value-not-json',
  KEY_NOT_A_NAME: 'approval:key-not-a-name',
  ONE_USE_REQUIRED: 'approval:one-use-required',
  OCCURRENCE_MALFORMED: 'approval:occurrence-malformed',
  DISPLAY_TEXT_INVALID: 'approval:display-text-invalid',
  PROJECTION_MALFORMED: 'approval:projection-malformed',
  PROJECTION_OVERSIZE: 'approval:projection-oversize',
  PROJECTION_MISMATCH: 'approval:projection-mismatch',
  OPERATION_OVERSIZE: 'approval:operation-oversize',
  OPERATION_NOT_CANONICAL: 'approval:operation-not-canonical',
  OPERATION_BYTES_MISMATCH: 'approval:operation-bytes-mismatch',
  OPERATION_DIGEST_MISMATCH: 'approval:operation-digest-mismatch',
  DEFINITION_MISMATCH: 'approval:definition-mismatch',
  EXPIRY_MISMATCH: 'approval:expiry-mismatch',
  EXPIRY_MALFORMED: 'approval:expiry-malformed',
  DIGEST_MALFORMED: 'approval:digest-malformed',
  ARTIFACT_EXPIRED: 'approval:artifact-expired',
  TTL_UNBOUNDED: 'approval:ttl-unbounded',
  UNRENDERABLE: 'approval:unrenderable-operation',
  DIGEST_MISMATCH: 'approval:artifact-digest-mismatch',
})

/** Occurrence identifiers are 16 random bytes, lowercase hex. */
const OCCURRENCE_ID = /^[0-9a-f]{32}$/u

/**
 * Printable ASCII only. Every C0 and C1 control, DEL, ANSI introducer, bidi
 * override, zero-width joiner, and every other non-ASCII code point is
 * outside this class, so one test refuses the whole family rather than
 * enumerating escapes a new Unicode version could extend.
 */
const PRINTABLE_ASCII_LINE = /^[\x20-\x7e]*$/u

/** Projection line ceiling. A display the human cannot read whole is not review. */
export const MAX_PROJECTION_LINES = 64

/** Per-line byte ceiling, chosen so a rendered line fits an ordinary terminal history. */
export const MAX_PROJECTION_LINE_BYTES = 4096

/** Canonical operation-bytes ceiling. */
export const MAX_OPERATION_BYTES = 65536

/** Maximum nesting accepted before canonicalization. */
const MAX_JSON_DEPTH = 64

/** Maximum primitive and collection values accepted before canonicalization. */
const MAX_JSON_NODES = 4096

const APPROVAL_REFUSAL_NAMES = new Set(Object.values(REFUSE_APPROVAL))

/**
 * Return the closed approval refusal name carried by one thrown value.
 * Unknown exceptions become `approval:artifact-malformed`; wire callers never
 * receive implementation diagnostics or an unregistered refusal vocabulary.
 * @param {unknown} error - caught parser failure.
 * @returns {string} one {@link REFUSE_APPROVAL} value.
 */
export function approvalRefusalReason(error) {
  const message = String(error?.message ?? error)
  for (const reason of APPROVAL_REFUSAL_NAMES) {
    if (message === reason || message.startsWith(`${reason} (`)) return reason
  }
  return REFUSE_APPROVAL.MALFORMED
}

/**
 * Read one digest while keeping parser failures inside the approval vocabulary.
 * @param {unknown} value - candidate digest.
 * @param {string} label - diagnostic subject.
 * @returns {string} validated digest.
 */
function readApprovalDigest(value, label) {
  try {
    return readDigest(value, label)
  } catch {
    throw new TypeError(`${REFUSE_APPROVAL.DIGEST_MALFORMED} (${label})`)
  }
}

/**
 * Read one expiry while keeping parser failures inside the approval vocabulary.
 * @param {unknown} value - candidate unix-seconds value.
 * @param {string} label - diagnostic subject.
 * @returns {number} validated expiry.
 */
function readApprovalExpiry(value, label) {
  try {
    return readNonNegativeInteger(value, label)
  } catch {
    throw new TypeError(`${REFUSE_APPROVAL.EXPIRY_MALFORMED} (${label})`)
  }
}

/**
 * Detach and recursively freeze one exact JSON value without invoking user
 * accessors. Input objects may use `Object.prototype` or a null prototype and
 * are detached into frozen `Object.prototype` records. Arrays are dense,
 * every member is an enumerable data property, and values are limited to
 * null, booleans, strings, finite numbers other than negative zero, arrays, and
 * objects. Cycles, proxies, riders, sparse arrays, accessors, and non-JSON
 * primitives refuse.
 * @param {unknown} input - candidate JSON value.
 * @returns {unknown} recursively frozen detached value.
 * @throws {TypeError} `approval:value-not-json`.
 */
function readImmutableJSON(input) {
  const ancestors = new WeakSet()
  let nodes = 0

  /** @param {unknown} value @param {number} depth @returns {unknown} */
  const visit = (value, depth) => {
    nodes += 1
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      throw new TypeError(REFUSE_APPROVAL.VALUE_NOT_JSON)
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(REFUSE_APPROVAL.VALUE_NOT_JSON)
      return value
    }
    if (typeof value !== 'object' || types.isProxy(value)) {
      throw new TypeError(REFUSE_APPROVAL.VALUE_NOT_JSON)
    }
    if (ancestors.has(value)) throw new TypeError(REFUSE_APPROVAL.VALUE_NOT_JSON)
    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(REFUSE_APPROVAL.VALUE_NOT_JSON)
        if (value.length > MAX_JSON_NODES) throw new TypeError(REFUSE_APPROVAL.VALUE_NOT_JSON)
        const keys = Reflect.ownKeys(value)
        const expected = [...Array.from({ length: value.length }, (_, index) => String(index)), 'length']
        if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
          throw new TypeError(REFUSE_APPROVAL.VALUE_NOT_JSON)
        }
        const descriptors = Object.getOwnPropertyDescriptors(value)
        const detached = Array.from({ length: value.length }, (_, index) => {
          const descriptor = descriptors[String(index)]
          if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
            throw new TypeError(REFUSE_APPROVAL.VALUE_NOT_JSON)
          }
          return visit(descriptor.value, depth + 1)
        })
        return Object.freeze(detached)
      }
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(REFUSE_APPROVAL.VALUE_NOT_JSON)
      }
      const keys = Reflect.ownKeys(value)
      if (keys.length > MAX_JSON_NODES) throw new TypeError(REFUSE_APPROVAL.VALUE_NOT_JSON)
      if (keys.some(key => typeof key !== 'string')) throw new TypeError(REFUSE_APPROVAL.VALUE_NOT_JSON)
      const descriptors = Object.getOwnPropertyDescriptors(value)
      const detached = {}
      for (const key of /** @type {string[]} */ (keys).toSorted()) {
        const descriptor = descriptors[key]
        if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
          throw new TypeError(REFUSE_APPROVAL.VALUE_NOT_JSON)
        }
        Object.defineProperty(detached, key, {
          configurable: false,
          enumerable: true,
          value: visit(descriptor.value, depth + 1),
          writable: false,
        })
      }
      return Object.freeze(detached)
    } catch (error) {
      if (approvalRefusalReason(error) === REFUSE_APPROVAL.VALUE_NOT_JSON) throw error
      throw new TypeError(REFUSE_APPROVAL.VALUE_NOT_JSON)
    } finally {
      ancestors.delete(value)
    }
  }

  return visit(input, 0)
}

/**
 * Refuse anything that is not one exact printable-ASCII display line.
 * @param {unknown} value - candidate line.
 * @param {string} label - diagnostic subject.
 * @returns {string} the validated line.
 * @throws {TypeError} named {@link REFUSE_APPROVAL} refusal.
 */
function readDisplayLine(value, label) {
  if (typeof value !== 'string') {
    throw new TypeError(`${REFUSE_APPROVAL.DISPLAY_TEXT_INVALID} (${label}: must be a string)`)
  }
  if (!PRINTABLE_ASCII_LINE.test(value)) {
    throw new TypeError(`${REFUSE_APPROVAL.DISPLAY_TEXT_INVALID} (${label}: only printable ASCII is displayable)`)
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_PROJECTION_LINE_BYTES) {
    throw new TypeError(`${REFUSE_APPROVAL.DISPLAY_TEXT_INVALID} (${label}: exceeds ${MAX_PROJECTION_LINE_BYTES} bytes)`)
  }
  return value
}

/**
 * Read the semantic projection as a dense array of exact display lines.
 * @param {unknown} value - candidate projection.
 * @param {string} label - diagnostic subject.
 * @returns {readonly string[]} frozen projection lines.
 * @throws {TypeError} named {@link REFUSE_APPROVAL} refusal.
 */
function readProjection(value, label) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${REFUSE_APPROVAL.PROJECTION_MALFORMED} (${label}: must be an array)`)
  }
  if (value.length === 0 || value.length > MAX_PROJECTION_LINES) {
    throw new TypeError(`${REFUSE_APPROVAL.PROJECTION_OVERSIZE} (${label}: must carry 1 to ${MAX_PROJECTION_LINES} lines)`)
  }
  const keys = Reflect.ownKeys(value)
  const expected = [...Array.from({ length: value.length }, (_, index) => String(index)), 'length']
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${REFUSE_APPROVAL.PROJECTION_MALFORMED} (${label}: must be dense and carry no extra properties)`)
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const lines = Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)]
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(`${REFUSE_APPROVAL.PROJECTION_MALFORMED} (${label}[${index}]: must be an enumerable data property)`)
    }
    return readDisplayLine(descriptor.value, `${label}[${index}]`)
  })
  return Object.freeze(lines)
}

/** The closed field list each defined effect's approval arguments must carry. */
const OPERATION_ARGUMENT_FIELDS = Object.freeze({
  [MEMORY_PUT]: Object.freeze(['key', 'value']),
  [WORKSPACE_PATCH]: Object.freeze(['workspace', 'path', 'beforeSha256', 'content']),
  [COMPUTE_JOB]: Object.freeze(['endpoint', 'imageSha256', 'volumeSha256', 'decodeSha256', 'budgetSha256']),
})

/**
 * Detach the registered effect's exact arguments, refusing accessors, proxies, and
 * any alphabet the operation builder would not accept.
 * @param {unknown} value - candidate arguments.
 * @param {string} toolName - a registered effect name.
 * @returns {import('./artifact.mjs').ApprovalArguments} detached arguments.
 * @throws {TypeError} named {@link REFUSE_APPROVAL} refusal.
 */
function readOperationArguments(value, toolName) {
  if (!Object.hasOwn(OPERATION_ARGUMENT_FIELDS, toolName)) {
    throw new TypeError(REFUSE_APPROVAL.DEFINITION_MISMATCH)
  }
  let fields
  try {
    fields = readClosedDataRecord(value, OPERATION_ARGUMENT_FIELDS[toolName], 'approval artifact.operationArguments')
  } catch (error) {
    throw new TypeError(`${REFUSE_APPROVAL.ARGUMENTS_NOT_EXACT} (${String(error?.message ?? error)})`)
  }
  if (toolName === COMPUTE_JOB) {
    const args = {
      endpoint: fields.endpoint,
      imageSha256: fields.imageSha256,
      volumeSha256: fields.volumeSha256,
      decodeSha256: fields.decodeSha256,
      budgetSha256: fields.budgetSha256,
    }
    if (!isExactComputeJobArgs(args)) throw new TypeError(REFUSE_APPROVAL.ARGUMENTS_NOT_EXACT)
    return args
  }
  if (toolName === WORKSPACE_PATCH) {
    const args = { workspace: fields.workspace, path: fields.path, beforeSha256: fields.beforeSha256, content: fields.content }
    if (!isExactWorkspacePatchArgs(args)) throw new TypeError(REFUSE_APPROVAL.ARGUMENTS_NOT_EXACT)
    return args
  }
  const args = { key: fields.key, value: readImmutableJSON(fields.value) }
  if (!isExactMemoryPutArgs(args)) throw new TypeError(REFUSE_APPROVAL.ARGUMENTS_NOT_EXACT)
  if (!KEY_SHAPE.test(args.key)) throw new TypeError(REFUSE_APPROVAL.KEY_NOT_A_NAME)
  return args
}

/**
 * Validate one candidate approval artifact and return the frozen canonical
 * form. Every derived field is RECOMPUTED from `operationArguments` and
 * `expiry` and compared with what the candidate claimed, so a caller cannot
 * present one operation and describe another.
 * @param {unknown} input - candidate artifact from any source.
 * @returns {import('./artifact.mjs').ApprovalArtifact<import('./artifact.mjs').ApprovalArguments>} validated artifact.
 * @throws {TypeError} named {@link REFUSE_APPROVAL} refusal.
 */
export function parseApprovalArtifact(input) {
  let fields
  try {
    fields = readClosedDataRecord(input, APPROVAL_ARTIFACT_FIELDS, 'approval artifact')
  } catch (error) {
    throw new TypeError(`${REFUSE_APPROVAL.MALFORMED} (${String(error?.message ?? error)})`)
  }
  if (fields.version !== APPROVAL_ARTIFACT_VERSION) throw new TypeError(REFUSE_APPROVAL.VERSION_UNSUPPORTED)
  if (fields.oneUse !== true) throw new TypeError(REFUSE_APPROVAL.ONE_USE_REQUIRED)
  if (typeof fields.occurrenceId !== 'string' || !OCCURRENCE_ID.test(fields.occurrenceId)) {
    throw new TypeError(REFUSE_APPROVAL.OCCURRENCE_MALFORMED)
  }
  const definitionId = readApprovalDigest(fields.definitionId, 'approval artifact.definitionId')
  const toolName = [MEMORY_PUT, WORKSPACE_PATCH, COMPUTE_JOB].find(name => definitionDigest(name) === definitionId)
  if (toolName === undefined) throw new TypeError(REFUSE_APPROVAL.DEFINITION_MISMATCH)
  const operationArguments = readOperationArguments(fields.operationArguments, toolName)
  const expiry = readApprovalExpiry(fields.expiry, 'approval artifact.expiry')
  const activationDigest = readApprovalDigest(fields.activationDigest, 'approval artifact.activationDigest')
  const rendererId = readApprovalDigest(fields.rendererId, 'approval artifact.rendererId')
  const claimedOperationDigest = readApprovalDigest(fields.operationDigest, 'approval artifact.operationDigest')
  if (typeof fields.operationCanonicalBytes !== 'string') {
    throw new TypeError(`${REFUSE_APPROVAL.OPERATION_NOT_CANONICAL} (operationCanonicalBytes: must be a string)`)
  }
  if (Buffer.byteLength(fields.operationCanonicalBytes, 'utf8') > MAX_OPERATION_BYTES) {
    throw new TypeError(REFUSE_APPROVAL.OPERATION_OVERSIZE)
  }
  let claimedProjection
  try {
    claimedProjection = readProjection(fields.semanticProjection, 'approval artifact.semanticProjection')
  } catch (error) {
    const reason = approvalRefusalReason(error)
    if (reason === REFUSE_APPROVAL.DISPLAY_TEXT_INVALID
      || reason === REFUSE_APPROVAL.PROJECTION_MALFORMED
      || reason === REFUSE_APPROVAL.PROJECTION_OVERSIZE) throw error
    throw new TypeError(REFUSE_APPROVAL.PROJECTION_MALFORMED)
  }

  let operation
  let projection
  try {
    operation = buildOperation(operationArguments, expiry, toolName)
    projection = reviewProjectionLines(operation, operationArguments)
  } catch (error) {
    throw new TypeError(`${REFUSE_APPROVAL.UNRENDERABLE} (${String(error?.message ?? error)})`)
  }
  const canonicalBytes = canonicalJSON(operation)
  if (Buffer.byteLength(canonicalBytes, 'utf8') > MAX_OPERATION_BYTES) {
    throw new TypeError(REFUSE_APPROVAL.OPERATION_OVERSIZE)
  }
  // A caller may present bytes that parse to the same object through a
  // different encoding. Comparing the exact recomputed string refuses that
  // alternate canonicalization without ever parsing the candidate's bytes.
  if (fields.operationCanonicalBytes !== canonicalBytes) {
    throw new TypeError(REFUSE_APPROVAL.OPERATION_BYTES_MISMATCH)
  }
  if (claimedOperationDigest !== operationDigest(operation)) {
    throw new TypeError(REFUSE_APPROVAL.OPERATION_DIGEST_MISMATCH)
  }
  if (definitionId !== operation.definitionId) throw new TypeError(REFUSE_APPROVAL.DEFINITION_MISMATCH)
  if (expiry !== operation.exp) throw new TypeError(REFUSE_APPROVAL.EXPIRY_MISMATCH)
  // Truncation, extension, reordering, and substitution of the displayed text
  // are one comparison: the projection the human is shown must be the exact
  // projection this module derives from the same arguments.
  if (claimedProjection.length !== projection.length
    || claimedProjection.some((line, index) => line !== projection[index])) {
    throw new TypeError(REFUSE_APPROVAL.PROJECTION_MISMATCH)
  }
  return Object.freeze({
    version: APPROVAL_ARTIFACT_VERSION,
    operationArguments: Object.freeze({ ...operationArguments }),
    operationCanonicalBytes: canonicalBytes,
    operationDigest: claimedOperationDigest,
    semanticProjection: Object.freeze([...projection]),
    definitionId,
    activationDigest,
    occurrenceId: fields.occurrenceId,
    expiry,
    rendererId,
    oneUse: true,
  })
}

/**
 * Build one approval artifact from the exact inputs the trusted parent holds.
 * The result is validated by the same reader that validates wire input, so a
 * locally built artifact and a received one are indistinguishable downstream.
 * @param {object} input - artifact inputs.
 * @param {import('./artifact.mjs').ApprovalArtifactInput['operationArguments']} input.operationArguments - the exact call arguments.
 * @param {string} [input.toolName='memory.put'] - the registered effect to approve.
 * @param {number} input.expiry - grant expiry, unix seconds.
 * @param {string} input.activationDigest - the activation this approval belongs to.
 * @param {string} input.occurrenceId - the one visible occurrence, 32 lowercase hex characters.
 * @param {string} input.rendererId - identity of the renderer that will display it.
 * @returns {ReturnType<typeof parseApprovalArtifact>} validated artifact.
 * @throws {TypeError} named {@link REFUSE_APPROVAL} refusal.
 */
export function createApprovalArtifact({ operationArguments, expiry, activationDigest, occurrenceId, rendererId, toolName = MEMORY_PUT }) {
  const args = readOperationArguments(operationArguments, toolName)
  const checkedExpiry = readApprovalExpiry(expiry, 'approval artifact.expiry')
  let operation
  let projection
  try {
    operation = buildOperation(args, checkedExpiry, toolName)
    projection = reviewProjectionLines(operation, args)
  } catch (error) {
    throw new TypeError(`${REFUSE_APPROVAL.UNRENDERABLE} (${String(error?.message ?? error)})`)
  }
  return parseApprovalArtifact({
    version: APPROVAL_ARTIFACT_VERSION,
    operationArguments: { ...args },
    operationCanonicalBytes: canonicalJSON(operation),
    operationDigest: operationDigest(operation),
    semanticProjection: [...projection],
    definitionId: operation.definitionId,
    activationDigest,
    occurrenceId,
    expiry: checkedExpiry,
    rendererId,
    oneUse: true,
  })
}

/**
 * The artifact digest every party derives independently: sha256 over the
 * domain tag and the artifact's canonical JSON.
 * @param {ReturnType<typeof parseApprovalArtifact>} artifact - a validated artifact.
 * @returns {string} lowercase hex digest.
 */
export function approvalArtifactDigest(artifact) {
  const canonical = canonicalJSON({
    version: artifact.version,
    operationArguments: { ...artifact.operationArguments },
    operationCanonicalBytes: artifact.operationCanonicalBytes,
    operationDigest: artifact.operationDigest,
    semanticProjection: [...artifact.semanticProjection],
    definitionId: artifact.definitionId,
    activationDigest: artifact.activationDigest,
    occurrenceId: artifact.occurrenceId,
    expiry: artifact.expiry,
    rendererId: artifact.rendererId,
    oneUse: artifact.oneUse,
  })
  return createHash('sha256').update(`${APPROVAL_ARTIFACT_DOMAIN} ${canonical}`, 'utf8').digest('hex')
}

/**
 * The exact bytes an issuer signs to attest one approved artifact. Its domain
 * tag is disjoint from the grant v3 and v4 authorization messages, so an
 * approval signature can never be replayed as a grant signature.
 * @param {string} artifactDigest - the artifact digest, lowercase hex.
 * @returns {Buffer} the signed message.
 * @throws {TypeError} when the digest is not one lowercase sha256 value.
 */
export function approvalSignedMessage(artifactDigest) {
  const digest = readApprovalDigest(artifactDigest, 'approval signed message.artifactDigest')
  return Buffer.from(`${APPROVAL_SIGNED_DOMAIN} ${digest}`, 'utf8')
}

/**
 * Re-derive an artifact from untrusted input and confirm it carries the
 * expected digest. This is the issuer-side entry point: it never trusts the
 * caller's digest, and it refuses before any prompt is rendered.
 * @param {unknown} input - candidate artifact.
 * @param {string} expectedDigest - the digest the caller claims.
 * @returns {ReturnType<typeof parseApprovalArtifact>} validated artifact.
 * @throws {TypeError} named {@link REFUSE_APPROVAL} refusal.
 */
export function verifyApprovalArtifact(input, expectedDigest) {
  const artifact = parseApprovalArtifact(input)
  const claimed = readApprovalDigest(expectedDigest, 'approval artifact.expectedDigest')
  if (approvalArtifactDigest(artifact) !== claimed) throw new TypeError(REFUSE_APPROVAL.DIGEST_MISMATCH)
  return artifact
}
