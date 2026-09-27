# FINDINGS — what the producer's own verifier says about these exact bytes

This is the measurement that justifies the consumer, recorded before the consumer's own
verdicts so that a reader can compare two rules over one set of bytes rather than take one
implementation's word for anything.

## Finding 1 — a tip check is not a position check

`plugins/aukora-kira/lib/memory-owner.mjs` (Genesis `a313854`) verifies a receipt with:

```js
if (chain.head !== aura.head) refusal_head(body.recordId, chain.head, aura.head)
```

`refusal_head` raises `MEMORY_TAMPERED`. The rule is honest and deliberate — its own message
says *"the receipt names head X but the log's head is Y"* — but it binds a receipt to the log's
**current tip**, so no receipt survives the next write. Measured on the exported bundle, with
the producer's own verifier, after two valid writes:

```
producerVerdictReceipt1AfterSecondWrite = {
  "ok": false,
  "code": "MEMORY_TAMPERED",
  "message": "MEMORY_TAMPERED: the receipt names head
     b1f15fd27653098de52d733ad3038a13b0a51b121d8cd4cbbb95a3384ac610b0
     but the log's head is
     5cfef05602fd6533faf46541122d31fc1cb4487b5322ed6070f754e4493bcf5e"
}
producerVerdictReceipt2 = { "ok": true, "verdict": "verified", "seq": 2 }
```

Nothing was tampered with. Receipt 1 still names exactly the entry the log holds at position 1,
with exactly the predecessor link the log records for it. It is refused anyway, because it is no
longer the tip. The producer reports this because the producer was asked; the value is in
`producer-summary.json`, reproduced verbatim rather than paraphrased.

The shared fixture's own README states this requirement in the other direction, as the Kira
lane's obligation: *"after a second and a third valid write, the FIRST receipt must still
verify."* The producer's verifier does not satisfy it. **This consumer does** — by checking the
receipt's OWN position (Facet 4), which is what makes arm 6 green and arm 6c red.

The two rules disagree on exactly one shape of input, and the disagreement is the point:

Both columns below are MEASURED — the producer's column by running the producer's own
`verifyReceipt`, this consumer's column by the arm runner. Every verdict is committed verbatim
in `producer-verdicts.json`; nothing in this table is reasoned about and then reported as
observed.

| document | the producer's own verifier | this consumer |
|---|---|---|
| receipt 1, log of 2 entries (arm 6) | REFUSED `MEMORY_TAMPERED` — *the receipt names head b1f15fd2… but the log's head is 5cfef056…* | **VERIFIED** — position 1 holds exactly that entry and that prior head |
| receipt 2, log of 2 entries (arm 0) | VERIFIED (`seq` 2, `verifiedHead` 5cfef056…) | **VERIFIED** — position 2, which is also the tip of the log in hand |
| receipt with one signed field moved (arm 2) | REFUSED `RECEIPT_TAMPERED` — the signature does not verify | **REFUSED `signature-invalid`** — same finding, same bytes |
| re-signed receipt claiming entry 2's hash at `seq` 1 (arm 6c) | REFUSED `MEMORY_TAMPERED` — *the chain entry hash is not the one the receipt names* | **REFUSED `position-mismatch`** |
| re-signed receipt stating a prior head the log does not link (arm 6d) | REFUSED `MEMORY_TAMPERED` — *the chain entry does not link the prior head the receipt names* | **REFUSED `position-prior-head-mismatch`** |
| log extended to 3 entries, receipt 1 (arm 6b) | not run against the producer — the extended log is this repository's construction, and the producer is not asked to verify another lane's synthesized bytes | **VERIFIED** — the receipt's position is unchanged by anything appended after it |

An important correction to a tempting reading of row 4: the producer does NOT accept that
document. It refuses it at the *entry-hash* check before ever reaching the head comparison, so
the tip rule is not the thing that catches it. The distinction still matters, and it is the
reason the consumer checks position rather than tip: the tip comparison is a check on a
different claim. A receipt that named the current head at an earlier position would satisfy a
tip rule; it does not satisfy a position rule.

## Finding 2 — the documented preimage omits a field that is inside it

`memory-owner.mjs` documents the Aura entry hash as *"sha256 over the canonical JSON of the
entry body with `domain` added, where the body is the stored fields less `hash`"*. Read
literally, that body is `{verdict, key, contentSha256, operation, prev}` — and hashing it
produces `f65a093d23c66a9794a4703ae85b3e2af2a7ee7ac28a2a7a5b39b04f7042c3c0`, while the stored
entry hash is `b1f15fd27653098de52d733ad3038a13b0a51b121d8cd4cbbb95a3384ac610b0`.

The measured preimage includes `sequence`:

```json
{"contentSha256":"a445c546…","domain":"aukora:aura-record:v1","key":"kira:4bf512…","operation":"memory.put","prev":"aukora:aura-record:v1","sequence":1,"verdict":"settled"}
```

No hash in this bundle was tampered with to reach that conclusion: the preimage was
reconstructed from the producer's own stored bytes, and the variant that includes `sequence`
reproduces the stored hash exactly. Recorded because a second implementation written from the
prose alone would compute a different hash for identical bytes and be *confidently* wrong.

## Finding 3 — the first entry's `priorHead` is the producer's own spelling, `null`

Receipt 1 carries `"priorHead": null`, not the Aura domain separator that the log names in its
`prev` link field. Both spellings mean "no predecessor", and the sibling `aukora-receipt/v3-genesis`
kind spells the same fact as a 64-zero digest. The consumer accepts a **closed, named** set of
no-predecessor spellings (`null`, the domain separator, the zero digest) and requires an exact
match for every other value. A closed set is not a loosening: arm 6d supplies `"a" * 64` and is
refused by name.

## Finding 4 — nothing in this bundle is an approval

The envelope carries `authority.grants: false`, `fixtureOnly: true`, a published challenge and a
placeholder `subjectControlDigest` (`FIXTURE-ONLY-NOT-A-REAL-CONTROL-DIGEST`). Every one of those
is a field a wrapper can assert about itself, and an unsigned wrapper is unsigned no matter what
it asserts. The consumer reports `OWNER_APPROVAL_UNCHECKED` on every arm — including the green
ones — and lists the claims it saw and did not read as approval. Genesis's fixture README asks
for exactly this: *"Report `OWNER_APPROVAL_UNCHECKED` rather than upgrading it."*

A wrapper that claimed `authority.grants: true` would be reported with the same status, because
the status is derived from the absence of a verifiable approval, never from the wrapper's own
label. That is the specific overclaim this facet exists to prevent.
