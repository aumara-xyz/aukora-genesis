# `patches/` — the Aukora patch layer over the pinned upstream build

`vendor/dsh` is a **pinned upstream tree** (`upstream-dsh.json`) extracted from
`vendor/dsh-source.tar.gz`. Aukora does not hand-edit it: `scripts/build-dsh.py` refuses to patch unless
every file the pinned tarball carries is byte-identical to it, so it only builds from a fresh extraction,
and then applies the patches declared here **as part of the build**. Added files and built `lib/` outputs
are outside that guard; the `lib/` outputs are covered by the artifact record. The
difference from upstream is therefore constructed, named, hashed and reviewable — never a mystery fork
and never a silent drift that a later re-materialize erases.

## One patch, one JSON file

`patches/*.patch.json`, sorted by filename and applied in that order:

```json
{
  "formatVersion": 1,
  "name": "client-hmr-events-auth",
  "reason": "why this patch exists, in one sentence a reader can act on",
  "edits": [
    {
      "path": "packages/client/hmr/src/index.ts",
      "find": "exact bytes already present in the pristine tree",
      "replace": "the bytes that must be there instead",
      "occurrences": 1
    }
  ],
  "expectAfterApply": [
    { "path": "packages/client/hmr/src/index.ts", "contains": "bytes the patched file must carry" }
  ],
  "expectAfterBuild": [
    { "path": "packages/client/hmr/lib/index.js", "contains": "bytes the build must produce" }
  ]
}
```

* `find` must appear **exactly** `occurrences` times (default 1) or the build **fails** with
  `patch-find-missing` / `patch-find-ambiguous`. Nothing is skipped; nothing is best-effort.
* `edits` are applied in order and the result is written to disk, so a later edit may depend on an
  earlier one.
* `expectAfterApply` is checked immediately after the edits land, and `expectAfterBuild` after
  `pnpm run build` regenerates `lib/`. Either being false **fails** the build with
  `patch-expect-missing`. This is how a source patch is proven to have travelled into the artifact the
  release actually loads — instead of assuming it did.
* Every patch's own `sha256` is recorded in `upstream-dsh.json` under `localPatches`, together with
  its `file` and `reason`, and `scripts/build-dsh.py` re-checks that hash (and the reason text) before
  applying it. A patch file edited without updating the pin fails the build.
* `python3 scripts/build-dsh.py --patches-only [--phase apply|build] [--skip-pristine]` runs just the
  patch layer against a tree, which is what `tests/aukora-patch-layer.test.mjs` uses to exercise each
  gate on its own. The supported build always uses `--phase all` and never skips the pristine guard.

## Why replacement, not a unified diff

The pinned tree is a 22 MB upstream tarball of sources; it carries no `lib/`, and the `lib/` halves the
build generates are minified. A
unified diff carries three lines of context and breaks on any churn near the hunk, which turns "the
next patch needs no code change" into "the next patch needs the context re-derived". Exact-byte
replacement is stricter, not looser: the bytes must be there verbatim or the build stops, and the
built artifact the patch produces (`packages/client/hmr/lib/index.js`) is recorded in the artifact record
like every other covered byte. The patched source is stripped from releases and not recorded.

## What is not here

The `connection` service is a **hard dependency** of the patched `client-hmr` node half
(`inject: ['clientModules', 'webServer', 'connection']`). If a deployment mounts `client-hmr` without
`connection`, then by Cordis inject semantics (not measured here) the plugin should stay pending and
register no route — failing closed (no channel) rather than open (an unauthenticated channel). The
handler's own check is skipped when the service is absent, so the inject list is the only fence.
