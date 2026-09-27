# PROVENANCE — where every piece came from

φ is not written from nothing and does not pretend to be. Everything below was taken from a repository
that had already proven it, WITH the tests that proved it. A transplant without its test is a rumour.

## From `aumara-xyz/aukora-symbiote` (the live node, `sam/node-update-20260721`)

| Here | There | Why it earned its place |
| --- | --- | --- |
| `core/authority/standing.ts` | `spatial/standing.ts` | the write seam — courtyard vs owner, read live, never cached |
| `core/forge/review.ts` | `spatial/forgeReview.ts` | propose → capture → restore → accept/discard, content-free receipts |
| `core/forge/renderDiff.ts` | `spatial/renderDiff.ts` | a real LCS diff; the first version printed a whole file twice |
| `core/forge/deadDoor.ts` | `spatial/deadDoor.ts` | the node cannot lock its owner out of the house |
| `core/forge/hands.ts` | `spatial/handsLane.ts` | read / run / ship / restart, three tiers by effect |
| `test/*.test.ts` | `core/tests/*` | 49 cases, each verified able to fail before it was trusted |

## From `aumara-xyz/aukora-one`

| Here | There | State |
| --- | --- | --- |
| `conformance/cases/*.json` | `conformance/cases/` | 12 hostile cases, unmodified |

### The council — `scripts/council*.mjs` → `core/council/`

Donor commit `e704324`. Both blob digests are of the donor file as it stood at that commit.

| Here | There | State | Donor blob sha256 | Proof |
| --- | --- | --- | --- | --- |
| `core/council/readonly.mjs` | `scripts/council-readonly.mjs` | **VERBATIM** — `cmp` clean | `71cc6c7f466163d657b6d99b439e2d74b1e4cb00eae44a4cea001aea2e0d7985` | `test/council.test.ts` drives the real binary over stdin |
| `core/council/cast.ts` | `scripts/council.mjs` | **ADAPTED** — CLI → streaming module | `653d770b39883d23f8c876128ae7df877673c1bccef6563a5fb32abd24e74dbb` | `test/council.test.ts` (14) |

**Why the fence is VERBATIM and the runner is not.** `readonly.mjs` is the file the whole read-only
claim rests on, and the donor's history is two consecutive versions of that claim being false — first
`permissions.allowed_tools`, which Crush's own schema defines as an auto-approve list rather than a
restriction (a model asked to create a file created it), then a deny-list hook that allowed an empty
payload. The version that survived both is worth copying byte for byte rather than paraphrasing, so it
is copied byte for byte and `cmp` says so.

`council.mjs` could not come across unchanged: the donor is a CLI that runs `Promise.all` and prints
results, and a door needs every seat's output streamed line by line as it arrives, tagged by model, or
the situation room is a spinner that eventually prints a wall. What was preserved is every measurement
the donor paid for — no `timeout(1)` on macOS, the worktree must not live under `/tmp`, reasoning counts
against `max_tokens`, one `--data-dir` per parallel run, and the `eyes` column recording which models
can actually drive the tool protocol. Those notes are the donor's real value; the control flow around
them is not.

**Not taken:** the donor's account-delta cost harvesting (`accountState`, the settle-poll loop). It
brackets a round against OpenRouter's `total_usage`, which is honest only when nothing else spends on
the same key concurrently — and φ's door is a long-running process that also spends on that key for the
voice and the eye, so the delta would be wrong exactly here. Reporting a fabricated per-round cost is
worse than reporting none. Per-seat timing and word counts are carried instead, which are true.

### The AUMLOK ceremony — `ui/ceremony/` → `ceremony/`

| Here | There | Why it earned its place |
| --- | --- | --- |
| `ceremony/phrase.ts` | `ui/ceremony/phrase.mjs` | the acrostic, byte-faithful and pinned — see below |
| `ceremony/verify.ts` | `ui/ceremony/verify.mjs` | seven-token fingerprint, fresh salt per write, `timingSafeEqual` |
| `ceremony/genesis.ts` | `ui/ceremony/genesis.mjs` | the content-free public echo of a completed vow |
| `ceremony/recovery.ts` | `ui/ceremony/recovery.mjs` | the phrase measured honestly, and the guard against deriving a key from it |
| `ceremony/door.ts` | `ui/ceremony/door.mjs` | the candidate lifecycle, the origin fence, rehearsal-by-default |
| `ceremony/vow.ts` | `ui/ceremony/commit.mjs` | the RULE, not the key path — a ceremony verifies its own result |
| `evidence/ceremony-phrase.donor.json` | same | byte-identical, and it still matches — see below |
| `test/ceremony-*.test.ts` | `test/ceremony-*.test.mjs` | 41 of 46 cases; 40 pass, 1 is a visible skip. Counted below, not rounded |

**The phrase is a third-generation transplant and the pin proves it survived.** The lineage is the owner's
`core/src/aumlokPhrase.ts` → aukora-one's `.mjs` (types stripped) → `ceremony/phrase.ts` (types restored).
The donor's content-free pin — digests of the anchor block and all 274 words, recorded on a machine where
the owner's own source was present — came across unchanged and still matches both digests. That is a
stronger statement than any prose: the tables are the same bytes someone once checked against his source.
It is also why the annotations in that file are at the point of access and never on a table literal.

**The test count, exactly.** The donor's four ceremony suites are 46 tests, 45 passing, 1 skipped. 41 came
over. The 5 that did not are listed under *Not taken* below. 40 of the 41 pass and 1 is the same visible
skip it was there. A further 23 cases were written here for the seam that is new (see *The graft*), for
63 passing and 1 skipped in total. Saying "45" would have been the arithmetic this repository's gate exists
to prevent.

## The threads/canvas/menu frame — `ui/app/shell.js` (`aumara-xyz/aukora-one`) → `surface/app/threadsGeometry.js` + `surface/app/threadsShell.js`

Donor commit `5b60222` (last commit touching the file at transplant time), blob sha256
`99a2b39a85694db0e83c581e59938870bd2e2cfd8b8368bda47e4f476114608f` for `ui/app/shell.js`; `style.css` at
that same commit is blob sha256 `ba7aedd4985eeff2d390672739605b24a18a22e32976b0bd2cd3b0d9ecdb5bf7` and is
**not re-transplanted**, because it already made the trip: `surface/app/style.css` lines 1-145 are
byte-identical to the donor's (confirmed by `diff` at transplant time — the trinity `.lane` / `.corner` /
`.edge-sliver` / `--hue-l·c·r` CSS this repository already carries is this same donor's own).

| Here | There | State | Test reference |
| --- | --- | --- | --- |
| `surface/app/threadsGeometry.js` | `ui/app/shell.js` lines 1-8, 42-53, 65-97 (header, `state`, `applyLanes`'s width formula, the `corners` object) | **ADAPTED** — one invariant added, see below | `test/threads-geometry.test.ts` (12) |
| `surface/app/threadsShell.js` | `ui/app/shell.js` lines 44-51, 98-126 (lane/corner DOM, `corner()` dispatch, the keydown guard) | ADAPTED — DOM only, mounts φ's existing chat instead of the donor's organ registry | `test/browser-modules.test.ts` (parses, imports resolve) |
| `surface/app/threads-shell.html` | `ui/app/index.html` lines 16-17, 106, 124, 148-149 (the three `<section>`s, the sliver divs) | ADAPTED — one page, no chat-list/menu-tab/hint-card DOM, since those are organ content, out of scope here | manual (see PR) |

**What was left out, and why: everything past the frame.** The donor file is 403 lines; roughly 280 of
them are the organ registry, the two-tab menu, `setOrgan`, the hint card and AUMLOK-first routing — real
product decisions for a shell with twenty-plus mountable organs. The task this port serves is the frame
only: "canvas and menu lanes can be EMPTY or a simple placeholder — do not invent content." Inventing that
content is explicitly a separate, later task, and this port does not guess at it.

**The one deviation, in full, because it is load-bearing.** Traced by hand and confirmed by
`test/threads-geometry.test.ts`'s `"the DONOR'S arithmetic (uncorrected) really does close threads in two
presses of \`menu\`"` case: the donor's own `corners.menu` (`state.d === 0` wall, `Math.max(0, state.a - 1)`
floor) drives `{a:0,d:0}` from the balanced room in two presses — **threads (chat) at zero width**, and
`.lane.collapsed` is `pointer-events:none`, so its own corner is unreachable from there too. That lane is
where the task's one hard requirement lives — "must keep working exactly as it does now" — so a geometry
that can make it disappear fails the task, not just a style preference. This repository had already found
the identical class of bug once, in a *different* file transplanted from a *sibling* donor
(`test/planes.test.ts`, `"the donor's reachable hole"`), and fixed it there by moving the reversal wall
inward by one third. The same fix, applied to this donor's `menu` and `canvasLeft` corners, is documented
in full in `surface/app/threadsGeometry.js`'s own header — wall `d===0`→`d===1`, floor
`Math.max(0,·)`→`Math.max(1,·)` on `menu`; wall `a===0`→`a===1` on `canvasLeft`, reversal replaced with a
no-op (there is nothing left to give without breaking the invariant, and reversing into growing threads
when the owner pressed a *canvas* control would be a surprising thing for that control to do). `threads`
and `canvasRight` are byte-faithful to the donor — traced by hand, and confirmed exhaustively by the same
test, that neither can put `a` below 1 on its own.

**Not wired into `index.html`, and why.** This repository's production shell is `surface/app/arc.js` +
`surface/app/planes.js` — real, tested (`test/planes.test.ts`), documented (`docs/EXPECTATIONS.md`,
`docs/SKELETON.md`'s "Geometry (working shell)"), and shipping tonight. It is a *different* transplant of
a *sibling* donor (`spatial/app/shell.js`, a different repository), reshaped around a permanent centre
chat lane with informational panels opening on the right, rather than this donor's chat-left / canvas-
centre / menu-right shape. A prior hosted session tonight tried close to this exact restructuring directly
against `arc.js` (`39c154a`, `607d84a`) and it was reverted same-night (`31d1a1f`) for freelancing beyond
its brief — a toggle, new colours, new copy — while the geometry itself was not the part that broke.
Replacing φ's current, working, documented chat placement with a differently-shaped one is a real product
decision (which lane chat lives in, whether it may ever shrink to a third), not a mechanical frame swap,
and this task's own scope is explicitly the frame, not that decision. So this transplant lands as an
additive, self-contained page — `surface/app/threads-shell.html`, reachable at `/app/threads-shell.html`,
proven working end to end (see the PR) — and the choice between the two shapes is left named, for the
owner, rather than made silently by whichever session runs last.

## The memory ledger — `@aukora/kira` (`aumara-xyz/aukora-one`, `organs/kira`) → `core/memory/`

Full account, including what was deliberately left out and why, in `docs/MEMORY-PORT.md`. Donor commit
per file below is the last commit that touched it, resolved against `aukora-one`'s `30798ab`. Donor blob
sha256 is `shasum -a 256` of the file's bytes as read for this port (not git's own object hash).

| Here | There | Donor commit | Donor blob sha256 | State | Test reference |
| --- | --- | --- | --- | --- | --- |
| `core/memory/eventLog.ts` | `organs/kira/src/eventLog.ts` | `246be1887ee12f5f78090be1d7490ee82e2091eb` | `ce0d568dbaacc7d3858c1d43e20e64e93a2a38195e56876d28dd1a81fd3afea3` | ADAPTED | `test/memory-eventlog.test.ts` |
| `core/memory/vault.ts` | `organs/kira/src/vault.ts` | `30de54306f16e3e87949cf944a725598b21a8dff` | `34bc47d9321dc50cd753761d749062ecdc2a1888a66a08e7aa1f05a253a7955f` | ADAPTED | `test/memory-vault.test.ts` |
| `core/memory/erasureCertificate.ts` | `organs/kira/src/erasureCertificate.ts` | `21a0a3572df3c47893a1879c1e26eef0456846e5` | `f4015df0a8aa7c9edcb62603fad2c27e129c6f1f6d711574a667213be9baa87a` | ADAPTED — reduced, see below | `test/memory-certificate.test.ts` |
| `core/memory/durableWrite.ts` | `organs/kira/adapters/durableWrite.ts` | `c337a8b6d4d65cfca5f187e3835b6b896a9a6d09` | `89784abfa422c24bd7571d73b5301f3fb85855b69adb1f2e67de9c5e49d934bc` | ADAPTED | `test/memory-durablewrite.test.ts` |
| `core/memory/fileVaultAdapter.ts` | `organs/kira/adapters/fileVault.ts` | `c337a8b6d4d65cfca5f187e3835b6b896a9a6d09` | `725cbfd5405f95e1342e95beba2337a762dc379d2583e885eed5e12f34708725` | ADAPTED | `test/memory-filevault.test.ts` |
| `core/memory/merkle.ts` | *(none — see `docs/MEMORY-PORT.md` §4)* | — | — | NEW | `test/memory-merkle.test.ts` |
| `core/memory/hash.ts` | *(none)* | — | — | NEW | exercised via `test/memory-eventlog.test.ts` |
| `core/memory/ledger.ts` | *(none — glue wiring to `surface/conversation.ts`)* | — | — | NEW | `test/memory-ledger.test.ts`, `test/memory-conversation.test.ts` |

Read for context, and their lessons carried over in comments, but **not ported** (see
`docs/MEMORY-PORT.md` §2–3 for exactly why):

- `organs/kira/adapters/vaultLock.ts` (`c337a8b…`) — the cross-process `LOCK` file. The
  lease/derivative-lineage system and the concurrent-write machinery named in the task are both
  explicitly out of scope; this is the file that would have carried the second one.
- `organs/kira/adapters/jsonlLedger.ts` (`c337a8b…`) — read for the "short write truncates a ledger to
  `{`" lesson (`durableWrite.ts` closes it); its own erasure-adapter design (predicate-based, JSONL
  line-level) was not ported — `core/memory/ledger.ts` is new glue with a different, simpler shape
  (whole-log atomic rewrite, one memory per turn).
- `organs/kira/src/logProof.ts` (`246be1887…`) — read for its RFC 6962 explanation; `core/memory/merkle.ts`
  is an independent implementation from the RFC itself, not adapted from this file (it wraps
  `@aukora/kernel/merkle`, which this repository does not carry).

**Not taken:** `@aukora/kernel` (the canonical-hashing and Merkle packages `eventLog.ts` and
`erasureCertificate.ts` depend on in the donor) — same reason as `aukora-one/kernel/` elsewhere in this
file: an npm-workspace TypeScript package built with `tsc`, not a small graft into a Bun tree.
`core/memory/hash.ts` and `core/memory/merkle.ts` are small, self-contained equivalents built for this
port instead.

## The graft: what neither repository could do alone

aukora-one's STATUS.md names its own gap — its membrane "cannot apply, promote, or materialize, and no
owner-authorization path". It had the rite and nowhere for the result to go. φ's `standing.ts` said the
reciprocal thing: "Because standing 1 cannot be reached from this repo yet… this module therefore has no
way to MINT standing, only to recognise it." It had the seam and no door.

One edge closes both. A completed vow writes a record; `core/authority/standing.ts` reads it and moves from
`courtyard` to `vowed`; a write verb that was refused resolves. `test/vow-standing.test.ts` proves that
end to end, and `requestAction` itself was not touched — it already asked the right question.

- **`vowAvailable` is computed, not hardcoded.** It was `false` with a note saying the ceremony lived in
  another repository. It is now `!courtyardPinned`, because the honest question is "will taking the vow
  change where I stand", and on a courtyard-pinned build the answer is no — the pin outranks a vow, exactly
  as it outranks the arming switch.
- **The reader cannot mint.** `core/authority/vowRecord.ts` recognises a vow and contains no write, no
  `randomBytes`, no import from `ceremony/`. This is aukora-one's best structural idea — "the MAIN door
  cannot mint — it does not import the keygen… not by policy, by reachability" — kept as a property of the
  import graph and asserted as one.
- **What a vow is worth, and what fences it.** The phrase is 14.3 bits of min-entropy, about twice a 4-digit
  PIN. It is not the credential. Writing the record needs local filesystem access as the user running the
  node — the same physical-possession act `AUKORA_FORGE=1` already required, so the vow is a second door of
  the same strength, not a weaker one.

## Changed in transplant, and why

## Changed in transplant, and why

- **`REPO` is read live rather than captured at module load.** The donor froze it in a `const`, so a
  test could not point the module at a fresh directory without tearing down the module cache — which
  is why its suite needed `vi.resetModules()`. Reading it per call follows the rule `standing.ts`
  already states: a seam no test can exercise is a seam nobody can trust.
- **`__resetForTests()` is declared, not smuggled.** The stores are module-level state; saying so is
  better than re-importing a module to pretend otherwise.
- **No hand-maintained test floors.** See `scripts/gate.ts` for the failure that decision comes from.
- **The ceremony's product is STANDING, not a key.** aukora-one's `commit.mjs` puts two seeds into Keychain
  custody and two public halves on disk. `ceremony/vow.ts` writes a content-free standing record. The rule
  the donor file exists to enforce is what came across — *a ceremony verifies its own result*, through the
  reader the seam itself uses rather than through the writer's return value.
- **The door is a `{ fetch }` handler, not a `node:http` server.** The donor's suite had to fake `req`/`res`
  and emit `'request'`, and the fake was thin enough that the Host-header fence had to be worked around
  inside the harness. Under Bun a real `Request` is available, so the fence is now exercised as a browser
  would present it.
- **`isBound()` became `isVowed()`, and `ceremony:already-bound` became `ceremony:already-vowed`.** Same
  guard, same two call sites — including the one at the moment of *effect* that Sakana found missing.
- **The vow id is random, not derived from the phrase.** In the donor this id is a fingerprint of a real
  hybrid key and carries a key's entropy. Deriving it from the phrase here would have made a public id an
  enumerable pointer into a 45,248-value keyspace.
- **The source-reading tests are line-anchored.** The donor's patterns were not, and the first draft of
  `ceremony/phrase.ts` spelled a table declaration out in a comment — so the keyspace enumerator matched the
  *prose*, several hundred lines above the code, and tried to evaluate an English sentence. It failed on the
  ellipsis in it, by luck. `^const` removes the class.
- **`COURTYARD_PINNED` is read live.** It was captured at module load in the one file whose own comment
  explains why that is wrong: `currentStanding()` read the variable live and `standingReport()` read the
  frozen copy, so a process that pinned the courtyard after import reported `courtyardPinned: false` while
  refusing every write. The report is the half a person sees.

## Not taken, and why

- `aukora-one/kernel/` and `organs/` (262 files, npm workspaces, tsc build). Real and valuable, and
  grafting them into a Bun tree is a multi-day job. φ grows into them; it does not ship them today.
- `aukora-seed/src/` — largely duplicates aukora-one, and its suite does not run outside its author's
  machine (a hardcoded absolute home-directory path in a test).

### From the ceremony specifically

- **`ui/ceremony/page.html`** — his 652-line original, 54KB, with the trefoil emblem, the AURA birth
  renderer and a vendored Three.js. It belongs to `surface/`, which is a different lane, and it needs three
  assets this repository does not have. A page that renders a broken emblem and can never play the birth
  would be a claim, not a capability. So the vow is performed from a terminal today and `GET /` on the
  ceremony door says exactly that, printing the three calls rather than implying a screen.
- **The key-minting half of `commit.mjs`** — `generateOwnerSeeds`, `derivePublicKeys`, `buildOwnerRoot`, and
  the Keychain backend. It needs `@aukora/kernel/authority`, `@noble/post-quantum` and `@noble/curves`; the
  kernel is already recorded above as not taken. LAW §3 also puts custody material out of reach here.
- **Five of the donor's 46 ceremony tests**, and each for a reason that is not "it was inconvenient":
  - *the transplanted page carries NO unprocessed template escapes* — guards `page.html`, which did not come.
  - *the PRE-WRITE fence refuses network tools and cannot fail open* — asserts things about
    `law/hooks/pretooluse.mjs` and `crush.json`, which φ does not have. It was a hitchhiker in the ceremony
    file to begin with.
  - *the seed FIELDS and the custody ACCOUNTS are mapped, not assumed* / *a seed bundle missing a half is
    REFUSED* / *commit writes BOTH seeds to custody and BOTH public halves to disk* — all three are about
    seeds, and φ mints none. They stay in aukora-one with the code they guard.

## Known gaps, named rather than left to be found

- **The forge can still propose a write to the standing record.** `core/forge/review.ts` applies
  owner-accepted proposals to arbitrary paths, so a proposal that wrote `.aukora/standing.json` and was
  clicked through would grant standing. The click is owner authorization and LAW §1 is satisfied — but the
  owner would be clicking a diff, not taking a vow, and those should not be the same act. The fix is a
  protected-path entry in the forge, which is another lane's file. `test/vow-standing.test.ts` asserts the
  gap is where this row says it is, and fails with instructions when someone closes it.
- **The vow record is tamper-EVIDENT, not tamper-proof.** `vowIntegrity` is a plain digest computed by a
  function in this repository; anyone who can write the record can compute a valid digest for it. It catches
  truncation, a hand-edited field and a stray key — a record that is not what the ceremony wrote. It is not a
  signature and nothing describes it as one. `test/ceremony-vow.test.ts` proves a re-signed forgery passes,
  so the limit cannot be quietly overstated later.
- **The genesis AURA is drawn, and over NO BINDING.** This row previously read *"nothing draws the genesis
  AURA … the data is real; the figure is not claimed."* That stopped being true when
  `surface/app/aura/face.html` shipped, and a stale limitation is worse than none — it reads as a promise
  that a surface does not exist. What is true now: φ is **UNBOUND**. There is no `aukora.pub`, so there is
  no `rootId` and no `boundAt`, so `core/aura/state.ts` reports `genesis: {present:false}` and the page
  draws `aura-birth.js`'s documented fallback seed under the words **NO BINDING — THIS FIGURE IS NOT AN
  IDENTITY**. The pattern is real and deterministic; the *identity* is not claimed, and the page says which
  is which. `ceremony/**` persists neither `genesisRef` nor `boundAt` today, and its two candidate instants
  disagree — a ref rebuilt from disk would not equal the one the owner was shown. That is another lane's
  file and is listed as a hand-off, not worked around here with a guess.

## From `aumara-xyz/aukora-symbiote` @ `9a950afc` — THE AURA TRACE (Lane 3)

**Read from the COMMIT, never the checkout.** The working tree at
`<FLEET_ROOT>/aukora-symbiote` sits on `codex/nebius-lab-handoff-20260709`, where all
four trace modules are **absent** and `spatial/app/aura-core.js` is the superseded
scoring version. Porting from the checkout would have imported exactly the thing that
was deliberately removed. Verified before a byte was copied.

| Here | There (`9a950afc`) | sha256 of the donor blob | State |
| --- | --- | --- | --- |
| `core/aura/auraTrace.ts` | `core/src/auraTrace.ts` | `5ae48a49120a4a79400ef8d8ecda61648095bb9469dd4a2753a4b25c23b5a807` | **VERBATIM** |
| `core/aura/auraEvidenceReader.ts` | `core/src/auraEvidenceReader.ts` | `4e3ce5b56e4690446dfa0109c72f9ab13a45af38d3802064e7947c4b2d6f2241` | **VERBATIM** (import re-pointed to `./memoryKey`) |
| `core/aura/auraEvidenceKeyRecord.ts` | `core/src/auraEvidenceKeyRecord.ts` | `8def9ef6ba32f1bce09629185c31a094b4cfab7958969d4636d752d0cdc162be` | **VERBATIM** (same re-point) |
| `core/aura/aumlokGenesisAura.ts` | `core/src/aumlokGenesisAura.ts` | `bac386cb55068d64b461d1545765deec43d5cb0a3473ffc1276d5a5ae0291d14` | **VERBATIM** |
| `core/aura/aumlokCeremonyEcho.ts` | `core/src/aumlokCeremonyEcho.ts` | `ef40ddcbe6e4101c1329185673cb378106ae1510334611e8248ec93d32e6c48f` | **VERBATIM** — carried for one function, `deriveReceiptRef`, so the anti-collision property below stays testable |
| `core/aura/memoryKey.ts` | `core/src/memoryAppend.ts:38` | — | **ONE LINE.** `MEM_KEY_RE` only. The donor module is 12,590 bytes of append-only memory API; two importers needed one regex. Subtractive rather than dragging the rest. |
| `core/aura/drandAnchor.ts` | `core/src/drandAnchor.ts` | `7e57a43f1ad988c924df8c4b8188ae9b277b6788ae7973b9f7f8340205b4355d` | **DELIBERATE REDUCTION — NOT A PORT.** See below. |
| `test/aura-trace.test.ts` · `aura-evidence-reader` · `aura-evidence-key-record` · `aura-genesis` | `core/tests/*` | — | ported with the code; **80 cases green** |

### `drandAnchor` is refused, not ported

The donor verifies drand beacon rounds against a pinned BLS12-381 key. Porting it
would add `@noble/curves` + `@noble/hashes` to φ, which today has **no `@noble` at
all** — a pairing-curve dependency pulled in by the lane that draws a figure.

So `verifyDrandRound` returns **false, always**. The drand block is optional in the
donor (`if (drand !== null)`), so a beaconless epoch builds and validates exactly as
the donor builds it; a beacon-carrying epoch is refused as `trace_drand_unverified`
rather than accepted unchecked. A stub returning `true` would be the actual
weakening, and it is the one someone reaches for when tests go red.

**Label: drand anchoring is BLOCKED in φ.** Not implemented, not claimed. The honest
consequence is visible in the trace's own output: a beaconless epoch reports
`freshness: 'none claimed'` rather than quoting a limit it cannot back, and there is a
test pinning that string.

### Dropped from the donor, and said so

`aura-genesis.test.ts` carried a `describe('the door wiring — structural pins')` that
reads `spatial/aumlok-bind-serve.ts`. φ has no such file; the equivalent surface is
`surface/door.ts`, which belongs to Lane 1. It was **removed rather than re-aimed** — a
structural pin pointed at the wrong file goes green over a surface it was never
written about.

## From `AUKORA-EVOLUTION` — THE AURA FACE (Lane 3)

| Here | There | sha256 | State |
| --- | --- | --- | --- |
| `surface/app/aura/aura-birth.js` | `apps/spatial/assets/aura-birth.js` | `2c3bfc92be194e5f36212b36075cb4114dfd53c8ea3be7eb4147b7c263cc0f4e` | **VERBATIM**, 294 lines |
| `surface/app/aura/vendor/three.module.min.js` | `apps/spatial/assets/vendor/` | `f7cee3c7533449a1505cc12cb5128b89e3d4fd3d7ea62b05f9f5464a217472ee` | **VERBATIM**, pinned — the geometry is computed by us and RASTERISED by three, so a different three is a different picture from the same seed |

**Corroborated by two independent trees.** symbiote `9a950afc` carries
`spatial/assets/aura-birth.js` with the *same* sha256. One digest, two donors that
never synced for this purpose — which is what makes "verbatim" checkable rather than
asserted.

Verified deterministic before porting: no `Math.random`, no `Date`, no
`performance.now`, no `crypto.getRandomValues`. Integer-only PRNG seeded from the
public genesis ref (`seedStream`, line 26).

### THE genesisRef DERIVATION — one was chosen, and this is which

Two incompatible derivations exist for the same root:

* `aukora-council-aura/ui/ceremony/genesis.mjs:34` — `sha256('aumlok-genesis-aura-ref:<rootId>|<boundAt>')[0:24]`
* `AUKORA-EVOLUTION apps/seed/src/ownerRootStore.ts:75` — `canonicalHash({domain:'aumlok-genesis-ref-v1', rootId})`

**φ uses rootId + boundAt** — the first. Not a preference: `aumlokGenesisAura.ts`,
which this lane ported, *contains* that derivation and its validator refuses any
packet whose ref does not match it (`genesis_ref_mismatch`, line 79). Choosing the
rootId-only form would make every packet the ported module produces invalid.

The consequence, stated because it is a real design fact: the ref is stable across
refresh and rotation within one binding, and a **re-bind draws a different face**. A
new genesis is a new genesis.

## The Riemann–Siegel observatory — an UNTRACKED donor, and what that costs

`surface/app/aura/zeta-observatory.html`, from
`/Users/peterviviani/aukora-worktrees/fable-knvs-round1/spatial/app/zeta-observatory.html`.

**THERE IS NO DONOR COMMIT, AND THAT IS THE FIRST THING TO SAY.** Every other transplant in this file
cites one — `9a950afc`, `5b60222`, `e704324` — because a commit is what makes "the same bytes someone
once checked" a checkable sentence rather than a memory. This file is **untracked in the donor
worktree** (`git status` reports `?? spatial/app/zeta-observatory.html`). There is no sha, no author,
no date, no branch: **lineage could not be pinned, and no lineage is claimed.**

What CAN be pinned is the artifact itself, so both digests are recorded:

| | sha256 | what it is |
| --- | --- | --- |
| donor, as it arrived | `267a57b5d6fc3ed449e1e256c8007ca0701dabeb2b755bdfae87b81ca6b67910` | 125,859 bytes, byte-identical on copy — verified with `cmp` before any edit |
| here, as it ships | `7a07f211c27728f9f6c14919e6842f3d35583b492e5ada69476ab6640227aab3` | the same file with nine amendments, below |

The shipped digest is pinned by `test/aura-apps.test.ts`, the same control
`surface/app/aura/vendor/three.module.min.js` has: the right question about a vendored artifact is
*did these exact bytes change?*, and re-pinning is a deliberate, visible act.

### Nine amendments, because it arrived making claims φ cannot point at

The page referred, in the present tense, to `instruments/zeta_harp_v2/MATH_SPEC.md`, a reference-
fixtures directory, a SHA-256 manifest and a check harness (`reference/check_inline_math.mjs`).
**None of them travelled with it and none exists anywhere in this repository.** Shipping that as-is
would import four claims this repository cannot back — LAW.md §4. The strongest was user-visible and
present-tense: *"the full fixtures, their SHA-256 manifest, and the check harness **live in the
repository at** instruments/zeta_harp_v2/reference/."*

So nine sentences were amended to what is true, and `test/aura-apps.test.ts` asserts each dangling
form stays gone — each guard verified non-vacuous by confirming the string IS present in the donor,
so the test would have caught the un-amended file.

The amendments say what is here rather than deleting the subject, because there IS something here:
`fillFenceStatic` recomputes `M(t)` from the inline math at **every one of the 564 embedded fixture
grid points on every load** and prints the maximum deviation on screen. Measured in this repository:
**W1 5.73e-13 · W2 5.49e-11 · W3 9.50e-9 · W4 1.72e-6** — which is itself the page's documented
float64 frontier, arriving as a number instead of a promise. So the badge that read
`validated: W1-W4 fixtures embedded` — pointing at a harness that never ran here — now reads
`W1-W4 fixtures embedded · inline math self-checked in page`, which the page proves while you look
at it. What it still cannot prove here is the provenance of the fixtures themselves (mpmath, 80
digits); that claim is marked **inherited and NOT verifiable in this repository** rather than dropped.

### What must never be amended, and is pinned verbatim

Its self-limiting language IS the artifact. `test/aura-apps.test.ts` pins sixteen strings verbatim,
including the standing label (asserted to appear **at least four times** — masthead, fence, opening
and head comment, so deleting one render cannot be quiet), `TRUTH MODE — no per-string tuning, no
remapping`, its artistic counter-label, the crossings labelling law (*"computed crossings (finite
approximation)"*, `never certified zeros`), the float64 honest-range sentence, the auxiliary-axis
disclosure, `never labeled |Z|`, the anti-fabrication rule (*"would fabricate a location"*), and the
Riemann fence itself: *"Nothing in this instrument is evidence for or against the Riemann
Hypothesis."*

### Self-contained, measured rather than asserted

The page claims `Self-contained: no CDN, no network`, and that half of the donor's head comment is
the one external-flavoured claim in the file the file can point at — itself. Verified two ways:
by scan (zero `fetch`, `XMLHttpRequest`, `WebSocket`, `src=`, `href=`, `http://`, `localStorage`,
`indexedDB`, webfonts — its AudioWorklet is a `blob:` URL built from an inline string, which makes no
request), and **at runtime**: loading `/app/aura/zeta-observatory.html` in a browser produces exactly
**one** network request, the page. No console errors.

**Pinned here deliberately, because nothing else can see it.** `test/browser-modules.test.ts` walks
`surface/app/` but collects only `.js`, so 66KB of inline script and every sentence around it are
invisible to it. For an artifact whose entire value is its honesty about its own limits, that gap was
not one to shrug at.

## New in φ (Lane 3, no donor)

| File | What it is |
| --- | --- |
| `core/aura/mood.ts` | Invariant B. Derives the mood from `trustworthy` on the witness verdict and **refuses to look at activity until the record is known sound** — a truncated chain verifies as structurally `intact`, so any other ordering renders calm over deleted history. |
| `surface/app/aura/aura.js` | The seam. Face + trace, no state, no health check of its own. The mood changes how she is LIT, never who she is. |
| `surface/app/aura/apps.js` | The apps menu. An app is a self-contained page under `/app/aura/` — the door already serves it, so registration is the file existing. Opening one takes the whole glass in an iframe and gives it straight back, so `planes.js` learns no new state. |
| `test/aura-mood.test.ts` · `aura-no-stored-value` · `aura-face-deterministic` · `aura-surface-join` | 36 cases. Each invariant watched failing on a real defect before it was trusted. |

## Round 4 — THE STUB FILLED, THE MOOD WIRED, THE FACE ON SCREEN

| File | What it is |
| --- | --- |
| `core/aura/state.ts` | What `surface/door.ts:1004` was waiting for. `auraStateForDoor()` — zero args, never throws, content-free. It consumes **`trustworthy`** from `core/witness/verify.mjs` and never `intact`, and projects every break array to a **length**, because `unparsable[].raw` is a verbatim ledger line and the route is a GET. |
| `surface/app/aura/face.html` · `face.js` | The face, on screen, at `/app/aura/face.html`. |
| `surface/app/aura/aura.d.ts` | The missing type sidecar, matching `lane.d.ts` and its siblings. It was a live typecheck error (`TS7016`). |
| `test/aura-truncated-chain.test.mjs` · `test/aura-state.test.ts` | 26 cases. The first builds a real bound repository with a real signed checkpoint, removes bytes from the end of the ledger, and walks the result from `verifyChain` to the hex colour on screen. |

**THE MEASUREMENT THAT SHAPED ALL OF IT.** A chain truncated at the tail leaves
`hashBreaks`, `orphans`, `unparsable`, `sigBreaks` and `sigGaps` **all empty** — every survivor still
hashes to its own claim and still names a predecessor that exists — so `intact` is **true**.
`checkpointBreaks` is the only field that fires, and only because a device signed for a head that is now
gone. Without a signed checkpoint, tail truncation is **completely invisible** to `verifyChain`, and the
live node has zero anchors. A test that truncated a chain without one would assert nothing while looking
thorough, so the fixture writes a genuine `writeCheckpoint` and a **control** runs the identical repository
untruncated and requires the calm state.

**`bound` HAD NO PRODUCER, AND NOW IT HAS ONE — the synthesis is gone.** `core/aura/mood.ts` branches
on `verdict.bound === false` to reach `unwitnessed`, and `verifyChain` emitted no such field, so against
a real verdict the branch never fired and this unbound node rendered **`quiet`** — "nothing has happened
recently" — when the true sentence was "nothing has signed for this at all". This lane could not fix it
at the source: the law refuses it `core/witness/**` (`judgePaths` → `law:protected-path`). So it derived
the field from `custody.ok`, said so, and handed the tidy fix upstream.

That hand-off landed (#96, `bound: custody.ok`, unconditional in the return literal and pinned both ways
by `test/witness-bound.test.mjs`). **The derivation is deleted and the field is read.** Deliberately not
kept as a fallback: two definitions of one fact is how they drift, and the fallback is the one nobody
notices going stale. Confirmed semantically identical rather than assumed — `test/aura-truncated-chain.test.mjs`
tampers one byte of `device.cert` on a real bound repository and drives `auraStateForDoor()` over both
states; it passed **unchanged** across the switch, which is the end-to-end evidence that the verifier's
field and the retired derivation agree.

**AND THE SWITCH CREATED A NEW QUESTION, ANSWERED THE SAME WAY THE LANE ANSWERS THE OTHER ONE.** While
`bound` was derived, an absent field was simply computed around; now that it is read, an absent one has
to mean something. A verdict carrying no `bound` is **refused**, exactly as one carrying no `trustworthy`
is. Coercing it to `false` would have this face state "nothing has signed for this" — a positive claim
about the world — on the authority of a verifier that never answered the question. "We could not ask" and
"the answer is no" are different sentences. Refusing is also fail-closed: the result is the alarm, never
a calm or identity-bearing state.

**INVARIANT A HELD, AND THE TEST FOR IT IS NOW ACTUALLY A PROPERTY TEST.** `activity` is a
**one-hour window**, not a running figure: a number that only goes up is a currency.

This paragraph previously called the guard for that "the distinguishing property, tested directly",
and it was not. What existed was two entries at one hand-picked offset — an EXAMPLE, and consistent
with several wrong implementations. It is now labelled as one and joined by a generative test that
quantifies over inputs instead of choosing them: **400 seeded record sets** (0–40 receipts each,
spread ±6h so every trial mixes receipts inside the window, long outside it, and stamped in the
FUTURE) each observed at **25 advancing times**, asserting that with nothing appended, deleted or
reset, `activity` never rises and reaches **zero** once the last receipt has aged out. Seeded with a
fixed LCG rather than randomised — a flaky property test is worse than an honest example.

MUTATION-CHECKED, because a property test that cannot fail is worse than no test. Against a copy of
the module with the cutoff removed so `activity` accumulates, **both** the example and the property
go red. Against a subtler mutation — a SYMMETRIC ±window, a plausible "receipts near this moment"
refactor that still decays for ordinary past receipts — the **example passes cleanly** and the
property fails with *"trial 0: activity rose from 2 to 3 with nothing appended."* That is the case
the example could not have caught, and the reason the generative test earns its place.

The vendor exclusion in the vocabulary scan is at `test/aura-no-stored-value.test.ts:47-57`. Stating
its provenance exactly, because "unchanged from the merge base" was claimed for it and has no
referent: that file is **new on this branch**, so there is no base version for it to be unchanged
from. The true sentence is narrower and checkable — the exclusion block is unchanged across the
branch's own history, written in the lane's first commit and never edited since. The file around it
did change once, in the second commit, for two unrelated index-access fixes; the block did not.
Checkable on the branch, before it is squashed, with `git log -p <first-lane-commit>..HEAD --
test/aura-no-stored-value.test.ts`: no added or removed line mentions the vendor directory. The
commit hash is deliberately not written here — this branch squashes on merge, so a hash in this file
would become a reference to nothing, which is the same defect this paragraph exists to correct.

**TWO THINGS AN ADVERSARIAL PASS FOUND, AFTER THE LANE CALLED ITSELF DONE.** Both are recorded
because the first one is the lane's own failure mode arriving through a door it had not watched.

*The face printed "bound" over a certificate that did not verify.* `aukora.pub` is read for two
strings and its signature is checked by nobody in this lane, so binding material can be PRESENT while
`custody.ok` is FALSE — a swapped device half, a revoked key, a pub copied from another root.
Reported independently, that put two contradictory sentences on one screen: the mood line said *"this
node is not bound — nothing has signed for it"* while the genesis half handed the page the node's
REAL `genesisRef` to draw a confident identity from. MEASURED on a fixture with one byte of
`device.cert` flipped. Custody now GATES the genesis half, and the refusal is NAMED rather than
flattened: `absence: 'unverified'` renders **BINDING NOT VERIFIED**, because "we cannot check this
binding" and "there is no binding" are different sentences and a reader who is being tampered with
deserves the first one.

*A renderer that would not start blanked the page.* `mountAura` reaches
`new THREE.WebGLRenderer(...)`, which throws when no context can be had — hardware acceleration off,
a blocklisted driver, WebGL disabled by policy. The mount ran before any text was built, so the throw
escaped `paint`, escaped `mountFace`, and left `<main>` EMPTY over a `cannot-verify` state: no alarm
word, no ink, no break count, indistinguishable from a page that never loaded. Not the
calm-over-broken failure this lane guards, but its neighbour — the whole point is that a reader is
TOLD, and a blank screen tells them nothing. Every word is now attached before the figure is
attempted. MEASURED after the fix, with `getContext` forced to null: 771 characters including the
mood, the binding statement, and an honest note that the figure could not be drawn.

**WHAT THIS LANE DID NOT DO.** `surface/door.ts` is byte-identical to `origin/main` — the route is a thin
delegation and filling the stub *removed* one error from main's typecheck baseline
(`TS2307: Cannot find module '../core/aura/state'`) without editing the file. The face is a standalone
page because **every** client-side mount seam belongs to another lane: `index.html` has a static module
graph, `arc.js` enumerates its panel kinds in code, and `live-swap.js` gates its dock to `/app/user/`.
Mounting the figure inside the running app is a Lane 1 change and is offered as one.
