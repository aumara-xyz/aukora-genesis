import { writeFileSync } from 'node:fs'

/** Version of the retained Court Gate report fields. */
export const COURT_GATE_REPORT_SCHEMA_VERSION = 1

const EMPTY_PROCESS_RESULT = Object.freeze({
  started: false,
  exitCode: null,
  signal: null,
  timedOut: false,
  errorCode: null,
  durationMs: 0,
})
const EMPTY_RUN_RESULT = Object.freeze({
  durationMs: 0,
  process: EMPTY_PROCESS_RESULT,
  faultCount: 0,
})
const CLASSIFICATION_BUCKETS = Object.freeze({
  pass: 'passed',
  skip: 'skipped',
  inconclusive: 'inconclusive',
  'kept-breach': 'keptBreach',
  'known-breach': 'knownBreach',
  resolved: 'resolved',
  counterfactual: 'mutationDetected',
  unexpected: 'unexpected',
})

/**
 * Validate an inherited descriptor used for bounded report capture.
 * @param {string[]} args Arguments after the runner entry point.
 * @returns {number | null} Descriptor three, or null when this transport is not requested.
 */
export const resolveCourtGateReportDescriptor = (args) => {
  if (args.length === 0) return null
  if (args.length !== 2 || args[1] !== '3') {
    throw new Error('usage: node scripts/run-gate.mjs [--report-fd 3]')
  }
  if (args[0] !== '--report-fd') throw new Error('usage: node scripts/run-gate.mjs [--report-fd 3]')
  return 3
}

/**
 * Return whether inherited-descriptor report transport is active.
 * @param {number | null} descriptor Validated descriptor transport.
 * @returns {boolean} Whether the runner must collect and build report witnesses.
 */
export const courtGateReportEnabled = descriptor => descriptor !== null

/**
 * Project a synchronous child result without retaining output, errors, or environment values.
 * @param {import('node:child_process').SpawnSyncReturns<string> | undefined} result Child result when execution started.
 * @param {number} durationMs Elapsed wall-clock milliseconds.
 * @returns {{ started: boolean, exitCode: number | null, signal: string | null, timedOut: boolean, errorCode: string | null, durationMs: number }} Retained process facts.
 */
export const courtGateProcessResult = (result, durationMs = 0) => ({
  started: result !== undefined,
  exitCode: Number.isInteger(result?.status) ? result.status : null,
  signal: typeof result?.signal === 'string' ? result.signal : null,
  timedOut: result?.error?.code === 'ETIMEDOUT',
  errorCode: typeof result?.error?.code === 'string' ? result.error.code : null,
  durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : 0,
})

/**
 * Split the fixed runner identity into reviewable execution fields.
 * @param {string} identity Fixed `label|path|JSON(args)` identity.
 * @returns {{ identity: string, label: string, path: string, args: string[] }} Parsed identity.
 */
export const parseCourtGateRunIdentity = (identity) => {
  const first = identity.indexOf('|')
  const second = identity.indexOf('|', first + 1)
  if (first <= 0 || second <= first + 1 || identity.indexOf('|', second + 1) !== -1) {
    throw new Error(`invalid Court Gate run identity: ${JSON.stringify(identity)}`)
  }
  const args = JSON.parse(identity.slice(second + 1))
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
    throw new Error(`invalid Court Gate argument vector: ${JSON.stringify(identity)}`)
  }
  return {
    identity,
    label: identity.slice(0, first),
    path: identity.slice(first + 1, second),
    args,
  }
}

/**
 * Build one complete report in the fixed scheduled-run order.
 * @param {{
 *   subject: object,
 *   runtime: object,
 *   scheduledRunRoster: string[],
 *   classifications: Map<string, string>,
 *   runResults: Map<string, object>,
 *   headline: object,
 *   dispatchedCount: number,
 *   classifiedCount: number,
 *   accountingFaults: string[],
 *   finalStatus: number,
 * }} input Final runner evidence.
 * @returns {object} JSON-serializable Court Gate report.
 */
export const buildCourtGateReport = (input) => {
  const runs = input.scheduledRunRoster.map((identity) => {
    const result = input.runResults.get(identity) ?? EMPTY_RUN_RESULT
    return {
      ...parseCourtGateRunIdentity(identity),
      classification: input.classifications.get(identity) ?? 'unclassified',
      durationMs: result.durationMs,
      process: result.process,
      faultCount: result.faultCount,
    }
  })
  const unclassified = runs.filter(run => run.classification === 'unclassified').length
  const classifications = Object.fromEntries(Object.values(CLASSIFICATION_BUCKETS).map(bucket => [bucket, 0]))
  for (const run of runs) {
    const bucket = CLASSIFICATION_BUCKETS[run.classification]
    if (run.classification !== 'unclassified' && bucket === undefined) {
      throw new Error(`unknown Court Gate classification: ${JSON.stringify(run.classification)}`)
    }
    if (bucket !== undefined) classifications[bucket]++
  }
  if (JSON.stringify(classifications) !== JSON.stringify(input.headline)) {
    throw new Error('Court Gate report classifications differ from the runner headline')
  }
  const verdict = input.finalStatus === 78
    ? 'inconclusive'
    : input.finalStatus !== 0
      ? 'failed'
      : input.headline.knownBreach > 0 || input.headline.keptBreach > 0
        ? 'green-with-open-breaches'
        : 'green'
  return {
    schemaVersion: COURT_GATE_REPORT_SCHEMA_VERSION,
    subject: input.subject,
    runtime: input.runtime,
    runs,
    aggregate: {
      scheduled: input.scheduledRunRoster.length,
      dispatched: input.dispatchedCount,
      classified: input.classifiedCount,
      unclassified,
      classifications,
      accountingFaults: [...input.accountingFaults],
    },
    final: {
      verdict,
      exitCode: input.finalStatus,
      systemSoundness: 'not-assessed',
      resolvedPendingOracleReview: classifications.resolved,
    },
  }
}

/**
 * Persist an enabled report through one inherited descriptor.
 * @param {number | null} descriptor Validated inherited descriptor, or null when disabled.
 * @param {object} report Complete report.
 * @param {number} gateStatus Gate verdict before report persistence.
 * @returns {{ exitCode: number, error: Error | null }} Final process outcome.
 */
export const persistCourtGateReportDescriptor = (descriptor, report, gateStatus) => {
  if (descriptor === null) return { exitCode: gateStatus, error: null }
  try {
    writeFileSync(descriptor, `${JSON.stringify(report, null, 2)}\n`)
    return { exitCode: gateStatus, error: null }
  } catch (error) {
    return {
      exitCode: 1,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}
