# Reviewer's checklist — a court under review

**Copy this file verbatim.** Edit nothing, including this line. An edited copy is not this
checklist, and a later reader cannot tell which clause was softened on the way in.

Extracted from the practice of the Diamond court at `00b9012` (`aumara-xyz/aukora-diamond`).
Every clause below is something that court does to itself, and most of them exist because the
weaker version was tried first and failed.

A **court** here means a small program that takes artifacts and returns verdicts — accepts,
refuses, ceilings, records — and that claims to be *sealed*: its rules are fixed, and a
stranger can check them without trusting whoever wrote them.

## How to review

1. Run the court's own arms command from a clean clone. It must exit non-zero when anything is
   wrong, and it must print the revision it ran at.
2. For every claim in its README, find the clause below that covers it and demand the evidence.
   A claim with no evidence is struck out, not softened.
3. Record what you ran and what it printed. A review that cannot be re-run is an opinion.
4. Where a clause does not apply, say why in one line. Silence is not an exemption.

## 1. Arms, and the mutations that prove them load-bearing

- [ ] Every protection the court claims has a **named arm** that fails when the protection is
      wrong. A protection with no arm is decoration: nobody will notice when it stops working.
- [ ] Every arm is **load-bearing, and it is proven by mutation**: in a throwaway copy, delete
      ONE protection, re-run the arms, and require the run to go RED — with the failing arm
      being the one that names that protection. The mutant's `FAIL` line is the evidence.
- [ ] Mutations are **surgical**: disable a guard, never rewrite the logic. A mutant that does
      not parse, or that fails for a different reason, proves nothing about the protection.
- [ ] The mutant runs the **real code with the real imports** (script plus path), so it cannot
      pass by exercising a stub.
- [ ] The arms are not a script that only ever says no: there is a **control** that must be
      accepted when everything is right, and at least one arm that refuses.
- [ ] A mutation that leaves the run GREEN is a **finding**, not a nuisance: either the
      protection is dead code or the arm is not testing it.

## 2. The stranger script

- [ ] **One command**, from a clean clone, with no secrets, no network, no sibling checkout and
      no pre-existing state. If it needs a sibling tree to run, it is not a stranger script.
- [ ] It prints the **exact revision it ran against, read from the tree** (`git describe
      --always --dirty` and its like), never a string remembered in the source. A green run
      must be unable to name a revision it did not exercise.
- [ ] A **modified working tree says so** (`-dirty`). A harness that prints a clean SHA over a
      dirty tree has mislabelled its own evidence.
- [ ] **Exit status is the verdict.** Warnings that matter are failures, and failures are not
      warnings.
- [ ] **Every number in the docs is reproducible by running it**, with the command printed next
      to the number. A table with no command above it is a claim, not a measurement.
- [ ] Missing inputs **fail loudly**; nothing is silently skipped, and no check is optional by
      accident.

## 3. Ceilings

- [ ] The court prints what it does **NOT** claim **on every verdict**, not only in the README.
      A ceiling that lives only in prose is read once and then forgotten.
- [ ] Ceilings are enumerated in **one place in code** and referenced everywhere else. Docs
      quote the constants, and a doc that quotes a code which does not exist is itself a
      failure of the run.
- [ ] Each printed ceiling is **asserted by an arm**, so a ceiling that stops being printed
      turns the run RED rather than quietly becoming a simplification.
- [ ] Ceilings name the **measured thing next to the claim it bounds** — "separate process,
      which is not device independence" — so a reader cannot mistake the smaller measured claim
      for the larger unmeasured one.
- [ ] Anything the court cannot do is either a **ceiling or a refusal**. Nothing important is
      left to inference.

## 4. Provenance

- [ ] Every compared byte has a **digest and a source**: repository, commit, path, and the
      licence it arrived under.
- [ ] Frozen inputs are **verified before use**, and a changed byte REFUSES as drift instead of
      being re-pinned to whatever is on disk.
- [ ] What was **vendored** and what was **derived here** are distinguishable, and the
      derivation is executable — a script regenerates the artifact rather than a human
      maintaining it by hand.
- [ ] Where a copy had to be repackaged, the **delta is named and checkable** (a diff command
      and its output), not summarised as "minor changes".
- [ ] The pin or manifest names the **exact commit of anything external**, and the file that
      records the pin is itself reviewed — a pin nobody reads is a pin that drifts.
- [ ] Historical documents are **left as filed**. Corrections are new artifacts, not edits over
      old bytes.

## What this checklist does not do

It does not verify that the court's claims are *true* — only that they are stated, bounded and
checkable. It does not replace running the thing, and it does not replace judgement: a court can
tick every box here and still be measuring the wrong property. That is what the arms, the
mutations and a reviewer's own scepticism are for.
