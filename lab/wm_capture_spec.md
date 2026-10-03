# wm capture spec: what the next box runs must save so an "intuition gate" (Laya) can be trained

Status: DRAFT for the next box runs. Written 2026-10-03 with `wm_laya_export.py`; revised the same day after review
(token-checkpoint export, corpus rows separated, input length corrected, per-checkpoint sufficiency and sizing, early-abort
design recording a fixed n per board).
Labels: RAN means checked against data on the Mac. INFERRED means an estimate.

## 1. Why this spec exists (RAN)

`wm_laya_export.py` was run over every pulled file:

- It produced **258 examples. All are PASS (87 distinct boards) and 0 are FAIL.** The verdict is **INSUFFICIENT**.
- Those 258 are corpus traces: 50 boards by the base model and 37 by gen-1, each the **shortest verified-OK trace of k=4**,
  from easier pool bands. They are not comparable to unselected fail samples (a gate could separate the classes by model,
  selection, length and board mix without reading the reasoning), so they now go to a separate file,
  `wm_laya_export.corpus_pass_only.jsonl` (fields `model`, `selection`), and never count toward sufficiency or enter gate
  training/evaluation. The gate file `wm_laya_export.jsonl` holds only unselected same-model samples; today it is empty.
- None of the pulled failed attempts kept their reasoning text:
  - `sampled_*.json` has counts only.
  - `forced_base.json` has verdicts, plus the continuation after a forced `</think>`. That continuation is not a reasoning prefix.
  - `posthoc_lenient_*.json` and `probe.json` keep only the last 300 or 400 characters of the answer.
  - `v6_A.json` `failed[]` keeps the final answer only.
- The v7 raw receipts (`v7_eval_*.raw.json`) do have full texts. They are on the **sealed** `holdout_v7`, so they are excluded from gate training by rule.

The data needed for a pass/fail gate therefore has to come from new runs. The `wm_*` runs already save it; see section 3.

## 2. The gate, in one line

g(board, reasoning prefix at token checkpoint k) gives P(this sample's eventual lenient verdict is OK), for k in {1024, 2048, 4096, 8192}.

The gate **never admits data.** It may only:

- **abort** a sample (stop generating it), or
- **route** it, to a resample, to interactive mode, or to the coach.

The verifier stays the only path by which anything enters training.

Candidate encoder: the Laya model is in the local HF cache (`convaiinnovations/laya`, ModernBERT, 28 layers, hidden 1024, 8192 positions; RAN, from its config).

**Gate input (binding).** input_k = board + "\n\n" + text[:ckpt_chars[k]], then **tail-truncated** to the encoder window:
the board plus the LAST ~6k Laya tokens of the prefix (about 8k positions in all). RAN: the reasoning runs about 2.1
characters per Ornith token (v5_corpus: 453,362 characters / 214,604 tokens), so an 8192-token prefix is about 17k
characters, and the Laya tokenizer gives about 1.00 Laya token per Ornith token. Board + an 8192-token prefix therefore
overflows the 8192 positions; the truncation is required, not optional. The export keeps the full prefix; the trainer
truncates.

## 3. Fields every single-shot run must save (per sample)

| field | why |
|---|---|
| run: tag, model path + snapshot hash, adapter sha (if any), sha256 of every script, vllm/torch/transformers versions, sampling config (T, top_p, top_k, max_tokens, n, seed rule), thinking flag, chat-template sha | reproducibility; refuse to pool incomparable runs |
| set name + sha256; case id, `canonical_id`, band, oracle_len | grouping and folds by board |
| sample index, request seed | pairing across arms; offline replay |
| prompt (user text, or its sha + board) and any retrieval ids | the gate input must match deployment |
| **full generated text** | the raw receipt, written right after sampling and before any post-processing |
| generated token count; `finish_reason`; `think_close_char` (and, if cheap, the token index of `</think>`) | censoring; whether a checkpoint is still inside thinking |
| **`ckpt_chars`**: for k in 1024/2048/4096/8192, the char length of `decode(token_ids[:k])`, or null if the sample is shorter | exact gate input = board + text[:ckpt_chars[k]], with no re-tokenization drift |
| strict verdict (`v5_common.score`); lenient verdict (`posthoc_lenient.lenient` then `sokoban.verify`, incl. the ILLEGAL@i index); the parsed plan; the forced verdict if forcing ran | labels: pass/fail, plus failure type for an auxiliary head |
| OPTIONAL: `token_ids` | exact slicing at any k. Costs about 4-8 bytes per token as JSON. |
| REQUIRED for baseline (2) in section 7: per-token sampled logprob (`SamplingParams(logprobs=0)`), saved only as the mean logprob over the 256 tokens before each checkpoint (never the full lists: Logprob objects for ~3M tokens are heavy in host RAM) | a strong, cheap non-neural baseline the gate must beat |

`wm_retrieval_eval.py` saves every field above **except the logprobs**: run tag, model path, script shas, vllm/torch/transformers
versions, chat-template sha, sampling config with the per-sample seed rule, set sha, case id, `canonical_id`, board, band,
oracle_len, sample index and seed, prompt text + retrieval ids, full text (`.raw.json`, written right after sampling), token
count, finish, `think_close_char`, `ckpt_chars`, strict and lenient verdicts and the plan (`.json`). Logprobs were left
out of the wm runs on purpose: they cannot be tested on the Mac (no vLLM) and they add output-processor work and host RAM
to the H-WM1 comparator stage. Consequence: the wm samples can train and evaluate the gate against baseline (1) only;
baseline (2) needs the section 6 capture run, which must request `logprobs=0`.

## 4. Interactive runs (per turn)

`wm_interactive.py` saves the following (per round, durably, in `wm_interactive_<TAG>.turns.jsonl`, and at the end in the
`.json` / `.raw.json` receipts):

- per turn: the full text, generated and prompt tokens, `finish`, `think_closed`, `ckpt_chars`, the parsed action, the harness reply, the applied prefix, `illegal_at` and `solved_after`;
- per episode: the outcome.

Possible labels:

- episode-level: solved;
- turn-level: the turn applied at least one move with no ILLEGAL **and** did not lower boxes-on-goal;
- turn-level failure type.

## 5. Data hygiene (binding)

- **holdout_v7 is sealed.** No trajectory on a holdout_v7 board enters gate training or threshold tuning. `wm_laya_export.py` excludes `v7_eval_*.raw.json` by name.
- **holdout128** has been reused for evals, but nothing has been trained on it. Its trajectories MAY train a gate. Every gate evaluation, and the early-abort experiment, must then use **fresh boards**: a new seed, excluded by canonical id (8 symmetries) from every board on disk, as `v7_seal.py` does.
- **Folds are by canonical id** (`wm_laya_export.fold`: sha prefix mod 5), so a board never sits in two folds.
- A prefix must lie strictly inside the thinking. An example at checkpoint k exists only if `think_close_char > ckpt_chars[k]`, or the sample never closed thinking.
- **Only unselected samples** enter gate training or evaluation, and pass and fail labels must come from the same model,
  prompt family and sampling config, keeping all n samples per board. Selected corpus traces (shortest OK of k) are excluded.
  The headline AUROC is computed only on such samples; if several sources are pooled, AUROC is also reported per source.
- **Sufficiency rule (binding, per checkpoint k, on the token-checkpoint view):** at least 200 examples AND at least 50
  distinct boards per class. A checkpoint that fails the rule is not used for training, thresholds or aborts.

## 6. Volume (INFERRED, from CONFIRM-2 base numbers, unless marked RAN)

The base rate is about 19% lenient-OK per sample. 512 fresh boards × n=4 = 2,048 samples:

- about 390 pass and 1,660 fail;
- about 24M generated tokens, roughly 70 H200-min at about 5.7k tok/s (CONFIRM-2 throughput, RAN), or about $6.5.

**Per-checkpoint sizing.** A pass example at k needs a passing sample that is still thinking at k. RAN (forced_base): of
89 passing samples, 69 exceed 4096 tokens and 33 exceed 8192, so about 6.4% of all samples (89/512 × 33/89) can give a pass
example at k=8192, before the still-inside-thinking filter removes more. 2,048 samples give about 130 pass examples at 8192,
below the 200 rule. Reaching 200 at k=8192 needs about 3,100 samples (about 36M tokens, about 105 H200-min, about $9.5) at
base rates; k ≤ 4096 is satisfied by 2,048. Choose one before the run: size it at ~3,100 samples, or drop k=8192 from the
abort set (aborts at 2048 and 4096 only).

Checkpoint coverage, from `sampled_base` token counts (RAN):

| checkpoint | samples reaching it |
|---|---|
| 1024 | 100% |
| 2048 | 100% |
| 4096 | 90.6% |
| 8192 | 68.4% |

The `wm_run.sh` runs add 512 more single-shot samples on holdout128, with full texts and labels. That is about 100 pass and 400 fail. It is enough for a first offline AUROC read, but not for the test fold.

## 7. Early-abort experiment (design; nothing here has run)

**Boards.** 256 fresh sealed boards: 128 at 8-16 and 128 at 17-32. The 33-48 band has had about 0 solves so far, so it is excluded.

**Budget.** B = 65,536 generated tokens per board.

**Recording (Phase 1 data).** For every board, record a FIXED n = 8 full samples (seeds s0..s7, each up to 16,384
tokens), whatever their outcomes: no stop at the first OK. 256 boards × 8 = 2,048 samples, about 24M tokens, about 70
H200-min; the section 6 data and this recording can be the same run if the boards are partitioned between gate
training/dev and this test.

**Arm A (no gate, replayed).** Walk the recorded samples s0, s1, ... in order; each costs its full token count; stop at
the first lenient OK, when B is spent, or when the n recorded samples run out.

**Arm B (gate, replayed).** The same recorded samples in the same order. At each checkpoint k in the abort set: if
g(board, prefix_k) < τ_k, the sample is aborted (its tokens up to k count) and the walk moves to the next recorded sample.
Tokens saved by aborts buy later samples only from the same n recorded ones. When arm B (or A) runs out of recorded samples
before solving or spending B, the board is **censored** and reported as such.

**Metrics.**
- PRIMARY: tokens-to-first-solve within the n recorded samples, summarized as solved boards per 1M generated tokens (censored boards count their tokens and no solve).
- SECONDARY: boards solved within B; number of censored boards per arm.
- SECONDARY: false-abort rate, the share of aborted samples whose recorded full continuation passed. It is defined only on recorded samples, so it is always known.

**Phase 1: offline replay (0 GPU).**
- Replay both arms exactly on the recording above: an aborted sample is the recorded sample truncated at k.
- This gives arm B's token cost and false aborts without running it. It is the "dreaming" replay idea.

**Phase 2: online.** Run only if Phase 1 shows **at least +20% solved/1M tokens** with false-abort **at most 10%** on the
test fold. Phase 2 does NOT assume same-seed regeneration: vLLM runs are not reproducible across engine instances
(AMENDMENTS: ±5/128 greedy), so the online comparison is between independent samples (arms run on disjoint seeds, or
interleaved by board), analyzed as an unpaired comparison of solved/1M tokens.

**Thresholds.** τ_k is fit on a dev fold, by canonical id, and frozen before the test fold is read.

**Baselines the gate must beat.** Measured as AUROC per checkpoint on the test fold:
- (1) length and restart heuristics: counts of "wait", "let me re", "actually", "Move k:" lines, and grid re-parses;
- (2) logistic regression on (1) plus the mean logprob.

If Laya does not beat (2) by at least 0.05 AUROC, deploy (2), not Laya.

**Prior warning (RAN, from the 15:13 plan review).** A blanket abort at 8k tokens loses gen-1 solves. The gate has to be content-dependent, not a length cut.

**Routing variant.** Instead of resampling, route low-g samples to `wm_interactive` (the simulator as working memory) or to the coach. The token accounting is the same, and the comparison against equal-cost resampling is mandatory.
