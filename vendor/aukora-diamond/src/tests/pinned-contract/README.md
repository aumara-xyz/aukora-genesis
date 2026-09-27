# tests/pinned-contract — the receipt-v3 contract regression check

    python3 tests/pinned-contract/test-pinned-contract.py

Exit 0 when every row matches the recorded expectation, 1 on a mismatch or on
pin drift. Self-contained: no sibling checkout, no network, no secret key.

## What this measures

`aumara-xyz/aukora-genesis` vendors this repository's cold receipt court as
`vendor/receipt-v3`, pinned at diamond `c512d0c`. This repository's composition
closed set then changed — v1 (five fields) became v2 (seven, when grants gained
`compositionDigest` and `subjectDigest`) — **while the `kind` strings stayed
identical**. That is the measurement `aumara-xyz/aukora-toy#3` recorded, and it made
a comparison worth keeping.

It also made acceptance depend on arithmetic: a five-field receipt was refused here
for having the wrong number of fields rather than for a stated rule. This revision
now NAMES its bases. A receipt may declare `compositionBase` — a closed name, part of
what the signature covers — and the verifier checks the block against the base the
document STATES. Both bases are accepted, each under its own name; an unknown name is
refused by name; a document with no declaration is resolved by set membership, which
is the legacy path that keeps pre-versioning receipts verifying.

The consequence for this check is that the committed Genesis fixture is now accepted
by BOTH revisions. The rows that changed changed on **this** side only:

Frozen result at pin `c512d0c` / Genesis `8d8601a`. The runner prints the revision it
ran against and marks a modified working tree `-dirty`, so the column below is that
tree and not a remembered SHA:

| variant | pinned `c512d0c` | this tree |
| --- | --- | --- |
| `genesis-5field` — the committed Genesis fixture, byte-identical | `ACCEPT unattributed/NON-CONFORMING` | `ACCEPT unattributed/NON-CONFORMING` |
| `genesis-5field-resigned` | `ACCEPT unattributed/NON-CONFORMING` | `ACCEPT unattributed/NON-CONFORMING` |
| `genesis-5field-declared-v1` | `REFUSE closed fields` | `ACCEPT unattributed/NON-CONFORMING` |
| `genesis-7field` | `REFUSE composition closed fields` | `ACCEPT unattributed/NON-CONFORMING` |
| `genesis-7field-fixture-kind` | `REFUSE composition closed fields` | `ACCEPT fixture/FIXTURE` |
| `genesis-7field-patentrefs` | `REFUSE composition closed fields` | `ACCEPT unattributed/NON-CONFORMING` |
| `genesis-5field-toy-kind` | `ACCEPT unattributed/NON-CONFORMING` | `ACCEPT unattributed/NON-CONFORMING` |
| `genesis-missing-priorhead` | `REFUSE aura closed fields` | `REFUSE aura closed fields` |
| `toy-with-priorhead` | `REFUSE aura closed fields` | `REFUSE aura closed fields` |
| `tampered-after-signing` | `REFUSE composition closed fields` | `REFUSE signature` |

`MATRIX_SHA256` is printed on every run and digests the ten verdict rows. It is the
same from any working directory.

Reading the table:

- **The committed Genesis fixture is accepted by both revisions.** The pinned one
  accepts it under its only field set; this one accepts it as the named base `v1`. The
  refusal a reader used to see here — `composition closed fields`, decided by counting —
  is gone, and what replaced it is a base with a name.
- **The pinned column is not ours to edit.** Every pinned-side verdict is re-measured
  from frozen bytes on every run and none of them moved when this revision's contract
  changed. Three rows changed on this side only; that asymmetry is the property that
  makes the comparison worth having.
- **A document that DECLARES its base is refused by the pinned revision**, with
  `closed fields`: the frozen closed set has no `compositionBase` in it at all. A frozen
  verifier cannot be taught a vocabulary, which is why adopting the declaration on the
  Genesis side is a separate change there, not a repin here.
- A `7-field` block is still refused by the pinned revision and accepted here, as base
  `v2`. The base, not the count, is what is checked: a v1 declaration over a seven-field
  block is refused naming `v1`, and a v2 declaration over a five-field one is refused
  naming `v2`.
- The two `aura` rows are identical at both revisions: the `v3-genesis` sibling-kind
  work is untouched.
- The tampered row is refused by both revisions, which is what stops this being a check
  that only ever says yes. Its pinned reason is the closed set (the pinned verifier never
  reaches the signature on a 7-field document) and its current reason is `signature`.

The separate `scripts/verify-composition-base.py` check proves the versioned contract
itself — both bases accepted, unknown names refused by name, contradictions refused
naming the base, and the declaration inside the signature — without needing the pinned
bytes.

## What it does not do

- It does not decide the release question. Whether Genesis emits a `compositionBase` is
  a **change in Genesis**; this check is evidence for it, not the decision.
- It does not modify Genesis, repin its verifier, loosen either base, or relabel any
  signature or `kind`.
- It does not test against Genesis's own emitter. Genesis is neither imported nor
  modified here. (Separately measured and reported on issue #3: Genesis's gate pins the
  5-field set, so it cannot *emit* a 7-field receipt without its own change.)
- It says nothing about whether a receipt is true, whether a human was present, or
  whether a receipt authorizes anything. Evidence never authorizes; grants authorize
  composition.

## Provenance and licences for every compared byte

Full digests in `pins.json`; the runner re-verifies all of them before comparing,
and refuses with `PIN DRIFT` if any byte moved.

**`pinned/` — AGPL-3.0-or-later, from `aumara-xyz/aukora-toy` (now `aukora-diamond`)
at `c512d0cbc35da8e0c410894a768a323fccac514d`.** The byte-for-byte transitive import
closure of the pinned `diamond.receipt` seam: `__init__.py`, `receipt.py`,
`ed25519.py`, `jcs.py`, `hexutil.py`. Chosen because that commit is exactly what
Genesis vendors today, so the pinned acceptance behaviour is checkable here
without a checkout of Genesis. Digests match the `files[]` entries in Genesis's
own `vendor/receipt-v3/upstream-receipt-v3.json`, which is independent
confirmation that both repositories vendored identical bytes. These files are a
frozen comparison input and are never imported by the current revision.
`cold_verify.py` is deliberately not snapshotted: the comparison is against the
`receipt.py` seam, and a CLI wrapper would add surface without adding a
comparison. Licence text: `../../LICENSE` (this repository, same AGPL-3.0).

**`fixtures/` — AGPL-3.0, from `aumara-xyz/aukora-genesis` at
`8d8601a32033f6b2c4238243c5404951c18a0e78`.** `vendor/receipt-v3/fixtures/receipt.json`
(a real `aukora-receipt/v3-genesis` produced by the Genesis composition gate) and
its **public** `issuer.pk`. Digests match the `fixtures[]` entries in Genesis's
pin manifest. `issuer.pk` is public; **no issuer secret key exists in this tree,
in Genesis, or in this comparison.**

**Re-signed comparison documents are not committed.** They are generated at run
time by the runner. The signing seed is the fixed constant `THROWAWAY_SEED` in
`test-pinned-contract.py` — public, written in the source, and worthless. It
exists so the comparison bytes carry a real Ed25519 signature this check can
regenerate without storing any secret, and so the one variable under test is isolated:
signature validity is held constant across variants and a refusal therefore cannot be
explained by a bad signature. Documents that declare a base are signed the way this
revision signs, because a declaration the signature does not cover is refused — and
that refusal is itself one of the arms in `scripts/verify-composition-base.py`.

## Reproducing the measurement by hand

```bash
git -C <diamond> worktree add --detach /tmp/rev-pinned c512d0cb
PYTHONPATH=/tmp/rev-pinned python3 -B -m toy.cold_verify \
    tests/pinned-contract/fixtures/genesis-receipt.json \
    --pub tests/pinned-contract/fixtures/genesis-issuer.pk   # rc 0, its only base
PYTHONPATH=<diamond> python3 -B -m diamond.cold_verify \
    tests/pinned-contract/fixtures/genesis-receipt.json \
    --pub tests/pinned-contract/fixtures/genesis-issuer.pk   # rc 0, COMPOSITION BASE: v1
```

The first command is how issue #3 measured the older conflict; the second is what
changed — the committed fixture verifies here now, and the court says which base it
checked rather than refusing on a field count. The check above does the same comparison
in-process, without needing the worktree.
