# Confined keyless guest

This reference covers `launchDeveloperAssembly({ guestConfinement: 'macos-seatbelt', ... })` and the `--confined` option of the [source command](README.md). It selects only the four-row `8088-inside-out` Cordis profile and its real `ToolRuntime`. Web and live-turn overlays are refused; ordinary launches are unchanged. This mode requires macOS and working `/usr/bin/sandbox-exec`; unsupported modes, unavailable enforcement, and failed preflight refuse without an unrestricted guest fallback.

## Launch

Build the host artifacts, then use the same exact launch and operation files as the source command:

```sh
pnpm run build:lib:host
pnpm aukora:source-launch --confined /tmp/aukora-launch.json /tmp/aukora-operation.json
```

The parent prepares the fixed profile before guest admission. The guest starts under Seatbelt with plain Node and the bundled `apps/cli/lib/profile-boot.js`, using `profilePreparation: 'read-only'`. It cannot create startup configuration or invoke tsx/esbuild. Workspace dependencies, including AUKORA authority modules, remain external to the CLI bundle. Activation measures the confinement policy, confinement launcher, prepared boot entry and CLI chunks, alongside the existing source and staged-profile inputs.

Every confined ready/result record carries `MACOS_SEATBELT_GUEST / SAME_UID_AUTHORITIES / NO_CUSTODY_CLAIM`. CLI approval remains the parent and issuer's separate fresh challenges. Scripted test replies are not attended human approval. A library parent can retain proposal-specific v5 authority; the JSON source command retains its v4 route.

## Guest access

| Resource | Permission |
| --- | --- |
| Repository `aukora/`, `packages/`, `vendor/`, `node_modules/`; CLI `lib/` and `node_modules/`; prepared profile and resolver fallback | Read-only source/runtime access; root directory and `package.json` are exact reads |
| Node executable, `/System/Library`, `/usr/lib`, `/dev/null`, `/dev/urandom` | Runtime reads; only the exact Node image may execute |
| `guest-home/confined-scratch` | Private read/write scratch; no other filesystem writes except `/dev/null` |
| Issuer private key and broker state | No read or write; activation home is read-only |
| Network | Only the exact broker Unix socket may connect; issuer socket, TCP, listeners, Mach and POSIX shared-memory routes are denied |
| Processes | Fork, detached children, process inspection and signals are denied; the parent tracks the single guest PID |
| Descriptors | Ignored stdin, bounded stdout/stderr pipes, and the direct-parent Node IPC channel; no inherited terminal or extra descriptors |
| Environment | Only `DSH_HOME`, telemetry disable, scratch `HOME`/`TMPDIR`, `LANG`, `LC_ALL`, and explicit macOS `__CF_USER_TEXT_ENCODING`; no credential, PATH, Node hook, or dotenv layer |

Read roots are canonicalized. Admission rejects private-key hard links, multiply-linked code files, private-target aliases, and symlinks outside the selected source installation. A permitted installation symlink adds no grant for its destination. The repository source trees must contain only data acceptable for this guest to read: this is not an arbitrary secret-free repository guarantee. Default denial excludes other home and temporary files. Unrestricted same-UID processes can still change the source installation, key, state, or profile; this mode supplies guest exclusion, not independent custody or protection against that host adversary.

The parent drains and caps guest output at 1 MiB, retains the existing operation timeout, and reaps its authority children on guest or parent loss. Scratch remains in the owned runtime directory after shutdown; there is no aggregate memory, disk, or idle-lifetime quota.

## Enforcement evidence

Before every confined guest spawn, a separate process under the exact policy and environment must write scratch, connect to the live broker, and report over parent IPC. It must observe actual kernel denial of private-key/state reads, private-state/startup writes, fork, issuer connection, and loopback TCP. The parent independently checks its private canary bytes. Missing observations, timeouts, unexpected errors, or changed bytes refuse admission.

The built-runtime tests use disposable local authorities and no model calls:

```sh
pnpm exec vitest run --config vitest.aukora-parent-launch.config.ts scripts/aukora-confined-guest.assembled.ts
AUKORA_TEST_REMOVE_GUEST_RESTRICTION=1 pnpm exec vitest run --config vitest.aukora-parent-launch.config.ts scripts/aukora-confined-guest.assembled.ts -t 'denies protected resources in the actual guest'
```

The second command is an expected-red control: it removes only the actual guest's OS wrapper while retaining the restricted preflight, environment, IPC, authority route, and guest code. The protected issuer-key read assertion must fail. Restore by omitting the variable and rerun the first command. These are macOS enforcement observations, not Linux coverage, attended approval, Web confinement, or installed-custody certification. See the [decision](../../.agents/notes/implemented/architecture/2026-09-06-confined-keyless-governed-guest.md) and [source provenance](confinement-provenance.md).
