# PREREG wm: the simulator as external working memory, and a library of past wins (EXPLORATORY)

Status: DRAFT. It locks when the lead commits this file to `ledger/prereg/` **before** `wm_run.sh` starts. After that, changes go in `ledger/AMENDMENTS.md` (append-only).
Drafted 2026-10-03 by Claude, before any wm data existed. Revised the same day after review, still before any wm data existed:
the forced move commit moved into the primary INTERACTIVE arm, H-WM1 made co-primary with its tokens-matched version,
retrieval seeds made one explicit n=1 request per sample, the move regex no longer rejects >64-move replies, notes are read by
JSON decoding, the generation-tail check added to both preflights, library provenance labelled (base vs gen-1) and the
retrieval wording made neutral, durable per-round receipts with `--resume`, analysis/reporting gaps closed, and the
code pinned (section 9).
Scripts: `lab/wm_*.py`, `lab/wm_run.sh`, `lab/wm_manifest.sha256`. Mac dry run: `lab/wm_dryrun.py`.

## 1. Background
Labels: RAN means checked against pulled data. INFERRED means an estimate.

- RAN: base, single-shot, sampled, thinking on, 16384 tokens, holdout128, lenient scoring:
  - 96/512 in CONFIRM-2 and 89/512 in FORCED-1, about 18-19% per sample.
  - 217 and 229 of 512 samples hit the token cap.
  - Forcing an answer after truncation rescued 0/229. The model restarts its analysis instead (210/229 NOPLAN).
  - 146/512 samples end in an illegal move.
- RAN: only 48/512 base samples (9.4%) finish within 4096 tokens; 31.6% finish within 8192 (`sampled_base.json`).
- INFERRED: the two bottlenecks are:
  - **State tracking**: illegal moves, and re-parsing the grid in its head.
  - **Search length**: running out of tokens before an answer.

  An external simulator holds the exact state and checks legality for free, so the model only has to choose the next few moves. This is the ARC-3 interactive loop and the ULHF "Δ" step (what changed after each action), applied to Sokoban.
- "Aura chain" library: verified solves by this model family (50 by the base model, 37 by gen-1) are stored and recalled as worked examples. Verified-only; the verifier is the sole admission path.

## 2. Arms
All arms: base Ornith-1.5-35B-A3B @10fbf86f, vLLM 0.30.0, thinking ON, `holdout128.json` (sha256 9dd07cd7…), **n=2** samples per board, T=0.6, top_p 0.95, top_k 20, max_model_len 20480.

| arm | command / tag | protocol |
|---|---|---|
| NORET | `wm_retrieval_eval.py … none` / `base_noret_n2` | Single shot, 16384 new tokens. The prompt is exactly `prompts.solve_prompt`. Every sample is its own n=1 request with seed 20261010 + 1000·i + 500 + j (board i, sample j). |
| RET | `wm_retrieval_eval.py … retrieval` / `base_ret_n2` | Identical to NORET, including seeds. The prompt is prefixed with "Here are two similar puzzles with verified solutions:" plus 2 library entries (board + `{"moves": …}`), then "Now the new puzzle.", then `solve_prompt`. |
| INTERACTIVE | `wm_interactive.py --commit-on-truncate` / `base_n2` | Multi-turn protocol, section 2.1, including the forced move commit. |
| WMMAX (exploratory extra) | `wm_interactive.py --commit-on-truncate --notes` / `base_wmmax_n2` | INTERACTIVE plus notes: the JSON may carry a `note` of up to 300 characters, which the harness echoes back every turn as persistent memory written by the model. Not part of H-WM1 or H-WM2. WMMAX vs INTERACTIVE isolates the notes. |

Why the commit is in the primary arm (RAN): only 48/512 base single-shot samples finish within 4096 tokens. Without a commit, a
turn that reaches 4096 tokens yields no move, and H-WM1 would mostly test whether the model closes thinking within 4096
tokens, not whether the simulator helps as working memory. The no-commit variant is not run: INTERACTIVE round 1 has the same
prompts and seeds it would have, and every turn records `think_closed` and `committed`, so the model's own close rate is
measured anyway.

Seeds. The retrieval seeds no longer depend on vLLM's internal child-seed rule for n > 1 (V1 gives child k the seed
parent + k, which would give sample 1 of board i the seed of sample 0 of board i+1). The +500 offset keeps them disjoint from
the interactive seeds 20261009 + 1000·episode + turn (turn ≤ 12).

Run order (`wm_run.sh`): NORET, then INTERACTIVE, then RET, then WMMAX. The comparator runs first, so a stop after stage 2
still leaves H-WM1 testable. Before each stage the driver waits until no v7 or other GPU job is running, and the GPU must read
free on 3 consecutive checks 30 s apart; it logs the blocking processes while waiting and never kills anything. Retries:
- a stage that fails and left its final receipt is not retried;
- an interactive stage whose `turns.jsonl` exists is retried with `--resume` (at most 3 tries in all, any wall time). The
  resume replays every logged turn through the same pure `apply_turn` (asserting each replayed turn record equals the stored
  one) and continues with the next round under the same seed rule. A resumed episode is protocol-identical; only the batch
  composition of later rounds differs, which is already not bit-identical (section 8);
- any other failure within 600 s without a receipt is retried once, with the same seeds;
- any other failure is logged and the next stage runs.
The driver refuses to start unless `WM_PREREG_SHA` equals the sha256 of this file (copied next to the scripts). It writes
`out/wm_STATUS.json` after every stage and `out/wm_DONE.json` (stage exit codes, tries, UTC times) as its last act.

### 2.1 Interactive protocol (`wm_interactive.py`)

**Opening message.** RULES + board + protocol text (the `initial_prompt`). The protocol text tells the model:
- think briefly;
- end each reply with exactly one `{"moves": "<1-8 of UDLR>"}` or `{"moves": "RESET"}`;
- coordinates are (row, col), 0-indexed;
- the limits are 12 replies and 64 applied moves;
- thinking is cut at about 4000 tokens per reply;
- earlier thinking is not shown again.

**Each turn.**
- Thinking ON, at most 4096 new tokens.
- Parse: the **last** `"moves":"…"` value after `</think>` matching `[UDLR]+|RESET`. This is the `posthoc_lenient` regex family without its 64-character cap, so a long reply is clipped, never rejected.
- More than 8 moves: only the first 8 are used (recorded as clipped). The observation and the assistant history echo at most the first 64 requested moves.
- **Forced commit.** A turn that hits 4096 tokens without closing thinking is continued greedily, in the same engine, from `…\n</think>\n\n{"moves": "` for up to 16 tokens, stopping at `"`. The leading `RESET|[UDLR]+` of that continuation is the turn's move string (recorded as `committed`). This is the untested FORCED-1 variant; its tokens count as generated tokens and its prompt as prefill.
- Notes (WMMAX only): the note is read from the JSON object whose `moves` equals the parsed value, found by decoding JSON at every `{` (so braces inside the note are fine). A note that is present but does not decode is reported in the observation and the previous note is kept.
- `strict_format` is recorded for every turn but never scored.

**Applying moves.**
- Moves are applied with `sokoban.step` from the current state.
- At the first blocked move the harness stops, reports ILLEGAL@i (0-indexed within the reply) and keeps the legal prefix.
- It also stops the moment both boxes are on goals, so the scored path is exactly the solving prefix.
- That path is re-verified with `sokoban.verify` on the original board. An assert fails the run on any disagreement.

**Harness reply.** It contains:
- what was sent and what was applied;
- a Δ line with the net displacement of the player and each box, in (row, col);
- the new board, in the same alphabet as the prompt;
- moves so far (since the start or the last RESET);
- boxes on goals x/2;
- move budget used x/64;
- replies left;
- resets left.

**RESET.** Restores the start board. At most 2 per episode. Each one costs a turn; a third is refused and still costs the turn.

**Episode end.** The first that applies, in this order:
1. solved;
2. 3 consecutive turns with no valid move JSON;
3. 64 applied moves in total (the last turn is clipped to the remaining budget);
4. 12 turns;
5. context limit, when the prompt leaves fewer than 512 tokens. The worst case is 4614 stand-in tokens, so this should never trigger.

**Context sent each turn.**
- The first user message, with the observations of all turns older than the last 3 appended to it.
- Then, for each of the last 3 turns, an assistant message holding that turn's final JSON only, followed by a user message holding the harness observation.
- Thinking text is never sent again.

**Batching and seeds.** One `llm.generate` call per round covers all live episodes, with per-request seed 20261009 + 1000·episode + turn. The forced commits of that round go in one more `llm.generate` call (greedy).

**Durable receipts.** After every round, every applied turn (episode, case id, sample, turn, seed, full text, commit text,
finish, token counts, `ckpt_chars`, and the turn record) is appended to `out/wm_interactive_<TAG>.turns.jsonl` and fsynced.
`.partial.json` holds progress plus the summaries of finished episodes; if the run dies it is rewritten with stage
`incomplete` and the error. The final `.json` / `.raw.json` are written at the end.

### 2.2 Library (`wm_library.jsonl`)
- **87 entries**, sha256 `0db7553d272aefb67af741fa617a48434252fab689986f219216bfbc444a2895`.
- Sources: `v5_corpus` (50, generated by the **base** model; `model: base`) and `v6_corpus` via=self (37, generated on the **gen-1** weights; `model: gen1`). Each was selected as the shortest verified-OK trace (≤ 12288 tokens) of k=4 (`selection: shortest_ok_of_4`). The RET prompt therefore says "similar puzzles with verified solutions", not "you solved".
- Excluded: hint_rationalized (12, hint-contaminated) and replay_gen1 (50, duplicates).
- Every entry re-verifies OK. 0 entries overlap holdout128, holdout_v7 or holdout32 (canonical id, all 8 symmetries).
- Plans are the solving model's own, on average 2.1 moves longer than the oracle.
- Oracle lengths: 22 at ≤8, 50 at 9-16, 12 at 17-24, 3 at 25-29. The library is skewed toward easy boards.

**Retrieval.**
- Nearest neighbours by a fixed L1 distance over 11 board-only descriptors: box-goal matching distance, interior walls, player-box distance, box-box and goal-goal distances, wall adjacency, corner boxes, reachable area/4, pushable (box, dir) pairs, boxes on goal.
- The weights are hand-set and nothing is fitted.
- Ties are broken by canonical id.
- The query's own canonical id is excluded, and the library is asserted disjoint from the eval set.
- On holdout128, 69 distinct entries are used. The most reused entry serves 17 boards.

## 3. Hypotheses and decision rules
All tests: one-sided exact sign test over the 128 boards, paired by id, ties dropped.

- **H-WM1 (co-primary):** y = number of lenient-OK NORET samples on the board (0..2).
  - (a) x = number of solved INTERACTIVE episodes (0..2);
  - (b) tokens-matched: x = number of INTERACTIVE episodes solved within ≤ 16384 cumulative generated tokens (turns + commits), the single-shot budget.
  - **SUPPORTED iff (a) p ≤ 0.05 AND (b) p ≤ 0.05.** If only (a) passes, the result is reported as a compute-unmatched gain, NOT SUPPORTED.
- **H-WM2:** per board, x = RET lenient-OK (0..2) and y = NORET lenient-OK (0..2). **SUPPORTED iff p ≤ 0.05.**
- **NOT EVALUABLE** if a needed receipt is missing, or if a comparability assert in `wm_analyze.py` fails (stage final, set sha, n, sampling config and per-sample seeds, case order, the interactive configs named in section 2, one prereg sha across receipts).
- **Multiplicity.** The decision rules are uncorrected: this is exploratory, and any single p ≤ 0.05 is hypothesis-generating only. With three main tests (H-WM1, H-WM2, WMMAX vs NORET) at 0.05 the chance of at least one false positive is about 0.14. Holm-adjusted p-values over those three are reported next to the raw ones (H-WM1 enters with p = max of its two parts).
- Wins needed for p ≤ 0.05:

  | non-tied boards | wins needed |
  |---|---|
  | 10 | 9 |
  | 15 | 12 |
  | 20 | 15 |
  | 25 | 18 |
  | 30 | 20 |
  | 40 | 26 |
  | 50 | 32 |
  | 60 | 37 |

- Secondary and exploratory measures. They carry a bare p-value or a number, never a verdict, and never change one:
  - same-scoring-rule H-WM1: the interactive harness stops at the solving move, so the NORET plans are also rescored as solved if any prefix before the first blocked move solves (`solved_at_prefix`), and H-WM1 (a) is repeated against that;
  - solves per 1M generated tokens and generated tokens per solve, for every arm (NORET, RET, INTERACTIVE, WMMAX), with a 95% bootstrap CI over boards (2000 resamples, seed 20261011), plus prompt (prefill) tokens per arm;
  - results by band;
  - interactive end reasons, illegal-move turns, and truncated / think-closed / committed / strict-format turn rates per interactive arm;
  - RET vs NORET on strict;
  - WMMAX vs NORET (unmatched and tokens-matched), and WMMAX vs INTERACTIVE (the notes effect).
- `wm_analyze.py` computes everything above from the receipts. It was exercised on mock receipts in the dry run. `wm_analysis.json` carries `evidence_class: EXPLORATORY`; only H-WM1 and H-WM2 carry a verdict, worded SUPPORTED / NOT SUPPORTED.

## 4. Evidence class: EXPLORATORY
- holdout128 has already been evaluated many times (CONFIRM-1, posthoc, CONFIRM-2, FORCED-1), and its seed is in the lab code. Nothing has ever been trained on it: it is excluded by canonical id from the v5/v6 pools, the v7 CP data and this library.
- The design constants were set before any wm output existed and were not tuned on holdout128 outputs. They are: 4096 tokens per turn, 8 moves per turn, 12 turns, 64 moves, 2 resets, last-3 history, prompt wording, library features and weights.
- **A positive H-WM1 or H-WM2 is not a finding until it is confirmed** on a fresh sealed set with the same sha-pinned scripts and a new preregistration. The fresh set needs a new secret seed and exclusion by canonical id from every board on disk (the `v7_seal.py` procedure).
- `holdout_v7` is never used by any wm script. `load_set` refuses it by name and by canonical-id overlap.

## 5. Compute estimate (INFERRED unless marked RAN)
- RAN throughput: 128 concurrent ≈ 4.3k generated tok/s (confirm_base: 1,477,287 tokens in 343.6 s); 512 concurrent ≈ 5.7k tok/s (CONFIRM-2 sampled_base: 5.93M in 1040 s); v7 eval_base 576 samples in about 19 min. Engine init RAN 60-90 s.
- At 256 concurrent requests, assume about 5k tok/s.

| stage | estimate |
|---|---|
| preflights + library rebuild | ~3 min CPU |
| NORET | 256 × ~11.6k tokens ≈ 3.0M tokens: about 10-13 min generation, 12-16 min total |
| INTERACTIVE | Each round is at most 256 × 4096 ≈ 1.05M tokens, about 3.5-4 min, plus the commit pass. With the commit, truncated turns no longer end episodes after 3 rounds; unsolved episodes run to the 64-move budget or 12 turns. Estimate 15-55 min (central 35-45). |
| RET | about 12-16 min |
| WMMAX | about 15-55 min |
| total | about 1.0-2.5 h of H200 (central ~1.8 h). |

Cost, stated cumulatively (the box has billed since 04:26Z at about $5.4/h; v7 ended 09:52Z, RAN, and the GPU has been idle
since): about $30.5 at 10:05Z. If the wm stages start about 10:20Z, ALL_DONE falls about 11:20-12:50Z, i.e. about **$37-45
cumulative** (central about $42), which likely passes the original $40 cap; Peter removed the auto-stop (AMENDMENTS,
16:41 local). After ALL_DONE nothing else is queued: the box keeps billing until someone stops it (a fresh Nebius login is
needed), so an idle night would cost about $60 more. The Mac-side `wm_watch.sh` raises a notification on ALL_DONE, failures,
long GPU waits and stale logs.

## 6. Power (INFERRED; simulation with per-board base rates taken from sampled_base + forced_base, 8 samples per board; 2000 replicates)
These numbers are for one sign test (H-WM1 (a) or H-WM2). The co-primary H-WM1 needs both (a) and (b); its power is at most
the smaller of the two and was not re-simulated (the interactive token distribution is unknown before the run).
- Under the null, the rejection rate is 0.04.

| true per-sample effect | power |
|---|---|
| +0.05 absolute | 0.48 |
| +0.10 absolute | 0.93 |
| odds ratio 2 | 0.73 |
| odds ratio 3 | 0.98 |
| ×1.5 relative | 0.85 |

- 59/128 boards had 0/8 base solves.

## 7. Predictions (Claude, locked with this file, graded afterwards)
Revised before any wm data existed, because the arms changed (commit in the primary arm, co-primary rule).
- **P(H-WM1 SUPPORTED, co-primary) = 0.20.** P((a) alone p ≤ 0.05) = 0.35.
  - Expected INTERACTIVE solved: 40-80 of 256; solved within 16384 tokens: 25-55. NORET: 40-55 of 256.
  - Expected: thinking closes within 4096 tokens on 15-40% of turns; at least 40% of turns are forced commits; `unparseable_x3` endings under 10% of episodes.
- **P(H-WM2 SUPPORTED) = 0.12.** Expected RET within ±10 of NORET (of 256). Move-only examples of a different board carry little transferable plan.
- **WMMAX (exploratory): P(WMMAX > NORET at p ≤ 0.05) = 0.35; P(WMMAX > INTERACTIVE at p ≤ 0.05) = 0.10** (notes alone are a small change). Expected more turn-limit and move-budget endings than solved endings on 33-48.

## 8. Known confounds and risks
- **Compute is not matched.** INTERACTIVE may use up to 12 × (4096 + 16) ≈ 49k generated tokens per episode, against 16k for single-shot, and re-sends a prompt of up to about 5k tokens every turn. This is why H-WM1 is co-primary with its tokens-matched version, and why prompt tokens and solves per 1M tokens are reported for every arm.
- **Scoring rule.** The interactive harness stops at the solving move; single-shot `verify` scores the final state. The NORET any-prefix rescoring secondary uses one rule for both (RAN on the pulled single-shot plans: 0 of 173 parseable plans solve at a prefix and then fail, so the effect is expected to be negligible).
- **The treatment is a package.** It combines simulator legality checking, the Δ line, the re-rendered board, the turn structure and the history policy. A positive H-WM1 does not say which part helped.
- **Clipping.** A reply with more than 8 moves is clipped, not rejected. Rejecting would have turned a format choice into failures, the CONFIRM-1 lesson.
- **Reproducibility.** Per-request seeds fix the sampling, but MoE numerics depend on batch composition. Re-runs are not bit-identical (AMENDMENTS: ±5/128 across engines).
- **Retrieval.** The library is small and easy-skewed. One entry serves 17 boards.
- **Chat template.** The multi-turn rendering under the real Ornith template is checked only by the box preflight (CPU, real tokenizer). Both preflights assert that the generation tail is one string that ends with `<think>` (the v7 box preflight logged `"<|im_start|>assistant\n<think>\n"` for this template, RAN) and that the worst-case prompt fits. The Mac dry run used a mock template (passes) and a Qwen2.5 stand-in, whose tail has no `<think>` and which the check refuses, as intended.

## 9. Files and pins
- Box: `wm_common.py`, `wm_interactive.py`, `wm_retrieval_eval.py`, `wm_library.py`, `wm_analyze.py`, `wm_library.jsonl`, `wm_library.meta.json`, `wm_run.sh`, plus the unchanged shared `sokoban.py`, `prompts.py`, `v5_common.py`, `posthoc_lenient.py`. The shared files' hashes equal `v7_manifest.sha256`. This file is copied next to them; `wm_run.sh` refuses to start unless its sha256 equals `WM_PREREG_SHA`, which every receipt head and `wm_analysis.json` record.
- `lab/wm_manifest.sha256` pins every box file above. Its own sha256 at lock: `10a77aebab65d4f252a6816a8ffd7d2fb3603d34a045ef08a3a9fa07d0855fe8`. `wm_analyze.py` sha256: `85c15d01e039a1f62b7131559dcc0d590ac2db1c112f9383a7ffd87b77539cff`.
- Lock procedure: commit this file to `ledger/prereg/wm_PREREG.md`, append its sha256 to `ledger/AMENDMENTS.md`, then launch with `WM_PREREG_SHA=<that sha>`.
- Mac only: `wm_dryrun.py`, `wm_watch.sh`, `wm_laya_export.py` (+ `wm_laya_export.jsonl`, `.corpus_pass_only.jsonl`, `.report.json`), `wm_capture_spec.md`, this file.
