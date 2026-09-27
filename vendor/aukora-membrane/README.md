# aukora-membrane (vendored byte for byte)

The membrane's cold-process minimal verifier and its guided tour, with every file the tour reads.
Source: github.com/aumara-xyz/aukora-membrane at d8b17faca5f17bb6e279feb30a2ea808a1f31cb8. The same `minimal/`
bytes are pinned at `vendor/phase0-consistency/`. Each file's git blob is listed in `PROVENANCE.json` (0 mismatches).

    python3 minimal/verify.py --selftest     # 4/4, no files needed
    python3 minimal/tour.py                  # four acts: APPEND_ONLY, UNDETERMINED, OBSERVATION_CONFLICT, UNDETERMINED

STATUS: imported byte for byte. `scripts/aura/verify-append-only.mjs` uses the pinned copy on Kira's Aura ledger.
