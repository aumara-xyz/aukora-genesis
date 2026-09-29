# SPIKE-FINDINGS — OpenShell Apple Silicon PASS (2026-09-29)

**STATUS=PASS (measure only)**  
Source log: `~/aukora-live/jobs/openshell-spike-20260929/SPIKE-LOG.md`  
Machine: `8f8eface-72fc-438e-ba34-bcf8c2e270f6` · Darwin arm64 · Asia/Makassar (WITA)

## Non-goals honored by the spike

- No live AUKORA release trees touched
- No Approve / become / live wire / push `main`
- No real Airlock/signer socket opened (shape file only under job dir)
- OpenShell ≠ authority — path allow/deny inside throwaway sandbox only

## Versions measured

| Component | Identity |
|---|---|
| openshell CLI | 0.1.2 (Homebrew `nvidia/openshell/openshell`) |
| openshell-gateway | 0.1.2 |
| Docker Engine | 29.5.3 · linux/arm64 |
| Default workload image | `nvcr.io/nvidia/base/ubuntu:24.04` · uid `1000(ubuntu)` |
| Policy loaded | `policy-spike-noproc.yaml` (process block removed) |
| Landlock | `compatibility: hard_requirement` — supervisor logged isolation attached/enforced |

## Required Mac fixes (encode in backend sketch)

### Fix A — Docker Desktop callback

```toml
[openshell]
version = 2

[openshell.gateway]
compute_driver = "docker"

[openshell.drivers.docker]
grpc_endpoint = "https://host.docker.internal:17670"
```

Without Fix A: `OPENSHELL_ENDPOINT=https://127.0.0.1:17670` inside container → `ControlSupervisorStartFailed`.  
With Fix A: supervisor logs `OCSF NET:OPEN host.docker.internal:17670` → Ready.

Evidence: spike `logs/46-container-inspect.txt`, `logs/50-endpoint.txt`.

### Fix B — workload user

`process.run_as_user/group: sandbox` fails on default image:

`IdentityResolutionFailed: workload user 'sandbox' does not exist in the pinned image`

**Product gap:** pin an image that has non-root `sandbox`, **or** omit process block for ubuntu default. **Never** use `root`.

### Fix C — TLS hygiene

Leftover `OPENSHELL_LOCAL_TLS_DIR` from disposable TLS caused BadSignature until unset. Prefer brew TLS under `/opt/homebrew/var/openshell/tls` for the measured gateway.

### Fix D — name length

Sandbox names max **19** characters.

## Measurable evidence (deny/allow)

| Check | Result |
|---|---|
| Guest cwd `/sandbox` + `touch ./spike-ok` | **WORKDIR_WRITE_OK** (ALLOW) |
| `head -1 /etc/passwd` | OK — baseline RO |
| `cat …/host-secret.txt` (outside guest) | ENOENT · SECRET_EC=1 |
| `ls /Users` | cannot access · USERS_EC=2 |
| Fake signer shape path | cannot access · FAKE_EC=2 |
| Documented real signer path | cannot access · DOC_EC=2 |
| Host secret file after test | still present, unchanged |
| `--no-keep` | sandbox list empty after |

Interpretation: Darwin host tree was **not bind-mounted**, so host secrets are **absent** (ENOENT), not Landlock-EACCES on a mounted path. Matches design rule: do not bind-mount home / jobs / Application Support / signer socket.

Full transcript: spike `logs/53-deny-evidence.txt`.

## Blockers resolved vs residual

| Item | Outcome |
|---|---|
| Docker daemon down | Started Desktop |
| Plaintext gateway | Need mTLS+JWT for Docker |
| 127.0.0.1 callback | Fix A |
| `sandbox` user missing | Fix B partial |
| O08 ordinary-worker ≠ admin | **Residual** — hostile review: single mTLS client class on Homebrew single-user profile |
| Policy schema no filesystem deny | Deny-by-omission only; cannot exclude child of allowed dir |
| Main vs tag feature drift | Spec: inspected main `1358941…` ≠ tag `6648bd0…` — pin one build at metal |

## What the spike does **not** prove

- Gate B / O01–O08 joint pass
- Control-plane separation (O08)
- Landlock EACCES on a deliberately mounted scratch-only path
- Middleware / interceptor governance
- Brokering of `workspace.patch`
- Anything about Peter's installed Electron app

## Fold-forward into this STAGE

| Artifact | Destination |
|---|---|
| Fix A + B + C + D | `plugins/aukora-containment/backends/openshell-sketch.mjs` |
| Policy shape (noproc) | `plugins/aukora-containment/policy/memory-metal-worker.inc1.sketch.yaml` |
| Evidence narrative | this file + ENGINEER-ONBOARD |
| Hostile residuals | job `CLAUDE-HOSTILE-ADAPTER.md` |
