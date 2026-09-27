// φ · ceremony/recovery.ts — the secret that guards the KEY, and the honest measurement of the phrase
//
// ══ TRANSPLANTED FROM aukora-one/ui/ceremony/recovery.mjs ══
//
// ══ WHY THIS FILE EXISTS: THE RITUAL AND THE SECRET ARE NOT THE SAME THING ══
//
// Issue #133. The ceremony phrase was measured in two repositories by two methods, and a third time by
// exhaustive enumeration rather than sampling:
//
//   anchors                : 18
//   EXACT distinct phrases : 45,248
//   Shannon entropy        : 15.40 bits
//   a 4-digit PIN          : 13.29 bits
//
// `aukora-seed` reported 45,248 / 15.40 by enumerating its own generator. Issue #133 estimated 45,266 by
// Chao1 over 400,000 draws. `test/ceremony-recovery.test.ts` walks every reachable completion and gets
// 45,248 exactly. Three methods, one number — and the exhaustive one is the literal checked in below.
//
// **The phrase is worth about 2.1 bits more than a 4-digit PIN** — roughly four PINs' worth of keyspace,
// not four hundred million.
//
//   BIP-39, 12 words   128 bits
//   Diceware, 6 words   77 bits
//   THIS PHRASE       15.4 bits
//   a 4-digit PIN     13.3 bits
//
// ══ AND THE DESIGN IS NOT WRONG ══
//
// It reads as seven independent words and is not: every token after the anchor is pinned to a specific
// starting letter AND a specific theme row, and most buckets hold three or four candidates. **The
// acrostic is what makes it memorable and it is also what destroys the entropy. Those are the same
// property**, so widening the word lists does not rescue it — ~8 words per letter per theme reaches only
// ~24 bits and the acrostic caps it structurally.
//
// A memorable phrase a human speaks back is the RIGHT shape for an owner ceremony. It is the only
// mechanism in this project that requires a person to be present. The defect was never the phrase; it
// would have been using a 15-bit secret as key-wrapping material.
//
// ══ WHAT THIS MEANS IN φ SPECIFICALLY, WHICH IS NOT WHAT IT MEANT IN THE DONOR ══
//
// aukora-one's ceremony mints an Ed25519 + ML-DSA-65 key pair. φ's mints STANDING — see `vow.ts` and
// `PROVENANCE.md`. So the sentence "the phrase gates the ceremony, this secret gates the key" arrives
// here with its second half unbuilt, because φ has no key to guard.
//
// That is a reason to state the separation more carefully, not less. What φ must never do is let the
// 15-bit phrase be mistaken for the thing that authorizes: it proves a person was present at a ceremony
// someone with the machine started, and `ceremonyClaim()` is the data the surface must quote for that.
// `assertNotPhraseDerived` comes across intact so that when φ does hold key material, the guard is
// already here and already red on the obvious mistake.
//
// ══ WHAT THIS DOES NOT DO ══
//
// It does not wrap anything, because there is nothing here to wrap. This is the shape the wrapping must
// take WHEN it is built, plus a guard that goes red if someone reaches for the phrase instead. Label:
// SPEC_ONLY for the wrapping; IMPLEMENTED for the generator and the guard.
//
// And raising scrypt cost is NOT a fix for the phrase and must never be presented as one. It buys an
// order of magnitude. Fifteen bits stays fifteen bits — an attacker who knows the generator enumerates
// the whole space, and the cost of that is measured in CPU-minutes, not centuries.

import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 256 bits. Not 128 — the cost of the larger secret is that the owner copies a slightly longer string
 * once, and the benefit is that this number never has to be revisited.
 */
export const RECOVERY_BYTES = 32;

/**
 * Characters in the secret the owner actually keeps.
 *
 * 52, because ceil(256 / log2(31)) = 52. The first version emitted 32 and claimed 256 bits; 32
 * characters over a 31-symbol alphabet carry 158.5. The claim now follows the string rather than the
 * other way round.
 */
export const RECOVERY_CHARS = 52;

/** The exact size of the phrase keyspace, enumerated. See the test. */
export const PHRASE_KEYSPACE = 45248;

/**
 * Three different numbers describe this keyspace and they are not interchangeable. The council
 * (deepseek-v4-pro) flagged that 15.40 is not log2(45248), and was right to — these are measured
 * separately:
 *
 *   log2(45,248)   15.47   if every phrase were equally likely
 *   Shannon         15.40   the actual distribution (anchors differ in fanout)
 *   MIN-ENTROPY     14.34   the conservative one, and the only security number
 *
 * Min-entropy is lowest because an attacker does not guess uniformly: the `frosty` anchor has only 1,152
 * completions, so its phrases are the most likely and are tried first. Quoting Shannon here would have
 * been picking the friendliest of three available figures, which is exactly what this module was written
 * to stop.
 */
export const PHRASE_BITS_UNIFORM = 15.47;
export const PHRASE_BITS = 15.40;
export const PHRASE_MIN_ENTROPY = 14.34;

/** For comparison in the UI, so the claim is checkable rather than rhetorical. */
export const REFERENCE_BITS = Object.freeze({
  bip39_12: 128,
  diceware_6: 77,
  ceremonyPhrase: PHRASE_MIN_ENTROPY,
  pin4: 13.29,
});

export class RecoveryError extends Error {
  reasonClass: string;

  constructor(reasonClass: string) {
    // Content-free, like every refusal here: the constructor never receives the offending value, so it
    // cannot echo a secret into a log.
    super(`recovery refused: ${reasonClass}`);
    this.name = 'RecoveryError';
    this.reasonClass = reasonClass;
  }
}

export interface RecoverySecret {
  readonly secret: string;
  readonly bytes: Buffer;
  readonly bits: number;
  readonly chars: number;
  readonly shownOnce: true;
}

/**
 * Mint a recovery secret. `randomBytes` and nothing else.
 *
 * No phrase is accepted as a parameter, and that is deliberate: a function that COULD take one would
 * eventually be called with one. The only way to derive this from the ceremony phrase is to rewrite this
 * function, which is the point.
 *
 * Grouped in fives for transcription, because the owner will copy it by hand and an unbroken
 * 52-character string is where transcription errors live.
 */
export function mintRecoverySecret(): RecoverySecret {
  // ══ THIS FUNCTION CLAIMED 256 BITS AND SHOWED 158 ══
  //
  // Found by the council (gemini-3.6-flash), confirmed by measurement. The first version took 32 random
  // bytes and folded each through `b % 31` into ONE character, then reported `bits: RECOVERY_BYTES * 8`:
  //
  //   input bytes     : 32 = 256 bits of randomBytes
  //   output chars    : 32 over an alphabet of 31
  //   output capacity : 158.5 bits
  //   MODULE CLAIMED  : 256 bits          <- FALSE
  //
  // The entropy is in the STRING THE OWNER KEEPS, not in the bytes that were thrown away producing it.
  // Reporting the input size was the same species of overstatement this entire module exists to correct,
  // shipped inside the correction. That is worth saying plainly rather than quietly patching.
  //
  // Two fixes, both required:
  //   · emit enough characters to actually carry the claim — ceil(256/log2(31)) is 52, and 52 chars
  //     carry 257.6 bits.
  //   · REJECTION-SAMPLE rather than modulo. 256 is not divisible by 31, so `b % 31` gives indices 0-7 a
  //     9/256 chance and 8-30 an 8/256 chance. The bias is small (~0.002 bits/char) but it is free to
  //     remove and a biased generator in a key path is not a thing to leave measured-but-present.
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O/1/I/L
  const LIMIT = 256 - (256 % ALPHABET.length);          // 248 — the unbiased ceiling
  let out = '';
  const drawn: number[] = [];
  while (out.length < RECOVERY_CHARS) {
    for (const b of randomBytes(64)) {
      if (out.length >= RECOVERY_CHARS) break;
      if (b >= LIMIT) continue;                          // reject, do not fold
      out += ALPHABET[b % ALPHABET.length];
      drawn.push(b);
    }
  }
  const grouped = (out.match(/.{1,5}/g) ?? []).join('-');
  return Object.freeze({
    secret: grouped,
    bytes: Buffer.from(drawn),
    // The honest figure: what the STRING carries, not what was drawn to make it.
    bits: Math.floor(RECOVERY_CHARS * Math.log2(ALPHABET.length)),
    chars: RECOVERY_CHARS,
    shownOnce: true as const,
  });
}

/**
 * Refuse a recovery secret that could have come from the ceremony phrase.
 *
 * THE STRUCTURAL HALF OF THE SEPARATION. A comment saying "do not derive this from the phrase" is a
 * wish. This is the check, and `test/ceremony-recovery.test.ts` has watched it fail on the real defect —
 * a secret derived by scrypt from a phrase, which is exactly the shape someone would reach for.
 *
 * It cannot detect every derivation — a keyed hash of the phrase with an unknown key is
 * indistinguishable from random, and this says so rather than pretending otherwise. What it CAN do is
 * refuse the cheap, likely mistakes: a secret that IS the phrase, contains it, or was produced from a
 * keyspace small enough to enumerate.
 */
export function assertNotPhraseDerived(secret: unknown, phrase: unknown): true {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new RecoveryError('recovery-secret-malformed');
  }
  const flat = (s: unknown): string => String(s ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const s = flat(secret);
  const p = flat(phrase);

  // The phrase itself, or the phrase wearing separators.
  if (p.length > 0 && s === p) throw new RecoveryError('recovery-secret-is-the-phrase');
  if (p.length > 0 && s.indexOf(p) !== -1) throw new RecoveryError('recovery-secret-contains-the-phrase');

  // A secret shorter than the phrase keyspace needs cannot carry 256 bits, and is the shape of a
  // truncated derivation.
  if (s.length < 32) throw new RecoveryError('recovery-secret-too-short');
  return true;
}

/**
 * What the ceremony may honestly claim, as data rather than prose, so the UI cannot drift from the
 * measurement.
 *
 * The wording matters and was corrected once already in the donor repository over AURA gold: never write
 * "cannot" where the honest word is "expensive". Here the honest word is neither — 15.4 bits is not
 * expensive. It is cheap, and the ceremony says so.
 */
export function ceremonyClaim() {
  return Object.freeze({
    proves: 'a person was present and knew the phrase',
    doesNotProve: 'cryptographic strength — 14.3 bits of min-entropy, about twice a 4-digit PIN',
    keyspace: PHRASE_KEYSPACE,
    bits: PHRASE_MIN_ENTROPY,
    bitsShannon: PHRASE_BITS,
    bitsUniform: PHRASE_BITS_UNIFORM,
    keyIsProtectedBy: 'a separate 256-bit recovery secret, shown once',
    // Raised by the council (deepseek-v4-pro, gemini-3.6-flash) reading the donor's `verify.mjs:52-55`.
    // They are right about the shape and wrong about the consequence, and both halves are worth stating.
    //
    // `scryptHex` runs scrypt over the phrase with keyLen 32, which LOOKS like key derivation. Measured:
    // `hashHex` has zero uses outside `verify.ts` — it is compared by `safeEqualHex`, never used to
    // encrypt or wrap. So the phrase is not key material.
    //
    // But a 15-bit input makes it a weak FINGERPRINT, and that is a real property nobody had written
    // down: anyone holding a sealed phrase record can enumerate the whole keyspace and recover the
    // phrase. The donor measured the cost at roughly 32 CPU-minutes at scrypt(N=2^15). In aukora-one it
    // unlocked nothing because the keys were in Keychain custody; in φ it unlocks nothing because there
    // is no key. In both, the sealed record is not confidential, and calling it "sealed" should not imply
    // that it is.
    sealedPhraseIsRecoverable: 'yes — ~32 CPU-minutes to enumerate the keyspace against a sealed record',
    grantsAuthority: false,
  });
}

/** Constant-time compare for a typed-back recovery secret. */
export function recoveryMatches(typed: unknown, expected: unknown): boolean {
  const a = Buffer.from(String(typed ?? ''), 'utf8');
  const b = Buffer.from(String(expected ?? ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A ritual is not an authority, and neither is a recovery code. */
export function recoveryGrantsAuthority(): boolean {
  return false;
}
