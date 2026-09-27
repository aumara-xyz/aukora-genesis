# Stage 0 — consumer readiness

**Question this answers:** can Diamond consume what Genesis produces, today, and what exactly
stands in the way of one shared contract version?

**Answer, measured on 2026-09-17:** Diamond is ready. Genesis is not — its producer cannot state a
contract version, and its vendored verifier does not understand one. Nothing in Diamond's law had
to be loosened to reach that answer, and nothing in it needs to change for the three Genesis-side
items below.

## 1. The FAIL log today

Everything here was run with an **empty neutral working directory** — the discipline the court
scripts and Genesis's own closure test both use, because a document that only verifies from inside
its own tree has not been verified.

Genesis checkout `704ae19` · Diamond `3c896d5` · fixture minted by Genesis's own
`scripts/composition/receipt.py`.

### What already works — Genesis mint → Diamond verify

```
$ python3 -m diamond.cold_verify <genesis-minted>.json --pub <its>.pk      # empty cwd
SIGNATURE_VALID / SIGNER: SIGNER_KEY_MATCHED
CLASS: unattributed / CONFORMANCE: NON-CONFORMING
COMPOSITION BASE: v1
rc=0
```

The same bytes also verify under the **pinned** verifier (`c512d0c`) and under **Genesis's own
vendored verifier**: rc 0 from all three. Genesis does not emit `compositionBase`; Diamond accepts
the document anyway, as the **named base `v1`**, and says so on its own output line. That is the
consumer side working today, on real Genesis bytes.

### What fails — and it is all on the producer side

| # | leg | exact result |
|---|---|---|
| 1 | Genesis `issue()` asked for a receipt under the shared contract | produces a document with **no `compositionBase`** — no parameter exists (`TypeError: unexpected keyword argument 'composition_base'`) |
| 2 | Genesis's own `check_payload` on a receipt carrying the field | `RECEIPT_TAMPERED: unknown receipt field(s) ['compositionBase'] — closed set is ['aura', 'composition', 'issuedAt', 'issuerPk', 'kind', 'nonce', 'sig']` |
| 3 | Genesis's `verify_receipt` on the same document | `RECEIPT_TAMPERED: receipt does not carry the closed field set` |
| 4 | Genesis's **vendored** verifier on a document that declares a base | `FAIL: closed fields` · rc=2 (its pin is `c512d0c`, older than the field) |

Reproduce legs 1–4, plus the passing legs and the junk arms, with one command:

```
python3 scripts/stage0-genesis-acceptance.py --genesis <checkout>      # RED today, 3 legs
```

**No loosening was needed, and none was applied.** The gap is not "Diamond is too strict": the
producer cannot state its version, so a consumer that *did* accept it would be guessing. Diamond
guesses only where the guess is closed and named (below), and never accepts a document that is
not exactly one of the two base shapes.

## 2. The shared contract version

**Name.** `aukora-receipt/v3`, version carried by the existing field `compositionBase` — a closed
name, inside the signature. **Stage 0 vN = `compositionBase: "v1"`**, because Genesis's
composition block is already exactly the v1 set: five fields, no more, no less.

A second version field was considered and rejected: two names for one thing is how a contract
starts drifting. The field already exists, is already signed, and is already refused-by-name when
unknown.

| | under vN |
|---|---|
| **required** | the existing closed set — `aura, composition, issuedAt, issuerPk, kind, nonce, sig` — and, for anything minted from adoption on, **`compositionBase`**. The declaration is what makes a document checkable without arithmetic. |
| **optional** | `compositionBase` itself stays optional *in the field set*, so documents minted before the name existed remain readable (see fail-closed below); the patent-licence pair stays optional, both-or-neither, as it already is in both bases. |
| **unchanged** | every `kind` string; the per-kind aura sets (six fields, plus `priorHead` for the genesis kinds); no `alg`; no identity field. vN adds a name, not a permission. |

**How old receipts fail closed.** Four rules, all already implemented and each one measured:

1. **No declaration, block is exactly the v1 set** → accepted **as `v1`**, and the verifier prints
   the base it checked. This is the only bridge, it is shape-exact (set membership, never a count),
   and it exists because those documents are already-issued evidence.
2. **No declaration, block is not exactly a base** → refused, naming both:
   `composition closed fields (compositionBase not declared and the block matches neither v1 nor v2)`.
3. **Declaration that contradicts its own block** → refused naming the base checked:
   `composition closed fields (base v1)` / `(base v2)`.
4. **Unknown name** → refused by name: `compositionBase unknown: 'v9'`.

Nothing is accepted because it is *old*. Rule 1 is a shape test, not an age test, and rules 2–4
close everything else. A document that stops being checkable stops being accepted, which is the
honest failure mode for an evidence system.

## 3. Patch draft — Genesis side only

Diamond needs **no patch** to accept vN `v1`: `scripts/verify-genesis-minted-acceptance.py` already
shows the declared shape accepted as `v1` (arm 2). What follows is the draft for Genesis's
`scripts/composition/receipt.py`; it is written out here rather than applied anywhere, because
this repository does not edit that one.

```diff
 FIELDS = ("aura", "composition", "issuedAt", "issuerPk", "kind", "nonce", "sig")
-SIGNED_FIELDS = tuple(name for name in FIELDS if name != "sig")
+#: The composition base this receipt was composed under. Optional in the FIELD set, so receipts
+#: minted before the name existed still verify; stated by everything minted from here on, because
+#: a document that cannot say which field set it means is a document a consumer has to guess at.
+CLOSED_OPTIONAL = ("compositionBase",)
+SIGNED_REQUIRED = tuple(name for name in FIELDS if name != "sig")
+SIGNED_FIELDS = SIGNED_REQUIRED + CLOSED_OPTIONAL
+COMPOSITION_BASE = "v1"          # this gate's block is exactly the v1 set

 def to_sign_bytes(receipt: dict) -> bytes:
-    body = {name: receipt[name] for name in SIGNED_FIELDS}
+    # ONLY WHEN PRESENT. A field signed always would change the bytes of every receipt minted
+    # before it existed and break signatures that are already out in the world.
+    body = {name: receipt[name] for name in SIGNED_FIELDS if name in receipt}

 def issue(..., composition_base: str | None = COMPOSITION_BASE):
     receipt = {..., "compositionBase": composition_base, ...}   # stamped, never inferred

 def check_payload(receipt):
-    unknown = sorted(set(receipt.keys()) - set(FIELDS))
+    unknown = sorted(set(receipt.keys()) - set(FIELDS) - set(CLOSED_OPTIONAL))
```

**The trap is the `if name in receipt`.** Signing the optional key unconditionally is the one
version of this patch that looks right and breaks every existing receipt — Diamond hit it when it
added the same field and had to make `to_sign_bytes` byte-identical for documents without it.
Then move the pin (`vendor/receipt-v3/upstream-receipt-v3.json` + the vendored files) to a Diamond
revision at or after the one that introduced the field, and leg 3 of the acceptance command stops
failing.

## 4. The test added here

`scripts/verify-genesis-minted-acceptance.py` — self-contained, no sibling checkout, wired into CI,
with the fixture at `tests/genesis-minted/` (minted by Genesis's producer, digests pinned in
`tests/genesis-minted/pins.json`, verified before use). Six arms:

```
genesis-minted-accepted              rc=0  COMPOSITION BASE: v1     ← Genesis mint → Diamond GREEN
declared-v1-accepted                 rc=0  COMPOSITION BASE: v1     ← the vN shape, before vN exists
unknown-base-refused-by-name         rc=2  compositionBase unknown: 'v9'
contradiction-refused-naming-base    rc=2  composition closed fields (base v2)
tampered-after-signing-refused       rc=2  signature
wrong-public-key-refused             rc=2  issuerPk mismatch
GENESIS-MINTED ACCEPTANCE: GREEN
```

The last three are what stop the first two from being a check that only ever says yes.

## 5. WASM — sketch only, no work this round

See `CONTINUITY-SPINE.md`. Two WASM stories exist. **Do not collapse them.**

**This sketch** is future packaging of the **cold-verify closure** — Channel 1
stranger-check, the same five modules Genesis vendors plus its CLI: `receipt.py`,
`ed25519.py`, `jcs.py`, `hexutil.py`, `cold_verify.py`. It is the right candidate
for three reasons and none of them is this round's: it is **stdlib-only** and
does no I/O beyond reading a receipt and a public key; its canonicalisation is
**integer-only JCS** with floats refused, which removes the usual cross-language
numeric divergence; and its refusals are already **named strings**, so a host can
surface them without a translation layer.

That packaging is **DISTINCT** from aukora-deep's zero-WASI WASM **proposal cell**
(Channel 0, propose shaping; digest pinned in `CONTINUITY-SPINE.md`). Diamond
does not import, vendor, or execute that cell. A compiled cold-verify is a
*copy of a verifier*. It is not a propose runtime, it is not a Seatbelt guest,
and it does not prove a cell ran (Check-18). Receipts still do not authorize.

What a cold-verify WASM target would have to settle first, and why it is not a
today problem: which of the two Ed25519 implementations is authoritative (the
vendored bytes or a host primitive), how the **version** is reported across the
boundary (the `COMPOSITION BASE` line is the natural carrier), and that a
compiled verifier is a *copy* — it drifts from the source like every other
copy, which is the lesson of the pin in section 3.

## 6. Non-claims

Acceptance here means the signature verifies under the named key, the closed sets hold, and the
base checked is stated. It does not mean the receipt is true, that a transition happened, that a
device acted, or that anyone was present: class is derived, live is `unattributed` /
`NON-CONFORMING`, attendance is reported-not-proven. Genesis is not modified, imported or repinned
by anything in this round. Evidence never authorizes; grants authorize composition.
