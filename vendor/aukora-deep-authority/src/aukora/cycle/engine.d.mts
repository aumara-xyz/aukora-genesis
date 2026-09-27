/** Closed task-spec roles; workers and coordinators run the same loop. */
export declare const ENGINE_TASK_ROLES: readonly ['coordinator', 'worker']

/** A named engine refusal for caller-side configuration errors. */
export declare class CycleEngineError extends Error {
  /** Stable machine-readable refusal code. */
  readonly code: string
  constructor(code: string, message: string)
}

/**
 * Decide whether one staged outcome record is representable on the broker's
 * approval path, using the same operation and projection builders plus the
 * exported artifact limits. Refusal leaves the complete staged record
 * available as failed-attempt evidence; nothing is trimmed.
 */
export declare function outcomeRepresentability(
  memoryPutArgs: { key: string; value: Readonly<Record<string, unknown>> },
  nowSeconds: number,
): Readonly<{ representable: true }>
  | Readonly<{ representable: false; reason: 'operation-oversize' | 'projection-oversize' | 'projection-line-oversize' }>

/**
 * Explicit aggregate completion of one task, returned beside the per-cycle
 * records. `partial` names the case where some effects settled (own cycles
 * or delegated children) while the task's own outcome refused; `incomplete`
 * names an interrupted task or one with no settled effect. A task called
 * after the shared budget stops returns `incomplete` with `run-stopped`,
 * empty record-ID lists, and no additional model or broker calls. Every side of
 * the truth stays named: settled own records, refused own records, and the
 * children's settled and refused records. Nothing here rolls back a child
 * effect.
 */
export type CycleTaskCompletion = Readonly<{
  taskId: string
  status: 'complete' | 'partial' | 'incomplete'
  reason: string | null
  settledOwnRecordIds: ReadonlyArray<string>
  refusedOutcomeRecordIds: ReadonlyArray<string>
  settledChildRecordIds: ReadonlyArray<string>
  refusedChildRecordIds: ReadonlyArray<string>
}>

/** One observed cycle result returned by the engine. */
export type CycleResult = Readonly<{
  taskId: string
  cycleIndex: number
  recordId: string | null
  settled: boolean
  terminalState: 'SETTLED' | 'REFUSED' | 'INDETERMINATE'
  terminal: boolean
  executionStatus: 'proposed' | 'validated' | 'executed' | 'rejected' | 'failed' | 'interrupted'
  decision: 'retain' | 'reject'
  proposal: { action: string; args: Record<string, unknown> } | null
  actualResult: Record<string, unknown>
  evidenceRecordIds: string[]
  /** Explicit bounded refusal reason; present only when settlement did not happen. */
  refusedReason?: string
  /** The complete staged record retained as failed-attempt evidence on explicit refusal. */
  stagedRecord?: Readonly<Record<string, unknown>>
}>

/**
 * Create one cycle engine over injected broker and model seams. The demo
 * wires the real broker proposal client and provider adapter; focused tests
 * wire labeled deterministic stubs. The engine owns validation order, budget
 * accounting, and outcome construction; one attempt per model call, no
 * retries, concurrency one.
 */
export declare function createCycleEngine(input: {
  scenarioId: string
  subject: string
  workspaceRoot: string
  tasks: Readonly<Record<string, unknown>>
  workers: Readonly<Record<string, { maxCycles: number }>>
  broker: Readonly<Record<string, unknown>>
  model: Readonly<Record<string, unknown>>
  journal: unknown
  budget: { maxRequests: number; maxOutputTokens: number; maxWallMs: number }
  budgetState?: { used: number; deadlineMs: number; stopped: boolean }
  clock?: () => number
  signal?: AbortSignal
}): {
  runTask(taskId: string): Promise<Readonly<{
    taskId: string
    records: ReadonlyArray<CycleResult>
    stopped: boolean
    completion: CycleTaskCompletion
  }>>
  state: Readonly<Record<string, unknown>>
}
