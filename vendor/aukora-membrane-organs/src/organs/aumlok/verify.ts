// φ · ceremony/verify.ts — the phrase's verification half
//
// ══ TRANSPLANTED FROM aukora-one/ui/ceremony/verify.mjs ══
//
// Which was itself a mechanical port of the owner's `core/src/aumlokBindCeremony.ts`. Types restored;
// nothing else changed.
//
// It lives apart from `phrase.ts` because the donor keeps that separation and says why: *"This module
// GENERATES ONLY. It writes nothing, verifies nothing, and grants nothing."*
//
// ══ THREE THINGS AN IMITATION GOT WRONG, EACH OF THEM SECURITY-RELEVANT ══
//
// The donor's header records them, and they are the reason this file is a transplant rather than a
// reimplementation. A from-scratch version:
//
//   1. fingerprinted the SIX-word tail. The donor fingerprints all SEVEN tokens, and states outright
//      that the tail alone must not match.
//   2. salted with the stable public `genesisRef`. The donor uses a FRESH RANDOM salt per write, so two
//      nodes with the same phrase — and the same node across a rotation — never share a fingerprint.
//   3. compared word-by-word with `===` and an early return, which leaks position through timing. The
//      donor uses `timingSafeEqual`.
//
// None of those three would have failed a test the imitation's author wrote. All three are the donor
// being careful in ways an imitation does not know to be careful. That is the whole argument for
// bringing a proven file over instead of writing a fresh one, and it is why the tests came with it.
//
// ══ WHAT THIS FILE IS NOT ══
//
// It is not a key derivation. `scryptHex` runs scrypt over the phrase with keyLen 32, which LOOKS like
// one; measured, its output is only ever compared by `safeEqualHex`, never used to encrypt or wrap.
// `recovery.ts` states the consequence that follows from that plainly, including the uncomfortable half:
// a sealed record of a 15-bit phrase is recoverable by enumeration, so "sealed" must not be read as
// "confidential".

import { createHash, timingSafeEqual, randomBytes, scryptSync } from 'node:crypto';

/** `aumlokBindCeremony.ts:39` — seven, and it is a named constant for a reason. */
export const BIND_PHRASE_WORDS = 7;

/** A phrase sealed for storage. v1 is the salted sha256; v2 is scrypt and is what is written today. */
export type SealedPhrase =
  | { version: 'v1'; saltHex: string; sha256Hex: string }
  | { version: 'v2'; saltHex: string; hashHex: string; N: number; r: number; p: number };

/**
 * lowercase, trim, any run of spaces/underscores/dashes → one dash — so "Amber Otter" matches
 * "amber-otter".
 *
 * (The donor's own comment, verbatim. This is why the ceremony can accept a phrase typed with spaces
 * even though the canonical form is dash-joined: one canonicalizer, applied to both sides.)
 */
export function normalizePhrase(s: unknown): string {
  return String(s ?? '').toLowerCase().trim().replace(/[\s_-]+/g, '-');
}

/** `saltedFingerprint` — v1. sha256 over `salt | normalized-seven-tokens`. */
export function saltedFingerprint(saltHex: string, phrase: unknown): string {
  return createHash('sha256').update(`${saltHex}|${normalizePhrase(phrase)}`, 'utf-8').digest('hex');
}

/** `PHRASE_KDF_V2` — the donor's exact parameters. */
export const PHRASE_KDF_V2 = Object.freeze({ N: 1 << 15, r: 8, p: 1, keyLen: 32, maxmem: 128 * 1024 * 1024 });

export function scryptHex(
  phrase: unknown,
  saltHex: string,
  N: number = PHRASE_KDF_V2.N,
  r: number = PHRASE_KDF_V2.r,
  p: number = PHRASE_KDF_V2.p,
): string {
  return scryptSync(normalizePhrase(phrase), Buffer.from(saltHex, 'hex'), PHRASE_KDF_V2.keyLen,
    { N, r, p, maxmem: PHRASE_KDF_V2.maxmem }).toString('hex');
}

/** Constant-time hex compare. Length mismatch short-circuits, contents do not. */
export function safeEqualHex(a: unknown, b: unknown): boolean {
  const ab = Buffer.from(String(a), 'utf-8');
  const bb = Buffer.from(String(b), 'utf-8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** A fresh salt per write. Never the genesis reference, never reused. */
export function newSaltHex(): string { return randomBytes(16).toString('hex'); }

/**
 * Seal a phrase for storage: scrypt v2 with a fresh salt.
 *
 * Returns only what a receipt may carry. The phrase itself is not returned, not logged, and not
 * retained by this function.
 */
export function sealPhrase(phrase: string): SealedPhrase {
  const saltHex = newSaltHex();
  return {
    version: 'v2',
    saltHex,
    hashHex: scryptHex(phrase, saltHex),
    N: PHRASE_KDF_V2.N, r: PHRASE_KDF_V2.r, p: PHRASE_KDF_V2.p,
  };
}

/** `verifyPhraseAgainstFingerprint` — both stored shapes, constant-time. */
export function verifyPhrase(typedPhrase: unknown, sealed: unknown): boolean {
  if (!sealed || typeof sealed !== 'object') return false;
  const s = sealed as Partial<Record<string, unknown>>;
  if (s.version === 'v1') {
    return safeEqualHex(saltedFingerprint(String(s.saltHex ?? ''), typedPhrase), s.sha256Hex);
  }
  if (s.version === 'v2') {
    return safeEqualHex(
      scryptHex(typedPhrase, String(s.saltHex ?? ''), Number(s.N), Number(s.r), Number(s.p)),
      s.hashHex,
    );
  }
  return false;
}

/** Verifying a phrase grants nothing. In aukora-one the Ed25519 key signs; here the seam decides. */
export function verifyGrantsAuthority(): boolean {
  return false;
}
