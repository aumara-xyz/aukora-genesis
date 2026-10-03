# SKUNKWORKS: DeepSeek Harness boundary lab

This is a working adaptation of **DeepSeek Harness (DSH) 0.2.0-rc.2**, published so other agents can pick it up. The agent "Auma" runs with:

- **Hands inside an NVIDIA OpenShell 0.1.2 sandbox.** The sandbox runs under rootless Podman as a separate Linux user, `auma`.
- **One boundary to change the system.** The `propose_change` tool shows the owner the exact diff in the harness's own approval popup. The owner approves once, the change is applied, and only that one Cordis entry is hot-reloaded.

The snapshot was taken from the running box on 2026-10-03 (WITA, UTC+8). Secrets, state, logs, `node_modules` and the upstream checkout are **not** included.

License: the first-party files in this folder are **AGPL-3.0-or-later**, the same license as this repo. Upstream DSH is **MIT** (Copyright (c) 2026 DeepSeek). The files in `patches/` are diffs against MIT-licensed DSH packages.

## Pinned versions (RAN on the box)
| component | version |
|---|---|
| DeepSeek Harness | `@deepseek-ai/dsh` 0.2.0-rc.2 from npm. Upstream source is https://github.com/deepseek-ai/deepseek-harness at tag `dsh-v0.2.0-rc.2`, commit `639ed01`, kept for reference only and not vendored |
| NVIDIA OpenShell | `openshell` / `openshell-gateway` 0.1.2, images `ghcr.io/nvidia/openshell/{sandbox,supervisor}:0.1.2`, `nvcr.io/nvidia/base/ubuntu:24.04` |
| Podman | 5.4.2, rootless, user `auma` |
| Node.js | v24.21.0 (needs `node:sqlite`) |
| OS | Debian 13 (trixie). No systemd; processes are supervised by pm2 |
| Tunnel | cloudflared 2026.9.3 quick tunnel (optional) |
| Model | `deepseek-official/deepseek-flash` |

## Layout
```
app/package.json               depends on @deepseek-ai/dsh ^0.2.0-rc.2
app/skunkworks.patch.yml       DSH profile overlay: disables every host-side tool preset, inserts auma-core, auma-theme, preset "auma"
app/plugins/auma-core/         boundary plugin: sandbox tools, propose_change/revert_last_change, single-use approvals, $10 cap, /auma/status
app/plugins/auma-theme/        declarative theme, host + browser halves (reads targets/plugins/auma-theme/theme.json)
targets/plugins/auma-theme/    theme.json = the ONLY allowlisted editable target (owned by aukora-gate on the box)
host/usr/local/lib/skunkworks/gate.mjs        skunkworks-gate: proposals, signed hash-chained ledger, receipts, target writes (user aukora-gate)
host/usr/local/lib/skunkworks/sbx-exec        root-owned wrapper: aukora-host -> (sudo as auma) -> openshell sandbox exec auma-ws
host/etc/sudoers.d/skunkworks.template        the single sudo rule (install as /etc/sudoers.d/skunkworks, 0440 root)
openshell/gateway-metadata.json               client gateway registration (mTLS, 127.0.0.1:17690); certs/keys NOT included
ops/                           pm2 ecosystem + launch scripts (podman API, gateway, sandbox ensure, harness, tunnel, start.sh)
patches/                       exact diffs applied to installed DSH node_modules files (vs pristine npm 0.2.0-rc.2 tarballs)
```

## Architecture
- **Two Linux users.**
  - `aukora-host` runs the harness: Cordis plugins, the approval handler, the state DB and the DeepSeek credential. The app directory is mode 0700.
  - `auma` owns rootless Podman, the OpenShell gateway (podman driver, port 17690, mTLS) and sandbox `auma-ws`.
  - The only bridge between them is one sudo rule: `aukora-host ALL=(auma) NOPASSWD: /usr/local/lib/skunkworks/sbx-exec`.
- **OpenShell sandbox.**
  - `sbx-exec <timeout> <cmd>` runs one bash command in `auma-ws` (`/sandbox` workspace, timeout ≤300s, 20 MB file-size ulimit, no TTY, stdin closed).
  - The sandbox is created with `--no-auto-providers`. The wrapper comments say "network none". That was **not independently verified** beyond the probe in step 2 below.
  - The model's tools are `sandbox_shell`, `write_file`, `read_file` and `memory_note`, and they all run inside the sandbox. The profile overlay disables every DSH host tool preset (terminal, web fetch/search, MCP, open-in-app, standard/ptc/minimal/cordis presets).
- **propose_change allowlist.**
  - Editable target: `plugins/auma-theme/theme.json` only, validated to exactly `{"accent": "default"|"#RRGGBB"}` (≤256 bytes). The privileged `plugins/user/<name>/index.js` path was **removed** on 2026-10-03 (see Hardening).
  - Paths are refused if they contain `..`, are absolute, include a symlink component, or escape `plugins/`.
  - `auma-core` itself, the approval store, the wrapper, the policy, key handling, the launcher and harness packages are not editable.
- **Single-use approvals.**
  - Each proposal gets a UUID, a 5-minute TTL, the base and result sha256, and a unified diff. These are recorded in SQLite (WAL, `synchronous=FULL`) before the harness's own approval popup is shown.
  - On "Allow once" the record moves atomically from `pending` to `applying` *before* any write. Replays are refused.
  - The base hash is rechecked at apply time. The file is written via temp file, fsync and rename, then the hash is verified again.
  - The previous version is kept so `revert_last_change` can propose it (revert goes through the same popup).
  - Popups over 12,000 characters cannot be approved: approval fails closed.
  - On startup, pending proposals are expired and in-flight ones are reconciled by hash. They are never replayed.
- **Cordis hot-reload.** After apply, only the target entry is restarted (`update({disabled:true})`, then `update({disabled:null})`). The browser half follows via DSH client HMR. No harness restart is needed.
- **$10 cap.**
  - The `llm/stream` waterfall reserves the worst-case cost *before* dispatch, using peak rates with every input token billed as cache-miss and output capped at 8192 tokens.
  - At most 2 requests can be in flight, and unknown models are refused.
  - Reservations settle on usage. A restart mid-request charges the reservation.
- **Auth.** The harness listens on loopback :3091 only. The tunnel host is admitted with `--trusted-host`. Access uses the DSH launch token plus a signed cookie. `/auma/status` and `/auma-theme/theme.json` sit behind the harness `connection.requestRejection` fence.

## Patches to DSH node_modules (`patches/`)
1. `dsh-client-ui-settings/lib/client.js`: settings persistence is forced to `"host"`. The original is `ctx.remote.$host.isLoopback ? "host" : "memory"`. Without this, settings would not persist over the cookie-authenticated tunnel origin.
2. `dsh-client-ui-approval/lib/client.js` (inline popup CSS): `.body` max-height becomes `min(72vh,1000px)` with `scrollbar-gutter:stable`. `.headline` becomes 13px monospace with `pre-wrap` and `overflow-wrap:anywhere`, so the full diff and hashes are readable in the popup.

To apply after `npm install` in `app/`, run `patch -p1 -d app < patches/<file>.patch`. The paths are `a/node_modules/...`.

## 5-step demo: RAN 2026-10-03 (WITA)
These results come from the harness's own state DB (approvals/spend/activity tables), read read-only for this handoff. Two passes were made. Pass A used a loopback scripted driver priced at $0 (14:25–14:29). Pass B used live DeepSeek `deepseek-flash` (14:44–14:57). Each approval was clicked by the owner in the real popup.

| # | step | result |
|---|---|---|
| 1 | Hands work in the sandbox: `write_file hello.sh`, then `chmod +x && ./hello.sh` | **RAN.** Pass A at 14:25, Pass B at 14:50. |
| 2 | Host is out of reach from the sandbox: `read_file` of the host `.credentials.yaml` path, `ls /home/aukora-host`, TCP probe to the harness port 3091 from inside the sandbox | **RAN** at 14:26, 14:29 and 14:50. The calls were recorded in the activity log. That log does not keep the tool output. The design result is that the sandbox has only its `/sandbox` volume and no host paths. Re-run this step to see the exact refusal text. |
| 3 | `propose_change` theme accent, Allow once, applied, hot-reload of entry `auma-theme` only | **RAN.** At 14:26:40 the bytes were applied, but hot-reload FAILED because of an entry-lookup bug. That bug was fixed at 14:28 and the change took effect at restart. Hot-reload worked at 14:28:07, 14:51:04 and 14:52:04 (current accent `#1E90FF`). |
| 4 | `revert_last_change`, popup, Allow once, previous bytes restored, hot-reload | **RAN** at 14:27:38, 14:28:34 and 14:51:43. All applied with hot-reload. |
| 5 | `propose_change`, then Reject: nothing changes and the proposal is spent | **RAN** at 14:28:55 and 14:57:25. Both refused (`rejected`). |
| (cap) | spend accounting | **RAN.** 17 live DeepSeek calls settled for about $0.0123 total. No-key calls were released at $0. The $10 refusal path itself was **NOT RUN**: it was never hit. |

## Honest limits
- **REDUCED GUARANTEE on approval auth.** Approval relies on the login link (launch token in the URL plus a signed cookie). Anyone holding the link or cookie can approve. There is no second factor or out-of-band confirmation.
- **The allowlist is theme-only so far.** The only target exercised is `theme.json` (one validated key).
- The privileged plugin path was removed on 2026-10-03 (see Hardening).
- Single-use state and the ledger moved to `aukora-gate` on 2026-10-03 (see Hardening). They are still a local SQLite DB: root on the box could roll it back, but every entry is chained and signed, so an edit or rollback shows up as a broken chain or a changed head.
- The scripted driver referenced in `auma-core` (`skunk-script/scripted`) is only priced at $0 while `state/SCRIPT_DRIVER_ENABLED` exists and the provider is configured. It is not configured in the published overlay.
- Since 2026-10-03, `/sandbox` survives sandbox recreation via `/home/auma/sandbox-persist` (see Hardening).
- Patches to `node_modules` are lost on reinstall. Re-apply them from `patches/`.
- The quick-tunnel hostname changes whenever the tunnel restarts. Re-run `ops/start.sh` after that.

## Reproduce on a fresh Linux box (NOT RUN as written; derived from the running setup)
1. **Users and packages.**
   - `useradd -m aukora-host; useradd -m auma`.
   - Give `auma` subuid/subgid ranges.
   - Install podman (rootless), uidmap and slirp4netns/pasta, plus OpenShell 0.1.2 (`openshell`, `openshell-gateway` in `/usr/bin`).
   - Install Node 24 (the scripts expect `/workspace/skunkworks/node/bin`) and pm2 (via `npx`).
2. **Host files.**
   - Copy `host/usr/local/lib/skunkworks/sbx-exec` to `/usr/local/lib/skunkworks/sbx-exec` (root:root 0755).
   - Copy `host/etc/sudoers.d/skunkworks.template` to `/etc/sudoers.d/skunkworks` (root:root 0440) and check it with `visudo -c`.
   - The operator account running pm2 also needs sudo to `-u auma` and `-u aukora-host` for the ecosystem entries.
3. **App.**
   - Place `app/` at `/workspace/skunkworks/app`, owned by `aukora-host` with mode 0700.
   - As `aukora-host`, run `npm install`, then apply both `patches/`.
   - Set the DeepSeek key through DSH's own credential flow. It is stored in `dsh-home/.credentials.yaml` and is never committed.
4. **Ops.**
   - Place `ops/` at `/workspace/skunkworks/ops`. Optionally install `cloudflared` in `~/.local/bin`.
   - Run `ops/start.sh`. It creates `/run/user/<auma uid>`, starts podman and the gateway (generating mTLS certs on first run), ensures sandbox `auma-ws`, starts the tunnel and harness, and prints the login URL to `ops/.access` (secret, mode 0600).
5. Open the URL and repeat the 5-step demo above. Check `GET /auma/status` for approvals and spend.

## Not included (by design)
- DeepSeek key and `.credentials.yaml`, `ops/.access`, launch tokens, cookie/signing secrets, `.secrets/`.
- OpenShell TLS/mTLS/JWT keys, gateway DB/credentials, Podman storage, pm2 homes, logs.
- `*.db` state, `prev/` backups, sessions, `node_modules`, the 440 MB upstream checkout and the Node binary.
- In `run-harness.sh`, the dummy `SKUNK_SCRIPT_KEY` export is replaced by a comment.

## Hardening 2026-10-03 (WITA)
All attacks below were run against the live box, with the harness online and Peter's tunnel unchanged. Most ran as `aukora-host` talking straight to the gate. That is a stronger attacker than the model: it stands for a fully compromised harness. Throwaway drivers were deleted afterwards.

**Fixes**
1. **Code target removed.** `plugins/user/<name>/index.js` is gone. One approval could install arbitrary JS running as `aukora-host`. The allowlist now holds only exact names of declarative targets (`theme.json`). Each has a strict schema: only known keys, `#RRGGBB`/`default`, a byte cap. Plugin capability later is design only: either a sandboxed plugin host or out-of-band signed packages. **Not implemented.**
2. **Separate approval/state user `aukora-gate`.**
   - `gate.mjs` is root-owned and runs as `aukora-gate`. It owns the single-use proposal store, the ledger, the Ed25519 receipt key and the target files.
   - The harness reaches it only through `/run/skunkworks-gate/gate.sock` (group `skgate`). `auma`, the sandbox and other users get EACCES.
   - `app/` is now `root:aukora-host 0750`. Plugins, overlay and `node_modules` are root-owned, so `aukora-host` can no longer rewrite its own boundary code.
   - The DeepSeek key and the cookie-signing secret **stay in `aukora-host`**. DSH needs both in-process to verify cookies and call the API, so moving them would mean patching DSH internals.
3. **Append-only change ledger.**
   - Every proposal, rejection, decision, apply, revert, expiry, reconcile and self-check is recorded with sha256s and ISO timestamps.
   - Entries are hash-chained, and each entry is signed with Ed25519. SQLite triggers refuse UPDATE/DELETE.
   - Verify with `ops/ledger-verify.sh`, or offline: `node gate.mjs verify <db> <pub.pem>`.
   - `chattr +a` is not available: the box root is overlayfs and has no e2fsprogs. The user boundary does that job instead.
4. **Auma's findings.**
   - (a) `read_target` returns host-read content, sha256 and recorded versions.
   - (b) The gate records the current base sha with every proposal. `propose_change` requires `base_sha256`: a missing or wrong base is refused as stale, and the base is checked again at approval. No blind overwrite.
   - (c) The last 50 applied versions are kept. `revert_change(target, to_sha256)` reverts to any recorded sha (`revert_last_change` = "previous"). Each revert still goes through the popup.
   - (d) After every decision the model is told approved/rejected/refused, with the WITA time. This already existed, and a live session shows "owner REJECTED it in the approval popup at 14:57:26 WITA".
   - `change_log` is a read-only view of the ledger.
5. **Fail-closed start-up self-check (teeth twin).** Until it passes, every Auma tool is refused. It re-runs every 15 minutes. It checks two things:
   - From inside the sandbox: TCP to 1.1.1.1, 8.8.8.8, api.deepseek.com, host loopback :3091/:17690, host.containers.internal, the host IPs and the metadata IP must all fail. DNS may only return OpenShell's 198.18.0.0/15 sinkhole. No podman/docker socket, host paths, gate socket, sudo or host processes may be visible.
   - As `aukora-host`: 10 forbidden actions must all fail (write a target, read the gate key or DB, edit its own plugin code or overlay, sudo to gate/root, or to auma outside sbx-exec).
6. **Durable workspace.** `auma-ensure-sandbox.sh` handles a broken sandbox in this order:
   - First it tries `sandbox start`.
   - Otherwise it snapshots `/sandbox` to `/home/auma/sandbox-persist` (keeping one `.prev`), then recreates the sandbox and restores the snapshot.
   - It refuses if the network mode is not `none`.
7. **Signed receipts.** Every applied change gets a receipt signed with the gate-held Ed25519 key. The two item-8 picks are these receipts and the teeth twin above.

**Attacks (all RAN unless marked)**
| attack | result |
|---|---|
| target `../gate/gate.db`, `a/../b`, absolute path, `plugins/user/evil/index.js`, `plugins/auma-core/index.js`, NUL suffix, `__proto__` | refused (not on the exact allowlist) |
| symlink: root planted `theme.json -> receipt key` | gate refused ("symlink in target path"); `aukora-host` cannot create links there (EACCES) |
| blind overwrite (no base) / wrong base | refused as stale |
| schema: extra key / CSS-injection colour / array / 301-byte content | refused (ledger `reject`) |
| replay an applied approval id | refused ("already used… replay refused") |
| approve after expiry (decided 5 min 16 s later) | refused, state `expired` |
| approve with stale base (a sibling proposal applied first) | refused, state `stale` |
| 4 concurrent approvals of one proposal | exactly 1 applied, 3 refused |
| deep revert to a chosen sha, then receipt check with the public key only | applied; signature valid; forged receipt invalid |
| ledger tamper: UPDATE/DELETE; insider drops the trigger and edits a copy | triggers refuse; `verify` reports `hash mismatch` |
| harness restarted with a proposal pending, then approve | expired at harness start; approval refused |
| gate crash between spend and write (simulated `applying` row), then gate restart | reconciled `failed: not written, spent, NOT replayed`; approval refused |
| oversized proposal → TRUNCATED popup | refused at the gate (byte cap). The TRUNCATED/approval-disabled branch cannot be reached for theme.json: **NOT RUN** |
| prompt injection in `why` (fake END/Allow-once lines, RTL override) | collapsed to one line of ≤300 chars with box/marker chars stripped, shown inside «» after "END OF HOST-VERIFIED FACTS" as MODEL-AUTHORED. Checked with the same functions; live popup render **NOT RUN** |
| teeth-twin break: target made 0666 plus a decoy `cloudflared` process in the sandbox, harness restarted | self-check FAILED, tools refused; after restore → passed |
| sandbox → podman socket, gateway :17690, harness :3091, host IPs, sudo, host `/proc`, host secrets | all blocked or absent; 0 routes; network mode `none` |
| `auma` → credentials, state DB, `.access`, pm2 logs, gate DB/key, gate socket | all denied |
| no cookie / forged cookie / cookie on another Host / garbage token | 401 |
| launch token reuse after restart | 401 (the token is per process; the cookie survives restarts) |
| cap bypass via dsh-llm-retry or concurrency | static review only: retries re-run the step through `llm/stream`, so each attempt gets its own reservation; at most 2 in flight under `BEGIN IMMEDIATE`; no adapter-level retries. Live **NOT RUN** (would spend) |
| full Podman restart (all containers killed) | sandbox went to Error and was recreated; `/sandbox` restored (a file written just before the restart survived); network `none` |
| model-driven end-to-end after hardening (`read_target`/`propose_change` through the real popup) | **NOT RUN** (no scripted driver configured; needs an owner click) |

**Still open**
- The gate trusts the harness's report of the popup outcome. A compromised `aukora-host` could forge "allowed-once". It still cannot skip schema, base, expiry, single-use or the ledger. The fix is an out-of-band owner confirmation served by the gate itself.
- Approval auth is still the login link plus cookie. The DSH owner UI (plugin manager, settings) gives a cookie holder `aukora-host`-level power.
- The DeepSeek key and the cookie secret live in the harness process.
- The first run of the new restore logic lost Auma's `/sandbox`; the bug was fixed the same day. `hello.sh` and her memory note were rebuilt from harness logs, but the note is cut off at 500 characters.
