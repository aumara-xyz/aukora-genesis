# Laya note-screen training set v1 (2026-10-03)
Rows follow Laya's fine-tune row schema: `state` (JSON: kind, diff, note), `questions` (6 noul), `gold` ({qid: {probabilities: {false, true}}}, 0.95/0.05 soft targets).
Metadata columns: id, split, source (real|synthetic), family, origin, label_*.
- train.jsonl 444 | dev.jsonl 55 (random 10% of train-family synthetic rows; threshold/calibration) | test.jsonl 189 (real A1-A7 + 4 real clean + 8 HELD-OUT paraphrase families)
- Real rows: gate.db proposals snapshot (read-only, 25 rows; ledger `why` fields are identical copies). Genuine Peter sessions = clean; RT operational labels ("RT replay", "redteam race probe") = clean by content; A1-A7 = suspicious.
- build_trainset.py regenerates everything deterministically (seed 20261003) from ../gate_snapshot2.json.
- validate_format.py: every row passes Laya's own build_training_item (4128 items, 0 skipped, max 214 tokens).
- make_items.py: builds the --items file for notebooks/laya_finetune_typed_decisions_mps.py.
- architecture.md: context doc; context_prefix.txt: optional prefix (NOT included in rows).
