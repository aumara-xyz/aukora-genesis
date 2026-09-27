// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { KernelInputError } from "./errors.js";
import { KERNEL_SCHEMAS, RINGS, type Ring } from "./registry.js";

export interface ActionRefV1 {
  namespace: string;
  kind: string;
  verb: string;
}

export interface ResourceRefV1 {
  namespace: string;
  id: string;
}

export interface HybridPublicKeysV1 {
  ed25519: string;
  mlDsa65: string;
}

export interface HybridSignaturesV1 {
  ed25519: string;
  mlDsa65: string;
}

export interface AumlokAuthorityRootV2 {
  schema: "aumlok-authority-root-v2";
  suite: "aumlok-ed25519-ml-dsa-65-v1";
  rootId: string;
  publicKeys: HybridPublicKeysV1;
  mode: "software_hybrid";
  createdAt: string;
  expiresAt: string | null;
  revoked: boolean;
  integrity: string;
}

export interface PromotionAuthorizationV2 {
  rootId: string;
  proposalHash: string;
  draftHash: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string | null;
}

export interface SignedPromotionV2 {
  schema: "aumlok-signed-promotion-v2";
  suite: "aumlok-ed25519-ml-dsa-65-v1";
  authorization: PromotionAuthorizationV2;
  signatures: HybridSignaturesV1;
  mode: "software_hybrid";
}

export interface PolicyRuleV1 {
  action: ActionRefV1;
  resourceNamespace: string;
  maxRing: Ring;
  requiresAuthorization: boolean;
}

export interface SacredTargetV1 {
  actionNamespace: string;
  actionKind: string;
  resourceNamespace: string;
}

export interface PolicyV1 {
  schema: typeof KERNEL_SCHEMAS.policy;
  rules: PolicyRuleV1[];
  sacred: SacredTargetV1[];
}

export interface KernelRequestV1 {
  schema: typeof KERNEL_SCHEMAS.request;
  requestId: string;
  action: ActionRefV1;
  resource: ResourceRefV1;
  ring: Ring;
  payloadHash: string | null;
  consumptionId: string | null;
  humanClearance: boolean;
  authorization: SignedPromotionV2 | null;
  evidenceRefs: string[];
}

export interface TrustedStateV1 {
  schema: typeof KERNEL_SCHEMAS.state;
  salama: { active: boolean; reason: string | null };
  trustedRoots: AumlokAuthorityRootV2[];
  consumedIds: string[];
  receiptHead: { count: number; headHash: string | null };
}

export type DecisionCodeV1 =
  | "allowed"
  | "salama_active"
  | "sacred_target"
  | "policy_no_match"
  | "policy_ambiguous"
  | "ring_exceeds_policy"
  | "self_modify_requires_clearance"
  | "consumption_id_required"
  | "replay"
  | "authorization_required"
  | "payload_hash_required"
  | "authorization_payload_mismatch"
  | "authority_root_unknown"
  | "authority_invalid";

export interface DecisionV1 {
  status: "allowed" | "refused";
  code: DecisionCodeV1;
  ring: Ring;
  authorizedRootId: string | null;
}

export interface ReceiptDraftV1 {
  schema: typeof KERNEL_SCHEMAS.receiptDraft;
  requestId: string;
  requestHash: string;
  priorStateHash: string;
  policyHash: string;
  decision: DecisionV1;
  transitionStateHash: string;
  previousReceiptHash: string | null;
  sequence: number;
  evidenceRefs: string[];
  nowMs: number;
  draftHash: string;
}

export interface KernelResultV1 {
  schema: typeof KERNEL_SCHEMAS.result;
  decision: DecisionV1;
  nextState: TrustedStateV1;
  receiptDraft: ReceiptDraftV1;
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const HEX_32 = /^[0-9a-f]{64}$/;
const ISO_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KernelInputError(code);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new KernelInputError(code);
}

function identifier(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new KernelInputError(code);
}

function hash(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !HEX_32.test(value)) throw new KernelInputError(code);
}

function nullableHash(value: unknown, code: string): void {
  if (value !== null) hash(value, code);
}

function bool(value: unknown, code: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new KernelInputError(code);
}

function stringArray(value: unknown, code: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && IDENTIFIER.test(entry))) throw new KernelInputError(code);
  if (new Set(value).size !== value.length) throw new KernelInputError(`${code}:duplicate`);
}

function assertAction(value: unknown, code: string): asserts value is ActionRefV1 {
  const row = object(value, code);
  exact(row, ["namespace", "kind", "verb"], `${code}:keys`);
  identifier(row.namespace, `${code}:namespace`);
  identifier(row.kind, `${code}:kind`);
  identifier(row.verb, `${code}:verb`);
}

function assertResource(value: unknown, code: string): asserts value is ResourceRefV1 {
  const row = object(value, code);
  exact(row, ["namespace", "id"], `${code}:keys`);
  identifier(row.namespace, `${code}:namespace`);
  identifier(row.id, `${code}:id`);
}

export function assertAuthorityRoot(value: unknown): asserts value is AumlokAuthorityRootV2 {
  const row = object(value, "root_malformed");
  exact(row, ["schema", "suite", "rootId", "publicKeys", "mode", "createdAt", "expiresAt", "revoked", "integrity"], "root_unknown_fields");
  if (row.schema !== "aumlok-authority-root-v2" || row.suite !== "aumlok-ed25519-ml-dsa-65-v1" || row.mode !== "software_hybrid") throw new KernelInputError("root_profile_invalid");
  hash(row.rootId, "root_id_invalid");
  hash(row.integrity, "root_integrity_shape");
  const keys = object(row.publicKeys, "root_keys_malformed");
  exact(keys, ["ed25519", "mlDsa65"], "root_keys_unknown_fields");
  if (typeof keys.ed25519 !== "string" || !/^[0-9a-f]{64}$/.test(keys.ed25519)) throw new KernelInputError("root_ed25519_invalid");
  if (typeof keys.mlDsa65 !== "string" || !/^[0-9a-f]{3904}$/.test(keys.mlDsa65)) throw new KernelInputError("root_mldsa_invalid");
  if (typeof row.createdAt !== "string" || !ISO_UTC_MILLIS.test(row.createdAt)) throw new KernelInputError("root_created_at_invalid");
  if (row.expiresAt !== null && (typeof row.expiresAt !== "string" || !ISO_UTC_MILLIS.test(row.expiresAt))) throw new KernelInputError("root_expires_at_invalid");
  bool(row.revoked, "root_revoked_invalid");
}

export function assertSignedPromotion(value: unknown): asserts value is SignedPromotionV2 {
  const row = object(value, "authorization_malformed");
  exact(row, ["schema", "suite", "authorization", "signatures", "mode"], "authorization_unknown_fields");
  if (row.schema !== "aumlok-signed-promotion-v2" || row.suite !== "aumlok-ed25519-ml-dsa-65-v1" || row.mode !== "software_hybrid") throw new KernelInputError("authorization_profile_invalid");
  const auth = object(row.authorization, "authorization_payload_malformed");
  exact(auth, ["rootId", "proposalHash", "draftHash", "nonce", "issuedAt", "expiresAt"], "authorization_payload_unknown_fields");
  hash(auth.rootId, "authorization_root_id_invalid");
  hash(auth.proposalHash, "authorization_proposal_hash_invalid");
  hash(auth.draftHash, "authorization_draft_hash_invalid");
  identifier(auth.nonce, "authorization_nonce_invalid");
  if (typeof auth.issuedAt !== "string" || !ISO_UTC_MILLIS.test(auth.issuedAt)) throw new KernelInputError("authorization_issued_at_invalid");
  if (auth.expiresAt !== null && (typeof auth.expiresAt !== "string" || !ISO_UTC_MILLIS.test(auth.expiresAt))) throw new KernelInputError("authorization_expires_at_invalid");
  const signatures = object(row.signatures, "authorization_signatures_malformed");
  exact(signatures, ["ed25519", "mlDsa65"], "authorization_signatures_unknown_fields");
  if (typeof signatures.ed25519 !== "string" || !/^[0-9a-f]{128}$/.test(signatures.ed25519)) throw new KernelInputError("authorization_ed25519_signature_invalid");
  if (typeof signatures.mlDsa65 !== "string" || !/^[0-9a-f]{6618}$/.test(signatures.mlDsa65)) throw new KernelInputError("authorization_mldsa_signature_invalid");
}

export function assertKernelRequest(value: unknown): asserts value is KernelRequestV1 {
  const row = object(value, "request_malformed");
  exact(row, ["schema", "requestId", "action", "resource", "ring", "payloadHash", "consumptionId", "humanClearance", "authorization", "evidenceRefs"], "request_unknown_fields");
  if (row.schema !== KERNEL_SCHEMAS.request) throw new KernelInputError("request_schema_invalid");
  identifier(row.requestId, "request_id_invalid");
  assertAction(row.action, "request_action_invalid");
  assertResource(row.resource, "request_resource_invalid");
  if (typeof row.ring !== "string" || !(RINGS as readonly string[]).includes(row.ring)) throw new KernelInputError("request_ring_invalid");
  nullableHash(row.payloadHash, "request_payload_hash_invalid");
  if (row.consumptionId !== null) identifier(row.consumptionId, "request_consumption_id_invalid");
  bool(row.humanClearance, "request_clearance_invalid");
  if (row.authorization !== null) assertSignedPromotion(row.authorization);
  stringArray(row.evidenceRefs, "request_evidence_refs_invalid");
}

export function assertTrustedState(value: unknown): asserts value is TrustedStateV1 {
  const row = object(value, "state_malformed");
  exact(row, ["schema", "salama", "trustedRoots", "consumedIds", "receiptHead"], "state_unknown_fields");
  if (row.schema !== KERNEL_SCHEMAS.state) throw new KernelInputError("state_schema_invalid");
  const salama = object(row.salama, "state_salama_invalid");
  exact(salama, ["active", "reason"], "state_salama_unknown_fields");
  bool(salama.active, "state_salama_active_invalid");
  if (salama.reason !== null && typeof salama.reason !== "string") throw new KernelInputError("state_salama_reason_invalid");
  if (!Array.isArray(row.trustedRoots)) throw new KernelInputError("state_roots_invalid");
  row.trustedRoots.forEach(assertAuthorityRoot);
  const rootIds = row.trustedRoots.map((root) => root.rootId);
  if (new Set(rootIds).size !== rootIds.length || rootIds.some((id, index) => index > 0 && rootIds[index - 1] > id)) throw new KernelInputError("state_roots_not_canonical");
  const consumedIds = row.consumedIds;
  stringArray(consumedIds, "state_consumed_ids_invalid");
  if (consumedIds.some((id, index) => index > 0 && consumedIds[index - 1] > id)) throw new KernelInputError("state_consumed_ids_not_sorted");
  const head = object(row.receiptHead, "state_receipt_head_invalid");
  exact(head, ["count", "headHash"], "state_receipt_head_unknown_fields");
  if (!Number.isSafeInteger(head.count) || (head.count as number) < 0) throw new KernelInputError("state_receipt_count_invalid");
  nullableHash(head.headHash, "state_receipt_hash_invalid");
  if (((head.count as number) === 0) !== (head.headHash === null)) throw new KernelInputError("state_receipt_head_incoherent");
}

export function assertPolicy(value: unknown): asserts value is PolicyV1 {
  const row = object(value, "policy_malformed");
  exact(row, ["schema", "rules", "sacred"], "policy_unknown_fields");
  if (row.schema !== KERNEL_SCHEMAS.policy) throw new KernelInputError("policy_schema_invalid");
  if (!Array.isArray(row.rules)) throw new KernelInputError("policy_rules_invalid");
  const ruleIds = new Set<string>();
  for (const entry of row.rules) {
    const rule = object(entry, "policy_rule_invalid");
    exact(rule, ["action", "resourceNamespace", "maxRing", "requiresAuthorization"], "policy_rule_unknown_fields");
    assertAction(rule.action, "policy_rule_action_invalid");
    identifier(rule.resourceNamespace, "policy_rule_resource_invalid");
    if (typeof rule.maxRing !== "string" || !(RINGS as readonly string[]).includes(rule.maxRing)) throw new KernelInputError("policy_rule_ring_invalid");
    bool(rule.requiresAuthorization, "policy_rule_authorization_invalid");
    const action = rule.action as unknown as ActionRefV1;
    const id = `${action.namespace}\u0000${action.kind}\u0000${action.verb}\u0000${String(rule.resourceNamespace)}`;
    if (ruleIds.has(id)) throw new KernelInputError("policy_rule_duplicate");
    ruleIds.add(id);
  }
  if (!Array.isArray(row.sacred)) throw new KernelInputError("policy_sacred_invalid");
  for (const entry of row.sacred) {
    const sacred = object(entry, "policy_sacred_target_invalid");
    exact(sacred, ["actionNamespace", "actionKind", "resourceNamespace"], "policy_sacred_unknown_fields");
    identifier(sacred.actionNamespace, "policy_sacred_action_namespace_invalid");
    identifier(sacred.actionKind, "policy_sacred_action_kind_invalid");
    identifier(sacred.resourceNamespace, "policy_sacred_resource_invalid");
  }
}
