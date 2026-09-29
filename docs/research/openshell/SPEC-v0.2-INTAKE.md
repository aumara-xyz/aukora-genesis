# Spec v0.2 intake — OpenShell as a candidate containment backend

**Status: PROPOSED / UNRUN.** This file records a design specification. It does not install OpenShell, wire a plugin, flip a flag, call `self-change`, call `become`, or ask for Aumlok Approve. OpenShell is not on the live path.

## What is not enforced

- Same-UID agents can still reach what the owner can reach. A different number in a guest is not, by itself, a closed boundary (§20.7).
- The approval key is a software key. Attendance is reported, not proven. OpenShell does not create a trusted display (§7.7).
- GitHub does not require the AUKORA approval routes on `main`. A scratch pull request is not an approval.
- Nothing in this directory was loaded by `openshell`. No sandbox was started for this intake.

## Document identity

| Item | Value |
|---|---|
| Title | AUKORA — Sovereign Composable Runtime. Technical direction and hardening specification. |
| Version | 0.2 |
| Date on the document | 29 September 2026 |
| Uploaded file | The copy handed to this intake (not committed). |
| SHA-256 | `c4199726125912da0debe2b7c9a39558edf9385f8b6ea5801c24645b983cafc1` |
| Size | 211,821 bytes |
| Hash command | `sha256sum` on that uploaded file, this intake. |
| Preserved v0.1 file named in the spec | `AUKORA_Sovereign_Composable_Runtime_Technical_Spec_v0.1.md` |
| v0.1 SHA-256 named in the spec | `45ecd2dc9762e98d92d4953210e92c53654578786ca0cd45d45b1f3f6b8883b9` |

The v0.1 hash is copied from the v0.2 revision record. This intake did not re-hash a v0.1 file.

The spec's own posture: proposed requirements are not claims that the current application satisfies them. OpenShell features are upstream evidence, not AUKORA achievements. Sentry and BlueField execution guarantees are not assumed. No repository, deployment, policy, credential, or signing configuration was changed to produce the spec.

## Pins the spec names

### AUKORA

| Pin | Identity |
|---|---|
| v0.1 reviewed `main` | `39a5da3f5190018fbcfc9e945506ba8de75f05e7` (tree `085bd9649a780b947fcbe615ad11813171a5a131`, `2026-09-29T00:05:52Z`) |
| v0.2 refresh of `main` | `289d2cebab92249639cd4dfcf7f9fa7539e4ff58` (tree `520f3eb7e1be208534402cab1002876b8034893c`, `2026-09-29T00:49:24Z`) |
| This branch's base, fetched for the intake | `7a029c68b6f781071e623291a30f8888e91dd075` |

`289d2ce` is an ancestor of `7a029c6`. The commits after the spec's refresh are Kira recall and check-registration changes. `git grep -i openshell` on `7a029c6`, excluding `vendor/`, returned no matches. That search is a tree search, not a live-app observation.

The spec says no OpenShell integration was observed in the v0.1 paths or in the delta through `289d2ce`. This intake does not convert that into a claim about Peter's installed app.

### OpenShell

| Pin | Identity |
|---|---|
| Upstream | `NVIDIA/OpenShell` |
| Inspected `main` (N00) | `1358941b818d4126a7374aaf5216d87fc960e122` |
| Tree at that commit | `b61132d4eae9ad22fb20ecf509bc54c2f237f34d` |
| Main timestamp in the spec | `2026-09-28T20:48:50Z` |
| Latest non-prerelease the spec's release API returned | `v0.1.2`, published `2026-09-28T03:58:00Z` |
| Tag `v0.1.2` resolved in the spec (N13) | `6648bd0c290efbc41ba131ee9831ee45cd431f94` |

**The inspected main and the v0.1.2 tag are different commits.** This intake does not pick a binary. A later qualification must select one exact build, check the extension capabilities that build actually advertises, and stop if a required interface is missing. A main-branch page must not be treated as present in the v0.1.2 artifact (§2.7).

This intake did not re-fetch NVIDIA/OpenShell and did not run `openshell`.

## What §1.5 decides

Adopt an existing containment implementation as a candidate backend. Do not rebuild the whole sandbox before the authority contract is tested.

Three questions stay separate:

1. **Reach.** A qualified runtime profile restricts files, processes, network, and credentials.
2. **Who may change those restrictions.** AUKORA-governed control operations protect the backend configuration and the authority ceiling.
3. **Which effect was authorized, and what happened.** The effect broker, immutable approvals, durable accounting, and scoped evidence stay necessary.

AUKORA is not moved into one privileged container. The proposal side is confined. The issuer, the broker, and recovery/checkpoint custody stay outside the domain they govern. OpenShell is replaceable. Sentry is optional. The foundation is the contract and its qualification evidence.

## What §4.5 decides

OpenShell sits in **Domain A's containment** and in the **controlled connection** from that domain toward Domains B–D. It does not wrap the whole authority hierarchy as one shared workload.

The gateway and the supervisor are privileged. They belong in the trusted-base manifest. A protected OpenShell configuration can implement part of the membrane. Aumlok issuance and operation accounting are not handed to a classifier, to the gateway's name, or to a receipt viewer.

Domains may share hardware under a stated profile. They must not share writable trust state with the worker. Platform-independent contracts stay even if OpenShell is later replaced. Placement detail is in `PLACEMENT.md`.

## What §20.5–§20.23 decide

All of the following are **PROPOSED**. The spec states that no sandbox was launched, no runtime binary was audited end to end, and no OpenShell conformance result is claimed.

| Section | Decision this intake carries |
|---|---|
| §20.5 | Two seams: a workload/data plane (supervisor, sandbox, inspected network policy, pre-credential middleware) and an administrative/control plane (gateway auth and allowlisted pre-handler interceptors). A data-plane filter is incomplete if the same workload can delete it. Use a narrow external adapter. Avoid a deep fork. The first protected operation remains `workspace.patch`. |
| §20.6 | Upstream separates a trusted supervisor from the workload (non-root, owned children, filesystem and network restrictions; Docker/Podman, Kubernetes, or MicroVM drivers). The policy prover compares modeled reach. It does not prove a person approved an action or that a running process enforces the compared files. |
| §20.7 | Replace "a different UID" with five reachability questions: owner home and keys; plugin bypass of a JavaScript guard; calling a signer; rewriting policy, replay state, or a witness; resistance to a compromised host administrator. A UID is neither always necessary nor sufficient. One OpenShell workload identity does not isolate two hostile plugins inside it. |
| §20.8 | Proposed topology: person → AUKORA protected control domain → OpenShell gateway and a protected target workspace the worker cannot write → trusted supervisor → confined Cordis workload. Native Mac UI stays off the worker. Linux-backed workload. One broker, one non-secret test workspace, one approved model route. A GPU is not required for a remote model. |
| §20.9 | Final workspace, Aumlok keys, GitHub push credentials, container/gateway admin, and Aura/accounting stores stay out of the workload. Remote-model credentials are placeholders in the image; the supervisor holds the real secret under a governed attachment. Loopback, container name, claimed UID, or a caller-supplied `sandbox_id` is not authentication. |
| §20.10 | Initial profile: pinned artifact, `hard_requirement` where a required extra filesystem policy is claimed, non-root, explicit network rules, `enforcement: enforce` on relied-upon L7 rules (documented L7 default is `audit`), middleware fail-closed, interceptor `binding_policy` exact or reviewed allowlist with pre-commit `failure_policy: fail_closed`, no `tls: skip` on a route whose claim needs body inspection, telemetry chosen explicitly. `best_effort` must not be read as "all isolation off"; it can leave a **required extra** restriction unapplied. |
| §20.11 | The first path is an AUKORA proposal/broker service. It is not an invented OpenShell `/v1/propose` route. Supervisor middleware is gRPC: `Describe`, `ValidateConfig`, `EvaluateHttpRequest`, plus declared stream/response services. The final AUKORA check is deny-only and non-mutating. A body change after approval is a new object or a refusal. |
| §20.12 | Credential substitution hides the key. It does not authorize use of the account. Bind provider, account/tenant, destination, and operation. Do not put secret bytes into public receipts. Do not treat a dummy token as Aumlok root entropy or as human presence. |
| §20.13 | Default middleware timeout in the inspected docs is 500 ms. Human review uses prepare → review → execute. A pending id is not a bearer master key. One service owns use-accounting. For the first closed workspace path, that owner is the AUKORA broker. |
| §20.14 | Inventory every gateway route that can broaden reach. OS-CP-01 through OS-CP-05: workers do not administer the gateway; pre-handler checks the exact approved configuration; interceptor bindings are part of activation; new upstream admin APIs stay unqualified until assessed; `post_commit` is an observer and is fail-open upstream, so it cannot be the authorizer. |
| §20.15 | AUKORA's epoch and OpenShell's active configuration are different until reconciled. Do not mark a policy active because a gateway call returned. The inspected interceptor `current_state` is not populated per method, so it is not a compare-and-swap. Tighten by closing admission first. A supervisor that keeps its previous setup after a failed config must not be reported as running the new policy. |
| §20.16 | Owner-approved maximum backend policy, then modeled access of the effective candidate inside that boundary, **and** actual protected effects inside current AUKORA grants. Neither inclusion proves the other. Only a supported `within_boundary` result passes the modeled gate. Unsupported, error, timeout, and inconclusive stay unresolved. Compare the full effective policy, including provider-added rules. |
| §20.17 | State what is not inspected: WebSocket binary and upstream-to-agent WebSocket messages, some HTTP response bodies, `tls: skip`. Opaque authority-bearing traffic is refused or sent to a separately qualified endpoint. A blocked response after a possible forward is `OUTCOME_UNKNOWN`. |
| §20.18 | An executable pin is not "the approved AUKORA tool" and not "the pinned Laya checkpoint". First-observed pins must not enroll worker-modified code. Restart is a governed generation change. |
| §20.19 | OpenShell logs are attributed observations. Signing an import does not prove the producer's claims. Two sandboxes on one host are not independent against that host's administrator. Do not copy prompts, phrases, stories, credential headers, or hidden reasoning into a universal trace. |
| §20.20 | Sentry / BlueField are optional research. This spec did not qualify a Sentry SDK, a DPU path, or an attestation exchange. Do not adopt automatic line-rate token evaluation, hidden-reasoning inspection, or complete execution proof as already satisfied. |
| §20.21 | Apache-2.0 is not a reason to avoid OpenShell or to relicense AUKORA as Apache. AGPL obligations on AUKORA remain. A process boundary does not settle copyleft. Keep a narrow adapter. Crown stays closed. See `LICENSE-NOTE.md`. |
| §20.22 | Ten missing pieces, ranked. The practical claim is less bespoke containment to write, plus a duty to govern the upstream control surface. It is not "all gaps closed". |
| §20.23 | Acceptance IDs OS-01 through OS-20. They extend INV-01–INV-12. They do not replace B01–B52. |

§22's first three increments are turned into owner-facing tasks in `INCREMENT-MAP.md`. O01–O40 and the B cases §22 assigns to those increments are in `O-CASES.md`. What OpenShell leaves open is in `RESIDUAL-RISKS.md`.

Decisions D-10 through D-14 (§24.5) match this intake: OpenShell is a candidate backend, not the constitution; both planes are governed; effective state is qualified separately from source manifests; speculative Sentry guarantees are not adopted; this stays one contract, not a second plan.

## What pull request #9 already covered

PR #9 (`cursor/openshell-aukora-fit-a427`, commit `8c10eaabbee70933d3ac65521171a17ccb046069`) added four files and nothing else:

| File | What it already said |
|---|---|
| `OPENSHELL-AUKORA-FIT.md` | Outer cage. OpenShell answers path, host, and credential. AUKORA answers whether the typed effect was signed. Laya stays STOP or ASK. Approve, `decide.mjs`, and `become.mjs` stay on the host. File-by-file host route from the action-gate tool through `become.mjs`. |
| `memory-metal-worker.policy.yaml` | Schema version 1 sample. Read-write is the guest workdir plus the baseline guest paths the policy notes already treat as present. Host denies are comments, because the schema has no filesystem deny and no path glob. `landlock.compatibility: hard_requirement`. Not loaded by `openshell`. |
| `FIRST-SPIKE.md` | Apple Silicon install, one throwaway sandbox, `--no-keep`, no live AUKORA writes. Not executed. |
| `LICENSE-NOTE.md` | Apache-2.0 OpenShell as an adjacent process beside AGPL. Crown (admit, spend, keystone) stays closed. Not a legal opinion. |

That spike is the right outer-cage sketch and the wrong scope for v0.2. It has no commit pin, no control plane, no async review, no prover, no O-cases, and no graduation gates.

## Gaps this intake fills, still as documents

| Gap in PR #9 | Where it is recorded now |
|---|---|
| Spec identity and SHA-256 | This file |
| OpenShell main vs `v0.1.2` tag | This file |
| Domains A–D and what stays outside the worker | `PLACEMENT.md` |
| Increments 1–3 as later tasks, with gates | `INCREMENT-MAP.md` |
| O01–O40 and the B cases those increments name | `O-CASES.md` |
| Residuals from §20 and §7.6–§7.7 | `RESIDUAL-RISKS.md` |
| Fit note pointed at this intake | `OPENSHELL-AUKORA-FIT.md` |
| Throwaway sandbox kept separate from the next measurement | `FIRST-SPIKE.md`, `NEXT-SPIKE.md` |
| License note pointed at §20.21 | `LICENSE-NOTE.md` |

## What this intake does not do

It does not choose the OpenShell build. It does not write a gateway interceptor, a middleware adapter, or a policy compiler. It does not move `workspace.patch`, the issuer, the broker, or checkpoint custody. It does not run B01–B52 or O01–O40. It does not preview UI. Peter's screens are unchanged.
