# Kira lane — provenance and handoff

Owner: Auma (Kira lane). Branch `codex/kira`. Candidates live in
`plugins/aukora-kira/` and `tests/kira*`.

## Source pin

Everything ported below was read from the pinned Deep checkout:

```
repository  aukora-deep
commit      c417f7c5752bf14b8e927986cd995f2e086f4189
subject     Merge pull request #311 from aumara-xyz/ops/rv3-cutover-kit
```

Read-only: no Deep file or worktree was written. Deep bytes ARE vendored, in two places (corrected
2026-09-26): the pinned `memory.put` proposal cell under `plugins/aukora-kira/lib/wasm-cell/`
(`aukora-deep` `c417f7c5`, AGPL-3.0-or-later, see its `PROVENANCE.json`; `kira_stage` runs through it),
and Deep's spatial client packages under `plugins/aukora-spatial/` (`7be3a614`). `vendor/` remains the
lead's.

### Files read at the pin, with their SHA-256

| Path at the pin | SHA-256 | Used for |
|---|---|---|
| `docs/specs/KIRA-MEMORY-SPEC.md` | `56a68773857924a589fed59fa04ef3b1f6e5552b960e1916dd2d86a556b27334` | record contract, tri-state recall, claim ceiling |
| `aukora/kira/stage.mjs` | `81ca34244419ce76a10f273664d97c5d834c5b16a03a8652963c181eefe8a288` | ported into `lib/record.mjs` |
| `aukora/kira/recall.mjs` | `322641727d085be3ee975bd066895468be3076e1b01dcc489e2a36b4eba9ba85` | tri-state classifier semantics; `kiraRecordContentSha256` |
| `aukora/kira/stage.d.mts` | `b021de90f93e4b003590f442390a0a56b5bf1e92686ded58e7a2a527197f9fa9` | type review only |
| `aukora/kira/recall.d.mts` | `8814b49eecf63c31db28a56481e56bc31a236ab94665a6b0da3f760096cd275a` | type review only |
| `aukora/broker/kira-recall.mjs` | `04ae61f836f538076dbe8bbc04cae8242417752aad4cc502a3b6fa91e4bd41a6` | read-owner policy, bounds, citation fields |
| `aukora/verifier/kira-memory-artifact-verifier.mjs` | `0810f0236d80a840095b615f54db1f2d4271fb0df06372e49d0ec60771c5a838` | citation and Aura-chain vocabulary |
| `aukora/kernel-seed/canonical-json.mjs` | `5cbfef67053f1154a589a124eea2996a9b9333e7c2ef270d16aec6cd5c91f5d4` | restated as `canonicalJSON` in `lib/record.mjs` |
| `aukora/broker/effect-body.mjs` | `2bf952d3a2a1df45477cee07dc5a5e866a1536e9cead6052173d868414074495` | restated as `memoryEffectBody` in `lib/record.mjs` |
| `aukora/broker/memory-put-args.mjs` | read at the pin; not extracted to a file | `KEY_SHAPE` restated as `MEMORY_PUT_KEY_SHAPE` |
| `research/associative-memory/2026-09-08/explorer/core.mjs` | `28c08d2277e23b037b53e0b11e9574e39e733a333fac2e9231ba7f5ec1c2bb63` | frozen scoring, limits, navigation |
| `research/associative-memory/2026-09-08/explorer/vectors.mjs` | `f7d1e9f60422cdbabead6c1a0a51e772d84f71cedf9ca1a6c0d9153fbc417a7e` | quantization inventory only |
| `research/associative-memory/2026-09-08/explorer/methods-freeze.json` | `71ea776f27b12296abd42570a09ad1677d53d9e47b34b3e781396401fd228191` | method freeze posture; it also pins `core.mjs` and `vectors.mjs` to the hashes above |
| `research/associative-memory/2026-09-09/conversation.mjs` | `fe2be4635b97a39211626561bd14c155e8b37c133a0b869100d6ede262912c20` | navigation, invalidation, disposal semantics |
| `research/associative-memory/2026-09-09/README.md` | `46d967d8a0e615779002306e44836c653cc49ef2a70546365042972940605a36` | measured lexical recommendation, claim ceiling |
| `research/associative-memory/2026-09-08/explorer/README.md` | `ab904daa812ccc2ce4fff8530f4e70f2129d05905830a0d997d955504ec4bd54` | tool surface and stop/rearm semantics |
| `research/associative-memory/2026-09-08/explorer/fixture-broker.mjs` | `f1f7871db4cbe54cd0523ce50de204903f2393e94ffa905ba9b0199e8d4db006` | read-owner/broker wiring posture |
| `research/associative-memory/2026-09-08/explorer/local-adapter.mjs` | `d01effe1b61ece8f3a0697caccbaf356293a4a2df7330d060bd2b85b46258e63` | interpreter posture (not ported) |

Hashes were computed over `git show <pin>:<path>` output, so they name the
pinned bytes. One entry is read-only-in-place because it was inspected with a
grep rather than extracted.

## What was ported, and what changed

**Ported unchanged in behaviour:**

- the canonical record contract: field set, closed-object reading, refusal
  codes, deterministic `recordId = 'kira:' + sha256(domain + '\0' + canonicalJSON(identity))`,
  canonical seconds-precision `createdAt`, depth/node ceilings, transform
  provenance requiring a source, and verification by re-derivation;
- the object-body rule `canonicalJSON({key, value}) + '\n'` and the
  `memory.put` key grammar;
- the tri-state store vocabulary (`found` / `empty` / `undetermined`) and its
  named reasons, with `undetermined` never collapsing into `empty`;
- the retrieval vocabulary (`match` / `ambiguous` / `insufficient` / `exhausted`)
  kept separate from store availability;
- the frozen lexical scoring (BM25 with `k1 = 1.2`, `b = 0.75`, plus one
  ordered-bigram term at weight `0.1`), `minScore = 0.12`, `ambiguousGap = 0.035`,
  the stop-word list, and the bounds (`snippets 3`, `references 5`,
  `stateBytes 8192`, `queryChars 512`, `snippetChars 480`, `records 4096`,
  `corpusBytes 4 MiB`);
- `supersedes` / `contradicts` navigation, the unambiguous-acyclic-succession
  rule, the missing-target and truncation refusals, and the rule that a recorded
  contradiction stays a disagreement;
- double acquisition per publication, snapshot-digest invalidation, bounded
  working state, rejection consuming reference capacity, and Stop preventing
  late publication with only an explicit `new` rearming.

**Changed, deliberately and with reasons:**

1. **Repackaged as one stock-DSH host plugin.** The pinned code is an in-tree
   library reached through relative imports (`../kernel-seed/...`, `../broker/...`,
   `../../../../packages/...`). This package must mount from a built DSH release as
   `./plugins/aukora-kira/lib/index.js`, and `@deepseek-ai/dsh-tools` is not
   resolvable from that release root. Outside its package, `lib/` imports only
   Aumlok's approval modules, and only through `lib/approval.mjs`; the `bin/`
   commands also import Aumlok's `lib/index.mjs`; and the staging path imports
   Deep's vendored proposal cell, `canonical-json.mjs` and `memory-put-args.mjs`
   from `lib/wasm-cell/`. `lib/record.mjs` still restates `canonicalJSON`,
   `memoryEffectBody` and `kiraRecordContentSha256` for the record contract. `defineTool`'s spec-to-schema
   compilation is replaced by hand-written JSON Schema in the harness's
   enforced subset, which is why `lib/parameters.mjs` exists.
2. **The plugin reads, it does not broker.** The pinned tree splits pure
   classification (`aukora/kira/recall.mjs`) from state access
   (`aukora/broker/kira-recall.mjs`). Here the store half is the *injected read
   owner*, supplied by the composition, and the read path holds no store route.
   With `memoryOwner` configured, the plugin (`lib/index.js` through
   `lib/memory-owner.mjs`) holds a state directory and its own disposable issuer
   key. `bin/kira-approve-queue.mjs` passes a controller directory and a
   signer-socket path to Aumlok's approval producer. No Kira module opens a
   socket itself.
3. **The read owner must supply the canonical record, not just text.** The
   pinned broker returns canonical records and the research layer projects them
   to text upstream. Here each snapshot entry carries the canonical record, a
   labelled text projection, and a citation; the plugin re-derives `recordId`
   and `contentSha256` from the record's own bytes. A citation therefore cannot
   name a record that does not hash to it.
4. **Staging is narrowed to the host-supplied subject.** The pinned
   `kira.stage` accepts `subject` and `privacy` as model-supplied candidates and
   the specification says this does not make the caller an authenticated
   subject. This plugin additionally requires the candidate subject to equal the
   read owner's subject and the privacy class to be one the owner permits, so
   the model cannot stage a record it could never read back, or one belonging to
   another subject. No court yet drives `kira.stage:subject-not-owner-supplied` or
   `kira.stage:privacy-not-permitted` (`lib/tools.mjs:261-266`); both are CODE ONLY.
5. **`--mutate` negative controls.** The pinned tests assert behaviour; this
   repository's rules require each invariant to have a check that fails when
   that invariant is broken. The three original suites (`kira-record`,
   `kira-recall`, `kira-dsh-assembly`) are scenario / `--mutate` suites, and
   `kira-recall` is red at `674fae6bf`: its write-boundary arm fails in the unbroken
   run because `lib/strict-read.mjs` imports `node:fs` and uses a write primitive,
   and the arms after it never run. Later
   Kira courts are not all like that: `interlock-kira-aumlok`,
   `kira-approval-row` and `kira-control-admission` are in `tests/GREEN-ONLY.txt`,
   and `kira-receipt-history` has no mutation arm even though
   `scripts/aukora-courts.sh` runs it with `--mutate`.

## What is deliberately NOT here

- **Durable memory RECORDS are written only through the governed settle** (grant
  plus approval) in `lib/memory-owner.mjs`. Other durable writes exist: the owner
  writes its issuer key and its directories at mount, and when `queueDir` is
  configured, as in the default composition, `kira_stage`, auto-stage and the
  compaction export write pending or declined, non-recallable review entries. The
  single-writer boundary arm in `kira-recall` is currently red (see above). The disposable test adapter (`tests/kira-test-store.mjs`) is never
  imported by the plugin. There is no direct-write shortcut.
- **No broker, issuer, grant, nonce, receipt or socket code IN THIS LANE.** The
  admitted memory owner added later (`lib/memory-owner.mjs`) does hold a grant, a
  nonce store and a receipt — for its own disposable per-state key, with
  `ISSUER_LOCAL` and `SAME_UID` printed on every result. `lib/` opens no socket
  and holds no broker. `bin/kira-approve-queue.mjs` and `bin/kira-pin-control.mjs`
  take an Aumlok controller directory, and `kira-approve-queue` passes a
  signer-socket path to the approval producer it spawns. Approval VERIFICATION lives in
  `lib/approval.mjs`; approval PRODUCTION belongs to the Aumlok lane.
- **No static-embedding, INT8 or ternary retrieval.** They stay enumerated in
  `RETRIEVAL_OPTIONS` as `not-implemented` and a configuration naming one is
  refused with the whole inventory in the message. The pinned
  `research/.../acquire_model.py` and `model-lock.json` imply a downloaded model
  artifact; this increment downloads and trains nothing.
- **No agent loop, no LLM call and no Web shell.** Kira does hook agent events
  (pre-step recall injection, turn-stopping auto-stage, compaction export; see
  `plugins/aukora-kira/README.md` for why the recall-injection hook currently
  injects nothing). When `queueDir` is configured it persists staged proposals,
  including compaction summaries, to a pending review queue on disk.
- **No answer-correctness claim.** `match` is lexical overlap.

## Delivery record

### Historical — the state at earlier heads

These rows describe the head named in them, not the branch tip. They are kept
because the running record of what was true when is evidence in its own right.

| At head | What was true then |
|---|---|
| `e425bf2` | `Genesis B1 keyless build` **passed** at this head (both the push and pull_request runs, 3m32s and 4m40s, all steps ran). At this point the PR was lane-only: 17 files, `plugins/aukora-kira/` and `tests/kira*`. |
| `e425bf2` … `cc919ae` | **CI could not start.** Every run on this repository from 2026-09-16T12:02Z failed with `runner_name: ""`, zero steps, ~5s and the annotation *"recent account payments have failed or your spending limit needs to be increased"*, reproduced on two branches. That was GitHub Actions billing, not a code or test failure, and no lane could clear it. It has since been restored; the affected runs were deliberately **not** rerun. |
| `cc919ae` | The head Codex and Muse Spark read. Assembly suite had 9 arms. |
| `d8d744b` | Merge-forward of `main 762d36b` plus the assembly suite's disposable-state leak fix and its tracking arm (arm 10). |
| `f63f7bc` | Merge of the lead's `codex/kira-ci-integration` (`1b9e541`). Assembly suite 10 arms; CI run `35104341080` succeeded at this exact head. Fable's first review returned CHANGES REQUESTED here. |

### Current — this PR as it stands

| Item | Value |
|---|---|
| Branch / worktree | `codex/kira` in its own Genesis worktree (exclusive; sole writer) |
| Base | `main`, merged forward with `git merge` on every round (no rebase, no force-push) |
| Files | **19** at `f63f7bc` (the head this table describes), not lane-only. 17 are this lane's (`plugins/aukora-kira/`, `tests/kira*`). The other two are shared and **were authored by the lead on his own scoped branch `codex/kira-ci-integration` (`1b9e541`), then merged into this candidate normally**: `.github/workflows/b1.yml` (three Kira steps) and `scripts/artifacts-coverage.json` (two `genesisPatterns` entries and one limits note). This lane did not write, edit or review those two files. |
| CI wiring | **Done, and not by this lane.** `node tests/kira-record.test.mjs --mutate` and `node tests/kira-recall.test.mjs --mutate` run before the build; `node tests/kira-dsh-assembly.test.mjs --mutate` runs after `scripts/materialize-aukora-release.py`, with `AUKORA_DSH_RELEASE` pointed at the release the job materializes. |
| Coverage | *Corrected 2026-09-26:* the release carries `plugins/aukora-kira` and covers its `lib` through the release's plugin host patterns, and the default composition mounts it with a `memoryOwner` row. (`scripts/artifacts-coverage.json`'s notes still say it is not mounted, and are stale.) This lane's tests, `tests/kira-test-store.mjs` and the measurement artifacts are deliberately not covered and are part of no composition. |
| Not done by this lane | no merge, no live installation, no shared-checkout edit, no donor write, no `vendor/` change, and no authorship of the shared CI or coverage change |
| Mergeable code vs live memory | *Corrected 2026-09-26:* the default composition mounts the memory owner, so memory is readable, and `kira.stage` reports settlement available. Its subject (`aumlok:subject:owner`) is outside the grammar the approval lane parses, so no approval can settle until an operator overlay names the deployment's `aukora:1:` subject (`bind-overlay` / `kira-pin-control`). The plugin's mount path does not check that grammar |
| Disposability | every root this lane creates is under the OS temporary directory and is removed by the run; the assembly suite tracks its roots so an arm that throws before its own guard cannot leak one |

The shared coordination file was deliberately not edited: this assignment scopes
provenance and handoff to this directory, and the coordination file lives in the
shared checkout. Entries for the lead go through the PR.

## Required CI commands

Wired into `.github/workflows/b1.yml` by the lead's `1b9e541`. Each is a plain
`node` run with no service, no port and no key. `--mutate` is the
negative-control pass and is required, not optional: without it the arms only
assert that the happy path works.

```sh
node tests/kira-record.test.mjs --mutate                                   # 25 arms, no runtime needed
node tests/kira-recall.test.mjs --mutate                                   # 29 arms defined (static count at 674fae6bf); RED there: the write-boundary arm fails and the five after it never run
python3 scripts/build-dsh.py
python3 scripts/materialize-aukora-release.py --to "$RUNNER_TEMP/aukora-release"
AUKORA_DSH_RELEASE="$RUNNER_TEMP/aukora-release" node tests/kira-dsh-assembly.test.mjs --mutate   # 12 arms (static count at 674fae6bf; not run here, it needs a release)
```

The assembly suite runs **after** materialization, for the same reason Aura's
host-path suite does: a harness runtime is a build output, and a release is the
artifact a launch actually loads. It resolves `--dsh-root`, then
`AUKORA_DSH_RELEASE`, then `AUKORA_DSH_ROOT`, then `<checkout>/vendor/dsh`, and
**fails by name** when none resolves.

Coverage and materialization inputs the lane reads:

| Input | Produced by | Used for |
|---|---|---|
| `vendor/dsh` (built tree) | `scripts/build-dsh.py` | harness `Context`, `ToolRuntime`, `SystemPrompt` |
| `<release>` (materialized) | `scripts/materialize-aukora-release.py --to <dir>` | the same, as the artifact a launch loads |
| `.dsh-build/genesis-artifacts.json` in the runtime | the build | `producer.genesisCommit`, printed as evidence |
| `.dsh-build/aukora-release.json` in the runtime | the materializer | whether the runtime is a materialized release |

## The owner approval dependency, and the exact wire between the two lanes

**Added 2026-09-20 on `lane/kira-approval`. RECONCILED on `lane/approval-wire`.** Settlement
requires an approval signature over the exact proposed content. It is an OWNER approval only when the
composition pins `memoryOwner.approverDid`; the generated rows do not pin it (`APPROVER_PINNED` is
absent), so by default any key the artifact names is accepted. The approval's SHAPE, its
DIGEST and its SUBJECT GRAMMAR are the Aumlok lane's, not this one's. The two lanes were built in
parallel and each was green alone; where they met, the wire was undefined in three places, and this
section states the reconciled answer rather than the expectation it replaced.

**What Kira imports, and from where.** `lib/approval.mjs` imports from
`plugins/aukora-aumlok/lib/` and from nowhere else outside this package — `owner-approval.mjs`
(`approvalSigningBytes`, `createApprovalRequest`), `approval-receipt.mjs` (`APPROVAL_RECEIPT_DOMAIN`,
`OWNER_KEY_SIGNED`, `parseApprovalReceipt`), `operation-approval.mjs`
(`OPERATION_CONTENT_DOMAIN`, `operationDigestOf`), `canonical.mjs` (`canonicalJSON`), `subject.mjs`
(`parseSubject`, re-exported for `memory-owner.mjs`) and `did-key.mjs` (`didKeyFromEd25519PublicKey`,
`ed25519PublicKeyFromDidKey`). Nothing else, and no
aumlok module imports anything from Kira. The three addresses are exported as
`AUMLOK_APPROVAL_MODULE`, `AUMLOK_RECEIPT_MODULE` and `AUMLOK_DIGEST_MODULE` and asserted by
`tests/kira-approval.test.mjs`, so a move of one fails loudly with a name rather than silently
drifting. The alternative — restating the domains and the signing rule inside Kira — is a copy that
agrees with itself forever, which is exactly what a verifier must not be.

**The document this lane consumes** (what `approvalFile` must contain):

```jsonc
{
  "authorization": { "grant": { /* aukora-kira-memory-grant/v1 */ }, "record": { /* the staged record */ }, "subject": "aukora:1:<sha256>" },
  "approval": {
    "domain": "aukora:approval-receipt:v1",
    "verdict": "OWNER_KEY_SIGNED",
    "keyClass": "B", "keyClassMeaning": "software-held",
    "approvalClass": "scripted",
    "subject": "aukora:1:<sha256>", "activeControlDigest": "<sha256>",
    "approvalKeyDid": "did:key:z…",
    "operationDigest": "<sha256>", "challenge": "<sha256>",
    "issuedAt": 0, "expiresAt": 0,
    "signature": "<128 hex>", "signedBytesDigest": "<sha256>", "verifiedAt": 0,
    "attendance": "reported-not-proven", "signerDeviceTrusted": "not-established",
    "succession": "unmeasured", "identityBound": false, "ceilings": [ /* … */ ]
  }
}
```

That `approval` object is EXACTLY what `scripts/aumlok/approve-operation --artifact-out` writes, and
exactly what `scripts/aumlok/verify-approval <artifact> --pub <key>` verifies from an empty
directory. Nothing wraps it and nothing is added to it. A composition may name `grantFile` and
`approvalFile` at the SAME path when the file is this two-field document; each reader unwraps its own
field and never the other's.

**The subject grammar is Aumlok's.** `aukora:1:<64 hex>`, required by `readAukoraId` on both the
producing and the parsing side of the approving lane. This lane's record layer treats a subject as an
opaque string, so it is `memory-owner.mjs`'s `settle` that requires the record's own `subject` to BE
the subject the owner serves — an approval for this owner's memory that would write a record into a
memory the read owner can never show is refused `RECORD_SUBJECT_MISMATCH`, and nothing is spent. No
court yet drives `RECORD_SUBJECT_MISMATCH`, and the plugin mount path does not apply the `aukora:1:`
grammar: only a direct `createMemoryOwner({subject})` does.

**Which approver key is accepted.** `memoryOwner.approverDid`, when named, must be the `did:key` of
the registered approval key, and an artifact signed by any other key is refused
`kira.settle:approver-not-registered`. It is optional, and its absence is a NAMED limit on every
verdict (`APPROVER_PINNED`, beside `SCRIPTED_APPROVAL`): without a pin, verification establishes that
a key the artifact NAMES signed these bytes — which a freshly generated key can also satisfy. The rows
`scripts/materialize-aukora-release.py` generates name no pin, deliberately, because this repository
provisions no controller register for one to name.

**What `operationDigest` must be**, so the two lanes meet exactly — and this is the rule that had to
be reconciled, because the two lanes did NOT agree:

```
content         = memoryEffectBody(memoryPut)          // the bytes the settlement stores
                = canonicalJSON({"key": <recordId>, "value": <record>}) ‖ "\n"
operationDigest = sha256( utf8("aukora:operation-content:v1") ‖ 0x00 ‖ utf8(content) )
```

The preimage is AUMLOK'S rule applied to THIS lane's effect bytes, and the choice is stated rather
than implied: a `sha256(canonicalJSON({key, value}))` with no domain and no terminator — what this
lane computed before the reconciliation — is not domain-separated, and it bound a byte string NO
other part of the system used. Under the reconciled rule the approval's `operationDigest`, the
grant's `effectDigest` and the object's content address at `objects/<sha256(content)>.json` all cover
ONE string, and a third party holding only the content file re-derives the digest with
`sha256("aukora:operation-content:v1" ‖ 0x00 ‖ file)`. Kira RE-COMPUTES it from the bytes about to be
settled and never reads a digest from the document, so a disagreement is visible as
`kira.settle:content-mismatch` rather than as a write nobody approved. There is ONE accepted
convention; there is deliberately no "also accept the other one" branch. Time units are unix SECONDS
on both sides (`issuedAt` / `expiresAt` beside the grant's `expiry`).

**The labels on the artifact are NOT signed, and are treated as labels.** Only the seven request
fields are inside the preimage, so `approvalClass`, `keyClass`, `attendance` and `identityBound` can
be rewritten without breaking a signature. This lane therefore REFUSES the claims it cannot stand
behind, by name, instead of printing them beside a green: `kira.settle:class-unsupported` for
`human-ceremony` (no enrolment register exists here), `kira.settle:attendance-unsupported` for any
`attendance` other than `reported-not-proven`, and the identity-bound refusal for
`identityBound: true`. The identity-bound refusal has no court of its own yet: its only arm is masked by
the attendance refusal, which fires first.

**The daemon-free double, and the honest label.** `scripts/kira/kira-approve.mjs` mints the SAME
artifact through Aumlok's own `createApprovalReceipt`, from its own disposable key, for the case the
shipped producer cannot serve (no signer daemon, no controller directory). It does not have the key
split and says so; `tests/kira-approval-standin.mjs` is its in-process form. Because it imports the
digest rule from the consuming lane, a drift in that rule moves BOTH the double and the verifier
together and the Kira courts cannot see it — which is why the negative control for the digest rule
lives in `tests/kira-approval-wire.test.mjs`, the only court with the SHIPPED producer on the far
side of the wire. Every artifact carries `approvalClass=scripted` and
`attendance=reported-not-proven` on its face; it is not the owner signer, holds no controller,
performs no ceremony and claims no identity binding.

**The same-operator audit, and what it changed.** A separate read-only reviewer agent (same operator;
not an independent audit) demonstrated six ways past the gate in the first version of this increment. Its
scratch evidence was not retained. All six are fixed here. Each has an arm in
`tests/kira-approval.test.mjs`. Five also have a mutation in `scripts/kira/kira-approval-mutations.mjs`;
the clock defect is listed there as `NOT_MUTATED`, because the per-call clock was removed rather than
gated:

| Audit defect | What it did | The fix | The arm |
|---|---|---|---|
| the one-use key was a digest of the WHOLE artifact while the signature covers only the seven request fields | editing an unsigned field minted a new identity for the same signature: **one approval, two writes** | the identity is the signed pair (`challenge` + `signature`) and nothing else | `editing-an-unsigned-field-does-not-buy-a-second-write` |
| the effect `value` was read three times | an accessor answered the approval digest, the grant digest and the written body: **approval for A, write of B** | `plainMemoryPut` reads each field ONCE from a property descriptor and refuses an accessor | `an-accessor-effect-value-is-refused-not-read-thrice` |
| `staged.recordId` was never bound | `keys/<a>` over a body identifying itself as `<b>`: **a corrupt store from one call** | the identifier must be the record's own | `a-record-id-that-is-not-the-records-own-is-refused` |
| a per-call clock | `settleAuthorized({now: 0})` voided an expired approval window | the per-call clock was REMOVED; the owner's own clock is the only one | `the-approval-window-is-checked-against-this-ownerships-clock` |
| the receipt's approval block was checked for SHAPE only | a FABRICATED `operationDigest` verified | the block is compared to the CONSUMPTION RECORD written before the effect | `a-receipt-omitting-or-faking-its-approval-is-refused` |
| a receipt with NO approval block verified over a store that had consumed one | an approved write could be re-signed as an unapproved-looking one | a store that consumed an approval for a record requires the receipt to name it | same arm |

**Carried across the reconciliation, and where the wording moved.** The audit was taken against the
revision where this lane read its own `aukora-kira-owner-approval-bundle/v1`: defect 1 was measured on
that bundle's unsigned `source`, and the audit revision's stand-in grew helpers
(`buildRequest`/`approveRequest`/`decline`) whose only purpose was to wrap ONE signed request in two
bundles that differed in that field. The reconciliation **deleted that shape**, so the fix is applied
on top of Aumlok's `aukora:approval-receipt:v1` and the control moved with it:

* the identity rule is unchanged in substance — `approvalIdOf` is the domain, the `challenge` and the
  `signature`, and nothing else — but the domain is now the receipt's own
  `aukora:approval-receipt:v1` rather than the deleted bundle's kind;
* the arm edits `keyClass` (with the `keyClassMeaning` that Aumlok's parser derives from it), which is
  the reconciled artifact's nearest equivalent to `source`: an unsigned label about the APPROVAL rather
  than about the approved content. The court edits the artifact on disk rather than minting two
  documents, which is the edit an attacker would actually make;
* the bundle-era stand-in helpers were removed rather than carried, because nothing calls them once the
  shape they built is gone. This is a deliberate deletion, not a silent one: no shipped or test code
  outside this module referenced them.

These six defects were properties of the RULE, not of the bundle. Defect 1 in particular re-appeared
verbatim on the reconciled artifact — the reconciliation derived the one-use key from the whole parsed
receipt — so carrying the fixes across was not a formality: without them, the reconciled wire's own
artifact would have permitted one approval to authorize two writes.

Re-run against the fixed bytes, the auditor's own attack scripts report: the identity is unchanged by an
unsigned edit and the second write refuses `kira.settle:replay`; the accessor is refused
`APPROVAL_INPUT_NOT_CANONICAL` with zero reads; a mismatched identifier refuses `RECORD_MALFORMED`; the
caller's clock is ignored; both re-signed receipts refuse. Two limits the audit also reported remain, and
are NAMED rather than fixed here: an UNPINNED composition accepts a self-generated approver key (closed
whenever the composition names `memoryOwner.approverDid`), and a store's issuer key is readable by any
same-uid process (`ISSUER_LOCAL`, a ceiling this module has always carried).

**What is NOT changed by this.** Existing Kira v1 records and signatures are
untouched: no historical hash is rewritten, no old receipt is re-signed, and no
existing record is retroactively labelled owner-approved. A receipt's approval
block is OPTIONAL and only receipts issued by this increment carry one — the
receipt-history suite's 16 arms, including its four controls and the re-signed
forgery, still pass unchanged.

## Mount and read-owner dependencies

*Corrected 2026-09-26: all three now exist.*

1. **A composition row.** Done: the materializer carries Kira and mounts it in the
   default composition (with the subject caveat recorded in the table above).
2. **A read owner.** The plugin mounts with `readOwner.module` or `memoryOwner`.
   `lib/memory-owner.mjs` supplies the production read owner. That the disposable
   test adapter is unreachable from `plugins/` rests on `kira-recall`'s
   write-boundary arm, which is currently red.
3. **An admitted memory producer.** Now implemented in this lane
   (`lib/memory-owner.mjs`): a governed `memory.put` transition — one-use grant
   bound to the effect digest, spend after every check, signed receipt, one Aura
   entry — plus the read owner over the same store. The default composition
   names it, so `kira.stage` reports `available: true`. Settling still needs an
   operator-minted grant, and an approval for a subject the approval lane can
   parse, which the default row does not supply.

## Handoff

- Interface supplied: the read-owner contract in `lib/read-owner.mjs` and the two
  tool schemas in `lib/tools.mjs`.
- Done: required CI and worktree coverage for the lane's shipped bytes, authored
  by the lead on `codex/kira-ci-integration` and merged here normally.
- The admitted memory path exists (`lib/memory-owner.mjs`). `kira.stage`
  reports `settlementStatus` from configuration: `available` is `true` whenever
  `memoryOwner` is configured, as in the default composition.
  `KIRA_SETTLEMENT` remains only as the unconfigured alias.
- The row is mounted: `aukora-composition.patch.yml`, generated by
  `scripts/materialize-aukora-release.py`, names it.

## Rejected dependency: `@openviking/dsh-memory-plugin` (2026-09-21)

**Not adopted. The reasons below are recorded from a review whose inputs were not retained** — no
package version or commit, no digest, no name for the undeclared event, and no location for any finding —
so they cannot be re-checked as written. It was proposed as a ready-made answer to memory-across-sessions:

- **Wrong harness version.** It targets DSH `rc.6`; this deployment runs an untagged commit five after
  `dsh-v0.1.6-alpha.1` (`upstream-dsh.json`). A plugin built
  against a different runtime's types is not a candidate, it is a second thing to debug.
- **It hooks an event this harness does not declare.** An event name the runtime never emits fails
  silently in the worst way: the plugin mounts, reports healthy, and never runs.
- **`autoCapture` is ON by default.** A memory path that writes without being asked is the opposite of
  this lane's contract, where a write needs a one-use grant AND a verified owner approval, and neither
  substitutes for the other.
- **Unfiltered MCP write tools.** It exposes write surfaces this plugin deliberately does not hold. Kira
  holds a READ owner and an inert proposer; a bundled write path would widen that by dependency.
- **An UNCONDITIONAL pending-replay drainer.** It replays queued items on every start with no condition
  on approval, scope or spend. That is an unattended write loop.
- **No data-not-instructions label in code.** Recalled text would arrive in a context unlabelled, and a
  model may act on unlabelled text as instruction. This lane's injection carries
  `form: 'snapshot'` so the harness presents a record as data, not instructions. A model may still act
  on instructions inside recalled text, and nothing here measures that.

**The general lesson, which cost more than the decision:** a dependency that *has* the feature is not a
dependency that has *your* constraints. The version pin, the event names, the defaults and the absence
of a label are all things the feature list does not mention, and every one of them is load-bearing here.

What was built instead is in `lib/injection.mjs` and the subscription in `lib/index.js` — see the commit
`kira: recalled memory reaches a fresh context without being asked for` for the seam choice and its
measurement.
