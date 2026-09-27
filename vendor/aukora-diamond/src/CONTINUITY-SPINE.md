# Continuity spine

Diamond is a **cold stranger verifier**. This file pins the propose / contain /
verify stack that was measured in `aukora-deep` so a later reader cannot
collapse Channel 0 (propose shaping) into Channel 1 (stranger check), or
treat evidence as a license to run a proposer here.

Nothing in this file authorizes a load, a spawn, a mint, or a consensus
vote. Evidence never authorizes. Identity never crowns. Grants authorize
composition — and Diamond does not become a grant issuer by documenting
one.

## Re-check status (2026-09-21)

**Locally measured source bytes**, replacing the earlier web-access-limited report.
The measured files match their committed bytes. This is not a new runtime,
confinement, or Electron deployment measurement. Full machine-readable results:
[`tests/continuity-spine/local-pins.json`](tests/continuity-spine/local-pins.json).

| Pin | Source revision / path | Measured SHA-256 |
| --- | --- | --- |
| WASM module, decoded from source; 101 bytes | Deep `7be3a614aab0580ec2d60cdcf77920217695ef2b`, `aukora/guest/wasm-proposal-cell.mjs` | `34ce6cab618b626243e876befb49ccf8a6780dc836e757484886b34ae977a438` |
| Cell JavaScript wrapper; 5,484 bytes | same revision/path | `379d1a0514dd83cc6d23880f3509aa1438d55a10977ac95edbde9bd65f975197` |
| WAT source text; 452 bytes | same Deep revision, `aukora/guest/wasm/memory-put-proposal.wat` | `d73e8d223973e03d24a48c4ab3b035e9505375b0cc2a29e65a233af20cc807d8` |
| Seatbelt source; observation literal present | same Deep revision, `aukora/supervisor/guest-confinement.mjs` | `9ccbc5a68ee13a9e84ab963ccbf202d8d920705653214af99857014b4879a7c0` |
| Genesis vendored minimal verifier | Genesis `44faca2f9c004d0b9bbdfe1273b08cf46bc08a8b`, `vendor/phase0-consistency/verify.py` | `039aa8999f9a1e1a8b8e01eb51598bfc546e4e574b2c9333f13e8bb303958089` |
| Membrane minimal verifier | Membrane `d8b17faca5f17bb6e279feb30a2ea808a1f31cb8`, `minimal/verify.py` | `039aa8999f9a1e1a8b8e01eb51598bfc546e4e574b2c9333f13e8bb303958089` |
| Spec Alpha source oracle | Alpha `ddb6a9cc9860fce840283b0010e24e7d627fa9db`; six source/document paths | locally re-hashed in `local-pins.json`; runtime **not executed here** |

Reproduce with `python3 -B tests/continuity-spine/measure_pins.py --deep <deep>
--genesis <genesis> --membrane <membrane> --spec-alpha <alpha> --out <report.json>`.
Missing files, uncommitted measured bytes, or drift in the required wrapper,
decoded-module, WAT, verifier pins or observation literal fail closed. The module
must also be exactly 101 bytes. The wrapper's declared module digest is checked
against the decoded bytes and the fixed module pin. WAT and binary are distinct
artifacts; measuring both does not prove the binary was compiled from that WAT.
The command reads and decodes source; it never runs or vendors the cell.
Sibling repositories are needed only for this opt-in measurement, not Diamond's
consumer or CI.

**Blob SHA-256 values are the match predicates; commits record provenance.** An
unrelated new commit with identical measured blobs is accepted. Each working file
must still equal the bytes at the HEAD recorded for it. The focused controls are
`python3 -B tests/continuity-spine/test_blob_pins.py`; they separately break the
wrapper, module, WAT, declaration, module length and working-tree/HEAD agreement,
and refuse substitution of WAT for module or module for WAT.

The wrapper and WAT blobs at measured Deep `7be3a614` are byte-identical to those
at published main `c417f7c5752bf14b8e927986cd995f2e086f4189`; consequently the
wrapper's embedded module is identical too. The Genesis verifier blob `039aa899…`
is also present at published main `17ee5ef72b3751265a59b54d3f5dad489ecbe295`.
Both published main refs were checked using `git ls-remote`, and their local Git
objects were hashed directly. Neither historical Genesis `195431e8` from the prior
report nor the newer measured source commit is evidence of deployment. Source
HEAD, installed shell, backend release and effective preset remain separate facts.

## Doctrine (load-bearing)

**Diamond = offline consumer / cold courts.**

This names the Channel 1 consumer, not an erasure of repository history. Existing
`loader`, `grant`, `mediator`, `demo` and simulated-device modules remain the
labelled sealed control-plane toy. The executable continuity court keeps their
authority/runtime modules outside the cold consumer's import closure and refuses
new runtime modules or named Deep/Seatbelt/Electron surfaces. Shared legacy
crypto/receipt modules still contain signing helpers; their presence is not a
claim of independent custody or a verifier sandbox.

- Evidence never authorizes.
- No WASM **proposal cell** execution.
- No Seatbelt guest spawn.
- No broker / issuer.
- No Electron.
- Do **not** import or vendor the deep WASM cell binary into Diamond as a
  runtime.
- Do **not** add Shear / Lotus / 108 / consciousness claims to Python
  verifier code, and do not claim AGI or consciousness anywhere in this
  repository's executable surface.

Vibes, if any, stay in short labeled `VISION` / `FENCE` sections of
markdown ceilings. They are not architecture.

## Two channels (do not collapse)

| Channel | Role | Where it was measured | In Diamond? |
| --- | --- | --- | --- |
| **0 — propose shaping** | Shape a proposal inside a containment boundary before anyone treats it as an act | `aukora-deep` WASM cell + same-UID Seatbelt guest | **No.** Documented only. |
| **1 — stranger check** | A second machine, later, checks bytes it did not produce | Diamond `cold_verify` + Phase 0 / Genesis consistency + optional membrane | **Yes.** This is the job. |

A receipt, a JSON body, or a green Channel 1 verdict is not proof that
Channel 0 ran. See Check-18.

---

## 1. Zero-WASI WASM proposal cell (`aukora-deep`)

**Status:** `MEASURED_LOCAL` — source and decoded module hashes only.

| Field | Pin |
| --- | --- |
| Role | Channel 0 propose shaping — not verification, not authorization |
| Decoded module SHA-256; 101 bytes | `34ce6cab618b626243e876befb49ccf8a6780dc836e757484886b34ae977a438` |
| Wrapper SHA-256 | `379d1a0514dd83cc6d23880f3509aa1438d55a10977ac95edbde9bd65f975197` |
| WAT source SHA-256 | `d73e8d223973e03d24a48c4ab3b035e9505375b0cc2a29e65a233af20cc807d8` |
| Stated host | `github.com/aumara-xyz/aukora-deep` |
| WASI | Zero-WASI (no WASI host imports as the measured cell surface) |
| Diamond action | **Reference only.** Do not execute. Do not vendor as a runtime. |

### Check-18 lesson (do not lose)

Identical JSON can bypass the cell in same-process Node. A receipt that
names a cell, carries a digest, or is byte-identical to a cell's output
does **not** prove the cell ran.

Channel 1 courts (including every court in this repository) verify
documents. They do not reconstruct a guest. Treating a valid receipt as
"the cell executed" is a category error — the same class as
`evidence:never-authorizes`.

A future Diamond WASM packaging of **cold-verify** (see
`STAGE0-CONSUMER-READINESS.md`) is a *copy of a verifier*, not this
proposal cell, and does not close Check-18.

---

## 2. Same-UID Seatbelt guest (`aukora-deep`)

**Status:** `MEASURED_LOCAL` — source hash and observation literal only.

| Field | Pin |
| --- | --- |
| Observation class | `MACOS_SEATBELT_GUEST / SAME_UID_AUTHORITIES / NO_CUSTODY_CLAIM` |
| What it can constrain | The guest process's permitted OS effects under the actual applied profile; no new confinement execution is measured here |
| What it does **not** establish | WASM traversal, multi-UID/root isolation, or independent custody against a malicious same-UID host |

**Check-18 remains open as an execution-provenance question.** A confined guest
can compute identical JSON without calling WASM and send it through an allowed
broker socket. Seatbelt restricts effects, not the computation path that made
those bytes. Authority checks must hold regardless of that path.

This is the same honesty Diamond already prints as `SAME_UID` and
`PYTHON_RUNTIME_TCB` on *its* in-process toy: a same-uid boundary is a
digest / profile binding, not custody. Deep's guest is a stronger
*process* measurement than Diamond's in-process plugin. It is still not
a custody claim.

Diamond does not spawn this guest.

---

## 3. Minimal / cold verifier lineage (Channel 1)

These courts have related arithmetic but distinct input contracts. The Genesis
vendor and Membrane verifier are **byte-identical**, as measured above; agreement
between those copies is not a second implementation. Re-hashing is provenance
measurement, not a new cross-implementation correctness proof.

| Court | Path | What it checks | In this repo? |
| --- | --- | --- | --- |
| Diamond cold receipt | `diamond/cold_verify.py` (`./scripts/cold-verify`) | `aukora-receipt/v3-*` JSON + caller-supplied pubkey (fail closed without) | **Yes** |
| Diamond Phase 0 | `vendor/phase0/verify.py` | retained vs presented `(size, root)` | **Yes** — own implementation, own vectors |
| Genesis phase-0 consistency | `github.com/aumara-xyz/aukora-genesis` `vendor/phase0-consistency` | same arithmetic family, Genesis-vendored bytes | **No** — `MEASURED_LOCAL` source digest |
| Optional membrane | `aukora-membrane` `minimal/verify.py` | same family; **different CLI** (two positional paths, not `--retained`/`--presented` or a pair object) | **No** — `MEASURED_LOCAL` source digest |

README already records the cost: pointing someone at this Phase 0 court
and handing them a membrane vector fails with an argument error that
looks like a bug. Translate explicitly. Do not assume the files are
interchangeable.

Skipping Phase 0 leaves consistency `CONSISTENCY_UNCHECKED`. Cold verify
is never Phase 0. Neither court is a proposer.

---

## 4. Evidence spine ≠ money blockchain

Aura is an **append-only observation log**: hash-linked entries, Merkle
`(size, root)`, offline verify of a retained head against a presented
head. That is a **continuity** spine — a stranger can keep N and later
check M.

It is **not**:

- a money blockchain
- a token, coin, or commodity
- consensus
- public finality
- authorization

Optional later work (not in this tip): notarize a public root so a
third party can see that *a* root existed at *a* time. That would still
be evidence. It would not mint money and it would not authorize a
composition. See the `FENCE` on time beacons below.

`CEILINGS.md` already prints: append-only is cryptographic/logical, not
a crash-safe disk WAL; not L1; not a blockchain.

---

## 5. Genesis gap (contract Diamond documents; Fable mounts)

**Status:** `LIVE_MOUNT_NOT_MEASURED_HERE`. Earlier handoffs reported the mount
absent. This source measurement does not establish the current installed shell,
backend release, effective preset or tool invocation. The Genesis owner measures
those; Diamond must not turn that historical report into a current deployment claim.

| Owner | Job |
| --- | --- |
| **Genesis implementation owner** | Mount and test the proposal cell on the existing application path; confinement remains a separately measured increment |
| **Diamond** | Document the contract. Remain a cold stranger verifier. Refuse to become the proposer so the mount has a court that did not also run the guest |

Diamond does not grow an Electron shell, a broker, or an issuer to
"help" close this gap. Closing it by putting the cell in this
repository would destroy the stranger property.

The read-only inventory found Genesis's new source closure committed at
`44faca2f9c004d0b9bbdfe1273b08cf46bc08a8b`, under
`plugins/aukora-kira/lib/wasm-cell/`. Its `PROVENANCE.json` names Deep `c417f7c5`,
three runtime files and nine pinned artifacts; each row separates `deepBlobSha1`
from content `sha256`. This was concurrent implementation work, beyond the
published Genesis main pin above. Diamond has not adopted that manifest as a
stable producer contract or verified a materialized release carrying its closure.
A future supply-chain check needs an exact published producer/release pin and a
frozen closure fixture. It can check closure bytes, never attest that the cell ran.

The proposed Kira v1 envelope `{format, canon, algs: {hash, sig}}` also awaits its
producer and a usable public fixture. At the inspected Genesis and Deep source
pins, records still use `aukora:kira-memory-record:v0`; Genesis's existing record
court explicitly refuses the v1 domain. The public `operation-envelope-v1`
fixture wraps a v0 record and is not that proposed envelope. Diamond must not
invent algorithm labels, a domain migration, or a signature preimage for it.

Retained memory checkpoints have a real Deep producer in
`aukora/aura/checkpoint.mjs`: `{domain, treeSize, root, commitment, streamNamespace}`
with domain `aukora:aura-checkpoint:v1`; presentations additionally carry
`proofFromPrevious`. They are unsigned and the namespace is an unverified label.
That wire, Genesis's composition retainer and Diamond's `aukora-checkpoint/v1-toy`
are different contracts. A Kira integration still needs the selected producer's
retained/presented fixture and explicit association to the memory history. None
of those documents proves latestness, independent custody or execution.

This candidate also offers a narrower, existing-wire control:
`verify-kira-evidence.py --retained-receipt <separately-retained-kira-receipt.json>`.
It verifies that retained receipt under the caller's supplied issuer anchor and
checks the log prefix through its signed position. An honest short prefix that
passes without retention refuses `RETAINED_CHECKPOINT_TRUNCATED` when it omits the
supplied later checkpoint. A divergent prefix refuses
`RETAINED_CHECKPOINT_CONFLICT`. `SUPPLIED_PREFIX_MATCH` establishes only agreement
with that supplied Kira receipt; `completeness: UNDETERMINED` and
`latestness: NO_LATESTNESS` remain on every report. This is not an implementation
of the separate Aura Merkle checkpoint profile or a persistence service.

Legacy Kira v0 receipts remain supported within Diamond's exact integer numeric
subset. Decimal numbers and integers outside ECMAScript's safe range return
`UNSUPPORTED_NUMBER`, including wrapper and approval-artifact CLI paths. Decimal
strings remain ordinary strings. This does not impose Alpha's Receipt v3
canonicalization on Kira or claim full ECMAScript number serialization.

---

## `aukora-spec-alpha` (source oracle; no runtime imported)

Spec Alpha is a source oracle for approval-mode and Seatbelt honesty. Diamond
absorbs the closed ceiling table in `CEILINGS.md`, public-key-only stranger
controls, and the rule that a claimed human approval is not attendance evidence.
No Alpha Node kernel, approval reader, profile launcher or model is copied or run.
The optional measurement command accepts `--spec-alpha <checkout>`; mandatory CI
requires no sibling checkout.

Alpha's process-local proof-mode registry is not an exported human-presence proof.
Existing Diamond composition receipts contain no such fields and remain
mode-unbound; existing Kira receipt labels remain reported, never observed presence.
Kira's unsupported `human-ceremony` label refuses with `APPROVAL_CLASS_UNSUPPORTED`.
Other unrecognized labels and injected presence fields remain closed-schema refusals.

Runtime mounts belong to Genesis. Retiring or archiving the Alpha showcase is an
owner decision only after Genesis courts cover the intended live claims; this PR
does not retire it or call the runtime integrated.

---

## FENCE — optional future time beacon (`SPECULATIVE` / later)

**Not in this tip. Not a court. Not authorization.**

A later continuity brick may attach a **time beacon** so a stranger can
say "not before" / anti-predating about an observation:

- **drand** — a public randomness beacon; a receipt could name a round
  whose randomness was not knowable earlier.
- **VDF** (verifiable delay function) — a proof-of-delay; expensive to
  start early, cheap to verify later.

This would be a continuity aid. It would **not** be:

- consensus
- money
- a clock that authorizes a grant
- a substitute for `--pub` / trust-anchors
- proof that Channel 0 ran

Print any such field as reported evidence. Do not teach a court to
activate from a beacon. `SPECULATIVE`. Later.

---

## VISION (one paragraph; not executable)

A stranger on a second machine should still be able to keep an earlier
observation and check a later one after the proposer, the Electron
host, and the guest are gone. Channel 0 exists so a proposal can be
shaped without thereby granting effect authority. Channel 1 exists so the
shaped bytes can be checked without trusting the shaper. Diamond is
Channel 1. That is the whole vision. It is not a consciousness claim
and it is not an architecture change.

---

## Forbidden in this repository (Diamond-as-proposer)

The following are **out of Diamond**, including as "just a demo":

1. Execute, embed, or vendor the deep WASM **proposal cell** as a
   runtime (the digest above is a reference, not a payload).
2. Spawn a Seatbelt guest, a broker, an issuer, or an Electron shell.
3. Treat a Channel 1 verdict as proof the cell ran (Check-18).
4. Treat Aura append-only as a money chain, a token, or consensus.
5. Claim independent custody from a same-UID Seatbelt guest.
6. Import Shear / Lotus / 108 / AGI / consciousness into verifier
   code.

See `CEILINGS.md` and `SECURITY.md`. Courts stay green only if they
remain courts.

## Executable continuity contract

`./scripts/diamond.sh` now runs the continuity boundary court and its mutations,
including Check-18, before the existing Diamond court. See
[`tests/continuity-spine/README.md`](tests/continuity-spine/README.md).

Cold receipt output prints `CELL_EXECUTION: NOT_ESTABLISHED`. Kira reports carry
`execution: {status: "NOT_ESTABLISHED", cellRan: null, ...}` on success and refusal.
Untrusted wrapper claims cannot upgrade it. The current closed receipt profiles
continue refusing an added `moduleSha256`; a future signed-field contract must
be reviewed explicitly and would still not prove execution.

The approval-block compatibility fix is already in this branch: current receipts
include the closed nine-field `approval` block in signed-body reconstruction;
legacy receipts retain their separate exact shape. Committed, regenerable producer
fixtures are pinned to Genesis `20af274`, not relabelled as newly minted at `b149047`.
No sibling code, source runtime or unreviewed PR21 repair is imported here.
