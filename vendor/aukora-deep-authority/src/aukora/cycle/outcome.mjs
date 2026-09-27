/**
 * Validated cycle-outcome contract carried inside one KIRA memory record.
 *
 * One bounded cycle receives a task, retrieves permitted evidence, proposes
 * one next action, validates it, executes it, and records what actually
 * happened. The outcome record below is that record's `content`: task
 * identity, parent relationship, the evidence references the cycle consumed,
 * the validated proposal, the execution status, the actual result, and the
 * cycle's retain/reject decision. It is constructed from observed execution,
 * never prewritten and later checked against the run. Failed, interrupted,
 * and rejected actions have distinct execution states.
 *
 * The outcome travels as the `content` of an ordinary KIRA memory record
 * (kind `observation`, or `summary` for a terminal cycle.finish), reusing the
 * existing stage/verify/broker-proposal interfaces. Retrieval never grants
 * authority: a recalled outcome is data, not permission to execute.
 *
 * @module @aukora/core/cycle/outcome
 */
import { createHash } from 'node:crypto'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import {
  KIRA_RECORD_ID,
  stageKiraMemoryRecord,
  verifyKiraMemoryRecord,
} from '../kira/stage.mjs'
import { kiraRecordContentSha256 } from '../kira/recall.mjs'

/** Cycle-outcome domain carried inside KIRA record content. */
export const CYCLE_OUTCOME_DOMAIN = 'aukora:cycle-outcome:v1'

/** Closed execution states; failed, interrupted, and rejected stay distinct. */
export const CYCLE_EXECUTION_STATES = Object.freeze([
  'proposed',
  'validated',
  'executed',
  'rejected',
  'failed',
  'interrupted',
])

/** Closed cycle decisions about its own result. */
export const CYCLE_DECISIONS = Object.freeze(['retain', 'reject'])

/** Closed cycle roles; coordinator and worker share the same cycle contract. */
export const CYCLE_ROLES = Object.freeze(['coordinator', 'worker'])

/** Maximum nesting depth a delegated cycle may reach. */
export const CYCLE_MAX_DEPTH = 2

/** Maximum evidence references one outcome may cite. */
export const CYCLE_MAX_EVIDENCE = 16

const TASK_ID = /^[a-z][a-z0-9-]{0,31}$/
const WORKER_NAME = /^[a-z][a-z0-9-]{0,31}$/
const MAX_CONTENT_NODES = 4_096
const MAX_CONTENT_DEPTH = 32

/** A named outcome-contract refusal; every refusal carries one stable code. */
export class CycleOutcomeError extends Error {
  /** Stable machine-readable refusal code, e.g. `cycle.outcome:task-invalid`. */
  code

  /**
   * @param {string} code - stable refusal code suffix, without the module prefix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`cycle.outcome: ${message}`)
    this.name = 'CycleOutcomeError'
    this.code = `cycle.outcome:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new CycleOutcomeError(code, message)
}

/** Test one bounded single-line name field. */
function readBoundedName(value, field, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    refuse(`${field}-invalid`, `${field} must match ${String(pattern)}`)
  }
  return value
}

/**
 * Read one evidence reference: the record identity plus the broker citation
 * that certifies its settlement, when a citation was returned.
 * @param {unknown} entry - candidate evidence reference.
 * @returns {{recordId: string, citation: Readonly<{auraSequence: number, auraEntryHash: string, verifiedHead: string}> | null}}
 */
function readEvidenceRef(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    refuse('evidence-invalid', 'evidence entries must be plain objects')
  }
  const record = /** @type {Record<string, unknown>} */ (entry)
  const keys = Object.keys(record)
  if (keys.some(key => key !== 'recordId' && key !== 'citation')) {
    refuse('evidence-invalid', 'evidence entries may only carry recordId and citation')
  }
  if (typeof record.recordId !== 'string' || !KIRA_RECORD_ID.test(record.recordId)) {
    refuse('evidence-invalid', 'evidence.recordId must be a deterministic KIRA record identifier')
  }
  let citation = null
  if ('citation' in record) {
    const value = record.citation
    if (value === null) {
      citation = null
    } else {
      if (value === undefined || typeof value !== 'object' || Array.isArray(value)) {
        refuse('evidence-invalid', 'evidence.citation must be an object or null')
      }
      const fields = /** @type {Record<string, unknown>} */ (value)
      const expected = ['auraSequence', 'auraEntryHash', 'verifiedHead']
      if (Object.keys(fields).some(key => !expected.includes(key)) || expected.some(key => !(key in fields))) {
        refuse('evidence-invalid', 'evidence.citation must carry auraSequence, auraEntryHash, verifiedHead only')
      }
      if (!Number.isSafeInteger(fields.auraSequence) || fields.auraSequence < 1
        || typeof fields.auraEntryHash !== 'string' || !/^[0-9a-f]{64}$/.test(fields.auraEntryHash)
        || typeof fields.verifiedHead !== 'string' || !/^[0-9a-f]{64}$/.test(fields.verifiedHead)) {
        refuse('evidence-invalid', 'evidence.citation fields are malformed')
      }
      citation = Object.freeze({
        auraSequence: fields.auraSequence,
        auraEntryHash: fields.auraEntryHash,
        verifiedHead: fields.verifiedHead,
      })
    }
  }
  return { recordId: record.recordId, citation }
}

/**
 * Detach one bounded lossless-JSON value without retaining caller references.
 * @param {unknown} value - candidate node.
 * @param {{nodes: number}} state - shared node budget.
 * @param {number} depth - current nesting depth.
 * @returns {unknown} frozen detached value with sorted object keys.
 */
function snapshotJson(value, state, depth) {
  state.nodes += 1
  if (state.nodes > MAX_CONTENT_NODES) refuse('content-nodes', 'outcome content exceeds the node limit')
  if (depth > MAX_CONTENT_DEPTH) refuse('content-depth', 'outcome content exceeds the depth limit')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) refuse('content-not-json', 'outcome content contains a non-JSON number')
    return value
  }
  if (typeof value !== 'object') refuse('content-not-json', 'outcome content must be lossless JSON data')
  if (Array.isArray(value)) {
    const result = value.map(entry => snapshotJson(entry, state, depth + 1))
    return Object.freeze(result)
  }
  const result = {}
  for (const key of Object.keys(value).toSorted()) {
    Object.defineProperty(result, key, {
      configurable: false,
      enumerable: true,
      value: snapshotJson(value[key], state, depth + 1),
      writable: false,
    })
  }
  return Object.freeze(result)
}

/** Read the closed proposal part: exactly `action` plus action args. */
function readProposal(value) {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    refuse('proposal-invalid', 'proposal must be an object or null')
  }
  const record = /** @type {Record<string, unknown>} */ (value)
  const keys = Object.keys(record)
  if (keys.length !== 2 || !keys.includes('action') || !keys.includes('args')) {
    refuse('proposal-invalid', 'proposal must carry exactly action and args')
  }
  if (typeof record.action !== 'string' || record.action === '') {
    refuse('proposal-invalid', 'proposal.action must be a non-empty string')
  }
  return Object.freeze({
    action: record.action,
    args: snapshotJson(record.args, { nodes: 0 }, 1),
  })
}

/**
 * Validate one candidate and return its detached frozen cycle outcome.
 * @param {unknown} input - untrusted candidate cycle-outcome content.
 * @returns {Readonly<Record<string, unknown>>} the frozen detached outcome.
 * @throws {CycleOutcomeError} when the candidate violates the contract.
 */
export function readCycleOutcome(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    refuse('not-plain', 'a cycle outcome must be one plain object')
  }
  const record = /** @type {Record<string, unknown>} */ (input)
  const required = [
    'domain', 'taskId', 'parentTaskId', 'role', 'worker', 'depth',
    'evidence', 'proposal', 'executionStatus', 'actualResult', 'decision',
  ]
  const keys = Object.keys(record)
  if (keys.length !== required.length || required.some(key => !keys.includes(key))) {
    refuse('fields-inexact', `a cycle outcome must carry exactly ${required.join(', ')}`)
  }
  if (record.domain !== CYCLE_OUTCOME_DOMAIN) {
    refuse('domain-invalid', `domain must be ${CYCLE_OUTCOME_DOMAIN}`)
  }
  const taskId = readBoundedName(record.taskId, 'taskId', TASK_ID)
  const parentTaskId = record.parentTaskId === null
    ? null
    : readBoundedName(record.parentTaskId, 'parentTaskId', TASK_ID)
  if (!CYCLE_ROLES.includes(/** @type {never} */ (record.role))) {
    refuse('role-invalid', `role must be one of ${CYCLE_ROLES.join(', ')}`)
  }
  const worker = record.worker === null ? null : readBoundedName(record.worker, 'worker', WORKER_NAME)
  if (record.role === 'worker' && worker === null) {
    refuse('worker-missing', 'a worker cycle must name its worker')
  }
  if (record.role === 'coordinator' && worker !== null) {
    refuse('worker-unexpected', 'a coordinator cycle must not name a worker')
  }
  if (!Number.isSafeInteger(record.depth) || record.depth < 0 || record.depth > CYCLE_MAX_DEPTH) {
    refuse('depth-invalid', `depth must be an integer from 0 to ${CYCLE_MAX_DEPTH}`)
  }
  if (!Array.isArray(record.evidence) || record.evidence.length > CYCLE_MAX_EVIDENCE) {
    refuse('evidence-invalid', `evidence must be an array of at most ${CYCLE_MAX_EVIDENCE} references`)
  }
  const evidence = Object.freeze(record.evidence.map(readEvidenceRef))
  const seen = new Set()
  for (const ref of evidence) {
    if (seen.has(ref.recordId)) refuse('evidence-invalid', 'evidence references must be unique')
    seen.add(ref.recordId)
  }
  if (!CYCLE_EXECUTION_STATES.includes(/** @type {never} */ (record.executionStatus))) {
    refuse('status-invalid', `executionStatus must be one of ${CYCLE_EXECUTION_STATES.join(', ')}`)
  }
  if (!CYCLE_DECISIONS.includes(/** @type {never} */ (record.decision))) {
    refuse('decision-invalid', `decision must be one of ${CYCLE_DECISIONS.join(', ')}`)
  }
  return Object.freeze({
    domain: CYCLE_OUTCOME_DOMAIN,
    taskId,
    parentTaskId,
    role: record.role,
    worker,
    depth: record.depth,
    evidence,
    proposal: readProposal(record.proposal),
    executionStatus: record.executionStatus,
    actualResult: snapshotJson(record.actualResult, { nodes: 0 }, 1),
    decision: record.decision,
  })
}

/**
 * Verify that one recalled KIRA record carries a valid cycle outcome.
 * @param {unknown} value - stored KIRA record value.
 * @returns {{verified: true, record: Readonly<Record<string, unknown>>, outcome: Readonly<Record<string, unknown>>} | {verified: false, reason: string}}
 */
export function verifyCycleOutcomeRecord(value) {
  const verdict = verifyKiraMemoryRecord(value)
  if (!verdict.verified) return verdict
  try {
    return { verified: true, record: verdict.record, outcome: readCycleOutcome(verdict.record.content) }
  } catch (error) {
    if (error instanceof CycleOutcomeError) return { verified: false, reason: error.code }
    throw error
  }
}

/**
 * Stage one observed cycle outcome as an inert KIRA memory record.
 *
 * The caller supplies what actually happened. Terminal cycle.finish outcomes
 * are derived summaries (kind `summary`); every other outcome is an original
 * event (kind `observation`). Parent cycles are linked so provenance survives
 * retrieval without granting any authority.
 *
 * @param {{subject: string, outcome: Readonly<Record<string, unknown>>, parentRecordId: string | null, createdAt: string, links?: readonly {recordId: string, relation: string}[]}} input
 *   subject, validated outcome content, the parent cycle's settled record
 *   identity when one exists, and the canonical creation instant.
 * @returns {{recordId: string, record: Readonly<Record<string, unknown>>, memoryPut: Readonly<{key: string, value: Readonly<Record<string, unknown>>}>}}
 *   staged record plus inert memory.put arguments for the proposal route.
 */
export function stageCycleOutcomeRecord(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    refuse('stage-input-invalid', 'stage input must be a plain object')
  }
  const outcome = readCycleOutcome(input.outcome)
  if (typeof input.subject !== 'string' || input.subject === '') {
    refuse('stage-input-invalid', 'stage input must carry a non-empty subject')
  }
  if (input.parentRecordId !== null
    && (typeof input.parentRecordId !== 'string' || !KIRA_RECORD_ID.test(input.parentRecordId))) {
    refuse('stage-input-invalid', 'parentRecordId must be a deterministic KIRA record identifier or null')
  }
  if (typeof input.createdAt !== 'string') {
    refuse('stage-input-invalid', 'stage input must carry a createdAt string')
  }
  const links = input.links === undefined ? [] : input.links
  const kind = outcome.proposal !== null && outcome.proposal.action === 'cycle.finish'
    ? 'summary'
    : 'observation'
  const parentLinks = input.parentRecordId === null
    ? []
    : [{ recordId: input.parentRecordId, relation: 'parent-cycle' }]
  const source = outcome.evidence.map(ref => ({ recordId: ref.recordId }))
  return stageKiraMemoryRecord({
    subject: input.subject,
    kind,
    source,
    content: outcome,
    links: [...parentLinks, ...links],
    privacy: 'private',
    createdAt: input.createdAt,
  })
}

/**
 * Lowercase SHA-256 of the exact settled memory-object bytes for one record.
 * @param {Readonly<Record<string, unknown>>} record - verified KIRA record.
 * @returns {string} content digest of the exact stored object body.
 */
export function cycleRecordBytesSha256(record) {
  return kiraRecordContentSha256(record)
}

/**
 * Lowercase SHA-256 of one cycle-outcome content object.
 * @param {unknown} outcome - validated cycle outcome.
 * @returns {string} digest of the canonical outcome bytes.
 */
export function cycleOutcomeDigest(outcome) {
  const detached = readCycleOutcome(outcome)
  return createHash('sha256').update(canonicalJSON(detached), 'utf8').digest('hex')
}
