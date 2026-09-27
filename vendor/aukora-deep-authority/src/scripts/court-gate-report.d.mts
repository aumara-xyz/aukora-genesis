import type { GateClassificationCounts } from './court-gate-classification.mjs'

export interface CourtGateProcessResult {
  started: boolean
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  errorCode: string | null
  durationMs: number
}

export interface CourtGateRunResult {
  durationMs: number
  process: CourtGateProcessResult
  faultCount: number
}

export interface CourtGateRunReport extends CourtGateRunResult {
  identity: string
  label: string
  path: string
  args: string[]
  classification:
    | 'pass'
    | 'skip'
    | 'inconclusive'
    | 'kept-breach'
    | 'known-breach'
    | 'resolved'
    | 'counterfactual'
    | 'unexpected'
    | 'unclassified'
}

export interface CourtGateReport {
  schemaVersion: number
  subject: Record<string, unknown>
  runtime: Record<string, unknown>
  runs: CourtGateRunReport[]
  aggregate: {
    scheduled: number
    dispatched: number
    classified: number
    unclassified: number
    classifications: GateClassificationCounts
    accountingFaults: string[]
  }
  final: {
    verdict: 'failed' | 'inconclusive' | 'green-with-open-breaches' | 'green'
    exitCode: number
    systemSoundness: 'not-assessed'
    resolvedPendingOracleReview: number
  }
}

export declare const COURT_GATE_REPORT_SCHEMA_VERSION: number

export declare function resolveCourtGateReportDescriptor(args: string[]): number | null
export declare function courtGateReportEnabled(descriptor: number | null): boolean

export declare function courtGateProcessResult(
  result?: {
    status: number | null
    signal: string | null
    error?: NodeJS.ErrnoException
    stdout?: unknown
    stderr?: unknown
  },
  durationMs?: number,
): CourtGateProcessResult

export declare function parseCourtGateRunIdentity(identity: string): {
  identity: string
  label: string
  path: string
  args: string[]
}

export declare function buildCourtGateReport(input: {
  subject: Record<string, unknown>
  runtime: Record<string, unknown>
  scheduledRunRoster: string[]
  classifications: Map<string, Exclude<CourtGateRunReport['classification'], 'unclassified'>>
  runResults: Map<string, CourtGateRunResult>
  headline: GateClassificationCounts
  dispatchedCount: number
  classifiedCount: number
  accountingFaults: string[]
  finalStatus: number
}): CourtGateReport

export declare function persistCourtGateReportDescriptor(
  descriptor: number | null,
  report: object,
  gateStatus: number,
): { exitCode: number, error: Error | null }
