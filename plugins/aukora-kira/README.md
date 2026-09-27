# AUKORA Kira plugin

A stock DSH host plugin that **writes Remembered memory and stages Signed proposals**. A Remembered record **is memory** — §2.2 of the design settles it, and §10.1 lists this
very sentence as a claim that had to change — but it is memory **labeled unreviewed** (`REMEMBERED_IS_UNREVIEWED`): extracted by deterministic rules over one bounded turn,
possibly wrong, and never presented as something a person checked. What it does **not** do is write the **Signed** track: that still needs a grant and a signed approval, and
that is what the queue below is for. When the composition names a `queueDir` (the shipped default does), a stage, the auto-stage turn hook and the compaction-export hook each
leave at most one pending review entry per record. A queued entry is not **Signed** memory and grants nothing; it is the exact bytes a person may choose to settle. It also
exposes **cited, bounded conversational retrieval through an injected read owner**: recall returns notes with their source, never raw text, and never more than the frame allows.

With a `readOwner` module, Kira holds no store route, path, key, grant, nonce or
receipt. With `memoryOwner` (the shipped default), its `lib/memory-owner.mjs` holds
the state directory, an issuer key stored in the clear there (`ISSUER_LOCAL`), the
one-use approval and nonce markers, and the receipts it writes. (`lib/index.js`'s
header comment still says the former for both, and is stale.) See `PROVENANCE.md` for the exact source pin and what
was ported versus changed.

**A write needs TWO operator documents, and neither substitutes for the other.**
`memoryOwner` names `grantFile` (this installation's one-use authorization for
exactly these bytes) and `approvalFile` (an approval signed over exactly those bytes
by the key the artifact itself names. It is the owner's approval only when the
composition pins `approverDid`. The shipped default composition does not; the
deployment overlay template has a slot for it. An unpinned settlement reports
`approverPinned: false`). A composition that names a memory owner and no approval route is
refused at mount with `kira.config:memory-owner-approval-unconfigured`; it is not
degraded, because a write tool that can load without an approval route is the hole
the approval path exists to close. `confirm: true` is an intent flag, not an
approval: it is unsigned, it is not durable, and it authorizes nothing.

## Mounting

A composition row mounts it, and the read owner names a module on disk:

```yaml
- id: aukora-kira
  name: ./plugins/aukora-kira/lib/index.js
  config:
    retrieval: lexical
    maxSessions: 16
    readOwner:
      module: ./owners/auma-memory-owner.mjs
      options: {}
```

The owner module must export `createReadOwner(options)`. The plugin resolves no
bare specifiers, needs no build step, and imports nothing from the harness. It
does need `plugins/aukora-aumlok` beside it, because `lib/approval.mjs` imports that
lane's rules, so it mounts from a built DSH release that also carries Aumlok. (The
court for the import boundary, `kira-recall`'s write-boundary arm, is red; see
Tests.) It declares `inject = ['tools']` and
registers `kira_stage` and `kira_recall`, `kira_settle` only with `memoryOwner`, and
`kira_queue` only with a `queueDir`. It provides the `kira.recall` service, and
`aura.cite` with `memoryOwner`. It registers an `agent/pre-step` recall-injection hook
and, with a queue, the auto-stage and compaction-export hooks. **Do not read the
recall-injection hook as working** (found 2026-09-26, by reading): its lane resolver
in `lib/index.js` (about :455) calls `readReflect()`, which is defined only inside
`compaction-export-hook.mjs`, so every pre-step throws a `ReferenceError` inside the
lane supplier, the injection guard contains it, and the turn goes through unchanged.
No court drives `index.js` `apply()` through a pre-step and asserts an injected
line.

A configuration that names an unimplemented retrieval option, or that omits the
read owner, fails at mount. It does not degrade silently.

## Tools

### `kira_stage`

Returns `{state: "proposed", wrote, recordId, record, memoryPut, subject, privacy,
settlement, ceiling[, queued]}`. It never writes memory. With a configured queue it
writes at most one pending entry and reports `wrote: true` only when it created one.

The subject and the privacy class come from the host read-owner policy. A
candidate naming a different subject is refused with
`kira.stage:subject-not-owner-supplied`; a privacy class the policy does not
permit is refused with `kira.stage:privacy-not-permitted`.

Every result carries `settlement`. With no `memoryOwner` it reads:

```json
{"available": false, "reason": "no-admitted-memory-producer", "detail": "..."}
```

The shipped default composition configures one, so it reads `available: true`.
Availability is not authorization: under the default subject (`aumlok:subject:owner`) no
approval can be produced until the deployment overlay names the controller's
`aukora:1:` subject.

**Whether live memory settlement is available is a fact about configuration, and
`kira_stage` reports it.** The status is `available: false` /
`no-admitted-memory-producer` when no owner is configured, and `available: true` /
`admitted-memory-owner-configured` when one is. The value is derived from whether a
`memoryOwner` was configured (`index.js`), and `kira-reachable` checks the configured
case. The output schema checks only its shape. The unconfigured-case arm in
`kira-recall` is currently unreached, because that court is red earlier (see Tests).

Two owner sources, exactly one of which a composition names:

| Config | What it supplies |
|---|---|
| `readOwner.module` | a read surface the composition already trusts |
| `memoryOwner: {stateDir, subject, permittedPrivacy, grantFile, approvalFile, approverDid?}` | this plugin constructs the **admitted memory owner** over a state directory: a governed settlement path *and* the read owner over the same store. `grantFile` and `approvalFile` are both mandatory; they may name the same file when it is the operator bundle `{authorization, approval}` |

Naming both is refused, because that is two answers to "whose memory is this".

With `memoryOwner`, settlement is a **governed transition**. The actual order
(corrected 2026-09-26) is: owner-daemon mode check; record verify, re-stage and subject
checks; label refusals; content digest and subject; artifact self-consistency; key,
then `approverDid` and `activeControlDigest` pins; signature; expiry (the window start
is not checked against the clock, so a future-dated approval is accepted early); grant
byte binding; the latest decision for these bytes (a decline refuses and consumes
nothing); both one-use records pre-checked, then consumed; put; receipt. The numbered
list below describes the same checks by purpose, not in execution order:

1. an **owner approval artifact** is presented, and the operation digest it binds is
   **re-computed from the bytes about to be written** — an artifact that merely
   *carries* an `operationDigest` field is refused the moment the field names
   other bytes (`kira.settle:content-mismatch`), and one for another subject is
   refused (`kira.settle:subject-mismatch`);
2. the approval's signature is verified under the key its `did:key` decodes to,
   inside the window it declares, over the bytes that artifact's own fields derive
   with the approving lane's signing rule — and if the composition names
   `approverDid`, the approver must BE that key
   (`kira.settle:approver-not-registered` otherwise), because an artifact signed by a
   freshly generated key is a valid document about a key nobody registered;
3. the labels the artifact carries are read as LABELS and refused where this lane
   cannot stand behind them: `human-ceremony` (`kira.settle:class-unsupported`),
   an `attendance` other than `reported-not-proven`
   (`kira.settle:attendance-unsupported`), or `identityBound: true`. They sit
   OUTSIDE the signed preimage, so a class is a word anyone can rewrite;
4. a **one-use grant** is presented and its byte binding checked — before the
   nonce is spent, so a grant for other bytes stays usable for its real payload;
5. the approval is **consumed** (`approvals/<approvalId>.json`), then the grant's
   nonce (`spent/<digest>`), each created exclusively (a temp file, then `link(2)`), so
   a second presentation to the same store is refused. The concurrent-writer case rests
   on the syscall's semantics and has no racing court. Two stores spend separate
   markers (`APPROVAL_CONSUMED_IN_STORE`);
6. one `memory.put` is applied: the object, the key projection, one Aura entry;
7. a signed receipt is emitted naming the record identity, the content digest, the
   historical position, and **the approval that authorized it**.

A second presentation of the same approval is refused by name
(`kira.settle:replay`) and writes nothing. A `kira_settle` result or refusal carries
`SAME_UID`, `ISSUER_LOCAL`, `ATTENDANCE`, `NOT_CONFINEMENT`, `NO_LATESTNESS`,
`TRUNCATION_UNANCHORED` and `APPROVAL_CONSUMED_IN_STORE`, plus
`approverPinned`/`controlPinned`. `APPROVER_PINNED` and `SCRIPTED_APPROVAL` (with
`APPROVAL_KEY_LOCAL`, `NO_IDENTITY_BINDING` and `VERIFICATION_IS_NOT_AUTHORIZATION`) are
printed on the approval verifier's verdict, not on the settle result.

**Availability is not authorization.** The flag says a producer exists; the
approval and the grant are what authorize one write. Reads never touch a grant, a
nonce or an approval store — a question is free, a durable write is authorized —
and no read-path module imports the settlement owner. That is an import-level
separation: with `memoryOwner`, the read owner is built by the same module over the
same store. The write-boundary arm that checks this is currently red, because
`strict-read.mjs` is a second filesystem module the arm does not admit. The cross-lane
imports are all in `approval.mjs` (Aumlok's owner-approval, operation-approval,
approval-receipt, canonical, subject and did-key modules), so the verifier uses the
approving lane's own rules. That makes the two agree by construction, not
independently. `kira-approval-wire` runs the real producer out of process to catch drift
on Kira's side; a defect in the shared rule itself is not independently checked.

**No tool mints a grant, and no tool approves.** When `memoryOwner` is configured
a third tool, `kira_settle`, is registered; it accepts only `confirm: true`, reads
both documents from the files the composition names, and settles exactly the bytes
they bind. The grant is minted by `bin/kira-grant.mjs` and the approval by the
owner approval command — `scripts/aumlok/approve-operation`, which holds no key and
asks a separate signer process, and writes an `aukora:approval-receipt:v1` artifact.
`scripts/kira/kira-approve.mjs` is a **daemon-free test double** that mints the SAME
artifact through the approving lane's own receipt layer, for the case where no signer
daemon is wanted; it records `approvalClass=scripted` and `attendance=reported-not-proven`
on its face. With either document absent the tool refuses (`approval-absent`,
`grant-absent`) and writes nothing.

## The read-owner contract

```ts
createReadOwner(options) -> {
  describe(): Promise<{
    subject: string
    policyRevision: string
    permittedPrivacy: readonly ('local' | 'exportable' | 'private')[]
  }>
  read(request: { signal: AbortSignal, kind?: string }): Promise<{
    availability: 'found' | 'empty' | 'undetermined'
    subject: string
    policyRevision: string
    projection: { name: string, version: string, digest: string }
    records: readonly {
      record: KiraMemoryRecordV0            // the canonical record
      text: string                          // labelled retrieval projection
      citation: { recordId, contentSha256, auraSequence, auraEntryHash, verifiedHead }
    }[]
    reason?: 'memory-unavailable' | 'memory-corrupt' | 'memory-unverified' | 'integrity'
  }>
}
```

The plugin validates every read against the policy the owner itself declared and
refuses, by name, a snapshot that:

| Refusal | Broken invariant |
|---|---|
| `snapshot-widens-subject` | the snapshot names a subject the policy did not |
| `snapshot-policy-changed` | the revision moved between the owner's own two calls |
| `record-subject-mismatch` | a returned record belongs to another subject |
| `record-privacy-not-permitted` | a returned record carries an unpermitted class |
| `record-unverified` | a record does not re-stage to its own `recordId` |
| `citation-mismatch` | the citation does not digest the record it names |
| `snapshot-unavailable-with-records` | the store reports unavailable while carrying records |
| `snapshot-reason-invalid` | an `undetermined` snapshot names no known reason |

Refusals the plugin raises while validating an owner's snapshot (isolation,
citation, re-stage) are **hard errors**. Damage the memory owner detects in its own
store is reported as `undetermined` with a named reason (`memory-unverified`,
`memory-corrupt`, `integrity`), never as `empty`. Only a mid-turn policy race is
treated as transient, and it is reported as `policy-changed-during-read`.

## Lifecycle

Every turn acquires the read owner twice — before and after navigation — and
compares a snapshot digest over the validated snapshot and the retrieval method.
Changed record bytes, a changed projection, a changed subject or a changed
effective privacy set all invalidate the cached lexical index and the working
state. A change detected between the two acquisitions withholds the result as
`snapshot-changed-during-read`.

Working state is bounded to 5 active references, 8 KiB, 3 snippets of 480
characters and a 512-character question. Rejection consumes reference capacity;
after 5 rejections the session reports `refine-query-after-rejections` instead
of recycling candidates. Sessions are bounded per plugin instance
(`maxSessions`, default 16) with oldest-first eviction, and eviction disposes the
session.

`stop` ends a session and `close()` aborts its lifetime. A turn that observes the
abort before it commits throws `kira.recall:closed` rather than publishing a
late result. Only an explicit `new` action rearms a stopped session, from a
blank state. Plugin disposal closes every live session before the registration
is torn down.

## Retrieval options

Only `lexical` is implemented: BM25 with `k1 = 1.2`, `b = 0.75` plus one
ordered-bigram term at weight `0.1`, `minScore = 0.12`, `ambiguousGap = 0.035`.
This is the method the pinned research measured as its lexical baseline and
recommended. It stores **no vectors**.

The migration inventory is load-bearing, not decorative: naming any other option
in a configuration fails at mount with the whole table in the message.

| id | status | representation |
|---|---|---|
| `lexical` | implemented | none |
| `static-embedding` | not implemented | f32 vectors from a frozen external encoder |
| `int8` | not implemented | i8 + scale over the same derived vectors |
| `ternary` | not implemented | 2-bit packed over the same derived vectors |

The derived options require a model artifact. This package downloads and trains
nothing, and no derived option is deployed, measured, or claimed.

## Mounting dependencies

| Dependency | Owner | State |
|---|---|---|
| A composition row naming `./plugins/aukora-kira/lib/index.js` | lead | **present, mounted by default** (corrected 2026-09-26): the release's `aukora-composition.patch.yml` carries the `aukora-kira` row (release-relative name) with `memoryOwner` and `queueDir`. `aukora-lanes.patch.yml` remains for a profile that wants the organs without the default composition. The deployment overlay template must supply the real subject (and `approverDid`) before a settlement can be approved |
| `readOwner.module` resolving to a module exporting `createReadOwner` | lead | **supplied by this lane now** as `memoryOwner`: `lib/memory-owner.mjs` constructs a production read owner *and* a governed settlement path over one state directory. The shipped default composition names it (with a placeholder subject the approval path refuses; the deployment overlay supplies the real one) |
| An admitted memory producer | lead | **supplied by this lane now**, and reported truthfully: `settlement.available` is `true` exactly when `memoryOwner` is configured. The default composition names it. `GENESIS-PLAN.md` records one live settlement on 2026-09-21 (`receipt-memory.put-001.json`); that record was not re-verified here |
| The **owner approval command** producing the document `approvalFile` reads | Aumlok lane | **present.** `scripts/aumlok/approve-operation` writes an `aukora:approval-receipt:v1` artifact over one exact operation digest, through a real signer daemon on a Unix socket. `scripts/kira/kira-approve.mjs` and `tests/kira-approval-standin.mjs` are daemon-free doubles that mint the SAME artifact through Aumlok's own `createApprovalReceipt`, for suites that must not start a daemon. `scripts/kira/kira-approve.mjs` records `approvalClass=scripted` by default; `approve-operation` and `tests/kira-approval-standin.mjs` default to `delegated`, and either may be set to `scripted`/`delegated`/`unattributed`. `human-ceremony` is refused. The class is an unsigned label. No artifact claims attendance: Kira refuses any value other than `reported-not-proven`. The reconciled digest rule and the exact fields are in `PROVENANCE.md` §"The owner approval dependency, and the exact wire between the two lanes" |
| The harness runtime | present | any built tree or materialized release |

## Tests

```sh
node tests/kira-record.test.mjs                    # the record contract
node tests/kira-recall.test.mjs                    # retrieval, isolation, lifecycle, write boundary — RED at 674fae6bf (see below)
node tests/kira-approval.test.mjs --mutate --repro # the approval gate, against a daemon-free double
node tests/kira-approval-wire.test.mjs --mutate    # THE WIRE: the shipped producer → this settle path
node tests/kira-dsh-assembly.test.mjs              # real DSH context and tool assembly
node tests/kira-lexical-bench.mjs --records 1000   # CPU latency and footprint
```

`kira-approval-wire.test.mjs` is the acceptance court for the interface between these two lanes: it
runs `scripts/aumlok/approve-operation` and `scripts/aumlok/signer.mjs` as separate processes,
consumes their artifact through the real `kira_settle` path, and re-runs itself against a mutated
copy of this package for each rule of the wire. It is the only court that can see the digest rule
drift, because the others' approver imports that rule from the module under test.

The first five are CI steps: record, recall, approval and approval-wire in the
`keyless-courts` job; dsh-assembly in `keyless-build` after materialize, when the
selector selects the build, with the courts gate failing if a selected job did not run.
The sixth, lexical-bench, is a measurement, not a gate. Each of the five runs with
`--mutate`.

**Two of those CI steps are red at commit `674fae6bf`** (measured 2026-09-26 from a clean
shell). `kira-recall` exits 1 at its write-boundary arm (`strict-read.mjs` imports
`node:fs` and uses a write primitive, which the arm admits only in `memory-owner.mjs`),
so every arm after it does not run. And the `--mutate` pass of `kira-approval-wire` fails
all four mutations for the wrong reason: its copies omit `plugins/aukora-owner-daemon`,
which `scripts/aumlok/signer.mjs` imports, so no mutation is detected (its plain run, 10
arms, passes). The fix belongs in the courts, not in this README.

`kira-dsh-assembly.test.mjs` needs a harness runtime and will not skip without
one. It resolves, in order: `--dsh-root <path>`, `AUKORA_DSH_RELEASE` (a
materialized release, which is what CI produces), `AUKORA_DSH_ROOT` (a built
tree), then `<checkout>/vendor/dsh`. No machine path is hard-coded, and when the
runtime carries its own build record the test prints the genesis commit it was
measured against, so "against the current runtime" is checkable afterwards:

```sh
python3 scripts/build-dsh.py
python3 scripts/materialize-aukora-release.py --to "$RUNNER_TEMP/aukora-release"
AUKORA_DSH_RELEASE="$RUNNER_TEMP/aukora-release" node tests/kira-dsh-assembly.test.mjs --mutate
```

`tests/kira-test-store.mjs` is a **disposable test adapter**. The durable write
path is `lib/memory-owner.mjs`; the adapter instead builds canonical records, object
bodies, key projections and a real `aura.jsonl` hash chain on temporary state,
and `verifyStore` re-derives every citation digest from those bytes. The plugin
never imports it.
