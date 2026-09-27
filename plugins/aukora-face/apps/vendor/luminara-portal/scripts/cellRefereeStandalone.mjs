// LUMINARA · THE TRAINED CELL — standalone referee (the shipped reference layer)
//
// The handoff twin of scripts/cellReferee.mjs, built to travel: it imports
// NOTHING from the canon. Truth lives in reference.json beside this file, a
// table pinned at export time from the Luminara canon. The receiving circuit
// gets exactly two powers: train on the corpus, and refuse a wrong answer.
// The living canon, the essences, and the practice surface stay home.
//
// Usage (from the bundle directory):
//   bun cellReferee.mjs --corpus luminara-cell-v1.jsonl   verify every line
//   bun cellReferee.mjs proposal.json                     verify one proposal
// Exit 0 = pass, 1 = refused.

import { readFileSync } from 'node:fs';

const REFERENCE = JSON.parse(
  readFileSync(new URL('./reference.json', import.meta.url), 'utf8'),
);

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The lookup key is readable off the proposal itself: no side channel to the
// prompt is needed, so the referee can sit anywhere in the circuit.
function keyOf(proposal) {
  const family = Object.keys(proposal)[0];
  const body = proposal[family];
  switch (family) {
    case 'identity': case 'counter': case 'knot': case 'interval':
    case 'becoming': case 'successor':
      return family + ':' + body.n;
    case 'house':
      return 'house:' + body.key;
    case 'count':
      return 'count:' + (body.every((e) => e.q < 0) ? 'neg'
        : body.every((e) => e.q > 0) ? 'pos' : 'all');
    case 'dyads': return 'dyads';
    case 'silences': return 'silences';
    default: return null;
  }
}

export function referee(proposal) {
  let key;
  try { key = keyOf(proposal); } catch (e) { return { ok: false, reason: 'unreadable: ' + e.message }; }
  if (!key || !(key in REFERENCE)) return { ok: false, reason: 'unknown task: ' + key };
  const expected = REFERENCE[key];
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
  console.log('referee: ' + pass + '/' + lines.length + ' proposals verified against the pinned reference');
  if (refusals.length) { console.error(refusals.join('\n')); process.exit(1); }
} else if (arg) {
  const v = referee(JSON.parse(readFileSync(arg, 'utf8')));
  if (v.ok) { console.log('PASS: the proposal agrees with the reference'); }
  else {
    console.error('REFUSED: ' + v.reason);
    if (v.expected) console.error('expected: ' + JSON.stringify(v.expected));
    process.exit(1);
  }
}
