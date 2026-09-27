# Phase 0 consistency demonstrator — path mapping

`vendor/phase0-consistency/CLAIM.md` is a pinned, digest-covered file (see `upstream-phase0.json`,
checked by `scripts/phase0-check-pins.py`) and is not edited here. Its own commands assume the
upstream repository layout, which this vendored tree does not reproduce. Map its paths as follows
when running the commands it documents:

- `minimal/verify.py` -> `vendor/phase0-consistency/verify.py`
- `minimal/vectors/` -> `vendor/phase0-consistency/vectors/`

The `docs/heads/...` paths referenced by `tour.py` and `SELFTEST.md` in this same directory are
upstream-only and are not vendored here.
