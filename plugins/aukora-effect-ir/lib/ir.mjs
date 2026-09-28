/**
 * Effect IR v0: parse a closed effect, then refuse it by default.
 *
 * Not mounted. Not an executor. Not the live membrane.
 * Live tool decisions still go:
 *   plugins/aukora-action-gate/lib/index.mjs createGuard
 *   → plugins/aukora-action-gate/lib/policy.mjs classify
 *   → plugins/aukora-action-gate/lib/kernel.mjs decideCall
 *   → vendor/authority/lib/reducer.js decide
 * Live membrane observation is scripts/aukora/become.mjs membraneObservation.
 * Neither path imports this file.
 *
 * A typed record is not permission to run. Laya never ALLOWs. Aura, when
 * named, is a digest map and does not authorize. The kernel policy below
 * has no allow rule, so a typed effect is refused with policy_no_match.
 * Digests use node:crypto sha256 over the kernel's canonical JSON.
 *
 * @module @aukora/effect-ir
 */
import { createHash } from 'node:crypto'
import { canonicalBytes, canonicalJson, decide } from '../../../vendor/authority/lib/index.js'
import { COMPUTE_JOB, DEFINED_EFFECTS, isGovernedEffect, MEMORY_PUT, WORKSPACE_PATCH } from '../../aukora-box/aukora/broker/effect-definition.mjs'
import { captureComputeJobArgs } from '../../aukora-box/aukora/broker/compute-job-args.mjs'
import { isExactMemoryPutArgs, KEY_SHAPE } from '../../aukora-box/aukora/broker/memory-put-args.mjs'
import { captureWorkspacePatchArgs } from '../../aukora-box/aukora/broker/workspace-patch-args.mjs'

export const SCHEMA = 'aukora-effect-ir:v0'
export const DIGEST_DOMAIN = 'aukora:effect-ir:v0'
export const PROPOSERS = Object.freeze(['none', 'kernel', 'laya'])

// No allow rule. An effect the policy does not name is refused.
const POLICY = {
  schema: 'aukora-policy-v1',
  rules: [],
  sacred: [],
}
const policyBytes = canonicalBytes(POLICY)
const EMPTY_STATE = {
  schema: 'aukora-trusted-state-v1',
  salama: { active: false, reason: null },
  trustedRoots: [],
  consumedIds: [],
  receiptHead: { count: 0, headHash: null },
}

const RECORD_FIELDS = Object.freeze(['schema', 'effect', 'args', 'proposer', 'aura'])
const REQUIRED_FIELDS = Object.freeze(['schema', 'effect', 'args'])

function refuse(code, detail, extra = {}) {
  return Object.freeze({
    verdict: 'REFUSE',
    code,
    detail,
    effect: extra.effect ?? null,
    digest: extra.digest ?? null,
    map: extra.map ?? null,
  })
}

function plainDescriptors(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) return null
  return Object.getOwnPropertyDescriptors(input)
}

function closedObject(input, allowed, required, code) {
  const descriptors = plainDescriptors(input)
  if (descriptors === null) return { ok: false, code }
  const keys = Reflect.ownKeys(descriptors)
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) return { ok: false, code: 'parse:unknown-field' }
  if (required.some(key => !keys.includes(key))) return { ok: false, code: 'parse:missing-field' }
  const values = {}
  for (const key of keys) {
    const descriptor = descriptors[key]
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return { ok: false, code: 'parse:unknown-field' }
    values[key] = descriptor.value
  }
  return { ok: true, values }
}

function capturedArgs(name, args) {
  if (name === MEMORY_PUT) {
    if (!isExactMemoryPutArgs(args) || !KEY_SHAPE.test(args.key)) return null
    return { key: args.key, value: args.value }
  }
  if (name === WORKSPACE_PATCH) return captureWorkspacePatchArgs(args)
  if (name === COMPUTE_JOB) return captureComputeJobArgs(args)
  return null
}

function effectDigest(name, args) {
  const body = canonicalJson({ args, effect: name, schema: SCHEMA })
  return createHash('sha256').update(`${DIGEST_DOMAIN}\n${body}`, 'utf8').digest('hex')
}

/**
 * Parse one closed effect record.
 * `ok: true` means the record is a typed closed effect. It is not an ALLOW.
 * @param {unknown} input
 */
export function parseEffect(input) {
  const record = closedObject(input, RECORD_FIELDS, REQUIRED_FIELDS, 'parse:not-object')
  if (!record.ok) return { ok: false, ...refuse(record.code, 'the effect record is not a closed object') }
  const { schema, effect, args, proposer = 'none', aura } = record.values
  if (schema !== SCHEMA) return { ok: false, ...refuse('parse:schema', 'schema is not aukora-effect-ir:v0') }
  if (typeof effect !== 'string' || !Object.hasOwn(DEFINED_EFFECTS, effect)) {
    return { ok: false, ...refuse('parse:effect', 'effect is not in the closed set', { effect: typeof effect === 'string' ? effect : null }) }
  }
  const captured = capturedArgs(effect, args)
  if (captured === null) return { ok: false, ...refuse('parse:args', 'arguments are not the closed alphabet for this effect', { effect }) }
  if (record.values.proposer !== undefined && !PROPOSERS.includes(proposer)) {
    return { ok: false, ...refuse('parse:proposer', 'proposer is not none, kernel, or laya', { effect }) }
  }
  let auraRole = null
  if (aura !== undefined) {
    const auraRecord = closedObject(aura, ['role'], ['role'], 'parse:aura')
    if (!auraRecord.ok) return { ok: false, ...refuse(auraRecord.code === 'parse:not-object' ? 'parse:aura' : auraRecord.code, 'aura is not a closed role record', { effect }) }
    if (typeof auraRecord.values.role !== 'string') return { ok: false, ...refuse('parse:aura', 'aura.role is not a string', { effect }) }
    auraRole = auraRecord.values.role
  }
  let digest
  try {
    digest = effectDigest(effect, captured)
  } catch (error) {
    return { ok: false, ...refuse('parse:not-canonical', error instanceof Error ? error.message : String(error), { effect }) }
  }
  return Object.freeze({
    ok: true,
    typed: true,
    effect,
    args: Object.freeze(captured),
    digest,
    proposer,
    auraRole,
    staged: !isGovernedEffect(effect),
  })
}

function kernelRequest(parsed) {
  return {
    schema: 'aukora-kernel-request-v1',
    requestId: `ir.${parsed.digest}`,
    action: { namespace: 'effect-ir', kind: parsed.effect, verb: 'call' },
    resource: { namespace: 'effect-ir', id: parsed.digest },
    ring: 'local-write',
    payloadHash: parsed.digest,
    consumptionId: `fx.${parsed.digest}`,
    humanClearance: false,
    authorization: null,
    evidenceRefs: [],
  }
}

function auraMap(parsed) {
  if (parsed.auraRole !== 'map') return null
  return Object.freeze({
    [parsed.digest]: Object.freeze({ effect: parsed.effect, role: 'map' }),
  })
}

/**
 * Decide one record. The default is REFUSE. ALLOW is returned only when the
 * carried kernel allows the request. The shipped policy has no such rule.
 * Laya is refused before the kernel is asked. An Aura role other than `map`
 * is refused and is not entered in the map.
 * @param {unknown} input
 * @param {number} nowMs non-negative safe integer. This function does not read the clock.
 */
export function decideEffect(input, nowMs) {
  const parsed = parseEffect(input)
  if (!parsed.ok) return refuse(parsed.code, parsed.detail, parsed)
  const map = auraMap(parsed)
  const bound = { effect: parsed.effect, digest: parsed.digest, map }
  if (parsed.proposer === 'laya') return refuse('laya:never-allow', 'Laya cannot ALLOW', bound)
  if (parsed.auraRole !== null && parsed.auraRole !== 'map') return refuse('aura:map-only', 'Aura maps an effect and does not authorize', { effect: parsed.effect, digest: parsed.digest, map: null })
  if (parsed.staged) return refuse('staged:not-admissible', 'staged effect is not admissible', bound)
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return refuse('usage:now', 'nowMs must be a non-negative safe integer', bound)
  let result
  try {
    result = decide(kernelRequest(parsed), EMPTY_STATE, policyBytes, nowMs)
  } catch (error) {
    return refuse('kernel:fault', error instanceof Error ? error.message : String(error), bound)
  }
  if (result.decision.status !== 'allowed') {
    return refuse(`kernel:${result.decision.code}`, 'refused by default', bound)
  }
  return Object.freeze({
    verdict: 'ALLOW',
    code: 'kernel:allowed',
    detail: 'kernel allowed this effect under the effect-ir policy',
    effect: parsed.effect,
    digest: parsed.digest,
    map,
  })
}
