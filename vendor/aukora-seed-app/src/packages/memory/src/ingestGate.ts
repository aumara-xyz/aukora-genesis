// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * INGEST QUALIFICATION (R56) — a pure, content-free gate over a memory record's SELF-ATTESTED consent/provenance
 * at the PUBLIC ingest boundary.
 *
 * `validateMemoryRecord` proves a record's SHAPE (consent is one of the enum, provenance is a bounded string) and
 * its content-address, but not its AUTHENTICITY. A public/untrusted caller can therefore self-attest
 * `consent: 'owner-only'` and a forged `provenance` and have it enter canonical memory as if it came from the
 * owner's own hand. This gate closes that at the door:
 *   - `owner-only` — the OWNER-TRUST claim — REQUIRES a valid door/service capability. Without it the record is
 *     REFUSED (content-free): a public caller can never forge owner-only memory.
 *   - `private` / `shared` are admitted (the organism's own scoping, not an owner-trust claim), but the
 *     self-attested `provenance` is QUARANTINED to a content-free `untrusted-external` marker so an untrusted
 *     source cannot forge a trusted lineage. The scope itself is preserved (no visibility downgrade of a legit
 *     private memory).
 *   - a valid capability (the trusted door path) preserves the full attestation.
 *
 * The capability is VERIFIED by the caller (Node runtime, out-of-band secret) and passed here as a boolean — this
 * module holds no secret and mints no authority. The TRUSTED path (the internal mutation, unreachable by a
 * client) preserves the attested consent/provenance; only the untrusted public boundary is gated.
 */
import type { ConsentScope } from './envelope.js';

/** The content-free provenance stamped over an untrusted (capability-less) open ingest. */
export const UNTRUSTED_PROVENANCE = 'untrusted-external' as const;

/** `owner-only` is the OWNER-TRUST claim — the only scope a public caller may not forge without a capability. */
export function consentRequiresCapability(consent: unknown): boolean {
  return consent === 'owner-only';
}

export type IngestQualification =
  | { readonly decision: 'accept-trusted' }
  | { readonly decision: 'refuse'; readonly reasonClass: string }
  | { readonly decision: 'quarantine'; readonly consent: ConsentScope; readonly provenance: string };

/**
 * Qualify a public ingest by its self-attested `consent` and whether the caller presented a valid capability.
 * A valid capability (the trusted door) preserves the full attestation. Without it: `owner-only` is REFUSED;
 * `private`/`shared` are admitted with the scope preserved but the self-attested provenance quarantined; an
 * unknown/malformed consent falls back to `shared` (fail-closed).
 */
export function qualifyMemoryIngest(input: { readonly consent: unknown; readonly capabilityValid: boolean }): IngestQualification {
  if (input.capabilityValid) return { decision: 'accept-trusted' };
  if (input.consent === 'owner-only') return { decision: 'refuse', reasonClass: 'owner-only-ingest-requires-capability' };
  const scope: ConsentScope = input.consent === 'private' || input.consent === 'shared' ? input.consent : 'shared';
  return { decision: 'quarantine', consent: scope, provenance: UNTRUSTED_PROVENANCE };
}

/** HARD: qualification grants no authority — it only refuses or downgrades an untrusted self-attestation. */
export function ingestGateGrantsAuthority(): false {
  return false;
}
