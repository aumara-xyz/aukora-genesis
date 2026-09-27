# The current producer's approval artifact — offline consumer acceptance

The executable half of the producer→consumer bind on the reconciled wire. `scripts/verify-kira-evidence.py`
is the combined consumer; everything here is the evidence it consumes and the controls that must make it
refuse.

```bash
python3 -B tests/kira-artifact/test_kira_artifact.py            # 33 controls, two lanes + the harness contract
tests/kira-artifact/run-empty-dir-arms.sh /tmp/kira-artifact    # 32 arms from an EMPTY directory

# The SAME acceptance, pointed at an externally produced transaction:
tests/kira-artifact/run-empty-dir-arms.sh /tmp/kira-artifact \
  --export /path/to/export --issuer-anchor /p/issuer.pem --approver-anchor /p/approver.pk
```

## The export the acceptance consumes (and the anchors it will not read)

An export is a directory of PUBLIC bytes about one approved transaction plus `export.json`:

| file | what it is |
|---|---|
| `record.json` | the Kira record |
| `content-1.txt` | the EXACT content bytes the approval binds (`canonicalJSON({key, value})` + one newline) |
| `receipt-1.json` | the receipt whose `approval` block must name this transaction |
| `aura.jsonl` | the history log it sits in — with the LATER writes, so the first receipt is exercised after them |
| `artifact-1.json` | the flat `aukora:approval-receipt:v1` |
| `artifact-1b.json` | a SECOND, genuine approval over the SAME bytes — the only thing that can isolate the receipt-linkage check |
| `objects/<sha256>.json` | the stored object, whose bytes must BE the content |

**The anchors are inputs, each checked on its own.** `--issuer-anchor` and `--approver-anchor` are
required arguments naming files the caller supplies, and in `--export` mode EACH is required
independently: omitting one refuses by name and names the one that is missing, before anything is
staged. A single "an anchor was supplied" flag previously let `--export X --issuer-anchor Y` run the
whole acceptance against the committed fixture's approver key. An export that declares anchors in its manifest is refused
(`EXPORT_ANCHORS_NOT_SEPARATE`): a bundle that hands over the keys it is checked against is a claim, not
evidence. `export.json` is not a signed format, and every claim in it that can be re-derived from the
bytes is re-derived and compared (`EXPORT_MANIFEST_DISAGREES_WITH_FILES`).

**The class is printed, never upgraded.** `class` is one of `committed-fixture`,
`materialized-candidate`, `live-produced`. A `live-produced` claim without `liveEvidence` (release +
serving pid + observation time) is refused by name, and even then the label is the export's own — the
runner prints the caveat beside it every time, because a candidate-release run is not proof that a
running service produced the bytes.

## What is here

| path | what it is |
|---|---|
| `fixtures/` | bytes a PINNED producer wrote: the flat `aukora:approval-receipt:v1` artifacts, the exact content they bind, the two current receipts, the Aura log, the stored objects and the public keys. Provenance, digests and the commands that produced them are in `fixtures/PROVENANCE.json` |
| `make-fixtures.mjs` | the generator that produced `fixtures/`, run BY HAND against a Genesis checkout. It signs nothing: every artifact comes from `scripts/aumlok/approve-operation`, every receipt from Kira's own `createMemoryOwner`. CI does not run it |
| `test_kira_artifact.py` | the controls: the standalone verifier and the combined consumer, each as a separate process from an empty directory |
| `run-empty-dir-arms.sh` | the runner: stages an empty directory, hashes everything in it, **runs every consumer invocation from inside it** under a restricted `PATH`, and runs 32 arms |
| `export_input.py` | reads and CHECKS an export manifest, prints its class, and refuses missing evidence, missing anchors and self-declared anchors by name |
| `isolation_probe.py` | runs the REAL consumer under an enforced import guard: modules are classified by RESOLVED ORIGIN, and an outside import is a NAMED non-zero failure |

## The wire this consumes, restated where a reader meets it

```
request          = {domain, subject, activeControlDigest, operationDigest, challenge, issuedAt, expiresAt}
signing bytes    = utf8("aukora:owner-approval-signature:v1") ‖ 0x00 ‖ canonicalJSON(request)
content          = canonicalJSON({key: <recordId>, value: <record>}) ‖ "\n"
operationDigest  = sha256( utf8("aukora:operation-content:v1") ‖ 0x00 ‖ contentBytes )
approvalId       = sha256( utf8("aukora:approval-receipt:v1") ‖ 0x00 ‖ challenge ‖ 0x00 ‖ signature )
did:key          = "did:key:z" ‖ base58btc( 0xed 0x01 ‖ 32 raw Ed25519 public key bytes )
```

The artifact is ONE flat record. The request/response wrapper this repository verified in an earlier
increment is a DIFFERENT document, and it is refused by name here: a wrapper proves a pair was signed,
not that the record a settlement consumes is the one presented.

## Signed fields and unsigned labels, kept apart

Only the seven request fields are inside the preimage. `approvalClass`, `keyClass`, `keyClassMeaning`,
`attendance`, `signerDeviceTrusted`, `succession`, `identityBound`, `ceilings` and `verifiedAt` are NOT
signed, and the suite MEASURES that rather than asserting it: arm 6d rewrites four of them and shows the
signature and the artifact's own `signedBytesDigest` still hold. The consumer therefore reports them as
`REPORTED` (`classification.signed == false`) and refuses the three claims it cannot stand behind —
`human-ceremony`, an `attendance` other than `reported-not-proven`, and `identityBound: true`.

## Two closed receipt profiles, one kind

The producer added the `approval` block to the SAME `aukora-kira-memory-receipt/v1` body without
relabelling the kind. This consumer accepts exactly two shapes and names which one it read:

| profile | fields | who writes it |
|---|---|---|
| `legacy-no-approval` | the original nine | every store that predates owner approval; the committed legacy bundle |
| `current-with-approval` | those nine **plus** a closed nine-field `approval` block | the current producer; the block is INSIDE the signed body |

The sets are closed individually. `{…legacy, approval}` is not "legacy plus anything", and the
difference between "the producer added a signed block" and "someone appended a claim" stays visible.
The legacy bundle's verdicts are otherwise untouched, and the legacy arms re-run unchanged.

## Isolation is enforced, not printed

The runner used to print the modules it found outside the closure and exit 0 — a report, not a control.
`isolation_probe.py` now runs the real consumer and enforces three things, each with its own name:

| guard | failure | what it means |
|---|---|---|
| dependency closure | `ISOLATION_IMPORT_OUTSIDE_CLOSURE` | an import RESOLVED outside the staged closure and the interpreter's own standard library |
| consumer outcome | `CONSUMER_EXIT_NONZERO` | the consumer did not complete successfully, so the run is evidence of nothing |
| consumer outcome | `CONSUMER_VERDICT_NOT_OBSERVED` | the consumer exited 0 but never printed the verdict the caller required |

**Resolution is recorded, not read from a cache.** A meta-path finder sits in front of the import
machinery, resolves each import through the same finders that would have handled it, and records the
origin at that moment; an audit hook is kept as a second witness. A module that is imported and then
deleted from `sys.modules` is therefore still caught — measured, with a wrapper that did exactly that
and was GREEN before the fix.

**The standard-library allowance is the interpreter's OWN library.** `stdlib` and `platstdlib`, plus the
directories this interpreter's own extension modules live in — measured from `binascii` and friends
rather than guessed from `lib-dynload` under one prefix. `purelib`, `platlib` and whole interpreter
prefixes are NOT allowed: a dependency installed in a virtual environment's `site-packages` is an
outside import even though it sits beside the interpreter.

**Scope, stated rather than implied:** this is dependency-closure evidence about one invocation. It is
**not** a claim of OS-level confinement — sockets, files and child processes are not measured here.

**The negative control is the point.** Arm 8b places a harmless module OUTSIDE the closure, makes it
importable, and imports it before the consumer runs. The arm requires the named failure **and** the
consumer's own verification having SUCCEEDED: an unrelated crash is not detection, and the probe
refuses a failed consumer with `CONSUMER_EXIT_NONZERO` *before* it would ever report an import finding.
Arm 8 requires the honest run to import nothing outside and to observe the expected verdict.

## Limits this directory does not hide

A verified artifact does not show that a person attended, that the approver is a REGISTERED key (that is
the composition's pin; with no pin the verdict says a key the artifact names signed these bytes), that an
approval is still inside its window (checked only when the caller supplies the clock it means), or that
anything is authorized. The window is checked on request and NOT inferred: an approval consumed long ago
is not false because time passed. Every verdict prints its ceilings, and the producer's own service
(`approvalClass=scripted`, `attendance=reported-not-proven`) is stated wherever it appears.

**The fixtures are not a served-tip public fixture.** They were minted by the pinned producer's own code
at the commit in `PROVENANCE.json`, under disposable keys, with the signer's labelled `test-all`
procedure — which proves the producer's code path, not that any deployment served it.
