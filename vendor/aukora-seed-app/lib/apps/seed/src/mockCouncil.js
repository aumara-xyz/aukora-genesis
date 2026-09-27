// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Deterministic advisory review (offline).
 *
 * Uses the canonical @aukora/council claim-basis primitives to freeze and verify the review basis, then returns
 * an ADVISORY verdict only. No live provider, no paid call, no authority: even a passing review authorizes
 * nothing — only the owner-gate does. The frozen-basis `digest` is surfaced as the council EVIDENCE artifact,
 * so the recursion pipeline can require concrete evidence and fail closed when it is missing.
 */
import { freezeClaimBasis, verifyClaimBasis } from '../../../packages/council/index.js';
/**
 * Deterministic offline review. `now` is injected (no ambient clock). Passes only when the frozen claim basis
 * verifies and there is a claim to review; the verdict is purely advisory and carries the basis digest as evidence.
 */
export const mockCouncilReview = (problem, claimTexts, now) => {
    const basis = freezeClaimBasis(problem, claimTexts, now);
    const basisValid = verifyClaimBasis(basis, problem);
    const pass = basisValid && claimTexts.length > 0;
    return {
        verdict: pass ? 'advisory-pass' : 'advisory-hold',
        grantsAuthority: false,
        advisoryOnly: true,
        basisValid,
        evidenceDigest: basisValid ? basis.digest : '',
        reason: pass
            ? 'advisory review passed (deterministic offline; no live provider contacted)'
            : 'advisory hold (basis invalid or no claim)',
    };
};
export function councilGrantsAuthority() {
    return false;
}
