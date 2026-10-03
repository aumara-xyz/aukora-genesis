# S1 preregistration: Laya value net ("fast intuition") + lookahead + tabu, then hinted Ornith

Written 2026-10-03 (Mac), before the real value-net training run and before any box run. The training script records
this file's sha256 in `s1_laya_eval.json` at start. Edits after the training run starts go in a dated **Amendments**
section at the end, never in place.

## Idea in one paragraph
Peter's request: the Laya model should look back at past decisions ("that didn't work last time, try something else"),
play a few moves ahead, and hand Ornith probabilities for the next move. S1 builds the smallest version that can be
tested. (1) A **value net** is fine-tuned from Laya's encoder to predict, for any Sokoban state, P(solvable) and a
distance-to-solve bucket. (2) A **lookahead** enumerates every possible next box push using the simulator, scores the
result with the value net plus exact deadlock rules, and returns the top options and known dead ends. (3) A **tabu
memory** records failed attempts per board across episodes. (4) **Ornith** gets the lookahead block in its prompt.
Nothing on the inference path calls the BFS oracle (`sokoban.solve`). The only inputs are the learned value, the simulator
and sound deadlock rules.

## Components (lab/, prefix s1_)
| file | role |
|---|---|
| s1_common.py | render, value-net input encoding, buckets, push macro-actions, SOUND deadlock rules (pure python, no oracle) |
| s1_data.py | labelled states (Mac, ~40 s): full reachable state graph per board + reverse BFS = exact `sokoban.solve` labels |
| s1_value.py | Laya encoder loaded with native `transformers.ModernBertModel` (no remote code), 2 heads, save/load, Scorer |
| s1_train_laya.py | fine-tune on MPS, then reload the saved artifact, temperature-scale on val, evaluate on test |
| s1_lookahead.py | 1-ply / 2-ply push lookahead, prompt block, no-oracle AST check + runtime tripwire |
| s1_tabu.py | per-board failed-attempt memory (JSONL, shared across episodes), "Avoid (tried, failed)" block |
| s1_ornith_eval.py | box eval: hints on CPU before generation, arms A/B in one vLLM engine, receipts; wm_interactive hook |

## Data (RAN, sealed before training)
- `s1_states_manifest.json` sha256 `803966dbaae4522c86fb797ab71ffbf612869e6196f9abc248ef90769a267867`
  - train `fe73d61c32bc6aaf1d4a1099642b223cd0fbced6d663984060054d75cae2b0ec` (60,000 states, 2,501 boards)
  - val `6682d7545d7cfc3b42562d745b74c37926d521bd0dfd6fc56a6ff9290af56266` (6,000 states, 250 boards)
  - test `3e4adcea8ae3b1625f6ab8c3d1b384fc6cc97b2459d1cb1a23bebf3d8bf12bbf` (6,000 states, 250 boards)
- Boards: `sokoban.generate`, rng seed 1020261003, start BFS-solvable. Each split is balanced 50/50 solvable/unsolvable.
  Solvable buckets in test: 1-4: 548, 5-8: 536, 9-16: 1217, 17-32: 678, 33+: 21.
- Leakage controls: no board and no sampled state appears, up to the 8 symmetries, in the exclusion set (1,491 ids,
  sha `a5c072d3...131b1`). The set covers holdout.json (32), holdout128 (exact replay asserted against confirm_base.json),
  holdout_v7 (144), v7_cp (600), probe easy (16), every pool board (256), and every grid found in pulled/, ledger/ and the
  lab JSON files (1,311). Splits are made by **layout** (walls+goals, symmetry-canonical), so test layouts never occur in
  train (0 overlaps, asserted).
- Label correctness: 400/400 random states match `sokoban.solve`, with the same solvable flag and the same shortest length.
  The deadlock rules are sound: 0 of 36,000 solvable states are flagged (asserted). 2,341 of the 3,000 unsolvable test
  states are rule-detectable; the other 659 are "hard" unsolvable.

## Value net training (Mac M4, MPS; caps: training <= 28 min, total Mac training wall time <= 35 min)
- Base: convaiinnovations/laya @1c5edc17 (Apache-2.0). Only `encoder/config.json` (ModernBertForMaskedLM config;
  loaded as ModernBertModel, SDPA attention) and the `encoder.*` tensors of `model.safetensors` (170 tensors, 394.8M params)
  are loaded. None of the repo's .py files are imported or executed. Laya's own decision heads are ignored.
- Input: `encode_cells`, the interior 6x6 with one token per tile, floor written as `_`, rows separated by `|`, 43 tokens.
  The tokenizer was checked to give exactly one token per tile in every context. The literal row text was rejected
  because BPE merges runs of tiles and breaks cell alignment.
- Embeddings and layers 0-21 are frozen, kept in fp16 (the exact Laya values) with no autograd. Layers 22-27, the final
  norm and both heads are trained in fp32 (73.6M trainable params). Mean pooling. Loss = CE(solvable) + CE(bucket),
  with the bucket loss masked on unsolvable states.
- AdamW lr 3e-5, wd 0.01, batch 32, 100 warmup steps, then linear decay over planned steps = min(1 epoch, time
  budget / measured step time). Hard stop at 28 min. Grad clip 1.0. Seed 1020261003.
- After training: save `s1_laya/`, **reload it from disk (fp32)** and evaluate that reloaded artifact. Temperatures
  (solvable head, bucket head) are each fitted by NLL on val (log grid 0.05-20 plus refinement).

## H-S1a (offline, CONFIRMATORY for the value net)
On the 6,000-state test split, with P(solvable) from the reloaded artifact:
- **AUROC >= 0.90**, with solvable as the positive class (rank-based; temperature does not change it), **and**
- **ECE <= 0.05 after temperature scaling**, computed with 15 equal-width bins over top-label confidence max(p, 1-p) of
  the solvable head. The first bin includes 0.

PASS needs both. Reported but not gating:
- ECE before scaling, positive-class reliability ECE, NLL, Brier
- AUROC on the hard subset (solvable vs rule-undetectable unsolvable)
- AUROC of a rule-only baseline
- AUROC by sampling source
- bucket accuracy, within-one-bucket accuracy, MAE of expected distance
- latency per state on MPS at batch 64 and 8

Claude's forecast (graded later): P(H-S1a PASS) = 0.65. Expected test AUROC 0.93 (80% interval 0.86-0.98). Expected
post-temperature ECE 0.02. The most likely failure is weak discrimination on hard unsolvable states, with AUROC there
around 0.7.

## Lookahead (no oracle)
- Macro-actions: player BFS without pushing, to every cell from which a box can be pushed (dest not wall/box). Each
  action is described in plain words, e.g. "push the box at row 3 col 4 RIGHT; player path ULLD; moves ULLDR".
  Coordinates are (row, col), 0-indexed from the top-left corner, as in the v7 consequence-prediction traces.
- Scoring: a push that solves the puzzle gets P = 1. A rule deadlock gets P = 0. Otherwise P is the temperature-scaled
  P(solvable) from the value net, and est = moves of the push + expected distance (bucket midpoints 2.5/6.5/12.5/24.5/40).
  Rank score = P - 0.01·est. With 2-ply, P and est come from the best next push.
- Dead ends: a rule deadlock, P < 0.05, or a state the tabu memory marked as failed.
- No-oracle enforcement: (a) an AST scan of s1_lookahead/s1_common/s1_value/s1_tabu for any `solve` / `label_graph` /
  `s1_data` reference runs at import; (b) every `analyze()` runs with `sokoban.solve` replaced by a tripwire that raises.
- Latency (dry run, MPS, real Laya encoder, random heads, fp32, after shape warm-up, batches padded to multiples of 4):
  - 1-ply median 120 ms, max 125 ms per board.
  - 2-ply with a 200 ms budget: max 184 ms, but it expands only 0-3 first pushes.
  - Unbudgeted 2-ply: about 300-530 ms.
  - Mac CPU 1-ply: about 150-410 ms.
  The budget mode depends on machine speed, so it is **not** used for preregistered hints.

## H-S1b (box, EXPLORATORY)
- Set: holdout128, the 128 boards of CONFIRM-1/2. Model: base Ornith-1.5-35B-A3B. n = 4 samples per board per arm,
  T 0.6, top_p 0.95, top_k 20, seed 20261010, thinking on, max_tokens 16384, max_model_len 20480. Both arms run in ONE
  engine and ONE `generate` call.
- Arm A: `prompts.solve_prompt(board)`.
- Arm B: the same prompt with the **1-ply** lookahead block inserted before the final reply instruction. The block holds
  top-3 first pushes with P and est, plus up to 6 known dead ends. Hints are computed on the box CPU (training .venv
  torch, fp32) **before** the engine is created. Each hint text is hashed and the whole hint set is hashed. A parity check
  against the Mac reference scores must hold: max |dP| <= 0.02.
- Scoring: lenient (posthoc_lenient.lenient + verify) and strict (v5_common.score), per sample. Per board: lenient_ok
  and strict_ok, 0..4 for each arm.
- **Test**: one-sided exact sign test that the per-board lenient count is higher in B than in A, with ties dropped.
  PASS iff p <= 0.05. This is exploratory: a PASS motivates a confirmatory rerun on a fresh sealed set and does not
  establish a claim.
- Secondary measures:
  - strict sign test, lenient by band, and truncation rate
  - `follows_top1`: how many plans start with the top-1 hint's move string. This tests whether the hint is used, not only
    whether it helps.
- Claude's forecast: P(PASS) = 0.30. Expected lenient totals: A ~95/512, B ~110/512. The likeliest gain is in the 8-16 band.
- Compute estimate: 2 arms × 128 boards × n 4 = 1,024 samples, about 2× one CONFIRM-2 model eval (512 samples took
  1,040 s of generation). That gives about 35 min of generation, plus about 3 min engine load, plus about 1-2 min CPU
  hints: **about 40 min of H200, about $3.6** at $5.40/h. It needs `s1_laya/` on the box (about 0.94 GB encoder plus
  tokenizer) and does not need the HF cache.

### Box commands (cwd = lab; T = training .venv, V = vLLM .venv)
```
CUDA_VISIBLE_DEVICES= $T/python s1_ornith_eval.py --hints holdout128.json $OUT          # CPU hints + parity check
$V/python s1_ornith_eval.py $BASE_MODEL base $OUT holdout128.json 4                     # arms A+B, receipts
```
Receipts: `$OUT/s1_hints_holdout128.json`, `$OUT/s1_eval_base.json`, `$OUT/s1_eval_base.raw.json`. None is ever
overwritten.

## Interactive variant (not run; documented hook)
`s1_ornith_eval.install_wm_hook(wm_interactive, lookahead, tabu_factory)` wraps `Episode.__init__` and
`Episode.apply_turn` at runtime; the wm files are not edited. Every harness observation then carries the intuition block
for the **current** board, placed before the reply instruction, plus the tabu "Avoid (tried, failed)" block. A blocked
prefix is recorded as `illegal`, and a proven deadlock along the applied path as `dead_rule`. The hook was dry-run with
a mock LLM and tokenizer on the Mac. Running it live needs the value net in the generation loop: on the GPU with vLLM
gpu_memory_utilization <= 0.85, or 1-ply on CPU, with one batched scorer call per round.

## Not claimed / limits
- The value net is trained on the same procedural generator family. AUROC on holdout-like boards is in-distribution.
- The hints are learned estimates. They can be wrong and can mislead.
- This setup cannot separate "the hint helped planning" from "the hint gave a correct first move to copy". `follows_top1`
  only partly addresses that.
- Parallel games and distillation back to the main player (Peter's "sensors ahead of the main player") are future work.
  The tabu JSONL is already a shared append-only workspace across parallel episodes of one board.

## Amendments
(none yet)

### A1 — 2026-10-03 (Mac, after the H-S1a training run, BEFORE any H-S1b box run): review fixes
Pre-amendment shas (the sealed training run's code): s1_PREREG.md 601b2a3c…d747, s1_train_laya.py 8c98dfc9…8440,
s1_value.py e3698489…f13f, s1_common.py 65ea25b8…ee54, s1_data.py c29207f8…a906, s1_lookahead.py a44b23cd…ae1c,
s1_ornith_eval.py efd480fe…9f9e, s1_tabu.py 1a96d40a…e8a2. Post-amendment shas: `s1_manifest.sha256`.
The sealed artifact and receipt are unchanged: s1_laya/meta.json ad017821…f88f96a, head f07f7377…48e8, encoder
b169fdef…eb95, s1_laya_eval.json fb66dc5d…bd02. H-S1a stays **PASS as preregistered**.

1. **Operative value-net quality (non-gating).** The gate scored all 6,000 test states, but the lookahead only sends the net
   states no sound rule flags. Re-evaluation of the sealed artifact (inference only, `s1_laya_reeval.json`; it reproduces the
   sealed numbers exactly: refit T diff 0, AUROC diff 0, ECE diff 0, reference-score |dp| 0):
   - net input (test, not rule_dead; n 3,659, 659 unsolvable): AUROC **0.869**, top-label ECE 0.016, positive-class ECE 0.083
   - push source and not rule_dead (n 501): AUROC **0.825**, top-label ECE **0.067** (above 0.05)
   - per source (pooled test): graph 0.939, walk 0.940, push 0.928 ('opt' is solvable-only, no AUROC)
   - system score (P = 0 when a rule fires, else net P): AUROC 0.971
   - post-hoc temperature fitted on val[not rule_dead] (T 1.087) does not fix it: net-input ECE 0.017, push 0.067.
   H-S1b is interpreted with the net-input numbers, not the pooled 0.953. Next version: gate on the rule-negative population,
   temperature fitted there, solvable and unsolvable states drawn from the same source mix.
2. **Receipt correction.** The sealed receipt's `stop_reason: epoch` should read `time_planned` (1,326 of 1,875 steps,
   0.707 epoch). Fixed in code.
3. **Mac training-time cap.** The real run alone took 2,011.7 s (33.5 min: 1,664.9 s training + 346.8 s load, save, reload,
   eval). Benchmarks (bench.py, incl. a killed full-model run) and the dry run (about 17:19-17:36, INFERRED from file mtimes)
   add more, so the cumulative 35-min cap was very likely exceeded (INFERRED: roughly 40+ min). No retraining was done after
   this point; the re-evaluation above is inference only (288 s wall on MPS). s1_train_laya.py now has `--total-minutes`
   (default 35, from process start) and refuses to overwrite any artifact or receipt in every mode.
4. **Hint text (changes arm B; made before any box run).** "Known dead ends (avoid):" is split into "Proven dead ends (a sound
   rule shows the puzzle can no longer be solved; avoid):" and "Likely dead ends (estimate, may be wrong):". The options and
   dead-end sets are unchanged (128/128 boards identical to the pre-amendment Mac CPU hints). Measured post hoc on
   holdout128 with the oracle: 3 of the 4 estimate dead ends are solvable (3/128 boards), 0 of 143 proven dead ends are
   wrong, and the top-1 option leads to an unsolvable state on 4/128 boards.
   Mac CPU reference hints_sha256: pre-amendment a2134018…8ce7 (old text), **post-amendment
   19d3fd1302737e75ce5682c0c0c64975c2bb054076debbdf42c9239e65ad63a3** (Mac M4 CPU, torch 2.8.0, transformers 4.53.0,
   9 threads, parity max |dp| 6.9e-6). Whether the box hints match it is reported as a NON-gating cross-machine check.
5. **Generation protocol.** "ONE generate call" is replaced by chunked generation: prompts interleaved [A_i, B_i] per board,
   chunks of 32 boards (64 prompts × n 4 = 256 sequences), the same per-request seed 20261010. After every chunk the scored
   rows and raw texts are appended to `OUT/s1_eval_base.partial.jsonl` (flush + fsync); the final receipt and raw file are
   built from it; `--resume` continues a stopped run, and the receipt records how many engine instances were used. Code shas
   are taken at start-up. Expected cost change INFERRED at about +0-15% generation time (each chunk pair is the size of one
   CONFIRM-2 call). Box commands are now `bash s1_run.sh` (sha checks, CPU hints, wait for a free GPU, eval, one --resume retry).
6. **Guards.** Hints must come from the sealed artifact (meta sha + file shas pinned in s1_ornith_eval.py), parity <= 0.02,
   1-ply top-3; any option or best-next line that would solve the puzzle is stripped (0 on holdout128) and asserted absent;
   `--two-ply` is refused for holdout128. The run refuses to build hints inline or to accept dry-run / injected-scorer hints.
   The receipt's H_S1b block carries `status: EXPLORATORY …` and `exploratory_signal` instead of `verdict`; the hints file
   records torch / transformers / threads / platform and an evidence class. load_cases refuses every sealed set
   (holdout_v7, holdout_rep1, holdout_v8, any other holdout*.json) and any set sharing a board with one, unless --allow-sealed.
7. **Tabu (not used by H-S1b).** `unsolved_end` is no longer a dead end: it is a soft "tried before, did not finish" note
   (no P change). Entries are keyed by the exact board sha256, so a rotated or mirrored copy loads nothing.
8. **Data exclusion.** holdout_rep1.json (17:56) and holdout_v8.json / v8_pool.json (18:19-18:20) postdate the sealed data
   build (17:25). The reviewer's check found 0 overlap with the 72,000 states at four levels (exact state,
   player-region-normalised, boxes-only, layout) for holdout32/128/v7/rep1, v7_cp and the v5 pool. s1_data.py now also drops
   any board whose layout occurs in any sealed or evaluated set, and refuses to overwrite outputs. A full rebuild with the
   amended code (1,969 ids and 1,646 layouts excluded, incl. rep1, v8 and v8_pool) reproduced all three sealed data files
   byte-identically (train fe73d61c…, val 6682d754…, test 3e4adcea…). Only 3 boards were dropped by layout, and the old build
   had dropped those anyway (start state rule-dead). Sealed overlap asserted 0 for state ids and layouts.
9. **Encoding note.** Cell (1,1) uses the bare-character token ids, while the other 35 cells use the space-prefixed ids. This
   is kept for the sealed artifact. `cells_v2` (leading space, 7 distinct cell ids verified) is available for the next
   version. encode_cells now asserts a wall border.
