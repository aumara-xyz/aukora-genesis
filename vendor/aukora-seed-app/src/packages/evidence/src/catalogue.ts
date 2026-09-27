// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Frozen secret-detection + confusable catalogue. Pure. catalogueId is derived from the canonical
 * bytes of the table, so any change to it changes the id. R12: adds secret projections (raw, NFC,
 * zero-width-stripped, confusable-skeleton) so a secret cannot hide behind Unicode confusables or
 * zero-width joiners (contract decisions 12–13). Application (omit/refuse) is the validator's job.
 */
import { canonicalBytes } from './canonical';
import { sha256Hex } from './digest';

export interface SecretPatternV1 { readonly id: string; readonly pattern: string; readonly flags: string; }

export interface SecretCatalogueV1 {
  readonly schema: string;
  readonly patterns: readonly SecretPatternV1[];
  // Named bounded linear scanners (not regexes). Listed here so catalogueId binds them too — a scanner
  // change re-derives the id exactly like a pattern change. D4 moved url-userinfo out of `patterns`
  // (its greedy regex was a proven O(n^2) ReDoS) into a bounded linear scanner (see scanUrlUserinfo).
  readonly scanners: readonly string[];
  readonly confusables: Readonly<Record<string, string>>;
  readonly zeroWidth: readonly string[];
}

export const SECRET_CATALOGUE: SecretCatalogueV1 = {
  schema: 'aukora-fu-secret-catalogue-v3',
  patterns: [
    // NOTE (D4 anti-ReDoS): every greedy quantifier that is FOLLOWED by a required token has a bounded upper
    // limit ({m,N}, not {m,}). An unbounded greedy run before a required literal backtracks O(len) at each of
    // O(len) start positions ⇒ O(n^2) on adversarial repeated-prefix input (the same class as the removed
    // url-userinfo regex). Terminal `{m,}` quantifiers (no trailing token) do not backtrack and stay open.
    // The upper bounds are best-effort ceilings (see §13) — a matchable run longer than the bound is missed.
    { id: 'openrouter-key', pattern: 'sk-or-[A-Za-z0-9_\\-]{16,}', flags: 'g' },
    { id: 'openai-key', pattern: 'sk-[A-Za-z0-9]{20,}', flags: 'g' },
    { id: 'aws-access-key-id', pattern: 'AKIA[0-9A-Z]{16}', flags: 'g' },
    { id: 'pem-private-key', pattern: '-----BEGIN [A-Z ]{0,64}PRIVATE KEY-----', flags: 'g' },
    { id: 'env-secret-assign', pattern: '(?:API|SECRET|TOKEN|PASSWORD|PRIVATE)[A-Z0-9_]{0,64}\\s*=\\s*\\S{8,4096}', flags: 'gi' },
    { id: 'github-token', pattern: '(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}', flags: 'g' },
    { id: 'slack-token', pattern: 'xox[baprs]-[A-Za-z0-9-]{10,}', flags: 'g' },
    { id: 'google-api-key', pattern: 'AIza[A-Za-z0-9_\\-]{35}', flags: 'g' },
    { id: 'stripe-key', pattern: 'sk_(?:live|test)_[A-Za-z0-9]{16,}', flags: 'g' },
    { id: 'npm-token', pattern: 'npm_[A-Za-z0-9]{30,}', flags: 'g' },
    { id: 'gitlab-pat', pattern: 'glpat-[A-Za-z0-9_\\-]{16,}', flags: 'g' },
    { id: 'anthropic-key', pattern: 'sk-ant-[A-Za-z0-9_\\-]{20,}', flags: 'g' },
    { id: 'sendgrid-key', pattern: 'SG\\.[A-Za-z0-9_\\-]{16,512}\\.[A-Za-z0-9_\\-]{16,}', flags: 'g' },
    { id: 'azure-account-key', pattern: 'AccountKey=[A-Za-z0-9+/]{40,}={0,2}', flags: 'g' },
  ],
  // Named bounded/linear scanners (NOT regexes), listed here so catalogueId binds them too.
  //  - url-userinfo-v1 (scheme://user:pass@host connection-string leaks): its former greedy regex was a
  //    proven O(n^2) ReDoS; scanUrlUserinfo is O(n) and shape-based.
  //  - jwt-v1: D5 replaces the capped jwt regex with the deterministic linear scanJwt. The D4 regex had to
  //    bound its payload quantifier ({10,4096}) to avoid O(n^2) backtracking, which introduced an arbitrary
  //    ~4096-char false-negative (large enterprise / x5c JWTs). scanJwt has NO length cap and NO backtracking.
  scanners: ['url-userinfo-v1', 'jwt-v1'],
  // Cyrillic/Greek homoglyphs → ASCII skeleton (extend deliberately; each change re-derives catalogueId).
  confusables: {
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x',
    'ѕ': 's', 'і': 'i', 'ј': 'j', 'һ': 'h', 'ԁ': 'd', 'ԛ': 'q',
    'ɡ': 'g', 'ο': 'o', 'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Κ': 'K',
    'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Χ': 'X',
  },
  zeroWidth: ['​', '‌', '‍', '⁠', '﻿'],
};

export function catalogueId(): string {
  return sha256Hex(canonicalBytes(SECRET_CATALOGUE));
}

export interface SecretMatch { readonly patternId: string; readonly start: number; readonly end: number; }

export function scanForSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const p of SECRET_CATALOGUE.patterns) {
    const flags = p.flags.indexOf('g') === -1 ? p.flags + 'g' : p.flags;
    const re = new RegExp(p.pattern, flags);
    let m: RegExpExecArray | null = re.exec(text);
    while (m !== null) {
      matches.push({ patternId: p.id, start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
      m = re.exec(text);
    }
  }
  matches.sort((a, b) => (a.start - b.start) || (a.end - b.end) || (a.patternId < b.patternId ? -1 : a.patternId > b.patternId ? 1 : 0));
  return matches;
}

// Strip EVERY invisible / default-ignorable / format character (not just the catalogue's core list), so a
// secret run cannot be split by e.g. U+00AD SOFT HYPHEN, bidi controls, or any other zero-width joiner
// (red-team hardening). Ordinary whitespace (TAB/LF/CR/space) is deliberately preserved.
// Also strip Unicode combining marks (\p{M}) — a secret run split by a combining mark would otherwise
// break a charset regex; stripping them rejoins the run so the scanner still catches it (red-team).
const INVISIBLE_RE = /[\p{Default_Ignorable_Code_Point}\p{Cf}\p{M}]/gu;
function stripZeroWidth(s: string): string {
  return s.replace(INVISIBLE_RE, '');
}
function confusableSkeleton(s: string): string {
  let o = '';
  for (const ch of s) o += (SECRET_CATALOGUE.confusables[ch] ?? ch);
  return o;
}

/** Defensive projections a secret might hide behind. D2 adds the COMPOSED projection
 *  confusableSkeleton(stripZeroWidth(NFC(text))) so an attacker cannot layer NFC + zero-width + confusable
 *  tricks to slip past any single-step projection (amendment 11). Round-14 red-team round 3 adds the two
 *  COMPATIBILITY projections (NFKC + composed-over-NFKC): fullwidth (U+FF01…), mathematical-alphanumeric
 *  (U+1D400…), superscript, and circled lookalikes are compatibility-equivalent to ASCII but have NO
 *  canonical (NFC) decomposition and are absent from the small confusables table, so only NFKC folds them
 *  back to ASCII where the catalogue regexes match. This closes the whole compatibility-confusable class in
 *  one step (a proven fullwidth/math-monospace bypass of a real credential).
 *  D4 adds the NFD-first projection `confusableSkeleton(stripZeroWidth(NFD(text)))`: NFC/NFKC *compose*,
 *  so a precomposed diacritic lookalike (e.g. `ó` U+00F3 standing in for `o`) survives them and its base
 *  letter never surfaces. NFD *decomposes* it into base + combining mark; stripZeroWidth then removes the
 *  `\p{M}` mark, leaving the bare base letter where the catalogue matches. Closes the decomposed/precomposed
 *  evasion class. */
export function secretProjections(text: string): string[] {
  const nfc = text.normalize('NFC');
  const nfkc = text.normalize('NFKC');
  const nfd = text.normalize('NFD');
  const zw = stripZeroWidth(text);
  const skeleton = confusableSkeleton(text);
  const composed = confusableSkeleton(stripZeroWidth(nfc));
  const composedK = confusableSkeleton(stripZeroWidth(nfkc));
  const composedD = confusableSkeleton(stripZeroWidth(nfd)); // D4: NFD-first (decompose → strip marks → skeleton)
  return [text, nfc, nfkc, nfd, zw, skeleton, composed, composedK, composedD];
}

// Deterministic operation counter for the hand-written linear scanners. It lets the test suite assert an
// O(n) STEP budget (load-independent) instead of a flaky wall-clock ratio (D5 item 4). Pure integer state,
// no I/O; read/reset only via scanStepBudget() below.
let SCAN_STEPS = 0;

function isSchemeChar(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x2b || c === 0x2e || c === 0x2d;
}
function isAlphaCode(c: number): boolean { return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a); }
function isWs(c: number): boolean { return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c || c === 0x0b; }
function isUserChar(c: number): boolean { return !isWs(c) && c !== 0x2f && c !== 0x3a && c !== 0x40; } // [^\s/:@]
function isPassChar(c: number): boolean { return !isWs(c) && c !== 0x2f && c !== 0x40; }              // [^\s/@]
// base64url alphabet [A-Za-z0-9_-] (the JWT segment charset; 'eyJ' is itself base64url).
function isB64Url(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || c === 0x2d;
}

// LINEAR scanner for a credential-carrying URL (scheme://user:pass@host), replacing the former greedy regex
// (a proven O(n^2) ReDoS). Each `://` is located once via indexOf (positions only advance ⇒ O(n) overall);
// the scheme is checked in a bounded backward window (must contain a letter). D5 (item 2) pins the userinfo
// boundary: the `@` may sit at index uStart+URL_USERINFO_MAX inclusive, so a userinfo (user:pass) of length
// exactly 512 IS detected; 513 is the first miss (best-effort ceiling, §13). The scheme window is a length
// bound only (out-of-window still linear); the userinfo bound is a documented detection ceiling.
const URL_SCHEME_MAX = 40;    // realistic scheme-length ceiling (postgres, mongodb, amqps, https, …)
const URL_USERINFO_MAX = 512; // realistic user:pass window ceiling; userinfo length ≤ 512 is detected
export function scanUrlUserinfo(text: string): boolean {
  let at = text.indexOf('://');
  while (at !== -1) {
    const lo = at - URL_SCHEME_MAX < 0 ? 0 : at - URL_SCHEME_MAX;
    let s = at - 1, sawAlpha = false;
    while (s >= lo && isSchemeChar(text.charCodeAt(s))) { SCAN_STEPS++; if (isAlphaCode(text.charCodeAt(s))) sawAlpha = true; s--; }
    if (sawAlpha) {
      const uStart = at + 3;
      const maxAt = uStart + URL_USERINFO_MAX; // '@' allowed at index ≤ maxAt ⇒ userinfo length ≤ 512
      let i = uStart;
      while (i < maxAt && isUserChar(text.charCodeAt(i))) { SCAN_STEPS++; i++; }
      if (i > uStart && i < maxAt && text.charCodeAt(i) === 0x3a) {
        i++;
        const pStart = i;
        while (i < maxAt && isPassChar(text.charCodeAt(i))) { SCAN_STEPS++; i++; }
        if (i > pStart && i <= maxAt && text.charCodeAt(i) === 0x40) return true;
      }
    }
    at = text.indexOf('://', at + 1);
  }
  return false;
}

// LINEAR scanner for a JWT (eyJ<b64url>{≥10}.<b64url>{≥10}.<b64url>{≥6}), replacing the D4 capped regex.
// No length cap (detects large/enterprise/x5c tokens the capped regex missed) and NO backtracking. Each
// seg-1 b64url run is consumed forward exactly once; on a FAILED candidate the cursor jumps PAST that run
// (to `i`), so the runs never overlap and total work is O(n) — no interior `eyJ` in a maximal b64url run can
// succeed where the earliest candidate failed (shared terminating char ⇒ shared seg-2/seg-3). This closes
// the D5 O(n²) case on `'eyJ'×K + '.'`. `charCodeAt` past end returns NaN, so every predicate is false at EOF.
export function scanJwt(text: string): boolean {
  let at = text.indexOf('eyJ');
  while (at !== -1) {
    let i = at + 3;
    while (isB64Url(text.charCodeAt(i))) { SCAN_STEPS++; i++; }        // seg-1 b64url run (incl. 'eyJ')
    const dot1 = text.charCodeAt(i) === 0x2e;
    if ((i - at) >= 13 && dot1) {                                     // 'eyJ' + ≥10 b64url, then '.'
      let j = i + 1, n2 = 0;
      while (isB64Url(text.charCodeAt(j))) { SCAN_STEPS++; j++; n2++; }
      if (n2 >= 10 && text.charCodeAt(j) === 0x2e) {
        let k = j + 1, n3 = 0;
        while (isB64Url(text.charCodeAt(k))) { SCAN_STEPS++; k++; n3++; }
        if (n3 >= 6) return true;
      }
    }
    // On EVERY failed candidate, advance past the already-consumed seg-1 b64url run (to `i`, which is > at).
    // A later `eyJ` inside that same maximal run shares its terminating char and therefore its seg-2/seg-3,
    // so it cannot succeed where the earliest candidate failed — re-scanning it would be O(n²) (D6 fix: this
    // was previously `at+1` when the run ended in a dot, the reachable quadratic case on `'eyJ'×K + '.'`).
    at = text.indexOf('eyJ', i);
  }
  return false;
}

/** Test-only: run both hand-written scanners and return the exact number of character steps taken — a
 *  deterministic, load-independent complexity budget (D5 item 4 replaces the flaky wall-clock ratio). */
export function scanStepBudget(text: string): number {
  SCAN_STEPS = 0;
  scanUrlUserinfo(text);
  scanJwt(text);
  return SCAN_STEPS;
}

/** True if ANY projection of `text` contains a catalogue secret (fail-closed). Runs the regex catalogue and
 *  the linear url-userinfo + jwt scanners over every projection. */
export function textHasSecret(text: string): boolean {
  for (const proj of secretProjections(text)) {
    if (scanForSecrets(proj).length > 0) return true;
    if (scanUrlUserinfo(proj)) return true;
    if (scanJwt(proj)) return true;
  }
  return false;
}
