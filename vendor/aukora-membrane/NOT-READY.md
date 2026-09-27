# NOT READY

This repository is private. Everything below is why it should stay that way for now, and what
would have to change.

It is prose, which is unusual here — almost everything else in this project refuses to make a claim
that is not a command. This file is the exception on purpose: **a blocker you have to run a gate to
discover is a blocker nobody discovers.** So the framing is prose and every item still carries the
command that shows it.

`scripts/not-ready-verify.ts` runs those commands and **fails if a listed blocker has stopped
being one.** A stale not-ready list is worse than none — it would tell you something is broken
after it was fixed, or stay silent about something new.

```bash
bun run scripts/not-ready-verify.ts
```

---

## 1. The record's history carries absolute paths, and it cannot be cleaned

The chain has never held file contents — the poverty rule held. It **has** held the paths of files
that were touched, and some of them name the file the signing key lives in. Not the key. The path.

```bash
bun run scripts/path-exposure-verify.ts
```

**It cannot be sanitised.** `path` is a signed payload field, so editing it invalidates the
signature on every receipt that carries one, and the majority do. `scripts/chain-repair.ts`
surveyed this and refused, for the reason in `backups/README.md`: *a backup that repaired the
record would be the forgery this project exists to detect.*

Nothing is exposed while this repository is private. **All of it becomes permanent the moment it
is not**, and git history is the hard kind to walk back.

What *is* controlled: the surface a stranger receives — `docs/heads/`, `minimal/` — carries zero
absolute paths, and that is a gate rather than a habit. Everywhere else is ratcheted: the count may
fall and may never rise.

There were **two more chain copies tracked outside `backups/`, uncompressed** — both under `lab/`,
which is now gitignored. Tracked carriers fell from 20 to 15 and the ratchet came down with them.
The check that found them looks at what a file *contains* rather than what it is called, and it
stays after the cleanup, because the next copy will be added by someone who does not know this
happened.

---

## 2. No outside party has ever checked the path that can accuse

This was "zero external test vectors" until this round, and it is no longer true: 98 vectors from
`transparency-dev/merkle` — Google's CT lineage, commit-pinned — now run against all four
implementations, 97/98, with the one miss being us stricter than the oracle.

**And not one of them ever makes this artifact accuse.**

```bash
python3 -c "
import json
r=json.load(open('scripts/fixtures/external-oracle/RESULTS.json'))
acc=[x for x in r['rows'] if 'CONFLICT' in json.dumps(x)]
print(r['summary']['probeCount'],'external vectors,',len(acc),'that produce an accusation')"
```

The cause is structural, not an oversight in their corpus. `transparency-dev` tests whether *their*
verifier **errors**, and a broken proof makes it error. They have no verdict for *a coherent proof
of a different history*, so nothing in their fixtures is shaped like one.

**The outside oracle validates the behaviour that cannot harm anybody, thoroughly, and the
behaviour that can, not at all.** `OBSERVATION_CONFLICT` is the only verdict here capable of
injuring someone, and every case that produces it was written by this project.

That sentence belongs beside "97/98" every time it is quoted.

---

## 3. The witness property has no runnable proof — PERMANENT, not pending

This is the claim the whole design is for: that someone else holds a prior head, out of our reach,
so a rewrite is detectable without our cooperation.

```bash
cat docs/heads/demo/README.md
```

The demo pairs demonstrate the **arithmetic**. They demonstrate nothing about the witness property,
and the README there proves that rather than admitting it — a command walks the git history and
shows that not one demo retained head was ever published, so nobody could have kept one.

**There is no command that could supply the proof**, because what it asserts is that a stranger
kept a copy. Only the stranger can demonstrate that, by producing it.

This one is a **limit, not a task.** Nothing in this repository can close it, so nothing in this
repository is licensed to remove it from the list. The gate asserts it is still stated and never
asserts it could go — a list that cannot tell a limit from a to-do will eventually instruct someone
to delete the most honest thing in it.

---

## 4. It is a subdirectory, not a repository

`minimal/` is standalone in the sense that matters — `python3 minimal/verify.py --selftest` needs
no files and no network — but the demo pairs it is pointed at live in `docs/heads/demo/`, which
means a stranger needs this repository to exercise it against real bytes.

---

## What *is* ready

Stated because a not-ready list with nothing on the other side is not an assessment, it is a mood.

```bash
python3 minimal/verify.py --selftest
bun run scripts/crossing-verify.ts
bun run scripts/tour-verify.ts
bun run scripts/head-emit.ts --check
```

`head-emit --check` is back in this list. It was pulled out last round because the front door and
this gate disagreed about what "honest" meant; the tour now reads the published field and the seam
is closed. **A blocker that closes is deleted from this file, not left standing** — a not-ready list
rots by things being fixed, and `scripts/not-ready-verify.ts` fails until the section goes.

The demonstrator runs from spec in three independently authored implementations across three
runtimes and agrees on every published case. Twelve demo cases sample a declared partition across
four axes and refuse to be written if a cell is neither sampled nor excused. Honest logs are
convicted zero times, counted rather than asserted. The published head is a fold of the live chain,
re-verified on every run, and it cannot be written if its root is not re-derivable.

---

## The honest sentence

**Nothing has got past us yet.** Every defect this month was found here, before a stranger, and
closed the same day — including four in one hour, two of which were created by the fix for the
other two.

That is not the same claim as *unbreakable*, and it is the strongest one available.
