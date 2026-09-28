# CLAIMS — what this tree demonstrates, and how to check it

> Re-run `sh scripts/check.sh` on your clone. The dates and commits below are historical measurements, not claims
> about the running release (`aukora-release-0496ba077`); the README's "What is not enforced" is current.

**Measured:** 2026-09-27, at archive commit `1c569f8aa`, on macOS with Node.js 22.23.0 and Python 3.9.6, by
`sh scripts/check.sh` as it then stood. Rows 1-13 are now checks 1-8, 11-14 and 16 in the 19-check runner. Every RUN row below was run from that tree, with no
`vendor/dsh`, no `node_modules`, no keys, no network and no running app, and printed the token its row names. Commit
hashes on this page are in aumara-xyz/aukora-genesis-archive (private archive, not a link), which holds the history up to 2026-09-27, read-only
and private; work continues on `main` of `aumara-xyz/aukora-genesis`.

A claim here is **a command and the line it must print**. Run the command. If the output disagrees with the
row, the row is wrong. The first backticked string in the "what the output proves" cell is the line to look
for. A row's **ceiling** is the part a reader would otherwise assume and must not: read it as part of the
claim.

`LIVE-ONLY` rows need the owner's installed app, his live store or his click. They are never run here and
never counted as passing now; each carries the date and commit it was last observed, or says that none is
recorded.

Earlier versions of this page carried rows measured by suites, courts and experiments that were archived on
2026-09-27 (`ARCHIVE.md`). Those rows are gone from this page, not re-labelled. They remain readable at
commit `5c8508b7f` of the read-only, private archive aumara-xyz/aukora-genesis-archive (private archive, not a link) (`ARCHIVE.md`).

---

## Claims this court runs

"This court" is you: each row is one command run from the repository root.

| # | claim | organ | command a reviewer runs | what the output proves | what it does NOT prove (ceiling) | last passed |
|---|---|---|---|---|---|---|
| 1 | The membrane minimal verifier decides append-only, an earned accusation and its own blind spot correctly on its built-in vectors | vendored membrane verifier (`vendor/append-only`, aukora-membrane `minimal/` @ `d8b17fac`) | RUN `python3 vendor/append-only/verify.py --selftest` | `SELFTEST: 4/4 checks passed` — including `OBSERVATION_CONFLICT` for a modified root and `UNDETERMINED` for the power-of-two blind spot | Four built-in cases, not a corpus. `tour.py` beside it runs, but prints `MISSING!!` for six upstream-only files (the differential, the peer-class corpus, the external oracle, the Rust replica, `LAW.md`, `NOT-READY.md`); `vendor/aukora-membrane` carries all six, and its own `minimal/tour.py` finds them | 2026-09-27 · `1c569f8aa` |
| 2 | Every vendored verifier byte matches its upstream pin | vendor pins | RUN `python3 scripts/phase0-check-pins.py` | `PINS OK: every vendored byte matches its upstream manifest` — 31 pinned files across `vendor/append-only`, `vendor/receipt` and `vendor/kira-export` | The manifests are this project's own. `vendor/dsh` is checked by `scripts/build-dsh.py`, not here | 2026-09-27 · `1c569f8aa` |
| 3 | The WASM proposal cell turns a memory write into exact, canonical proposal bytes and refuses argument riders, path-like keys, oversize proposals, unprovided imports, out-of-range reads, invalid UTF-8 and non-canonical JSON | Kira WASM cell (`plugins/aukora-kira/lib/wasm-cell`) | RUN `node plugins/aukora-kira/lib/wasm-cell/courts/harness/wasm-proposal-cell/run.mjs` | `rowsComplete=true expected=13 observed=13` — every row `held`, with observation class `NODE-EMBEDDER-UNCONFINED` | `NODE-EMBEDDER-UNCONFINED`: the cell is a constrained relay inside an ordinary Node process, not a sandbox around it. Settlement bytes are identical with and without the cell, so no artefact shows that the cell ran in a past settlement | 2026-09-27 · `1c569f8aa` |
| 4 | A separate cold consumer verifies a real Kira export from an empty directory and refuses tampered ones by name | Kira export + vendored Diamond (`vendor/kira-export`) | RUN `node tests/kira-diamond-cold.test.mjs` | `ALL ARMS PASSED` | Diamond is **this project's own verifier**, pinned at `0d3cc66`, not an independent implementation. Disposable store and test keys | 2026-09-27 · `1c569f8aa` |
| 5 | The public evidence export carries only allowlisted fields and its verifier refuses tampered, extra, private-key-shaped and unlisted files by name | Kira public evidence (`scripts/kira/public-evidence.mjs`) | RUN `node tests/public-evidence.test.mjs` | `ALL CONTROLS PASSED` | Offline, over a disposable store. It re-hashes; it checks no signature (row 4 does) | 2026-09-27 · `1c569f8aa` |
| 6 | A receipt plus a public key reaches the cold court's verdict from a fresh empty directory, and a wrong key is refused before any verdict | composition receipts (`vendor/receipt`) | RUN `node tests/receipt-v3.test.mjs` | `RECEIPT V3 STRANGER TEST: all checks passed` | The "stranger" is this project's code in a separate process, not an outside party. Consistency over time is Phase 0's question (row 1), not this one | 2026-09-27 · `1c569f8aa` |
| 7 | A stranger verifies an Aumlok approval receipt from its bytes and the public key alone, and forged keys, wrong keys, extra fields and preimage mismatches are refused by name | Aumlok verify (`scripts/aumlok/verify-approval`) | RUN `node tests/aukora-aumlok-verify.test.mjs` | `AUMLOK VERIFY APPROVAL: GREEN` — parse, digest and signature `VERIFIED`; trusted key `NOT_ESTABLISHED`; scope, attendance and custody `REPORTED` | Disposable test key, no person, no trusted device, no identity binding. Its throwaway signer's socket path under `TMPDIR` must stay under 104 bytes | 2026-09-27 · `1c569f8aa` |
| 8 | An approval over exact bytes round-trips through the shipped producer and the desktop shell's own signer, and verifies under the machine key the record lists | Aumlok approval path (`apps/aukora-desktop/aumlok-signer.mjs`) | RUN `node tests/aukora-approval-roundtrip.test.mjs` | `PASS — 13/13 arms` | A scratch socket and a labelled test identity; no rendered window, no click, no person. Same `TMPDIR` note as row 7 | 2026-09-27 · `1c569f8aa` |
| 9 | The identity root is not kept on disk: the machine holds only a machine key, and the root is re-derived from the handle and the words | Aumlok cold root | RUN `node tests/aukora-aumlok-cold-root.test.mjs` | `AUMLOK COLD ROOT: GREEN` — `21/21 arms green` | A temporary file stands in for the Keychain, every key comes from an invented phrase, and no live controller is touched | 2026-09-27 · `1c569f8aa` |
| 10 | The composition gate names an absent grant as a ceiling, refuses an unusable one, and fails closed under `requireGrant: true` | composition gate | RUN `node tests/aukora-gate-require-grant.test.mjs` | `AUMLOK GATE REQUIRE GRANT: GREEN` — `10/10 arms green` | The gate governs only what `policy.json` names, currently `hello-governed`; every stock plugin loads ungoverned (`STOCK_PLUGINS_NOT_YET_UNDER_POLICY`) | 2026-09-27 · `1c569f8aa` |
| 11 | An approval does not outlive the control that issued it: a stale control head is refused by name and the store is unchanged | Kira settlement | RUN `node tests/kira-control-admission.test.mjs` | `# pass 7` and `# fail 0` | Models the state a rotation leaves, not a rotation event: no rotation is performed, and revocation and succession are not measured | 2026-09-27 · `1c569f8aa` |
| 12 | A spent one-use approval stays spent across a restore of the state directory **only** when an external witness outside that directory recorded the spend; without it, the restore un-spends it | owner daemon journal + consumption witness | RUN `node tests/aukora-restore-scope.test.mjs` | `AUMLOK RESTORE SCOPE: GREEN` — `11/11 arms green`, including the arm where a restore un-spends the journal and Kira's one-use marker | **This row measures a gap.** A restore of Kira's state brings its one-use markers back, and the retained head cannot see it. The witness is exercised on disposable state; this row does not show the installed app writing one | 2026-09-27 · `1c569f8aa` |
| 13 | Three agents repeating one false report create no evidence and no authority, and cannot undo a person's decision | Kira consolidation | RUN `node tests/kira-consolidate.test.mjs` | `kira-consolidate: ok` | A scratch store; the live store is never touched | 2026-09-27 · `1c569f8aa` |

## LIVE-ONLY — not run here, not counted as passing

| # | claim | organ | command a reviewer runs | what the output proves | what it does NOT prove (ceiling) | last passed |
|---|---|---|---|---|---|---|
| 14 | One memory transaction runs end to end in the installed app: stage through the WASM cell, approve in the popup, settle, chain in Aura, export, and cold-verify from an empty directory | Kira + Aumlok + Aura + Diamond | LIVE-ONLY — `node scripts/aukora/remember.mjs "<text>"` needs the installed app and the owner's click | `LIVE TRANSACTION` with the record id and Aura sequence | **ATTENDANCE IS NOT PROVEN**: a software key on this Mac signed; the click is recorded, not bound to a person. Same user account for app, agent and key. | 2026-09-27 13:37 UTC · Kira Aura sequence 7, release `aukora-release-76bb9650b`, `PUBLICATION: VERIFIED` from an empty directory; not re-run on a later release |
| 15 | A code change is shown in full, signed, verified against the pinned key, committed and chained in Aura before main moves | self-change | LIVE-ONLY — `node scripts/aukora/self-change.mjs "<why>" <paths>` needs the installed app and the owner's click | the commit and Aura sequence it prints | **Not enforced on GitHub**: nothing on this machine or on GitHub stops a direct push. Every commit on `main` after `1c362a2c5` came through self-change or a MOVE MAIN (`advance.mjs`) and is in the Aura code chain. Refuses a card longer than the installed card shows (11,800 characters), deletions, binary, symlink and mode changes, and any path containing `authority` (those go by MOVE MAIN). Since `b070c95a0`, self-change and MOVE MAIN run `decide.mjs` through the TrustedStateStore; the high-water witness is outside `state/` at `~/.aukora-witness/kernel-high-water.json`. The same UID can rewrite both | 2026-09-28 · commit `5fd48e490`, code Aura entries 85-86, approved in the AUKORA popup by `did:key:z6MkkVxRYC6uHVpaxyfZAFuNx1LZrwgay1DCPTu6ttPJMQog` |
| 16 | An approval **from the owner's registered signer** is in the ledger, at entry 3 | Kira + signer | LIVE-ONLY — needs the owner's consent | entry 3 of the ledger; the record is class **delegated** | **ATTENDANCE IS NOT PROVEN.** The bytes show an approval from a signer, not a person at a keyboard | 2026-09-24 · commit `4e812b9e` |
| 17 | Every tool call an agent session makes in the running app is judged before it runs, and each decision is chained in Aura; a write or edit tool call on governing code is refused and names the approval route | action gate | LIVE-ONLY — in the app, ask an agent session to write a file under `plugins/`; then read `state/home/aura-actions/aura.jsonl` in the app's support folder | the call is refused `authority:governing-code`, no file appears, and the log gains a chained `deny` entry (an allowed read gains an `allow` entry) | Shell commands are read as text: literal write targets (`sed -i`, a redirect, `tee`, `cp`, `mv`, a literal path in `python3 -c`) are judged as writes; a script, a variable, `git apply`, `git checkout` or `patch` can hide a target. Unknown and MCP tools are allowed, with their paths judged as reads; `tool-cordis` runs model-written code inside the backend process. The Codex and Claude Code subagents and anything outside the app are not governed. Same user account, so not isolation | 2026-09-27 04:08 UTC, entries 1-2, release `7a6f4f11d`; 2026-09-27T23:53:16Z on `25149f573`: full-access `sed -i` on `plugins/aukora-kira/` refused `authority:governing-code`, `kernelCode: sacred_target`, file untouched |
| 18 | A move of a remote's main is shown in the popup, signed, verified against the pinned key, spent once by the kernel and chained in Aura before the push, which is leased on the main that was shown | advance | LIVE-ONLY — `node scripts/aukora/advance.mjs "<why>" <remote> <commit> [--snapshot]` needs the installed app and the owner's click | the main it moved to and the code Aura sequences it prints | **Not enforced on GitHub**: the owner's credential on this Mac can push to the remote directly, and `aumara-xyz/aukora-genesis` `main` has no branch protection. The approver key is read from the live Kira overlay, a file the same user can edit | 2026-09-28 · code Aura entries 97-98: `main` moved to `25149f573`, approved in the AUKORA popup by `did:key:z6MkkVxRYC6uHVpaxyfZAFuNx1LZrwgay1DCPTu6ttPJMQog` |

---

## NOT CLAIMED

Named rather than omitted.

| claim | status | why not |
|---|---|---|
| Containment of a hostile agent | **NOT CLAIMED** | The app and agent share a macOS UID. In the recorded Airlock deployment the key is in a separate account, but any process of the app's UID can request signatures. The checks above are procedures over bytes, not agent isolation |
| Independent verification | **NOT CLAIMED** | Every verifier on this page (Diamond, receipt-v3, the membrane verifier) is this project's own code run as a separate process. No outside party has re-implemented or run them |
| Human **attendance** at an approval | **NOT CLAIMED** | Row 16 records a signer's approval, not a person at a keyboard. The approval key is a software key on this Mac |
| That the owner **understood** an approval, was not tired, rushed or persuaded when giving it, or paused before it took effect | **NOT CLAIMED** | Nothing measures what the owner read or how long an approval was on screen. The approval window (`apps/aukora-desktop/aumlok-approval.html`) sets no timer before Approve; there is no rate limit and no second approver. Auma Live is told to be "genuinely fond of the owner" (`presence.ts`), and nothing measures whether it urges an approval |
| The owner cut is **installed**, and an agent is refused by the kernel | **PARTLY INSTALLED** | The recorded Airlock deployment holds the approval key in the separate account `aukora-owner`: on 2026-09-28 `scripts/aukora/airlock-probe.mjs` reported `VERIFIED EACCES` for UID 501. Any process of the app's UID can still request a signature; an agent is not refused by the kernel there. This is operator-recorded, not independently verified here |
| Stock plugins are **owner-governed** | **NOT CLAIMED** | AUKORA plugin approval uses `scripts/aukora/plugin-set.mjs approve`; that approval and live load are not independently verified here. Upstream's stock plugins stay ungoverned (`plugins/aukora-composition-gate/GOVERNED.md`) |
| That the desktop launches only releases the owner approved | **NOT CLAIMED** | The shipped template sets `allowUnapproved` to false (`apps/aukora-desktop/resolve.mjs`), but `approvedRecordSha` is appended by `scripts/aukora/desktop-cutover.mjs apply` without an owner signature, and `true` in `config.json` still passes `--allow-unapproved` |
| That the owner root key resists an offline guess | **NOT CLAIMED** | The root is derived with scrypt from the seven words and the owner's handle (`plugins/aukora-aumlok/lib/derive-v3.mjs`), and the handle is not secret. The desktop's word lists give about 34 bits (`plugins/aukora-aumlok/lib/themed-entropy.mjs`); `scripts/aumlok/bind --generate` about 14.3 bits (`plugins/aukora-aumlok/lib/ceremony-phrase.mjs`). Anyone holding the record can test guesses offline at one scrypt run each. A redesign is planned |
| The owner's live chain **as of today** | **NOT CLAIMED** | Rows 4 and 5 verify disposable exports. A claim about the live tip needs a fresh export from the live store (row 14) |
| That automatic memory captures the owner's conversations in the running app | **NOT VERIFIED LIVE** | Finished turns are meant to become unsigned remembered notes (`plugins/aukora-kira/lib/memory-capture.mjs`). On 2026-09-27 the live remembered store was empty |
| The clipboard | **NOT CLAIMED** | Nobody has measured what reaches it |
| Auma Live's daily spend cap as a bound on **money actually spent** | **NOT CLAIMED** | The cap compares an estimate (characters at `CHARS_PER_TOKEN = 1`) to `capUsd`, not an invoice. Its total is one JSON line in `<dshHome>/auma-live/spend.json`; torn writes and two writers are unmeasured, and the gate's `settle` is called by no code in the face (`spend-gate.ts`) |

---

## How to read this page

- **A row is a command, not a summary.** Run it. If the output disagrees with the row, the row is wrong.
- **Dates and commits are load-bearing.** A `LIVE-ONLY` row's date and commit mean *at that commit*, not
  *forever*.
- **Run rows 7 and 8 with a short `TMPDIR`** (`sh scripts/check.sh` sets one). Each starts a throwaway signer on
  a Unix socket under `TMPDIR`, and the signer refuses a socket path of 104 bytes or more
  (`plugins/aukora-owner-daemon/lib/listener.mjs`).
- **The ceilings are the point.** This project's recurring defect is an artifact describing its intent
  rather than its act — a report computed from a flag, a citation read as a verification. Each ceiling
  names where its row's claim stops.
