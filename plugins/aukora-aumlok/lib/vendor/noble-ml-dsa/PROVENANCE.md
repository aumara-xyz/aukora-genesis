# PROVENANCE — plugins/aukora-aumlok/lib/vendor/noble-ml-dsa

What this directory is: the measured, pinned ML-DSA-65 implementation this lane signs and verifies
with, reduced to the eight upstream modules a real keygen → sign → verify round trip actually loads,
plus a three-line Genesis-authored entry. It holds no `node_modules`, reaches no network, and
resolves nothing outside itself.

Why it is here: `scripts/aumlok/enrol` was filling the ML-DSA-65 public and secret fields with
`randomBytes` of the right length. Two arbitrary strings are not a keypair, so the ceremony
registered fields that could not correspond. Repairing that needs a genuine generator, and this
repository has no package manifest and no install step, so a dependency cannot be declared — it can
only be vendored or fetched. It was vendored.

## Upstream

| field | value |
| --- | --- |
| packages | `@noble/post-quantum@0.6.1`, `@noble/curves@2.2.0`, `@noble/hashes@2.2.0` |
| author | Paul Miller (`https://paulmillr.com`) |
| licence | **MIT** for all three. Carried verbatim in `licenses/`, one file per package, because the copyright year differs: post-quantum says 2024, curves and hashes say 2022. |
| taken from | the `aukora-deep` checkout at commit `7be3a614aab0580ec2d60cdcf77920217695ef2b`, from its own pnpm store — i.e. the exact bytes Deep resolves and runs at that commit |
| network | **none used.** No registry was contacted; no tarball was downloaded. |
| integrity | the three `sha512` values in Deep's `pnpm-lock.yaml` are recorded per package in the manifest as `lockfileIntegrity`, alongside the lockfile's own `sha256` |
| manifest | `upstream-noble-ml-dsa.json`, checked by `scripts/aumlok/check-vendor-closure.mjs` |

## Why these eight modules and not the package

The closure was **measured, not read**. A Node resolve hook was registered, a full
`keygen` → `getPublicKey` → `sign` → `verify` round trip was run against Deep's copy, and every
module URL Node actually resolved was recorded. The result is eight modules and 133 138 bytes:

| vendored path | from | why it is reachable |
| --- | --- | --- |
| `post-quantum/ml-dsa.js` | `@noble/post-quantum` | `ml_dsa65` itself |
| `post-quantum/_crystals.js` | `@noble/post-quantum` | the shared CRYSTALS machinery ML-DSA is built on |
| `post-quantum/utils.js` | `@noble/post-quantum` | byte, coder and option helpers |
| `curves/utils.js` | `@noble/curves` | `abool`, imported by `ml-dsa.js` |
| `curves/abstract/fft.js` | `@noble/curves` | `FFTCore`, `reverseBits` — the NTT |
| `hashes/sha3.js` | `@noble/hashes` | `shake128`, `shake256` |
| `hashes/utils.js` | `@noble/hashes` | `abytes`, `concatBytes`, `isLE`, `randomBytes` |
| `hashes/_u64.js` | `@noble/hashes` | `rotlBH/L`, `rotlSH/L`, `split` |

Deliberately **not** vendored — each name below appears in the package, and each was checked rather
than assumed:

* `ml-kem.js`, `slh-dsa.js`, `falcon.js`, `hybrid.js` — other primitives, unreachable from
  `ml_dsa65`. Vendoring them would be a mountain for no measured need.
* `@noble/curves/ed25519.js` — this lane verifies Ed25519 through `node:crypto`, not through
  `@noble/curves`. **This is the reason `ED25519_POINT_UNVALIDATED` still stands**: the vendored
  `curves/` slice is the two modules ML-DSA's FFT needs, and it carries no point validation.
* `@noble/curves/abstract/modular.js`, `@noble/hashes/sha2.js`, `@noble/hashes/hmac.js` — named
  inside JSDoc examples in `fft.js`, `utils.js` and `curves/utils.js`, never in an import statement.
  The resolve-hook measurement is what establishes this: none of the three was loaded. Reading the
  files' `grep` output alone would have counted them, because a `grep` cannot tell a comment from an
  import — which is precisely how a vendor step silently acquires modules it never needed.
* all `.d.ts`, `.js.map` and `.d.ts.map` files, and `README.md` — not runtime bytes.

## The one modification, and why it is the only one

The vendored tree has no `node_modules`, so a bare `@noble/...` specifier cannot resolve. Each
occurrence in an import statement is replaced by the relative path to the same file. There are
exactly **six** such occurrences, in four files; four of the eight modules are carried byte-identical
to upstream and have an empty `specifierRewrites` list to say so:

| file | from | to |
| --- | --- | --- |
| `post-quantum/ml-dsa.js` | `@noble/curves/utils.js` | `../curves/utils.js` |
| `post-quantum/ml-dsa.js` | `@noble/hashes/sha3.js` | `../hashes/sha3.js` |
| `post-quantum/_crystals.js` | `@noble/curves/abstract/fft.js` | `../curves/abstract/fft.js` |
| `post-quantum/_crystals.js` | `@noble/hashes/sha3.js` | `../hashes/sha3.js` |
| `post-quantum/utils.js` | `@noble/hashes/utils.js` | `../hashes/utils.js` |
| `curves/utils.js` | `@noble/hashes/utils.js` | `../hashes/utils.js` |

No other byte is altered. The manifest records the upstream `sha256` **and** the vendored `sha256`
for every module, so the two can be compared rather than trusted, and
`check-vendor-closure.mjs --deep <path>` re-derives each vendored file from upstream by applying
exactly these rewrites and requires byte equality. A manifest and a file can be edited together; a
re-derivation from a pinned upstream checkout cannot be.

## What this directory does NOT establish

**It does not establish that this is FIPS 204 ML-DSA-65.** It is a working, internally consistent
ML-DSA-65 implementation: it produces keys of the standard's exact sizes (1952 / 4032 / 3309), the
halves correspond, and it can tell its own signature from a wrong one. What is missing is a
known-answer vector from the standard and a second, independent implementation to disagree with —
neither exists on this host, and neither was fetched. So "this is the standard's ML-DSA-65" is an
assumption about the upstream library, not a measurement made here. `ML_DSA_65_UNMEASURED` says
exactly this and is **not** retired by this directory.

**It does not establish defect-freedom.** A vendored copy of a library inherits that library's bugs
and inherits none of its future fixes. Re-vendoring is a deliberate act with a manifest change; it
does not happen by itself.

**It does not make the bytes tamper-evident by itself.** The manifest digest is checked by
`scripts/aumlok/check-vendor-closure.mjs` and by section 1 of `tests/aukora-aumlok-pq-keypair.test.mjs` (neither runs in CI yet). A writer
able to change the modules, the manifest and both checkers can produce a coherent false result. The
release's own `plugins/*/lib/**/*` integrity pattern covers these bytes because they live under
`lib/`, which is why they are here rather than in the repository-root `vendor/` — that directory is
copied into a release by a hardcoded two-entry list in `scripts/materialize-aukora-release.py`
(`VENDORED`), while `LANE_DIRS = ('lib',)` is what carries a lane plugin's own files. Under
`vendor/` these modules would have shipped in no release at all.
