/**
 * The one common cycle contract, shared by coordinator and workers.
 *
 * Each cycle: retrieve permitted evidence through the broker-owned recall
 * seam; render the byte-stable prompt; ask the model for exactly one typed
 * proposal; validate it against the closed allowlist, the worker/task
 * registries, the nesting depth, and the shared request budget; execute the
 * bounded action; observe the actual result; stage and settle the outcome
 * record through the existing KIRA proposal route; and return the outcome so
 * a later cycle can consume it. A coordinator invokes a worker through the
 * same `runTask` entry: delegation is bounded recursion, not spawning.
 *
 * Every model call is budgeted before it happens: one attempt, no retries,
 * concurrency one (calls are sequential), and an explicit wall deadline.
 * Budget exhaustion is recorded as an `interrupted` outcome, not a silent
 * skip.
 *
 * @module @aukora/core/cycle/engine
 */
import { verifyKiraMemoryRecord } from '../kira/stage.mjs'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { buildOperation } from '../broker/operation.mjs'
import { reviewProjectionLines } from '../broker/review.mjs'
import {
  MAX_OPERATION_BYTES,
  MAX_PROJECTION_LINE_BYTES,
  MAX_PROJECTION_LINES,
} from '../approval/artifact.mjs'
import {
  buildWorkspacePatch,
  readWorkspaceFile,
  validateProposal,
} from './actions.mjs'
import { renderCyclePrompt } from './prompt.mjs'
import {
  CYCLE_MAX_DEPTH,
  CYCLE_OUTCOME_DOMAIN,
  stageCycleOutcomeRecord,
  verifyCycleOutcomeRecord,
} from './outcome.mjs'

/** Closed task-spec roles; workers and coordinators run the same loop. */
export const ENGINE_TASK_ROLES = Object.freeze(['coordinator', 'worker'])

/**
 * Decide whether one staged outcome record is representable on the broker's
 * approval path. The broker's approval artifact renders every operation as a
 * bounded review projection; a record whose projection cannot be rendered
 * refuses at authorization. This is the exact preflight the engine runs
 * BEFORE the proposal is deposited, built from the same operation and
 * projection builders the broker uses plus the exported artifact limits.
 * Nothing is trimmed and no broker limit is changed; a refusal here leaves
 * the complete staged record available as failed-attempt evidence.
 * @param {{key: string, value: Readonly<Record<string, unknown>>}} memoryPutArgs - staged inert write arguments.
 * @param {number} nowSeconds - clock seconds for a nominal expiry.
 * @returns {{representable: true} | {representable: false, reason: 'operation-oversize' | 'projection-oversize' | 'projection-line-oversize'}}
 */
export function outcomeRepresentability(memoryPutArgs, nowSeconds) {
  const operation = buildOperation(memoryPutArgs, nowSeconds + 3600, 'memory.put')
  if (Buffer.byteLength(canonicalJSON(operation), 'utf8') > MAX_OPERATION_BYTES) {
    return { representable: false, reason: 'operation-oversize' }
  }
  const lines = reviewProjectionLines(operation, memoryPutArgs)
  if (lines.length > MAX_PROJECTION_LINES) {
    return { representable: false, reason: 'projection-oversize' }
  }
  if (lines.some(line => Buffer.byteLength(line, 'utf8') > MAX_PROJECTION_LINE_BYTES)) {
    return { representable: false, reason: 'projection-line-oversize' }
  }
  return { representable: true }
}

/** A named engine refusal for caller-side configuration errors. */
export class CycleEngineError extends Error {
  /** Stable machine-readable refusal code. */
  code

  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(`cycle.engine: ${message}`)
    this.name = 'CycleEngineError'
    this.code = `cycle.engine:${code}`
  }
}

/** One task-spec from the frozen scenario registry. */
function readTaskSpec(spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new CycleEngineError('task-invalid', 'task specs must be plain objects')
  }
  const fields = spec
  if (typeof fields.taskId !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(fields.taskId)) {
    throw new CycleEngineError('task-invalid', 'taskId must match the bounded task grammar')
  }
  if (!ENGINE_TASK_ROLES.includes(fields.role)) {
    throw new CycleEngineError('task-invalid', `task role must be one of ${ENGINE_TASK_ROLES.join(', ')}`)
  }
  if (fields.role === 'worker' && (typeof fields.worker !== 'string' || fields.worker === '')) {
    throw new CycleEngineError('task-invalid', 'worker tasks must name their worker')
  }
  if (fields.role === 'coordinator' && fields.worker !== null) {
    throw new CycleEngineError('task-invalid', 'coordinator tasks must not name a worker')
  }
  if (fields.parentTaskId !== null && (typeof fields.parentTaskId !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(fields.parentTaskId))) {
    throw new CycleEngineError('task-invalid', 'parentTaskId must be null or match the bounded task grammar')
  }
  if (!Number.isSafeInteger(fields.depth) || fields.depth < 0 || fields.depth > CYCLE_MAX_DEPTH) {
    throw new CycleEngineError('task-invalid', `task depth must be an integer from 0 to ${CYCLE_MAX_DEPTH}`)
  }
  if (!Number.isSafeInteger(fields.maxCycles) || fields.maxCycles < 1 || fields.maxCycles > 8) {
    throw new CycleEngineError('task-invalid', 'task maxCycles must be an integer from 1 to 8')
  }
  if (typeof fields.taskText !== 'string' || fields.taskText === '' || Buffer.byteLength(fields.taskText, 'utf8') > 512) {
    throw new CycleEngineError('task-invalid', 'taskText must be a non-empty string of at most 512 bytes')
  }
  if (!Array.isArray(fields.evidenceKinds) || fields.evidenceKinds.length === 0
    || fields.evidenceKinds.some(kind => typeof kind !== 'string' || kind === '')) {
    throw new CycleEngineError('task-invalid', 'evidenceKinds must name at least one record kind')
  }
  return {
    taskId: fields.taskId,
    parentTaskId: fields.parentTaskId,
    role: fields.role,
    worker: fields.role === 'worker' ? fields.worker : null,
    depth: fields.depth,
    maxCycles: fields.maxCycles,
    taskText: fields.taskText,
    evidenceKinds: Object.freeze([...fields.evidenceKinds]),
  }
}

/**
 * Create one cycle engine over injected broker and model seams.
 *
 * The seams keep this module free of any store or provider transport: the
 * demo wires the real broker proposal client and the real provider adapter;
 * focused tests wire labeled deterministic stubs. The engine owns validation
 * order, budget accounting, and outcome construction.
 *
 * @param {{scenarioId: string, subject: string, workspaceRoot: string, tasks: Readonly<Record<string, unknown>>, workers: Readonly<Record<string, {maxCycles: number}>>, broker: Readonly<Record<string, unknown>>, model: Readonly<Record<string, unknown>>, journal: unknown, budget: {maxRequests: number, maxOutputTokens: number, maxWallMs: number}, budgetState?: {used: number, deadlineMs: number, stopped: boolean}, clock?: () => number, signal?: AbortSignal}} input
 *   frozen scenario identity, the broker-owned subject, the canonical
 *   workspace root, the scenario task registry, the worker registry, the
 *   broker seam (`recall`, `settleMemoryPut`, `settleWorkspacePatch`), the
 *   model seam (`propose`), the observer journal, and the frozen budget.
 *   `budgetState` shares one request counter and wall deadline across every
 *   engine that consumes the same experiment budget.
 * @returns {{runTask: (taskId: string) => Promise<unknown>, state: Readonly<Record<string, unknown>>}}
 *   the task runner and the live budget/task state.
 */
export function createCycleEngine(input) {
  const {
    scenarioId,
    subject,
    workspaceRoot,
    tasks: rawTasks,
    workers,
    broker,
    model,
    journal,
    budget,
    budgetState,
    clock = Date.now,
    signal,
  } = input
  if (typeof scenarioId !== 'string' || scenarioId === '' || typeof subject !== 'string' || subject === '') {
    throw new CycleEngineError('configuration-invalid', 'scenarioId and subject must be non-empty strings')
  }
  if (typeof workspaceRoot !== 'string' || !workspaceRoot.startsWith('/')) {
    throw new CycleEngineError('configuration-invalid', 'workspaceRoot must be a canonical absolute path')
  }
  if (!Number.isSafeInteger(budget.maxRequests) || budget.maxRequests < 1
    || !Number.isSafeInteger(budget.maxOutputTokens) || budget.maxOutputTokens < 1
    || !Number.isSafeInteger(budget.maxWallMs) || budget.maxWallMs < 1) {
    throw new CycleEngineError('configuration-invalid', 'budget fields must be positive integers')
  }
  if (typeof broker.recall !== 'function'
    || typeof broker.settleMemoryPut !== 'function'
    || typeof broker.settleWorkspacePatch !== 'function'
    || typeof model.propose !== 'function'
    || journal === null || typeof journal.emit !== 'function') {
    throw new CycleEngineError('configuration-invalid', 'broker, model, and journal seams are required')
  }
  const taskSpecs = new Map()
  for (const raw of Object.values(rawTasks)) {
    const spec = readTaskSpec(raw)
    taskSpecs.set(spec.taskId, spec)
  }
  for (const taskId of taskSpecs.keys()) {
    const spec = taskSpecs.get(taskId)
    if (spec.parentTaskId !== null && !taskSpecs.has(spec.parentTaskId)) {
      throw new CycleEngineError('configuration-invalid', `task ${taskId} names an unknown parent task`)
    }
  }
  const shared = budgetState ?? { used: 0, deadlineMs: clock() + budget.maxWallMs, stopped: false }
  if (!Number.isSafeInteger(shared.used) || shared.used < 0
    || !Number.isSafeInteger(shared.deadlineMs) || typeof shared.stopped !== 'boolean') {
    throw new CycleEngineError('configuration-invalid', 'budgetState must carry used, deadlineMs, and stopped')
  }
  const state = {
    tasks: new Map(),
  }

  /** @returns {{requestsRemaining: number, wallRemainingMs: number}} live budget headroom. */
  function headroom() {
    return {
      requestsRemaining: budget.maxRequests - shared.used,
      wallRemainingMs: shared.deadlineMs - clock(),
    }
  }

  /** @param {string} taskId @returns {{lastRecordId: string | null, cycles: number}} per-task chain state. */
  function taskState(taskId) {
    let entry = state.tasks.get(taskId)
    if (entry === undefined) {
      entry = { lastRecordId: null, cycles: 0 }
      state.tasks.set(taskId, entry)
    }
    return entry
  }

  /** Verify one recalled record: a KIRA record is required; outcome content must also validate. */
  function verifyRecallRecord(value) {
    const verdict = verifyKiraMemoryRecord(value)
    if (!verdict.verified) return verdict
    const content = verdict.record.content
    if (content !== null && typeof content === 'object' && !Array.isArray(content)
      && content.domain === CYCLE_OUTCOME_DOMAIN) {
      return verifyCycleOutcomeRecord(value)
    }
    return { verified: true, record: verdict.record }
  }

  /** Retrieve permitted evidence through the broker-owned recall seam. */
  async function retrieveEvidence(kinds) {
    const states = []
    const byId = new Map()
    const citations = new Map()
    for (const kind of kinds) {
      const reply = await broker.recall(kind, signal)
      if (reply === null || typeof reply !== 'object' || reply.result === null || typeof reply.result !== 'object') {
        throw new CycleEngineError('recall-malformed', `recall for kind ${kind} returned a malformed reply`)
      }
      const result = reply.result
      if (result.status === 'undetermined') {
        states.push({ kind, status: 'undetermined', reason: result.reason })
        continue
      }
      if (result.status === 'empty') {
        states.push({ kind, status: 'empty' })
        continue
      }
      if (result.status !== 'found' || !Array.isArray(result.records)) {
        throw new CycleEngineError('recall-malformed', `recall for kind ${kind} returned an unknown state`)
      }
      states.push({ kind, status: 'found' })
      for (const value of result.records) {
        const verdict = verifyRecallRecord(value)
        if (!verdict.verified) {
          throw new CycleEngineError('recall-malformed', `recall returned an unverified record (${verdict.reason})`)
        }
        byId.set(verdict.record.recordId, verdict.record)
      }
      for (const citation of reply.citations ?? []) {
        if (citation !== null && typeof citation === 'object' && typeof citation.recordId === 'string') {
          citations.set(citation.recordId, citation)
        }
      }
    }
    const records = [...byId.values()].toSorted((left, right) => (left.recordId < right.recordId ? -1 : 1))
    return { states: Object.freeze(states), records: Object.freeze(records), citations }
  }

  /** Record one budget-interrupted outcome without calling the model. */
  async function interruptOutcome(spec, reason) {
    shared.stopped = true
    const chain = taskState(spec.taskId)
    journal.emit('cycle-end', { phase: 'interrupted', taskId: spec.taskId, reason })
    return settleOutcome(spec, chain.cycles, chain, { states: [], records: [], citations: new Map() }, null, 'interrupted', {
      interrupted: reason,
    }, 'reject', true)
  }

  /** Stage and settle one outcome record constructed from what happened. */
  async function settleOutcome(spec, cycleIndex, chain, evidence, proposal, executionStatus, actualResult, decision, terminal) {
    const createdAt = new Date(clock()).toISOString().slice(0, 19) + 'Z'
    const links = chain.lastRecordId === null
      ? []
      : [{ recordId: chain.lastRecordId, relation: 'previous-cycle' }]
    const outcome = {
      domain: CYCLE_OUTCOME_DOMAIN,
      taskId: spec.taskId,
      parentTaskId: spec.parentTaskId,
      role: spec.role,
      worker: spec.worker,
      depth: spec.depth,
      evidence: evidence.records.map(record => {
        const cited = evidence.citations.get(record.recordId)
        // The contract keeps the three settlement fields; the broker's
        // contentSha256 and recordId are already the digest and identity here.
        const citation = cited === undefined ? null : {
          auraSequence: cited.auraSequence,
          auraEntryHash: cited.auraEntryHash,
          verifiedHead: cited.verifiedHead,
        }
        return { recordId: record.recordId, citation }
      }),
      proposal,
      executionStatus,
      actualResult,
      decision,
    }
    const staged = stageCycleOutcomeRecord({
      subject,
      outcome,
      parentRecordId: null,
      createdAt,
      links,
    })
    journal.emit('outcome-staged', {
      taskId: spec.taskId,
      cycleIndex,
      recordId: staged.recordId,
      kind: staged.record.kind,
      executionStatus,
    })
    const representability = outcomeRepresentability(staged.memoryPut, Math.floor(clock() / 1000))
    if (!representability.representable) {
      const refusedReason = `cycle.outcome:not-representable:${representability.reason}`
      journal.emit('outcome-unrepresentable', {
        taskId: spec.taskId,
        cycleIndex,
        recordId: staged.recordId,
        reason: representability.reason,
        evidenceRefs: staged.record.source.length,
        record: staged.record,
      })
      journal.emit('cycle-end', { phase: 'cycle-end', taskId: spec.taskId, cycleIndex, settled: false, terminal })
      return Object.freeze({
        taskId: spec.taskId,
        cycleIndex,
        recordId: staged.recordId,
        settled: false,
        terminalState: 'REFUSED',
        refusedReason,
        terminal,
        executionStatus,
        decision,
        proposal,
        actualResult,
        evidenceRecordIds: evidence.records.map(record => record.recordId),
        stagedRecord: staged.record,
      })
    }
    const settled = await broker.settleMemoryPut(`${spec.taskId}-c${cycleIndex}-outcome`, staged.memoryPut, signal)
    let recordId = null
    let settledOk = false
    let brokerRefusedReason = null
    if (settled.ok === true && settled.state === 'SETTLED') {
      settledOk = true
      recordId = staged.recordId
      chain.lastRecordId = recordId
      journal.emit('outcome-settled', { taskId: spec.taskId, cycleIndex, recordId })
    } else {
      // A broker refusal keeps the staged identity named and carries the
      // reason, mirroring the pre-staging representability refusal, so the
      // completion aggregate reports the refusal instead of a false complete.
      recordId = staged.recordId
      brokerRefusedReason = settled.reason ?? null
      journal.emit('outcome-refused', {
        taskId: spec.taskId,
        cycleIndex,
        recordId: staged.recordId,
        state: settled.state,
        reason: settled.reason ?? null,
        proposalId: settled.proposalId ?? null,
      })
    }
    journal.emit('cycle-end', { phase: 'cycle-end', taskId: spec.taskId, cycleIndex, settled: settledOk, terminal })
    return Object.freeze({
      taskId: spec.taskId,
      cycleIndex,
      recordId,
      settled: settledOk,
      terminalState: settled.state,
      ...(settledOk ? {} : { refusedReason: brokerRefusedReason, stagedRecord: staged.record }),
      terminal,
      executionStatus,
      decision,
      proposal,
      actualResult,
      evidenceRecordIds: evidence.records.map(record => record.recordId),
    })
  }

  /** Run one bounded cycle and return its observed outcome. */
  async function runCycle(taskId, cycleIndex) {
    const spec = taskSpecs.get(taskId)
    if (spec === undefined) throw new CycleEngineError('task-unknown', `no task named ${taskId} is registered`)
    const chain = taskState(taskId)
    journal.emit('cycle-end', { phase: 'cycle-begin', taskId, cycleIndex, depth: spec.depth })
    const { requestsRemaining, wallRemainingMs } = headroom()
    if (shared.stopped || requestsRemaining < 1 || wallRemainingMs <= 0) {
      return interruptOutcome(spec, 'budget-exhausted')
    }
    const evidence = await retrieveEvidence(spec.evidenceKinds)
    journal.emit('recall', {
      taskId,
      cycleIndex,
      states: evidence.states,
      recordIds: evidence.records.map(record => record.recordId),
    })
    const prompt = renderCyclePrompt({
      scenarioId,
      taskId,
      parentTaskId: spec.parentTaskId,
      role: spec.role,
      worker: spec.worker,
      depth: spec.depth,
      taskText: spec.taskText,
      cyclesRemaining: Math.max(0, spec.maxCycles - chain.cycles),
      workers: Object.keys(workers),
      tasks: [...taskSpecs.keys()],
    }, evidence)
    journal.emit('prompt', {
      taskId,
      cycleIndex,
      promptSha256: prompt.sha256,
      evidenceBytes: prompt.evidenceBytes,
      recordIds: evidence.records.map(record => record.recordId),
    })
    if (shared.stopped || headroom().requestsRemaining < 1 || headroom().wallRemainingMs <= 0) {
      return interruptOutcome(spec, 'budget-exhausted')
    }
    const response = await model.propose(prompt, signal)
    shared.used += 1
    journal.emit('model-response', {
      taskId,
      cycleIndex,
      status: response.status,
      finishReason: response.finishReason ?? null,
      reason: response.reason ?? null,
      inputBytes: response.inputBytes,
      outputBytes: response.outputBytes,
      wallMs: response.wallMs,
      requestsUsed: shared.used,
    })
    chain.cycles += 1
    if (response.status !== 'completed' || typeof response.content !== 'string') {
      return settleOutcome(spec, cycleIndex, chain, evidence, null, 'failed', {
        failure: response.status === 'truncated' ? 'truncated' : response.reason ?? 'model-unavailable',
      }, 'reject', false)
    }
    let parsed
    try {
      parsed = JSON.parse(response.content)
    } catch {
      journal.emit('proposal-invalid', { taskId, cycleIndex, reason: 'not-json' })
      return settleOutcome(spec, cycleIndex, chain, evidence, null, 'rejected', {
        validation: 'proposal-not-json',
      }, 'reject', false)
    }
    const verdict = validateProposal(parsed, {
      workers,
      tasks: Object.fromEntries(taskSpecs),
      depth: spec.depth,
      requestsRemaining: headroom().requestsRemaining,
    })
    if (!verdict.ok) {
      journal.emit('proposal-invalid', { taskId, cycleIndex, reason: verdict.reason })
      return settleOutcome(spec, cycleIndex, chain, evidence, parsed, 'rejected', {
        validation: verdict.reason,
      }, 'reject', false)
    }
    const proposal = verdict.proposal
    journal.emit('validation', { taskId, cycleIndex, action: proposal.action, ok: true })
    return executeProposal(spec, cycleIndex, chain, evidence, proposal)
  }

  /** Execute one validated proposal and observe what actually happened. */
  async function executeProposal(spec, cycleIndex, chain, evidence, proposal) {
    const { action, args } = proposal
    if (action === 'workspace.read') {
      try {
        const read = readWorkspaceFile(workspaceRoot, args.path)
        journal.emit('execution', { taskId: spec.taskId, cycleIndex, action, path: args.path, ok: true })
        return settleOutcome(spec, cycleIndex, chain, evidence, proposal, 'executed', { read }, 'retain', false)
      } catch (error) {
        journal.emit('execution', { taskId: spec.taskId, cycleIndex, action, ok: false, reason: error?.code })
        return settleOutcome(spec, cycleIndex, chain, evidence, proposal, 'failed', { failure: error?.code ?? 'read-failed' }, 'retain', false)
      }
    }
    if (action === 'workspace.write') {
      let patch
      try {
        patch = buildWorkspacePatch(workspaceRoot, proposal)
      } catch (error) {
        journal.emit('execution', { taskId: spec.taskId, cycleIndex, action, ok: false, reason: error?.code })
        return settleOutcome(spec, cycleIndex, chain, evidence, proposal, 'rejected', { validation: error?.code ?? 'patch-invalid' }, 'reject', false)
      }
      const terminal = await broker.settleWorkspacePatch(`${spec.taskId}-c${cycleIndex}-patch`, patch.args, signal)
      if (terminal.ok === true && terminal.state === 'SETTLED') {
        const bytes = Buffer.byteLength(patch.args.content, 'utf8')
        journal.emit('execution', { taskId: spec.taskId, cycleIndex, action, path: patch.args.path, ok: true })
        return settleOutcome(spec, cycleIndex, chain, evidence, proposal, 'executed', {
          wrote: { path: patch.args.path, bytes, content: patch.args.content },
        }, 'retain', false)
      }
      journal.emit('execution', { taskId: spec.taskId, cycleIndex, action, ok: false, state: terminal.state, reason: terminal.reason })
      return settleOutcome(spec, cycleIndex, chain, evidence, proposal, terminal.state === 'REFUSED' ? 'rejected' : 'failed', {
        authority: terminal.reason ?? terminal.state,
      }, 'reject', false)
    }
    if (action === 'cycle.delegate') {
      const childId = String(args.taskId)
      const childResults = await runTask(childId)
      const childOutcomeRecordIds = childResults.records.map(record => record.recordId).filter(id => id !== null)
      journal.emit('execution', {
        taskId: spec.taskId,
        cycleIndex,
        action,
        worker: args.worker,
        childTaskId: childId,
        childOutcomeRecordIds,
      })
      // Delegation ends the delegating task's cycle sequence: the child
      // outcome feeds the NEXT task's evidence, not another cycle here.
      return settleOutcome(spec, cycleIndex, chain, evidence, proposal, 'executed', {
        delegated: {
          worker: args.worker,
          taskId: childId,
          childOutcomeRecordIds,
          childExecutionStates: childResults.records.map(record => record.executionStatus),
          childSettledRecordIds: childResults.records
            .filter(record => record.settled && record.recordId !== null)
            .map(record => record.recordId),
          childRefusedRecordIds: childResults.records
            .filter(record => !record.settled && record.recordId !== null)
            .map(record => record.recordId),
        },
      }, 'retain', true)
    }
    if (action === 'cycle.finish') {
      journal.emit('execution', { taskId: spec.taskId, cycleIndex, action, ok: true })
      return settleOutcome(spec, cycleIndex, chain, evidence, proposal, 'executed', {
        summary: args.summary,
      }, 'retain', true)
    }
    // cycle.abstain
    journal.emit('execution', { taskId: spec.taskId, cycleIndex, action, ok: true })
    return settleOutcome(spec, cycleIndex, chain, evidence, proposal, 'executed', {
      abstained: args.reason,
    }, 'retain', true)
  }

  /**
   * Aggregate one task's cycle results into the explicit completion status
   * the caller receives. A delegating cycle whose own outcome refuses while
   * its children settle is `partial` — never `complete` — and every side of
   * the truth stays named: settled own records, refused own records (with
   * their reason), and the children's settled and refused records. An
   * interrupted task is `incomplete`, whatever records it settled.
   */
  function taskCompletion(taskId, records) {
    const settledOwn = records.filter(record => record.settled && record.recordId !== null)
    const refusedOwn = records.filter(record => !record.settled && record.recordId !== null)
    const interrupted = records.some(record => record.executionStatus === 'interrupted')
    const settledChildren = records.flatMap(record => record.actualResult?.delegated?.childSettledRecordIds ?? [])
    const refusedChildren = records.flatMap(record => record.actualResult?.delegated?.childRefusedRecordIds ?? [])
    let status
    if (interrupted) {
      status = 'incomplete'
    } else if (refusedOwn.length === 0 && refusedChildren.length === 0) {
      status = 'complete'
    } else if (settledOwn.length > 0 || settledChildren.length > 0) {
      status = 'partial'
    } else {
      status = 'incomplete'
    }
    let reason = null
    if (interrupted) {
      reason = 'interrupted'
    } else if (refusedOwn.length > 0) {
      reason = records.find(record => !record.settled)?.refusedReason ?? 'outcome-refused'
    } else if (refusedChildren.length > 0) {
      reason = 'child-outcome-refused'
    }
    return Object.freeze({
      taskId,
      status,
      reason,
      settledOwnRecordIds: Object.freeze(settledOwn.map(record => record.recordId)),
      refusedOutcomeRecordIds: Object.freeze(refusedOwn.map(record => record.recordId)),
      settledChildRecordIds: Object.freeze([...new Set(settledChildren)]),
      refusedChildRecordIds: Object.freeze([...new Set(refusedChildren)]),
    })
  }

  /** Run bounded cycles; an already-stopped shared budget returns incomplete without further work. */
  async function runTask(taskId) {
    const spec = taskSpecs.get(taskId)
    if (spec === undefined) throw new CycleEngineError('task-unknown', `no task named ${taskId} is registered`)
    if (shared.stopped) {
      return Object.freeze({
        taskId, records: Object.freeze([]), stopped: true, reason: 'run-stopped',
        completion: Object.freeze({
          ...taskCompletion(taskId, []), status: 'incomplete', reason: 'run-stopped',
        }),
      })
    }
    const records = []
    for (let cycleIndex = 0; cycleIndex < spec.maxCycles && !shared.stopped; cycleIndex += 1) {
      const cycle = await runCycle(taskId, cycleIndex)
      records.push(cycle)
      if (cycle.terminal || cycle.executionStatus === 'interrupted') break
    }
    journal.emit('task-end', {
      taskId,
      cycles: records.length,
      recordIds: records.map(record => record.recordId).filter(id => id !== null),
      terminal: records.at(-1)?.terminal ?? false,
    })
    return Object.freeze({ taskId, records: Object.freeze(records), stopped: shared.stopped, completion: taskCompletion(taskId, records) })
  }

  return { runTask, state }
}
