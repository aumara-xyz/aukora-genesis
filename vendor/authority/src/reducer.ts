// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { canonicalHash, parseCanonicalBytes, type CanonicalValue } from "./canonical.js";
import { KernelInputError } from "./errors.js";
import { verifyAumlokPromotionV2 } from "./authority.js";
import { KERNEL_SCHEMAS, ringCovers } from "./registry.js";
import {
  assertKernelRequest,
  assertPolicy,
  assertTrustedState,
  type DecisionCodeV1,
  type DecisionV1,
  type KernelRequestV1,
  type KernelResultV1,
  type PolicyRuleV1,
  type PolicyV1,
  type ReceiptDraftV1,
  type TrustedStateV1,
} from "./schema.js";

const asCanonical = (value: unknown): CanonicalValue => value as CanonicalValue;

function copyState(state: TrustedStateV1): TrustedStateV1 {
  return {
    schema: state.schema,
    salama: { active: state.salama.active, reason: state.salama.reason },
    trustedRoots: state.trustedRoots.map((root) => ({
      ...root,
      publicKeys: { ...root.publicKeys },
    })),
    consumedIds: [...state.consumedIds],
    receiptHead: { ...state.receiptHead },
  };
}

function matchesRule(request: KernelRequestV1, rule: PolicyRuleV1): boolean {
  return request.action.namespace === rule.action.namespace
    && request.action.kind === rule.action.kind
    && request.action.verb === rule.action.verb
    && request.resource.namespace === rule.resourceNamespace;
}

function isSacred(request: KernelRequestV1, policy: PolicyV1): boolean {
  return policy.sacred.some((target) => target.actionNamespace === request.action.namespace
    && target.actionKind === request.action.kind
    && target.resourceNamespace === request.resource.namespace);
}

function decision(request: KernelRequestV1, state: TrustedStateV1, policy: PolicyV1, nowMs: number): DecisionV1 {
  const refused = (code: DecisionCodeV1): DecisionV1 => ({ status: "refused", code, ring: request.ring, authorizedRootId: null });
  if (state.salama.active) return refused("salama_active");
  if (isSacred(request, policy)) return refused("sacred_target");
  const rules = policy.rules.filter((rule) => matchesRule(request, rule));
  if (rules.length === 0) return refused("policy_no_match");
  if (rules.length !== 1) return refused("policy_ambiguous");
  const rule = rules[0];
  if (!ringCovers(rule.maxRing, request.ring)) return refused("ring_exceeds_policy");
  if (request.ring === "self-modify" && !request.humanClearance) return refused("self_modify_requires_clearance");
  if (request.ring !== "observe" && request.consumptionId === null) return refused("consumption_id_required");
  if (request.consumptionId !== null && state.consumedIds.includes(request.consumptionId)) return refused("replay");
  const authorizationRequired = rule.requiresAuthorization || request.ring === "self-modify";
  if (!authorizationRequired) return { status: "allowed", code: "allowed", ring: request.ring, authorizedRootId: null };
  if (request.authorization === null) return refused("authorization_required");
  if (request.payloadHash === null) return refused("payload_hash_required");
  if (request.authorization.authorization.proposalHash !== request.payloadHash
    || request.authorization.authorization.draftHash !== request.payloadHash) return refused("authorization_payload_mismatch");
  const root = state.trustedRoots.find((candidate) => candidate.rootId === request.authorization?.authorization.rootId);
  if (!root) return refused("authority_root_unknown");
  if (!verifyAumlokPromotionV2(request.authorization, root, nowMs).valid) return refused("authority_invalid");
  return { status: "allowed", code: "allowed", ring: request.ring, authorizedRootId: root.rootId };
}

function transitionView(state: TrustedStateV1): CanonicalValue {
  return {
    schema: state.schema,
    salama: state.salama,
    trustedRoots: state.trustedRoots,
    consumedIds: state.consumedIds,
  } as unknown as CanonicalValue;
}

export function decodePolicy(policyBytes: Uint8Array): PolicyV1 {
  const parsed = parseCanonicalBytes(policyBytes);
  assertPolicy(parsed);
  return parsed;
}

export function decide(
  request: KernelRequestV1,
  trustedState: TrustedStateV1,
  policyBytes: Uint8Array,
  nowMs: number,
): KernelResultV1 {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new KernelInputError("now_invalid");
  assertKernelRequest(request);
  assertTrustedState(trustedState);
  const policy = decodePolicy(policyBytes);
  const priorStateHash = canonicalHash(asCanonical(trustedState));
  const requestHash = canonicalHash(asCanonical(request));
  const policyHash = canonicalHash(asCanonical(policy));
  const verdict = decision(request, trustedState, policy, nowMs);
  const nextState = copyState(trustedState);
  if (verdict.status === "allowed" && request.consumptionId !== null) {
    nextState.consumedIds = [...nextState.consumedIds, request.consumptionId].sort();
  }
  const transitionStateHash = canonicalHash(transitionView(nextState));
  const sequence = trustedState.receiptHead.count + 1;
  const previousReceiptHash = trustedState.receiptHead.headHash;
  const receiptBase = {
    schema: KERNEL_SCHEMAS.receiptDraft,
    requestId: request.requestId,
    requestHash,
    priorStateHash,
    policyHash,
    decision: verdict,
    transitionStateHash,
    previousReceiptHash,
    sequence,
    evidenceRefs: [...request.evidenceRefs].sort(),
    nowMs,
  } as const;
  const draftHash = canonicalHash(asCanonical(receiptBase));
  const receiptDraft: ReceiptDraftV1 = { ...receiptBase, draftHash };
  nextState.receiptHead = { count: sequence, headHash: draftHash };
  return {
    schema: KERNEL_SCHEMAS.result,
    decision: verdict,
    nextState,
    receiptDraft,
  };
}
