# OpenShell as an outer cage for AUKORA coding agents

Status: design sketch. Not installed, not wired, not verified. This file changes no plugin and no script. It does not describe the running app.

Sources read for the OpenShell side, 2026-09-29: [NVIDIA/OpenShell](https://github.com/NVIDIA/OpenShell) (Apache-2.0), the policy schema and sandbox-policy pages under `docs.nvidia.com/openshell/dev/`, and the sandbox compute-driver page. Two published install pages disagree on the Homebrew gateway bind address (`https://localhost:17670` and `https://[::1]:17670`). Trust `openshell status` on the machine, not either sentence.

## What is not enforced

- Nothing in this note confines a process. OpenShell is not on the live path.
- The app and the agent share a UID. The approval key is a software key on this Mac. Attendance is reported, not proven. GitHub does not require the approval routes, so a direct push to `main` is not stopped.
- Seatbelt confines BUILD (`workspace-write`) and read-only shells. Auma's sessions run danger-full-access, where Seatbelt is unenforced. An OpenShell sandbox would not cover those sessions unless they were started inside one.
- OpenShell filesystem rules are Landlock inside a Linux guest. They are not a Darwin Seatbelt profile. A bind mount of the Mac home can negate them. OpenShell says so.
- `landlock.compatibility: best_effort` continues without Landlock when the ABI is missing. The sample worker policy asks for `hard_requirement`. That choice is not verified on Apple Silicon.
- An OpenShell `access:` preset is an egress rule for a binary and a host. It is not an AUKORA grant.

## Two questions, two answers

OpenShell answers an operating-system question: can this process touch that path, host, or credential?

AUKORA answers an authority question: is this typed effect signed, and did Approve consume it once?

| Layer | Question | Answer that counts | What it must not do |
| --- | --- | --- | --- |
| OpenShell gateway + supervisor | Path, host, binary, credential injection | Landlock, the egress proxy, process identity, provider-held secrets | Sign an effect, raise Approve, restart the app, emit ALLOW |
| Laya | Advisory judge in front of the boundary | STOP or ASK only | ALLOW. A model verdict is not a grant |
| Effect IR + membrane | Is this the signed operation, and are the histories intact? | Operation digest, then `become.mjs` membrane observation | Treat a YAML allow as a signature |
| Aumlok Approve | Did the owner approve these exact bytes? | The popup signature, then one-use `decide.mjs` | Run inside the sandbox |

Laya is the small local judge recorded in `docs/AUKORA-GOLDEN-BOUNDARY-ARCHIVE.md` ("A small judge in front of the boundary"). That record is a toy: the judge allowed unauthorized requests and the boundary refused them. The rule for this fit is stricter than that toy. Laya's vocabulary stays STOP or ASK. It never has an ALLOW the membrane will honor.

`scripts/aukora/decide.mjs` also prints the word ALLOW. That is a different word. It means a signature that already exists was consumed once. It is not Laya, and it is not an OpenShell preset.

## Where the cage sits

```text
Apple Silicon Mac
|
|-- OpenShell gateway (control plane: lifecycle, policy delivery, provider secrets)
|     |
|     +-- one sandbox (Linux guest: Docker Desktop, Podman machine, or the opt-in VM driver)
|           supervisor applies Landlock + egress proxy + non-root process identity
|           |
|           +-- coding agent (throwaway). Writes only its guest workdir.
|                 may propose file bytes
|                 cannot see the signer socket, keys, jobs, or the live checkout
|
|-- outside the sandbox, same as today
      aukora_self_change tool
        -> owner's scripts/aukora/self-change.mjs
        -> Aumlok popup (Approve / Refuse)
        -> decide.mjs (one-use)
        -> commit on main
        -> scripts/aukora/become.mjs (membrane, then restart)
```

The gateway is not the membrane. The supervisor is not Laya. Approve stays a macOS popup on the host. `become` stays a host script that restarts the installed app. None of those move into the guest.

On Apple Silicon the guest is Linux. The Homebrew install starts a local gateway; the usual compute driver is Docker or Podman, which OpenShell can auto-detect. The VM driver (`compute_drivers = ["vm"]`, libkrun settings such as `krun_log_level`) is never auto-selected. Landlock runs in the guest either way. Seatbelt, in `plugins/aukora-seatbelt/lib/profile.mjs`, remains the host cage for an agent that is still a macOS process. OpenShell does not replace that profile.

## Live call path today

OpenShell is not on this path. The path is the host route a contained agent already has to use.

1. `plugins/aukora-action-gate/lib/self-change-tool.mjs` — tool `aukora_self_change`. The harness runs the owner's `self-change.mjs` outside the sandbox. The worktree supplies file bytes only.
2. `plugins/aukora-action-gate/lib/routes.mjs` — a shell that runs `self-change.mjs`, `become.mjs`, `advance.mjs`, `advance-main.mjs`, `plugin-set.mjs`, or `desktop-cutover.mjs` is refused by name. The refusal names the tool.
3. `plugins/aukora-seatbelt/lib/profile.mjs` — last-match denies on the governing checkout, `~/aukora-worktrees/<name>/.git`, the support root, key paths, `aura-code`, `aura-actions`, and the signer socket `~/Library/Application Support/AUKORA/state/aumlok-signer.sock` (file and `network-outbound` unix-socket).
4. `scripts/aukora/self-change.mjs` — preview, popup, both verifiers, then the candidate authority adapter.
5. `apps/aukora-desktop/aumlok-signer.mjs` — the popup witness. Approve signs. Refuse signs nothing.
6. `scripts/aukora/decide.mjs` — one-use consume. ALLOW here is consumption of that signature.
7. `scripts/aukora/aumlok-candidate-authority.mjs` — `localCandidateStage` materializes only after that allow.
8. `scripts/aukora/become.mjs` — `membraneObservation` over the four histories. `OBSERVATION_CONFLICT` refuses. Then the app restarts. A failed restart restores the old release.

A sandbox policy does not become part of this chain by being committed. Wiring it would be a later change, through `self-change`, on the owner's approval. This branch does not do that.

## Where they compose

The agent edits inside the guest workdir. Those bytes are a proposal. They leave the guest only as files the host-side tool reads. The tool, the popup, the kernel consume, the commit, and `become` stay on the host, in the owner's checkout, which the guest cannot write.

OpenShell holds provider credentials at the gateway and can inject them at the proxy. The agent process does not need the raw key. That is the right place for a model token. It is the wrong place for the Aumlok machine seed, the signer key, Kira issuer keys, and the OpenViking root key. Those stay unmounted. Provider injection must not be pointed at them.

Network rules are hot-reloadable (`openshell policy update` / `policy set`). Filesystem and process rules are locked at sandbox creation. A running agent cannot widen its own disk. Widening egress is still an operator action on the gateway, and it is still not Approve.

`become` checks the membrane before it restarts the app. A sandbox that cannot reach `state/` cannot forge that check, and it also cannot satisfy it. The check stays on the host.

## What the YAML can say

`filesystem_policy` is an allowlist of absolute guest paths. A path in neither `read_only` nor `read_write` is inaccessible. There is no filesystem deny key and no path glob. Landlock on a directory covers its children, so a read-write parent cannot carry an exception for `jobs/` or a key file underneath it.

The memory-metal rule is therefore a mount rule, not a fake `deny:` key:

- The only read-write tree is the sandbox workdir (`include_workdir: true`). For a later worker that workdir is one directory whose host path matches `~/aukora-worktrees/<name>`, with `<name>` the same single-segment rule as `worktreePath` in `self-change-tool.mjs`.
- Do not bind-mount `~/aukora-live`, `~/aukora-live/jobs`, `~/aukora-live-proof`, `~/aukora-genesis`, `~/Library/Application Support/AUKORA`, `~/.aukora`, `~/.ssh`, `~/.config/gh`, `~/.git-credentials`, `~/.aws`, `~/.gnupg`, or the home directory itself.
- The Approve socket is identifiable: `~/Library/Application Support/AUKORA/state/aumlok-signer.sock`. OpenShell's network schema is TCP `host` + `port`, not a Darwin unix socket. The socket stays unreachable by not forwarding it and not mounting its directory. Do not pass `--forward` at all on the spike.

`hard_requirement` aborts startup if Landlock cannot be applied or a listed path cannot be opened. The sample lists only the baseline guest paths the policy docs already treat as present (`/usr`, `/lib`, `/etc`, `/var/log`, `/proc`, `/dev/urandom`, `/dev/null`, `/tmp`). It does not list a host path.

## Anti-patterns

- Do not replace Laya with a YAML `access: full` or any other ALLOW. OpenShell presets govern sockets. Laya does not permit.
- Do not teach the membrane to read OpenShell policy as a signature.
- Do not run `self-change.mjs`, `become.mjs`, or `advance.mjs` inside the guest. The guest has no signer and must not grow one.
- Do not put the Aumlok popup, the signer socket, or the airlock inside the sandbox. Approve is Peter's, on the host.
- Do not bind-mount the home directory, the support root, or `aukora-live` to "make the agent more useful."
- Do not use `landlock.compatibility: best_effort` for this worker. A missing ABI would then be a warning, and the cage would be gone.
- Do not copy the crown — admit, spend, keystone — into the sandbox image or into an Apache tree so the cage can "decide." Those stay closed. See `LICENSE-NOTE.md`.
- Do not treat this document as a claim that the live app is confined. The Golden Boundary still says the live agent inside a confined guest is not built.

## Files in this sketch

- `memory-metal-worker.policy.yaml` — schema version 1 sample. Host denies are comments, because the schema cannot express them.
- `FIRST-SPIKE.md` — install on Apple Silicon, one sandbox, one throwaway command, no live AUKORA writes.
- `LICENSE-NOTE.md` — Apache-2.0 beside AGPL, attribution, crown stays out.
