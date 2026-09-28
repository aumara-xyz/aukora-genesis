export declare const AUKORA_MEMORY_REFUSED: 'AUKORA_MEMORY_REFUSED'
export declare const AUKORA_MEMORY_INDETERMINATE: 'AUKORA_MEMORY_INDETERMINATE'
export declare const SOURCE_OUTCOME_SETTLED: 'SETTLED'
export declare const SOURCE_OUTCOME_REFUSED: 'REFUSED'
export declare const SOURCE_OUTCOME_INDETERMINATE: 'INDETERMINATE'
export type SourceOutcome =
  | typeof SOURCE_OUTCOME_SETTLED
  | typeof SOURCE_OUTCOME_REFUSED
  | typeof SOURCE_OUTCOME_INDETERMINATE
export declare function classifyMemoryToolResult(result: unknown): SourceOutcome | null
