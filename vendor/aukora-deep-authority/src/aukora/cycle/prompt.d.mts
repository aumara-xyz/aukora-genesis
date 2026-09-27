/** Maximum bytes rendered for one record's content projection. */
export declare const PROMPT_RECORD_MAX_BYTES: 4096

/** Maximum rendered evidence bytes across all records in one prompt. */
export declare const PROMPT_EVIDENCE_MAX_BYTES: 49152

/** One merged per-kind recall state line. */
export type PromptRecallState = Readonly<{
  kind: string | undefined
  status: 'found' | 'empty' | 'undetermined'
  reason?: string
}>

/**
 * Render one cycle prompt from a frozen task and one merged evidence view.
 * Deterministic: the same evidence renders to the same bytes, records keep
 * recordId-sorted order, and empty/undetermined states stay visible.
 */
export declare function renderCyclePrompt(task: {
  scenarioId: string
  taskId: string
  parentTaskId: string | null
  role: string
  worker: string | null
  depth: number
  taskText: string
  cyclesRemaining: number
  workers: ReadonlyArray<string>
  tasks: ReadonlyArray<string>
}, evidence: {
  states: ReadonlyArray<PromptRecallState>
  records: ReadonlyArray<Readonly<Record<string, unknown>>>
  citations: Readonly<Record<string, { auraSequence: number; auraEntryHash: string; verifiedHead: string }>>
}): {
  system: string
  user: string
  sha256: string
  evidenceBytes: number
}
