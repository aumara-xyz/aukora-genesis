// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AURA geometry (GEOMETRY_ONLY — a shape the Spatial shell renders, NOT a capability).
 *
 * A safe, bounded numeric summary of a ceremony's evolving state — epoch, phase, lineage depth, attempts,
 * a witness mode, and a coherence scalar in [0,1] — plus a SHORT intent correlator. The Spatial shell renders
 * evolving geometry from these numbers WITHOUT recomputing any governance verdict: the verdict is already baked
 * into `phase`/`coherence` as data. Hard law: geometry grants no authority, carries no secret/private material,
 * and passes the AURA forbidden-field fence (positive allowlist + recursive forbidden-key/value refusal).
 *
 * This module is a leaf: it imports only the fence, never the ceremony. Pure/in-memory.
 */
import { scanForbiddenKeys, scanForbiddenValues, scanForbiddenAuthorityClaims } from './forbiddenContent.js';
/** Frozen geometry bounds. */
export const GEOMETRY_LIMITS = Object.freeze({
    MAX_FRAMES: 1024,
    MAX_INTENT_PREFIX: 12,
    MAX_STRING: 64,
});
const WITNESS_MODES = new Set(['write', 'witness', 'release', 'unknown']);
const HEX = /^[0-9a-f]*$/;
export const GEOMETRY_ALLOWED_FIELDS = new Set([
    'schema', 'epoch', 'phase', 'lineageDepth', 'attemptsUsed', 'witnessMode', 'coherence',
    'intentPrefix', 'classification', 'advisoryOnly', 'grantsAuthority',
]);
const safeInt = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
/** Derive geometry from a decided outcome. Pure; the coherence encodes the ALREADY-decided verdict, so the shell
 *  never recomputes governance. */
export function deriveGeometry(input) {
    const coherence = input.applied ? 1 : input.phase === 'challenge-issued' ? 0.5 : 0.25;
    return {
        schema: 'aukora-aura-geometry-v1',
        epoch: safeInt(input.epoch),
        phase: input.phase.slice(0, GEOMETRY_LIMITS.MAX_STRING),
        lineageDepth: safeInt(input.lineageDepth),
        attemptsUsed: safeInt(input.attemptsUsed),
        witnessMode: input.applied ? 'write' : 'witness',
        coherence,
        intentPrefix: input.intentId ? input.intentId.slice(0, GEOMETRY_LIMITS.MAX_INTENT_PREFIX) : undefined,
        classification: 'GEOMETRY_ONLY',
        advisoryOnly: true,
        grantsAuthority: false,
    };
}
/**
 * Sanitize an untrusted geometry object: (1) recursive forbidden-key/value/authority scan → reject the WHOLE
 * record on any hit (fail-closed — geometry-field smuggling is refused); (2) positive allowlist → drop unknown
 * fields; (3) clamp coherence to [0,1], coerce enums, bound strings, and keep only a SHORT hex intent prefix.
 */
export function sanitizeGeometry(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, geometry: null, droppedFields: [], forbiddenFound: [], reason: 'not a plain object' };
    }
    const forbiddenFound = [
        ...scanForbiddenKeys(raw),
        ...scanForbiddenValues(raw).map((p) => `value@${p}`),
        ...scanForbiddenAuthorityClaims(raw).map((p) => `authority@${p}`),
    ];
    if (forbiddenFound.length) {
        return { ok: false, geometry: null, droppedFields: [], forbiddenFound, reason: `forbidden content at depth: ${forbiddenFound.join(', ')}` };
    }
    const r = raw;
    const droppedFields = Object.keys(r).filter((k) => !GEOMETRY_ALLOWED_FIELDS.has(k));
    const witnessMode = (typeof r.witnessMode === 'string' && WITNESS_MODES.has(r.witnessMode)) ? r.witnessMode : 'unknown';
    const rawPrefix = typeof r.intentPrefix === 'string' ? r.intentPrefix.slice(0, GEOMETRY_LIMITS.MAX_INTENT_PREFIX) : undefined;
    const intentPrefix = rawPrefix !== undefined && HEX.test(rawPrefix) ? rawPrefix : undefined;
    const geometry = {
        schema: 'aukora-aura-geometry-v1',
        epoch: typeof r.epoch === 'number' ? safeInt(r.epoch) : 0,
        phase: typeof r.phase === 'string' ? r.phase.slice(0, GEOMETRY_LIMITS.MAX_STRING) : 'unknown',
        lineageDepth: typeof r.lineageDepth === 'number' ? safeInt(r.lineageDepth) : 0,
        attemptsUsed: typeof r.attemptsUsed === 'number' ? safeInt(r.attemptsUsed) : 0,
        witnessMode,
        coherence: typeof r.coherence === 'number' ? clamp01(r.coherence) : 0,
        intentPrefix,
        classification: 'GEOMETRY_ONLY',
        advisoryOnly: true,
        grantsAuthority: false,
    };
    const rec = geometry;
    for (const k of Object.keys(rec))
        if (rec[k] === undefined)
            delete rec[k];
    return { ok: true, geometry, droppedFields, forbiddenFound: [], reason: 'ok' };
}
/** Bounded, append-only stream of geometry frames — lets the Spatial shell render EVOLVING geometry. */
export class GeometryLog {
    frames = [];
    /** Append a geometry frame (sanitized). A frame that fails the fence is NOT stored (fail-closed). */
    push(raw) {
        const res = sanitizeGeometry(raw);
        if (!res.ok || !res.geometry)
            return false;
        this.frames.push(res.geometry);
        if (this.frames.length > GEOMETRY_LIMITS.MAX_FRAMES)
            this.frames.shift();
        return true;
    }
    all() {
        return this.frames.slice();
    }
    latest() {
        return this.frames.length ? this.frames[this.frames.length - 1] : null;
    }
    clear() {
        this.frames.length = 0;
    }
    /** Self-audit: every stored frame is forbidden-content free. */
    audit() {
        const forbiddenFound = [...scanForbiddenKeys(this.frames), ...scanForbiddenValues(this.frames).map((p) => `value@${p}`)];
        return { clean: forbiddenFound.length === 0, forbiddenFound };
    }
}
/** HARD: geometry grants no authority — ever. Constant, by construction. */
export function auraGeometryGrantsAuthority() {
    return false;
}
