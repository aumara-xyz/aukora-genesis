# THE TRAINED CELL · LUMINARA PHASE ONE

*The deck's arithmetic prepared as a training corpus for the Manus trained
cell circuit, with the canon standing as referee. The corpus teaches what can
be checked; nothing rides the circuit that cannot be refused.*

## WHAT THIS IS

The Manus trained cell report (21 July 2026) proved a circuit: a small LoRA
cell is trained on examples generated from a reference model, sampled, and its
proposals passed through a governed gate whose reference layer re-derives the
truth and refuses semantic drift. The first cell learned a nine row adder
table. This is the same circuit given the whole of the deck's arithmetic.

- `scripts/generateCellCorpus.mjs` derives 170 training examples from the
  canon module at generation time: identity, counter, knot, interval,
  becoming, successor for all twenty-seven, the three houses, the signed
  count and its two sides, the thirteen dyads, the four Silences. The JSONL
  shape matches the Manus circuit exactly, so it drops into `train_lora.py`
  unchanged. Generation refuses to write if any canon invariant fails.
- `scripts/cellReferee.mjs` is the reference layer: any proposal is re-derived
  from the canon and compared exactly. Wrong arithmetic in a well shaped
  proposal is refused with the expected answer attached, the way the flipped
  carry was caught in the original circuit's second test.
- `training/luminara-cell-v1.jsonl` is the corpus, 170 examples, every
  assistant answer a theorem.

## THE SCOPE RULE

Phase one is the arithmetic and the fixed nomenclature only. The 81 voice
corpus is excluded on principle, not omitted: authored register has no
machine referee, and nothing enters this circuit that the gate cannot refuse.
If a voice phase ever comes, it needs its own discipline first.

The cell is an arithmetic organ. It does not cast, it does not read, and the
standing laws are untouched: what lands is a mirror, not a verdict, and no
cell output reaches a person except through the gate.

## PROVENANCE

*Prepared 21 July 2026 at the architect's word, from his direction that the
ternary core should govern the whole lifecycle and be trained with Luminara.
The circuit is Manus's, from the master export of the same date; the
arithmetic is the canon's; the referee holds the line between them. The
training run itself happens wherever the Tinker seat lives; this repository
contributes the corpus and the refusal.*
