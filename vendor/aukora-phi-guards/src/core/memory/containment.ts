// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Advisory-containment contract (pure predicates).
 *
 * The negative-space complement of the authority core: evidence of any modality is ADVISORY, never AUTHORITY.
 * Unknown / unreadable / non-finite / out-of-bounds representation is QUARANTINE, not trust; a payload must be
 * decoded to a deterministic human-readable audit summary before it may be displayed; a leaked key is an
 * INCIDENT (raise quarantine), never a capability. Registration buys readability, never authority.
 *
 * This module is PURE classification. It is not a codec, decoder, timing writer, or effect path, and it holds
 * no channel-construction detail. It only decides "advisory" vs "quarantine" and always answers
 * "does this grant authority?" with false. Portable: no I/O, no clock, no randomness, no imports.
 *
 * PROVENANCE: extracted from donor apps/symbiote/core/src/evidenceAuthorityGuard.ts
 * (aukora-kernel commit b441edc4, blob 89813fa19fac2da9a08afae3e954f249eb91e436),
 * function bodies preserved verbatim; internal codenames removed for the public package.
 */

export type EvidenceDisposition = 'readable_advisory' | 'quarantine';

export interface EvidenceClassification {
  disposition: EvidenceDisposition;
  /** Structurally false — evidence of any modality never grants authority. */
  grantsAuthority: false;
  reason: string;
}

/** Whole-module authority guard (matches the kernel primitive idiom): this contract grants no authority. */
export function advisoryContainmentGrantsAuthority(): false {
  return false;
}

/** Evidence NEVER grants authority. Constant, by construction. */
export function evidenceGrantsAuthority(): false {
  return false;
}

/** Timing is evidence, never permission — perturbing it may move advisory state, never the authority bit. */
export function timingGrantsAuthority(): false {
  return false;
}

export interface EvidenceReadability {
  /** Can the payload be reduced to a deterministic, human-readable audit summary? (decode-to-audit) */
  hasAuditSummary: boolean;
  /** Is the representation / codebook registered and known? Unknown provenance = untrusted. */
  codebookKnown: boolean;
  /** Free of NaN / Infinity / non-finite markers? */
  finite: boolean;
  /** Within declared size / dimension bounds? */
  withinBounds: boolean;
}

function quarantine(reason: string): EvidenceClassification {
  return { disposition: 'quarantine', grantsAuthority: false, reason };
}

/**
 * Classify an evidence payload. Anything that cannot be decoded to a human-readable audit summary, or whose
 * codebook is unknown, or that is non-finite / out of bounds, becomes QUARANTINE — it never enters the trusted
 * advisory flow. A readable payload is at most "readable_advisory" — still never authority.
 */
export function classifyEvidence(r: EvidenceReadability): EvidenceClassification {
  if (!r.hasAuditSummary) return quarantine('untranslatable: no decode-to-audit summary');
  if (!r.codebookKnown) return quarantine('unknown codebook / unregistered representation');
  if (!r.finite) return quarantine('non-finite evidence markers (NaN/Infinity)');
  if (!r.withinBounds) return quarantine('out-of-bounds evidence (size/dimension)');
  return { disposition: 'readable_advisory', grantsAuthority: false, reason: 'readable; advisory only' };
}

/** True only when the payload is safe to DISPLAY as advisory (readable). Quarantine is never displayed as trusted. */
export function mayDisplayAsAdvisory(r: EvidenceReadability): boolean {
  return classifyEvidence(r).disposition === 'readable_advisory';
}

export interface KeyCustodyVerdict {
  /** A leaked key raises quarantine/incident... */
  quarantine: boolean;
  /** ...but it is NEVER a capability. */
  grantsAuthority: false;
  reason: string;
}

/** A leaked key is an incident, not a capability. Leaked -> quarantine; never grants authority either way. */
export function keyCustodyVerdict(leaked: boolean): KeyCustodyVerdict {
  return leaked
    ? { quarantine: true, grantsAuthority: false, reason: 'key-custody failure: incident raised, no capability granted' }
    : { quarantine: false, grantsAuthority: false, reason: 'key custody intact; still not a grantable authority' };
}

/**
 * Confidence / opacity is NEVER authorization. A perfect score on an opaque or unreadable summary grants
 * nothing and cannot upgrade a quarantine. Confidence is advisory display, orthogonal to both the authority
 * bit and the readability disposition. Constant false by construction.
 */
export function confidenceGrantsAuthority(_confidence: number): false {
  return false;
}

export interface EvidenceBundle {
  glyph?: unknown;
  timing?: unknown;
  latent?: unknown;
  voice?: unknown;
  confidence?: number;
}

/**
 * Strip-neutral replay: the authority bit is CONSTANT over any evidence bundle. Dropping all evidence yields a
 * byte-identical verdict — evidence can never be the thing that opens the gate. Always
 * `{ grantsAuthority: false }`, independent of the input.
 */
export function authorityOverEvidenceBundle(_bundle: EvidenceBundle): { grantsAuthority: false } {
  return { grantsAuthority: false };
}

/** Display is presentation of a decoded audit summary — never authority. Constant. */
export function displayGrantsAuthority(): false {
  return false;
}

export interface DecodeAttempt {
  /** Did decoding complete? */
  decoded: boolean;
  /** The deterministic, human-readable audit summary produced by the decode. */
  auditSummary?: string;
  /** Did the decoder throw / fail internally? A failed decoder is quarantine, never passthrough. */
  threwDuringDecode?: boolean;
}

/**
 * Decode-to-audit before display: nothing reaches display without a completed decode to a human-readable audit
 * summary, and a decoder failure quarantines rather than passing raw payload through. A decoded payload is at
 * most "readable_advisory" — display never grants authority.
 */
export function decodeToAuditVerdict(a: DecodeAttempt): EvidenceClassification {
  if (a.threwDuringDecode) return quarantine('decoder failure is quarantine, not passthrough');
  if (!a.decoded || !a.auditSummary) return quarantine('no decode-to-audit summary before display');
  return { disposition: 'readable_advisory', grantsAuthority: false, reason: 'decoded to audit summary; display is advisory only' };
}

/**
 * A signed gate crossing is required before any effect: an effect that skipped the audit/signature crossing
 * carries no authority, ever. The real crossing lives in the authority core; this constant exists so the rest
 * of the organism has one defensive place to ask. Deliberately NOT a permit function.
 */
export function unauditedEffectGrantsAuthority(): false {
  return false;
}

export interface SupplyProvenance {
  /** Is the representation / codebook / artifact in the governed registry? */
  registered: boolean;
  /** Digest check against the registry entry: true = intact, false = tampered, null = not applicable. */
  digestMatches: boolean | null;
}

/** Being registered buys readability, never authority. Constant. */
export function registrationGrantsAuthority(): false {
  return false;
}

/**
 * Supply-chain law (the supply side of "unknown representation is QUARANTINE, not trust"): an unregistered
 * representation/artifact is quarantine; a registered artifact that fails its digest check is quarantine
 * (registration does not immunize tampering); intact registered supply is at most advisory.
 */
export function supplyChainVerdict(s: SupplyProvenance): EvidenceClassification {
  if (!s.registered) return quarantine('unregistered representation/artifact');
  if (s.digestMatches === false) return quarantine('registered artifact fails digest check (tamper)');
  return { disposition: 'readable_advisory', grantsAuthority: false, reason: 'registered supply; advisory only — registration is never authority' };
}
