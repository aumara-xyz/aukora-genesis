/**
 * The small closed allowlist of reversible cycle actions.
 *
 * A model proposes one typed action; validation here and the existing
 * authority rules decide whether it runs. Retrieved text is data and cannot
 * authorize commands: every action is either a confined workspace read, a
 * workspace file replacement that only the broker's workspace.patch effect
 * may publish, a bounded delegation to a registered worker task, or a
 * terminal finish/abstain marker. Delegation is bounded by the worker
 * registry, the scenario task registry, the nesting depth, and the shared
 * request budget; nothing here spawns shell execution.
 *
 * @module @aukora/core/cycle/actions
 */
import { createHash } from 'node:crypto'
import { constants, openSync, fstatSync, readFileSync, closeSync } from 'node:fs'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { captureWorkspacePatchArgs, MAX_WORKSPACE_PATCH_BYTES } from '../broker/workspace-patch-args.mjs'
import { CYCLE_MAX_DEPTH } from './outcome.mjs'

/** Closed action names for cycle proposal v1. */
export const CYCLE_ACTIONS = Object.freeze([
  'workspace.read',
  'workspace.write',
  'cycle.delegate',
  'cycle.finish',
  'cycle.abstain',
])

/** Workspace alias under which the demo workspace is published to the broker. */
export const CYCLE_WORKSPACE_ALIAS = 'lab'

const READ_MAX_BYTES = 4_096
const WRITE_MAX_BYTES = 64
const SUMMARY_MAX_BYTES = 24
const REASON_MAX_BYTES = 80
const PATH_MAX_LENGTH = 256

// Mirrors the closed workspace.patch path grammar so engine-side reads and
// broker-side writes accept the same path alphabet.
const PATH_COMPONENT = /^[a-zA-Z0-9._-]{1,128}$/
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

/** A named action-refusal; every refusal carries one stable code. */
export class CycleActionError extends Error {
  /** Stable machine-readable refusal code, e.g. `cycle.action:path-escape`. */
  code

  /**
   * @param {string} code - stable refusal code suffix, without the module prefix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`cycle.action: ${message}`)
    this.name = 'CycleActionError'
    this.code = `cycle.action:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new CycleActionError(code, message)
}

/** Test one closed plain-data proposal object without invoking accessors. */
function readClosedProposal(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    refuse('proposal-not-plain', 'a proposal must be one plain object')
  }
  const record = /** @type {Record<string, unknown>} */ (input)
  const keys = Object.keys(record)
  if (keys.length !== 2 || !keys.includes('action') || !keys.includes('args')) {
    refuse('proposal-inexact', 'a proposal must carry exactly action and args')
  }
  if (typeof record.action !== 'string' || !CYCLE_ACTIONS.includes(/** @type {never} */ (record.action))) {
    refuse('action-unknown', `action must be one of ${CYCLE_ACTIONS.join(', ')}`)
  }
  if (record.args === null || typeof record.args !== 'object' || Array.isArray(record.args)) {
    refuse('args-not-plain', 'proposal args must be a plain object')
  }
  return { action: /** @type {typeof CYCLE_ACTIONS[number]} */ (record.action), args: /** @type {Record<string, unknown>} */ (record.args) }
}

/** Test one workspace path against the shared closed path grammar. */
function readWorkspacePath(value) {
  if (typeof value !== 'string' || value === '' || value.length > PATH_MAX_LENGTH) {
    refuse('path-invalid', 'workspace paths must be non-empty strings of at most 256 characters')
  }
  if (isAbsolute(value) || value.includes('\u0000') || value.includes('\\')) {
    refuse('path-invalid', 'workspace paths must be relative forward-slash paths')
  }
  const parts = value.split('/')
  if (parts.some(part => !PATH_COMPONENT.test(part) || part === '.' || part === '..'
    || part.toLowerCase() === '.git' || part.endsWith('.') || RESERVED.test(part))) {
    refuse('path-invalid', 'workspace path components are outside the closed grammar')
  }
  return value
}

/** Test one bounded single-line text argument. */
function readBoundedText(value, field, maxBytes, allowEmpty) {
  if (typeof value !== 'string' || (!allowEmpty && value === '')) {
    refuse(`${field}-invalid`, `${field} must be a ${allowEmpty ? '' : 'non-empty '}string`)
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    refuse(`${field}-invalid`, `${field} exceeds ${maxBytes} bytes`)
  }
  return value
}

/**
 * Confine one workspace-relative path beneath a canonical root and return the
 * resolved absolute path. The confinement refuses traversal, absolute input,
 * and every escape spelled by the path grammar; the caller still opens the
 * result without following symbolic links.
 * @param {string} root - canonical absolute workspace root.
 * @param {string} relative - validated workspace-relative path.
 * @returns {string} absolute path beneath the root.
 */
export function confineWorkspacePath(root, relative) {
  readWorkspacePath(relative)
  const resolvedRoot = resolve(root)
  if (resolvedRoot !== root || normalize(root) !== root) {
    refuse('root-not-canonical', 'the workspace root must be a canonical absolute path')
  }  const absolute = resolve(resolvedRoot, relative)
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`
  if (absolute !== resolvedRoot && !absolute.startsWith(prefix)) {
    refuse('path-escape', 'the resolved path escapes the workspace root')
  }
  return absolute
}

/**
 * Read one workspace file without following symbolic links.
 * @param {string} root - canonical workspace root.
 * @param {string} relative - validated workspace-relative path.
 * @returns {{path: string, sha256: string, bytes: number, content: string}} the exact bytes read.
 * @throws {CycleActionError} on confinement or read failures; missing files refuse by name.
 */
export function readWorkspaceFile(root, relative) {
  const absolute = confineWorkspacePath(root, relative)
  let descriptor
  try {
    descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    refuse('read-unavailable', `workspace.read could not open the file (${String(error?.code ?? 'open')})`)
  }
  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile()) refuse('read-not-file', 'workspace.read target is not a regular file')
    if (stat.size > READ_MAX_BYTES) refuse('read-too-large', `workspace.read target exceeds ${READ_MAX_BYTES} bytes`)
    const body = readFileSync(descriptor)
    if (body.length > READ_MAX_BYTES) refuse('read-too-large', `workspace.read target exceeds ${READ_MAX_BYTES} bytes`)
    return {
      path: relative,
      sha256: createHash('sha256').update(body).digest('hex'),
      bytes: body.length,
      content: body.toString('utf8'),
    }
  } finally {
    closeSync(descriptor)
  }
}

/**
 * Build the exact workspace.patch arguments for one proposed write.
 * @param {string} root - canonical workspace root.
 * @param {{action: string, args: Record<string, unknown>}} proposal - validated write proposal.
 * @returns {{args: {workspace: string, path: string, beforeSha256: string | null, content: string}}} exact patch arguments.
 * @throws {CycleActionError} when the proposal or current file state violates the contract.
 */
export function buildWorkspacePatch(root, proposal) {
  const { action, args } = readClosedProposal(proposal)
  if (action !== 'workspace.write') refuse('action-mismatch', 'expected a workspace.write proposal')
  const path = readWorkspacePath(/** @type {unknown} */ (args.path))
  const content = readBoundedText(args.content, 'content', WRITE_MAX_BYTES, true)
  confineWorkspacePath(root, path)
  let beforeSha256 = null
  let descriptor
  try {
    descriptor = openSync(join(root, path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stat = fstatSync(descriptor)
    if (stat.isFile() && stat.size <= MAX_WORKSPACE_PATCH_BYTES) {
      const body = readFileSync(descriptor)
      if (body.length <= MAX_WORKSPACE_PATCH_BYTES) {
        beforeSha256 = createHash('sha256').update(body).digest('hex')
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      refuse('patch-preimage-unreadable', `workspace.write could not read the current file (${String(error?.code ?? error)})`)
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  const patch = captureWorkspacePatchArgs({
    workspace: CYCLE_WORKSPACE_ALIAS,
    path,
    beforeSha256,
    content,
  })
  if (patch === null) refuse('patch-args-invalid', 'workspace.write arguments are outside the workspace.patch grammar')
  return Object.freeze({ args: Object.freeze(patch) })
}

/**
 * Validate one model-proposed action against the allowlist, the worker
 * registry, the task registry, the nesting depth, and the request budget.
 * @param {unknown} input - untrusted candidate proposal from a model.
 * @param {{workers: Readonly<Record<string, {maxCycles: number}>>, tasks: Readonly<Record<string, {role: string, worker: string | null}>>, depth: number, requestsRemaining: number}} context
 *   authority-owned registries and the live budget/depth state.
 * @returns {{ok: true, proposal: {action: string, args: Record<string, unknown>}} | {ok: false, reason: string}}
 *   the validated proposal or one named refusal.
 */
export function validateProposal(input, context) {
  let proposal
  try {
    proposal = readClosedProposal(input)
  } catch (error) {
    return { ok: false, reason: error instanceof CycleActionError ? error.code : 'cycle.action:proposal-invalid' }
  }
  const { action, args } = proposal
  try {
    if (action === 'workspace.read') {
      if (Object.keys(args).length !== 1 || !('path' in args)) {
        refuse('args-inexact', 'workspace.read args must carry exactly path')
      }
      readWorkspacePath(args.path)
    } else if (action === 'workspace.write') {
      if (Object.keys(args).length !== 2 || !('path' in args) || !('content' in args)) {
        refuse('args-inexact', 'workspace.write args must carry exactly path and content')
      }
      readWorkspacePath(args.path)
      readBoundedText(args.content, 'content', WRITE_MAX_BYTES, true)
    } else if (action === 'cycle.delegate') {
      if (Object.keys(args).length !== 2 || !('worker' in args) || !('taskId' in args)) {
        refuse('args-inexact', 'cycle.delegate args must carry exactly worker and taskId')
      }
      const worker = readBoundedText(args.worker, 'worker', 32, false)
      const taskId = readBoundedText(args.taskId, 'taskId', 32, false)
      const workerSpec = context.workers[worker]
      if (workerSpec === undefined) refuse('delegate-unknown-worker', `no worker named ${worker} is registered`)
      const taskSpec = context.tasks[taskId]
      if (taskSpec === undefined) refuse('delegate-unknown-task', `no task named ${taskId} is registered`)
      if (taskSpec.role !== 'worker' || taskSpec.worker !== worker) {
        refuse('delegate-task-mismatch', `task ${taskId} is not a task of worker ${worker}`)
      }
      if (context.depth + 1 > CYCLE_MAX_DEPTH) {
        refuse('delegate-depth-exceeded', `delegation would exceed nesting depth ${CYCLE_MAX_DEPTH}`)
      }
      if (context.requestsRemaining < 1) {
        refuse('delegate-budget-exhausted', 'no model requests remain for a delegated cycle')
      }
    } else if (action === 'cycle.finish') {
      if (Object.keys(args).length !== 1 || !('summary' in args)) {
        refuse('args-inexact', 'cycle.finish args must carry exactly summary')
      }
      readBoundedText(args.summary, 'summary', SUMMARY_MAX_BYTES, false)
    } else {
      if (Object.keys(args).length !== 1 || !('reason' in args)) {
        refuse('args-inexact', 'cycle.abstain args must carry exactly reason')
      }
      readBoundedText(args.reason, 'reason', REASON_MAX_BYTES, false)
    }
  } catch (error) {
    return { ok: false, reason: error instanceof CycleActionError ? error.code : 'cycle.action:proposal-invalid' }
  }
  return { ok: true, proposal: Object.freeze({ action, args: Object.freeze(args) }) }
}
