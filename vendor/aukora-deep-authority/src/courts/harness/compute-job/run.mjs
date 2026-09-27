/**
 * courts/harness/compute-job — the staged compute.job effect and its executor-bound identity.
 *
 * compute.job's definitionId covers the executor's source sha256, pinned in
 * effect-definition.mjs. The ordinary arm checks the pin matches the bytes on
 * disk, recomputes the definitionId independently, exercises the closed
 * argument grammar, mints and re-parses an approval artifact whose tool is
 * derived from that definitionId, and confirms the executor preflights and
 * then refuses by name (stage 1 has no runner). Mutation mode copies aukora/
 * twice: in one copy a single byte is appended to the executor and preflight
 * must refuse `compute.job:definition-drift`; in the other the pin is updated
 * to the new bytes and an approval minted under the live definitionId must
 * stop verifying there while an unrelated memory.put approval still does.
 *
 * Ceilings. The broker's refusal of compute.job is inferred from
 * `isGovernedEffect` returning false, the predicate both admission sites gate
 * on; no arm presents a compute.job proposal to a live broker. This is
 * builder-owned, self-reported evidence.
 *
 *   node courts/harness/compute-job/run.mjs
 *   node courts/harness/compute-job/run.mjs --mutate
 */
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const AUKORA_DIRECTORY = join(HERE, '../../../aukora')
const EXECUTOR_RELATIVE = 'broker/compute-job.mjs'
const REGISTRY_RELATIVE = 'broker/effect-definition.mjs'

const registry = await import(pathToFileURL(join(AUKORA_DIRECTORY, REGISTRY_RELATIVE)).href)
const executor = await import(pathToFileURL(join(AUKORA_DIRECTORY, EXECUTOR_RELATIVE)).href)
const approval = await import(pathToFileURL(join(AUKORA_DIRECTORY, 'approval/artifact.mjs')).href)
const {
  COMPUTE_JOB, COMPUTE_JOB_DEFINITION, COMPUTE_JOB_DEFINITION_DOMAIN, COMPUTE_JOB_EXECUTOR_SHA256,
  EFFECT_DEFINITIONS, MEMORY_PUT, MEMORY_PUT_DEFINITION, STAGED_EFFECT_DEFINITIONS, WORKSPACE_PATCH,
  WORKSPACE_PATCH_DEFINITION, definitionDigest, isGovernedEffect,
} = registry
const { REFUSE_COMPUTE_JOB, computeJob, computeJobExecutorSha256, isExactComputeJobArgs, preflightComputeJob } = executor
const { REFUSE_APPROVAL, createApprovalArtifact, parseApprovalArtifact } = approval

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--mutate')) {
  console.error('usage: node courts/harness/compute-job/run.mjs [--mutate]')
  process.exit(2)
}
const MUTATE = args[0] === '--mutate'

const EXPECTED_ROWS = [
  'J1.staged',
  'J2.pin',
  'J3.definition-id',
  'J4.grammar',
  'J5.approval',
  'J6.preflight',
  'J7.neighbours',
]
const MEMORY_PUT_DEFINITION_ID = '2afe11cd84b96a7a00b07ce628c741c8e7b4c244d49d8f8e9b8653baa7f69a9b'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const HEX = 'a'.repeat(64)
const VALID = Object.freeze({ endpoint: 'dc-east-1', imageSha256: HEX, volumeSha256: HEX, decodeSha256: HEX, budgetSha256: HEX })
const recordDigest = (d) => sha256(Buffer.from(JSON.stringify([d.name, d.parameters, d.semantics, d.version]), 'utf8'))
const boundDigest = (d, pin) => sha256(Buffer.from(
  `${COMPUTE_JOB_DEFINITION_DOMAIN}\n${JSON.stringify([d.name, d.parameters, d.semantics, d.version])}\n${pin}`, 'utf8'))
const refusal = (fn) => {
  try { fn() } catch (error) { return String(error?.message ?? error) }
  return null
}
const mintInputs = (operationArguments, toolName) => ({
  operationArguments, toolName, expiry: Math.floor(Date.now() / 1000) + 600,
  activationDigest: HEX, occurrenceId: '0'.repeat(32), rendererId: HEX,
})
const rowsAreExact = (rows) => {
  const names = rows.map((row) => row.n)
  return names.length === EXPECTED_ROWS.length
    && new Set(names).size === names.length
    && EXPECTED_ROWS.every((name) => names.includes(name))
}

const rows = []

rows.push({
  n: 'J1.staged',
  ok: COMPUTE_JOB === 'compute.job'
    && Object.hasOwn(STAGED_EFFECT_DEFINITIONS, COMPUTE_JOB)
    && !Object.hasOwn(EFFECT_DEFINITIONS, COMPUTE_JOB)
    && isGovernedEffect(COMPUTE_JOB) === false
    && isGovernedEffect(MEMORY_PUT) === true
    && /^[0-9a-f]{64}$/.test(definitionDigest(COMPUTE_JOB)),
  d: `staged=${Object.hasOwn(STAGED_EFFECT_DEFINITIONS, COMPUTE_JOB)} admissible=${isGovernedEffect(COMPUTE_JOB)}`,
})

const executorBytes = readFileSync(join(AUKORA_DIRECTORY, EXECUTOR_RELATIVE))
const diskSha256 = sha256(executorBytes)
const selfSha256 = computeJobExecutorSha256()
rows.push({
  n: 'J2.pin',
  ok: diskSha256 === COMPUTE_JOB_EXECUTOR_SHA256 && selfSha256 === COMPUTE_JOB_EXECUTOR_SHA256
    && COMPUTE_JOB_DEFINITION.executorSha256 === COMPUTE_JOB_EXECUTOR_SHA256,
  d: `disk=${diskSha256.slice(0, 16)} pin=${COMPUTE_JOB_EXECUTOR_SHA256.slice(0, 16)} self=${selfSha256.slice(0, 16)}`,
})

const liveDefinitionId = definitionDigest(COMPUTE_JOB)
const independentId = boundDigest(COMPUTE_JOB_DEFINITION, COMPUTE_JOB_EXECUTOR_SHA256)
const recordOnlyId = recordDigest(COMPUTE_JOB_DEFINITION)
rows.push({
  n: 'J3.definition-id',
  ok: liveDefinitionId === independentId && liveDefinitionId !== recordOnlyId,
  d: `live=${liveDefinitionId.slice(0, 16)} court=${independentId.slice(0, 16)} recordOnly=${recordOnlyId.slice(0, 16)}`,
})

class NotPlain { constructor() { Object.assign(this, VALID) } }
const REJECTED = [
  ['extra-field', { ...VALID, tenant: 't' }],
  ['missing-field', (() => { const { budgetSha256: _b, ...rest } = VALID; return rest })()],
  ['uppercase-hex', { ...VALID, imageSha256: HEX.toUpperCase() }],
  ['short-hex', { ...VALID, volumeSha256: HEX.slice(1) }],
  ['endpoint-slash', { ...VALID, endpoint: 'dc/east' }],
  ['endpoint-empty', { ...VALID, endpoint: '' }],
  ['getter', Object.defineProperty({ ...VALID }, 'decodeSha256', { get: () => HEX, enumerable: true })],
  ['class-prototype', new NotPlain()],
  ['array', [VALID]],
  ['null', null],
]
const rejectedHeld = REJECTED.filter(([, candidate]) => !isExactComputeJobArgs(candidate)).length
rows.push({
  n: 'J4.grammar',
  ok: isExactComputeJobArgs(VALID) && isExactComputeJobArgs(Object.create(null, Object.getOwnPropertyDescriptors(VALID)))
    && rejectedHeld === REJECTED.length,
  d: `accepted=exact rejected=${rejectedHeld}/${REJECTED.length}`,
})

let liveArtifact = null
let approvalDetail = 'mint-failed'
let approvalHeld = false
try {
  liveArtifact = createApprovalArtifact(mintInputs(VALID, COMPUTE_JOB))
  const reparsed = parseApprovalArtifact({ ...liveArtifact, operationArguments: { ...liveArtifact.operationArguments }, semanticProjection: [...liveArtifact.semanticProjection] })
  const crossTool = refusal(() => parseApprovalArtifact({
    ...liveArtifact,
    operationArguments: { ...liveArtifact.operationArguments },
    semanticProjection: [...liveArtifact.semanticProjection],
    definitionId: definitionDigest(WORKSPACE_PATCH),
  }))
  const projectionNamesId = liveArtifact.semanticProjection.includes(`definitionId: ${liveDefinitionId}`)
  const wrongArgsAtMint = refusal(() => createApprovalArtifact(mintInputs({ ...VALID, tenant: 't' }, COMPUTE_JOB)))
  approvalHeld = reparsed.definitionId === liveDefinitionId
    && liveArtifact.definitionId === liveDefinitionId
    && projectionNamesId
    && crossTool !== null && crossTool.startsWith(REFUSE_APPROVAL.ARGUMENTS_NOT_EXACT)
    && wrongArgsAtMint !== null && wrongArgsAtMint.startsWith(REFUSE_APPROVAL.ARGUMENTS_NOT_EXACT)
  approvalDetail = `reparsed=${reparsed.definitionId === liveDefinitionId} projectionNamesId=${projectionNamesId} crossTool=${crossTool} extraField=${wrongArgsAtMint}`
} catch (error) {
  approvalDetail = `mint-failed=${String(error?.message ?? error)}`
}
rows.push({ n: 'J5.approval', ok: approvalHeld, d: approvalDetail })

const preflight = preflightComputeJob(VALID)
const runRefusal = refusal(() => computeJob(VALID))
const grammarFirst = refusal(() => computeJob({ ...VALID, tenant: 't' }))
rows.push({
  n: 'J6.preflight',
  ok: preflight.definitionId === liveDefinitionId
    && preflight.executorSha256 === COMPUTE_JOB_EXECUTOR_SHA256
    && Object.isFrozen(preflight) && Object.isFrozen(preflight.args)
    && runRefusal === REFUSE_COMPUTE_JOB.EXECUTOR_NOT_IMPLEMENTED
    && grammarFirst === REFUSE_COMPUTE_JOB.ARGUMENTS_NOT_EXACT,
  d: `run=${runRefusal} badArgs=${grammarFirst}`,
})

rows.push({
  n: 'J7.neighbours',
  ok: definitionDigest(MEMORY_PUT) === MEMORY_PUT_DEFINITION_ID
    && definitionDigest(MEMORY_PUT) === recordDigest(MEMORY_PUT_DEFINITION)
    && definitionDigest(WORKSPACE_PATCH) === recordDigest(WORKSPACE_PATCH_DEFINITION)
    && refusal(() => definitionDigest('compute.job2')) === 'effect:unknown-tool',
  d: `memoryPut=${definitionDigest(MEMORY_PUT).slice(0, 16)} workspacePatch=record-only unknown=refused`,
})

console.log('\n  courts/harness/compute-job — staged compute.job effect, executor-bound definitionId\n  ' + '-'.repeat(72))
for (const row of rows) {
  console.log(`  ${row.n}  ${row.ok ? 'held' : '*** BREACH ***'}  ${row.d}`)
}

const mutationVerdict = ({ ordinaryRows, mutation }) => rowsAreExact(ordinaryRows)
  && ordinaryRows.every((row) => row.ok)
  && mutation.executorByteAppended
  && mutation.driftRefused
  && mutation.repinnedIdMoved
  && mutation.outstandingApprovalRetired
  && mutation.repinnedPreflightHeld
  && mutation.unrelatedApprovalKept

if (MUTATE) {
  const mutation = {
    executorByteAppended: false,
    driftRefused: false,
    repinnedIdMoved: false,
    outstandingApprovalRetired: false,
    repinnedPreflightHeld: false,
    unrelatedApprovalKept: false,
  }
  const driftCopy = mkdtempSync(join(tmpdir(), 'aukora-compute-job-drift-'))
  const repinCopy = mkdtempSync(join(tmpdir(), 'aukora-compute-job-repin-'))
  try {
    const changedBytes = Buffer.concat([executorBytes, Buffer.from('\n', 'utf8')])
    const changedSha256 = sha256(changedBytes)
    mutation.executorByteAppended = changedSha256 !== COMPUTE_JOB_EXECUTOR_SHA256

    // Copy A: the executor moved, the pin did not. Preflight must refuse.
    cpSync(AUKORA_DIRECTORY, join(driftCopy, 'aukora'), { recursive: true })
    writeFileSync(join(driftCopy, 'aukora', EXECUTOR_RELATIVE), changedBytes)
    const driftExecutor = await import(pathToFileURL(join(driftCopy, 'aukora', EXECUTOR_RELATIVE)).href)
    mutation.driftRefused = refusal(() => driftExecutor.preflightComputeJob(VALID)) === REFUSE_COMPUTE_JOB.DEFINITION_DRIFT
      && refusal(() => driftExecutor.computeJob(VALID)) === REFUSE_COMPUTE_JOB.DEFINITION_DRIFT

    // Copy B: the executor moved and the pin followed. The definitionId moves,
    // the approval minted under the live id stops verifying, and an unrelated
    // memory.put approval still does.
    cpSync(AUKORA_DIRECTORY, join(repinCopy, 'aukora'), { recursive: true })
    writeFileSync(join(repinCopy, 'aukora', EXECUTOR_RELATIVE), changedBytes)
    const registrySource = readFileSync(join(repinCopy, 'aukora', REGISTRY_RELATIVE), 'utf8')
    const repinned = registrySource.split(COMPUTE_JOB_EXECUTOR_SHA256)
    if (repinned.length === 2) {
      writeFileSync(join(repinCopy, 'aukora', REGISTRY_RELATIVE), repinned.join(changedSha256))
      const repinRegistry = await import(pathToFileURL(join(repinCopy, 'aukora', REGISTRY_RELATIVE)).href)
      const repinExecutor = await import(pathToFileURL(join(repinCopy, 'aukora', EXECUTOR_RELATIVE)).href)
      const repinApproval = await import(pathToFileURL(join(repinCopy, 'aukora', 'approval/artifact.mjs')).href)
      const movedId = repinRegistry.definitionDigest(COMPUTE_JOB)
      mutation.repinnedIdMoved = movedId !== liveDefinitionId
        && movedId === boundDigest(COMPUTE_JOB_DEFINITION, changedSha256)
      if (liveArtifact !== null) {
        const retired = refusal(() => repinApproval.parseApprovalArtifact({
          ...liveArtifact,
          operationArguments: { ...liveArtifact.operationArguments },
          semanticProjection: [...liveArtifact.semanticProjection],
        }))
        mutation.outstandingApprovalRetired = retired === REFUSE_APPROVAL.DEFINITION_MISMATCH
      }
      const repinPreflight = refusal(() => {
        const record = repinExecutor.preflightComputeJob(VALID)
        if (record.definitionId !== movedId || record.executorSha256 !== changedSha256) throw new Error('repinned-preflight-wrong-identity')
      })
      mutation.repinnedPreflightHeld = repinPreflight === null
      const memoryArtifact = createApprovalArtifact(mintInputs({ key: 'court.compute-job', value: { ok: true } }, MEMORY_PUT))
      mutation.unrelatedApprovalKept = refusal(() => repinApproval.parseApprovalArtifact({
        ...memoryArtifact,
        operationArguments: { ...memoryArtifact.operationArguments },
        semanticProjection: [...memoryArtifact.semanticProjection],
      })) === null
    }
  } finally {
    rmSync(driftCopy, { recursive: true, force: true })
    rmSync(repinCopy, { recursive: true, force: true })
  }

  const sabotagedRows = rows.map((row) => row.n === 'J2.pin' ? { ...row, ok: false } : row)
  const sabotagedMutation = { ...mutation, driftRefused: false }
  const sabotageRejected = !mutationVerdict({ ordinaryRows: sabotagedRows, mutation })
    && !mutationVerdict({ ordinaryRows: rows, mutation: sabotagedMutation })
  const detected = mutationVerdict({ ordinaryRows: rows, mutation }) && sabotageRejected
  console.log(`\n  MUTATION definition-drift  executorByteAppended=${mutation.executorByteAppended}`
    + ` driftRefused=${mutation.driftRefused}`
    + ` repinnedIdMoved=${mutation.repinnedIdMoved}`
    + ` outstandingApprovalRetired=${mutation.outstandingApprovalRetired}`
    + ` repinnedPreflightHeld=${mutation.repinnedPreflightHeld}`
    + ` unrelatedApprovalKept=${mutation.unrelatedApprovalKept}`
    + ` sabotagedRejected=${sabotageRejected}`
    + ` detected=${detected}  ${detected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  process.exit(detected ? 0 : 1)
}

console.log(`\n  rowsComplete=${rowsAreExact(rows)} expected=${EXPECTED_ROWS.length} observed=${rows.length}`)
console.log('  observationClass: SELF-REPORTED\n')
process.exit(!rowsAreExact(rows) || rows.some((row) => !row.ok) ? 1 : 0)
