# AUMLOK ceremony rebuild — durable handoff

> **History, in one line: v2's custody — a randomly minted root wrapped under a per-day device secret and a printed recovery secret for a lost machine — was removed on 2026-09-23, and nothing was ever bound with it; v3 derives the root FROM the seven words, so the phrase is the identity and the way back at once, and there is no second factor to keep.**

The plan (`~/aukora-private/plans/AUMLOK-CEREMONY-PLAN.md`, v3) replaces every earlier version. THIS FILE IS KEPT AS THE RECORD OF WHAT WAS REMOVED AND WHY; everything below describes the model that no longer exists.

**Written** 2026-09-22 by the Aumlok lane, at the end of the session that was told to *"STOP everything
from the last prompt"*. **Read `~/aukora-private/plans/AUMLOK-CEREMONY-PLAN.md` first — it is the locked
spec, and this file does not replace it.** This file records only what was verified, what is superseded,
and the exact next action.

## 1. What is superseded (do not build on it)

Commits `c462ee55`, `41b00bdd`, `089e001c` on `fable/spatial-shell` are **pushed and must not be
reverted** (other lanes share the branch), but two of their parts are WRONG per the plan:

| Superseded | Why |
|---|---|
| `plugins/aukora-aumlok/lib/ceremony.mjs` — `generatePhrase()` from the 7,776-word EFF list | The AUMLOK phrase is a TRUE ACROSTIC (§1). Seven unrelated EFF words are not a phrase this system has ever had. |
| `ceremony.mjs:245` — `deriveOwnerKey(phrase)`, the phrase derives the key | Violates phi/Membrane law (§2): *the phrase NEVER derives the key*. Measured at ~14.3 bits, it must not be a key. |
| `lib/eff_large_wordlist.txt` in the plugin | Delete from the ceremony path (§6 step 4). |
| `apps/aukora-desktop/aumlok-ceremony.html` — hardcoded hex, forced dark, generic font, no face tokens | §5: the window must use the face's tokens, follow the app theme via `nativeTheme`, and reproduce `AumlokSurface.tsx`'s layout. |

**Still good and reusable** (verified green, unrelated to the corrections): `lib/ed25519-point.mjs` (the
real point validator — `nodeCryptoVerifierCapabilities()` supplies none, and the only others in the tree
were `() => true` stubs); `lib/succession.mjs` (rotate-key, §4); `lib/binding-report.mjs`; the
`installAumlokBridge` **structure** in `apps/aukora-desktop/aumlok-bridge.mjs` (closed channel set, sender
validation, own in-memory session, `devtools:false`, `loadFile`, no network) — its *page* and *phrase
source* are what change; `writeCeremonyReceipt` (§4 requires receipts for both paths).

Nothing is bound. The phrase shown on 2026-09-22 is disclosed and unused (§ header).

## 2. What was verified this session, against the originals

| Claim in the plan | Verified |
|---|---|
| `THEME_BY_ROW = ['root','root','unite','unite','rise','rise']` | ✓ `~/aukora-phi/ceremony/phrase.ts:66` |
| `WORDS_THEMED` with three themed buckets | ✓ `phrase.ts:67-110` |
| 18 six-letter `ANCHOR_WORDS`, anchor is WORD ZERO | ✓ `phrase.ts:112-113`; owner's #284 correction at `:12-13` |
| seven tokens dash-joined; six-word tail must not verify | ✓ `phrase.ts:147-151` |
| `generateAcrosticPhrase` — no repeats, 60 tries, `harbor` fallback | ✓ `phrase.ts:159-178` |
| donor pin exists and is the port's proof | ✓ `~/aukora-phi/evidence/ceremony-phrase.donor.json` (1202 bytes) |
| phi's courts exist to port | ✓ `test/ceremony-{phrase,door,recovery,vow}.test.ts` |
| Membrane rehearsal + its gates | ✓ `core/aumlok-custody-rehearsal.ts` (37 KB), `scripts/validate-aumlok-custody-rehearsal.ts` (29 KB) |
| 45,248 / min-entropy ≈14.3 bits shown on screen | ✓ `recovery.ts:79` `PHRASE_KEYSPACE = 45248`; `:11-17` records 15.40 being *wrong* and the exhaustive number being literal |

**No contradiction between the plan and phi/Membrane was found.** Nothing needed to be raised before
proceeding. One note for step 1: `phrase.ts` is read **as text** by two of phi's own tests (the donor pin
over the word set, and an exhaustive keyspace enumeration), so the port must keep the table literals
unannotated and line-anchored — phi's header (`:29-40`) records a real failure caused by a comment
shadowing a table.

## 3. The exact next action — step 1

Port **byte-faithful** into `plugins/aukora-aumlok/lib/`, recording source path + commit + sha256 for each
in the lane's PROVENANCE:

1. phi `ceremony/phrase.ts` → tables, `THEME_BY_ROW`, `ANCHOR_WORDS`, `generateAcrosticPhrase`; port
   `evidence/ceremony-phrase.donor.json` and `test/ceremony-phrase.test.ts` as the donor-pin court.
2. phi `ceremony/verify.ts` → seal/type-back, constant-time compare over all seven dash-joined, seven-token
   fingerprint, one content-free refusal.
3. phi `ceremony/recovery.ts` → the base-31 recovery material and the measured 14.34 figure.
4. Membrane `core/aumlok-custody.ts` → the pure custody core (no fs, injectable entropy): full-strength root
   mint, `aumlokRootId`, `genesisRef`, two purpose-separated HKDF→AES-256-GCM wraps, phrase-only wrap refused
   by name (`aumlok:phrase-only-wrap-refused`), one content-free refusal on any factor failure. Port the
   rehearsal gates as a court.

Then steps 2–8 in plan order, **one commit and push per step**, each with a court that can go red.

## 4. Open question the next session must resolve before step 3

The plan (§3) moves the **signer into the Electron main process** and has the shell serve the Unix socket the
backend's `approve-operation` already talks to. That socket is currently served by `scripts/aumlok/signer.mjs`
(a separate process, `--socket --key-file --registered-key-hex --approve`). Nothing in the plan says what
retires that process or how the shell takes the socket over without a window where neither serves it. Resolve
by reading `scripts/aumlok/signer.mjs` and `plugins/aukora-aumlok/lib/signer-channel.mjs` and stating the
handover explicitly — do not improvise it in code.

## 5. Rules that still bind

Own files only: `plugins/aukora-aumlok/**`, the Aumlok face, `apps/aukora-desktop/**`,
`tests/aukora-aumlok-*`. Never switch branches. Never `git add -A` in this six-lane tree — path-scope every
add and check nothing foreign is staged. The phrase never touches a web page, chat, log, IPC reply,
clipboard or argv. Commit and push after each step; when `npm run dist` is green, report the dist path and
**stop** for Fable to install.

---

## 6. Step 1 is DONE and pushed — `7238461e`

Ported into `plugins/aukora-aumlok/lib/`: `ceremony-phrase.mjs`, `ceremony-verify.mjs`,
`ceremony-recovery.mjs`, `custody.mjs`; fixtures in `data/`; `PROVENANCE-CEREMONY.md` carries every
source path, commit and sha256. Courts: `tests/aukora-aumlok-phrase.test.mjs` **23/23**,
`tests/aukora-aumlok-custody.test.mjs` **25/25**; existing bind 29/29 and ceremony 47/47 unchanged.

**The custody port is proven against the donor's own output**, not argued: `node:crypto` replaces
`@noble/curves` and the vendored tree replaces `@noble/post-quantum`, and the court reproduces
Membrane's donor-computed Ed25519 key, its 1952-byte ML-DSA-65 key and its rootId from fixed seeds.
The phrase port reproduces BOTH of phi's donor-pin digests.

**Two findings recorded rather than resolved** (both in `PROVENANCE-CEREMONY.md` §"Two findings"):
the pin's 275-vs-274 word drift is phi's and needs the absent donor checkout to resolve; and the
documented example `harbor → hazel amber raven birch ochre rowan` is **not producible** and must never
be bound — a court asserts it is not generable, as a control in the opposite direction.

## 7. Step 2, sized — and it is NOT a format swap

`local-control.json` has **20+ readers across five lanes**, not just this one:

```
plugins/aukora-nostr/bin/reissue-binding.mjs   plugins/aukora-nostr/lib/identity.mjs   ← Beta's lane
plugins/aukora-face/messages/src/contacts-store.ts                                     ← messages face
plugins/aukora-aumlok/lib/{store,succession,identity-correspondence,ceremony,binding-report}.mjs
scripts/aumlok/make-disposable-identity.mjs
apps/aukora-desktop/aumlok-bridge.mjs
tests/aukora-{nostr-contact,messages-contacts,aumlok-approve,aumlok-signer,aumlok-mount-flow,aumlok-bind}.test.mjs
```

Two constraints that decide the shape of step 2:

1. **`store.mjs:242` currently REQUIRES `ed25519PrivateKeyPem` and `mlDsa65SecretKeyHex`.** A v2 record
   holds two WRAPS and no seed, so that reader must be extended to accept v2 while v1 support stays.
   Writing v2 first would break the mounted adapter — the app would refuse its own controller.
2. **The projection must be re-founded, and its subject grammar must not move.** `PUBLIC_CONTROL_FIELDS`
   is `domain, subject, epoch, activeControlDigest, revoked, approvalKeyDid, custodyClass`. A v2 root
   carries `rootId, publicKeys, boundAt, genesisRef, revoked, integrity` — no `genesis` and no
   `activeControl`, which is where v1 got `subject` and `activeControlDigest`. The natural mapping is
   `subject = aukora:1:<rootId>` (rootId is already 64 hex, so it fits the grammar the Kira overlay
   pins), `epoch = 0` with succession advancing it, `activeControlDigest = root integrity`. **Confirm
   this mapping before writing it**, because the Kira overlay's `memoryOwner.subject` is pinned to the
   `aukora:1:<64 hex>` grammar and a change there is a cross-lane break, not a local one.

So step 2 is: extend `store.mjs` to read both versions → re-found the projection → then the binding
library writes v2 + its 0600 machine factor. In that order, each with its court, one commit per step.

## 8. Step 2a is DONE and pushed — `e0b532b2`

`lib/owner-record.mjs` writes and reads `local-control.json` **v2**: a full-strength root plus an
everyday wrap (phrase + a 0600 machine factor) and a recovery wrap (phrase + a long printed factor).
Court `tests/aukora-aumlok-owner-record.test.mjs` **23/23**.

**The order changed, deliberately.** §7 above said extend `store.mjs` FIRST. Instead the WRITER was
built first and `store.mjs` is untouched — v2 is written and read by this module and is reachable from
nothing that mounts it. That removes the failure §7 was protecting against (a v2 record the adapter
cannot read) without needing the reader to exist yet, and it lets the writer be verified on its own.
The reader is still the next step.

**The projection mapping is now IN THE CODE, and it is still a cross-lane fact.** `subject =
aukora:1:<rootId>`, `epoch = 0`, `activeControlDigest` = the root's integrity. Nothing mounts v2 yet,
so no live behaviour changed — but the moment `store.mjs` reads v2, the projected subject moves, and
the Kira overlay's `memoryOwner.subject` is pinned to that grammar. That is Plan §6 step 6's repoint,
and it is outside this lane's files.

**Step 2b, the remaining half:** teach `store.mjs` to read v2 while v1 keeps working, and re-found
`parseLocalAumlokPublicHalf` / `projectParsedRecord` on the v2 public root. This is the highest-risk
change in the plan — `local-control.json` has twenty-odd readers across five lanes — so do it with a
court that still exercises a v1 record end to end, and dispatch on the record's own `domain` rather
than on which fields happen to be present.

## 9. Round 3 — step 2b pushed, 2c saved, and ONE REGRESSION I INTRODUCED IN STEP 1

**Step 2b is DONE and pushed — `93076f10`.** `store.mjs` dispatches on the record's own `domain`, so
the mounted adapter reads v2 while v1 keeps working; `readLocalAumlokFullRecord` refuses a v2 record by
name (`aumlok-local:no-private-half-in-v2`) instead of returning two `undefined`s. The court caught a
real constraint: the adapter refuses any record with an INTERIOR NEWLINE, so the pretty-printed v2
writer from step 2a was rejected with `aumlok-local:entry-malformed`. The writer emits one canonical
line now. Court `owner-record` 28/28.

**Step 2c IS WRITTEN BUT NOT COMMITTED.** Its diff is saved at
`~/.aukora-lane-scratch/aumlok-step2c-working.patch` (601 lines) with the file list beside it. It does:
`bindOwnerFromPhrase` MINTS a full-strength root and wraps it twice instead of deriving the key from
the phrase; the CLI draws and proves the ML-DSA-65 seed before reading the phrase, prints the recovery
secret once, and replaces the now-false `KEY_DERIVATION: scrypt …` line with `KEY_ORIGIN: minted …`;
and `openEverydayKeyMaterial` opens the everyday wrap into the PEM/hex shapes the rest of the lane
expects. It was reverted because it leaves FOUR courts red and I ran out of room to update them
properly. What each needs:

- `owner-record` — its "v1 still works" arm used the CLI as a v1 PRODUCER. After 2c nothing writes v1,
  so the arm needs a v1 FIXTURE built in-court from `genesis.mjs` + `control.mjs` + `deriveOwnerKey`.
- `pq-keypair` — `correspondenceOf(record)` reads `record.activeControl.publicKeys.mlDsa65` and
  `record.mlDsa65SecretKeyHex`; both come from `openEverydayKeyMaterial` now.
- `bind-e2e` — two more v1 reads, including line 257's `record.ed25519PrivateKeyPem` used as the
  session-log leak needle; point it at the opened key, which is a STRONGER needle.
- `ceremony` — six arms. Five are SUCCESSION, which is v1-only: `succeedOwnerFromPhrase` reads
  `record.activeControl` and `record.ed25519PrivateKeyPem`. Plan §4 makes Rotate = succession with a
  new root and new wraps, and §6 step 5 is where that lands, so the interim is to refuse a v2 record
  BY NAME and convert those arms to assert that refusal. The sixth inverts the phrase-derivation arm.

## 10. ⛔ A REGRESSION I INTRODUCED IN STEP 1, found by a court I had not run

`tests/aukora-aumlok-pq-keypair.test.mjs` is **RED at the pushed HEAD `93076f10`**, on the arm *"with
the generator DELETED the ceremony exits non-zero"*, and it is my fault, not the court's.

**Cause.** `lib/custody.mjs` (step 1) has a STATIC `import { ml_dsa65 } from './vendor/noble-ml-dsa/index.mjs'`.
The barrel `index.mjs` re-exports custody, so with the vendored tree absent the barrel fails at MODULE
LOAD time and Node exits 1 — before any `refuse()` runs. Before step 1 the vendor was reached only
dynamically, inside `vendoredMlDsa65Capability()`, so `acquireCorrespondingMlDsa65Keypair` threw
`MlDsa65KeygenError` and the CLI refused BY NAME with exit 2.

**Why it matters beyond the test.** The lane's designed property is that a missing generator is a NAMED
refusal (`aumlok:ml-dsa-65-generator-unavailable`) that registers nothing and never asks for a phrase.
A load-time crash is none of those things. The other three arms of that block still pass, so the
guarded behaviour is intact; only the NAME and the exit code are lost.

**The fix, not yet applied.** Make the keygen an INJECTABLE capability on the custody core — which is
what its own header already claims it is, "pure, every entropy-bearing input injectable" — with a lazily
resolved default that raises `aumlok:ml-dsa-65-generator-unavailable` when it is absent. That is a
change to `derivePublicKeys`'s call sites, so it wants its own increment and its own court arm rather
than a rushed patch. **Do this before step 3**, because step 3 is the signer and it is the next thing
that depends on the generator being reachable.

## 11. Round 4 — the step-1 regression is FIXED and pushed (`001d991f`)

`lib/custody.mjs` no longer imports the vendored ML-DSA-65 tree. The vendor is loaded in exactly one
place — `vendoredMlDsa65Capability()`, dynamically, which is where it always was — and that one loader
now INSTALLS the keygen into the custody core. With nothing installed, `derivePublicKeys` refuses
`aumlok:ml-dsa-65-generator-unavailable` BY NAME rather than crashing at module load.

Three arms guard it, one of them in a FRESH PROCESS because the keygen is installed as a side effect:
no static vendor import in custody.mjs; the named refusal with no generator; and the barrel still
LOADING with no generator, which is exactly what the load-time crash cost.

**ALL THIRTEEN Aumlok suites are green at `001d991f`:** approve 41, ceremony 47, custody 28,
d3-spike 11, bind-e2e 10, bind 29, mount-flow 16, mount 22, owner-record 28, phrase 23,
pq-keypair 34, signer 88, verify 21.

Three stale court arms were fixed rather than loosened, and each is worth knowing about because each
failed for a reason worth keeping:
  * `pq-keypair`'s ordering arm searched the CLI for `mkdirSync(absolute` — moved into `ceremony.mjs`
    by the shared-library refactor. It refused to assert nothing rather than passing vacuously, and
    now checks the property in BOTH files.
  * the same arm's library anchors were written against the uncommitted 2c text; corrected to HEAD's.
  * `custody`'s comment-stripper control asserted `ml_dsa65.keygen`, which the injection removed — it
    went red because the code changed under it, which is what a positive control is for.

## 12. Next, in order

1. **Step 2c** — re-apply `~/.aukora-lane-scratch/aumlok-step2c-working.patch` and update the four
   courts it leaves red. It was written against the pre-injection `custody.mjs`, so expect conflicts
   in `index.mjs` at least; everything else in it is unaffected by the injection fix. The four courts
   and what each needs are listed in §9. Note that §9's item for `pq-keypair` is now DONE (the opened
   halves come from `openEverydayKeyMaterial`, added by that same patch) — what remains there is only
   that the court must install the generator first, which it now does.
2. Then step 3 (the signer in the shell with the 48h unlock window). Its prerequisite — a reachable
   generator that refuses by name — is now satisfied.

## 13. Round 5 — an independent bug fixed and pushed (`bd90e84f`); 2c saved a second time

**`openWrap` no longer blames the owner's factors for a missing primitive.** Its blanket catch
swallowed the ML-DSA-65 generator's own refusal and reported
`aumlok:the-factors-did-not-open-this-custody-record`. Opening a record rederives the public keys to
check the wrap against its bound rootId, and that derivation needs the generator — so without it, the
refusal was a statement about the owner's SECRET. Someone reading it would go hunting for a lost
phrase. Found by doing 2c: a CLI-written record refused to open with the CORRECT phrase and the
CORRECT machine factor. Two arms guard it, one of them in a FRESH PROCESS against a real v2 record,
plus a discriminating arm that opens the same wrap with the right factors.

**All thirteen Aumlok suites are green at `bd90e84f`** (owner-record is now 30 arms).

**STEP 2C IS SAVED AT `~/.aukora-lane-scratch/aumlok-step2c-v2.patch`** — 404 lines, SIX files, all
this lane's, verified by filename. **Delete the earlier `aumlok-step2c-working.patch` if it is still
around: that one was made with an unscoped `git diff` and contains ANOTHER LANE's uncommitted
`apps/aukora-desktop/resolve.mjs`.** The scoped one is the only patch to apply.

2c makes `bindOwnerFromPhrase` MINT a root and wrap it twice, adds `openEverydayKeyMaterial`, makes
`readBindingReport` read v2, and rewrites the CLI's output including replacing the now-false
`KEY_DERIVATION: scrypt …` line. In round 5 it got as far as **`bind` 29/29 GREEN against v2** before
four other courts needed work I ran out of room for. What each needs, precisely:

- `ceremony` — five SUCCESSION arms. `succeedOwnerFromPhrase` reads `record.activeControl` and
  `record.ed25519PrivateKeyPem`, neither of which a v2 record has. Plan §4 makes Rotate = succession
  with a new root and new wraps, and §6 step 5 is where that lands, so the interim is to refuse a v2
  record BY NAME and convert those arms to assert that refusal. The sixth inverts the
  phrase-derivation arm.
- `owner-record` — its "v1 still works" arm used the CLI as a v1 PRODUCER. After 2c nothing writes v1,
  so it needs a v1 FIXTURE built in-court from `genesis.mjs` + `control.mjs` + `deriveOwnerKey`.
- `pq-keypair` — half reads must branch on version: v2 publishes one half and WRAPS the other, so the
  secret comes from opening the wrap. Its `correspondenceOf(record, opened)` and the "both halves"
  arm were partly converted in round 5; the conversion is the right shape, it just needs finishing.
- `bind-e2e` — line 138's `writeFileSync(keyPath, record.ed25519PrivateKeyPem)` and line 257's leak
  needle both need the opened key. The point at line 257 is worth keeping: the opened key is a
  STRONGER needle than the v1 one, because it is the key itself and not a copy in the record.

## 14. Round 6 — 2c APPLIED AND 12/13 COURTS FIXED, captured in one patch

**`~/.aukora-lane-scratch/aumlok-step2c-v3.patch` — 887 lines, ELEVEN files, all this lane's.** Apply
with `git apply --exclude=plugins/aukora-aumlok/lib/custody.mjs` (that hunk is already committed as
`bd90e84f`). Delete the v1 and v2 patch files: the first was unscoped and carried another lane's
`resolve.mjs`, and both are superseded.

It contains: the v2 mint (`bindOwnerFromPhrase` mints a root and wraps it twice), `openEverydayKeyMaterial`,
`readBindingReport` reading v2, the CLI's new output, succession refusing a v2 record BY NAME, AND the
court fixes for FOUR suites — `bind` 29/29, `pq-keypair` 34/34, `bind-e2e` 10/10, `owner-record` 30/30
— all verified green with 2c applied. `ceremony` is the ONE suite still red under it, and its ten failing
arms are all succession/report: five exercise the v1 succession path, which the v2 refusal now blocks.

**What `ceremony` needs, and the trade to make.** It needs `buildV1Controller` (the helper now in
`owner-record.test.mjs`, ~28 lines) so it can run its succession arms against a REAL v1 fixture rather
than the CLI, which no longer produces one. That preserves coverage of the v1 succession path. The
alternative — converting those arms to assert the refusal — is fewer edits but drops the coverage, and
v1 succession is still shipped code until step 5 replaces it. **Prefer the fixture.**

**Two defects the courts found while 2c was applied, both real and both fixed inside the patch:**
  * `openEverydayKeyMaterial` returned the 32-byte SEED hex under the name `mlDsa65SecretKeyHex`, where
    every consumer in this lane expects the 4032-byte EXPANDED key — 64 hex characters offered as 8064.
    `custody.deriveMlDsa65SecretKeyHex` now expands it.
  * `pq-keypair`'s ordering arm could be retired by a rename: it pinned anchor spellings, and each
    rename made it refuse to assert anything. It now reads whichever anchor is present, so the PROPERTY
    survives a rename instead of the arm dying quietly.

**A process note worth keeping.** Two of this round's saves used `tests/aukora-aumlok-` as a pathspec.
That matches nothing, so `git diff` silently excluded every test file AND `git checkout` silently
reverted nothing — the patch looked right and the revert looked clean while neither had happened. Both
were caught by checking the patch's file list rather than trusting the command's exit code. **Check the
file list of any patch before applying it, and never write a pathspec without its glob.**

## 15. Round 7 — one correction to the apply recipe, and the exact remaining edit

**DO NOT `--exclude` the whole `custody.mjs` hunk.** Its one hunk carries BOTH the `openWrap` fix
(already committed as `bd90e84f`) AND `deriveMlDsa65SecretKeyHex`, which `owner-record.mjs` imports. In
round 7 I excluded the file to avoid the already-applied part and lost the export, and every suite
failed to load with `does not provide an export named 'deriveMlDsa65SecretKeyHex'`. Either apply the
patch whole and resolve that one hunk by hand, or apply with `--exclude` and then add:

```js
export function deriveMlDsa65SecretKeyHex(seed) {
  if (typeof installedKeygen !== 'function') throw new Error(ML_DSA_65_GENERATOR_UNAVAILABLE)
  return Buffer.from(installedKeygen(seed).secretKey).toString('hex')
}
```
plus its line in `index.mjs`'s custody export block.

**`ceremony` is the only suite left, and the edit is known exactly.** Nine arms fail under 2c, all
succession or report. The fix, verified in design but not yet written:

- add `buildV1Controller(directory, phrase)` (port from `owner-record.test.mjs`, ~28 lines);
- invert the derivation arm — v1 asserted the registered key EQUALS `deriveOwnerKey(phrase)`, v2 must
  assert the opposite;
- replace section 5's two succession arms with (a) a v2 refusal arm asserting
  `SUCCESSION_REFUSE.V2_NOT_IMPLEMENTED` and (b) a bridge succession over a v1 fixture, so the
  bridge's own succession wiring — socket call, proof file, mode `0600` — keeps its coverage;
- point section 9's `reportDir` at `buildV1Controller` rather than `bindOwnerFromPhrase`, because the
  two arms below it advance the epoch and succession is v1-only until step 5;
- section 12's receipt arm expects `/succession-key-unchanged/`; under 2c the refusal is
  `/succession-v2-not-implemented/`.

**THREE ROUNDS HAVE GONE INTO STEP 2C WITHOUT LANDING IT.** Each time the source change was fine and
the court updates ran out of room. The patch is complete and verified for four suites; treat the
`ceremony` edit above as a single self-contained increment and land 2c with it, rather than
re-deriving any of the rest.

## 16. Round 8 — STEP 2C IS LANDED (`48b5d6c6`). Steps 1, 2a, 2b and 2c are all in.

**The phrase unwraps the key and no longer derives it.** `bindOwnerFromPhrase` mints an Ed25519 seed
and an ML-DSA-65 seed at full strength and wraps the pair twice — everyday under phrase + a 0600
machine factor, recovery under phrase + a long printed factor. `local-control.json` v2 plus its 0600
companion file are what a ceremony now writes. It fails closed if the proven ML-DSA-65 key is not
the one the record derives from its own seed.

**ALL THIRTEEN Aumlok suites are green at `48b5d6c6`, and all thirteen were green WITHOUT it
immediately before**, so nothing in that list is a pre-existing pass: approve 41, ceremony 47,
custody 28, d3-spike 11, bind-e2e 10, bind 29, mount-flow 16, mount 22, owner-record 30, phrase 23,
pq-keypair 34, signer 88, verify 21.

**The patch file is now redundant — delete `~/.aukora-lane-scratch/aumlok-step2c-*.patch`.** All of it
is in `48b5d6c6`.

Three defects were found and fixed while landing it, each worth remembering:
  * `openEverydayKeyMaterial` returned the 32-byte SEED under the name `mlDsa65SecretKeyHex`, where
    every consumer expects the 4032-byte expanded key. `custody.deriveMlDsa65SecretKeyHex` expands it.
  * the v2 succession guard was UNREACHABLE — `readController` rejects any non-v1 domain first, so a v2
    record read as `succession-predecessor-unreadable`, "your controller is broken", when rotating a
    v2 key is simply a different, unbuilt procedure. The refusal moved to where the domain is read.
  * an arm in `bind` was passing VACUOUSLY because this step renamed the line its regex read.

## 17. Step 3, and the open question that has to be answered first

The plan (§3) moves the signer INTO the Electron main process: at launch or on first approval the
shell asks for the phrase in the ceremony window, opens the everyday wrap with its machine factor, and
holds the seeds in MAIN-PROCESS MEMORY ONLY for an unlock window (default 48h, "Lock now"). The
backend's `approve-operation` keeps talking to the same Unix socket, now served by the shell; locked
means a refusal by name (`aumlok:locked`).

**THE HANDOVER IS STILL UNDECIDED AND MUST BE READ, NOT IMPROVISED.** `scripts/aumlok/signer.mjs` is a
separate process that binds that socket today (`--socket --key-file --registered-key-hex --approve`).
Nothing in the plan says what retires it, or how the shell takes the socket over without a window in
which neither side is serving — during which a real approval would be refused for a reason that has
nothing to do with the owner. Read `signer.mjs` and `lib/signer-channel.mjs`, state the handover
explicitly, and only then write code.

The prerequisite from round 4 is now satisfied: the generator is injectable and refuses BY NAME when
it is absent, so the shell can reach it and report a missing primitive honestly.

## 18. Round 9 — step 3a landed (`025c8188`): the unlock window

`lib/unlock.mjs` + `tests/aukora-aumlok-unlock.test.mjs` (15/15). All FOURTEEN Aumlok suites green.
48-hour default window, `lock()` for "Lock now", injected clock so the window is a DEADLINE rather
than a sleep, expiry OBSERVED on the next question rather than timer-driven, and the seed bytes
ZEROED on expiry, on lock, and on re-unlock — the court keeps its own reference and asserts the
arrays are zeros, because a dropped reference is a copy someone else may still hold.

`aumlok:never-unlocked` and `aumlok:locked` are DISTINCT names, and neither echoes a key byte.
`custody.ed25519PrivateKeyFromSeed` builds the signer's key from an open session so the PEM never
becomes a value a caller keeps. The module reaches no filesystem, asserted over its code.

## 19. Step 3b and 3c — what is left of step 3, and the handover, now decided by reading

**The wire is simpler than it looked.** `scripts/aumlok/signer.mjs` serves a Unix socket whose entire
protocol is ONE JSON LINE IN, ONE JSON LINE OUT: the broker's `exchangeLine({socketPath, line,
timeoutMs})` connects, writes `${JSON.stringify(request)}\n`, and reads one line back; the signer
answers with `encodeApprovalResponse(response)`. So the shell does not need to reimplement a protocol
— it needs to serve the same one.

The signer itself is `createOwnerSigner({ privateKey, registeredPublicKeyHex, review, seen, now })`,
and `review` is the only human-facing part (`popupReview` in `signer.mjs`). The shell's version passes
a review backed by the ceremony window, and takes `privateKey` from
`custody.ed25519PrivateKeyFromSeed(unlockSession.requireSeeds().ed25519Seed)`.

**THE HANDOVER, STATED RATHER THAN IMPROVISED.** The standalone signer is an OPERATOR-STARTED process
in a terminal, so the shell cannot retire it and must not try. The rule is therefore: **the shell binds
the socket, and if something else already holds it the shell REFUSES BY NAME** rather than unlinking or
stealing it. `signer.mjs` already owns its socket carefully (`ownsLeafNow`, `removeOwnSocket`,
`chmodSync(target, 0o600)`) and the shell must keep the same rigour: bind only if the path is free or
is a socket this process made, mode 0600 from bind time, remove only what it created. The operator's
part of the handover is to stop running the standalone signer; the shell's part is to refuse loudly if
they have not. There is no quiet overlap, and no window where neither serves — the shell binds at
startup, before any approval can arrive.

**Still to do for step 3:** the socket server over `unlock.mjs` (3b), the ceremony window's unlock mode
and the "Lock now" control (3c), and a court proving that a LOCKED session refuses over the wire with
`aumlok:locked` rather than a channel error. Then steps 4–8.

**Note for step 4:** the ceremony window still has to be rebuilt from the face's tokens and layout —
`apps/aukora-desktop/aumlok-ceremony.html` is still the EFF-era page with hardcoded hex and forced
dark, and `lib/eff_large_wordlist.txt` is still in the ceremony path. The phrase generator to use is
`ceremony-phrase.mjs`'s `generateAcrosticPhrase`, ported in step 1 and unused by the window so far.

## 20. Round 10 — step 3b landed (`c7c63b7c`): the shell serves the signer

`lib/unlock-server.mjs` + `tests/aukora-aumlok-unlock-server.test.mjs` (7/7). **All FIFTEEN Aumlok
suites green.** The wire is UNCHANGED — one JSON line in, one out — because `signer.mjs` already
speaks it and the backend already depends on it. The only difference is where the key comes from.

**The handover is implemented, not just stated.** Binding REFUSES BY NAME if the path already exists
rather than unlinking it, because taking that socket would move the owner's approvals to a different
key with nobody told. 0600 from bind time; `close()` removes only its own socket. Both asserted. The
operator's half is to stop running the standalone signer, and the shell's half is to refuse loudly
until they do.

**AND ONE COLLAPSE REMOVED FROM THE BROKER — this is why 3b was needed at all.** `signer-channel.mjs`
mapped EVERY refusal to `aumlok:approval-refused` with the signer's reason buried in a detail string,
so "the owner declined" and "your own machine needs unlocking" arrived under the same name. Only one
of those is ever true. The two unlock names now pass through AS THEIR OWN REASONS, imported from
`unlock.mjs` so they cannot drift from the session that produces them.

The court runs the REAL path at both ends: a v2 record is bound, its everyday wrap opened into an
unlock session, and an approval is signed through the lane's own broker, which verifies the signature
under the registered key. Then the window closes and the wire must say `aumlok:locked` — distinct from
`aumlok:never-unlocked` and from `aumlok:approval-refused`.

## 21. What is left of step 3 (3c), then steps 4–8

**3c:** the Electron main process must START `serveUnlockedSigner` at app launch, and the ceremony
window needs an unlock mode plus a "Lock now" control. Nothing in `apps/aukora-desktop/` calls
`unlock.mjs` or `unlock-server.mjs` yet, so the shipped app still signs the v1 way — or not at all,
since the ceremony now writes v2 and `signer.mjs --key-file` has no PEM to read. **That gap is real
and worth stating plainly: a v2 record plus the old signer equals no approvals until 3c lands.**

**Step 4** rebuilds the ceremony window from the face's tokens and the ROOT/UNITE/RISE spine, and
replaces the EFF generator with `ceremony-phrase.mjs`'s `generateAcrosticPhrase` (ported in step 1,
still unused by the window). `lib/eff_large_wordlist.txt` leaves the ceremony path there.

**Steps 5–8:** change-phrase re-wrap and v2 rotate-key succession; retire `state/controller` and
repoint the Kira overlay; the remaining courts; `npm run dist` and stop for Fable.

## 22. Round 11 — STEP 3 IS COMPLETE (`f9a81c78`). Steps 1, 2a, 2b, 2c, 3 are all in.

3a the unlock window, 3b the served signer, 3c the shell starting it at launch. **All SIXTEEN Aumlok
suites green.**

The gap named last round is closed: a v2 controller now HAS something serving the approval socket, and
it starts LOCKED. An approval dials, reaches a listener, and is refused `aumlok:never-unlocked` at a
cold launch or `aumlok:locked` after a window closes — never `channel-unavailable`, which would send a
person debugging a crash that did not happen.

**THE SOCKET PATH IS AN OPERATOR SETTING AND THAT IS NOT YET WIRED ANYWHERE REAL.**
`scripts/aumlok/approve-operation` requires `--signer-socket` and has no default, so the shell reads
`AUKORA_SIGNER_SOCKET` and does not serve at all when it is unset. **Nothing sets that variable today**,
on either side. So the honest state of a live deployment right now is: the shell serves nothing until
the operator exports that variable AND passes the same path to `approve-operation`. That is a
deployment step, not a code gap, and it belongs to whoever does the restart — say it out loud rather
than letting the first approval fail as `channel-unavailable`.

## 23. What remains: steps 4–8

**Step 4 — the ceremony window**, and it is the largest remaining piece. `apps/aukora-desktop/aumlok-ceremony.html`
is STILL the EFF-era page: hardcoded hex, forced dark, a generic font, no face tokens, and it draws
seven random EFF words. It must become the face's own layout — gold anchor token on top, the
ROOT/UNITE/RISE spine below, tokens not hex, following `nativeTheme` — using
`ceremony-phrase.mjs`'s `generateAcrosticPhrase` (ported in step 1, still unused by the window).
`lib/eff_large_wordlist.txt` leaves the ceremony path there. It also gains the unlock mode and
"Lock now", which is what calls the session 3a built: the review callback in
`apps/aukora-desktop/aumlok-signer.mjs` currently declines everything and step 4 replaces its body.

**Step 5 — change-phrase re-wrap and v2 rotate-key succession.** `succeedOwnerFromPhrase` refuses a v2
record by name today (`aumlok:succession-v2-not-implemented`), which is the correct interim and the
thing this step replaces: open the everyday wrap, mint a NEW root, wrap it twice, sign the transition
with the OLD key.

**Step 6** — retire `state/controller` (the machinery exists in `retireTestController` and is asserted;
it has simply never run against live state) and repoint the Kira overlay at the real controller.

**Step 7** — the remaining courts from plan §6.

**Step 8** — `npm run dist`, then STOP and report the dist path for Fable. Last measured build was
`apps/aukora-desktop/dist/mac-arm64/AUKORA.app` at `c462ee55`; NOTHING has been rebuilt since, so that
artifact predates every step-2 and step-3 commit and must not be installed.

## 24. Round 12 (the last) — step 4a landed (`89f2307b`). SEVENTEEN courts green.

`lib/ceremony-view.mjs` + `tests/aukora-aumlok-ceremony-view.test.mjs` (10/10): the SHAPE the ceremony
window draws, as a pure function, with the face's TOKEN NAMES and no hex anywhere — asserted by walking
every leaf, with a planted-hex control. The anchor is word zero, marked `typed: true`; the six rows'
letters spell it; the three bands carry the plan's own subtitles; the honesty block carries the measured
14.34 bits beside the phrase. It DESCRIBES a phrase rather than generating one.

**NOT ON SCREEN.** The page still renders the EFF-era layout. This is the data step 4b draws.

## 25. FINAL STATE — what is done, what is not, and what would finish it

**DONE AND PUSHED, each with its own court, all seventeen suites green at `89f2307b`:**

| Step | Commit | What it is |
|---|---|---|
| 1 | `7238461e` | phi's phrase/verify/recovery and Membrane's custody ported byte-faithful, with PROVENANCE and the donor's own byte vectors reproduced |
| 2a | `e0b532b2` | `local-control.json` v2: a full-strength root, two purpose-separated wraps |
| 2b | `93076f10` | the mounted adapter reads v2 while v1 keeps working |
| 2c | `48b5d6c6` | **the phrase unwraps the key and no longer derives it** — plan §2 |
| 3a | `025c8188` | the 48-hour unlock window, seeds zeroed on expiry, two distinct lock names |
| 3b | `c7c63b7c` | the shell serves the approval socket; the broker stops collapsing "locked" into "declined" |
| 3c | `f9a81c78` | the shell starts that signer at launch, locked |
| 4a | `89f2307b` | the window's display data, tokens not hex |

**NOT DONE — steps 4b through 8:**

1. **4b: rewrite `apps/aukora-desktop/aumlok-ceremony.html`** to draw `ceremonyView()` — gold anchor on
   top, ROOT/UNITE/RISE spine below, the face's tokens, following `nativeTheme`. It must use
   `generateAcrosticPhrase` (step 1, still unused by the window) instead of the EFF list, and
   `lib/eff_large_wordlist.txt` leaves the ceremony path there. It also gains the unlock mode and
   "Lock now", which replaces the review callback in `apps/aukora-desktop/aumlok-signer.mjs` that
   currently declines everything.
2. **5: v2 rotate-key succession and change-phrase re-wrap.** `succeedOwnerFromPhrase` refuses a v2
   record by name today (`aumlok:succession-v2-not-implemented`); that refusal is the hook to replace.
3. **6:** retire `state/controller` (the machinery exists and is asserted; it has never run against live
   state) and repoint the Kira overlay at the real controller.
4. **7:** the remaining plan §6 courts.
5. **8:** `npm run dist`, then STOP and report the dist path.

**TWO THINGS A DEPLOYER MUST KNOW, both of which fail silently if skipped:**
  * **`AUKORA_SIGNER_SOCKET` is read by the shell and set by nothing.** Until an operator exports it
    AND passes the same path to `approve-operation --signer-socket`, no approval socket is served at
    all — deliberately, because inventing a path the backend is not dialling would fail as
    `channel-unavailable` and look like a crash.
  * **THE LAST BUILT ARTIFACT IS STALE.** `apps/aukora-desktop/dist/mac-arm64/AUKORA.app` was built at
    `c462ee55` and predates every step-2 and step-3 commit. It must not be installed. Step 8 rebuilds.

**AND ONE THING TRUE OF THE WHOLE REBUILD:** nothing here has been through Electron. Seventeen courts
run the real libraries, the real broker and the real socket, but no window has been opened and no
phrase has been typed by a person. Peter's click remains the acceptance, and no court substitutes for
it.

## 26. Round 14 (last of this budget) — 4b holds; T is DIAGNOSED and its court found a hang

> **THE DIAGNOSIS IN THIS SECTION IS WRONG. SEE §27.** The hang was in the COURT, not in step 3b:
> `spawnSync` blocks the parent's event loop, so the socket server living in that same parent could
> never accept the connection. T has since landed at `a91637c6` — and writing its court first did find
> a real defect, but a different one, in `operation-approval.mjs`. Everything below about T's three
> source changes was right; everything below that blames step 3b is not.

**4b stands as pushed at `467984a6`; all eighteen Aumlok suites are green and the tree is clean.**

**T was built, run, and reverted — its court found a defect in step 3b that I had not seen.**
The court started a real served socket from a LOCKED unlock session and ran the SHIPPED
`approve-operation` with no `--signer-socket`, with `AUKORA_SIGNER_SOCKET` set. Four arms passed once
the change was in, including the one that matters: `approve-operation` no longer refuses for a missing
flag. The fifth FAILED, and it failed on a **HANG**: the command confirmed the operation digest,
dialled the socket, and then sat there until my 30-second court timeout killed it (`exit null`).

**That is a real defect and it is mine, from step 3b.** A locked session is supposed to answer over the
wire with `aumlok:locked` — the step-3b court asserts exactly that against the lane's own broker and it
passes. But `approve-operation` uses `OPERATOR_SIGNER_TIMEOUT_MS = 310_000`, the attended-path fix from
round 5, so when the served socket's locked reply is not accepted the command hangs for **five minutes**
rather than failing. The lane's own `signer-channel` court and my `unlock-server` court both pass
because the BROKER accepts that reply; the shipped operator command evidently does not, or does not
reach it. **Diagnose the command against the served socket before re-attempting T.**

The three source changes T needs are known and small, and were written and verified by four arms before
being reverted:
1. `apps/aukora-desktop/aumlok-signer.mjs` — `resolveSignerSocketPath` returns
   `{socketPath: join(stateRoot, 'aumlok-signer.sock'), source: 'userData-default'}` instead of `null`
   when nothing is exported, because returning null is what made the two sides disagree by omission.
2. `apps/aukora-desktop/main.mjs` — resolve it ONCE before `startHarness` and pass it to the backend
   child through `eyeEnv`, which `supervisor.mjs:190` already forwards into the launcher's environment.
3. `scripts/aumlok/approve-operation` — `const socketPath = option('--signer-socket') ??
   process.env.AUKORA_SIGNER_SOCKET`, with the usage line updated. The court must pass
   `library.operationDigestOf(content)` and not an arbitrary hex, or the command refuses before it dials.

**THE EFF LIST IS STILL PRESENT** (`lib/eff_large_wordlist.txt` and the functions reading it). Round 13
showed that removing it is a DEPENDENCY removal, not a file deletion: `scripts/aumlok/bind --generate`
imports `generatePhrase`/`parseWordList` from the barrel, and the first cut also took out
`CEREMONY_REFUSE`, `CeremonyError` and `readPhraseFromDescriptor`, which the CLI needs. **Move
`--generate` onto `generateAcrosticPhrase` first**, then delete — one commit, one court.

**Steps 5 and 8 are not started. Step 7 landed in the same round — see §27.**

## 27. Round 15 — T LANDED (`a91637c6`) and STEP 7 LANDED (`dcca3b3f`); the hang was the court's

**The §26 diagnosis was wrong, and this section replaces it.** I said the five-minute hang was a defect
in step 3b. It was not. It was in the court I had just written.

### 27.1 The hang: `spawnSync` against a server in the same process

`spawnSync` BLOCKS THE PARENT'S EVENT LOOP. The T court served the socket in its own process and then
ran the shipped command with `spawnSync` — so the process that had to `accept()` the connection was
parked inside `spawnSync` and never ran its socket callbacks. The command waited out its own
`OPERATOR_SIGNER_TIMEOUT_MS = 310_000`, the court's 30-second timeout killed it, and the report read
`exit null`. **The command was healthy the whole time.** Reproduced in `.scratch/aumlok-t/`: the same
served socket, the same command, the same arguments — `spawnSync` → `REFUSED: aumlok:channel-timeout /
no reply within 8000ms` in 8043 ms; async `spawn` → the real refusal in **55 ms**.

**RULES FOR ANY COURT THAT SERVES AND DIALS FROM ONE PROCESS, written here because the next person will
otherwise rediscover this the same way:**
1. `spawn`, never `spawnSync`, for the child that dials.
2. Bound every child with its own kill timer and assert the elapsed time, so a future hang fails an ARM
   in seconds instead of stalling the suite for the length of the command's own timeout.
3. `execSync`/`spawnSync` are still fine for children that dial a socket in ANOTHER process — which is
   why `tests/aukora-aumlok-approve.test.mjs` has been correct all along with `spawnSync` against a real
   `scripts/aumlok/signer.mjs` child.

### 27.2 What writing the court first DID find: the shipped command told a person the wrong sentence

**This is the defect §26 was reaching for, and it was real.** Two modules read a refusal off the wire:
`signer-channel.mjs` (the broker a library caller drives) and `operation-approval.mjs` (what the SHIPPED
`scripts/aumlok/approve-operation` actually runs). The first passed `aumlok:locked` and
`aumlok:never-unlocked` through by name; the second collapsed both into `aumlok:approval-refused`. So
over one socket, from one signer, the lane's own court was green about a property the command did not
have, and the string an operator read was:

    REFUSED: aumlok:approval-refused / the signer refused with aumlok:never-unlocked

about a machine that had simply not been unlocked. "The owner declined" and "your own machine needs
unlocking" are different sentences and only one of them was true. The lock names now have ONE definition
— `isLockRefusal` in `unlock.mjs`, beside the names themselves, a PREDICATE rather than an exported
`Set` because a `Set` handed to callers can be `.add`ed to, which is a fail-open door in the one check
that must not open — and BOTH readers ask it. `APPROVAL_PATH_REFUSE` also exports `LOCKED` and
`NEVER_UNLOCKED` so a caller can compare without reaching into another module for the string.

### 27.3 T, as landed

- `apps/aukora-desktop/aumlok-signer.mjs` — `resolveSignerSocketPath` returns
  `{socketPath: join(stateRoot, 'aumlok-signer.sock'), source: 'userData-default'}` when nothing is
  exported; an export still wins, and with NO state root it still returns `null` rather than inventing a
  `/tmp` path. **It also makes the containing directory before binding**, which §26 did not anticipate:
  the first bind under a fresh `userData` failed `EACCES` and the shell reported "not serving" — the same
  silence the default exists to end, arrived at from the other side. `DEFAULT_SIGNER_SOCKET_NAME` is
  exported so courts do not spell the filename themselves.
- `apps/aukora-desktop/main.mjs` — the path is resolved ONCE, before the backend child exists, and placed
  in that child's environment through `eyeEnv` (`signerSocket === null ? eye.env : {...eye.env,
  [SIGNER_SOCKET_ENV]: signerSocket.socketPath}`). The signer-start block reads the SAME resolved value
  instead of re-resolving it, so there is one string and two readers. **This is the file the eye lane
  shares; the change is confined to that one argument and to reading the hoisted value.**
- `scripts/aumlok/approve-operation` — `--signer-socket` defaults from `AUKORA_SIGNER_SOCKET`, the flag
  still wins, and with neither present the usage message NAMES the variable instead of only reporting a
  missing flag.

### 27.4 The court, and its red arm

`tests/aukora-aumlok-socket-default.test.mjs`, **15 arms**, added to CI. **Red first at HEAD: 10 of 15
failed**, including "with no flag the command runs at all rather than refusing its own argv" (it exited 2
on its own usage) and both lock-name arms. It drives the SHIPPED command as a child process with the
variable set and no flag, once against a cold session and once against a window that OPENED and CLOSED —
and it keeps the arm that proves the two sentences are distinguishable: a path with nothing on it must
still answer `aumlok:channel-unavailable`. Section 5 asserts both verifiers ask the shared predicate, so
a third hand-written copy of the pair cannot appear.

**ONE DOCUMENTED PROPERTY WAS REPLACED, DELIBERATELY.** `tests/aukora-aumlok-shell-signer.test.mjs` used
to assert that with nothing exported the shell resolved NO path and served nothing. That was the old
reasoning — inventing a path would let the two sides disagree silently — and it was wrong about which
silence is worse, because "nothing exported" was the ORDINARY case: nothing in this repository ever set
the variable. The court is rewritten to the plan's instruction and its header says why. **If Fable's plan
ever wants the old behaviour back, this is the arm that records what changed and when.**

### 27.5 Step 7, as landed

Fourteen Aumlok suites registered in `b1.yml`'s `keyless-courts`, one line each, plus the four already
there = eighteen Aumlok runs in the cheap required job. Every one was verified importable from a clean
clone with no install and no network by extracting every non-relative specifier from each file — their
only imports are `node:` and files in this tree, and the ML-DSA-65 generator is VENDORED AND TRACKED under
`plugins/aukora-aumlok/lib/vendor/noble-ml-dsa/`. The fourteen lines run in **27 seconds** locally against
a 30-minute job.

TWO COURTS ARE DELIBERATELY NOT REGISTERED, and the workflow comment names them where the next person
reads: `ceremony-electron` needs `apps/aukora-desktop/node_modules/.bin/electron`, which that job never
installs, and it REFUSES rather than skips when Electron is absent — right for the court, wrong to hand a
job that cannot satisfy it; `mount` stays in `keyless-build` because it needs the built `vendor/dsh` tree.

### 27.6 What is left, exactly

1. **Step 5 — real v2 rotation.** Still `aumlok:succession-v2-not-implemented`
   (`SUCCESSION_REFUSE.V2_NOT_IMPLEMENTED`), replaced by nothing. This is the largest remaining piece and
   it is crypto: new root, new wraps, epoch+1, proof signed by the OLD key, old approvals still verify.
   **Write the court first, and check what `lib/succession.mjs` already does before writing any new
   signing** — §1 records that `succession.mjs` was verified good and reusable.
2. **EFF removal, still promised and still not done.** `lib/eff_large_wordlist.txt` and the functions
   reading it are STILL PRESENT. It is a DEPENDENCY removal: `scripts/aumlok/bind --generate` imports
   `generatePhrase`/`parseWordList` from the barrel. **Move `--generate` onto `generateAcrosticPhrase`
   first, then delete — one commit, one court.**
3. **Step 8 — `npm run dist`** at the final commit, sha256 and commit recorded here.
   `apps/aukora-desktop/dist/mac-arm64/AUKORA.app` from `c462ee55` remains the newest artifact and is
   stale for every step-2, step-3, step-4 and T commit. **Do not install it.**
4. **Step 6 — retire `state/controller` and repoint the Kira overlay — happens on the FIRST REAL
   BINDING, not before.**

**AND NOTHING HERE HAS BEEN THROUGH ELECTRON AS A PERSON.** Twenty Aumlok suits are green, eighteen of
them now run in CI, and T's court drives the real command against a real socket — but no window has been
opened for a person, no phrase has been typed by a human hand, and no binding has happened. ATTENDANCE
stays `reported-not-proven`, `IDENTITY_BOUND` stays false, `OWNER_KEY_SAME_UID` stands. **Peter's click is
the acceptance and no court substitutes for it.**

## 28. Round 2 of the standing goal — STEP 5 LANDED: a v2 root rotates, and the old key signs it

**`SUCCESSION_REFUSE.V2_NOT_IMPLEMENTED` IS GONE.** It is replaced by a real ceremony,
`succeedOwnerRecord` in the new `plugins/aukora-aumlok/lib/succession-v2.mjs`, with
`tests/aukora-aumlok-succession-v2.test.mjs` (21 arms, **RED first at 18 of 20** on the court as first
written). All twenty Aumlok courts are green and the new one is registered in `b1.yml`'s keyless-courts.

### 28.1 What was actually missing, and why v1's machinery could not be reused

`succeedOwnerFromPhrase` (v1) rotates by taking a **NEW phrase** and deriving a new key from it, because
a v1 record kept its private half in the clear and the phrase WAS the key. A v2 record keeps a public
ROOT and two WRAPS, and the phrase derives nothing — it OPENS a wrap. So a v2 rotation starts from the
factors the owner already holds:

1. `phrase` + `deviceSecret` open the everyday wrap of the CURRENT record. The opened seeds are
   re-derived into public keys and **must equal the record's registered keys**, or nothing proceeds.
2. the phrase is described (a rotation may not seal a new root under a phrase this lane would refuse),
3. a NEW root is minted at full strength and its ML-DSA-65 pair acquired BEFORE anything is written,
4. `aumlokRootId(next) === predecessor rootId` refuses `aumlok:succession-key-unchanged`,
5. the authorization is signed by the predecessor **with both halves**, over
   `utf8(domain) ‖ 0x00 ‖ canonicalJSON(authorization)` — the lane's existing convention, mirrored from
   `rootControlAuthorizationBytes`,
6. the transition is VERIFIED with the same verifier a stranger uses, and only then is the proof written
   (then the record), so a record whose proof failed to write cannot exist.

### 28.2 The record gained a real epoch, and that is a shape change

`epoch` is now a closed field of the v2 record (six fields, not five), `buildOwnerRecord` takes it
(default 0), `parseOwnerRecord` refuses anything that is not a non-negative safe integer, and
**`ownerRecordProjection` reads it instead of hardcoding 0** — a projection that reported 0 for a
rotated record would make a second-generation owner look like a first-generation one to every consumer.
This is safe to do now and would not be later: **nothing is bound**, so no v2 record exists outside a
court. **A NEW ROOT IS A NEW SUBJECT** (`subject = aukora:1:<rootId>`), which is a cross-lane fact
asserted by the court rather than discovered: the Kira overlay pins `memoryOwner.subject` and step 6 is
where it is repointed.

### 28.3 What a stranger can and cannot check

`verifyOwnerSuccessionAsStranger({proofPath})` reads ONE file and needs no controller directory: the
proof carries the predecessor's rootId, epoch, integrity and **both public keys**, which is what keeps an
old approval checkable — a receipt is verified under the key that signed it, and the predecessor keys
travel with the proof rather than being rewritten anywhere. It establishes that the transition was
authorized by whoever held the predecessor root; it does NOT establish that the predecessor root was
ever this owner's, which is a question about the record and is the caller's to check.

### 28.4 Two things the first cut got wrong, both worth remembering

- **A tamper arm that tampers with nothing.** The first version of the "edited successor is refused" arm
  edited `proof.nextPublicKeys` — a field that does not exist, because the signed payload is
  `proof.authorization`. The edit changed no signed byte, the proof verified honestly, and the arm
  reported a verifier defect for a tamper nobody had made. The arms now go through a `tamperedProof`
  helper that **asserts its own tamper changed the preimage** before the verifier is called.
- **A refusal code that lives in the message.** `openWrap` throws
  `Error('aumlok:the-factors-did-not-open-this-custody-record')` with no `.code`, so a predicate reading
  `error.code` matches nothing and `assert.rejects` reports its own failure using whatever message the
  arm passed — which read, at first, like a wrong phrase had been ACCEPTED. It had not: probed every
  factor combination directly, all four behave correctly. The court now matches code-or-message.

### 28.5 What is NOT wired, and is the next item

**The ceremony window's succession mode is still the v1 shape**: it asks for a NEW PHRASE and calls the
bridge's SUBMIT in `mode: 'succession'`, which refuses a v2 record by name
(`aumlok:succession-v2-use-owner-record-ceremony` — the rename is asserted by two arms in
`tests/aukora-aumlok-ceremony.test.mjs`). Wiring that path to `succeedOwnerRecord` needs the page to
collect the CURRENT phrase and the machine factor (which lives in main) and to show the NEW recovery
factor once. It is filed as its own item in `.agents/live/rounds/AUMLOK.md` rather than counted as done.

**AND THIS IS NOT A PHRASE CHANGE.** Because the phrase only unlocks, changing the phrase is a RE-WRAP of
the same root — same rootId, same subject, same epoch — which is a different, cheaper operation and is
NOT built here. A rotation is for a root that must stop being used. **If Peter's "change my phrase later"
means the cheap rewrap, that is a separate item and the plan should say so.**

## 29. Round 3 — the WIRE item is BLOCKED ON A DECISION, and the reason is a false comment in the donor

**The ceremony window's `change` mode cannot be wired yet, and the blocker is not a lane.** The page
already has a `change` mode whose copy promises *"A new phrase for the SAME root. Your identity does not
change and old approvals still verify."* Wiring it needs to know which of two operations "change my
phrase" means, and **the two are not interchangeable**:

| | what it does | needs | identity |
|---|---|---|---|
| **(A) re-seal the wraps** | same root, same epoch, same subject; both wraps re-keyed to the new phrase | current phrase + the machine factor + **the printed factor** | unchanged |
| **(B) rotate the root** (`succeedOwnerRecord`, landed in §28) | new root, new wraps, epoch+1, new subject | current phrase + the machine factor | **moves** |

**WHY (A) NEEDS THE PRINTED FACTOR, WHICH NOBODY WOULD GUESS.** `custody.mjs`'s own comment said the
recovery wrap's phrase leg "uses a fixed public domain marker", which would make the printed factor
phrase-INDEPENDENT and (A) a two-factor operation. **That sentence is false.** MEASURED 2026-09-22 by
opening a real recovery wrap with the owner's phrase and then with a different valid phrase: the first
opens, the second refuses. `wrapOwnerSeeds` calls `phraseLeg(input.phrase, salt)` unconditionally, and
`purpose` separates the two wraps only in the HKDF **info** string — so the recovery wrap is phrase +
the printed factor, exactly like the everyday wrap is phrase + the machine factor.

**AND IT IS FALSE IN THE DONOR TOO, SO THIS IS NOT PORT DRIFT.** `~/AUKORA-MEMBRANE/core/aumlok-custody.ts`
@ `d8b17fa` carries the same sentence at line 154 and the same `phraseLeg(input.phrase, salt)` in its
`wrapOwnerSeeds`. The port copied a claim phi/Membrane does not implement either. The comment is now
corrected in `custody.mjs` and the property is PINNED by an arm in `tests/aukora-aumlok-custody.test.mjs`
("the RECOVERY wrap is ALSO phrase-bound, so the printed factor alone does not open it"), because the sentence
survived this long precisely by being untested.

**WHY IT MATTERS RATHER THAN BEING A TYPO.** Changing the phrase WITHOUT re-sealing the recovery wrap
silently destroys the recovery path: the printed factor stops working, and its owner finds out in the
emergency it exists for. So (A) must re-seal both wraps, and re-sealing the recovery wrap needs the
printed factor — which is shown once at binding and **never stored**, so the window must ask for it.

**THE QUESTION, ANSWERED IN ONE LINE BY ANYONE WHO KNOWS THE INTENT.** Does "change my phrase" ask the
owner for their printed factor on a routine phrase change (A), or does it rotate the root and issue a
NEW printed factor, accepting that the identity/subject moves and the Kira overlay must follow (B)?
**If (A)**, the
next round adds `rewrapOwnerRecord` + a third field in the window and the page's copy stays true. **If
(B)**, the page's copy must be rewritten to say the identity changes. **If C is wanted** — make the donor's
description TRUE by giving the recovery leg a fixed public marker — that is a CUSTODY change, not a port,
and it should be taken deliberately rather than as a side effect of a window.

**NOTHING IN THE WINDOW WAS CHANGED THIS ROUND.** The `WIRE` item stays unchecked with the blocker
written into `.agents/live/rounds/AUMLOK.md`; the next round takes the EFF removal, which is unblocked.

## 30. Round 4 — THE WINDOW COULD NOT BIND ANYONE, and the Electron court was green about it

**Found while starting the EFF removal, and fixed before anything else. This is the defect that would
have met Peter at his click.**

### 30.1 What was wrong

The ceremony window displays the seven tokens **dash-joined** (`phrase.join('-')`) and its constant-time
comparison canonicalises what a person types with `replace(/[\s_-]+/gu, '-')` — so spaces, dashes and
underscores are all "the same phrase" to the window. The plugin's `normalisePhrase` collapsed whitespace
to a **space** and `describePhrase` split on `' '`. So the string the window had just drawn normalised to
**one word** and was refused:

    REFUSED: aumlok:bind-phrase-too-short — 1 word(s); this lane derives from at least 6

MEASURED directly: `bindOwnerFromPhrase({phrase: 'corals-cliff-oasis-ring-amity-light-summit'})` refuses;
the space-joined form binds. **Every binding through the window failed**, and the refusal named a
phrase-length rule, so a person would read it as their own typing.

Two implementations of one rule — the window's separator and the plugin's — and they disagreed. The
window was written in step 4b to the plan's dash-joined form; the plugin's normaliser is EFF-era, when
phrases were space-joined and printed that way.

### 30.2 Why fourteen green arms did not notice

**The harness has always typed the displayed phrase back and submitted it.** The court recorded
`observations.submit` — `{ok, reason, detail}` — and then only ever asserted that the reply carried no
phrase bytes. It never asserted the reply was a SUCCESS, so `ok: false` with a refusal reason sat inside
a passing court for a whole step.

The arm is now there and it is the sharpest one in the file:

    arm('THE SUBMISSION SUCCEEDED — the string the window displays is one the ceremony ACCEPTS')

**An observation that is recorded but never asserted is a court that reports green for having checked
nothing.** This is the third time in this lane that the defect was in the COURT rather than the code, and
the first time it was in a court that had already been counted as 4b's acceptance evidence.

### 30.3 The fix, and why the plugin is the side that moved

`normalisePhrase` now folds `[\s_-]+` to a single space, lowercases and trims — the same set the window
folds. Dash-joined is the form the plan calls canonical and the form the window shows, so the plugin had
to accept it. No themed word contains a hyphen (checked: the only `-` in `ceremony-phrase.mjs` is the
`join('-')` itself), so folding cannot split a token. `deriveOwnerKey` uses the same normaliser, so
`corals-cliff-…` and `corals cliff …` now derive the **same** key — previously they were two keys, which
is the deeper half of this bug: the window told a person two strings were one phrase while the plugin
stored them as two.

Court: **3 new arms in `tests/aukora-aumlok-phrase.test.mjs`** (26/26, RED first at 2/26) pinning the
generator's dash-joined output, that the displayed form describes identically to its space-joined twin,
and that every separator the WINDOW folds behaves the same in the plugin. Plus the new Electron arm
(15/15). All twenty Aumlok courts green.

### 30.4 What this means for the artifact Peter installs

**Item 8 (`npm run dist`) was about to ship a window that could not bind.** It must be built AFTER the
remaining code change (the EFF removal), or the artifact will be stale for it — so the order in
`.agents/live/rounds/AUMLOK.md` is EFF first, then 8. **Until the dist is rebuilt, the installed app is
still the one from `c462ee55` and does not carry ANY of steps 2–5, T, or this fix.**

## 31. Round 5 — THE EFF LIST IS GONE, and it was a dependency removal after all

**Both copies of `eff_large_wordlist.txt` are deleted, every function that read them is deleted, and
`scripts/aumlok/bind --generate` now prints a true acrostic drawn from the themed tables.** All twenty
Aumlok courts are green; the two courts that pinned the list were REWRITTEN rather than trimmed, and
both went red first (`tests/aukora-aumlok-bind.test.mjs` 2 of 29, `tests/aukora-aumlok-ceremony.test.mjs`
section 6).

### 31.1 What went

| removed | where |
|---|---|
| `eff_large_wordlist.txt` (both copies) | `plugins/aukora-aumlok/lib/`, `scripts/aumlok/` |
| `parseWordList`, `readBundledWordList`, `generatePhrase` | `lib/ceremony.mjs` |
| `EFF_WORDLIST_SHA256`, `EFF_WORDLIST_SIZE`, `GENERATED_PHRASE_WORDS`, `CEREMONY_REFUSE.WORDLIST_*` | `lib/ceremony.mjs`, barrel |
| the EFF Long Wordlist attribution, licence and digest | `scripts/aumlok/README.md` |

`createHash`, `readFileSync` and `randomInt` were used in `ceremony.mjs` ONLY by that block, so its
imports shrank to `{ randomBytes }` and one shorter `node:fs` list. Nothing else in the tree read any of
it — checked repo-wide, excluding `vendor/`.

### 31.2 The arm that had to be INVERTED, which is why this was never a file deletion

`tests/aukora-aumlok-bind.test.mjs` used to copy the CLI into a sandbox **without** a word list and
assert it **refused**, then copy the list in and assert success. That arm cannot survive the deletion of
the list, and it should not: it is replaced by its inverse —

    arm('THE DEPENDENCY IS GONE: generation works in a sandbox holding NO word list at all')

— which builds a byte-identical sandbox, asserts no list is present, and requires generation to
**succeed**. That is the whole difference between deleting a file and removing a dependency, and it is
why the earlier promise ("move `--generate` onto `generateAcrosticPhrase` FIRST") was right.

### 31.3 The absence arms have to be able to fail

Section 6 of the ceremony court now claims an ABSENCE, and an absence arm passes trivially if the path is
misspelled. So it asserts three things, not one: neither file exists; none of the six names is exported
by the barrel; and **no `.mjs` in `lib/` mentions `eff_large_wordlist` at all** — because a path left
behind in a comment or a fallback is exactly how a deleted dependency comes back, with the next reader
following it to a file that is not there.

### 31.4 One mislabelled refusal fixed on the way

`rngBytes` — the ceremony's own injected-rng guard, used by `bindOwnerFromPhrase` — threw
`aumlok:ceremony-wordlist-unreadable` when a caller's rng returned the wrong length. That is a refusal
about a **file**, for a fault in a **function**, in a module that no longer reads a word list at all. It
now throws `aumlok:ceremony-rng-malformed`. A refusal that names the wrong noun sends its reader to the
wrong place, which is the same class of defect as a comment that describes a design the code does not
implement (§29).

### 31.5 What is left

**Item 8 (`npm run dist`) is now the next unblocked item**, and it must be built at THIS commit or later:
it carries steps 2–5, T, the separator fix (§30) and this removal. Until it runs, the installed app is
still `c462ee55` and carries none of them. `WIRE` and `PHRASE-REWRAP` remain parked on the (A)/(B)
decision in §29, which is the only thing in this lane waiting on a person.

## 32. Round 6 — STEP 8: the artifact is built, and the manifest it was built from could not start

> **THE HASHES IN THIS SECTION ARE SUPERSEDED — SEE §36, AND THEN §43.** Six packed files changed after this build
> (five in 5b, one in 5b-ii), so the asar `59bdbe84…` and manifest `fb29f019…` below describe a bundle
> that no longer matches the tree and must not be installed. §32 remains the record of the BLOCKER it
> found and of how an artifact is verified; §36 is the current artifact.

### 32.1 The blocker, found by looking at the artifact instead of only hashing it

`apps/aukora-desktop/package.json`'s `build.files` is the list `electron-builder` packs, and it was
written by hand. `main.mjs` statically imports **seven** modules from its own directory. The list named
**five**. The two it omitted were:

| omitted | why it exists |
|---|---|
| `aumlok-signer.mjs` | this lane's — the shell's signer, added when the shell began serving the approval socket (step 3b/T) |
| `eye.mjs` | the eye lane's door |

**A static `import` of a file that is not in the bundle is not a degraded feature; it is a module
resolution failure, and the app does not start.** MEASURED on the artifact that was on disk:

    $ asar list dist/mac-arm64/AUKORA.app/Contents/Resources/app.asar | grep -c 'aumlok-signer.mjs'
    0

So the shipped `c462ee55` app **could not start**, and every rebuild would have reproduced it, because
nothing checked the closure. Court first: `tests/aukora-aumlok-desktop-package.test.mjs` extracts every
local static import from `main.mjs` and requires each to be named in `build.files` — **RED first at 2 of
5 arms**, naming exactly `eye.mjs` and `aumlok-signer.mjs`. Registered in `b1.yml`'s keyless courts.

It is an EXACT-MEMBERSHIP check rather than a glob matcher on purpose: the rules contain one glob
(`icons/**`), and a court that re-implemented glob semantics would be asserting its own idea of what
`electron-builder` packs — a matching bug there turns this court green while the artifact is broken,
which is the failure mode it exists to prevent. The list is the packing rule; this court is the closure.

### 32.2 THE ARTIFACT RECORD

    commit           this commit (every packed .mjs/.cjs/.html is byte-identical to this tree — see below;
                     package.json is not comparable, and why is stated there)
    built by         cd apps/aukora-desktop && npm run dist      (electron-builder 26.15.3, --mac dir)
    app.asar sha256  59bdbe84c5c8004c4991e96bca9a87bad60c3e46968fd04aec2d39e858d50e07
    bundle manifest  fb29f0191c4887fd69b3f39813da99bc93c86520e438be3fd3a55cdd746a4b62
                     (find AUKORA.app -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256)
    executable       dist/mac-arm64/AUKORA.app/Contents/MacOS/AUKORA
                     52591945c62a357a093d45bab2a13ef95636e5e16c40ea960e428123ce58365e
    app.asar         1330377 bytes; bundle 289M; unsigned (identity: null), as every previous build

**What the artifact CONTAINS, verified rather than assumed:** all eleven of the app's own files —
including `aumlok-signer.mjs` and `eye.mjs` — and the 4b ceremony page. **What it does NOT contain:**
`eff_large_wordlist.txt` (the removal in §31 is in the artifact, not only in the tree).

**The packed bytes were compared to the source, not assumed:** `main.mjs`, `aumlok-signer.mjs`,
`eye.mjs`, `aumlok-ceremony.html` and `aumlok-bridge.mjs` were extracted from the asar and `cmp`-ed
against the working tree — all five IDENTICAL. And the artifact's whole local import graph was walked
from `main.mjs` (8 modules reachable, `MISSING: none`), so the bundle cannot fail to start for a missing
local module.

**`package.json` IS THE ONE FILE THAT CANNOT BE COMPARED, AND SAYING SO MATTERS MORE THAN A CLEAN
SENTENCE.** `electron-builder` REWRITES it while packing: the copy inside the asar carries six fields
(`name`, `productName`, `version`, `private`, `type`, `main`) and drops `scripts`, `devDependencies` and
the whole `build` block. So the packed manifest differs from this one deliberately, and a reader who
`cmp`-ed it would find a difference that means nothing. What matters is that the `files` list WHICH
DECIDED WHAT WENT IN is this commit's, and that is what §32.1's court now enforces and what the eleven
packed files above attest to. **The bundle does not contain `tests/`, CI or this handoff, so a later docs-only commit
does not change the artifact** — the hashes above name this commit's packed files.

### 32.3 What is NOT done, and is not this lane's to do

**NOBODY HAS INSTALLED IT AND NOBODY HAS BOUND.** The app was not launched; the check above is static,
over the built bytes, with no window and no side effect. **Fable installs; Peter binds.** Until Peter's
click, `ATTENDANCE` stays `reported-not-proven`, `IDENTITY_BOUND` stays false and `OWNER_KEY_SAME_UID`
stands. Step 6 (retire `state/controller`, repoint the Kira overlay) happens on that first real
binding and not before.

**AND THE SEPARATOR FIX IS IN THIS ARTIFACT (§30), WHICH MATTERS:** without it the window refused the
phrase it had just drawn, so this would have been a bundle that installs and then cannot bind. The
`c462ee55` app on disk carries none of steps 2–5, T, §30 or §31 and must be overwritten rather than run.

`WIRE` and `PHRASE-REWRAP` remain parked on the (A)/(B) decision in §29 — the only thing in this lane
waiting on a person.

## 33. Round 7 — the attended approval path can say YES (5a of the review wiring)

**What was wrong, in one line:** `apps/aukora-desktop/aumlok-signer.mjs` served the socket with
`review: () => ({ approve: false })` — a hardcoded decline whose own comment said step 4 would replace it.
So an unlocked session still refused every approval, and the attended path that
`scripts/aukora/approve-operation` waits **310 seconds** for had nothing that could ever answer yes.

### 33.1 The structural fact that made this more than a callback

`createOwnerSigner.approve` is **synchronous** and called the reviewer inline, because every reviewer this
lane shipped already knew its answer. A reviewer that asks a **person** cannot answer synchronously — the
answer arrives from a window, later — and a synchronous reviewer that "waited" would block the very event
loop that delivers the answer. So the decision path had to become awaitable:

- `owner-signer.mjs` gains **`approveAsync`**, sharing `precheck`, the refusal mapping and the signing step
  with the sync `approve` so there is ONE decision implementation, not two.
- `unlock-server.mjs` **awaits** it, with `deciding` set BEFORE the await so a second chunk cannot start a
  second decision for one connection. (One line in, one line out is the protocol; a protocol is not a
  promise about bytes.)
- `approve` is KEPT for reviewers that already know, and **refuses by name** (`signer:ask-requires-await`)
  when handed one that returns a promise — a synchronous caller must not read "no answer yet" as consent.

### 33.2 The four things that must not soften

1. **A default approve is impossible.** No reviewer → `no-reviewer`; a reviewer that throws →
   `ask-unavailable` (NEW, because "nobody was asked" and "the person said no" are different sentences);
   a reviewer that never answers → the request's own expiry.
2. **The wait is bounded by the REQUEST'S `expiresAt`, not a new knob.** After that instant the request is
   expired anyway, so waiting longer can only mint a signature for a closed window. The clock is POLLED
   rather than turned into a duration, because this lane injects its clock and a duration computed from an
   injected clock measures nothing.
3. **The refusal set a reviewer may choose from is CLOSED** (`declined`, `ask-unavailable`). An open string
   would let a reviewer put `aumlok:locked` on the wire and blame the owner's own machine for its failure.
4. **The clock is read AGAIN after the await**, before signing: an awaited answer took time.

### 33.3 Two defects found and fixed inside this change

- **The oversized-line guard reported `aumlok:locked`.** A request line over
  `MAX_APPROVAL_LINE_BYTES` was answered "your own machine needs unlocking" — a refusal that sends the
  reader to unlock a machine that is already open. It is now `aumlok:approval-malformed`. Found while
  making that handler async.
- **I clobbered `owner-signer.mjs` with a bad slice.** Replacing the factory body with a
  `s.index(...)`-to-end slice took `createTestApprover`, `createTestDecliner` and
  `rawEd25519PublicKeyHex` with it — the module then failed to LOAD, and `succession.mjs` failed with it.
  Restored verbatim and checked by comparing the export count against `HEAD` (4 = 4). **The same mistake
  as the round-13 EFF cut: a slice to the end of a file is not a slice of the thing you are replacing.**

### 33.4 Court

`tests/aukora-aumlok-attended-approval.test.mjs`, **11 arms, RED first at 9 of 11**, registered in
`b1.yml`'s keyless courts. The centrepiece is over the WIRE: an unlocked served socket signs for an async
approver and the lane's own broker VERIFIES it — the first time that path can answer yes end to end. The
declining twin proves the same socket does not sign for a no.

**NO WINDOW IS OPENED AND NO PERSON IS ASKED.** The reviewer in every arm is a labelled test procedure
that answers on a timer: this proves the PATH can carry a person's answer, not that a person gave one.
ATTENDANCE stays `reported-not-proven`.

### 33.5 What is left (5b), and one fact about how this reaches a person

**5b is the window itself:** `startShellSigner` must pass an `ask` that opens the ceremony window in an
`approve` mode carrying the operation's exact facts, waits for the page's answer, and returns it; the page
needs that mode and a new IPC channel for the answer; `main.mjs` supplies the ask. The danger is a review
that approves by default, which is the one thing this lane refuses everywhere — and the shape of the
answer is already fixed by §33.2, so the window half only has to deliver a decision.

**AND THE PLUGIN IS NOT IN THE APP BUNDLE.** `apps/aukora-desktop/dist` packs only the eleven files in
`build.files` (verified by listing the asar); `plugins/aukora-aumlok/**` travels in a **RELEASE**, loaded
by `loadCeremonyLibrary(releaseDir)`. So this round's change reaches a person through a release, not
through the app bundle, and whoever installs must make sure the release they serve carries it. **§32's
artifact record is the SHELL and says nothing about the plugin's revision.**

## 34. Round 8 — 5b: the window is the reviewer, and an approval can reach a person

**The attended path is now wired end to end: the signer asks, the bridge puts ONE question in front of a
person, and the answer comes back as one bit.** Built on §33's awaitable decision path.

### 34.1 The bridge: one question at a time, bound by challenge

`aumlok-bridge.mjs` gained `ASK` and `ANSWER` channels and an `ask(request)` method. The design is the
binding:

- **ONE PENDING QUESTION**, and that IS the binding. Two windows would make "the person said yes"
  ambiguous about *which* operation, and an ambiguity in this direction is an approval for something
  nobody looked at. A second ask is refused `aumlok:ceremony-ask-already-open`.
- **THE ANSWER MUST NAME THE CHALLENGE.** The window is not trusted to be answering the current question;
  it is required to say which one. An answer naming another challenge is refused and leaves the question
  pending — the refused answer is not applied on the way to being refused.
- **ONLY AN EXPLICIT `true` APPROVES.** `{approve: 'yes'}`, `{approve: 1}`, `{}` and a missing field are
  all declined, because the failure this path exists to prevent is an approval nobody gave.
- **THE QUESTION SHOWS PUBLIC FACTS ONLY**: subject, operation digest, issued-at, expiry. The exact key
  set is asserted. **The operation CONTENT is deliberately not sent** — the digest is what the key signs,
  and putting a body of text in front of a person invites them to approve prose the digest does not cover.
- **NO TIMER LIVES IN THE BRIDGE.** The wait is bounded by the SIGNER, which polls the request's own
  `expiresAt`. A second bound here would be a second source of truth for when a request ends, and the two
  would disagree in exactly the case that matters — a person answering as the window closes.
- **A WINDOW THAT CLOSES UNANSWERED RELEASES THE SIGNER** rather than holding it, and `dispose()` does the
  same.

### 34.2 The signer: the mapping, in one place

`reviewFromAsk(library, ask)` in `aumlok-signer.mjs` is the ONLY place the two facts could be conflated:
`unavailable` becomes `ask-unavailable` and everything that is not an explicit yes becomes `declined`. An
`ask` that throws is `ask-unavailable`, not the owner declining. **With no `ask` the answer is always no**
— a shell that cannot ask a person cannot approve an operation, which is the honest state and never a
default yes. `main.mjs` passes `ask: request => aumlok.ask(request)` (one added argument).

### 34.3 The window, and a hazard the page edit removed

The page gained an `approve` mode that shows the digest, the subject and the window, with Approve and
Decline, and whose branch **returns before the drawing code** — so an approval window draws no phrase and
accepts none. **THIS WAS NOT COSMETIC:** `main.mjs` began passing `ask` in the same change, so a page
without an approve branch would have opened the BINDING window on an approval request — seven words, a
type-back box, and no way to answer. The static arm that pins "the approve branch does not call `render(`"
is what makes that impossible to reintroduce. The preload gained exactly two verbs (`ask`, `answer`), and
the application preload is asserted NOT to reach either.

### 34.4 Courts, and a discipline failure I am recording

`tests/aukora-aumlok-attended-approval.test.mjs` is now **22 arms**: 11 from §33, 7 driving the bridge's
real pending-question machinery through a fake Electron, and 4 pinning the page and preload.

**I IMPLEMENTED BEFORE WRITING THE COURT THIS ROUND**, which is the discipline this lane holds itself to
and had just failed at in §30. Recovered by stashing the three source files and running the new arms
against the old code: **5 of 5 signer arms and the bridge arms went RED** (`reviewFromAsk is not a
function`; `ask is not a function`; and over the wire, `aumlok:approval-refused` from the old hardcoded
decline). The red arm is therefore real, but it was observed after the fact and this note says so.

**THREE CLOSED-SET ARMS FIRED, EXACTLY AS DESIGNED**, and each was a decision rather than an accident:
the channel set grew 6 → 8, the enumerated channel names 6 → 8, and the ceremony preload's verb count
4 → 6. All three are named in their updated text.

**SECTION 6 IS SOURCE ARMS AND IS LABELLED AS SUCH.** They stop the wiring being removed silently; they do
NOT prove the page renders or that a click answers. The behavioural arm needs the Electron harness to open
an approve window with a pending question, and that is filed as **5b-ii** rather than implied here.

### 34.5 THE ARTIFACT FROM §32 IS NOW STALE

This round changed packed files — `aumlok-bridge.mjs`, `aumlok-ceremony.html`,
`aumlok-ceremony-preload.cjs`, `aumlok-signer.mjs`, `main.mjs` — so **§32's asar sha256
(`59bdbe84…`) and manifest (`fb29f019…`) name a shell that no longer matches the tree.** A re-dist is
required before anyone installs: it is filed in `.agents/live/rounds/AUMLOK.md`. §32's record is not
wrong about the artifact it measured; it is stale, and this is where that is said.

## 35. Round 9 — 5b-ii: the approval path is proven with a REAL CLICK inside Electron

**What §34 could only pin as source is now observed as behaviour.** The Electron harness opens an approve
window with a PENDING question, reads what the page rendered, clicks Approve the way a person would, and
the court judges the result. `tests/aukora-aumlok-ceremony-electron.test.mjs` is **21 arms** (was 15).

### 35.1 The six things the click proves

1. the window opened **ON THE APPROVAL STEP**, with a question to answer and an Approve control;
2. it shows the **operation digest** (byte-exact) and the subject — the digest is what the key signs;
3. **nothing about the phrase is reachable**: no words drawn, no anchor, no type-back box;
4. **the click answered the pending question** — `{approve: true}`, the person's bit, through the real
   IPC channel;
5. **the answer closed the window**, so a question does not outlive its answer;
6. **a question nobody answers is released when its window closes**, resolving `{approve: false}` — it
   neither approves nor holds the signer.

### 35.2 The arm that failed, and why the arm was wrong

The first cut of arm 3 asserted the type-back input was **absent from the DOM**. It failed — because the
page is ONE document whose steps are toggled, so the input is present on EVERY path. The arm was testing
the page's markup style, not the window's behaviour, and it would have failed identically on a correct
page. **The failure was the arm's fault, and it is recorded here rather than quietly re-scoped.**

Fixed in both directions, because there were two faults:

- **the arm** now measures **reachability** — `offsetParent !== null` — which is the claim that matters:
  what a person can reach;
- **the page** now takes the phrase steps OUT OF RENDERING on the approve path (`hidden = true` on
  `step-words` and `step-verify`), not merely inactive. A class toggle left the type-back input in the
  document, and "this window cannot show a phrase" is worth more as a fact about what is rendered than
  about which class is set.

### 35.3 State

All 22 Aumlok courts green. The attended path is now wired end to end and observed at both ends: §33's
awaited decision, §34's one-question binding, and this round's real click.

**NOBODY HAS STILL SEEN IT.** A hidden window driven by `executeJavaScript` is not a person looking at a
screen, and no court can assert that a human read the digest. `ATTENDANCE` stays
`reported-not-proven`, and Peter's click remains the acceptance.

**THE RE-DIST ITEM NOW CARRIES THIS ROUND TOO:** `aumlok-ceremony.html` changed again (the rendering
hardening above), so §32's artifact is stale by six packed files, not five. Nothing should be installed
until the rebuild is recorded.

## 36. Round 10 — RE-DIST: the artifact rebuilt, and the attended path is inside it

**The bundle is now built from the tree that carries steps 2–5, T, the separator fix (§30), the EFF
removal (§31), the attended approval path (§33, §34, §35) and the packaging fix (§32).**

### 36.1 THE ARTIFACT RECORD

    commit           816af286 — the commit that owns every packed file in this bundle
                     (HEAD moved twice during the build: six lanes share this branch, and the bundle
                      contains no file from any of them. The seven packed sources were compared
                      against `git show 816af286:apps/aukora-desktop/<file>`, not against a moving HEAD)
    built by         cd apps/aukora-desktop && npm run dist   (electron-builder 26.15.3, --mac dir)
    app.asar sha256  a16cad0bc18d814776d4d5733748859969f525daf1ec008a83bcf855913bc9ac
    bundle manifest  d1e8e5ed9a49810dd5102006e27c3887df8ad4d1e920d89b5991f90fc05044ad
                     (find AUKORA.app -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256)
    executable       52591945c62a357a093d45bab2a13ef95636e5e16c40ea960e428123ce58365e
                     (UNCHANGED from §32, which is a free confirmation that only app code moved)
    app.asar         1343790 bytes (was 1330377); bundle 291M (was 289M); unsigned, `identity: null`

### 36.2 What was verified on the BUILT BYTES

- **All eleven of the app's own files are present**, including `aumlok-signer.mjs` and `eye.mjs` — the
  two §32's manifest was missing.
- **`eff_large_wordlist.txt` is ABSENT**, so §31's removal is in the artifact rather than only in the tree.
- **Seven packed sources are byte-identical to `816af286`**: `main.mjs`, `aumlok-signer.mjs`, `eye.mjs`,
  `aumlok-bridge.mjs`, `aumlok-ceremony.html`, `aumlok-ceremony-preload.cjs`,
  `aumlok-bridge-preload.cjs`. (`package.json` is again the one file that cannot be compared — 
  electron-builder rewrites it; see §32.2.)
- **The local import graph closes**: eight modules reachable from `main.mjs`, `MISSING: none`.
- **THE ATTENDED PATH IS IN THIS BUNDLE, checked by searching the packed bytes**: the `ASK` and `ANSWER`
  channels appear in the bridge and the preload, the page carries `step-approve` and `ask-digest`, and
  `reviewFromAsk` is in the packed signer. A rebuild that had silently kept the old page would pass a
  hash check and fail this one, which is why it is here.
- the page's theme declaration is still `:root { color-scheme: light dark; }` with no hardcoded dark.

### 36.3 What is NOT in this bundle, and what is not done

**THE PLUGIN IS NOT IN IT.** `plugins/aukora-aumlok/**` travels in a **RELEASE**, loaded by
`loadCeremonyLibrary(releaseDir)` (§33.5) — so this bundle carries the shell, the window and the signer,
and a release must carry the matching plugin. **Whoever installs has to make sure of that**, and §32's
asar list is the evidence for what the bundle does and does not contain.

**NOBODY HAS INSTALLED IT AND NOBODY HAS BOUND.** *(The app has since been LAUNCHED, headless and with a
disposable userData — see 44, which also found that it serves a RELEASE that predates every fix in this
section's siblings.)* Every check above is
static, over the built bytes. **Fable installs; Peter binds.** Until Peter's click, `ATTENDANCE` stays
`reported-not-proven`, `IDENTITY_BOUND` stays false and `OWNER_KEY_SAME_UID` stands. Step 6 happens on
that first real binding and not before.

**`WIRE` and `PHRASE-REWRAP` remain parked on the (A)/(B) decision in §29** — the only two items in this
lane waiting on a person.

## 37. Round 11 — the unlock path refused the same phrase typed with spaces

**Found while every queued item was blocked on the §29 decision, and fixed before anyone binds — which is
the only window in which it could be fixed at all.**

### 37.1 The defect, measured

The ceremony window DISPLAYS and SUBMITS the seven tokens **dash-joined**, so an binding through the
window seals its wraps with a dash-joined phrase. `describePhrase` and `normalisePhrase` fold `[\s_-]`, so
the lane calls the dash-joined and space-joined forms **THE SAME PHRASE** — and the wrap's key derivation
(`phraseLeg` → scrypt) folded only **whitespace**. Measured:

    bind with  'corals-cliff-oasis-ring-amity-light-summit'   → record written
    unlock with 'corals cliff oasis ring amity light summit'   → aumlok:the-factors-did-not-open-this-custody-record
    and describePhrase says those two strings are the same phrase: true

So a person who bound by typing back what the window showed, and later typed the same seven words with
spaces, was told **their own phrase was wrong**. This is §30's defect one layer down: two places that must
agree about what "the same phrase" means, disagreeing.

### 37.2 The fix: one canonical form, in the module that owns the key

`custody.mjs` now exports **`canonicalPhrase`** — lowercase, trim, and runs of whitespace, dashes and
underscores collapsed to a single space — and `phraseLeg` uses it. **`binding.mjs`'s `normalisePhrase`
now DELEGATES to it** rather than keeping a second copy of the same expression, so there is one
implementation of the rule in the codebase, in the module whose job is the key.

### 37.3 Why this was safe, VERIFIED RATHER THAN ASSUMED

A change to a key derivation can lock an existing owner out, so the check came before the commit:

- **both `local-control.json` files on this host are v1 records with NO `wraps` field at all** —
  `~/Library/Application Support/AUKORA/state/controller/` and `~/.aukora/local-control-v1/`. v1 keeps its
  private half in the clear and never uses the phrase as a KDF input, so **no v2 wrap exists anywhere that
  this change could lock out**. That is what "nothing is bound" means in v2 terms, and it is now
  measured rather than quoted;
- **the change is inert for any phrase without a dash or an underscore** — for a phrase of single-spaced
  lowercase words the old and new rules are the same function, which is why the DONOR-PIN arms still
  reproduce the donor's ciphertext (32/32 green).

Had a v2 wrap existed, this change would have made it unopenable, and the honest answer would have been a
compatibility path or a re-binding — not a silent break. **After Peter binds, this class of fix is no
longer available**, which is why it is recorded as landing in the last safe round.

### 37.4 Courts

- `tests/aukora-aumlok-custody.test.mjs` — **3 new arms, RED FIRST at 3 of 32**: a dash-sealed wrap opens
  with the space form; the underscore form and the reverse direction too; and an **EQUIVALENCE arm** that
  states the property instead of listing separators — *if `normalisePhrase` says two forms are the same
  phrase, they must open each other's wraps* — over six forms including upper case, extra spaces and
  surrounding whitespace.
- `tests/aukora-aumlok-bind.test.mjs` — **a fourth arm for the person's exact sequence**: the phrase this
  CLI generates (dash-joined) is bound, and the record is opened with its space-joined twin. 30/30.
- **All 22 Aumlok courts green.**

### 37.5 What this does NOT change

**The dist artifact from §36 is unaffected** — this is plugin code, and the plugin is not in the app bundle
(§33.5). It travels in a **RELEASE**, so **whoever installs must make sure the release carries this fix**,
or the window will bind with dashes and the unlock will refuse spaces exactly as before.

**Nobody has bound.** `ATTENDANCE` stays `reported-not-proven`, `IDENTITY_BOUND` stays false,
`OWNER_KEY_SAME_UID` stands.

## 38. Round 12 — the unlock window could not be opened, and could not have opened anything

**Two independent defects on the one path that makes an binding usable, both measured, both fixed —
and this is the third time this lane has found a dead link in the same chain (§30 could not bind, §37
could not open the wrap, this could not unlock).**

### 38.1 Half one: the mode was not in the list

`openCeremony(mode)` refuses any mode not in `CEREMONY_MODES`, and **`'unlock'` was not in it** — while
the page has had an `unlock` mode since step 3b and the app offers the button. So the window never
existed: the OPEN channel answered `aumlok:ceremony-mode-unknown`, and no court had ever opened one.

### 38.2 Half two: nobody passed the session

The `UNLOCK` handler reads `deps.getUnlockSession`, and **NOTHING passed it** — not `main.mjs`, not any
court. So even a successfully opened window would have refused:

    { ok: false, reason: 'aumlok:unlock-session-absent',
      detail: 'this shell is not serving a signer, so there is no window to open' }

**THE CONSEQUENCE WAS TOTAL.** After Peter binds, the shell's signer serves its socket **LOCKED**, and
the unlock window is the only way to open it. Refused, every approval would have answered
`aumlok:locked` for as long as the shell ran, and **the attended path built in §33–§35 would have been
unreachable by a person** — with no court red about it, because no court drove the unlock window. §33's
courts unlock the session by CALLING `session.unlock()`, which is exactly the step a person cannot take
without this window.

### 38.3 The fixes

- `CEREMONY_MODES` now includes `'unlock'`, and the constant's comment records why it was missing.
- `aumlok-bridge.mjs` exports **`unlockSessionSource(getSigner)`** — a **SOURCE**, not a session: the
  signer is awaited AFTER the bridge is installed, so a value captured at install time would be null for
  the lifetime of the window, which is the same defect wearing a different hat. `null` when there is no
  signer or when the getter throws, and the handler still refuses by name.
- `main.mjs` passes `getUnlockSession: unlockSessionSource(() => shellSigner)`, with `shellSigner` HOISTED
  above the bridge install.
- **Custody refusals now carry `.code` as well as the message** (`custodyRefusal`). The unlock handler
  reports `error?.code ?? null`, and `openWrap` threw a bare `Error(FACTOR_REFUSAL)` whose name lived only
  in the message — so a WRONG PHRASE produced `reason: null`, and the window would have rendered
  "Refused: no reason was given" for a mistyped phrase. MEASURED by the court arm that expected
  `library.FACTOR_REFUSAL` and got `null`. (§29 recorded this same fault as a court-side workaround;
  fixing it at the source retires the workaround's reason for existing.)

### 38.4 Court

`tests/aukora-aumlok-attended-approval.test.mjs` — **4 new arms, RED FIRST** (`bridge.unlockSessionSource
is not a function`, then the mode refusal). They assert: the source returns the signer's session and null
when there is none; **UNLOCK with the owner's phrase OPENS the session and reports the 48-hour window**;
a wrong phrase refuses **content-free**, leaves the session shut and does not echo the phrase; and with no
source at all it refuses by name. Plus a SOURCE arm that `main.mjs` passes the source tied to
`shellSigner`. **All 22 Aumlok courts green.**

**A FIXTURE FAULT WORTH RECORDING:** the first cut of these arms used `getWindow: () => null`, so the OPEN
channel answered `FORBIDDEN_SENDER` and no window was created — the arms failed for a reason that had
nothing to do with the defect. The bridge compares the sender against the application window, so the
fixture now provides one.

### 38.5 THE LAST LINK IS STILL MISSING, and a person still cannot unlock

**`apps/aukora-desktop/aumlok-bridge-preload.cjs` exposes exactly `bind`, `changePhrase` and `state` —
there is no `unlock` verb — and the Aumlok face's ceremony action supports only the `bind` and
`changePhrase` intents.** So the bridge can now open the window and the window can now open the signing
session, but nothing on screen asks for it. That is filed as the next item, with its three parts named.

**AND THE RELEASE STILL MATTERS:** none of this is in the app bundle (the plugin and the bridge's
behaviour ride the release the shell serves), so whoever installs must make sure the release carries
these fixes. Nobody has bound: `ATTENDANCE` stays `reported-not-proven`, `IDENTITY_BOUND` false,
`OWNER_KEY_SAME_UID` stands.

## 39. Round 13 — the face's intent mapper, and THE AUMLOK SCREEN DOES NOT BUILD

### 39.1 What this round set out to do, and did

The face's ceremony path gained the third ceremony: `unlock()` on `AumlokCeremonyBridge`, `'unlock'` in
`AumlokCeremonyIntent`, the verb check now requiring **all three** verbs (a half-mounted bridge is not
exposed, which is the file's own doctrine), and — the part that mattered — **the mapper is no longer a
binary ternary.**

`openAumlokCeremony` mapped its intent with `intent === 'bind' ? bind() : changePhrase()`. Adding a
third ceremony to that expression would have made **"unlock" open the CHANGE-PHRASE window**: a person
asking to open signing would have been shown the window that rewrites their phrase, and nothing in the
code would have looked wrong. It is a closed `switch` now, and its `default` runs **no verb at all** and
refuses `aumlok:ceremony-intent-unknown`.

Court: `tests/aukora-face-aumlok-control.test.mjs`, **4 new arms, RED FIRST at 4/4**, now 13/13 —
including one that asserts an unknown intent calls NO verb.

**AND ONE OF THOSE ARMS FAILED AGAINST CORRECT CODE FIRST**, because it matched the explanatory comment
recording what the ternary *used to be*. It strips comments now. That is the third time in this lane a
text-level check has been fooled by prose (a rounds-file splice that ate an item, a guard keyed on a word
appearing elsewhere, and this): **a check about code must read code.**

### 39.2 THE FINDING THAT OUTRANKS THIS ROUND'S ITEM

**`scripts/build-face.py --only aumlok` FAILS. The Aumlok screen has not been buildable.**

    FACE FAILED aumlok: client
      AumlokMenu.tsx(8,16):   Type '"shell.menu.system"' does not satisfy the constraint
                              '"root" | "settings.trigger" | "settings.header" | ...'
      AumlokSurface.tsx(79,16): Type '"shell.surface"' does not satisfy the same constraint
      AumlokSurface.tsx(249,250): Property 'activeSurface' / 'closeSurface' does not exist on the props
      index.ts(7,21):         Cannot find module '@aukora/face-layout/client'

**PROVEN PRE-EXISTING, NOT CAUSED BY THIS ROUND:** stashing this round's change and rebuilding produces
the identical eleven errors.

**AND MOST OF THEM ARE AN ARTIFACT, WHICH IS THE USEFUL PART.** Building `layout` first
(`python3 scripts/build-face.py --only layout`) removes **ten of the eleven**: the slot-name and props
errors were TypeScript falling back to a wrong overload set because the sibling face's TYPES were absent.
What remains is one resolution failure inside the face build:

    Cannot find module '@aukora/face-layout/client'

`plugins/aukora-face/layout/package.json` declares `@aukora/face-layout` with `./client` in its `exports`,
and `plugins/aukora-face/layout/lib/client.js` now exists — so this is about how `scripts/build-face.py`'s
overlay makes a sibling face's package resolvable, not about the Aumlok face pointing at dead slot names.
**The next session should read that builder's overlay/link logic rather than migrating slot names**, which
the error list made look necessary and which is not.

Building `layout` wrote NOTHING into the tree (`git status` clean for that directory — the builder works in
`.runtime/face-build/`), and `--only` takes ONE face name: passing `layout,aumlok` asks for a face called
"layout,aumlok" and fails on a missing `tsconfig.json`.

### 39.3 What this means for the acceptance

**The committed `lib/` is a build from BEFORE the drift, so the screen a person sees is older code.** My
unlock plumbing (§38, and this round) is correct and courted, but **it cannot reach a person through the
face until the face builds** — and neither can any of §30's, §37's or §38's shell-side behaviour be
exercised from the screen. `tests/aukora-face-aumlok-control.test.mjs` passes 13/13 because it imports the
face's SOURCE modules directly; **a source-level court cannot see that the bundle does not compile**, and
nothing else was watching that either.

**Nobody has bound.** `ATTENDANCE` stays `reported-not-proven`, `IDENTITY_BOUND` false,
`OWNER_KEY_SAME_UID` stands — and the screen that would carry the binding cannot currently be built.

## 40. Round 14 — THE AUMLOK SCREEN BUILDS AGAIN, and the cause was one missing reference

**`python3 scripts/build-face.py --only aumlok --fresh` now reports `FACE BUILT aumlok`.** The committed
`lib/client.js` is regenerated from the current source, so the screen a person sees is no longer a
pre-drift build.

### 40.1 The cause, and why the error list pointed the wrong way

§39 reported eleven TypeScript errors and guessed at a slot-name migration. **The guess was wrong and the
error list was misleading.** The real cause is one line:

    src/client/index.ts imports '@aukora/face-layout/client'
    tsconfig.json        has NO reference to ../aukora-face-layout

`tsc -b` builds a referenced project's DECLARATIONS (`lib/types`) before typechecking the referrer, and
`@aukora/face-layout`'s `exports['./client'].types` is `./lib/types/client/index.d.ts` — a file that only
exists inside a build. With no reference, nothing built it, TS could not resolve the module, and **ten of
the eleven errors were downstream of that**: with the sibling's types absent, TypeScript fell back to a
wrong overload set and blamed slot names (`shell.surface`, `shell.menu.system`) and props
(`activeSurface`, `closeSurface`) that are perfectly fine. That is why building `layout` first appeared to
fix ten of them — it left the sibling's declarations in the overlay for the next run — and why the
remaining error was always the module resolution the whole thing started from.

**The lesson, stated because it will recur: a cascade of type errors in a project-referenced build can
all be ONE missing reference.** The first error is the only one to read.

### 40.2 The fix, and the arm that holds it

- `plugins/aukora-face/aumlok/tsconfig.json` gains `{ "path": "../aukora-face-layout" }`. The overlay's own
  naming rule is `packages/client/aukora-face-<name>`, which is why the face's package `@aukora/face-layout`
  maps to `../aukora-face-layout` while the ui kit's `@aukora/ui-layout` maps to `../ui-layout`.
- `tests/aukora-face-aumlok-control.test.mjs` gains a **closure arm**: every `@aukora/<pkg>` the face's
  sources import must have a project reference in its tsconfig. **RED FIRST at 14**, and it is the arm that
  would have caught this the day the import was added. It exists because **a source-level court cannot see
  a bundle that does not compile** — 13/13 arms passed for months against a face that could not be built.

**VERIFIED ON THE BUILT BUNDLE, not on the exit code:** `lib/client.js` contains
`aumlok:ceremony-intent-unknown`, `unlock` and `change-phrase`; the diff is +12/−3; all 22 Aumlok courts
green and the face court 14/14.

### 40.3 What this unblocks, and what is still missing

**The screen can be regenerated, so this lane's work since §30 can finally reach a person through it** —
subject to the RELEASE note (§33.5, §38.5): the shell's behaviour rides the release, and the face bundle
rides `plugins/aukora-face/aumlok/lib/`, which is committed here.

**The Unlock button is still not wired**: the surface has no third ceremony action and the face imports no
`signing` state. The bridge, the state and the intent all exist now, so that is the next piece of work and
it is mechanical. **RE-DIST is still outstanding** — §36's asar was stale before this round and nothing
here changed that.

**Nobody has bound.** `ATTENDANCE` stays `reported-not-proven`, `IDENTITY_BOUND` false,
`OWNER_KEY_SAME_UID` stands, and Peter's click remains the acceptance.

## 41. Round 15 — the face can read whether signing is shut, and fails closed when it cannot tell

**The prerequisite for the Unlock button, done properly rather than half-rendered.**

### 41.1 The reading

`AumlokSigningState` and `parseAumlokSigning` live in the face's `binding-bridge.ts`:

    { available, locked, reason, expiresAt, remainingMs, windowMs }

- **FAIL-CLOSED.** A reply this code does not recognise becomes `available: false` with its own reason
  `aumlok:signing-state-unreadable` — never a hopeful `locked: false`. The distinction matters in both
  directions: offering Unlock while signing is already open is a dead button, and **not** offering it
  while signing is shut is a person who cannot sign at all. A screen that guesses is worse than one that
  stays quiet.
- **`reason` IS QUOTED, NOT PARAPHRASED.** It is the session's own name for why it is shut —
  `aumlok:locked` after a window lapsed versus `aumlok:never-unlocked` before one opened — which is
  exactly the fact a screen cannot invent about someone's own machine.
- **THE FIELD SET IS CLOSED.** A reply that grows a field does not grow this face's vocabulary with it.
- The bridge interface gains `state()` and `readSigning()`, and a reply is only exposed when the bridge
  carries **all four** verbs. A screen that can open signing but cannot read whether it is shut cannot
  honestly offer the control.

### 41.2 Court

`tests/aukora-face-aumlok-control.test.mjs` is **18/18**, with four new arms: the closed shape (a reply
carrying an extra field does not carry it to the screen); **eight different unreadable replies all failing
closed**; the session's reason surviving intact; and `readSigning()` reading through to the shell.

**THE RED ARM WAS CRUDE AND THAT IS RECORDED:** with `--experimental-strip-types` a missing named export
is a **load-time** error in ESM, so the whole file failed rather than four arms — a red that names nothing.
**AND THREE OF MY OWN ARMS THEN FAILED** because they predated this round's stricter shape and the fourth
verb: they were updated, not worked around, and the strictness is deliberate (a partial reply is a reply
this face does not understand).

**Face bundle rebuilt and VERIFIED ON THE BUILT BYTES** (`signing-state-unreadable` and `readSigning` are
present in `lib/client.js`), all 22 Aumlok courts green.

### 41.3 What is left

**Rendering the button**, which is now mechanical: expose `readSigning` through `control-projection.ts`,
render the third action from it in `AumlokSurface.tsx` (offer Unlock when `available && locked`; say
signing is open for N hours otherwise) calling the existing `runCeremony('unlock')`, add the locale key,
rebuild. Then **RE-DIST**, which is still outstanding: §36's asar is stale by more files than when it was
filed.

**Nobody has bound.** `ATTENDANCE` stays `reported-not-proven`, `IDENTITY_BOUND` false,
`OWNER_KEY_SAME_UID` stands.

## 42. Round 16 — THE UNLOCK BUTTON, and the chain from a person's click to a signature is whole

**The screen now offers Unlock when signing is shut, and says so when it is open.** With §38 (the mode
and the session source), §41 (the reading) and this round (the rendering), the path is:

    a person clicks Unlock  →  runCeremony('unlock')  →  the bridge opens the unlock window in 'unlock'
    mode  →  the window takes the phrase  →  session.unlock(seeds)  →  STATE reports signing.locked:false
    →  the socket signs approvals instead of answering `aumlok:locked`

### 42.1 What was added

- `control-projection.ts`: `readSigning()`, delegating to the bridge and **failing closed** when there is
  no bridge (`parseAumlokSigning(undefined)` → "cannot tell" → no control offered).
- `index.ts`: the surface is injected with `readSigning`.
- `AumlokSurface.tsx`: `signing` is read on the same schedule as the surface becoming visible, and the
  third ceremony is rendered **on its own condition** — `signing.available && signing.locked` — rather
  than folded into the status branch that chooses between binding and succession. Binding and
  succession act on the PHRASE; this one only opens signing. When signing is open the screen says so
  (`data-aumlok-signing-open`), and while `signing === undefined` — nobody has asked yet — **nothing is
  offered**, because "I have not asked" is not "signing is open".
- `locales.ts`: `runtime.binding.unlock` and `runtime.signing.open`, in BOTH locales (the file's
  `satisfies Record<AumlokKey, string>` makes a partial addition a type error, which is why the pair was
  added twice rather than once).

### 42.2 The same trap as the mapper, one layer up — and the arm that caught it

`CeremonyAction` derived its button text with `intent === 'bind' ? bind : changePhrase`. A third
ceremony through that ternary would have been labelled **"Change phrase"**: a person asking to open
signing offered a button that says it will rewrite their phrase. It is a closed lookup now,
`CEREMONY_LABEL`, typed `satisfies Record<AumlokCeremonyIntent, AumlokKey>` so a fourth ceremony cannot be
added without a label. **The arm was written first and went RED at 19.**

### 42.3 What the BUILD caught that the court could not

The first cut added `parseAumlokSigning` and `AumlokSigningState` to a block that turned out to be a
**re-export**, not an import — so they were passed on rather than bound, and the class that calls the
parser could not see it. `FACE FAILED aumlok` reported `Cannot find name 'parseAumlokSigning'` and the
face was fixed before it shipped. **A source-level court checks what the source SAYS; the typechecker
checks whether it HOLDS TOGETHER** — §40's lesson in the other direction, and the reason the build step is
part of this lane's evidence rather than a formality.

Verified on the built bytes: `runtime.binding.unlock`, `runtime.signing.open`, `data-aumlok-signing-open`
and `readSigning` are all present in `lib/client.js`. **19/19 face arms, 22 Aumlok courts green.**

### 42.4 What is left

**RE-DIST**, which is now the only unblocked item: §36's asar has been stale since §38 and this round adds
another packed-file change to the pile (the face bundle rides `plugins/aukora-face/aumlok/lib/`, which is
NOT in the app bundle — the shell's `aumlok-bridge.mjs`, `aumlok-signer.mjs` and preloads are). One rebuild
should carry everything.

**AND THE RELEASE STILL MATTERS** (§33.5): the plugin rides the release the shell serves; the face bundle
and the shell ride the app. Whoever installs has to make sure both are current, or a person will see a
button whose machinery is older than it looks.

**Nobody has bound.** `ATTENDANCE` stays `reported-not-proven`, `IDENTITY_BOUND` false,
`OWNER_KEY_SAME_UID` stands, and Peter's click remains the acceptance.

## 43. Round 17 — RE-DIST: the shell rebuilt with the whole unlock chain inside it

**`apps/aukora-desktop/dist/mac-arm64/AUKORA.app` is rebuilt from the tree that carries §38's unlock
wiring, §41's reading and the attended path.**

### 43.1 THE ARTIFACT RECORD

    commit           a6dd2814 — the commit that owns every packed file in this bundle
    built by         cd apps/aukora-desktop && npm run dist     (electron-builder 26.15.3, --mac dir)
    app.asar sha256  e2f08832d8351bde18a1d2cfd6212a103325b37a3850c6878f9b217756f8ac95
    bundle manifest  5df61dffefdba7d64f9267586a9b0038b27fd15365ff377bacf6ffb8b92b913e
                     (find AUKORA.app -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256)
    executable       52591945c62a357a093d45bab2a13ef95636e5e16c40ea960e428123ce58365e
    app.asar         1348260 bytes (was 1343790 at §36); bundle 289M; unsigned, `identity: null`

**THE EXECUTABLE HASH HAS NOT MOVED ACROSS THREE BUILDS** — `52591945…` at §32, §36 and here. The Electron
runtime binary is the same every time; only `app.asar` changes. That is a free cross-check that these
builds differ in application code and nothing else.

### 43.2 Verified on the built bytes, not on the exit code

- **All eleven of the app's own files are present**, and **`eff_large_wordlist.txt` is absent** (§31).
- **All seven packed sources are byte-identical to `a6dd2814`**: `main.mjs`, `aumlok-signer.mjs`, `eye.mjs`,
  `aumlok-bridge.mjs`, `aumlok-ceremony.html`, `aumlok-ceremony-preload.cjs`, `aumlok-bridge-preload.cjs`.
- **The local import graph closes**: eight modules reachable from `main.mjs`, `MISSING: none`.
- **THE UNLOCK CHAIN IS IN THE BUNDLE, checked by searching the packed bytes**: `unlockSessionSource` and
  `getUnlockSession` (the session source and the handler that reads it), the app preload's `unlock` verb,
  the `ASK`/`ANSWER` channels, `step-approve` and `ask-digest` in the ceremony page, `reviewFromAsk`, and
  `signing` in the state. A rebuild that silently kept an older shell would pass a hash check and fail
  this one, which is why it is done every time.

### 43.3 What is NOT in this bundle, and what an installer must check

| piece | where it lives | current as of |
|---|---|---|
| the shell (this bundle) | `apps/aukora-desktop/dist/` | `a6dd2814`, hashes above |
| the Aumlok FACE | `plugins/aukora-face/aumlok/lib/client.js`, committed | `a6dd2814` (rebuilt in §42) |
| the PLUGIN | a **RELEASE** the shell serves, loaded by `loadCeremonyLibrary` | must be materialized — §33.5 |

**THREE THINGS MUST BE CURRENT, AND TWO OF THEM ARE NOT IN THIS BUNDLE.** A person who installs the app
without a release carrying the plugin will have a screen whose machinery is older than it looks; and the
face bundle is only current because §42 regenerated and committed it.

**NOBODY HAS INSTALLED IT AND NOBODY HAS BOUND.** The app was not launched: every check above is
static, over the built bytes. **Fable installs; Peter binds.** Until that click, `ATTENDANCE` stays
`reported-not-proven`, `IDENTITY_BOUND` stays false, `OWNER_KEY_SAME_UID` stands, and step 6 happens on the
first real binding and not before.

**`WIRE` and `PHRASE-REWRAP` remain the only two items open**, both waiting on the §29 decision: does
"change my phrase" ask for the printed factor (a re-seal, identity unchanged) or rotate the root and
issue a new printed factor (identity and subject move)?

## 44. Round 18 — THE ARTIFACT LAUNCHES, and the RELEASE it serves carries none of this work

### 44.1 The launch, which is the first time this artifact has been run

    AUKORA_DESKTOP_USERDATA=$(mktemp -d) AUKORA_DESKTOP_NO_DIALOG=1 \
      apps/aukora-desktop/dist/mac-arm64/AUKORA.app/Contents/MacOS/AUKORA

    aukora-desktop: release $HOME/aukora-release-harden; checkout pinned to e772aa92b44a
                    from $HOME/aukora-genesis; composition patch from the release;
                    state root owned by this shell
    aukora-desktop: eye: listening on http://127.0.0.1:54689/eye/capture
    aukora-desktop: Spawned Genesis PID 81614; it printed its URL inside the startup window:
                    dsh web: http://127.0.0.1:54690/?token=<redacted>
    aukora-desktop: backend http://127.0.0.1:54690 · owned by this window · release aukora-release-harden
                    @ e772aa92b44a · spatial frontend
    aukora-desktop: window loaded http://127.0.0.1:54690

**IT STARTS, RESOLVES A RELEASE, BINDS THE EYE DOOR, SPAWNS A REAL BACKEND, LOADS THE SPATIAL FRONTEND AND
REDACTES THE TOKEN.** That is far stronger than §32/§36/§43's static checks: the module graph loads under
Electron, `installEyeDoor` runs, `supervisor.mjs` spawns the launcher, and the window loads the frontend it
was told about. **A bundle can pass every static check and still fail to start; this one does not.**

### 44.2 THE FINDING THAT MATTERS FOR THE INSTALL

**The release it served carries NONE of this lane's fixes.** Checked by searching the release's own files:

    unlockSessionSource         0   (§38 — the unlock window's mode and session source)
    canonicalPhrase             0   (§37 — one phrase, whatever separator)
    signing-state-unreadable    0   (§41 — the reading)
    ceremony-intent-unknown     0   (§39/§42 — the closed mapper)

`~/aukora-release-harden` is at `e772aa92b44a`, which predates §37 onwards. **So a person who installs
`a6dd2814`'s app bundle and clicks today gets a plugin that cannot unlock at all** — the binding would
work and everything after it would not, and the refusal would look like a defect in the NEW shell.

**THE INSTALL THEREFORE HAS THREE PRECONDITIONS, NOT ONE** (this is §33.5 and §43.3, now measured):

1. the app bundle — current (`a6dd2814`, §43);
2. the Aumlok **face** — current (`plugins/aukora-face/aumlok/lib/client.js`, §42);
3. a **RELEASE** materialized from `a6dd2814` or later — **NOT current, and the shell resolves a stale one
   by default.**

### 44.3 Side effects of this round, and their cleanup

**IT SPAWNED A REAL BACKEND AND THE APP SURVIVED THE FIRST SIGNAL.** The launch started a Genesis backend
(PID 81614, listening on 54690) and my first `SIGTERM` hit the wrong pid, leaving the app itself (81593, the
eye door on 54689) alive. **Both were killed and both ports are free** — verified by `lsof` and `ps`.
Anyone repeating this must kill the APP first so its quit handler stops the child, then confirm the ports.

**NOTHING OF PETER'S WAS WRITTEN.** `find ~/aukora-release-harden -newermt '-10 minutes'` is empty (the
release was only READ), and every write went into the disposable `userData` (`Local State`, `Partitions`,
`checkouts`, `config.json`, `state`). The isolation seam is `app.setPath('userData', …)` at `main.mjs:34`,
before anything reads it, and `AUKORA_DESKTOP_NO_DIALOG` suppressed the modal.

**NO PERSON ATTENDED ANY OF IT.** A hidden window driven by a script is not a person looking at a screen;
`ATTENDANCE` stays `reported-not-proven`, `IDENTITY_BOUND` false, `OWNER_KEY_SAME_UID` stands.

## 45. Round 19 — THE RELEASE IS MATERIALIZED, AND THE APP NOW SERVES IT

**All three pieces are current and the install path is verified end to end by launching the app.**

### 45.1 The release

    python3 scripts/materialize-aukora-release.py --to ~/aukora-release-aumlok
    RELEASE MATERIALIZED $HOME/aukora-release-aumlok
    strip manifest sha256 35e119bb349e7f99195fdc2552b72dbbf38e01392f263493445d15ffb3f5ade4
    record sha256         22ee46b358c634a540e76d207bcf2048929424de25609b4821404a6edc606661
    plugin client bundle  fb6ca005cecd8053bfa96b0e1f3049f6354b798b909853558f1695a020723477

**NO `--development`**, which the tool's own help says is "NOT for a release an application runs: that
channel answers unauthenticated".

**AND IT IS PICKED UP WITHOUT ANY CONFIGURATION.** `resolve.mjs` defaults to *"the newest
`aukora-release-*` in searchRoots"*, so materializing `~/aukora-release-aumlok` moves the shell onto this
lane's release. **That is a change to what this machine's app runs on its next launch** — the intended
delivery, and stated here rather than left to be discovered.

### 45.2 Verified, and one false alarm worth recording

At the release's REAL paths (`plugins/aukora-aumlok/**` and `plugins/aukora-face-aumlok/lib/client.js` —
the layout is FLATTENED: `plugins/aukora-face-<name>/`, not `plugins/aukora-face/<name>/`):

    canonicalPhrase            2 files      (§37, the one phrase form)
    signing-state-unreadable   1 file       (§41, the reading)
    ceremony-intent-unknown    1 file       (§39/§42, the closed mapper)
    readSigning                1 file       (§41)
    face bundle vs checkout    IDENTICAL
    lib/succession-v2.mjs      IDENTICAL    (§28)
    lib/custody.mjs            IDENTICAL    (§37)
    eff_large_wordlist.txt     absent       (§31)

**MY FIRST CHECK REPORTED "THE RELEASE CARRIES A STALE FACE", AND IT WAS WRONG** — I searched the
SOURCE's layout (`plugins/aukora-face/aumlok/…`) instead of the release's flattened one, and `cmp` against
a missing file reads as "differs". Two commands and a corrected path later, the face is byte-identical.
**A check that looks for a file in the layout you remember rather than the one the artifact uses produces
false findings in both directions** — the same family as §44's marker list, and the reason the check is
now written down with the real paths.

### 45.3 The launch, which is the end-to-end proof

    aukora-desktop: release $HOME/aukora-release-aumlok; checkout pinned to 3574f689f8dd
                    from $HOME/aukora-genesis; composition patch from the release;
                    state root owned by this shell
    aukora-desktop: backend http://127.0.0.1:55671 · owned by this window · release
                    aukora-release-aumlok @ 3574f689f8dd · spatial frontend

**The app bundle (`a6dd2814`'s shell), the face (§42) and the release (`3574f689f8dd`) are all current, and
the shell says so in its own log.** The three preconditions of §44.2 are met.

### 45.4 Cleanup, and the lesson that bit me twice

**`$!` IS NOT THE APP'S PID.** The `AUKORA` binary re-execs, so killing the pid the shell captured leaves
the real process (an `AUKORA` on the eye port) alive — twice. **Find it by PORT:**

    APP=$(lsof -nP -iTCP:<eye port> -sTCP:LISTEN -t | head -1); kill -TERM "$APP"

killing the APP first lets its quit handler stop the backend, which is what happened on the second run
(the backend was already gone). Both runs ended with no process of mine and no port held, verified by
`lsof` and `pgrep`. **Nothing of Peter's was written**: the release was only READ, and every write went to
a disposable `userData` through `main.mjs:34`'s `setPath` seam.

**NO PERSON ATTENDED ANY OF IT.** `ATTENDANCE` stays `reported-not-proven`, `IDENTITY_BOUND` false,
`OWNER_KEY_SAME_UID` stands, and Peter's click remains the acceptance — but for the first time everything
that click needs is in place.
