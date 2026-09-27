/**
 * The compute.job executor, stage 1: a definition-bound refusal.
 *
 * This module's own source bytes are what the compute.job definitionId binds
 * (effect-definition.mjs pins their sha256). Preflight recomputes that digest
 * from disk and refuses when it has moved, so an executor edited after an
 * approval was minted cannot run under that approval, and an executor whose
 * pin was updated moves the definitionId so the approval itself stops
 * verifying. Both directions are courted in courts/harness/compute-job.
 *
 * There is no job runner here yet. `computeJob` preflights and then refuses
 * by name. Stage 2 replaces that refusal with the preflight-then-execute path;
 * until it lands, nothing describes compute.job as running.
 * @module @aukora/broker/compute-job
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { captureComputeJobArgs } from './compute-job-args.mjs'
import { COMPUTE_JOB, COMPUTE_JOB_EXECUTOR_SHA256, definitionDigest } from './effect-definition.mjs'

export { captureComputeJobArgs, computeJobResource, isExactComputeJobArgs } from './compute-job-args.mjs'

/** Every refusal this executor can return, by name. */
export const REFUSE_COMPUTE_JOB = Object.freeze({
  ARGUMENTS_NOT_EXACT: 'compute.job:arguments-not-exact',
  DEFINITION_DRIFT: 'compute.job:definition-drift',
  EXECUTOR_NOT_IMPLEMENTED: 'compute.job:executor-not-implemented',
})

/**
 * The sha256 of this module's bytes as they are on disk right now.
 * @returns {string} lowercase hex digest.
 */
export function computeJobExecutorSha256() {
  return createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')
}

/**
 * Check the arguments and this executor's own identity before any work.
 * @param {unknown} args - candidate compute.job arguments.
 * @returns {{args: object, definitionId: string, executorSha256: string}} the frozen preflight record.
 * @throws {Error} a named {@link REFUSE_COMPUTE_JOB} refusal.
 */
export function preflightComputeJob(args) {
  const captured = captureComputeJobArgs(args)
  if (captured === null) throw new Error(REFUSE_COMPUTE_JOB.ARGUMENTS_NOT_EXACT)
  const executorSha256 = computeJobExecutorSha256()
  if (executorSha256 !== COMPUTE_JOB_EXECUTOR_SHA256) throw new Error(REFUSE_COMPUTE_JOB.DEFINITION_DRIFT)
  return Object.freeze({
    args: Object.freeze(captured),
    definitionId: definitionDigest(COMPUTE_JOB),
    executorSha256,
  })
}

/**
 * Stage 1 has no runner: preflight, then refuse by name.
 * @param {unknown} args - candidate compute.job arguments.
 * @returns {never}
 * @throws {Error} a named {@link REFUSE_COMPUTE_JOB} refusal.
 */
export function computeJob(args) {
  preflightComputeJob(args)
  throw new Error(REFUSE_COMPUTE_JOB.EXECUTOR_NOT_IMPLEMENTED)
}
