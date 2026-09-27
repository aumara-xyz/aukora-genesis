/**
 * The phrase's verification half. Ported from phi `ceremony/verify.ts`.
 *
 * BYTE-FAITHFUL PORT. Source: `~/aukora-phi/ceremony/verify.ts` @ `a099901ad5a2d623c5343263de6ae5f9994d3159`,
 * sha256 `578d791d1678c970960f8025e58bd3d02c35fa87878368297d6b1ca1d19f464a`. Logic unchanged; TypeScript
 * annotations are gone. See `PROVENANCE-CEREMONY.md`.
 *
 * IT LIVES APART FROM `ceremony-phrase.mjs` BECAUSE THE DONOR KEEPS THAT SEPARATION: *"This module
 * GENERATES ONLY. It writes nothing, verifies nothing, and grants nothing."*
 *
 * THREE THINGS AN IMITATION GOT WRONG, EACH SECURITY-RELEVANT, and this port keeps the donor's
 * answers rather than restating them:
 *   1. it fingerprinted the SIX-word tail; the donor fingerprints all SEVEN tokens and states that the
 *      tail alone must not match;
 *   2. it salted with the stable public `genesisRef`; the donor uses a FRESH RANDOM salt per write, so
 *      two nodes with the same phrase — and the same node across a rotation — never share a fingerprint;
 *   3. it compared with `===` and an early return, leaking position through timing; the donor uses
 *      `timingSafeEqual`.
 *
 * WHAT THIS FILE IS NOT. It is not a key derivation. `scryptHex` runs scrypt with keyLen 32, which
 * LOOKS like one; measured, its output is only ever compared by `safeEqualHex`, never used to encrypt or
 * wrap. `ceremony-recovery.mjs` states the consequence plainly, including the uncomfortable half: a
 * sealed record of a ~14-bit phrase is recoverable by enumeration, so "sealed" must not be read as
 * "confidential".
 *
 * @module @aukora/dsh-plugin-aumlok/ceremony-verify
 */
import { createHash, timingSafeEqual, randomBytes, scryptSync } from 'node:crypto'

/** `aumlokBindCeremony.ts:39` — seven, and it is a named constant for a reason. */
export const BIND_PHRASE_WORDS = 7

/**
 * lowercase, trim, any run of spaces/underscores/dashes → one dash — so "Amber Otter" matches
 * "amber-otter".
 *
 * The donor's own comment, verbatim. This is why the ceremony can accept a phrase typed with spaces
 * even though the canonical form is dash-joined: one canonicalizer, applied to BOTH sides.
 * @param {unknown} s - the phrase as typed.
 * @returns {string} the canonical typed form.
 */
export function normalizePhrase(s) {
  return String(s ?? '').toLowerCase().trim().replace(/[\s_-]+/g, '-')
}

/**
 * `saltedFingerprint` — v1. sha256 over `salt | normalized-seven-tokens`.
 *
 * **THIS IS THE RECOVERY PATH, AND IT IS ALSO THE CHEAPEST PLACE TO CHECK A GUESS (AUMLOK-113).** It hashes
 * seven normalised tokens against a salt, which is exactly what an offline attacker does — **and the salt here
 * is PUBLIC, so there is nothing in this function an attacker does not have.** Reviewer row 8: the root is worth
 * about 34.14 bits, so enumerating the phrase space is a dictionary walk, not a search for a secret.
 *
 * **THE CEILING IS PRINTED ON EVERY CALL RATHER THAN ONCE AT STARTUP**, because a caller that reached this
 * function is a caller holding a phrase and asking whether it is the right one — **which is the moment the
 * question "how guessable is this" is actually being asked.**
 */
export function saltedFingerprint(saltHex, phrase) {
  console.log('CEILING: ROOT_KEY_OFFLINE_GUESSABLE — about 34.14 bits from the seven words plus a PUBLIC '
    + 'handle, public salt, roughly 1 second per guess. This check is the same arithmetic an offline attacker '
    + 'runs, and the salt is not a secret. The acrostic stays; what it unlocks is being redesigned.')
  return createHash('sha256').update(`${saltHex}|${normalizePhrase(phrase)}`, 'utf-8').digest('hex')
}

/** `PHRASE_KDF_V2` — the donor's exact parameters. */
export const PHRASE_KDF_V2 = Object.freeze({ N: 1 << 15, r: 8, p: 1, keyLen: 32, maxmem: 128 * 1024 * 1024 })

/** @returns {string} the scrypt hash of the normalized phrase, hex. */
export function scryptHex(phrase, saltHex, N = PHRASE_KDF_V2.N, r = PHRASE_KDF_V2.r, p = PHRASE_KDF_V2.p) {
  return scryptSync(normalizePhrase(phrase), Buffer.from(saltHex, 'hex'), PHRASE_KDF_V2.keyLen,
    { N, r, p, maxmem: PHRASE_KDF_V2.maxmem }).toString('hex')
}

/** Constant-time hex compare. Length mismatch short-circuits, contents do not. */
export function safeEqualHex(a, b) {
  const ab = Buffer.from(String(a), 'utf-8')
  const bb = Buffer.from(String(b), 'utf-8')
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** A fresh salt per write. Never the genesis reference, never reused. */
export function newSaltHex() { return randomBytes(16).toString('hex') }

/**
 * Seal a phrase for storage: scrypt v2 with a fresh salt.
 *
 * Returns only what a receipt may carry. The phrase itself is not returned, not logged, and not
 * retained by this function.
 * @param {string} phrase - the phrase as typed.
 * @returns {{version: 'v2', saltHex: string, hashHex: string, N: number, r: number, p: number}} the seal.
 */
export function sealPhrase(phrase) {
  const saltHex = newSaltHex()
  return {
    version: 'v2',
    saltHex,
    hashHex: scryptHex(phrase, saltHex),
    N: PHRASE_KDF_V2.N, r: PHRASE_KDF_V2.r, p: PHRASE_KDF_V2.p,
  }
}

/** `verifyPhraseAgainstFingerprint` — both stored shapes, constant-time. */
export function verifyPhrase(typedPhrase, sealed) {
  if (!sealed || typeof sealed !== 'object') return false
  const s = sealed
  if (s.version === 'v1') {
    return safeEqualHex(saltedFingerprint(String(s.saltHex ?? ''), typedPhrase), s.sha256Hex)
  }
  if (s.version === 'v2') {
    return safeEqualHex(
      scryptHex(typedPhrase, String(s.saltHex ?? ''), Number(s.N), Number(s.r), Number(s.p)),
      s.hashHex,
    )
  }
  return false
}

/** Verifying a phrase grants nothing. In aukora-one the Ed25519 key signs; here the seam decides. */
export function verifyGrantsAuthority() {
  return false
}
