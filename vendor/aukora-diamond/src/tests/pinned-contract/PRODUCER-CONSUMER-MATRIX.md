# Producer/consumer compatibility matrix — the pinned Genesis contract vs this revision

One table, measured rather than asserted. Run `python3 tests/pinned-contract/compat-matrix.py`
to regenerate it: the pinned bytes are re-verified against `pins.json` first, and the run prints
the same `TABLE_SHA256` from any working directory.

Rows are the composition field set **and what the document declares**, per kind. Columns are the
two revisions in two roles: what each can **mint** (`receipt.issue()`, and whether it declares a
base), and what each **accepts** (`receipt.verify_receipt()`) of the document the other side
produced — including **which base the consumer says it checked**. This table was measured at
`8581462`; the runner prints the revision it ran against, and marks a working tree that is not the
clean commit `-dirty`.

The pinned contract is `c512d0cb`, the bytes Genesis vendors as `vendor/receipt-v3`
(`receipt.py` sha256 `432cf269536238ecbf7b01c29d19f1719067a14114cab053d0244284625eecbb`).

| kind | composition, declaration | document provenance | producer: pinned `c512d0c` | producer: current `2e2c66c-dirty` | consumer: pinned `c512d0c` | consumer: current `2e2c66c-dirty` |
| --- | --- | --- | --- | --- | --- | --- |
| `aukora-receipt/v3-toy` | 5-field, undeclared | minted by pinned `c512d0c`: no declaration, the shape Genesis emits and the committed fixture is | mints (5 fields, undeclared) | mints (5 fields, declares v1) | accepts `unattributed/NON-CONFORMING` (no base vocabulary: v1 is all it has) | accepts as `v1` — `unattributed/NON-CONFORMING` |
| `aukora-receipt/v3-toy` | 7-field, declares v2 | minted by current `2e2c66c-dirty`: `issue()` stamps the base it composed under | **refuses** (composition closed fields) | mints (7 fields, declares v2) | **refuses** (closed fields) | accepts as `v2` — `unattributed/NON-CONFORMING` |
| `aukora-receipt/v3-toy-fixture` | 5-field, undeclared | minted by pinned `c512d0c`: no declaration, the shape Genesis emits and the committed fixture is | mints (5 fields, undeclared) | mints (5 fields, declares v1) | accepts `fixture/FIXTURE` (no base vocabulary: v1 is all it has) | accepts as `v1` — `fixture/FIXTURE` |
| `aukora-receipt/v3-toy-fixture` | 7-field, declares v2 | minted by current `2e2c66c-dirty`: `issue()` stamps the base it composed under | **refuses** (composition closed fields) | mints (7 fields, declares v2) | **refuses** (closed fields) | accepts as `v2` — `fixture/FIXTURE` |
| `aukora-receipt/v3-genesis` | 5-field, undeclared | minted by pinned `c512d0c`: no declaration, the shape Genesis emits and the committed fixture is | mints (5 fields, undeclared) | mints (5 fields, declares v1) | accepts `unattributed/NON-CONFORMING` (no base vocabulary: v1 is all it has) | accepts as `v1` — `unattributed/NON-CONFORMING` |
| `aukora-receipt/v3-genesis` | 7-field, declares v2 | minted by current `2e2c66c-dirty`: `issue()` stamps the base it composed under | **refuses** (composition closed fields) | mints (7 fields, declares v2) | **refuses** (closed fields) | accepts as `v2` — `unattributed/NON-CONFORMING` |
| `aukora-receipt/v3-genesis-fixture` | 5-field, undeclared | minted by pinned `c512d0c`: no declaration, the shape Genesis emits and the committed fixture is | mints (5 fields, undeclared) | mints (5 fields, declares v1) | accepts `fixture/FIXTURE` (no base vocabulary: v1 is all it has) | accepts as `v1` — `fixture/FIXTURE` |
| `aukora-receipt/v3-genesis-fixture` | 7-field, declares v2 | minted by current `2e2c66c-dirty`: `issue()` stamps the base it composed under | **refuses** (composition closed fields) | mints (7 fields, declares v2) | **refuses** (closed fields) | accepts as `v2` — `fixture/FIXTURE` |
| `aukora-receipt/v3-genesis` | 5-field, declares v1 | minted by current `2e2c66c-dirty`: the same block as the legacy row, with the base stated | mints (5 fields, undeclared) | mints (5 fields, declares v1) | **refuses** (closed fields) | accepts as `v1` — `unattributed/NON-CONFORMING` |
| `aukora-receipt/v3-genesis` | 7-field, undeclared (legacy) | re-signed: the shape this revision minted before it declared bases — nothing this revision accepted before became refused | **refuses** (composition closed fields) | mints (7 fields, declares v2) | **refuses** (composition closed fields) | accepts as `v2` — `unattributed/NON-CONFORMING` |
| `aukora-receipt/v3-genesis` | 5-field, declares v9 (unknown) | re-signed: a name outside the closed vocabulary, on an otherwise valid document | mints (5 fields, undeclared) | mints (5 fields, declares v1) | **refuses** (closed fields) | **refuses** (compositionBase unknown: 'v9') |
| `aukora-receipt/v3-genesis` | 7-field, declares v1 (contradiction) | re-signed: the block is v2's set under a v1 declaration; neither revision will mint it | **refuses** (composition closed fields) | mints (7 fields, declares v2) | **refuses** (closed fields) | **refuses** (composition closed fields (base v1)) |
| `aukora-receipt/v3-genesis` | 5-field, declares v2 (contradiction) | re-signed: the block is v1's set under a v2 declaration; neither revision will mint it | mints (5 fields, undeclared) | mints (5 fields, declares v1) | **refuses** (closed fields) | **refuses** (composition closed fields (base v2)) |
| `aukora-receipt/v3-genesis` | 7-field (5 base + patent pair), undeclared | minted by pinned `c512d0c`: seven fields, and still base v1 — the patent pair is optional in BOTH bases, so the count was never the rule | mints (7 fields, undeclared) | mints (7 fields, declares v1) | accepts `unattributed/NON-CONFORMING` (no base vocabulary: v1 is all it has) | accepts as `v1` — `unattributed/NON-CONFORMING` |
| `aukora-receipt/v3-genesis` | 5-field, undeclared | Genesis gate, committed (not regenerable here: no issuer secret exists) | — | — | accepts `unattributed/NON-CONFORMING` (no base vocabulary: v1 is all it has) | accepts as `v1` — `unattributed/NON-CONFORMING` |
| `aukora-receipt/v3-genesis-fixture` | 7-field, declares v2 | this repository's issuer, committed (regenerate: make-fixture.py) | — | — | **refuses** (closed fields) | accepts as `v2` — `fixture/FIXTURE` |
| `aukora-experience/v1` | record: advisory, unsigned, no receipt fields | Experience Court's own `ExperienceStore.put()` at `0e970d9c…`; bytes vendored, digest pinned | — | — | **refuses** (closed fields) | **refuses** (closed fields) |
| `aukora-experience/v1` | recall reply: advisory, unsigned, cites records | Experience Court's own `ExperienceStore.recall()` at `0e970d9c…`; bytes vendored, digest pinned | — | — | **refuses** (closed fields) | **refuses** (closed fields) |
| `aukora-receipt/v3-genesis` | 7-field, undeclared (tampered) | negative control: mutated after signing | — | — | **refuses** (composition closed fields) | **refuses** (signature) |

```
— boundary: adopting only one of the two added fields —
  8 re-signed documents over 4 kinds x 2 partial shapes
    producer pinned `c512d0c`  : refuses 8/8
    producer current `8581462` : refuses 8/8
    consumer pinned `c512d0c`  : refuses 8/8
    consumer current `8581462` : refuses 8/8

TABLE_SHA256: 8f244765669e18f5deec30646b3ce61dc011d3133cfaafe2a31e39524fda828c
pinned receipt.py exercised: 432cf269536238ecbf7b01c29d19f1719067a14114cab053d0244284625eecbb
throwaway issuer (public): 0d7550754e0800a5…
```

## The row that now passes on both sides

The first row for every kind — **`5-field, undeclared`** — is the one that changed. It is what
Genesis's gate emits and what the committed historical fixture is: five composition fields and no
declaration. The pinned revision accepts it under its only field set; **this revision now accepts
it as the named base `v1`**. Before the contract was sealed this same row read
`REFUSE composition closed fields` here: a refusal decided by counting fields, which is what made
the two sides look incompatible while every `kind` string matched.

- **Both bases are accepted, each under its own name.** `v1` (five fields) and `v2` (seven) are
  closed names in `COMPOSITION_BASES`; the verifier checks the block against the base the document
  states, and every consumer cell above says which base it checked.
- **An unknown name is refused by name.** `compositionBase unknown: 'v9'` quotes the string it did
  not recognise. A base that contradicts its own block is refused naming that base —
  `composition closed fields (base v1)` / `(base v2)` — so a reader learns the rule that was
  applied instead of guessing at a field count.
- **The declaration is inside the signature.** `issue()` stamps the base it composed under, and
  `to_sign_bytes` covers `compositionBase` when it is present while leaving every pre-versioning
  document's bytes unchanged. A version that could be relabelled after signing would choose which
  field set applies to the same bytes, which is the failure this removes.
- **Nothing that used to verify stopped verifying.** The `7-field, undeclared (legacy)` row is the
  shape this revision minted before the seal; it still verifies, as `v2` by set membership. The
  legacy path is an inference *with a name*, and a block matching neither base is refused naming
  both rather than as an anonymous count.
- **The count was never the rule.** Five base fields plus the optional patent-license pair is seven
  fields, and it is accepted here as `v1` — the patent pair is optional in both bases.
- **The pinned side has no version vocabulary, and says so.** Its acceptance cells carry no base
  because the frozen bytes have none to state: a document that *declares* a base is refused there
  with `closed fields`, its top-level closed set having no `compositionBase` in it. A frozen
  verifier cannot be taught a vocabulary, which is why adopting the declaration in Genesis is a
  separate change there rather than a repin here.
- **No partial upgrade buys acceptance.** The boundary block above is unchanged: adopting only one
  of the two added fields is refused by both revisions in all four roles, 8/8.

## The Experience Court's kind, measured

The **Experience Court** (`aumara-xyz/aukora-experience-court`, a sibling of this repository,
never a fork of it) sealed `aukora-experience/v1` while this branch was open, so its rows are
measured rather than described. Two shapes come out of that court's own producer — a stored
**record** and a **recall reply** — and both are **advisory and unsigned**: `grantsAuthority` is
false and there is no signature field anywhere in them.

Handed to a verifier of *authority*, each is refused with `closed fields` by **both** revisions,
and the refusal never reaches the kind: the closed-set check runs before the kind is read, so
`aukora-experience/v1` is not a name either revision has an opinion about. That is the useful
part of these rows — not that the documents are refused, but *how* they are, because the path a
refusal takes is the thing anyone adding interoperability later would have to change.

- The bytes are vendored in `fixtures/` and derived by `make-experience-fixtures.py` from that
  court's own `ExperienceStore` at `0e970d9cdf40dd3e3d651c37c52af2a3007ac480`, then re-verified
  against `pins.json` before anything is compared: a moved byte refuses as `PIN DRIFT`.
- The commit is pinned **in full**. A short SHA is a display convenience whose length varies with
  how many objects a repository holds — the first version of that generator compared a 7-character
  abbreviation against an 8-character one and refused a checkout that was correct — and a pin that
  can stop matching without a byte moving is not a pin.

## Courts with no row here yet

The runner prints this section on every run, and it is empty now: it held the Experience Court
until that court sealed a kind. The mechanism stays because the rule does — a court that has not
fixed its rules is **named** here rather than given a row of guesses, since a guessed row would be
indistinguishable from a measured one at a glance, and that indistinguishability is the one thing
this artifact cannot afford.

## Cross-checks

- The wired `tests/pinned-contract/test-pinned-contract.py` agrees row-for-row on the rows the two
  share and now reports
  `MATRIX_SHA256: a0736f66587b47a19c7a70209514b6c14ac3e0b41fa6c914d3d1c425edf5955f`
  (ten rows, `PINNED-CONTRACT REGRESSION: GREEN`). Its pinned column did not move when this
  revision's contract changed: the changed rows changed on this side only.
- `scripts/verify-composition-base.py` proves the sealed contract itself in fifteen arms — both
  bases accepted, unknown names refused by name, contradictions refused naming the base, the
  declaration covered by the signature, and a tampered document still refused — and is wired into
  CI.
- The `foreign/` second implementation, which imports nothing from `diamond.*`, was taught the same
  rule independently and prints the base it checked. It is what failed first when the field was
  added, which is the useful part of having it.

Not done: Genesis is not modified and its verifier is not repinned; no `kind` string is relabelled
and neither base is loosened. The matrix records which documents are accepted and which base was
used — not whether any receipt is true, whether a human was present, or whether a receipt
authorizes anything. Evidence never authorizes.

`TABLE_SHA256: f5466f61eac95808dc3c90d4db388ba3ce5ba7e4e38acedd4ca31e2c8030a31d`
