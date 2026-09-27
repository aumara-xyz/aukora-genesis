/** The seed/shell policy classifies paths, tools and hosts; the carried kernel decides. */
import { createHash } from 'node:crypto'
import { canonicalBytes, decide } from '../../../vendor/authority/lib/index.js'
import { KERNEL_ALLOWS } from './policy.mjs'

const action = kind => ({ namespace: 'action-gate', kind, verb: 'call' })
const rings = new Map(KERNEL_ALLOWS.map(([kind, ring]) => [kind, ring]))
// Compile exact class/outcome pairs once; no catch-all permission.
const policyBytes = canonicalBytes({
  schema: 'aukora-policy-v1',
  rules: KERNEL_ALLOWS.flatMap(([kind, maxRing, outcomes]) => outcomes.map(resourceNamespace => ({
    action: action(kind), resourceNamespace, maxRing, requiresAuthorization: false,
  }))),
  sacred: [...rings.keys(), 'live-code'].map(kind => ({
    actionNamespace: 'action-gate', actionKind: kind, resourceNamespace: 'protected',
  })),
})
// Aura owns durable history. This per-call state adds no replay or SALAMA enforcement.
const state = {
  schema: 'aukora-trusted-state-v1', salama: { active: false, reason: null },
  trustedRoots: [], consumedIds: [], receiptHead: { count: 0, headHash: null },
}

export function decideCall(classified, digest, nowMs = Date.now()) {
  const { kind, rule, message, targets } = classified
  const namespace = rule.startsWith('allow:') ? rule
    : rule === 'authority:tool-not-approved' ? 'unapproved-tool' : 'protected'
  // Kernel ids exclude raw paths. Bind resolved targets privately; payloadHash binds arguments.
  const targetDigest = createHash('sha256').update(JSON.stringify(targets)).digest('hex')
  const ring = rings.get(kind) ?? 'self-modify'
  const request = {
    schema: 'aukora-kernel-request-v1', requestId: `tool:${digest}`,
    action: action(kind), resource: { namespace, id: `target:${targetDigest}` },
    ring, payloadHash: digest, consumptionId: ring === 'observe' ? null : `call:${digest}`,
    humanClearance: false, authorization: null, evidenceRefs: [],
  }
  const result = decide(request, state, policyBytes, nowMs)
  const kernelCode = result.decision.code
  if (result.decision.status === 'allowed') return { decision: 'allow', rule, message: null, kernelCode }
  const named = (kernelCode === 'sacred_target' && namespace === 'protected')
    || (kernelCode === 'policy_no_match' && namespace === 'unapproved-tool')
  const refusal = named ? rule : `kernel:${kernelCode}`
  return { decision: 'deny', rule: refusal, kernelCode,
    message: named ? message : `AUKORA action gate refused this call [${refusal}]: no kernel permission for this call` }
}
