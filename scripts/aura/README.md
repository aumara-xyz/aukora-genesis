# `scripts/aura/` — the observation adapter lane

One job: take the composition gate's **actual** transition log and make it judgeable by the
**pinned** Phase 0 court, with the association between the two made explicit and checked.

The adapter adds no ledger, receipt format or hash of its own; the composition log stays the one
transition ledger. The producer stays `scripts/composition/` and the consumer stays
`vendor/append-only/verify.py`. The lane's witness does add a countersigned envelope
(`aukora-aura-witness-v1`, Ed25519 over `jcs(observation)`), and settle-time retention adds a pending
queue (`<state>/aura/retainer-pending.json`) and a delivery record beside each receipt (`*.retainer.json`).

## The interface (what the lead integrates)

```bash
# the stream label this log is named by — one value, for wiring the existing Phase 0 CLI
python3 scripts/aura/adapter.py chain-key --state "$STATE"

# retain a prefix of the real log (writes retained.json + association.json)
# refuses to overwrite an existing retained.json: keeping an earlier reading is the act,
# and clobbering it would look like a successful retain
python3 scripts/aura/adapter.py retain    --state "$STATE" --out "$DIR" [--size N] [--force]

# present the grown log: writes presented.json, runs the court, reports three facts
python3 scripts/aura/adapter.py present   --state "$STATE" --retained "$DIR/retained.json" --out "$DIR"

# judge an existing pair against a named log (association + court + log-in-hand)
python3 scripts/aura/adapter.py associate --state "$STATE" --retained R.json --presented P.json [--out "$DIR"]
```

Three facts are printed on every path, separately, and they are separate questions:

| Fact | Question | Answered by |
| --- | --- | --- |
| `ASSOCIATION` | are these documents about **this** log, at these positions, for the receipts that name them? | this adapter, by recomputation |
| `COURT` | what does the pinned court say about the pair **alone**? | `vendor/append-only/verify.py`, a separate process |
| `COMPOSITION` | what does the log **in hand** say about the same two sizes? | `scripts/composition/aura.py:verify_consistency` |

Exit codes: `0` all three green, `3` a verdict was reached and is not `APPEND_ONLY`,
`2` a named refusal (the question could not be asked), `1` unrunnable. A refusal is never
itself a verdict, and a court verdict is never suppressed by an association refusal:
`associate` prints `COURT: APPEND_ONLY` *and* `REFUSE: aura-pair-not-this-log` for a valid pair
that belongs to another log, because that combination is the whole reason this lane exists. The
other refusals print no verdict.

## The host path it is built for (B3 admission → accepted issuer → this adapter)

`plugins/aukora-composition-gate/` enforces at the real Cordis loader seam, as a node
bootstrap. Its admission decision runs inside a **synchronous** module-load hook, so it cannot
spawn the issuer: it records an **admission** in `<state>/admissions.jsonl` marked
`receipt: PENDING_SERIALIZATION`, and the accepted serializer
(`scripts/composition/serialize-admissions.py --state <state>`) turns admissions into receipts
afterwards through the one issuer. That script writes the composition's
`<state>/aura/records.jsonl` — the log this adapter reads — and puts each receipt in two
places: `receipt-<operation>-<seq:03d>.json` in the state root (the loader's own copy) and
`receipts/<id>-<seq:03d>.json` (the serializer's copy). Both are read here, and both must name
the same position.

```
disposable DSH profile ──► gate admits (admissions.jsonl, PENDING_SERIALIZATION)
                               │  no log entry, no receipt — the adapter refuses: aura-admission-pending
                               ▼
                        serialize-admissions.py ──► aura/records.jsonl + receipts
                               │
                               ▼
                        this adapter: retain / present / associate
```

**An admission is never read as a receipt.** With a ledger holding pending rows and no log,
every verb refuses with `aura-admission-pending` naming the count and the serializer command,
and prints no verdict at all. A row a previous drain could not settle keeps its `settleError`
in the ledger and is still reported as pending, never as settled.

What the host path cannot do today, measured: the gate admits **load only**, and the composition
ledger's state machine does not swap — one state directory settles **one** load. Extending a host
log past its first entry therefore goes through the accepted CLI in the same state dir
(`grant --operation unload`, then `unload`), which writes the same log with the same producer
module. The host-path test does exactly that and labels it.

## The verdict contract, pinned by digest

[`COURT-CONTRACT.md`](COURT-CONTRACT.md) states, for anyone who needs to speak about Aura
consistency without reading this lane's code: the two documents and the one question, the exact
three verdicts and their reasons, what a retained observation **proves** and what it does **not**
(not truth, not authorization, not latestness, not completeness, not custody, and not the
composition's other root convention), the 2^k limit with the measured verdict at each branch, and
the rule that **a consistency verdict never authorizes anything**. It also pins the digest of the
vendored court it describes.

It is written to be pinned rather than paraphrased: a tool that follows Aura should pin that file
by SHA-256 and cite the digest, instead of inventing chain rules of its own. Any edit — even a
reflow — changes the digest, which is the point: there is no "latest version" of a contract, only
the text whose digest you checked.

## Named refusals

| Code | Raised when |
| --- | --- |
| `aura-no-log` | no `aura/records.jsonl` and no pending admissions |
| `aura-admission-pending` | admissions exist in the ledger with no receipt yet |
| `aura-log-not-admissible` | the composition reader refuses the chain (torn line, seq gap, broken `prev`) |
| `aura-views-disagree-*` | the composition reader and the Phase 0 reader disagree about the same file |
| `aura-pair-not-this-log` | a document names another stream, or a document under the fixed retainer label |
| `aura-root-not-this-log` | a document's root is not the root of that prefix of this log |
| `aura-proof-not-this-log` | the presented proof is not the proof from the retained size over this log |
| `aura-observation-beyond-this-log` | an observation names more entries than this log has |
| `aura-receipt-not-this-position` | a receipt's `aura` block disagrees with the entry at the position it claims |
| `aura-pair-sizes-disagree` | the presented document extends a different retained size than the one supplied |
| `aura-receipt-beyond-this-log` | a receipt claims a position this log cannot have |
| `aura-receipt-not-admissible` | a receipt fails the accepted contract's own structural check |
| `aura-retained-exists` | a second `retain` would clobber the earlier reading (`--force` replaces it) |
| `aura-retainer-refused` | the Phase 0 retainer module raised `RetainerError`, which is reachable when the file already at that size's path is not an admissible `aukora-retainer-v1` envelope (CODE ONLY, no arm). A different observation for a size already held is `aura-first-retention-lost` |
| `aura-witness-signature-is-the-nodes-own` | a countersignature verifies under the key this state publishes as its own |
| `aura-witness-signature-invalid` | a countersignature does not verify under the key it carries |
| `aura-witness-unreachable` | the witness could not be reached: the question is unanswered, not answered |
| `aura-witness-refused` | the witness answered with its own refusal (size already signed, body not admissible) |
| `aura-witness-holds-no-observation` | the witness holds no head for that stream and size, and invents none |
| `aura-witness-absent` | `--publish` named a URL but this lane's witness module is not beside the adapter |
| `aura-first-retention-lost` | another writer retained a **different** observation for this stream and size first, so this one did not land |
| `witness-lost-first-retention` | the same loss, refused by the witness itself |
| `witness-observation-is-not-what-was-asked-for` | a read-back returned a head whose own stream or size is not the one requested |
| `witness-body-too-large` / `witness-body-length-required` | the request body exceeds the bound, or declares no length to check it against |
| `witness-stream-limit` / `witness-size-limit` / `witness-storage-limit` | a named resource bound was reached: streams, sizes per stream, or store bytes |
| `witness-rate-limited` | more retention requests in a minute than the bound allows |

A refusal is never a verdict, and a verdict is never suppressed by a refusal: `associate`
prints the court's answer for the pair and then refuses the association, because a valid pair
that belongs to another log is exactly the case worth seeing.

## What a receipt row says, and what it does not

Each entry row lists every receipt-shaped document found for that position, from the state root
and from `receipts/`, with its `sha256`, `kind`, `operation`, `nonce`, `root`, `carriedKey`
(the key the receipt itself names) and `class`/`conformance`.

**Two signature questions, never merged.** A receipt carries the public key it names, so a
signature that verifies under that key proves the document is self-consistent and nothing more —
anyone can mint a self-consistent receipt under a key of their own. Every receipt is therefore
checked twice and labelled by what actually happened:

| `signature` | `issuerMatch` | What it means |
| --- | --- | --- |
| `issuer-pinned` | `true` | it verifies under `<state>/issuer.pk`, the key this installation publishes for its issuer — the same file `scripts/composition/loader.py:verify_receipt_against_pair` passes as `expect_pk` |
| `carried-key-only` | `false` | it verifies under the key it carries, and that key is **not** this installation's issuer |
| `carried-key-only` | `null` | it verifies under the key it carries and the state publishes no issuer key, so there is nothing to anchor to |
| `invalid: <reason>` | `null`/`false` | it does not verify at all |

The anchor comes from **one read per verb** of `<state>/issuer.pk`, and that read has three
outcomes which are never collapsed into two:

| `issuer.snapshot.status` | Meaning | Printed as |
| --- | --- | --- |
| `pinned` | the path exists, is readable, and holds a 64-hex public key | `ISSUER      : pinned — <path>` |
| `absent` | there is no entry at that path: this installation publishes no key | `ISSUER      : absent — no issuer.pk at <path>` |
| `unusable` | an entry exists and cannot be used: unreadable, not text, or not a 64-hex key | `ISSUER      : unusable — <path> exists but cannot be used: <reason>`, plus a `CEILING` saying this is **not** the absent case (printed on the refusal path too) |

An existing-but-unreadable file used to be reported as an absent key, which is the quieter of
the two claims and the wrong one: they need different repairs. `unusable` never anchors
anything — every receipt stays `carried-key-only` — and the ceiling states that an absent key
and an unreadable key are different facts.

The snapshot is taken once and passed to classification, to the rows, to the human lines and
to the manifest's `issuer` block, so the labels and the emitted issuer evidence cannot
describe two different reads: `entry_associations` requires the snapshot (no default), no
`None` fallback rereads the file, and `issuer_evidence()` builds that block in one place for
all three verbs. An arm wraps `issuer_snapshot` and counts the calls each verb makes (exactly one
each), and `issuer_snapshot` is the only reader of `issuer.pk` in the adapter; no arm counts file reads
directly. A held snapshot is shown to keep classifying by the key it captured while a fresh snapshot
sees a replacement.

The manifest's `issuer` block keeps the v1 field meaning and adds one:
`configured` is still `null` when this state publishes no readable key file, and otherwise the
v1 `{path, publicKey}` (or `{path, publicKey: null, note}` for a readable non-key), so a reader
written against `aukora-aura-association-v1` cannot read absence as a published key;
`snapshot` is the additive field carrying `status`, `source`, `publicKey`, `reason` and
`readable`. All three verbs emit the same five keys — `configured`, `snapshot`, `source`,
`classification`, `note` — and an arm asserts that shape.

The between-runs arm is exactly that: two sequential processes, each consistent with the key it
read, and run two not rewriting run one's document. It is **not** a mid-run mutation test; the
mid-run property is carried by the held-snapshot control above, which is deterministic and has
no timing race.

The human summary counts the three classes separately —
`RECEIPTS : N issuer-pinned (<path>), M carried-key-only, K invalid` — and the headline counts
**only** `issuer-pinned`. `carried-key-only` is self-consistency, never an anchor to this
installation: no carried key is read as an authority, no network trust is used, and no owner
attendance is claimed. A receipt-shaped document that claims no usable position (`aura.seq`
missing or not a positive integer) is refused by name rather than skipped.

Every receipt in the state is checked against the log, not only the ones inside a retained
prefix: a receipt that lies about a position is a property of the receipt, not of the size a
caller happened to ask for. A refusal raised before the write step writes no document; the `--out`
directory itself may already have been created. `retain --publish` writes `retained.json` and
`association.json` before it publishes, so a publish refusal leaves both behind without a `retainer`
block.

`associate` answers a pair that *shrank* rather than calling it unanswerable: with both sizes
inside the log it reports `COMPOSITION: OBSERVATION_CONFLICT` (the log-in-hand comparison) and
the court's `UNDETERMINED`, which is exactly the case the association declines to refuse.
When the association itself refuses, no composition verdict is printed; a `COMPOSITION : not asked`
line says why (CODE ONLY: no arm asserts it). That comparison is this log against itself and would say
`APPEND_ONLY` about the log while saying nothing about the documents — the one green number a reader
could misread in the case that matters.

## Roots: each bound to its stated algorithm and the same prefix

`association.json` records both conventions for each observation as
`retained.roots.phase0` / `retained.roots.composition` (and the same for `presented`), each
carrying `algorithm`, `root`, `consumedBy`, and the shared `prefix` and `entryHash`. They are
different numbers over the same bytes by construction and are never compared with each other.

## Every document this adapter writes is consumable unchanged

`retained.json` and `presented.json` are the wire shape `scripts/phase0/retain-head`,
`present-head` and `verify` already speak (`schema`, `chainKey`, `leafConvention`,
`treeSize`, `root`, `atGeneration`, plus `proofFromPrevious` and `retainedTreeSize` on the
presented one), so the existing CLI runs over them:

```bash
python3 scripts/phase0/verify "$DIR/retained.json" "$DIR/presented.json"   # -> APPEND_ONLY
```

To point the existing producer at the same stream instead, pass the derived label:

```bash
python3 scripts/phase0/retain-head --state "$STATE" --out "$DIR/retained.json" \
  --chain-key "$(python3 scripts/aura/adapter.py chain-key --state "$STATE")"
```

A document retained under `retain-head`'s fixed default label (`genesis-phase0:aura-chain`)
is refused as `aura-pair-not-this-log` with that label named and the key to re-retain under:
a fixed label names no log, and a pair that names no log is not evidence about any log.

## Two conventions over one log, never compared

| Convention | Leaf | Written by | Consumed by |
| --- | --- | --- | --- |
| `aukora-receipt-line-sha256-v1` | sha256 of the canonical bytes of log line k, used as the leaf with no re-hashing | `scripts/phase0/phase0log.py` | the pinned court |
| `rfc6962-leaf-sha256-0x00-prefixed-v1` | sha256(0x00 ‖ entry_hash_k), the composition's own entry hash | `scripts/composition/aura.py` (a receipt's `aura.root`, `Loader.checkpoint()`) | the log-in-hand comparison |

Same log, same positions, **different roots by construction**. Both are printed under their
own names on every run. Comparing one with the other means nothing, and this file never does.

## Provenance

Read at the source pin `c417f7c5752bf14b8e927986cd995f2e086f4189` (2026-09-15), digests are
sha256 prefixes of the file bytes at that commit:

| Pin file | sha256 |
| --- | --- |
| `aukora/aura/record.mjs` | `399df7807a05a4b8` |
| `aukora/aura/checkpoint.mjs` | `e6534c236ec0c749` |
| `aukora/aura/merkle.mjs` | `f14918b817ba4106` |
| `aukora/aura/authority-evidence.mjs` | `02dc5fcc4d970964` |
| `docs/specs/KIRA-MEMORY-SPEC.md` | `56a68773857924a5` |
| `docs/AUKORA-BOUNDARY-ARCHITECTURE.md` | `d2dd28bbb871f980` |
| `archive/research/THE-GOLDEN-BOUNDARY.md` | `6c54a24afe87a662` |
| `archive/research/UNOWNABLE-CORE.md` | `e48c27b027543fbe` |

Genesis files this lane **consumes and does not own**, digests at base `b887dde`:

| Genesis file | sha256 | Owner |
| --- | --- | --- |
| `scripts/composition/aura.py` | `6488becaf22f2e83` | the lead's composition lane |
| `scripts/composition/receipt.py` | `75f2bc14e1c75efa` | the lead's composition lane |
| `scripts/composition/loader.py` | `eb23b3ac0df6b6c1` | the lead's composition lane |
| `scripts/phase0/phase0log.py` | `2ff4471f70c65652` | the Phase 0 lane |
| `vendor/append-only/verify.py` | `039aa8999f9a1e1a` | vendored; never edited |

What was taken from the pin, and what was **not**:

- Taken: the separation of evidence from truth, authorization, latestness and custody
  (`UNOWNABLE-CORE.md` §3, `AUKORA-BOUNDARY-ARCHITECTURE.md` §2, §7), and the KIRA rule that
  a deterministic record id and a chain head answer different questions and must not be
  merged (`KIRA-MEMORY-SPEC.md` §3) — the association manifest keeps `recordId` and
  `contentSha256` in their own fields beside the sequence, never as an interpretation of it.
- Not taken: `aukora/aura/record.mjs` is a *different* record format (domain-separated
  `{hash, prev, ...fields}` lines). This lane does **not** re-implement it and does **not**
  create a second chain: the composition gate's log is the one ledger, and the adapter is a
  reader of it. `checkpoint.mjs`'s `streamNamespace` label is carried by this lane as the
  derived `chainKey`, which is a label and not an authentication.

## What this lane does not own

Settlement, grants, receipts, the log's own write path, the court's bytes, `scripts/phase0/`,
`scripts/composition/`, shared CI, the plan, the coordination file and `vendor/`. Wired by the lead
in `.github/workflows/b1.yml`: `aura-adapter` (plain and `--mutate`), `aura-host-path`,
`aura-association-row`, `aura-settle-retain`, `aura-witness` and `aura-t7-retention`. None runs from
`scripts/aukora-courts.sh`, and the `--mutate` registrations of `aura-adapter`, `aura-witness` and
`aura-t7-retention` do not read the flag (`b1.yml`'s own comments).

## Limits, on every path

- Evidence, not truth: two documents describing one log say nothing about whether a
  transition happened or whether a record is true.
- Evidence, not authorization: nothing here is a grant, a nonce or a permission. A receipt
  signature is checked under the key the receipt carries unless this state publishes an issuer
  key, and a `carried-key-only` result is self-consistency rather than an issuer anchor.
- Evidence, not latestness: the presented head is this log's head as of this read; another
  log may exist and this adapter cannot see it. A truncation with no earlier retained
  observation is **undetectable** — the test asserts that as a passing arm, because a limit
  that is smoothed over is the defect.
- Evidence, not custody: the retained document sits in a directory this uid owns on this
  host, or in a retainer working copy this uid pushed, or countersigned by a second process
  this uid started. None of those is an independent retainer, and every verdict using one
  prints `RETAINER_SAME_OWNER`. Independent custody needs a second principal holding a copy.
- The court's power-of-two blind spot: a retained size m = 2^k uses the retained root as the
  fold seed. A rewritten prefix there is `UNDETERMINED` rather than `OBSERVATION_CONFLICT`, and
  an `APPEND_ONLY` there is **not** complete verification of the prefix — the court assumed the
  retained root instead of deriving it. Every present or associate run that reaches a verdict with a
  retained size that is a power of two, smaller than the presented size, prints a `CEILING:` line saying
  so; an off-2^k pair prints none (host-path arms "retained at 1 (2^k)…" and "retained at 3 (off 2^k)…").
  The associate refusal path prints the court's verdict without that line. The flipped-root case is an arm
  in both suites.
- An admission is not a receipt, and a receipt is not a transition that had an effect: the gate
  binds the governed entry file's bytes by digest at admission — not its imports, and not its path (a
  byte-identical copy under the same governed id at another path is admitted; measured, not pinned, by
  `declared-id-regression.sh` arm 6). The plugin shares this process and this uid, so the binding is a
  digest binding, not isolation.

## Lane tests

```bash
node tests/aura-adapter.test.mjs      # 40 arms: the accepted producer, the pinned court
AUKORA_DSH_RELEASE=<release> node tests/aura-host-path.test.mjs   # 25 arms: the real B3 host admission path
node tests/aura-witness.test.mjs      # 11 arms: the countersigning witness, as a separate process
```

The first drives `scripts/composition/__main__.py` directly. The second boots a **disposable DSH
profile** with the gate installed as the node bootstrap, admits a governed plugin at the real
loader seam, runs the accepted serializer, and consumes the host's own log and receipts; it
needs `AUKORA_DSH_RELEASE` (a materialized release) and reads the profile from
`tests/fixtures/headless-profile/` unless `AUKORA_PROFILE_TEMPLATE` points elsewhere. The third
starts `scripts/aura/witness.py` as its own process on a loopback port the OS assigns, and drives
it over HTTP. All three run under the system temporary directory and touch no live state,
credentials or running process; only the third binds a port, and only on the loopback interface.

These suites are wired in `.github/workflows/b1.yml` (see "What this lane does not own" above); none
runs from `scripts/aukora-courts.sh`.

## Review

An adversarial review of this round's diff (reviewer and report not recorded here, so it is not
independent verification) reported seven defects; each fix landed with an arm (`c92c010fa`, then three
more in `3457131d1`); a second pass confirmed six closed, narrowed the seventh, and found
three more, all now closed too: receipts were structurally checked but not signature-verified (rows
now carry the contract's own verdict); `retain` never reported pending admissions; `retain`
checked receipts only inside the retained prefix; a refused `retain` left a `retained.json` that
blocked the retry; a refused `present` overwrote the previous pair's document while its manifest
still described the old one; the proof refusal named lengths instead of the element that
disagreed; and a receipt-shaped document with a non-integer `seq` was skipped silently. A second
reviewer (codex) could not read the source — its code-mode helper binary is missing on this host —
and reported no findings; it is not counted as a review.

The second pass: `present` still wrote its document before two later steps that can refuse, so a
rejected run could leave a fresh document beside a stale manifest — the document is now staged,
the court reads the staged bytes, and it is renamed into place only after the court answers. A
receipt-shaped document whose `aura` is not an object was still skipped silently — refused now. The
headline count said "N with a receipt" even when signatures did not verify — it now counts only
issuer-pinned receipts: "N position(s), P with an issuer-pinned receipt, X not issuer-pinned". And an unreadable-only ledger produced "0 admission(s) pending
serialization" plus a remedy the accepted drain provably cannot carry out — the count is omitted at
zero, unreadable lines are counted separately, and that case says the drain cannot clear it.

## Publishing to the off-host retainer

`retain --publish <retainer-dir>` writes the retained observation into the layout
`scripts/phase0/retainer.py` already reads — `<root>/heads/<chainKey>/size-<N>.json`, envelope
`aukora-retainer-v1` — by staging the bytes with that module's own writer and linking them into place
with `os.link`, so the first retention for a size wins and a different observation for that size is
refused as `aura-first-retention-lost`. The document's sha256, size, chainKey and
layout are recorded in the manifest's `retainer` block. **Nothing is pushed**: the command writes
into the directory it is given and prints the git commands, because a reading tool that silently
wrote to a remote would be making a custody claim on the operator's behalf.

```bash
python3 scripts/aura/adapter.py retain --state "$STATE" --out "$DIR" --size N --publish "$RETAINER_WC"
git -C "$RETAINER_WC" add heads && git -C "$RETAINER_WC" commit -m 'retain <chainKey> size N' && git -C "$RETAINER_WC" push
python3 scripts/phase0/verify --retainer https://github.com/aumara-xyz/aukora-retainer.git \
        "$DIR/presented.json" --chain-key "$(python3 scripts/aura/adapter.py chain-key --state "$STATE")"
```

The verdict that comes back is the vendored court's, computed from retained bytes fetched from
the remote, and it prints `CUSTODY: RETAINER_SAME_OWNER`: a retainer on the same GitHub account
held by the same principal shows that this host did not silently rewrite its own history. It is
**not** independent custody. Another local directory, another local process, or a private
repository this host pushes to does not establish independent custody either, and the label says
so on every verdict. Independent custody needs a second principal holding a copy.

## The witness (B2c): a second key, still the same principal

`scripts/aura/witness.py` is a small service that receives a retained observation, countersigns
it under an Ed25519 key of its own, and serves it back.

```bash
python3 scripts/aura/witness.py serve --root "$WITNESS_ROOT" --port 4479
python3 scripts/aura/witness.py pubkey --root "$WITNESS_ROOT"

# the node sends the observation and reads the countersigned head back, in one command
python3 scripts/aura/adapter.py retain --state "$STATE" --out "$DIR" --size N --publish http://127.0.0.1:4479

# and the court then reads it from the countersigned copy, through the retainer path it already has
python3 scripts/phase0/verify --retainer "$DIR/witness" --chain-key "$KEY" "$DIR/presented.json"
```

`--publish` takes a directory or an `http(s)` URL. With a URL it POSTs the observation to
`<url>/retain` and then **reads it back** (`GET /heads/<chainKey>/size-<N>.json`): a witness that
accepted a document and could not serve it again has retained nothing a later verifier can use.
The countersigned head is written into `<out>/witness/` in the retainer layout, so the court reads
it through `scripts/phase0/retainer.py` — the Phase 0 lane's own reader, unmodified — and prints
`CUSTODY: RETAINER_SAME_OWNER`. The `witness` block is extra and ignored by that reader.

What the countersignature covers: `jcs(observation)`, the observation alone, nothing else. The
envelope is not signed, so translating between layouts cannot silently re-point a signature. For
that reason the witness **refuses an observation carrying `retainedAt`**
(`witness-observation-carries-envelope-field`): the retainer reader strips that key, so signing a
document that carries it would sign bytes no reader can re-derive. The timestamp lives in the
envelope (`receivedAt`), and the witness stamps its own clock — it never reports the node's.

Four answers stay four answers, and the tests keep them apart:

| what happened | what comes back |
| --- | --- |
| countersigned, read back, court reads it | `VERDICT: APPEND_ONLY`, `CUSTODY: RETAINER_SAME_OWNER` |
| the countersignature verifies under the **node's own** key | refused by name (`aura-witness-signature-is-the-nodes-own`, exit 2): no countersigned copy and no `retainer` block are written; `retained.json` and `association.json` from the retain step remain |
| the witness serves a head this log no longer extends | `VERDICT: OBSERVATION_CONFLICT`; the node's association refuses by name |
| the witness is unreachable | `witness-unreachable` (`witness.py fetch`) / `aura-witness-unreachable` (adapter, exit 2) and no countersigned copy (the settle hook reports `RETAINER_UNREACHED` and queues the size); a later `verify --retainer` over a retainer that holds no head prints `CONSISTENCY_UNCHECKED` (exit 3). No arm drives the adapter's unreachable path; `retain`'s `retained.json` and `association.json` remain |

The second row is not a weak witness — it is not a witness. A node countersigning its own
observation is the same party talking twice, and the label a verdict carried would be a lie rather
than a caveat. The witness is also not a rubber stamp: it refuses to sign a different observation
for a size it already signed, and refuses a size it never saw rather than inventing one.

**A second key is not a second principal.** On this host the witness runs as a separate process
with a key of its own, and it is the same uid, the same machine and the same administrative
control. Every verdict that used it keeps `RETAINER_SAME_OWNER`. What it does buy: through the
witness's HTTP interface, the node cannot make it sign a different observation for a size it already
signed. It is the same uid, though: a process running as this user can delete or rewrite the witness's
stored head (the witness then signs a new observation for that size), or read its `0600` key, so this does
not hold against this host's own uid.

## T7: first retention is atomic, read-backs are checked, the witness has bounds

Three properties, each with arms that race or mislabel the thing being tested rather than
asserting it in isolation (`node tests/aura-t7-retention.test.mjs`, 19 arms).

**First retention wins, atomically, per stream and size.** Both retention paths used to check
whether a size was already held and then write, and that pair has a window: two first-retentions
of one stream and size can both find nothing and both write, so the second lands on top of the
first and a caller can be told it published while the store holds someone else's observation.
Now the bytes are written to a temporary name and *linked* into place — `os.link` fails with
`EEXIST` and only ever publishes a complete file — so exactly one writer creates the entry and
every other writer is told which case it is in:

| outcome | meaning |
| --- | --- |
| `retained` / `won: true` | this call created the entry |
| `already-retained` / `won: false` | it did not write; the store already held an observation with the same root for this stream and size (roots are compared, not bytes) |
| `aura-first-retention-lost` / `witness-lost-first-retention` | another writer retained a **different** observation first, so this one did not land |

Linking rather than writing under the final name is deliberate: `O_CREAT | O_EXCL` on the final
path is atomic about the *name* and not about the *content*, so a second caller that found the
name would read a half-written envelope. The witness's store path now carries a 64-bit prefix of
the whole key's sha256 (`<sanitized>-<digest prefix>`), because sanitizing a stream name is lossy —
`a:b` and `a_b` collapse — so two streams share a path only on a truncated-digest collision (about 2^32
work for a chosen pair). The read-back check refuses such a case by name
(`witness-observation-is-not-what-was-asked-for`) instead of filing one stream's head under another.

**Every read-back is checked against the request.** A head is served, fetched or accepted only if
its own `chainKey` and `size` *and* the observation's `chainKey` and `treeSize` are the ones that
were asked for. The check runs in the witness's store read (`409`, not `404`, because "not what
you asked for" is a different answer from "I never held it") and again in the client's `fetch`,
so a store that was moved, restored from another stream, or answered by something that is not the
witness is refused by name instead of being verified and filed under the requested identity.

**Bounds are named, printed, and refuse as bounds.** Printed at startup as
`BOUNDS : body<=524288B streams<=32 sizes/stream<=4096 store<=67108864B rate<=240/min`, each with
a flag:

| flag | refusal when reached |
| --- | --- |
| `--max-body-bytes` | `witness-body-too-large` (checked before the body is read) |
| `--max-streams` | `witness-stream-limit` |
| `--max-sizes-per-stream` | `witness-size-limit` |
| `--max-total-bytes` | `witness-storage-limit` |
| `--max-requests-per-minute` | `witness-rate-limited` (retention requests only — throttling reads would look like an unreachable retainer) |

A bound that is hit must read as a bound: anything that looks like an unreachable retainer
becomes `CONSISTENCY_UNCHECKED`, which is exactly the distinction this lane exists to keep. Same
custody as everywhere else — `RETAINER_SAME_OWNER`, printed on every path.

## Retaining on settle: the producer path keeps its own head

An operator who remembers to run `retain --publish` after each settle produces a record of when
they remembered, and the interval they forgot is exactly the interval a rewrite would live in. So
the settle itself retains. `scripts/composition/serialize-admissions.py` calls
`scripts/aura/retain_on_settle.py` after the issuer has signed, and that module calls **this
adapter's own `--publish` path** — the operator command's code, not a second implementation of it.

```bash
export AUKORA_AURA_RETAINER_TARGET=/path/to/retainer      # or a git URL, or a witness URL
# or: <state>/aura/retainer.json  { "target": "…" }
python3 scripts/composition/serialize-admissions.py --state "$STATE"
# SETTLED  hello-settled: receipt seq 1 entry … -> …/receipts/hello-settled-001.json
#   RETAINER_UNREACHED size 1: AssociationRefusal: aura-witness-unreachable: … (the effect settled; 1 size(s) waiting)
```

**`AUKORA_AURA_RETAINER` is not this variable, and it is not a destination.** That name belongs to
the launcher: it names the retainer **program** the release carries, is recorded in
`gate-state/gate-config.json` as `auraRetainer`, and is read back out of a running process by the
cutover and rollback paths to refuse a successor whose retainer belongs to the superseded tree.
This module used to read it as the place to publish to, which put the program path through
`makedirs` and reported the resulting `NotADirectoryError` as `RETAINER_UNREACHED` — the same status
a retainer that is merely down produces. A governed launch therefore looked like an outage that
never ended, and nothing was ever retained. Naming the program where a destination belongs is now
refused by name (see the table) instead of being reported as an outage.

| status | meaning |
| --- | --- |
| `RETAINER_PUBLISHED` | the head (and anything queued) reached the retainer |
| `RETAINER_UNREACHED` | the publish failed; the size is queued and the effect settled anyway |
| `RETAINER_TARGET_NOT_A_DESTINATION` | the destination is misnamed — it is the program, or an existing file — so nothing was published. The `refusal` field names which: `aura-retainer-program-is-not-a-destination`, `aura-retainer-target-is-a-file`. The sizes are still queued, and the effect settled anyway |
| `RETAINER_CONFIG_UNUSABLE` | `<state>/aura/retainer.json` **exists** and cannot be turned into a destination: `aura-retainer-config-unreadable` (not readable as JSON) or `aura-retainer-config-names-no-target` (no usable `target` string, or not a JSON object). Nothing was published. This is deliberately NOT `RETAINER_NOT_CONFIGURED`: a file at that path declares that retention was intended, so a broken one must not read as a deliberate no-op |
| `RETAINER_NOT_CONFIGURED` | no destination in `--target`, the environment, or a config file, and no retainer program named: nothing is printed and nothing is written |
| `RETAINER_HOOK_ABSENT` | a target is configured and the hook is not in the release — reported, never skipped |

A retainer that is down never blocks the effect: the hook returns statuses instead of raising, the
caller wraps it in a second belt, and neither can mark an admission unsettled that the issuer
already receipted. Sizes whose publication failed go to `<state>/aura/retainer-pending.json`, and
the next settle that *can* reach the retainer publishes them oldest first, before its own head —
so a verifier holding the head from before the outage still gets `APPEND_ONLY`.

**The flag is not a field in the receipt, and that is a ceiling.** The accepted receipt contract
(`scripts/composition/receipt.py`) is a closed set at both the top level and inside `aura`, so a
retainer flag written into the receipt would make the document `RECEIPT_TAMPERED` while its
signature still verified. The flag therefore rides the delivery record beside the receipt
(`<state>/receipts/<id>-<NNN>.retainer.json`, carrying neither `kind` nor `aura`, so the adapter's
receipt discovery skips it) and the line the settle prints. The receipt says what the issuer
signed, unchanged.

Same custody as everywhere else in this lane: a retainer this host reaches — a directory, a
private remote it pushes to, a witness it started — is `RETAINER_SAME_OWNER`.

## Handoff

Next increments, in the order they become useful — none of them started here:

1. **Retention (landed, `retain --publish`).** One `retained.json` per stream is published into
   the retainer path `scripts/phase0/verify --retainer <dir-or-git-url>` already reads, with the
   document digest recorded in the manifest so a reader can check the bytes the verdict used.
   This is **SAME_OWNER** custody: another local directory, another local process, another local
   key, or a private repository this host pushes to does **not** establish independent custody.
   Independent custody needs a destination whose operator is not this uid, and that remains a
   later, separately-scoped increment.
2. **The witness (landed, `scripts/aura/witness.py`).** A countersigning service on a disposable
   profile, driven by `--publish <url>`: four outcomes kept distinct, listed above. Also
   **SAME_OWNER**, for the reason the section above gives.
3. **Settlement association for memory.** When a `memory.put`/KIRA settlement lands on this
   log, its entry body carries the accepted record fields; the association manifest already
   reports `recordId`, `contentSha256` and `receiptSha256` at their own sequence, and the
   test exercises that carrier shape through the real producer. Settling is the memory
   lane's; reading it is this lane's.
4. **A second `chainKey` per stream**, if the composition gate ever writes more than one log.
   The label is derived from the first entry, so two logs are two labels by construction.
