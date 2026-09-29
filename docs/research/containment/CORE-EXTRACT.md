# CORE-EXTRACT — OpenShell-as-harness + Sovereign Runtime v0.2 (§1.5 / §22 Inc1)

**STATUS=STAGED · PROPOSED / UNRUN · NEVER_APPROVE · NEVER_LIVE_WIRE**

North star: *AUKORA_Sovereign_Composable_Runtime_Technical_Spec_v0.2*  
Spec SHA-256: `c4199726` … `afc1` (full digest in ~/aukora-live/jobs/containment-hard-20260929/NOTES.md)  
Worktree tip base: `7a029c68b6f781071e623291a30f8888e91dd075` (`origin/main`)  
Spec §2.6 AUKORA pin: `289d2cebab92249639cd4dfcf7f9fa7539e4ff58`  
Mac spike: `~/aukora-live/jobs/openshell-spike-20260929/` **STATUS=PASS** (measure only)  
Effect IR sibling: `~/aukora-live/jobs/day-astra-effect/ready/` **STATUS=STAGED** (do not break Auma)

## Ownership (steal patterns; keep contracts)

| Layer | Owner | What it is |
|---|---|---|
| **Contracts** | **AUKORA** | Effect IR, issuer, broker, activation, accounting, recovery, evidence |
| **Harness / fence** | OpenShell (candidate) | Supervisor + workload + reachability ceiling |
| **Measure driver** | Docker Desktop (Mac spike) | Linux guest for Landlock; **not** production authority |
| **Optional hardware** | Sentry / BlueField | Research only; not assumed |

**Rule:** OpenShell answers *what can the agent reach?* AUKORA answers *which exact effect was authorized and what happened?* Who may change the ceiling is a third, separately governed plane.

## §1.5 distilled — three questions, not one

1. **Reach** — qualified runtime profile restricts files, processes, network, credentials.
2. **Who may change those restrictions** — AUKORA-governed control operations protect backend config and authority ceiling.
3. **Which effect was authorized, and what happened** — broker, immutable approvals, durable accounting, scoped evidence stay necessary.

AUKORA is **not** moved into one privileged container. Proposal side is confined. Issuer, broker, recovery/checkpoint custody stay **outside** the domain they govern. OpenShell is **replaceable**. Foundation = contract + qualification evidence, not vendor dependency.

## §4.5 / §20.8 placement (one diagram)

```text
PERSON
  | control policy / trusted review / explicit recovery
  v
AUKORA PROTECTED CONTROL  (Domains C issuer+renderer, D broker, E recovery)
  | governs config          | executes approved workspace.patch
  v                         v
OpenShell gateway         protected target workspace
  v                         ^ NO writable worker mount
trusted supervisor ---------+---- permitted AUKORA proposal intake
  v
CONFINED WORKLOAD (Domain A + Domain B composition inside it)
  scratch + RO snapshot; NO home / keys / admin socket / engine socket
```

OpenShell sits in **Domain A's containment** and the controlled connection toward B–D. Gateway/supervisor are privileged → trusted-base manifest. They are **not** Domain C or D.

## §22 Increment 1 — qualify one worker + one closed effect path

**Change:** Select exact OpenShell artifact/driver with required capabilities. Run Cordis agent/tools/owned children inside its qualified boundary. Preserve carried AUKORA `workspace.patch`, protected target, approval interfaces, broker **outside** that worker. Enroll a protected deployment identity and a minimal allowed proposal route.

**Reuse:** Existing closed effect/activation/broker; OpenShell workload/supervisor separation. Deep broker is **not** replaced by a generic forwarding proxy.

**Initial restrictions:** Disposable keys + selected workspace only. No owner-home mount, no writable protected target, no GitHub push credential, no signing key, no management socket, no worker-controlled policy change. Required backend checks enforce **or** assembly refuses to start. Never weaken Landlock to `best_effort` for a green start.

**Acceptance:** **B01/B02 and O01–O08 pass together.** Same worker does useful scratch; independently authorized exact change lands; unauthorized protected change does not. Record identities, mounts, driver, image, effective policy.

**Not claimed in Inc1:** human-presence proof, trusted display, compromised-host resistance, control-plane governance (Inc2), durable accounting across crashes (Inc3), prover proof, Sentry/BlueField.

## First protected effect

Still the carried **`workspace.patch`**: one preimage-bound UTF-8 file replacement inside an operator-selected disposable workspace. Do **not** invent a universal shell effect to make the sandbox “useful.” Do **not** invent an OpenShell `/v1/propose` route — use a dedicated AUKORA proposal/broker service (§20.11).

## Stolen patterns (keep; do not overclaim)

From OpenShell / v0.2 / Mac spike PASS:

| Pattern | Keep as |
|---|---|
| Supervisor ≠ workload | Domain A fence |
| Policy = reachability ceiling | Never Effect IR / grant / settlement |
| Landlock `hard_requirement` | Refuse-default on missing kernel feature (O02) |
| Deny-by-omission (no host bind-mount) | Host secrets absent (ENOENT), not merely EACCES |
| Docker `grpc_endpoint = host.docker.internal` | Required Mac Desktop callback fix |
| Default image user `ubuntu:1000` | Do not assume `sandbox` user exists |
| mTLS+JWT for Docker sandboxes | Plaintext gateway rejected by Docker driver |
| Cordis lifecycle + broker outside | Narrow host bridge; no gateway-admin as worker service |
| Effect IR closed classes | Sibling pack; membrane raise is separate Peter Approve |

## What this STAGE pack is / is not

**Is:** engineer-readable Stage pack — docs, NOT_WIRED interface stubs, OpenShell backend sketch encoding Mac spike fixes, Inc1 checklist, stub courts marked UNRUN, Effect IR sibling link, Codex polish + Claude HOSTILE parked in the job dir.

**Is not:** Approve, become, push to `main`, door_send AUMA, live Electron wire, mounted decide adapter, Auma memory worktree edits, Gate B claim, or any O01–O08 pass.

## Read next

- `ADAPTER.md` — AUKORA-owned interface + OpenShell sketch
- `PROFILES.md` — Development / Confined laboratory / Sovereign local v1
- `SPIKE-FINDINGS.md` — Mac PASS evidence + required fixes
- `ENGINEER-ONBOARD.md` — how to raise (docs-only card vs metal)
- Sibling: `~/aukora-live/jobs/day-astra-effect/ready/`
