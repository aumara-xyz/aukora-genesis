# INC1 placement — OpenShell candidate, STAGE

**STATUS=STAGE · Gate A=UNMET · metal courts=UNRUN · NEVER live Electron · NEVER Become**

Base checkout for this mirror: `28956e78a`. Spec: Sovereign Composable Runtime v0.2, sections 1.4–1.5, 6, 20.5–20.12, 22.1 Increment 1, and 22.4 Gate A. The spec digest is kept out of this tree.

This file is a cloud scratch note. Landing it in Peter's installed app is a local `scripts/aukora/self-change.mjs` plus approval in the AUKORA popup. A pull request does not do that. Nothing on GitHub requires that route. The approval key is a software key; a recorded click does not prove who was present.

This note is not part of the imported `docs/research/PROVENANCE.json` byte list.

## What is not enforced

- The macOS app and the agent share one UID. Seatbelt confines BUILD and read-only shells. `danger-full-access` stays on the host. A Linux guest UID is not that boundary.
- OpenShell is not Approve, not the issuer, and not the broker.
- No pinned OpenShell build is enrolled here. The 2026-09-29 spike log is a prior measure, not a result of this mirror.
- Break corpus stays the frozen record in `docs/BREAK-CORPUS.md` (17 breaches, 11 open when frozen on 2026-08-21). This stage does not re-measure it and closes none of it.
- Courts B01, B02, and O01–O08 are labeled UNRUN. A green stub check is not those courts.

## Placement

```text
PERSON
  | control policy / trusted review / explicit recovery
  v
AUKORA PROTECTED CONTROL
  issuer + renderer          broker executes workspace.patch
  Aura evidence              Kira memory            Aumlok approval
  | governs config           | no writable worker mount of the target
  v                          v
OpenShell gateway          protected target workspace
  v
trusted supervisor
  v
CONFINED WORKLOAD
  Cordis agent + ordinary tools + owned children
  scratch + read-only snapshot
  no owner home, no signer socket, no engine socket, no push credential
```

| Piece | Where | Existing seam |
|---|---|---|
| Cordis worker and owned children | Inside the candidate workload | Cordis host in the desktop release; not relaunched here |
| `workspace.patch` definition | Carried closed effect | `plugins/aukora-box/aukora/broker/effect-definition.mjs` |
| `workspace.patch` executor | Outside the workload | `plugins/aukora-box/aukora/broker/workspace-patch.mjs` |
| Broker and issuer | Outside | `plugins/aukora-box/aukora/broker/broker.mjs` and the Aumlok issuer path |
| Signer socket | Denied, not forwarded | `plugins/aukora-seatbelt/lib/profile.mjs` socket deny |
| In-process tool judgment | Host, not OS confinement | `plugins/aukora-action-gate` |
| Aura | Evidence, outside | `scripts/aura/` |
| Kira | Memory, outside | `plugins/aukora-kira/` |
| Aumlok | Identity and approval, outside | `plugins/aukora-aumlok/` |

The first effect stays `workspace.patch`: one preimage-bound UTF-8 file replacement in an operator-selected disposable workspace. Parameters on the carried definition are `workspace`, `path`, `beforeSha256`, `content`. Creation is a null preimage. The definition excludes commands, deletion, parent creation, and symlinks, and it already states the same-UID concurrent-mutation limit. No universal shell effect is added to make a sandbox look useful. No OpenShell `/v1/propose` route is invented. Proposal intake, when it exists, is a dedicated AUKORA broker path outside the worker.

## Call path in this mirror

There is no live entry point. The desktop shell does not import this plugin.

The only executable entry is `plugins/aukora-containment/check.mjs`. It calls `admitWorkloadRequest` in `plugins/aukora-containment/lib/adapter.mjs`, compares the closed effect name with `WORKSPACE_PATCH` in `plugins/aukora-box/aukora/broker/effect-definition.mjs`, and reads the UNRUN rows in `plugins/aukora-containment/courts/inc1.mjs`. It does not call `workspace-patch.mjs`, `broker.mjs`, Seatbelt, the action gate, or Electron.

`plugins/aukora-containment/backends/openshell-sketch.mjs` holds spike fixes A–D as data. `launch()` throws `containment:not-wired`.

## Gate A prerequisites

Gate A is a supported backend: one exact build, its API capabilities, and the platform all qualify. Until that record exists, the profile stays development status. A missing enforcement check is not replaced by a classifier, a model, or a policy keyword.

Still required before Gate A can be claimed:

1. Pin one OpenShell source or release, driver, workload image digest, and configuration. Floating tags do not count.
2. Show the workload becomes available only after the required boundary is confirmed (O01), and that a missing required filesystem feature refuses start (O02) with `hard_requirement` rather than best-effort graduation.
3. Record effective identities, mounts, environment, and image contents against dummy sentinels (O04): no owner home, no signer socket, no engine socket, no gateway-admin credential, no GitHub push credential.
4. Separate ordinary worker credentials from gateway administration (O08). The Homebrew single-user profile left this residual.
5. Keep issuer, broker, recovery custody, Aura, Kira, and Aumlok outside the workload, and show one authorized `workspace.patch` land beside one unauthorized refusal (B01 with B02).

## Residual risks

| Risk | Why it remains |
|---|---|
| Same UID on the Mac | Host processes of the app UID can still ask the signer socket. Guest isolation does not revoke that. |
| Same UID inside the guest | One workload identity does not separate two hostile plugins. Fiber names are not a boundary. |
| Confused deputy | A host adapter that accepts a model-chosen path would spend the owner's rights. The stub refuses named home and socket shapes and still does not resolve a real workspace. |
| Deny-by-omission | The measured schema cannot name a filesystem deny for a child of an allowed directory. |
| ENOENT versus EACCES | The spike saw host files absent because they were not bind-mounted. That is not a Landlock denial of a mounted path. |
| Docker callback and user | Fix A (gateway callback via `host.docker.internal`) and Fix B (no `sandbox` user on the default image; never root) are notes in the sketch. They are not applied. |
| TLS and name length | A leftover local TLS directory can fail signatures. Sandbox names measured a 19-character limit. |
| Control plane | A data-plane filter is incomplete if the worker can remove it. Governing that plane is Increment 2. |
| Middleware timeout | Human review does not fit a short synchronous middleware deadline. Prepare, review, and execute stay asynchronous, and they are not built here. |
| Credential substitution | Hiding an API key does not authorize every call the key can make. Account and operation binding is later work. |
| Upstream drift | Documentation of a newer upstream main must not be treated as the measured release. |
| Sentry / BlueField | Optional research. Not assumed. |
| This pull request | Scratch evidence. It does not change the installed app. |

## What a green self-check means

`node plugins/aukora-containment/check.mjs` exits zero when the stubs refuse signer-socket forward, home mount, universal shell, worker policy change, and best-effort compatibility, and when every Increment 1 court prints `UNRUN`. The last line is the placement result. It is not Gate A, Gate B, or a live-app measurement.
