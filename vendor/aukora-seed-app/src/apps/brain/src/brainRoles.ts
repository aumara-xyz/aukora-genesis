// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Brain roles + the 32B verification gate (R33).
 *
 * The claimed Nebius-hosted 32B may become the REMOTE PRIMARY VOICE/ROUTING brain ONLY after a read-only
 * verification finds ALL FIVE elements: license, model checksum, code digest, image digest, a runnable
 * manifest, and eval evidence (sanitized — no infrastructure IDs ever recorded). Any missing element keeps it
 * UNVERIFIED_OR_PARKED and the role assignment falls back to the deterministic offline provider. A
 * provider-neutral SMALL LOCAL VISION model is retained as an OPTIONAL fallback role. All outputs are advisory;
 * no role grants authority.
 */
import type { ModelTruth } from './brainProvider.js';

const HEX64 = /^[0-9a-f]{64}$/;

/** The sanitized evidence checklist for the 32B claim. Every field is a fact found read-only, or absent. */
export interface Model32bEvidence {
  /** SPDX id or license file sha256 — located, not assumed. */
  readonly license?: string;
  readonly modelChecksumSha256?: string;
  readonly codeSha256?: string;
  readonly imageDigestSha256?: string;
  /** sha256 of a runnable deployment manifest bound to the checksums. */
  readonly runnableManifestSha256?: string;
  /** sha256 of committed eval evidence (results, not a harness alone). */
  readonly evalEvidenceSha256?: string;
}

export interface Model32bVerification {
  readonly truth: ModelTruth;
  readonly missing: readonly string[];
  /** Structurally false — verification performs no launch and no paid inference. */
  readonly launched: false;
  readonly paidInference: false;
}

/** The read-only 32B gate. ALL elements present and well-formed ⇒ AVAILABLE_PRIVATE; else UNVERIFIED_OR_PARKED. */
export function verify32bClaim(evidence: Model32bEvidence): Model32bVerification {
  const missing: string[] = [];
  if (!evidence.license) missing.push('license');
  if (!evidence.modelChecksumSha256 || !HEX64.test(evidence.modelChecksumSha256)) missing.push('model_checksum');
  if (!evidence.codeSha256 || !HEX64.test(evidence.codeSha256)) missing.push('code_digest');
  if (!evidence.imageDigestSha256 || !HEX64.test(evidence.imageDigestSha256)) missing.push('image_digest');
  if (!evidence.runnableManifestSha256 || !HEX64.test(evidence.runnableManifestSha256)) missing.push('runnable_manifest');
  if (!evidence.evalEvidenceSha256 || !HEX64.test(evidence.evalEvidenceSha256)) missing.push('eval_evidence');
  return { truth: missing.length === 0 ? 'AVAILABLE_PRIVATE' : 'UNVERIFIED_OR_PARKED', missing, launched: false, paidInference: false };
}

export type BrainRole =
  | 'remote-primary-voice-routing' // the verified 32B, remote — voice + routing ONLY, advisory
  | 'local-vision-fallback'        // optional small local vision model, provider-neutral, advisory
  | 'deterministic-offline';       // the always-available fail-closed floor

export interface BrainRoleAssignment {
  readonly primary: BrainRole;
  readonly fallbacks: readonly BrainRole[];
  readonly reason: string;
  /** Structurally false — a role assignment grants no authority; all outputs stay advisory. */
  readonly grantsAuthority: false;
}

/**
 * Assign brain roles from the verification result. The 32B becomes remote primary voice/routing ONLY when its
 * verification passed; otherwise the assignment fails closed to deterministic-offline. The small local vision
 * fallback is OPTIONAL (kept when `localVisionAvailable`), always advisory, never primary authority of any kind.
 */
export function assignBrainRoles(v: Model32bVerification, localVisionAvailable: boolean): BrainRoleAssignment {
  const fallbacks: BrainRole[] = localVisionAvailable ? ['local-vision-fallback', 'deterministic-offline'] : ['deterministic-offline'];
  if (v.truth === 'AVAILABLE_PRIVATE') {
    return { primary: 'remote-primary-voice-routing', fallbacks, reason: 'verified: license + checksum + digests + runnable manifest + eval evidence', grantsAuthority: false };
  }
  return { primary: 'deterministic-offline', fallbacks, reason: `fail-closed: 32B unverified (missing: ${v.missing.join(',') || 'none'})`, grantsAuthority: false };
}

/** Role assignment grants no authority. Constant. */
export function brainRolesGrantAuthority(): false {
  return false;
}
