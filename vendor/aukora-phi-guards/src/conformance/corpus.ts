// φ CONFORMANCE — THE CORPUS: twelve hostile cases, read off disk, never counted by hand.
//
// ══ WHERE THESE CAME FROM ══
//
// PROVENANCE.md: taken from `aumara-xyz/aukora-one`, unmodified. They are not φ's tests — they are a
// standard φ is being measured against, written by people who had already been bitten. Ten of the
// twelve carry a dated incident in the `incident` field, and that field is the reason the case exists.
//
// NOTHING IN THIS DIRECTORY MAY EDIT A CASE. A conformance corpus you are allowed to adjust is a
// mirror, and this loader is deliberately strict about it: a case that does not parse, or that is
// missing a field, is a LOUD failure rather than a quiet skip. The failure mode this guards against is
// the one gate.ts already names — machinery that exists to catch drift becoming the drift — and it
// arrives here as a case file that silently stops being run.
//
// ══ NO HARDCODED TWELVE ══
//
// The corpus size is whatever is on disk. Every number this suite reports is measured at the moment it
// is reported, including how many cases there are. If a thirteenth case lands tomorrow it is run
// tomorrow, and if one is deleted it disappears from git, in review, where a person can see it.

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export type Expect = 'ALLOW' | 'REFUSE';

export interface Attempt {
  /** The path, exactly as the attacker types it. Never normalised here — that is the seam's job. */
  path: string;
  op: string;
}

export interface Fixture {
  dirs?: string[];
  files?: Record<string, string>;
  /** link path → target, as written in the case. See sandbox.ts for how a target is resolved. */
  symlinks?: Record<string, string>;
  /** new name → existing file. A hard link IS the file under a second name. */
  hardlinks?: Record<string, string>;
}

export interface HostileCase {
  /** The file it was read from, so a report can be traced back to a thing on disk. */
  file: string;
  id: string;
  why: string;
  incident: string;
  fixture: Fixture;
  attempt: Attempt;
  expect: Expect;
}

export const CASES_DIR = new URL('./cases/', import.meta.url).pathname;

/** Everything wrong with one case, named. Empty means it is usable. */
export function problemsWith(raw: unknown, file: string): string[] {
  const p: string[] = [];
  if (typeof raw !== 'object' || raw === null) return [`${file}: not an object`];
  const c = raw as Record<string, unknown>;
  for (const field of ['id', 'why', 'incident'] as const) {
    if (typeof c[field] !== 'string' || !(c[field] as string).trim()) p.push(`${file}: ${field} is missing`);
  }
  if (c.expect !== 'ALLOW' && c.expect !== 'REFUSE') p.push(`${file}: expect must be ALLOW or REFUSE, got ${JSON.stringify(c.expect)}`);
  const a = c.attempt as Record<string, unknown> | undefined;
  if (!a || typeof a.path !== 'string' || !a.path.length) p.push(`${file}: attempt.path is missing`);
  if (!a || typeof a.op !== 'string' || !a.op.length) p.push(`${file}: attempt.op is missing`);
  if (typeof c.fixture !== 'object' || c.fixture === null) p.push(`${file}: fixture is missing`);
  return p;
}

/**
 * Every case on disk, in filename order.
 *
 * Throws on a malformed case rather than skipping it. A corpus that quietly runs eleven of twelve and
 * reports a percentage of eleven is the exact dishonesty this whole directory exists to prevent.
 */
export function loadCorpus(dir: string = CASES_DIR): HostileCase[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const cases: HostileCase[] = [];
  const problems: string[] = [];
  for (const file of files) {
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(join(dir, file), 'utf8')); }
    catch (e) { problems.push(`${file}: ${(e as Error).message}`); continue; }
    const p = problemsWith(raw, file);
    if (p.length) { problems.push(...p); continue; }
    cases.push({ file, ...(raw as object) } as HostileCase);
  }
  if (problems.length) throw new Error(`the corpus is malformed and will not be run:\n  ${problems.join('\n  ')}`);
  return cases;
}

/**
 * THE DECLARED WORLD — the only paths this corpus says may be written, derived from the corpus itself.
 *
 * Read off the ALLOW cases rather than written down somewhere. A hand-kept allow-list next to a corpus
 * that already contains one is a second copy of a policy, and the second copy is the one that goes
 * stale. Case 00 is the only ALLOW today; if the corpus grows another, this grows with it and no line
 * of code changes.
 */
export function declaredWritable(cases: HostileCase[]): string[] {
  return cases.filter((c) => c.expect === 'ALLOW').map((c) => c.attempt.path);
}

/**
 * Whether this corpus can mean anything at all.
 *
 * Case 00 says it outright: "A fence that refuses everything passes every other case in this suite and
 * protects nothing." Without at least one ALLOW, a perfect score is evidence of nothing.
 */
export function hasControl(cases: HostileCase[]): boolean {
  return cases.some((c) => c.expect === 'ALLOW');
}
