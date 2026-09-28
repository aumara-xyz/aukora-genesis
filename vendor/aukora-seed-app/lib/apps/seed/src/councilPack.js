// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * CouncilEvidencePackV1 — a bounded, secret-scrubbed evidence pack the canonical Fu runner and one external advisory
 * reviewer can both consume.
 *
 * It captures the exact head/tree, a bounded relevant diff, a test summary, the claims made, the refusal reason
 * classes exercised, receipt references, and a digest over the whole pack. Every free-text field is SCRUBBED through
 * the AURA fence + the evidence secret scanner (secret/production/authority lines are redacted), and a final audit
 * confirms the pack is clean. A council verdict over this pack is ADVISORY and can never waive a gate.
 *
 * Pure/in-memory. Grants no authority.
 */
import { canonicalHash } from '../../../../../authority/lib/canonical.js';
import { textHasSecret } from '../../../packages/evidence/src/index.js';
import { FORBIDDEN_VALUE_RE, FALSE_AUTHORITY_CLAIM_RE, scanForbiddenValues, scanForbiddenAuthorityClaims } from './forbiddenContent.js';
const MAX_DIFF_CHARS = 32_768;
const MAX_ITEMS = 256;
/** Redact any line carrying a secret, a production wire, or a false-authority claim. Returns scrubbed text. */
export function scrubText(text) {
    return text
        .split('\n')
        .map((line) => {
        if (textHasSecret(line))
            return '[REDACTED:secret]';
        if (FORBIDDEN_VALUE_RE.test(line))
            return '[REDACTED:forbidden-value]';
        if (FALSE_AUTHORITY_CLAIM_RE.test(line))
            return '[REDACTED:false-authority]';
        return line;
    })
        .join('\n');
}
function scrubItems(items) {
    return items.slice(0, MAX_ITEMS).map((s) => scrubText(String(s)).slice(0, 512));
}
const HEX = /^[0-9a-f]{6,64}$/;
/**
 * Assemble a scrubbed, digested CouncilEvidencePackV1. Fail-closed: if any field remains forbidden AFTER scrubbing
 * (a leak the redactor could not neutralise), refuse rather than emit an unsafe pack.
 */
export function buildCouncilPack(input) {
    if (!HEX.test(input.headSha) || !HEX.test(input.treeSha))
        return { ok: false, reason: 'headSha/treeSha must be hex' };
    const body = {
        schema: 'aukora-council-evidence-pack-v1',
        headSha: input.headSha,
        treeSha: input.treeSha,
        diff: scrubText(input.diff).slice(0, MAX_DIFF_CHARS),
        tests: { command: scrubText(input.tests.command).slice(0, 256), passed: Math.max(0, input.tests.passed | 0), failed: Math.max(0, input.tests.failed | 0) },
        claims: scrubItems(input.claims),
        refusals: scrubItems(input.refusals),
        receiptRefs: scrubItems(input.receiptRefs),
        advisory: true,
        grantsAuthority: false,
    };
    // Final audit — the scrubbed pack must be forbidden-content free, else fail closed.
    const leaks = [...scanForbiddenValues(body).map((p) => `value@${p}`), ...scanForbiddenAuthorityClaims(body).map((p) => `authority@${p}`)];
    if (leaks.length)
        return { ok: false, reason: 'pack still carries forbidden content after scrubbing', leaks };
    const digest = canonicalHash(body);
    return { ok: true, pack: { ...body, digest } };
}
/** Recompute the digest and confirm the pack is scrubbed clean — an independent reviewer's integrity check. */
export function verifyCouncilPack(pack) {
    const body = {
        schema: pack.schema, headSha: pack.headSha, treeSha: pack.treeSha, diff: pack.diff,
        tests: { command: pack.tests.command, passed: pack.tests.passed, failed: pack.tests.failed },
        claims: [...pack.claims], refusals: [...pack.refusals], receiptRefs: [...pack.receiptRefs],
        advisory: pack.advisory, grantsAuthority: pack.grantsAuthority,
    };
    if (canonicalHash(body) !== pack.digest)
        return { valid: false, reason: 'digest mismatch' };
    const leaks = [...scanForbiddenValues(body), ...scanForbiddenAuthorityClaims(body)];
    if (leaks.length)
        return { valid: false, reason: 'pack carries forbidden content' };
    if (pack.grantsAuthority !== false || pack.advisory !== true)
        return { valid: false, reason: 'pack is not advisory-only' };
    return { valid: true, reason: 'ok' };
}
/** HARD: a council verdict over this pack is advisory and can never waive a gate. Constant, by construction. */
export function councilVerdictWaivesGates() {
    return false;
}
