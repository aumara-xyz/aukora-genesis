# vendor/aukora-packages
@aukora/memory (KIRA memory law: scoped envelope, recall, staleness), @aukora/council (advisory multi-model council with disagreement accounting) and ConvexWorkflowStore (async cache facade over a Convex workflow store).
Source: aumara-xyz/aukora @ def297fc146bf3c448df4d0f4e78358d65345436, copied with `git archive`; upstream layout under `src/`, LICENSE and NOTICE from the upstream root. PROVENANCE.json pins all 36 files (git blob, sha256, bytes).
Council tests, no dependencies: `cd src/packages/council && bun test ./test` (82 pass).
Memory tests: `cd src/packages/memory && bun test ./test`, once `@aukora/kernel/{canonical,staleness}` (aukora@def297f packages/kernel, vendored in Genesis as vendor/aukora-kernel) and `@noble/{hashes,curves,post-quantum}` resolve (17 pass).
`src/apps/brain/test/convexWorkflowStore.test.ts` also needs vitest, convex 1.42.2, convex-test 0.0.54 and upstream `apps/brain/convex`, `apps/brain/src/index.ts` and `apps/seed`, which are not in this directory.
License: AGPL-3.0-or-later (see LICENSE and NOTICE).
STATUS: `src/` imported byte for byte. `packages/memory` is wired into Kira: `node vendor/aukora-packages/transpile.mjs` type-strips it into `lib/` (only the two `@aukora/kernel` specifiers are rewritten, to `vendor/aukora-kernel/lib`; PROVENANCE.json `generated` records every byte), and `plugins/aukora-kira/lib/memory-law.mjs` calls it. Check: `node tests/kira-memory-law.test.mjs` (and `--red`). Council and apps/brain are not wired.
