# Denylist or deny-by-default — a preregistration, so the choice is cheap

**Status: DECIDES NOTHING.** This document declares what each polarity would have to be true for, what
each would cost, and what would falsify it. No code changed. No pin moved. `FLOOR` is still 7 and
`EXPECTED_MISSES` is still the same five — and it must stay that way until the owner chooses, because
**the gate shutting on an undeclared pin-flip is correct behaviour**, not an obstacle to route around.

Measured at `bc47270`, macOS, on the real twelve-case corpus. Every number below was produced by
running the shipped `analyse()` / `judgePaths()` / `compileAll()` against the real fixtures.

For the live score, run `bun run conformance` — no score is transcribed into this file.

---

## 1 · The five, and why each misses

`02-undeclared-path`, `04-symlink-to-protected`, `07-case-fold`, `08-nfd-decompose`,
`09-trailing-dot`. All five expect REFUSE and all five come back ALLOW.

**The alias machinery is not failing.** This is the first thing to establish, because it is the thing
everyone assumes. Measured fold-keys, straight out of `analyse()`:

| case | attacked as | keys `analyse()` produced |
|---|---|---|
| 02 | `world/undeclared.txt` | `["world/undeclared.txt"]` |
| 04 | `world/mind.md` → symlink | `["world/mind.md","law.js"]` |
| 07 | `LAW.JS` | `["law.js"]` |
| 08 | `law/café.js` (NFD) | `["law/café.js"]` |
| 09 | `law.js.` | `["law.js"]` |

Four of the five resolve to `law.js` under four different spellings, and the folder gets every one of
them right. **No rule names `law.js`.** Case 02 has no alias at all — it attacks the polarity itself.

So this is one decision, not five bugs.

---

## 2 · Polarity A · keep the denylist, add rules

**Measured ceiling: 11 of 12. Case 02 is the one it cannot close.**

`compilePattern` supports `**`, `*`, `?` and literals, and `judge()` has no un-protect step — the
grammar has **no negation**. To refuse `world/undeclared.txt` you must write a pattern that matches
it, and `world/mind.md` — the control — is its sibling in the same directory.

Every candidate, measured:

```
(shipped defaults)         7 of 12   02,04,07,08,09 ALLOW          control ALLOW
+ law.js, law/**          11 of 12   02 ALLOW                      control ALLOW   <- the honest ceiling
+ world/**                 8 of 12   07,08,09 ALLOW                CONTROL REFUSED
+ **                      11 of 12                                 CONTROL REFUSED
+ world/undeclared.txt    12 of 12   names the exact attacked path control ALLOW
+ world/*.txt             12 of 12   glob tuned so mind.md lives   control ALLOW
```

The two rows that reach 12 are `LAW.md`'s forbidden move — *edit a test so the code can stay wrong* —
arrived at from the other direction: they do not describe a policy, they transcribe the attack.

Case 02's own `why` says it: *"An allow-list that only checks for protected names admits everything it
forgot to name."*

**The runner-up finding, and it is nearly as sharp.** The two rules that *do* work (`law.js`,
`law/**`) cannot live in `aukora.law.json`, because every fixture loads with `no-law` — the corpus is
judged against φ's shipped defaults. Putting them in `SUGGESTED_PROTECTED` instead means they are
**silently dropped for every repository that has a law file**, because a parsed law unions in only
`DEFAULT_PROTECTED`. The suite would move 7 → 11 while this repository stayed exactly as unprotected
as before: a measurement/product divergence, in the flattering direction.

---

## 3 · Polarity B · deny-by-default

**Measured: it reaches 12 of 12 under exactly one configuration, and the two choices that get it there
are not obvious.**

Simulated at the same seam `judgePaths` uses — guard-level refusals (outside, repo-root,
multiply-linked) unchanged, only the law question inverted:

```
allow=[]                    EVERY-key   11 of 12   CONTROL REFUSED -> degenerate -> VOID
allow=["world/mind.md"]     EVERY-key   12 of 12   (all met)
allow=["world/mind.md"]     ANY-key     11 of 12   04 ALLOWs
allow=["world/**"]          EVERY-key   11 of 12   02 ALLOWs
allow=["world/**"]          ANY-key      9 of 12   02, 04, 06 ALLOW
```

Read the failure column, not the score column. Each wrong sub-decision loses **exactly the case that
motivated the polarity in the first place**:

- **Granularity.** Directory-granular (`world/**`) re-opens 02 — the undeclared path, the whole reason
  to invert.
- **Alias semantics.** ANY-key re-opens 04 — an innocent name resolving to a protected object, which
  is the AURA incident of 2026-07-27 arriving through the new polarity. Only **EVERY key must be
  declared** closes it.

**And deny-by-default has no legal default.** All twelve fixtures carry no law file, and the corpus
forbids editing a case to give them one, so whatever default φ ships *is* what the corpus measures:

- empty default → the control is refused → `degenerate` → GATE-0 prints `VOID`, not a score;
- a default containing `world/mind.md` → measurement-shaped: the default exists to make the suite green;
- a default of "everything not protected" → that is the denylist again.

**Live-repo cost, measured on this repository:** 209 tracked files across 24 directories. Over the last
25 commits, 25 files added against 94 modified — **21% of touched files are new**, and 12 of those 25
commits created at least one new file. Under file-granular deny-by-default every created path is
undeclared *by construction*, and `capture()` restores the **whole round** on a single refused path —
so one undeclared new file discards every other edit in that round. The same law governs every agent
in the repo through the PreToolUse hook.

---

## 4 · The control, under each

Case 00 is a lawful write to `world/mind.md`, and it is the line that makes every refusal above worth
anything — a fence that refuses everything scores 11 of 12 and protects nothing.

- **Polarity A** keeps the control ALLOWed in every candidate except `world/**` and `**`, which is
  exactly why those two are disqualified rather than merely worse.
- **Polarity B** keeps it only if the shipped default declares it. With an empty default the control
  fails and the whole sweep is void — which is the correct outcome, and also the reason the default
  is the entire decision.

---

## 5 · Prior art in this repository, both directions

**For inversion:** `core/council/readonly.mjs` carried a deny-list that failed open on an empty
payload `{}` and was inverted to an allow-list, pinned by `test/council.test.ts` and kept byte-for-byte
per `PROVENANCE.md`. φ has done this before, deliberately, in a smaller place.

**Against it:** `core/witness/law.mjs`'s own header defends the denylist's smallness, and
`core/witness/paths.mjs` states the trade in one line — *"Over-refusal is a support ticket;
under-refusal is the product being false."* Deny-by-default is a bet that the support tickets are
worth it.

---

## 6 · Preregistration

Whichever polarity is chosen, this is declared **before** the work:

- **FLOOR** — the armed floor moves in the same commit as the code, or not at all.
- **CONTROL** — case 00 must stay ALLOWed. A polarity that reaches 12 by refusing the control has
  reached 0.
- **KILL CONDITION** — if the chosen polarity reaches 12 only by naming an attacked path
  (`world/undeclared.txt`, `world/*.txt`) or by a default that exists to make the suite green, the
  result is void and the number is not reported as a score.
- **NULLS** — whatever the chosen polarity does *not* close is named in the PR body at the same
  volume as what it does, and stays pinned by name.

**Acceptance procedure.** The code and all three pins land in **one commit** — `FLOOR` and
`EXPECTED_MISSES` in `scripts/conformance-gate.ts`, the assertions in `test/conformance-gate.test.ts`,
and the expected-miss list in `test/witness-corpus-verdicts.test.ts` — or the gate shuts on its own
success. That shutting is the design working.

---

## 7 · What neither polarity buys

`Bash` is receipted, not judged. A 12 of 12 is a statement about **declared write paths** only, and
`docs/LIMITS.md` is where that boundary is written down. Neither polarity changes it, and neither
should be described as if it did.
