# OpenShell as an outer cage for AUKORA coding agents

**Status: PROPOSED / UNRUN.** Design note. Not installed, not wired, not verified. This file changes no plugin and no script. It does not describe the running app.

The v0.2 specification is the direction this note now follows. Read `SPEC-v0.2-INTAKE.md` first. Placement is in `PLACEMENT.md`. The first three later tasks are in `INCREMENT-MAP.md`. Cases are in `O-CASES.md`. What the cage leaves open is in `RESIDUAL-RISKS.md`.

PR #9 (`cursor/openshell-aukora-fit-a427`) wrote the first version of this file. That version is obsolete as a complete direction. The outer-cage rule below is kept. The control plane, the pins, and the graduation gates were missing from it.

## What is not enforced

- Nothing in this note confines a process. OpenShell is not on the live path.
- The app and the agent share a UID until a qualified workload is actually measured (Gate B). The approval key is a software key. Attendance is reported, not proven. GitHub does not require the approval routes.
- Seatbelt confines BUILD (`workspace-write`) and read-only shells. Auma's sessions run danger-full-access, where Seatbelt is unenforced. An OpenShell sandbox covers a session only when that session is started inside one.
- OpenShell filesystem rules are Landlock inside a Linux guest. They are not a Darwin Seatbelt profile. A bind mount of the Mac home can negate them.
- `landlock.compatibility: best_effort` can continue without a required extra restriction. The sample worker policy asks for `hard_requirement`. That choice is not verified on Apple Silicon.
- An OpenShell `access:` preset is an egress rule for a binary and a host. It is not an AUKORA grant.
- The inspected OpenShell `main` (`1358941b818d4126a7374aaf5216d87fc960e122`) and tag `v0.1.2` (`6648bd0c290efbc41ba131ee9831ee45cd431f94`) are different commits. This note does not pick one.

Sources for the OpenShell side of PR #9, 2026-09-29: [NVIDIA/OpenShell](https://github.com/NVIDIA/OpenShell) (Apache-2.0), the policy schema and sandbox-policy pages under `docs.nvidia.com/openshell/dev/`, and the sandbox compute-driver page. Two published install pages disagree on the Homebrew gateway bind address (`https://localhost:17670` and `https://[::1]:17670`). Trust `openshell status` on the machine, not either sentence. The v0.2 spec's own inspection scope is N00–N14 in `SPEC-v0.2-INTAKE.md`.

## Two questions, and a third the v0.2 spec adds

OpenShell answers an operating-system question: can this process touch that path, host, or credential?

AUKORA answers an authority question: is this typed effect signed, and did Approve consume it once?

§1.5 adds the control-plane question: who is allowed to change the restrictions? A worker that can edit its own gateway policy has a second route around the first answer.

| Layer | Question | Answer that counts | What it must not do |
|---|---|---|---|
| OpenShell gateway + supervisor | Path, host, binary, credential injection, and who may change that policy | Landlock, the egress proxy, process identity, provider-held secrets, pre-handler interceptors on the admin routes | Sign an effect, raise Approve, restart the app, emit ALLOW, or treat a policy file as a grant |
| Laya | Advisory judge in front of the boundary | STOP or ASK only | ALLOW. A model verdict is not a grant |
| Effect IR + membrane | Is this the signed operation, and are the histories intact? | Operation digest, then the host membrane observation | Treat a YAML allow as a signature |
| Aumlok Approve | Did the owner approve these exact bytes? | The popup signature, then one-use `decide.mjs` | Run inside the sandbox |

Laya's live vocabulary on this fit stays STOP or ASK. The spec's §10 names (`NO_OBJECTION`, `REVIEW_REQUIRED`, `BLOCK`, `UNAVAILABLE`) are a proposed assessor contract. They still must not mint a grant. Shadow evaluation is increment 4, not this note.

`scripts/aukora/decide.mjs` also prints the word ALLOW. That word means a signature that already exists was consumed once. It is not Laya, and it is not an OpenShell preset.

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

The gateway is not the membrane. The supervisor is not Laya. Approve stays a macOS popup on the host. `become` stays a host script that restarts the installed app. Issuer, broker, and recovery/checkpoint custody stay outside the worker (`PLACEMENT.md`). None of those move into the guest.

On Apple Silicon the guest is Linux. The Homebrew install starts a local gateway; the usual compute driver is Docker or Podman, which OpenShell can auto-detect. The VM driver (`compute_drivers = ["vm"]`) is never auto-selected. Landlock runs in the guest either way. Seatbelt, in `plugins/aukora-seatbelt/lib/profile.mjs`, remains the host cage for an agent that is still a macOS process.

## Live call path today

OpenShell is not on this path. The path is the host route a contained agent already has to use. File presence was checked on branch base `7a029c68b6f781071e623291a30f8888e91dd075`. The calls were not executed for this intake.

1. `plugins/aukora-action-gate/lib/self-change-tool.mjs` — tool `aukora_self_change`. The harness runs the owner's `self-change.mjs` outside the sandbox. The worktree supplies file bytes only.
2. `plugins/aukora-action-gate/lib/routes.mjs` — a shell that runs `self-change.mjs`, `become.mjs`, `advance.mjs`, `advance-main.mjs`, `plugin-set.mjs`, or `desktop-cutover.mjs` is refused by name. The refusal names the tool.
3. `plugins/aukora-seatbelt/lib/profile.mjs` — last-match denies on the governing checkout, `~/aukora-worktrees/<name>/.git`, the support root, key paths, `aura-code`, `aura-actions`, and the signer socket `~/Library/Application Support/AUKORA/state/aumlok-signer.sock` (file and `network-outbound` unix-socket).
4. `scripts/aukora/self-change.mjs` — preview, popup, both verifiers, then the candidate authority adapter.
5. `apps/aukora-desktop/aumlok-signer.mjs` — the popup witness. Approve signs. Refuse signs nothing.
6. `scripts/aukora/decide.mjs` — one-use consume. ALLOW here is consumption of that signature.
7. `scripts/aukora/aumlok-candidate-authority.mjs` — `localCandidateStage` materializes only after that allow.
8. `scripts/aukora/become.mjs` — membrane observation over the histories. `OBSERVATION_CONFLICT` refuses. Then the app restarts. A failed restart restores the old release.

A sandbox policy does not become part of this chain by being committed. Wiring it would be a later change, through `self-change`, on the owner's approval, and only after the increments in `INCREMENT-MAP.md`. This branch does not do that.

## Where they compose

The agent edits inside the guest workdir. Those bytes are a proposal. They leave the guest only as files the host-side tool reads. The tool, the popup, the kernel consume, the commit, and `become` stay on the host.

OpenShell holds provider credentials at the gateway and can inject them at the proxy. The agent process does not need the raw key. That is a reasonable place for a model token. It is the wrong place for the Aumlok machine seed, the signer key, Kira issuer keys, and the OpenViking root key. Those stay unmounted. Provider injection does not authorize use of the account (§20.12, `RESIDUAL-RISKS.md`).

Network rules are hot-reloadable (`openshell policy update` / `policy set`). Filesystem and process rules are locked at sandbox creation. A running agent cannot widen its own disk. Widening egress is still an operator action on the gateway, and it is still not Approve. In a qualified profile that operator action is a governed control-plane change (§20.14), not a side door.

`become` checks the membrane before it restarts the app. A sandbox that cannot reach `state/` cannot forge that check, and it also cannot satisfy it. The check stays on the host.

## What the YAML can say

`filesystem_policy` is an allowlist of absolute guest paths. A path in neither `read_only` nor `read_write` is inaccessible. There is no filesystem deny key and no path glob. Landlock on a directory covers its children, so a read-write parent cannot carry an exception for `jobs/` or a key file underneath it.

The memory-metal rule is therefore a mount rule, not a fake `deny:` key:

- The only read-write tree is the sandbox workdir (`include_workdir: true`). For a later worker that workdir is one directory whose host path matches `~/aukora-worktrees/<name>`, with `<name>` the same single-segment rule as `worktreePath` in `self-change-tool.mjs`.
- Do not bind-mount `~/aukora-live`, `~/aukora-live/jobs`, `~/aukora-live-proof`, `~/aukora-genesis`, `~/Library/Application Support/AUKORA`, `~/.aukora`, `~/.ssh`, `~/.config/gh`, `~/.git-credentials`, `~/.aws`, `~/.gnupg`, or the home directory itself.
- The Approve socket is identifiable: `~/Library/Application Support/AUKORA/state/aumlok-signer.sock`. OpenShell's network schema is TCP `host` + `port`, not a Darwin unix socket. The socket stays unreachable by not forwarding it and not mounting its directory. Do not pass `--forward` at all on the spike.

`hard_requirement` aborts startup if Landlock cannot be applied or a listed path cannot be opened. The sample lists only the baseline guest paths the policy docs already treat as present (`/usr`, `/lib`, `/etc`, `/var/log`, `/proc`, `/dev/urandom`, `/dev/null`, `/tmp`). It does not list a host path.

The v0.2 profile adds requirements this YAML does not express: `enforcement: enforce` on relied-upon L7 rules, fail-closed middleware, interceptor binding policy, and an explicit telemetry choice (`SPEC-v0.2-INTAKE.md`, §20.10). The sample's GitHub endpoint blocks are a sketch of egress, not that profile.

## Anti-patterns

- Do not replace Laya with a YAML `access: full` or any other ALLOW. OpenShell presets govern sockets. Laya does not permit.
- Do not teach the membrane to read OpenShell policy as a signature.
- Do not run `self-change.mjs`, `become.mjs`, or `advance.mjs` inside the guest. The guest has no signer and must not grow one.
- Do not put the Aumlok popup, the signer socket, or the airlock inside the sandbox. Approve is on the host.
- Do not bind-mount the home directory, the support root, or `aukora-live` to make the agent more useful.
- Do not use `landlock.compatibility: best_effort` for this worker.
- Do not copy the crown — admit, spend, keystone — into the sandbox image or into an Apache tree. See `LICENSE-NOTE.md`.
- Do not treat a prover `within_boundary` result, a gateway HTTP success, or a credential placeholder as Approve.
- Do not treat this document as a claim that the live app is confined.

## Files in this directory

- `SPEC-v0.2-INTAKE.md` — hash of the v0.2 spec, pins, decisions, PR #9 gaps.
- `PLACEMENT.md` — Domains A–D, gateway, and what stays outside the worker.
- `INCREMENT-MAP.md` — the first three later tasks and their gates.
- `O-CASES.md` — O01–O40 and the B cases those increments name. All UNRUN.
- `RESIDUAL-RISKS.md` — attendance, trusted display, same-UID mis-placement, telemetry, provider-use.
- `memory-metal-worker.policy.yaml` — schema version 1 sample carried forward from PR #9. Host denies are comments. Not loaded.
- `FIRST-SPIKE.md` — Apple Silicon throwaway sandbox. No live AUKORA writes. Not a measurement of a planted secret.
- `NEXT-SPIKE.md` — the smallest runnable experiment after these docs.
- `LICENSE-NOTE.md` — Apache-2.0 beside AGPL. Crown stays closed.
