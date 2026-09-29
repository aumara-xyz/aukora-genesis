# Increment map — §22 first three, as later AUKORA tasks

**Status: PROPOSED / UNRUN.** These are tasks for a later owner-facing change. This pull request does not perform them. No plugin, script, flag, crown path, or Approve popup is part of this change.

## What is not enforced

Gate B is the first point at which the spec allows a claim that worker/host separation was measured. Until B01, B02, and O01–O08 pass together on a pinned build, production secrets stay out and same-UID is not closed (§22.4). A green `scripts/check.sh` on the repository is not that gate. The installed app is not that gate.

The spec's gates, in order:

| Gate | Holds before it |
|---|---|
| A — supported backend | Exact build, API capabilities, and platform qualify. A missing enforcement feature is not replaced by a classifier. |
| B — complete narrow path | B01/B02 plus actual worker/host separation. |
| C — governed change and durable use | Control-plane authorization, immutable approval, accounting, active-policy reconciliation, and revocation, together. An endpoint allowlist is not this gate. A signed Git commit is not this gate. |
| D — privacy, recovery, replacement | Ceremony, recovery, export, and O38–O40, before a person-owned durable runtime is advertised. |

Increments 1–3 below are the path to Gates A–C. Gate D is later. Laya shadow work, acrostic measurement, and provenance work may proceed as separate experiments. They must not be used to excuse a missed Gate B.

The first protected effect stays the carried `workspace.patch`: one preimage-bound UTF-8 file replacement inside an operator-selected disposable workspace (§1.4, §20.5).

---

## Increment 1 — One qualified worker, one closed effect path

**Goal.** Use the prove/Docker profile: OpenShell 0.1.2 and the Docker driver only (`PROFILES.md`). Run the Cordis agent, its ordinary tools, and its owned child processes inside that workload, as UID 1000. Leave the `workspace.patch` contract, the protected target, the approval interfaces, and the broker outside the worker. The six obligations the adapter must meet are in `CORE-EXTRACT.md`. Record a deployment identity and one minimal proposal route.

**Why this is first.** It is the earliest measurement that replaces a diagram of the membrane with one observed separation (§22.1).

**Files and surfaces touched later, not in this pull request.**

| Surface | Later role |
|---|---|
| External OpenShell 0.1.2, Docker driver, workload image, and policy | The first adapter body (`CORE-EXTRACT.md`). Pinned. No floating `latest`. Podman, Kubernetes, and the VM driver are not this increment. |
| `plugins/aukora-box/aukora/broker/effect-definition.mjs` | Keep `workspace.patch` as the closed effect. Do not add a universal shell effect to make the sandbox useful. |
| `plugins/aukora-box/aukora/activation/statement.mjs` | Enrollment of the selected runtime identity beside the existing activation fields. |
| A narrow proposal adapter, new only if the existing broker cannot speak the authenticated workload channel | Sits on the host side of the supervisor channel. Not an OpenShell `/v1/propose` invention (§20.11). |
| `plugins/aukora-action-gate/lib/self-change-tool.mjs` and `routes.mjs` | Still the host route for governing changes. The workload does not gain a way around them. |
| `plugins/aukora-seatbelt/lib/profile.mjs` | Remains the host cage for any agent that is still a macOS process. OpenShell does not replace it. |

**Stays outside the worker for this increment:** `scripts/aukora/decide.mjs`, `apps/aukora-desktop/aumlok-signer.mjs`, `scripts/aukora/become.mjs`, issuer keys, checkpoint stores, the container-engine socket, and the gateway admin credential (`PLACEMENT.md`).

**Initial restrictions.** Disposable keys and one selected workspace. No owner-home mount. No writable mount of the protected target. No real GitHub push credential. No signing key. No management socket. No worker-controlled policy change. If a required backend check cannot enforce, the assembly refuses to start. Do not switch Landlock to `best_effort` to get a green start (§20.10).

**Graduation gate.** Gate A, then Gate B: **B01, B02, and O01–O08** pass together on that pin. Record actual identities, mounts, driver, image, and effective policy. The same worker can do useful scratch work. One independently authorized exact change lands. The same change without a grant does not land.

**What is not claimed.** Human presence. A trusted display. Compromised-host resistance. Control-plane governance. Durable accounting across crashes. Policy-prover proof. Sentry or BlueField. Any behavior of Peter's installed app.

---

## Increment 2 — Review and backend configuration on one authority epoch

**Goal.** Freeze the proposal bytes independently of the worker's description of them. Render those bytes on the trusted approval path. Review asynchronously: prepare, then review, then execute. Do not block a person inside the middleware timeout (the inspected default is 500 ms, §20.13). Add the narrow gateway pre-handler path for the configuration and provider changes this first profile needs. Reconcile the observed active configuration before publishing the AUKORA activation.

**Why this is second.** A confined worker is not a governed system if a second channel can widen policy, or if the popup and the broker disagree about the approved object (§22.1).

**Files and surfaces touched later, not in this pull request.**

| Surface | Later role |
|---|---|
| `scripts/aukora/self-change.mjs` | Immutable acquisition of the proposal. The spec notes that this script starts `become` without waiting for its result (§20.4). Closing that observation is part of the deployment receipt, not part of this document. |
| `scripts/aumlok/dual-verify.mjs` | Both verifiers still have to accept the same bindings. |
| `scripts/aukora/decide.mjs` | One-use decision against the pinned approver. Caller control of production trust state is in scope to remove when this increment is actually built. |
| `plugins/aukora-owner-daemon/lib/commit-bind-custody.mjs` | R1 custody checks. The spec records them as default-off (§2.3). A later production profile must not confuse a test seam with a deployed issuer. |
| `scripts/owner/commit-ssh-airlock-bind.mjs` | The spec records this as spike/test and not wired into the candidate-authority path. Replacing that assumption has to be explicit. |
| `apps/aukora-desktop/aumlok-signer.mjs` and the desktop renderer | Trusted rendering (R3). Untrusted content must not request privileged approval or rewrite the preview (§7.7). No UI change is authorized by this research note. |
| OpenShell gateway interceptor registration | Pre-commit, fail-closed, exact or reviewed allowlist. Route inventory, not only `CreateSandbox` (§20.14). |

**Graduation gate.** Gate C's review half: **B06–B08, B24–B27, O09–O20, and O26–O30**. The trusted rendering and the executed object agree. A policy loosening, a provider rebind, or an update the supervisor did not accept cannot silently change the envelope. Required control-plane coverage and authentication are measured. Unsupported admin APIs stay unavailable.

**What is not claimed.** That a signature proves a person was present (B27's expected result is the opposite: the receipt names the missing attendance evidence). That `post_commit` prevented an operation. That interceptor `current_state` is a compare-and-swap (the inspected docs say method-specific state is not populated, §20.15). That R1, R2, or R3 are obsolete because a sandbox exists (§7.7).

---

## Increment 3 — One accounting owner, revocation, and policy refinement

**Goal.** One protected service reserves each action's use and its aggregate budget. Bind the permit to workload generation, effect definition, provider/account where that matters, and the active control epoch. Stop new admissions before teardown or before a policy is tightened. Keep outcome uncertainty across crashes. Compare the effective backend policy to the owner-approved maximum, with the prover's coverage written down, then compare the running deployment to the approved state.

**Why this is third.** It is the increment that has to survive time, restart, restore, and an already-open connection (§22.1).

**Files and surfaces touched later, not in this pull request.**

| Surface | Later role |
|---|---|
| `scripts/aukora/decide.mjs` and its approval-state store, including the high-water witness | The existing one-use and restore logic to reuse. For `workspace.patch`, this broker side remains the single accounting owner (§20.13). |
| Cordis dependency lifecycle in the carried host bridge | Withdrawal of a required mediator closes admission before teardown finishes (INV-07, §5.3). `vendor/dsh/` stays upstream and is not edited by hand. |
| OpenShell policy prover | A separate modeled check. A passing prover result is not authority to install the policy (§20.16). |
| Activation record | Binds effective policy, attached providers, and active generation (OS-07). |

**Graduation gate.** The rest of Gate C: **B09–B17, B28–B35, O21–O25, and O31–O37**. Restart, restore, a delayed response, an existing connection, and a duplicate request do not restore spent or revoked permission. Unsupported or inconclusive proof results do not pass. Stop and recovery stay usable without the model.

**What is not claimed.** Global exactly-once physical execution. Independence of two witnesses that share a host (O37). That a modeled `within_boundary` result is a measurement of the running mounts (O34). Privacy, phrase ceremony, or backend replacement (those are Gate D: O38–O40 and later increments).

---

## After the first three, not scheduled here

§22.2 continues with Laya shadow evaluation (increment 4), the acrostic and local story (5), recovery (6), provenance (7), a second verifier implementation (8), a two-node pilot (9), and constitutional update plus portable exit (10). Sentry, payments, and a global federation wait until the narrow software profile is real (§22.4).

Each later graduation record has to name source and artifact identity, the profile, platform mechanisms, issuer/broker/renderer/control-state identities, effect classes, executed cases, skips, unrun cases, witness assumptions, residual risks, and an explicit owner decision to activate (§22.3). This pull request is not that record.
