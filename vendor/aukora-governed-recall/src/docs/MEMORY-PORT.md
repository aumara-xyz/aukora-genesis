# The memory port — what came from KIRA, what did not, and why

Written the same day as the port, because "the exact scope of a reduction" is exactly the kind of fact
that gets rounded down to "we ported KIRA" in the next summary. It did not. This is the honest,
line-by-line account.

**Trigger condition, quoted from `aukora-one/docs/BRICK_ORDER.md`:** *"φ has no retrieval, embedding or
memory surface today. Porting the lease-gated derivative-lineage machinery now would be governance for a
capability that does not exist. The moment φ remembers a conversation, port the minimal slice."*

φ grew a real memory surface — `surface/conversation.ts`, a plain JSONL log at
`.aukora/conversation.jsonl` — earlier in this repository's life. This port is that trigger firing.

---

## 1 · What was ported, and where it lives

| Here | Donor (`aumara-xyz/aukora-one`, `organs/kira`) | State |
| --- | --- | --- |
| `core/memory/eventLog.ts` | `src/eventLog.ts` | ADAPTED — see §2 |
| `core/memory/vault.ts` | `src/vault.ts` | ADAPTED — see §2 |
| `core/memory/erasureCertificate.ts` | `src/erasureCertificate.ts` | ADAPTED — see §2 |
| `core/memory/durableWrite.ts` | `adapters/durableWrite.ts` | ADAPTED — closely, see §3 |
| `core/memory/fileVaultAdapter.ts` | `adapters/fileVault.ts` | ADAPTED — see §3 |
| `core/memory/merkle.ts` | *(none — see §4)* | NEW |
| `core/memory/hash.ts` | *(none — see §4)* | NEW |
| `core/memory/ledger.ts` | *(none — glue code)* | NEW |

Exact donor commits and per-file digests are in `PROVENANCE.md`, in the format this repository already
uses for every other transplant.

**What came across, conceptually, from every ADAPTED file:** the event kinds' shape (drafts carry no
identifier the log must own), "NEVER ACCEPT A VALUE YOU SHOULD OWN" as the log's minting rule, the
GOVERN-BEFORE-EXECUTE ordering (a tombstone must be accepted before a key may be destroyed), the
`isReadable`/`keyMaterialSurvives` split (a retrieval question and an audit question are different
questions, and folding them together is how the donor's own K9 round shipped a completeness check that
was structurally pinned to zero), the five-component erasure certificate shape from AUMARA's provisional
filing, and the round-11 preimage-binding fix (a certificate must recompute its own leaf from a carried
preimage rather than trusting a `targetId` label sitting beside an opaque hash).

**Line count:** the seven files in `core/memory/` total roughly 1,050 lines, somewhat over the
500–800 estimate in the brief. The overrun is the Merkle layer (`merkle.ts`, genuinely new — RFC 6962
inclusion proofs are not a small primitive to get right) and the real filesystem adapter
(`fileVaultAdapter.ts`) and durable-write module (`durableWrite.ts`), neither of which has a smaller
honest version once the short-write bug (see §3) is taken seriously. `ledger.ts` (the glue wiring this to
`surface/conversation.ts`) is new and not in the donor at all.

---

## 2 · Left out on purpose: the lease/derivative-lineage system

The donor's `derive`, `lease`, and `reinsert` event kinds, its `ARTIFACT_KINDS` taxonomy, its per-object
lease-gated reads, and its multi-device identity (`deviceId`/`deviceSeq`, for merge-compatible ids across
machines) are **entirely absent** from this port.

**Why, exactly.** The donor's lease system exists to solve one problem: a `derive` event let a producer
CLAIM its own lineage (*"I read memory A and made this embedding from it"*), and nothing forced that
claim to be true — so an embedder could read A, register the artifact as derived from B, and deleting A
would leave a real, live, queryable descendant of A's plaintext with no edge pointing back to it. The
donor's fix is structural: reading is gated behind a LOGGED lease, so an unregistered derivative is
provably unreadable, because you could never have obtained the plaintext to derive it from without
registering what you read.

This reduction has **no `derive` event and no artifact taxonomy at all**. There is nothing here that
computes an embedding, a summary, a cluster, or an index entry from a memory's plaintext. The problem the
lease system solves does not exist in this reduction, because the thing that would create it does not
exist either. Building the lease system now — as `BRICK_ORDER.md` says of the whole donor slice before
this port — would be governance for a capability that does not exist.

**What is kept instead:** a `correct` event (a plain revision, `supersedes` an earlier id, no lease, no
artifact kind), because without SOMETHING for a tombstone to close over, `tombstoneClosure` degenerates to
a one-line stub that returns `[]` for every target, and the task explicitly asked for a real closure
computation, not its shape. A `correct` chain is the smallest honest thing that gives `tombstoneClosure`
something real to walk.

**If a derivative-producing feature is ever added to this ledger** — an embedding index, a summary cache,
anything that reads a memory's plaintext and writes something new derived from it — the lease mechanism
must come back with it, in full, not reinvented smaller. This file says so explicitly so that a future
session does not have to rediscover why it was there.

---

## 3 · Left out on purpose: the concurrent-write machinery, and what was kept instead

The donor's `adapters/vaultLock.ts` — a cross-process `LOCK` file with a live-pid check, an ownership
token, and (after several rounds of its own hostile review) a policy of refusing rather than stealing a
stale lock — is **not ported**. Neither is any cross-process coordination in `core/memory/ledger.ts`.

**What this means concretely:** if two separate operating-system processes are ever pointed at the same
`.aukora/memory/` directory — for example, two φ doors started against one repository — they can race
each other: both may read the log, both may append, and the loser's write can be lost. `ledger.ts`'s
header names this directly. It is a known, deliberate gap, not a silent one, and it matches the task's
instruction to leave the lock system out.

**What was kept, and why it is NOT the same thing.** `core/memory/durableWrite.ts` ports the donor's
`writeAllSync` loop and its stage/verify/flush/publish sequence (`publishFileDurably`) closely. This is
a **data-integrity fix, not a concurrency fix** — it defends a SINGLE writer against a SHORT WRITE, which
POSIX permits `writeSync` to produce even with no concurrent process anywhere in the picture. The donor's
own hostile review measured this exact failure twice, and both instances are the reason this file exists
at all:

- `fileVault.writeFileDurably('abcdef')`, under a `writeSync` landing one byte per call, published the
  ciphertext or key file as the single byte `"a"`.
- `jsonlLedger.eraseFromLedger`, under the same mock, reported `matched: 1`, issued a verifying erasure
  certificate, and published the **entire surviving ledger** as the single byte `"{"` — every other
  memory destroyed by the act of forgetting one, with a receipt saying it went fine.

`test/memory-durablewrite.test.ts` reproduces the first scenario directly (`writeAllSync` under an
injected one-byte-per-call writer still yields the complete bytes on disk) and asserts the specific
defensive checks that close it: a `writeSync` returning `0` refuses instead of looping forever, and a
`writeSync` returning `NaN` refuses rather than being read as "finished" by a naive `n < 0` comparison
(`NaN < 0` is `false`, which is exactly how that shape used to slip through).

**Am I confident this port avoids both named bugs?** The short-write bug: yes, with a test that
reproduces the donor's own measured scenario against the ported code, not merely against the idea of it.
The stale-lock-steal bug: **there is nothing here that could exhibit it, because there is no lock at
all** — `core/memory/ledger.ts` serialises writes only WITHIN one process (a plain promise queue,
documented as exactly that, not a filesystem primitive), so the specific race the donor's lock defends
against (two OS processes both observing a dead pid and both stealing) has no code path to occur through.
That is a narrower, honest claim than "the concurrency bug is fixed" — it is "the mechanism that had the
bug was not rebuilt, so the surface area for that specific bug is absent." A future session that adds
cross-process coordination here needs to re-earn that property, not assume this port already has it.

---

## 4 · The Merkle layer is new code, not a port, and what "reduced" means for the certificate

`core/memory/merkle.ts` is **not** adapted from `@aukora/kira`'s `src/logProof.ts` — that file is a thin
wrapper around `@aukora/kernel/merkle`, a package this repository does not carry and whose source was not
read for this port (`aukora-one/kernel/` is npm-workspace TypeScript built with `tsc`; grafting it into a
Bun tree is, per `PROVENANCE.md`'s own words about a different transplant, "a multi-day job"). `merkle.ts`
is a from-scratch implementation of RFC 6962 §2.1's leaf/node domain separation and unbalanced-tree split
rule, built directly from the RFC rather than from any donor file, and proven against brute-force root
recomputation across a range of tree sizes in `test/memory-merkle.test.ts`.

**What it implements:** Merkle INCLUSION proofs only. **What it does not implement:** a Merkle
CONSISTENCY proof (RFC 6962 §2.1.2) — the succinct, O(log n) proof that one tree is a strict extension of
an earlier, smaller one. The donor's certificate carries exactly this, and its own commit history names
why: *"without this the two commitments are unrelated numbers"* (KIMI, round 8) — without a consistency
proof, nothing formally binds the pre-erasure root to the post-erasure root as the same history, merely
grown.

`core/memory/erasureCertificate.ts`'s `verifyErasureCertificate` returns `extensionProved: false`,
always, and its own header names this exactly: **this reduction does not independently prove that the
post-state log extends the pre-state log.** A holder who wants that property must additionally hold the
full log and call `verifyChain` on it. What the reduced certificate DOES still prove, standalone, with
nothing but the certificate: that the named target really sat in a tree with the claimed pre-erasure
root, that the tombstone really sits in a tree with the claimed post-erasure root, and that the closure
recorded matches what the tombstone actually named (the donor's round-11 preimage-binding fix, ported and
tested — `test/memory-certificate.test.ts` asserts a forged `targetId` without a matching preimage is
refused).

**The other honest limit, inherited rather than introduced:** a certificate checked against no prior
observation is documentation, not proof of anything's timing — it is internally consistent and cannot
distinguish a real erasure from one an issuer fabricated from nothing with a fresh, self-consistent log.
The donor's own review found exactly this (`erasureCertificate.ts`'s header: *"a reviewer falsified that
in 31 lines"*) and kept the fabrication case as a passing test rather than pretending the artifact proves
more than it does. `test/memory-certificate.test.ts` keeps the same discipline.

---

## 5 · What is wired in, and what is not

`surface/conversation.ts`'s `appendTurn` — the function `recordExchange` calls twice per exchange — now
also seals the same turn into `core/memory/ledger.ts`, best-effort, into a **separate file**
(`.aukora/memory/log.jsonl`, never `.aukora/conversation.jsonl`). `test/memory-conversation.test.ts`
drives the real `recordExchange` and confirms: both stores end up populated, decrypting a sealed turn
returns the real words, forgetting a ledger entry does not touch the plaintext conversation file, and a
broken ledger (simulated by making `.aukora/memory` unopenable) does not stop the plaintext conversation
from being recorded — the same best-effort contract `conversation.ts` already states for its own write.

**Not wired in:** nothing in the running door (`surface/door.ts`) currently calls `forgetOccurrence`,
`recallTurn`, or `verifyLedger` — there is no UI verb yet for "forget this turn" or "show me the erasure
certificate for what I just asked you to forget." The ledger exists and is exercised end to end by tests;
exposing it as something the owner can click is a separate, smaller piece of work this port does not
attempt.

---

## 6 · If you are the next session reading this

Read `core/memory/eventLog.ts`, `vault.ts`, and `erasureCertificate.ts`'s own file headers before
changing any of them — each states, at the point it matters, which donor defect the code in front of you
exists to not repeat. That density of comment is deliberate, matching this repository's own house style,
and it is cheaper to read than to rediscover.

## 7 · The read side: merged from `@aukora/memory`, not transplanted

§1–6 describe the **write** half — durable write, seal, tombstone, shred, prove. What φ had no law
for was **reading**: which memories may be recalled, by whom, whether a recalled memory is still
fresh, and what a memory is permitted to be. That law existed as a pure package with no I/O,
`@aukora/memory`, and it crossed here as a **merge**: φ already owned durability, so only the read
law came, and nothing φ already had was replaced.

### What crossed, and on what terms

Donor repository `aumara-xyz/aukora` (local checkout `~/ak3`). Every file below was tracked and
clean at the commit named; blob digests are `shasum -a 256` of the donor file as it stood.

| φ file | donor | commit | blob sha256 | terms |
|---|---|---|---|---|
| `core/memory/recall.ts` | `packages/memory/src/recall.ts` | `e3628eb` | `b8c740d7ef17883e689c49658d208383f576293ad93dbbebc3bd13851d25071e` | **VERBATIM** |
| `core/memory/scope.ts` | `packages/memory/src/scope.ts` | `9c5d89e` | `49f7d2e5444e723e0c2ba21340e27f2e8c566abdb4389dcbbd923db130719eee` | **VERBATIM** |
| `core/memory/ingestGate.ts` | `packages/memory/src/ingestGate.ts` | `9dcc576` | `65bdd6a291f7e7dc7f5eab0694ec9f515a9b138b8dc91fed2d43c9d3a8179213` | **VERBATIM** |
| `core/memory/containment.ts` | `packages/memory/src/containment.ts` | `f71e562` | `bdd6d3433854fa870c087e9c329616c0cafce85a121639cbca7a65f6cf5ad885` | **VERBATIM** |
| `core/memory/envelope.ts` | `packages/memory/src/envelope.ts` | `7f2030f` | `107472bf80063af88ad1fc60f8e295899a3053c27d69dd1e6ce19a22a58aa84f` | **ADAPTED** — see below |
| `core/memory/staleness.ts` | `packages/kernel/src/staleness.ts` | `ab37835` | `d57468a95efc21eea936af001b97206ee33670fe8f07ff8d38b3335be50e9924` | **VENDORED SUBTRACTIVELY** |

"VERBATIM" is meant literally: those four files differ from the donor only in dropping the `.js`
import extension, which is φ's own style (`core/memory/ledger.ts` imports `'./vault'`). The claim is
mechanically checkable — `diff <(sed "s|\.js'|'|g" <donor>) <φ file>` is empty for each.

Tests: `test/memory-recall.test.ts` (23 assertions across envelope, recall, scope, ingest,
containment, staleness, and the merge's own properties).

### The one dependency, and why it did not cross

`@aukora/memory` depends on `@aukora/kernel` for two things. **φ has zero runtime dependencies**, and
that property is worth more than either of them.

**`canonicalHash` → re-derived.** The kernel's canonical hash imports `@noble/hashes`. So
`deriveRecordId` is re-derived against φ's own `core/memory/hash.ts`, which was already the one hash
primitive this organ uses. It is not merely a substitution — `domainHash` is **domain-separated** and
the donor's was not, so a value built to collide as a record id cannot also collide as a merkle node
or a certificate. **Consequence, stated plainly: ids minted here do not match ids minted by
`@aukora/memory`.** Nothing crosses between them today, and the property that matters — same content,
same id, forever, on any machine — holds on both sides.

The donor closed `envelope.ts` with a compile-time proof that its commitments are valid
`CanonicalValue` records. That is a kernel *type*, so the proof could not cross; the property it
protected is asserted at runtime in the test instead. A weaker moment to catch it than the compiler,
and the honest one available here.

**`staleness` → vendored subtractively.** The donor carried it as a bare re-export of the kernel
package. The law crossed; the package did not. The kernel module stands on
`parseCanonicalIsoUtcMs` from its 700-line `authority.ts` — about root keys, suites and revocation,
none of which φ needs — so **only that parser crossed, with the two civil-date helpers it stands
on.** Function bodies are verbatim. Nothing else from `authority.ts` is here, and nothing else
should arrive later by accident.

### What this does NOT do yet

**Nothing in φ imports these modules.** They are the law, landed ahead of their consumer, and this
repository has already learned what that costs — `core/aura/auraTrace.ts` is built, tested, and
imported by nothing. Saying so here rather than letting someone discover it.

What would wire it: the store φ already has (`core/memory/ledger.ts`, `eventLog.ts`) holds events,
not `MemoryRecordV1` envelopes. A consumer would build records with `buildMemoryRecord`, commit them
to the chain by `memoryCommitment` (content-free, so a later forget breaks no link), and read them
back through `recall`/`recallScoped` with the tombstoned ids as the `forgotten` set. That adapter is
a separate piece of work and is not smuggled in here.
