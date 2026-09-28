# AUKORA GOLDEN BOUNDARY — Rev 2.4

28 September 2026

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

## §4 — The running boundary

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

- **Approval fatigue.** If every meaningful action raises a cryptographic prompt, the person clicks yes mechanically and human authorization becomes theatre. The code comment at [`plugins/aukora-kira/lib/memory-tiers.mjs:7`](../plugins/aukora-kira/lib/memory-tiers.mjs#L7) is the source of this account: the approval-per-memory model was withdrawn because *"three records settled, a hundred and thirty waiting, and an owner who never knew he was supposed to approve anything."* No capability hierarchy — standing permissions with narrow scope, budgets, counterparties, resource ceilings and expiry, escalating to a full approval only for the unusual — is built or specified here.
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

---

[Earlier revision — preserved unchanged in the archive](AUKORA-GOLDEN-BOUNDARY-ARCHIVE.md).
