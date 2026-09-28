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
import { canonicalHash, canonicalJson } from '../../../../../authority/lib/canonical.js';
import { textHasSecret } from '../../../packages/evidence/src/index.js';
import { validateNebiusManifest } from './nebiusProvider.js';
const HEX64 = /^[0-9a-f]{64}$/;
const isPosInt = (n) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const hexOrEmpty = (s) => typeof s === 'string' && (s === '' || HEX64.test(s));
/** Default capability flags of a brain node — advisory memory only; NO authority, NO merge, NO live effect. */
export const DEFAULT_NODE_CAPABILITIES = [
    'memory.ingest', 'memory.recall', 'memory.forget', 'chain.verify', 'provider.advisory', 'output.pr-candidate-only',
];
export function buildNodePrint(input) {
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
export function nodePrintId(print) {
    return canonicalHash(print);
}
/**
 * Validate a print. Returns violations (empty = valid). Enforces shape, canonical-hashable integer budgets,
 * bound-or-empty digests, a fingerprint (never a key), the PR-only output contract, and — critically —
 * SECRET-FREEDOM: the canonical serialization must carry no secret shape (reused @aukora/evidence scanner).
 */
export function validateNodePrint(print) {
    const v = [];
    if (print === null || typeof print !== 'object')
        return ['print_not_object'];
    const o = print;
    if (o.schema !== 'aukora-node-print-v1')
        v.push('schema_invalid');
    if (!hexOrEmpty(o.codeSha256))
        v.push('codeSha256_invalid');
    if (!hexOrEmpty(o.imageDigestSha256))
        v.push('imageDigestSha256_invalid');
    if (!hexOrEmpty(o.modelChecksumSha256))
        v.push('modelChecksumSha256_invalid');
    if (!hexOrEmpty(o.authorityRootFingerprint))
        v.push('authorityRootFingerprint_invalid');
    if (o.packageVersions === null || typeof o.packageVersions !== 'object' || Array.isArray(o.packageVersions))
        v.push('packageVersions_invalid');
    else
        for (const [, ver] of Object.entries(o.packageVersions))
            if (typeof ver !== 'string')
                v.push('packageVersions_value_invalid');
    if (!Array.isArray(o.capabilities) || !o.capabilities.every((c) => typeof c === 'string'))
        v.push('capabilities_invalid');
    const b = o.budgets;
    if (!b || typeof b !== 'object')
        v.push('budgets_missing');
    else {
        if (!isPosInt(b.maxGenerations))
            v.push('budget_maxGenerations_invalid');
        if (!isPosInt(b.maxWallClockMs))
            v.push('budget_maxWallClockMs_invalid');
        if (!isPosInt(b.maxOutputTokens))
            v.push('budget_maxOutputTokens_invalid');
        if (!isPosInt(b.maxCostMicroUsd))
            v.push('budget_maxCostMicroUsd_invalid');
        if (!isPosInt(b.maxPatchBytes))
            v.push('budget_maxPatchBytes_invalid');
    }
    if (o.providerMode !== 'deterministic-offline' && o.providerMode !== 'nebius')
        v.push('providerMode_invalid');
    if (o.outputContract !== 'pr-only')
        v.push('output_contract_must_be_pr_only');
    if (o.grantsAuthority !== false)
        v.push('grants_authority_must_be_false');
    if (o.receiptGenesis !== null && typeof o.receiptGenesis !== 'string')
        v.push('receiptGenesis_invalid');
    if (o.lineageParent !== null && typeof o.lineageParent !== 'string')
        v.push('lineageParent_invalid');
    // SECRET-FREE: the whole print, serialized, must contain no secret shape.
    try {
        if (textHasSecret(canonicalJson(o)))
            v.push('secret_detected');
    }
    catch {
        v.push('not_canonical');
    }
    return v;
}
/** True when a print's real digests + model checksum are bound (a precondition for a LIVE nebius node). */
export function nodePrintDigestsBound(print) {
    return HEX64.test(print.codeSha256) && HEX64.test(print.imageDigestSha256) && HEX64.test(print.modelChecksumSha256);
}
/**
 * Stamp a node instance from a print for a target. Both targets consume the SAME `print` (same `printId`); they
 * differ ONLY in the returned `adapter` (and the fail-closed `live`/`reasons`). Local is always live (offline
 * provider). Nebius is live ONLY when the print's digests are bound, its providerMode is 'nebius', and a valid,
 * enabled runtime manifest is supplied — otherwise it is prepared-but-not-live (fail-closed), never fabricated.
 */
export function instantiateNode(print, target, config = {}) {
    const printId = nodePrintId(print);
    if (target === 'local') {
        return {
            schema: 'aukora-node-instance-v1', target, printId, print,
            adapter: { kind: 'local-offline', providerMode: 'deterministic-offline', detail: 'in-process deterministic offline provider' },
            live: true, reasons: [],
        };
    }
    const reasons = [];
    if (print.providerMode !== 'nebius')
        reasons.push('print_provider_mode_not_nebius');
    if (!nodePrintDigestsBound(print))
        reasons.push('digests_unbound');
    const m = config.runtimeManifest;
    if (!m)
        reasons.push('no_runtime_manifest');
    else {
        const violations = validateNebiusManifest(m);
        if (violations.length > 0)
            reasons.push(`runtime_manifest_invalid:${violations.join(',')}`);
        if (!m.enabled)
            reasons.push('runtime_not_enabled');
        if (m.modelChecksumSha256 !== print.modelChecksumSha256)
            reasons.push('model_checksum_mismatch');
    }
    return {
        schema: 'aukora-node-instance-v1', target, printId, print,
        adapter: { kind: 'nebius-runtime', providerMode: 'nebius', detail: 'bounded Nebius runtime adapter' },
        live: reasons.length === 0, reasons,
    };
}
/** A node print grants no authority. Constant. */
export function nodePrintGrantsAuthority() {
    return false;
}
