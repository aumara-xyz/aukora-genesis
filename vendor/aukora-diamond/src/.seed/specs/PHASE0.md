# Phase 0 — Aura consistency (toy)

Permitted claim: a retained Merkle observation of size N/root R1 lets a stranger
check whether a later presentation of size M≥N/root R2 is an append-only extension.

Verdicts only: APPEND_ONLY | OBSERVATION_CONFLICT | UNDETERMINED.
Forbidden: occurrence, world truth, identity, latestness, single-log assumption.

Stranger CLI: `python3 vendor/phase0/verify.py --retained retained.json --presented presented.json`
Selftest: `python3 vendor/phase0/verify.py --selftest`
Court: `python3 vendor/phase0/court.py`

Power-of-two retain with larger present stays UNDETERMINED (no RFC 9162 §2.1.4.2 step 2).
