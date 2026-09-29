# First spike: one sandbox, no live AUKORA writes

**Status: UNRUN.** This runbook was not executed. It is an Apple Silicon throwaway sandbox. It is not a qualification of the v0.2 profile, not Gate B, and not a write to the live app.

Direction for why this exists: `SPEC-v0.2-INTAKE.md`. The next measurement, still on the Mac and still without live AUKORA writes, is `NEXT-SPIKE.md`. Run this throwaway only if you want the install and a single create/delete. Do not treat its output as O01–O08.

Do not point the sandbox at `~/aukora-genesis`, `~/aukora-live`, `~/aukora-live-proof`, `~/Library/Application Support/AUKORA`, or `~/.aukora`. Do not pass `--upload`, `--forward`, or `--provider`. Do not attach a model key. The command below is a shell, not Claude, Codex, or the live app. Do not call `self-change.mjs`, `become.mjs`, or the Aumlok popup.

## Install

Homebrew is required. Docker Desktop or a Podman machine must be running so the gateway has a Linux guest. Landlock applies inside that guest, not as Seatbelt.

The published installer is:

```sh
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh
```

Read `install.sh` before piping it if you want to see what it does. On macOS it uses Homebrew and starts a local gateway. The two public install pages disagree on the bind URL (`https://localhost:17670` and `https://[::1]:17670`). Use whichever `openshell status` reports.

The spec's inspected `main` and the `v0.1.2` tag are different commits (`SPEC-v0.2-INTAKE.md`). Record the version `openshell status` actually prints. Do not assume it is `1358941b818d4126a7374aaf5216d87fc960e122` or `6648bd0c290efbc41ba131ee9831ee45cd431f94`.

```sh
openshell status
```

Stop if the gateway is not healthy. Do not edit `~/aukora-genesis` to fix it.

## One sandbox

```sh
mkdir -p "$HOME/openshell-spike"
cp /path/to/memory-metal-worker.policy.yaml "$HOME/openshell-spike/"
cd "$HOME/openshell-spike"
openshell sandbox create \
  --name aukora-spike-throwaway \
  --policy "$HOME/openshell-spike/memory-metal-worker.policy.yaml" \
  --no-keep \
  -- sh -c 'pwd; touch ./spike-ok && echo WORKDIR_WRITE_OK; ls /Users; ls "$HOME/Library/Application Support/AUKORA"'
```

`--no-keep` deletes the sandbox when that command exits. Copy the policy from this branch into the scratch directory. Do not run the command with the governing checkout as the current directory.

What you want to see: `WORKDIR_WRITE_OK`, then failures for `/Users` and the Application Support path. `hard_requirement` may refuse to start if a listed guest path is missing or Landlock is unavailable. That refusal is the spike stopping. Do not switch the policy to `best_effort` or to `root` to get past it. A refused start is not a successful denial measurement (`NEXT-SPIKE.md` separates those gates).

If create fails because the image has no `sandbox` user, stop and record the error. The schema rejects `root` / `0`. Do not put a host path into `read_write` to work around it.

The policy file has no `deny:` key. Host paths and the signer socket appear only as comments. Leaving them unmounted and unforwarded is the restriction the schema can express.

## After it exits

On the Mac, outside OpenShell:

```sh
openshell sandbox list
git -C "$HOME/aukora-genesis" status --short
ls "$HOME/aukora-live/jobs"
```

The sandbox name should be gone. `aukora-genesis` should show no new files from this spike. `aukora-live/jobs` should be unchanged. Nothing in this spike calls `self-change.mjs`, `become.mjs`, or the Aumlok popup.

Record the `openshell status` line, the create output, and those three checks. Until that record exists, this spike is not verified.
