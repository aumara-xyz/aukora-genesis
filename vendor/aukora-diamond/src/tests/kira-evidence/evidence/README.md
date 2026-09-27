# Kira evidence bundle — the exported public bytes the offline consumer verifies

This directory is the **exported public evidence**: everything the offline consumer needs, and
nothing it does not. It contains no secret, no private state, no Genesis checkout, and no
network artifact. It is redistributable: the record is `privacy: exportable`, and the issuer
key is a locally generated test key whose seed is published below beside the public key it
derives.

The original bundle was produced by a throwaway exporter using the producer's
modules. [PRODUCER.md](PRODUCER.md) records that historical procedure; the
`/tmp/kira-export.mjs` script itself was not preserved and is **not** a runnable
reproduction command in this checkout. The committed public bytes remain inputs
to the [offline consumer acceptance](../README.md).

## Files

| file | what it is |
|---|---|
| `fixture/record.json` | the Kira memory-v1 record, produced by the project's own `stageKiraMemoryRecord` — a byte-identical copy of aukora-genesis `tests/fixtures/operation-envelope-v1/record.json` |
| `fixture/operation.json` | the operation envelope that PROPOSES the record. `authority.grants: false`, `fixtureOnly: true`, published challenge. It is not an approval and this consumer never reads it as one |
| `fixture/DIGESTS.txt` | the upstream fixture's own digest file, copied verbatim so the record's published `recordId`/`recordDigest` can be checked against Genesis's numbers rather than this bundle's |
| `aura.jsonl` | the Aura log: **two** chained entries, written by the producer's `appendAura` |
| `receipt-1.json` | the signed receipt for entry 1, written after the FIRST write |
| `receipt-2.json` | the signed receipt for entry 2, written after the SECOND write |
| `objects/a445c5…945.json` | the stored object bytes the receipts name: canonical JSON of `{key, value}` plus a newline |
| `issuer.pk` | the NAMED issuer anchor, 64 lowercase hex characters |
| `issuer-test-key.json` | the same key in its SPKI PEM spelling, plus the fixed public seed it derives from |
| `other-issuer.pk` | a different, well-formed public key. The wrong-anchor control |
| `producer-summary.json` | what the producer's OWN verifier said about each receipt, recorded verbatim (see FINDINGS.md) |
| `DIGESTS.txt` | sha256 of every file in this bundle |
| `vendor/` | the producer's sources, vendored so the producer's rule is citable here. **Not executed at run time** — see below |
| `vendor/genesis-fixture-README.md` | Genesis's own README for the fixture, copied verbatim: the field semantics and each lane's obligation |

## The anchor, and what it does not prove

`issuer.pk` is the anchor. It is a **pointer**: it names the key the signature must verify
under. It is not a root of trust. Nothing in this bundle, and nothing in this repository,
attests that the key belongs to a person, an organization, or an owner. It is derived from

```
seed (public, worthless): 3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c
→ Ed25519 public key     : 5526f742941711b3bc530ba44ff6f6dab0f0ab71af832f41a7fe3b9fdaed9c60
```

so a reader can re-derive it, and can re-sign negative controls beside it. That is exactly
what the seed is for, and it is why the seed is published rather than hidden. A signature made
with a published key proves the signature; it never proves a person was present.

## The vendored producer sources are not part of the run

`vendor/kira/record.mjs`, `vendor/kira/memory-owner.mjs` and `vendor/composition/jcs.py` are
the producer's own code, copied here so the rule this consumer restates can be compared against
the code that produced the bytes — by a reader, not by the verifier. The consumer imports only
the Python standard library and `diamond.kira_evidence`; the arm runner **moves these sources
aside** and re-runs three arms (0d, 6f, 6g) to measure that rather than promise it. Verdicts do
not change.

`vendor/*.mjs` is JavaScript and is never executed: Node is taken off `PATH` for the whole run.
If the producer's sources were the thing being trusted, this bundle would be pointless.

## Provenance

See `PRODUCER.md` for the exact producer revision, module digests, the export command, and the
determinism check. `FINDINGS.md` records what the producer's own verifier concluded about
these same bytes, because it is not the same as what the consumer concludes, and that
difference is the reason this consumer exists.
