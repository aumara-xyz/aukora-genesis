import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { join } from 'node:path'

const ROW_ID = /^[A-Z]{1,3}\d{1,3}(?:[.-][a-z0-9]+)*$/
const ROW_LINE = /^ {2}(\S+) +(?:(.*?) +)?(\*\*\* BREACH \*\*\*|\*\*\* INCONCLUSIVE \*\*\*|\*\*\* KEPT BREACH \*\*\*|held) {2}(\S.*)$/
const ROW_LOOKING_LINE = /^\s*\S+\s+.*(?:\*\*\* (?:BREACH|INCONCLUSIVE|KEPT BREACH) \*\*\*|\bheld\b) {2,}\S/
const MUTATION_LINE = /^ {2}MUTATION (.+?) {2,}.*? {2,}(DETECTED|NOT DETECTED|HELD|NOT HELD)\s*$/
const MUTATION_ORACLE_LINE = /^ {2}MUTATION ordinary-row oracle {2,}expectedBreaches=\[([^\]]*)\] matched=(true|false)\s*$/
const MUTATION_LOOKING_LINE = /\bMUTATION(?:\s|$)/
const MUTATION_VERDICT_TOKEN = /\b(?:NOT DETECTED|DETECTED|NOT HELD|HELD)\b/
const ROW_VERDICT_TOKEN = /(?:\*\*\* (?:BREACH|INCONCLUSIVE|KEPT BREACH) \*\*\*|\bheld\b)/
const OUTPUT_CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/**
 * Resolve every named command against one fixed PATH directory list.
 * Missing commands remain explicit so a later addition changes the witness.
 * @param {readonly string[]} pathEntries Absolute PATH directories in search order.
 * @param {readonly string[]} names Executable basenames used by scheduled courts.
 * @returns {Array<{ name: string, path: string | null }>} Resolved command roster.
 */
export const resolvePathExecutables = (pathEntries, names) => names.map((name) => {
  for (const directory of pathEntries) {
    const candidate = join(directory, name)
    try {
      accessSync(candidate, fsConstants.X_OK)
      if (statSync(candidate).isFile()) return { name, path: candidate }
    } catch {
      // This PATH member does not provide the named executable.
    }
  }
  return { name, path: null }
})

/** Fixed identities and execution order for the production Court Gate. */
export const EXPECTED_GATE_RUNS = Object.freeze([
  'ordinary:verifier-bytes:normal|courts/harness/verifier-bytes/run.mjs|[]',
  'ordinary:verifier-bytes:mutation|courts/harness/verifier-bytes/run.mjs|["--mutate"]',
  'ordinary:broker:normal|courts/harness/broker/run.mjs|[]',
  'ordinary:broker:mutation|courts/harness/broker/run.mjs|["--mutate"]',
  'ordinary:settlement:normal|courts/harness/settlement/run.mjs|[]',
  'ordinary:settlement:mutation|courts/harness/settlement/run.mjs|["--mutate"]',
  'ordinary:aura-record:normal|courts/harness/aura-record/run.mjs|[]',
  'ordinary:aura-record:mutation|courts/harness/aura-record/run.mjs|["--mutate"]',
  'ordinary:aura-record:revert-line-encoding|courts/harness/aura-record/run.mjs|["--arm=revert-line-encoding"]',
  'ordinary:aura-record:revert-reserved-field|courts/harness/aura-record/run.mjs|["--arm=revert-reserved-field"]',
  'ordinary:aura-consistency:normal|courts/harness/aura-consistency/run.mjs|[]',
  'ordinary:aura-consistency:mutation|courts/harness/aura-consistency/run.mjs|["--mutate"]',
  'ordinary:spine:normal|courts/harness/spine/run.mjs|[]',
  'ordinary:spine:mutation|courts/harness/spine/run.mjs|["--mutate"]',
  'ordinary:wasm-proposal-cell:normal|courts/harness/wasm-proposal-cell/run.mjs|[]',
  'ordinary:wasm-proposal-cell:mutation|courts/harness/wasm-proposal-cell/run.mjs|["--mutate"]',
  'ordinary:guest-import-purity:normal|courts/harness/guest-import-purity/run.mjs|[]',
  'ordinary:guest-import-purity:mutation|courts/harness/guest-import-purity/run.mjs|["--mutate"]',
  'ordinary:kernel-hardening:normal|courts/harness/kernel-hardening/run.mjs|[]',
  'ordinary:kernel-hardening:mutation|courts/harness/kernel-hardening/run.mjs|["--mutate"]',
  'ordinary:identity-core:normal|courts/harness/identity-core/run.mjs|[]',
  'ordinary:identity-core:mutation|courts/harness/identity-core/run.mjs|["--mutate"]',
  'ordinary:confinement:normal|courts/harness/confinement/run.mjs|[]',
  'ordinary:confinement:mutation|courts/harness/confinement/run.mjs|["--mutate"]',
  'ordinary:uid-confinement:normal|courts/harness/uid-confinement/run.mjs|[]',
  'ordinary:uid-confinement:mutation|courts/harness/uid-confinement/run.mjs|["--mutate"]',
  'ordinary:live-dispatch:normal|courts/harness/live-dispatch/run.mjs|[]',
  'ordinary:live-dispatch:mutation|courts/harness/live-dispatch/run.mjs|["--mutate"]',
  'ordinary:intent-reconciliation:normal|courts/harness/intent-reconciliation/run.mjs|[]',
  'ordinary:intent-reconciliation:mutation|courts/harness/intent-reconciliation/run.mjs|["--mutate"]',
  'ordinary:amendment-channel:normal|courts/harness/amendment-channel/run.mjs|[]',
  'ordinary:amendment-channel:mutation|courts/harness/amendment-channel/run.mjs|["--mutate"]',
  'ordinary:compute-job:normal|courts/harness/compute-job/run.mjs|[]',
  'ordinary:compute-job:mutation|courts/harness/compute-job/run.mjs|["--mutate"]',
  'ordinary:receipt-v3:normal|courts/harness/receipt-v3/run.mjs|[]',
  'ordinary:receipt-v3:mutation|courts/harness/receipt-v3/run.mjs|["--mutate"]',
  'ordinary:receipt-inspect:normal|courts/harness/receipt-inspect/run.mjs|[]',
  'ordinary:receipt-inspect:mutation|courts/harness/receipt-inspect/run.mjs|["--mutate"]',
  'ordinary:wysiwys-issuer:normal|courts/harness/wysiwys-issuer/run.mjs|[]',
  'ordinary:wysiwys-issuer:semantic-body|courts/harness/wysiwys-issuer/run.mjs|["--mutate"]',
  'ordinary:wysiwys-issuer:rider|courts/harness/wysiwys-issuer/run.mjs|["--mutate-rider"]',
  'ordinary:wysiwys-issuer:fixed-field|courts/harness/wysiwys-issuer/run.mjs|["--mutate-fields"]',
  'ordinary:wysiwys-issuer:mint-drift|courts/harness/wysiwys-issuer/run.mjs|["--mutate-mint-drift"]',
  'enrolled:escalation:normal|courts/harness/escalation/run.mjs|[]',
  'enrolled:escalation:mutation|courts/harness/escalation/run.mjs|["--mutate"]',
  'enrolled:executable-configuration:normal|courts/harness/executable-configuration/run.mjs|[]',
  'enrolled:executable-configuration:mutation|courts/harness/executable-configuration/run.mjs|["--mutate"]',
  'enrolled:composition-closure:normal|courts/harness/composition-closure/run.mjs|[]',
  'enrolled:composition-closure:mutation|courts/harness/composition-closure/run.mjs|["--mutate"]',
  'enrolled:launch-ceremony:normal|courts/harness/launch-ceremony/run.mjs|[]',
  'enrolled:launch-ceremony:mutation|courts/harness/launch-ceremony/run.mjs|["--mutate"]',
  'enrolled:launch-ceremony:additional:prove-second-uid|courts/harness/launch-ceremony/run.mjs|["--prove-second-uid"]',
  'enrolled:launch-ceremony-topology:normal|courts/harness/launch-ceremony-topology/run.mjs|[]',
  'enrolled:launch-ceremony-topology:mutation|courts/harness/launch-ceremony-topology/run.mjs|["--mutate"]',
])

/**
 * Parse the row table emitted by a Court harness.
 * @param {string} text Combined court output.
 * @returns {{
 *   raw: Array<{ id: string, verdict: string, line: number }>,
 *   breach: Set<string>,
 *   held: Set<string>,
 *   inconclusive: Set<string>,
 *   keptBreach: Set<string>,
 *   duplicateIds: string[],
 *   unparsedLines: number[],
 * }} Parsed row partitions.
 */
export const parseCourtRows = (text) => {
  const raw = []
  const breach = new Set()
  const held = new Set()
  const inconclusive = new Set()
  const keptBreach = new Set()
  const unparsedLines = new Set()
  for (const [index, line] of text.split('\n').entries()) {
    if (OUTPUT_CONTROL.test(line)) {
      unparsedLines.add(index + 1)
      continue
    }
    const match = ROW_LINE.exec(line)
    if (match === null || !ROW_ID.test(match[1])) {
      if (ROW_LOOKING_LINE.test(line)) unparsedLines.add(index + 1)
      continue
    }
    if ((match[2] !== undefined && ROW_VERDICT_TOKEN.test(match[2])) || ROW_VERDICT_TOKEN.test(match[4])) {
      unparsedLines.add(index + 1)
      continue
    }
    raw.push({ id: match[1], verdict: match[3], line: index + 1 })
    if (match[3] === 'held') held.add(match[1])
    else if (match[3] === '*** BREACH ***') breach.add(match[1])
    else if (match[3] === '*** INCONCLUSIVE ***') inconclusive.add(match[1])
    else keptBreach.add(match[1])
  }
  const seen = new Set()
  const duplicateIds = new Set()
  for (const { id } of raw) {
    if (seen.has(id)) duplicateIds.add(id)
    seen.add(id)
  }
  return {
    raw,
    breach,
    held,
    inconclusive,
    keptBreach,
    duplicateIds: [...duplicateIds].sort(),
    unparsedLines: [...unparsedLines].sort((a, b) => a - b),
  }
}

/**
 * Parse named counterfactual results and the ordinary-row oracle sentinel.
 * @param {string} text Combined court output.
 * @returns {{
 *   raw: Array<{ marker: string, verdict: string, line: number }>,
 *   duplicateMarkers: string[],
 *   oracleResults: Array<{ expectedBreaches: string[], matched: boolean, line: number }>,
 *   unparsedLines: number[],
 * }} Parsed counterfactual evidence.
 */
export const parseMutationResults = (text) => {
  const raw = []
  const oracleResults = []
  const unparsedLines = new Set()
  for (const [index, line] of text.split('\n').entries()) {
    if (OUTPUT_CONTROL.test(line)) {
      unparsedLines.add(index + 1)
      continue
    }
    const result = MUTATION_LINE.exec(line)
    if (result !== null) {
      const terminalStart = line.trimEnd().lastIndexOf(result[2])
      const beforeTerminal = line.slice(0, terminalStart)
      if (MUTATION_VERDICT_TOKEN.test(beforeTerminal)) unparsedLines.add(index + 1)
      else raw.push({ marker: result[1].trim(), verdict: result[2], line: index + 1 })
    }
    const oracle = MUTATION_ORACLE_LINE.exec(line)
    if (oracle !== null) {
      oracleResults.push({
        expectedBreaches: oracle[1].trim() === '' ? [] : oracle[1].trim().split(/\s+/),
        matched: oracle[2] === 'true',
        line: index + 1,
      })
    }
    if (MUTATION_LOOKING_LINE.test(line) && result === null && oracle === null) unparsedLines.add(index + 1)
  }
  const seen = new Set()
  const duplicateMarkers = new Set()
  for (const { marker } of raw) {
    if (seen.has(marker)) duplicateMarkers.add(marker)
    seen.add(marker)
  }
  return {
    raw,
    duplicateMarkers: [...duplicateMarkers].sort(),
    oracleResults,
    unparsedLines: [...unparsedLines].sort((a, b) => a - b),
  }
}

/**
 * Compare parsed counterfactual output with the manifest declaration.
 * @param {string} text Combined court output.
 * @param {Array<{
 *   marker: string,
 *   verdict: 'DETECTED' | 'NOT DETECTED' | 'HELD' | 'NOT HELD',
 *   detailExact?: string,
 * }>} expected Declared results.
 * @param {readonly string[]} expectedBreachRows Breach rows named by the oracle.
 * @returns {string[]} Fail-closed discrepancies.
 */
export const mutationResultFaults = (text, expected, expectedBreachRows = []) => {
  const parsed = parseMutationResults(text)
  const faults = []
  const lines = text.split('\n')
  const claimedLines = new Map()
  const duplicateMarkers = new Set()
  for (const { marker, verdict, detailExact } of expected) {
    const matches = detailExact === undefined
      ? parsed.raw.filter((result) => result.marker === marker)
      : lines.flatMap((line, index) => {
        const prefix = `  MUTATION ${marker} ${detailExact}   `
        if (!line.startsWith(prefix)) return []
        const terminal = line.slice(prefix.length)
        return ['DETECTED', 'NOT DETECTED', 'HELD', 'NOT HELD'].includes(terminal)
          ? [{ marker, verdict: terminal, line: index + 1 }]
          : []
      })
    for (const result of matches) {
      const claimers = claimedLines.get(result.line) ?? []
      claimers.push(marker)
      claimedLines.set(result.line, claimers)
    }
    if (matches.length === 0) faults.push(`missing mutation marker ${JSON.stringify(marker)}`)
    if (matches.length > 1) duplicateMarkers.add(marker)
    if (matches.length === 1 && matches[0].verdict !== verdict) {
      faults.push(`mutation ${JSON.stringify(marker)} reported ${matches[0].verdict}, expected ${verdict}`)
    }
  }
  if (duplicateMarkers.size > 0) {
    faults.unshift(`duplicate mutation markers: ${[...duplicateMarkers].sort().join(', ')}`)
  }
  for (const [line, claimers] of claimedLines) {
    if (claimers.length > 1) {
      faults.push(`mutation output line ${line} matched multiple declarations: ${claimers.map(claim => JSON.stringify(claim)).join(', ')}`)
    }
  }
  for (const { marker, line } of parsed.raw) {
    if (!claimedLines.has(line)) faults.push(`undeclared mutation marker ${JSON.stringify(marker)}`)
  }
  const unparsedLines = parsed.unparsedLines.filter((line) => !claimedLines.has(line))
  if (unparsedLines.length > 0) faults.push(`unparseable mutation output at lines: ${unparsedLines.join(', ')}`)
  if (parsed.oracleResults.length !== 1) {
    faults.push(`ordinary-row oracle appeared ${parsed.oracleResults.length} times, expected exactly once`)
  } else if (!parsed.oracleResults[0].matched) {
    faults.push('ordinary-row oracle reported matched=false')
  } else {
    const named = parsed.oracleResults[0].expectedBreaches
    if (named.length !== new Set(named).size) faults.push('ordinary-row oracle repeated an expected breach row')
    const missing = expectedBreachRows.filter(row => !named.includes(row))
    const extra = named.filter(row => !expectedBreachRows.includes(row))
    if (missing.length > 0) faults.push(`ordinary-row oracle omitted breach rows: ${missing.join(', ')}`)
    if (extra.length > 0) faults.push(`ordinary-row oracle added breach rows: ${extra.join(', ')}`)
    let terminalLine = lines.length
    while (terminalLine > 0 && lines[terminalLine - 1].trim() === '') terminalLine--
    if (parsed.oracleResults[0].line !== terminalLine) {
      faults.push(`ordinary-row oracle was at line ${parsed.oracleResults[0].line}, but output terminated at line ${terminalLine}`)
    }
  }
  return faults
}

/**
 * Require all four parent-guest amendment controls and their observations.
 * @param {string} text Complete amendment mutation stdout.
 * @returns {string[]} Missing, forged, or contradictory counterfactual evidence.
 */
export const amendmentChannelMutationFaults = (text) => {
  const controls = [
    ['watcher neutralized', 'ordinary live under real=true, under mutant=false, watched=[]'],
    ['disabled row composed', 'live entries moved=true, model-visible tools moved=false'],
    ['refusal removed', 'both guest defense controls=[true,true]'],
    ['parent disposition removed', 'both guest live amendments=[true,true]'],
  ]
  const faults = mutationResultFaults(text, controls.map(([marker]) => ({ marker, verdict: 'DETECTED' })))
  const parsed = parseMutationResults(text)
  const lines = text.split('\n')
  for (const [marker, detail] of controls) {
    const matches = parsed.raw.filter(result => result.marker === marker)
    if (matches.length === 1) {
      const columns = lines[matches[0].line - 1].trim().split(/ {2,}/)
      if (columns.length !== 3 || columns[1] !== detail) {
        faults.push(`mutation ${JSON.stringify(marker)} observations differ from the required control`)
      }
    }
  }
  return faults
}

/**
 * Compare the scheduled run identities with the fixed production roster.
 * @param {readonly string[]} actual Scheduled run identities.
 * @returns {string[]} Missing, extra, duplicate, or reordered identities.
 */
export const gateRosterFaults = (actual) => {
  const faults = []
  const seen = new Set()
  const duplicates = new Set()
  for (const identity of actual) {
    if (seen.has(identity)) duplicates.add(identity)
    seen.add(identity)
  }
  if (duplicates.size > 0) faults.push(`duplicate scheduled runs: ${[...duplicates].sort().join(', ')}`)
  const expected = new Set(EXPECTED_GATE_RUNS)
  const missing = EXPECTED_GATE_RUNS.filter((identity) => !seen.has(identity))
  const extra = [...seen].filter((identity) => !expected.has(identity)).sort()
  if (missing.length > 0) faults.push(`missing scheduled runs: ${missing.join(', ')}`)
  if (extra.length > 0) faults.push(`unexpected scheduled runs: ${extra.join(', ')}`)
  if (faults.length === 0 && actual.some((identity, index) => identity !== EXPECTED_GATE_RUNS[index])) {
    faults.push('scheduled run order differs from the fixed production roster')
  }
  return faults
}

/**
 * Compare observed kept-breach rows with the oracle declaration.
 * @param {readonly string[]} expectedRows Declared kept rows for this court.
 * @param {Set<string>} observedRows Parsed kept rows.
 * @returns {string[]} Fail-closed discrepancies.
 */
export const keptBreachFaults = (expectedRows, observedRows) => {
  const faults = []
  const expected = new Set(expectedRows)
  for (const row of expected) if (!observedRows.has(row)) faults.push(`kept-breach row ${row} was not emitted`)
  for (const row of observedRows) if (!expected.has(row)) faults.push(`undeclared kept-breach row ${row} was emitted`)
  return faults
}

/**
 * Compare every ordinary verdict partition with its fixed declaration.
 * @param {{ held: readonly string[], breach: readonly string[], kept: readonly string[] }} expected Declared rows.
 * @param {{ held: Set<string>, breach: Set<string>, keptBreach: Set<string>, inconclusive: Set<string> }} observed Parsed rows.
 * @returns {string[]} Missing, added, or misclassified rows.
 */
export const ordinaryResultFaults = (expected, observed) => {
  const faults = []
  if (observed.unparsedLines.length > 0) {
    faults.push(`unparseable court rows at lines: ${observed.unparsedLines.join(', ')}`)
  }
  const compare = (name, declared, actual) => {
    const missing = declared.filter(row => !actual.has(row))
    const added = [...actual].filter(row => !declared.includes(row)).sort()
    if (missing.length > 0) faults.push(`${name} rows missing: ${missing.join(', ')}`)
    if (added.length > 0) faults.push(`${name} rows added: ${added.join(', ')}`)
  }
  compare('held', expected.held, observed.held)
  compare('breach', expected.breach, observed.breach)
  compare('kept-breach', expected.kept, observed.keptBreach)
  if (observed.inconclusive.size > 0) {
    faults.push(`inconclusive rows emitted without an inconclusive exit: ${[...observed.inconclusive].sort().join(', ')}`)
  }
  return faults
}

const LIVE_DISPATCH_NORMAL = Object.freeze([
  { spec: 'packages/governed/memory-put/tests/live-dispatch.spec.ts', total: 38, passed: 33, failed: 0, pending: 5 },
  { spec: 'packages/governed/memory-put/tests/loader-profile.spec.ts', total: 6, passed: 6, failed: 0, pending: 0 },
])

/**
 * Verify both one-line JSON collection records emitted by the live-dispatch wrapper.
 * @param {string} text Court stdout.
 * @param {string} root Absolute repository root used in Vitest's collection report.
 * @returns {string[]} Fail-closed discrepancies.
 */
export const liveDispatchNormalFaults = (text, root) => {
  const observed = text.split('\n').filter(line => /^\s*NORMAL(?:\s|$)/.test(line))
  const expected = LIVE_DISPATCH_NORMAL.map(({ spec, total, passed, failed, pending }) => `  NORMAL ${JSON.stringify({
    spec,
    runnerStatus: 0,
    runnerSignal: null,
    reportSuccess: true,
    tests: { total, passed, failed, pending },
    assertionCounts: { passed, failed, pending },
    collectedEntry: join(root, spec),
    exact: true,
  })}`)
  const faults = []
  if (observed.length !== expected.length) {
    faults.push(`live-dispatch normal evidence appeared ${observed.length} times, expected ${expected.length}`)
  }
  for (const [index, line] of observed.entries()) {
    if (line !== expected[index]) faults.push(`live-dispatch normal evidence ${index + 1} was not exact`)
  }
  return faults
}

const LIVE_DISPATCH_MUTATION = Object.freeze({
  mutant: 'broker-copy-with-verifyGrant-patched-to-ok',
  controlRow: 'control-valid-settles',
  controlPassed: true,
  securityRowsExpected: ['L4-forged', 'L6-replayed', 'L8-argument-mutation'],
  stillRefusedRows: ['m-expired'],
  breachedRows: ['L4-forged', 'L6-replayed', 'L8-argument-mutation'],
  observations: {
    control: { isError: false },
    'm-forged': { isError: false },
    'm-expired': { isError: true, error: 'memory.put: authorization does not bind to these arguments' },
    'm-replayed': { isError: false },
    'm-mutated': { isError: false },
  },
  testsCollected: 5,
  mutationDetected: true,
  mutantApplied: true,
  missingSecurityRows: [],
  runnerPassed: true,
  observationsExact: true,
  securityRowsExact: true,
  defenseHeld: true,
  countExact: true,
  subjectExact: true,
})

/**
 * Verify the canonical terminal JSON record emitted by the live-dispatch mutation wrapper.
 * @param {string} text Court stdout.
 * @returns {string[]} Fail-closed discrepancies.
 */
export const liveDispatchMutationFaults = (text) => {
  const lines = text.split('\n')
  const starts = lines.flatMap((line, index) => /^\s*MUTATION(?:\s|$)/.test(line) ? [index] : [])
  const faults = []
  if (starts.length !== 1) {
    faults.push(`live-dispatch mutation evidence appeared ${starts.length} times, expected exactly once`)
    return faults
  }
  let terminalIndex = lines.length - 1
  while (terminalIndex >= 0 && lines[terminalIndex].trim() === '') terminalIndex--
  const start = starts[0]
  if (lines[start] !== '  MUTATION {' || terminalIndex < start) {
    faults.push('live-dispatch mutation evidence did not use the canonical JSON envelope')
    return faults
  }
  const source = ['{', ...lines.slice(start + 1, terminalIndex + 1)].join('\n')
  let value
  try {
    value = JSON.parse(source)
  } catch {
    faults.push('live-dispatch mutation evidence was not valid JSON')
    return faults
  }
  if (source !== JSON.stringify(value, null, 2)) faults.push('live-dispatch mutation evidence was not canonical JSON')
  if (source !== JSON.stringify(LIVE_DISPATCH_MUTATION, null, 2)) faults.push('live-dispatch mutation evidence was not exact')
  return faults
}

/**
 * Count primary classifications assigned to scheduled subprocesses.
 * @param {{
 *   passed: number,
 *   skipped: number,
 *   inconclusive: number,
 *   keptBreach: number,
 *   knownBreach: number,
 *   resolved: number,
 *   mutationDetected: number,
 *   unexpected: number,
 * }} counts Gate headline buckets.
 * @returns {number} Classified subprocess count.
 */
export const classifiedRunCount = (counts) => Object.values(counts).reduce((sum, count) => sum + count, 0)
