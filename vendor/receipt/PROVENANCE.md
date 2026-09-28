# PROVENANCE — vendor/receipt-v3

What this directory is: the smallest self-contained copy of the aukora-toy cold receipt
court. A stranger holding a receipt JSON, a public key file, and these bytes can verify the
receipt offline, from an empty directory, with no sibling checkout and no network.

## THIS PIN IS A COURT UPDATE, NOT AN UNCHANGED COPY

It replaces `b288ff6b95d38e74b18519e0f3262d5e802fb856` and it is **not the same court**.

| | previous pin | this pin |
| --- | --- | --- |
| commit | `b288ff6` | `c512d0cbc35da8e0c410894a768a323fccac514d` |
| accepted kinds | `v3-toy`, `v3-toy-fixture` | the same, **plus `v3-genesis` and `v3-genesis-fixture`** |
| `aura` closed set | six fields | six for the toy kinds, **seven for the genesis kinds** (`priorHead` required) |
| `composition` closed set (genesis) | five fields | **seven**: Diamond's `compositionDigest` and `subjectDigest` required |
| licence | MIT | **AGPL-3.0** |
| a Genesis receipt | refused — `FAIL: kind` | **verifies** |

Upstream accepted the extension in `aumara-xyz/aukora-toy` PR #2, whose own test file
(`scripts/verify-v3-genesis-acceptance.py`, 8 arms) is the evidence for the schema change.
The behaviour of the two `v3-toy` kinds is unchanged: a `v3-toy` receipt carrying `priorHead`
is still refused as closed fields, a `v3-genesis` receipt missing it is still refused, and a
`signed` receipt whose `kind` alone is changed still fails **signature** verification, because
the kind string is the signature domain.

## Upstream

| field | value |
| --- | --- |
| repository | `github.com/aumara-xyz/aukora-toy` |
| commit | `c512d0cbc35da8e0c410894a768a323fccac514d` (`c512d0c`, "Merge pull request #2") |
| licence | **AGPL-3.0** — see `LICENSE`; first-party pin: sha256 `1f7e2277a29ae557cc0c3ae44a50e51934045bc95bf1311ff933fb312aa0b27e`, 35,209 bytes |
| vendored | the cold verifier's transitive import closure, plus the repo-root `LICENSE` |
| manifest | `upstream-receipt-v3.json` (this directory), checked by `scripts/phase0-check-pins.py` |

### The licence changed upstream, and the change was caught rather than carried

The previous pin recorded MIT, correctly: at `b288ff6` the `LICENSE` file opened "MIT License
/ Copyright (c) 2026 aukora-toy contributors". At `c512d0cb` the same path holds an
**AGPL-3.0** licence. Nothing was relicensed by this repository; the licence text from line 2
onward is upstream's. The current copyright line is a local departure, recorded below; the
local pin is in the table above.

`scripts/distill-upstream.py` **refused to write this pin** while it was told `--license MIT`,
because the licence family it reads in the file is not MIT. That refusal is the whole reason
the tool exists: an inherited licence claim is exactly the error that was made twice on this
project, and here the machine caught it instead of a reader.

**2026-09-22 note (corrected).** `LICENSE`'s first line is `Copyright (c) 2026 Aumara and Peter
Viviani`, naming Aumara and Peter Viviani as the holders. The sha256 and byte count above are
this repository's own first-party pin, not a claim that upstream `c512d0cb` matches byte for
byte. Lines 2 onward of `LICENSE`, the licence family and the vendored closure trace to that
commit; file-specific departures are recorded below.

## Vendored — the verifier's closure only

`toy/__init__.py`, `toy/cold_verify.py`, `toy/receipt.py`, `toy/ed25519.py`, `toy/jcs.py`,
`toy/hexutil.py`, and the root `LICENSE`. `toy/receipt.py` carries a Genesis-kind composition extension (`compositionDigest` and `subjectDigest` required, matching Diamond); the other verifier files remain the c512d0cb closure. `cold_verify` imports
`hexutil` and `receipt`; `receipt` imports `ed25519`, `hexutil` and `jcs`; those import the
standard library only.

**Deliberately NOT vendored**, and listed in the manifest's `notVendored`: `toy/loader.py`,
`toy/grant.py`, `toy/aura.py`, `toy/court.py`, `toy/mediator.py`, `toy/patent_license.py`,
`toy/checkpoint.py`, `toy/lock.py`, `toy/refuse_codes.py`, `toy/retain_handoff.py`,
`toy/verify_pair.py`, `toy/demo.py`, `toy/__main__.py`. This is the stranger's court, not the
producer: Genesis has its own composition gate and does not want a second unrelated loader.

## The fixture is Genesis-produced

`fixtures/receipt.json` is a real `aukora-receipt/v3-genesis` receipt emitted by
`scripts/composition` — the same code that issues receipts in production — and
`fixtures/issuer.pk` is its public key. It was reminted so the composition block
carries Diamond's required `compositionDigest` and `subjectDigest`.

No secret key is committed: there is no `issuer.sk` in this tree, and every test re-verifies
the signature from the public key alone.

## RECORDED DEPARTURE: `toy/ed25519.py` carries a small-order check this pin adds (KIRA, 2026-09-26)

`SECURITY.md` says `vendor/receipt-v3/` is a byte-pinned copy and that a fix is normally made where those bytes come
from and then re-pinned. This one is recorded as a DEPARTURE, the way the `LICENSE` replacement above is, because the
defect is a live forgery and the upstream revision is not ours to cut:

**The defect, measured rather than read** (`tests/aukora-toy-ed25519-smallorder.test.mjs`, red before the fix): the toy
had no noncanonical-sign, noncanonical-point or 8-torsion check, so under the IDENTITY public key (`01` then 31 zero
bytes) `verify` computes `right = R + k*A` where `k*A` is the identity — the message drops out of the equation and the
signature `R = B, s = 1` verifies **two different messages** with no private key. The identity key was accepted among
the eight small-order keys.

**The departure:** the three checks Diamond has carried all along
(`vendor/diamond-cold/diamond/ed25519.py`) are ported into this file's `_decode_point`: a noncanonical sign bit, a
noncanonical point encoding, and `_mul(8, point) == (0, 1)`. `upstream-receipt-v3.json` records the resulting bytes
(4510 → 5473) and `scripts/phase0-check-pins.py` checks them, so the pin and the file agree rather than one silently
drifting from the other.

## PER FILE: WHICH UPSTREAM BYTES EACH VENDORED FILE MATCHES, AND WHERE ITS HOME IS

**A BLANKET SENTENCE WAS WRONG HERE, AND THIS SECTION REPLACES IT.** An earlier note said the three small-order checks
"belong upstream, after which this file is replaced by the distilled upstream bytes" — one claim covering a whole
directory, and the future it described does not exist: **under the 2026-09-24 decision, DIAMOND IS NEVER PUBLISHED**, so
no upstream re-cut will arrive for any of these files. Departures are recorded PER FILE, because that is the only form
in which a reader can check one.

Measured on this disk, 2026-09-26. The two upstreams named in this repository are `aukora-toy @ c512d0cb` (the commit the
manifest below records, whose bytes are NOT on this disk) and `aukora-diamond @ 0d3cc665d88a905d89f22211546ec7e445cb5c46`
(whose tree IS on disk at `vendor/diamond-cold/`, and against which the python files below were compared byte for byte).
The `git blob` column is the identifier an outside audit used, so its finding can be matched to this table.

| file | git blob | sha256 (short) | upstream bytes it matches | permanent home |
|---|---|---|---|---|
| `toy/__init__.py` | `aa3dbd46c8df` | `48eb118ec734d2c4` | **aukora-diamond, byte-identical** | upstream, as vendored |
| `toy/hexutil.py` | `3205f8c2ccb6` | `82d1f9a3b7caa9c2` | **aukora-diamond, byte-identical** | upstream, as vendored |
| `toy/jcs.py` | `6a05e3c100cd` | `cf8f1558dbaa72d9` | **aukora-diamond, byte-identical** | upstream, as vendored |
| `toy/cold_verify.py` | `94943ba51980` | `de68ad78c9187427` | **not verifiable on this disk** — no diamond counterpart; the manifest records it from `aukora-toy @ c512d0cb`, whose bytes are not present | **GENESIS IS ITS PERMANENT HOME** |
| `toy/receipt.py` | **`908993ed61f1`** | `1a64984ae4fb35fe` | **NEITHER UPSTREAM — A GENESIS EDIT.** It matches neither `aukora-toy @ c512d0cb` nor `aukora-diamond @ 0d3cc66`. **The manifest carries no note saying so**, which is a gap in the pin rather than in this table: the pin proves a file matches the MANIFEST, and the manifest's silence about this file is why an outside audit found it and the checker did not. | **GENESIS IS ITS PERMANENT HOME** |
| `toy/ed25519.py` | `55eeff95ad03` | `d3696cbc8d8b9843` | **NEITHER — a recorded departure**: the three small-order checks ported from Diamond, then Codex's modular negation (`x = (-x) % P`). Both are described below. | **GENESIS IS ITS PERMANENT HOME** |
| `LICENSE` | `4aed80e4cc99` | `1f7e2277a29ae557` | **NEITHER — a recorded departure**: the copyright-holder line was changed, and the manifest notes it. | **GENESIS IS ITS PERMANENT HOME** |
| `fixtures/receipt.json` | — | `289d2160d181dc29` | **never upstream bytes**: a real `aukora-receipt/v3-genesis` receipt produced by the Genesis composition | **GENESIS IS ITS PERMANENT HOME** |
| `fixtures/issuer.pk` | — | `f04c5b8d225dc93b` | **never upstream bytes**: the public key for that receipt (public only; no `issuer.sk` is committed) | **GENESIS IS ITS PERMANENT HOME** |
| `upstream-receipt-v3.json` | — | — | **never upstream bytes**: this manifest, which cannot carry its own digest | **GENESIS IS ITS PERMANENT HOME** |
| `PROVENANCE.md` | — | — | **never upstream bytes**: this record | **GENESIS IS ITS PERMANENT HOME** |

**For every file whose bytes are not upstream's, the answer to "will an upstream re-cut replace this?" is NO, and the
reason is the same one:** Diamond is never published. Nothing is owed upstream for these bytes; what is owed is that the
difference stays visible here, in the pin, and in the courts that would go red if a protection were removed.

## SECOND RECORDED DEPARTURE: `toy/ed25519.py`, the modular negation (Codex's review, 2026-09-26)

A reviewer (Codex, review `codex-ed25519-smallorder-r1.md`) confirmed the small-order fix closed the
flaw — all eight small-order points are rejected — and found one further defect in the same function, which is fixed
here: `_decode_point` negated with `x = P - x`, and when `x` is 0 with the sign bit set that produces `P`, which is out
of range. The point was still refused, by the re-encode check below it, so this was never a bypass; what it defeated was
the NONCANONICAL-SIGN check, whose named refusal could never fire. It is now `x = (-x) % P`, and the named refusal does
its job.

**The bytes and the pin moved together again** (5473 → 6026), and `scripts/phase0-check-pins.py` checks them, so the pin
and the file agree rather than one silently drifting from the other. See **PER FILE**, above, for what this file matches
and why Genesis is its permanent home: Diamond is never published, so no upstream re-cut will replace these bytes and
nothing is owed upstream for them.
