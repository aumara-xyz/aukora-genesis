# Dated boundary records

`node scripts/owner/measure-boundary.mjs --positive-control` writes `boundary-<timestamp>.json` here,
and docs/INTEGRATION-STATUS.md row 12c cites it. No real record exists yet.

**Warning (corrected 2026-09-26).** `tests/aukora-owner-boundary-measure.test.mjs`, which the front door
runs with `--mutate`, deletes **every** `boundary-*` file in this directory, a real record included, not
only the fixture records it made. Records here are untracked, so a deleted one cannot be recovered. Copy a
real record out before running the courts. A run killed part-way can also leave fixture records here that
read as real, and its `--mutate` arm edits `scripts/owner/measure-boundary.mjs` in place, so a killed run
can leave the tracked instrument mutated.
