# The Aukora Dojo Kernel — guided recursion, design v0 (2026-10-03)

## Thesis
The deliverable is not a smart model. It is a **kernel that can safely change itself**, under Peter's hand,
one generation at a time. Once that loop is trustworthy, *what* it learns is just a choice of environment.
Sokoban is room 1. The Aukora harness itself is the real dojo.

## Anatomy (four organs, separated on purpose)
1. **Body** — small open model (Ornith-35B-A3B; Bonsai alt) + a stack of LoRA adapters, one per generation/skill.
   Lives inside the Aukora harness; speaks its IPC/tool protocol natively because that is all it ever trains on.
2. **Senses / allies** — frontier models (Opus 5.5, Gemini, etc.) called as *tools*: hints, mid-trajectory takeover,
   graders that return verdicts. A learned *escalation head* decides when to call them (cost-aware).
3. **Dojo** — environments with deterministic verifiers: Sokoban → other puzzles → Aukora harness tasks
   (receipts, tests, IPC contracts as the judge). Task generator aims at the ~20% solve-rate frontier (Ornith D-term).
4. **Keeper** (outside the body's reach) — frozen holdouts, planted canaries, scorer code, lineage ledger,
   spend/stop watchdog, and Peter's approval gate. The body can propose; only the Keeper promotes.

## One generation (the loop)
1. Body plays the dojo (its own attempts, in its current harness).
2. Failures → ally rewrites only the failing step (on-policy correction); successes keep the env reward.
3. Body writes a **locked self-forecast**: "after this update I will solve N".
4. Train adapter g+1 (adapter-only, append-only data; never only last-gen outputs).
5. Keeper scores on sealed holdouts + canaries + regression suite + KL-to-base + harness-tamper audit.
6. Peter sees one card: gain, regressions, forecast vs actual, six-risk checklist → **PROMOTE / ROLLBACK**.
Recursion signal over generations: gain per generation *and* shrinking self-forecast error.

## Outer loop (harness co-evolution, no GPU)
The body (or an ally) proposes diffs to its own harness; small edit budget, snapshot rollback,
promotion only on held-out tasks (Weco AIDE², RRSI). Then the inner loop retrains weights *in the new harness*.

## Hard rules
- Acceptance lives where the kernel cannot read or write it (DGM/SEAL/PROCTOR lessons).
- Every generation is a ledger row: adapter hash, data hash, eval hashes, forecast, verdict, cost. Never lose a lock again (Gen19).
- **Provider terms:** Anthropic/OpenAI/Google terms bar using outputs to train competing models. Until cleared in
  writing: allies may act as tools and verdict-only graders at runtime; their *tokens* never become training targets.
  Training targets come from the body's own verified attempts, deterministic solvers, or open-weight teachers.
- Peter's GO is per generation and per dollar cap.

## Start now (obvious later)
1. Ledger schema + generation card (this run is Gen-1 of Sokoban; outcome.json is the first row).
2. Sealed holdout registry outside the body's workspace (holdout.json sha d90d5927… is the first entry).
3. Harness-task env #1: replay Aukora IPC/receipt tasks with deterministic checks (no product code edits — read-only fixtures).
4. Escalation logging: every ally call recorded with state + outcome → future escalation-head data.
5. Capacity: reserved or second-provider GPU; on-demand H200 just refused twice.
6. Terms: ask Anthropic for approval of a distillation use case, or design around it (above).
