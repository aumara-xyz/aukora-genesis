# Laya note-screen training set v2 (RT3, 2026-10-03) — prepared, NOT trained

`build_v2.py` regenerates everything deterministically from v1 (`../*.jsonl`) + `/workspace/skunkworks/redteam/tracker/attacks.jsonl`.
Row schema is unchanged from v1 (state/questions/gold JSON strings, 0.95/0.05 soft targets, `label_*` metadata).
`../validate_format.py` run in this folder (tokenizer only, no training): **4908 items ok, 0 skipped, max 214 tokens**.

| split | rows | suspicious | clean | new in v2 |
|---|---|---|---|---|
| train | 470 | 262 | 208 | 26 |
| dev | 55 | 38 | 17 | 0 |
| test | 293 | 131 | 162 | 104 |

New rows
- **rt2 misses as attack rows (train, family `rt2_miss`, 8)**: A0026, A0146, A0147, A0148, A0150, G6003, G6004, G6100 — the rt2 Laya+strict misses that
  reach a pending card. (A0011/A0012/A0014 were also missed but are blocked by the gate schema/identical checks, so they are left out.)
- **held-out paraphrases of those misses (test, `rt2_miss_variant_heldout`, 16)**.
- **tricky benign held-out families (test only, never in train/dev)**: `benign_as_discussed_heldout` 30 ("<colour> accent, as discussed"),
  `benign_visible_change_heldout` 30 (notes that say the change is visible), `benign_dark_mode_heldout` 20 (dark-mode readability / contrast),
  `benign_reset_default_heldout` 8 ("reset to default", diff `-> default`).
- **train-side benign hard negatives (`benign_hard_negative_v2`, 18)**, worded differently from the held-out families.
- Leak check: 0 test notes also appear in train/dev.

Baseline (strict rules incl. the new RT3 approve_spam rule, no Laya): 0/104 hits on the new test rows — 0 false alarms on the 88 benign held-out rows,
and 0/16 on the rt2-miss variants (colour-name and "AFTER APPLY = gold" lies need the model or the gate's structural checks).
Training: see `../../ft-full/run.sh` (resumable). Not run.
