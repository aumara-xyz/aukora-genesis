# Review brief — Aukora Ornith Sokoban dojo (2026-10-03, ~14:07 local / 06:07 UTC)

## Hardware / budget
- One Nebius H200 (141 GB) RUNNING since 12:26 local (04:26 UTC); Mac watchdog hard-stops at 17:15 local (09:15 UTC). Peter cap $40; ~$5.40/h. Spent so far ~$9-10.
- Box: /mnt/glm-data/aukora-run (data disk ~13 GB free), /dev/shm 99 GB tmpfs (gen-1 merged weights 66 GB live there). torch 2.11+cu128, transformers 5.18, peft 0.21.2, fla present (triton upgraded to 3.8.0), causal_conv1d NOT installed (slow fallback). vLLM 0.30.0 (torch 2.13 cu130) in separate venv.
- Model: ornith-ai/Ornith-1.5-35B-A3B @10fbf86f (Qwen3_5Moe, 30 linear-attn + 10 full-attn layers, 256 experts top-8, BF16 67 GB). Loaded as Qwen3_5MoeForConditionalGeneration. Thinking template enable_thinking flag.

## Code (all local copies, read them): /Users/peterviviani/aukora-nebius-run/lab/
- sokoban.py (8x8, 2 boxes, BFS oracle, verify, canonical id, generator), prompts.py, holdout.json (32 sealed, bands 8-16/17-32/33-48), holdout128.json is ON THE BOX ONLY (confirm.py makes it; seed 5120261003).
- v4 runner.py (HF generate, thinking OFF) -> outcome NO_ELIGIBLE_CORPUS (P0 0/32).
- probe_vllm.py (exploratory, thinking ON 16k): easy 6/16, holdout 4/32.
- v5: v5_common.py, v5_gen.py (vLLM P0a/P0b, k=4 samples on 96 procedural boards, shortest verified trace <=12288 tok, locked forecast), v5_train.py (HF+PEFT LoRA r16 a32 on 100 attn modules, AdamW 1e-4, batch1, full thinking trace target, epochs rule), v5_eval.py (vLLM on merged weights), v5_run.sh.
- confirm.py (128 new sealed puzzles; base vs gen1) — RUNNING NOW.
- v6 (gen-2, queued to auto-start after confirm): v6_genA.py, v6_genB.py (GLM-5.3 hint -> hinted retry -> rationalized target w/o hint; replay gen-1 corpus), v6_train.py (derived from v5_train via string edits; deletes /dev/shm/merged after loading gen-1, saves gen-2 merged to /dev/shm/merged_gen2), v6_eval.py, v6_run.sh, friend.py + friend_batch.py (Mac-side OpenRouter z-ai/glm-5.3, key at ~/aukora-nebius-run/.openrouter_key — DO NOT print it), ~/aukora-nebius-run/v6_mac_friend.sh.
- Preregistrations: /private/tmp/claude-501/-Users-peterviviani-aukora-prime/aca41c86-c676-41b2-b898-b4c24b3cb5a6/scratchpad/nebius-lab-v3/PREREG-*.json

## Results so far (raw JSON in /Users/peterviviani/aukora-nebius-run/pulled/out/)
- v5: P0a 4/32, P0b 4/32 (0 flips: greedy vLLM deterministic here). Pool: 96 boards, k=4 -> 50 tasks with a verified trace (corpus 50). Forecast (model) = 4.
- Training: 50 steps, 1 epoch (epoch rule misfired: first step 96 s = kernel JIT warmup inflated projection; later steps ~3 s), loss ~0.10 -> 0.086, peak 91 GiB.
- P1 (merged gen-1) 7/32: b=5 gained, c=2 lost, sign test p=0.227 -> FAIL by preregistered rule. Forecast MISS (4 vs 7).
- Many outputs hit 16384-token cap (probe: 15/32 holdout length-truncated).

## Context / ideas Peter wants considered
- Dream-RSI (arXiv 2609.14858): "dreaming" = replay frozen discovery tree to evaluate alternative exploration policies cheaply; improve policy code via replay; redeploy.
- Ornith-1.5 joint GRPO (task-gen D-term targeting ~20% solve rate; harness reward), Salesforce co-evolving harness+model (2609.09134: on-policy corrected turns only), RRSI, RobustSGPO, SPSD (2609.30936: distill classical search trees into reasoning), on-policy distillation (Thinking Machines), Unmasking OPD (teacher helps on failures), RSI via OPD (2609.30652, length term), Bayesian self-escalation (2608.24087), Darwin Gödel Machine/SEAL/PROCTOR (sealed eval outside agent's reach), RL's Razor (KL tracks forgetting), merge-before-forget, Looking Inward/self-prediction.
- Peter's docs (assessed): top transferable ideas: (1) disagreement-gated escalation (k=4 agreement as uncertainty), (2) replay mix + retention set, (3) update-admission gate with hysteresis, (4) consequence prediction aux task (predict board after moves, simulator labels), (5) rotation/mirror perturbation robustness canary.
- Peter's goal: guided recursion kernel that natively fits the Aukora harness; dojo ladder Sokoban -> ARC-AGI-1 -> ARC-AGI-2 -> ARC-AGI-3; phone-a-friend with learned escalation; provider terms: GLM-5.3 weights MIT-style license (API outputs via OpenRouter: hosting terms also apply).

## Rules
- No product code edits (aukora-prime repo untouched). No GPU/provider actions by reviewers — analysis only. Don't print secrets.
- Label claims RAN (verified from data) vs INFERRED.
