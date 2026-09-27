# Same-UID source launch

English | [中文](README.zh.md)

This reference describes the source-only parent launcher in [`developer-launch.mjs`](developer-launch.mjs). It starts the canonical broker, issuer, and an `8088-inside-out` Cordis guest as three direct child processes; runs the guest with governed Loader semantics; does not inject the issuer route or signed grant artifact into the guest composition or protocol; and reaps every direct child on shutdown or child loss.

Every process runs under the invoking UID. Ordinary launches prove an assembled process route and parent-owned review callback, not key custody, OS confinement, peer authentication, immutable activation, or protection from a hostile same-UID guest; their ready records say `SAME_UID_PARENT_LAUNCH / NO_CUSTODY_CLAIM`. The opt-in [confined keyless guest](confined-guest.md) applies OS restrictions to the fixed 8088 guest and reports its distinct observation class, without claiming independent custody.

## Configuration

Build the host packages before launching:

```sh
pnpm run build:lib:host
```

The launcher accepts one exact JSON object. `runtimeDir` must be an absolute normalized path that does not exist. For `aukora:source-launch`, the private key is an Ed25519 PKCS8 PEM owned by the invoking user with mode `0600`; the public key is its SPKI PEM counterpart. `kiraSubject` and `kiraPrivacy` are an optional pair for that command. Privacy is a non-empty unique subset of `local`, `exportable`, and `private`.

```json
{
  "schema": "aukora:developer-launch:v1",
  "runtimeDir": "/tmp/aukora-source-run",
  "rootPrivateKeyFile": "/tmp/aukora-source-keys/root-private.pem",
  "rootPublicKeyFile": "/tmp/aukora-source-keys/root-public.pem",
  "kiraSubject": "aukora:subject:owner",
  "kiraPrivacy": ["local", "private"]
}
```

The source-launch JSON command has no subject-authority field, so it keeps the v4 proposal route. A library parent can select v5 through `launchDeveloperAssembly()`'s `createSubjectAuthority(activationDigest)` factory.

The optional second file is one exact operation. It is inert input until the real guest passes it through `ToolRuntime`, the pinned WASM proposal cell, broker-owned parent review, issuer confirmation, and settlement.

```json
{
  "key": "demo.source.launch",
  "value": {
    "guest": "cordis",
    "proposalCell": "wasm"
  }
}
```

Run one operation and exit:

```sh
pnpm aukora:source-launch /tmp/aukora-launch.json /tmp/aukora-operation.json
```

One parent-staged overlay, [`live-turn.overlay.yml`](live-turn.overlay.yml) line 6, inserts `aukora-kira`, `session`, `agent`, `agent-loop`, and one DeepSeek LLM into the staged guest without editing `profiles/8088-inside-out/cordis.patch.yml`. The companion command runs one user turn and still leaves the parent `yes <challenge>` artifact frame as the only write door:

```sh
pnpm aukora:live-turn /tmp/aukora-launch.json /tmp/aukora-turn.json [--control-dir PATH]
```

```json
{
  "schema": "aukora:live-turn:v1",
  "prompt": "Store one object at live.turn"
}
```

The command creates or authenticates the same persistent local AUMLOK controller used by `aukora:web`, defaulting to `~/.aukora/local-control-v1`. Controller keys select the issuer and its active control selects the KIRA subject and proposal-specific v5 authority. The v1 launch file's key paths remain required for compatibility with the shared parser but do not select live-turn authority. An optional `kiraSubject` must equal the controller's subject; `kiraPrivacy` is retained when supplied and otherwise defaults to `private`.

Without `DEEPSEEK_API_KEY` the turn refuses `supervisor:model-credential-missing` and writes nothing. A fixture adapter is a test overlay only (`AUKORA_LIVE_TURN_FIXTURE=1`); it receives the parent-selected subject and privacy policy and still cannot skip the parent yes. `8088-inside-out` remains the idle inventory profile.

`aukora-kira` mounts `kira.stage` and `kira.recall` for the staged turn only, so the idle profile keeps the tools it always shipped. Staging authorizes nothing: the tool returns a deterministic `recordId` beside the inert `memory.put` arguments that write it. The broker refuses a KIRA write unless the staged record subject and privacy match the parent-owned policy and a proposal-specific v5 delegation binds that subject, active control, activation, operation, resource, audience, and budget. Recall lets the model select only an optional record kind; the broker owns state access and Aura citations.

The fixture turn runs the staging and write hops in order — `kira.stage`, then `memory.put` with the arguments the reply carried — so a settled object is stored under the record identifier KIRA derived rather than a key the caller chose. The separate keyless headless snapshot restarts the broker and guest, then dispatches `kira.recall` and pins the returned local Aura citation. Removing the overlay entry changes the overlay bytes, so the launch refuses at validation before any broker starts.

Recall does not open a per-call approval or produce a grant, nonce, receipt, or Aura effect. The official Cordis path logs `kira/recall`, but this same-UID source launch does not stop another plugin that can reach `broker.sock` from sending the raw recall frame without that session event. Complete mediation still requires OS or WASM confinement.

## Web launch

Run the loopback Web assembly on port 5173, or select another port and controller directory:

```sh
pnpm aukora:web [--port 1..65535] [--control-dir PATH] [--data-dir PATH] [--review-config PATH] [--operator-home CANONICAL_ABSOLUTE_HOME] [--workspace NAME=CANONICAL_ABSOLUTE_DIR ...]
```

The command creates or authenticates one persistent local AUMLOK controller at `--control-dir`, defaulting to `~/.aukora/local-control-v1`, and keeps the state that outlives one launch under `--data-dir`, defaulting to `~/.aukora/web-data-v1`. The two must not overlap, neither may sit inside the checkout, and each must be a directory the invoking uid owns with mode `0700`. The data root holds the DSH home carrying sessions and settings, the guest home, and the broker state carrying KIRA objects, receipts, Aura, and authority evidence, so a complete parent restart re-enters them. Its activation epoch is recorded once beside that state and its broker route is a fixed platform location derived from the root rather than from `TMPDIR`, so one deployment keeps one activation; every other member of the statement is still measured per launch, and a changed composition, module, key, or policy is still refused. `dsh` composes a home patch layer above the staged profile, so a `cordis.patch.yml` in that DSH home is refused at launch and at every guest spawn rather than mounted. It derives the issuer key, KIRA policy, and proposal-specific grant-v5 authority from that controller. The five non-secret projection fields are bound into the activation and exposed to the AUMLOK browser surface through one loopback same-origin endpoint; private keys, controller paths, broker routes, state paths, and approval material never enter the response. POSIX owner and mode checks under one UID do not establish independent human-key custody.

The default preset exposes `auma_canvas_read`, `auma_canvas_render`, `kira.recall`, `kira.stage`, `memory.put`, and `workspace.patch`. Operator-configured Capsule staging preserves those allowances and adds `capsule` for the lead, not the worker. The launcher writes an `aukora:parent-web-ready:v3` operator record containing `READY`, the URL, access mode, observation class, broker/issuer/guest PIDs, broker/issuer routes, state directory, public AUMLOK projection, and activation artifact. Its `globalTools` list is not the session-scoped catalog. `SIGUSR1` replaces only the guest and writes an `aukora:parent-web-restart:v2` record containing `RESTARTED` and the three lifecycle PIDs. The URL and five-field AUMLOK projection are browser input; lifecycle PIDs, authority routes, state directory, and activation artifact remain parent-side evidence and never enter Web responses or executed browser content.

`--operator-home` explicitly enables native coding in that same `aukora` preset: existing file, shell, job, goal, skill, planning and compaction tools plus Council. The path must be an existing canonical directory owned by the invoking user without group/other write access. It becomes the guest's `HOME` for installed CLI authentication; `DSH_HOME`, sessions, models, controller and broker state retain their existing locations. The home and selected preset enter activation measurement. Supply the same option to retained upgrade and replacement launch. `OPERATOR_NATIVE_WITH_BROKERED_EFFECTS` preserves workspace-write and ask defaults; retained session policies take precedence, including Full access. Native tools and workers are not brokered, need not prompt on every action, and produce no AUKORA settlement receipt. Only the two brokered effects use the owner popup. Provider availability and billing require separate evidence; enabling this mode does not authorize paid calls. See the [operator-mode decision](../../.agents/notes/implemented/feature/2026-09-14-web-operator-coding.md).

The Web parent forwards only `DEEPSEEK_API_KEY` and optional `DEEPSEEK_BASE_URL` from its own environment. Credentials saved by a different ordinary 5173 launch are not reused because this command owns its own DSH home under `--data-dir`; browser-saved settings in that home now survive both a guest-only `SIGUSR1` restart and a complete parent restart onto the same data root. `OPENROUTER_API_KEY` is not currently forwarded by this command.

The keyless browser acceptance registers a real workspace and session, submits through the composer, drives the model loop through `kira.stage` and governed `memory.put`, and supplies test-scripted decisions at the parent and issuer terminal prompts. It verifies the Aura entry and stored object, restarts only the guest while broker and issuer PIDs remain stable, opens a fresh browser session, and requires `kira.recall` to render the exact retained Aura citations. Its refusal controls require a scripted parent denial to add no second Aura entry and a corrupted object to return `undetermined / memory-unverified`, never `empty`. This remains a same-UID v5 test with scripted decisions, not proof of attended human approval, OS confinement, or custody.

The command first prints a `READY` record. It re-derives the approval artifact, renders it, and asks for a fresh parent challenge, then forwards the issuer's independent artifact prompt. Only the exact `yes <challenge>` answer approves each step. Its `aukora:source-launch-result:v1` record carries `SETTLED`, `REFUSED`, or `INDETERMINATE`; the process exits `0`, `2`, or `3` respectively. Launch and lifecycle failures exit `1` without relabeling a possibly executed effect as a refusal.

Run the assembled source lane, which builds the Host and Client artifacts it consumes:

```sh
pnpm run test:aukora-parent-launch
```

Omit the operation file to keep the assembled processes alive until `SIGINT` or `SIGTERM`:

```sh
pnpm aukora:source-launch /tmp/aukora-launch.json
```

## Reconnectable owner terminal

`--review-config` moves both approval prompts to a separately connected terminal. The assembly can run with closed stdin under an operator-selected service owner. Disconnecting the approval terminal does not stop the broker, issuer, or Web guest; recall remains available. Without an authenticated terminal, new writes refuse. Losing the terminal during issuer review sends no decision: the issuer expires the unanswered request. A new connection can approve only future operations, not resume an earlier connection's approval.

The configuration is an exact JSON object with `domain: "aukora:web-review-config:v1"`, `socketPath` (absolute Unix route), `subject` (the existing AUMLOK subject), and `terminalPublicKeyPem` (canonical Ed25519 SPKI). The file must be a single-link regular file, owned by the invoking uid with mode `0600`; its directory and the socket directory must be canonical, owned `0700` directories. Use a separate terminal authentication key, not the controller's signing key. No keys or service configuration are generated automatically.

Connect the owner terminal with:

```sh
node scripts/aukora-web-review.mjs --config /absolute/review.json --private-key /absolute/terminal.pem
```

The issuer prompt has a 20-second transport ceiling, below the assembly callback's 25-second ceiling. The broker-artifact prompt has a 30-second ceiling instead, five seconds inside the broker's own 35-second IPC wait so the deadline cannot outlive the broker awaiting it: nothing downstream of that stage holds a signed deadline, and a reader must see the complete operation before deciding. The transport refuses at startup any artifact window above that bound, and the owner UI refuses any view window above the transport leg that would cut it short. Neither window is unbounded and the artifact's own signed expiry still bounds both. The client renders the exact operation and requires its fresh challenge; issuer review separately renders the issuer's complete frame and requires its independent challenge. Signatures bind both decisions to one connection, authorization digest, expiry and exact prompt. Key possession authenticates a terminal, not a human; this same-UID route does not establish independent custody.

### In-chat approval popup

Add `--browser` to connect the existing AUKORA chat approval card to the owner transport. The command opens the app at `http://127.0.0.1:5173`; `--app-url ORIGIN` selects another explicit loopback app origin. No separate approval website is served. Parent and issuer appear as two separate native modals, each requiring a fresh button click. The complete terminal-format record remains visible. The private signing key stays in the owner process, and decisions bypass guest RPC. An approval result is not settlement or receipt verification.

```sh
node scripts/aukora-web-review.mjs --config /absolute/review.json --private-key /absolute/terminal.pem --browser
```

The API binds only `127.0.0.1`. The app removes the single-use pairing fragment before making owner requests; pairing expires after five minutes. The browser retains an eight-hour token in tab session storage and sends it only through explicit authorization headers to the owner API; cookies would leak it across localhost ports. Exact Host/Origin checks, an explicit app-origin CORS allowlist, and bounded JSON requests constrain the API. Operation text is rendered literally in the existing approval card. This shares the app's browser execution environment: it does not isolate credentials from compromised app scripts, protect against another process with the same OS identity, or establish human attendance.

Keep the paired chat open while proposing an operation. Expired, cancelled, duplicate, or stale decisions cannot approve a new request; an absent browser denies pending review after ten seconds without polling. The owner API can reconnect its transport for future requests without restarting the guest. After an unexpected transport disconnect the service re-attaches the same configured transport on a bounded exponential backoff — six attempts within about twelve seconds — and then settles at `disconnected`; an explicit `/api/reconnect` replaces the pending budget with one immediate attempt, and re-arms the backoff from zero when that attempt fails, so a transport that returns afterwards needs no second operator action. Closing the owner service stops approval only. For host-managed launch, `--port PORT` selects the owner API listener; `--pairing-file PRIVATE_NEW_FILE --no-open` writes the private one-use URL exclusively into a canonical owner-only directory instead of opening the app. Never expose that file or URL to agent-visible chat or shared logs.

The activation includes the review configuration digest, adapter, client, transport and owner-browser assets. A populated deployment bound to different source bytes refuses `broker:activation-state-conflict`: adding `--review-config` does not authorize migration. Use the explicit upgrade below; do not delete the binding or choose an empty store. Installing a background owner remains a separate attended operator step.

The chat shows **Reconnect approval** when the transport disconnects. Reconnecting clears stale presentation and admits future requests only; it never resubmits a decision. Expired or invalid browser credentials require a fresh private pairing link. With `--review-config`, the launcher does not also read approval from stdin: an attached terminal alone is not a fallback. To use terminal review, stop the browser reviewer and run the same owner-client command without `--browser`, retaining its configuration and key.

## Retained-state Web upgrade

The POSIX-only [upgrade command](../../scripts/aukora-web-upgrade.mjs) authorizes one legacy v1 activation binding to the reconnectable Web launch. Stop the existing deployment cleanly first, retain its original controller and data directories, and prepare the private review configuration above. Build the reviewed checkout, then run from a real terminal:

```sh
node scripts/aukora-web-upgrade.mjs --data-dir /absolute/data --control-dir /absolute/control --review-config /absolute/review.json --port 5090 --workspace project=/absolute/workspace --rollback-bundle /absolute/private-recovery/rollback.json
```

The command measures the target through the existing Web profile writer and ActivationStatement builder in disposable staging; it does not publish a profile or start services. It locks the populated broker state, verifies its directory seal, Aura/object/projection evidence and settled nonce burns, and presents the complete transition with a fresh `upgrade <challenge>` prompt. Approval expires after 120 seconds. Both existing controller keys sign the old binding hash, next statement, retained-state digest, controller identity, receipt-key identity and fresh nonce. The atomic replacement changes only `activation.json`; normal launch never rebinds a store.

On `ACTIVATION_UPGRADED`, start `pnpm aukora:web` from the same checkout and Node executable with the same port, control, data and review configuration. Its measured digest must match the approved statement. Recalling retained memory requires no reviewer; writing requires a connected owner and two fresh approvals. The upgrade neither starts a background service nor modifies the ordinary 5173 workbench profile.

A busy lease, changed evidence, unresolved intent, malformed nonce record, missing settled burn, wrong signer or expired approval refuses. Stores exceeding 8,192 entries or 128 MiB refuse this bounded operation. Once publication is attempted, an uncertain outcome preserves the lease and complete old or new binding for explicit inspection: do not remove the lock, retry automatically, or copy an old binding over it. The forward command accepts either persisted binding format — the one-time legacy v1 record or a record a previous upgrade wrote — so a store can be rebound to a later measured target without discarding it. An upgraded predecessor is re-verified against the retained controller before it is accepted, and its exact retained bytes, never a reconstruction, are what a rollback restores. Re-proposing the activation a store is already bound to refuses, as does a pin naming any activation other than the current one.

Memory-object and key-projection checks apply only to validated memory entries; unknown effect definitions refuse. Each workspace entry requires its persisted receipt, authenticated against the retained broker key and matched to the Aura fields and retained workspace mapping. Only the latest settlement per destination must match the current file, including its signed observation and request digest; replaced historical contents need not remain on disk. Changed, missing or linked destinations refuse at preparation and commit. Workspace-only history requires no fabricated memory objects or keys.

Same-UID and `NO_CUSTODY_CLAIM` still apply. Receipt authentication does not prove human attendance or independent custody. Legacy memory history keeps its existing evidence checks; absent historical signatures are not recreated. The controller signature authorizes this transition only. The [decision note](../../.agents/notes/implemented/architecture/2026-09-07-retained-web-activation-upgrade.md) records these limits and the failure semantics.

Repeat `--workspace NAME=CANONICAL_ABSOLUTE_DIR` for every alias on both upgrade and replacement launch. The mappings enter the activation measurement; omitting or changing one produces a different statement. Malformed, duplicate, noncanonical, or protected-root mappings refuse before approval or retained-state mutation.

To include coding workers, pass the same `--capsule-config /absolute/capsule.json` to both commands. Prepare `dataDir/capsules` separately as an existing canonical, owner-private `0700` directory. Target measurement requires that directory and a nonempty workspace mapping, reads the retained broker receipt key, and stages the exact worker, checks, aliases and lead preset used by launch. Preparation does not create the directory or invoke a worker. A popup-only upgrade does not authorize adding Capsule afterward.

For an established controller that has never settled a write, explicitly supply `--expected-previous-activation SHA256` with the observed legacy binding. The pin must match; the existing controller, broker key and directory seal remain required. Zero history is accepted only with no object, projection, nonce or receipt residue. No history is created.

### Preauthorized failed-start rollback

The optional `--rollback-bundle` names a nonexistent file under an existing canonical private `0700` directory outside the control and data directories. The terminal displays both exact operations; one answer authorizes the upgrade and its narrowly bounded reversal. Before upgrading, the command durably saves both controller-signed authorizations and the original activation bytes in that `0600` file. Omitting the option explicitly warns that no rollback is preauthorized.

If the replacement fails readiness, stop it cleanly, then run from the candidate checkout:

```sh
node scripts/aukora-web-rollback.mjs --data-dir /absolute/data --bundle /absolute/private-recovery/rollback.json
```

The bundle expires fifteen minutes after forward-operation preparation. Rollback requires an idle broker lease, the exact signed upgraded binding, the same controller and broker key, and unchanged broker-owned state. Any subsequent effect, nonce, unresolved residue or evidence change refuses; nothing is rewound. A private authorization audit is flushed before the exact previous binding is restored. An uncertain audit or binding publication retains the lease and evidence for inspection, not an automatic retry. The audit alone is not proof that rollback completed.

Only after `ACTIVATION_ROLLED_BACK`, start the preserved previous source with its original Node executable, arguments, workspace mappings and retained home. The rollback command does not restore source, builds or profiles, restart services, approve writes, or discard sessions and models. The [rollback decision](../../.agents/notes/implemented/architecture/2026-09-14-retained-web-activation-rollback.md) records verification and limits.

## Process and data ownership

Workspace aliases are explicit operator inputs. Their canonical directories must not overlap controller, data, runtime, or issuer-key paths. Alias meanings enter the activation digest and the broker's retained mapping; changing a mapping refuses rather than retargeting prior authority. Supplying aliases does not mount a workspace tool or authorize a write.

The parent creates a private runtime directory, validates and stages the zero-bundle four-row profile with the run-specific broker socket, starts the broker with a minimal environment, its issuer route, and the optional detached KIRA policy, starts the issuer with only its socket, private-key path, and expected receipt-key identity, and starts the Cordis guest with an exact process-only environment. The guest loads no project or user `.env` layer and accepts only the direct parent's exact `aukora:guest-memory-put:v1` IPC record. The library permits one active operation and snapshots lossless JSON before IPC. A parent issuer-approval callback that does not settle within 25 seconds terminates the assembly as a lifecycle failure; it is never reported as human denial. If no terminal guest result arrives within the launcher's 80-second operation budget, the launcher terminates the guest and returns `INDETERMINATE`.

A library parent can supply `createSubjectAuthority(activationDigest)` for one static context, or the paired `selectSubjectAuthority(request, signal)` and `subjectAuthorityExpectation` fields for proposal-specific contexts. The Web assembly requires the proposal-specific form and verifies that it names the projected active AUMLOK control and KIRA policy. Detached contexts reach only the broker; the guest, issuer, and returned assembly handle never receive them. A non-Web launch without either form selects v4.

Before any child starts, the parent measures and validates one closed [`ActivationStatement`](../activation/statement.mjs) and passes the statement to the broker only as its digest. The broker binds that digest in its own state, compares it before grant verification can reserve the nonce, and compares it again immediately before the effect. A mismatch at the first comparison is `REFUSED` without consuming the authorization; a binding change after reservation is `INDETERMINATE`, with no effect started. The statement includes every module in the exact static issuer/broker graph, the graph selector, the assembled composition, explicit executable and source-resolver anchors, the proposal cell, a SHA-256 identity for the selected parent renderer, the model-emission policy, both key identities, and the KIRA recall-policy digest when recall is enabled. That policy digest commits its selected subject and privacy classes, but activation v1 does not independently commit the full delegation context. Each successful v5 action and its retained authority-evidence record bind that context to the activation digest. Before every guest spawn, including a Web guest replacement, the parent remeasures the complete statement and requires the original activation digest. A Web restart performs an initial check before stopping the serving guest, then repeats it immediately before the replacement executes. The statement does not recursively attest Node built-ins, dynamic imports, installed package artifacts, operating-system behavior, or source changes between the last measurement and process execution. The ready artifact's additional hashes remain descriptive. This result is `SOURCE-INSPECTED`, not an installed-custody attestation: every child still runs at the parent's UID, so the staged profile and protected state remain writable by the shared UID and no activation check can establish custody against it. The [launch-downward observer](../../ops/launch-downward/README.md) remains the non-activating specification for distinct-principal custody.
