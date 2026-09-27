/**
 * Canonical operations shared by the approval issuer and broker. Each binds the
 * exact effect, destination, content digest, expiry, and one-use requirement.
 * Workspace replacements additionally bind the expected prior content digest.
 * Broker-owned intent, receipt, and Aura writes are not separate reviewed effects.
 *
 * @module @aukora/broker/operation
 */
import { createHash } from 'node:crypto'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { COMPUTE_JOB, definitionDigest, MEMORY_PUT, WORKSPACE_PATCH } from './effect-definition.mjs'
import { isExactComputeJobArgs } from './compute-job-args.mjs'
import { effectBody } from './effect-body.mjs'
import { isExactMemoryPutArgs, KEY_SHAPE } from './memory-put-args.mjs'
import { isExactWorkspacePatchArgs, workspacePatchBody } from './workspace-patch-args.mjs'

export { effectBody } from './effect-body.mjs'
export { KEY_SHAPE } from './memory-put-args.mjs'

/**
 * Build the fixed operation a grant binds to. Canonical JSON sorts object keys,
 * so the field set and values are load-bearing; source-literal order is not.
 * @param {{key: string, value: unknown}|{workspace:string,path:string,beforeSha256:string|null,content:string}} args - effect-specific call arguments.
 * @param {number} exp - the grant's expiry, in seconds.
 * @param {string} [toolName] - a name in the closed effect registry; defaults to memory.put.
 * @returns {object} the canonical effect-specific operation.
 * @throws {TypeError} when the argument alphabet or key grammar is invalid.
 */
export function buildOperation(args, exp, toolName = MEMORY_PUT) {
  if (toolName === WORKSPACE_PATCH) {
    if (!isExactWorkspacePatchArgs(args)) throw new TypeError('buildOperation: arguments-not-exact')
    const body = workspacePatchBody(args)
    return {
      tool: WORKSPACE_PATCH,
      workspace: args.workspace,
      path: args.path,
      beforeSha256: args.beforeSha256,
      bytes: Buffer.byteLength(body, 'utf8'),
      contentSha256: createHash('sha256').update(body, 'utf8').digest('hex'),
      definitionId: definitionDigest(WORKSPACE_PATCH),
      exp,
      oneUse: true,
    }
  }
  if (toolName === COMPUTE_JOB) {
    if (!isExactComputeJobArgs(args)) throw new TypeError('buildOperation: arguments-not-exact')
    return {
      tool: COMPUTE_JOB,
      endpoint: args.endpoint,
      imageSha256: args.imageSha256,
      volumeSha256: args.volumeSha256,
      decodeSha256: args.decodeSha256,
      budgetSha256: args.budgetSha256,
      definitionId: definitionDigest(COMPUTE_JOB),
      exp,
      oneUse: true,
    }
  }
  if (toolName !== MEMORY_PUT) throw new TypeError('buildOperation: unknown-tool')
  if (!isExactMemoryPutArgs(args)) throw new TypeError('buildOperation: arguments-not-exact')
  if (!KEY_SHAPE.test(args.key)) throw new TypeError('buildOperation: key-not-a-name')
  const body = effectBody(args)
  return {
    tool: MEMORY_PUT,
    key: args.key,
    bytes: Buffer.byteLength(body, 'utf8'),
    contentSha256: createHash('sha256').update(body, 'utf8').digest('hex'),
    definitionId: definitionDigest(),
    exp,
    oneUse: true,
  }
}

/** The operation digest a grant carries: sha256 over its canonical JSON. */
export function operationDigest(op) {
  return createHash('sha256').update(canonicalJSON(op), 'utf8').digest('hex')
}
