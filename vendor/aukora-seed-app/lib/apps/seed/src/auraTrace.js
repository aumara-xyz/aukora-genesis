// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AURA portable trace law (TRACE_ONLY — a stethoscope, NOT a capability).
 *
 * A scrubbed PUBLIC trace around each governed-recursion decision: it records WHICH phase/stage the pipeline
 * reached (attempt | verified | refused | applied) and a SAFE refusal category, without exposing the proposed
 * content, the owner signature, the full intent id, or any private state — and it grants NO power. Hard law:
 *   - evidence never authority — a trace can NEVER authorize/deny/retry/accelerate or alter any gate or apply;
 *     there is no read path from this module into the recursion decision (`grantsAuthority:false`, advisoryOnly).
 *   - positive ALLOWLIST only; unknown fields are dropped (fail-closed).
 *   - a RECURSIVE forbidden-field/value scanner rejects the WHOLE record if any forbidden key OR secret/authority
 *     value appears at any depth (the AURA fence, ported in ./forbiddenContent).
 *   - verbatim, frozen TRACE_LIMITS bound every string and the store size, so a trace can neither grow memory
 *     without bound nor smuggle a long secret through a "safe" field.
 *   - erasure is HONEST and VERIFIABLE: an erased trace leaves a content-free tombstone (the audit that a trace
 *     existed and was erased is kept) and `verifyErasure` proves no content residue survived.
 *
 * PROVENANCE: distilled from the donor `core/src/boundaryTraceTelemetry.ts` (aukora-symbiote, HRT-002 / 24Z.20),
 * adapted to the recursion pipeline. This module is pure/in-memory: no I/O, network, clock, signing, or authority.
 */
import { scanForbiddenKeys, scanForbiddenValues, scanForbiddenAuthorityClaims, } from './forbiddenContent.js';
/** Verbatim, frozen bounds — the AURA trace pins. A trace that would exceed any of these is truncated or refused. */
export const TRACE_LIMITS = Object.freeze({
    /** Ring-buffer ceiling — live emission can never grow memory without bound. */
    MAX_TRACES: 2048,
    /** Maximum length of any stored string field. */
    MAX_STRING: 200,
    /** Maximum length of a refusal-category string. */
    MAX_REASON: 64,
    /** Maximum length of the safe intent correlator (a SHORT prefix, never the full 64-hex intent id). */
    MAX_INTENT_PREFIX: 12,
});
// Positive allowlist — ONLY these public field names may appear in a stored trace.
export const ALLOWED_FIELDS = new Set([
    'eventId', 'timestampMs', 'phase', 'stage', 'receiptMode', 'refusalCause', 'intentPrefix',
    'source', 'classification', 'advisoryOnly', 'grantsAuthority',
]);
const PHASES = new Set(['attempt', 'verified', 'refused', 'applied']);
const RECEIPT_MODES = new Set(['write', 'witness', 'release', 'unknown']);
const TRACE_SOURCES = new Set(['governedRecursion', 'sandboxApply', 'testFixture']);
const HEX = /^[0-9a-f]*$/;
const numOf = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strOf = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
/**
 * Sanitize a raw trace into a stored event. (1) recursive forbidden-key/value/authority scan → reject the WHOLE
 * record on any hit (fail-closed); (2) positive allowlist → keep only known public fields, drop the rest;
 * (3) bound every string to TRACE_LIMITS. No meta/payload escape hatch survives — unknown blobs are dropped, and
 * if they nest a forbidden key or a secret/authority value the whole record is rejected.
 */
export function sanitizeTraceEvent(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, event: null, droppedFields: [], forbiddenFound: [], reason: 'not a plain object' };
    }
    const forbiddenFound = [
        ...scanForbiddenKeys(raw),
        ...scanForbiddenValues(raw).map((p) => `value@${p}`),
        ...scanForbiddenAuthorityClaims(raw).map((p) => `authority@${p}`),
    ];
    if (forbiddenFound.length) {
        return { ok: false, event: null, droppedFields: [], forbiddenFound, reason: `forbidden content at depth: ${forbiddenFound.join(', ')}` };
    }
    const r = raw;
    const droppedFields = Object.keys(r).filter((k) => !ALLOWED_FIELDS.has(k));
    const phase = (typeof r.phase === 'string' && PHASES.has(r.phase)) ? r.phase : 'attempt';
    const receiptMode = (typeof r.receiptMode === 'string' && RECEIPT_MODES.has(r.receiptMode)) ? r.receiptMode : 'unknown';
    const source = (typeof r.source === 'string' && TRACE_SOURCES.has(r.source)) ? r.source : 'testFixture';
    // Intent correlator: a SHORT lowercase-hex prefix only; anything else is dropped.
    const rawPrefix = strOf(r.intentPrefix, TRACE_LIMITS.MAX_INTENT_PREFIX);
    const intentPrefix = rawPrefix !== undefined && HEX.test(rawPrefix) ? rawPrefix : undefined;
    const event = {
        eventId: strOf(r.eventId, TRACE_LIMITS.MAX_STRING) ?? `evt_${numOf(r.timestampMs) ?? 0}`,
        timestampMs: numOf(r.timestampMs) ?? 0,
        phase,
        stage: strOf(r.stage, TRACE_LIMITS.MAX_REASON) ?? phase,
        receiptMode,
        refusalCause: strOf(r.refusalCause, TRACE_LIMITS.MAX_REASON),
        intentPrefix,
        source,
        classification: 'TRACE_ONLY',
        advisoryOnly: true,
        grantsAuthority: false,
    };
    // strip undefined optionals so a stored event carries only present fields
    const rec = event;
    for (const k of Object.keys(rec))
        if (rec[k] === undefined)
            delete rec[k];
    return { ok: true, event, droppedFields, forbiddenFound: [], reason: 'ok' };
}
/**
 * In-memory AURA trace log (TRACE_ONLY). Ring-buffered to TRACE_LIMITS.MAX_TRACES so live emission cannot grow
 * memory. There is no authority read path — the only accessors return scrubbed evidence, never a capability.
 */
export class AuraTraceLog {
    store = [];
    /** Sanitize + append a trace. A rejected record is NOT stored (fail-closed) and the sanitize result explains why. */
    record(raw) {
        const res = sanitizeTraceEvent(raw);
        if (res.ok && res.event) {
            this.store.push(res.event);
            if (this.store.length > TRACE_LIMITS.MAX_TRACES)
                this.store.shift();
        }
        return res;
    }
    traces() {
        return this.store.slice();
    }
    count() {
        return this.store.length;
    }
    clear() {
        this.store.length = 0;
    }
    /** Stored traces must contain zero forbidden keys/values — a self-audit over the whole store. */
    audit() {
        const forbiddenFound = [
            ...scanForbiddenKeys(this.store),
            ...scanForbiddenValues(this.store).map((p) => `value@${p}`),
            ...scanForbiddenAuthorityClaims(this.store).map((p) => `authority@${p}`),
        ];
        return { clean: forbiddenFound.length === 0, forbiddenFound };
    }
    /**
     * Honest erasure: replace the FIRST live event for `eventId` with a content-free tombstone. The audit that a
     * trace existed and was erased is preserved (the store is not silently rewritten to hide the erasure), and no
     * content field survives. Idempotent-ish: erasing an already-erased or unknown id reports why.
     */
    erase(eventId) {
        const idx = this.store.findIndex((e) => e.eventId === eventId && !('erased' in e));
        if (idx < 0) {
            const already = this.store.some((e) => e.eventId === eventId && 'erased' in e);
            return { ok: false, tombstone: null, reason: already ? 'already erased' : 'unknown eventId' };
        }
        const tombstone = { eventId, erased: true, classification: 'TRACE_ONLY', advisoryOnly: true, grantsAuthority: false };
        this.store[idx] = tombstone;
        return { ok: true, tombstone, reason: 'ok' };
    }
    /**
     * Erasure-honest verification: an erasure is HONEST iff a content-free tombstone exists for `eventId`, NO live
     * (non-erased) event for that id remains, and the whole store still audits clean (no residue). This is the trace
     * analogue of the memory tombstone: content-free audit kept, no plaintext returned again.
     */
    verifyErasure(eventId) {
        const tomb = this.store.find((e) => e.eventId === eventId && 'erased' in e);
        if (!tomb)
            return { honest: false, reason: 'no tombstone for eventId' };
        // A content-free tombstone carries ONLY the audit fields — never a content field.
        const contentKeys = Object.keys(tomb).filter((k) => !['eventId', 'erased', 'classification', 'advisoryOnly', 'grantsAuthority'].includes(k));
        if (contentKeys.length > 0)
            return { honest: false, reason: `tombstone retained content: ${contentKeys.join(',')}` };
        if (this.store.some((e) => e.eventId === eventId && !('erased' in e))) {
            return { honest: false, reason: 'a live copy of the erased trace still exists' };
        }
        const a = this.audit();
        if (!a.clean)
            return { honest: false, reason: `store residue: ${a.forbiddenFound.join(',')}` };
        return { honest: true, reason: 'ok' };
    }
}
/** HARD: the AURA trace grants no authority — ever. Constant, by construction. */
export function auraTraceGrantsAuthority() {
    return false;
}
