# PREREG v8: hard-push training on oracle-graded interactive turns, judged on a new sealed set

Status: DRAFT (revision 2, after the 2026-10-03 review; section 12 lists what changed and why). It locks when the lead (1) fills
in section 8 (predictions), (2) regenerates `v8_manifest.sha256` from the final files (section 10; `wm_interactive.py` is still
being finalized by another workflow) and records its sha256 here, (3) gets an explicit budget from Peter for the queue (section 9),
and (4) commits this file to `ledger/prereg/` **before** `v8_run.sh` starts. After that, changes go in `ledger/AMENDMENTS.md`
(append-only). Drafted 2026-10-03 by Claude (code author), before any v8 data existed. Scripts: `lab/v8_*.py`, `lab/v8_run.sh`,
`lab/v8_eval.sh`. Mac checks: `lab/v8_dryrun.py` (mocks only) and `lab/v8_driver_test.py` (driver control flow); RAN, section 11.

## 1. Background (RAN = checked against pulled data; INFERRED = not checked)
- RAN (V7-RESULT): on holdout_v7 (144 boards, n=4, forced answer), lenient_ok_forced of 576: base 132, gen1 159, v7 164.
  v7 > base p=0.019 (secondary). By band (8-16 / 17-32 / 33-48): base 90/42/0, gen1 98/60/1, v7 114/50/0. v7 gained on 8-16 and
  lost on 17-32 against gen1.
- RAN: the v7 trace data was 13 traces under 8 moves, 35 at 8-16 and 2 at 17-32. So v7 was trained almost only on short puzzles.
- RAN: about 39% of samples end in an illegal move, about 27% hit the 16k cap, and base solves about 23% of samples (lenient) on
  holdout_v7.
- RAN: CONFIRM-2 (holdout128) showed gen1 < base on lenient. A v7 > base replication (REP1, holdout_rep1) is running now.
  holdout_rep1 is therefore NOT used here.
- RAN (review): in optimal pool solutions 64% (17-32) and 71% (33-48) of moves are plain walks, and with 8-move optimal turns
  64% of 17-32 turns and 39% of 33-48 turns START within 16 moves of the solve. A board's band therefore says little about how
  hard a late turn is; v8 measures the difficulty of every turn by its own start distance.
- INFERRED: models learn from hard puzzles they do not fully solve if the training signal credits the correct partial steps. The
  environment's exact BFS distance gives that credit at the move level, with no learned or LLM judge.

## 2. What v8 changes
1. **Oracle move grader** (`v8_grade.py`). Exact move distance-to-solve for every state, from a reverse BFS over each layout.
   Each move is labelled progress / neutral / fatal (deadlock) / illegal (plus dead / unknown / unused), and the grader returns
   the sound prefix. It is used only to choose training data and for analysis. Its output never enters a prompt (asserted).
2. **Hard-biased pool** (`v8_pool.json`, seed 1120261003). 160 boards: 40 at 9-16, 80 at 17-32, 40 at 33-48. It excludes every
   sealed set and every earlier pool/CP board by canonical id.
3. **On-policy interactive collection** (`v8_collect.py`). merged_v7 plays each pool board twice in the wm_interactive harness
   (the loop is imported unmodified). Every turn is replayed and graded.
4. **Data** (`v8_build_data.py`). DIFFICULTY of an item = its start state's oracle distance: for a turn, the distance d_before at
   the start of THAT turn; for a full solution, the board's oracle length. HARD = difficulty >= 17, SHORT = difficulty <= 16.
   - (a) GOOD turns. All of: legal; own reply (not a forced commit); strict JSON of 1-8 moves; no overshoot (a solving turn used
     every move it asked for); distance strictly decreased AND reached a new best for the episode (undoing an earlier
     regression does not count); at least one box moved (walk-only turns carry no push decision); efficiency (distance gained
     per applied move) >= 0.75. Target = that turn's thinking + JSON; context = the exact multi-turn messages. Ranked by
     efficiency, then hard start, then pushes, then gain. At most 4 per board, 3 per episode, 480 in all.
   - (b) Verified full single-shot solutions: v8 single-shot n=2 on the pool, plus the 37 gen-1 self-solves in v6_A
     (re-verified strictly; `out/v6_A.json` sha256 checked on the box).
   - (c) v5 replay (50 traces; 48 are short).
   - (d) all 600 v7 CP items (v7's absolute CP dose).
   - Mix rules, over PUZZLE OPTIMIZER UNITS (CP excluded; a turn row is 1/2 unit because turn rows are trained in pairs; a
     single/replay row is 1 unit), enforced together by trimming:
     R1 hard-start turns >= 50% of turn items; R2 turn-1 items <= 1/3 of turn items (turn 1 is the closest structural match to
     single-shot); R3 short units <= 50% of puzzle units (trim order: short replay, seeded; then the worst short turns; then the
     longest short singles). The report gives both the state-band and the board-band mix, the turn-index, push and efficiency
     histograms, and the full-solution share of puzzle units.
5. **Training** (`v8_train.py`). A fresh LoRA on BASE, with the same targets and hyperparameters as v7, exactly 2 epochs.
   Turn rows are paired per optimizer unit (loss/2 each) and CP rows grouped 6 per unit, as in v7. Logged per kind: loss, grad
   norm, and the ANSWER loss (cross-entropy over the tokens after `</think>`, from the same forward pass), so the logs show
   whether short-JSON or full-plan answers are being learned. Every turn row's re-rendered prompt must have exactly the token
   count the model saw at collection (asserted, preflight included).

## 3. Sealed eval set
`holdout_v8.json` has 144 boards: 64 at 8-16, 64 at 17-32 and 16 at 33-48. It was made with `v8_seal.py --auto-seed`; the
seed was drawn in-process and never printed or stored. sha256 = `538c87b9e80c51f33841025d8c44430f9c8d01dfd8a0a568798d2ae96f9a175c`
(RAN 2026-10-03). Its exclusion set has 73,826 ids. It covers:
- by file: holdout.json, holdout128 (replay asserted against confirm_base.json), holdout_v7 and holdout_rep1;
- all pools, v7_cp, probe easy, wm_library and v8_pool;
- s1 board ids;
- every 8x8 grid in pulled/**, run-dir json(l), ledger/** json, and lab/** json + jsonl.

Overlap with every sealed set and with the pool is 0 (RAN). Note: `v7_seal.py`'s own scan skips `holdout_v7*` files. The rep1
seal therefore reached holdout_v7 only through grids in eval receipts (142/144 ids, RAN). Its actual overlap is 0, but v8 reads
every sealed set explicitly. No sealed set (holdout, holdout128, holdout_v7, holdout_rep1, holdout_v8) is ever a training or
pool board; every training item's board and every 8x8 grid in its prompt or target is checked against all of them.

## 4. Arms
| arm | weights | role |
|---|---|---|
| base | Ornith-1.5-35B-A3B @10fbf86f (disk snapshot) | PRIMARY comparator |
| v7 | `/dev/shm/merged_v7` (base + `OUT/v7_adapter`) | champion; CO-PRIMARY and GATE comparator; also the collection policy |
| v8 | base + fresh LoRA trained on `OUT/v8_data.json`, merged to `/dev/shm/merged_v8` | candidate |

## 5. Eval protocol
- **Single-shot** (`v8_eval.py`). This is a literal copy of `v7_eval.py`; `diff` shows only the set, seed, tags, receipt
  prefix, own sha and log prefix. Settings: holdout_v8, n=4, T=0.6, top_p 0.95, top_k 20, seed 20261011, thinking on,
  16384 tokens, forced answer (`\n</think>\n\n`, greedy, 96 tokens) for samples truncated before `</think>`. Per board:
  lenient_ok_forced (0..4) and the other three counts. Receipts: `OUT/v8_eval_<arm>{.raw,}.json`, never overwritten. A run that
  fails without leaving any receipt (engine start) is retried once after the GPU is free again.
- **Interactive** (`wm_interactive.py --commit-on-truncate`, tag `v8i_<arm>`). n=2 per board on holdout_v8, otherwise wm's
  protocol. SECONDARY. Skipped entirely with `V8_NO_INTER=1`, or if a `wm_*` file no longer matches the manifest.
- Order on the box: v7 single-shot, then base single-shot, then (optional) v7 interactive, all **before** v8 is trained (merged_v7
  still exists; base does not depend on v8). merged_v7 may be deleted for the merge only after a final, forcing-complete v7
  single-shot receipt exists; otherwise the driver stops before training. No v8 script reads any eval receipt (v8_build_data
  reads only v8_turns / v8_single / v5_corpus / v6_A / v7_cp / v8_pool), so nothing can flow from the eval into training.

## 6. Hypotheses and decision rules
- **PRIMARY.** v8 > base on per-board lenient_ok_forced. Test: a one-sided exact sign test over the 144 boards, paired by id,
  ties dropped. **PASS iff p <= 0.05.** It is NOT_EVALUABLE if `forcing_complete` is false in the v8 or base receipt.
- **CO-PRIMARY (the test of "graded hard turns help").** v8 > v7 on per-board lenient_ok_forced over the 80 HARD boards
  (bands 17-32 and 33-48), same one-sided exact sign test, ties dropped. **PASS iff p <= 0.05.** NOT_EVALUABLE without final,
  forcing-complete v7 and v8 receipts. v8 inherits the v7 CP dose, so a PRIMARY pass alone could come from v7's recipe; the
  hypothesis that the oracle-graded hard turns teach anything is judged ONLY by this test.
- **PROMOTION GATE (band guard vs the champion v7).** Per band b: d_i = v8_i − v7_i (lenient_ok_forced), D_b = Σ d_i.
  - Hard bands 17-32 and 33-48: **PASS iff D_b >= 0** (point non-inferiority, no noise allowance). Under the paired null this
    false-fails a band with probability about 0.3-0.5 (less on 33-48, where most boards tie at 0); that is the accepted cost of
    a gate that actually catches the v7 failure mode (RAN: the draft margin rule passed the real gen1 → v7 17-32 drop of 60 → 50,
    and passed a hybrid with all of v7's hard-band skill removed).
  - 8-16: PASS iff D_b >= −1.96·sqrt(Σ d_i²) (the sign-flip noise margin; 1.96 is two-sided, so this one-sided check is lenient
    on purpose: the run's aim is the hard bands).
  - The GATE PASSES iff all three bands pass. NOT_EVALUABLE without final, forcing-complete v7 and v8 receipts.
- **PROMOTE v8** (it becomes the champion candidate) iff PRIMARY PASS **and** CO-PRIMARY PASS **and** GATE PASS (an
  intersection-union rule: each test at alpha 0.05, no multiplicity correction needed). Nothing else promotes.
- Planted checks (RAN on the real holdout_v7 receipts, relabelled): the hybrid "v7 on 8-16, base on 17-32/33-48" passes PRIMARY
  (30-15, p=0.018) and passed the draft gate, but FAILS the CO-PRIMARY (17-22, p=0.83) and the GATE (17-32 D=−8) → not promoted.
  v7 plus 20 extra solved samples on 17-32 boards is promoted.
- Secondary measures. Each is reported with a bare p and none of them changes the verdict:
  - v8 > v7 and v7 > base, both on lenient_ok_forced (all boards and hard boards);
  - all comparisons on strict_ok_forced and lenient_ok_raw;
  - band guard v8 vs base;
  - per-band totals, illegal-move rate, truncation, forced and rescue counts, mean tokens (overall and per band);
  - **format bleed** (per arm and band): short_plan = samples whose lenient plan has <= 8 moves on a board whose oracle needs
    > 8 moves, out of such planned samples; and the median plan length / oracle length. A rise in short_plan for v8 against v7
    and base on 17-32 is read as bleed from the 8-move turn format, not as weaker planning;
  - interactive: solved/episodes, per-board solved sign tests (v8 > base, v8 > v7, v7 > base), illegal turns per turn,
    truncated-turn rate, committed turns, solves per 1M generated tokens; receipts that differ in set/config/code/n are
    reported NOT_COMPARABLE;
  - training losses, answer losses and grad norms per kind, the composition of `v8_data.json`, and the collection summary.

## 7. Known confounds and threats
1. v8 differs from v7 in more than one way: data source (on-policy turns plus singles), pool difficulty, the replay mix (most
   short v5 replay is trimmed by R3) and volume: about 500-820 optimizer steps (section 11 projections) at the same constant LR
   1e-4 with no schedule, against v7's 300. A PROMOTE supports "the v8 recipe"; the CO-PRIMARY isolates "v8 beats v7 where v7 was weak", but more steps
   at constant LR remains a confound. The epoch-1 adapter is saved but NOT evaluated (/dev/shm holds one merged model; no
   volume-matched point this run).
2. **Format transfer.** Turn targets are short (≤ 4096-token) thinking blocks ending in an 8-or-fewer-move JSON inside a
   multi-turn protocol; the PRIMARY is single-shot. Mitigations: turn rows count 1/2 unit (paired), turn-1 items ≤ 1/3 of turns,
   and the full-solution share of puzzle units is reported. Detection: the short_plan and plan/oracle secondaries, answer-loss
   logging, mean tokens and truncation.
3. The collection policy is v7, and the turns are distilled into BASE. Positive-only selection (rejection-sampling style) means
   fatal and illegal turns are not used as negatives.
4. Sampling noise and engine nondeterminism (RAN: greedy vLLM is not reproducible across engine instances).
5. The 33-48 band has 16 boards and is near 0 for all arms, so its gate and its share of the CO-PRIMARY are weak by construction.
6. If the collection yields few GOOD hard turns, the trained data is mostly singles + CP and v8 ≈ the v7 recipe; the
   CO-PRIMARY is then expected to fail. The build report states the counts before training starts.

## 8. Predictions (TO BE FILLED BY THE LEAD BEFORE LAUNCH)
- P(PRIMARY PASS) = ___ ; P(CO-PRIMARY PASS) = ___ ; P(GATE PASS) = ___ ; P(PROMOTE) = ___
- Predicted lenient_ok_forced of 576 (base / v7 / v8): ___ / ___ / ___ ; by band for v8: ___ / ___ / ___
- Claude's own (code author, revision 2): P(PRIMARY PASS) = 0.40, P(CO-PRIMARY PASS) = 0.20, P(GATE PASS) = 0.40,
  P(PROMOTE) = 0.12. Base about 125-140 and v7 about 145-170 out of 576. v8 17-32 count ≥ v7's: P = 0.55. v8 mean single-shot
  tokens lower than v7's: P = 0.6. v8 short_plan on 17-32 higher than v7's: P = 0.4.
- Signed / UTC timestamp: ___

## 9. Compute estimates (INFERRED unless marked; one H200; about $5.4/h)
| stage | basis | estimate |
|---|---|---|
| CPU preflights (at launch, while wm runs) | v7 preflights | 3-5 min, no GPU |
| collect interactive (320 episodes, ≤ 12 turns, ≤ 4096 tok/turn) | RAN aggregate decode 5.4-5.7k tok/s at 576-way; about 2.9-3.8k turns × 2.5-3.4k tok = 7-13M tok; 12 synchronous rounds + commits + engine start | 35-55 min |
| collect single (320 samples, 16k) | RAN 576 samples: 954-1109 s gen | 15-20 min |
| post + build + train preflight (CPU) | mock: 2.9k turns post ≈ 40 s | 3-6 min (GPU idle) |
| eval single-shot, per arm (576 samples + forcing), × 3 (v7, base, v8) | RAN v7 eval wall 1066-1248 s | 18-21 min each |
| eval interactive, per arm (288 episodes), × 3, optional | scaled from collection | 28-45 min each |
| train v8 (2 epochs; turn pairs + 600 CP) | RAN v7 fit: s/row = 0.62 + 1.79e-4·seq_len; CP unit 2.57 s; projections 21-40 min (section 11); load + merge 4-6 min | 25-50 min |

- Core path (PRIMARY + CO-PRIMARY + GATE; `V8_NO_INTER=1`): about 2.4-3.2 h of wall (about 130-190 GPU-busy minutes),
  about $13-18.
- Everything (three interactive evals): about 3.9-5.5 h, about $21-30.
- Queue ahead of v8 on the box (INFERRED): the rest of REP1, then wm (wm_PREREG: 1.0-2.5 h). s1 (about 0.7 h) runs after v8
  (section 10). At about $5.4/h since 12:26 local the box passes $40 near 19:50 local. **The lead must get an explicit new budget
  or cap from Peter before launch** (the $40 cap in the brief was never amended; AMENDMENTS 16:41 only removed the auto-stop).
  If the cap stands, run the core path only (`V8_NO_INTER=1`) or skip v8.
- The driver's BUDGET_s clock starts at the first GPU_FREE after WAIT_FOR_FILE, not at launch. Core path stage budgets sum to
  15,000 s; every later stage re-checks the remaining budget after its GPU wait and STOPs cleanly (exit 3, re-launchable) when
  the chain no longer fits.

## 10. Run order, files, hashes
1. Mac (done): `python3 v8_pool.py` → `v8_pool.json` sha256 `12800c3c310a195102fd0052b5e6ae0d046dcbd3cf35b7b46590cc9c2a3ced0a`.
2. Mac (done): `python3 v8_seal.py holdout_v8.json --auto-seed` → section 3 sha.
3. Mac: `python3 v8_grade_test.py` (12 tests), `python3 v8_driver_test.py <scratch>` and `python3 v8_dryrun.py <scratch>`.
4. Mac, at lock (after wm_interactive.py is final): regenerate the manifest from the final files:
   `shasum -a 256 v8_common.py v8_grade.py v8_collect.py v8_build_data.py v8_train.py v8_rebuild.py v8_eval.py v8_analyze.py v8_run.sh v8_eval.sh v8_pool.json holdout_v8.json v7_common.py v7_train.py v7_cp.json wm_interactive.py wm_common.py sokoban.py prompts.py v5_common.py posthoc_lenient.py > v8_manifest.sha256`
   Then record `shasum -a 256 v8_manifest.sha256` here: ___
5. Commit this file to `ledger/prereg/`.
6. scp **only** the files listed in the manifest plus `v8_manifest.sha256` into the box `lab/`. Do not rsync, and do not use
   `--delete`. `holdout128.json` exists only on the box. Then on the box run `sha256sum -c v8_manifest.sha256`, and check
   `sha256sum out/v6_A.json` = `12e83c447810c20f722ae3193608177d2f952c90609967240cf899dda7501fef` (the driver also checks it).
7. Box, any time after the files are in place (the driver preflights on CPU, then waits for `out/wm_DONE.json`, then for a free
   GPU; the 4.5 h budget starts at that first GPU_FREE):
   `cd /mnt/glm-data/aukora-run/lab && V8_NO_INTER=1 nohup bash v8_run.sh 16200 538c87b9e80c51f33841025d8c44430f9c8d01dfd8a0a568798d2ae96f9a175c /mnt/glm-data/aukora-run/out/wm_DONE.json > /mnt/glm-data/aukora-run/v8.log 2>&1 &`
   (drop `V8_NO_INTER=1` and use 24000 for the three interactive evals if Peter approves the extra ~1.5-2.3 h). Check `v8.log`
   for `V8_PREFLIGHT_OK`, then `V8_WAIT_FOR_OK`, `V8_DL_SET`. Re-launch the same command after a STOP or a fixed FAIL: stages
   with receipts are skipped.
   - Do NOT launch or restart `wm_run.sh` while `v8_run.sh` is alive (wm does not wait for v8).
   - s1: `s1_run.sh` waits while any `v8_` process exists, so a queued s1 runs after v8 finishes. To run s1 first instead,
     launch v8 only after s1's receipt exists (never launch v8 with WAIT_FOR = an s1 receipt while s1 waits: that deadlocks).
     v8 does not list `s1_run.sh` (that would deadlock with s1's own wait); it does wait for `s1_ornith_eval.py` and any GPU app.
8. Pull `out/v8_*`, `out/wm_interactive_v8*`, `out/v8_analysis*.json` and `out/v8_train.json`. Then on the Mac:
   `python3 v8_analyze.py ../pulled/out --holdout-sha 538c87b9...`.

`/dev/shm`: v8_train deletes `/dev/shm/merged_v7` only if (a) `--free-merged-v7` is passed (v8_run.sh passes it only after a
final, forcing-complete `v8_eval_v7.json` exists), (b) free space is short of what the merge needs, and (c) `OUT/v7_adapter`
matches the v7_train.json adapter hashes (RAN against the pulled copy). v7 can be rebuilt with
`python v8_rebuild.py OUT/v7_adapter /dev/shm/merged_v7`.

## 11. Dry-run record (RAN on the Mac, mocks only, 2026-10-03, revision 2)
- `v8_grade_test.py`: 12/12. `py_compile` on every v8_*.py and `bash -n` on v8_run.sh / v8_eval.sh: OK.
- `v8_dryrun.py` (193.6 s; mock models, real pool, real v5_corpus / v6_A / v7_cp):
  - collection: wm_interactive.main on the real pool, 320 episodes, 2,892 turns; post replays every turn exactly (grader/harness
    agreement asserted on every turn);
  - build (mock policy, illustrative only): 2,892 turns → 641 GOOD under the new rules (draft rules: 1,150; new rejects: 402
    walk_only, 96 no_new_best, 7 overshoot, 4 inefficient) → 527 after per-board/episode caps → 366 turn items (start-state
    bands <9: 83, 9-16: 94, 17-32: 169, 33-48: 20; board bands 9-16: 58, 17-32: 188, 33-48: 120; hard-start 51.6%; turn-1
    9.6%; median d_before 17; pushes per turn 1-5, walk-only 0) + 88 singles + 2 replay + 600 CP. R3 trimmed 48 short replay
    and 12 short turns: short units 50.0%, full-solution units 33.0% of puzzle units. 373 optimizer units per epoch (turn 183,
    single 88, replay 2, CP 100). Every selected turn replay-checked against the harness log (366/366).
  - train preflight (mock tokenizer): ptok re-render check on 366/366 turn rows; answer offsets found on every row. REAL 2-epoch
    LoRA mini-run (Qwen2.5-0.5B stand-in, CPU): 10 optimizer steps (paired turn units), answer loss logged on 32/32 rows,
    adapter + epoch1 + merge. merged_v7 deletion guard OK on the pulled v7_adapter.
  - eval: v8_eval.py (unchanged) for 3 arms on a scratch seal with forcing; interactive for 3 arms; v8_analyze PRIMARY /
    CO-PRIMARY / GATE / PROMOTE consistency; synthetic gate failure → FAIL; missing v7 → NOT_EVALUABLE; an interactive receipt
    with a different code sha → NOT_COMPARABLE (analysis still written).
  - PLANTED on the REAL holdout_v7 receipts: hybrid (v7 on 8-16, base elsewhere) → PRIMARY PASS 30-15 p=0.018, CO-PRIMARY FAIL
    17-22 p=0.83, GATE FAIL (17-32 D=−8), PROMOTE false (the draft gate passed all three bands). v7 + 20 solved samples on
    17-32 → PRIMARY 62-29 p=0.0004, CO-PRIMARY 20-0, GATE PASS, PROMOTE true.
- `v8_driver_test.py` (≈20 s; the REAL v8_run.sh + v8_eval.sh with a simulated clock, GNU-tool shims and stub stages), all pass:
  happy path (DL set at the first GPU_FREE after wm_DONE, not at launch; order collect → single → post → build → eval v7 →
  eval base → v7 interactive → train with --free-merged-v7 → eval v8 → analyze → interactive v8/base → analyze); resume (every
  stage skipped); v7 single failing twice without a receipt (one retry, base still evaluated, stop before v7 interactive and
  training, merged_v7 kept); GPU taken after collection (clean STOP exit 3 inside the wait, then a re-launch skips collection
  and finishes); wm_interactive.py changed after build (interactive evals skipped, core completes); V8_NO_INTER=1; a collect
  crash without a turns log (plain retry) and with one (--resume).
- Projections (INFERRED, `projections()` in v8_dryrun.py; real GOOD-turn rates unknown): turn items 118 / 258 / 442 (hard-start
  68 / 138 / 230) for low / mid / high, + about 85 singles, 2 replay, 600 CP; full-solution share 0.59 / 0.40 / 0.28 of puzzle
  units; 492 / 632 / 816 optimizer steps over 2 epochs; training 21 / 29 / 40 min before load + merge.

## 12. Review response (revision 2)
Applied: turn difficulty = start distance d_before (R1/R3 and the hard-start rank use it; both mixes reported); GOOD turns
require a moved box, a new episode best, efficiency >= 0.75 and no overshoot (push counts recorded); hard-band GATE is point
non-inferiority; CO-PRIMARY v8 > v7 on hard boards; format-bleed secondaries (short_plan, plan/oracle); turn rows paired per
unit; turn-1 cap; short rule over puzzle units (CP excluded); CP kept at 600; answer-span loss logging; ptok re-render check;
budget clock starts at the first GPU_FREE with in-wait STOP; restartable driver (receipt-based skips, scratch-dir preflights);
v7 single receipt required before merged_v7 may be freed; single-shot retry on receipt-less failure; base single before training;
WAIT_FOR file (wm_DONE) serialization; manifest re-checks per stage with interactive skip on wm_* change; interactive
NOT_COMPARABLE instead of raising; v6_A.json presence + sha check; `V8_NO_INTER=1`.
Not applied (reasons): n=8 on hard boards (+20 min per arm; budget); adding `s1_run.sh` to v8's wait list (s1 already waits on
any `v8_` process: the two waits would deadlock); a REP1 driver name (not in the local files; v8 waits for wm_DONE, and wm itself
waits for REP1_DONE; the wait list now matches any `rep1_` process, which covers rep1_eval.py and any rep1_* driver); evaluating the epoch-1 adapter (needs a second merge in /dev/shm and ~25 min).
