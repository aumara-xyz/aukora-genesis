// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Candidate path collision integrity (#22 overnight · HARDEN GIT: "case folding, Unicode normalization").
 *
 * macOS/APFS collapses BOTH letter case AND Unicode normalization form: two candidate paths that differ only in
 * case (`File.ts` vs `file.ts`) or only in NFC/NFD composition (`café.ts` with a precomposed U+00E9 vs a base `e`
 * + combining U+0301) map to the SAME on-disk file — so staging both would silently let one candidate file
 * overwrite another. The candidate stage already refuses case-fold duplicates; this closes the remaining
 * Unicode-normalization dimension with a single APFS-equivalence key, as a pure, exhaustively-testable check.
 *
 * Pure; no I/O; grants no authority. A candidate stage may call this before writing to refuse a colliding set.
 */

/** The APFS-equivalence key: NFC-normalize, then case-fold. Two paths sharing this key collide on disk. */
export function pathCollisionKey(relPath: string): string {
  // NFC folds NFD/NFC apart-but-equal forms together; toLowerCase folds letter case. macOS applies both.
  return relPath.normalize('NFC').toLowerCase();
}

export type PathCollisionVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasonClass: string; readonly colliding: readonly [string, string] };

/**
 * Detect the first collision in a candidate file set. Fail-closed and order-stable: an EXACT duplicate string is
 * `candidate:duplicate-path`; two DISTINCT strings that fold to the same APFS key are `candidate:path-collision`
 * (a case-fold and/or Unicode-normalization collision). Returns the offending pair (earliest-seen first).
 */
export function detectCandidatePathCollisions(paths: readonly string[]): PathCollisionVerdict {
  const byKey = new Map<string, string>();
  for (const p of paths) {
    const key = pathCollisionKey(p);
    const prior = byKey.get(key);
    if (prior !== undefined) {
      const reasonClass = prior === p ? 'candidate:duplicate-path' : 'candidate:path-collision';
      return { ok: false, reasonClass, colliding: [prior, p] };
    }
    byKey.set(key, p);
  }
  return { ok: true };
}

/** True iff two paths would resolve to the same file on a case-insensitive, normalization-insensitive filesystem. */
export function pathsCollide(a: string, b: string): boolean {
  return pathCollisionKey(a) === pathCollisionKey(b);
}

/** HARD: this is a read-only integrity check; it grants no authority and touches nothing. Constant. */
export function candidatePathIntegrityGrantsAuthority(): false {
  return false;
}
