# PREREG v7: thinking-mode consequence-prediction aux + forced-answer eval on a new sealed set

Status: LOCKED. It locks when the lead (1) settles the comparator note in section 6.6, (2) fills in the predictions in section 7, (3) records the holdout_v7 sha256 in section 8, and (4) commits this file to `ledger/prereg/` **before** `v7_run.sh` starts. After that, changes go in `ledger/AMENDMENTS.md` (append-only).
Drafted 2026-10-03 by Claude (code author); revised the same day after review (grouped CP updates, thinking-mode CP traces, forced-answer rule, run order, deadline margins, manifest, preflight). Scripts: `lab/v7_*.py`, `lab/v7_run.sh`, `lab/v7_manifest.sha256`.

## 1. Background (labels: RAN = checked against data; INFERRED = not checked)
- RAN: on holdout128 the base model scores 11/128 strict and 21/128 lenient. Gen-1 scores 22 strict (greedy). Most of gen-1's CONFIRM-1 gain is answer-format learning (AMENDMENTS).
- RAN: CONFIRM-2 (holdout128, sampled n=4, lenient), totals out of 512: base 96, gen2 102, gen1 77. Strict: base 42, gen2 101, gen1 76. Paired per board on lenient, base beats gen1 on 32 boards and loses on 19 (one-sided p=0.046, post hoc). 217/512 base samples hit the 16384-token cap (`pulled/out/sampled_*.json`, `pulled/confirm2.log`).
- Task facts (not re-derived here): about 40/128 failures are illegal moves, about 50/128 hit the token cap, and the 33-48 band has 0 solves.
- RAN: greedy vLLM is not reproducible across engine instances (gen2: 19 vs 23). Sampled evals with a fixed seed are treated as noisy too.
- RAN: the model's own thinking traces track state explicitly, move by move, in (row,col) coordinates, e.g. "Move 10: R, player (2,4)->(2,5). (2,5) floor. Valid." (`v5_corpus.json`, probe tails).
- INFERRED: two failure modes are being targeted. (a) The model keeps a wrong board state while it thinks, which gives illegal moves. Thinking-mode consequence-prediction (CP) training should help. (b) The model runs out of tokens before answering. Forced answering measures how much of that is lost answers rather than lost planning.

## 2. Arms (all thinking ON at eval)
| arm | weights | training |
|---|---|---|
| base | Ornith-1.5-35B-A3B @10fbf86f | none |
| gen1 | base + `v5_adapter`, merged (`/dev/shm/merged_gen1`, left by CONFIRM-2; rebuilt by `rebuild_gen1.py` only if absent) | v5: 50 verified self-traces, 1 epoch (epoch rule misfired), 50 optimizer steps, LoRA r16/a32 on 100 attention modules |
| v7 | base + fresh LoRA (same 100 targets, r16/a32, AdamW 1e-4, clip 1.0), merged to `/dev/shm/merged_v7` | exactly 2 epochs over 650 rows: `v5_corpus.json` (50 thinking traces) + `v7_cp.json` (600 CP items). **All rows use enable_thinking=True.** Optimizer step units: 1 trace per unit; 6 CP rows per unit (gradient accumulation, each loss/6). Per epoch 50 trace + 100 CP units = 150 optimizer steps; 300 in total; 1300 forward/backward rows. Units shuffled with `random.Random(20261007+epoch)`; `torch.manual_seed(20261007)` before LoRA init. Prompt masked; HF mean loss over target tokens per row. Rows right-padded to a multiple of 128 with labels -100 (causal model, no effect on real positions; bounds kernel-shape count). |

The CP data (`v7_cp_data.py`, seed 9120261003) has 600 distinct procedural boards, disjoint from holdout32 and holdout128. Each prompt is RULES + board + a move string of length 3-12 + the task text: "Simulate these moves step by step. Reply with only the final 8-line board, or ILLEGAL@i where i is the first (0-indexed) move that is blocked." The target is a thinking-mode trace written in the model's own verification style (a start line with player, boxes A/B and goals; one line per move such as "Move 7: L, player (2,4)->(2,3). (2,3) box A. Push to (2,2). (2,2) goal. Valid. Player (2,3). Box A on goal (2,2)."; it stops at the first blocked move), then `\n</think>\n\n`, then the answer: the exact `sokoban.step` final board or `ILLEGAL@i`. Mix: 150 random legal walks, 50 legal walks ending with the player or a box on a goal, 100 oracle-solution prefixes, 150 illegal by wall bump, 150 illegal by blocked push. Boards and move strings are identical to the first (non-thinking) draft; only the task text and the target format changed. An independent char-grid checker parsed every trace line and re-simulated every item: 600/600 fully verified (dry run). Stand-in tokenizer (Qwen2.5) estimate: CP targets about 190k tokens per epoch against about 206k for the 50 traces.

The epoch-1 adapter (`OUT/v7_adapter/epoch1`) is diagnostic only. Any eval of it is exploratory and cannot change the H1 verdict.

## 3. Sealed eval set
`holdout_v7.json` has 144 boards: 64 at depth 8-16, 64 at 17-32 and 16 at 33-48. It is built by `v7_seal.py` **after** `v7_cp.json` exists. The RNG seed comes from env `V7_SEAL_SEED`, which is never stored or printed. A relative output path resolves to `lab/`; the real seal must be `lab/holdout_v7.json` with a non-public seed; anything else needs `--scratch` and is a dry run. Exclusion is by canonical id (all 8 symmetries) and covers:
- holdout.json
- holdout128 (an exact replay of confirm.py, asserted equal to `confirm_base.json` ids and bands)
- the v7 CP boards
- the probe easy boards
- every pool board in the attempts/pool receipts and v6_A
- every 8x8 grid found anywhere in pulled/**, the run-dir JSON(L), ledger/** and lab/** JSON

## 4. Eval protocol (`v7_eval.py`, identical for all arms)
- Sampling: n=4 samples per board, T=0.6, top_p 0.95, top_k 20, seed 20261007, thinking on, max_tokens 16384, max_model_len 20480.
- **Forced answer**: a sample is forced iff `finish_reason=='length'` **and** its text contains no `</think>` (it never closed thinking). It is continued in the same engine from `prompt + sample_text + "\n</think>\n\n"`, greedy, 96 tokens. Every other sample (stopped, or truncated after it had already closed thinking) keeps forced = raw. Forcing therefore can never lower a verdict; `lenient_lost` (raw OK, forced not OK) is counted and must be 0 (asserted in `v7_analyze.py`).
- Scoring per sample:
  - strict = `v5_common.score`
  - lenient = `posthoc_lenient.lenient`, then `sokoban.verify`
  - each is scored raw and forced
- Per-board counts, each 0..4: `lenient_ok_raw`, `lenient_ok_forced`, `strict_ok_raw`, `strict_ok_forced`.
- Receipts: `OUT/v7_eval_<arm>.raw.json` (full sample texts and raw verdicts) is written right after sampling, before the forced pass. `OUT/v7_eval_<arm>.json` is the final receipt. Both carry the sampling and forcing configs, the sha256 of `v7_eval.py`, `posthoc_lenient.py`, `v5_common.py`, `sokoban.py`, `prompts.py`, and the vllm/torch/transformers versions. `v7_eval.py` refuses to overwrite either receipt. `v7_analyze.py` refuses receipts whose sampling config, forcing config or code hashes differ.
- If the forced pass raises, the error is recorded (`forcing_complete=false`, forced = raw for every sample) and the final receipt is still written.

## 5. Hypotheses and decision rules
- **H1 (PRIMARY):** v7 > gen1 on per-board `lenient_ok_forced`.
  - Test: a one-sided exact sign test over the 144 boards, paired by id, ties dropped.
  - **PASS iff p <= 0.05.** There is no other success criterion.
  - If `forcing_complete` is false in the v7 or gen1 receipt, H1 is **NOT EVALUABLE** from this run. The raw-based comparison is reported as secondary only, and any re-forcing from the raw receipts needs an AMENDMENTS entry before it is run.
  - Reference thresholds:
    | non-tied boards | wins needed |
    |---|---|
    | 20 | >= 15 |
    | 30 | >= 20 |
    | 40 | >= 26 |
    | 60 | >= 37 |
- **H2:** forcing rescues >= 5 board-samples for base. A rescue is a sample where `lenient_raw != OK` and `lenient_forced == OK`. Counted in the base receipt. SUPPORTED iff the count is >= 5. NOT EVALUABLE if the base forced pass failed or the base eval did not run (it runs last and is skipped when time is short).
- Re-runs: receipts are never overwritten. Any re-run of an arm is logged in AMENDMENTS with its reason before it starts, and both receipts are kept and reported.
- Secondary measures. These are reported but none of them changes the H1 verdict:
  - the same sign test for v7 vs base and gen1 vs base on `lenient_ok_forced`
  - all three comparisons on `strict_ok_forced` and `lenient_ok_raw`
  - rescue counts (lenient and strict) for each model
  - illegal-move rate (share of samples whose forced lenient verdict is ILLEGAL@i, out of all samples and out of samples with a plan)
  - totals per band
  - truncation counts (also truncated-after-`</think>`), forced counts and mean tokens
  - training losses and pre-clip gradient norms split into trace and CP (`v7_train.json`)

## 6. Known confounds and threats (stated up front)
1. **v7 vs gen1 differs in more than CP.** v7 has 2 epochs on the traces (gen1 had 1) and 300 optimizer steps (gen1 had 50), 200 of them CP steps. A PASS on H1 supports "the v7 recipe beats gen1". It does not show "CP causes the gain". Attributing the gain to CP needs a v7-noCP arm (2 epochs, traces only), which is not in this run.
2. CP targets are synthetic thinking text in a fixed, compact style. Grouping keeps CP to 2/3 of the optimizer steps and about half of the target tokens, but CP may still change the length or style of thinking-mode output in either direction. Mean tokens and truncation are reported for that reason.
3. Sampling noise and engine nondeterminism. The sign test treats each board's 0..4 count as noisy. Results are not bit-reproducible across engine instances.
4. Forced answers can include guesses made without a finished plan. That is why both raw and forced numbers are reported and H1 uses lenient forced.
5. The gen1 weights are a rebuild (base + saved adapter). They are identical up to merge numerics; the gen1 used for CONFIRM-1 is no longer on the box.
6. **Weak comparator (LEAD DECISION BEFORE LOCK).** RAN on CONFIRM-2: gen1 is below base on lenient (77 vs 96 of 512; base wins 32 boards, gen1 wins 19). So v7 > gen1 can PASS just because v7 is damaged less than gen1, with no CP benefit. As written, a PASS supports only "the v7 recipe beats gen1". The v7 vs base test (secondary) is the one that speaks to "better than the untrained model". Before locking, the lead keeps H1 as written or makes v7 > base co-primary (both must pass, no alpha split). Either way the choice is recorded here before launch.

## 7. Locked predictions (TO BE FILLED BY THE LEAD BEFORE LAUNCH)
- P(H1 PASS) = 0.50
- Predicted totals of `lenient_ok_forced` out of 576 (base / gen1 / v7): 120 / 100 / 125
- P(H2 SUPPORTED) = 0.55; predicted base lenient rescues = 8
- Predicted illegal-move rate (forced), base / gen1 / v7: 0.30 / 0.32 / 0.26
- Claude's own predictions: P(v7 > base, p<=0.05) = 0.20; CP training changes mean thinking length by <15%; truncation stays the dominant failure (>30% of samples) for all three.
- Comparator decision (section 6.6): KEEP H1 as written (v7 > gen1); improvement-over-base claims require the secondary v7 > base test (see 6.6 addendum).
- Signed / UTC timestamp: Claude (lead, on Peter's standing GO) 2026-10-03T08:36:11Z

## 8. Run order and hashes
1. Mac: `python3 v7_cp_data.py`. Already done (thinking-mode build); output is `v7_cp.json`.
2. Mac, from `lab/`: `V7_SEAL_SEED=<secret> python3 v7_seal.py holdout_v7.json`, then record its sha256 here: `holdout_v7.json sha256 = 1bc8691b9778d03f284fea56ed419be6d19a522525a6ec0feb41311d54e9866f`.
3. Commit this file to the ledger.
4. Re-arm the Mac watchdog to a deadline that covers the run (see section 9), and restart `pull_loop.sh` at the same time.
5. Copy **only** these files into the box `lab/` with scp (no rsync of the whole directory, no `--delete`; `holdout128.json` exists only on the box): `v7_eval.py v7_train.py v7_run.sh v7_cp.json v7_manifest.sha256 holdout_v7.json posthoc_lenient.py v5_common.py sokoban.py prompts.py rebuild_gen1.py`. Then on the box run `sha256sum -c v7_manifest.sha256` and `sha256sum holdout_v7.json`.
6. On the box: `nohup bash v7_run.sh <watchdog_deadline_epoch> <holdout_v7_sha256> > ../v7.log 2>&1 &`. The script checks the holdout hash and the manifest, runs CPU-only preflights (`v7_train.py --preflight`, `v7_eval.py --preflight`), waits for any GPU job, and then runs: **eval gen1 -> train v7 -> eval v7 -> eval base** (base last and non-fatal). Check `v7.log` for `V7_PREFLIGHT_OK` within about 2 minutes of launch.
7. Pull `out/v7_eval_{gen1,v7,base}.json`, the `.raw.json` files and `v7_train.json`, then run `python3 v7_analyze.py --json v7_analysis.json` on the Mac.

Code sha256 at drafting (any edit after the lock must be logged as an amendment):
| file | sha256 |
|---|---|
| v7_common.py | c2bef01e938ea2302f7e860d6afc92cca36c7a3cb41eb1acf7e9811ca918c681 |
| v7_seal.py | 09d3ce7bf2d956f200c4fa5073588e14e9752b832f2daf23d665643f283838ad |
| v7_cp_data.py | 6f7c37715e9c81013b74904a6fda458cf5b75616505520ee14538916b0193a33 |
| v7_cp.json (file) | 86e6d90ea5c5b1daed31eaabf1fb7ff00ee5f80f32e297a548fe932d986ea729 |
| v7_cp.json (items sha) | 37e084983aeeab7061fb8b782959b2162514ebc8a5f4a125500c9d6da8ec4c35 |
| v7_train.py | 9a4411851d1809516f5727e861dee41a1561bc105db0abb2f0ed101dd10bddde |
| v7_eval.py | b296a7a82ff1dff1333c6dfc8436c5a1b992aacc0dca0dd4ffdb2df07869a01e |
| v7_run.sh | 43fb4e830d4e67d12f1d2f0385da1214e40fdff923a51aa6e0e012734f8c302a |
| v7_analyze.py | aaa7de9f875fd0e2f5c346258a40583825c054a858cd5930abdbe28f4c7b4d08 |
| v7_manifest.sha256 | 6c46705ab362d10ba33d9d5114e238aff6643f9b3d36e453295a6a508bef9450 |
| posthoc_lenient.py (dependency) | 0a8ad1f9cb2d92141fa9c6e27979bae864dec7fc6b9509a3c63beb047f01d5ad |
| rebuild_gen1.py (dependency) | d6c5f19f1de88dc5442c7116aabb785018425b3ce49a3d8666afd54213206eed |
| v5_common.py (dependency) | 6136a8b3b00a1dd6dbb5ff2c393e2e20eb2f0a17a6f7a86296e6605a48fb5025 |
| sokoban.py (dependency) | f860cca985126aafd9da4b130b06e5f26be1a8ba2c3b3947a21c61ec5c38fb31 |
| prompts.py (dependency) | 2f32ef55b9d2d3227bf922285d3a0e0628f7cd55b940a8aa94330b2c8a1e613c |

## 9. Operational notes (INFERRED estimates unless marked RAN)
- Runtime. RAN basis: CONFIRM-2 sampled evals took 1012-1040 s of generation for 512 samples, plus about 1.5 min of engine start. Each v7 eval (576 samples plus the forced pass) is estimated at about 23-25 min. Training is estimated at about 15-20 min including model load, 1300 forward/backward rows, and merge. The H1 chain (gen1 eval + train + v7 eval) is therefore about 65-70 min, and about 95 min with the base eval. At $5.40/h that is about $9.
- Deadline handling. `v7_run.sh` takes the watchdog's own deadline and uses DL = deadline - 15 min, so the last receipt is written at least 15 min before the stop and `pull_loop.sh` (300 s cadence) exports it. A stage starts only if its whole budget fits before DL: eval 1800 s, train 1500 s, and gen1 rebuild 600 s if needed. The H1 chain starts only if all of it fits (5100 s). The train stage also needs train + v7 eval (3300 s). The base eval runs only if 1800 s remain. `v7_train.py` also stops at DL inside its loop and before the merge. With the watchdog still at 17:15, the H1 chain cannot fit and the script exits with `V7_STOP` at once. Re-arm first. The H1 chain needs a watchdog deadline of at least launch + 1h40m (85 min of budget + the 15 min margin). The full sequence including base needs about launch + 1h55m.
- Re-arming. The watchdog needs a valid Nebius token to stop the box. Re-arm only after Peter's re-login (`rearm_on_relogin.sh` waits for it, moves the deadline to 19:15 local, sets an in-VM `shutdown` backstop at 19:25 local, and restarts `pull_loop.sh`). `pull_loop.sh` reads `deadline` only once at start, so any manual re-arm must also run `pkill -f pull_loop.sh; nohup ./pull_loop.sh >/dev/null 2>&1 &`.
- `/dev/shm`: v7_train deletes `/dev/shm/merged_gen1` only if free space is below 70 GiB at merge time. Under the new order that is after the gen1 eval. Before deleting, it checks that `OUT/v5_adapter` matches the `v5_train.json` hashes. Nothing else is deleted. If `/dev/shm/merged_v7`, `OUT/v7_adapter` or `OUT/v7_train.json` already exists, the script refuses to run. The base eval loads from the disk snapshot.

## §6.6 addendum (lead, 2026-10-03 16:33 local, before any v7 data)
CONFIRM-2 showed gen1 is a weak comparator (lenient 77/512 vs base 96/512). Therefore: an H1 PASS (v7 > gen1) is reported only as "the v7 recipe beats gen1". Any claim that v7 improved PLANNING over the untrained model requires the secondary test v7 > base on lenient_ok_forced at p <= 0.05. If base is not evaluated, no improvement-over-base claim is made.
