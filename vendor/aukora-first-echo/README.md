# aukora-first-echo: a second machine witnesses the receipt frontier

What: the First Echo courier (`src/core/echo/courier.mjs`, `src/bin/echo.mjs`) plus the peer, frontier and chain modules it signs over, so a second machine acknowledges the exact checkpoint it retained without seeing content.
From: aukora-phi @ a099901ad5a2d623c5343263de6ae5f9994d3159 (github.com/aumara-xyz/aukora-phi), via `git archive`; `src/` keeps upstream paths, and every file's blob, sha256 and role is in `PROVENANCE.json`. License: AGPL-3.0-only, declared in `src/package.json` (the commit has no LICENSE or NOTICE file).
Tests, from `src/`, need bun on PATH. Point keys and chains at empty dirs, or the tests can write into `~/.aukora/keys` and `~/.aukora/chains`:
`AUKORA_KEYS_DIR="$(mktemp -d)" bun test --path-ignore-patterns='**/witness-chain-identity.test.mjs' ./test/`
`AUKORA_KEYS_DIR="$(mktemp -d)" AUKORA_CHAIN_HOME="$(mktemp -d)" bun test ./test/witness-chain-identity.test.mjs`
(Only the git-identity test gets `AUKORA_CHAIN_HOME`: set for the other tests, it makes them share one chain file and fail.)

STATUS: imported byte for byte, not yet wired into Genesis.
