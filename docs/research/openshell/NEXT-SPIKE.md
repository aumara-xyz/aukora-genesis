# Next spike: planted host secret and the signer socket path

**Status: UNRUN.** Peter's Mac pass covers bring-up only (`SPIKE-FINDINGS.md`): OpenShell 0.1.2, gateway `host.docker.internal:17670`, identity `ubuntu:1000`. It does not cover the four gates below. This agent did not run them. Do not run them in a cloud VM as a stand-in for the Mac. Do not install OpenShell onto the live app from this branch.

`FIRST-SPIKE.md` is the throwaway install note. This file is the reachability check. It is still not O01–O08, not Gate B, and not a broker test. No `workspace.patch` is performed. No Approve popup is raised. Use the prove/Docker profile (`PROFILES.md`), not friend/light.

## What is not enforced

Until the four gates below are recorded from a real run, the worker's inability to read the planted secret is a hypothesis. The policy schema has no filesystem `deny` and no path glob. Host paths stay comments in `memory-metal-worker.policy.yaml`. The restriction under test is: those paths are not mounted and the signer socket is not forwarded.

A startup refusal from `hard_requirement` is Gate 1 failing closed. It is not a pass of Gate 2 (§21.7). Do not flip the policy to `best_effort` or `root` to obtain a pass.

## Scope

- Machine: Apple Silicon Mac, operator-owned, disposable scratch only.
- Guest: Linux, via Docker Desktop. Podman is friend/light, not this check. Landlock applies in the guest.
- Gateway address from the reported bring-up: `host.docker.internal:17670`.
- Policy identity: `"1000"` (the sample YAML). The name `sandbox` does not exist in the default image.
- Policy: `memory-metal-worker.policy.yaml` from this directory, copied into the scratch directory.
- Flags that stay off: `--upload`, `--forward`, `--provider`, and any bind of the home directory, `~/aukora-genesis`, `~/aukora-live`, `~/aukora-live-proof`, `~/Library/Application Support/AUKORA`, or `~/.aukora`.
- Process inside the sandbox: `sh`, not a model CLI and not the AUKORA app.

## Plant the sentinel first

Outside OpenShell, on the Mac:

```sh
mkdir -p "$HOME/openshell-spike-secret"
printf '%s\n' 'AUKORA_PLANTED_SECRET_DO_NOT_LEAK' > "$HOME/openshell-spike-secret/PLANTED_SECRET"
# signer socket path, comment only — do not open it, do not forward it:
# ~/Library/Application Support/AUKORA/state/aumlok-signer.sock
```

The sentinel directory must not be the sandbox workdir and must not be passed to `openshell`. The string `AUKORA_PLANTED_SECRET_DO_NOT_LEAK` is the oracle. If it appears in the sandbox command's stdout or stderr, Gate 2 fails.

## Gates

Record `openshell status` first, including the version line, so the run names the build that actually started. The spec's `main` pin and the `v0.1.2` tag differ (`SPEC-v0.2-INTAKE.md`).

**Gate 0 — gateway healthy.** `openshell status` reports a healthy local gateway. If it does not, stop. Do not edit `~/aukora-genesis`.

**Gate 1 — policy loads and the sandbox starts.** Create with `--no-keep` and the sample policy. Exit 0 and a line `WORKDIR_WRITE_OK` mean the guest could write its workdir. A non-zero exit before any guest command, with Landlock or a missing listed path in the error, is a recorded startup refusal. Stop there. Do not relax the policy.

**Gate 2 — planted secret and signer path are unreachable.** The guest command must:

1. Write `./spike-ok` in the workdir and print `WORKDIR_WRITE_OK`.
2. Test readability of the planted path at the guest `$HOME` location and at `/Users/<user>/openshell-spike-secret/PLANTED_SECRET`. Either path being readable prints `SECRET_PRESENT` and exits non-zero. Both unreadable prints `SECRET_ABSENT`. The command uses `test -r` so a hit does not print the file body.
3. Stat the signer socket path under guest `$HOME` and under `/Users/<user>/Library/Application Support/AUKORA/state/aumlok-signer.sock`. Print `SIGNER_PATH_ABSENT` when neither exists. Print `SIGNER_PATH_PRESENT` if `test -e` or `test -S` succeeds on either.

Success for Gate 2 is all of:

- stdout contains `WORKDIR_WRITE_OK`, `SECRET_ABSENT`, and `SIGNER_PATH_ABSENT`;
- stdout and stderr do not contain `AUKORA_PLANTED_SECRET_DO_NOT_LEAK`;
- stdout and stderr do not contain `SECRET_PRESENT` or `SIGNER_PATH_PRESENT`.

**Gate 3 — host unchanged.** After exit:

```sh
openshell sandbox list
git -C "$HOME/aukora-genesis" status --short
ls "$HOME/aukora-live/jobs"
test -f "$HOME/openshell-spike-secret/PLANTED_SECRET"
```

Success: the sandbox name is gone, `aukora-genesis` has no new files from this run, `aukora-live/jobs` is unchanged, and the planted file is still only on the Mac. Then remove the scratch secret directory. Nothing in this spike calls `self-change.mjs`, `become.mjs`, `decide.mjs`, or the signer.

## Command shape

Replace the policy path. Do not run this with the governing checkout as the current directory.

```sh
mkdir -p "$HOME/openshell-spike"
cp /path/to/memory-metal-worker.policy.yaml "$HOME/openshell-spike/"
cd "$HOME/openshell-spike"
openshell sandbox create \
  --name aukora-spike-planted \
  --policy "$HOME/openshell-spike/memory-metal-worker.policy.yaml" \
  --no-keep \
  -- sh -c 'touch ./spike-ok && echo WORKDIR_WRITE_OK
secret="$HOME/openshell-spike-secret/PLANTED_SECRET"
alt="/Users/${USER}/openshell-spike-secret/PLANTED_SECRET"
if test -r "$secret" || test -r "$alt"; then
  echo SECRET_PRESENT
  exit 3
fi
echo SECRET_ABSENT
sock1="$HOME/Library/Application Support/AUKORA/state/aumlok-signer.sock"
sock2="/Users/${USER}/Library/Application Support/AUKORA/state/aumlok-signer.sock"
if test -e "$sock1" || test -e "$sock2"; then
  echo SIGNER_PATH_PRESENT
  exit 4
fi
echo SIGNER_PATH_ABSENT'
```

`test -r` and `test -e` do not read file bodies and do not connect to a socket. A readable planted path fails Gate 2 by printing `SECRET_PRESENT` without echoing the sentinel. The sentinel string itself is only in the host file and in this runbook, not in the guest command.

## What a pass would still not claim

A recorded pass would claim only this: on that Mac, that `openshell` build, that policy file, and that one `sh` process, the workdir was writable, the planted sentinel did not appear, and the signer path was absent, and the host checkout and jobs directory were unchanged afterward.

It would not claim UID separation for every helper, a trusted display, attendance, telemetry opt-out, provider-use control, control-plane governance, or any O-case. Those remain in `O-CASES.md` and `RESIDUAL-RISKS.md`.
