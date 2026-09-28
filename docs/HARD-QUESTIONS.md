# Hard questions

Every file and line below was opened and checked on 2026-09-27 against the tree of archive commit `1c569f8aa`
with this page's edits. If a later commit moved a line, search for the quoted text. Where the answer is no, it says
no. "Not established" means no file settles it.

Work happens on `main` of `aumara-xyz/aukora-genesis`. aumara-xyz/aukora-genesis-archive (private archive, not a link) holds the history up to
2026-09-27, read-only and private, including every commit pushed straight to `main`; the commit hashes on this page
are there.

## What is not enforced

- **One OS user holds everything.** The app, the agents, their coding subagents and the approval key run as the
  owner's macOS user, with his git and GitHub credentials. The checks here are procedures over bytes, not an
  isolation boundary.
- **The approval key is a software key on this Mac**, readable by that same user. A valid approval proves the key
  signed.
- **Nothing server-side checks `main`.** On 2026-09-27 `aumara-xyz/aukora-genesis`'s `main` had no branch
  protection at all, and the archive's `main` required no status check and no review. CI runs after each push;
  it does not require the approval routes.
- **Attendance is reported, not proven.** No receipt shows that a person clicked.

### 1. Can the AI push to main without approval?

Yes. The agents and the Codex and Claude Code subagents run as the owner's user
(`plugins/aukora-subscription-hands/lib/pins.mjs:242`). git on the Mac uses the macOS keychain helper, and the
GitHub login there is admin on both repositories. On 2026-09-27 `aumara-xyz/aukora-genesis`'s `main` was not
protected, and the archive's `main` forbade force-push and deletion but required no status check or review; agents
push to `main` by design (`AGENTS.md:12`).
`scripts/aukora/self-change.mjs` is the supported route for code, and its header says it is not enforced
(`:22-25`). On 2026-09-27 it carried one code change (`97714048a`); every other change, governing code included,
was pushed directly. The action gate (question 17) refuses a push to `main` typed in a tool call in the app, not one
inside a script, a subagent or a process outside the app.
Check: `git config credential.helper`; `gh api repos/aumara-xyz/aukora-genesis --jq .permissions`;
`gh api repos/aumara-xyz/aukora-genesis/branches/main/protection`; the same two for
aumara-xyz/aukora-genesis-archive (private archive, not a link).

### 2. Then what does the approval path give you today?

Evidence, for the changes that use it. `self-change.mjs` shows the full diff in the popup; the original
governedCrossing binds the proposal to bytes re-read from disk and halts before signature, granting no authority
(`:131-138`). It verifies the returned signature against the pinned key before anything is materialized
(`:188-205`); the kernel spends the approval once and the original localCandidateStage materializes the approved
tree (`:216-222`, `scripts/aukora/aumlok-candidate-authority.mjs:253-306`). It commits exactly that tree with
`Approved-by`, `Approval-digest`, `Operation-digest` and `Candidate-digest` trailers
(`aumlok-candidate-authority.mjs:309-321`), appends an Aura entry (`self-change.mjs:228-232`), pushes (`:247`) and
chains the result it reads back (`:249-253`). The signed approval and the exact text shown stay in the app's support
folder, under `state/home/code-evidence/` (`:157-167`), not in this repository. The current version has not run with
a real approval. Prevention is not built.

### 3. Would a required GitHub check close that?

Not by itself. The credential on the Mac is admin, so it can change branch protection. A required check stops the
agent only when no credential it can reach may push to `main` or edit protection. That is not built.

### 4. Who holds the key?

Two layers. The root key is not stored: it is re-derived with scrypt from a seven-word phrase and a public handle
(`plugins/aukora-aumlok/lib/derive-v3.mjs:4-15`), which gives 34.14 bits at the weakest drawable anchor
(`plugins/aukora-aumlok/lib/themed-entropy.mjs:24`). Approvals are signed by a machine key whose seed sits on the
Mac, by default in `machine-seed-v3.json`, mode 0600 (`plugins/aukora-aumlok/lib/record-v3.mjs:69-82`); reading it
asks no person for anything (`:277-281`). Receipts say key class `B`, `software-held`
(`plugins/aukora-aumlok/lib/approval-receipt.mjs:47`). The approver that `self-change.mjs` and Kira trust is
whatever the live Kira overlay names (`self-change.mjs:151-155`); on 2026-09-27 it was
`did:key:z6MkkVxRYC6uHVpaxyfZAFuNx1LZrwgay1DCPTu6ttPJMQog`.

### 5. Can the AI approve its own change or its own memory?

No tool it is given does that, and nothing prevents it. There is no model-facing approve tool
(`plugins/aukora-kira/bin/kira-approve-queue.mjs:26-28`), and the app signs only after Approve in its popup. But
any process running as the owner can read the machine seed, and this repository ships a terminal signer whose
`--approve test-all` signs every request (`scripts/aumlok/signer.mjs:15-17`, `:88`). A receipt signed with the same
key that way verifies like the popup's: the signature covers only subject, control digest, operation digest,
challenge and validity window (`scripts/aumlok/verify-approval:87-89`), so `approvalClass` and `attendance` are
unsigned. The action gate, mounted in the owner's app (question 17), refuses tool calls that name the seed
(`plugins/aukora-action-gate/lib/policy.mjs:33-54`), not code inside a script.

### 6. What happens if the signer or its key is compromised?

Whoever holds the machine seed can sign approvals that `self-change.mjs`, the Kira settle and the cold verifier
accept, until the live configuration names another approver (`self-change.mjs:151-155`,
`scripts/aukora/remember.mjs:35-40`). The signer runs inside the app's main process
(`apps/aukora-desktop/main.mjs:438`), so code that can change the app can sign. The cold verifier takes no
revocation input and prints `NO_GLOBAL_REPLAY_PREVENTION` and `NO_LATESTNESS`
(`vendor/kira-export/diamond/kira_evidence.py:846-851`), so evidence signed before a key change still verifies.
No check here performs a rotation.

### 7. Can the popup show one thing and sign another?

The signer recomputes the operation digest over the bytes it would display and refuses, before any window opens,
when they do not match the signed request (`apps/aukora-desktop/aumlok-signer.mjs:914-918`). Control, invisible and
bidi characters are escaped (`:426-437`). Approve is enabled only when the description was derived and is not
truncated (`apps/aukora-desktop/aumlok-approval.html:241-244`). `self-change.mjs` refuses more than 1,650
characters, under the window's 1,800 (`self-change.mjs:50`, `:146-148`, `aumlok-signer.mjs:384`), refuses binary
and NUL changes (`self-change.mjs:141-142`), and runs git without the caller's `GIT_*` variables, config or
textconv (`self-change.mjs:62-68`, `:72-73`). The limit is question 5: another signer need not show anything.
Check (prints `signer:operation-content-mismatch`):

```bash
node --input-type=module -e "const s = await import('./apps/aukora-desktop/aumlok-signer.mjs');
const d = s.operationDigestOfContent(Buffer.from('a'));
console.log(s.readOperationContent({ operationDigest: d, operationContent: Buffer.from('b').toString('base64') }).reason)"
```

### 8. Is a person proven to have clicked Approve?

No. Every receipt carries `attendance: reported-not-proven` and `signerDeviceTrusted: not-established`
(`approval-receipt.mjs:179-180`), and neither is signed. The settle command says a dialog result does not identify
the clicker, so it never reports that a person approved (`kira-approve-queue.mjs:23-24`). The window reports how
long each question was on screen (`dwellMs`, `aumlok-signer.mjs:1070`), a number the page supplies; nothing
requires a minimum, binds the click to a person, or tells it from a synthetic click.

### 9. Can one approval be used twice? What does the kernel decide?

For memory, Kira spends an approval before the write and refuses a second use as `APPROVAL_REPLAY`
(`plugins/aukora-kira/lib/memory-owner.mjs:1041`, `:834-840`). For code, `self-change.mjs` asks
`scripts/aukora/decide.mjs` through the candidate adapter (`self-change.mjs:219-222`,
`scripts/aukora/aumlok-candidate-authority.mjs:260`), and `advance.mjs` calls it directly (`advance.mjs:188-192`).
The adapter reads the receipt strictly, verifies its one Ed25519 signature under the pinned did:key, and checks
operation, subject, control digest and window (`decide.mjs:104-164`). Then the vendored verifier-only kernel (`vendor/authority`, from aumara-xyz/aukora at
`def297f`) allows one use of the signed challenge, and the spent set is rewritten only on ALLOW
(`decide.mjs:166-212`).

Limits. The kernel's hybrid Ed25519 + ML-DSA-65 check is not used: a v1 receipt has one signature, so it is mapped
to a ring that needs none (`decide.mjs:12-43`); the candidate adapter prints `NO_PQ_SIGNATURE`
(`scripts/aukora/aumlok-candidate-authority.mjs:33`). The spent set, `state/home/aura-code/consumed-ids.json`, is a
file the same user can edit. Since `d02046e58` it is tied to the code Aura chain: it may be created only while the
chain shows no kernel spend (`scripts/aukora/aura-code.mjs:38-39`, `self-change.mjs:221`, `advance.mjs:191`), so once
the chain shows one, a missing spent set is refused rather than recreated and deleting it no longer silently
un-spends (the same user can still edit both files). The kernel spend and the `approved` entry are written under one
lock, and the entry carries the kernel's approval id (`self-change.mjs:216-234`). The 300-second window
(`self-change.mjs:47`, `:180`) and the checkout-equals-GitHub-`main` rule (`:125-127`) remain. After the push each
script reads `main` back and chains a separate result (`completed`, `not-completed` or `uncertain`); only a definite
result closes an approval, and a spent approval is never reused. A restore of Kira's state un-spends its markers unless an outside witness recorded the spend.
Check: `node vendor/authority/conformance.mjs` prints `KERNEL CONFORMANCE: 37/37 passed`;
`node tests/aukora-restore-scope.test.mjs` measures the restore gap.

### 10. What does the cold verifier prove, and what does it not prove?

With anchors you supply, it proves that an exported Kira record, its receipt, its Aura entry and the object bytes
agree and carry valid issuer signatures, and, given the approval artifact, that the approver key signed that exact
content (`APPROVAL_ARTIFACT_VERIFIED`, `vendor/kira-export/diamond/approval_artifact.py:845`). In its own printed
words it does not prove that the WASM cell ran, first presentation, latestness, absence of forks, human attendance
or that the record is in anyone's store (`vendor/kira-export/diamond/kira_evidence.py:844-861`). It is this
project's verifier in a separate process, not an independent implementation.
Check: `node tests/kira-diamond-cold.test.mjs --mutate` ends `ALL ARMS PASSED, AND EVERY ARM WENT RED WHEN BROKEN`.

### 11. Where do the verifier's trust anchors come from?

From the caller; it prints `ANCHOR_SUPPLIED_BY_CALLER` (`scripts/kira/verify-public-evidence.py:971`). In
`remember.mjs` the caller is the producer: the issuer anchor comes from its own store and the approver anchor from
its own live configuration (`remember.mjs:89-92`), and the verifier states `SAME_UID_ISSUER`
(`vendor/kira-export/diamond/kira_evidence.py:861`). So the live evidence shows consistency under the owner's own
keys. A third party needs the approver key from a source independent of this Mac; none exists yet.

### 12. Is automatic memory an authority bypass?

It is a separate, unsigned tier by design. Finished turns become "remembered" notes with no approval
(`plugins/aukora-kira/lib/memory-capture.mjs:2`), kept in a different store from signed records
(`plugins/aukora-kira/lib/memory-tiers.mjs:24-25`) and built with `grantsAuthority: false` (`:248`); new signing
into the signed tier is off (`SIGNING_ENABLED = false`, `:94`). The original memory law (`vendor/aukora-packages`,
called by `plugins/aukora-kira/lib/memory-law.mjs:8-16`) quarantines a note that presents no capability, chains the
unsigned tier in its own log, `remembered/aura.jsonl`, never in the approved `aura.jsonl` the export copies, and
makes a forget leave a tombstone with no words. A memory settle and a self-change each need a fresh signature over
their own bytes. The real exposure: recalled text enters the model's context, so a poisoned note can
steer later actions, most of which need no approval. Lane messages are kept out of capture by the request ids the lane
door records (each message carries its request id as `source.rpcId`), with a text prefix as fallback
(`plugins/aukora-kira/lib/autostage-hook.mjs` `isRealAsk`); until 2026-09-27 the door recorded nothing, so only the prefix applied. Automatic
capture is not verified live: on 2026-09-27 the live remembered store was empty.

### 13. What does the WASM cell confine, is it on the live path, and is it AUKORA-37's?

It confines the proposal step of `memory.put`: one import and one fixed 64 KiB page
(`plugins/aukora-kira/lib/wasm-cell/aukora/guest/wasm/memory-put-proposal.wat:2-4`). Riders, path-like keys,
oversize proposals, WASI imports, out-of-range reads, invalid UTF-8 and non-canonical JSON are refused (court rows
W3-W12). It does not confine the Node process that hosts it (`NODE-EMBEDDER-UNCONFINED`), it has no authority
(`plugins/aukora-kira/lib/wasm-proposal.mjs:10`), and settlement bytes are the same with or without it, so no
artefact shows that it ran. The in-chat `kira_stage` tool uses it (`plugins/aukora-kira/lib/index.js:693`,
`tools.mjs:193`), and so does `kira-stage.mjs`, which `remember.mjs` calls
(`plugins/aukora-kira/bin/kira-stage.mjs:97`). The one recorded live `remember.mjs` run (Aura sequence 5,
2026-09-27) predates the commit that put the cell into `kira-stage.mjs` (`5c8508b7f`), so by the committed
record it did not use the cell; whether uncommitted code did is not established. The cell comes from aukora-deep at
`c417f7c5` (`wasm-cell/PROVENANCE.json`); the 11 of its 12 files that AUKORA-37 also carries matched a local
AUKORA-37 checkout byte for byte on 2026-09-27, wrapper `379d1a05…5197` and embedded module `34ce6cab…a438`
included.
Check: `node plugins/aukora-kira/lib/wasm-cell/courts/harness/wasm-proposal-cell/run.mjs --mutate` ends `DETECTED`.

### 14. What does the membrane minimal verifier prove, and what is it connected to?

One arithmetic fact: whether a presented log (size, root, proof) extends a retained one
(`vendor/append-only/CLAIM.md`). `APPEND_ONLY` is not truth, occurrence or identity, and at power-of-two
sizes it declines to accuse (`UNDETERMINED`). `scripts/phase0/memory-head` keeps a head of Kira's `aura.jsonl`
outside the state directory and runs `verify.py` as a separate process (`scripts/phase0/memory_head.py:1-15`). The
head is on the same Mac (`RETAINER_SAME_OWNER`, `scripts/phase0/retainer.py:38`), so whoever controls the Mac can
rewrite both.
Check: `python3 scripts/phase0/selfcheck.py` (36/36 arms); `python3 vendor/aukora-membrane/minimal/tour.py`.

### 15. Can a lane or a CORE session pass itself off as the owner or the orchestrator?

At the text level, yes. The lane door authenticates with one token file
(`apps/aukora-desktop/lane-door.mjs:92-93`) and has no per-lane tokens, so every holder of that token gets the class
of `fable`, the owner's orchestration session, which needs no owner card (`credentialSender`,
`apps/aukora-desktop/lane-dispatch.mjs:247-254`). The lane name still comes from the request body, as a label only. Messages arrive as user messages prefixed `[<lane> via lane door]`
(`lane-door.mjs:862`), which the harness marks `source: user` like the owner's own (`autostage-hook.mjs:116-119`).
The old guard that withheld the lane-door directory from CORE sessions (`aukora-core-read-deny`) stays disabled; its
rows now live in the action gate (`plugins/aukora-action-gate/lib/policy.mjs:56-60`, question 17), which is mounted in
the owner's app. Its CORE-session refusal has not been exercised live. One credential per lane is not built.

### 16. What stops the coding subagents and the model's own tools?

Very little, and the code says so. CORE gives up its shell and web tools (`presets/core/agent.cordis.yml:8`) but
keeps the Codex and Claude Code subagents (`:268-282`), which run as the owner with his subscription credentials;
of the protected directories their pins say "A determined child could still read them"
(`plugins/aukora-subscription-hands/lib/pins.mjs:238-242`). Until 2026-09-27 the live configuration applied `scripts/composition/held-read-deny.patch.yml`, which disables
the CORE read guard (`:14-18`); since then it mounts the action gate in that patch's place (question 17), which
carries the same CORE rows for tool calls. Standard sessions keep the shell. The action gate does not see the
subagents' own tools. AUKORA's Seatbelt denies for agent shell commands (`plugins/aukora-seatbelt`, mounted by
`overlays/seatbelt.patch.yml`) are on `main`, but the running release `c7de4279c` neither carries nor mounts them.

### 17. What is the action gate, and is it running?

`plugins/aukora-action-gate` registers one guard through the harness's `ctx.tools.guard()`, so every tool call in
that process is judged before the tool runs; a guard can deny and never force an allow
(`plugins/aukora-action-gate/lib/index.mjs:6-13`, `:187-193`). Paths are judged by the vendored seed guard
(aukora-seed at `9fca7a0`), imported at `plugins/aukora-action-gate/lib/policy.mjs:27-29`. Key material and
credentials are refused (`policy.mjs:33-48`). Writes to governing code (`plugins/**`, `apps/**`, `vendor/**`,
`scripts/aukora/**`, the owner pin, `AGENTS.md` and more) in a write or edit tool call are refused as
self-modification, naming self-change as the route (`policy.mjs:64-69`, `policy.mjs:214-223`, `:313-315`). Shell
text that would move `main` is refused (`plugins/aukora-action-gate/lib/shell.mjs:199-240`). Each decision is fsync'ed to an Aura chain, with an argument
digest and never raw arguments, before an allow is returned; a call whose receipt cannot be written is refused
(`plugins/aukora-action-gate/lib/index.mjs:25-27`, `:157-176`).

Its own ceilings (`plugins/aukora-action-gate/lib/index.mjs:29-42`): "a script file, an alias, a hook, `eval` of
computed text, or a command assembled from pieces is not seen"; "this is an in-process gate, not isolation"; the
subagents' tools, other processes, tool-less harness code and unnamed network are outside it; writes are fenced by
root, not per file; the judge opens a path before its verdict; the argument digest is plain sha256.

Three more, read from the code. A bash command that writes governing code (`sed -i`, a redirect, `cp`, `mv`) is
allowed: shell text is judged only for key material, credentials, publishing and spending, moves of `main` and hosts
(`policy.mjs:266-294`, `:322-327`). A tool the gate does not know, an MCP tool included, is allowed, with any paths
in its arguments judged as reads (`policy.mjs:339-346`). And the live configuration mounts the harness's
`tool-cordis` (`live-tools.patch.yml` in the app's support folder), whose `cordis_define` and `cordis_run` let a
model record and run its own code inside the backend process; the gate judges those calls as unknown tools and never
sees the code.

Is it running? The overlay that mounts it is `overlays/action-gate.patch.yml`, which replaces the held-read-deny
patch (`overlays/action-gate.patch.yml:5-6`); whether the running app mounts it is the live configuration's patch
list. The owner's app has mounted it since 2026-09-27 04:08 UTC; since 05:30 UTC it runs release `c7de4279c`
with `<release>/action-gate.patch.yml` in that list. One live probe, on release `7a6f4f11d`: an agent session's
write under `plugins/` was refused `authority:governing-code` and no file appeared; its read was allowed; both
decisions are entries 1-2 of `state/home/aura-actions/aura.jsonl` in the app's support folder. By 05:32 UTC that
chain held 72 decisions, one of them a refusal. Its other rules (key material, pushes to `main`, hosts) have been
exercised only by calling the policy directly, not live. Its write roots include the lane worktrees, temp and the owner's Desktop, Documents and
Downloads (`overlays/action-gate.patch.yml`).
Check: `DSH_ROOT=<a built vendor/dsh> node plugins/aukora-action-gate/check.mjs` ends `ACTION GATE CHECK: GREEN`
(build first with `python3 scripts/build-dsh.py`).

### 18. Why does the repository name two different approval keys?

`self-change.mjs` and the Kira settle trust the machine key in the live Kira overlay (question 4).
`docs/owner-pin.json` names another, `did:key:z6Mkty7ygHQUs4hVBB2hfhBMLcNQWR5EG15jMoiRDJqL84Vq`, the public half of
a separate terminal signer daemon's key (`scripts/aumlok/install-owner-pin.mjs:13`, `:31`). Only
`scripts/aukora/advance-main.mjs` reads the pin, from the `from` commit, never the working tree
(`advance-main.mjs:47`, `:69`, `:106`). Its header says "DRY RUN ONLY. IT EXECUTES NOTHING" (`:3`), yet
`--execute` pushes `main` (`:439`, `:517-539`), and the `repo.advance: not enabled` refusal it promises is defined
(`:181`) but never raised. Its CI check is now a printed `NO_CI_CHECK` ceiling (`:158-160`, `:337`). The other path
is `scripts/aukora/advance.mjs`: the popup shows the repository, main now, main after, the tree and the commits; the
approval is verified against the key in the live Kira overlay, like `self-change.mjs`, consumed once by the kernel,
and the push is leased on the main that was shown. With `--snapshot` it publishes the tree of a commit as one new
commit on the remote's `main`, with none of its history (`advance.mjs:97-105`). It is weaker than
`advance-main.mjs`'s design: it trusts a key named in a file the same user can edit, not a pin read from the `from`
commit, and it requires no check. It ran twice on 2026-09-27: code Aura entries 2-3 created
`aumara-xyz/aukora-genesis` `main` from a snapshot, and entries 4-5 moved it to a second snapshot. Two keys for two
paths to `main` remains a defect.

### 19. What was imported from the older repositories, and what is wired in?

Imported byte for byte, each with a `PROVENANCE.json` giving every file's upstream commit, git blob and sha256, most
with a README giving their own test command: under `vendor/`, `authority`, `seed`, `aukora-membrane`,
`aukora-first-echo`, `aukora-seed-app`, `aukora-packages` and `aukora-evidence`; and `docs/research`. Re-run on
2026-09-27 at `ebcee5bd7` (those trees are unchanged since): kernel 37/37; seed guard 37 tests, conformance 11/12
(the declared `undeclared-path` gap); the membrane tour; First Echo 141/141 (bun 1.3.14; its git-identity test left
out); seed app 90/90 on generated JS
(`node vendor/aukora-seed-app/run-tests.mjs --vitest <path to vitest.mjs>`). Re-run at `1c569f8aa`: kernel 37/37 and
the membrane tour (both in `sh scripts/check.sh`), and `node vendor/aukora-evidence/conformance.mjs` 178/178.

Wired in:
- the seed guard judges every path for the action gate (`plugins/aukora-action-gate/lib/policy.mjs:27-29`), which is
  mounted in the owner's app;
- the kernel decides one use of each code approval through `decide.mjs` (`decide.mjs:62`), for `self-change.mjs`
  and `advance.mjs`;
- the seed app's original localCandidateStage, governedCrossing, path fence and repository-identity check run
  inside `self-change.mjs` through `scripts/aukora/aumlok-candidate-authority.mjs:21-30`; its own hybrid monitor
  still refuses, and the adapter substitutes the verified Ed25519 approval (`aumlok-candidate-authority.mjs:1-13`,
  `:281-294`);
- the memory law from `aukora-packages`, with the kernel's canonical hash, decides Kira's tiers and tombstones
  (`plugins/aukora-kira/lib/memory-law.mjs:22-24`), and the running release carries it;
- the secret-shape catalogue from `aukora-evidence` scans a `remember.mjs` export before it is published
  (`scripts/aukora/evidence-secret-gate.mjs:24-27`, `scripts/aukora/remember.mjs:25`);
- First Echo is called by `scripts/aura/echo-head.mjs:92-93`, a standalone check of the code Aura chain against a
  disposable peer on the same machine; nothing runs it automatically.

`scripts/aukora/candidate.mjs`, the original hybrid-only candidate stage, is called by nothing and fails closed here:
it needs a pinned hybrid Ed25519 + ML-DSA-65 owner root and signatures the popup cannot make, and it refuses this
repository's remote (`candidate.mjs:169-178`). `scripts/phase0-check-pins.py` covers only the three older vendor
trees; no script re-checks the newer manifests.

### 20. What checks exist and how do I run them?

The README's Reviewer packet: `sh scripts/check.sh` runs 19 keyless checks in parallel in about 18 seconds with only `python3`,
Node.js 22 or newer, `perl` and `/usr/bin/cc` (Xcode Command Line Tools; no keys, network, harness build or running app); the README's table names the output to look for,
and `docs/CLAIMS.md` says what the original thirteen prove and do not. On 2026-09-27 all 15 passed at
`1c569f8aa` from a tree with no `vendor/dsh` or `node_modules` (Node 22.23.0, Python 3.9.6):
`TOTAL 6.02s | 15/15 passed`. The `--mutate` runs in questions 10 and 13 show those checks going red when their
protection is removed. CI runs `sh scripts/check.sh` on every push (`.github/workflows/check.yml`, a macOS runner); it checks the
repository, not the installed app. The court forest that used to run here was archived on 2026-09-27
(`ARCHIVE.md`). None measures the installed app: `remember.mjs`, `self-change.mjs` and `advance.mjs` need the app and a click in its popup
(`LIVE-ONLY`). Run alone, the Aumlok checks need a short `TMPDIR` (`docs/CLAIMS.md:81-83`); `check.sh` sets one.

### 21. What leaves this machine?

The assistant's turns go to whichever model provider the harness is configured with. The voice companion sends
each turn and its context to OpenRouter (`plugins/aukora-face/apps/src/auma-live/presence.ts:196`), with provider
fallbacks off (`:69-85`). Three upstream uploaders (the full session log to DeepSeek, a plugin inventory, and
OpenTelemetry) are on in the harness's base profile. Every release the materializer cuts carries three rows that
switch them off (`scripts/materialize-aukora-release.py:1104-1118`), and `overlays/privacy.patch.yml` holds the
same rows as a separate overlay. That they are off is read from configuration, not measured on the wire.
`self-change.mjs` and `advance.mjs` push to GitHub (`self-change.mjs:247`, `advance.mjs:212`).

### 22. How much of what runs is upstream code, and how is it pinned?

The model harness and the Cordis plugin loader are the DeepSeek Harness (MIT) at `0d1f5000`, pinned by archive and
lockfile sha256 in `upstream-dsh.json`, with three recorded local patches in `patches/`. `scripts/build-dsh.py`
refuses an archive, lockfile or patch that does not match (`:51-52`, `:178-179`, `:96-99`). It is not audited here
and runs with the owner's full privileges. The older vendored verifiers are pinned file by file
(`python3 scripts/phase0-check-pins.py`: 31 files in three trees), as is the WASM cell
(`plugins/aukora-kira/lib/wasm-cell/PROVENANCE.json`). The newer imports are question 19.
