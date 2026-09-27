# Kira graduation contract

*What must be true before a Kira record — and specifically an **experience**
record — may be adopted by this system.*

This file is a contract, not a description. It names the verdicts that gate
adoption, the shape an experience record must have, and the one mechanism by
which adoption happens. Where a term is used but is **not defined anywhere in
this tree**, that is stated rather than papered over.

---

## 1. The Experience Court, now defined — and the paragraph it replaced

An earlier revision of this file recorded that the **Experience Court** named by the
assignment was **not defined anywhere in this repository**: `git grep -in "experience court"`
over `main` returned nothing: no script, no court, no verdict vocabulary, no exit convention. It
bound adoption to the courts that existed rather than naming one nobody could run, and it stated
that when such a court *was* defined, it would become an additional row in the table in §2.

That court now exists, so that is what happened. It is row **8** of §2.

Pinned by digest, not by path, following `scripts/aura/COURT-CONTRACT.md`:

```
scripts/kira/experience-court.py
sha256 131a95f2bc72df0c64727098d97e385b1bdc948533a1b7bc470589beb06ae37e
```

This file's own digest cannot appear inside itself, so the court's digest is recorded here and a
mismatch means unknown rules rather than a newer version of the same rules.

**What was replaced, precisely:** §2 carried seven rows and no placeholder, so no row was
deleted to make room — the sentence above is recorded as it stood, and this section replaced it
because leaving it in place alongside a working court would have been false. §2 gains a row; it
did not lose one. Saying which of the two happened is the point.

The court answers **one** question: does every provenance claim in the candidate resolve to an
artifact that is actually present, and whose bytes say what the candidate says they say? It
prints exactly one of `GROUNDED`, `UNGROUNDED`, `UNDETERMINED` with a `REASON :` line naming the
branch that produced it. Its own docstring carries the full statement of what a `GROUNDED`
verdict does **not** establish, which is the part most likely to be overread: not truth, not
authorization, not attendance, and not a claim about anyone's interior. A `GROUNDED` verdict is a
floor below which adoption would mean storing a claim nobody can check. Adoption remains the
operator's act with the operator's grant.

Recording this is still the point.
run would graduate records on a verdict no one could reproduce.

## 2. Verdicts a Kira record kind must pass before adoption

Every row is a **named, reproducible verdict** with a command that produces it. A
record kind graduates only when **all** of these pass. A missing verdict is a
failure, never a skip: an unrun court graduates nothing.

| # | Court | Command | Required verdict | Not a graduation |
|---|---|---|---|---|
| 1 | **Record contract** | `node tests/kira-record.test.mjs --mutate` | the record re-stages to its own `recordId`; `grantsAuthority === false`; the closed field set holds | `identity-mismatch`, `malformed`, any refusal code |
| 2 | **Consistency over time** | `python3 vendor/append-only/verify.py <retained> <presented>` | `APPEND_ONLY` — the evidence for this record extends a retained observation | `OBSERVATION_CONFLICT` (an earned accusation), `UNDETERMINED` (nobody looked) |
| 3 | **Governed transition** | `python3 scripts/composition/__main__.py load …` | the transition was admitted under a **one-use grant**, verified against the gate's configured governor key, and the receipt names the digest of the governed entry file. `BOOTSTRAP_UNGATED` and `SAME_UID` apply: the gate generates that key itself, keeps it in the clear in the state directory under the same UID, and can mint its own grants. The digest does not cover the plugin's imports or its path | `NO_GRANT`, `GRANT_MALFORMED`, `GRANT_BYTES_MISMATCH`, `GRANT_SPENT`, `GRANT_OPERATION_MISMATCH`, `GRANT_EXPIRED`, `MEDIATOR_OFF` |
| 4 | **Receipt, offline** | `node tests/receipt-v3.test.mjs` | a stranger holding the receipt and a public key verifies the signature and the closed fields, with no state of ours | any non-zero exit from the receipt court (a flipped byte, a key mismatch, or "identity field refused"); this court prints `FAIL:` lines, not `RECEIPT_TAMPERED`, which comes from the composition loader and Kira's memory owner |
| 5 | **Memory evidence** | `node tests/kira-memory-owner.test.mjs --mutate` | the receipt is bound to the **actual object bytes** (they hash to the digest it names) and to the **validated chain** (entry, link and head re-derived from the log) | `MEMORY_TAMPERED`, `MEMORY_CORRUPT`, `MEMORY_UNVERIFIED` |
| 6 | **Readable with a citation** | `node tests/kira-reachable.test.mjs --mutate` | `kira.recall` returns the record with a citation whose head re-derives (reachability and the citation are this court's) | `availability: undetermined` — and **never** `empty`, which would report damage as absence; that half is courted by `node tests/kira-integrity.test.mjs` and `node tests/kira-recall.test.mjs`, not by this row's command |
| 7 | **Whole wiring** | `bash scripts/aukora-courts.sh` | rows 2 and 3 through their listed commands and row 4's receipt court through `scripts/receipt-verify`, under one exit code. Rows 1, 5 and 6 are **not** run by this script. Rows 1 and 5 run in CI's keyless-courts job, and row 6 in keyless-build (plain and `--mutate`) | any non-zero exit |
| 8 | **Experience Court** | `python3 scripts/kira/experience-court.py --candidate <record.json> --evidence <dir>` | `GROUNDED` — the record's identifier is the one its own fields derive, every `source` entry is present in the evidence set and agrees by digest, and every `links` target resolves | `UNGROUNDED` (provenance asserted and not produced), `UNDETERMINED` (this pair does not answer the question), and any non-zero exit (the court could not run) |

**Damaged evidence never graduates and never reads as absence.** Row 6's last
column is the contract's sharpest edge: `undetermined` and `empty` are different
facts, and a store that could not be verified may not be reported as one that
held nothing.

### What none of these verdicts establish

Attendance, personhood, truth, occurrence, authorization, or that the record's
content is *correct*. A signature proves a key signed. A receipt proves a
transition was recorded. `APPEND_ONLY` is arithmetic over two roots. Every one of
these is evidence about a record, and evidence never authorizes.

## 3. Experience records are a Kira content kind

An **experience record** is a Kira memory record whose `content` conforms to the
experience content kind:

```
kind:    aukora:kira-experience:v0
fields:  { what, when, where, who, outcome, evidence }
```

An experience record is carried under an **existing** closed record kind — today
`observation` — and is distinguished by its content, not by its `kind` field.

**Why a content kind and not a new record kind.** `recordKind` is a closed
vocabulary and the record identifier is derived from the record's own bytes, so
extending the *record* vocabulary is a change to the record contract with its own
consequences for every identifier downstream. Declaring the experience shape as a
*content* kind gives the court something exact to judge without silently moving
the identity domain. Adding an `experience` **record** kind is a separate,
deliberate change: it needs this file amended, the closed vocabulary extended in
`lib/record.mjs`, and new arms — and it must not be done by widening the content
kind until it happens to be one.

`who` and `when` are **recorded attribution and a recorded instant**. They are
not a claim that a person was present, and not a claim that the system observed
anything. That is the same ceiling the rest of this lane carries.

## 4. Adoption happens by distill with pins

A record kind is adopted by **`scripts/distill-upstream.py`**, and by nothing
else. Adoption means: bytes leave their origin, enter this tree, and arrive with
provenance that a checker can re-verify.

The pins are not decoration — each rule is a failure the tool refuses:

| Rule | Refusal |
|---|---|
| the ref must be a **full 40-character commit sha** | `main` moves; a pin to a branch is a pin to nothing |
| the upstream tree must be **clean** | a manifest whose digests were computed over uncommitted bytes claims a commit those bytes are not |
| the destination must not already pin a **different** commit, under any manifest name | overwriting a pin silently is how two trees claim one origin |
| the manifest is written **only** when every digest is computed | a partial manifest is worse than none: the checker reads it as complete |

and the result is verified by **`python3 scripts/phase0-check-pins.py`**, with
`--mutate` as the negative control.

**No adoption by copy, by hand, or by a manifest someone typed.** A record kind
that graduated every court in §2 and then entered by any route other than a
pinned distill has not been adopted; it has been inserted.

## 5. What this contract does not say

- It does not say an Experience Court existed WHEN THIS CONTRACT WAS FIRST WRITTEN. It
  says **which verdicts graduate a record today**, and it named that missing court as a
  gap rather than a premise. §1 records that the court has since been defined and is
  row 8 of §2; leaving this bullet in its original tense would contradict §1.
- It does not say any record kind **has** graduated. As of this file, none has:
  the gates are stated, and the adoption has not been run.
- It does not make a Kira record authoritative. Records carry
  `grantsAuthority: false`; a graduated record is a well-evidenced record, and
  evidence never authorizes.
- It does not claim the experience content kind is implemented. §3 declares the
  shape a court would judge; the records this lane can currently stage carry
  arbitrary `content`, and nothing yet validates the experience fields.
