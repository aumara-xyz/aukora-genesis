// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AukoraNodePrintV1 — the canonical, SECRET-FREE print an Aukora brain node is instantiated from.
 *
 * A "baby" node (local or Nebius) is stamped from this exact print; it contains NO UI, NO keys, NO tokens, NO
 * private infra identifiers. It binds a code SHA, an image digest, package versions, capability flags, an
 * authority-root FINGERPRINT (a hash of the authority-root public key — never the key), a model checksum,
 * budgets, a provider mode, a receipt-genesis anchor, a lineage parent (git commit/PR — canonical lineage), and
 * the PR-only output contract. `nodePrintId` is the canonical hash of the print, so identical prints stamp
 * byte-identical babies. All numeric budgets are integers (cost is micro-USD) so the print is canonical-hashable.
 *
 * Local and Nebius nodes use the SAME print/schema and differ ONLY through an explicit adapter/config
 * (`instantiateNode`). A live (nebius) node is fail-closed: it becomes live only when the print's digests +
 * model checksum are really bound and a valid, enabled runtime manifest is supplied.
 */
import { canonicalHash, canonicalJson, type CanonicalValue } from '@aukora/kernel/canonical';
import { textHasSecret } from '@aukora/evidence';
import type { ProviderMode } from './brainProvider.js';
import { validateNebiusManifest, type NebiusDeploymentManifest, type OutputContract } from './nebiusProvider.js';

export interface NodeBudgets {
  readonly maxGenerations: number;
  readonly maxWallClockMs: number;
  readonly maxOutputTokens: number;
  /** Integer micro-USD (so the print stays canonical-hashable — no floats). */
  readonly maxCostMicroUsd: number;
  readonly maxPatchBytes: number;
}

export interface AukoraNodePrintV1 {
  readonly schema: 'aukora-node-print-v1';
  /** '' = unbound (only offline nodes may run unbound). */
  readonly codeSha256: string;
  readonly imageDigestSha256: string;
  readonly modelChecksumSha256: string;
  readonly packageVersions: Readonly<Record<string, string>>;
  readonly capabilities: readonly string[];
  /** sha256 fingerprint of the authority-root PUBLIC key. NEVER a key. '' = none pinned. */
  readonly authorityRootFingerprint: string;
  readonly budgets: NodeBudgets;
  readonly providerMode: ProviderMode;
  /** Genesis receipt/chain anchor (or null for an empty node). */
  readonly receiptGenesis: string | null;
  /** Parent print id or git commit/PR — canonical lineage is git. */
  readonly lineageParent: string | null;
  readonly outputContract: OutputContract;
  readonly grantsAuthority: false;
}

const HEX64 = /^[0-9a-f]{64}$/;
const isPosInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const hexOrEmpty = (s: unknown): boolean => typeof s === 'string' && (s === '' || HEX64.test(s));

export interface BuildNodePrintInput {
  readonly codeSha256?: string;
  readonly imageDigestSha256?: string;
  readonly modelChecksumSha256?: string;
  readonly packageVersions?: Readonly<Record<string, string>>;
  readonly capabilities?: readonly string[];
  readonly authorityRootFingerprint?: string;
  readonly budgets: NodeBudgets;
  readonly providerMode: ProviderMode;
  readonly receiptGenesis?: string | null;
  readonly lineageParent?: string | null;
}

/** Default capability flags of a brain node — advisory memory only; NO authority, NO merge, NO live effect. */
export const DEFAULT_NODE_CAPABILITIES: readonly string[] = [
  'memory.ingest', 'memory.recall', 'memory.forget', 'chain.verify', 'provider.advisory', 'output.pr-candidate-only',
];

export function buildNodePrint(input: BuildNodePrintInput): AukoraNodePrintV1 {
  return {
    schema: 'aukora-node-print-v1',
    codeSha256: input.codeSha256 ?? '',
    imageDigestSha256: input.imageDigestSha256 ?? '',
    modelChecksumSha256: input.modelChecksumSha256 ?? '',
    packageVersions: input.packageVersions ?? {},
    capabilities: input.capabilities ?? DEFAULT_NODE_CAPABILITIES,
    authorityRootFingerprint: input.authorityRootFingerprint ?? '',
    budgets: input.budgets,
    providerMode: input.providerMode,
    receiptGenesis: input.receiptGenesis ?? null,
    lineageParent: input.lineageParent ?? null,
    outputContract: 'pr-only',
    grantsAuthority: false,
  };
}

/** Canonical id of a print — identical prints ⇒ identical id (and identical stamped babies). */
export function nodePrintId(print: AukoraNodePrintV1): string {
  return canonicalHash(print as unknown as CanonicalValue);
}

/**
 * Validate a print. Returns violations (empty = valid). Enforces shape, canonical-hashable integer budgets,
 * bound-or-empty digests, a fingerprint (never a key), the PR-only output contract, and — critically —
 * SECRET-FREEDOM: the canonical serialization must carry no secret shape (reused @aukora/evidence scanner).
 */
export function validateNodePrint(print: unknown): string[] {
  const v: string[] = [];
  if (print === null || typeof print !== 'object') return ['print_not_object'];
  const o = print as Record<string, unknown>;
  if (o.schema !== 'aukora-node-print-v1') v.push('schema_invalid');
  if (!hexOrEmpty(o.codeSha256)) v.push('codeSha256_invalid');
  if (!hexOrEmpty(o.imageDigestSha256)) v.push('imageDigestSha256_invalid');
  if (!hexOrEmpty(o.modelChecksumSha256)) v.push('modelChecksumSha256_invalid');
  if (!hexOrEmpty(o.authorityRootFingerprint)) v.push('authorityRootFingerprint_invalid');
  if (o.packageVersions === null || typeof o.packageVersions !== 'object' || Array.isArray(o.packageVersions)) v.push('packageVersions_invalid');
  else for (const [, ver] of Object.entries(o.packageVersions as Record<string, unknown>)) if (typeof ver !== 'string') v.push('packageVersions_value_invalid');
  if (!Array.isArray(o.capabilities) || !o.capabilities.every((c) => typeof c === 'string')) v.push('capabilities_invalid');
  const b = o.budgets as Record<string, unknown> | undefined;
  if (!b || typeof b !== 'object') v.push('budgets_missing');
  else {
    if (!isPosInt(b.maxGenerations)) v.push('budget_maxGenerations_invalid');
    if (!isPosInt(b.maxWallClockMs)) v.push('budget_maxWallClockMs_invalid');
    if (!isPosInt(b.maxOutputTokens)) v.push('budget_maxOutputTokens_invalid');
    if (!isPosInt(b.maxCostMicroUsd)) v.push('budget_maxCostMicroUsd_invalid');
    if (!isPosInt(b.maxPatchBytes)) v.push('budget_maxPatchBytes_invalid');
  }
  if (o.providerMode !== 'deterministic-offline' && o.providerMode !== 'nebius') v.push('providerMode_invalid');
  if (o.outputContract !== 'pr-only') v.push('output_contract_must_be_pr_only');
  if (o.grantsAuthority !== false) v.push('grants_authority_must_be_false');
  if (o.receiptGenesis !== null && typeof o.receiptGenesis !== 'string') v.push('receiptGenesis_invalid');
  if (o.lineageParent !== null && typeof o.lineageParent !== 'string') v.push('lineageParent_invalid');
  // SECRET-FREE: the whole print, serialized, must contain no secret shape.
  try {
    if (textHasSecret(canonicalJson(o as unknown as CanonicalValue))) v.push('secret_detected');
  } catch {
    v.push('not_canonical');
  }
  return v;
}

/** True when a print's real digests + model checksum are bound (a precondition for a LIVE nebius node). */
export function nodePrintDigestsBound(print: AukoraNodePrintV1): boolean {
  return HEX64.test(print.codeSha256) && HEX64.test(print.imageDigestSha256) && HEX64.test(print.modelChecksumSha256);
}

export interface NodeAdapter {
  readonly kind: 'local-offline' | 'nebius-runtime';
  readonly providerMode: ProviderMode;
  readonly detail: string;
}

export interface NodeInstance {
  readonly schema: 'aukora-node-instance-v1';
  readonly target: 'local' | 'nebius';
  readonly printId: string;
  /** The IDENTICAL print both targets are stamped from. */
  readonly print: AukoraNodePrintV1;
  /** The ONLY thing that differs between a local and a Nebius node. */
  readonly adapter: NodeAdapter;
  /** Fail-closed liveness: a nebius node is live only with bound digests + a valid enabled runtime manifest. */
  readonly live: boolean;
  readonly reasons: readonly string[];
}

export interface InstantiateConfig {
  /** Only consulted for target 'nebius'. */
  readonly runtimeManifest?: NebiusDeploymentManifest;
}

/**
 * Stamp a node instance from a print for a target. Both targets consume the SAME `print` (same `printId`); they
 * differ ONLY in the returned `adapter` (and the fail-closed `live`/`reasons`). Local is always live (offline
 * provider). Nebius is live ONLY when the print's digests are bound, its providerMode is 'nebius', and a valid,
 * enabled runtime manifest is supplied — otherwise it is prepared-but-not-live (fail-closed), never fabricated.
 */
export function instantiateNode(print: AukoraNodePrintV1, target: 'local' | 'nebius', config: InstantiateConfig = {}): NodeInstance {
  const printId = nodePrintId(print);
  if (target === 'local') {
    return {
      schema: 'aukora-node-instance-v1', target, printId, print,
      adapter: { kind: 'local-offline', providerMode: 'deterministic-offline', detail: 'in-process deterministic offline provider' },
      live: true, reasons: [],
    };
  }
  const reasons: string[] = [];
  if (print.providerMode !== 'nebius') reasons.push('print_provider_mode_not_nebius');
  if (!nodePrintDigestsBound(print)) reasons.push('digests_unbound');
  const m = config.runtimeManifest;
  if (!m) reasons.push('no_runtime_manifest');
  else {
    const violations = validateNebiusManifest(m);
    if (violations.length > 0) reasons.push(`runtime_manifest_invalid:${violations.join(',')}`);
    if (!m.enabled) reasons.push('runtime_not_enabled');
    if (m.modelChecksumSha256 !== print.modelChecksumSha256) reasons.push('model_checksum_mismatch');
  }
  return {
    schema: 'aukora-node-instance-v1', target, printId, print,
    adapter: { kind: 'nebius-runtime', providerMode: 'nebius', detail: 'bounded Nebius runtime adapter' },
    live: reasons.length === 0, reasons,
  };
}

/** A node print grants no authority. Constant. */
export function nodePrintGrantsAuthority(): false {
  return false;
}
