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
import { canonicalHash, type CanonicalValue } from '@aukora/kernel/canonical';

export const MEMORY_SCHEMA = 'aukora-memory-v1';

/** Who may see this memory. Owner-only is the tightest; shared the broadest advisory scope. */
export type ConsentScope = 'owner-only' | 'private' | 'shared';
export const CONSENT_SCOPES: readonly ConsentScope[] = ['owner-only', 'private', 'shared'];

/** What kind of thing this memory records. Never authority — only evidence-about. */
export type ProvenanceKind = 'observation' | 'proposal' | 'receipt' | 'reflection' | 'tombstone';
export const PROVENANCE_KINDS: readonly ProvenanceKind[] = ['observation', 'proposal', 'receipt', 'reflection', 'tombstone'];

export interface MemoryRecordV1 {
  readonly schema: typeof MEMORY_SCHEMA;
  /** Content-addressed id = canonicalHash({ content }). */
  readonly recordId: string;
  /** ISO-8601 UTC, caller-supplied (pure: no ambient clock). */
  readonly createdAt: string;
  readonly kind: ProvenanceKind;
  readonly consent: ConsentScope;
  readonly content: string;
  readonly provenance: string;
  /** Load-bearing containment literals — a memory is advisory, never a capability. */
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

const MAX_CONTENT_CHARS = 16_384;
const MAX_PROVENANCE_CHARS = 512;
const RECORD_KEYS: readonly string[] = [
  'schema', 'recordId', 'createdAt', 'kind', 'consent', 'content', 'provenance', 'advisoryOnly', 'grantsAuthority',
];

/** Deterministic content-addressed id (pure; reuses the kernel canonical hash — no second hash implementation). */
export function deriveRecordId(content: string): string {
  return canonicalHash({ content });
}

export interface BuildMemoryInput {
  readonly content: string;
  readonly createdAt: string;
  readonly kind?: ProvenanceKind;
  readonly consent?: ConsentScope;
  readonly provenance?: string;
}

/** Build a well-formed memory record. Pure: id is derived from content, time is supplied by the caller. */
export function buildMemoryRecord(input: BuildMemoryInput): MemoryRecordV1 {
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

function hasExactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Object.keys(o).length !== keys.length) return false;
  if (Reflect.ownKeys(o).length !== keys.length) return false; // reject non-enumerable / symbol smuggling
  for (const k of keys) if (!Object.prototype.hasOwnProperty.call(o, k)) return false;
  return true;
}

/**
 * Re-validate an untrusted value as a memory record. Drop-not-fail: returns null on any deviation (never throws),
 * exact-key closed, bounded, and refuses anything that is not advisory / that claims authority.
 */
export function validateMemoryRecord(x: unknown): MemoryRecordV1 | null {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!hasExactKeys(o, RECORD_KEYS)) return null;
  if (o.schema !== MEMORY_SCHEMA) return null;
  if (typeof o.recordId !== 'string' || !/^[0-9a-f]{64}$/.test(o.recordId)) return null;
  if (typeof o.createdAt !== 'string' || o.createdAt.length === 0 || o.createdAt.length > 40) return null;
  if (typeof o.kind !== 'string' || !PROVENANCE_KINDS.includes(o.kind as ProvenanceKind)) return null;
  if (typeof o.consent !== 'string' || !CONSENT_SCOPES.includes(o.consent as ConsentScope)) return null;
  if (typeof o.content !== 'string' || o.content.length === 0 || o.content.length > MAX_CONTENT_CHARS) return null;
  if (typeof o.provenance !== 'string' || o.provenance.length > MAX_PROVENANCE_CHARS) return null;
  if (o.advisoryOnly !== true) return null;
  if (o.grantsAuthority !== false) return null;
  // content-addressed integrity: the id must match the content
  if (deriveRecordId(o.content) !== o.recordId) return null;
  return o as unknown as MemoryRecordV1;
}

/** A memory grants no authority. Constant, by construction. */
export function memoryGrantsAuthority(): false {
  return false;
}

/**
 * The CONTENT-FREE commitment a memory contributes to the receipt chain.
 *
 * A receipt chain that embedded plaintext could never honour governed forgetting: removing the plaintext would
 * change a chained payload and break every downstream hash. So the chain commits to the content by its
 * content-ADDRESSED id (`recordId = deriveRecordId(content)`) plus metadata — NEVER the plaintext itself. The
 * content is therefore cryptographically bound (the id is `sha256({content})`), yet the separately-stored
 * plaintext can be forgotten later without rewriting or invalidating a single chain link.
 *
 * Defined as a `type` (not an interface) so it carries an implicit index signature and is directly usable as a
 * `receiptChainHash` payload with no cast. Pure and deterministic: same fields ⇒ same commitment, forever.
 */
export type MemoryCommitmentV1 = {
  readonly schema: typeof MEMORY_SCHEMA;
  readonly recordId: string;
  readonly createdAt: string;
  readonly kind: ProvenanceKind;
  readonly consent: ConsentScope;
  readonly provenance: string;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
};

/** The CONTENT-FREE tombstone a governed forget contributes to the chain — an audit that a memory existed and
 * was forgotten, carrying no plaintext. */
export type TombstoneCommitmentV1 = {
  readonly kind: 'tombstone';
  readonly recordId: string;
  readonly at: string;
};

export type MemoryCommitmentInput = {
  readonly recordId: string;
  readonly createdAt: string;
  readonly kind: ProvenanceKind;
  readonly consent: ConsentScope;
  readonly provenance: string;
};

/**
 * Build the canonical content-free memory commitment. Accepts either a full {@link MemoryRecordV1} (the ingest
 * path) or the reconstructed metadata read back from a persisted row (the verify path) — both adapters and the
 * chain verifier derive the SAME commitment from the SAME fields, so there is exactly one chaining law and no
 * clone. `CanonicalValue`-typed, so it hashes with `@aukora/kernel`'s canonical hash unchanged.
 */
export function memoryCommitment(input: MemoryCommitmentInput): MemoryCommitmentV1 {
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
export function tombstoneCommitment(input: { readonly recordId: string; readonly at: string }): TombstoneCommitmentV1 {
  return { kind: 'tombstone', recordId: input.recordId, at: input.at };
}

// Compile-time proof that both commitments are valid `receiptChainHash` payloads (CanonicalValue records) — if
// a future field breaks canonicality, this fails to type-check rather than at runtime.
const _memoryCommitmentIsCanonical: { readonly [key: string]: CanonicalValue } = memoryCommitment({
  recordId: '', createdAt: '', kind: 'observation', consent: 'private', provenance: '',
});
const _tombstoneCommitmentIsCanonical: { readonly [key: string]: CanonicalValue } = tombstoneCommitment({ recordId: '', at: '' });
void _memoryCommitmentIsCanonical;
void _tombstoneCommitmentIsCanonical;
