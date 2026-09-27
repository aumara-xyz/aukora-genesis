# AUKORA Genesis

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
byte-pinned in this tree: Diamond (`vendor/diamond-cold`), the receipt court (`vendor/receipt-v3`) and the
membrane minimal verifier (`vendor/phase0-consistency`, byte-identical to `minimal/` in
[aukora-membrane](https://github.com/aumara-xyz/aukora-membrane) at `d8b17fac`).

Work happens on `main` of `aumara-xyz/aukora-genesis`. `aumara-xyz/aukora-genesis-archive` holds the history up to
2026-09-27, read-only and private (`ARCHIVE.md`); the commit hashes on this page are there.

## Genesis / A37 parity

Genesis is the lab; AUKORA-37 is the simplified public build of the same architecture.
The shared sequence is `aukora_self_change` → exact-byte owner card → one-use
consume → chained change → `become`. That last step means restart into the
approved application, observe readiness, and roll back on failure; tool registration
alone does not earn the name. Automatic memory informs this loop and never authorizes it.

This table records source parity against Genesis `96cb4cec` and A37 `394fa63b`
plus the card-display change accompanying this table. It is not a fresh measurement
of either installed application. **NEXT** names a port still required.

| Feature | Genesis | A37 | Status |
| --- | --- | --- | --- |
| Kira / automatic memory | Automatic remembered tier; explicit signed-memory path remains separate. | Automatic local capture and recall; bounded retries preserve failed bytes while the process lives. | No approval for ordinary memory; implementations and failure policies differ. |
| Viking retrieval | Owner deployment uses `aukora/owner`; automatic Kira-to-Viking loop still needs a live proof. | Defaults to `aukora37/owner`; another destination requires explicit owner confirmation. | Separate namespaces; delivery acknowledgment is not extraction or recall proof. |
| Aumlok authorization | Software machine key; root re-derived for root acts. | Phrase unlock creates a temporary software signing session; new homes retain public identity, with legacy seed cleanup explicit. | Same role, distinct custody; the host UID remains trusted and human attendance unestablished. |
| `aukora_self_change` | Candidate tree → approval → one-use consume → commit and Aura chain. | Python capability → approval → one-use consume → immutable version and receipt chain. | Same law, different bounded effects and versioned formats. |
| Owner card | Derived code-change display; exact approved bytes. | Plain headline from checked bound card; proposer reason labeled as a claim; original exact bytes below. | Summary never substitutes for the signed bytes or proves code safety. |
| `become` | Release admission, restart, observed readiness, best-effort rollback and body record in source. | Capability activation exists; full application restart, rollback and chained body transition not ported. | **NEXT A37:** supervised release transition; do not expand a tool grant into engine authority. |
| Unknown tools / decision log | Tool-name policies and durable decision logging in the app; host and subagent routes are outside full mediation. | Exact trusted tool definitions; durable guard record before allowed dispatch; failed guard mount blocks startup. | Same requirement, unequal coverage; neither governs every host action. |
| Coding tools | Host path/command policy. | Container workspace tools with no network and an explicitly pinned local image. | **NEXT Genesis:** container execution; host and Docker daemon remain trusted. |
| Engine pin / interrupted install | Plugin-set admission and release recovery. | Operator-admitted engine digest; interrupted install reconciles without renewing spent permission. | **NEXT Genesis:** distill these bindings; mechanisms are not interchangeable. |
| Shared vectors | v1 contract checks prepared in the shared-contract worktree, not yet on this inspected main. | Byte-identical v1 vectors and court-23(e) run native verifiers; unsupported profiles remain explicit. | Shared fixture SHA-256: `82c12697e79dc70de4f7d2f5971710c5063788ddee0cb83af0e492873d8abb3d`; no blanket format compatibility. |

Update this table in both READMEs when a feature lands. Change shared formats in
the vectors first, run each implementation against them, and keep named profiles
distinct. Genesis mechanisms move to A37 after live verification; A37 hardening
moves back without importing its UI or replacing Genesis's authority semantics.

## Limits first

These are true today, and the rest of this page should be read through them.

- **One user account holds everything.** The app, the agent and the approval key run as the same macOS user
  (`SAME_UID`, `OWNER_KEY_SAME_UID`). The checks here are procedures over bytes, not an isolation boundary.
  The two-principal owner cut is built (`scripts/owner/`, `plugins/aukora-owner-daemon/`) and not installed.
- **A signature is not a person.** The approval key is a software key on this Mac. A click is recorded, but
  nothing binds it to a human (`ATTENDANCE: reported-not-proven`).
- **The approval routes are supported, not enforced.** `scripts/aukora/self-change.mjs` (code) and
  `scripts/aukora/advance.mjs` (a remote's `main`) show a change in full, get it signed and verify the signature
  before they write, but the agent has the owner's git credentials, and nothing on this machine or on GitHub stops a
  direct push. On 2026-09-27 self-change carried one code change (`97714048a`) and every other change landed
  directly; advance carried both snapshot moves of `aumara-xyz/aukora-genesis` `main`.
- **The action gate is an in-process check, not isolation.** It judges every tool call in the app's agent
  sessions, but it refuses a write to governing code only in a write or edit tool call: a shell command that writes
  the same paths (`sed -i`, a redirect, `cp`, `mv`) is not refused. It reads a shell command as text, so a script
  the agent writes and then runs is not seen. Unknown and MCP tools are allowed, with any paths in their arguments
  judged as reads. The harness's `tool-cordis` tools, mounted in the app, run model-written code inside the backend
  process; the gate sees the call, not the code. The Codex and Claude Code subagents and anything else running as
  the owner are not governed by it.
- **AUKORA's Seatbelt denies are not live.** `plugins/aukora-seatbelt`, which adds kernel denies to agent shell
  commands through `overlays/seatbelt.patch.yml`, is on `main`, but the running release neither carries nor mounts it.
- **The stock apps share the desktop's origin.** Since 2026-09-27 their frames are `allow-scripts allow-same-origin`
  (`plugins/aukora-face/apps/src/client/EmbeddedAppSurface.tsx:115`), so the null-origin sandbox is off: a vendored
  app runs with the desktop page's origin, and its requests no longer carry the `Origin: null` the app's routes refuse.
- **The composition gate governs the AUKORA plugins by a same-uid record.** A release records every file of each
  AUKORA plugin its patches mount (`policy.json` `pluginSet`), the owner approves that set in one Aumlok popup, and the gate refuses a changed or
  unrecorded plugin file at import. Upstream's stock plugins and `node_modules` load ungoverned
  (`STOCK_PLUGINS_NOT_YET_UNDER_POLICY`), and the record, the approval and the pinned approver are files the
  owner's uid can rewrite (`plugins/aukora-composition-gate/GOVERNED.md`). This is on `main`; the release the owner runs today predates it and governs only `hello-governed`.
- **CORE's two code-running subagents are on.** `presets/core/agent.cordis.yml` enables Codex and Claude Code
  as subagent tools; they run as the owner's user.
- **Releases were switched in with no owner approval.** Until the plugin-set approval, `scripts/aukora/desktop-cutover.mjs
  apply` appended the release's record digest to `approvedRecordSha` itself, unsigned. On `main` it now refuses a
  release whose plugin set the owner has not approved in the popup. The shipped template sets `allowUnapproved: false`
  (`apps/aukora-desktop/resolve.mjs`); `true` in `config.json` waives both.
- **Memory does not work end to end in the running release.** In release `c7de4279c` the export step of
  `scripts/aukora/remember.mjs` fails: `scripts/kira/public-evidence.mjs` imports `apps/aukora-desktop/card-chain.mjs`,
  which the release does not carry, so a record settles and is chained but is not exported or cold-verified.
  Automatic memory is not verified live: on 2026-09-27 the live remembered store was empty.
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
`perl` (included on macOS): no keys, no network, no harness build, no running app. The 15 commands run in
parallel with a hard 55-second timeout per command, including its subprocesses. It prints one line per command,
in the order below: PASS or FAIL, the seconds, the command and its last nonblank output line; then a `TOTAL` line
with the time and the count passed. On the owner's Mac on 2026-09-27, at `1c569f8aa`, it ended
`TOTAL 6.02s | 15/15 passed`. Any failure or timeout makes the packet exit nonzero, and the `TOTAL` line then
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
| 10 | Required grant | `AUMLOK GATE REQUIRE GRANT: GREEN` | The gate fails closed for an unusable required grant; its policy still governs only `hello-governed`. |
| 11 | Control admission | `# pass 7` and `# fail 0` | A stale control head refuses settlement and leaves the store unchanged; rotation state is modeled, no rotation event is performed. |
| 12 | Restore scope | `AUMLOK RESTORE SCOPE: GREEN` | An external witness keeps a spent approval spent across a restore; without it, the restore un-spends the approval. This measures a gap. |
| 13 | Consolidation | `kira-consolidate: ok` | Three agents repeating one false report create no evidence and no authority, and cannot undo a person's decision. |
| 14 | Membrane guided tour | Guided tour verdicts and published-case scoreboard | Runs append-only, an honest decline, an earned accusation and the blind spot; 12 published cases. Teaching output, not an assertion suite. |
| 15 | Kernel conformance | `KERNEL CONFORMANCE: 37/37 passed` | Source, generated code, dependency and vector pins hold; 37 upstream reducer, Merkle, hybrid-authority, downgrade, encoding, evidence and staleness cases pass. |

What they show, in one line each:

- **The membrane verifier** decides append-only, an earned accusation and its own blind spot on its built-in
  vectors. Its guided tour runs in full from the vendored membrane tree: `cd vendor/aukora-membrane && python3
  minimal/tour.py` (append-only, an honest decline, an earned accusation, the blind spot; 12 published cases).
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
  sequence 5, on an earlier release); in the running release its export step fails (see Limits first).
- `node scripts/aukora/self-change.mjs "<why>" <paths>` — the full diff is shown in the popup (at most 1,650
  characters; no deletions, binaries, symlinks or executables), the original governedCrossing binds the proposal to
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
  only: a shell command that writes governing code is not refused, and a script the agent writes and runs is not
  seen; it does not govern the Codex and Claude Code subagents, which run their own tools.

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
            └─ scripts/{aura,kira,composition,phase0} and vendor/{diamond-cold,receipt-v3,phase0-consistency,
               aukora-kernel,aukora-packages,aukora-seed-guard}
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
| Kira memory | `plugins/aukora-kira/`, `scripts/kira/` | `scripts/kira/verify-public-evidence.py` + `vendor/diamond-cold` |
| Aumlok approval | `plugins/aukora-aumlok/`, `scripts/aumlok/`, `apps/aukora-desktop/aumlok-signer.mjs` | `scripts/aumlok/verify-approval` |
| Aura evidence | `scripts/aura/`, `scripts/phase0/` | `vendor/phase0-consistency/verify.py` |
| Composition gate | `plugins/aukora-composition-gate/`, `scripts/composition/` | `scripts/receipt-verify` + `vendor/receipt-v3` |
| Desktop shell | `apps/aukora-desktop/` | — |
| Faces | `plugins/aukora-face/` | — |
| Release path | `scripts/materialize-aukora-release.py`, `scripts/aukora/`, `scripts/launch-dsh.py` | `scripts/genesis-check.mjs` |

Further reading: `SECURITY.md` (scope and every printed ceiling, organ by organ), `docs/CLAIMS.md` (claims,
ceilings and what is not claimed), `docs/AUKORA-GOLDEN-BOUNDARY.md` (the research position; a paper, not a
deployment or safety certification), `AGENTS.md` (rules for agents working in this tree) and `ARCHIVE.md`
(what was removed on 2026-09-27 and where it still lives).

## License

Copyright (c) 2026 Aumara and Peter Viviani.

AUKORA-authored code in this repository is licensed under the
[GNU Affero General Public License, version 3 or later](LICENSE)
(`AGPL-3.0-or-later`), except where a file or component states otherwise.

Third-party components retain their own licenses and copyright notices.
The pinned DSH host retains its upstream MIT license; vendored components
retain the notices shipped beside their source, including
[`vendor/phase0-consistency/LICENSE`](vendor/phase0-consistency/LICENSE),
[`vendor/receipt-v3/LICENSE`](vendor/receipt-v3/LICENSE), and the
[noble cryptography notices](plugins/aukora-aumlok/lib/vendor/noble-ml-dsa/licenses/).
