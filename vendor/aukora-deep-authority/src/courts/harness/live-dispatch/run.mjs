/**
 * courts/harness/live-dispatch — the governed memory.put tool driven through
 * the real DSH ToolRuntime.execute seam (pre-execute ask -> approval answerer
 * -> grant -> tool body -> broker process -> effect -> receipt -> Aura).
 *
 * Runs the vitest court in `packages/governed/memory-put/tests`. Requires the
 * DSH workspace deps, so the gate must install them first (CI does).
 *
 *   node courts/harness/live-dispatch/run.mjs
 *   node courts/harness/live-dispatch/run.mjs --mutate
 *
 * --mutate performs REAL mutation testing against a temporary patched COPY of
 * the broker tree written to the system temp dir. The copy is outside the
 * repository and outside every package import graph, so production cannot load
 * it; production broker behavior is invariant under any environment variable.
 *
 * Both modes fail closed on a Vitest startup failure, timeout, nonzero exit,
 * or missing collection evidence. Normal mode requires Vitest's own JSON
 * report to name each production entry spec and its exact result count.
 * Mutation mode additionally requires its test-produced sentinel: the control
 * and defense rows must hold, the exact named security rows must observe the
 * exploit, and no observation may be missing or unexpected.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const SPEC = 'packages/governed/memory-put/tests/live-dispatch.spec.ts'
const PROFILE_SPEC = 'packages/governed/memory-put/tests/loader-profile.spec.ts'
const BROKER_SOURCE = join(ROOT, 'aukora', 'broker', 'broker.mjs')
const MUTATE = process.argv.includes('--mutate')
const TIMEOUT_MS = 300000
const NORMAL_EVIDENCE = [
  { spec: SPEC, total: 38, passed: 33, failed: 0, pending: 5 },
  { spec: PROFILE_SPEC, total: 6, passed: 6, failed: 0, pending: 0 },
]
let workdir // module-level so process.on('exit') can reach it

process.on('exit', () => {
  if (workdir !== undefined) {
    try { rmSync(workdir, { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
  }
})

function red(reason) {
  console.error(`\n  MUTATION ${reason}  detected=false  RED\n`)
  process.exit(1)
}

/**
 * Run one normal production entry test through Vitest's own JSON reporter.
 *
 * This is runner-owned collection evidence, not a test-authored success
 * sentinel: the file names the actual entry spec and its exact passed, failed,
 * and pending counts. It prevents an empty or differently collected test run
 * from grading green, but does not make the test framework an independent
 * observer of the production behavior.
 */
function runNormalEvidence({ spec, total, passed, failed, pending }) {
  const evidenceDir = mkdtempSync(join(tmpdir(), 'aukora-live-dispatch-normal-'))
  const reportPath = join(evidenceDir, 'vitest.json')
  let runner
  let report = null
  try {
    runner = spawnSync('pnpm', ['vitest', 'run', spec, '--reporter=json', `--outputFile=${reportPath}`], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: TIMEOUT_MS,
    })
    if (existsSync(reportPath)) {
      try {
        report = JSON.parse(readFileSync(reportPath, 'utf8'))
      } catch {
        report = null
      }
    }
    const results = Array.isArray(report?.testResults) ? report.testResults : []
    const matchingResult = results.length === 1 && results[0]?.name === join(ROOT, spec)
      ? results[0]
      : null
    const assertionResults = Array.isArray(matchingResult?.assertionResults) ? matchingResult.assertionResults : []
    const assertionCounts = {
      passed: assertionResults.filter((result) => result?.status === 'passed').length,
      failed: assertionResults.filter((result) => result?.status === 'failed').length,
      pending: assertionResults.filter((result) => result?.status === 'skipped' || result?.status === 'pending').length,
    }
    const exact = runner?.error === undefined
      && runner?.status === 0
      && report?.success === true
      && report?.numTotalTests === total
      && report?.numPassedTests === passed
      && report?.numFailedTests === failed
      && report?.numPendingTests === pending
      && matchingResult?.status === 'passed'
      && assertionResults.length === total
      && assertionCounts.passed === passed
      && assertionCounts.failed === failed
      && assertionCounts.pending === pending
    console.log(`\n  NORMAL ${JSON.stringify({
      spec,
      runnerStatus: runner?.status ?? null,
      runnerSignal: runner?.signal ?? null,
      reportSuccess: report?.success ?? null,
      tests: {
        total: report?.numTotalTests ?? null,
        passed: report?.numPassedTests ?? null,
        failed: report?.numFailedTests ?? null,
        pending: report?.numPendingTests ?? null,
      },
      assertionCounts,
      collectedEntry: matchingResult?.name ?? null,
      exact,
    })}\n`)
    return exact
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true })
  }
}

if (!MUTATE) {
  const evidenceHeld = NORMAL_EVIDENCE.every(runNormalEvidence)
  process.exit(evidenceHeld ? 0 : 1)
}

// ---------------------------------------------------------------------------
// Mutation: patch grant verification out of a TEMPORARY COPY of the broker.
// ---------------------------------------------------------------------------
try {
  workdir = mkdtempSync(join(tmpdir(), 'aukora-mutant-'))
  const tree = join(workdir, 'aukora')
  cpSync(join(ROOT, 'aukora'), tree, { recursive: true })
  const brokerCopy = join(tree, 'broker', 'broker.mjs')
  const source = readFileSync(brokerCopy, 'utf8')
  // Anchor on the unconditional verification call; remove the whole block.
  const anchor = /const verdict = verifyGrant\(\{[\s\S]*?\n    \}\)/
  if (!anchor.test(source)) red('mutation anchor not found in broker source')
  const mutated = source.replace(anchor, 'const verdict = { ok: true }')
  if (mutated === source || mutated.includes('verifyGrant({')) red('mutation did not remove verification from the broker copy')
  writeFileSync(brokerCopy, mutated)
  const mutantEntry = brokerCopy

  const sentinelPath = join(workdir, 'sentinel.json')
  const r = spawnSync('pnpm', ['vitest', 'run', SPEC], {
    cwd: ROOT,
    env: { ...process.env, AUKORA_MUTANT_BROKER_ENTRY: mutantEntry, AUKORA_MUTATION_SENTINEL: sentinelPath },
    stdio: 'inherit',
    timeout: TIMEOUT_MS,
  })
  if (r.error !== undefined) red(`mutation runner could not start vitest (${String(r.error.code ?? r.error.message)})`)
  if (r.status === null) red(`mutation run killed by signal ${String(r.signal)}`)
  if (!existsSync(sentinelPath)) red('no mutation sentinel — vitest crashed or collected zero tests')

  let sentinel
  try {
    sentinel = JSON.parse(readFileSync(sentinelPath, 'utf8'))
  } catch {
    red('mutation sentinel is not valid JSON')
  }
  const missingSecurityRows = Array.isArray(sentinel.securityRowsExpected)
    ? sentinel.securityRowsExpected.filter(row => !Array.isArray(sentinel.breachedRows) || !sentinel.breachedRows.includes(row))
    : ['sentinel-malformed']
  const expectedObservationRows = ['control', 'm-forged', 'm-expired', 'm-replayed', 'm-mutated']
  const expectedSecurityRows = ['L4-forged', 'L6-replayed', 'L8-argument-mutation']
  const exactNames = (actual, expected) => Array.isArray(actual)
    && actual.length === expected.length
    && [...actual].sort().every((name, index) => name === [...expected].sort()[index])
  const observedRows = sentinel.observations !== null && typeof sentinel.observations === 'object'
    ? Object.keys(sentinel.observations)
    : []
  const runnerPassed = r.status === 0
  const observationsExact = exactNames(observedRows, expectedObservationRows)
  const securityRowsExact = exactNames(sentinel.securityRowsExpected, expectedSecurityRows)
    && exactNames(sentinel.breachedRows, expectedSecurityRows)
  const defenseHeld = sentinel.observations?.['m-expired']?.isError === true
    && exactNames(sentinel.stillRefusedRows, ['m-expired'])
  const countExact = sentinel.testsCollected === expectedObservationRows.length
  const subjectExact = sentinel.mutant === 'broker-copy-with-verifyGrant-patched-to-ok'
    && sentinel.controlRow === 'control-valid-settles'
  const detected = runnerPassed
    && sentinel.controlPassed === true
    && missingSecurityRows.length === 0
    && observationsExact
    && securityRowsExact
    && defenseHeld
    && countExact
    && subjectExact
  console.log(`\n  MUTATION ${JSON.stringify({
    ...sentinel,
    mutant: sentinel.mutant ?? 'unknown',
    mutantApplied: true,
    controlRow: sentinel.controlRow ?? 'control-valid-settles',
    controlPassed: sentinel.controlPassed === true,
    breachedRows: sentinel.breachedRows ?? [],
    securityRowsExpected: sentinel.securityRowsExpected ?? [],
    missingSecurityRows,
    runnerPassed,
    observationsExact,
    securityRowsExact,
    defenseHeld,
    countExact,
    subjectExact,
    mutationDetected: detected,
  }, null, 2)}\n`)
  process.exit(detected ? 0 : 1)
} catch (error) {
  // Fail closed: any crash in the mutation runner is RED, never green.
  console.error(`mutation runner crashed: ${String(error?.message ?? error)}`)
  process.exit(1)
}
