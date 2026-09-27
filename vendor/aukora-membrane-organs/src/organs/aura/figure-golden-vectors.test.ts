/**
 * EVERY GOLDEN VECTOR IN `docs/FIGURE-Z1.md`, RECOMPUTED FROM THE COUNTS THAT DOCUMENT PRINTS.
 *
 * ══ WHY THIS SUITE EXISTS ══
 *
 * `FIGURE-Z1.md` is the disclosed map. Its whole value is that a stranger can take the counts in a
 * row, recompute the angles with a calculator, and check this build. That contract has failed twice,
 * both times silently:
 *
 *   1. THE HALF-REPUBLISHED DOCUMENT. When the size plane moved off total receipts, the GOLDEN
 *      VECTORS table was republished and the *Golden frames* table in the SAME FILE was not. It went
 *      on carrying `2.931754`, which back-solves to the old 6,200-receipt basis. Rows 1, 2 and 4
 *      verified byte-exact, so the file looked checked.
 *
 *   2. THE MIXED VINTAGE. One row paired `judgedWritePaths = 626` with `refused = 49, allowed = 492`.
 *      Every judged write path carries an allowed-or-refused verdict, so `judgedWritePaths ≤ allowed
 *      + refused` always — and `626 > 541` cannot come from any single `verifyChain` call. The row
 *      was two measurements wearing one hat.
 *
 * A STALE GOLDEN VECTOR IS WORSE THAN NO GOLDEN VECTOR. It turns an honest stranger's recomputation
 * into a false accusation against a build that is actually correct, and they have no way to tell
 * which of the two is wrong.
 *
 * So nothing here trusts prose. The tables are PARSED, every number is recomputed through the real
 * `standingOf` and the real `frameDigest`, and the two tables are checked against each other.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { standingOf, TAU, STRINGS } from '../core/aura/figure';
import { figureFrame, frameDigest } from '../surface/app/aura/rotor.js';

const DOC = join(import.meta.dir, '..', 'docs', 'FIGURE-Z1.md');
const md = readFileSync(DOC, 'utf-8');

const SEED_FULL = 'd84d4d104450a1b2c3d4e5f6';
const cell = (s: string) => s.trim().replace(/^`|`$/g, '');

/** Rows of a markdown table whose header contains `marker`. Header and rule dropped. */
function table(marker: string): string[][] {
  // TRIMMED FIRST. The class table lives inside a list item and is indented two spaces, so an
  // anchored `startsWith('|')` found nothing — and because this ran at collection time the miss
  // printed an error while the suite still reported 0 failing. A parser that returns empty on a miss
  // makes every test built from it vacuous, which is why the emptiness check below is not optional.
  const lines = md.split('\n').map((l) => l.trim());
  // A HEADER, not merely a line containing the word. `judgedWritePaths` is also a CELL in the class
  // table, which appears earlier — matching that row silently returned a table with no data rows.
  // A markdown header is the line immediately above the `| --- |` rule, and that is what is required.
  const isRule = (l: string) => /^\|(\s*:?-{3,}:?\s*\|)+$/.test(l);
  const head = lines.findIndex((l, i) => l.startsWith('|') && l.includes(marker) && isRule(lines[i + 1] ?? ''));
  if (head < 0) throw new Error(`no table HEADER with a '${marker}' column — the document changed shape`);
  const out: string[][] = [];
  for (let i = head + 2; i < lines.length; i += 1) {
    const l = lines[i]!;
    if (!l.startsWith('|')) break;
    out.push(l.split('|').slice(1, -1).map(cell));
  }
  if (!out.length) throw new Error(`the '${marker}' table has no rows`);
  return out;
}

describe('THE VINTAGE — which WHEN these rows describe', () => {
  it('the document declares one, machine-readably', () => {
    const m = md.match(/<!--\s*VINTAGE head=([0-9a-f]{12}|\(none\)) receipts=(\d+) at=(\d{4}-\d{2}-\d{2})\s*-->/);
    expect(m, 'no VINTAGE marker — a measured row with no `when` is how three documents came to '
      + 'disagree about this node\'s own record').not.toBeNull();
  });

  it('and states it in prose a reader sees, not only in a comment', () => {
    const m = md.match(/<!--\s*VINTAGE head=([0-9a-f]{12}) receipts=(\d+)/)!;
    const [, head, receipts] = m;
    expect(md, 'the head must appear in the prose').toContain(head!);
    const pretty = Number(receipts).toLocaleString('en-US');
    expect(md.includes(receipts!) || md.includes(pretty),
      'the receipt count must appear in the prose too').toBe(true);
  });

  it('both measured tables claim the SAME vintage — the failure was one table lagging the other', () => {
    expect(md).toMatch(/Same vintage as the table above/i);
  });
});

// ══ ONE VINTAGE ACROSS EVERY FILE THAT QUOTES THIS RECORD ══
//
// Three documents once carried three different counts of this node's own record — 6,200 · 10,252 ·
// 627-against-626 — and nothing said which `when` each described. The chain grows while a file is
// being written, so any prose quoting it goes stale by the next receipt. The fix is not to stop
// quoting: it is to say WHICH CALL, and to say the same one everywhere.
describe('EVERY FILE THAT QUOTES THIS RECORD QUOTES THE SAME CALL', () => {
  const QUOTERS = [
    ['docs/FIGURE-Z1.md', 'the disclosed map'],
    ['core/aura/figure.ts', 'the module that computes standing'],
    ['surface/app/aura/face.js', 'the page that prints the counts'],
  ] as const;

  const vintage = md.match(/<!--\s*VINTAGE head=([0-9a-f]{12}) receipts=(\d+) at=(\d{4}-\d{2}-\d{2})\s*-->/);

  it('the map declares the vintage', () => {
    expect(vintage, 'no VINTAGE marker in FIGURE-Z1.md').not.toBeNull();
  });

  for (const [f, why] of QUOTERS) {
    it(`${f} (${why}) cites that same head`, () => {
      const src = readFileSync(join(import.meta.dir, '..', f), 'utf-8');
      expect(src, `${f} quotes this node's record but names no vintage — this is exactly how three `
        + 'documents came to disagree').toContain(vintage![1]!);
    });

    // A vintage that is only a tag is decoration. The counts beside it have to be that call's counts.
    //
    // NO PROXIMITY HEURISTIC. The first version exempted a superseded number when a word like "was"
    // or "older" sat within 140 characters of it — and that exemption immediately swallowed a REAL
    // regression: reintroducing the stale `1,933` into figure.ts's class table stayed green, because
    // the paragraph explaining the old reading was right above it. An escape wide enough to cover the
    // history is wide enough to cover the mistake.
    //
    // So every surviving mention is listed BY FILE, BY NUMBER, WITH ITS REASON, and the list is
    // checked for entries that are no longer needed. Same shape as `test/docs-paths.test.ts`, and for
    // the same reason: an exemption nobody has to justify becomes a place to hide.
    // Receipt totals, class counts AND judged counts. `626` was missing from the first list and a
    // mutation walked straight through — the list has to name every number that identifies a
    // superseded call, not just the biggest one. Bare two-digit counts (49, 56) are deliberately
    // absent: they collide with digits inside the angles, and a guard with false positives gets
    // relaxed. The distinctive ones are enough to pin a vintage.
    const STALE = ['10,252', '10,265', '10,345', '6,200', '6,376', '1,933', '6,945',
      '626', '627', '541', '10,365'];
    const HISTORICAL: Record<string, Record<string, string>> = {
      'docs/FIGURE-Z1.md': {
        '6,200': 'the vintage section names the three disagreeing counts in order to explain the defect',
        '10,252': 'same sentence — the list of what three documents each claimed',
        '626': 'the worked example of the impossible row: 626 judged against 492 + 49 = 541',
        '627': 'the same sentence — "627-against-626", the third of the three disagreeing counts',
        '541': 'the sum that made that row impossible, quoted so the arithmetic is checkable',
      },
      'core/aura/figure.ts': {
        '10,252': 'names the older reading this comment block used to mix in, so the correction is legible',
      },
      'surface/app/aura/face.js': {},
    };

    it(`${f} quotes NO count from a superseded reading`, () => {
      const src = readFileSync(join(import.meta.dir, '..', f), 'utf-8');
      const allowed = HISTORICAL[f] ?? {};
      const offenders = STALE.filter((n) => src.includes(n) && !allowed[n]);
      expect(offenders, `${f} quotes ${offenders.join(', ')} — superseded reading(s) with no entry in `
        + 'HISTORICAL. Either re-measure at the declared vintage, or add the number with the reason '
        + 'it is being quoted as history.').toEqual([]);
    });

    it(`${f}'s historical exemptions are all still needed`, () => {
      const src = readFileSync(join(import.meta.dir, '..', f), 'utf-8');
      for (const [n, why] of Object.entries(HISTORICAL[f] ?? {})) {
        expect(why.length, `${f}: ${n} needs a reason, not an entry`).toBeGreaterThan(30);
        expect(src.includes(n), `${f}: ${n} is exempted but no longer appears — drop the entry`).toBe(true);
      }
    });
  }
});

// The prose class table under `xy` is a SECOND statement of the same measurement, and a second copy
// is exactly what goes stale — it is how this document came to hold two different bases for one row.
// So it is tied to the data table rather than merely proofread: mutating its judged count to a number
// that appears nowhere else used to pass, because nothing referred to it.
describe('THE CLASS TABLE IN THE PROSE IS THE SAME MEASUREMENT AS THE GOLDEN ROW', () => {
  const classes = table('class');
  const measured = table('judgedWritePaths').find((r) => /measured/i.test(r[0]!))!;

  const of = (name: string) => {
    const row = classes.find((r) => r[0]!.includes(name));
    expect(row, `no \`${name}\` row in the class table`).toBeTruthy();
    return Number(row![1]!.replace(/,/g, ''));
  };

  it('its judgedWritePaths is the golden row\'s judgedWritePaths', () => {
    expect(of('judgedWritePaths'), 'the prose table and the golden row disagree about the same call')
      .toBe(Number(measured[1]));
  });

  it('the five classes sum to the receipt count the same row prints', () => {
    const sum = ['attention', 'unjudged', 'boundary', 'judgedWritePaths', 'ownerOutcomes']
      .reduce((t, k) => t + of(k), 0);
    expect(sum, 'the classes partition the chain — if they do not sum to `receipts`, either a class is '
      + 'missing from the table or the rows come from different calls').toBe(Number(measured[9]));
  });

  it('and the printed shares match the printed counts', () => {
    const total = Number(measured[9]);
    for (const row of classes) {
      const count = Number(row[1]!.replace(/,/g, ''));
      const share = Number(row[2]!.replace('%', ''));
      expect(share, `${row[0]}: ${count} of ${total} is not ${share}%`)
        .toBeCloseTo(Math.round((count / total) * 1000) / 10, 1);
    }
  });
});

describe('GOLDEN VECTORS — recomputed from the row\'s own counts', () => {
  const rows = table('judgedWritePaths');

  it('is not vacuous', () => {
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });

  for (const r of rows) {
    const [name, judged, refused, allowed, unguarded, seed8, xy, xz, yz, receipts] = r as string[];

    it(`${name} — the printed angles are what the module computes from the printed counts`, () => {
      const seed = seed8 === '(none)' ? '' : SEED_FULL;
      expect(seed8 === '(none)' || SEED_FULL.startsWith(seed8!),
        'the seed prefix must actually prefix the seed used').toBe(true);
      const got = standingOf({
        receipts: Number(receipts),
        verdicts: { refused: Number(refused), allowed: Number(allowed), unguarded: Number(unguarded) },
        biography: {
          schema: 'aukora-biography-v1', attention: 0, unjudged: 0, boundary: 0,
          judgedWritePaths: Number(judged), ownerOutcomes: 0, uninspectableShellCalls: 0,
        },
      }, seed);
      expect(got[0].toFixed(9), `${name}: xy`).toBe(xy!);
      expect(got[1].toFixed(9), `${name}: xz`).toBe(xz!);
      expect(got[2].toFixed(9), `${name}: yz`).toBe(yz!);
    });

    // THE IMPOSSIBILITY CHECK. `classifyReceipt` returns JUDGED_WRITE_PATH exactly when the verdict is
    // allowed or refused, so a row where judged exceeds allowed+refused describes no single call.
    it(`${name} — judgedWritePaths cannot exceed allowed + refused`, () => {
      expect(Number(judged),
        `${name}: ${judged} judged against ${allowed} allowed + ${refused} refused — a row like this `
        + 'cannot come from one verifyChain call, so it is two vintages wearing one hat')
        .toBeLessThanOrEqual(Number(allowed) + Number(refused));
    });

    // Attention must not reach a plane, checked against the DOCUMENT'S OWN row rather than a fixture.
    it(`${name} — receipts and unguarded reach no plane`, () => {
      const base = {
        verdicts: { refused: Number(refused), allowed: Number(allowed), unguarded: Number(unguarded) },
        biography: {
          schema: 'aukora-biography-v1', attention: 0, unjudged: 0, boundary: 0,
          judgedWritePaths: Number(judged), ownerOutcomes: 0, uninspectableShellCalls: 0,
        },
      };
      const seed = seed8 === '(none)' ? '' : SEED_FULL;
      const quiet = standingOf({ ...base, receipts: Number(receipts) }, seed);
      const loud = standingOf({
        ...base,
        receipts: Number(receipts) + 500_000,
        verdicts: { ...base.verdicts, unguarded: Number(unguarded) + 500_000 },
      }, seed);
      expect(loud, `${name}: half a million reads moved her`).toEqual(quiet);
    });
  }
});

describe('GOLDEN FRAMES — recomputed, and checked against the other table', () => {
  const frames = table('REST FRAME digest');
  const vectors = table('judgedWritePaths');

  it('is not vacuous, and has a row per golden vector', () => {
    expect(frames.length).toBeGreaterThanOrEqual(4);
    expect(frames.length, 'the two tables must describe the same cases').toBe(vectors.length);
  });

  for (let i = 0; i < frames.length; i += 1) {
    const [name, seedCell, standingCell, digest] = frames[i] as string[];

    // THE DIGEST IS RECOMPUTED FROM THE COUNTS, NOT FROM THE PRINTED ANGLES, AND THAT IS A FINDING.
    //
    // The first version of this test did the obvious thing — take the standing printed in this table,
    // digest it — and three of four rows failed. Measured: the printed 6dp angles give a different
    // digest, AND SO DO 9dp ANGLES. `figureFrame` rotates sixteen vertices, so an error in an angle
    // arrives in the coordinates multiplied by roughly the vertex norm, and `frameDigest` quantises
    // coordinates at 1e-9. No printable decimal precision pins the frame.
    //
    // So the reproducible path — the one the document now tells a stranger to take — is: counts →
    // `standingOf` → `figureFrame` → digest, at full float precision throughout. The angle column is
    // for reading, and it is cross-checked against the other table below.
    it(`${name} — the printed digest is reproducible from the row's COUNTS`, () => {
      const v = vectors[i] as string[];
      const seed = seedCell === '(none)' ? '' : seedCell!;
      const standing = standingOf({
        receipts: Number(v[9]),
        verdicts: { refused: Number(v[2]), allowed: Number(v[3]), unguarded: Number(v[4]) },
        biography: {
          schema: 'aukora-biography-v1', attention: 0, unjudged: 0, boundary: 0,
          judgedWritePaths: Number(v[1]), ownerOutcomes: 0, uninspectableShellCalls: 0,
        },
      }, seed);
      const got = frameDigest(figureFrame({ seed, standing, breath: [0, 0, 0] }));
      expect(got, `${name}: rest digest`).toBe(digest!);
    });

    // THE CROSS-CHECK THAT WOULD HAVE CAUGHT THE HALF-REPUBLISHED DOCUMENT.
    it(`${name} — this table's standing agrees with the GOLDEN VECTORS table`, () => {
      const v = vectors[i] as string[];
      expect(v[0], 'the two tables must list the cases in the same order').toBe(name!);
      const here = standingCell!.split(',').map((x) => x.trim());
      const there = [v[6]!, v[7]!, v[8]!].map((x) => Number(x).toFixed(6));
      expect(here, `${name}: this table says ${here.join(', ')} and the other says ${there.join(', ')} `
        + '— one of the two tables was republished and the other was not')
        .toEqual(there);
    });
  }
});

describe('THE DOCUMENT TELLS A STRANGER THE PATH THAT ACTUALLY REPRODUCES', () => {
  it('it warns that the digest comes from the counts, not from the printed angles', () => {
    const frames = md.slice(md.indexOf('## Golden frames'));
    // Each clause is required SEPARATELY. The first version used an alternation and stayed green when
    // the precision half was deleted, because the other branch still matched elsewhere in the section
    // — a guard that passes on a fragment of what it is guarding.
    expect(frames, 'it must say to start from the counts').toMatch(/START FROM THE COUNTS/i);
    expect(frames, 'it must say NOT from the printed angles').toMatch(/not from the angles printed here/i);
    expect(frames, 'it must say full float precision throughout').toMatch(/full float precision/i);
    // NO ALTERNATION. Twice now an `|` in one of these guards let a mutation through, because the
    // surviving branch matched neighbouring prose. Each required phrase gets its own assertion.
    expect(frames, 'it must say rounding fails even at nine places — the part a reader will not '
      + 'believe unless told').toMatch(/does not work at nine/i);
    expect(frames, 'and it must show the three measured digests that prove it')
      .toMatch(/73eb921b[\s\S]{0,120}5d45b447[\s\S]{0,60}536cf1e2/);
  });
});

describe('THE FORMULAS THE DOCUMENT PRINTS ARE THE FORMULAS THE MODULE RUNS', () => {
  it('the published xz has no `unguarded` in it', () => {
    const block = md.slice(md.indexOf('xy = TAU'), md.indexOf('```', md.indexOf('xy = TAU')));
    expect(block).toMatch(/xz\s*=\s*TAU\s*·\s*\(\s*refused\s*\/\s*\(\s*1\s*\+\s*refused\s*\+\s*allowed\s*\)/);
    const formulaLine = block.split('\n').find((l) => l.trim().startsWith('xz ='))!;
    expect(formulaLine.split('unguarded is NOT')[0],
      'unguarded must not appear inside the xz formula itself').not.toMatch(/\(\s*[^)]*unguarded[^)]*\)/);
  });

  it('and the worked recomputation under the table uses the same numbers as the row', () => {
    const rows = table('judgedWritePaths');
    const measured = rows.find((r) => /measured/i.test(r[0]!))!;
    const worked = md.slice(md.indexOf('Recompute row 3'));
    const judged = Number(measured[1]), refused = Number(measured[2]), allowed = Number(measured[3]);
    expect(worked, 'the worked xy must use judged + 1').toContain(`log2(${judged + 1})`);
    expect(worked, 'the worked xz must use the row\'s refusals').toContain(`${refused} / (1 + ${refused} + ${allowed})`);
    expect(worked).toContain((TAU * ((Math.log2(judged + 1) / STRINGS) % 1)).toFixed(9));
    expect(worked).toContain((TAU * (refused / (1 + refused + allowed))).toFixed(9));
  });
});
