# @aukora/kernel dependencies, exactly as upstream pins them

@noble/curves 2.2.0, @noble/hashes 2.2.0 and @noble/post-quantum 0.6.1 (plus @noble/ciphers 2.2.0, a declared dependency of post-quantum), pinned by aumara-xyz/aukora@def297f `packages/kernel/package.json` and `package-lock.json`.
Each `@noble/<name>@<version>/` is its published npm tarball unpacked byte for byte. The tarball sha512 equals the lockfile integrity, and PROVENANCE.json pins every file (sha256, git blob).
`node_modules/@noble/*` are four links into those directories, so the packages' own bare `@noble/...` imports resolve to the same pinned copies.
Tests: `node vendor/authority/conformance.mjs` (checks every pin and link, then runs the 37 upstream cases against these packages).
STATUS: imported byte for byte; the vendored kernel (lib/, lib-test/) imports these. It is not yet wired into Genesis beyond that kernel.
