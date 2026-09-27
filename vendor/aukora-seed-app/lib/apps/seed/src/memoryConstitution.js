// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The governed KIRA memory constitution (pure) — the tier law Sam 2 (brain) and Sam 4 (console) consume.
 *
 * Four tiers of memory, ONE law about how each may change:
 *   ROOT / UNITE / RISE — editable through NORMAL governed proposals (the standard recursion gate:
 *     shape → intent id → lineage → secret/staleness → council evidence → owner hybrid signature → sandbox → receipt).
 *   GOLD — the deepest layer. A gold change additionally requires an explicit HIGHER-FRICTION owner AUMLOK
 *     ceremony: a stated REASON, a SUPERSEDES lineage (or an explicit genesis declaration), a PASSED REHEARSAL
 *     receipt, and a ROLLBACK draft — all owner-signed through the ceremony contract.
 *
 * Two hard symmetries keep gold honest:
 *   - gold cannot SELF-AUTHORIZE: nothing written in a memory (any tier) can carry authority — authority-shaped
 *     content is refused by the fence, and only the owner's out-of-band hybrid signature ever authorizes a change;
 *   - gold cannot become TECHNICALLY UNCHANGEABLE: there is no lock field in the law, immutability framings are
 *     refused, and `goldIsImmutable()` is a hard false — the owner ceremony path always exists.
 *
 * UI note: constitution state is DISPLAY-ONLY through `toConstitutionView` (fence-clean, prefix-only); rendered
 * state can never feed an authority or apply decision. Pure: no I/O, clock, signing, or authority grant.
 */
import { scanForbiddenKeys, scanForbiddenValues, scanForbiddenAuthorityClaims } from './forbiddenContent.js';
import { isHex64 } from './proposal.js';
import { completeCeremony } from './ceremony.js';
export const MEMORY_TIERS = ['root', 'unite', 'rise', 'gold'];
/** The tier law — which change path each tier requires. Frozen; there is no tier without a change path. */
export const TIER_LAW = Object.freeze({
    root: 'governed-proposal',
    unite: 'governed-proposal',
    rise: 'governed-proposal',
    gold: 'gold-ceremony',
});
/** Immutability framings the constitution refuses — gold may be slow to change, never impossible. */
export const IMMUTABILITY_RE = /\b(immutable|unchangeable|permanent(ly)? lock(ed)?|never (be )?(changed|edited|superseded|revised)|forever fixed|cannot ever (change|be changed))\b/i;
const verdict = (ok, reasonClass, text) => ({ ok, reasonClass, text });
/** Which change path a tier requires. Total. */
export function requiredChangePath(tier) {
    return TIER_LAW[tier];
}
/**
 * Evaluate the HIGHER-FRICTION gold requirements. Fail-closed with stable reason classes. This runs BEFORE the
 * ceremony — it can only add refusals; passing it never substitutes for the owner's hybrid signature.
 */
export function evaluateGoldChange(tier, req) {
    if (tier !== 'gold')
        return verdict(false, 'gold:tier-not-gold', `refused: tier '${tier}' takes the normal governed-proposal path, not the gold ceremony`);
    if (typeof req.reason !== 'string' || req.reason.trim().length === 0 || req.reason.length > 512) {
        return verdict(false, 'gold:reason-missing', 'refused: a gold change requires a stated, bounded reason');
    }
    if (req.supersedes === null ? req.genesis !== true : !isHex64(req.supersedes)) {
        return verdict(false, 'gold:lineage-missing', 'refused: a gold change requires a 64-hex supersedes lineage (or an explicit genesis declaration)');
    }
    if (!isHex64(req.rehearsalReceiptHash)) {
        return verdict(false, 'gold:rehearsal-missing', 'refused: a gold change requires the receipt hash of a PASSED rehearsal');
    }
    if (!isHex64(req.rollbackDraftHash)) {
        return verdict(false, 'gold:rollback-missing', 'refused: a gold change requires a prepared rollback draft (its 64-hex draftHash)');
    }
    // gold cannot self-authorize: authority-shaped or secret-shaped FREE TEXT is refused outright. The structural
    // hash fields are already shape-validated above (64-hex is their legitimate form, not smuggled material).
    const freeText = { reason: req.reason };
    const leaks = [...scanForbiddenKeys(freeText), ...scanForbiddenValues(freeText), ...scanForbiddenAuthorityClaims(freeText)];
    if (leaks.length)
        return verdict(false, 'gold:self-authorize', 'refused: a gold request can never carry authority or secret material');
    // gold cannot become technically unchangeable: immutability framings are refused.
    if (IMMUTABILITY_RE.test(req.reason))
        return verdict(false, 'gold:immutability-claim', 'refused: gold may be slow to change, never impossible — immutability framings are rejected');
    return verdict(true, 'gold:ok', 'gold requirements met — proceed to the owner AUMLOK ceremony');
}
/**
 * Run a GOLD memory change end-to-end: higher-friction requirements first (refuse-only), then the full owner AUMLOK
 * ceremony (unsigned challenge → custody signature → hybrid verify → witness → receipt/Merkle → sandbox). The gold
 * pre-check can only refuse; the owner's signature remains the sole authority boundary.
 */
export function goldChange(env, proposalInput, challenge, req, auth) {
    const g = evaluateGoldChange('gold', req);
    if (!g.ok)
        return { tier: 'gold', goldVerdict: g, ceremony: null, completed: false, rollbackDraftHash: null, grantsAuthority: false };
    const ceremony = completeCeremony(env, proposalInput, challenge, auth);
    return {
        tier: 'gold',
        goldVerdict: g,
        ceremony,
        completed: ceremony.completed,
        rollbackDraftHash: ceremony.completed ? req.rollbackDraftHash : null,
        grantsAuthority: false,
    };
}
/** HARD: gold is never technically unchangeable — the owner ceremony path always exists. Constant, by construction. */
export function goldIsImmutable() {
    return false;
}
/** HARD: no memory tier can mint authority — memories are evidence, never capability. Constant, by construction. */
export function memoryTierGrantsAuthority(_tier) {
    return false;
}
export function toConstitutionView(counts, goldLineage) {
    return {
        schema: 'aukora-constitution-view-v1',
        tiers: MEMORY_TIERS.map((tier) => ({ tier, changePath: TIER_LAW[tier], count: Math.max(0, counts[tier] | 0) })),
        goldLineagePrefixes: goldLineage.filter((id) => isHex64(id)).map((id) => id.slice(0, 12)),
        classification: 'DISPLAY_ONLY',
        advisoryOnly: true,
        grantsAuthority: false,
    };
}
