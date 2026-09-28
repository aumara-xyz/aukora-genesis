# Evidence map: AUKORA Golden Boundary, Revision 2.2

This companion lists every evidence-tagged claim in the paper, keyed by section and line, with
the file or command a reader can use to check it and the claim class the paper gives it. It is
a map, not new evidence: it records what was checked while preparing Revision 2.2 and says
plainly where the evidence is not public.

## How to read it

- **Line** is the historical Revision 2.2 line number (with its evidence corrections applied),
  now preserved in [the archive](AUKORA-GOLDEN-BOUNDARY-ARCHIVE.md); it is not the current archive
  line number. Rows marked **‡** check a sentence that was corrected against this evidence.
- **Class** is the paper's label for the claim (§1): `SOURCE_PRESENT`, `TESTED_AT_PIN`, `MEASURED`,
  `BUILT`, `TOY`, `DOCTRINE`, operator-recorded, author-recorded/-reported, lab-recorded.
- **Check it with** names repository-relative paths and commands to run from the root of the
  named repository (**G** = Genesis, **A** = AUKORA-37). Line numbers inside files are omitted on
  purpose: files may have moved since the pins, so search for the quoted identifier.
- **Archived Genesis paths (2026-09-27).** The Genesis test forest, `courts/`, `experiments/`,
  `scripts/demo/`, `scripts/ci/`, `.github/` and most of `docs/` were removed from the tree on
  2026-09-27 (`ARCHIVE.md`). A **G** path under one of them is read at commit `5c8508b7f` of the archive repository
  aumara-xyz/aukora-genesis-archive (private archive, not a link), where it
  last existed; it is not in the tree at this revision. Ten suites stayed, and `docs/CLAIMS.md`
  lists them with the other checks that run from a clone.
- **Public?**
  - `yes`: the file ships in the public repository.
  - `yes†`: the file is newer than the earliest public snapshot recipe and ships in any
    snapshot cut at or after this revision.
  - `external`: a pinned or dated outside link.
  - **private only**: the evidence exists only in private history, a private log, an
    unpublished branch or experiment, or one development desktop. A reader cannot check it.
- **Result** is what the preparation found: `re-run` (the command was executed for this
  revision), `read` (source read, not executed), `recorded` (a recorded run was read, not
  re-run), `not checkable` (private, or no record exists), `court owed` (the text is accurate,
  but no court yet goes red if the property is removed).
- **Verified at (private)** gives the private development pins the check ran against:
  Genesis `bf564e7a65` and AUKORA-37 `7cb6bda`, as in §1 of the paper. The public repositories
  are fresh-history snapshots, so **these identifiers do not resolve there**. The column is kept
  only so the preparation can be audited against private history.

Totals: 124 evidence rows. 75 hold with public or external evidence and no gap; 36 rest wholly or
partly on private-only evidence; 7 needed corrected wording (8 lines, marked ‡); and 6 rows
(5 distinct properties) have accurate text but no court that asserts them yet.

---

## Abstract

| Ref | Line | Claim | Class | Check it with | Public? | Result | Verified at (private) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | 15 | The gate binds a grant to the loaded bytes of one governed file, not to its imports or path; open defect D3 admits a byte-identical copy at another path | BUILT: component scope | G `plugins/aukora-composition-gate/src/policy.js` (`verifyGrant` receives no path or closure; the comment stating an identical copy is admitted); `bash plugins/aukora-composition-gate/test/declared-id-regression.sh` arm 6 (asserts ADMITTED as the known defect after a later commit; REFUSED goes red) | yes | read; court added after the pin | G `bf564e7a65` |
| A2 | 15 | The family supplies a WASM proposal cell, memory and receipt libraries and a cold verifier | BUILT: component scope | G `plugins/aukora-kira/lib/wasm-proposal.mjs`, `plugins/aukora-kira/lib/wasm-cell/`, `plugins/aukora-kira/lib/memory-owner.mjs`, `vendor/kira-export/scripts/verify-kira-evidence.py` | yes | read | G `bf564e7a65` |
| A3 | 23 | Diamond ships only as pinned copies vendored into Genesis and AUKORA-37 | BUILT: component scope | G `vendor/kira-export/upstream-diamond.json` (`commit`); A `vendor/aukora-diamond/` and the README "Lineage" section | yes | read | G `bf564e7a65`; A `7cb6bda` |
| A4 | 23 | Cordis manages plugin lifecycle and confines nothing | BUILT: component scope | G `docs/CLAIMS-LEDGER.md` (row quoting the host runner: "isolates globals but is not a security boundary"); the quoted upstream README arrives under `vendor/dsh/` via `python3 scripts/build-dsh.py` | yes† | read | G `bf564e7a65` |

## §3 What the existing technology contributes

| Ref | Line | Claim | Class | Check it with | Public? | Result | Verified at (private) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1a | 109 | Bytes-bound, pilot and require-grant courts green in CI at the pin | TESTED_AT_PIN | G `node tests/aukora-gate-bytes-bound.test.mjs`; `node tests/aukora-gate-pilot-digest.test.mjs`; `node tests/aukora-gate-require-grant.test.mjs` | courts yes†; CI record **private only** | recorded (4/4, 4/4, 10/10 arms) | private CI at G `bf564e7a65` |
| T1b | 109 | Governed demo green at earlier main | TESTED_AT_PIN | G `bash plugins/aukora-composition-gate/test/governed-demo.sh` | script yes; CI record **private only** | recorded | private CI at earlier main (G `84018ba1a`) |
| T1c | 109 | Stock plugins load ungoverned; admission is not confinement | SOURCE_PRESENT (limit) | G `plugins/aukora-composition-gate/GOVERNED.md` (`STOCK_PLUGINS_NOT_YET_UNDER_POLICY`) | yes | read | G `bf564e7a65` |
| T2 | 110 | Cordis: no executed evidence for Genesis; its one loader court is unwired | SOURCE_PRESENT | G `upstream-dsh.json` (Cordis version and pin); `grep -c board-reload .github/workflows/b1.yml scripts/aukora-courts.sh` gives 0 and 0; `tests/aukora-board-reload.test.mjs` needs a built harness | yes | read; court owed (wiring) | G `bf564e7a65` |
| T3a | 111 | Recall courts ±`--mutate` in CI at the pin | TESTED_AT_PIN | G `node tests/kira-recall-service.test.mjs [--mutate]`; `tests/kira-she-remembers-check.test.mjs [--mutate]`; `tests/kira-memory-unlinked.test.mjs`; `tests/kira-anchor-provenance.test.mjs` | courts yes†; CI record **private only** | recorded | private CI at G `bf564e7a65` |
| T3b | 111 | Secret-filter court 4/4, three arms red when mutated, for this revision | TESTED_AT_PIN | G `node tests/kira-secret-filter.test.mjs` and `--mutate` | yes† | re-run | G `bf564e7a65` |
| T3c | 111 | A first approval settled, recalled, exported and cold-verified, operator-recorded 23–24 Sept | operator-recorded | G `docs/CLAIMS.md` live-only rows 8 (recall) and 11 (approval); export and cold verification appear only in a private operator log | rows yes†; export and cold verification **private only** | read in part; log not checkable | G `bf564e7a65` |
| T3d | 111 | Only staging uses the cell; exactly-once is replay-only in one process; the note filter is five pattern shapes | SOURCE_PRESENT (limit) | G `plugins/aukora-kira/lib/tools.mjs` (`stageTool` is the only caller of `proposeMemoryPutProven`); `plugins/aukora-kira/lib/compaction-export.mjs` (five patterns); `docs/CLAIMS.md` row 8 | yes / yes† | read | G `bf564e7a65` |
| T4a ‡ | 112 | Release court, 4 plain arms against the bytes of the release installed on the §1 host, a local build that is not published; no mutation run | TESTED_AT_PIN: installed release | G `node tests/kira-wasm-proposal-release.test.mjs --release <materialized release>` | court yes; measured release and run record **private only** | recorded, not re-run | G `bf564e7a65` (court); release not public |
| T4b | 112 | 64 KiB budget; `CELL_EXECUTION: NOT_ESTABLISHED` | SOURCE_PRESENT (limit) | G `plugins/aukora-kira/lib/wasm-proposal.mjs` (`64 * 1024`); `vendor/kira-export/scripts/verify-kira-evidence.py` | yes | read | G `bf564e7a65` |
| T5a | 113 | `measure()` and the common-words court (16/16), for this revision | TESTED_AT_PIN | G `node --input-type=module -e "import('./plugins/aukora-aumlok/lib/themed-entropy.mjs').then(m=>console.log(m.measure()))"`; `node tests/aukora-aumlok-common-words.test.mjs` | yes | re-run | G `bf564e7a65` |
| T5b | 113 | Cold-root, derivation, signer and approval courts at earlier main | TESTED_AT_PIN | G `node tests/aukora-aumlok-cold-root.test.mjs`; `tests/aukora-aumlok-v3-derivation.test.mjs`; `tests/aukora-aumlok-signer.test.mjs --mutate`; `tests/aukora-aumlok-approve.test.mjs` | courts yes; CI record **private only** | recorded | private CI at earlier main (G `84018ba1a`) |
| T5c | 113 | Owner binding with a cold root, operator-recorded 23 Sept; the root-key ceiling print is absent on the desktop | operator-recorded | private operator log; the observed desktop's release file lacks the print | **private only** | not checkable | desktop observed 26 Sept |
| T5d | 113 | About 34 bits, offline-guessable, no floor | TESTED_AT_PIN (limit) | G `measure()` as in T5a (`floorBits` null); header of `plugins/aukora-aumlok/lib/themed-entropy.mjs`; `docs/CLAIMS.md` offline-guess row | yes | re-run | G `bf564e7a65` |
| T6a | 114 | Self-test, pin checks and replica build in CI at the pin | TESTED_AT_PIN | G `python3 vendor/append-only/verify.py --selftest`; `python3 scripts/phase0-check-pins.py [--mutate]`; `cargo build --release --manifest-path vendor/append-only/replicas/rust-verifier/Cargo.toml`; `python3 scripts/phase0/selfcheck.py` | scripts yes; CI record **private only** | recorded | private CI at G `bf564e7a65` |
| T6b | 114 | Aura retention operator-recorded 23 Sept | operator-recorded | private operator log only; no live-only row in `docs/CLAIMS.md` | **private only** | not checkable | none |
| T7a | 115 | Cold-consumer court: a real export verifies; byte flips and a small-order-key forgery are refused | TESTED_AT_PIN | G `node tests/kira-diamond-cold.test.mjs` (12 arms) | yes | re-run | G `bf564e7a65` |
| T7b | 115 | Diamond prints `NO_GLOBAL_REPLAY_PREVENTION` and `NO_LATESTNESS` | SOURCE_PRESENT (limit) | G `vendor/kira-export/diamond/kira_evidence.py` (`CEILINGS`), printed by `vendor/kira-export/scripts/verify-kira-evidence.py`; `tests/kira-diamond-cold.test.mjs` asserts `LATESTNESS: NO_LATESTNESS` only | yes | read; court owed (replay ceiling) | G `bf564e7a65` |
| T8 | 116 | Point hygiene: five arms, three red arms proven, for this revision; wired into the front door and CI at a later commit; round-trip check has no red arm | TESTED_AT_PIN | G `node tests/aura-ed25519-point-hygiene.test.mjs` and `--mutate`; subject `scripts/composition/ed25519.py`; `grep -c aura-ed25519-point-hygiene .github/workflows/b1.yml scripts/aukora-courts.sh` gives 0 and 0 at the pin, non-zero after the wiring commit | court yes†; subject yes | re-run; court owed (wiring, round-trip arm) | G `bf564e7a65` |
| T8b | 116 | Point hygiene absent on the development desktop | observation | hash of the desktop release's `scripts/composition/ed25519.py` equals the file before the fix | **private only** | not checkable | desktop observed 26 Sept |
| T9a | 117 | Read guard: 62 arms and 11 removed-rule mutations in CI at the pin | TESTED_AT_PIN | G `node tests/aukora-core-read-deny.test.mjs --mutate` | court yes†; CI record **private only** | recorded (62/62, 11/11) | private CI at G `bf564e7a65` |
| T9b | 117 | Profile generator: no production caller; recorded as unusable | SOURCE_PRESENT | G `git grep -n coreSeatbeltProfileArgs` (tests only); `plugins/aukora-core-read-deny/README.md` | yes† | read | G `bf564e7a65` |
| T10 | 118 | Owner daemon: single-uid arms green in CI at the pin; protocol court `NOT_READY`; no two-uid run | TESTED_AT_PIN: single uid | G job `owner-cut-linux` in `.github/workflows/b1.yml`; `node tests/aukora-owner-protocol.test.mjs` | courts yes†; CI record **private only** | recorded; protocol court changed after the pin | private CI at G `bf564e7a65` |
| T10b | 118 | Authority mode printed beside the receipt, not signed into it; daemon not installed on the desktop | SOURCE_PRESENT (limit) | G `plugins/aukora-owner-daemon/lib/settle-adapter.mjs` (returns receipt, authority and digest separately); "not installed" is a host account lookup on the observed desktop | code yes†; desktop part **private only** | read | G `bf564e7a65` |
| T11a | 119 | Nostr courts against an in-process mock relay at earlier main | TESTED_AT_PIN: mock relay | G `node tests/aukora-nostr-{vendor-pin,nip44,giftwrap,binding,contact,evidence,relay}.test.mjs`; `tests/helpers/mock-relay.mjs`; `plugins/aukora-nostr/README.md` | courts yes; CI record **private only** | recorded | private CI at earlier main (G `84018ba1a`) |
| T11b | 119 | One real Nostr exchange, author-recorded | author-recorded | G `plugins/aukora-nostr/README.md` ("Measured on a real send and receive, 2026-09-24"; `eventId` matched) | yes | read | G `bf564e7a65` |
| T12a | 120 | Eye door courts at earlier main | TESTED_AT_PIN | G `node tests/aukora-eye-door.test.mjs`; `tests/aukora-eye-row.test.mjs`; `tests/aukora-eye-sight.test.mjs`; `tests/aukora-eye-ui-invariants.test.mjs` | courts yes; CI record **private only** | recorded | private CI at earlier main (G `84018ba1a`) |
| T12b | 120 | Stranger refusal in live-only rows of CLAIMS.md | operator-recorded | G `docs/CLAIMS.md` live-only row 9 ("door answers 401 to a stranger") | yes† | read | G `bf564e7a65` |
| T12c | 120 | `/eye/act` clicks and types trusted input; a token holder is not an authenticated person | SOURCE_PRESENT (limit) | G `apps/aukora-desktop/eye.mjs` (`EYE_ACT_ROUTE`; header comment "a same-origin gesture check, not an identity") | yes | read | G `bf564e7a65` |
| T13 | 121 | AUKORA-37: 34-court gate; author-recorded subsets; no CI; full acceptance `NOT_RUN`; separate-uid `NOT_MEASURED`; TEST keys; root inside the trust boundary | TESTED_AT_PIN: author-recorded | A `ls courts/` (34 scripts); `README.md`; `docs/MAIN-STATUS-20260926.md`; no `.github/` directory | yes | read | A `7cb6bda` |
| T14 | 109–121 | Development-desktop column: what the observed release carries; the gate governs one demonstration id | observation | process arguments and configuration of one development desktop, 26 Sept | **private only** | not checkable | desktop observed 26 Sept |
| P1 | 124 | An earlier private codebase holds cell-at-effect, separate-uid custody, a deny-default proposer fence and a signed confinement class | BUILT: private source | none public | **private only** | not re-run (as the tag says) | none |
| P2 ‡ | 125 | On 22 Sept Genesis vendored an earlier Diamond commit; upstream's point-validation hardening landed that afternoon and Genesis re-vendored the changed files the same evening, so the copy now records the hardened commit, as AUKORA-37 does | BUILT: dated observation | G `vendor/kira-export/upstream-diamond.json` (`commit`, per-file `upstreamCommit`); A README "Lineage" section; the dates come from private history | file yes; dates **private only** | read | G history at `bf564e7a65`; Diamond history |
| U1 | 131 | Decoded proposal-module SHA-256 pin `34ce6cab…a438` | pin (untagged) | G `plugins/aukora-kira/lib/wasm-cell/PROVENANCE.json` (`binarySha256`) | yes | read | G `bf564e7a65` |
| U2 | 139 | The cold consumer prints `CELL_EXECUTION: NOT_ESTABLISHED`, asserted by its court | untagged | G `vendor/kira-export/scripts/verify-kira-evidence.py`; `node tests/kira-diamond-cold.test.mjs` | yes | re-run | G `bf564e7a65` |

## §4 The smallest complete engineering target

| Ref | Line | Claim | Class | Check it with | Public? | Result | Verified at (private) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1a | 163 | The approval window sets no delay before Approve and has no approval-rate limit or second approver | BUILT: code-read | G `apps/aukora-desktop/aumlok-approval.html` (`approveEligible` has no time term); `docs/CLAIMS.md` understanding row | yes | read | G `bf564e7a65` |
| S1b ‡ | 163 | The observed desktop's shell shows the first string member named `note` anywhere in the signed bytes; the development head shows the top-level note, or the whole value when more than one `note` is present | BUILT: code-read | G `apps/aukora-desktop/aumlok-signer.mjs` (`stagedTextAsBound`); the older shell is on the observed desktop only | code yes; shell **private only** | read | G `bf564e7a65`; desktop observed 26 Sept |
| S2 | 165 | The shipped template has `allowUnapproved` defaulting to true | BUILT: code-read; PROPOSED: the change | G `apps/aukora-desktop/resolve.mjs` (`allowUnapproved: true` in the template); `docs/CLAIMS.md` | yes | read | G `bf564e7a65` |
| S3 | 179 | Local spend prototype: courts passed with TEST keys and fake providers; three removed-protection mutations detected; conformance `NOT_READY` with five named gaps | TOY: lab-recorded | unpublished local branch | **private only** | recorded | local branch (not pushed) |
| S4 | 180 | The experimental money gate read the verifying key from the approval object, so a fresh self-signed ceiling was admitted at the pin; a later commit pins the owner key (`OWNER_KEY_NOT_PINNED`) and adds a court arm for this probe | MEASURED: preparation probe; fix code-read | `experiments/laya/spend_gate.py` and `experiments/laya/spend_gate_court.py` (both excluded from the public snapshot) | **private only** | re-run (probe admitted a fresh key's ceiling) | G `bf564e7a65` |
| S5 | 181 | The per-day provider-cost cap bounds the gate's estimate, not money spent | BUILT: code-read; DOCTRINE: limit | G `plugins/aukora-face/apps/src/auma-live/spend-gate.ts` (`CHARS_PER_TOKEN = 1`); `plugins/aukora-face/apps/lib/index.js` (`capUsd` default); `docs/CLAIMS.md` | yes† | read | G `bf564e7a65` |

## §5 Authority, custody and continuity

| Ref | Line | Claim | Class | Check it with | Public? | Result | Verified at (private) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E2-01 | 195 | Toy: 19.51 bits, 16 anchors, six words per bucket, uniform draws; court-asserted | TOY | A `bash courts/court-25-aumlok-toy.sh` (asserts `min-entropy-bits: 19.5098`); recompute log2(16) + 6·log2(6) from `aumlok37/wordlists.json` | yes | recomputed | A `7cb6bda` |
| E2-02 | 195 | Toy `aumlok-kdf-v1` is scrypt n = 2^14, r = 8, p = 1 with a constant salt | TOY | A `aumlok37/kdf-contract.json`; `aumlok37/derive.py` | yes | read | A `7cb6bda` |
| E2-03 | 195 | About 0.048 s per derivation, author-reported | TOY: author-reported | no file in either repository carries the figure | **private only** (no retained record) | not checkable | none |
| E2-04 ‡ | 195 | This revision measured 0.02–0.04 s for the toy parameters on the §1 host, depending on load | TOY (host measurement) | `node -e "const c=require('crypto');console.time('kdf');c.scryptSync('x','salt',32,{N:16384,r:8,p:1});console.timeEnd('kdf')"` | command yes; the figure is host- and load-specific | re-run | §1 host, 26 Sept |
| E2-05 | 195 | At its pinned commit the toy printed a truncated SHA-256 of the phrase, since removed | TOY | A `aumlok37/generate.py`, `aumlok37/derive.py`, `aumlok37/SPEC-v1.md`, `courts/court-25-aumlok-toy.sh` (removal and its red arm) | removal yes; the old print is in **private history only** | read | A `7cb6bda` |
| E2-06 | 196 | `measure()` returns 34.142338067819374 = log2(150) + 26.9135 | MEASURED at the Genesis pin | G `measure()` command as in T5a, over `plugins/aukora-aumlok/data/aumlok-themes.json` | yes | re-run | G `bf564e7a65` |
| E2-07 | 196 | The common-words court prints the figure | MEASURED at the Genesis pin | G `node tests/aukora-aumlok-common-words.test.mjs` | yes | read | G `bf564e7a65` |
| E2-08 | 196 | The packaging court checks the module header, needs a materialized release, and was not run | MEASURED (scope note) | G `tests/aukora-aumlok-packaging.test.mjs` | yes | read | G `bf564e7a65` |
| E2-09 | 196 | The desktop drawer gives about 33.50 bits over about 2^40.4 phrases | MEASURED: preparation enumeration, not a court | G drawer code `apps/aukora-desktop/aumlok-draw.mjs` and `WORD_PATTERN` in `plugins/aukora-aumlok/lib/themed-entropy.mjs`; the enumeration script is not published | code yes; enumeration **private only** | re-run (see E3-20) | G `bf564e7a65` |
| E2-10 | 196 | `scripts/aumlok/bind --generate` uses older tables of about 14.3 bits | BUILT: file statement | G `scripts/aumlok/bind` (`--generate`); header of `plugins/aukora-aumlok/lib/ceremony-phrase.mjs` | yes | read | G `bf564e7a65` |
| E2-11 | 198 | `measure()` reports no floor; the bind accepts any seven well-shaped words | BUILT: code-read at the pin | G `measure()` (`floorBits` null); `plugins/aukora-aumlok/lib/bind-v3.mjs` (`WORD_PATTERN` only) | yes | re-run / read | G `bf564e7a65` |
| E2-12 | 198 | A 58-bit floor court is red by design and outside the aggregate runner and CI | BUILT: code-read at the pin | G `tests/aukora-aumlok-entropy-floor.test.mjs` (`FLOOR_BITS = 58`); `tests/aukora-aumlok-courts-wired.test.mjs`; `grep entropy-floor scripts/aukora-courts.sh .github/workflows/b1.yml` gives nothing | yes† | read | G `bf564e7a65` |
| E2-13 | 198 | Every desktop bind prints `ROOT_KEY_OFFLINE_GUESSABLE`; a court added after the pin asserts it; CLAIMS.md marks offline-guess resistance NOT CLAIMED | BUILT: code-read at the pin | G `plugins/aukora-aumlok/lib/bind-v3.mjs` (print); `plugins/aukora-aumlok/lib/ceilings.mjs`; `docs/CEILINGS.md`; `docs/CLAIMS.md`; `node tests/aukora-aumlok-root-key-ceiling.test.mjs` and `--mutate` (added after the pin) | yes† | read; court added after the pin | G `bf564e7a65` |
| E2-14 | 201 | Genesis `aumlok-kdf-v1`: scrypt N = 2^17, r = 8, p = 5, domain-and-handle salt, 64-byte seed for Ed25519 and ML-DSA-65; frozen by a court | BUILT | G `plugins/aukora-aumlok/lib/derive-v3.mjs`; `node tests/aukora-aumlok-kdf-pin.test.mjs --mutate` | yes | read | G `bf564e7a65` |
| E2-15 | 202 | 0.87–1.6 s per guess with load; 0.17–0.19 s at p = 1 | MEASURED: one loaded host | G `measureKdfSecondsPerGuess` in `plugins/aukora-aumlok/lib/derive-v3.mjs` | function yes; figures host-specific | re-run (0.86–0.95 s; 0.18–0.20 s at p = 1) | G `bf564e7a65`, §1 host |
| E2-16 | 211 | Bind and refresh keep only an HKDF machine key; the root is re-derived and never on disk; the cold-root court refuses cross-class signatures with positive controls | BUILT: court-driven | G `plugins/aukora-aumlok/lib/machine-key-v3.mjs` (`aumlok-machine-kdf-v1`); `node tests/aukora-aumlok-cold-root.test.mjs --mutate` | yes | read | G `bf564e7a65` |
| E2-17 ‡ | 213 | The record reads a revoked-machine list that no shipped code path writes (only a court builds one) | BUILT: code-read | G `git grep -n revokedMachines -- plugins apps scripts` (readers only); the one writer is `tests/aukora-aumlok-cold-root.test.mjs` | yes | read | G `bf564e7a65` |
| E2-18 | 213 | Succession code is exercised only by a rehearsal and a demo | BUILT: code-read | G `plugins/aukora-aumlok/lib/refresh-v3.mjs`; callers `scripts/aumlok/rehearse-rotation.mjs`, `plugins/aukora-aumlok/demo/sign-what-you-see.mjs` | yes | read | G `bf564e7a65` |
| E2-19 | 213 | The subject commits to a random nonce kept only in the record; re-binding mints a new subject | BUILT: code-read | G `plugins/aukora-aumlok/lib/bind-v3.mjs` (`genesisNonce: randomBytes(32)`); `plugins/aukora-aumlok/lib/genesis-v3.mjs` | yes | read | G `bf564e7a65` |
| E2-20 | 214 | Attendance is separate and its hardware path is not shipped; root-class signatures are Ed25519 only; the ML-DSA-65 seed signs nothing | BUILT: code-read | G `plugins/aukora-aumlok/lib/attendance.mjs`; `plugins/aukora-aumlok/lib/root-class-v3.mjs`; `plugins/aukora-aumlok/lib/ceilings.mjs` (`ML_DSA_65_UNMEASURED`) | yes | read | G `bf564e7a65` |

## §6 Validation, agreement and availability

| Ref | Line | Claim | Class | Check it with | Public? | Result | Verified at (private) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E2-21 | 233 | Round 4: four fixed TEST witnesses, three-signature certificate | TOY | A `witness37/cold_verify_witness.py` (`THRESHOLD = 3`); `witness37/certify.py`; `courts/court-24-witness-protocol.sh` | yes | read | A `7cb6bda` |
| E2-22 | 234 | Fresh-archive acceptance author-reported GREEN at a commit holding 26 court files | TOY: author-reported | Round 4 history; no retained log | **private only** | court count read; GREEN not checkable | Round 4 history (not public) |
| E2-23 | 234 | Court 24 asserts 405 explored schedules with zero conflicting certificates | TOY: author-reported | A `bash courts/court-24-witness-protocol.sh` (asserts `405` and `conflicting-certs=0`) | yes | read | A `7cb6bda` |
| E2-24 | 235 | The scheduler on AUKORA-37 main reproduces 405 schedules, 69 certificates per value, 267 stalls, 0 conflicts and six honest two-two splits | TOY: MEASURED at AUKORA-37 main | A `python3 -B witness37/scheduler.py` | yes | re-run | A `7cb6bda` |
| E2-25 | 236 | The toy prints eight ceiling labels | TOY | A `python3 -B witness37/scheduler.py` (CEILINGS block) | yes | re-run | A `7cb6bda` |
| E2-26 | 276 | Diamond's cold-consumer design supports verification independent of location | BUILT: source scope | G `vendor/kira-export/scripts/verify-kira-evidence.py`; `node tests/kira-diamond-cold.test.mjs` | yes | read | G `bf564e7a65` |
| E2-27 | 277 | The Nostr lane carries messages and is never the authority | BUILT: transport | G `plugins/aukora-nostr/lib/relay.mjs`; `plugins/aukora-nostr/README.md` ("A binding is not authorization") | yes | read | G `bf564e7a65` |

## §7 Memory, privacy and receipted training data

| Ref | Line | Claim | Class | Check it with | Public? | Result | Verified at (private) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E2-28 | 299 | The development head turned off upstream session-log upload, plugin inventory and telemetry | BUILT at the pin | G `overlays/privacy.patch.yml` (`enabled: false`, `mode: DISABLED`) | yes† | read | G `bf564e7a65` |
| E2-29 | 299 | The model router is asked to deny data collection | BUILT at the pin | G `plugins/aukora-face/apps/src/auma-live/presence.ts` (`data_collection: 'deny'`, `zdr: true`, `allow_fallbacks: false`) | yes | read | G `bf564e7a65` |
| E2-30 | 299 | Cloud speech recognition is opt-in | BUILT at the pin | G `plugins/aukora-face/apps/vendor/auma-live/runtime/app/aumalive.js` (`AUMA_LIVE_ALLOW_CLOUD_VOICE === true`) | yes | read | G `bf564e7a65` |
| E2-31 ‡ | 299 | WHAT-LEAVES-THIS-MACHINE.md states what leaves, with file and line for each setting (refreshed after the pin: privacy overlay, `allow_fallbacks: false`, the voice opt-in) | BUILT | G `docs/WHAT-LEAVES-THIS-MACHINE.md` | yes† | read after the refresh | later commit |
| E2-31b | 246 | Snapshot restore un-spends one-use state; retained head, Aura checkpoint and sequence number are blind; a consumption witness refuses the replay; its placement is open | TESTED: author-recorded; BUILT: code-read | G `node tests/aukora-restore-scope.test.mjs` and `--mutate`; `node tests/aukora-consumption-witness.test.mjs`; `plugins/aukora-owner-daemon/lib/consumption-witness.mjs` | yes† | recorded, not re-run (disposable state) | later commit |
| E2-32 | 314 | The consolidation court drives `consolidate.mjs` through 15 arms on a scratch store, each red when its protection is removed | TESTED_AT_PIN | G `node tests/kira-consolidate.test.mjs` and `--mutate`; subject `plugins/aukora-kira/lib/consolidate.mjs` | yes† | read (15 arms); recorded run | G `bf564e7a65` |
| E2-33 | 315 | What the arms assert: shared ancestry counts once, hashes are not independence, unknown ancestry never votes, contrary evidence kept, authority fields refused, no settlement import, the chorus cannot reopen a decline | BUILT: component scope | G arm names in `tests/kira-consolidate.test.mjs`; imports of `plugins/aukora-kira/lib/consolidate.mjs` | yes† | read | G `bf564e7a65` |
| E2-34 | 322 | Refusal lab: 0/6 unapproved effects, 1/1 early handoff, 0/1 false stop, 1/1 lesson, three controls red, no model, latency unmeasured | TOY: lab-recorded | unpublished laboratory branch | **private only** | not checkable | unpublished branch |

## §8 Self-improvement without self-authorization

| Ref | Line | Claim | Class | Check it with | Public? | Result | Verified at (private) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E2-35 | 360 | Advisory judge: Laya 0.3.4 on CPU | TOY | unpublished laboratory branch | **private only** | not checkable | unpublished branch |
| E2-36 | 361 | 36 cases, 72 calls, no paid inference, median 2.23 s; cards 10/24 against prose 15/24; `NO_CLEAR_WIN` | TOY: lab-recorded | unpublished laboratory branch | **private only** | not checkable | unpublished branch |
| E2-37 | 362 | The gate handed off all 72; zero incorrect and zero useful submissions; all 8 supported notes handed off | TOY: lab-recorded | unpublished laboratory branch | **private only** | not checkable | unpublished branch |
| E2-38 | 363 | The confidence field is one minus normalized entropy (0.027–0.270) | TOY: lab-recorded | unpublished laboratory branch; vendor package source | **private only** | not checkable | unpublished branch |
| E2-39 | 364 | Judge allowed 5/6 unauthorized; boundary refused all (0/12 effects); 0/2 false stops; a contradicted TEST-approved note cold-verified CLEAN | TOY: lab-recorded | unpublished laboratory branches | **private only** | not checkable | unpublished branch |
| E2-40 | 377 | AUKORA-37 main runs one proposer step in user, network, mount, IPC and PID namespaces with a read-only root on the same uid | BUILT: component scope; run UNVERIFIED | A `sandbox/joined_isolation.sh` (court 29; Linux only) | yes | read | A `7cb6bda` |
| E2-41 | 377 | An unpublished, unmerged branch adds a peer-credential owner gate that passes on one uid printing `TWO_PRINCIPAL: NOT_ESTABLISHED`; no run retained | BUILT: component scope; run UNVERIFIED | unpublished branch | **private only** | read; no run exists | unpublished branch |

## §11 Relation to prior art

| Ref | Line | Claim | Class | Check it with | Public? | Result | Verified at (private) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E3-01 | 446 | Nostr: signed events and relay transport | BUILT: external protocol | `[nostr]` link, NIP-01 at a pinned commit | external | link resolves | n/a |
| E3-02 | 447 | AT Protocol: portable identity, signed repositories, federated services | BUILT: external architecture | `[atproto]` link, accessed 26 Sept | external | link resolves | n/a |
| E3-03 | 448 | Farcaster: decentralized identity and signed messages | BUILT: external architecture | `[farcaster]` link, accessed 26 Sept | external | link resolves | n/a |
| E3-04 | 449 | Urbit: personal servers and network identity | BUILT: external architecture | `[urbit]` link, accessed 26 Sept | external | link resolves | n/a |
| E3-05 | 450 | Buzz: Nostr workspace, agent keys, signed histories, review approvals; workflow approval gates "being wired up" | BUILT: documented external implementation | `[buzz]` README at a pinned commit | external | read | n/a |
| E3-06 | 451 | FastPay and Sui Lutris: quorum settlement; owned and shared objects | BUILT: external systems | `[fastpay]`, `[lutris]` arXiv links | external | links resolve | n/a |

## §12 Revision 2.2 record

These rows restate earlier evidence; each points to the command a reader runs.

| Ref | Line | Claim | Class | Check it with | Public? | Result | Verified at (private) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E3-07 | 492 | Secret filter 4/4, three arms red under mutation | TESTED_AT_PIN | G `node tests/kira-secret-filter.test.mjs --mutate` (see T3b) | yes† | re-run | G `bf564e7a65` |
| E3-08 ‡ | 492 | WASM release court: 4 plain arms against the installed release's bytes (a local build, not published; no mutation run) | TESTED_AT_PIN: installed release | G `node tests/kira-wasm-proposal-release.test.mjs --release <dir>` (see T4a) | court yes; measured release **private only** | recorded | G `bf564e7a65` (court) |
| E3-09 | 492 | Cold consumer 12/12 | TESTED_AT_PIN | G `node tests/kira-diamond-cold.test.mjs` | yes | re-run | G `bf564e7a65` |
| E3-10 | 492 | Common words 16/16 | TESTED_AT_PIN | G `node tests/aukora-aumlok-common-words.test.mjs` | yes | re-run | G `bf564e7a65` |
| E3-11 | 492 | Point hygiene 5 arms, three red | TESTED_AT_PIN | G `node tests/aura-ed25519-point-hygiene.test.mjs --mutate` | yes† | re-run; court owed (wiring) | G `bf564e7a65` |
| E3-12 | 492 | Read guard 62 arms, 11 mutations | TESTED_AT_PIN | G `node tests/aukora-core-read-deny.test.mjs --mutate` | court yes†; CI record **private only** | recorded | private CI at G `bf564e7a65` |
| E3-13 | 492 | Consolidation 15 arms, each red under mutation | TESTED_AT_PIN | G `node tests/kira-consolidate.test.mjs --mutate` | yes† | read; recorded run | G `bf564e7a65` |
| E3-14 | 492 | Live Kira settlement | operator-recorded | G `docs/CLAIMS.md` live-only rows 8 and 11; their backing record sits under `experiments/`, which is not published | rows yes†; record **private only** | read | G `bf564e7a65` |
| E3-15 | 492 | Live Aura retention | operator-recorded | private operator log only | **private only** | not checkable | none |
| E3-16 | 493 | Toy 19.51 bits, court-asserted and recomputed | TOY: court-asserted, recomputed | A `bash courts/court-25-aumlok-toy.sh`; `aumlok37/wordlists.json` | yes | recomputed | A `7cb6bda` |
| E3-17 | 493 | Toy 0.048 s per derivation | TOY: author-reported | no published file carries it | **private only** (no retained record) | not checkable | none |
| E3-18 ‡ | 493 | 0.02–0.04 s for the toy KDF on the §1 host, varying with load | MEASURED | `node -e` with `crypto.scryptSync`, N = 2^14, r = 8, p = 1 (see E2-04) | command yes; figure host-specific | re-run | §1 host, 26 Sept |
| E3-19 | 493 | 34.14 bits (34.142338067819374) for the shipped lists | MEASURED at the Genesis pin | G `measure()` as in T5a | yes | re-run | G `bf564e7a65` |
| E3-20 | 493 | About 33.50 bits over about 2^40.4 phrases for the drawer | MEASURED: preparation enumeration, not a court | enumeration script (not published) over G `apps/aukora-desktop/aumlok-draw.mjs` | code yes; script **private only** | re-run (33.5009 bits; 2^40.365 phrases) | G `bf564e7a65` |
| E3-21 | 493 | About 14.3 bits for `bind --generate` | BUILT: file statement | G `plugins/aukora-aumlok/lib/ceremony-phrase.mjs` header; `scripts/aumlok/bind` | yes | read | G `bf564e7a65` |
| E3-22 | 493 | 64-bit floor retired | BUILT | G `plugins/aukora-aumlok/lib/themed-entropy.mjs` (retirement note; constant deleted) | yes | read | G `bf564e7a65` |
| E3-23 | 493 | 58-bit floor court red and unwired | BUILT: registry; verdict not re-run | G `tests/aukora-aumlok-entropy-floor.test.mjs`; `tests/kira-courts-wired.test.mjs`; `tests/aukora-aumlok-courts-wired.test.mjs` | yes | read | G `bf564e7a65` |
| E3-24 | 493 | 0.87–1.6 s per Genesis guess; 0.17–0.19 s at p = 1 | MEASURED: one loaded host | G `measureKdfSecondsPerGuess` in `plugins/aukora-aumlok/lib/derive-v3.mjs` | function yes; figures host-specific | re-run (0.95 s; 0.18 s at p = 1) | G `bf564e7a65`, §1 host |
| E3-25 | 494 | Local spend prototype | PROPOSED; TOY: lab-recorded | unpublished local branch | **private only** | not re-run | local branch (not pushed) |
| E3-26 | 494 | Self-signed-key admission in the experimental money gate | MEASURED | `experiments/laya/spend_gate.py` (excluded from the public snapshot); see S4 | **private only** | re-run (probe) | G `bf564e7a65` |
| E3-27 | 494 | 15-arm anti-mimetic court | TESTED_AT_PIN | G `node tests/kira-consolidate.test.mjs --mutate` (see E3-13) | yes† | read; recorded run | G `bf564e7a65` |
| E3-28 | 494 | Refusal memory (0/6, 1/1, 0/1, 1/1) | TOY: lab-recorded | unpublished laboratory branch | **private only** | not checkable | unpublished branch |
| E3-29 | 494 | Judge lab figures | TOY: lab-recorded | unpublished laboratory branch | **private only** | not checkable | unpublished branch |
| E3-30 | 494 | Witness scheduler 405/69/267/0 and six honest splits | TOY: MEASURED at AUKORA-37 main | A `python3 -B witness37/scheduler.py` | yes | re-run | A `7cb6bda` |
| E3-31 | 495 | `ROOT_KEY_OFFLINE_GUESSABLE` printed at the head | BUILT | G `plugins/aukora-aumlok/lib/bind-v3.mjs` and `plugins/aukora-aumlok/lib/ceremony-verify.mjs` (print); `git grep -n ROOT_KEY_OFFLINE_GUESSABLE -- tests` gives nothing | yes | read; court owed | G `bf564e7a65` |
| E3-32 | 495 | `PERSUASION_UNMEASURED` on every status payload, asserted by a court | BUILT | G `plugins/aukora-face/apps/src/status-facts.ts`; `node tests/laya-auma-status.test.mjs [--mutate]` | yes | read | G `bf564e7a65` |
| E3-33 | 495 | `CORE_RUNS_MODEL_CODE` stated in source and asserted by a court | BUILT | G `plugins/aukora-face/apps/src/auma-live/core-lens.ts`; `tests/laya-auma-status.test.mjs` (source-text check) | yes | read | G `bf564e7a65` |
| E3-34 | 495 | `CORE_VERB_FILTER_IS_LEXICAL` stated in source and asserted by a court | BUILT | G `plugins/aukora-face/apps/src/auma-live/core-lens.ts`; `tests/laya-auma-status.test.mjs` | yes | read | G `bf564e7a65` |
| E3-35 | 495 | `allowUnapproved` defaults to true | BUILT: code-read | G `apps/aukora-desktop/resolve.mjs` (see S2) | yes | read | G `bf564e7a65` |
| E3-36 | 496 | WASM cell narrowed: a release court over its bytes; only staging passes through the cell; `CELL_EXECUTION: NOT_ESTABLISHED` | BUILT | G `plugins/aukora-kira/lib/tools.mjs`; `vendor/kira-export/scripts/verify-kira-evidence.py`; `tests/kira-diamond-cold.test.mjs` | yes | read | G `bf564e7a65` |
| E3-37 | 496 | Cordis split out as SOURCE_PRESENT | SOURCE_PRESENT | G `upstream-dsh.json`; `tests/aukora-board-reload.test.mjs` is unwired (see T2) | yes | read | G `bf564e7a65` |

## Annex A

| Ref | Line | Claim | Class | Check it with | Public? | Result | Verified at (private) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E3-38 | 514 | Speech neuroprosthesis and inner-speech research are external results | BUILT: external research | `[speech]` and `[inner-speech]` links | external | links resolve | n/a |

---

## What this map does not show

- No complete test suite was run and no running application's behavior was measured for this
  revision (paper §1). "Recorded" results come from private CI and preparation logs, which are
  not published.
- Private-only rows cannot be checked by a reader. The paper labels each of them (private CI,
  operator-recorded, lab-recorded, author-reported, or "private source, not published"). The
  map adds nothing to them beyond saying where the record lives.
- A `court owed` row is accurate today, but no court goes red if the property changes. Those
  rows are the next courts to write.
