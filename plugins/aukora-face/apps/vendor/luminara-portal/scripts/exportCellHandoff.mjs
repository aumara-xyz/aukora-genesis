// LUMINARA · THE TRAINED CELL — handoff bundle exporter
//
// Builds handoff/luminara-cell/ for delivery into the ak3 circuit:
//   luminara-cell-v1.jsonl   the corpus (copied verbatim from training/)
//   reference.json           the truth table, pinned from the canon NOW
//   cellReferee.mjs          the standalone referee (no canon import)
//   LUMINARA_CELL_HANDOFF.md the note, with SHA-256 custody computed here
//
// The bundle is the whole boundary: nothing else of the estate travels.
// Usage: bun scripts/exportCellHandoff.mjs   (from the repo root)

import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { SUITS } from '../spatial/app/luminara-canon.js';
import { derive } from './generateCellCorpus.mjs';

const OUT = new URL('../handoff/luminara-cell/', import.meta.url);
mkdirSync(OUT, { recursive: true });

// --- the pinned reference: every task the corpus teaches, keyed -----------
const reference = {};
for (let n = 1; n <= 27; n++) {
  for (const fam of ['identity', 'counter', 'knot', 'interval', 'becoming', 'successor']) {
    reference[fam + ':' + n] = { [fam]: derive[fam](n) };
  }
}
for (let h = 0; h < 3; h++) reference['house:' + SUITS[h].key] = { house: derive.house(h) };
reference['count:all'] = { count: derive.count() };
reference['count:neg'] = { count: derive.count('neg') };
reference['count:pos'] = { count: derive.count('pos') };
reference['dyads'] = { dyads: derive.dyads() };
reference['silences'] = { silences: derive.silences() };
writeFileSync(new URL('reference.json', OUT), JSON.stringify(reference, null, 1) + '\n');

// --- the corpus and the referee, copied ------------------------------------
copyFileSync(new URL('../training/luminara-cell-v1.jsonl', import.meta.url), new URL('luminara-cell-v1.jsonl', OUT));
copyFileSync(new URL('cellRefereeStandalone.mjs', import.meta.url), new URL('cellReferee.mjs', OUT));

// --- the note, with custody computed from the bytes just written -----------
const sha = (name) => createHash('sha256').update(readFileSync(new URL(name, OUT))).digest('hex');
const size = (name) => readFileSync(new URL(name, OUT)).length;
const srcCommit = execSync('git rev-parse HEAD', { cwd: new URL('..', import.meta.url) }).toString().trim();

const note = `# LUMINARA CELL CORPUS · HANDOFF TO THE AK3 CIRCUIT

**From:** the Luminara lane (Fable), at the architect's word
**Date:** ${new Date().toISOString().slice(0, 10)}
**Source:** luminara-portal @ \`${srcCommit.slice(0, 12)}\` (private; this bundle is the whole boundary)

## What this is

A training corpus for the trained-cell circuit (MANUS_TRAINED_CELL_REPORT,
2026-07-21), in the exact JSONL shape of \`aukora_ternary_train.jsonl\`, so it
drops into \`train_lora.py\` unchanged. Where the first cell memorised the
nine-row balanced ternary adder, this corpus carries the full arithmetic of
the Luminara deck: 170 examples, every assistant answer a theorem.

- **the bijection**: 27 cards, ternary codes, signed q covering [-13, +13] exactly once
- **the involution**: every card's counter (layerwise negation; 13 dyads + the Seed self-paired)
- **the tempered rule**: the torus knot T(p, q) of every card
- **the harmonic law**: every card's interval, |q| : p
- **the becoming, the successor, the three houses, the four Silences, the signed count**

## The referee (the reference layer)

\`cellReferee.mjs\` + \`reference.json\` are the semantic gate for cell
proposals, in the pattern of TC2: structure is the candidate gate's job,
truth is this layer's. A proposal is looked up by its own stated task and
compared exactly; drift is refused with the expected answer attached. The
referee is standalone by design: it imports nothing, and the truth table is
pinned at export time. Proof run: a well-shaped proposal claiming card 14's
counter is 15 was refused; the true counter is 27 (the deepest mirror pair,
q +13/-13).

\`\`\`
bun cellReferee.mjs --corpus luminara-cell-v1.jsonl   # 170/170 pass
bun cellReferee.mjs some-sampled-proposal.json        # exit 0 pass / 1 refuse
\`\`\`

## The scope rule (please keep it)

Phase one is arithmetic and fixed nomenclature ONLY. The 81 voice corpus and
the practice surface (essences, readings, casts) are excluded on principle,
not omitted: authored register has no machine referee, and nothing should
ride this circuit that the gate cannot refuse. The cell is an arithmetic
organ. It does not cast and it does not read.

## Custody (SHA-256 of the exact bytes)

| File | Bytes | SHA-256 |
|---|---:|---|
| \`luminara-cell-v1.jsonl\` | ${size('luminara-cell-v1.jsonl')} | \`${sha('luminara-cell-v1.jsonl')}\` |
| \`reference.json\` | ${size('reference.json')} | \`${sha('reference.json')}\` |
| \`cellReferee.mjs\` | ${size('cellReferee.mjs')} | \`${sha('cellReferee.mjs')}\` |
`;
writeFileSync(new URL('LUMINARA_CELL_HANDOFF.md', OUT), note);

console.log('handoff bundle written to handoff/luminara-cell/');
console.log('reference tasks: ' + Object.keys(reference).length);
