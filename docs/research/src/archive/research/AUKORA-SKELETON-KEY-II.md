# THE AUKORA SKELETON KEY II — MEASURED AT `bd198b9`

*Second pass 2026-08-27, after a fifteen-agent adversarial re-measurement. Corrections to the first pass are marked **[corrected]** and the reasons are in §11.*

*Assembled 2026-08-27 against `aukora-deep@bd198b9b049bde46c9c52176dbe950e41c966fcc`, on a clean detached worktree, macOS 26.1 arm64 (M4, 16 GB), Node v22.23.0.*

**This document does not amend [AUKORA-SKELETON-KEY.md](AUKORA-SKELETON-KEY.md).** That record is pinned to a different repository at HEAD `aa3e655` and to grant v2, and its own header says it is not current implementation authority. Editing a frozen record to carry new findings is the representation drift this project keeps catching in others. This is a successor, separately pinned, and it inherits nothing.

**Publication correction, 2026-08-28:** one absolute local path in a `realpath` transcript was replaced with `<checkout>` before publication. No subject, digest, command result, or finding changed.

Every number here came from a command run while writing. Where a reviewer's published claim disagreed with the tree, the tree won and the reviewer is named by their claim text. **That includes claims this author published**, recorded in §1 with the rest.

---

## 0 · Why this document exists

Nine independent reviews of the same three pinned subjects arrived within one day. They agreed on the architecture and contradicted each other on the facts. Agreement among reviewers has no evidentiary value; the useful product of nine reviews is the set of places they disagree, because that set is exactly where someone did not run the command.

Three things came out of resolving them, and none of the three was in any single review:

1. One of the four published "core digests" is **collidable on the real tree**, demonstrated.
2. The proposed cell-identity function **cannot distinguish an isolated guest from one sharing memory with a sibling**, demonstrated.
3. The empty-intersection invariant is **not unmeasurable on this host — it is measurably FALSE**, and the four objects it names were all read by an unprivileged process at the modes the design specifies.

---

## 1 · Correction ledger

Errors found in published reviews, including this author's. Each is stated as the claim, then the measurement.

**1.1 — `scripts/run-gate.mjs` has zero occurrences of "inconclusive".** *(This author's claim. False.)*
```
grep -ic inconclusive        scripts/run-gate.mjs  -> 35
grep -c  INCONCLUSIVE_STATUS scripts/run-gate.mjs  -> 11
grep -c  EXIT_INCONCLUSIVE   scripts/run-gate.mjs  ->  0
```
The gate defines `INCONCLUSIVE_STATUS = 78` at `scripts/run-gate.mjs:52`, dispatches it as a distinct non-green verdict at `:138-159`, propagates it to its own exit at `:981`, and cross-checks it rather than trusting it at `:893-923`. The zero was a grep for `EXIT_INCONCLUSIVE` — the *court's* constant name, not the gate's. **A narrow grep was published as a broad absence.** That is the defect class this repository is built to catch, committed in a document about catching it.

Worse than the error: the mechanism nominated as a vacuous green is the one machinery in the tree built specifically to prevent vacuous greens. `courts/harness/composition-closure/run.mjs:205` sets `inconclusive = subjects.n === 0` so an empty subject set can never print `held`, and its banner at `:913-917` says why.

**1.2 — "41 packages import `node:fs`".** *(This author's claim. Wrong number, right direction.)*
```
ls -d packages/*/*/src                                      -> 228
grep -rl "from 'node:fs"  packages/*/*/src | pkg-unique     ->  48
grep -rl "from 'node:fs'" packages/*/*/src | pkg-unique     ->  31
grep -rl "from 'node:child_process'" packages/*/*/src       ->   7
```
Neither 41. The correct figures are 48 of 228 including `node:fs/promises`, 31 for the exact specifier.

**1.3 — "the four web tool packages contain zero files mentioning grant/capability/aukora".** *(This author's claim. Half wrong.)* `grant` and `aukora` are genuinely zero in all four. `capability` appears 2–4 times per package — every hit is the phrase "web capability seam" in a README or `package.json` description, e.g. `packages/web/web-fetch-http/package.json:3`. **No `.ts` source file in any of the four matches any of the three terms.** The intent survives; the stated measurement did not.

**1.4 — "`registerIssuerBridge` is gated near line 289".** The gate is `packages/governed/memory-put/src/index.ts:279`, the call `:280`. Line 289 is a closing brace in the `defineTool` parameters block. The substance holds and is worth restating: the `if` has **no `else`**, `issuerSocket?: string` is optional so config validation cannot reject its absence, and grep for `logger`/`.warn(`/`console.` across that file returns zero. A governed boot with no issuer socket disables the authority path and says nothing.

**1.5 — "`registerIssuerBridge` has zero non-test callers".** *(In-tree archive documents, `archive/reviews/VERIFY-AUMA-20-COMMITS.md:24,71`.)* False at this pin — `src/index.ts:280` is a real caller. Those documents describe an earlier tree and propose adding the call as a fix at `:82`.

**1.6 — "vendored at `vendor/README.md:15` as cordis 4.0.0-rc.7".** Line 15 is the `cosmokit/` row; cordis is `vendor/README.md:17`. Version and SHA were right.

**1.7 — "vendored as `@deepseek-ai/cordis` 4.0.1".** Correct as the shipped manifest field, incomplete as an identity. Both reviewers read different files and neither conflict was real:

| field | value | source |
|---|---|---|
| shipped package version | `4.0.1` | `vendor/cordis/package.json:4` |
| upstream version copied | `4.0.0-rc.7` | `vendor/README.md:17` |
| upstream SHA | `56b3d4f725681cf4556c1a8695a709cc3b6eed74` | `vendor/README.md:17` |

`vendor/README.md:5` asserts that "upstream version numbers are deliberately unchanged, so the manifest below still reads as an upstream snapshot." **For cordis that sentence is false**, and `4.0.1` does not exist upstream at the pinned SHA. A third party resolving "cordis 4.0.1" cannot recover the bytes.

**1.8 — "the paper pins MEASURED to `4adb7dc` at `docs/AUKORA-BOUNDARY-ARCHITECTURE.md:37`".** True of the copy on `bd198b9`. **False of the paper subject itself**: at `4adb7dc`, line 37 still reads `aukora-deep@[FINAL_INTEGRATION_SHA]` with `[FINAL_DARWIN_GATE_TALLY]`. The pin was filled in afterwards by `fbe46fa` / `24e88fc` / `d3121e0`. The paper at its own pin does not self-pin.

**1.9 — "the Aura chain returns ok:true for an empty *or missing* file".** Empty: true. Missing: false — `ENOENT` maps to `record:truncated` at `aukora/aura/record.mjs:190`. Also, the function is at `:162`, not `:130-149`, and the field is `count`, not `length`.

**1.10 — "no code path answers the issuer's stdin challenge".** Correct for product and UI code. **Wrong tree-wide**: three test files and two courts answer it programmatically (`tests/issuer-approval.spec.ts:172…`, `tests/live-dispatch.spec.ts:199`, `courts/harness/launch-ceremony-topology/run.mjs:680`, `courts/harness/wysiwys-issuer/run.mjs:293`). The structural fact survives intact and is conceded in-tree at `packages/governed/memory-put/README.md:53`: a LaunchDaemon has no human input carrier.

**1.11 — the sci-fi tier.** A promotional document circulated to the crew describes a "27-State Chiral Lock", a "3B Tetrahedron", ternary weights, and 218.2 tokens/sec. Measured against the tree: `tetrahedron` 0 files, `chiral` 0 files, `BitNet` 0 files. `27-state` returns exactly one hit — `archive/research/AUKORA-SKELETON-KEY.md:1248`, **which is the quarantine autopsy of that idea**, banner-dated `QUARANTINED 2026-08-09`, recording that a 27-state cell is log₂27 = 4.75 bits across eight fields of which three are bijective with one another, that the phase→cell map is "quantisation, not a bridge, and not a finding", and that its convergence court generated its own samples and graded itself. **A killed idea returned as a headline through a promotional document.** The record already contained its own refutation; nobody read it.

Claims that survived every check are listed in §7.

---

## 2 · The WASM lab

A circulated proposal names WebAssembly micro-cells as the "real Move 37", on the grounds that WASM has "ZERO ambient access to files, network, or OS" and starts in 0.2 ms. The proof offered was an eight-byte empty module and a hand-written JavaScript `spawnChild` function that throws. Neither is evidence: a module with no code and no exports cannot demonstrate isolation, and a JS function refusing an argument demonstrates only that its author wrote a refusal.

Real modules were hand-encoded (type/import/function/memory/export/code sections, LEB128) and run on Node v22.23.0.

| # | Test | Measured |
|---|---|---|
| T2 | unresolved import at instantiation | **TRAPS** — `TypeError: Import #0 module="env": module is not an object or function` |
| T3 | import supplied but not callable | **TRAPS** — `LinkError: … function import requires a callable` |
| T4 | guest with exactly one import, whose closure holds a host secret | guest reached the secret by calling its only import |
| T5 | attenuating an import from inside the guest | **no such operator exists in WASM** |
| T6 | instantiate cached trivial module ×1000 | 0.0011 ms each; compile+instantiate 0.0015 ms |
| T8b | zero-import module, memtype with **no declared max**, pages touched | linear memory **384 MiB**, host **RSS +390.4 MiB** |
| T8c | same module, memtype `max = 4` | `grow` returns `-1` at the fourth page |
| T10 | `new WASI({preopens}).getImportObject()` | **46 imports, 31 filesystem-shaped** (`fd_*`, `path_*`) |

**T2 and T3 confirm the claim's true half.** An import the host did not supply is a link-time refusal, not a runtime surprise. That is a real and useful property.

**T4 is the correction.** The membrane is the host import table, not the engine. A guest holding one import holds whatever that import's closure holds. WASM contributes the *shape* of the boundary and none of the *policy*.

**T5 matters for the nesting story.** "A child cell can only shrink its permissions, never expand them" is not a WASM guarantee. It is four lines of host JavaScript that somebody has to write, test, and keep correct — and if they get it wrong the engine will not notice.

**T8b is the finding the proposal misses entirely.** A module with **zero imports** moved host resident memory by 390 MiB. "Zero ambient access" is true of named capability and false of resources. T8c shows the fix is not in the host's import table at all: the bound lives in the module's own declared memtype, so **the host must validate the memtype limits of a module before instantiating it** — a check nobody in the correspondence mentioned.

**T10 is the practical ceiling.** A cell with no imports computes and nothing else; it cannot read a file, open a socket, or emit a proposal. To be useful it needs imports, and the ordinary way to give a WASM guest useful I/O is WASI — which is not a narrow grant but a POSIX-shaped table of 46 functions, 31 of them filesystem-shaped, handed over in one call from one preopen. **WASI is the opposite of an attenuated import table.**

**Timing.** 0.0011 ms is real and meaningless: it is a three-instruction module with a cached compilation. It does not predict a real guest, and it does not transfer to wasmtime or a V8 isolate. Do not quote it.

### 2.1 The cell-identity function does not identify cells

The proposal offers:

```
CellId = SHA256( moduleDigest ‖ importTable ‖ activationDigest ‖ liveGrantSet )
```

with the demonstration hashing `Object.keys(importTable).sort()`. Measured:

```
cellId(private memory A)          3821e1300cb7a502
cellId(memory A shared w/ sibling) 3821e1300cb7a502
cellId(private memory B)          3821e1300cb7a502
all three identical: true
```

A `WebAssembly.Memory({shared: true})` is an ordinary import. Two cells share one only if the host passes the same object to both — so it is an attenuation bug, not an engine hole. But **an import table keyed by name cannot express object identity**, and the proposed CellId therefore assigns one identifier to a cell in solitary confinement and a cell wired to a sibling through shared memory. The identity function cannot see the channel.

That is the narrow defect. The broad one is that three of its four inputs do not exist:

| CellId input | in tree | evidence |
|---|---|---|
| `moduleDigest` | **ABSENT** as a value | zero occurrences; nearest relative is the frozen source-graph digest, which `docs/AUKORA-BOUNDARY-ARCHITECTURE.md:275` states is compared by neither issuer nor broker |
| `importTable` | **ABSENT** | zero occurrences repo-wide |
| `activationDigest` | **ABSENT from code** | 8 hits, all prose in the paper; `:148` — "not fields silently added to grant v3"; `:360` status `SPECIFIED` |
| `liveGrantSet` | **ABSENT** | zero occurrences; nearest is the nonce book's set of *spent* nonces per state dir, `aukora/host-dsh/src/nonce-book.mjs:61` |

Hashing four inputs of which three have no value yields a stable-looking identifier that binds nothing. **Name the custody domain and measure the intersection before hashing it.**

### 2.2 The one-liner that ends the import-table story on Node

```
$ node -e "console.log(typeof process.getBuiltinModule('node:child_process'))"
object
$ node -e "console.log(process.getBuiltinModule('node:child_process').execSync('id -u').toString().trim())"
501
```

No `import`. No `require`. No mounted plugin. `process.getBuiltinModule` is a property of the Node runtime, not of the composition, and it is untouched by unmounting every governed plugin in the tree. Any CellId that binds a *declared* import table does not bind `getBuiltinModule`, dynamic `import()`, or a reference captured before disposal.

This is the same limit the vendored Cordis paper states at `references/Cordis.md:2391` and the paper concedes at `docs/AUKORA-BOUNDARY-ARCHITECTURE.md:73`.

### 2.3 Verdict on Move 37

WASM is a real guest engine with a real link-time refusal and no ambient named capability. It is **a candidate guest runtime for the Boundary Lab, not the boundary**, and specifically:

- it does not hold the root key, so it is not the issuer;
- it does not own the pixels, so it cannot make the click unforgeable;
- it does not create a second principal, so it does not close the uid row;
- and with an unbounded memtype it does not even close resource authority.

The genuinely load-bearing sentence in the correspondence is the smaller one: **do not let the guest become the monitor.** WASM is one way to start a guest at zero. It is not the wall.

---

## 3 · The four core digests

Four reviewers published four different "core digests" for `aukora/` at this pin. All four recompute exactly. None of them conflict, because all four measure different objects — and one of them is broken.

| claimed | recomputed | covers |
|---|---|---|
| tree sha `5316604baab740ebad561539e642c8f2ad355aff` | **MATCH** | all 32 tracked files **plus paths, modes, structure** — a recursive Merkle tree; the only one that binds names to content |
| concat sha256 `fed7eba1bc53c5a3c132afc84a8eb8c5de1f373b798286e57b3df76492e8a790` | **MATCH (value) / BROKEN (construction)** | content bytes of 32 blobs, no framing, no names |
| `FROZEN_VERIFIER_SHA256` `2c5a0625…489ff0` == `computeVerifierDigest()` | **MATCH, `true`** | **14 of the 19 executable `.mjs` modules**, static relative imports only **[corrected]** |
| six per-file sha256 (`broker.mjs`, `issuer.mjs`, `effect.mjs`, `operation.mjs`, `memory-put-args.mjs`, `record.mjs`) | **all six MATCH in full** | 6 of 32 files, bytes only |

### 3.1 The concatenation digest is collidable — but it is a reviewer's pipeline, not the repository's **[corrected]**

Read this section with its scope: the construction below was published by a reviewer as a core digest. **No code in the repository uses it.** Every multi-file digest the tree actually computes is path-keyed or length-framed — `verifier-bytes.mjs:172` with per-node `{path, byteLength, sha256, sourceBase64}`, `run-gate.mjs:351-357` with an 8-byte big-endian length prefix, `executable-configuration/run.mjs:150-162` path-keyed. The repository's own instruments are built correctly. What follows kills a number that circulated in review, and must not be reported as a defect of the tree.

The pipeline concatenates blob contents with no length framing and no path input. Moving **500 bytes** out of `aukora/broker/confinement.mjs` into its sort-order predecessor `aukora/broker/broker.mjs` — 60794→61294 and 27011→26511 bytes — leaves the digest at `fed7eba1…e8a790`, **unchanged**. Two production authority files rewritten; digest identical. Per-file hashes do move, so a manifest catches it.

Confirmation that paths contribute nothing: `find aukora -type f | LC_ALL=C sort | xargs cat | shasum -a 256` yields the identical value.

**Do not use this construction as an integrity pin.** It is the one place in this whole correspondence where a published number is not merely incomplete but actively wrong as an instrument.

### 3.2 The frozen verifier digest does not hash itself

`aukora/host-dsh/src/verifier-bytes.mjs` walks static relative imports from two roots (`broker/broker.mjs`, `issuer/issuer.mjs`) and serialises `{format, roots, nodes[{path, byteLength, sha256, sourceBase64}], localEdges, externalEdges}` at `:228-234` — 14 nodes, 35 local edges, 31 external. It skips `import(` at `:116` and resolves `.mjs` only at `:152`. `node:` builtins are recorded as **specifier strings**; the implementations are outside the digest, as documented at `:12-13`.

**Five of the nineteen executable modules are uncovered [corrected]** — `aura/merkle.mjs`, `guest/guest.mjs`, `supervisor/topology.mjs`, `supervisor/bin.mjs`, and, unreachable from either root, **`verifier-bytes.mjs` itself**. The file that defines the digest is not inside the digest. `aura/merkle.mjs` carries its own MEASURED row at `docs/AUKORA-BOUNDARY-ARCHITECTURE.md:350` while sitting outside the anchor.

*(The first pass said "18 of 32". That counted `.d.mts` declaration files and `package.json`. 14 of 19 executable modules is the meaningful ratio; both denominators are real, only one is informative.)*

**The graph's tokenizer cannot see `process.getBuiltinModule`, and two kernel nodes use it — but not as a bypass. [corrected]**

The tokenizer at `verifier-bytes.mjs:108-140` recognises only `import` and `export` word tokens, so a call to `process.getBuiltinModule` records no edge. Two nodes call it:

```
aukora/broker/effect.mjs:238   process.getBuiltinModule('fs').readFileSync(source)
aukora/broker/broker.mjs:1208  process.getBuiltinModule('crypto')
```

A second-pass lane reported this as ambient reach escaping the anchor. **It is not, and the overstatement is recorded here rather than repaired silently.** `effect.mjs:15-18` statically imports `node:fs` — `readFileSync` among the named bindings — and `broker.mjs:45` statically imports `node:crypto`. Both edges are in the graph:

```
{"from":"broker/effect.mjs","kind":"import","ordinal":1,"specifier":"node:fs"}
```

Neither call site reaches a capability its module has not already declared and the graph has not already recorded. And both are *deliberate hardening*: `broker.mjs:1205` states the reason — *"Bound at call time so a poisoned parent cannot pre-empt this module's import."*

The finding that survives is about the instrument, not the kernel: **`getBuiltinModule` is a hole in the tokenizer's coverage, and today nothing in `aukora/` stands in it.** A future module that reaches a builtin it never imports would be invisible to the anchor, and no gate would notice. That is worth a disclosure line in the paper and a court row; it is not a present breach, and reporting it as one would be the same defect this document exists to catch.

### 3.3 Nothing compares any of this at runtime

The only comparison in the repository is `courts/harness/verifier-bytes/run.mjs:81`. No production file imports `verifier-bytes.mjs`; that is independently confirmed by the graph, since the module is not reachable from its own roots. The digest-shaped identifiers inside production (`broker.mjs:632,1172`, `issuer.mjs:330`, `bridge.ts:95-99`) are per-request operation/receipt/grant digests — data integrity, never code identity.

### 3.4 So what actually makes product and lab "the same core"?

A symlink on one side and raw relative imports on the other. **[corrected]**

```
packages/governed/memory-put/node_modules/@aukora/core -> ../../../../../aukora
realpath -> <checkout>/aukora
```

`@aukora/core` is a pnpm workspace member, declared `workspace:^` at `packages/governed/memory-put/package.json:27,37`, aliased at `tsconfig.base.json:31`, and `aukora/package.json` is a bare passthrough — `private: true`, `exports: {"./*": "./*"}`, no build step, no `files` field.

That is the *product* side, and structurally it is byte-identity — better than a copy. The **lab** side is a different mechanism: `archive` is not a member of `pnpm-workspace.yaml`, and `archive/lab/broker/broker.mjs:12`, `archive/lab/gatekeeper.mjs:2` and `archive/lab/kernel/verify.mjs:22` import the kernel by raw relative path. So the core enters two consumers by two unrelated routes, and `pnpm-lock.yaml:4826` records the product route as `version: link:../../../aukora` with **no integrity hash**. Neither route is digested. The first pass said "a symlink" and measured only the product side. **Answer to "is there a published digest a third party could pin to prove product and lab share the authority core?" — NO.** The tree sha and the concat digest appear zero times in the repository; they exist only in reviewer reports. `2c5a0625` appears exactly once, at `verifier-bytes.mjs:41`, inside the tree it measures, which makes it self-attesting rather than third-party pinnable. There is no `SHASUMS`, no signed manifest, no per-file hash artifact — and no running process compares any value.

The kernel is at least clean enough for this to be worth fixing: 32 files, 5767 lines, and

```
grep -rnoE "from '[^']+'" aukora/ | grep -vE "'(node:|\./|\.\./)"   -> (no output, exit 1)
grep -rn "@deepseek-ai\|node_modules\|require(" aukora/             -> (no output, exit 1)
```

Zero npm dependencies, zero harness imports. Nothing binds the core to either host.

---

## 4 · The custody measurement

### 4.1 What a grant binds

`grantPreimage`, `aukora/host-dsh/src/grant.mjs:94-105`, canonical JSON over exactly eight fields: `domain` (`aukora:tool-grant:v3`), `tool`, `digest`, `nonce`, `exp` (ceiling `MAX_TTL_SECONDS = 3600`), `definitionId`, `operationDigest`, `receiptKeyId`. `GRANT_KEYS` is closed at `:126` and enforced at `:141` and `:189`.

**Absent: `activationDigest`, `compositionRoot`, `brokerIdentity`, `stateDir`, `epoch`, `rendererDigest`, `importTable`** — all seven, zero occurrences in code.

`receiptKeyId` is sha256 over the SPKI DER of the settlement **key bytes** (`grant.mjs:58-61`). That names key bytes, not a broker process. A second real broker carrying a copied key and a fresh state dir settles the same grant: the expected id is derived from bytes at `broker.mjs:416`, and the nonce book is opened per state directory at `broker.mjs:413` with an empty set at `nonce-book.mjs:61`. The claim file is `<stateDir>/nonces/<nonce>` and its record is `{nonce, exp, pid, ts}` — **no broker identity, no host id, no epoch**. The atomic step is `linkSync(candidate, path)` at `nonce-book.mjs:130`; the `openSync(candidate, 'wx', 0o600)` at `:122` creates the *private candidate*, not the claim. **Four places in the tree describe the rejected wx-at-final-path mechanism instead** — `docs/specs/BRICK-1-GRANT-AUTHORITY.md:128`, the `grant.mjs:277` JSDoc, and both language versions of `.agents/notes/proposed/architecture/2026-08-25-mission-envelope-frozen-semantics.md:133`, the last of which also cites the wrong line. The source comment three lines from the real call states why wx-at-final-path was rejected. This is already enrolled as a known breach.

### 4.2 The approval prompt, and what it binds

Four line citations from one reviewer verify exactly, the only perfect citation record in the set: `aukora/issuer/issuer.mjs:223` stderr prompt `approve? type "yes ${challenge}"`, `:259` `issuer:approval-answer-mismatch`, `:283-285` 30 s timeout, `:298` `randomBytes(8)` = 16 hex.

The challenge is armed **before** the operation is displayed — `:298` generate, `:299` `readHumanApproval(signal, \`yes ${challenge}\`)`, `:300` render. And it is **not bound into the grant**: `challenge` returns zero hits across `grant.mjs`, `mint.mjs`, `operation.mjs`, `review.mjs`. The binding chain is *operation → digest → signature*, never *terminal bytes → signature*; the issuer computes `presentedDigest` before rendering (`:334-335`) and re-verifies the returned artifact against it (`:350-359`, failing `issuer:presented-signed-drift` at `:361`). The paper states this limit honestly at `docs/AUKORA-BOUNDARY-ARCHITECTURE.md:209`: it does not parse or hash literal terminal text after display.

So the challenge is a **liveness token for the stdin channel**, not a WYSIWYS binding. It proves someone read a fresh 16-hex string off a terminal. It does not prove the bytes they read described the operation that got signed — that is carried by the digest chain instead, which is a different and weaker guarantee than "what you saw is what you signed."

### 4.3 The empty intersection is FALSE, and it was measured

The proposed invariant:

```
guest.reachable ∩ { issuerKey, nonceBook, receiptKey, issuerSocket } = ∅
```

Fixture built at the modes the design specifies — issuer key `0600` in a `0700` dir, broker key `0600`, nonce book with a claim file, live Unix socket `chmod 0600` in a `0700` dir. A plain `node` process at uid 501, no privilege:

```json
{ "uid": 501, "euid": 501,
  "issuerKey":    { "reached": true, "evidence": "FAKE-ROOT-KEY-BYTES" },
  "receiptKey":   { "reached": true, "evidence": "FAKE-RECEIPT-KEY" },
  "nonceBook":    { "reached": true, "evidence": { "entries": ["aa"] } },
  "issuerSocket": { "reached": true, "evidence": "ISSUER-REPLY" } }
```

**All four reached.** The intersection is not merely non-empty; it is the entire set. The modes are correctly implemented and enforce nothing, because guest, broker and issuer are one uid wearing three hats. The tree already says this in as many words at `courts/harness/launch-ceremony-topology/run.mjs:405-407`: *a mode is not a denial; 0600 denies nobody when the reader is the owner, and the only way to know is to call `open(2)` and see what comes back.*

This matters for how the finding is reported. **"Unmeasurable on this host" is the kinder answer and it is not the true one.** The invariant is measurable, it was measured, and it is false. What is unmeasurable here is whether any enforcement backend could make it true.

**And the repository says it first, in the right words. [corrected]** `courts/known-breaches.json:257`: *"That is evidence of CO-LOCATION and is NOT evidence that a real four-uid deployment would deny the same calls."* The paper concedes the same at lines 87, 219, 323, 363, 383, 386 and 390. The modes are 0600 files in 0700 directories and they are *correct*; what the probe measures is that three principals are one uid, not that anything is misconfigured. Reporting it as a new breach would be re-discovering a conceded limit — the failure mode §0 names. The finding worth keeping is narrower: the invariant has never been written down as a checkable object, so nothing goes red the day the co-location ends and someone gets it wrong.

### 4.4 Backend availability on this host

```
id -u                 501            uname   Darwin 25.1.0 arm64      sw_vers  macOS 26.1
setpriv               not found      unshare not found                bwrap    not found
sudo                  present (password required — not invoked)
sandbox-exec          present, probes clean
docker                binary present, daemon not running
WebAssembly           zero-import instantiate OK
```

| backend | this host |
|---|---|
| POSIX uid drop | **IMPOSSIBLE unattended** — no `setpriv`, no `unshare`; only route is `sudo` with a password |
| Landlock | **IMPOSSIBLE** — Linux LSM; `packages/sandbox/sandbox-local/src/index.ts:160-161` lists it under `linux` only |
| VM | **IMPOSSIBLE as configured** — no hypervisor tooling; the one docker binary has no daemon |
| WASM zero-import | **AVAILABLE** — and has no consumer in the tree |
| **Seatbelt (`sandbox-exec`)** | **AVAILABLE** — the fifth backend the four-way proposal omits, and the only OS-level confinement that works on this machine today |

Seatbelt's own recorded ceiling, `archive/research/BRICK-0-HANDOFF.md:809`: as used it denies file-write only, and `networkRestricted` must report `false`.

### 4.5 No type names any of this

```
CustodyDomain  ZERO   mayMint  ZERO   maySettle  ZERO   mayWiden  ZERO   CellId  ZERO
attenuat       7 hits, none in source (5 in the frozen skeleton key, 1 in references/, 1 console.log)
```

One live union comes close — `TopologyPrincipalName` at `aukora/supervisor/topology.d.mts:1`, `'human-session' | 'issuer' | 'broker' | 'guest'`, consumed by `topology.mjs`. Eight further principal/custody types exist in `docs/specs/BRICK-0-CONTRACT.ts` and **none are live**: its own header says *SPECIFICATION ARTIFACT — NOT A BUILT PACKAGE*, nothing imports it, it is in no `tsconfig*.json` and no gate, and the two courts that reference it read it as text.

The nearest existing thing to the invariant is already a compile-time check — `BRICK-0-CONTRACT.ts:1668`:
```ts
export type GovernanceFactSourceIsNotGuestReachable =
  AssertEmpty<Extract<GovernanceFactSource, GuestReachableSource>>
```
But it ranges over configuration sources (`profile-manifest`, `patch-layer`, `guest-environment`, `guest-argv`), **not** over `{issuerKey, nonceBook, receiptKey, issuerSocket}`, and no gate runs `tsc` on the file.

### 4.6 What the guest inherits at spawn

`scrubEnv` is a **denylist, not an allowlist** — `aukora/broker/broker.mjs:126-133` iterates every entry and skips only the names in `STRIPPED_ENV` (`:104-118`: `NODE_OPTIONS`, `ELECTRON_RUN_AS_NODE`, the `AUKORA_*` triple, the peer-token pair, `LD_*`/`DYLD_*`, `OPENSSL_CONF`/`OPENSSL_MODULES`). Everything else — `DEEPSEEK_API_KEY`, cloud credentials, `HOME`, `PATH` — passes through. The broker spawn also opens an **IPC channel on fd 3** (`broker.mjs:1248`, `stdio: ['ignore','pipe','pipe','ipc']`).

Exactly one spawn site in the tree uses a replacement environment: `aukora/supervisor/topology.mjs:433-435`, `{PATH:'/usr/bin:/bin', LANG:'C', LC_ALL:'C'}`. The guest spawn in the topology court (`courts/harness/launch-ceremony-topology/run.mjs:356`) passes **no `env` key at all** and inherits `process.env` wholesale.

---

## 5 · Vacuous greens, ranked

Seven now. Five confirmed, one refuted, one misfiled. The strongest was found in the second pass and outranks everything in the first.

**0 — the paper's `2 skipped` were the only cross-UID court, and it could not have run. [new]**
`scripts/run-gate.mjs:79-82` lists `uid-confinement` and `uid-confinement --mutate` as the only skippable ordinary runs, so the gate tally `23 passed / 2 skipped` decomposes exactly: the two skips are both runs of the one enrolled court that exercises a second UID. At the paper's pinned subject that court was crash-broken:

```
$ git show 4adb7dc:courts/harness/uid-confinement/run.mjs | grep -n readFileSync
234:  const brokerKeyRecord = JSON.parse(readFileSync(join(stateDir,'keys','broker.json'),'utf8'))

$ git show bd198b9 -- courts/harness/uid-confinement/run.mjs
-import { mkdtempSync, ..., cpSync } from 'node:fs'
+import { mkdtempSync, ..., cpSync, readFileSync } from 'node:fs'
```

`readFileSync` was used at line 234 and never imported. The Darwin gate never noticed because `run.mjs:91-98` exits 77 long before line 234. So the paper's line 37 — *"Linux was not measured for this revision"* — understates its own position: at `4adb7dc` a Linux run would have raised `ReferenceError`, not returned a verdict. **The cross-UID measurement was not merely unmeasured; it was unobtainable.** The import was added in `bd198b9`, the very commit this document is pinned to.

This is the highest-value green in the set because it reads as a benign platform gate and is in fact the whole second-principal question.

**1 — `loader-profile.spec.ts` skips the entire security claim when `lib/` is unbuilt.** `packages/governed/memory-put/tests/loader-profile.spec.ts:43-48` computes `builtProfileArtifactsExist` over four built artifacts; **four rows** are gated on it (`:90`, `:99`, `:112`, `:126`), not two — exactly the rows that assert the governed tool inventory, the absence of a model provider, that ungoverned consequential tools are absent rather than silently allowed, and that `memory.put` fails closed. On this pinned tree all four artifacts are **ABSENT**. What survives is a manifest-shape check (`:81`) and a disposal probe (`:143`), neither of which mounts anything. `pnpm run test` is `vitest run` with no build step (`vitest.config.ts:90-95` collects the file) and exits 0.

The compensating control is real and lives elsewhere: `scripts/run-gate.mjs:54-75` builds the artifact plane at `:703`, one line before the court loop, and `courts/harness/live-dispatch/run.mjs:37-40` pins `pending: 5` and `pending: 0` so a degraded run turns the court red. **That is exactly why this is the most dangerous of the six** — the green a developer sees comes from a command that has no such control.

**2 — the mutation battery is off by default.** `live-dispatch.spec.ts:1044` `describe.skipIf(!MUTANT)` with `MUTANT = Boolean(MUTANT_ENTRY && SENTINEL_PATH)` (`:40-45`). Row counts by reading: main block 33 rows, mutant block 5 (`:1082` control, `:1090` forged, `:1105` expired, `:1119` replayed, `:1137` argument-mutation) = 38. The 33 that do run all pass against an intact broker — which is precisely the condition under which a suite with no discriminating power still goes green. Ranked second because vitest prints the pending count, the court pins it, and CI does run the `--mutate` arm (`run-gate.mjs:23`, `:704-710`, `.github/workflows/gate.yml:15`).

*(The reviewer who quoted `skipIf(MUTANT)` was reading `:412` — the main suite, which is skipped in the mutant run. Both strings are in the file.)*

**3 — the packaging acceptance headline.** `provenance/MACOS-SOURCE-PREVIEW-ACCEPTANCE.md:35` reports "38 total, 33 passed, 0 failed, 5 pending" and `:38` states "This acceptance did not run the court's separate `--mutate` arm." Both true, three lines apart, **and never connected**: the reader is not told that the five pending *are* the mutation battery. Every claim is accurate and the composition misleads.

**4 — an empty Aura chain verifies.** `aukora/aura/record.mjs:196-216`: `raw === ''` short-circuits the truncation check, `filter(Boolean)` drops empty lines, the loop never runs, and the function returns `{ok: true, count: 0}`. A newline-only file does the same. Ranked last because it is latent — every grading site pairs `ok` with a nonzero count and a hash equality (`courts/harness/spine/run.mjs:152,178`, `courts/harness/aura-record/run.mjs:126`), and `count: 0` is the legitimate genesis state `appendEntry` needs (`record.mjs:135-139`).

Two facts about that function are worth keeping separately: **the chain carries no signature at all** — it is hash-linked only (`record.mjs:62-64`) and the only key-derived value in an entry is `receiptSha256` (`broker.mjs:632`). An `ok` means "these bytes are internally hash-consistent" and says nothing about who wrote them. And a coherent suffix deletion also verifies `ok: true` — guarded, separately, by the broker's sequence witness at `broker.mjs:613-615`. The module self-discloses both limits at `record.mjs:21-27`.

One live swallow found while checking: `tests/live-dispatch.spec.ts:399-402` collapses a failed verification to the same `0` as an empty chain (`chain.ok ? chain.count : 0`). Not vacuous in the default ordering, but the refusal reason is discarded.

**Misfiled — the pnpm bootstrap.** `PKG/scripts/macos-preview.mjs:153-163`: `pinnedPnpmArgs` places `--ignore-scripts` **after** the `--` separator, so it is consumed by pnpm, not by the `npm exec --yes --package=pnpm@11.7.0` that downloads and installs pnpm into the `_npx` cache. The tool that will enforce containment is fetched from the registry with lifecycle scripts enabled, before any containment exists. The closed environment forecloses every config route (`:198-211`, `NPM_CONFIG_USERCONFIG: '/dev/null'`, an asserted-absent global config at `:289-291`) and yet leaves this open. The later `rebuild --pending -r` at `:328` is deliberate and correctly sequenced after `auditResolvedGraphOutput`. **This is a real supply-chain gap and worth fixing — it is not a vacuous green**, because nothing here is a passing check that means nothing.

**Refuted — the gate's inconclusive plumbing.** See §1.1.

---

## 6 · Local hardware, measured

A circulated document reports "7.00 GB active footprint of the 3B Tetrahedron on Apple Silicon" and "218.2 tokens/sec speculative throughput". Nothing named tetrahedron exists in any tree. What exists on this machine:

```
llama-bench, ggml 0.13.1, Metal, recommendedMaxWorkingSetSize 12713.12 MB

| model        | size     | params | backend  | test  |            t/s |
| llama 1B F16 | 2.30 GiB | 1.24 B | BLAS,MTL | pp128 | 1580.24 ± 0.68 |
| llama 1B F16 | 2.30 GiB | 1.24 B | BLAS,MTL |  tg32 |   38.40 ± 0.31 |
```

A **1B** model at f16 generates **38.4 tokens/sec** on this M4. Token generation is memory-bandwidth bound, so a 3B at f16 — roughly three times the weight bytes per token — lands near a third of that. **218 t/s is not a generation figure for a 3B model on this hardware**; it is in the prompt-processing regime, which is a different measurement. *(The 1B number is measured; the 3B inference is stated as an inference, not a measurement.)*

Usable working set is 12.4 GB of 16 GB, so a 3B f16 fits. The footprint claim is plausible. The throughput claim is not.

---

## 7 · What survived

- Profile 8088 ships `cordis.patch.yml` and no `cordis.yml`; the launcher writes an empty root list (`apps/cli/src/profile-boot.ts:69-77,111`).
- 8088 mounts no model, agent loop, session or runner (`cordis.patch.yml:17-20`), and **mounts no approval answerer** — the `dsh-user-approval` entry at `:41-42` is the Service Definition seam, not an answerer. `next()` resolves `'unavailable'` and `bridge.ts:167-171` returns before the issuer is contacted, so **that profile can never mint a grant**. The message is `tool "memory.put" requires approval, but no approval channel is available` (`packages/core/tools/src/index.ts:1828`). The repo states this against itself at `bridge.ts:36-47` and `docs/8088-READINESS.md:85`.
- `registerIssuerBridge` is mounted behind a conditional with no diagnostic (§1.4).
- All four issuer approval line citations (§4.2).
- `packages/workspace/workspace/` is the workspace entity registry — `ctx.workspaceRegistry`, durable session-membership records, `defineTool` count **0**. The governed patch capability does not exist. Anyone who greps "workspace" and concludes otherwise is measuring the wrong package.
- The four web tool packages sit directly under `packages/web/`; `packages/web/src` does not exist. Correct paths: `packages/web/{web-fetch-http,web-search-deepseek,web-search-exa,web-search-perplexity}/`.
- No production or UI code path answers the issuer's stdin challenge.
- 10 commits separate `4adb7dc` from `bd198b9`; **3** touch `aukora/` or `packages/governed/` — `fed4d4a`, `f772b19`, `ce469af` — and **two of the three touch `src/bridge.ts`, the measured authority path itself**. Zero touch `aukora/` proper.

## 8 · Agreed by everyone, measured by nobody

One sentence recurs in all nine reviews and has no court on a running assembly: **"AUKORA sits outside Cordis as the reference monitor, and removing it fails closed."** Cordis Cor. 62 and Thm 63 are recited; no court disables the mediator on a *product launch* and shows the emitter stop while ambient `fs`/`fetch` also die. Profile 8088 does not start a broker or an issuer. Universal agreement, zero measurement — the exact shape of a claim about to be published as fact.

## 9 · Additions to the FORBIDDEN list

Until each has a court that can fail:

1. **"WASM gives the cell zero ambient access."** Say: zero ambient *named capability*; resource authority survives an empty import table (§2, T8b).
2. **"The child can only shrink its permissions."** Say: the *host* must refuse widening; WASM has no such operator (§2, T5).
3. **"Product and lab consume the same core."** Two unrelated mechanisms — an integrity-free workspace link on the product side, raw relative imports on the lab side — neither digested, neither verified by any running process (§3.4).
4. **"`sha256(cat *.mjs)` pins the core."** Collidable — demonstrated on the real tree. Note the scope: this construction is a reviewer's, and every digest the repository itself computes is path-keyed or length-framed (§3.1).
5. **"The empty intersection is unmeasurable on this host."** It was measured. It is false (§4.3).
6. **"The human clicked, so what they saw is what was signed."** The challenge is a channel liveness token and is bound into nothing (§4.2).
7. **"Unmounting the governed plugin leaves zero ambient file capability."** `process.getBuiltinModule('node:fs')` needs no import and no mount (§2.2).
8. **"Only the issuer may deposit, only the guest may redeem."** The broker has no caller identity at all — zero `SO_PEERCRED`, and its own comment says the peer echo *"does not identify a uid or exclude a relay"* (§11.2).
9. **"The handle refactor protects the grant from memory inspection."** At uid 501 the inspector is the guest's uid. The real gain is deleting the cleartext grant copy at `index.ts:316` (§11.2).
10. **"A 27-state diagnostic."** It is a 3-state classifier over a 27-state input, discarding 78.17% of the input entropy, with 0 of 27 cells backed by a subject (§11.2).
11. **"The gate is 23 passed, 2 skipped on a supported platform."** The two skips are the only cross-UID court, and at the pinned subject it would have raised `ReferenceError` (§5, item 0).
12. **Any claim sourced to `3ccb1a1` or `/workspace/first-cell-lock`.** No such object exists in any reachable tree (§11.3).
13. **Any number from the sci-fi tier** — 27-state, tetrahedron, 218 t/s, ternary weights — until it has a subject, a command, and raw output. One of them is already quarantined in this repository's own archive (§1.11).

## 11 · Second pass — fifteen agents, adversarial

The first pass was re-measured by seven independent lanes, each followed by a refuter instructed to kill findings it could not personally reproduce. Four claims died. Nine facts are new. Nothing was quietly withdrawn.

### 11.1 Killed

**The concatenation collision was scoped wrong.** The collision reproduces (twice, independently). But no code in the repository computes that digest, and every digest the tree *does* compute is path-keyed or length-framed. Corrected in §3.1. It kills a number that circulated in review; it is not a defect of the tree, and it must not enter the paper.

**"Product and lab share the core via a symlink" measured one side.** Corrected in §3.4.

**"18 of 32 files uncovered" counted declaration files.** Corrected in §3.2.

**"The renderer leaves a raw U+202E visible."** *(A reviewer's claim, not this document's — recorded because it understates the production defence in a review whose subject is what the human sees.)* `quoteReviewUtf8` at `aukora/broker/review.mjs:44-62` maps every codepoint above `0x7e` to `\uXXXX`. Measured over the full trojan operation: `render is printable-ASCII+LF only? true`, `contains a RAW U+202E? false`, `non-printable chars: 0`. The six characters `‮` appear. The defence is stronger than reported.

**"Any local uid can connect to the broker."** The premise is right — `grep -c chmodSync aukora/broker/broker.mjs` → `0`, `grep -rn umask aukora/` → zero, so the broker never sets its socket mode. The inference is wrong: `connect(2)` needs write permission and 0755 grants write to the owner only. Measured rather than assumed — bind, `chmod 0o000`, dial as the owner → `EACCES`. Darwin enforces socket permissions. Second blocker: `broker.mjs:894` creates the directory `mode: 0o700`. What survives is narrower and still worth fixing: the broker's socket access control is whatever the launcher's umask happens to be, unasserted by any code.

### 11.2 New, and load-bearing

**The broker cannot tell its callers apart.** `grep` for `SO_PEERCRED|getpeereid|peercred|getsockopt` across `aukora/` and `packages/governed/` → **zero occurrences**. The only per-connection state is `broker.mjs:225` `{ provenClass: null, peerEchoedAt: null }`, whose own comment at `:221-224` reads *"This does not identify a uid or exclude a relay."* `confinement.prove` (`:461-477`) is a bearer-token echo — `sha256(base64decode(echo))` compared with `timingSafeEqual` at `confinement.mjs:267-276`. Anyone who can reach the socket and replay the token is the issuer as far as the broker is concerned. **Any design whose safety rests on "only the issuer may deposit, only the guest may redeem" is enforced by nothing today.**

**The shipped profile can never mint, so the guest never holds a grant.** `profiles/8088-inside-out/cordis.patch.yml:37-58` mounts four plugins. The only three `approval/request` answerers in the tree are `api-proxy.ts:1363`, `acp/src/index.ts:271` and `bridge.ts:167`; the first two are whole app surfaces and are not mounted, and `dsh-user-approval` is the dispatch side, falling back to `'unavailable'` at `user-approval/src/index.ts:317-321`. `bridge.ts:171` returns before contacting the issuer unless the outcome is `allowed-once`. Therefore `authority.tickets` (`memory-put/src/index.ts:82`) is **provably always empty** in the shipped profile. A refactor that removes grant bytes from guest memory closes no live exposure *there*.

**But there is a real one nobody argued.** The full signed grant crosses the guest→broker socket as cleartext NDJSON at `packages/governed/memory-put/src/index.ts:316`. That copy exists on every governed dispatch, and the handle refactor deletes it. That is the honest case for the refactor — accident containment and multi-uid enablement — not memory inspection, because at uid 501 the inspector is the guest's own uid.

**One uid is forced by the shipped configuration, not merely by this host.** The issuer requires its socket's parent owned by its own euid and mode ≤ 0700 (`issuer.mjs:115-116`) then chmods the socket 0600 (`:444`); the broker requires its socket's parent owned by the *broker* euid (`broker.mjs:764`); the profile places both sockets in `/run/aukora` (`cordis.patch.yml:56-57`); and `bridge.ts:116` has the guest dial the issuer. Those four constraints have exactly one solution. `packages/governed/memory-put/README.md:44` states it: *"No deployment unit in this repository provisions the two uids."*

**`STRIPPED_ENV` strips the wrong variable name.** `broker.mjs:104-118` strips `AUKORA_BROKER_SOCKET`. `broker.mjs:1331` and `:1335` read `AUKORA_SOCKET`. `spawnBroker` overwrites it at `:1237` — and `spawnBroker` has zero production callers, so any other launch path inherits an ambient socket pathname the scrubber believes it removed.

**Nonce startup cost is superlinear and nothing ever retires a claim.** `openNonceBook` scans the whole `nonces/` directory once per `serve()` (`broker.mjs:413`). Two independent runs:

```
N=1,000    11.5–16.9 µs/entry
N=10,000   13.2–13.3 µs/entry   (133–207 ms)
N=50,000   43.2–43.5 µs/entry   (2.17–2.35 s, blocking)
```

Zero deletion paths for `stateDir/nonces/<nonce>` exist in the live tree. **Broker start time is a monotonically increasing function of lifetime settlement count.** One-use-forever is the correct security property and it has an unbounded storage and startup cost attached, which no document mentions.

**The nonce race holds, hard.** 1 winner of 16 across 6/6 runs at barrier spreads of 1–39 ms; also 1-of-64 and 1-of-128. The negative control works: a two-syscall check-then-write produced 3–8 winners at *tighter* barriers, so the harness can detect a broken lock. SIGKILL fuzz over 200 trials: 198 published claims, **zero** re-claims, 2 fail-safe kills before publication. A half-published claim (`nlink=2`) seeds and refuses; `nlink=3` throws `nonce-book: malformed claim entry`.

**Strip is not injective, and there is a display collision between two differently-signed operations.** At `exp=4102444800`, `{key:'deploy', value:{path:'/var/log/app.log', mode:'append'}}` against the same object with U+202E inserted before `.log`:

```
honest operationDigest : 605f52cdced8ff078b44e2b66f59b4ea3ffbbe6e568bededd61a2ebd9686c7db
trojan operationDigest : 247762343111dde85ef505cd7eca390e7b5d201b8c7d1b5470224f6986462dd2
STRIP renders byte-identical?  true
ESCAPE renders identical?      false
```

Two operations with different signed digests, one rendering. The renderer is the human's only evidence, so **a non-injective renderer makes the signature ambiguous by construction.** Escape round-trips: `unescape(escape(c)) === c` for every codepoint `U+0000..U+20FF`. This is the decisive argument for escape over strip, and it is stronger than the one that was offered. Separately, over 32 probed codepoints the proposed strip regex deletes 11 and passes 21 unchanged; Unicode `Bidi_Control` has 12 members and the class misses U+061C; the ANSI half matches only `ESC [`, so OSC-8, RIS, RI, DECSC and 8-bit C1 CSI all survive it.

**The 27-state matrix is a 3-state classifier over a 27-state input, and it has no subjects.** It factors as `f = g ∘ φ` through two derived bits; the fibers are 1/7/7/12 and `f` is constant on each. `H(input) = 4.7549` bits, `H(output) = 1.0378` bits, **78.17% discarded**. And the subject count is the real finding: zero caller-receipt producers, zero witness-receipt producers. The one real chain is `broker.mjs:608 appendEntry` plus `:616 mintReceipt`, same closure, same process — `receipt.mjs:17` says so: *"The broker attests to its own work … not an independent witness."* **Cells with a real subject today: 0 of 27.** Every cell must report INCONCLUSIVE until three independent producers exist.

### 11.3 The `first-cell-lock` report

Its subject does not exist. `git cat-file -t 3ccb1a1` → `fatal: Not a valid object name`; zero matches across `--batch-all-objects` (186 commits, 433 refs); zero refs matching `first.cell` locally or in reflog; `gh api …/commits/3ccb1a1` → `422 No commit found for SHA`; `ls /workspace` → `No such file or directory`; fifteen `aukora-*` org repos scanned for a `first*` branch → zero each. The named artifact `/tmp/swarm-real-aukora.json` is absent, in a directory holding ~30 other real `aukora-*` artifacts. `broker:grant-bytes-refused`, `broker:register-on-guest`, `broker:handle-unknown`, `grant.register`, `GovernedOperationHandle`, `handleId` — zero occurrences at `bd198b9` and zero rows org-wide, on a search control-validated by `FROZEN_VERIFIER_SHA256` returning 10 rows.

**Its one checkable claim is false, not merely unreachable.** The report says the frozen pin has drifted to `3d2c88ad1584…57ce`. At `bd198b9`, `computeVerifierDigest() === FROZEN_VERIFIER_SHA256` → `true`. `3d2c88ad` appears in zero files and in zero of 186 commits (`git log -S` empty). Only four `FROZEN_VERIFIER_SHA256` values were ever committed: `0b56f73b`, `2c5a0625`, `99cad356`, `da2475d2`.

Those are three different verdicts and they must not be blended: **unreachable** for the H/N/W/U rows, **false** for F1, and **true and valuable** for the underlying mechanisms the report describes correctly.

One row names something real. `broker:effect-outcome-indeterminate` exists at `broker.mjs:567`, `broker/run.mjs:734` and `docs/8088-READINESS.md:91`. The path the report says reaches it does not; the root framing has its own distinct code, `broker:root-euid` at `confinement.mjs:90`.

### 11.4 What the paper already concedes

Of the facts carried into the second pass, three are things the paper says about itself, and re-reporting them as discoveries is the failure mode §0 names. *Nothing compares the frozen digest at runtime* — conceded at line 275, in row 355's limitation column, and verbatim at non-claim 399: *"No claim that the frozen authority source graph binds a running issuer or broker, executed module bytes, or module resolution."* *Same-uid readability of the custody objects* — conceded at 87, 219, 323, 363, 383, 386, 390. *No published digest* — partially covered at line 370 and OPEN row 359.

Genuinely uncovered by the paper: the tokenizer's blindness to `process.getBuiltinModule` as an instrument gap (§3.2 — not a present breach), the unbound challenge, the silent conditional mount, the 14-of-19 coverage fraction, and the two-mechanism core sharing.

**The paper's self-restraint is, on the whole, more accurate than most of the reviews written about it.** That is the most useful sentence in this document.

## 10 · Reproduce

```sh
# subjects — clean detached worktrees, never the live checkout
git worktree add --detach <dir> bd198b9b049bde46c9c52176dbe950e41c966fcc

# §3 digests
git rev-parse bd198b9:aukora
git ls-tree -r bd198b9 aukora | awk '{print $3}' | while read b; do git cat-file -p "$b"; done | shasum -a 256
node --input-type=module -e "import('./aukora/host-dsh/src/verifier-bytes.mjs').then(m=>console.log(m.FROZEN_VERIFIER_SHA256, m.computeVerifierDigest(), m.FROZEN_VERIFIER_SHA256===m.computeVerifierDigest()))"

# §3 kernel purity (both must print nothing and exit 1)
grep -rnoE "from '[^']+'" aukora/ | grep -vE "'(node:|\./|\.\./)"
grep -rn "@deepseek-ai\|node_modules\|require(" aukora/

# §1.1 the correction
grep -ic inconclusive scripts/run-gate.mjs        # 35, not 0
grep -c INCONCLUSIVE_STATUS scripts/run-gate.mjs  # 11

# §2.2 the ambient one-liner
node -e "console.log(process.getBuiltinModule('node:child_process').execSync('id -u').toString().trim())"

# §4.5 the absent vocabulary (each must return nothing)
grep -rn --exclude-dir={node_modules,.git,lib,dist} "CustodyDomain\|mayMint\|maySettle\|mayWiden\|CellId\|importTable" .

# §6 local hardware
llama-bench -m <model>.gguf -p 128 -n 32 -r 2
```

The WASM lab (§2) is a hand-encoded module emitter plus three test files, run outside any worktree. It is not committed: it measures the Node runtime, not this repository, and a court that measures a runtime property belongs in the courts directory with an enrollment, or nowhere.
