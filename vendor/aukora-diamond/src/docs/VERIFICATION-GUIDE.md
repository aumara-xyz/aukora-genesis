# Verification guide

[Back to the overview](../README.md). These profiles have different wire formats,
canonicalizers and trust inputs. Select the matching consumer explicitly.

## Verification commands

Run these from the repository root. `scripts/cold-verify` and `scripts/verify-pair`
are shell entry points; Phase 0 is a Python program. The commands below follow the README
demo in the same shell, with `$demo_dir` still set. The demo intentionally mutates
A's retained checkpoint; B's retained checkpoint is the intact positive control.

| Court | Command | Checks |
|-------|---------|--------|
| Phase 0 | `python3 vendor/phase0/verify.py --retained "$demo_dir/b/retained.json" --presented "$demo_dir/a/presented.json"` | retained vs presented arithmetic only; no signature/identity claim |
| Cold receipt | `./scripts/cold-verify "$demo_dir/a/receipt-load.json" --pub "$demo_dir/a/issuer.pk"` | JSON + pubkey (fail closed without) |
| Signed pair | `./scripts/verify-pair "$demo_dir/b/retained.json" "$demo_dir/a/presented.json" --pub "$demo_dir/a/issuer.pk"` | anchored checkpoint sig + Phase 0 |

Phase 0 and the signed-pair command support `--mutate`. Cold-receipt tamper,
wrong-key, missing-anchor and coherent-forgery controls run in the mandatory
continuity tests. A court that cannot be made to fail is decoration.

### Accepting `aukora-receipt/v3-genesis`

The Genesis control plane emits the same receipt shape as this repository with one addition: its
`aura` block also names `priorHead` — the head as it stood immediately before the entry — so
a reader holding a receipt and a retained observation can check the entry's *position*
without holding the log.

That is an addition to a **closed** block, so the two are **sibling kinds with sibling closed
field sets**, not one shape with an optional field:

| kind | closed `aura` fields |
| --- | --- |
| `aukora-receipt/v3-toy`, `…-fixture` | `entryHash`, `head`, `prevHash`, `root`, `seq`, `size` |
| `aukora-receipt/v3-genesis`, `…-fixture` | the same six **plus** `priorHead` |

Nothing was loosened for the existing kinds. A `v3-toy` receipt carrying `priorHead` is still
refused as closed fields, and a `v3-genesis` receipt missing it is refused too — so neither
shape can drift into the other. The `kind` string is the signature domain, so relabelling a
signed receipt changes what was signed: a `v3-genesis` receipt relabelled `v3-toy` fails
**signature** verification, which is what makes the kind a binding rather than a label.

```bash
python3 scripts/verify-v3-genesis-acceptance.py    # sibling kinds and refusal controls
```

### The Phase 0 court here is NOT the membrane's bytes

`vendor/phase0/verify.py` in this repository is its own implementation, not a copy of
`aukora-membrane minimal/verify.py`. The two are deliberately different at the command
line: this one takes `--retained`/`--presented` flags or a single `{"retained": …,
"presented": …}` pair object, while the membrane's takes two positional paths in order.
They also keep their vectors in different shapes — `{retained, presented}` pair objects
here, separate `retained.json` and `presented.json` files there — so their fixtures are
not interchangeable.

That is a real property worth having (independent implementations agreeing on the
arithmetic is evidence; two copies of one file agreeing is not) and it is also a real
cost: pointing someone at this court and then handing them a membrane vector will fail
with an argument error that looks like a bug. Genesis vendors the membrane bytes and
pins them per file with sha256; this repository vendors its own. If the two are ever wired
together, that difference has to be translated explicitly rather than assumed away.

Skipping Phase 0 leaves consistency **`CONSISTENCY_UNCHECKED`**. See
`CEILINGS.md`, `SECURITY.md`, `REDTEAM.md`. Pitch: `PITCH.md`.
Continuity contract (Diamond stays a cold verifier; Channel 0 stays
elsewhere): `CONTINUITY-SPINE.md`.

### Consuming Kira memory-v1 evidence offline

`scripts/verify-kira-evidence.py` verifies a Kira memory record and its receipt from public
bytes alone, and reports **five separate results** rather than one word: record identity and
content digest, signature and canonicalization (RFC 8785 JCS), the ISSUER ANCHOR the caller
named, the receipt's own **historical position** in the Aura log, and owner approval. The
anchor is an input and never a discovery — a receipt's `issuerPk` is a claim, and there is no
unanchored mode. With no approval document supplied, approval is `OWNER_APPROVAL_UNCHECKED`: an
unsigned wrapper never upgrades legacy evidence into owner approval, and no digest, label or
`confirm: true` is read as one. When the caller DOES name an approval document and a separate
approval anchor (`--approval` / `--approval-anchor`), the Aumlok lane verifies it offline and
reports five findings of its own — signature validity, caller-supplied digest EQUALITY,
memory-operation binding (which stays `OPERATION_BINDING_UNVERIFIED`), authorization (which stays
`OWNER_APPROVAL_UNCHECKED`) and attendance (which stays `reported-not-proven`). A required approval
check that fails there fails the whole run with its own name as the reason; a wrapper field
claiming attendance is refused, not annotated.

```bash
tests/kira-evidence/run-empty-dir-arms.sh /tmp/kira-empty-dir   # isolated consumer acceptance
```

### Consuming the CURRENT producer's approval artifact offline

The reconciled wire (Genesis #131) makes one flat record the artifact a settlement consumes:
`aukora:approval-receipt:v1`, written by `scripts/aumlok/approve-operation --artifact-out`. That is a
DIFFERENT document from the older request/response wrapper above, and this consumer refuses the wrapper
**by name** when it is handed one as an artifact — a wrapper proves a pair was signed, not that the
record a settlement consumes is the one presented.

```bash
python3 -B tests/kira-artifact/test_kira_artifact.py            # offline artifact controls
tests/kira-artifact/run-empty-dir-arms.sh /tmp/kira-artifact    # isolated artifact acceptance
```

The acceptance consumes an **export** — the record, the exact content, the receipt, its history log,
the flat artifact, a stored object and a second genuine approval over the same bytes — and the same
runner takes an EXTERNAL export with `--export <dir>`; the issuer and approver anchors are always
supplied separately and a bundle that declares its own anchors is refused by name. Every consumer
invocation in the runner executes from inside the empty target directory under a restricted `PATH`, and
an import resolved outside the staged closure is a **named non-zero failure** (`isolation_probe.py`),
proven by a control that fails on a run whose verification otherwise SUCCEEDS. Both anchors are
required **independently** in `--export` mode, the standard-library allowance excludes third-party
package roots, and a consumer that fails — or that never prints the expected verdict — is a named
refusal rather than a green.

`--artifact` names the record, `--artifact-anchor` supplies the approver key **separately** (hex, a
`did:key`, or an SPKI PEM), and `--artifact-content` supplies the exact bytes being settled:
`canonicalJSON({key, value})` plus one newline. The operation digest is **derived** from those bytes here
and compared with the one the artifact names; a caller-supplied digest is never accepted as the binding,
and a moved payload byte, a missing or doubled newline, or reformatted JSON each change the bytes and are
refused. The receipt's own `approval` block, the record's recomputed identity and the stored object are
cross-checked, and its agreement with the artifact's **signed** fields is kept apart from its unsigned
labels. `approvalClass`, `keyClass`, `attendance`, `identityBound` and `ceilings` are outside the signed
preimage — measured, not asserted — so they are reported as `REPORTED` and the three claims this consumer
cannot stand behind are refused by name.

The runner stages a directory that was **empty**, hashes everything that ends up in it, prints
the interpreter's own module closure, and takes `node` off `PATH`. The acceptance target is arm
6: **after a second write, the FIRST receipt still verifies**, because the receipt is checked
against its own position rather than the log's current tip. Arm 6c is the companion — a
re-signed receipt claiming a later entry's hash at an earlier position is refused by position.
See `tests/kira-evidence/README.md`, and [producer findings](../tests/kira-evidence/evidence/FINDINGS.md) for the measured difference
between that rule and the producer's own `MEMORY_TAMPERED` verdict on the same bytes.

Offline verification cannot claim global replay prevention, latestness, human attendance, or the
absence of all forks. Every verdict prints those ceilings.


## Reference-demo licensing gate

The historical control-plane demo has an optional patent-license grant gate. It is
off by default and is separate from the cold verification entry points. Its scope
and limitations remain in [SECURITY](../SECURITY.md) and the preserved
[historical design note](../legal/PROVISIONAL-B-POST-DISCLOSURE-IMPROVEMENTS.md).
