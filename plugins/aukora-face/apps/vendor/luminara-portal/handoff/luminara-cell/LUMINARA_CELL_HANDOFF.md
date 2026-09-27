# LUMINARA CELL CORPUS · HANDOFF TO THE AK3 CIRCUIT

**From:** the Luminara lane (Fable), at the architect's word
**Date:** 2026-07-21
**Source:** luminara-portal @ `3bcae1da9eaa` (private; this bundle is the whole boundary)

## What this is

A training corpus for the trained-cell circuit (MANUS_TRAINED_CELL_REPORT,
2026-07-21), in the exact JSONL shape of `aukora_ternary_train.jsonl`, so it
drops into `train_lora.py` unchanged. Where the first cell memorised the
nine-row balanced ternary adder, this corpus carries the full arithmetic of
the Luminara deck: 170 examples, every assistant answer a theorem.

- **the bijection**: 27 cards, ternary codes, signed q covering [-13, +13] exactly once
- **the involution**: every card's counter (layerwise negation; 13 dyads + the Seed self-paired)
- **the tempered rule**: the torus knot T(p, q) of every card
- **the harmonic law**: every card's interval, |q| : p
- **the becoming, the successor, the three houses, the four Silences, the signed count**

## The referee (the reference layer)

`cellReferee.mjs` + `reference.json` are the semantic gate for cell
proposals, in the pattern of TC2: structure is the candidate gate's job,
truth is this layer's. A proposal is looked up by its own stated task and
compared exactly; drift is refused with the expected answer attached. The
referee is standalone by design: it imports nothing, and the truth table is
pinned at export time. Proof run: a well-shaped proposal claiming card 14's
counter is 15 was refused; the true counter is 27 (the deepest mirror pair,
q +13/-13).

```
bun cellReferee.mjs --corpus luminara-cell-v1.jsonl   # 170/170 pass
bun cellReferee.mjs some-sampled-proposal.json        # exit 0 pass / 1 refuse
```

## The scope rule (please keep it)

Phase one is arithmetic and fixed nomenclature ONLY. The 81 voice corpus and
the practice surface (essences, readings, casts) are excluded on principle,
not omitted: authored register has no machine referee, and nothing should
ride this circuit that the gate cannot refuse. The cell is an arithmetic
organ. It does not cast and it does not read.

## Custody (SHA-256 of the exact bytes)

| File | Bytes | SHA-256 |
|---|---:|---|
| `luminara-cell-v1.jsonl` | 54079 | `66cae6d14adb4bcd24f1e0c66e594b3af2753983e7563bbb7fdab5b69750d868` |
| `reference.json` | 20093 | `f6737baa863530c5daa37a6e1ec8fb93a4da456ccd0380836706581507304814` |
| `cellReferee.mjs` | 2971 | `0405f897a9acdb1a242bfe603d50cbb23a122bfa08a2e69382ca91de0f1c2c0a` |
