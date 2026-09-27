# What this release governs, and what it does not

## Governed

| What | How it is admitted | Where |
| --- | --- | --- |
| Every AUKORA plugin a patch at the release root mounts, whether or not a deployment lists that patch (the ids in `policy.json` `pluginSet`; `demo-governed` excepted) | By the owner's ONE Aumlok approval of the release's plugin set record. The materializer records a sha256 for every file of each plugin (`scripts/aukora/plugin-set.mjs record` writes `.dsh-build/plugin-set.json`); the owner approves the set digest in one popup (`plugin-set.mjs approve`); the gate verifies that receipt against the pinned approver before anything is imported and checks each plugin file when Node loads it. | `src/plugin-set.mjs`, `src/policy.js` (`installPluginSet`) |
| `hello-governed` (`plugins/aukora-gate-demo/hello-governed.mjs`) | By a one-use grant signed by this installation's governor key, bound to the entry's bytes, its release-relative path and its import closure. | `src/policy.js` (`decide`, `verifyGrant`) |

A plugin file that changed by one byte is refused at import with `plugin-bytes-changed`, naming the
plugin and the file; a file inside a recorded plugin directory that the record does not list is refused
with `plugin-file-unrecorded`. Every recorded file is also checked once, at rest, when the gate installs,
and a plugin with any changed file is refused whole. The launcher enforces the set unless it was given
`--allow-unapproved` (the desktop's `allowUnapproved`, which now ships `false`); then every finding is
printed as `WAIVED` and the file loads.

A composition grant with identical bytes presented at another path is refused
(`GRANT_PATH_NOT_GRANTED`): defect D3 is closed. `scripts/composition/__main__.py grant` binds
`pluginPath` and `pluginClosure` on every grant, and the hook refuses a grant without them.
`test/declared-id-regression.sh` arms 6 and 9 hold it.

## Not governed

- **Upstream's stock plugins and `node_modules`.** `STOCK_PLUGINS_NOT_YET_UNDER_POLICY` still holds
  for them. Bare specifiers are not followed, so no installed dependency byte is in any record.
- **The bootstrap.** `src/install.js` and what it imports (`policy.js`, `artifact.mjs`,
  `admission-grant.mjs`, `plugin-set.mjs`, the owner daemon's `binding.mjs`, `operations.mjs` and
  `owner-separation.mjs`, and Aumlok's `owner-approval.mjs`, `canonical.mjs`, `validation.mjs`,
  `did-key.mjs`, `base58.mjs`) load before the hook exists (`BOOTSTRAP_UNGATED`). They are in the record
  and checked once at rest when the gate installs, by code they are part of. The launcher checks the hook's digest against the approved release
  record before spawn; nothing checks those files at import.
- **Bytes read without an import after boot**: served client bundles, data files, WASM from a buffer.
  They are in the record and checked once at rest when the gate installs, not at each read.
- **Workers and child processes.** Each has its own loader, and the hook is not installed there.
- **The same uid.** The record, the approval, the pinned approver (`gate-state/plugin-set-approver.json`,
  copied from the Kira overlay's `approverDid`) and `governor.pk` are all files this uid can write. An
  agent running as the owner can rewrite all of them together; the gate refuses changed plugin bytes, it
  does not stop that.

## What admission is not

Not confinement and not isolation: an admitted module shares this process and this uid and can
do anything the host can. The boundary is *which bytes may load*. Removing the bootstrap leaves every
import before the gate plugin's `apply()` ungoverned.
