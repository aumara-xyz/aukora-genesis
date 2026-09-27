# Phase 0 consistency — vendored bytes, and how to run them cold

This directory is a **vendored copy** of `github.com/aumara-xyz/aukora-membrane`
`minimal/` at commit `d8b17faca5f17bb6e279feb30a2ea808a1f31cb8`. Nothing here was
edited. `upstream-phase0.json` pins the sha256 and byte length of every file, and
`scripts/phase0-check-pins.py` recomputes both from the bytes on disk.

## Run it

```bash
python3 vendor/phase0-consistency/verify.py --selftest
```

No network, no sibling checkout, no arguments, no repository state: the four checks
are computed in memory from constants in `verify.py` itself. Expected output:

```
aukora minimal verifier — standalone in-memory self-test

  ok  positive control (m=5, n=14) -> APPEND_ONLY
  ok  power-of-two valid extension (m=4, n=14) -> APPEND_ONLY
  ok  earned accusation (m=5, n=14, modified root) -> OBSERVATION_CONFLICT
  ok  power-of-two blind spot limit (m=4, n=14, corrupted proof) -> UNDETERMINED (POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE)

SELFTEST: 4/4 checks passed — all green
```

Exit status is 0 only when all four pass.

The same three verdicts on the vendored vector files:

```bash
python3 vendor/phase0-consistency/verify.py vendor/phase0-consistency/vectors/retained.json   vendor/phase0-consistency/vectors/append-only.json     # APPEND_ONLY
python3 vendor/phase0-consistency/verify.py vendor/phase0-consistency/vectors/retained.json   vendor/phase0-consistency/vectors/rewritten.json       # OBSERVATION_CONFLICT
python3 vendor/phase0-consistency/verify.py vendor/phase0-consistency/vectors/power-of-two-retained.json vendor/phase0-consistency/vectors/power-of-two-presented.json   # APPEND_ONLY
```

## Check the pins

```bash
python3 scripts/phase0-check-pins.py             # every vendored byte still matches
python3 scripts/phase0-check-pins.py --mutate    # one pinned file altered in a disposable copy must be refused
```

`--mutate` copies the tree to a temporary directory, appends a line to `verify.py`
there, and requires the checker to refuse the copy. A checker whose "pass" cannot be
flipped by a changed byte is decoration.

**A stale note, kept visible rather than quietly deleted.** An earlier version of this
file recorded that the checker read only `upstream-phase0.json`, walked every regular file
under this directory, did not know about `replicas/` or `upstream-replicas.json`, did not
honour `rust-verifier/.gitignore`, and therefore reported `PINS FAILED (198 problem(s))`
the moment the required `cargo build` ran — six replica source files, 191 files under
`rust-verifier/target/`, and `upstream-replicas.json`, none of them a digest mismatch.

That is fixed: the checker now reads every `upstream-*.json` manifest, so `replicas/` has
its own pin set and its own per-file digests, and it treats a `target/` path component as
build output rather than as drift. The number the checker prints today is on the next
line, and it is the number a reader should check against the run rather than against this
sentence. The old failure is left here because it is the reason the exclusion exists: the
checker could only have passed in a tree nobody had built, and a vendored verifier that
has never been built is not evidence that it works.

## What this does not say

The permitted claim is exactly the one in `CLAIM.md`: retaining an observation of
tree size `N` with root `R1` lets an observer test whether a presented tree of size
`M >= N` with root `R2` is an append-only extension of the retained observation.
`APPEND_ONLY` is not truth, not occurrence, not identity, and not proof that only one
log exists. `UNDETERMINED` is a refusal, not a soft accusation. `OBSERVATION_CONFLICT`
is the only verdict that accuses, and it accuses a *presentation*, never a person.

Known limit, declared by the program rather than hidden: when the retained size is a
power of two the retained root is the fold seed, so a rewritten prefix and a damaged
proof are mathematically indistinguishable — the verifier says so and refuses to
accuse.

## Files

| File | Origin |
| --- | --- |
| `CLAIM.md` | `minimal/CLAIM.md`, verbatim |
| `verify.py` | `minimal/verify.py`, verbatim; the same bytes are pinned by Deep at `c417f7c5` |
| `tour.py` | `minimal/tour.py`, verbatim — teaching artifact, not run by CI |
| `vectors/` | `minimal/vectors/`, verbatim |
| `LICENSE` | upstream AGPL-3.0 text, copied with the bytes it covers |
| `upstream-phase0.json` | Genesis-authored pin manifest, not upstream |
| `upstream-replicas.json` | Genesis-authored pin manifest for `replicas/`, not upstream |
| `replicas/` | `minimal/replicas/`, verbatim; `target/` build output not vendored |

`tour.py` is vendored so the upstream teaching file travels with the bytes it
teaches, but it is **not** run by CI: it reads `docs/heads/demo/` and other paths that
belong to the membrane repository. Run from here it prints `MISSING!!` beside the
paths this slice does not carry — that marker is the file being honest about what it
cannot reach, not a verdict. It decides nothing itself; it shells out to `verify.py`.

## The Rust replica

`replicas/` holds the third-runtime verifier from the same upstream commit
`d8b17faca5f17bb6e279feb30a2ea808a1f31cb8`, at `minimal/replicas/`. It was excluded
from the first vendoring pass; `upstream-phase0.json` still lists `minimal/replicas/`
under `notVendored`, and `upstream-replicas.json` now pins the source bytes that were
taken from it. Those source bytes are verbatim and unedited like everything else here.

It was **authored independently against the published wire shape**, from
`specs/0060-retained-head-demonstrator.md`, and **not ported from `verify.py`**. Why a
second language is real evidence and a second file is not: two verifiers written in the
same language share number and JSON semantics, so they are forced to agree on the
inputs where those semantics decide the answer — their agreement carries no independent
information about that class of defect. Rust and CPython do not share those semantics,
so agreement here is evidence about the walk rather than about the parser. It is
evidence about the *walk* only; nothing about this arrangement makes either
implementation correct, and a shared misreading of the spec would still make both
agree.

Build and run it:

```bash
cd vendor/phase0-consistency/replicas/rust-verifier
cargo build --release
./target/release/aukora-verify-rs \
  ../../vectors/retained.json ../../vectors/append-only.json   # APPEND_ONLY
```

Compare against `python3 verify.py <retained> <presented>` on the same pair. On
`vectors/retained.json` versus `vectors/append-only.json` both print
`VERDICT: APPEND_ONLY` / `REASON : valid_append_only_extension`. Both binaries print
the sha256 of each input they read, which is what makes the comparison checkable rather
than a claim.

`target/` is build output, is not vendored and is not pinned: `rust-verifier/.gitignore`
carries `target/`, so a build adds no line to `git status --porcelain` and no build
artifact can be committed by accident. Cargo fetches `sha2` and `serde_json`, so the
first build is not offline.

One known limitation, stated by the replica's own README rather than discovered here:
its JSON extraction is intentionally minimal and is not a full parser. On duplicate keys
and exotic encodings it may disagree with the Python verifier's `object_pairs_hook`
path. That disagreement would be a **finding about the replica, not a vote on the
record** — it would say the Rust admission layer is wrong or narrower, and would not
move the verdict on any tree.

`replicas/rust-verifier/src/serde_probe.rs` builds a second binary, `serde-probe`, which
prints `OK` / `FAIL` / `DECODE_FAIL` for a file's raw `serde_json` behaviour. It carries
no admission rules and decides no verdicts; it is a substrate probe, vendored because it
travels with the crate.
