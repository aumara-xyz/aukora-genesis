// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The proposal-bound approval CHALLENGE — the device-local approve ceremony's anti-CSRF + informed-consent
 * primitive.
 *
 * PROVENANCE (WAVE 2): ported from the donor `core/src/aumlokApproveChallenge.ts` (aukora-symbiote, #105b). The
 * algorithm is preserved byte-for-byte — the 64-word unambiguous wordlist, the modulo-debiased rejection sampler,
 * the 4-word phrase, single-use consumption, short TTL, and the fail-closed verify. DOCUMENTED ADAPTATIONS:
 *   1. the store is keyed by a generic `bindingHash` (the 64-hex candidate payload hash the owner will sign),
 *      not the donor's `proposalHash` — in the current hybrid law the owner signs the canonical candidate payload
 *      (`candidatePayloadHash`), so the challenge binds THAT exact hash;
 *   2. `mintChallenge` takes an optional injected `{phrase,nonce}` generator so tests get deterministic vectors;
 *      production callers omit it and get fresh randomness (unchanged behaviour).
 * No other bytes changed. It signs NOTHING and grants NO authority — it only gates the owner's own gesture: before
 * the local door will route an approval, it mints a fresh, human-readable phrase BOUND to that exact payload hash,
 * shows it to the owner, and requires the owner to re-enter it. A cross-origin page can neither READ (same-origin
 * door, no permissive CORS) nor GUESS (fresh random words) the phrase, so it can never forge an approval — and even
 * the legitimate UI cannot approve without the owner's deliberate re-entry. Single-use + short-TTL ⇒ a captured or
 * replayed phrase is dead. PURE (the in-memory store is passed in) so the door owns the lifetime.
 */
import { randomBytes } from 'node:crypto';

/** A small, unambiguous wordlist (no homophones, no easily-confused pairs) — the phrase is read aloud/typed by a
 *  human, so clarity matters more than entropy density (4 words from 64 ≈ 16M combos, and the phrase is also
 *  single-use, short-TTL, and same-origin-only). Ported verbatim from the donor. */
const WORDS = [
  'amber', 'anchor', 'basin', 'birch', 'cedar', 'cinder', 'cobalt', 'copper',
  'coral', 'delta', 'ember', 'fern', 'flint', 'garnet', 'harbor', 'hazel',
  'indigo', 'ivory', 'jade', 'kelp', 'lark', 'linen', 'lumen', 'maple',
  'marsh', 'meadow', 'mica', 'north', 'ochre', 'onyx', 'opal', 'otter',
  'pebble', 'pewter', 'quartz', 'quill', 'raven', 'reef', 'river', 'rowan',
  'sable', 'sage', 'sand', 'seven', 'shale', 'slate', 'sorrel', 'spruce',
  'stone', 'storm', 'tansy', 'teal', 'thorn', 'tide', 'timber', 'umber',
  'vale', 'verdant', 'walnut', 'willow', 'wren', 'yarrow', 'zephyr', 'zinc',
] as const;
const PHRASE_WORDS = 4;

export interface ApprovalChallenge {
  /** The 64-hex candidate payload hash this challenge is bound to (the exact hash the owner will sign). */
  readonly bindingHash: string;
  readonly phrase: string;
  /** Carried into the signed authorization so the signature is bound to THIS challenge (nonce = consumptionId). */
  readonly nonce: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  used: boolean;
}

export type ChallengeStore = Map<string, ApprovalChallenge>;

export const DEFAULT_CHALLENGE_TTL_MS = 120_000; // 2 minutes — long enough to read + type, short enough to be dead soon

function pickWord(): string {
  // rejection-sample a byte into [0,64) so the 64-word list has no modulo bias (donor algorithm)
  for (;;) {
    const b = randomBytes(1)[0];
    if (b < 256 - (256 % WORDS.length)) return WORDS[b % WORDS.length];
  }
}

/** A fresh human-readable phrase, e.g. "amber-otter-seven-quartz". */
export function generateChallengePhrase(): string {
  return Array.from({ length: PHRASE_WORDS }, pickWord).join('-');
}

export interface ChallengeGen {
  readonly phrase?: string;
  readonly nonce?: string;
}

/**
 * Mint (or replace) the challenge for a candidate payload. Overwrites any prior challenge for the same hash — only
 * the newest is live, so an old phrase left on a stale tab is already dead. Returns the phrase to SHOW the owner
 * (and the nonce/expiry); the store keeps the authoritative copy. `nowMs` is injected for testability; `gen` is an
 * optional deterministic phrase/nonce for tests (omitted ⇒ fresh randomness).
 */
export function mintChallenge(store: ChallengeStore, bindingHash: string, nowMs: number, ttlMs = DEFAULT_CHALLENGE_TTL_MS, gen?: ChallengeGen): ApprovalChallenge {
  const c: ApprovalChallenge = {
    bindingHash,
    phrase: gen?.phrase ?? generateChallengePhrase(),
    nonce: gen?.nonce ?? randomBytes(16).toString('hex'),
    issuedAt: nowMs,
    expiresAt: nowMs + ttlMs,
    used: false,
  };
  store.set(bindingHash, c);
  return c;
}

export type ChallengeVerdict =
  | { readonly ok: true; readonly nonce: string }
  | { readonly ok: false; readonly reason: 'no_challenge' | 'expired' | 'already_used' | 'phrase_mismatch' };

/**
 * Verify the owner's re-entered phrase against the live challenge for a payload, and CONSUME it on success
 * (single-use). Fail-closed: no challenge, expired, already used, or a phrase that does not match EXACTLY all
 * refuse. A refused verify never consumes a good challenge (only a correct, live phrase consumes). We compare full
 * strings, never a prefix. (Donor algorithm, unchanged.)
 */
export function verifyAndConsumeChallenge(store: ChallengeStore, bindingHash: string, phrase: string, nowMs: number): ChallengeVerdict {
  const c = store.get(bindingHash);
  if (!c) return { ok: false, reason: 'no_challenge' };
  if (nowMs > c.expiresAt) { store.delete(bindingHash); return { ok: false, reason: 'expired' }; }
  if (c.used) return { ok: false, reason: 'already_used' };
  if (typeof phrase !== 'string' || phrase !== c.phrase) return { ok: false, reason: 'phrase_mismatch' };
  c.used = true; // consume — a second confirm with the same phrase now refuses 'already_used'
  return { ok: true, nonce: c.nonce };
}

/** Drop expired challenges — the door may call this periodically so the store does not grow. Mutates the store. */
export function sweepExpiredChallenges(store: ChallengeStore, nowMs: number): void {
  for (const [k, c] of store) if (nowMs > c.expiresAt) store.delete(k);
}

/** The challenge grants no authority — constant, by construction. */
export function challengeGrantsAuthority(): false {
  return false;
}
