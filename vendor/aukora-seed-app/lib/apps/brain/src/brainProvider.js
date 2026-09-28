// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * BrainProvider — the provider-neutral model boundary.
 *
 * The organism attaches real brains without bundling weights. This interface is the only seam a model plugs
 * into; the deterministic offline provider makes every demo/test reproducible with no network and no paid call.
 * NO model grants authority — `providerGrantsAuthority()` is constant false.
 *
 * TRUTH GATE (R29): a model manifest entry carries a `claim` (the label it would earn) and its `evidence`.
 * `AVAILABLE_PRIVATE` is granted ONLY when the entry is backed by an IN-REPO, checksum-bound sanitized manifest
 * (`evidence.inRepoManifestSha256`). Out-of-repo evidence located merely on the build host (an eval harness, a
 * preregistration) is recorded honestly but is NOT sufficient — it downgrades the resolved truth to
 * `UNVERIFIED_OR_PARKED`. This canonical repo ships no weights and no in-repo model manifests, so Qwen / Auma-VL
 * resolve to `UNVERIFIED_OR_PARKED` this round; the gate exists so a future committed manifest can earn
 * `AVAILABLE_PRIVATE` honestly. The manifest carries NO weights, endpoint IDs, job IDs, bucket IDs, or tokens.
 */
import { canonicalHash } from '../../../../../authority/lib/canonical.js';
/** Deterministic, offline, no-network provider. Same prompt ⇒ same output, forever. */
export class DeterministicOfflineProvider {
    id = 'deterministic-offline-v0';
    async complete(prompt) {
        return `advisory:offline:${canonicalHash({ prompt }).slice(0, 24)}`;
    }
}
/**
 * The evidence gate. `AVAILABLE_PRIVATE` requires an in-repo checksum-bound manifest; otherwise it resolves to
 * `UNVERIFIED_OR_PARKED`. Every other claim resolves to itself. Pure and total.
 */
export function resolveTruth(claim, evidence) {
    if (claim === 'AVAILABLE_PRIVATE' && !evidence?.inRepoManifestSha256)
        return 'UNVERIFIED_OR_PARKED';
    return claim;
}
// The eval evidence located out-of-repo on this build host (a sibling working copy): the burn-v5 in-job LUM-READ
// evaluation harness and its preregistration. Recorded by content hash for honest provenance. It is process
// evidence — NOT weights, NOT a result attestation, NOT committed here — so it does NOT earn AVAILABLE_PRIVATE.
const AUMA_VL_LOCATED = [
    { note: 'burn-v5 in-job eval harness (base vs v4 vs v5, LUM-READ v1), sibling working copy', sha256: '95944245e28b809279c467d7f3943d8157fb3489de39a3177a3f632164e41355' },
    { note: 'LUM-READ probe harness, sibling working copy', sha256: '448d0c3cec59c4c3a9dd727e8ae1c9d7d996f7a0525d7280d10c4171a137d680' },
    { note: 'LUM-READ probe preregistration note, sibling working copy', sha256: 'ae9997197c96251fcdfb68a750404e0590613eccef76d2359b97069debaa0055' },
];
// Sanitized model manifest (claims + evidence). Truth labels only — no weights, no private infra identifiers.
const RAW_MANIFEST = [
    {
        id: 'qwen2.5-vl-32b-instruct',
        label: 'base vision-language model',
        claim: 'AVAILABLE_PRIVATE',
        evidence: { locatedOutOfRepo: AUMA_VL_LOCATED, note: 'weights not included; no in-repo checksum-bound manifest, so resolves UNVERIFIED_OR_PARKED' },
    },
    {
        id: 'auma-vl-lora',
        label: 'Auma-VL LoRA ladder (v5..v17 reported; provenance out-of-repo)',
        claim: 'AVAILABLE_PRIVATE',
        evidence: { locatedOutOfRepo: AUMA_VL_LOCATED, note: 'weights not included; no in-repo checksum-bound manifest, so resolves UNVERIFIED_OR_PARKED' },
    },
    {
        id: 'liquid-candidate',
        label: 'Liquid AI candidate',
        claim: 'UNVERIFIED_OR_PARKED',
        evidence: { note: 'no concrete trained artifacts located; parked' },
    },
    {
        id: 'nemotron',
        label: 'Nemotron',
        claim: 'BLOCKED',
        evidence: { note: 'no concrete completed artifacts located; blocked' },
    },
    {
        id: 'router-3b-seed',
        label: '~3B router seed',
        claim: 'DESIGN_ONLY',
        evidence: { note: 'design document only; not trained' },
    },
    {
        id: 'mopd-distillation',
        label: 'MOPD distillation',
        claim: 'DESIGN_ONLY',
        evidence: { note: 'design document only; not trained' },
    },
    {
        id: 'kimi',
        label: 'Kimi (external crew — removed)',
        claim: 'REJECTED',
        evidence: { note: 'off the external crew per owner (R35). Provider-truth records the removal; the canonical Fu council roster is NOT altered for this — seat availability is governed by provider truth + quorum law.' },
    },
];
export const MODEL_MANIFEST = RAW_MANIFEST.map((e) => ({
    id: e.id,
    label: e.label,
    claim: e.claim,
    truth: resolveTruth(e.claim, e.evidence),
    evidence: e.evidence,
}));
/** The resolved truth table as flat `{id, truth}` rows — the honest label per model. */
export function providerTruthTable() {
    return MODEL_MANIFEST.map((e) => ({ id: e.id, truth: e.truth }));
}
/** A provider grants no authority. Constant. */
export function providerGrantsAuthority() {
    return false;
}
