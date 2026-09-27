# Local launchd custody pair

English | [中文](README.zh.md)

This directory contains the macOS LaunchDaemon templates and example input for provisioning the issuer/broker custody prerequisite. [`scripts/install-launchd-custody-pair.mjs`](../../scripts/install-launchd-custody-pair.mjs) creates or verifies three service principals, installs two daemons, stages the authority implementation outside the checkout, and runs active cross-principal probes. A successful report has status `PROVISIONED_DAEMON_PAIR`; it is not a complete product or custody claim.

## Installed topology

The installer creates exact hidden, login-disabled broker, issuer, and guest accounts with distinct numeric UIDs. It creates separate broker-route and issuer-route groups. Among these two managed route groups, the guest belongs only to the broker route group; the broker belongs to both; the issuer belongs only to the issuer route group.

Only the broker and issuer receive LaunchDaemon jobs. Their fixed routes are `/private/var/db/aukora/run/broker/broker.sock` and `/private/var/db/aukora/run/issuer/issuer.sock`, and the broker publishes a third node, the review route, beside its own. That route is published `0600` rather than `0660`: its parent's group contains the guest, so the mode is what keeps the guest off the approval channel. The installer does not custody-observe or probe it. The immediate socket parents are owned by the respective service account and primary group with mode `0710`, and the sockets are published with mode `0660` under the [installed group socket policy](../../.agents/notes/implemented/architecture/2026-08-30-installed-group-socket-policy.md). The templates intentionally omit `StandardOutPath` and `StandardErrorPath`; they do not open service-owned log leaves, and process output remains under launchd's default handling. The guest identity exists so the installer can exercise the denied and allowed routes under the future guest's numeric principal; there is no guest job.

Every generated job uses an explicit `implementationRoot`. The installer copies the frozen verifier graph, its selector, the closed custody helper, the allowed Noble dependency packages, and a canonical manifest into that content-addressed directory under `/private/var/db/aukora/implementation/`; the directory basename must equal the manifest SHA-256. Staged directories must be root-owned `0555` and files root-owned `0444`. Custody checks reject every extended ACL, including deny-only ACLs, and refuse unavailable observations; they never remove ACLs. Runtime bytes must match the operator's `nodeSha256` before and after installation. The report hashes the observed runtime and implementation identities together; it does not attest loaded pages, dynamic libraries, or the loaded environment. Live argv confirms the executable and entry module. These observations are neither off-host nor root-resistant custody.

## Input and operation

[`custody-pair.example.json`](custody-pair.example.json) is the closed input format. Copy it to an untracked path, confirm or select unused numeric IDs, retain the content-addressed `implementationRoot` for these exact staged files, and inspect every absolute path before applying it. A change to the frozen graph, selector, or custody helper requires a new manifest digest and therefore a new implementation leaf. Existing accounts, groups, jobs, directories, or implementation files are accepted only when their observed identity and contents match exactly; the installer does not delete or repair conflicting host state.

The `v2` input requires `nodeSha256`. The example's all-zero value is deliberately non-operational: replace it with the digest of the selected, independently inspected runtime before applying. Older input documents refuse. Hashing an unknown executable does not make it trustworthy. The example's `reviewServerId` is a placeholder in the same sense: it is the identity a terminal pins, so replace it with a value unique to this host rather than copying the example.

`--apply` also requires the terminal's public key to be in place before it runs. The installer creates the root-owned `/private/var/db/aukora/review/` directory but never writes this file and never handles the terminal private key: place the public half yourself, owned `root:wheel` with mode `0644`, at the `reviewTerminalPublicKeyFile` path in the plan. Root ownership is what stops the broker replacing the key it is held to. An absent, wrongly owned, or non-Ed25519 key refuses during identity provisioning, before either property list is written.

The activation statement is placed the same way and in the same leaf. It records the digests of the staged implementation the broker will run, plus the selections a launcher declares: composition, proposal cell, renderer, model-emission policy, and the issuer and broker identities. Its digests are measured; those selections are declarations the operator owns, because an installed broker governs a composition that is not itself installed.

```bash
sudo install -d -o root -g wheel -m 0755 /private/var/db/aukora/review
sudo install -o root -g wheel -m 0644 terminal.pub /private/var/db/aukora/review/terminal.pub
sudo install -o root -g wheel -m 0644 activation.json /private/var/db/aukora/review/activation.json
```

```bash
cp ops/launchd/custody-pair.example.json /tmp/aukora-custody-pair.json
```

Run `--apply` from an installation path whose every ancestor is root-owned without group or world write; the mutating path refuses `launchd-install:invocation-tree-untrusted` otherwise. `--check` never takes this gate.

Prepare that path with [`scripts/stage-launchd-operator-seat.mjs --prepare`](../../scripts/stage-launchd-operator-seat.mjs) rather than copying a working checkout. Preparation is unprivileged and takes its sources from one resolved commit, so uncommitted edits, untracked files, `.env`, sessions and the user's Git hooks and configuration cannot reach the result. Every pinned Git read runs under an environment allowlist, so `GIT_DIR`, `GIT_OBJECT_DIRECTORY` and the other repository, object, index and work-tree pointers cannot redirect a pinned read to another repository, and each read also confirms the working tree it resolved is the intended one. It runs no package manager, so no install hook runs at any privilege. Dependencies are written as bytes inside the prepared path, and the command refuses a path that borrows Git objects from another repository, carries a symlink escaping itself, or cannot reproduce the seat manifest digest with its own stager.

```bash
node scripts/stage-launchd-operator-seat.mjs --revision <commit> --prepare /tmp/aukora-prepared
```

The operator then places that prepared path root-owned and runs the privileged commands from it. Only these steps need privilege:

```bash
sudo install -d -o root -g wheel -m 0755 <repo-root>
sudo cp -R /tmp/aukora-prepared/. <repo-root>
sudo chown -R root:wheel <repo-root>; sudo chmod -R go-w <repo-root>
sudo node <repo-root>/scripts/install-launchd-custody-pair.mjs --inputs /tmp/aukora-custody-pair.json --apply
sudo node scripts/install-launchd-custody-pair.mjs --inputs /tmp/aukora-custody-pair.json --check
```

Both modes require Darwin and effective UID 0. `--apply` creates absent managed records and files, provisions the issuer and broker keys through helpers running as their final service principals, installs the two property lists, bootstraps issuer before broker, and observes the result. A successful `--check` leaves no durable provisioning changes: it acquires and removes the root-owned exclusive installer lock and performs active key and socket observations. Interruption can leave the fail-closed `/private/var/db/aukora/.install.lock` for operator inspection and removal before another run. A failed apply can leave visible accounts, groups, directories, keys, implementation files, or property lists for inspection; it rolls back only jobs loaded by that invocation when later observation fails.

The installer verifies each live job's PID, numeric UID, Node executable, and authority entry module. It then requires these positive controls: guest-to-broker connects, broker-to-issuer connects, the issuer can open its private key, and the broker can open its state key. It separately requires `EACCES` or `EPERM` for guest-to-issuer, issuer-to-broker, broker-to-issuer-key, guest-to-issuer-key, guest-to-broker-state, and issuer-to-broker-receipt-key. A missing path is not accepted as deprivation evidence.

## Generator-only use

[`scripts/generate-launchd-jobs.mjs`](../../scripts/generate-launchd-jobs.mjs) remains available when an operator needs only validated property lists. Its input requires the same explicit `implementationRoot`, distinct principal and route-group names, separate route parents, canonical Ed25519 public keys, and state and secret paths outside the checkout. It escapes XML values, refuses unsafe labels and unresolved placeholders, validates both property lists with `/usr/bin/plutil -lint`, and creates output leaves exclusively without following links or replacing existing entries.

Generation validates declared input; it does not resolve numeric identities, create host state, load jobs, or run active probes. A generator report is not `PROVISIONED_DAEMON_PAIR` evidence.

## Review adapter

[`serveBrokerWithTerminalReview`](../../scripts/launchd-broker-review.mjs) supplies the existing broker's review callback through a bounded Unix-socket transport. The terminal retains its Ed25519 private key; the server pins only its public key. Signed answers bind the connection, role, route, review/proposal IDs, and artifact/operation/authorization digests. A missing terminal, disconnect, stale answer, or deadline refuses. Tests use scripted terminal and issuer fixtures. [`scripts/launchd-broker-entry.mjs`](../../scripts/launchd-broker-entry.mjs) is the broker job's program and reaches the adapter from a launchd environment, which cannot supply the parent-IPC review callback the standalone broker reads. The entry requires a review route and refuses `launchd-broker-entry:review-route-required` without one, so an installed broker cannot start unreviewed. The plan carries the review route, the operator-placed terminal public key, and the pinned route identity, and the installer renders them into the broker job. That key file is root-owned under `/private/var/db/aukora/review`: the broker reads it once at startup and cannot replace it, because a broker that could replace it could manufacture its own approvals; rotating or revoking that key therefore takes effect only when the broker job is restarted. The installer never creates it and never handles the terminal private key. The generated job carries an activation digest, and that digest is transport rather than evidence: the entry reads a retained `ActivationStatement` from a fixed name inside the implementation root, requires it to name the broker, the entry, the review adapter, the transport and the activation modules, re-measures every member against the staged bytes, and refuses unless the re-measured statement digests to exactly the value the job carries. The statement's path and the interpreter it measures are derived rather than configured, so the property list chooses neither. The installer performs the same measurement before either property list is written. A digest no measured statement produces never reaches the broker, and a changed authority byte changes the digest. Under that binding the rendered program settles one reviewed, issuer-authorized memory effect, measured by running it with the rendered environment against an implementation root holding exactly the staged bytes. The operator terminal below joins the issuer carrier to this authenticated review session. A guest launcher and an attended installed run remain unmeasured. Key possession authenticates a terminal session, not a person.

## Staging the operator seat

[`scripts/stage-launchd-operator-seat.mjs`](../../scripts/stage-launchd-operator-seat.mjs) publishes one root-owned tree to attach the seat from. It stages the existing entry and nothing else: no service is started, no route connected, and nothing approved.

Source bytes come from `git cat-file` at one resolved commit, never from the working tree, so uncommitted edits cannot reach the artifact and the report says whether the tree was dirty. Dependency bytes are not in Git, so they come from this checkout's installed packages through the same snapshot the installer uses, which reads through pnpm's symlinks and refuses anything that is not an exact regular file; the manifest pins them by version and per-file digest. The manifest names the source commit, and its digest is the staged root's required basename, so `--check` recomputes the expected root and compares.

```bash
node scripts/stage-launchd-operator-seat.mjs --revision <commit> --root /private/var/db/aukora/seat/<digest> --check
sudo node scripts/stage-launchd-operator-seat.mjs --revision <commit> --root /private/var/db/aukora/seat/<digest> --apply
```

Run `--check` first with any placeholder digest: the refusal names the digest the root must carry. The seat stager's `--check` takes no admission gate, so it stays available unprivileged and read-only, and for that same reason a passing `--check` is not a prediction that `--apply` will be admitted. The installer's `--check` is a different thing: it performs active key and socket observations and requires root.

`--apply` runs from the prepared installation path described above, not from a working checkout:

```bash
node scripts/stage-launchd-operator-seat.mjs --revision <commit> --prepare /tmp/aukora-prepared
```

The preparation report names the commit, every dependency with its version, and the seat manifest digest the prepared path reproduced.

`--apply` takes the same invocation-custody admission as the installer's `--apply`, and takes it before the revision is read, before dependencies are snapshotted, and before any filesystem effect: every ancestor of the running installation path must be root-owned without group or world write, or it refuses `launchd-install:invocation-tree-untrusted` having done nothing. The bootstrap that satisfies it is the one above — place the installation path root-owned and run the privileged command from there. There is no override, and the manifest digest is not one: a digest the command computed about its own output states which bytes would be staged, never that staging is approved. Once admitted, `--apply` creates `/private/var/db/aukora/seat` root-owned `0755` and publishes files `0444` and directories `0555` under `root:wheel`, through the installer's own publication path. An existing root is never rewritten, only observed, so a staged root that already differs is reported rather than repaired.

Each report keeps its residual limits. `--apply` carries `installation-path-bytes-unattested`: admission establishes custody of the executing path, which the owner placed, not provenance of what it contains. `--check` carries `check-mode-admission-not-taken`. Both carry `attended-seat-attachment-not-performed`: staging makes the seat runnable and nothing more.

## Operator terminal

Run `node scripts/launchd-operator-review.mjs --help` from the repository root for the exact command. The installed mode requires Darwin and root, and attaching additionally requires every ancestor of the tree it runs from to be root-owned without group or world write, refusing `aukora:operator-review:invocation-tree-untrusted` otherwise. A home-directory checkout fails that gate on the home directory itself, and `/private/tmp` fails it on mode `1777`. `--check` does not take the gate, so a preflight that passes from an untrusted tree does not mean the attach will. Stage the seat first, as the preceding section describes, and attach from that tree. Supply an existing root-owned custody plan, a root-owned `0600` terminal private key matching the plan's public key, and an already provisioned issuer-only group. The issuer route group is unsuitable because the broker belongs to it. The command refuses other or nested group members, extended ACLs, writable ancestors, and an occupied approval route; it never provisions identities, replaces keys, removes existing routes, or restarts services.

```bash
sudo node scripts/launchd-operator-review.mjs --inputs ABSOLUTE_JSON --private-key ABSOLUTE_TERMINAL_PEM --approval-group ISSUER_ONLY_GROUP --check
sudo node scripts/launchd-operator-review.mjs --inputs ABSOLUTE_JSON --private-key ABSOLUTE_TERMINAL_PEM --approval-group ISSUER_ONLY_GROUP
```

The uppercase arguments are operator-supplied values, not example files. The plan must name the fixed issuer approval route with `issuerApprovalSocketUid: "0"`. The broker must already serve the plan's review route. `--check` only inspects prerequisites; it neither connects nor approves. After the terminal reports ready, any required issuer deployment/restart is a separate attended operation using that same route. Ctrl-C closes the terminal and its own socket without stopping either daemon.

A broker artifact approval permits one matching issuer challenge before the deadline. The terminal renders that challenge separately; it does not auto-approve. Disconnects discard outstanding approvals. `scripts/launchd-issuer-review.spec.ts` runs the production broker, issuer process, signing, and operator transport over disposable state, including KIRA settlement and broker-restart recall. Only terminal decisions are scripted. This does not establish installed UID isolation, human attendance, or operational AUMLOK identity binding.

## Claim ceiling

The installed pair is one prerequisite for the OS-confined product path. It does not complete [Wayfinder issue #3](https://github.com/aumara-xyz/aukora-deep/issues/3) or full custody. The following product requirements remain absent or unmeasured:

- no guest LaunchDaemon or parent activator;
- no trusted renderer in the human login session;
- no measured attended product turn through this installed pair; terminal decisions in automated fixtures are scripted, and the composition declared by activation is not a measured installed guest;
- no guest network deprivation or complete recursive runtime closure measurement;
- no installed-guest extended-ACL attack/control measurement; installer ACL checks alone do not prove that result;
- no confinement of ambient supplementary groups inherited by service principals;
- no binding between the operational issuer key and verified AUMLOK control history;
- no attestation of the environment values held by loaded launchd jobs;
- no retained runtime-manifest or loaded-page attestation; the byte pin and combined report digest cover observed files only.

The pair therefore proves only the installed identities, observed root ownership and read-only POSIX modes for staged authority bytes, two running daemon principals, route reachability, and named secret denials recorded in its report. Independent topology courts, extended-ACL write-exclusion measurement, and a settled end-to-end product turn remain required before a broader claim.
