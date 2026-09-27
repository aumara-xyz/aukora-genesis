// LUMINARA · THE TRAINED CELL — corpus generator (phase one: the arithmetic)
//
// Generates a JSONL training corpus for a LoRA cell in the Manus trained-cell
// circuit (MANUS_TRAINED_CELL_REPORT, 2026-07-21): the same {system, user,
// assistant-JSON} shape as aukora_ternary_train.jsonl, so it drops into
// train_lora.py unchanged.
//
// THE DISCIPLINE: every assistant answer is DERIVED from the canon module at
// generation time, never authored here. The same canon is the reference layer
// at gate time (scripts/cellReferee.mjs), so any semantic hallucination the
// trained cell produces is caught the way TC2 caught the flipped carry.
//
// PHASE ONE SCOPE: the arithmetic and fixed nomenclature only — bijection,
// involution, tempered rule, harmonic law, houses, silences, the count.
// The 81 voice corpus is EXCLUDED by design: authored register has no
// machine referee, so it cannot ride this circuit honestly.
//
// Usage: bun scripts/generateCellCorpus.mjs   (from the repo root)
// Output: training/luminara-cell-v1.jsonl + a self-verification report.

import { mkdirSync, writeFileSync } from 'node:fs';
import {
  CARDS, SUITS, cardOf, codeOf, knotOf, counterOf, becomingOf, isSilent, SILENCES,
} from '../spatial/app/luminara-canon.js';

const SYSTEM = 'You are a Luminara cell of the Aukora organism. Output only valid JSON proposals derived from the canon.';

const example = (prompt, answer) => ({
  messages: [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: prompt },
    { role: 'assistant', content: JSON.stringify(answer) },
  ],
});

const houseOf = (n) => SUITS[codeOf(n)[0]].key;

// --- the derived answer for every family, one place ------------------------
export const derive = {
  identity: (n) => ({ n, name: cardOf(n).name, code: codeOf(n), q: knotOf(n).q, house: houseOf(n) }),
  counter: (n) => ({ n, counterN: counterOf(n), q: knotOf(n).q, counterQ: knotOf(counterOf(n)).q }),
  knot: (n) => {
    const k = knotOf(n);
    return { n, p: k.p, q: k.q, kind: k.kind, genus: k.genus, components: k.components };
  },
  interval: (n) => {
    const k = knotOf(n);
    return { n, name: k.interval, ratio: [Math.abs(k.q), k.p] };
  },
  becoming: (n) => ({ n, becomes: becomingOf(n) }),
  successor: (n) => {
    const next = (n % 27) + 1;
    return n === 27 ? { n, next, seam: true } : { n, next };
  },
  house: (h) => ({ key: SUITS[h].key, cards: CARDS.map((c) => c.n).filter((n) => codeOf(n)[0] === h) }),
  count: (filter) => CARDS.map((c) => ({ n: c.n, q: knotOf(c.n).q }))
    .filter((e) => (filter === 'neg' ? e.q < 0 : filter === 'pos' ? e.q > 0 : true))
    .sort((a, b) => a.q - b.q),
  dyads: () => {
    const pairs = [];
    for (let n = 1; n <= 27; n++) {
      const c = counterOf(n);
      if (c > n) pairs.push([n, c]);
    }
    return { pairs, still: 1 };
  },
  silences: () => CARDS.map((c) => c.n).filter(isSilent)
    .map((n) => ({ n, name: cardOf(n).name, silence: SILENCES[n].name })),
};

function build() {
  const out = [];
  for (let n = 1; n <= 27; n++) {
    out.push(example('Propose the identity of card ' + n + '.', { identity: derive.identity(n) }));
    out.push(example('Propose the counter of card ' + n + '.', { counter: derive.counter(n) }));
    out.push(example('Propose the knot of card ' + n + '.', { knot: derive.knot(n) }));
    out.push(example('Propose the interval of card ' + n + '.', { interval: derive.interval(n) }));
    out.push(example('Propose the becoming of card ' + n + '.', { becoming: derive.becoming(n) }));
    out.push(example('Propose the successor of card ' + n + ' on the count.', { successor: derive.successor(n) }));
  }
  for (let h = 0; h < 3; h++) {
    out.push(example('Propose the nine cards of house ' + SUITS[h].key + '.', { house: derive.house(h) }));
  }
  out.push(example('Propose the full signed count of the deck.', { count: derive.count() }));
  out.push(example('Propose the negative side of the count.', { count: derive.count('neg') }));
  out.push(example('Propose the positive side of the count.', { count: derive.count('pos') }));
  out.push(example('Propose the dyads of the deck.', { dyads: derive.dyads() }));
  out.push(example('Propose the four Silences and their seats.', { silences: derive.silences() }));
  return out;
}

// --- self-verification: property checks, not echo checks -------------------
// These re-derive nothing from `derive`; they test the corpus against the
// canon's own laws, so a bug in the generator cannot certify itself.
function verifyInvariants() {
  const fails = [];
  const ck = (name, ok) => { if (!ok) fails.push(name); };

  // the bijection: q covers [-13, 13] exactly once
  const qs = CARDS.map((c) => knotOf(c.n).q).sort((a, b) => a - b);
  ck('q-bijection', qs.length === 27 && qs.every((q, i) => q === i - 13));

  for (let n = 1; n <= 27; n++) {
    const k = knotOf(n), code = codeOf(n), c = counterOf(n);
    // the involution: counter negates q, twice returns home, Seed self-paired
    ck('involution:' + n, counterOf(c) === n && knotOf(c).q === -k.q + 0);
    // the tempered rule: p = 1 + moving while any stillness holds; else 7
    const moving = code.filter((d) => d !== 0).length;
    ck('tempered:' + n, k.p === (code.includes(0) ? 1 + moving : 7));
    // the becoming: settles only where a turning mark stands
    ck('becoming:' + n, (becomingOf(n) === null) === !code.includes(2));
    // the house: first digit names it
    ck('house:' + n, houseOf(n) === ['AUM', 'MA', 'RA'][Math.floor((n - 1) / 9)]);
  }
  // the four Silences on their seats
  const seats = CARDS.map((c) => c.n).filter(isSilent);
  ck('silences', seats.join(',') === '4,16,22,25');
  return fails;
}

// Generate only when run directly; importers (the referee) take `derive` alone.
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1].replace(/\\/g, '/')).href) {
  const corpus = build();
  const fails = verifyInvariants();
  if (fails.length) {
    console.error('INVARIANT FAILURES — corpus NOT written:', fails.join(' '));
    process.exit(1);
  }
  mkdirSync(new URL('../training/', import.meta.url), { recursive: true });
  const path = new URL('../training/luminara-cell-v1.jsonl', import.meta.url);
  writeFileSync(path, corpus.map((e) => JSON.stringify(e)).join('\n') + '\n');
  console.log('invariants: all held (q-bijection, involution, tempered rule, becoming, houses, silences)');
  console.log('examples: ' + corpus.length + ' written to training/luminara-cell-v1.jsonl');
}
