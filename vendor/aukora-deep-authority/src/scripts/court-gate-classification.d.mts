export interface ParsedCourtRows {
  raw: Array<{ id: string, verdict: string, line: number }>
  breach: Set<string>
  held: Set<string>
  inconclusive: Set<string>
  keptBreach: Set<string>
  duplicateIds: string[]
  unparsedLines: number[]
}

export interface ParsedMutationResults {
  raw: Array<{ marker: string, verdict: string, line: number }>
  duplicateMarkers: string[]
  oracleResults: Array<{ expectedBreaches: string[], matched: boolean, line: number }>
  unparsedLines: number[]
}

export interface MutationExpectation {
  marker: string
  verdict: 'DETECTED' | 'NOT DETECTED' | 'HELD' | 'NOT HELD'
  detailExact?: string
}

export interface GateClassificationCounts {
  passed: number
  skipped: number
  inconclusive: number
  keptBreach: number
  knownBreach: number
  resolved: number
  mutationDetected: number
  unexpected: number
}

export declare const EXPECTED_GATE_RUNS: readonly string[]
export declare function resolvePathExecutables(
  pathEntries: readonly string[],
  names: readonly string[],
): Array<{ name: string, path: string | null }>
export declare function parseCourtRows(text: string): ParsedCourtRows
export declare function parseMutationResults(text: string): ParsedMutationResults
export declare function mutationResultFaults(
  text: string,
  expected: MutationExpectation[],
  expectedBreachRows?: readonly string[],
): string[]
export declare function amendmentChannelMutationFaults(text: string): string[]
export declare function gateRosterFaults(actual: readonly string[]): string[]
export declare function keptBreachFaults(expectedRows: readonly string[], observedRows: Set<string>): string[]
export declare function ordinaryResultFaults(
  expected: { held: readonly string[], breach: readonly string[], kept: readonly string[] },
  observed: Pick<ParsedCourtRows, 'held' | 'breach' | 'keptBreach' | 'inconclusive' | 'unparsedLines'>,
): string[]
export declare function liveDispatchNormalFaults(text: string, root: string): string[]
export declare function liveDispatchMutationFaults(text: string): string[]
export declare function classifiedRunCount(counts: GateClassificationCounts): number
