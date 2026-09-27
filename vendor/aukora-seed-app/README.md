# aukora-seed-app: the never-push-main candidate stage, path fence, reference monitor, repo identity and governed crossing
Source: github.com/aumara-xyz/aukora @ def297fc146bf3c448df4d0f4e78358d65345436, apps/seed plus its whole import closure (apps/brain, packages/{council,evidence,kernel-node,memory,mind}), taken with `git archive` into `src/<upstream path>`. Every file's blob id and sha256 are in PROVENANCE.json.
Not copied: @aukora/kernel (Genesis carries it at vendor/aukora-kernel; set AUKORA_KERNEL_SRC if that directory is absent). Not vendored: @noble/curves 2.2.0, @noble/hashes 2.2.0, @noble/post-quantum 0.6.1, vitest 4.x, and tsx (r39 runs `npx tsx`).
Tests: run them from src/apps/seed. The two run-tests.* files are Genesis-authored.
```
cd vendor/aukora-seed-app/src/apps/seed && AUKORA_SEED_DEPS=/path/to/node_modules node /path/to/vitest/vitest.mjs run --config ../../../run-tests.vitest.config.mjs
```
Measured 2026-09-27 with vitest 4.1.8 and tsx 4.23.15: containment 69/69, r39.security 10/10, r47.governed-crossing 11/11. With isSelfProtecting stubbed to false, r39 goes red (2 fail).
STATUS: imported byte for byte, not yet wired into Genesis
