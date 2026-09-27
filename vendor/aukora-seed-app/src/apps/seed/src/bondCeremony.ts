// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK Bond/Bind Ceremony — the human/root Markov blanket made visible. A CEREMONY/BOUNDARY layer, NOT a live
 * apply lane, NOT authority.
 *
 *   phrase             = symbolic memory / ceremony   (observer-visible; NEVER authority)
 *   voice              = presence witness only        (advisory; voiceIsAuthority ALWAYS false)
 *   public fingerprint = the pinned boundary          (public material only)
 *   private key        = OUTSIDE the ceremony, owner-held (NEVER in this module / artifact)
 *   signature          = the ONLY lawful crossing     (verified by the hybrid kernel, not produced here)
 *
 * The circle glows when you speak; it opens only when you sign. Reaching `ready_for_signature` means the ceremony
 * is complete and a SIGNATURE is now required — it grants nothing on its own.
 *
 * PROVENANCE (WAVE 2): ported from the donor `core/src/aumlokBondCeremony.ts` (aukora-symbiote, 24Z / ABB-001).
 * The state machine (unbound → phrase_revealed → public_fingerprint_pinned → presence_witnessed →
 * ready_for_signature), the one-time phrase reveal, the anti-replay voice challenge, the forbidden-material
 * sanitization, and the N_t/B_t/A_t shadow boundary (visible projection → advisory bond state → legal authority)
 * are preserved. DOCUMENTED ADAPTATION: the donor's A_t hinge `legalAuthorityFromSignature` verified an ML-DSA
 * Convex receipt head via `verifyCanonicalReceiptHead`; here it is replaced by `legalAuthorityFromPromotion`, which
 * routes through the current HYBRID kernel verifier `verifyOwnerPromotion` ([[aumlokGate]]). Every other law is
 * carried over. PURE: hashing only (no Convex, no network, no key generation, no raw audio, no biometric capture).
 */
import { createHash } from 'node:crypto';
import { verifyOwnerPromotion, type OwnerBinding } from './aumlokGate.js';
import type { AumlokAuthorityRootV2, SignedPromotionV2 } from '@aukora/kernel/schemas';

export type AumlokBondState =
  | 'unbound'                    // boundary unformed
  | 'phrase_revealed'           // phrase remembered (revealed once; never persisted plaintext)
  | 'public_fingerprint_pinned' // the public boundary is pinned
  | 'presence_witnessed'        // a voice/presence challenge was witnessed (advisory only)
  | 'ready_for_signature';      // ceremony complete — a SIGNATURE is now required (grants nothing yet)

export type VoiceLivenessMode = 'mock' | 'local_microphone_future' | 'disabled';

export interface VoicePresenceWitness {
  /** Human-readable fresh challenge, e.g. "Speak key-word #3, then the number 4827". Public, advisory. */
  readonly transcriptChallenge: string;
  /** Hash of the EXPECTED spoken response (challenge id + nonce) — NEVER raw audio, NEVER a voiceprint. */
  readonly spokenChallengeHash: string;
  /** Fresh nonce/id bound into the hash — anti-replay (a stale challenge cannot be reused). */
  readonly challengeId: string;
  readonly livenessMode: VoiceLivenessMode;
  /** Whether presence was observed. ADVISORY ONLY — never gates a crossing. */
  readonly witnessed: boolean;
  /** STRUCTURAL INVARIANT: voice can never be authority. */
  readonly voiceIsAuthority: false;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

export interface AumlokBond {
  readonly bondState: AumlokBondState;
  /** Public fingerprint pinned (public hex only — never a private key). Empty until pinned. */
  readonly publicFingerprint: string;
  /** A NON-REVEALING summary of the phrase ceremony — never the raw phrase. */
  readonly phraseWitnessSummary: string;
  /** Whether the one-time reveal has happened (the raw phrase is never stored). */
  readonly phraseRevealedOnce: boolean;
  readonly voicePresenceWitness?: VoicePresenceWitness;
  /** The only lawful crossing is a signature — always required; this ceremony never substitutes for it. */
  readonly signatureRequired: true;
  /** STRUCTURAL INVARIANT: the private key is never in the bond/artifact. */
  readonly privateKeyInArtifact: false;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
  readonly updatedAt: string;
}

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

const HEX = /^[0-9a-f]+$/i;

/** A public fingerprint is short public hex. Reject anything that smells like private key material. */
export function isPublicFingerprint(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  if (!HEX.test(s)) return false;
  // public fingerprints are short (16–64 hex); a 160+ hex blob looks like key material → reject.
  if (s.length < 8 || s.length > 64) return false;
  return true;
}

// ── Ceremony transitions (each returns a NEW bond; none ever grants authority) ──

export function createUnboundBond(now: string): AumlokBond {
  return {
    bondState: 'unbound',
    publicFingerprint: '',
    phraseWitnessSummary: 'no phrase remembered yet',
    phraseRevealedOnce: false,
    signatureRequired: true,
    privateKeyInArtifact: false,
    advisoryOnly: true,
    grantsAuthority: false,
    updatedAt: now,
  };
}

/** Record the one-time phrase reveal. Stores ONLY a non-revealing summary — never the raw phrase. */
export function revealPhrase(bond: AumlokBond, now: string): AumlokBond {
  if (bond.phraseRevealedOnce) {
    // one-time reveal: a second reveal does not re-expose; summary stands.
    return { ...bond, bondState: maxState(bond.bondState, 'phrase_revealed'), updatedAt: now };
  }
  return {
    ...bond,
    bondState: maxState(bond.bondState, 'phrase_revealed'),
    phraseWitnessSummary: 'keyed phrase remembered (anchor + key words spell it); revealed once, not stored',
    phraseRevealedOnce: true,
    updatedAt: now,
  };
}

/** Pin the PUBLIC fingerprint boundary. Throws on anything that isn't a public fingerprint. */
export function pinPublicFingerprint(bond: AumlokBond, fingerprint: string, now: string): AumlokBond {
  if (!isPublicFingerprint(fingerprint)) {
    throw new Error('aumlok_bond_public_fingerprint_invalid (not short public hex — refusing possible key material)');
  }
  return {
    ...bond,
    bondState: maxState(bond.bondState, 'public_fingerprint_pinned'),
    publicFingerprint: fingerprint.toLowerCase(),
    updatedAt: now,
  };
}

/** Witness a voice/presence challenge. ADVISORY ONLY — sets presence, never authority. */
export function witnessVoicePresence(bond: AumlokBond, witness: VoicePresenceWitness, now: string): AumlokBond {
  // structural guard: a witness object must never claim authority.
  if ((witness as { voiceIsAuthority?: unknown }).voiceIsAuthority !== false) {
    throw new Error('aumlok_bond_voice_is_authority_must_be_false');
  }
  return {
    ...bond,
    bondState: maxState(bond.bondState, 'presence_witnessed'),
    voicePresenceWitness: { ...witness, voiceIsAuthority: false, advisoryOnly: true, grantsAuthority: false },
    updatedAt: now,
  };
}

/**
 * Mark the ceremony complete: a signature is now required. REQUIRES the public fingerprint to be pinned (the
 * boundary must exist). Voice presence is optional. This grants NOTHING — it is the glow before the crossing, and
 * the crossing is a signature the hybrid kernel verifies.
 */
export function markReadyForSignature(bond: AumlokBond, now: string): AumlokBond {
  if (!bond.publicFingerprint || !isPublicFingerprint(bond.publicFingerprint)) {
    throw new Error('aumlok_bond_not_ready: public fingerprint must be pinned before signature is requested');
  }
  return { ...bond, bondState: 'ready_for_signature', updatedAt: now };
}

const STATE_ORDER: readonly AumlokBondState[] = [
  'unbound', 'phrase_revealed', 'public_fingerprint_pinned', 'presence_witnessed', 'ready_for_signature',
];
function maxState(a: AumlokBondState, b: AumlokBondState): AumlokBondState {
  return STATE_ORDER.indexOf(a) >= STATE_ORDER.indexOf(b) ? a : b;
}

/** STRUCTURAL: the bond NEVER grants authority — always false, by construction. */
export function bondGrantsAuthority(_bond: AumlokBond): false {
  return false;
}

// ── Voice challenge (mock; anti-replay; no raw audio) ──

/**
 * Build a fresh voice presence challenge. The spokenChallengeHash binds a fresh nonce so a replayed transcript from
 * an earlier challenge cannot be reused. NO raw audio, NO voiceprint, NO biometric. (Donor vector-compatible.)
 */
export function generateVoiceChallenge(
  challengeId: string,
  nonce: string,
  keyWordPosition: number,
  livenessMode: VoiceLivenessMode = 'mock',
): VoicePresenceWitness {
  const pos = Math.max(1, Math.min(6, Math.floor(keyWordPosition))); // positions 1..6 only (never 0)
  const transcriptChallenge = `Speak key-word #${pos}, then the number ${nonce}`;
  const spokenChallengeHash = sha256(`aumlok-voice-challenge|${challengeId}|${nonce}|${pos}`);
  return {
    transcriptChallenge,
    spokenChallengeHash,
    challengeId,
    livenessMode,
    witnessed: false,
    voiceIsAuthority: false,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

// ── Validation + artifact sanitization ──

const FORBIDDEN_BOND_KEYS = [
  'privateKey', 'private_key', 'seed', 'signingSeed', 'signing_seed', 'rawJwk', 'raw_jwk',
  'mnemonic', 'mnemonicSecret', 'bearer', 'bearerToken', 'apiKey', 'api_key',
  'voiceEmbedding', 'voice_embedding', 'rawAudio', 'raw_audio', 'biometricTemplate', 'biometric_template',
  'rawPhrase', 'phrasePlaintext', 'unlockPhrase', 'pop', 'proofOfPossession', 'signedHead',
];

export function validateBond(bond: AumlokBond): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  if (bond.advisoryOnly !== true) violations.push('bond.advisoryOnly must be true');
  if (bond.grantsAuthority !== false) violations.push('bond.grantsAuthority must be false');
  if (bond.signatureRequired !== true) violations.push('bond.signatureRequired must be true');
  if (bond.privateKeyInArtifact !== false) violations.push('bond.privateKeyInArtifact must be false');
  if (!STATE_ORDER.includes(bond.bondState)) violations.push(`bond.bondState invalid: ${bond.bondState}`);

  if (bond.publicFingerprint && !isPublicFingerprint(bond.publicFingerprint)) {
    violations.push('bond.publicFingerprint is not valid public hex (possible key material)');
  }
  // states beyond pinning require a real public fingerprint
  if ((bond.bondState === 'public_fingerprint_pinned' || bond.bondState === 'ready_for_signature') && !bond.publicFingerprint) {
    violations.push(`bond.bondState=${bond.bondState} but no public fingerprint pinned`);
  }

  if (bond.voicePresenceWitness) {
    const v = bond.voicePresenceWitness;
    if (v.voiceIsAuthority !== false) violations.push('voicePresenceWitness.voiceIsAuthority must be false');
    if (v.advisoryOnly !== true) violations.push('voicePresenceWitness.advisoryOnly must be true');
    if (v.grantsAuthority !== false) violations.push('voicePresenceWitness.grantsAuthority must be false');
  }

  // forbidden material must never appear anywhere in the bond object
  const json = JSON.stringify(bond);
  for (const k of FORBIDDEN_BOND_KEYS) {
    if (Object.prototype.hasOwnProperty.call(bond, k) || new RegExp(`"${k}"\\s*:`).test(json)) {
      violations.push(`forbidden key present in bond: ${k}`);
    }
  }
  if (/sk-or-[a-zA-Z0-9_-]{12,}/.test(json) || /sk-[a-zA-Z0-9]{16,}/.test(json)) violations.push('API key pattern in bond');
  if (/-----BEGIN/.test(json)) violations.push('PEM/key block in bond');
  if (/\b[a-f0-9]{160,}\b/i.test(json)) violations.push('possible long key material in bond');

  return { valid: violations.length === 0, violations };
}

export interface AumlokBondAdvisoryState {
  readonly bondState: AumlokBondState;
  readonly publicFingerprint: string;
  readonly phraseWitnessSummary: string;
  readonly phraseRevealedOnce: boolean;
  voicePresenceWitness?: {
    readonly transcriptChallenge: string;
    readonly challengeId: string;
    readonly livenessMode: VoiceLivenessMode;
    readonly witnessed: boolean;
    readonly voiceIsAuthority: false;
    readonly advisoryOnly: true;
    readonly grantsAuthority: false;
  };
  readonly signatureRequired: true;
  readonly privateKeyInArtifact: false;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

/** Sanitize a bond for the artifact: public fields only; voice loses the hash, keeps only the public challenge. */
export function sanitizeBondForArtifact(bond: AumlokBond): AumlokBondAdvisoryState {
  const out: AumlokBondAdvisoryState = {
    bondState: bond.bondState,
    publicFingerprint: bond.publicFingerprint,
    phraseWitnessSummary: bond.phraseWitnessSummary,
    phraseRevealedOnce: bond.phraseRevealedOnce,
    signatureRequired: true,
    privateKeyInArtifact: false,
    advisoryOnly: true,
    grantsAuthority: false,
  };
  if (bond.voicePresenceWitness) {
    const v = bond.voicePresenceWitness;
    out.voicePresenceWitness = {
      transcriptChallenge: v.transcriptChallenge,
      challengeId: v.challengeId,
      livenessMode: v.livenessMode,
      witnessed: v.witnessed,
      voiceIsAuthority: false,
      advisoryOnly: true,
      grantsAuthority: false,
    };
  }
  return out;
}

/** The bond is NEVER apply-eligible — only a hybrid-verified signature crosses. */
export function isBondApplyEligible(_bond: AumlokBond): { eligible: false; reasons: string[] } {
  return { eligible: false, reasons: ['bond ceremony grants no authority — a hybrid-verified signature is the only crossing'] };
}

// ── ABB-001: projection-only shadow boundary ──
// Three layers kept strictly separate:
//   N_t = scrubbed observer-visible ceremony projection
//   B_t = f(N_t)                             advisory bond state (depends ONLY on the visible projection)
//   A_t = 1[Verify(sigma,pk,c)=1]            legal authority (depends ONLY on a real cryptographic verifier)
// Laws: VerifierAbsent → A_t=0 ; Forbidden(N_t) → reject + A_t=0 ; N^(1)=N^(2) → B^(1)=B^(2) ;
// a hidden non-authority shift moves neither B_t nor A_t. Ceremony LANGUAGE ("approved") never reaches A_t.

export interface CeremonyProjection {
  readonly bondState: AumlokBondState;
  readonly publicFingerprint: string;
  readonly phraseRevealedOnce: boolean;
  readonly phraseWitnessSummary: string;
  readonly voicePublicChallenge: string | null;
  readonly voiceWitnessed: boolean;
  readonly voiceLivenessMode: VoiceLivenessMode | null;
}

/**
 * N_t — derive the scrubbed, VISIBLE-ONLY ceremony projection. Excludes hashes, timestamps, and any hidden field,
 * so two bonds that differ only in hidden/non-visible state yield an identical projection.
 */
export function deriveCeremonyProjection(bond: AumlokBond): CeremonyProjection {
  return {
    bondState: bond.bondState,
    publicFingerprint: bond.publicFingerprint,
    phraseRevealedOnce: bond.phraseRevealedOnce,
    phraseWitnessSummary: bond.phraseWitnessSummary,
    voicePublicChallenge: bond.voicePresenceWitness ? bond.voicePresenceWitness.transcriptChallenge : null,
    voiceWitnessed: bond.voicePresenceWitness ? bond.voicePresenceWitness.witnessed : false,
    voiceLivenessMode: bond.voicePresenceWitness ? bond.voicePresenceWitness.livenessMode : null,
  };
}

// The ONLY keys a scrubbed visible projection may carry (allowlist > denylist — an unknown key is rejected, so
// nothing can be smuggled into N_t even if it isn't on a forbidden denylist).
const ALLOWED_PROJECTION_KEYS = new Set<string>([
  'bondState', 'publicFingerprint', 'phraseRevealedOnce', 'phraseWitnessSummary',
  'voicePublicChallenge', 'voiceWitnessed', 'voiceLivenessMode',
]);

/** Forbidden(N_t): reject a projection carrying any non-allowlisted / private / authority-bearing field. */
export function rejectForbiddenProjection(projection: unknown): { ok: boolean; reason: string | null } {
  if (!projection || typeof projection !== 'object') return { ok: false, reason: 'projection_not_object' };
  const p = projection as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    if (!ALLOWED_PROJECTION_KEYS.has(k)) return { ok: false, reason: `projection_carries_unallowed_key:${k}` };
  }
  const json = JSON.stringify(p);
  if (/-----BEGIN/.test(json) || /sk-[a-zA-Z0-9]{16,}/.test(json)) return { ok: false, reason: 'projection_carries_key_material' };
  return { ok: true, reason: null };
}

/** B_t = f(N_t): deterministic advisory bond state from the visible projection. Same N_t → same B_t. */
export function advisoryBondStateFromProjection(projection: CeremonyProjection): AumlokBondState {
  return projection.bondState; // pure function of the visible projection — nothing hidden enters it
}

/**
 * A_t = 1[Verify(hybrid-signature, pinned-root, binding)=1]. The DONOR-adapted authority hinge. Authority is 1 ONLY
 * when the CURRENT hybrid kernel verifier ([[aumlokGate]] `verifyOwnerPromotion`) validates the owner's hybrid
 * (Ed25519 + ML-DSA-65) signature against the EXPLICITLY pinned root AND the exact intent/draft binding. No root /
 * no valid signature / wrong key / wrong binding → 0. Ceremony language never reaches this function; a caller
 * cannot fake it without the owner's out-of-band keys. Total — a malformed receipt fails closed to 0.
 */
export function legalAuthorityFromPromotion(
  receipt: SignedPromotionV2 | null | undefined,
  root: AumlokAuthorityRootV2 | null | undefined,
  binding: OwnerBinding | null | undefined,
  nowMs: number,
): 0 | 1 {
  if (!receipt || !root || !binding) return 0;
  const verdict = verifyOwnerPromotion(receipt, root, binding, nowMs);
  return verdict.valid ? 1 : 0;
}
