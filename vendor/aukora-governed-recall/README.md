# aukora-governed-recall

Governed recall. Memory is read back through the consent, containment, ingest-gate, scope and staleness checks in `core/memory`, so a recalled memory cannot become authority or cross its scope, and forgetting reaches everything the mind block reads.

Source: `aumara-xyz/aukora-phi` @ `a099901ad5a2d623c5343263de6ae5f9994d3159`. Upstream paths are kept verbatim under `src/`. `PROVENANCE.json` lists each file's git blob id, sha256 and byte count. Licence: AGPL-3.0-only, as declared in `src/package.json`. Upstream has no LICENSE or NOTICE file.

Tests (offline, no dependencies, Bun 1.3.14): `cd vendor/aukora-governed-recall/src && bun test ./test`. Result at import: 150 pass, 0 fail, 449 expect() calls, 11 files. The two recall suites alone give 23/23: `bun test ./test/governed-recall.test.ts ./test/mind-block-governed.test.ts`.

STATUS: imported byte for byte, not yet wired into Genesis, except one comment in `src/core/memory/erasureCertificate.ts` that named a private document (removed for publication; `genesisEdit` in `PROVENANCE.json` records the upstream digest).
