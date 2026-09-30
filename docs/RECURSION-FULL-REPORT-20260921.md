Redacted copy: identifiers replaced.

# FULL RECURSION REPORT — Nebius, lineage, dreaming, judges, and the audit loop (2026-09-21)

**Status:** measured where measured, labeled where not. NOT PUSHED (owner freeze).
Instance STOPPED, confirmed. This document is the complete picture Peter asked for:
everything we did, why each piece matters, and what it costs.

## PART 1 — NEBIUS ACCOUNT (live-queried today)

| Item | State |
|---|---|
| Instance `<INSTANCE_NAME>` (`<NEBIUS_instance_ID> | **STOPPED**, confirmed via provider `get` |
| Preset | `1gpu-16vcpu-200gb`, gpu-h200-sxm — one H200 (~$4.50/hr reference) |
| Boot disk (200 GiB) | READY, 4 GB free — holds the lineage environment (trainers, eval JSONLs, rollback chain) |
| Data disk `glm-data-186` (186 GiB NRD, ~$9.86/mo) | READY, attached RW — created for the Bonsai/Ornith windows |
| Compute billed, all-time this lane | **~$0.59** (one 467-second disk-refusal window) |
| Storage burn rate | ~$30/mo combined while both disks exist, instance stopped or not |

**What happened on the cloud:** four start attempts for the window — two silent failures,
one STARTING→STOPPED reversal, one explicit `NotEnoughResources` (VM schedule timeout).
The executor started the instance once legitimately, SSH'd in as `aukora@`, measured
4 GB free vs 95 GB needed, exported the finding, and shut itself down with provider-
confirmed STOPPED. Findings baked in: `--parent-id` required on start/stop, public IP
preferred with `/32` stripped, SSH user `aukora`, CLI hangs without TTY (stdin=DEVNULL
+ bounded timeouts now encoded).

## PART 2 — THE LINEAGE (the reason any of this matters)

Nine receipted model generations, gen-10 → gen-18, burned on H200s: Qwen3.8-27B base +
LoRA adapters, 18 GB of adapters backed up on this Mac (`~/<BACKUP_NAME>/`,
gen-1 through gen-18 verified present today). Three certified laws came out of those
burns: **erosion** (corpus-only fine-tuning erodes byte-recitation), **restoration**
(the FP engraving gate restores it in one epoch), and the **two-part protocol**
(corpus epochs + live engraving refresh = line-best families AND held recitations —
gen-18 hit 18/18 idempotent-recovery + 4/4 recitations).

**Why it's sci-fi:** this is a *breeding program for minds* with papers-grade discipline —
every generation receipted, every law certified by measurement, the whole bloodline on
disk. Almost nobody in the industry versions their models like livestock with papers.
**Honest limit:** the recitation grader uses trimmed equality + prefix matching, not
byte-exact memory; gen-19 (rows 0/1 recovery) is preregistered, unburned.

## PART 3 — THE DREAMING LAYER (the wild one)

A dreaming judge (Jev via OpenRouter, ~$0.0001/run) re-reads our OWN recorded history
and predicts what we should have done: it found the FP gate we missed for 3 generations
(0.83) and the floor-axis move that closed L=0.6 (0.20). Corrected record: 2/3 on
suboptimal-baseline points, 4/5 total, 0 worse — no overclaim.
**The forward prediction, preregistered and UNGRADED:** gen-19 should turn the refresh-share
knob for rows 0/1. Graded only against the future burn. If it hits, a machine predicted
its own training outcome in advance, on record, for a tenth of a cent.

**Why it's sci-fi:** a system dreaming about its own past to predict its own future —
with the prediction locked before the outcome exists so nobody can cheat. That's not a
metaphor; it's a JSON file with a timestamp.

## PART 4 — THE JUDGES (System-1 bench)

- **Risk plane:** 12 recorded governance decisions; risk score separates safe/hostile 5.2×;
  risk-only leave-one-out 1.000; $0.000017 per decision.
- **Liquid 1.2B** (local): 10/16, completeness 1.0. **Llama 1B** below degenerate baseline;
  3B above it. **Laya** base 9/16, typed-decisions 8/16 — fine-tuned SOTA does NOT transfer
  zero-shot to governance (their own docs predicted this).
- **Truncation finding (load-bearing):** decisive fact at input end flips the verdict;
  start-placed passes. Integration rule recorded: evidence first, overflow gates everything.
- **Bonsai-27B** (ternary, 7.59 GB on disk): loads and generates at 9.2 tok/s on the M4 —
  verified, then shut down to protect Peter's working machine.

## PART 5 — THE AUDIT LOOP (the part that makes it all believable)

Auma (inside the app) independently re-ran 12 of 15 lane commands: 10 reproduced to the
decimal, 2 real defects found with root causes (stale orchestration matcher, stale manifest
count) — both fixed and re-verified green the same night. The lane's own controls caught
5 of its own scenario collisions, a binding mismatch the verifier found in the toy, and an
overcounted headline (3/5 → 2/3+4/5). Every correction appended, none overwritten.
**This is the foundation-to-SSI claim made concrete at small scale:** the machine that
catches its own lies, with receipts.

## PART 6 — WHAT'S STILL UNPROVEN (the honest list)

Arms B/D (adapted beats base — needs the burn). The gen-19 prediction (ungraded).
Liquid 2.6B, Jev-on-v02, abstention fitting, the holdout (all UNMEASURED). The Golden
Boundary toy (mechanism shape only). Nothing merged (COST HOLD + tonight's freeze).
H200 capacity (out tonight). No training runs anywhere in the lane — by design, until
the gates clear.

## PART 7 — COSTS AND GATES

Spent to date: ~$0.59 compute + $9.86/mo disk (from today) + ~$20/mo boot disk (standing).
Recorded ceiling for any window: $50 total. Gates in order: (1) this freeze lifts (owner
only), (2) Actions billing clears for pushes, (3) H200 capacity returns, (4) recorded
spending ceiling per window, (5) five-lane dispatch. The next window is one command:
start → mount → serve → frozen comparison → export → STOPPED-confirmed.

## PART 8 — GAMMA CONTEXT: WHAT THE OTHER REPORT CHANGES (added 2026-09-30)

**Account resources: UNCHANGED.** Verified live: one instance (STOPPED), boot disk
200 GiB, data disk 186 GiB READY + attached. Nothing from any side created, deleted, or
moved resources since the data disk. The Gamma docs below changed the *picture*, not
the account state.

**Three credit figures now on record (status of each noted honestly):**
- ~$50 remaining (September handoff premise; basis: observed spend rate, not a statement)
- **$10K credit offer** (Gamma cover letter to Nebius — a written offer, terms unknown)
- **$150K Lift Program** (May pitch ask — unknown whether granted; verifiable only in console/billing)

**ULHF reasoning protocol (Gamma cover letter, stated):** anchored state observation +
liquid hypothesis weighting + reasoned move/update loop; TU93 and LS20 Level 1 solved
autonomously multiple times, repeatable on demand. The stated recursion target is explicit:
**beat ARC-AGI-3 at human reasoning level, publicly, with full reasoning traces** (Kaggle
entry at Level 5+). SOTA AI completes essentially zero levels in 500+ actions; humans do
all 7 in ~175. Gamma's wins sit on the human side of that gap.

**What this means for the lane:** the ARC-AGI-3 target gives the dojo work a real
destination (Sokoban dojo = toy-scale version of the same trusted-engine discipline),
and the ULHF loop (hypotheses weighted by confidence, refuted ones kept as negative
memory) is directly comparable to the dream-layer + abstention-contract design. Two
independent implementations converging on: fast hypothesis turnover, no re-litigation
of refuted approaches, human-readable traces.
