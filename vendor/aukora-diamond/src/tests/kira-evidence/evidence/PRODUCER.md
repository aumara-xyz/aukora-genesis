# PRODUCER — where these bytes came from, and how to remake them

Everything in `../evidence/` was produced by a **public producer in another repository**. This
file records which revision, which modules, which inputs, and how the reproduction was checked
— because a bundle nobody can re-derive is a bundle nobody can check, and "I ran it once" is
not provenance.

## The producer

| field | value |
|---|---|
| repository | `github.com/aumara-xyz/aukora-genesis`, worktree `/Users/peterviviani/aukora-genesis-worktrees/lead-fixture` |
| commit | `a313854df5f8b3f3ea2c34eb1f50b88d63c0d013` ("fixture: one public operation/evidence envelope v1, built by the project's own producer") |
| module | `plugins/aukora-kira/lib/record.mjs` — `stageKiraMemoryRecord`, `canonicalJSON`, `kiraRecordContentSha256`, `verifyKiraMemoryRecord` |
| module | `plugins/aukora-kira/lib/memory-owner.mjs` — `createMemoryOwner`, the admitted settlement path |
| module | `scripts/composition/jcs.py` — the same restricted JCS subset, used for comparison only |
| licence | AGPL-3.0 |

Vendored copies of those modules live in `../evidence/vendor/` and hash **identical** to their
upstream sources at that commit:

| vendored path | sha256 (identical upstream and here) |
|---|---|
| `vendor/kira/record.mjs` | `dfbb3800bf7519c1e1a3e4e2a263c0ea8c8367093ebb34a2a79e2fcc3b3bf083` |
| `vendor/kira/memory-owner.mjs` | `c4d17c7caf0b1e9e3437b809723f943929734ce366cb4627dc1fdf974c1087a3` |
| `vendor/composition/jcs.py` | `7d11510f7d435fe1d2804be881374adbd15f506108e547afe2045402ccd1a469` |
| `vendor/genesis-fixture-README.md` | `6aa7a51bc5f146f8601e34aeb503b0bbe15d884d033b1a6a70c4cbbb0dfcc0e3` |

## The inputs

The record is **not** written by Diamond. It is a byte-identical copy of the shared public
fixture `tests/fixtures/operation-envelope-v1/record.json` from that commit, itself produced by
`stageKiraMemoryRecord`. The bundle's `fixture/DIGESTS.txt` is that directory's own digest file,
copied verbatim, so the published identity can be checked against the producer's numbers:

```
recordId      kira:4bf512a553eee25b492b00780ac18f617b682f5565b4e54fe308247e616f4bc1
recordDigest  2469437bd82fcaf4011300596107af354d39c8c458ac0de6062de28c187ff0f1
```

The consumer recomputes both from the record's own fields and gets the same pair. That is a
**cross-implementation agreement**, not the producer's word: the consumer's canonicalizer and
identifier rule are independent Python code, and the fixture's own build was re-run to confirm
the fixture is deterministic before it was used as a source.

## The export

The migration was performed by a throwaway Node script kept outside both repositories
(`/tmp/kira-export.mjs`), which:

1. imports the producer's modules by absolute path from that worktree — no Genesis file is
   modified, and no Genesis file is read except the modules above and the fixture;
2. seeds the owner's issuer key from a **fixed public constant** so the evidence is
   reproducible, then lets Node's own crypto derive the SPKI public half;
3. calls `owner.grantFor(memoryPut, {expiry, nonce})` and `owner.settleAuthorized({grant,
   record})` **twice**, with two distinct one-use nonces, a fixed clock (`now: () => 1789000000`)
   and a fixed grant expiry — so the two writes, the two log entries and the two receipts are
   byte-deterministic;
4. copies out the Aura log, the stored object bytes and the public key, and records the
   producer's OWN verification verdicts into `producer-summary.json`.

The grant is present only as an argument to that call: **no grant, authorization, or approval
is committed**. What is committed is the resulting evidence.

## Determinism, measured rather than asserted

The exporter was run twice into two different state directories and every emitted file was
compared:

```
IDENTICAL ./aura.jsonl
IDENTICAL ./issuer-test-key.json
IDENTICAL ./objects/a445c546db3acdceeb98286932d8e0f06fe285532f349a88d29b022bd2590945.json
IDENTICAL ./producer-summary.json
IDENTICAL ./receipt-1.json
IDENTICAL ./receipt-2.json
```

## The producer's rule, restated before it was trusted

`memory-owner.mjs`'s own documentation says an Aura entry hash covers "the canonical JSON of the
entry body with `domain` added, where the body is the stored fields less `hash`". The measured
preimage from the producer's own bytes is

```json
{"contentSha256":"…","domain":"aukora:aura-record:v1","key":"kira:…","operation":"memory.put","prev":"aukora:aura-record:v1","sequence":1,"verdict":"settled"}
```

— which **includes `sequence`**, inside the envelope. An independent reconstruction built from
the documentation alone (four body fields + `prev` + `domain`) reproduces nothing: its hash is
`f65a093d…`, and the stored entry hash is `b1f15fd2…`. The consumer therefore restates the
MEASURED rule, and this discrepancy is recorded here because a memo that omits a hashed field is
exactly the kind of drift that makes two implementations disagree about which bytes were signed.

## What the producer's revision is NOT being asked to do

The producer is not modified, not patched, not pinned by this repository, and not needed at run
time. The consumer's verdicts stand with `../evidence/vendor/` moved away entirely — the arm
runner measures that (arms 0d, 6f, 6g).
