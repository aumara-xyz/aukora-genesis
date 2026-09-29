/**
 * Effect IR v0 — parse one closed effect and name its see-digest.
 *
 * Not mounted. Not an executor. Live tool decisions still go
 * plugins/aukora-action-gate/lib/index.mjs → policy.mjs → kernel.mjs → vendor/authority/lib/reducer.js.
 * This file is not on that path.
 *
 * @module @aukora/effect-ir/parse
 */
import { createHash } from 'node:crypto'
import { canonicalJson } from '../../../vendor/authority/lib/index.js'
import { COMPUTE_JOB, DEFINED_EFFECTS, MEMORY_PUT, WORKSPACE_PATCH, isGovernedEffect } from '../../aukora-box/aukora/broker/effect-definition.mjs'
import { captureComputeJobArgs } from '../../aukora-box/aukora/broker/compute-job-args.mjs'
import { isExactMemoryPutArgs, KEY_SHAPE } from '../../aukora-box/aukora/broker/memory-put-args.mjs'
import { captureWorkspacePatchArgs } from '../../aukora-box/aukora/broker/workspace-patch-args.mjs'

export const SCHEMA = 'aukora-effect-ir:v0'
export const DIGEST_DOMAIN = 'aukora:effect-ir:v0'
export const PROPOSERS = Object.freeze(['none', 'kernel', 'laya'])
const HEX = /^[0-9a-f]{64}$/u
const RECORD_FIELDS = Object.freeze(['schema', 'effect', 'args', 'proposer', 'aura', 'sign', 'laya', 'layaPrior'])
const REQUIRED_FIELDS = Object.freeze(['schema', 'effect', 'args'])

function refuse(code, detail, extra = {}) {
  return Object.freeze({ ok: false, verdict: 'REFUSE', code, detail, effect: extra.effect ?? null, see: null })
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

/**
 * Parse one closed effect record.
 * `ok: true` means the record is typed. It is not an ALLOW, a signature, or an execution.
 * @param {unknown} input
 */
export function parseEffect(input) {
  const record = closedObject(input, RECORD_FIELDS, REQUIRED_FIELDS, 'parse:not-object')
  if (!record.ok) return refuse(record.code, 'the effect record is not a closed object')
  const { schema, effect, args, proposer = 'none', aura, sign, laya, layaPrior } = record.values
  if (schema !== SCHEMA) return refuse('parse:schema', 'schema is not aukora-effect-ir:v0')
  if (typeof effect !== 'string' || !Object.hasOwn(DEFINED_EFFECTS, effect)) {
    return refuse('parse:effect', 'effect is not in the closed set', { effect: typeof effect === 'string' ? effect : null })
  }
  const captured = capturedArgs(effect, args)
  if (captured === null) return refuse('parse:args', 'arguments are not the closed alphabet for this effect', { effect })
  if (record.values.proposer !== undefined && !PROPOSERS.includes(proposer)) {
    return refuse('parse:proposer', 'proposer is not none, kernel, or laya', { effect })
  }
  if (sign !== undefined && (typeof sign !== 'string' || !HEX.test(sign))) return refuse('parse:sign', 'sign is not a sha256 hex digest', { effect })
  if ((laya !== undefined || layaPrior !== undefined) && proposer !== 'laya') {
    return refuse('parse:laya', 'only Laya carries a move', { effect })
  }
  if (laya !== undefined && typeof laya !== 'string') return refuse('parse:laya', 'laya move is not a string', { effect })
  if (layaPrior !== undefined && typeof layaPrior !== 'string') return refuse('parse:laya', 'laya prior is not a string', { effect })
  let auraRole = null
  if (aura !== undefined) {
    const auraRecord = closedObject(aura, ['role'], ['role'], 'parse:aura')
    if (!auraRecord.ok) return refuse(auraRecord.code === 'parse:not-object' ? 'parse:aura' : auraRecord.code, 'aura is not a closed role record', { effect })
    if (typeof auraRecord.values.role !== 'string') return refuse('parse:aura', 'aura.role is not a string', { effect })
    auraRole = auraRecord.values.role
  }
  let see
  try {
    const body = canonicalJson({ args: captured, effect, schema: SCHEMA })
    see = createHash('sha256').update(`${DIGEST_DOMAIN}\n${body}`, 'utf8').digest('hex')
  } catch (error) {
    return refuse('parse:not-canonical', error instanceof Error ? error.message : String(error), { effect })
  }
  return Object.freeze({
    ok: true,
    typed: true,
    effect,
    args: Object.freeze(captured),
    see,
    digest: see,
    sign: sign ?? null,
    proposer,
    laya: laya ?? null,
    layaPrior: layaPrior ?? null,
    auraRole,
    staged: !isGovernedEffect(effect),
  })
}
