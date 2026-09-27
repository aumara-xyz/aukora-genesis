# CLAIM

This directory is a stranger court. It does not see an Aura log, a receipt,
a grant, or a repository. It sees only a retained observation and a presented
observation.

**Permitted claim:** retaining observation N enables checking presentation M.

## Verdicts

The verifier prints exactly one of these words and nothing else on stdout:

- `APPEND_ONLY` — the presented `(size, root)` is a consistent RFC-6962
  extension of the retained `(size, root)`.
- `OBSERVATION_CONFLICT` — the pair is a fork, a rewind, a same-size
  equivocation, or a proof that reconstructs different roots.
- `UNDETERMINED` — this minimal verifier will not decide.

No other verdict exists.

## Known limit (stays UNDETERMINED)

When the retained size N is a power of two and the presented size M is
greater than N, this verifier returns `UNDETERMINED`.

RFC 9162 §2.1.4.2 step 2 would prepend `first_hash` to the consistency path
in that case. This membrane does not implement that step. A fuller verifier
may decide those pairs. This one will not claim `APPEND_ONLY` or
`OBSERVATION_CONFLICT` there.

Equal-size pairs (including power-of-two sizes) are still decided:
same root is `APPEND_ONLY`, different root is `OBSERVATION_CONFLICT`.

## What this is not

Not a human-ceremony. Not CONFORMING. Not L1. Not a blockchain. Not a
product membrane. Vendored here so the toy runs with `python3` and no
sibling repo. Evidence never authorizes. Identity never crowns.
