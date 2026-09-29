/**
 * Effect IR v0 composer. Not mounted. Refuse by default.
 * Live decisions: plugins/aukora-action-gate/lib/index.mjs, policy.mjs, kernel.mjs, vendor/authority/lib/reducer.js.
 * Live membrane: scripts/aukora/become.mjs membraneObservation then membraneRefusal. Neither imports this file.
 * Order: parse, membrane, see=sign=execute, aura map-only, Laya STOP/ASK, staged, clock, kernel. No allow rule.
 * @module @aukora/effect-ir
 */
import { canonicalBytes, decide } from '../../../vendor/authority/lib/index.js'
import { seeSignExecute } from './identity.mjs'
import { layaStep } from './laya.mjs'
import { membraneAdmit } from './membrane.mjs'
import { parseEffect } from './parse.mjs'

export { parseEffect } from './parse.mjs'
export { layaStep } from './laya.mjs'
export { membraneAdmit } from './membrane.mjs'
export { seeSignExecute } from './identity.mjs'

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

function refuse(code, detail, extra = {}) {
  return Object.freeze({
    verdict: 'REFUSE',
    code,
    detail,
    effect: extra.effect ?? null,
    see: extra.see ?? null,
    sign: extra.sign ?? null,
    execute: extra.execute ?? null,
    map: extra.map ?? null,
  })
}

function kernelRequest(parsed) {
  return {
    schema: 'aukora-kernel-request-v1',
    requestId: `ir.${parsed.see}`,
    action: { namespace: 'effect-ir', kind: parsed.effect, verb: 'call' },
    resource: { namespace: 'effect-ir', id: parsed.see },
    ring: 'local-write',
    payloadHash: parsed.see,
    consumptionId: `fx.${parsed.see}`,
    humanClearance: false,
    authorization: null,
    evidenceRefs: [],
  }
}

function auraMap(parsed) {
  if (parsed.auraRole !== 'map') return null
  return Object.freeze({ [parsed.see]: Object.freeze({ effect: parsed.effect, role: 'map' }) })
}

/** @param {unknown} input @param {number} nowMs @param {unknown} membrane Absence refuses. `sign` must equal the see-digest. */
export function decideEffect(input, nowMs, membrane) {
  const parsed = parseEffect(input)
  if (!parsed.ok) return refuse(parsed.code, parsed.detail, parsed)
  const map = auraMap(parsed)
  const bound = { effect: parsed.effect, see: parsed.see, map }
  const membraneResult = membraneAdmit(membrane)
  if (!membraneResult.ok) return refuse(membraneResult.code, 'membrane is not admitted', { ...bound, chain: membraneResult.chain })
  const request = kernelRequest(parsed)
  const identity = seeSignExecute(parsed.see, parsed.sign, request.payloadHash)
  if (!identity.ok) {
    return refuse(identity.code, 'see, sign, and execute are not the same digest', {
      ...bound, sign: identity.sign, execute: identity.execute,
    })
  }
  bound.sign = identity.sign
  bound.execute = identity.execute
  if (parsed.auraRole !== null && parsed.auraRole !== 'map') {
    return refuse('aura:map-only', 'Aura maps an effect and does not authorize', { ...bound, map: null })
  }
  if (parsed.proposer === 'laya') {
    const step = layaStep(parsed.layaPrior ?? 'none', parsed.laya)
    if (!step.ok) return refuse(step.code, 'Laya is STOP or ASK only, and the rank never falls', bound)
    return Object.freeze({
      verdict: step.verdict,
      code: step.code,
      detail: 'Laya does not execute',
      effect: parsed.effect,
      see: identity.see,
      sign: identity.sign,
      execute: identity.execute,
      map,
    })
  }
  if (parsed.staged) return refuse('staged:not-admissible', 'staged effect is not admissible', bound)
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return refuse('usage:now', 'nowMs must be a non-negative safe integer', bound)
  let result
  try {
    result = decide(request, EMPTY_STATE, policyBytes, nowMs)
  } catch (error) {
    return refuse('kernel:fault', error instanceof Error ? error.message : String(error), bound)
  }
  if (result.decision.status !== 'allowed') return refuse(`kernel:${result.decision.code}`, 'refused by default', bound)
  return Object.freeze({
    verdict: 'ALLOW',
    code: 'kernel:allowed',
    detail: 'kernel allowed this effect under the effect-ir policy',
    effect: parsed.effect,
    see: identity.see,
    sign: identity.sign,
    execute: identity.execute,
    map,
  })
}
