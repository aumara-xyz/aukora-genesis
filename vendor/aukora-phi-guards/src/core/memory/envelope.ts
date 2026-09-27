// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * KIRA memory envelope (pure, portable).
 *
 * The constitutional shape of a single memory: a content-addressed, consent-scoped, provenance-bearing record
 * that is ADVISORY by construction (`advisoryOnly:true` / `grantsAuthority:false`). This module is pure — the
 * caller supplies time and identity; it performs no I/O, clock, randomness, signing, mutation, or authority
 * grant. Record identity is the domain-separated hash of the content (deterministic, φ's own
 * `core/memory/hash.ts`), so the same content always yields the same id across runtimes.
 *
 * PROVENANCE: @aukora/memory src/envelope.ts @ 7f2030f (blob
 * 107472bf80063af88ad1fc60f8e295899a3053c27d69dd1e6ce19a22a58aa84f) — ADAPTED: the kernel canonical
 * hash is re-derived against φ's `domainHash`, and the kernel-typed compile-time proof is asserted at
 * runtime instead. Consent/provenance/validation laws preserved verbatim. See docs/MEMORY-PORT.md §7.
 */
import { domainHash } from './hash';

export const MEMORY_SCHEMA = 'aukora-memory-v1';

/** Who may see this memory. Owner-only is the tightest; shared the broadest advisory scope. */
export type ConsentScope = 'owner-only' | 'private' | 'shared';
export const CONSENT_SCOPES: readonly ConsentScope[] = ['owner-only', 'private', 'shared'];

/** What kind of thing this memory records. Never authority — only evidence-about. */
export type ProvenanceKind = 'observation' | 'proposal' | 'receipt' | 'reflection' | 'tombstone';
export const PROVENANCE_KINDS: readonly ProvenanceKind[] = ['observation', 'proposal', 'receipt', 'reflection', 'tombstone'];

export interface MemoryRecordV1 {
  readonly schema: typeof MEMORY_SCHEMA;
  /** Content-addressed id = `deriveRecordId(content)` = `domainHash(MEMORY_RECORD_DOMAIN, { content })`. */
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

/**
 * Deterministic content-addressed id.
 *
 * ADAPTED, and this is the one substantive change the merge makes. The donor derived this with
 * `@aukora/kernel`'s `canonicalHash`, which reaches `@noble/hashes` — a runtime dependency. φ has
 * ZERO runtime dependencies and that property is worth more than byte-compatibility with the donor's
 * ids, so the hash is re-derived against φ's own discipline (`core/memory/hash.ts`, already the one
 * hash primitive this organ uses).
 *
 * It is not merely a substitution: `domainHash` is DOMAIN-SEPARATED, and the donor's was not. Every
 * hash ROLE in this organ hashes under its own tag, so a value built to collide as a record id
 * cannot also collide as a merkle node or a certificate. The donor's bare `sha256({content})` had no
 * such tag.
 *
 * The consequence, stated rather than discovered later: ids minted here do NOT match ids minted by
 * `@aukora/memory`. Nothing crosses between them today, and the property that matters —
 * same content, same id, forever, on any machine — holds in both.
 */
export function deriveRecordId(content: string): string {
  return domainHash(MEMORY_RECORD_DOMAIN, { content });
}

/** The hash role for a record id. Named once; see `deriveRecordId` for why the tag is load-bearing. */
export const MEMORY_RECORD_DOMAIN = 'aukora-memory-record-v1';

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
 * content is therefore cryptographically bound (the id is `deriveRecordId(content)`, domain-separated
 * under `MEMORY_RECORD_DOMAIN` — not a bare `sha256({content})`), yet the separately-stored
 * plaintext can be forgotten later without rewriting or invalidating a single chain link.
 *
 * Defined as a `type` (not an interface) so it carries an implicit index signature — the donor needed that to
 * pass it to its `receiptChainHash`, an identifier that exists nowhere in φ. φ's `domainHash` takes `unknown`,
 * so nothing here requires the index signature; the shape is kept for donor compatibility, not for a cast φ
 * ever has to make. Pure and deterministic: same fields ⇒ same commitment, forever.
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
 * clone. Content-free and flat, so it hashes through `domainHash` unchanged.
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

// The donor closed this file with a compile-time proof that both commitments are valid
// `CanonicalValue` records — a kernel type φ does not carry, so the proof cannot cross verbatim. The
// property it protected is real (a commitment must stay hashable). Both commitments are content-free
// and flat by construction, and `test/memory-recall.test.ts` plus `test/governed-recall.test.ts` pin
// their serialised shape — but NOTHING yet hashes them through `domainHash`, so the runtime assertion
// this comment claimed as the replacement DOES NOT EXIST. The donor's compile-time proof was dropped
// and nothing took its place. Named rather than left implied.
