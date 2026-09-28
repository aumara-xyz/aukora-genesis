# AUKORA Genesis

## What is not enforced

**Deep launcher is in the tree; the live agent still runs on the host.**

Running release on the owner's Mac: `aukora-release-25149f573`, the same commit as GitHub `main` when this was written
(`state/home/become/last.json` names it with the observed pid and port). Source inspection and disposable checks do
not verify the installed app.

- **Approval key: off this user.** It is held by a separate macOS account (`aukora-owner`) and reached only
  through the Airlock socket, where the kernel names the caller; `node scripts/aukora/airlock-probe.mjs` prints
  `VERIFIED EACCES: configured key path cannot be opened by UID 501` on the owner's Mac (2026-09-28), and the first
  approval signed through it moved `main` to `f87b72b68` (`did:key:z6MkiP8BnvVRZJcxtv9TShdq3KUGc7wF1skbZBJbQ96jAtCm`).
  The app and the agent still run as the same macOS user, and that user can still ask the socket to sign.
- **Deep's guest launcher, broker and issuer are in the tree; the live agent still runs on the host.** They are
  copied byte for byte from `aukora-deep@c417f7c` into `plugins/aukora-box/` (sha256 per file in its
  `PROVENANCE.md`); Deep's confinement verifier passes on this Mac and refuses an unrestricted policy. Nothing mounts
  them in the release yet.
- **A signature is not a person.** The approval key is a software key on this Mac. A click is recorded, but
  nothing binds it to a human (`ATTENDANCE: reported-not-proven`).
- **Nothing on GitHub enforces the approval routes.** `scripts/aukora/self-change.mjs` (a diff card) and
  `scripts/aukora/advance.mjs` (a MOVE MAIN card) show a change, get it signed in the popup and verify the signature
  before they write, but the macOS user holds the push credentials and GitHub has no server-side check. Every commit
  on `main` after `1c362a2c5` came through one of these routes and is in the Aura code chain (the commits inside a
  MOVE MAIN are listed in its approved operation); a direct push would still not be stopped.
- **The action gate is an in-process check, not isolation.** It refuses write and edit tool calls on governing
  code and shell writes whose targets it can read (`sed -i`, a redirect, `cp`, `mv`, a literal path in
  `python3 -c`). A shell command that hides its target in a script or variable is not refused by this text check.
  The gate sees a subagent launch, not every tool the child runs; same-UID processes outside the app remain outside it.
  The gate's kernel decides each tool call without a one-use grant; one-use applies to self-change and MOVE MAIN.
  Its verdict is the kernel's `decide()` (`vendor/authority`, called from `plugins/aukora-action-gate/lib/kernel.mjs`).
  Seen live on `aukora-release-25149f573`: a `sed -i` on `plugins/aukora-kira/` from Auma's full-access session was
  refused with `rule: authority:governing-code`, `kernelCode: sacred_target` (2026-09-27T23:53:16Z), file untouched.
- **Seatbelt does not confine danger-full-access sessions.** It is mounted for BUILD (`workspace-write`) and
  read-only shells. Auma's sessions run `danger-full-access`, where Seatbelt is UNENFORCED. The backend process
  and its plugins are outside the shell sandbox.
- **The stock apps share the desktop's origin.** Since 2026-09-27 their frames are `allow-scripts allow-same-origin`
  (`plugins/aukora-face/apps/src/client/EmbeddedAppSurface.tsx:115`), so the null-origin sandbox is off: a vendored
  app runs with the desktop page's origin, and its requests no longer carry the `Origin: null` the app's routes refuse.
- **The composition gate governs the AUKORA plugins by a same-uid record.** A release records every file of each
  AUKORA plugin its patches mount (`policy.json` `pluginSet`), the owner approves that set in one Aumlok popup, and the gate refuses a changed or
  unrecorded plugin file at import. Upstream's stock plugins and `node_modules` load ungoverned
  (`STOCK_PLUGINS_NOT_YET_UNDER_POLICY`), and the record, the approval and the pinned approver are files the
  owner's uid can rewrite (`plugins/aukora-composition-gate/GOVERNED.md`).
- **CORE's two code-running subagents are on.** `presets/core/agent.cordis.yml` enables Codex and Claude Code
  as subagent tools; they run as the owner's user.
- **Releases were switched in with no owner approval.** Until the plugin-set approval, `scripts/aukora/desktop-cutover.mjs
  apply` appended the release's record digest to `approvedRecordSha` itself, unsigned. On `main` it now refuses a
  release whose plugin set the owner has not approved in the popup. The shipped template sets `allowUnapproved: false`
  (`apps/aukora-desktop/resolve.mjs`); `true` in `config.json` waives both. The resolver also grants a first-run
  waiver when no installed plugin-set approval exists and the approved-record list is empty.
- **Signed memory was verified end to end on an earlier release, not this one.** On `aukora-release-76bb9650b`
  (2026-09-27) `scripts/aukora/remember.mjs` staged through the WASM cell, was approved in the popup, settled at Aura
  sequence 7, exported, and cold-verified from an empty directory (`PUBLICATION: VERIFIED`). It has not been re-run
  on `25149f573`. Automatic notes grant no authority; Auma Live voice capture remains unverified.
- **The owner's root key can be searched offline.** It is derived with scrypt from a seven-word phrase and a
  public handle (`plugins/aukora-aumlok/lib/derive-v3.mjs`); the desktop's word lists give about 34 bits.
- **The voice companion's conversation leaves the machine.** Auma Live sends each turn to a remote model
  provider (OpenRouter) and keeps what is said without review (`REMOTE_PROVIDER_EGRESS`,
  `TRANSCRIPTS_UNGOVERNED`, in `plugins/aukora-face/apps/src/auma-live/`).
- **The WASM cell is a relay, not a sandbox.** It runs inside an ordinary Node process
  (`NODE-EMBEDDER-UNCONFINED`), and settlement bytes are identical with and without it, so no artefact shows
  that the cell ran in a past settlement.
- **Every verifier here is this project's own code.** Diamond, the receipt court and the membrane verifier
  run as separate processes, but no outside party has re-implemented them.
- **A fresh install does not yet mount Memory or bind an Aumlok phrase on its own.** The release's default
  composition carries Kira's placeholder subject `aumlok:subject:owner`, which Kira refuses at mount
  (`SUBJECT_INVALID`), and gives `aukora-aumlok` no controller directory (`aumlok:adapter-unbound`). Both are
  per-deployment values; `<release>/aukora-deployment-overlay.patch.yml` is the template that supplies them.

## AUKORA Genesis

AUKORA Genesis is a desktop AI application in which the software that proposes an action is not the authority
that permits it. It runs on a pinned copy of the **DeepSeek Harness** and its **Cordis** plugin loader
(`upstream-dsh.json`, built locally by `scripts/build-dsh.py`) and adds four organs as Cordis plugins:

- **Kira**, memory: a memory the owner approves is staged as a proposal through a pinned **WebAssembly cell**,
  settled once under his signed approval, and recalled with a citation. Automatic notes are a separate, unsigned
  tier that grants no authority.
- **Aumlok**, identity and approval: the owner's approval is a signature over the exact bytes of the action,
  made by a separate signer after a click in the app's approval popup.
- **Aura**, evidence: every settled record is appended to a hash-linked log, and a retained head lets a later
  reader tell an extended log from a rewritten one.
- **The composition gate**: a module the policy names loads only with a one-use grant bound to its bytes.

The evidence those organs leave can be checked **cold**, from an empty directory, by verifiers vendored and
byte-pinned in this tree: Diamond (`vendor/kira-export`), the receipt court (`vendor/receipt`) and the
membrane minimal verifier (`vendor/append-only`, byte-identical to `minimal/` in
`aukora-membrane` at `d8b17fac`).

Work happens on `main` of `aumara-xyz/aukora-genesis`. `aumara-xyz/aukora-genesis-archive` holds the history up to
2026-09-27, read-only and private (`ARCHIVE.md`); the commit hashes on this page are there.

## Get started

macOS with `python3`, Node.js 22.23 or newer, `pnpm` and `git`. From a clone of this repository:

```sh
python3 scripts/build-dsh.py        # downloads the DeepSeek Harness pinned by hash in upstream-dsh.json, builds it
python3 scripts/materialize-aukora-release.py --to ~/aukora-release-local
cd apps/aukora-desktop && npm ci && npm start
```

Then add your API key in **Models**, and link your Aumlok phrase in **Aumlok**. Do not run `build-face.py`
first: the face bundles are committed, and a rebuild elsewhere changes their bytes, so the materializer refuses.

## Reviewer packet

Read this first. Run the packet from the repository root of a fresh clone with `python3`, Node.js 22 and
`perl` (included on macOS): no keys, no network, no harness build, no running app. The 16 commands run in
parallel with a hard 55-second timeout per command, including its subprocesses. It prints one line per command,
in the order below: PASS or FAIL, the seconds, the command and its last nonblank output line; then a `TOTAL` line
with the time and the count passed. On a fresh clone of `main` at `25149f573`, on 2026-09-28, it ended
`TOTAL 6.06s | 16/16 passed`. Any failure or timeout makes the packet exit nonzero, and the `TOTAL` line then
names the temporary directory that keeps the full logs.

PASS means the command exited zero. The table names the output to find in each check, which need not be
its last line. `docs/CLAIMS.md` gives the original 13 checks with what their output proves, what it does
**not** prove, and the date each last passed. The two additional rows run the vendored membrane tour and
kernel conformance check; neither measures the installed app.

Hard questions, answered with file and line: [docs/HARD-QUESTIONS.md](docs/HARD-QUESTIONS.md)

```sh
sh scripts/check.sh
```

| # | Check | Output to look for | What it shows |
| --- | --- | --- | --- |
| 1 | Membrane self-test | `SELFTEST: 4/4 checks passed` | Append-only, an earned accusation and the blind spot on four built-in vectors. |
| 2 | Vendor pins | `PINS OK: every vendored byte matches its upstream manifest` | Bytes in the three registered verifier trees match their manifests; this does not check every vendor or the harness. |
| 3 | WASM proposal cell | `rowsComplete=true expected=13 observed=13` | Exact, canonical proposal bytes and refusal of nine kinds of bad input or bad module; the Node embedder remains unconfined. |
| 4 | Diamond cold consumer | `ALL ARMS PASSED` | A disposable Kira export verifies from an empty directory; tampered members and a small-order-key forgery are refused. |
| 5 | Public evidence | `ALL CONTROLS PASSED` | Only allowlisted fields are exported; tampered, extra, private-key-shaped and unlisted files are refused. Hashes, not signatures, are checked here. |
| 6 | Receipt v3 | `RECEIPT V3 STRANGER TEST: all checks passed` | A receipt and public key reach the cold court's verdict from an empty directory; a wrong key is refused first. |
| 7 | Aumlok approval verifier | `AUMLOK VERIFY APPROVAL: GREEN` | Approval bytes verify under the public key alone; forged or wrong keys, extra fields and preimage mismatches are refused. |
| 8 | Approval round trip | `PASS — 13/13 arms` | Exact bytes round-trip through the shipped producer and desktop signer under the listed machine key; a scratch socket, no window, click or person. |
| 9 | Aumlok cold root | `AUMLOK COLD ROOT: GREEN` | Only a machine key is kept in disposable custody; the root is re-derived from the handle and words. |
| 10 | Required grant | `AUMLOK GATE REQUIRE GRANT: GREEN` | The gate fails closed for an unusable required grant; this check exercises the one-use grant for `hello-governed`. |
| 11 | Control admission | `# pass 7` and `# fail 0` | A stale control head refuses settlement and leaves the store unchanged; rotation state is modeled, no rotation event is performed. |
| 12 | Restore scope | `AUMLOK RESTORE SCOPE: GREEN` | An external witness keeps a spent approval spent across a restore; without it, the restore un-spends the approval. This measures a gap. |
| 13 | Consolidation | `kira-consolidate: ok` | Three agents repeating one false report create no evidence and no authority, and cannot undo a person's decision. |
| 14 | Membrane guided tour | Guided tour verdicts and published-case scoreboard | Runs append-only, an honest decline, an earned accusation and the blind spot; 12 published cases. Teaching output, not an assertion suite. |
| 15 | Kernel conformance | `KERNEL CONFORMANCE: 37/37 passed` | Source, generated code, dependency and vector pins hold; 37 upstream reducer, Merkle, hybrid-authority, downgrade, encoding, evidence and staleness cases pass. |

What they show, in one line each:

- **The membrane verifier** decides append-only, an earned accusation and its own blind spot on its built-in
  vectors. Its guided tour runs in full from the vendored membrane tree: `python3 vendor/aukora-membrane/minimal/tour.py` (append-only, an honest decline, an earned accusation, the blind spot; 12 published cases).
- **The WASM cell** produces exact, canonical proposal bytes and refuses nine kinds of bad input or bad module.
- **Diamond** verifies a real Kira export from a literally empty directory, and refuses a flipped byte in the
  receipt, the record, the Aura log or the object by name, plus a small-order-key forgery.
- **Aumlok** approvals verify from their bytes and the public key alone; the root key is re-derived from the
  phrase while only a machine key sits on disk; the desktop signer's approval round-trips over exact bytes.
- **The gate** fails closed when a grant is required and unusable.
- **One-use authority** survives a restore only when a witness outside the restored directory recorded the
  spend. This check measures the gap: without the witness, a restore un-spends an approval.
- **Consolidation**: three agents repeating one false report create no evidence and no authority.

Every check uses disposable state and test keys; none of them measures the owner's installed app.

**What only the installed app shows.** These need the running app, and the first three need the owner's click,
so they are `LIVE-ONLY` in `docs/CLAIMS.md` and never counted as passing here:

- `node scripts/aukora/remember.mjs "<text>"` — Kira stages the text through the WASM cell, the app's Aumlok
  signer shows the exact bytes, and on Approve Kira settles once, Aura chains it, the public evidence is
  exported and Diamond verifies it cold. Refuse writes nothing. It ran end to end once, on 2026-09-27 (Kira Aura
  sequence 5, on an earlier release); this release is not verified end to end here (see What is not enforced).
- `node scripts/aukora/self-change.mjs "<why>" <paths>` — the full diff is shown in the popup (bounded by the
  installed card limit; no deletions, binaries, symlinks or executables), the original governedCrossing binds the proposal to
  the bytes re-read from disk, the returned signature is verified against the pinned key and spent once by the
  kernel, the original localCandidateStage materializes exactly the approved tree, and only then is it committed,
  chained in Aura and pushed to `origin`'s `main`. This version has not run with a real approval; the one
  live self-change (`97714048a`, code Aura entry 1) used the version before it.
- `node scripts/aukora/advance.mjs "<why>" <remote> <commit> [--snapshot]` — moves a remote's `main`;
  `--snapshot` publishes the tree of a commit as one new commit, with none of its history. The popup shows the
  repository, main now, main after, the tree and the commits added; the approval is verified against the pinned key,
  consumed once by the kernel (`scripts/aukora/decide.mjs`), chained in Aura, and the push is leased on the main
  that was shown. It moved `aumara-xyz/aukora-genesis` `main` twice on 2026-09-27 (code Aura entries 2-5).
- **The action gate** (`plugins/aukora-action-gate`, mounted by `overlays/action-gate.patch.yml`) judges every
  tool call an agent session makes in the app and chains each decision in `state/home/aura-actions/aura.jsonl`
  before the call runs. It refuses a write or edit tool call on governing code (naming `self-change.mjs` as the
  route), key material, pushes to main, publishing and hosts off its allowlist. It reads shell commands as text
  only: literal write targets are judged, while a script or variable can hide a target from this check.
  It does not judge every tool the Codex and Claude Code subagents run. Seatbelt confines BUILD and read-only
  shells; it does not confine Auma's `danger-full-access` sessions.

## How it runs

```
apps/aukora-desktop        Electron shell: starts the supervisor, hosts the approval popup and the signer
  └─ scripts/launch-dsh.py     run from a pinned checkout of this repo on every launch
       └─ <release>/           materialized by scripts/materialize-aukora-release.py
            ├─ DeepSeek Harness + Cordis (pinned, stripped: scripts/release-strip.mjs)
            ├─ plugins/aukora-face-*     the nine faces, built by scripts/build-face.py
            ├─ plugins/aukora-kira       memory, with lib/wasm-cell
            ├─ plugins/aukora-aumlok     identity and approval
            ├─ plugins/aukora-action-gate, aukora-composition-gate, aukora-foundation, aukora-board, aukora-eye, …
            └─ scripts/{aura,kira,composition,phase0} and vendor/{kira-export,receipt,append-only,
               authority,aukora-packages,seed}
```

A release is cut with `scripts/aukora/cut-release.sh` and switched in with
`scripts/aukora/desktop-cutover.mjs prepare|apply|rollback`. The materializer refuses a dirty tree, and
`scripts/artifacts-coverage.json` declares what the release's artifact record covers; `scripts/genesis-check.mjs`
checks it at every launch.

## Build it

macOS, `python3`, Node.js 22 and `pnpm`. The harness build downloads the pinned archive (network, several
minutes, about 1.8 GB):

```bash
scripts/install-mac.sh --dry-run    # walk every check and step, build nothing
scripts/install-mac.sh              # build the harness, materialize a release, package the app
```

`install-mac.sh` runs `scripts/build-dsh.py`, `scripts/build-face.py` (skipped while the committed bundles are
present), `scripts/materialize-aukora-release.py --to ~/aukora-release-<commit>` and the desktop `npm ci && npm run
dist` in that order. `scripts/aukora/cut-release.sh` is the owner's cutover path: it needs `--support` and
`--home-session` and refuses without them. The full `install-mac.sh` run has not been measured end to end.

## Where things are

| Organ | Code | Cold check |
| --- | --- | --- |
| Kira memory | `plugins/aukora-kira/`, `scripts/kira/` | `scripts/kira/verify-public-evidence.py` + `vendor/kira-export` |
| Aumlok approval | `plugins/aukora-aumlok/`, `scripts/aumlok/`, `apps/aukora-desktop/aumlok-signer.mjs` | `scripts/aumlok/verify-approval` |
| Aura evidence | `scripts/aura/`, `scripts/phase0/` | `vendor/append-only/verify.py` |
| Composition gate | `plugins/aukora-composition-gate/`, `scripts/composition/` | `scripts/receipt-verify` + `vendor/receipt` |
| Desktop shell | `apps/aukora-desktop/` | — |
| Faces | `plugins/aukora-face/` | — |
| Release path | `scripts/materialize-aukora-release.py`, `scripts/aukora/`, `scripts/launch-dsh.py` | `scripts/genesis-check.mjs` |

Further reading: `SECURITY.md` (scope and every printed ceiling, organ by organ), `docs/CLAIMS.md` (claims,
ceilings and what is not claimed), `AGENTS.md` (rules for agents working in this tree) and `ARCHIVE.md`
(what was removed on 2026-09-27 and where it still lives).

## License

Copyright (c) 2026 Aumara and Peter Viviani.

AUKORA-authored code in this repository is licensed under the
[GNU Affero General Public License, version 3 or later](LICENSE)
(`AGPL-3.0-or-later`), except where a file or component states otherwise.

Third-party components retain their own licenses and copyright notices.
The pinned DSH host retains its upstream MIT license; vendored components
retain the notices shipped beside their source, including
[`vendor/append-only/LICENSE`](vendor/append-only/LICENSE),
[`vendor/receipt/LICENSE`](vendor/receipt/LICENSE), and the
[noble cryptography notices](plugins/aukora-aumlok/lib/vendor/noble-ml-dsa/licenses/).
