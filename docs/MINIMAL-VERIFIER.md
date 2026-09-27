# The minimal verifier, pointed at Aura

`vendor/append-only/` is `github.com/aumara-xyz/aukora-membrane` `minimal/` at `d8b17fac`, byte for
byte (`verify.py` sha256 `039aa899…958089`; `python3 scripts/phase0-check-pins.py` recomputes every pin).
`verify.py` is a standalone Python checker for RFC 6962 consistency proofs. Given a head you kept
(tree size N, root) and a later head (size M, root, proof), it answers `APPEND_ONLY`,
`OBSERVATION_CONFLICT` or `UNDETERMINED`.

`scripts/aura/verify-append-only.mjs` points that checker at Kira's memory ledger (`aura.jsonl`, the
hash chain `memory-owner.mjs` writes: `sequence`, `prev`, `hash`).

## Two commands

```bash
python3 vendor/append-only/verify.py --selftest    # the membrane verifier alone: 4/4 checks, no files
node scripts/aura/verify-append-only.mjs --selftest       # the Aura bridge: 12 cases on disposable logs, plus the
                                                          # restated hash rule compared with memory-owner.mjs
```

On a real log:

```bash
node scripts/aura/verify-append-only.mjs retain <aura.jsonl> > head.json      # keep this file somewhere else
node scripts/aura/verify-append-only.mjs head.json <aura.jsonl> [--out DIR]   # later: 0 APPEND_ONLY, 2 REWRITTEN
```

The retained side can be any of these:

- a head written by `retain`,
- a head written by `scripts/kira/retain-head.mjs`, which uses the same leaf convention,
- a Kira receipt, whose `aura.seq` and `aura.entryHash` are a head (its signature is not checked),
- a copy of the log's first N lines (a `.jsonl` file). With this form the tool can name the exact first entry that changed.

## What it proves

1. **Chain arm (the tool itself).** Every entry is re-derived from the start of the log under the Aura rule,
   `sha256(canonicalJSON({prev, ...fields, domain: "aukora:aura-record:v1"}))`. The rule is restated in the tool, not
   imported. It also checks that each `prev` names the entry before it, that each line is canonical, and that
   `sequence` equals the entry's position. Entry N must equal the retained hash. If all of that holds, entries
   1..N are the ones that were retained and every later entry chains onto them. Otherwise the tool reports
   `REWRITTEN` with the first bad position and a reason (`CHAIN_TAMPERED`, `CHAIN_BROKEN_LINK`,
   `RETAINED_HEAD_MISMATCH`, `RETAINED_ENTRY_DIFFERS`, `SHORTER_THAN_RETAINED`, …).
2. **Court arm (the membrane verifier, unedited, run as a separate process).** When the retained side has a Merkle
   root, the tool builds the RFC 6962 tree over the re-derived entry hashes. Leaf k is `sha256(0x00 ‖ hash_k)` and
   each node is `sha256(0x01 ‖ l ‖ r)`. The tool writes `presented.json` with the consistency proof and runs
   `python3 vendor/append-only/verify.py <retained> <presented>`. Pass `--out DIR` to keep both files so
   anyone can re-run that line. The command prints the court's verdict beside its own. If the chain arm says
   `APPEND_ONLY` and the court disagrees, the result is `UNDETERMINED`.

**Why two arms.** When the retained size is a power of two, the court cannot tell a rewritten prefix from a damaged
proof, so it answers `UNDETERMINED (POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE)`. The chain arm still catches
the rewrite. The self-test shows the reverse as well: if the chain rule is mutated to drop `prev`, the court arm
catches what the chain arm missed.

## What it does not prove

It does not prove that any entry is true, who wrote an entry, that any signature is valid, or that only one log
exists. It also cannot prove that the retained head was kept somewhere the log's writer cannot reach. A head kept on
the same disk as the log shows only that the arithmetic holds, not who had custody. Keep heads off this machine.

## `tour.py`

`vendor/append-only/tour.py` is upstream's teaching file. It reads `docs/heads/demo/`, and that directory
exists only in the membrane repository. Run from this repository, every act prints `UNDETERMINED
parse_or_io_error`. Run it in a membrane checkout (`python3 minimal/tour.py`), where the four acts print
`APPEND_ONLY`, `UNDETERMINED`, `OBSERVATION_CONFLICT` and `UNDETERMINED (2^k)`. Its scoreboard there reads 12 cases,
7 honest, 0 accused.
