![AUKORA — Human first. AI next.](docs/assets/aukora-human-first.png)

# AUKORA Genesis

AUKORA Genesis is a desktop AI where the software that proposes an action is not the authority that permits it.
On its governed approval paths, the owner approves exact bytes through Airlock, which holds the owner's approval key
in a separate macOS account the agent cannot read; a kernel decides; every governed decision is receipted and can be checked cold, from an empty directory.

## What is not enforced

- **The app and agent share a macOS UID.** The Airlock keeps the software approval key in a separate account,
  but its socket accepts signature requests from any process of the app's UID.
- **Attendance is reported, not proven.** A recorded click and a signature do not establish that a person approved.
- **The phrase-derived root has about 34 bits.** Its seven-word phrase and public handle permit offline guessing.
- **Embedded app frames share the desktop origin.** The null-origin sandbox is off.
- **The live agent runs on the host.** Deep's box, guest launcher, broker and issuer are in the tree, but are not
  wired to the live agent. Full-access sessions remain unconfined by Seatbelt.
- **Nothing on GitHub requires the approval routes.** The macOS user holds push credentials; a direct push to
  `main` is not stopped. The app's action gate is an in-process check, not isolation.
- **Care grants no authority. Auma, the app's assistant, is not an authorizer.**
- **Our own break corpus: 17 breaches, 11 open when frozen (2026-08-21), not re-measured on this tree.** [docs/BREAK-CORPUS.md](docs/BREAK-CORPUS.md)

[Further limits and recorded evidence](#further-limits-and-recorded-evidence) below bound these claims.

## The combination

A model may propose an act. On the governed path, permission is a signature
over the exact bytes of that act, from a key the model does not hold.
That permission is spent once, using a nonce and a spent set. Then the act may run.

The primitives have separate jobs:

- **Ed25519:** a stamp on exact bytes.
- **One-use nonce:** that stamp cannot be replayed at an executor enforcing the spent set.
- **Hash chain + retained head:** a later reader can tell “log grew” from
  “log was rewritten,” within the history covered by a separately trusted retained head.
- **Cold verifier:** a small program that is not the agent, run from an empty
  directory with separately supplied trust anchors, to accept or refuse that bundle.

This is not a new curve, a coin, or a world ledger.
These are the same kinds of tools used in signed updates and transparency logs.

A reason to use a chain is to let two parties who do not trust each other
check an act without trusting one operator’s database.
Here the acting program is supposed to carry the evidence with the act:
exact bytes, a signature, a record of one-use consumption, and a new page in the log.
The other party, or a stranger, runs the cold verifier. Checking is local;
there is no global book. The bundle records consumption; it cannot by itself
prove that no second execution happened elsewhere or after a spent-store rollback.

This could replace the need for a blockchain for the narrower questions
“was this act authorized?” and “was this covered history rewritten?”, under
those trust and retention assumptions. It does not replace global agreement
about one scarce thing, such as who can spend the same asset across the world.

Today, this repo contains code for exact-byte approval, one-use consumption,
governed effects, chained receipts, public export and standalone verification.
Those components do not establish that every live action passes through them.
The limits in **What is not enforced** above apply: the live agent is still
on the host, and the box is not wired to that agent. This describes the
combination and its intended boundary, not complete live containment.

## Try it

On macOS with Python 3, Node.js 22 or newer, Perl and `/usr/bin/cc` (Xcode Command Line Tools):

```sh
git clone https://github.com/aumara-xyz/aukora-genesis && cd aukora-genesis && sh scripts/check.sh
```

Expected final line (elapsed time and check counts depend on this checkout):

```text
TOTAL <elapsed>s | <passed>/<run> passed
```

[CI](.github/workflows/check.yml) runs the same checks on every push. They check disposable repository fixtures,
not the installed app; see the [reviewer packet](#reviewer-packet) for scope and skipped-check caveats.
When checks are skipped, the final line also reports their count; read the explicit `SKIP` rows for their scope.

## Read

- [AUKORA Golden Boundary — Rev 2.3 front](docs/AUKORA-GOLDEN-BOUNDARY.md)
- [Claims and their limits](docs/CLAIMS.md)
- [Hard questions](docs/HARD-QUESTIONS.md)
- [Running AUKORA on your Mac](docs/RUNNING.md)
- [Care Without Control](docs/CARE-WITHOUT-CONTROL.md) — a speculative design note

## License

[AGPL-3.0-or-later](LICENSE). Copyright (c) 2026 Aumara and Peter Viviani (the named owner).
Third-party components retain their own licenses and notices.

---

## Further limits and recorded evidence

Peter's operator record on 2026-10-01 names `b7b8d841c431a8800f6d1929fe53b81a6388a7b2` as the installed deployment's source.
The installed results quoted here are operator records, not independent live verification of this checkout;
source inspection and disposable checks do not verify the installed app.

- **Airlock custody is deployment-specific.** In the recorded owner deployment, the key was held by the separate
  macOS account `aukora-owner`. On 2026-09-28, `scripts/aukora/airlock-probe.mjs` reported
  `VERIFIED EACCES: configured key path cannot be opened by UID 501`. The first recorded Airlock approval moved
  `main` to `f87b72b68`, signed by `did:key:z6MkiP8BnvVRZJcxtv9TShdq3KUGc7wF1skbZBJbQ96jAtCm`.
  This names a software key, not a proven person. Without Airlock configuration, the signer retains its legacy
  local-key path; a malformed configuration refuses fallback.
- **Deep's box is source, not the live agent's boundary.** The guest launcher, broker and issuer were carried
  byte for byte into `plugins/aukora-box/`, with hashes in its `PROVENANCE.md`. The recorded confinement check
  accepted the generated policy and refused an unrestricted policy; neither result puts the live agent in a guest.
- **The action gate only covers calls it sees.** It refuses write/edit tools on governing code and shell writes
  with visible targets (`sed -i`, redirects, `cp`, `mv`, literal paths in `python3 -c`). Scripts or variables can
  hide targets. It sees a subagent launch, not every child tool; same-UID processes outside the app are outside it.
  Each judged call uses the kernel's `decide()`, without a one-use grant; one-use applies to self-change and
  MOVE MAIN. On `25149f573`, the recorded full-access `sed -i` attempt on `plugins/aukora-kira/` was refused with
  `rule: authority:governing-code`, `kernelCode: sacred_target`, file untouched (2026-09-27T23:53:16Z).
- **Agent process launchers require native confinement in source.** Launchers require read-only or workspace-write
  policy; full-access/auto cannot bypass that requirement. This does not confine the backend or its plugins.
  CORE's native Codex and Claude Code SDK delegation tools are disabled, and their host provider startup paths
  also refuse `AUKORA_NATIVE_CONFINEMENT_UNWIRED` until the SDK launch closures enforce native confinement.
- **Composition approval rests on same-UID files.** The policy records the AUKORA plugin files mounted by a
  release and checks their approved bytes at import. Stock plugins and `node_modules` remain ungoverned
  (`STOCK_PLUGINS_NOT_YET_UNDER_POLICY`). The record, approval and pinned approver are all writable by the
  owner's UID. See `plugins/aukora-composition-gate/GOVERNED.md`.
- **Release approval has waivers.** Earlier cutovers appended the record digest to `approvedRecordSha` unsigned.
  The current cutover refuses an unapproved plugin set, and the resolver template sets `allowUnapproved: false`.
  Setting it to `true` waives the plugin-set and record approvals; a first-run waiver also applies when no
  installed plugin-set approval exists and the approved-record list is empty (`apps/aukora-desktop/resolve.mjs`).
- **Signed memory's live evidence is from an earlier release.** On `76bb9650b` (2026-09-27), `remember.mjs`
  staged through the WASM cell, settled after popup approval at Aura sequence 7, exported, and verified cold
  (`PUBLICATION: VERIFIED`). It was not re-run on the later recorded release `25149f573`. Automatic notes grant
  no authority; Auma Live voice capture remains unverified.
- **Voice conversations leave the machine.** Auma Live sends each turn to OpenRouter and retains transcripts
  without review (`REMOTE_PROVIDER_EGRESS`, `TRANSCRIPTS_UNGOVERNED`).
- **The WASM cell is a relay, not a sandbox.** Its Node embedder is unconfined. Settlement bytes are identical
  with and without it, so no artifact proves the cell ran in a past settlement.
- **All verifiers are this project's code.** Diamond, the receipt court and the membrane verifier run as separate
  processes; no outside party has re-implemented them.
- **Fresh installs need deployment bindings.** Default Kira subject `aumlok:subject:owner` is refused at mount
  (`SUBJECT_INVALID`), and Aumlok has no controller directory (`aumlok:adapter-unbound`). The release's
  `aukora-deployment-overlay.patch.yml` supplies these per-deployment values; mounting Memory and binding the
  phrase are not automatic.

## Components

The desktop uses a pinned copy of the **DeepSeek Harness** and its **Cordis** plugin loader
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

Work happens on `main` of `aumara-xyz/aukora-genesis`. Earlier history is held in a private archive;
no private repository is needed for the checks above. See [CONTRIBUTING.md](CONTRIBUTING.md) to propose a change.

## Run the desktop

macOS with `python3`, Node.js 22.23 or newer, `pnpm` and `git`. From a clone of this repository:

```sh
python3 scripts/build-dsh.py        # downloads the DeepSeek Harness pinned by hash in upstream-dsh.json, builds it
python3 scripts/materialize-aukora-release.py --to ../aukora-release-local
cd apps/aukora-desktop && npm ci && npm start
```

This build path is not verified end to end here. The deployment bindings described above are required;
adding an API key in **Models** and linking a phrase in **Aumlok** alone do not establish a working fresh install.
Do not run `build-face.py` first: the face bundles are committed, and a rebuild elsewhere changes their bytes,
so the materializer refuses.

## Reviewer packet

Run `sh scripts/check.sh` from the repository root with the prerequisites above. No keys, network, harness build
or running app are needed. The commands registered in this checkout run in parallel, with a 55-second timeout per command including its
subprocesses. Each row prints PASS or FAIL, elapsed time, the command and its last nonblank output line. Any
failure or timeout makes the packet exit nonzero; the final `TOTAL` line then names the retained log directory.
Elapsed time varies with the machine and contention; the TrustedStateStore check waits out a bounded 15-second lock.

PASS means exit zero, not a live-app measurement. In particular, the box check exits zero with `SKIPPED` off
macOS or `NOT RUN (nested sandbox)` when sandbox admission is unavailable. Read its row, not only the TOTAL.
[CLAIMS](docs/CLAIMS.md) describes the original 13 checks, their limits and dated results; the table below also
includes the TrustedStateStore, Airlock, four-history witness, membrane tour, kernel and box checks now in the runner,
in `check.sh` order.

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
| 9 | TrustedStateStore | `TRUSTED STATE: restore protection verified in scratch; installed app not verified` | A consumed approval stays spent across a restored-away store: the external high-water witness refuses the rollback; six parallel decides give one ALLOW and five replay refusals. Removing the high-water comparison makes the restore arm ALLOW and its refusal assertion fail. The same UID can rewrite state and witness. Every write stays in scratch; the installed app is not verified. |
| 10 | Airlock custody switch | `VERIFIED wrong kernel peer UID, bad signature, and wrong public-key pin refused` | Exact bytes reach a scratch signer without a local seed; wrong UID, signature and pin are refused. The stand-in shares the test UID: separate-account custody and EACCES remain live-only. |
| 11 | Aumlok cold root | `AUMLOK COLD ROOT: GREEN` | Only a machine key is kept in disposable custody; the root is re-derived from the handle and words. |
| 12 | Required grant | `AUMLOK GATE REQUIRE GRANT: GREEN` | The gate fails closed for an unusable required grant; this check exercises the one-use grant for `hello-governed`. |
| 13 | Control admission | `# pass 7` and `# fail 0` | A stale control head refuses settlement and leaves the store unchanged; rotation state is modeled, no rotation event is performed. |
| 14 | Restore scope | `AUMLOK RESTORE SCOPE: GREEN` | An external witness keeps a spent approval spent across a restore; without it, the restore un-spends the approval. This measures a gap. |
| 15 | Four-history witness | `PASS four-history witness check (<elapsed>s; scratch only)` | The four become histories (code, actions, memory and remembered notes) grow `APPEND_ONLY`; a rewritten memory chain, unavailable verifier, truncation and the power-of-two blind spot refuse. A refusal after the switch restores the old release. Removing the conflict check or first-refusal rollback makes those arms fail. Scratch only. |
| 16 | Consolidation | `kira-consolidate: ok` | Three agents repeating one false report create no evidence and no authority, and cannot undo a person's decision. |
| 17 | Membrane guided tour | Guided tour verdicts and published-case scoreboard | Runs append-only, an honest decline, an earned accusation and the blind spot; 12 published cases. Teaching output, not an assertion suite. |
| 18 | Kernel conformance | `KERNEL CONFORMANCE: 37/37 passed` | Source, generated code, dependency and vector pins hold; 37 upstream reducer, Merkle, hybrid-authority, downgrade, encoding, evidence and staleness cases pass. |
| 19 | Box confinement | `BOX CONFINEMENT CHECK: GREEN` | Generated policy passes; unrestricted policy is refused with `confined:enforcement-unavailable`. Disposable guest probes only; may instead report SKIPPED or NOT RUN as described above. |

Every check uses disposable state and test keys; none of them measures the owner's installed app.

**What requires installed-app verification.** The following source paths are not verified live by this packet.
The first three require popup approval; attendance is reported, not proven. Earlier recorded results below are
historical evidence, not results for this checkout:

- `node scripts/aukora/remember.mjs "<text>"` — Kira stages the text through the WASM cell, the app's Aumlok
  signer shows the exact bytes, and on Approve Kira settles once, Aura chains it, the public evidence is
  exported and Diamond verifies it cold. Refuse writes nothing. The earlier recorded result is described above;
  this checkout is not verified end to end in the installed app here.
- `node scripts/aukora/self-change.mjs "<why>" <paths>` — the full diff is shown in the popup (bounded by the
  installed card limit; no deletions, binaries, symlinks or executables), the original governedCrossing binds the proposal to
  the bytes re-read from disk, the returned signature is verified against the pinned key and spent once by the
  kernel, the original localCandidateStage materializes exactly the approved tree, and only then is it committed,
  chained in Aura and pushed to `origin`'s `main`. This checkout's path is not verified live here; an earlier
  recorded self-change (`97714048a`, code Aura entry 1) used an earlier version.
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
  It does not judge same-UID processes outside the app. Source agent process launchers require native confinement
  and refuse full-access/auto policy; the unwired native SDK subagent providers refuse startup, and CORE does
  not advertise their delegation tools.

## How it runs

Source map at `aeb631a1b`; this is not an installed-app verification:

```
apps/aukora-desktop/main.mjs   Electron shell: approval popup and signer; starts supervisor.mjs
  └─ apps/aukora-desktop/supervisor.mjs
     └─ scripts/launch-dsh.py  run from a pinned checkout of this repo on every launch
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
present), `scripts/materialize-aukora-release.py --to <release-directory>` and the desktop `npm ci && npm run
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

## Third-party licenses

AUKORA-authored code uses AGPL-3.0-or-later, except where a file or component states otherwise.
The pinned DSH host retains its upstream MIT license; vendored components
retain the notices shipped beside their source, including
[`vendor/append-only/LICENSE`](vendor/append-only/LICENSE),
[`vendor/receipt/LICENSE`](vendor/receipt/LICENSE), and the
[noble cryptography notices](plugins/aukora-aumlok/lib/vendor/noble-ml-dsa/licenses/).
