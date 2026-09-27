// THE FENCE, MEASURED AGAINST THE REAL CORPUS — what wiring the judge in would actually buy.
//
// ══ WHY THIS FILE EXISTS ══
//
// `test/conformance.test.ts` tests the RUNNER. `bun run conformance/run.ts` measures the
// WRITE SEAM — `core/forge/review.ts` capture -> apply — and reports 3 of 12, because that
// seam's only path predicate is `abs.startsWith(repoRoot() + sep)`: no law, no protected
// set, no `judge()`. So the armed score is not a measurement of `core/witness/` at all.
// The fence and the number everyone quotes about the fence are about different code.
//
// This file closes that gap in the only honest direction available from this lane: it runs
// the SAME twelve fixtures through `judgePaths()` — the witness lane's actual judge — and
// pins, case by case, what the suite WILL report once someone wires it into the write path.
// A pre-measured target instead of a promise.
//
// ══ THE THREE NUMBERS, AND KEEPING THEM APART ══
//
//   12 of 12  what THIS judge answers, pinned below
//   12 of 12  what `conformance/run.ts` reports armed, against review.apply
//
// They were 7 and 3, then 7 and 7, and now both are 12. Each step is a different commit and a
// different reason, and the file kept them apart at every one.
//
// THE FIRST TWO USED TO BE 7 AND 3, AND THAT GAP WAS THE POINT OF THIS FILE. The judge
// answered seven; the write seam had no path predicate but `startsWith(repoRoot() + sep)`
// and answered three; quoting the seven as if it were the three would have been the exact
// dishonesty this repository keeps catching itself in. This file existed to hold them apart
// and to pre-measure what wiring would buy.
//
// `core/forge/review.ts` now calls `judgePaths` at all four of its path sites, so the gap is
// closed and the two numbers agree — which is the outcome this file predicted, not a
// coincidence. It keeps its job: it is still the only place the judge is measured against
// the corpus WITHOUT the write seam in the way, so if the two ever disagree again, the
// disagreement is between this file and `scripts/conformance-gate.ts` and one of them is
// wrong out loud.
//
// ══ WHAT THE LAST FIVE NEEDED, AND WHY IT WAS ONE DECISION ══
//
// 02, 04, 07, 08 and 09 all missed for one reason: they attack `law.js` (directly, through a
// symlink, case-folded, NFD-spelled, or with a trailing dot) or an undeclared path, and NO
// RULE PROTECTED `law.js`. The alias machinery was never failing — `paths.mjs` folds all
// four spellings to the same key correctly, which cases 06 and 11 proved by going green
// through exactly that folding. The rules simply did not name the file, and no denylist rule
// could name case 02's path without also naming the control beside it: measured, the honest
// denylist ceiling was 11 of 12.
//
// `conformance/cases/02-undeclared-path.json` said what was actually being asked, in words:
// "An allow-list that only checks for protected names admits everything it forgot to name."
// That is deny-by-default. The owner chose it, `core/witness/law.mjs` grew a `writable` list,
// and `corpus.ts`'s `declaredWritable()` — which `run.ts` had been PRINTING while nothing
// enforced it — is now the policy the sandbox is judged under.
//
// The pin did its job on the way out. These five were asserted WRONG on purpose, so closing
// them turned a red assertion green and `scripts/conformance-gate.ts` SHUT with "an expected
// miss went green", which is what made the polarity change a declared act rather than a
// number quietly improving. That is the whole argument for pinning misses by name.

import { describe, it, expect } from 'bun:test';
import { resolve } from 'path';

import { loadCorpus, declaredWritable } from '../conformance/corpus';
import { build, destroy, verify } from '../conformance/sandbox';
// @ts-expect-error — guard.mjs is untyped ESM; see judgePaths' own note on the typed surface.
import { judgePaths } from '../core/witness/guard.mjs';

type Verdict = { verdict: string; reasonClass: string; rule: string | null };

/** One case, judged. The fixture is real — built and torn down by the conformance sandbox. */
function judge(caseId: string): { got: 'ALLOW' | 'REFUSE'; v: Verdict; expect: string } {
  const c = loadCorpus().find((x) => x.id === caseId);
  if (!c) throw new Error(`no such case: ${caseId}`);
  const s = build(c);
  try {
    // A fixture that did not materialise makes every verdict below meaningless.
    expect(verify(c, s), `${caseId}: the fixture did not materialise`).toEqual([]);
    const [v] = judgePaths(s.repo, [resolve(s.repo, c.attempt.path)]) as Verdict[];
    // A judge that returned NOTHING for a declared path is the loudest possible failure and read here
    // as `undefined.verdict`. Under `noUncheckedIndexedAccess` tsc says so; said in words instead, so
    // the corpus reports a missing verdict as a missing verdict rather than a TypeError.
    if (!v) throw new Error(`${caseId}: the judge returned no verdict at all for ${c.attempt.path}`);
    return { got: v.verdict === 'allowed' ? 'ALLOW' : 'REFUSE', v, expect: c.expect };
  } finally { destroy(s); }
}

describe('the witness judge, against the corpus the write seam is measured by', () => {
  it('THE CONTROL — a declared write is still allowed', () => {
    // Case 00's own argument: "A fence that refuses everything passes every other case in
    // this suite and protects nothing." Every refusal below is worthless without this line.
    const r = judge('lawful-write');
    expect(r.got).toBe('ALLOW');
    expect(r.v.reasonClass).toBe('ok:allowed');
  });

  it('refuses the seven it can, each by a NAMED class rather than by accident', () => {
    // The class matters as much as the verdict. Case 10 was already "green" under
    // run.ts — on EISDIR, the kernel refusing a write to a directory, which the report
    // states out loud ("before φ: the filesystem refused the edit"). A fence whose only
    // argument is the operating system has not made one.
    const expected: Record<string, string> = {
      'dotdot-traversal': 'law:outside-repo',
      'dangling-symlink': 'law:outside-repo',
      'hardlink-nlink': 'guard:multiply-linked',
      'symlinked-parent': 'law:protected-path',
      'repo-root': 'law:repository-root',
      'empty-segment-glob': 'law:protected-path',
    };
    for (const [id, reasonClass] of Object.entries(expected)) {
      const r = judge(id);
      expect(r.got, `${id} must be refused`).toBe('REFUSE');
      expect(r.v.reasonClass, `${id} must be refused BY NAME`).toBe(reasonClass);
    }
  });

  it('THE FIVE THAT NEEDED THE ALLOW-LIST — closed, and each refused as undeclared', () => {
    // These five were asserted WRONG on purpose for as long as phi had no answer to the question they
    // ask. The owner chose deny-by-default; `core/witness/law.mjs` grew a `writable` list; they close.
    //
    // The reason class matters as much as the verdict, and it is the honest one: none of these is
    // refused because a rule NAMES it — no rule ever named `law.js`. They are refused because nothing
    // DECLARES them, which is the whole content of the new polarity. A future change that started
    // refusing them as `law:protected-path` would be a different mechanism wearing this test's result.
    for (const id of ['undeclared-path', 'symlink-to-protected', 'case-fold', 'nfd-decompose', 'trailing-dot']) {
      const r = judge(id);
      expect(r.expect, `${id} is a REFUSE case`).toBe('REFUSE');
      expect(r.got, `${id} is closed by the allow-list`).toBe('REFUSE');
      expect(r.v.reasonClass, `${id} is refused for being undeclared, not for being named`).toBe('law:undeclared-path');
    }
  });

  it('the corpus already carries the allow-list the fence does not consume', () => {
    // `declaredWritable` reads the editable set off the ALLOW cases. `run.ts` reports it
    // and nothing enforces it. Naming that here so the gap is a fact in a test rather than
    // an observation in a PR body that scrolls away.
    expect(declaredWritable(loadCorpus())).toEqual(['world/mind.md']);
  });

  it('the score this judge produces is 12 of 12, and the armed suite agrees', () => {
    const cases = loadCorpus();
    let met = 0;
    for (const c of cases) if (judge(c.id).got === c.expect) met += 1;
    expect(cases.length).toBe(12);
    expect(met).toBe(12);
    // Measured twice by two routes that share no code below the corpus: this one calls `judgePaths`
    // directly, `AUKORA_FORGE=1 bun run conformance/run.ts` drives capture -> apply and grades what
    // moved on disk. They are kept as two numbers on purpose — if the wiring ever drifts from the
    // judge, one of them moves first and the disagreement is the finding. This file was 7 while the
    // seam was 3, and that gap was the whole reason it exists.
  });
});
