# Profiles — prove/Docker and friend/light

**Status: PROPOSED**, except the three bring-up facts in `SPIKE-FINDINGS.md`, which are **OPERATOR-REPORTED**. Neither profile is on the live path. This file adds no plugin, flag, or Approve step.

## What is not enforced

A friend/light session is not a proof. A prove/Docker note is not a graduated Gate B. O01–O40 and the B cases in `O-CASES.md` stay **UNRUN**. The installed app is unchanged.

Peter's direction for the proof: go hard, extract the useful containment behavior, own the contracts in AUKORA, and use a **Docker harness only**. The contract list is `CORE-EXTRACT.md`. Placement of issuer, broker, and recovery stays `PLACEMENT.md`.

## prove / Docker

This is the only profile that can later graduate Gate A and Gate B.

| Item | Prove profile |
|---|---|
| Runtime | OpenShell **0.1.2**, commit `6648bd0c290efbc41ba131ee9831ee45cd431f94`. No floating `main`, no floating `:latest` as the proof identity. |
| Harness | **Docker only.** Podman, Kubernetes, and the VM driver are outside this profile. A second driver is a new qualification, not a flag on this one. |
| Gateway | `host.docker.internal:17670`, as reported on the Mac. Record whatever `openshell status` prints next to it. |
| Process identity | `"1000"` / `"1000"` (Ubuntu image user). The name `sandbox` failed on the default image. Root stays rejected. |
| Filesystem | `landlock.compatibility: hard_requirement`. No owner-home mount, no signer socket, no `--forward`. Host paths stay comments in `memory-metal-worker.policy.yaml` because the schema has no deny key. |
| Network | Relied-upon L7 rules at `enforcement: enforce`. An `audit` rule does not count as a block. |
| Effect | Still the host broker's `workspace.patch`. The Docker workload may propose bytes. It does not publish them. |
| Graduation | B01, B02, and O01–O08 on this pin, together. Not the bring-up pass alone. |

The Mac bring-up shows this profile can start. It does not show the worker was denied a planted secret, and it does not show an authorized patch landing once.

## friend / light

This is the profile a person can stand to use before the proof exists: Seatbelt on the Mac, a danger-full-access session, a sandbox with a worktree mounted, `best_effort`, Podman, or no OpenShell at all.

| Item | Friend / light |
|---|---|
| Purpose | Get ordinary work done without pretending the boundary was measured. |
| Reach | Wider than prove/Docker, or simply unmeasured. A mounted worktree, a shared UID, or a missing Landlock rule fits here. |
| What a result may say | A development note. A command log. A preference. |
| What a result must not say | Gate B. O-case pass. Same-UID closed. Attendance. Trusted display. |

Friend/light does not get a second policy file in this pull request. Writing a looser YAML and calling it the sample would blur the proof. The sample YAML is the prove/Docker sketch.

Laya stays STOP or ASK in both profiles. Neither profile holds admit, spend, or keystone. Neither profile moves `decide.mjs`, the signer, or `become.mjs` into the guest.

## How to label a future run

Write the profile name on the record before the output. A run with Podman, with `best_effort`, with `run_as_user: sandbox` on an image that has no such user, or with a bind of the Mac home, is friend/light even if the sandbox printed `WORKDIR_WRITE_OK`. Only prove/Docker, on 0.1.2, with the identity and gateway above, can be offered toward Gate B — and only after B01, B02, and O01–O08 are actually recorded.
