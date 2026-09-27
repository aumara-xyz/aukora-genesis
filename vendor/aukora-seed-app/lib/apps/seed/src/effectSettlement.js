// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Post-effect settlement is PROJECTION-ONLY (#22 overnight, mission item 4). After an effect terminalizes, the
 * only thing the effect broker may write into Convex/durable state is a content-free PROJECTION of the outcome —
 * never an authorization, a signature, a key, or the proposal/draft CONTENT. This module defines that exact
 * projection and a TOTAL validator that refuses anything else, so the settlement boundary cannot be used to
 * smuggle authority or plaintext into the store. Pure; grants no authority; performs no I/O.
 *
 * The phase set is kept in lockstep with the effect protocol's EffectPhase (redeclared here so the settlement
 * boundary is self-contained and does not depend on the protocol module landing first).
 */
const SETTLEABLE_PHASES = new Set([
    'AWAITING_OWNER', 'PREPARED', 'COMMITTED',
    'REFUSED', 'REHEARSAL_FAILED', 'CANCELLED_BEFORE_PREPARE',
    'RECONCILE_REQUIRED', 'QUARANTINED', 'COMPENSATED',
]);
const SETTLEMENT_KEYS = ['schema', 'effectId', 'phase', 'candidateBranch', 'completionRef', 'updatedAtIso', 'advisoryOnly', 'grantsAuthority'];
const HEX64 = /^[0-9a-f]{64}$/;
const CANDIDATE_BRANCH = /^candidate\/[0-9a-f]{6,64}$/; // only a disposable candidate ref may be named
// Authority-shaped keys/values that must NEVER appear in a projection (defense in depth over the exact-key check).
const AUTHORITY_KEY = /^(authorization|signature|signatures|ed25519|mlDsa65|secret|secretKey|privateKey|key|token|content|newContent|draft|payload|nonce)$/i;
function no(field) {
    return { ok: false, field };
}
/**
 * TOTAL, fail-closed validation of a settlement projection. Names the first failing field (content-free labels).
 * Refuses: non-object / wrong key set / any authority-shaped key / bad field shape / COMMITTED without a
 * completion ref / authority-claiming flags. A refused settlement never reaches the store.
 */
export function validateSettlement(x) {
    if (x === null || typeof x !== 'object' || Array.isArray(x))
        return no('not-an-object');
    const r = x;
    const keys = Reflect.ownKeys(r);
    // Loud, specific refusal FIRST: any authority/content-shaped own key is a smuggling attempt, named distinctly
    // from a benign shape mismatch (a `signature`/`newContent`/`nonce` key must never even be considered).
    if (keys.some((k) => typeof k === 'string' && AUTHORITY_KEY.test(k)))
        return no('authority-shaped-key');
    // exact key set — no extra key may ride along (an extra key is refused outright).
    if (keys.length !== SETTLEMENT_KEYS.length || keys.some((k) => typeof k !== 'string' || !SETTLEMENT_KEYS.includes(k)))
        return no('key-set');
    if (r.schema !== 'aukora-effect-settlement-v1')
        return no('schema');
    if (typeof r.effectId !== 'string' || !HEX64.test(r.effectId))
        return no('effectId');
    if (typeof r.phase !== 'string' || !SETTLEABLE_PHASES.has(r.phase))
        return no('phase');
    if (r.candidateBranch !== null && (typeof r.candidateBranch !== 'string' || !CANDIDATE_BRANCH.test(r.candidateBranch)))
        return no('candidateBranch');
    if (r.completionRef !== null && (typeof r.completionRef !== 'string' || !HEX64.test(r.completionRef)))
        return no('completionRef');
    if (typeof r.updatedAtIso !== 'string' || r.updatedAtIso.length === 0 || r.updatedAtIso.length > 40)
        return no('updatedAtIso');
    if (r.advisoryOnly !== true)
        return no('advisoryOnly');
    if (r.grantsAuthority !== false)
        return no('grantsAuthority');
    // INVARIANT: a COMMITTED settlement is a clean success ⇒ it MUST carry a durable completion reference.
    if (r.phase === 'COMMITTED' && r.completionRef === null)
        return no('committed-null-completion');
    return { ok: true, settlement: r };
}
/** Predicate form — true iff `x` is a valid projection-only settlement. */
export function isProjectionOnlySettlement(x) {
    return validateSettlement(x).ok;
}
/** HARD: a settlement is a content-free projection of an outcome; it never carries or mints authority. Constant. */
export function effectSettlementGrantsAuthority() {
    return false;
}
