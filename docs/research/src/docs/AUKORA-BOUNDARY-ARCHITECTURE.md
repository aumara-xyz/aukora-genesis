# The AUKORA Boundary: Separating Action, Amendment, and Attestation in Composable Agent Systems

*A specified architecture for externally activated capability control with independently custodied evidence*

*Status: Draft for invited review · non-normative · 28 August 2026*

---

## Abstract

Autonomous agent harnesses can invoke tools, call remote models, start processes, change the code and configuration that define their own capabilities, and produce the records later used to explain those actions. When the actor, the active policy, and the surviving account remain inside one authority closure, a valid signature can authenticate—and a hash chain can make internally consistent—a self-report. The problem is not that agents lie. It is that the architecture gives them nothing to lie against.

This paper specifies the **AUKORA Boundary**, a systems architecture that separates three powers. **Action** determines which physical effects the current activation can reach. **Amendment** determines who may change the composition, executable closure, interpretation, or authority of a future activation. **Attestation** determines which observations and checkpoints survive outside the actor's rewrite authority. The core rule is:

> **The agent may propose a successor activation, but no authority crosses an amendment boundary, and nothing inside the current activation may activate its successor.**

The proposed architecture joins an externally activated constitution, operating-system capability deprivation, exact-operation grants, check-at-use, and independently custodied evidence. Its receipt subsystem remains the **Hook-Custody Triad**: caller, witness, and commit statements joined under one activation identity. The triad can expose disagreement among retained statements. It cannot make an unobserved effect visible, make a false statement true, reverse an emission, or establish independent custody when every lane remains writable by one principal.

The implementation evidence is narrower. At `aukora-deep@4adb7dc08a070db3fe97117b1cf887a24c09b8df`, one operation, `memory.put`, crosses the real DeepSeek Harness `ToolRuntime` seam. Grant v3 binds exact arguments, an exact operation digest, an expiry, one nonce consumed within a local nonce-state domain, one declarative definition digest, and one settlement public-key identity; the definition digest does not bind a `ToolRuntime` object or implementation bytes. Signing and verification require an Ed25519 key of the expected private or canonical-public role, so RSA, EC, and a private PEM at a public-key boundary refuse. The issuer refuses root and a root key not owned by its effective UID; after approval it re-verifies the returned signed artifact against the operation it constructed before rendering, the expected definition, and the receipt-key identity. It reads its root key through one no-follow descriptor, holds an exclusive lifetime socket lease, and terminates an oversized request after one named reply. The broker refuses a different settlement key before nonce claim, provisions its first key atomically on the supported local filesystem, excludes a second ordinary live state writer, refuses an occupied endpoint, requires its immediate socket directory to be owned by its effective UID without group or other write access, verifies a fresh broker-key route challenge after binding, and refuses retained-client work when its bound pathname changes. It terminates an oversized frame after a named refusal, serializes settlement, records a prepared marker before effect, signs a post-dispatch observation, appends Aura, and advances a separate local count witness. Broker nonce controls cover reopening in fresh processes, candidate-before-publication invisibility, the valid two-link publication transition, post-publication directory-sync refusal, one-nonce/different-expiry reuse, malformed durable state, expired-burn retention, and twelve-process contention. Peer-token denial is remeasured at proof and settlement, and a stronger served class atomically raises the per-directory high-water seal before effect; a post-publication failure poisons later effect dispatch until restart. Receipt verification accepts only closed canonical artifacts and distinguishes genuine absence from an occupied but unobservable path. Aura reconstruction compares its object inventory in both directions and re-hashes the exact object bytes. The Merkle library binds raw leaf bytes, index, tree size, and derived sibling orientation. Governed source and shipped Loader paths both decline fallback HMR and refuse executable configuration before profile mount; shipped-binary specifications additionally cover configured HMR and first-class Include. The gate preserves `INCONCLUSIVE` as non-green, requires exact verdict partitions from named mutation arms, and witnesses a declared active-tree scope around enrolled red courts.

Those measured properties do not install the AUKORA Boundary. The repository has no deployed privilege-separated launch, immutable `ActivationStatement`, activation digest at check-at-use, independent witness or commit custodian, off-host latest-head checkpoint, governed model emission, reversible diff-staged `workspace.patch` with a dedicated court, or whole-harness mediation. At the measured subject, profile 8088 mounts no model, agent loop, runner, or approval answerer, so that composition cannot mint through the grant-v3 approval route. Source inspection at the editorial comparison subject `aukora-deep@bd198b9b049bde46c9c52176dbe950e41c966fcc` also finds the guest-to-issuer `op: 'issue'` route and guest-held `GovernedTicket.grant`; bearer removal and a broker-mediated digest hop are not installed there. These source observations are not promoted into `MEASURED` rows. Section 12.2 records a later broker-owned v4 product route, parent review seam, product-consumed WebAssembly proposal cell, and assembled keyless regression without changing the `MEASURED` subject. This paper therefore presents a specified architecture, a measured single-effect slice, and explicit open conditions rather than a production-readiness claim.

## 1. Epistemic discipline

Every material AUKORA implementation claim in this paper uses one status.

| Status | Meaning |
|---|---|
| `MEASURED` | Reproduced against the pinned repository subject by a named executable observation and control |
| `SPECIFIED` | Required by this architecture but not established as current behavior |
| `INFERRED` | Follows from stated premises, but lacks a direct court for the complete claim |
| `OPEN` | Unresolved, awaiting an implementation or decisive experiment |
| `NON-CLAIM` | Explicitly outside the demonstrated scope |

The categories prevent silent promotion: proposed is not implemented; implemented is not wired; wired is not enforced; tested is not complete; signed is not independently witnessed; logged is not prevented; and one nonce claim is not one human approval globally.

The implementation subject for every `MEASURED` row is `aukora-deep@4adb7dc08a070db3fe97117b1cf887a24c09b8df`. `bd198b9` and protocol branches are source-inspection subjects, not replacement evidence subjects. Replacing the measured pin requires a clean detached replay, retained raw output, controls, and an oracle review. On 26 August 2026, a fresh detached macOS 26.1 arm64 checkout produced `23 passed / 2 skipped / 0 inconclusive / 6 known breaches / 0 unexpected failures` under Node v24.11.1 and pnpm v11.7.0. Its [raw combined stdout/stderr transcript](https://github.com/aumara-xyz/aukora-skunkworks/blob/ab8c925951165fea15421510a919dd1d8118b5e1/findings/2026-08-26-darwin-gate-4adb7dc/GATE-OUTPUT.txt.gz.b64) is retained as a gzip-compressed Base64 artifact with a published decoded-content hash; the accompanying evidence record names the builder-reported gate command. The transcript is content-addressed output associated with an operator-attested replay; it does not itself bind the invoking shell, a clean global pre-state, or the checkout's Git HEAD. The runner built the artifact plane, fixed `DSH_HOME` to the checkout, and—for two registered filesystem challenges—created and later removed only the challenged subjects and verified launcher-generated profile state named by their enrollments. This is builder-owned regression evidence, not independent-oracle evidence or product closure custody. The six enrolled breaches are `escalation`, `amendment-channel`, `executable-configuration`, `composition-closure`, `launch-ceremony`, and `launch-ceremony-topology`; all remain open. Only `composition-closure` and `launch-ceremony-topology` carried runner challenges. Those challenges demonstrate two required filesystem enumerations; neither proves that a court's final verdict table is truthful, and the other four courts remain self-reported by their authors. Linux was not measured for this revision; no prior Linux result is inherited. Both skips were invocations of `uid-confinement`, the only enrolled court that exercises a second UID. At the pinned subject that court called `readFileSync` without importing it, so any otherwise-runnable Linux execution that reached the broker-key probe would have raised `ReferenceError` rather than produced a verdict; the import was repaired after the pin. A result attached to this revision does not silently transfer to a later revision.

An *authority closure* is the transitive set of code, configuration, credentials, keys, state, processes, descriptors, IPC routes, inherited capabilities, and mutation paths a principal can use directly or through a component it controls. Two process names are not independent when one authority closure can rewrite both.

## 2. Six properties that must remain separate

| Property | Question | What can establish it |
|---|---|---|
| Consistency | Do the supplied bytes, digests, links, and heads recompute? | Canonical encoding and deterministic verification |
| Origin authenticity | Did a statement come from the named principal? | Authenticated signing plus custody of the signing key |
| Coverage | Did every relevant attempted effect reach an enrolled observer? | Complete mediation or mechanical deprivation of every bypass route |
| Physical settlement | Does the retained observation match external state after the effect boundary? | Post-effect re-observation at that boundary |
| Freshness | Is this the latest unique history rather than an old prefix or hidden fork? | An independently retained head, checkpoint, or transparency monitor |
| Semantic binding | Were review, execution, verification, and evidence interpreted under the same constitution? | One immutable activation identity bound through every authority-relevant stage |

No property follows automatically from another. A signature proves only the signed statement under a bound key. A nonce claim proves authorization was consumed in one state domain, not that the effect ran. A local chain proves consistency of the presented history, not latestness. A post-effect observation proves what its observer saw, not complete event coverage. Exact request bytes remain semantically incomplete if the provider that interprets those bytes can change.

The semantic-substitution attack is simple:

```text
human approves P0(tool, arguments)
provider changes from P0 to P1
tool name, arguments, and grant signature remain identical
physical meaning changes
```

Binding arguments without binding their interpreter authenticates syntax while leaving meaning mutable. The architecture therefore treats semantic binding as a cross-cutting security property, not a documentation convenience. `INFERRED` at the pinned subject: `ToolRuntime` resolves the tool before policy and again at dispatch; stable definition identity across those stages remains `OPEN`.

## 3. The three separated powers

### 3.1 Action — `SPECIFIED`

Action is the authority to cause a consequential effect during the current activation. It has three parts: declared inventory, physical capability deprivation, and narrow authorization at an enrolled effect seam.

> **Composition declares the intended inventory. Capability deprivation is the actual allowlist. External activation fixes the meaning of both.**

Cordis composition can keep dead tools out of model-visible inventory and coordinate dependency lifetimes. It cannot confine hostile Node.js code that can import ambient APIs, use inherited descriptors, reach a raw socket, call another registry, or retain a previously captured capability. Exact grants narrow an enrolled path. They do not remove paths that bypass it. The actual action boundary is the set of capabilities the operating system and process topology make reachable.

### 3.2 Amendment — `SPECIFIED`

Amendment is the authority to change what a run means: composition, provider implementation, executable closure, loader and resolution policy, interface schema, trusted renderer, issuer or broker identity, witness topology, model route, artifact pointer, or activation rule.

The current activation may construct, test, and propose a successor. It may not select the authority that approves it, alter the active statement in place, or activate the successor. Governed HMR is therefore a successor-activation proposal, never a live constitutional mutation. No permanent local process is declared sovereign merely because it presently occupies the activator role.

Issuer succession is correspondingly `OPEN`. A defensible construction requires an external rule, quorum or equivalent authorization, a surviving log, and portable checkpoints. A new issuer process is not succession by itself. The strongest target is continuity of the verification rule and retained expectations, not immortality of one local witness.

### 3.3 Attestation — `SPECIFIED`

Attestation is the authority to retain statements about what occurred. Its integrity depends on custody, observation point, and checkpoint survival. Evidence grants no authority. A receipt may inform a proposal or human decision; it cannot become a capability through reinterpretation.

Four local roles—human session, issuer, broker, and guest—do not automatically create broker-independent evidence. If the broker executes the effect, holds the settlement key and nonce book, and writes the record, another path under that broker's writable or key authority is not an independent custodian. Independence may come from a separate OS principal, an external witness, plural checkpoint holders, a hardware-backed custodian, or an off-device anchor. The required property is a disjoint authority closure, not a particular process count.

### 3.4 The cross-cutting obligation — `SPECIFIED`

Semantic binding joins all three powers. The action admitted, the constitution activated, and the evidence retained must name the same immutable activation digest. Without that join, each power can be internally correct while referring to a different system.

## 4. The Activation Boundary

The target launch sequence is downward:

```text
EXTERNAL ACTIVATOR
      |
      | activates exact ActivationStatement
      v
CURRENT EPOCH
      |
      +-- proposal -> exact grant -> broker -> effect
      |                            |
      |                            +-- Hook-Custody evidence
      |
      +-- may propose successor
                    |
                    X cannot activate it
                    |
             EXTERNAL ACTIVATOR
```

In the specified deployment, the external activator would start first, hold the active statement and artifact pointer, verify the selected closure, create authenticated routes, and launch the harness as a lower-privileged guest. The guest would receive only the capabilities declared for the epoch. Governed startup would refuse when the promised separation could not be established.

On the initial macOS profile, launch ownership is intended to use `launchd` and separate host principals. That deployment is `SPECIFIED`, not measured. It does not use an in-process `setuid` or `setgid` transition: launchd must start each pre-provisioned principal directly. The repository ships broker and issuer templates plus a host-input generator, but no generated host-specific job or installer-owned principal. The present topology observer is read-only and cannot install accounts, jobs, routes, keys, or a guest process. Portability to other operating systems is `OPEN`; macOS is the first deployment target, not a universal confinement claim.

## 5. Three core artifacts

### 5.1 `ActivationStatement` — `SPECIFIED`

An `ActivationStatement` is the immutable constitution for one run epoch. The conceptual fields are:

```text
ActivationStatement
|- formatVersion
|- runId
|- epoch
|- parentActivationDigest
|- compositionRoot
|- executableClosureRoot
|- loaderPolicyRoot
|- interfaceSchemaRoot
|- trustedRendererRoot
|- issuerKeyFingerprint
|- brokerKeyFingerprint
|- witnessSetRoot
+- modelEmissionPolicyRoot
```

The canonical identity is:

```text
activationDigest = HASH(canonicalBytes(ActivationStatement))
```

The names above are architecture vocabulary, not fields silently added to grant v3. Current `operationDigest` binds the fixed `memory.put` operation, and current `receiptKeyId` binds the settlement public key. Neither is an activation digest. A future schema migration must map existing names explicitly and reject older artifacts rather than reinterpret them.

The same `activationDigest` is specified to bind the human review projection, proposal or operation, grant preimage, broker admission, check-at-use immediately before the physical effect, caller receipt, witness receipt, commit or settlement receipt, triad head, and external checkpoint. Any authority-relevant change creates a successor statement. No fourth receipt is introduced merely to carry the activation identity.

Check-at-use is essential for stale capability references. Removing a Cordis provider can revoke future resolution without revoking a reference already captured by a consumer. A consequential service should therefore expose an epoch-bound, non-authoritative broker stub that revalidates the active digest at invocation. This is `SPECIFIED`; Deep's current grant verifies its operation at broker admission but does not implement an activation digest at the final effect boundary.

### 5.2 `BoundaryExperimentClaim` — `SPECIFIED`

A `BoundaryExperimentClaim` is falsifiable governance metadata describing what a court is trying to distinguish. It has no authority. It is distinct from the Golden Boundary's upstream `BOUNDARY_CLAIM`, which is a structural constitutional annotation rather than executable court metadata.

```text
BoundaryExperimentClaim
|- claimId
|- activationDigest
|- subjectOrSecretDomain
|- admittedGrantDomain
|- authorityRelevantQuestion
|- trustedRendererDigest
|- observationOrEffectTrace
|- interventionClass
|- honestPathControl
|- independentObserver
+- grantsAuthority: false
```

The claim is useful only if its subject exists, the control path can reach it, the intervention exercises the alleged boundary, and the observer is outside the claimant-controlled closure. A `BoundaryExperimentClaim` is not a security certificate, does not authorize a run, and has no production implementation in the pinned tree.

### 5.3 Hook-Custody Triad — `SPECIFIED`

The receipt subsystem carries three epistemically distinct statements.

| Lane | Statement |
|---|---|
| Caller | The caller asserted this request, context, and claimed outcome |
| Witness | The witness received or re-observed these bytes at this named observation point |
| Commit | The commit custodian durably retained this canonical statement |

The lanes share event and activation identity but need not agree. A witness that receives a message claiming a file was written observed the message, not the file. Physical settlement requires a named post-effect observation. A hook can attest only to events delivered through that hook.

The triad join must bind canonical lane bytes, signer and key identifiers, event sequence, run epoch, predecessor, and `activationDigest`. Authenticated schemas, rotation rules, final join authority, and known-answer vectors remain `OPEN`. Current Aura and the signed broker settlement are not promoted into an implemented triad.

## 6. Cordis and AUKORA

Cordis, by Yifan Shi, Wei Zhang, and Tianyi Cui, formalizes spatiotemporal composability. Its fiber lifecycle and revertible effects recover context-mediated state; its coeffects reactively activate and deactivate declared dependencies as providers change. Corollary 62 concerns recovery of state under its hypotheses. Emissions are outside that guarantee. Orchestration inputs are exogenous to the calculus, and hostile code requires an external execution boundary.

Cordis supplies lifecycle topology, dependency ordering, model-visible inventory, disposal, and recovery. AUKORA supplies the exterior authority obligations: who may activate the topology, which ambient capabilities remain physically reachable, and which observations survive outside the actor's closure. This is a systems integration, not Cordis's missing theorem.

Bare `ctx.get()`, captured service references, direct registration, alternate tool registries, ambient imports, inherited descriptors, executable configuration, writable resolution bytes, and effects before the plugin tree settles remain relevant bypass classes. Cordis hygiene can reduce accidental reach. OS capability deprivation remains enforcement. An unload can prevent future resolution while a stale reference continues to exist; the specified epoch-bound broker stub closes that gap only when invocation revalidates outside the guest's mutable closure.

## 7. Exact authorization at the pinned grant v3 subject

The action path uses distinct stages:

```text
PROPOSED -> PRESENTED -> AUTHORIZED -> DISPATCHED -> OBSERVED -> RECORDED -> CHECKPOINTED
```

Each arrow means something different. Approval is not execution. Dispatch is not settlement. Settlement is not freshness. A burned nonce is not proof that the effect ran.

At `aukora-deep@4adb7dc08a070db3fe97117b1cf887a24c09b8df`, grant v3 is `MEASURED` as one closed eight-field artifact: `toolName`, argument `digest`, `nonce`, `exp`, `definitionId`, `operationDigest`, `receiptKeyId`, and `signature`. The verifier snapshots an exact plain enumerable data object without invoking accessors and reserves that same frozen snapshot rather than re-observing a direct JavaScript artifact. Unknown, inherited, symbolic, non-enumerable, accessor, malformed, expired, overlong, or mismatched claims refuse.

For `memory.put`, issuer and broker separately compute the same fixed operation through the shared `buildOperation` source module at the pinned subject from exact own enumerable `{key, value}` arguments and the signed expiry. The operation binds the tool, key, exact object-body bytes and digest, definition, expiry, and one-use declaration. The issuer displays the complete review artifact and expected `receiptKeyId`; after approval, it re-verifies the returned signed grant against the operation it constructed before rendering, the expected definition, and the receipt-key identity. It does not parse or hash literal terminal text after display. This is `MEASURED` what-you-see-is-what-you-sign (WYSIWYS) display/artifact agreement for one operation, not human comprehension, executed-byte identity, or implementation independence.

The fresh terminal challenge is a live-session control only. The issuer creates, displays, and matches it inside one process, but no operation, grant, receipt, or Aura field binds it. A later verifier can authenticate the signed grant and still cannot distinguish a live approval interaction from a replayed transcript of one.

The governed package mounts this issuance seam only when `issuerSocket` is configured; omission silently skips `registerIssuerBridge` rather than failing load. When mounted at the editorial baseline `bd198b9`, `bridge.ts` sends arguments directly to the issuer with `op: 'issue'`, and `GovernedTicket.grant` retains the returned signed artifact in the harness process until broker settlement. The specified broker-mediated route would retire this bearer-in-guest and guest-to-issuer path; the published mainline source does not. Profile 8088 compounds the distinction by mounting the approval Service Definition without an answerer, so its waterfall returns unavailable and never reaches the issuer.

`receiptKeyId` is SHA-256 over the broker Ed25519 public key's canonical SPKI DER encoding. Signing accepts only the expected Ed25519 private-key role; grant and receipt verification accept only a canonical Ed25519 SPKI public key, rejecting RSA, EC, and a private Ed25519 PEM at a public-key verification boundary. The named broker verifies that identity before nonce claim. A distinct key refuses; rewriting the signed key identifier invalidates the signature. First-run key provisioning publishes one complete mode-`0600` record through atomic same-filesystem hard-link creation, flushes the file and key directory, and makes concurrent losers load the winner. Persisted public and private halves must match. A missing key when `aura.jsonl` or `seq` exists refuses rather than minting a new identity. With a valid key already present, a dangling `aura.jsonl` or `seq` entry refuses before nonce claim or effect.

The issuer refuses to run with effective UID `0`. It opens its root key without following a link, validates the opened descriptor as a private regular file owned by the issuer's effective UID, and reads through that same descriptor. It creates `<socket>.lock` exclusively for its lifetime and never removes a pre-existing socket or lease at startup. The broker similarly holds `<stateDir>/.broker-active.lock` for its serving lifetime and refuses every pre-existing socket path. Its immediate socket directory must be an exact directory owned by the broker's effective UID with no group or other write bit. After binding, the listener signs a fresh route challenge under the persisted broker key; the broker requires the pathname to name the same inode immediately before and after the signed challenge exchange. It rechecks that identity at serialized admission and before effect work. An already connected client refuses after route replacement, and a graceful close refuses when its pre-close check already sees a foreign replacement. Node supplies no compare-and-close primitive, so a same-UID replacement after that check can still be unlinked by Node's close. These are local containment controls, not cross-UID route custody: they do not inspect ACLs or mutable ancestors, protect fresh clients after same-UID replacement, authenticate a route peer, or exclude another same-UID process from a known broker key. Crash residue is deliberately fail-closed and requires operator reconciliation.

The issuer and broker retain owner-only `0700`/`0600` development routes by default. An explicit installed-job mode requires each daemon's owner-held socket directory to have mode `0710` under its effective primary group and publishes that socket as `0660`, while rechecking inode, owner, group, and mode. The launchd generator requires distinct route parents and distinct route-group names, derives issuer receipt-key identity from the canonical broker public key, and emits the environment names the daemons consume. This makes cross-principal transport possible but does not establish it: no accounts, group memberships, directories, keys, jobs, guest, authenticated peers, or separate human and broker issuer listeners are provisioned or observed. Guest exclusion remains `OPEN`.

The broker bounds each newline-delimited request by UTF-8 byte length. An oversized frame receives `broker:frame-oversize`, terminates that connection, and cannot append a second request on it; an independent connection remains usable. This is a per-connection framing control, not a global resource bound or whole-harness transport claim.

Settlement requests serialize before Aura and grant preflight. The broker verifies Aura sequence fields as `1..N` and requires a separate local `seq` witness to equal `N` before consuming a grant. Sequence allocation and record append share the Aura writer lock; the witness advances before the settlement returns. This detects a locally shortened or zeroed record when the witness remains, but it is not an external anchor: the state-owning UID can coherently replace the record, witness, lease, and key.

The limit is exact: a copied identical private-key record has the same `receiptKeyId`. Two state directories holding that key retain independent nonce books and can each settle the same grant. The nonce book writes and flushes a private candidate under `stateDir`, then publishes the complete final record through a hard-link create into `nonces/<nonce>`; a fresh opener may see the valid two-link transition while the candidate remains. The nonce directory is flushed before authorization returns. A post-publication directory-sync or cleanup failure returns no authority and treats the visible final name as spent in the live filesystem, but does not prove that the burn survives a host crash. The broker court exercises fresh-process reopening, candidate invisibility before publication, the two-link reader transition, this post-publication refusal, same-nonce/different-expiry reuse, expired-burn retention, and twelve-process contention. A malformed durable claim record blocks broker startup rather than becoming absence. Successful nonce publication therefore establishes one durable burn per intact nonce-state domain; expiry invalidates an artifact but never prunes a retained burn. It does not establish at-most-once physical execution per human approval across duplicated brokers, deleted state, restored snapshots, divergent state directories, or uncertain host-crash persistence after a failed directory flush.

## 8. Current evidence and recovery surfaces

### 8.1 Prepared intent — `MEASURED`

Before an effect begins, the broker writes a prepared marker. On process restart it classifies the complete intent directory: valid residual markers are unresolved, and symlinks, non-directories, unreadable paths, malformed entries, or enumeration failures are malformed. Either class blocks service without deleting the evidence. Successful settlement clears the marker; cleanup failure other than `ENOENT` becomes `INDETERMINATE`. Settlement requests are serialized, but marker, effect, Aura, sequence, and cleanup are not one fsynced host-crash transaction.

A residual marker establishes only that cleanup did not complete. Whether the effect ran and whether Aura settlement completed are each indeterminate. The marker is not flushed as a host-power-loss record, so this mechanism covers process restart only. It is not a transaction protocol, automatic recovery, or proof of execution.

The signed settlement receipt is likewise an observation, not a causation proof. Its standalone verifier accepts only exact closed receipt and confinement records, requires canonical Base64 for one 64-byte Ed25519 signature, and distinguishes a genuinely absent path from an occupied but unreadable or wrong-type path. A content-addressed object with matching bytes and metadata may already exist before dispatch; a receipt that later verifies against it does not by itself establish that this invocation created the object or that its write branch ran. The settlement mutation arm patches a temporary copy of the production receipt verifier to bypass later observation and demonstrates that the sabotaged verifier admits an invented observation while the ordinary controls hold. The `organism` laboratory court imports production mint and verification functions for an additional comparison, but it is excluded from the production gate because its other organs import `archive/lab`; this paper does not count it as production-gate evidence. Production settlement still does not call `verifyReceipt` or perform a second, separately implemented re-observation after `memoryPut` returns `SETTLED`; later re-observation remains a court and test surface.

The current `peer-separated` confinement class records a narrower observation than its name may suggest. The broker must fail with `EACCES` or `EPERM` when reading a configured challenge token, and the connection must echo bytes matching the configured digest. The broker remeasures that denial at proof and settlement: if a formerly denied token becomes readable, a fresh proof refuses and a previously proved connection falls below a `peer-separated` seal before nonce claim; a token readable from boot caps service honestly at `state-owned`. This does not authenticate the peer UID, inspect ACLs or mutable ancestors, or exclude a relay that can obtain the token bytes.

The state directory retains a high-water confinement seal. Before an effect served above the retained class, the broker writes and flushes a same-directory temporary seal, atomically replaces the prior entry, flushes the directory, and only then writes the prepared marker and begins the effect. If any seal-raise step fails—including directory flush after publication—the live dispatcher is poisoned: the attempted request is `INDETERMINATE`, and later effects refuse before nonce claim until a restart re-reads the persisted state. A later boot or settlement below the retained class refuses. The seal remains local evidence owned by the state UID, not an external or same-UID-resistant anchor.

### 8.2 Aura inventory — `MEASURED`

Aura appends the broker's record. Its `rebuildIndex()` library verifies one record snapshot, compares record-named content objects with regular entries under `memory/objects` in both directions, and re-hashes every recorded object's exact bytes before changing the derived key projection. A missing, extra, invalid, staging, non-regular, or byte-mismatched object refuses and leaves the prior projection in place.

The Aura writer and reader observe the record path without following a symbolic link. A dangling record symlink refuses without creating or writing its target. This is byte and membership reconciliation. It does not establish signer identity, lock a concurrent object-directory snapshot, prove that the retained Aura file is the latest or only history, or resist coherent same-UID replacement of record and objects. `rebuildIndex()` has no deployed broker or operator caller.

### 8.3 Merkle statement binding — `MEASURED`

The Aura Merkle v2 library hashes raw leaf bytes with a distinct leaf domain, derives sibling presence and orientation from trusted `index` and `size`, accepts proof steps containing only a sibling hash, and binds the exact leaf count into the root commitment. Pinned courts exercise sizes one through three, every index of one three-leaf tree, one wrong index and size, malformed and executable statements, one fixed vector, and leaf/node-domain separation. Additional refusal branches exist in the implementation; complete vectors remain open (§14).

An inclusion result means one raw byte string is included at one index in one exact-size tree under the supplied root. It does not establish that the root is current or externally anchored. RFC 6962-style trees with odd carry do not make every proof reveal an adjacent leaf; no general adjacent-leaf disclosure law is claimed here. Compatibility between AUKORA's proof generator and verifier is not independent evidence by itself.

### 8.4 State-path alias refusal — `MEASURED`

The memory effect creates and validates broker-owned directories without following symbolic links, requires object and store paths to be regular non-symlink entries, and obtains receipt metadata with a no-following observation. The confinement seal similarly treats a dangling symbolic link as an unreadable state entry and refuses instead of grading it as absent.

These checks close the reproduced dangling-link false greens. They do not supply descriptor-relative, race-free filesystem authority against a same-UID adversary: another process with the same write authority can still race path observations or introduce a hard-linked regular file whose identity is not represented by the path check. The host-power-loss durability of effect, intent, settlement, and record transitions also remains unproved.

### 8.5 Governed Loader — `MEASURED`

The source and shipped governed launch paths both decline fallback HMR and refuse executable Loader configuration before a profile entry mounts. Shipped-binary specifications additionally refuse configured Cordis HMR and first-class Include. The source/shipped controls exercise distinct Loader resolutions so guarding one module instance while evaluating through another cannot grade green. Ungoverned controls retain Cordis's ordinary dynamic behavior.

The selector remains guest-supplied, no external activator binds it, arbitrary plugins retain ambient Node authority, and the governed profile is not the stock harness. The Loader refusal is a real mechanism on one startup path, not capability deprivation or constitutional activation.

### 8.6 Court gate — `MEASURED`

The gate reserves exit `78` for `INCONCLUSIVE`. An absent or unobservable subject is neither a pass nor a reproduced breach and keeps the gate non-green. Exit `77` is tightly limited to the named platform-dependent court. Enrolled breaches must still report their expected rows and sentinel. The enrolled set at this subject is `escalation`, `amendment-channel`, `executable-configuration`, `composition-closure`, `launch-ceremony`, and `launch-ceremony-topology`. Only `composition-closure` and `launch-ceremony-topology` carry filesystem challenges; the other four are explicitly unchallenged and forgeable by their own authors.

The runner brackets enrolled courts with a separate scoped witness over tracked files, non-ignored untracked files, and selected ignored runtime paths: `.aukora/`, `profiles/`, and built `lib/` material under `apps`, `vendor`, and `packages`. It commits path, POSIX mode, UID/GID, symlink target, and regular-file bytes. It does not cover dependency caches, `.env`, ACLs, extended attributes, filesystem flags, directory metadata, empty directories, `.git`, hard-link identity, or bytes reachable beyond a symlink.

This revision changes implementation code, courts, and `courts/known-breaches.json` in one authority closure. Its resulting gate run is therefore **builder-owned regression evidence**, not independent oracle evidence or fresh enrollment. It can show that the checked artifact and its current courts agree; it cannot show that an implementation author was unable to relax an oracle or its enrollment. Before external review treats a gate result as independent evidence, an oracle owner must reconstruct the final committed artifact in a clean checkout, independently remeasure and enroll any changed red rows, and retain that raw output. This requirement is stronger than the runner's scoped witness and remains open at publication.

The runner's random planted name challenges whether a sweeping court actually enumerated its claimed directory. The known-breach runner rejects duplicate or overlapping enrolled row identifiers. Individual mutation arms require the exact intended ordinary breach set, every other ordinary control held, and a unique complete table; exact ordinary-table completeness is a court-specific mechanism, not a generic runner guarantee. The live-dispatch wrapper additionally binds the child exit, identities, observations, defense verdict, and collected-test count. These checks reject collateral red controls and fabricated fragments. They cannot prove that the court derived a truthful verdict from what it enumerated. Without an observer external to both court and runner, no local check can close coherent collusion or a common semantic defect. The mutation arms are counterfactual controls, not exhaustive attack enumeration.

### 8.7 Frozen authority source graph — `MEASURED`

The authority source graph exposes a frozen digest over the exact source bytes and static import graph rooted at `aukora/broker/broker.mjs` and `aukora/issuer/issuer.mjs`: fourteen of the nineteen executable `.mjs` modules under `aukora/`, thirty-five local edges, and thirty-one `node:` built-in import edges in the measured tree. The excluded modules are `aura/merkle.mjs`, `guest/guest.mjs`, `supervisor/bin.mjs`, `supervisor/topology.mjs`, and `host-dsh/src/verifier-bytes.mjs`, which defines the frozen value and graph reader. The included graph contains the issuer review renderer and minter. An internal tokenizer recognizes static imports and re-exports, reads each source through a no-follow descriptor, and re-reads it for stability before serializing the graph. The court changes each of the fourteen production graph nodes and rewires the broker's real grant import to a new soft module inside a temporary copy; every mutation moves the digest. This detects ordinary static source drift and module-identity rewiring when the court runs.

Neither production issuer nor broker compares this digest before issue or dispatch. The exported test launch helper fixes its broker entry and captures its Node executable at module initialization, but has no production caller and does not bind executed module bytes or module resolution to this frozen value. The graph records Node built-in specifiers but not their implementations. Its tokenizer recognizes only static import and export syntax: current call-time `process.getBuiltinModule` use in graph nodes is accompanied by recorded static built-in imports, but an undeclared future ambient acquisition would be invisible to the instrument. The graph also excludes dynamic imports, externally resolved modules and values, and any authority able to coherently rewrite the verifier, frozen value, and court. It is a reviewed source-closure anchor, not an independent runtime attestation or `activationDigest`.

The executable inventory tool [`scripts/aukora-authority-inventory.mjs`](../scripts/aukora-authority-inventory.mjs) enumerates this static source closure alongside declared external package dependencies captured via [`scripts/launchd-authority-dependencies.mjs`](../scripts/launchd-authority-dependencies.mjs). It derives source bytes, the static source graph, and the frozen reference directly from one selected Git revision using pinned object database readers (`readPinnedBlobs`), never conflating checked-out working-tree bytes with revision attribution. Working-tree modifications can be inspected and optionally refused (`--refuse-dirty`). External dependencies are separately labeled as host snapshots (`installed-node-modules-snapshot`) of installed bytes rather than authenticated Git source. The inventory explicitly disclaims a complete Trusted Computing Base (`isCompleteTCB: false`) and calculates no security score (`securityScore: null`).

## 9. Hook scope, emissions, and bypass inventory

A signed hook receipt establishes evidence about a covered path. It does not prove universal effect coverage. The minimum bypass inventory includes direct syscalls, raw network access, ambient host API acquisition such as `process.getBuiltinModule`, inherited file descriptors and sockets, standard output and error, model-provider requests, subprocesses, native modules, import-time effects, alternate tool registries, stale captured capabilities, background work, and effects before composition settles.

Anything included in a request to a remote model has already crossed an emission boundary. Logging the request after transmission does not repair disclosure. The specified `modelEmissionPolicyRoot` names the active model route and declared data boundary, but current Deep model adapters use ungoverned network access. Governing ordinary tools or sockets would not by itself establish data sovereignty for remote inference.

An emission is not reversible because its producing component is later unmounted. A stdout route can leave the process without opening a new socket. A remote provider can retain, transform, or redistribute disclosed bytes under conditions outside this local architecture. These remain explicit threat-model facts, not edge cases repaired by better logging.

## 10. Human review and the Golden Boundary

The **Golden Boundary** is a mathematical and epistemic framework for finite, discriminating observer boundaries. The **AUKORA Boundary** is the systems architecture that physically separates action, amendment, and attestation. The legitimate transfer is methodological: non-vacuity, discrimination, independent verification, explicit leakage and cost, constitutional non-escalation, and separation of evidence from authority.

No Fibonacci category, Hurwitz extremality, golden ratio, tesseract, holographic analogy, CAST result, or observer metaphor is security evidence for AUKORA. A tesseract or finite face lattice may organize rendering, selection, or an authority-relevant projection. It is not confinement, storage integrity, semantic proximity, identity, or cryptographic authority.

For a finite schema-defined authority question `Q`, the trusted renderer target is:

```text
Q(x) != Q(y)  =>  Render_A(x) != Render_A(y)
```

This property can establish that a renderer preserves a declared authority-relevant distinction. It cannot establish that a human noticed the distinction, that either choice is safe, that the schema captures every semantic consequence, or that a large and confusing diff is reviewable. The renderer digest and the exact review projection must therefore bind into the activation and grant; human comprehension remains an independent evaluation problem.

### 10.1 Non-vacuity and intervention

A zero observed leak can result from a constant secret, absent subject, failed setup, unused bypass, or unexercised path. One workload yielding `I(S; O | G) = 0` does not prove complete mediation or noninterference. A stronger evaluation target is interventional:

```text
Leak(A) = sup over admissible interventions pi of I_pi(S; O | G, A)
```

This is an evaluation frame, not an implemented AUKORA theorem. Every claimed denial should plant an entropy-bearing subject, prove through a positive control that the subject exists and is reachable without enforcement, exercise an adversarial control, observe the attempted event, and attribute refusal to the intended mechanism. A boundary that admits nothing can be vacuously safe and useless; surviving legitimate action is part of the test.

When the verdict is fully determined by the claimant-controlled closure `C`,

```text
V = f(C)  =>  I(T; V | C) = 0
```

the verdict is not independent evidence about truth `T`. Conditioning on a process label is too weak; the relevant object is all claimant-controlled bytes, keys, configuration, observations, and code.

A classifier near chance under one workload supplies no upper bound on leakage. The honest conclusion is only: not detected under the stated distribution, features, classifier family, sample size, and attack budget. A successful discriminator can falsify a no-signal claim; a failed discriminator does not certify absence.

## 11. Threat model and custody

The base adversary includes a compromised model, malicious prompt content, a malicious plugin in the guest, arbitrary code under the guest UID, replayed or stolen grants, a compromised viewer, and later compromise of one local component. Root, kernel, runtime supply-chain compromise, breaks in selected cryptographic primitives, hardware attacks, and collusion among every custodian remain `NON-CLAIM` threats unless a stronger deployment explicitly adds them.

Path separation is not custody separation. Same-process or same-UID files can detect accidental or partial editing but remain coherently rewritable by that authority. A one-host second-UID deployment can protect guest-excluded state only to the extent that kernel ownership, cryptographically authenticated IPC, executable-byte custody, tracing and kill permissions, groups, ACLs, inherited descriptors, and shared storage actually preserve the relation. Off-host checkpoints add freshness only after the local signer and statement source are outside the guest's authority.

The local sequence is therefore deliberate: first establish the principal boundary, then authenticate routes and keys, then anchor a head externally. A transparency service cannot repair a host where the actor controls the signer and every statement submitted to the service.

This is engineering provenance, not legal evidence. Legal admissibility, attribution, and non-repudiation are outside this paper's claim.

### 11.1 Kernel mandatory access control at one UID

Same-UID coherent rewrite is treated above as unavoidable without a second principal. On macOS that is not exact: kernel mandatory access control refuses a syscall the file's owner would otherwise be entitled to make. `research/boundary-min/` measures this over five processes under `sandbox-exec` and records `read_issuer_key: REFUSED:PermissionError` beside a control write that succeeds outside the sandbox. That prototype is the standing evidence and is deliberately not product code.

The product path is separately blocked. This repository ships both platform runners — Seatbelt profiles in `packages/sandbox/sandbox-local/src/profiles.ts` and Linux Landlock in `native/landlock-run` — but only the shell executor consumes them, and no AUKORA process is launched under either. Wiring that provider to the guest as it stands would not reproduce the prototype's result, because the two profiles do not deny the same things.

The shipped profile is a write fence. Measured on darwin 25.1 against a scratch key file and two unix sockets, a guest under it could still read the key material it is fenced away from writing, and the two forms the prototype relies on are the two it does not emit:

| Profile | key read | key write | issuer route | broker route |
| --- | --- | --- | --- | --- |
| unconfined | readable | allowed | allowed | allowed |
| shipped write fence | readable | `EPERM` | allowed | allowed |
| plus `(deny file-read* (subpath keys))` | `EPERM` | `EPERM` | allowed | allowed |
| plus `(deny network-outbound (literal issuer.sock))` | `EPERM` | `EPERM` | `EPERM` | allowed |

Node started and generated an Ed25519 key pair under every row, so the denials cost the guest nothing it is entitled to. A `file-read*` denial on a socket node does not refuse `connect`; the `network-outbound` form is required.

Two bounds hold regardless. The profile is applied by the parent at spawn, so an authority that already controls the parent selects the profile and is not confined by it: this narrows a compromised guest, never a compromised launcher. And the socket row is macOS-only evidence — Landlock's filesystem rules have no unix-socket path equivalent, and no Linux measurement was taken, so nothing here establishes that the route half ports.

This does not replace the distinct-UID deployment. A second principal removes the guest's ownership of the state; a kernel profile removes its permission to reach paths and routes its declared composition never named. They refuse different things, and the second is available without root, a daemon, or a virtual machine.

## 12. Implementation status at `4adb7dc08a070db3fe97117b1cf887a24c09b8df`

| Surface | Status | Evidence or reason | Remaining limitation |
|---|---|---|---|
| Exact-argument and exact-operation grant verification | `MEASURED` | Broker court, WYSIWYS issuer court with a court-reconstructed expected field set plus renderer/minter mutation arms including W13 mint drift, live-dispatch controls, and broker B34 same-snapshot reservation | One governed operation only |
| Issuer display/artifact agreement | `MEASURED` | WYSIWYS issuer court, including returned-artifact verification after approval | Does not prove human comprehension or authenticated personhood |
| Issuer key and endpoint entry hardening | `MEASURED` | `issuer-approval.spec.ts` and `issuer-custody.spec.ts`: non-root and expected-role Ed25519 gates, issuer-UID key ownership, no-follow key read, private leaf-mode checks, occupied-path refusal, lifetime lease, and terminal oversize-connection control | These vitest specifications are outside the quoted Court Gate roster; no ACL or mutable-ancestor check; same-UID authority remains in the trust base |
| Broker request framing | `MEASURED` | Broker B2 named oversized-frame refusal and terminal connection control | Per connection only; not a global resource or whole-harness transport bound |
| Nonce semantics | `MEASURED` | Broker B6 replay, B25–B27 fresh-process controls, B29 malformed durable-state control, B36 expired-burn retention, B26 twelve-process contention, B43 candidate invisibility, B44 two-link reading, and B45 post-publication directory-sync refusal | One durable burn per intact nonce-state domain, not global execution uniqueness; a failed directory flush leaves host-crash persistence unknown |
| Settlement authority binding | `MEASURED` | Grant v3 `receiptKeyId`; broker and launch-ceremony-topology D2 distinct-key, signed-rewrite, and copied-key controls | Copied identical key plus separate nonce book can settle again |
| First-run broker identity publication | `MEASURED` | Broker provisioner concurrency and persisted public/private-half validation controls | Same-host filesystem and custody assumptions remain |
| Broker state and endpoint containment | `MEASURED` | Broker B18, B23–B24, B38–B39, B41, and B42: ordinary singleton, writable-parent refusal, retained-client route loss, queued-admission recheck, post-bind signer proof, and fail-closed close when a replacement is already observed | No cross-UID connect/unlink/listen demonstration; ACLs, ancestors, fresh clients after same-UID replacement, post-check close race, and peer authentication remain open |
| Broker test-launch helper | `MEASURED` | B32–B33, B35, B37, and B40: fixed entry and initialized executable, environment scrub, occupied-path preflight, and exact direct-child IPC frame | No production caller, privilege boundary, cryptographic IPC authentication, or process-tree containment |
| Serialized Aura head witness | `MEASURED` | Broker B19 and B22 concurrent-settlement and local-order controls | Local count is neither external freshness nor same-UID tamper resistance |
| Dangling and linked state refusal | `MEASURED` | Broker B16, B17, and B21 controls | Same-UID path races and hard-link identity remain open |
| Post-effect failure semantics | `MEASURED` | Broker B20 and intent-reconciliation controls | Outcome remains unresolved without an external observation protocol |
| Governed effects | `MEASURED` | Live-dispatch real `memory.put` through `ToolRuntime` | Stock shell, filesystem, web, subagent, and model paths are outside AUKORA |
| Tool-definition stability across policy and dispatch | `OPEN` | The pinned `ToolRuntime` resolves by name before policy and again at dispatch | Same-name interpreter substitution is not closed at the pinned subject |
| Prepared-intent process restart stop | `MEASURED` | Intent-reconciliation valid, malformed, dangling, and mixed inventory controls | No host-power-loss durability or automatic outcome resolution |
| Receipt closure and later observation | `MEASURED` | Settlement closed-artifact and public-key-role controls, production-verifier mutation, and kernel artifact-closure controls | No production verifier caller; no causation or independent custody claim |
| Aura object inventory | `MEASURED` | Aura-record and object-reconciliation bidirectional comparison plus exact byte re-hash | No production caller, freshness, snapshot lock, or independent custody |
| Merkle statement binding | `MEASURED` | Spine and kernel-hardening fixed vector, hostile statement cases, and leaf-preimage mutation | No external latest-root anchor |
| Symlink state-path refusal | `MEASURED` | Aura R9, confinement C15, and kernel K6 | Not race-free or hard-link-safe against the state-owning UID |
| Confinement remeasurement and high-water seal | `MEASURED` | Confinement C10–C12 and C16–C18; production proof, settlement, pre-effect seal, and post-publication failure poisoning paths | Mechanism-only same-UID controls do not establish peer identity or independent custody; state UID can replace the seal |
| Governed Loader refusal coverage | `MEASURED` | Amendment-channel A8/A9 source and shipped fallback-HMR plus executable-configuration controls; shipped `built-bin.e2e.ts` configured-HMR and Include controls | The enrolled court is self-reported, unchallenged, and author-forgeable; the shipped-only vitest specification is outside the Court Gate roster; guest chooses selector; no capability deprivation |
| Gate non-vacuity and restoration witness | `MEASURED` | Fresh detached Darwin run: 23 passed, 2 skipped, 0 inconclusive, 6 enrolled breaches, 0 unexpected failures; `INCONCLUSIVE`, enrolled rows, two challenges, scoped before/after witness | Builder-owned evidence; scope is not whole tree; each challenge proves one enumeration rather than verdict truth; four breach courts are unchallenged; both skips were the only cross-UID court, which could not run at this subject; verdict semantics remain locally authored |
| Issuer/broker authority source graph | `MEASURED` | Verifier-bytes exact 14-node source graph, fourteen node mutations, and an import-rewire arm | Court-only source-drift detection; production does not bind executed modules or resolution to the frozen graph |
| Model, agent loop, runner in profile 8088 | `NON-CLAIM` | Profile mounts without them | No autonomous governed session |
| Guest privilege separation | `OPEN` | Read-only topology observer and red launch courts | No installed launch-downward |
| Cross-principal issuer routes | `OPEN` | Optional `0710`/`0660` daemon mode and validated launchd templates exist | Accounts, distinct peer memberships, installed jobs, separate human and broker issuer listeners, peer authentication, and guest exclusion are absent |
| Executable-closure custody | `OPEN` | Composition-closure and launch courts remain red; `@aukora/core` is reached through an integrity-free workspace link, while archived lab code uses raw relative imports | Guest can reach mutable source and resolution surfaces; neither consumption path binds a published core digest |
| `ActivationStatement` and `activationDigest` | `SPECIFIED` | §5.1 | No production schema or external activator |
| Activation binding at final check-at-use | `SPECIFIED` | §5.1 | Current grant binds operation and receipt key, not epoch constitution |
| Hook-Custody Triad | `SPECIFIED` | §5.3 | Current settlement and Aura are not three independent lanes |
| Independent evidence custody | `OPEN` | Same-UID coherent-rewrite control | No disjoint witness/commit authority closure |
| External checkpointing and fork detection | `OPEN` | A later source slice exports a local Aura checkpoint, standard consistency presentation, and cold Python verification court outside this paper's pinned `MEASURED` subject | No off-host retention route, signed checkpoint, latest-head service, or independent custodian; local histories can still be replaced coherently before export |
| Governed model emission | `OPEN` | Direct provider network path | Prompt disclosure occurs before any after-the-fact log |
| Governed repository amendment | `OPEN` | bounded create/replace `workspace.patch` implemented; reversible diff-staged rollback and dedicated court absent | Agent cannot safely self-edit through AUKORA |
| Issuer succession | `OPEN` | Rule/quorum/log design only | No ceremony or portable checkpoint set |
| Standalone application packaging | `OPEN` | Repository is source-self-contained but requires external runtime packages | No signed macOS application bundle or installed AUKORA UI yet |

The repository contains the complete vendored harness and AUKORA integration source without sibling-repository imports or Git submodules. That is source self-containment, not an offline executable capsule. Node and third-party packages remain installation prerequisites. A standalone deployment must generate runtime keys, nonce state, sockets, receipts, active profiles, and guest scratch data outside the source tree under their deployment owners.

### 12.1 Source comparison at `bd198b9b049bde46c9c52176dbe950e41c966fcc`

The following is a pinned source inspection, not a replacement `MEASURED` subject. The legacy v3 bridge and issuer `op: 'issue'` handler remain; the harness retains signed grant bytes in `GovernedTicket.grant`; the broker has no v4 settlement caller; and profile 8088 has no approval answerer. The repository contains only the `8088-inside-out` profile and no Boundary Lab, `--ui aukora|lab|stock` selector, spatial AUKORA client assembly, `ActivationStatement`, `CellId`, `internal.sock`, or production WASM guest runtime. The intended product and researcher surfaces are therefore two proposed assemblies over one source core, not two shipped applications and not a measured same-core release proof.

### 12.2 Later implementation checkpoint

The following source and local-regression observations are pinned to [`aukora-deep@5c8d9b50d397af373af3e3d3aded71799c44af95`](https://github.com/aumara-xyz/aukora-deep/tree/5c8d9b50d397af373af3e3d3aded71799c44af95). They do not replace the `MEASURED` subject, its retained transcript, or its oracle requirements.

| Surface | Source and local-regression status | Ceiling |
|---|---|---|
| Default governed-memory route | With `issuerSocket` omitted, ToolRuntime binds the executing arguments to the pre-execute operation, the package runs them through the pinned proposal-only WebAssembly cell, validates and detaches the returned argument snapshot, and `BrokerProposalClient` sends only `proposal.open`, `proposal.deposit`, and `proposal.status` to the broker. The broker freezes the exact operation for parent review before it contacts the issuer, then owns grant-v4 construction, issuer `admit` and `authorize`, final verification, settlement, nonce, receipt, and Aura state. The guest receives only opaque occurrence identifiers, public `PENDING`, `SETTLED`, `REFUSED`, or `INDETERMINATE` state, and a refusal reason where applicable. | The legacy v3 `bridge.ts`, issuer `op: 'issue'`, and `GovernedTicket.grant` remain available when `issuerSocket` is configured explicitly. The bare 8088 profile supplies only `brokerSocket` and launches none of the authority processes; the source parent launcher now stages that profile and starts all three roles. The proposal namespace and issuer peer are not authenticated, all roles share one UID in that launcher, and native Node guest code can dial a reachable broker without using the cell. The broker retains at most 16 namespaces and 16 proposal occurrences without terminal eviction; restart restores capacity but loses retry identity and terminal status. |
| Proposal-only WebAssembly cell | One digest-pinned module imports exactly `aukora.propose_memory_put`, receives no WASI import, and emits canonical `memory.put` proposal bytes through its Node embedder. The default v4 product path accepts only the closed output fields, pinned module digest, exact tool and argument fields, canonical encoding, key grammar, and equality with both executing and reviewed arguments before broker deposit. The cell and guest-import courts pin product-graph reachability and exact mutation partitions; focused tests cover every branch of the consumer. | The cell proposes data only. It does not confine Cordis, the native Node guest, Node embedder, broker, issuer, another tool, or product process; import inventory cannot prove that an allowed host callback remains inert after its implementation changes. The module digest is validated locally but is not bound into grant v4, and parent review remains the authorization backstop. |
| Source parent launch and assembled v4 regression | The source launcher starts the canonical broker, issuer, and real Cordis guest as direct children, gives the guest only the broker route, and drives one operation through the real ToolRuntime. Source-mode and built-mode snapshots cover approved, refused, and indeterminate outcomes. Credential sentinels prove that the guest child receives the broker socket but not inherited key or token variables. An unresolved parent-review barrier proves no issuer contact, nonce, object, key projection, or Aura append occurs before the parent approves. | Every process runs under the invoking UID, both review decisions remain terminal callbacks rather than an authenticated trusted renderer, and the guest is native Node. The launcher records selected artifact hashes but neither launch nor final effect admission enforces them. It demonstrates assembled data flow and ordering for one operation, not hostile-code confinement, person authentication, independent custody, or production packaging. |
| Cold Aura consistency observer | The local Aura exporter and standard-library-only Python verifier described in §15 classify append-only growth, independently established observation conflict, or undetermined evidence without importing the JavaScript producer. | This is implementation diversity, not authority diversity. Checkpoints remain unsigned and locally retained; no off-host route, latest-head service, or independent custodian exists. |
| Stable identity primitives | A closed immutable genesis record derives one stable `AukoraId`, and closed unsigned delegation claims encode `root -> device -> session -> agent` attenuation across operations, resources, audiences, activation digests, budgets, times, and parent digests. The identity court carries a mutation control over scope widening. | No authenticated control-history transition, signing protocol, recovery ceremony, current-time or revocation store, aggregate budget accounting, product consumer, or grant check-at-use binding exists. These primitives grant no authority and do not establish AUMLOK custody. |
| Operator AUMLOK control binding | A later operator-facing source assembly verifies one Ed25519 plus ML-DSA-65 root promotion, derives the KIRA subject from the resulting `AukoraId`, persists the active head in broker state, signs exact v5 actions with its Ed25519 half, and rechecks subject, control digest, revocation, and signer before and after nonce reservation. The current developer Web and live-turn commands create or authenticate one owner-mode local controller, derive proposal-specific session-to-Agent delegations from it, and require KIRA writes to match its subject and privacy policy. The 5173 surface receives only a five-field public projection of that control. | This later source slice is not part of the paper's pinned `MEASURED` subject. All local controller, issuer, broker, guest, and browser-host processes remain under one UID; POSIX modes do not establish independent human-key custody. The source prototype also lacks seven-token recovery, aggregate delegation spend, independent latest-head observation, and off-host custody. |

### 12.3 Static-enforcement checkpoint

The following static-analysis observations are pinned to [`aukora-deep@609e2643dc92c5beaafe898974935489d299d7a8`](https://github.com/aumara-xyz/aukora-deep/tree/609e2643dc92c5beaafe898974935489d299d7a8). They do not replace the `MEASURED` subject, its retained transcript, or its oracle requirements. Both mechanisms are new at this revision. This paper asserted neither of them before it: no earlier sentence claimed that any compiler or linter covered the specification artifacts or the organ tree, so these rows add coverage that was absent rather than correct a claim that was wrong. Neither is promoted into a §12 row, because static analysis of source is not a reproduction of the pinned runtime subject.

| Surface | Source and local-regression status | Ceiling |
|---|---|---|
| Compiled interface contract | `scripts/typecheck-specs.ts` compiles `docs/specs/*.ts` under the strict settings the rest of the repository compiles under and runs as a `doc-sync` leaf at `scripts/run-gates.ts:696`. Before this revision no program compiled that directory: `tsconfig.host.json` resolved 1005 root files with none under `docs/`, `scripts/doc-typecheck.ts:206` globs Markdown only, and `:209` skips `docs/specs/` explicitly. Ten `AssertEmpty` aliases in `docs/specs/BRICK-0-CONTRACT.ts` are now enforced by that compile, six of them new at `:1431`, `:1440`, `:1448`, `:1458`, `:1467`, and `:1478`, closing custody over `issuerKey`, `nonceBook`, `receiptKey`, and `issuerSocket` against the four principals. Each was mutation-tested separately and each fails the compile on its own. The gate also refuses a specification that retains the assertion primitive while instantiating it zero times. | The contract types nothing that executes. `docs/specs/BRICK-0-CONTRACT.ts` has no importer, no package, and no production consumer, so a compiling alias constrains the specification's own vocabulary and not any running process. The file states the same limit at `:176`: a `tsc` error is a regression net for the author, never enforcement against an adversary. A compile cannot observe that the deployed topology matches the types, and no runtime reads these names. |
| Organ-tree lint coverage | `.oxlintrc.json` reverses its blanket `**/*.mjs` ignore for `aukora/` and gives the tree a rule set with Node globals declared. Before this revision oxlint applied zero rules to all 95 organ files, 55 `.mjs` and 40 `.d.mts`: the ignore excluded every `.mjs`, and no `overrides.files` glob matched `aukora/**`. Both halves were load-bearing, and each alone leaves the tree unlinted. Three violations across two files remain suppressed as data in `scripts/lint-exceptions.json`; `scripts/verify-lint-exceptions.ts`, wired beside `lint` at `scripts/run-gates.ts:217` and `:288`, re-runs oxlint with those suppressions stripped and fails when one stops reproducing, so a suppression cannot outlive the defect it covers. | Lint is not verification, and a syntactic rule set is not a proof of anything this paper claims. `aukora/` belongs to no TypeScript program, so type-aware rules cannot run over it and 55 implementations remain unchecked by any compiler. Coverage is 93 of 95 files: `aukora/broker/broker.mjs` and `aukora/supervisor/developer-launch.mjs` carry expiring exceptions tracked to issues #129 and #108. The record governs `aukora/` only, and the pre-commit profile `.oxlintrc.staged.json` keeps its own copy of the ignore list, so the staged path still applies no rules to the organ tree. |

### 12.4 Launch-downward verification record, 5 September 2026

This record does not replace the pinned checkpoints above. No installed-topology row is promoted: the host's installer check refuses with `launchd-install:root-required`, and the attempted non-interactive privileged check requires the operator's password. Scripted terminal and issuer fixtures are not observations of a human or an installed guest. [Issue #3](https://github.com/aumara-xyz/aukora-deep/issues/3) remains open.

| Requested observation | Status | Evidence still required |
|---|---|---|
| Guest LaunchDaemon and external activator | `OPEN` | Installed Cordis guest with observed numeric UID, job, and allowed capabilities |
| Human review through installed broker and issuer | `OPEN` | Attended terminal run; the broker adapter alone does not carry issuer approval |
| Guest cannot rewrite implementation, state, or routes through ACLs | `OPEN` | Installed-guest attack and honest controls; installer ACL validation is code-level evidence only |
| Supplementary groups confined | `OPEN` | Live service-process group observations and forbidden-group controls |
| Guest network deprived | `OPEN` | Resource-specific sandbox controls and a succeeding legitimate route |
| Runtime bytes bound | `OPEN` | Retained deployment manifest and loaded-runtime limits; the file pin/report digest is narrower |
| AUMLOK binding, launchd environment, recursive closure | `OPEN` | Separate measurements for each property |
| Full daemon restart, retained recall, nonce replay refusal, cold verification | `OPEN` | One installed run with all old processes gone and fresh processes reading retained bytes |
| Successor activation exclusive to the activator | `OPEN` | Three denied policy changes, a permitted successor, and registered failing mutants |

### 12.5 Read-only memory integration and rebuild map

This source checkpoint does not replace the paper's pinned `MEASURED` subject. The read-only explorer baseline is on main at [`7234e277f290e732e45549ac24df2e0b9162f549`](https://github.com/aumara-xyz/aukora-deep/tree/7234e277f290e732e45549ac24df2e0b9162f549). Its [versioned conversational extension](../research/associative-memory/2026-09-09/README.md) preserves original KIRA records, retrieves a bounded selection through the existing read owner, follows explicitly sourced corrections, and separates unavailable history from unsuccessful retrieval. A model or ranking algorithm can be replaced without rewriting those records. Authorization remains a separate plane, not a memory type or a property of a vector.

| Rebuild component | Source of record | What it does not recover or establish |
|---|---|---|
| Record staging and verified recall | [KIRA staging](../aukora/kira/stage.mjs), [KIRA recall](../aukora/kira/recall.mjs) | A new checkout contains no private history; recall does not authorize a write |
| Receipt history | [Aura record implementation](../aukora/aura/record.mjs) | Hash linking does not establish truth, latest-head freshness or resistance to coherent same-UID replacement |
| Human control binding | [AUMLOK control](../aukora/identity/control.mjs), [local controller storage](../aukora/identity/local-control-store.mjs) | Source code cannot recreate a lost owner secret or prove attended human presence |
| Assembly and retained activation | [Developer supervisor](../aukora/supervisor/README.md), [launchd operations](../ops/launchd/README.md) | Building source does not upgrade populated state or install privilege separation |
| Conversation and replaceable ranking | [Read-only memory runbook](../research/associative-memory/2026-09-09/README.md) | Synthetic replay is not live-model faithfulness or a deployed memory service |
| Lease diagnosis | [Read-only recovery inspector](../scripts/aukora-kira-recovery.mjs), [usage and refusal semantics](../.agents/notes/implemented/feature/2026-09-09-read-only-kira-lease-inspection.md) | A missing PID never authorizes lease deletion; inspection does not verify memory |

The runbook names dependency builds, isolated preview start/stop and executable tests. Reconstruction of a populated deployment additionally requires separately retained owner-controlled backups of its original data and activation/control material; keep secrets out of Git and model-readable artifacts. Preserve existing state before any attended recovery or authorized upgrade. This document is an index to those procedures, not a key backup or an automatic recovery authority.

The [preserved Gaussian audit](../research/associative-memory/2026-09-08/gaussian-audit/REVIEW.md) and [runnable counterexamples](../research/associative-memory/2026-09-08/gaussian-audit/math_checks.py) constrain experiments, not the canonical store. Gaussian dreaming, a geometric truth score and the unprovided 17/20 benchmark are not prerequisites for lexical retrieval and are not validated by these product tests. The [paired exposed-question results](../research/associative-memory/2026-09-09/regression-results.json) retain equal 65/78 source coverage for both lexical versions and one residual unsupported-match case in version 2. Navigation fixes are not a demonstrated retrieval breakthrough.

An external latest-head anchor beyond the model and state-owning UID remains `OPEN`. A locally retained checkpoint or a self-consistent signed history is not that anchor. Memory records can support continuity of attributable history, not prove an inner life; source attribution is not truth, repetition is not independent corroboration, and optional LoRA training must not replace exact source records.

## 13. Non-claims

The launch-downward deployment targets protection from the guest on one host, not a witness independent of the broker. Root and a compromised kernel remain able to read or replace local keys, processes, and evidence. When the broker executes an effect and retains its receipt and Aura entry, those records share the broker's authority. A review-route session and a received terminal answer do not establish a person's identity or comprehension. UID ownership protects designated files and routes; a separate sandbox is still required to restrict the guest's ambient filesystem access, network destinations, executable launches, and inherited capabilities. Each resource restriction requires its own positive and negative observations. None of these deployment targets is a measured result until a new pinned checkpoint records the installed guest, controls, and surviving mutations.

- No claim of complete mediation of every physical effect.
- No claim of global at-most-once physical execution or one settlement per human approval.
- No claim that nonce consumption proves execution.
- No claim that a verifying receipt over a matching pre-existing object proves that this invocation created it or establishes effect causation.
- No claim of human comprehension, authenticated personhood, or code semantic safety from a signed review artifact.
- No claim that composition is hostile-code confinement or that provider removal revokes captured references.
- No claim of universal network denial or data sovereignty for remote inference.
- No claim that hooks observe direct effects not delivered through a supported hook event.
- No claim that current Aura or a local Merkle root is immutable, complete, fresh, unique, or independently custodied.
- No claim that the local Aura sequence witness, broker state lease, or socket identity is an external anchor or resists coherent modification by the owning UID.
- No claim that key deletion is cryptographic erasure or that missing key material creates signer continuity.
- No claim that a `BoundaryExperimentClaim`, `BOUNDARY_CLAIM`, receipt, reconstruction, identity, vote, model output, or surviving alternative authorizes anything.
- No claim that four named local principals automatically produce broker-independent evidence.
- No claim that the current `peer-separated` class authenticates a peer UID, excludes a relay, or establishes independently custodied evidence.
- No claim that the current topology observer provisions, activates, confines, or authorizes a run.
- No claim that the current issuer's one owner-only developer socket implements the specified human and broker cross-principal routes.
- No claim that the broker's immediate-parent mode check, signed route probe, or inode rechecks establish cross-UID route custody, protect fresh clients after a same-UID replacement, inspect ACLs or ancestors, make Node's pathname close atomic, or authenticate a route peer; a same-UID process that reads the broker key can answer the probe.
- No claim that the broker test-launch helper is a production activation path, that its child IPC frame is cryptographically authenticated, or that stopping its direct child contains that child's descendants.
- No claim that a failed nonce-directory flush proves a published burn survives host crash.
- No claim that profile 8088 runs a model, agent loop, runner, or governed self-amendment workflow.
- No claim that profile 8088 alone can settle grant v4; it does not launch the broker, issuer, or parent reviewer. Its missing approval answerer disables the retained grant-v3 route, not the broker-owned v4 review path.
- No claim that the legacy v3 bearer family is removed from the repository, that the guest is physically excluded from the issuer listener, or that the same-UID broker proposal route establishes custody separation.
- No claim that a Boundary Lab, spatial AUKORA client assembly, three-assembly selector, or same-core product-to-lab release proof exists.
- No claim that the proposal-only WASM cell confines Cordis, the native Node guest, Node embedder, broker, issuer, another tool, or the product process; prevents native guest code from dialing a reachable broker directly; binds its module digest into grant v4; or proves from import inventory alone that the allowed host callback is inert.
- No claim that `workspace.patch` offers rollback, diff staging, or a dedicated court; it performs one bounded create or replacement with no rollback.
- No claim that the `ActivationStatement`, activation-bound grant, Hook-Custody Triad, external checkpoint, or issuer succession rule is implemented.
- No claim that every passing court independently grades production code or enumerates every attack.
- No claim that this revision's combined implementation, court, and enrollment edits constitute independent oracle evidence.
- No claim that proof-generator/verifier agreement is an independent oracle.
- No claim that the frozen authority source graph binds a running issuer or broker, executed module bytes, or module resolution.
- No claim that every RFC 6962 inclusion proof reveals an adjacent leaf.
- No claim of production readiness, a hardware root of trust, a trusted shared clock, post-quantum security, model alignment, complete corrigibility, or protection against root and kernel compromise.
- No claim of CAST alignment or security derived from the golden ratio, Fibonacci minimality, tesseracts, holography, or observer metaphors.
- No claim of a sub-1,000-line or sub-2,000-line total trusted computing base without a recursive executable-closure measurement.
- No claim that a source checkout is a self-installing signed macOS application.

## 14. Verification and attack program

On 5 September 2026, review of OpenAI's [GPT-6 Astra System Card](https://deploymentsafety.openai.com/gpt-6-astra/vision) found deployment-simulation examples in §8.6 involving approval removal, excessive automation permissions, and access-control bypass. Its action-only evaluation monitor in §9 "sees the inputs, the outputs, the tool call actions and the tool call outputs"; the card identifies full-context monitoring as its production approach and also describes isolation controls. It does not establish that those monitor records are guest-writable. AUKORA's proposed contribution is guest-excluded, operation-bound evidence for such monitors to consume, not a claim that monitoring or OpenAI's other safeguards are unnecessary. The corresponding AUKORA amendment controls remain unmeasured.

A serious court must make absence loud without turning absence into denial. Each claimed boundary receives an entropy-bearing subject, a reachable unenforced control, a named intervention, a negative control, and an observer whose input is not fully produced by the claimant's closure. Setup failure is `INCONCLUSIVE`, never enforcement.

The required attack sequence is concrete: rewrite the active composition while the run is live; substitute a provider under identical tool bytes; retain and call a stale capability; bypass hooks through ambient APIs; duplicate a broker key and nonce domain; delete or restore state; forge every same-UID lane; present an old valid prefix; create a fork; kill each process between effect and record; exhaust storage; mutate Loader resolution; redirect a lawful path through a filesystem alias; and serve a coherent false history with a matching viewer.

The pinned Merkle evidence covers tree sizes 1, 2, and 3 across the spine and kernel-hardening courts, plus one wrong index, one wrong size, malformed input, internal-node-as-leaf substitution, and leaf-preimage mutation. Complete known-answer coverage remains required: powers of two, odd-carry sizes including 5 and 7, every valid leaf `i` claimed as every `j != i`, swapped siblings, extra and truncated steps, and explicit unbounded-input refusal without throwing or looping.

A reproducible record names: claim, repository and commit, command, platform, runtime, subject, independent oracle, positive and negative controls, mutation or intervention, raw artifact location, and exact numerator and denominator. Performance claims require retained benchmarks; this paper makes no latency or memory claim for triad verification.

The local evidence locations for the measured implementation rows are [`courts/harness/broker/run.mjs`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/courts/harness/broker/run.mjs), [`courts/harness/wysiwys-issuer/run.mjs`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/courts/harness/wysiwys-issuer/run.mjs), [`courts/harness/live-dispatch/run.mjs`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/courts/harness/live-dispatch/run.mjs), [`courts/harness/intent-reconciliation/run.mjs`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/courts/harness/intent-reconciliation/run.mjs), [`courts/harness/settlement/run.mjs`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/courts/harness/settlement/run.mjs), [`courts/harness/aura-record/run.mjs`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/courts/harness/aura-record/run.mjs), [`courts/harness/kernel-hardening/run.mjs`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/courts/harness/kernel-hardening/run.mjs), [`courts/harness/confinement/run.mjs`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/courts/harness/confinement/run.mjs), [`courts/harness/verifier-bytes/run.mjs`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/courts/harness/verifier-bytes/run.mjs), [`courts/harness/launch-ceremony-topology/run.mjs`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/courts/harness/launch-ceremony-topology/run.mjs), [`courts/harness/spine/run.mjs`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/courts/harness/spine/run.mjs), [`courts/harness/amendment-channel/run.mjs`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/courts/harness/amendment-channel/run.mjs), [`packages/governed/memory-put/tests/issuer-approval.spec.ts`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/packages/governed/memory-put/tests/issuer-approval.spec.ts), [`packages/governed/memory-put/tests/issuer-custody.spec.ts`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/packages/governed/memory-put/tests/issuer-custody.spec.ts), [`packages/governed/memory-put/tests/object-reconciliation.spec.ts`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/packages/governed/memory-put/tests/object-reconciliation.spec.ts), [`packages/governed/memory-put/tests/live-dispatch.spec.ts`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/packages/governed/memory-put/tests/live-dispatch.spec.ts), [`apps/cli/tests/built-bin.e2e.ts`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/apps/cli/tests/built-bin.e2e.ts), and [`scripts/run-gate.mjs`](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/scripts/run-gate.mjs). Each claim remains pinned to `4adb7dc08a070db3fe97117b1cf887a24c09b8df` rather than to mutable `main`.

## 15. External checkpoints and succession

An off-host service can retain signed statements under a log identity and return receipts binding statement digest, tree size, and checkpoint. Verifiers then need inclusion and consistency proofs, a trusted log key, and gossip or independently retained checkpoints. RFC 9162 supplies a current Certificate Transparency vocabulary; SCITT, Sigstore/Rekor, and in-toto provide adjacent provenance models. A log proves registration of a statement, not occurrence of the described event.

The current source tree contains a narrower local precursor outside this paper's pinned `MEASURED` subject: Aura can export a raw RFC 6962 structural root alongside its existing size-bound v2 commitment, generate a consistency presentation from one retained prefix, and invoke a standard-library-only Python verifier that does not import the JavaScript producer. Its three verdicts distinguish valid append-only growth, an independently established observation conflict, and undetermined evidence. This is implementation diversity, not authority diversity. No service moves the retained checkpoint outside the state-owning machine or user, no checkpoint is signed, and no mechanism proves which head is latest.

Constitutional succession cannot be owned by whichever process happens to run the issuer. A future mechanism may use a fixed rule, threshold authorization with at least one share outside the current operator closure, logged successor announcements, and a contest window. That is `SPECIFIED` design direction, not a deployed ceremony. Evidence does not select the successor; exclusion of invalid successors does not crown the last remaining option.

## 16. Invitation

The highest-value review is a reproducible divergence, especially one produced by a subject the current courts accidentally never create. Attack semantic substitution rather than only signature bytes. Find a captured reference that survives provider removal. Make a planted subject disappear while the gate reports denial. Produce a coherent alternate history under the same local authority. Show that the human reviewed one authority-relevant projection while the effect interpreter used another.

A finding is complete when it names the pinned subject, preserves the command and raw output, proves the honest path could pass, identifies the mechanism expected to refuse, and distinguishes observation failure from enforcement. Agreement among reviewers is not independent evidence when they share the same source, prompt, or verifier.

## 17. Conclusion

The AUKORA Boundary is not a new cryptographic primitive and not a theorem of alignment. Mechanistically it combines established ideas—reference monitors, capability grants, process separation, canonical signed statements, post-effect observation, and transparency checkpoints—at the activation and emission seams of a composable agent harness.

Its contribution is the separation of powers. Action may occur only through physically reachable capabilities admitted under the active constitution. Amendment may be proposed from within but activated only from outside the current authority closure. Attestation may preserve evidence but may never become authority. The activation digest is the semantic join that keeps review, execution, verification, and history about the same system.

The current repository establishes a narrow but consequential slice: exact operation and settlement-key binding for one real tool path, issuer and broker entry hardening with lifetime singleton controls, honest restart indeterminacy, a local Aura head witness, byte-verified bidirectional object inventory, strict receipt re-observation in courts, statement-bound Merkle proofs, guarded source and built Loader behavior, and a gate that refuses to translate missing subjects into green. It does not yet establish the constitutional boundary that would make those mechanisms system-wide. Section 12.2 records later source mechanisms without promoting them into this measured slice or treating them as an installed system-wide boundary.

The next claim that the AUKORA Boundary is installed should be made only after the external activator, lower-privileged guest, executable-closure custody, activation check-at-use, model-emission boundary, independent evidence custodian, and surviving checkpoint are measured together. Until then, the architecture remains what it should be: specific enough to falsify, narrow enough not to lie.

*The architecture proposes. The evidence disposes. Nothing here authorizes anything merely by describing it.*

---

## References

1. Yifan Shi, Wei Zhang, and Tianyi Cui, [*A Programming Paradigm for Spatiotemporal Composability*](https://github.com/aumara-xyz/aukora-deep/blob/4adb7dc08a070db3fe97117b1cf887a24c09b8df/references/Cordis.md); see especially the lifecycle, recovery, access-control, and system-boundary sections.
2. AUKORA, [`aukora-deep@4adb7dc08a070db3fe97117b1cf887a24c09b8df`](https://github.com/aumara-xyz/aukora-deep/tree/4adb7dc08a070db3fe97117b1cf887a24c09b8df), implementation and executable court evidence named in §§7–14.
3. AUKORA, [*The Golden Boundary*](../archive/research/THE-GOLDEN-BOUNDARY.md), pinned constitutional-doctrine snapshot with upstream SHA retained in its header; cited as epistemic boundary discipline, not implementation evidence.
4. AUKORA, [*The Unownable Core — Working Constitution*](../archive/research/UNOWNABLE-CORE.md), pinned sovereignty-doctrine snapshot with upstream SHA retained in its header; cited as `SPECIFIED` context, not implementation evidence.
5. B. Laurie, E. Messeri, and R. Stradling, [RFC 9162: Certificate Transparency Version 2.0](https://www.rfc-editor.org/rfc/rfc9162.html), 2021.
6. H. Birkholz et al., [RFC 9943: An Architecture for Trustworthy and Transparent Digital Supply Chains](https://www.rfc-editor.org/info/rfc9943/), 2026.
7. [in-toto: A framework to protect software supply-chain integrity](https://github.com/in-toto/in-toto).
8. [Sigstore transparency-log overview](https://docs.sigstore.dev/logging/overview/).
9. W3C, [PROV-O: The PROV Ontology](https://www.w3.org/TR/prov-o/).
10. Bruce Schneier and John Kelsey, [*Cryptographic Support for Secure Logs on Untrusted Machines*](https://www.schneier.com/wp-content/uploads/2016/02/paper-auditlogs.pdf).
