/**
 * Immutable identities of the closed governed effect registry.
 *
 * This module contains no executor and imports no filesystem API. Guest-side
 * proposal code can name and bind the effect without loading the host effect
 * implementation into its static module graph.
 *
 * @module @aukora/broker/effect-definition
 */
import { createHash } from 'node:crypto'

/** The effect's name, as it appears in an authorization claim. */
export const MEMORY_PUT = 'memory.put'

/** One preimage-bound UTF-8 file replacement in an operator-selected workspace. */
export const WORKSPACE_PATCH = 'workspace.patch'

/** One container image against one data volume at one endpoint under one decode set. */
export const COMPUTE_JOB = 'compute.job'

const MEMORY_PUT_PARAMETERS = Object.freeze(['key', 'value'])

/** The effect definition to which every memory.put authorization is bound. */
export const MEMORY_PUT_DEFINITION = Object.freeze({
  name: MEMORY_PUT,
  parameters: MEMORY_PUT_PARAMETERS,
  semantics: 'content-addressed object write at <stateDir>/memory/objects/<contentSha256>.json plus a last-write-wins projection at <stateDir>/memory/keys/<key>.json; evidence binds the object',
  version: 2,
})

/**
 * The authorization definitionId. For a definition that pins an executor, the
 * digest also covers that executor's source sha256 under a domain tag, so the
 * id moves when the implementation moves, not only when the record does.
 * @param {string} [toolName] - defined effect name. @returns {string} authorization definitionId.
 */
export function definitionDigest(toolName = MEMORY_PUT) {
  if (!Object.hasOwn(DEFINED_EFFECTS, toolName)) throw new TypeError('effect:unknown-tool')
  const d = DEFINED_EFFECTS[toolName]
  const record = JSON.stringify([d.name, d.parameters, d.semantics, d.version])
  const canonical = d.executorSha256 === undefined
    ? record
    : `${COMPUTE_JOB_DEFINITION_DOMAIN}\n${record}\n${d.executorSha256}`
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/** Closed replacement grammar; null preimage permits creation only. */
export const WORKSPACE_PATCH_DEFINITION = Object.freeze({
  name: WORKSPACE_PATCH,
  parameters: Object.freeze(['workspace', 'path', 'beforeSha256', 'content']),
  semantics: 'replace one regular UTF-8 file beneath an operator-selected workspace; exact prior sha256 or absence must match before publication; no symlinks, commands, deletion or parent creation; observe published bytes before settlement; same-UID concurrent filesystem mutation is not excluded',
  version: 1,
})

/** Domain tag separating an executor-bound definitionId from a record-only one. */
export const COMPUTE_JOB_DEFINITION_DOMAIN = 'aukora:compute-job-definition:v1'

/**
 * The sha256 of ./compute-job.mjs as committed. The executor recomputes its own
 * digest at preflight and refuses `compute.job:definition-drift` when the two
 * differ; changing this pin moves the definitionId and retires every approval
 * minted under the old one. courts/harness/compute-job measures both.
 */
export const COMPUTE_JOB_EXECUTOR_SHA256 = '9ca9cb486fe2fc550c618e8a55d98a973efd9f13084794e03ee4d327d2b764d1'

/** Closed job grammar; the executor's bytes are part of the identity. */
export const COMPUTE_JOB_DEFINITION = Object.freeze({
  name: COMPUTE_JOB,
  parameters: Object.freeze(['endpoint', 'imageSha256', 'volumeSha256', 'decodeSha256', 'budgetSha256']),
  semantics: 'execute one container image against one data volume at one endpoint under one decode parameter set; the endpoint is verified against its pinned identity and resident model digest before any work is admitted; no other image, volume, endpoint or decode set may run under this authorization; the serving slice is re-observed and signed after completion; the hypervisor and the operator are not excluded',
  version: 1,
  executorSha256: COMPUTE_JOB_EXECUTOR_SHA256,
})

/** Only code-owned definitions can enter broker admission. */
export const EFFECT_DEFINITIONS = Object.freeze({
  [MEMORY_PUT]: MEMORY_PUT_DEFINITION,
  [WORKSPACE_PATCH]: WORKSPACE_PATCH_DEFINITION,
})

/**
 * Definitions that exist, can be digested and approved against, but are not
 * yet admissible at the broker. compute.job stays here until its executor
 * runs something; `isGovernedEffect` deliberately does not consult this set.
 */
export const STAGED_EFFECT_DEFINITIONS = Object.freeze({
  [COMPUTE_JOB]: COMPUTE_JOB_DEFINITION,
})

/** Every definition a definitionId can name, admissible or staged. */
export const DEFINED_EFFECTS = Object.freeze({ ...EFFECT_DEFINITIONS, ...STAGED_EFFECT_DEFINITIONS })

/** @param {unknown} toolName - requested effect. @returns {boolean} registry membership. */
export function isGovernedEffect(toolName) {
  return typeof toolName === 'string' && Object.hasOwn(EFFECT_DEFINITIONS, toolName)
}
