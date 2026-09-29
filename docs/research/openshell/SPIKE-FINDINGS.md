# Spike findings — Mac bring-up, operator-reported

**Evidence: OPERATOR-REPORTED.** Peter reported a pass on an Apple Silicon Mac: OpenShell **0.1.2**, gateway at **`host.docker.internal:17670`**, and workload identity **`ubuntu:1000`** because the default image has no `sandbox` user. This cloud agent did not run `openshell`, did not see the command output, and did not re-check the live app.

That pass is a bring-up. It is not Gate B, not O01–O08, and not the planted-secret checks in `NEXT-SPIKE.md`. Those stay **UNRUN**.

## What is not enforced

OpenShell is not on the live path. No plugin, flag, crown path, or Approve step changed with this note. A reported gateway address does not confine the installed app. Same-UID, the software approval key, and the lack of an AUKORA check on GitHub `main` are unchanged.

## Reported pass

| Fact Peter named | How this note uses it |
|---|---|
| `openshell` 0.1.2 | Prove profile pin. Tag `v0.1.2` in the spec is commit `6648bd0c290efbc41ba131ee9831ee45cd431f94`. Inspected `main` `1358941b818d4126a7374aaf5216d87fc960e122` is a different commit and is not the proof build. |
| Gateway needs `host.docker.internal:17670` | The address the Mac run needed. The two public install pages (`https://localhost:17670` and `https://[::1]:17670`) were not that address. |
| Default image has no `sandbox` user — use `ubuntu:1000` | Do not require a user named `sandbox`. Run as the Ubuntu image identity at UID 1000. |

`ubuntu:1000` is recorded in Peter's words. The reading used here: the image user is `ubuntu`, the numeric identity is UID 1000. The v0.1.2 policy schema, read at `6648bd0c290efbc41ba131ee9831ee45cd431f94` in `docs/how-it-works/policies/schema.mdx`, says an explicit `run_as_user` / `run_as_group` is the name `sandbox` or a numeric id from `1` through `4294967294` (root rejected). The name `ubuntu` is not that explicit form. The sample policy now sets `"1000"`. If the fields are omitted, that same page says Docker and Podman use the image `USER`.

## What was read at the 0.1.2 tag, and what was not run

**SOURCE-INSPECTED** at `6648bd0c290efbc41ba131ee9831ee45cd431f94`, this update only:

- `docs/how-it-works/policies/schema.mdx` — process identity rule above. `hard_requirement` fails the start when Landlock cannot enforce. `best_effort` starts without the filesystem rules and logs a finding.
- `crates/openshell-driver-docker/README.md` — two containers: workload `network_mode=none`, supervisor companion on Docker host networking so it can reach the gateway's loopback listener. Workload identity is the admitted policy identity or the image `Config.User`, non-root. UID 0 and an unresolved name are rejected.

That README does not mention `host.docker.internal`. Peter's address is the Mac report, kept beside the README rather than rewritten into it. Docker Desktop's VM is a plausible reason a Mac-side gateway on port 17670 is reached as `host.docker.internal` instead of the container's loopback. That reason was not measured here.

## What the pass does not include

Peter's report did not include a planted-secret transcript, a signer-path transcript, `openshell sandbox list` after `--no-keep`, or `git status` on `~/aukora-genesis`. `NEXT-SPIKE.md` Gates 0–3 stay **UNRUN**. B01, B02, and O01–O08 stay **UNRUN**.

The sample YAML in this directory was not loaded by `openshell` in this update. Its `run_as_user: sandbox` lines were the ones the default image could not satisfy. They now say `"1000"` so the next Mac run does not repeat that miss. Still not loaded here.
