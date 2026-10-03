# Sokoban recursion lab — r1 (2026-10-03)

A measured self-improvement loop on one H200: **Ornith-1.5-35B-A3B** (36B total / ~3B active MoE) learns 8x8 two-box Sokoban
from its own verified attempts; an exact BFS solver is the referee. Every claim below was preregistered (hash-locked) before the run.

## Results (RAN)
| Test | Set (sealed, never trained on) | Result |
|---|---|---|
| CONFIRM-1 (strict format+solve) | 128 puzzles | base 11 -> gen-1 22, p=0.0096 PASS — later shown to be mostly answer-format learning |
| CONFIRM-2 (format-independent, 4 samples/board) | 128 puzzles | gen-1/gen-2 vs base: FAIL (planning flat) |
| FORCED-1 (force an answer when thinking runs out) | 128 puzzles | 0 rescues — truncated attempts are unfinished search |
| v7 (self-traces + simulator-labelled board-prediction practice) | new sealed set, 144 | v7 > gen-1 FAIL; v7 > base p=0.019 (secondary) |
| **REP1 replication** | second new sealed set, 144 x 8 samples | **v7 > base: 22.2% -> 26.6%, 53 boards up / 32 down, p=0.0147 PASS**, gains in 8-16, 17-32 and first 33-48 solves |
| System-1 value net (Laya / ModernBERT, trained on solver-labelled states) | held-out boards | AUROC 0.953, ECE 0.012 |
| Frontier reference (not training data) | 128 puzzles | Qwen3.8 Max Prime 106/128 single-shot |

Honest limits: one generation of real planning gain; Sokoban 8x8 only; the frontier gap is large.

## Layout
- `lab/` — all code (sokoban.py simulator/verifier, v5–v8 pipelines, eval scripts, wm_* working-memory harness, s1_* Laya System-1, frontier_eval.py).
- `ledger/prereg/` — every preregistration and result receipt; `ledger/AMENDMENTS.md` — append-only log of deviations.
- `ledger/DOJO-KERNEL.md` — the guided-recursion kernel design.
- **Withheld on purpose:** sealed test sets (secret-seed holdouts), model/adapter weights, raw transcripts, credentials.

## Next (in progress)
- System-1 policy+value net (small CNN "vision" net vs Laya) + probability-guided search ("snapshots" several pushes ahead).
- **Sob-Zero**: self-play with no solver labels — the net plays novel puzzles (incl. DeepMind Boxoban 10x10/4-box), retrains only on its own wins; zero-shot sealed tests each generation.
- Ornith learns from verified hard-puzzle solutions (own + System-1-found + solver tutor, with leak gates).

Rules of the loop: the verifier and sealed sets live outside the model's reach; fast intuition can veto/route but never approve; every generation is a ledger row; the owner approves each promotion.
