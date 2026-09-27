// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Provider-neutral live-council runner BOUNDARY (pure) — the wall around CouncilEvidencePackV1.
 *
 * This module defines HOW a live council pass over an evidence pack would be admitted — and holds every gate shut
 * by construction in this round:
 *   - provider-neutral: the transport is INJECTED (the same `Transport` contract the canonical Fu engine uses);
 *     there is NO default transport and NO embedded credential — a config carrying a credential-shaped key is
 *     refused by the fence, and with no transport the boundary refuses honestly (`runner:no-transport`);
 *   - hard ceilings: $2 per pass and $10 per day, enforced FAIL-CLOSED through the canonical @aukora/council
 *     SpendMeter (projection first; a pass that could breach either ceiling never dispatches);
 *   - the pack itself must verify (digest + scrub audit) before anything would run;
 *   - external Fugu is ONE ADVISORY REVIEWER of the pack — never Fu authority: it holds no seat in any roster,
 *     counts toward no quorum, and its review can never waive a gate.
 *
 * NO live call happens here: this is the boundary law, not the runner. Pure: no I/O, no network, no authority.
 */
import { SpendMeter, SpendCeilingExceeded } from '../../../packages/council/index.js';
import { scanForbiddenKeys, scanForbiddenValues } from './forbiddenContent.js';
import { verifyCouncilPack } from './councilPack.js';
/** Hard runner ceilings — frozen; a config cannot widen them (narrower is allowed, wider is clamped). */
export const RUNNER_CEILINGS = Object.freeze({ perPassUsd: 2.0, perDayUsd: 10.0 });
const HANDLE_RE = /^[a-z0-9:._-]{1,64}$/;
/** Validate a broker reference: opaque short handles only, never credential-shaped material. Total. */
export function validateBrokerRef(ref) {
    if (ref === null || typeof ref !== 'object' || Array.isArray(ref))
        return { valid: false, reason: 'broker-ref: not a plain object' };
    const r = ref;
    if (r.schema !== 'aukora-broker-ref-v1' || r.issue !== '#30')
        return { valid: false, reason: 'broker-ref: wrong schema/issue' };
    if (typeof r.transportHandle !== 'string' || !HANDLE_RE.test(r.transportHandle))
        return { valid: false, reason: 'broker-ref: transportHandle must be an opaque short handle' };
    if (typeof r.custodyHandle !== 'string' || !HANDLE_RE.test(r.custodyHandle))
        return { valid: false, reason: 'broker-ref: custodyHandle must be an opaque short handle' };
    const leaks = [...scanForbiddenKeys(r), ...scanForbiddenValues(r)];
    if (leaks.length)
        return { valid: false, reason: 'broker-ref: credential-shaped material in a handle' };
    return { valid: true, reason: 'ok' };
}
const refuse = (reasonClass, text) => ({ admitted: false, reasonClass, text });
/** Effective limits: caller may narrow, never widen. */
export function effectiveLimits(limits) {
    return {
        perPassUsd: Math.min(RUNNER_CEILINGS.perPassUsd, limits?.perPassUsd ?? RUNNER_CEILINGS.perPassUsd),
        perDayUsd: Math.min(RUNNER_CEILINGS.perDayUsd, limits?.perDayUsd ?? RUNNER_CEILINGS.perDayUsd),
    };
}
export class CouncilRunnerBoundary {
    transport;
    brokerRef;
    limits;
    dayToDateUsd;
    configLeaks;
    constructor(config = {}) {
        this.transport = config.transport;
        this.brokerRef = config.brokerRef;
        this.limits = effectiveLimits(config.limits);
        this.dayToDateUsd = Number.isFinite(config.dayToDateUsd) && config.dayToDateUsd > 0 ? config.dayToDateUsd : 0;
        // NO EMBEDDED CREDENTIAL: a config smuggling a credential-shaped key/value anywhere is remembered and refused.
        this.configLeaks = [
            ...scanForbiddenKeys({ ...config, transport: undefined }),
            ...scanForbiddenValues({ ...config, transport: undefined }).map((p) => `value@${p}`),
        ];
    }
    /**
     * Decide whether ONE live pass over `pack` would be admitted. Refuse-only gates, checked in order:
     * config credential fence → pack integrity → transport presence → per-pass ceiling → per-day ceiling.
     * Admission is a DECISION, not a dispatch — this module never performs the call.
     */
    admit(pack, estimatedUsd) {
        if (this.configLeaks.length) {
            return refuse('runner:credential-embedded', `refused: runner config carries credential-shaped material (${this.configLeaks.length} finding(s)) — credentials are supplied out-of-band, never embedded`);
        }
        if (this.brokerRef !== undefined) {
            const b = validateBrokerRef(this.brokerRef);
            if (!b.valid)
                return refuse('runner:broker-ref-invalid', `refused: ${b.reason}`);
        }
        const packVerdict = verifyCouncilPack(pack);
        if (!packVerdict.valid)
            return refuse('runner:pack-invalid', `refused: evidence pack failed verification (${packVerdict.reason})`);
        if (this.transport === undefined) {
            return refuse('runner:no-transport', 'refused: no injected provider transport — no live call is possible (none is embedded, by design)');
        }
        const est = Number.isFinite(estimatedUsd) && estimatedUsd >= 0 ? estimatedUsd : Number.POSITIVE_INFINITY;
        // Canonical fail-closed spend law: projection guard through the @aukora/council SpendMeter.
        const meter = new SpendMeter(this.limits, this.dayToDateUsd);
        try {
            meter.beginPass();
            meter.reserve(est);
        }
        catch (e) {
            if (e instanceof SpendCeilingExceeded) {
                const perPass = est > this.limits.perPassUsd;
                return refuse(perPass ? 'runner:ceiling-per-pass' : 'runner:ceiling-per-day', `refused: ${e.message}`);
            }
            return refuse('runner:ceiling-per-pass', 'refused: spend projection failed');
        }
        return { admitted: true, reasonClass: 'runner:ok', text: 'admissible: pack verified, transport present, within ceilings (no call performed here)', packDigest: pack.digest, estimatedUsd: est };
    }
}
// ── External Fugu — one advisory reviewer, never Fu authority ─────────────────────────────────
export const FUGU_REVIEWER = Object.freeze({
    id: 'FUGU',
    role: 'external-advisory-reviewer',
    authority: false,
    countsTowardQuorum: false,
});
/** Fugu's review = an integrity read of the pack. Advisory evidence only; it can neither vote nor waive. */
export function fuguReview(pack) {
    const v = verifyCouncilPack(pack);
    return { reviewer: 'FUGU', role: 'external-advisory-reviewer', packDigest: pack.digest, packValid: v.valid, reason: v.reason, advisoryOnly: true, grantsAuthority: false };
}
/** A Fu roster must never seat an external reviewer — Fugu can never become Fu. Fail-closed check. */
export function rosterExcludesExternalReviewers(seats) {
    for (const seat of seats) {
        if (seat.id === FUGU_REVIEWER.id || seat.role === FUGU_REVIEWER.role) {
            return { valid: false, reason: `roster: '${seat.id}' is an external advisory reviewer and can never hold a Fu seat` };
        }
    }
    return { valid: true, reason: 'ok' };
}
/** HARD: Fugu is never Fu authority. Constant, by construction. */
export function fuguIsFuAuthority() {
    return false;
}
