Redacted copy: identifiers replaced.

# Nebius H200 Window Report — 2026-09-21 (Bonsai + Ornith preparation)

**Status:** window EXECUTED and closed. Instance STOPPED (provider-confirmed).
Compute billed ≈ $0.59. No training, no inference, no model loads occurred.
This report is self-contained: all evidence below is inline. Lane code lives on
branch `glm/ingestion` (unmerged); nothing here depends on it.

## 1. Resources (measured via read-only CLI, no billing actions)

| Item | Value | How verified |
|---|---|---|
| Instance | `<NEBIUS_INSTANCE_ID>` (`<INSTANCE_NAME>`) | `nebius compute instance get` |
| Preset | `1gpu-16vcpu-200gb`, platform `gpu-h200-sxm` — **one H200** (earlier "8×H200" records were wrong for this instance) | same |
| Boot disk | 200 GiB, 4 GB free (99% full) | on-instance `df` via SSH |
| Data disk | `<NEBIUS_DISK_ID>`, **186 GiB NRD, READY, attached RW** | `nebius compute disk list` + instance config |
| SSH | `aukora@` + `~/.ssh/<SSH_KEY_NAME>` (ubuntu/root denied) | live SSH handshake |
| Public IP (at runtime) | `<PUBLIC_IP_ROTATES>` (rotates per start) | instance `public_ip_address` field |
| Ornith revision pinned (read-only HF metadata, no download) | `ornith-ai/Ornith-1.5-35B-A3B` @ `10fbf86fed7ecee4a061f8b499a618f46001cac1` | HF API |
| Bonsai revision pinned | `prism-ml/Ternary-Bonsai-27B-gguf` @ `86e89f34c93201c3dfd5e5880fedb0022fc7e34d`, pack `Q2_g64` (local pack verified separately at 9.2 tok/s) | HF API + local run |

## 2. Timeline (all times local, 2026-09-21)

| Step | Result |
|---|---|
| Disk created (186 GiB NRD, per recorded storage authorization) | `<NEBIUS_DISK_ID>`, READY |
| Disk attached to stopped instance | accepted, visible in instance config |
| Instance start #1–2 | silent failures (async op died); executor retried correctly |
| Instance start #3 | **RUNNING**, IP resolved, SSH (`aukora@`) succeeded |
| Disk gate (first remote command) | **DISK_HEADROOM_FAILED: 4 GB free vs 95 GB needed** — exported, no deletion, no substitute model |
| Provider stop + STOPPED reconfirmed | `<NEBIUS_OPERATION_ID>`; `get` reports `STOPPED` |
| Later start attempts (capacity probe) | `NotEnoughResources — VM schedule timeout` ×4 (incl. one STARTING→STOPPED reversal) |

## 3. Costs (measured + reference)

- Compute billed this session: **~467 s ≈ $0.59** (the disk-refusal window only).
- Recurring storage from today: boot ~$20/mo + data 186 GiB NRD ≈ **$9.86/mo** (public reference $0.0530/GiB-month; confirm on the console invoice).
- Reference compute rate: 1×H200 ≈ **$4.50/GPU-hour** → ~$18 per 4 h window. A 4-hour Bonsai window fits the recorded $50 ceiling with wide margin.

## 4. Findings that change the plan

1. **Provider start/stop require `--parent-id <NEBIUS_PROJECT_ID>`** (the handoff's command was right; bare calls fail).
2. **IP resolver must prefer `public_ip_address` and strip `/32`** (the private `<PRIVATE_IP>/32` is unreachable from here).
3. **SSH user is `aukora`** (ubuntu/root denied).
4. **CLI `update` hangs without a TTY** — all provider calls need `stdin=DEVNULL` + bounded timeouts.
5. **Fresh attached disks are unformatted**: blank-check (`blkid`), then `mkfs.ext4` + mount (safe: volume created empty; non-blank volumes must refuse).
6. **Capacity is a real gate**: H200 `NotEnoughResources` persisted across the evening — windows must treat scheduling as uncertain, never assumed.

## 5. What's ready for the next window

- Executor with manifest-pinned package upload, data-volume gates on `/mnt/glm-data`, deadline tied to instance start, on-instance poweroff timer + provider-side stop with STOPPED reconfirmation, partial evidence export on every path.
- `setup_bonsai.sh`: mount-verify → PrismML fork CUDA build → PQ2_0 download at the pinned revision → llama-server → frozen A/B/DIAG/C comparison → export → stop.
- Strict output contract, sealed evaluators, frozen splits, refusal-by-name (never empty baselines).
- Remaining gates: H200 capacity, recorded spending ceiling per window, owner go.

## 6. What this window proves

A governed cloud run can start an instance, measure its own infeasibility (4 GB vs 95 GB),
export the finding, and shut itself down inside the authorization — spending $0.59 to learn
exactly what the next window needs. A negative result with receipts beats an assumed success.
