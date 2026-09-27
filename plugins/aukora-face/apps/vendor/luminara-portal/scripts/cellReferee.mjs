// LUMINARA · THE TRAINED CELL — the referee (the reference layer)
//
// The semantic gate for cell proposals, in the pattern of the Manus trained-
// cell circuit's reference check (TC2): the structural gate's job is shape,
// this layer's job is truth. A proposal is re-derived from the canon and
// compared exactly; any drift is refused with the expected answer attached.
//
// Usage:
//   bun scripts/cellReferee.mjs --corpus training/luminara-cell-v1.jsonl
//     verifies every assistant message in a corpus (the corpus proves itself)
//   bun scripts/cellReferee.mjs proposal.json
//     verifies one sampled proposal file, exit 0 pass / 1 refuse
//
// Or import { referee } and give it a parsed proposal object.

import { readFileSync } from 'node:fs';
import { derive } from './generateCellCorpus.mjs';

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Re-derive the expected object for a proposal, from its own stated inputs.
// Every family's params are readable off the proposal itself (n, key, shape),
// so the referee needs no side channel to the prompt.
function expectedFor(proposal) {
  const key = Object.keys(proposal)[0];
  const body = proposal[key];
  switch (key) {
    case 'identity': case 'counter': case 'knot': case 'interval':
    case 'becoming': case 'successor':
      return { [key]: derive[key](body.n) };
    case 'house':
      return { house: derive.house(['AUM', 'MA', 'RA'].indexOf(body.key)) };
    case 'count': {
      const filter = body.every((e) => e.q < 0) ? 'neg' : body.every((e) => e.q > 0) ? 'pos' : undefined;
      return { count: derive.count(filter) };
    }
    case 'dyads': return { dyads: derive.dyads() };
    case 'silences': return { silences: derive.silences() };
    default: return null;
  }
}

export function referee(proposal) {
  let expected;
  try { expected = expectedFor(proposal); } catch (e) { return { ok: false, reason: 'underivable: ' + e.message }; }
  if (!expected) return { ok: false, reason: 'unknown family: ' + Object.keys(proposal)[0] };
  if (deepEq(proposal, expected)) return { ok: true };
  return { ok: false, reason: 'semantic drift', expected };
}

// --- CLI -------------------------------------------------------------------
const arg = process.argv[2];
if (arg === '--corpus') {
  const lines = readFileSync(process.argv[3], 'utf8').trim().split('\n');
  let pass = 0; const refusals = [];
  lines.forEach((line, i) => {
    const proposal = JSON.parse(JSON.parse(line).messages[2].content);
    const v = referee(proposal);
    if (v.ok) pass++; else refusals.push('line ' + (i + 1) + ': ' + v.reason);
  });
  console.log('referee: ' + pass + '/' + lines.length + ' proposals verified against the canon');
  if (refusals.length) { console.error(refusals.join('\n')); process.exit(1); }
} else if (arg) {
  const v = referee(JSON.parse(readFileSync(arg, 'utf8')));
  if (v.ok) { console.log('PASS: the proposal agrees with the canon'); }
  else {
    console.error('REFUSED: ' + v.reason);
    if (v.expected) console.error('expected: ' + JSON.stringify(v.expected));
    process.exit(1);
  }
}
