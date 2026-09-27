# B3 — the composition gate

The first governed emission in Genesis. One command to check it:

```bash
python3 scripts/composition/composition-selfcheck.py
```

23 arms, each with a published expected result, run against a disposable temporary
state directory that is deleted afterwards. Non-zero exit if any arm stops
producing its published result.

## What the gate governs: the composition transition, not the tool call

This is the sentence the whole brick exists to make true, so it is worth being
precise about what changes when you believe it.

If the **tool call** were the governed unit, authority would attach to what the
running code does: every invocation would need its own permission, and the
interesting question would be whether the code's behaviour stayed inside bounds.

Here the governed unit is the **composition transition** — a plugin load or a
plugin unload. One grant authorizes one load or one unload. Once the transition
is accepted, the code that results is code the gate allowed to exist.
Composition is governed; the tool calls that loaded code makes afterwards are
**not this gate's subject**. A reader who wants per-call governance is asking
for a different seam, and nothing here pretends to be it.

A **receipt** is emitted for every accepted transition, describing exactly which
bytes were loaded — by SHA-256 digest, with the plugin id derived from those same
bytes — plus the prior head, the new head, a fresh random receipt nonce (not the
grant's one-use nonce; the receipt does not name the grant that authorized it), an
issued-at timestamp, `compositionDigest` and `subjectDigest`, and a detached Ed25519
signature over a canonical encoding.

## Running it by hand

```bash
M="python3 scripts/composition/__main__.py"
D=$(mktemp -d); printf 'some plugin bytes\n' > "$D/plugin.bin"

$M grant  --state "$D/state" --operation load --plugin "$D/plugin.bin" --out "$D/g.json"
$M load   --state "$D/state" --plugin "$D/plugin.bin" --grant "$D/g.json"
$M checkpoint --state "$D/state" --out "$D/retained.json"
$M grant  --state "$D/state" --operation unload --plugin "$D/plugin.bin" --out "$D/g2.json"
$M unload --state "$D/state" --plugin "$D/plugin.bin" --grant "$D/g2.json"
$M checkpoint --state "$D/state" --out "$D/presented.json"
$M verify --state "$D/state" --receipt "$D/state/receipt-unload-002.json" \
          --retained "$D/retained.json" --presented "$D/presented.json"
```

Exit codes are the contract: **0** accepted / verified, **2** refused with a named
code, **1** the gate could not run at all. A refusal is not an error — it is the
gate working.

Receipts are written to `<state>/receipt-<operation>-<seq>.json`. That layout is
a published interface: the self-check reads it by the path rather than by
scraping human-readable output, because the printed summary is for a person and
the layout is for a program.

## The refusal codes

Every refusal prints `REFUSE: <CODE>: <reason>` on stderr, exits 2, and is a
stable string constant in `refusals.py`. These are the codes and the exact input
that produces each one:

| Code | Refused when |
| --- | --- |
| `NO_GRANT` | no grant was presented at all |
| `GRANT_MALFORMED` | wrong `kind`; unknown field (named); an `alg` field; an identity field (`owner`, `identity`, `did`, …); missing field; malformed hex; non-integer `expiry` or `issuedAt` (booleans excluded); coeffect envelope digest that does not match this process; or a signature that does not verify under the key the grant names |
| `GOVERNOR_UNTRUSTED` | a correctly signed grant whose `governorPk` is not this installation's configured governor key (arm 20). A grant is authorized by the key configured here, never by the key it carries, so defect D1 (verify under the grant's own key) does not apply to this Python gate. The configured key is generated into this gate's own state directory (see `BOOTSTRAP_UNGATED`), so this stops a foreign keypair, not a reader of the state directory |
| `GRANT_BYTES_MISMATCH` | the grant binds a different plugin digest than the bytes being loaded |
| `GRANT_SPENT` | the grant's one-use nonce was already consumed |
| `GRANT_OPERATION_MISMATCH` | a load grant used to unload, or an unload grant used to load |
| `GRANT_EXPIRED` | the grant's expiry has passed |
| `MEDIATOR_OFF` | the mediator is off — fail closed, no new governed effects |
| `ALREADY_LOADED` | a load while something is already loaded (this gate does not swap) |
| `NOTHING_LOADED` | an unload with nothing loaded, or naming bytes that are not the loaded ones |
| `RECEIPT_TAMPERED` | a receipt did not verify: edited content, wrong key, an `alg` or identity field, malformed structure |
| `CONSISTENCY_UNCHECKED` | not a refusal — printed as a verdict when no retained/presented pair was supplied |

**Check order is deliberate**, and two consequences are worth knowing:

- The byte binding is checked **before** the spend check, so presenting a grant
  for different bytes does **not** burn its nonce.
- The nonce is consumed only after every verification passes and before the
  effect is applied. A failed attempt leaves the nonce unspent, so a typo can be
  corrected and retried with the same grant. An accepted transition can never be
  replayed, and a crash between consuming the nonce and applying the effect
  leaves a grant spent-and-unused, which is the safe direction to be wrong in.

## The ceilings it prints

`BOOTSTRAP_UNGATED`, `SAME_UID` and `MEDIATOR_OFF` are printed on **every**
human-facing path — accepted, refused, and verify — followed by
`ATTENDANCE: reported-not-proven`. A limit printed only on success teaches a
reader that the limit applies only to successes, so the self-check asserts the
ceilings appear on the refusal paths too (arm 18). When measured by hand at 19 arms,
making `print_ceilings` a no-op turned 14 arms red. Arm 20 has since added a
ceiling-checking arm, and no committed court re-runs this mutation.

**`BOOTSTRAP_UNGATED`** — there is no owner key at this gate. The governor key
that signs grants is generated locally by the gate itself and stored in its own
state directory. A grant therefore proves that *this installation* authorized a
transition; it does not show that a person did. Live receipts derive
`unattributed` / `NON-CONFORMING`, and there is no code path in this brick that
can derive anything else. `derive_class` takes an owner-key registry parameter so
the derivation is visible and testable, but **no caller passes a non-empty one**,
and even a registered key would return
`OWNER-KEY-PRESENT-NOT-CONFORMING` rather than `CONFORMING`.

**`SAME_UID`** — **the plugin shares this process and this uid.** The coeffect
envelope is `{kind: "same-uid-envelope", uid}` and it is a **digest binding, not
isolation**. Nothing here separates the plugin from the loader, and no process or
uid boundary may be claimed from this code. Any binding this gate provides is a
*binding of bytes by digest* — it answers "were these the authorized bytes?", not
"is this code contained?".

**`MEDIATOR_OFF`** — when the mediator is off (`AUKORA_MEDIATOR=0|off|false|no|disabled`,
or an explicit constructor argument), every transition refuses with the code
`MEDIATOR_OFF` and no state change is applied. It is one process-local boolean
consulted immediately before the effect. It is **not** a Cordis broker, not a
capability system, and not an enforcement boundary: it stops *this* loader in
*this* process, and it cannot stop another process or a caller who skips it.

**`ATTENDANCE: reported-not-proven`** — the system can report that a transition
occurred and which key signed for it. It cannot prove a person was present. There
is no human-ceremony path in this brick, and the `issuedAt` timestamp is a clock
reading by the same process that emitted the receipt.

## The receipt, beside the toy's

Vocabulary matches the sealed control plane's `aukora-receipt/v3-toy` —
`kind`, `composition`, `aura`, `issuedAt`, `nonce`, `sig`, `issuerPk` — so the two
are legible side by side. The `composition` block carries the toy's five fields —
`operation`, `pluginId`, `pluginDigest`, `coeffectEnvelopeDigest`, `revertOf` — plus
`compositionDigest` and `subjectDigest`, which Diamond requires.

Four differences, stated rather than left for a reader to diff:

1. **`kind` is `aukora-receipt/v3-genesis`.** The `kind` is the signature's domain
   separator, so two different issuers must not share one.
2. **`aura` gains `priorHead`** — the head as it stood immediately before this
   entry. The toy names `prevHash` (previous entry hash) and `head` (head *after*
   this entry), so a reader holding only the receipt and a retained observation
   cannot check the receipt's *position*. Genesis makes the prior head explicit.
   `entryHash`, `seq`, `root`, `size` keep the toy's names and meanings.
3. **No owner field, and no coeffect field outside `composition`**, so the ceiling
   travels inside the signed bytes rather than only in prose.
4. **`composition` gains `compositionDigest` and `subjectDigest`.**

**Never an `alg` field.** The `kind` string is the algorithm binding; `alg`,
`algorithm`, `hash` and `curve` are refused by name on both grants and receipts
(arms 7 and 16). A receipt that advertises an algorithm has moved a decision that
belongs to the verifier into data the signer controls.

### Ed25519 provenance, and the vendored cross-check

Python's standard library has no Ed25519. `vendor/receipt/` **did not exist in
this worktree** when this gate's crypto was written, so `ed25519.py` and `jcs.py`
here are independent stdlib implementations (`hashlib`, `secrets`): not copied
from the sealed toy (AGPL-3.0) and not copied from the vendored tree.

The vendored tree arrived afterwards, committed by another agent in this same
worktree. The gate **keeps its own implementations** — so nothing it ships
depends on a file another agent may still be editing, and the AGPL-3.0 tree stays
an input to evidence rather than a runtime dependency — and measures the two
against each other:

```bash
python3 scripts/composition/ed25519.py            # RFC 8032 vectors + negative controls
python3 scripts/composition/parity-vendored.py    # this gate vs the vendored tree
```

Measured result: byte-identical signatures on the RFC's published vectors and on
30 random seeds and messages, identical canonical bytes on 10 canonical-form cases,
and the vendored verifier accepts each of this gate's signatures. Rejection parity on
invalid signatures is not measured (the parity script's own printed line says more
than this and should be corrected). A second implementation written separately within
this project family agrees byte-for-byte. That adds evidence beyond the three RFC
vectors, but both follow the RFC's reference structure, so it is not independent
verification and cannot catch a shared conceptual error.

The parity check is **skipped, and reported as skipped**, when the vendored tree
is absent — never counted as a pass. A vendored tree that exists but will not
load **fails** `composition-selfcheck.py`, because those bytes are pinned
elsewhere in this repository.

The verifier is **cofactorless** and enforces `s < L` (the malleability guard);
both choices are declared in `ed25519.py`.

### Interchange with the sealed toy, measured

Vocabulary is shared, and since the receipt-v3 pin moved to `c512d0c` the vendored
verifier accepts `aukora-receipt/v3-genesis` as its own sibling kind
(`vendor/receipt/toy/receipt.py`, `KIND_GENESIS`), so a receipt from this gate
verifies under the vendored cold verifier, whose genesis-kind composition set Genesis
extended locally (see `upstream-receipt-v3.json`). That is not acceptance by unmodified
upstream `c512d0c`, and the pinned digest for `toy/receipt.py` is of the locally edited
file. The two kinds remain separate signature domains: the
`kind` string is the domain separator, a receipt whose `kind` alone is changed
fails signature verification, and the `v3-genesis` `aura` block is closed over
seven fields (`priorHead` required) where `v3-toy` closes over six, so a receipt
re-kinded across that line is refused at the closed-fields check before the
signature is examined. Legible, verifiable by the sibling, not interchangeable.

## Consistency: two questions, two courts

A receipt names an Aura head. Whether that head **extends an earlier retained
observation** is a *different* question with a different answer:

- `python3 … verify --receipt R` — no pair supplied → `CONSISTENCY_UNCHECKED`.
  This is an honest "I did not look", never an implied "it agreed".
- `python3 … verify --receipt R --retained A --presented B` → a measured
  `APPEND_ONLY` / `OBSERVATION_CONFLICT` / `UNDETERMINED`.

A single log always agrees with itself, so checking one log alone proves nothing,
and the gate will not print a verdict derived from it. Cold verification of a
receipt with just a public key is always `CONSISTENCY_UNCHECKED`.

The consistency check here recomputes both Merkle roots from the log, so it holds
at **every** retained size including a power of two. Phase 0's court must return
`UNDETERMINED` at a power-of-two retained size because it judges a *consistency
proof* rather than holding the log. Same fact, different court — and the
difference is declared in `aura.verify_consistency` rather than hidden.

## What this does NOT claim

- **Not CONFORMING.** No owner key exists at this gate; every live receipt is
  `unattributed` / `NON-CONFORMING`. Arm 17 asserts this and fails if it changes.
- **Not isolation.** Same process, same uid. The binding is a digest binding.
- **Not human attendance.** `reported-not-proven`. No human-ceremony path exists.
- **The plugin is not executed.** `load` records the bytes and marks them active;
  nothing in this gate runs them. "Loaded" here means *recorded as the active
  composition*, and no claim of code execution is made.
- **Not per-tool-call governance.** See the first section.
- **Not a Cordis broker or capability system.** The mediator is one boolean.
- **Not a trust root.** Nothing here proves the log's bytes are the ones ever
  published, that a record is true, or that only one log exists. Anyone who can
  write the log can rewrite it and recompute every hash in it — which is exactly
  what Phase 0 and a retainer outside this host exist to catch.
- **Not owner custody.** The governor and issuer keys are generated locally and
  written in the clear into the state directory. That is correct for a disposable
  gate and wrong for anything else. A real deployment needs a custody story this
  brick does not have — which is what `BOOTSTRAP_UNGATED` says.

**Evidence never authorizes. A receipt, a valid chain or a plausible Aura head
never authorizes anything. Grants authorize, and they authorize once.**

## Files

| File | Role |
| --- | --- |
| `__main__.py` | the CLI: `load`, `unload`, `grant`, `checkpoint`, `verify` |
| `loader.py` | the gate: check order, state changes, receipts, the receipt court |
| `grant.py` | mint / verify / consume one-use grants; closed field set; nonce store |
| `receipt.py` | issue / verify receipts; derived class; the four toy differences |
| `mediator.py` | the on/off mediator; OFF fails closed with the toy's code |
| `aura.py` | hash-linked log (tamper-evident only against a head retained outside this host; append-only is not enforced), RFC 6962 Merkle roots, consistency |
| `refusals.py` | the stable refusal-code vocabulary, and the refusal type |
| `ceilings.py` | the ceilings, spelled once, printed on every path |
| `ed25519.py` | RFC 8032 Ed25519 in stdlib, with vectors and negative controls |
| `parity-vendored.py` | measures this gate's crypto against `vendor/receipt/`, or reports the check skipped |
| `jcs.py` | RFC 8785 canonical form, integer-only subset |
| `hexutil.py` | strict hex/digest/JSON helpers |
| `composition-selfcheck.py` | the acceptance command: 23 published arms |
