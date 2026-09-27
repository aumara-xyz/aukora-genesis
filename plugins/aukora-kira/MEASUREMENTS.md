# Measured cost of the lexical conversational method

**Measured object:** the `plugins/aukora-kira/lib/` bytes whose SHA-256 values
appear in `measuredSources` below and in `MEASUREMENTS.json`. The hashes name the
exact bytes measured on 2026-09-16. Nothing re-checks them against the tree (the bench
records them when it runs, and the bench is in no gate). By 2026-09-26, five of the seven
files had changed, so these figures describe earlier code until the bench is rerun.

Measured source bytes (SHA-256, recorded by the run):

| File | SHA-256 |
|---|---|
| `lib/conversation.mjs` | `87bcbe6283ad533158b8ea1f15b5ca16089459c1651d8de0a5eba7f8ec56307e` |
| `lib/index.js` | `0fad5b6ce609098789efbcc44814309a6152c07bb7fa352dd4362eb0f73ee76f` |
| `lib/parameters.mjs` | `c41f3e7742bce30f5951ad272b36667f728b851a61d24509d001baa34fb511f1` |
| `lib/read-owner.mjs` | `4accb72ab9e0d1851b70186baf13bf4e03dc43efb14242be6f7040ba098a7428` |
| `lib/record.mjs` | `26e5d5f6ee19119410b06f267d873bfd323ea5100527d6109349d0d360a24c4f` |
| `lib/retrieval.mjs` | `5e1cc031e2914b669863c3a356542eca09f91c3619c0c6d7a16b7ca8ab70a923` |
| `lib/tools.mjs` | `484e8170a0791661bd97fd67e4590a3c49c1d1644daf13cbaf5c81d3c7bffa20` |

Raw artifact: `MEASUREMENTS.json` (this directory). Reproduce with:

```sh
node tests/kira-lexical-bench.mjs --records 1000 --query-turns 200 --json plugins/aukora-kira/MEASUREMENTS.json
```

Measured on the merge-forward candidate that carries the byte hashes above; the
branch head at the time of writing is in `PROVENANCE.md`. The hashes, not a
commit id, are the authoritative identifier: they name the exact bytes the
numbers describe.

Environment: darwin arm64, node `v22.23.0`, one process, one synthetic corpus,
no warm-up rounds. These are single-run observations on one machine, not a
benchmark suite and not a performance guarantee. Repeat runs moved the
plugin-turn mean between about 31 and 42 ms across revisions and runs (this
artifact's run: 31.0 ms), so treat the millisecond figures as magnitude only.

Method under measurement: `lexical-bm25-bigram`, digest
`e7395c0ad06e7b7a8624b6128e19c182e4b9ff124796332f478ed3c96f47623a`.

## CPU latency

Corpus: 1000 synthetic records, 200 turns. Milliseconds.

| Phase | per call (p50) | p95 | mean |
|---|---:|---:|---:|
| `kira.stage` one record | 0.008 | 0.010 | 0.011 |
| compile the lexical index (1000 records) | — | — | 1.31 (single) |
| rank one question against the index | 2.70 | 3.81 | 2.70 |
| read-owner acquisition (see note) | 0.04 | 0.07 | 0.05 |
| snapshot verification (all 1000 records) | 10.04 | 10.55 | 10.06 |
| snapshot digest (one key, ~844 KB) | 3.56 | — | 3.54 |
| **full published turn** | **30.68** | **36.09** | **31.14** |
| plugin-attributable turn cost | 30.60 | 35.87 | 31.04 |

**Attribution, and what it does not show.** A published turn acquires the read owner twice, so the phase
model predicts `2 x snapshotVerify + 2 x snapshotDigest + rank`:
`2(10.06) + 2(3.54) + 2.70 = 29.9 ms`
against a measured plugin-turn mean of `31.0 ms`, a residual of `-1.1 ms`.

**This is not a decomposition that closes, and the sign of the residual is not stable.** On this run the
phases sum slightly *below* the whole; the review that prompted this rewrite measured the opposite sign on
an earlier revision (phases summing ~4 ms *above* the whole). Each phase is timed in isolation while the
turn interleaves them, so the residual carries the difference between those two measurement shapes, and
it changes sign with run-to-run noise. A previous revision of this file presented a positive residual as
evidence that "the model closes"; that claim is withdrawn. What these numbers do support is the ranking
of the terms and their rough magnitudes: record re-verification dominates, the snapshot digest is second,
and ranking is small.



The dominant term is **record re-verification**: the plugin re-derives `recordId`
and `contentSha256` for every record in the snapshot on every acquisition, so a
citation can never name a record that does not hash to it. This is the pinned
broker's own posture — it verifies the whole local Aura chain, the object
inventory and every record before answering a recall.

The `read-owner acquisition` row is small only because the disposable adapter
hands over an in-memory snapshot. A broker-backed owner would carry real I/O and
its own chain verification; that cost belongs to the admitted memory path, not
to Kira, and conflating the two would misattribute the store's cost to the
retrieval method.

### Friction found, and the proposed change

At 1000 records the plugin spends ~31 ms per turn, ~20 ms of it re-verifying
records it verified moments earlier, twice per turn, and ~7 ms re-hashing the
snapshot key, twice per turn. Both are `O(records)` and both run twice per turn. The pinned
broker pays the same order of cost per recall.

Proposal, not implemented here: cache the **verified** snapshot keyed by the
digest of the bytes the owner returned. Verification is a deterministic function
of those bytes, so identical bytes have an identical verdict, and the cache hit
path needs one hash of the returned snapshot instead of a full per-record
re-parse. The second acquisition would then usually cost one digest rather than
one verify plus one digest. Not implemented in this increment because it trades
a small amount of review complexity for latency, and the integrity property it
must preserve — never serve an unverified record — needs its own negative
control before it ships.

## Footprint

Bytes. Every figure in this section is copied verbatim from `MEASUREMENTS.json` as
an unformatted integer, so the two cannot disagree by transcription: a previous
revision grouped its digits differently from the artifact it cited and reported a
heap figure from a different run entirely.

| Part | Bytes | What it is |
|---|---:|---|
| `retained.snapshotBytes` | 843906 | the 1000 visible records as JSON |
| `retained.indexBytes` | 319387 | the compiled lexical index (tokens + document frequency + vocabulary) |
| `retained.stateBytes` | 589 | one bounded working state (ceiling 8192) |
| `retained.pluginBytes` | 319976 | index + working state: the structures **Kira** holds |
| `retained.readOwnerBytes` | 1462808 | the adapter's own record structures — the read owner's, not the plugin's |
| **`footprint.vectorBytes`** | **0** | the lexical method stores **no** vector bytes |
| `process.heapUsedDeltaBytes` | 22173064 | observed heap delta for the whole run in this process |

`vectorBytes: 0` is a property of the measured method, not a claim about the
migration inventory. The `static-embedding`, `int8` and `ternary` options are
**not implemented and not measured**: no encoder is deployed by this build, so
their bytes are unknown rather than zero, and reporting a number for them would
be fabrication. The pinned research gives them a representation
(`f32` / `i8`+scale / 2-bit packed over the same dimensions) and nothing here
should be read as a deployed footprint.

`heapUsedDeltaBytes` is an observation of one process across corpus
construction, index compilation and 200 turns. It is not a GC-precise retained
size, and it is dominated by the adapter's in-memory store rather than by the
plugin. The `retained.*` rows are the accounted figures; the heap delta is
reported only because omitting it would hide how it was obtained.

## What is deliberately not measured

- **No accuracy, quality, correctness or answer score.** Lexical and embedding
  similarity are overlap measures. A high score says a record shares terms with a
  question and nothing about whether it answers it. No answer is generated or
  scored anywhere in the bench. `descriptive.retrievalStatusCounts` reports which
  status the method returned, which is a count, not a measure of correctness. At
  this corpus size the synthetic vocabulary made all 200 questions ambiguous (0
  matches), so no turn in this run reached the match status. That is a property of
  the fixture, not a result.
- **No comparison against the derived options.** Running them would require the
  encoder artifact the pinned research used, which this increment does not
  download.
- **No concurrency, no sustained load, no multi-process behaviour.** No latency
  or footprint figure here is a concurrency measurement.
- **The session bound is asserted, not measured.** `maxSessions` and the
  eviction-disposal invariant are covered by the arm
  `session-bound-evicts-and-stops-late-publication` in
  `tests/kira-dsh-assembly.test.mjs`, which mounts with `maxSessions: 1`, drives
  two agent scopes through the real runtime, and asserts that eviction closed the
  displaced session and that its in-flight turn could not publish a late result —
  with a mutation that neutralizes `close` and must then fail the arm. That is an
  assertion about behaviour, not a throughput or cost figure, and an earlier
  revision of this file claimed the coverage before any such arm existed.
