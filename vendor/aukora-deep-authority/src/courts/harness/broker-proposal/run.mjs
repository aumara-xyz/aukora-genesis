/**
 * courts/harness/broker-proposal — the broker-owned product proposal route.
 *
 * Normal mode requires the complete package matrix and then changes a v4
 * artifact after issuer verification in a copied source tree. The effect-side
 * verifier must refuse it without a nonce, object, or Aura entry.
 *
 * Mutation mode removes that final verifier from the same copied tree. The
 * intervention must settle and make the verifier spec fail, proving that the
 * normal row depends on the production check rather than an earlier guard.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const MATRIX = 'packages/governed/memory-put/tests/broker-proposal.spec.ts'
const VERIFIER = 'packages/governed/memory-put/tests/broker-proposal-verifier.spec.ts'
const MUTATE = process.argv.includes('--mutate')
const TIMEOUT_MS = 120_000
let workdir

process.on('exit', () => {
  if (workdir !== undefined) {
    try { rmSync(workdir, { recursive: true, force: true }) } catch { /* best-effort court cleanup */ }
  }
})

function fail(message) {
  console.error(`broker-proposal: ${message}`)
  process.exit(1)
}

function runMatrix() {
  const report = join(workdir, 'matrix.json')
  const result = spawnSync('pnpm', ['vitest', 'run', MATRIX, '--reporter=json', `--outputFile=${report}`], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: TIMEOUT_MS,
  })
  if (result.error !== undefined || result.signal !== null || result.status !== 0 || !existsSync(report)) {
    fail('normal matrix did not complete')
  }
  let evidence
  try { evidence = JSON.parse(readFileSync(report, 'utf8')) } catch { fail('normal matrix report was not JSON') }
  const results = Array.isArray(evidence.testResults) ? evidence.testResults : []
  const collected = results.length === 1 && results[0]?.name === join(ROOT, MATRIX) ? results[0] : null
  const assertions = Array.isArray(collected?.assertionResults) ? collected.assertionResults : []
  if (evidence.numTotalTests !== 52
    || evidence.numPassedTests !== 52
    || evidence.numFailedTests !== 0
    || evidence.numPendingTests !== 0
    || evidence.success !== true
    || collected?.status !== 'passed'
    || assertions.length !== 52
    || assertions.some(assertion => assertion?.status !== 'passed')) {
    fail('normal matrix count was not exactly 52/52/0/0')
  }
}

function readVerifierEvidence(report) {
  if (!existsSync(report)) fail('verifier intervention omitted its JSON report')
  let evidence
  try { evidence = JSON.parse(readFileSync(report, 'utf8')) } catch { fail('verifier intervention report was not JSON') }
  const results = Array.isArray(evidence.testResults) ? evidence.testResults : []
  const collected = results.length === 1 && results[0]?.name === join(ROOT, VERIFIER) ? results[0] : null
  const assertions = Array.isArray(collected?.assertionResults) ? collected.assertionResults : []
  return { assertions, collected, evidence }
}

workdir = mkdtempSync(join(tmpdir(), 'aukora-broker-proposal-court-'))
if (!MUTATE) runMatrix()

const tree = join(workdir, 'aukora')
cpSync(join(ROOT, 'aukora'), tree, { recursive: true })
const brokerEntry = join(tree, 'broker', 'broker.mjs')
const original = readFileSync(brokerEntry, 'utf8')
const artifactAnchor = "    if (!artifact.ok) return { ok: false, reason: BROKER_REFUSE.ISSUER_RESPONSE_MALFORMED }\n    return { ok: true, request, grant, verify: verifyV4Grant }"
let changed = original.replace(
  artifactAnchor,
  "    if (!artifact.ok) return { ok: false, reason: BROKER_REFUSE.ISSUER_RESPONSE_MALFORMED }\n    grant.signature = Buffer.alloc(64).toString('base64')\n    return { ok: true, request, grant, verify: verifyV4Grant }",
)
if (changed === original) fail('artifact-change intervention anchor was absent')

if (MUTATE) {
  const verifierAnchor = /const verdict = verifyGrantV4\(\{[\s\S]*?\n    \}\)/
  if (!verifierAnchor.test(changed)) fail('v4 verifier mutation anchor was absent')
  changed = changed.replace(verifierAnchor, 'const verdict = { ok: true }')
  if (changed.includes('verifyGrantV4({')) fail('v4 verifier mutation did not remove the call')
}
writeFileSync(brokerEntry, changed, 'utf8')

const sentinel = join(workdir, 'observation.json')
const verifierReport = join(workdir, 'verifier.json')
const result = spawnSync('pnpm', [
  'vitest', 'run', VERIFIER, '--reporter=json', `--outputFile=${verifierReport}`,
], {
  cwd: ROOT,
  env: {
    ...process.env,
    AUKORA_PROPOSAL_MUTANT_ENTRY: brokerEntry,
    AUKORA_PROPOSAL_MUTATION_SENTINEL: sentinel,
  },
  stdio: 'inherit',
  timeout: TIMEOUT_MS,
})
if (result.error !== undefined || result.signal !== null || !existsSync(sentinel)) {
  fail('verifier intervention did not produce an observation')
}
const verifier = readVerifierEvidence(verifierReport)
let observation
try { observation = JSON.parse(readFileSync(sentinel, 'utf8')) } catch { fail('verifier observation was not JSON') }

if (!MUTATE) {
  const held = result.status === 0
    && verifier.evidence.success === true
    && verifier.evidence.numTotalTests === 1
    && verifier.evidence.numPassedTests === 1
    && verifier.evidence.numFailedTests === 0
    && verifier.evidence.numPendingTests === 0
    && verifier.collected?.status === 'passed'
    && verifier.assertions.length === 1
    && verifier.assertions[0]?.status === 'passed'
    && JSON.stringify(observation) === JSON.stringify({ aura: 0, nonces: 0, objects: 0, state: 'REFUSED' })
  if (!held) fail(`effect-admission verifier did not hold: ${JSON.stringify(observation)}`)
  console.log('broker-proposal: matrix=52/52 effectVerifier=HELD')
  process.exit(0)
}

const detected = result.status === 1
  && verifier.evidence.success === false
  && verifier.evidence.numTotalTests === 1
  && verifier.evidence.numPassedTests === 0
  && verifier.evidence.numFailedTests === 1
  && verifier.evidence.numPendingTests === 0
  && verifier.collected?.status === 'failed'
  && verifier.assertions.length === 1
  && verifier.assertions[0]?.status === 'failed'
  && JSON.stringify(observation) === JSON.stringify({ aura: 1, nonces: 0, objects: 1, state: 'SETTLED' })
if (!detected) fail(`v4 verifier removal was not detected: status=${result.status} ${JSON.stringify(observation)}`)
console.log('broker-proposal: verifierRemoval=DETECTED')
process.exit(0)
