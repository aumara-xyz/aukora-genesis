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
app/plugins/auma-theme/        declarative theme (theme.json = the ONLY allowlisted editable target), host + browser halves
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
  - Editable targets: `plugins/auma-theme/theme.json`, validated to exactly `{"accent": "default"|"#RRGGBB"}`, plus `plugins/user/<name>/index.js` (privileged plugin path, see limits).
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
- **The privileged plugin path (`plugins/user/<name>/index.js`) is untested.** It would run arbitrary JS as `aukora-host`, not sandboxed. The popup warns about this. **NOT RUN.**
- **Crash recovery is untested.** The reconciliation code exists (pending→expired, applying→applied/failed/conflict by hash; reserved spend→uncertain), but **NOT RUN** under a real crash.
- **The spent list is not rollback-proof.** Single-use state is a local SQLite DB owned by `aukora-host`. Restoring an older DB copy, or anything running as `aukora-host`, could un-spend it. There is no external, append-only ledger.
- The scripted driver referenced in `auma-core` (`skunk-script/scripted`) is only priced at $0 while `state/SCRIPT_DRIVER_ENABLED` exists and the provider is configured. It is not configured in the published overlay.
- Restarting the Podman API puts the sandbox in Error, and `auma-ensure-sandbox.sh` then recreates it, **losing `/sandbox`**. `start.sh` therefore only starts podman/gateway and never restarts them.
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
