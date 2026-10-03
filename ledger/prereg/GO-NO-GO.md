# Nebius lab — GO/NO-GO for Peter (2026-10-03)

**Recommendation: NO-GO today. Conditional GO once 5 zero-cost blockers close, cap $25, 3h20m wall.**

## What it is
One run, Ornith-1.5-35B-A3B @10fbf86f, frozen BF16 parent + fresh rank-16 attention LoRA,
self-training on Sokoban puzzles it failed then fixed with verifier feedback; compare P0 vs P1
on 32 sealed holdout puzzles. Prereg: PREREG-v3-DRAFT.json SHA256 69fe04e4…7d57 (amends v2 01aa97ef…).

## Cost (public $5.40/H200-h; account rate UNVERIFIED)
| Case | Wall | Compute |
|---|---|---|
| Early stop (disk/SSH/no corpus/no headroom) | 0.5–1.5 h | $3–8 |
| Full run (est., UNMEASURED) | 2–2.5 h | $11–14 |
| Hard ceiling (watchdog) | 3h20m | $18 |
Plus standing storage on existing disks (~$30/mo, already being paid) and tax. Proposed cap **$25**.

## What we learn
- PASS: one self-generated LoRA generation measurably helps a 35B MoE on a held-out verifiable task (p≤0.05 on paired flips). First real recursion evidence in this lab.
- FAIL/stop: still useful — measured load/train memory & speed for Ornith on one H200, P0 Sokoban ability, whether the fail-then-fix corpus exists. Nothing about historical Gen16/Gen19 or product.

## What would make it a waste
- Starting before free disk on `glm-data-186` and SSH access are known (both unobservable while STOPPED; SSH was denied last time).
- Running the v2 pass rule (+1 puzzle = "pass" is a coin flip).
- Untested stack (Transformers ≥5.8.1 + Qwen3.5-MoE linear-attention kernels) debugged on the paid clock.
- No watchdog outside the job, or no fresh provider STOPPED at the end.

## Blockers before GO (all $0, local)
1. Write + hash BFS verifier, holdout generator, 32 holdout boards, prompts (CPU on Mac).
2. Build exact pip lock; dry-run runner on a tiny Qwen3.5-MoE-architecture config on CPU (shape/LoRA-target check, no weights).
3. Watchdog script on Mac (independent of the job) dry-run against `nebius … get` only.
4. Decide what to do if data disk has <100 GiB free (deletion is currently forbidden → would be NO-GO).
5. Peter: numeric cap ($25 proposed), and accept Sokoban domain + v3 amendments.

## Also noticed
`aukora-prime-pilot` (cpu-e2 2vcpu-8gb) RUNNING since 2026-10-01 — outside this lab, not touched.
