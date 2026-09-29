# AUKORA GOLDEN BOUNDARY — Rev 2.5

29 September 2026

**Rev 2.5 makes the network horizon explicit: the Sovereign Agent Mesh.** It adds a proposed path from person-controlled AI to cooperation across independent nodes, and identifies what to reuse from Buzz without transferring local authority to a workspace. The Rev 2.4 doctrine and recorded implementation limits are retained; the approval-fatigue paragraph now distinguishes the new proposed requirements from deployed capability. No new **RUNNING** row, deployed integration, test result or partnership is claimed. Source baseline: Genesis `b8e652cfda98fa7d09f3403be460574cc58c443f`; upstream sources are identified below.

**Rev 2.4 adds the second boundary to the front matter.** Rev 2.3 protected capability against authority; this revision states, in the opening pages, that **repetition must not manufacture evidence** — a principle the paper already carried in its network, memory and provenance sections, and which a reader should not have had to assemble. No claim was strengthened and no new capability is asserted. No **RUNNING** row was added.

## The problem

A model proposes actions; the software that proposes must not be the authority that permits. The app and agent still share a UID, the approval key is software, and nothing on GitHub requires the approval routes. These are limits of the present boundary.

## The Unownable five laws

Quoted from [this paper's earlier §2](AUKORA-GOLDEN-BOUNDARY-ARCHIVE.md#2-the-boundary-and-the-person), where they are constitutional goals inherited from *Unownable Core*. They are obligations, not achieved guarantees:

> - Evidence and reconstructed memories do not create authority.
> - An identity does not automatically gain governing power over others.
> - A model, evaluator, maintainer, or founder cannot approve its own expansion of power
>   merely by describing that expansion as beneficial.
> - Removing an observer or mediator does not silently widen an effect path.
> - Refusal, interruption, revocation, portability, and exit remain meaningful.

## Care without control

Care grants no authority. **[DOCTRINE]** Peter Viviani's [Care Without Control](CARE-WITHOUT-CONTROL.md), a speculative design note, asks whether growing capability can be paired with a stable orientation toward human flourishing without ever converting care into control; nothing here tests that hypothesis. **[HORIZON]** Auma is not an authorizer: warmth, memory and confidence approve nothing; only the owner's approval routes below move the boundary. **[DOCTRINE]**

## Authority and provenance in a synthetic world

This paper protects **two** boundaries, not one, and they are siblings.

> As models become able to generate actions, greater capability must not manufacture greater **authority**.
>
> As models become able to generate unlimited accounts, reports, summaries and media, greater repetition must not manufacture greater **evidence**.

The first is the subject of most of this document. The second is the reason the memory, provenance and network work exists at all, and it is stated here because a reader should not have to assemble it from sections further down.

**Three invariants, which almost everything else in this paper serves:**

1. **Capability does not create authority.** A smarter machine does not acquire more permission.
2. **Repetition does not create evidence.** A thousand descendants of one observation remain one evidentiary ancestry.
3. **Relationship does not create personhood.** Keys, histories and vouches can establish continuity and relationships without pretending to prove unique humanity.

**What the architecture does and does not attempt.** AUKORA does not attempt to prove that a key belongs to one unique human, that a signed claim is true, or that a vouch establishes personhood. Instead it asks whether authority and provenance can survive copying, transformation and communication. A signature can establish that a key stood behind particular bytes. A retained history can establish relationships between records. A vouch can record an introduction. Provenance can distinguish independent observations from descendants of the same observation. **None of those facts alone establishes truth or humanity.** **[DOCTRINE]**

**The consequence, in one line:**

> **In a synthetic information environment, a thousand agents repeating one source must not become a thousand independent sources.**

Four children repeating the same rumour does not mean four children saw it happen. That is the anti-mimetic principle, and the consolidation machinery exists to enforce it.

**The composition, named rather than left to the reader.** *Nostr* can move signed events but is not an authority oracle. *Aumlok* concerns authority and custody. *Aura* concerns retained history and evidence. *Kira* concerns memory and the provenance distinctions above. *Vouches and relationships* can express who recognises whom without magically proving humanity. *Anti-mimetic consolidation* attempts to stop copied ancestry from masquerading as independent evidence. Their possible composition is a network in which communication may be machine-generated while **authority and evidentiary lineage remain inspectable**. **[HORIZON]**

**Not "no bots allowed."** Bots are allowed. **Bots just do not get to counterfeit authority or multiply one observation into a consensus.** **[DOCTRINE]**

**[HORIZON]** If provenance survives across communication and transformation, future retrieval and training systems could distinguish independent observations from copied descendants, preserve attribution and authorization metadata, and weight information according to inspectable lineage rather than repetition alone. **Provenance does not establish truth, copyright ownership, consent beyond the recorded scope, dataset completeness, or that training occurred.** Nothing in this repository implements this, and no part of the claim above is tested here.

## Sovereign Agent Mesh — collaboration without merged authority

**[HORIZON]** The longer-term unit is not one assistant with everyone's passwords. It is a network of person-controlled nodes: each with its own models, memory, resource limits, keys and right to refuse. A person could ask Auma to assemble a project team; the agents could exchange tasks, produce software, review findings and offer specialist computation, without any participant becoming the administrator of the others.

> **Intelligence can cooperate at machine speed while authority remains separately controlled by people. Collaboration does not merge sovereignty.**

A project, business, research group or temporary team could form across those nodes. The same person could participate in several projects without giving any project their whole digital life. Models, collaboration services and compute suppliers would be replaceable; identity continuity, authorised memory, relationships and the right to stop or leave would remain the durable layer. That is the intended meaning of **“the person is the platform”**, not a claim that people control other people's resources or need no infrastructure. **[HORIZON]**

### What exists, and what this revision adds

At the inspected Genesis source baseline `b8e652cfda98fa7d09f3403be460574cc58c443f`, [the Nostr module](../plugins/aukora-nostr/README.md) documents node identity, Aumlok-to-Nostr bindings, peer contact checks, encrypted messaging and retained-event evidence. [Its event implementation](../plugins/aukora-nostr/lib/event.mjs) constructs canonical event IDs and BIP-340 signatures. These are existing building blocks; a source read is not a fresh live exchange or proof of production custody. **[SOURCE PRESENT]**

[The Kira consolidation implementation](../plugins/aukora-kira/lib/consolidate.mjs) supplies the narrower ancestry-grouping rule described above. [The containment research](research/containment/CORE-EXTRACT.md) explores OpenShell and the sovereign-runtime direction; it explicitly does not establish live integration. This revision adds a **proposed mesh design**, not a deployed scheduler, delegated peer-execution service, Buzz adapter or shared-inference cluster. No new **RUNNING** claim follows from it. **[HORIZON]**

### The collaboration path

The following is a proposed workflow, not today's automatic behaviour:

```text
Person A -> Auma planner -> signed task offer
                                 |
                       Nostr / optional Buzz workspace
                                 |
                                 v
                    Person B's verified task inbox
                                 |
                    B's local policy and delegation
                                 |
                     confined worker / chosen model
                                 |
                   result + artifact + scoped evidence
                                 |
                                 v
                    A's independent review and staging
                                 |
                    A's resource-authority decision
                                 |
                     protected broker -> observed outcome
```

For example, A may request a Documents feature while B and C offer implementation and review. B's own policy could permit reading that project, creating a scratch branch and running bounded tests. A's request supplies no additional rights on B's machine. B returns a patch and test evidence; it does not write A's protected files. A's authorised promotion path decides whether the exact candidate enters A's repository or running release. **[PROPOSED]**

**Task acceptance, review approval and execution authorisation are three different decisions.** A project-room reaction, a relay administrator's approval, a signed “done”, or a successful test cannot become an Aumlok grant by reinterpretation. For a shared repository, the repository's configured authority policy controls promotion; another contributor's approval is not sufficient by itself. Routine work may run under bounded standing delegations rather than making people click through every step. Expansion of scope remains a separate decision by the relevant resource controller. **[DOCTRINE / PROPOSED]**

### What to distil from Buzz

[Buzz's README][buzz-readme] describes a self-hostable workspace combining humans, agents, channels, workflows, Git and artifacts. Its [architecture][buzz-architecture] makes the relay authoritative for a workspace, with custom event kinds and HTTP services as well as Nostr. This is relevant implementation work and prior art, **not an already-deployed federation of independently sovereign AUKORA nodes**. The README still labels workflow approval gates as being wired up and cross-relay web-of-trust reputation as future work. **[UPSTREAM-DOCUMENTED; not independently run here]**

The proposed reuse boundary is a **thin Cordis collaboration adapter**, initially connected to one selected workspace or relay. Keep the existing AUKORA desktop, Nostr primitives, Kira, Aura and approval path. Do not begin by forking the whole Buzz application or replacing the harness. The adapter is a replaceable integration component, not a new authority issuer. **[PROPOSED]**

| Buzz pattern | Proposed AUKORA use | Boundary that must remain |
| --- | --- | --- |
| Shared project rooms and linked discussions | One project view of tasks, patches, review and results | Channel membership is not authority over a member's computer. |
| Typed event builders | Versioned task/result/artifact envelopes | Event construction, communication signing and authority issuance stay separate. |
| Distinct agent identities | Attribute which delegated worker submitted something | An agent's communication key is not the person's control root. |
| Git events and artifact revisions | Link work to an exact repository, base commit and candidate digest | Receiving or reviewing a patch does not promote it. |
| Workflow triggers and audit events | Coordinate bounded work and retain relevant evidence | A trigger is a request; a relay log is not independent execution proof. |

Buzz's inspected [`buzz-sdk` interface][buzz-sdk] explicitly separates input validation and event building from caller signing and network I/O. That is a useful pattern to reuse or interoperate with. Actual code reuse requires a pinned dependency and review of its transitive requirements; the adapter need not import a Rust server stack into the trusted Node process. Buzz's own [sovereign-workspace vision][buzz-vision] also permits collaboration over existing GitHub repositories, so replacing the forge is not a prerequisite. **[SOURCE PRESENT / UPSTREAM-DOCUMENTED]**

Its [security policy][buzz-security] describes relay-side membership controls and a hash-chain audit log whose chain can be recomputed by a database writer. Therefore private workspace access is not automatically end-to-end secrecy from the operator, and a Buzz audit entry is not an independently retained Aura checkpoint. Copying either assertion into an AUKORA guarantee would be a mistake. Buzz is Apache-2.0-licensed; any reused code must retain applicable licences and notices. This document imports no Buzz code and changes no repository licence. **[UPSTREAM-DOCUMENTED / PROPOSED]**

### Small contracts across the boundary

Begin with task offers, task responses, result manifests and artifact references. These are proposed message classes, not allocated Nostr kind numbers or existing AUKORA APIs. Fix the schema version and map to supported protocols explicitly. [NIP-34][nip34] already describes Git collaboration; [NIP-94][nip94] describes file metadata including retrieval locations and hashes. Large artifacts need not be embedded in relay events. **[PROPOSED; protocol references]**

A task contract should identify the task and revision, authenticated sender and recipient, project/resource scope, exact input artifacts, requested output, deadline and budget ceiling. A result should identify the accepted task revision, exact source/tree and output digests, what was actually tested, the environment, known failures and evidence ancestry. Authority grants, where needed, remain separate objects with holder, audience, scope, epoch, expiry and use/budget checks at the receiving broker. **[PROPOSED]**

A transport acknowledgement means only that the relay accepted an event. The application must distinguish delivery, local acceptance, work completion, review and authorised promotion. Duplicate delivery must not run a job twice or spend permission twice; stale results must not overwrite newer work; cancellation must stop new covered admissions without claiming to undo an already-emitted effect. Task revisions and conditional updates need explicit conflict handling rather than “last message wins”. **[PROPOSED]**

### The controls that make the mesh sovereign

**Separate contact from permission.** Pin or otherwise authenticate the peer's control binding through a defined ceremony. An introduction or vouch asserts a relationship, not personhood or an unlimited capability. Revoked or unknown bindings must not become trusted because a workspace displays a familiar name. **[PROPOSED]**

**Treat even a friend's agent as untrusted input.** Parse bounded envelopes and inspect fetched artifacts in confined staging. A valid signature identifies a key; it does not make a document, model response or build script safe. Sharing information, running tests, sending messages, spending compute and promoting code each require the applicable local authority. **[PROPOSED]**

**Bound the swarm, not just each task.** Delegation needs aggregate compute/spending limits, maximum child-task depth, timeouts and a stop path that works without the planner. A peer may not turn one permitted task into an unlimited cascade across other peers. Lease expiry and local revocation must work during disconnection; remote cancellation cannot be assumed instantaneous. **[PROPOSED]**

**Preserve evidence without manufacturing consensus.** Recorded shared ancestry can expose copied claims; non-overlapping declared ancestors do not prove independence. Independent test execution must be distinguished from several models rereading one report. Different model families can still share vulnerabilities. Peer reviews may inform an approval policy, but signatures or a quorum never supply authority absent that policy. Keep scoped results and retained checkpoints, not an “eternal record of everything” or private model reasoning. **[DOCTRINE / PROPOSED]**

**Protect the collaboration control plane.** Membership changes, agent enrolment, relay replacement, workflow edits and new provider access can expand what is disclosed or invoked. Those changes need their own governed path. The workspace operator may control the workspace; it must not thereby control participants' local signing keys, recovery or authority policy. **[PROPOSED]**

### Local intelligence, shared compute and remote services

**[HORIZON]** Each node could select local models, commercial APIs or an explicitly approved peer compute pool without changing the origin of its authority. Hyperspace's [Pod documentation][hyperspace-pods] describes peer/sharded inference and cloud fallback; that is an upstream proposal/implementation claim, not a runtime audited or adopted here. Pooling machines is optional. Independent task execution is a smaller first step than splitting one model across distant devices.

**Local access is not necessarily local processing.** A localhost API may forward a prompt to another machine or cloud service. The node must bind provider, permitted recipients, data-disclosure scope, model/version where verifiable, cost and fallback policy. No silent remote fallback for a local-only task; no Aumlok phrase or private memory sent to peers merely because they volunteered compute. Model downloads, updates and training participation are separately governed. **[PROPOSED]**

**[HORIZON]** A specialised remote service could appear in Cordis as a local proxy with an explicit contract. It does not inject the peer's arbitrary code into the trusted host. Network loss requires leases, timeouts and unavailable states; Cordis teardown cannot synchronously revoke a disconnected peer or reverse its external effects. Nostr can carry coordination and artifact references while an independently authorised transport carries heavier compute traffic. Neither transport becomes the authorizer.

### A small first mesh, not a premature platform

**[PROPOSED / UNRUN]** Start with two separately provisioned nodes, disposable identities and a public test project: offer one review task, accept it under the recipient's local scope, return one digest-bound artifact and report, then stage it for the resource owner's existing approval route. Use GitHub branches/PRs for delivery initially; a Buzz room can coordinate without replacing Git or Aumlok. Required checks include a successful allowed task, an out-of-scope request refused, duplicate delivery deduplicated, a stale result held, a failed/unknown peer binding refused, an exhausted budget stopped and an unavailable relay reported without gaining permission. Claims about production confinement wait for the actual confined deployment.

The next milestones are a qualified collaboration adapter, reliable fresh-node identity binding, protected local effects and revocation, and one meaningful export/recovery exercise without the original workspace. Only then expand to multi-node scheduling, remote services, shared inference or evidence-aware training. This lane complements the containment and custody work below; it does not mark those holes closed or make joining a network safe by itself. **[PROPOSED]**

**[HORIZON]** The eventual system could assemble temporary teams of humans and machines across software, research, design and physical interfaces. The durable achievement would not be one indispensable application or one collective mind. It would be **portable cooperation: people can pool intelligence without pooling away their authority, and can leave without losing the records they are entitled to retain.** This is a direction to test, not a guarantee supplied by Nostr, Buzz, Cordis or a model vendor.

## §4 — The running boundary

**Revision note:** The following running-boundary and live-evidence records are retained from Rev 2.4 as dated operator reports. They were not re-measured for Rev 2.5.

The installed app runs `aukora-release-0496ba077`, built from main `0496ba077`. **RUNNING** below records the supplied operator status; it is not independent live verification. The README's “What is not enforced” bounds every claim.

| Claim | Status | Scope and limit |
| --- | --- | --- |
| Kernel `decide()` on every app-session tool call | RUNNING | The action gate invokes the carried kernel. No one-use grant per tool call; child-process tools and processes outside the app are outside this gate. |
| Exact-byte approval with a one-use kernel consume on self-change and MOVE MAIN | RUNNING | One-use belongs to these approval routes, which run from a checkout of `main`; self-change has run with real approvals in the AUKORA popup. |
| Membrane minimal verifier gating restarts | RUNNING | `become.mjs` checks all four histories: `OBSERVATION_CONFLICT` refuses; `UNDETERMINED` refuses except `missing_prior_observation`. `POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE` is not permitted. |
| Four-history witness: code, actions, memory and remembered notes | RUNNING | First live run in the `0496ba077` become (2026-09-28 13:18 WITA): code `APPEND_ONLY`; actions, memory and remembered notes were first observations, retained after success. Retained heads remain under `state/`, writable by the same UID. |
| Automatic memory through the pinned WASM cell | RUNNING | A relay, not a sandbox; automatic notes grant no authority. |
| Airlock key custody in a second macOS account | RUNNING | `airlock-probe`: EACCES, operator-recorded, 2026-09-28. Any process running as the owner's user can still REQUEST a signature. |
| Deep's guest launcher, broker and issuer | ON MAIN, NOT MOUNTED | Source in `plugins/aukora-box/`; the live agent remains on the host. |
| Live agent inside a confined guest | NOT BUILT | The guest source is not a deployed agent boundary. |
| Stock harness plugins under policy | NOT ON MAIN | Stock plugins still load ungoverned. |
| TrustedStateStore restore protection integrated into Genesis approval state | RUNNING | Self-change and MOVE MAIN run `decide.mjs` from a checkout of `main`; the high-water witness is at `~/.aukora-witness/kernel-high-water.json`, outside `state/`. The same UID can rewrite both state and witness. Kira's memory markers are not covered. |
| CI | RUNNING | `.github/workflows/check.yml` runs `sh scripts/check.sh` on every push; it checks the repository, not the installed app. |

The action gate checks shell text and can miss targets hidden in scripts or variables. Full-access sessions remain unconfined by Seatbelt. Source call paths support the implementation descriptions; they do not reproduce the recorded live results.

## Live evidence

These are **operator-recorded lines, not independently reproduced** for this revision:

- `2026-09-27T23:53:16Z | 25149f573 | ALPHA full-access sed -i on plugins/aukora-kira → deny | rule authority:governing-code | kernelCode sacred_target | file untouched`
- `CI | 16/16` — [recorded run 36361238805](https://github.com/aumara-xyz/aukora-genesis/actions/runs/36361238805).
- `First Airlock approval | main → f87b72b68 | approving key did:key:z6MkiP8BnvVRZJcxtv9TShdq3KUGc7wF1skbZBJbQ96jAtCm` — approved in the AUKORA popup; the record names a key, not a proven person.

## Ceilings

The app and agent share a UID; the Airlock socket accepts signature requests from any process of that UID. Attendance is reported, not proven. The phrase-derived root has about 34 bits and can be guessed offline. Embedded app frames share the desktop origin. The live agent runs on the host. No independent re-implementation of the verifiers exists. Nothing on GitHub requires the approval routes: a direct push is not stopped.

The candidate file cap is 65,536 UTF-8 bytes, a fail-closed draft-size ceiling (`LIMITS.MAX_PATCH_BYTES` in `vendor/aukora-seed-app/lib/apps/seed/src/proposal.js`, applied to each non-generated file by `scripts/aukora/aumlok-candidate-authority.mjs`); no reason for that value is recorded in the code.

## Ways this fails after confinement

The ceilings above are first-order holes. These are second-order ones, and each becomes visible only after the first is closed. They are named here because they are invisible from inside the confinement work, and because a reviewer outside this project named four of them on 2026-09-28 before this section existed.

- **Approval fatigue.** If every meaningful action raises a cryptographic prompt, the person clicks yes mechanically and human authorization becomes theatre. The code comment at [`plugins/aukora-kira/lib/memory-tiers.mjs:7`](../plugins/aukora-kira/lib/memory-tiers.mjs#L7) is the source of this account: the approval-per-memory model was withdrawn because *"three records settled, a hundred and thirty waiting, and an owner who never knew he was supposed to approve anything."* No capability hierarchy — standing permissions with narrow scope, budgets, counterparties, resource ceilings and expiry, escalating to a full approval only for the unusual — is established by the running-boundary evidence above. The mesh section now states proposed requirements; it does not deploy that hierarchy.
- **Key recovery.** The person's authority root must not be losable in a way that destroys their digital life permanently, and must not be recoverable in a way that quietly gives somebody else ownership. Those two constraints pull against each other. Nothing in this tree designs either. Item 4 below replaces a weak root with a stronger one; that is root *strength*, not root *recovery*, and it does not address this.
- **Ecosystem compatibility.** A sovereign agent that speaks only to AUKORA software is an island, not a sovereign. Nostr is a standard and covers transport. The plugin format is this project's own. A person-owned layer has to interoperate or it is simply a smaller platform.
- **Psychological authority without cryptographic authority.** The *Care without control* section above says warmth, memory and confidence approve nothing. That is true and it is held by the approval routes (GitHub does not require them; see the README's What is not enforced). It is not the same claim as **warmth, memory and confidence do not persuade.** A system that holds a person's history, speaks in a familiar voice and assists them for years can acquire extraordinary influence while holding no key at all. **Technical non-authority does not eliminate psychological authority.** On a long enough horizon this may carry as much weight as the authorization kernel. Nothing here measures it. **[HORIZON]**

The Ceilings and this list are separate on purpose: the first states what is true of the running release today, the second states what has not been built and is not claimed.

## 90 days — plans

These are plans, in order, not completed work or promised results:

1. Put the live agent inside Deep's guest: **no confinement, no start**. Remove its ambient host authority.
2. Have a broker perform approved effects. Isolate embedded app frames from the desktop origin and authority.
3. Give the socket caller identity beyond UID. Develop a trusted approval interaction with separate attendance evidence; caller identity alone does not prove a person attended.
4. Replace the phrase-derived root with a stronger random root, at least 128 bits, unlocked by the words. Measure custody and offline-guess resistance.
5. Commission an independent re-implementation of the verifiers and compare their acceptance and refusal behavior.
6. Add branch protection that requires the approval routes on GitHub.
7. Build a capability hierarchy so that ordinary action needs no prompt: standing permissions with narrow scope, budgets, counterparties, resource ceilings and expiry. Escalate only the unusual. **Measure how often a person approves without reading** — that number is the real test of whether authorization is real or theatre.
8. Design key recovery that is neither destructively losable nor quietly reassignable, and state plainly which of the two constraints the design sacrifices.
9. State the interoperability boundary: which standards this speaks (Nostr for transport) and which parts are this project's own (the plugin format).

### Mesh lane alongside the local hardening plan

**[PROPOSED / UNRUN]** Preserve the priority of confinement, custody and exact-effect admission. The containment backend may be Deep's guest or a qualified OpenShell profile; neither source presence nor a room-level workflow grants permission. The in-tree [containment extraction](research/containment/CORE-EXTRACT.md) is research, not an activated boundary.

The first collaboration increment is task-and-result exchange using existing Nostr primitives and Git artifacts. The second is a thin Buzz adapter with explicit disclosure, identity and workflow mappings. The third is cross-node bounded delegation, after local enforcement and fresh-node onboarding are measured. Shared inference and remote Cordis providers remain later experiments. No new repo, token economy, shared master key or replacement of the desktop/forge is required.

## Network-horizon sources and scope

Reviewed 29 September 2026. Buzz sources below are pinned to `12670bd0f037c66a682272bb81c46c3f254fad74`; Hyperspace documentation is pinned to `fb067577f6645ca66cfbc271fc13a38533f1b402`. NIP links are upstream living drafts. This was a targeted documentation and interface read, including Buzz's SDK and AUKORA's event implementation, not a complete audit or execution of either network. **UPSTREAM-DOCUMENTED** statements report the source; **PROPOSED** requirements and **HORIZON** scenarios are this paper's design direction. No code is imported by this revision.

[buzz-readme]: https://github.com/block/buzz/blob/12670bd0f037c66a682272bb81c46c3f254fad74/README.md
[buzz-architecture]: https://github.com/block/buzz/blob/12670bd0f037c66a682272bb81c46c3f254fad74/ARCHITECTURE.md
[buzz-sdk]: https://github.com/block/buzz/blob/12670bd0f037c66a682272bb81c46c3f254fad74/crates/buzz-sdk/src/lib.rs
[buzz-vision]: https://github.com/block/buzz/blob/12670bd0f037c66a682272bb81c46c3f254fad74/VISION_SOVEREIGN.md
[buzz-security]: https://github.com/block/buzz/blob/12670bd0f037c66a682272bb81c46c3f254fad74/SECURITY.md
[nip34]: https://github.com/nostr-protocol/nips/blob/master/34.md
[nip94]: https://github.com/nostr-protocol/nips/blob/master/94.md
[hyperspace-pods]: https://github.com/hyperspaceai/agi/blob/fb067577f6645ca66cfbc271fc13a38533f1b402/docs/PODS.md

---

[Earlier revision — preserved unchanged in the archive](AUKORA-GOLDEN-BOUNDARY-ARCHIVE.md).
