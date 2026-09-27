// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * KIRA memory envelope (pure, portable).
 *
 * The constitutional shape of a single memory: a content-addressed, consent-scoped, provenance-bearing record
 * that is ADVISORY by construction (`advisoryOnly:true` / `grantsAuthority:false`). This module is pure — the
 * caller supplies time and identity; it performs no I/O, clock, randomness, signing, mutation, or authority
 * grant. Record identity is the canonical hash of the content (deterministic, reused from @aukora/kernel), so
 * the same content always yields the same id across runtimes.
 *
 * PROVENANCE: distilled from donor apps/symbiote/core/src/coreMemoryEnvelope.ts (aukora-kernel b441edc4),
 * node:crypto replaced by the kernel canonical hash; consent/provenance/validation laws preserved.
 */
import { canonicalHash } from '../../../../../authority/lib/canonical.js';
export const MEMORY_SCHEMA = 'aukora-memory-v1';
export const CONSENT_SCOPES = ['owner-only', 'private', 'shared'];
export const PROVENANCE_KINDS = ['observation', 'proposal', 'receipt', 'reflection', 'tombstone'];
const MAX_CONTENT_CHARS = 16_384;
const MAX_PROVENANCE_CHARS = 512;
const RECORD_KEYS = [
    'schema', 'recordId', 'createdAt', 'kind', 'consent', 'content', 'provenance', 'advisoryOnly', 'grantsAuthority',
];
/** Deterministic content-addressed id (pure; reuses the kernel canonical hash — no second hash implementation). */
export function deriveRecordId(content) {
    return canonicalHash({ content });
}
/** Build a well-formed memory record. Pure: id is derived from content, time is supplied by the caller. */
export function buildMemoryRecord(input) {
    return {
        schema: MEMORY_SCHEMA,
        recordId: deriveRecordId(input.content),
        createdAt: input.createdAt,
        kind: input.kind ?? 'observation',
        consent: input.consent ?? 'private',
        content: input.content,
        provenance: input.provenance ?? 'unspecified',
        advisoryOnly: true,
        grantsAuthority: false,
    };
}
function hasExactKeys(o, keys) {
    if (Object.keys(o).length !== keys.length)
        return false;
    if (Reflect.ownKeys(o).length !== keys.length)
        return false; // reject non-enumerable / symbol smuggling
    for (const k of keys)
        if (!Object.prototype.hasOwnProperty.call(o, k))
            return false;
    return true;
}
/**
 * Re-validate an untrusted value as a memory record. Drop-not-fail: returns null on any deviation (never throws),
 * exact-key closed, bounded, and refuses anything that is not advisory / that claims authority.
 */
export function validateMemoryRecord(x) {
    if (x === null || typeof x !== 'object' || Array.isArray(x))
        return null;
    const o = x;
    if (!hasExactKeys(o, RECORD_KEYS))
        return null;
    if (o.schema !== MEMORY_SCHEMA)
        return null;
    if (typeof o.recordId !== 'string' || !/^[0-9a-f]{64}$/.test(o.recordId))
        return null;
    if (typeof o.createdAt !== 'string' || o.createdAt.length === 0 || o.createdAt.length > 40)
        return null;
    if (typeof o.kind !== 'string' || !PROVENANCE_KINDS.includes(o.kind))
        return null;
    if (typeof o.consent !== 'string' || !CONSENT_SCOPES.includes(o.consent))
        return null;
    if (typeof o.content !== 'string' || o.content.length === 0 || o.content.length > MAX_CONTENT_CHARS)
        return null;
    if (typeof o.provenance !== 'string' || o.provenance.length > MAX_PROVENANCE_CHARS)
        return null;
    if (o.advisoryOnly !== true)
        return null;
    if (o.grantsAuthority !== false)
        return null;
    // content-addressed integrity: the id must match the content
    if (deriveRecordId(o.content) !== o.recordId)
        return null;
    return o;
}
/** A memory grants no authority. Constant, by construction. */
export function memoryGrantsAuthority() {
    return false;
}
/**
 * Build the canonical content-free memory commitment. Accepts either a full {@link MemoryRecordV1} (the ingest
 * path) or the reconstructed metadata read back from a persisted row (the verify path) — both adapters and the
 * chain verifier derive the SAME commitment from the SAME fields, so there is exactly one chaining law and no
 * clone. `CanonicalValue`-typed, so it hashes with `@aukora/kernel`'s canonical hash unchanged.
 */
export function memoryCommitment(input) {
    return {
        schema: MEMORY_SCHEMA,
        recordId: input.recordId,
        createdAt: input.createdAt,
        kind: input.kind,
        consent: input.consent,
        provenance: input.provenance,
        advisoryOnly: true,
        grantsAuthority: false,
    };
}
/** Build the canonical content-free tombstone commitment. */
export function tombstoneCommitment(input) {
    return { kind: 'tombstone', recordId: input.recordId, at: input.at };
}
// Compile-time proof that both commitments are valid `receiptChainHash` payloads (CanonicalValue records) — if
// a future field breaks canonicality, this fails to type-check rather than at runtime.
const _memoryCommitmentIsCanonical = memoryCommitment({
    recordId: '', createdAt: '', kind: 'observation', consent: 'private', provenance: '',
});
const _tombstoneCommitmentIsCanonical = tombstoneCommitment({ recordId: '', at: '' });
void _memoryCommitmentIsCanonical;
void _tombstoneCommitmentIsCanonical;
