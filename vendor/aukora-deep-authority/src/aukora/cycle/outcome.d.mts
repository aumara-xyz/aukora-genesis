import type { KiraMemoryRecordV0 } from '../kira/stage.d.mts'

/** Cycle-outcome domain carried inside KIRA record content. */
export declare const CYCLE_OUTCOME_DOMAIN: 'aukora:cycle-outcome:v1'

/** Closed execution states; failed, interrupted, and rejected stay distinct. */
export declare const CYCLE_EXECUTION_STATES: readonly ['proposed', 'validated', 'executed', 'rejected', 'failed', 'interrupted']

/** Closed cycle decisions about its own result. */
export declare const CYCLE_DECISIONS: readonly ['retain', 'reject']

/** Closed cycle roles; coordinator and worker share the same cycle contract. */
export declare const CYCLE_ROLES: readonly ['coordinator', 'worker']

/** Maximum nesting depth a delegated cycle may reach. */
export declare const CYCLE_MAX_DEPTH: 2

/** Maximum evidence references one outcome may cite. */
export declare const CYCLE_MAX_EVIDENCE: 16

/** Broker settlement citation that certifies one recalled record. */
export type CycleEvidenceCitation = Readonly<{
  auraSequence: number
  auraEntryHash: string
  verifiedHead: string
}>

/** One evidence reference: record identity plus its broker citation when returned. */
export type CycleEvidenceRef = Readonly<{
  recordId: string
  citation: CycleEvidenceCitation | null
}>

/** The typed proposal part: exactly one action name and its validated args. */
export type CycleProposal = Readonly<{
  action: string
  args: Readonly<Record<string, unknown>>
}>

/** One validated cycle outcome carried inside KIRA record content. */
export type CycleOutcome = Readonly<{
  domain: 'aukora:cycle-outcome:v1'
  taskId: string
  parentTaskId: string | null
  role: 'coordinator' | 'worker'
  worker: string | null
  depth: number
  evidence: ReadonlyArray<CycleEvidenceRef>
  proposal: CycleProposal | null
  executionStatus: 'proposed' | 'validated' | 'executed' | 'rejected' | 'failed' | 'interrupted'
  actualResult: Readonly<Record<string, unknown>>
  decision: 'retain' | 'reject'
}>

/** A named outcome-contract refusal; every refusal carries one stable code. */
export declare class CycleOutcomeError extends Error {
  /** Stable machine-readable refusal code, e.g. `cycle.outcome:task-invalid`. */
  readonly code: string
  constructor(code: string, message: string)
}

/**
 * Validate one candidate and return its detached frozen cycle outcome.
 * Throws {@link CycleOutcomeError} when the candidate violates the contract.
 */
export declare function readCycleOutcome(input: unknown): CycleOutcome

/**
 * Verify that one recalled KIRA record carries a valid cycle outcome.
 * Never throws for bad data and never proves authorization or Aura inclusion.
 */
export declare function verifyCycleOutcomeRecord(value: unknown):
  | Readonly<{ verified: true; record: KiraMemoryRecordV0; outcome: CycleOutcome }>
  | Readonly<{ verified: false; reason: string }>

/**
 * Stage one observed cycle outcome as an inert KIRA memory record.
 * Terminal cycle.finish outcomes are derived summaries (kind `summary`);
 * every other outcome is an original event (kind `observation`).
 */
export declare function stageCycleOutcomeRecord(input: {
  subject: string
  outcome: CycleOutcome
  parentRecordId: string | null
  createdAt: string
  links?: ReadonlyArray<{ recordId: string; relation: string }>
}): Readonly<{
  recordId: string
  record: KiraMemoryRecordV0
  memoryPut: Readonly<{ key: string; value: KiraMemoryRecordV0 }>
}>

/** Lowercase SHA-256 of the exact settled memory-object bytes for one record. */
export declare function cycleRecordBytesSha256(record: KiraMemoryRecordV0): string

/** Lowercase SHA-256 of one cycle-outcome content object. */
export declare function cycleOutcomeDigest(outcome: CycleOutcome): string
