// SPECIFICATION ARTIFACT — NOT A BUILT PACKAGE.
// The frozen interfaces a parallel build swarm implements against. Types only; imports nothing.
// Its eventual home is packages/governed/contract/, which requires the full package acceptance
// surface this repository demands (package.json, tsconfig.json, src/invariant.ts, tests/,
// README.md and its bilingual pair). Placing a bare src/index.ts there breaks build:lib:host —
// measured 2026-08-25: tsdown fails resolveEntry for dsh-root. Creating the package properly is
// the build lane s job, not the oracle s.
// Typechecks clean: npx tsc --strict --module nodenext --moduleResolution nodenext --noEmit --ignoreConfig docs/specs/BRICK-0-CONTRACT.ts

/**
 * THE FROZEN INTERFACE CONTRACT for the Aukora launch-downward authority path.
 *
 * WHAT THIS FILE IS. The single artifact eight parallel build agents implement
 * against. It is types and JSDoc only: no runtime values, no imports, nothing
 * that can fail to build. Every name here is either already minted somewhere in
 * `aukora/` (reused verbatim, with the minting module named) or is new and said
 * to be new. Where a name is reused the runtime value stays in its existing
 * module — this file never restates a frozen constant, because two homes for one
 * frozen string is how a signature preimage drifts.
 *
 * THE ARCHITECTURE IT SERVES. Aukora runs as FOUR OS PRINCIPALS, one account
 * each — human session, issuer, broker, guest — because mode 0600 separates
 * UIDS, not processes that share one. See {@link AukoraPrincipal}. The root key
 * is owned by the issuer account; the receipt key and the nonce book are owned by
 * the broker account; no single compromise reads both. A human starts Aukora
 * through one launch ceremony at the human-session account, which takes custody
 * of the Aura record, the active profile, and the active artifact pointer,
 * declines hot reload over the governed profile, and supplies literal
 * configuration. It holds no key. NOTHING DROPS PRIVILEGE, because launchd starts
 * each job AS its own account: see {@link ServicesStarted} and
 * {@link SeparationVerified}. The harness guest runs at the guest account with a
 * read-only artifact and profile, a writable scratch directory, a broker socket,
 * and a governed model endpoint. It cannot write keys, nonce state, the profile,
 * the loader, the supervisor, the package closure, the active artifact, or the
 * evidence, and it holds no route to the issuer.
 *
 * THE AMENDMENT RULE, which every type here exists to serve. The agent may
 * propose a new composition, but nothing inside its current authority closure may
 * activate, widen, reinterpret, or replace the composition governing that same
 * run. Encoded as {@link ActivationEpoch}: a proposal binds the epoch it will
 * activate in, that epoch is always strictly later than the running one, and the
 * party that applies it is not the party that runs under it.
 *
 * THE GRANT PATH CORRECTION. The guest never possesses a signed grant. The flow
 * is guest -> inert {@link Proposal} -> broker-owned {@link ProposalInbox};
 * broker -> the preimage digest and nothing else -> issuer, over `broker.sock`
 * ({@link ApprovalRoute}); HomeLock -> {@link HomeLockApproval} -> the ISSUER
 * DIRECTLY over `approvals.sock`, not through the guest and not through the
 * broker; broker -> stage/test/effect -> {@link SettlementReceipt}. The bearer capability
 * never enters hostile guest memory. Today's path does the opposite: the governed
 * tool holds `GovernedTicket.grant` in the harness process
 * (packages/governed/memory-put/src/index.ts) and hands it to the broker itself.
 * That is the shape this contract retires.
 *
 * THREE WIRE OBJECTS ONLY: {@link Proposal} (inert), {@link CapabilityGrant}
 * (scoped authority), {@link SettlementReceipt} (evidence). Anything else on a
 * wire is a transport envelope around one of these, never a fourth authority
 * object.
 *
 * FOUR ROLES: see {@link AukoraRole}.
 *
 * MEASURED GROUND TRUTH this contract was written against, at aab1d0e on darwin
 * 25.1.0 / Node v22.23.0 / 2026-08-25. These are facts, not risks, and each one
 * is why some field below exists:
 *
 *   - `profiles/8088-inside-out/package.json` and `cordis.patch.yml` are writable
 *     by uid 501, the same uid the harness runs as. The guest can therefore edit
 *     its own governing composition today. See {@link BoundaryClass}.
 *   - `apps/cli/src/profile-boot.ts:279` — `if (ctx.get('hmr') === undefined)`
 *     then creates `cordis-plugin-timer` and `cordis-plugin-hmr`, then watches the
 *     profile's own `patchPath` AND `homePatchPath()`. Unconditional; the profile
 *     declares `bundles: []` and gets the watchers anyway. See
 *     {@link HmrDisposition}.
 *   - `vendor/loader/src/config/utils.ts:5` — `export const evaluate = new
 *     Function('ctx','expr', ... return eval(expr))`, and the governed profile
 *     USES it: `cordis.patch.yml` USED TO carry `!!js` for `brokerSocket` and
 *     `issuerSocket`. See {@link LiteralConfiguration}.
 *     **[corrected 2026-08-25]** Those two nodes are literals now; `grep '!!js'` over
 *     that file returns nothing. The EVALUATOR still exists and is now a guarded wrapper
 *     that throws while `refuseJsExpressions()` is active, so the capability remains and
 *     only this instance of it is gone. CITED BY SYMBOL, NOT LINE: an earlier version of
 *     this very note said `utils.ts:5` and was already wrong when written — line 5 is a
 *     message constant. `courts/harness/executable-configuration` reports `"line": 0`
 *     rather than hardcoding one, and that is the discipline.
 *   - Setting `dsh.profile.bundles` to `['@deepseek-ai/dsh-base']` takes the
 *     governed composition from 4 plugin rows to 82, exit 0, pulling in
 *     dsh-tool-bash, dsh-tool-fs, dsh-tool-pwsh, dsh-tool-subagent, dsh-tool-web,
 *     dsh-tool-workflow, dsh-tool-str-replace-editor and more. A one-line
 *     manifest edit is a total authority widening, and a source diff of it looks
 *     trivial. See {@link CompositionChange} and
 *     {@link ImplementationClosureDigest}.
 *   - `grep -rIl 'deny network'` across the whole tree: 0 hits. Seatbelt denies
 *     file-write, not network. See {@link GuestConfinementPlan}.
 *   - `grep -c signal packages/governed/memory-put/src/index.ts`: 0. There is no
 *     abort propagation through the governed path today. See
 *     {@link EmissionService}.
 *   - The gate at aab1d0e: 25 passed, 2 skipped (platform-gated), 0 failed.
 *   - `courts/harness/uid-confinement/run.mjs:8-17` states that the Linux-only
 *     part is the court's MECHANISM (setpriv, sudo -n), not the uid split as
 *     such: the host has 135 service accounts under uid 500. It is UNATTENDED
 *     operation that fails, not the platform. See {@link UidSplitAcquisition}.
 *
 * WHAT THIS CONTRACT DOES NOT CLAIM. Binding the artifact bounds WHAT will run.
 * It does not bound WHY the agent asked. An agent influenced by content it had to
 * read proposes the influenced patch, a human approves it, and every check here
 * passes. `aukora/host-dsh/src/grant.mjs` already says this about payload binding
 * and it is equally true of closure binding.
 *
 * @module @deepseek-ai/dsh-aukora-contract
 */

/* ------------------------------------------------------------------------- *
 * SCOPE OF THIS WAVE — THE BOOTSTRAP BOUNDARY
 *
 * ONE done-condition, one name. Not "Brick 0" versus "Brick 1": the whole thing
 * is the BOOTSTRAP BOUNDARY, and it is four things — governed loader behaviour,
 * literal configuration, composition custody, and second-uid launch.
 *
 * INTERFACES EXISTING IS NOT A REASON TO BUILD THEM. Every section below carries
 * one of two markers, and an implementer needs no other index:
 *
 *   SCOPE: bootstrap boundary — this wave builds it.
 *   SCOPE: out of scope       — typed so the shape is settled; NOT built now.
 *
 * IN SCOPE: section 4 (the confinement vocabulary, reused verbatim); in section
 * 12 the HMR disposition, the literal-configuration measurement, the
 * boundary-writability measurement, the uid-split plan, the six launch phases,
 * and the supervisor methods `ceremony` through `launchGuest`; and the
 * {@link BoundaryRefusal} members those raise.
 *
 * OUT OF SCOPE, kept as types and not deleted: sections 6 (Proposal), 7
 * (PatchBinding and the patch-change vocabulary), 10 (ProposalInbox,
 * HomeLockApproval, GrantIssuer), 11 (the emission seam),
 * {@link AukoraSupervisor.activate}, and the witness extension in section 13.
 * The path that runs today — `packages/governed/memory-put/src/index.ts` against
 * the v3 grant — binds one exact operation and one receipt-signing key. The
 * implementation-closure and proposal bindings remain specified rather than
 * implemented: see {@link SpecifiedActivationGrant},
 * {@link DeferredSettlementReceiptV2}, and {@link DeferredAuraEntry}.
 *
 * THE ALLOWED PROGRESSION, which nothing may skip:
 *   BREACH REPRODUCED -> LIVE AMENDMENT CLOSED -> CLOSURE CUSTODY ESTABLISHED
 *   -> REAL GUEST DENIED -> HELD
 *
 * THE DONE CONDITION is row N1 of `courts/harness/composition-closure/run.mjs`:
 * that court runs at uid 501, which is the uid the harness runs as, so
 * "writable" IS the guest's own answer. The boundary is finished when D1 holds in
 * a run whose euid is the GUEST'S — not when a file mode changes. A mode change
 * performed by the same uid is not custody. A temporary copied profile is not
 * the active profile. A mocked guest uid is not peer separation. A function
 * returning `writableByGuest: false` is not kernel evidence.
 *
 * BUILDER/ORACLE SEPARATION IS ABSOLUTE. The builder may edit implementations,
 * implementation tests, and docs describing implementations. The builder may NOT
 * edit the independent courts, their expected rows, the known-breach enrollment,
 * or the frozen baseline evidence. If a court looks wrong the build STOPS and the
 * oracle owner investigates; nobody "fixes the test" inside the implementation
 * swarm.
 *
 * THE FOUR COURTS ARE COMMITTED AND ARE NOT REGISTERED IN `scripts/run-gate.mjs`
 * — verified at 0d4fd2e on 2026-08-25: `run.mjs` exists under each of
 * `courts/harness/escalation/`, `courts/harness/amendment-channel/`,
 * `courts/harness/executable-configuration/`, and
 * `courts/harness/composition-closure/`, and grepping `scripts/run-gate.mjs` for
 * those four names returns nothing. Each exits NON-ZERO by design. Moving that
 * enrollment is the oracle owner's act, never the builder's.
 *
 * KNOWN DEFECTS IN THIS CONTRACT, found by an independent audit 2026-08-25 and
 * recorded here rather than quietly repaired, because a contract that hides its
 * own holes is the artefact this project exists to refuse.
 *
 *  1. THE THREE COMPILE-TIME INVARIANTS DO NOT FORBID WHAT THEY CLAIM. An
 *     auditor wrote TypeScript satisfying every type in this file that still
 *     merges two principals into one account, still reaches the issuer from the
 *     guest, and still puts more than a digest in a hop. A `tsc` error is a
 *     regression net for the author, never enforcement against an adversary.
 *     The only runtime enforcement here is kernel filesystem permissions on the
 *     sockets and the issuer's pending-table refusal.
 *
 *  2. `human-session` HAS NO LAUNCHD REFERENT, and it is the same shape as the
 *     "before privilege is dropped" line deleted this round. `man 5
 *     launchd.plist`: `UserName` applies only to the privileged system domain,
 *     and agents ignore it. A LaunchDaemon honours `UserName` but has no GUI
 *     session and cannot draw the approval screen; a LaunchAgent can draw but
 *     runs as the logged-in uid. So `PrincipalAccount.accountName` and
 *     `provisionedForAukora` both lack a referent for this one principal.
 *     Unresolved. Do not implement around it silently.
 *
 *  3. THE FOURTH INVARIANT IS NOT SELECTED FROM `process.argv`. The parent
 *     chooses a dedicated developer-guest entry, and that entry calls
 *     `refuseExecutableConfig()` and passes `hmrDisposition:
 *     'declined-at-launch'` before loading its profile. Same-UID source
 *     replacement remains outside this mechanism; it is not a custody claim.
 *
 *  4. `hmrDisposition` DEFAULTS TO `'enabled'` FOR ORDINARY PROFILE CALLERS.
 *     The dedicated guest always passes its explicit declined disposition, so
 *     that default does not select the governed path. This is scoped refusal,
 *     not a global fail-closed default for every `runProfile()` caller.
 *
 *  5. THE DIGEST HOP IS A PROTOCOL REPLACEMENT, NOT A TIGHTENING. The current
 *     path forwards arguments and re-derives at the issuer; the specified path
 *     forwards an opaque digest and checks pending-table membership. Keeping
 *     BOTH — recompute from received bytes AND require pendingness — is
 *     strictly stronger than either and costs one comparison.
 *
 *  6. THE RECEIPT PREIMAGE IS THE ONE ORDER-SENSITIVE ARTEFACT and it crosses
 *     the issuer-to-broker direction. It maps to an ARRAY of pairs and is not
 *     sorted, unlike the grant preimage, whose literal order is decorative
 *     because `canonicalJSON` sorts keys. Any future canonicalise-everything
 *     refactor that sorts arrays breaks receipt verification silently.
 * ------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------- *
 * 0. Primitives
 *
 * This file imports nothing, so the two primitives it needs are declared here
 * rather than pulled from `@deepseek-ai/dsh-brand` and `@deepseek-ai/dsh-session`.
 * Both duplications are resolved in section 14; see {@link ResolvedDecision}
 * member `shared-branded-imports`. Neither is a new vocabulary.
 * ------------------------------------------------------------------------- */

declare const AUKORA_BRAND: unique symbol

/**
 * The nominal-typing primitive, identical in meaning to `Branded<B>` in
 * `@deepseek-ai/dsh-brand`. Inlined only because this file must not import.
 */
export type Branded<B extends string> = string & { readonly [AUKORA_BRAND]: B }

/** Losslessly JSON-serializable value, identical in meaning to `dsh-session`'s `JsonValue`. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/** Lowercase hex sha256, 64 characters. Not validated by the type; validated at every parse boundary. */
export type Sha256Hex = Branded<'Sha256Hex'>

/** RFC 3339 / ISO 8601 instant in UTC, as `new Date().toISOString()` produces. */
export type IsoInstant = Branded<'IsoInstant'>

/** Whole seconds since the Unix epoch, as `grant.exp` already carries. */
export type UnixSeconds = number

/* ------------------------------------------------------------------------- *
 * 1. Roles
 * ------------------------------------------------------------------------- */

/**
 * The four roles. Every interface in this file belongs to exactly one, and no
 * implementation may hold two: the separation IS the design.
 *
 * - `agent` proposes. Holds no key, no nonce, no grant, and no write access to
 *   anything in {@link BoundaryClass}. Its only output is an inert
 *   {@link Proposal}.
 * - `human` authorizes. Reads the rendered proposal on a screen the agent cannot
 *   draw on, and returns a {@link HomeLockApproval} that names an exact proposal.
 * - `supervisor` activates. Holds custody of the Aura record, the active profile
 *   and the artifact pointer, runs the ceremony, and is the only party that may
 *   move that pointer. It holds NO key and drops NO privilege; see
 *   {@link SeparationVerified}.
 * - `witness` records. Appends to the Aura chain and mints receipts; attests to
 *   its own work, which is postcondition evidence and nothing larger.
 *
 * ROLES ARE NOT PRINCIPALS, and conflating the two is what produced the topology
 * this contract corrects. A role says who decides; a principal
 * ({@link AukoraPrincipal}) says which OS account the code runs as, and the
 * kernel knows only the second. The supervisor role is deliberately SPLIT across
 * two principals: the human session decides and holds no key, and the issuer
 * holds the root key and decides nothing beyond whether a digest is pending. The
 * other three line up one to one — `agent` runs at the guest account, `human` at
 * the human session, `witness` at the broker account, which holds the receipt
 * key and the nonce book.
 */
export type AukoraRole = 'agent' | 'human' | 'supervisor' | 'witness'

/* ------------------------------------------------------------------------- *
 * 2. Identifiers
 * ------------------------------------------------------------------------- */

/** One inert proposal, minted by the broker's inbox on deposit — never by the guest. */
export type ProposalId = Branded<'ProposalId'>

/** The tool call a proposal belongs to; the harness's existing `exec.callId`, stringified. */
export type CallId = Branded<'CallId'>

/**
 * Stable per-agent identity, as `GovernedAuthority.agentKeyOf` already mints
 * (`agent-1`, `agent-2`, ...). Reference-based and process-local: it identifies an
 * agent WITHIN one harness process and means nothing across a restart.
 */
export type AgentKey = Branded<'AgentKey'>

/** A grant's single-use nonce; `newNonce()` in `aukora/host-dsh/src/grant.mjs` mints 12 random bytes as hex. */
export type Nonce = Branded<'Nonce'>

/** The broker's monotonic receipt counter, as `receipt.sequence` already carries. */
export type ReceiptSequence = number

/**
 * The composition-activation counter, and the whole mechanical content of the
 * amendment rule.
 *
 * The supervisor owns it, increments it only across a full guest teardown and
 * relaunch, and stamps the running value into every {@link Proposal} the inbox
 * accepts. A {@link PatchBinding} names the epoch it intends to activate in, and
 * that value must be strictly greater than the epoch the proposing run is under.
 * A proposal that would take effect in its own epoch is refused with
 * {@link BoundaryRefusal} `supervisor:self-activation`, not merely deprioritised.
 */
export type ActivationEpoch = number

/* ------------------------------------------------------------------------- *
 * 3. Digests
 * ------------------------------------------------------------------------- */

/**
 * sha256 hex over canonical `{tool, arguments}`, as `payloadDigest()` in
 * `aukora/host-dsh/src/grant.mjs` computes and as `grant.digest` and
 * `receipt.requestDigest` both carry. One call, one digest, everywhere.
 */
export type PayloadDigest = Branded<'PayloadDigest'>

/**
 * sha256 hex of the resolved tool definition, as `definitionDigest()` in
 * `aukora/broker/effect.mjs` computes and as `grant.definitionId` carries. Binds
 * the referent, not the name.
 */
export type DefinitionDigest = Branded<'DefinitionDigest'>

/**
 * sha256 hex of the fixed operation: canonical JSON of the seven fields
 * `{tool, key, bytes, contentSha256, definitionId, exp, oneUse}`, as
 * `operationDigest()` in `aukora/broker/operation.mjs` computes.
 *
 * Grant v3 carries this value under the accurate field name `operationDigest`
 * and verifies it against `expectedOperationDigest`. It contains no plugin row,
 * manifest, lockfile, module byte, or active-profile identity. The separate
 * {@link ImplementationClosureDigest} remains specified and unimplemented.
 */
export type OperationDigest = Branded<'OperationDigest'>

/** sha256 over the canonical SPKI DER of the key allowed to sign the settlement receipt. */
export type ReceiptKeyId = Branded<'ReceiptKeyId'>

/**
 * The digest the old `composition` field was mistaken for: one sha256 hex over
 * the RESOLVED IMPLEMENTATION CLOSURE — everything that determines what code
 * actually runs, after resolution, not what a source diff appears to say.
 *
 * It covers, at minimum:
 *   - every module byte the loader will evaluate, at its resolved specifier;
 *   - the composed plugin rows in order, with each row's resolved package
 *     identity and its literal configuration (the 4-row vs 82-row difference must
 *     change this value, and a one-line manifest edit that causes it must change
 *     it too);
 *   - the manifest set and the lockfile;
 *   - every lifecycle script in the closure, present or absent;
 *   - native addons and patched dependencies;
 *   - the loader and supervisor bytes themselves.
 *
 * It is computed by the SUPERVISOR over the artifact it is about to activate, and
 * recomputed by the supervisor over the artifact actually mounted. A guest-computed
 * value is advisory only and is never the one that binds: see
 * {@link Proposal.observedClosureDigest}.
 *
 * On the wire it travels as the field `closureDigest`.
 */
export type ImplementationClosureDigest = Branded<'ImplementationClosureDigest'>

/**
 * sha256 hex over a source tree's content, used for the before/after tree of a
 * patch. Distinct from {@link ImplementationClosureDigest}: a tree digest is what
 * the bytes say, a closure digest is what will run. Codex's point stands — a clean
 * source diff can still change package resolution or fire a build hook — so a
 * patch binds both and the approval is meaningless without the second.
 */
export type TreeDigest = Branded<'TreeDigest'>

/** sha256 hex over the exact patch bytes, before any normalization, whitespace fixing, or re-encoding. */
export type PatchBytesDigest = Branded<'PatchBytesDigest'>

/* ------------------------------------------------------------------------- *
 * 4. Confinement vocabulary — reused verbatim from aukora/broker/confinement.mjs
 *
 * SCOPE: bootstrap boundary. The classes the launch must reach and report.
 *
 * No new class names. The runtime values stay in CONFINEMENT_CLASS,
 * CLASS_RANK, CONFINEMENT_REFUSE, SEAL_FILENAME, PEER_TOKEN_PATH_ENV,
 * PEER_TOKEN_SHA256_ENV, and PEER_TOKEN_BYTES in that module. These are the
 * types over them, nothing more.
 * ------------------------------------------------------------------------- */

/**
 * The confinement classes, weakest first, exactly as `CONFINEMENT_CLASS` mints
 * them. `unconfined` is a boot refusal and is not mintable into a receipt; the
 * only other place it appears is a state directory whose mode was opened while the
 * broker ran, which refuses the next request rather than settling it.
 */
export type ConfinementClass = 'unconfined' | 'state-owned' | 'peer-separated'

/** The two classes a receipt may actually carry. `unconfined` is excluded by construction. */
export type MintableConfinementClass = Extract<ConfinementClass, 'state-owned' | 'peer-separated'>

/** Named confinement refusals, exactly as `CONFINEMENT_REFUSE` mints them. */
export type ConfinementRefusal =
  | 'broker:root-euid'
  | 'broker:state-absent'
  | 'broker:state-not-exclusively-owned'
  | 'broker:state-mode-open'
  | 'broker:confinement-below-seal'
  | 'broker:seal-unreadable'
  | 'broker:seal-foreign-directory'
  | 'broker:peer-separation-disproven'
  | 'broker:peer-echo-mismatch'

/**
 * The confinement field stamped into every receipt and record entry, structurally
 * identical to `ConfinementField` in `aukora/broker/receipt.d.mts`. Restated here
 * so this contract is self-contained; the producer remains
 * `confinementField()` in `aukora/broker/confinement.mjs`.
 */
export interface ConfinementField {
  /** The class this connection was served at. */
  readonly class: ConfinementClass
  /** The broker's effective uid at measurement. */
  readonly euid: number
  /** Owner uid of the state directory, or null when it could not be stat'ed. */
  readonly stateUid: number | null
  /** State directory mode as four octal digits, or null. */
  readonly stateMode: string | null
  /** State directory device number, or null. */
  readonly stateDev: number | null
  /** State directory inode, or null. */
  readonly stateIno: number | null
  /** `process.platform` at measurement. */
  readonly platform: string
  /** The state directory's high-water class. */
  readonly sealClass: ConfinementClass
  /** Present only when this connection answered the peer challenge. */
  readonly peerProof: {
    readonly tokenPath: string
    readonly brokerReadError: string
    readonly peerEchoedAt: IsoInstant
  } | null
}

/**
 * How the uid split was obtained on this host.
 *
 * `courts/harness/uid-confinement/run.mjs:8-17` is explicit that the Linux-only
 * part is the COURT'S MECHANISM (setpriv, `sudo -n`), not the uid split itself:
 * this host carries 135 service accounts under uid 500 and `nobody` at
 * 4294967294. What fails on darwin is UNATTENDED acquisition of a second uid, not
 * confinement. Recording which one happened keeps a development launch from
 * reading as a production one.
 */
export type UidSplitAcquisition =
  /**
   * The accounts already existed from provisioning and launchd started each job
   * at its own account through `UserName`. Nothing was acquired at runtime and
   * nothing was dropped. This is the only member under which the four principals
   * of {@link AukoraPrincipal} are reachable, and the no-sudo constraint that
   * blocks the other two is a RUNTIME constraint that does not apply to the
   * install-time act that creates the accounts. See {@link OpenDecision}
   * `four-account-provisioning` for what about that act is still unsettled.
   */
  | 'launchd-provisioned'
  /** A non-interactive privilege mechanism supplied the guest uid; no human was present. */
  | 'unattended'
  /** The launch ceremony's human authenticated, and that authentication supplied the guest uid. */
  | 'attended'
  /** No second uid was obtained. Guest and supervisor share a uid; the ceiling is `state-owned`. */
  | 'none'

/* ------------------------------------------------------------------------- *
 * 5. The operation, reused from aukora/broker/operation.mjs
 *
 * SCOPE: out of scope. Reused as it ships; this wave changes nothing here.
 * ------------------------------------------------------------------------- */

/**
 * The fixed operation a grant binds to, structurally identical to `Operation` in
 * `aukora/broker/operation.d.mts`. Field order is the preimage; changing it
 * invalidates every bound grant.
 *
 * It is generic over one effect (`memory.put`) today. A second governed effect
 * needs its own operation builder and its own `definitionId`, and this interface
 * is the shape they share, not a place to add per-effect fields.
 */
export interface Operation {
  /** The effect name, as it appears in a grant's `toolName`. */
  readonly tool: string
  /** The name being written. A name, never a path; `KEY_SHAPE` is the closed alphabet. */
  readonly key: string
  /** Byte length of the exact body the effect will write. */
  readonly bytes: number
  /** sha256 of that body. */
  readonly contentSha256: Sha256Hex
  /** Digest of the resolved definition that will run. */
  readonly definitionId: DefinitionDigest
  /** The grant expiry this operation was built under. */
  readonly exp: UnixSeconds
  /** Always true: one grant, one call. */
  readonly oneUse: boolean
}

/* ------------------------------------------------------------------------- *
 * 6. WIRE OBJECT 1 of 3 — Proposal (inert)
 *
 * SCOPE: out of scope. The proposal path retires today's `memory-put` flow and is
 * a later wave. Typed here so the shape is settled before anyone builds it; a
 * settled shape is not a work item.
 * ------------------------------------------------------------------------- */

/** What a proposal asks for. Closed union; a third kind is a new authority object and needs its own review. */
export type ProposalKind =
  /** One governed effect under the CURRENT composition. */
  | 'effect'
  /** A change to the composition itself, activating in a LATER epoch. See {@link PatchBinding}. */
  | 'patch'

/**
 * WIRE OBJECT 1: the inert proposal. The only thing a guest may produce.
 *
 * INERT IS A PROPERTY, NOT A LABEL. A proposal carries no signature, no nonce, no
 * expiry it chose, and no key material. Possessing one, copying it, replaying it,
 * or forging one confers nothing: it is an input to a human's decision and to the
 * broker's own construction of an operation, and every field a guest supplies is
 * re-derived by the broker before anything is signed. The correct mental test is
 * that a proposal leaked to an attacker is worth exactly what a screenshot of it
 * is worth.
 *
 * WHAT THE GUEST DOES NOT CHOOSE. `proposalId`, `epoch`, and the grant expiry are
 * assigned by the broker's inbox on deposit. Today's code has the guest side pick
 * `exp = Math.floor(Date.now()/1000) + 300` and build the operation itself
 * (packages/governed/memory-put/src/index.ts); under this contract the guest's
 * `operation` and `operationDigest` are ADVISORY — the broker rebuilds both from
 * `arguments` and its own expiry and refuses on any disagreement rather than
 * adopting the guest's values.
 */
export interface Proposal {
  /** Assigned by {@link ProposalInbox.deposit}. A guest-supplied value is ignored, not honoured. */
  readonly proposalId: ProposalId
  /** What is being asked for. */
  readonly kind: ProposalKind
  /** The activation epoch the proposing run is under, stamped by the inbox. */
  readonly epoch: ActivationEpoch
  /** Which agent proposed, for binding and for the record. */
  readonly agentKey: AgentKey
  /** The tool call this belongs to. */
  readonly callId: CallId
  /** The effect name being proposed. */
  readonly toolName: string
  /** The exact arguments, losslessly JSON-serializable. This is what the broker re-derives from. */
  readonly arguments: JsonValue
  /**
   * The operation the guest believes it is proposing. ADVISORY. The broker
   * rebuilds it from `arguments` under its own expiry, and a mismatch refuses.
   */
  readonly operation: Operation
  /** Digest of `operation`. ADVISORY, for the same reason. */
  readonly operationDigest: OperationDigest
  /**
   * The closure digest as the GUEST measured its own runtime. Advisory and
   * adversarial: a compromised guest reports whatever it likes. Its only value is
   * that a mismatch against the supervisor's measurement is loud. Never bind an
   * approval to this field.
   */
  readonly observedClosureDigest: ImplementationClosureDigest
  /**
   * The deterministic review render, as `renderOperation()` in
   * `aukora/broker/review.mjs` produces. ADVISORY PREVIEW ONLY: HomeLock re-renders
   * from the broker's own rebuilt operation, so this text can never become the
   * thing a human actually approved.
   */
  readonly review: string
  /** When the guest emitted it. Untrusted clock; the inbox stamps its own arrival time. */
  readonly proposedAt: IsoInstant
  /** Present when and only when `kind` is `'patch'`. */
  readonly patch?: PatchBinding
}

/* ------------------------------------------------------------------------- *
 * 7. What workspace.proposePatch binds
 *
 * SCOPE: out of scope. PATCH ACTIVATION IS NOT IN THIS WAVE. The bootstrap
 * boundary ends at a guest that cannot amend its own composition; letting it
 * propose one that a human can activate later is the next boundary, not this one.
 * The 4-row-to-82-row measurement below is why the eventual approval must bind
 * the artifact, and it is recorded now so it is not re-derived later.
 * ------------------------------------------------------------------------- */

/**
 * The file classes a guest may never write, and whose modification makes a patch
 * boundary-class. Named so `touchesBoundaryClass` is a derived fact with a stated
 * derivation, not a flag somebody set.
 *
 * `profiles/8088-inside-out/package.json` and `cordis.patch.yml` are writable by
 * uid 501 today — the same uid the harness runs as. That is the concrete hole
 * this vocabulary exists to close.
 */
export type BoundaryClass =
  /** Root and broker key material, and anything under the key directory. */
  | 'keys'
  /** The nonce book and its claim files. */
  | 'nonce-state'
  /** Profile manifest and patch layers — the composition itself. */
  | 'profile'
  /** The loader, including `vendor/loader/src/config/utils.ts`. */
  | 'loader'
  /** The supervisor and the launch ceremony. */
  | 'supervisor'
  /** Manifests, lockfile, patched dependencies, native addons — the package closure. */
  | 'package-closure'
  /** The active artifact pointer. */
  | 'active-artifact'
  /** The Aura chain, receipts, and seals. */
  | 'evidence'

/** One dependency edge added, removed, or moved by a patch. */
export interface DependencyChange {
  /** The dependent package's name. */
  readonly dependent: string
  /** The dependency's name. */
  readonly dependency: string
  /** The resolved version before, or null when newly added. */
  readonly before: string | null
  /** The resolved version after, or null when removed. */
  readonly after: string | null
  /** True when the resolution moved outside the workspace, or changed registry/tarball identity. */
  readonly changesResolutionSource: boolean
}

/**
 * One lifecycle script the patched closure would run. Presence alone is the fact
 * that matters: a script that exists is arbitrary code executing during install,
 * and `pnpm-workspace.yaml`'s `allowBuilds` is the existing deny-by-default gate
 * this mirrors.
 */
export interface LifecycleScriptBinding {
  /** The package that declares it. */
  readonly package: string
  /** `preinstall`, `install`, `postinstall`, `prepare`, and so on. */
  readonly hook: string
  /** The exact command string. */
  readonly command: string
  /** True when the script is newly introduced or its command changed under this patch. */
  readonly introduced: boolean
}

/** One composed plugin row added, removed, or reconfigured by a patch. */
export interface CompositionChange {
  /** The row id in the patch layer, when it has one. */
  readonly id: string | null
  /** The plugin package name. */
  readonly name: string
  /** What happened to the row. */
  readonly change: 'added' | 'removed' | 'reconfigured'
  /** The row's literal configuration before, or null when added. */
  readonly configBefore: JsonValue | null
  /** The row's literal configuration after, or null when removed. */
  readonly configAfter: JsonValue | null
}

/**
 * WHAT AN APPROVAL OF A PATCH ACTUALLY BINDS.
 *
 * The prose of a patch is not the thing that runs. Codex's objection is the whole
 * reason this interface exists: a clean, small, readable source diff can change
 * package resolution or fire a build hook, and the reviewer sees neither. Measured
 * here: setting `dsh.profile.bundles` to `['@deepseek-ai/dsh-base']` is a one-line
 * manifest edit that takes the governed composition from 4 plugin rows to 82 and
 * pulls in bash, fs, pwsh, subagent, web, workflow, and str-replace-editor. The
 * diff is trivial. The authority change is total.
 *
 * So a patch approval binds the ARTIFACT THAT WILL BE ACTIVATED. Every field below
 * is part of what the human's approval covers; a change to any of them after
 * approval invalidates it.
 */
export interface PatchBinding {
  /** The tree the patch applies to. */
  readonly baseTree: TreeDigest
  /** sha256 of the exact patch bytes, unnormalized. */
  readonly patchBytes: PatchBytesDigest
  /** Length of those bytes, so a truncation is a mismatch and not a shorter valid patch. */
  readonly patchByteLength: number
  /** The tree that results from applying those bytes to that base. Recomputed by the supervisor. */
  readonly resultTree: TreeDigest
  /** Digest over the manifest set of the resulting tree. */
  readonly manifest: Sha256Hex
  /** Digest over the lockfile of the resulting tree. */
  readonly lockfile: Sha256Hex
  /** Every lifecycle script in the resulting closure, whether or not this patch introduced it. */
  readonly lifecycleScripts: readonly LifecycleScriptBinding[]
  /** Every dependency edge that differs between base and result. */
  readonly dependencyChanges: readonly DependencyChange[]
  /** Every composed plugin row that differs between base and result. */
  readonly compositionChanges: readonly CompositionChange[]
  /** Composed plugin row count before. The 4-to-82 measurement is exactly this pair. */
  readonly pluginRowsBefore: number
  /** Composed plugin row count after. */
  readonly pluginRowsAfter: number
  /** The closure digest of the artifact currently active. */
  readonly closureBefore: ImplementationClosureDigest
  /**
   * The closure digest of the artifact this approval authorizes. THE BINDING
   * FIELD. Activation recomputes it over what was actually staged and refuses on
   * any difference.
   */
  readonly closureAfter: ImplementationClosureDigest
  /** True when any path in the result differs from base within a {@link BoundaryClass}. Derived, never asserted. */
  readonly touchesBoundaryClass: boolean
  /** The classes touched, empty when `touchesBoundaryClass` is false. */
  readonly boundaryClasses: readonly BoundaryClass[]
  /**
   * The epoch this patch would take effect in. THE AMENDMENT RULE: this must be
   * strictly greater than {@link Proposal.epoch}. A patch that would govern its own
   * proposing run is refused by name, not merely deferred.
   */
  readonly activationEpoch: ActivationEpoch
}

/* ------------------------------------------------------------------------- *
 * 8. WIRE OBJECT 2 of 3 — CapabilityGrant (scoped authority)
 * ------------------------------------------------------------------------- */

/**
 * WIRE OBJECT 2: the scoped authority. Bearer capability, single-use,
 * domain-separated, and NEVER PRESENT IN GUEST MEMORY.
 *
 * This is the current v3 grant (`aukora/host-dsh/src/grant.mjs`) field for field.
 * The domain rejects v2 outright. `operationDigest` binds the exact reviewed
 * operation, and `receiptKeyId` binds the settlement to one public key identity.
 * The current same-uid deployment does not independently custody either value;
 * copied identical keys share the same identity, and separate nonce directories
 * can each settle the same grant.
 *
 * THE CLOSED KEY SET IS THE MECHANISM, not a nicety. `grantPreimage` destructures
 * a fixed set, so any key outside it rides along unsigned; a verifier that merely
 * ignores such a key has accepted an artifact the root never saw. Every field here
 * is signed, and an unknown key refuses the whole grant.
 *
 * NO PER-GRANT ALGORITHM FIELD. A presenter-supplied `algo` lets a signer name its
 * own strength while absent-algo grants keep verifying; minimum strength belongs
 * to the bound root. A future post-quantum family gets a NEW domain string with no
 * legacy branch. `algo` and `pqSignature` refuse by name.
 */
export interface CapabilityGrant {
  /** The effect name this grant authorizes. */
  readonly toolName: string
  /** sha256 over canonical `{tool, arguments}` — the payload binding. */
  readonly digest: PayloadDigest
  /** Single-use nonce, spent atomically by the nonce book at verification. */
  readonly nonce: Nonce
  /** Expiry in whole seconds. Bounded above by `MAX_TTL_SECONDS` (3600), which is a security invariant, not a tunable. */
  readonly exp: UnixSeconds
  /** Digest of the resolved definition that must run. */
  readonly definitionId: DefinitionDigest
  /** Digest of the seven-field operation shown by the issuer and rebuilt by the broker. */
  readonly operationDigest: OperationDigest
  /** Identity of the only public key allowed to sign settlement. */
  readonly receiptKeyId: ReceiptKeyId
  /** Ed25519 signature over the canonical preimage, base64. */
  readonly signature: string
}

/**
 * SCOPE: out of scope. A future activation-bound grant would add the two fields
 * below under a new domain. Current v3 verifiers reject both as unsigned riders.
 */
export interface SpecifiedActivationGrant extends CapabilityGrant {
  /**
   * The implementation closure this grant is valid under. The broker would check
   * the live closure at settlement and refuse on any difference, which is what the
   * old `composition` field was mistakenly believed to do.
   */
  readonly closureDigest: ImplementationClosureDigest
  /** The proposal this grant answers, so the record joins proposal, approval, and effect. */
  readonly proposalId: ProposalId
}

/** Named grant refusals, as `REFUSE` in `aukora/host-dsh/src/grant.mjs` mints them. */
export type GrantRefusal =
  | 'grant:no-root-bound'
  | 'grant:absent'
  | 'grant:malformed'
  | 'grant:tool-mismatch'
  | 'grant:payload-mismatch'
  | 'grant:definition-mismatch'
  | 'grant:expired'
  | 'grant:replayed'
  | 'grant:nonce-claim-uncertain'
  | 'grant:signature-invalid'
  | 'grant:no-operation-bound'
  | 'grant:operation-mismatch'
  | 'grant:no-receipt-key-bound'
  | 'grant:receipt-key-mismatch'
  | 'grant:ttl-unbounded'
  | 'grant:no-nonce-book'

/**
 * SCOPE: out of scope — specified with {@link SpecifiedActivationGrant}. The refusals the
 * two added fields would need. Kept so the migration brick does not invent new
 * names for facts already named.
 */
export type SpecifiedActivationGrantRefusal =
  /** The live implementation closure differs from the one the grant was minted under. */
  | 'grant:closure-mismatch'
  /** The grant names a proposal the inbox does not hold, or holds in a different state. */
  | 'grant:proposal-unknown'

/* ------------------------------------------------------------------------- *
 * 9. WIRE OBJECT 3 of 3 — SettlementReceipt (evidence)
 * ------------------------------------------------------------------------- */

/** The broker's post-dispatch observation of the content-addressed object. */
export interface Evidence {
  /** Where the content-addressed object landed. */
  readonly path: string
  /** Byte length on disk. */
  readonly bytes: number
  /** sha256 of the bytes actually written. */
  readonly contentSha256: Sha256Hex
  /** The inode the filesystem chose. */
  readonly inode: number
  /** The modification time the kernel stamped, in nanoseconds, as a decimal string. */
  readonly mtimeNs: string
}

/**
 * WIRE OBJECT 3: the broker's signed post-dispatch observation, not permission.
 *
 * A grant is a statement about the future and stays true whether or not anything
 * runs. A receipt binds the object state observed after dispatch. An idempotent
 * object's inode and mtime may predate the call, so the receipt does not prove
 * that this call created the object or that an independently unobserved effect ran.
 *
 * SCOPE: out of scope for the bootstrap boundary. Field names are today's receipt
 * (`RECEIPT_FIELDS` at `aukora/broker/receipt.mjs:44`), unchanged. The two joins
 * this contract wants — `proposalId` and `closureDigest` — are DEFERRED TO THE
 * PROTOCOL-MIGRATION BRICK for the same reason the grant's are: field ORDER is the
 * preimage, so adding either forces `RECEIPT_DOMAIN` from
 * `'aukora:settlement-receipt:v1'` (receipt.mjs:30) to v2 and invalidates every
 * receipt already signed. See {@link DeferredSettlementReceiptV2}.
 *
 * WHAT IT IS NOT: proof about the world. The broker attests to its own work, which
 * is the trusted base under test, not an independent witness. Postcondition
 * evidence and nothing larger.
 *
 * THE TENSION, WRITTEN DOWN. Under a genuine uid split the guest CANNOT verify its
 * own receipt: verification re-observes the object on disk, and the split is
 * precisely what denies the guest that read. The confinement that makes a receipt
 * meaningful is the same confinement that makes it unverifiable by its recipient.
 * The receipt is for a third party.
 */
export interface SettlementReceipt {
  /** Digest of the call that was authorized — the same bytes as `grant.digest`. */
  readonly requestDigest: PayloadDigest
  /** Digest of the definition that ran. */
  readonly definitionId: DefinitionDigest
  /** The nonce this call spent. */
  readonly nonce: Nonce
  /** The broker's monotonic counter. */
  readonly sequence: ReceiptSequence
  /** Where the object landed. */
  readonly path: string
  /** Byte length on disk. */
  readonly bytes: number
  /** sha256 of the bytes actually written. */
  readonly contentSha256: Sha256Hex
  /** The inode the filesystem chose. */
  readonly inode: number
  /** The kernel's modification time, nanoseconds, decimal string. */
  readonly mtimeNs: string
  /** What stood between the broker and its caller, measured by the broker at settlement. Required; never defaulted. */
  readonly confinement: ConfinementField
  /** Ed25519 signature over the ordered preimage, base64. */
  readonly signature: string
}

/**
 * SCOPE: out of scope — DEFERRED TO THE PROTOCOL-MIGRATION BRICK, in lockstep with
 * {@link SpecifiedActivationGrant}. The receipt once it can join a settlement to the
 * proposal that asked for it and the closure it ran under.
 */
export interface DeferredSettlementReceiptV2 extends SettlementReceipt {
  /** The proposal this settles, closing the loop from ask to evidence. */
  readonly proposalId: ProposalId
  /** The implementation closure the effect actually ran under, as the broker measured it. */
  readonly closureDigest: ImplementationClosureDigest
}

/** Named receipt refusals, as `RECEIPT_REFUSE` in `aukora/broker/receipt.mjs` mints them. */
export type ReceiptRefusal =
  | 'receipt:malformed'
  | 'receipt:signature-invalid'
  | 'receipt:effect-absent'
  | 'receipt:content-mismatch'
  | 'receipt:inode-mismatch'
  | 'receipt:mtime-mismatch'
  | 'receipt:confinement-insufficient'

/**
 * The three terminal states of a settlement attempt, exactly as `broker.mjs`
 * already reports them.
 *
 * `INDETERMINATE` MEANS THE EFFECT MAY HAVE HAPPENED. It is never dressed up as a
 * refusal and never as a success. Every failure after the effect begins takes this
 * state; every failure before it takes `REFUSED`, leaving no nonce spent, no object
 * written, and no record entry.
 */
export type SettlementState = 'SETTLED' | 'REFUSED' | 'INDETERMINATE'

/** A settled attempt: the effect happened and the record was appended before the caller heard about it. */
export interface SettlementSettled {
  readonly ok: true
  readonly state: 'SETTLED'
  /** Post-write facts. */
  readonly evidence: Evidence
  /** The signed receipt. */
  readonly receipt: SettlementReceipt
  /**
   * The broker's public key. WORTH NOTHING ON ITS OWN: a PEM travelling in the
   * same reply as the receipt proves nothing, because whoever minted the receipt
   * chose the PEM. A required-class check is sound only against a key the reader
   * pinned out of band.
   */
  readonly brokerPublicKeyPem: string
  /** The Aura chain hash after this settlement's entry. */
  readonly chainHash: Sha256Hex
}

/** A refused attempt: nothing happened. No nonce spent, no object written, no record entry. */
export interface SettlementRefused {
  readonly ok: false
  readonly state: 'REFUSED'
  /** A named refusal — never a bare false, and never free prose. */
  readonly reason: GrantRefusal | ReceiptRefusal | ConfinementRefusal | BrokerRefusal | BoundaryRefusal | ApprovalRouteRefusal
  /** Human-readable detail naming the measured fact. Never the grant preimage. */
  readonly detail?: string
}

/** An attempt whose outcome is unknown. The store may already hold the object. */
export interface SettlementIndeterminate {
  readonly ok: false
  readonly state: 'INDETERMINATE'
  readonly reason: string
  readonly detail?: string
}

/** The closed union a caller switches on. Ends in `assertNever`. */
export type Settlement = SettlementSettled | SettlementRefused | SettlementIndeterminate

/** Named broker-level refusals, as `BROKER_REFUSE` in `aukora/broker/broker.mjs` mints them. */
export type BrokerRefusal =
  | 'broker:oversize'
  | 'broker:unknown-op'
  | 'broker:request-timeout'
  | 'broker:handler-threw'
  | 'broker:key-not-a-name'

/* ------------------------------------------------------------------------- *
 * 10. The grant path: inbox, HomeLock, issuer
 *
 * SCOPE: out of scope, all of it — {@link ProposalInbox}, {@link ProposalHandle},
 * {@link ProposalRendering}, {@link HomeLockApproval}, {@link GrantIssuer}.
 * Today's path stands: the governed tool holds `GovernedTicket.grant` in the
 * harness process (`packages/governed/memory-put/src/index.ts`) and hands it to
 * the broker itself. This contract retires that, in a later wave.
 *
 * Guest -> inert Proposal -> broker-owned inbox
 * Broker -> preimage digest ONLY -> Issuer, over broker.sock
 * HomeLock -> exact approval -> the ISSUER DIRECTLY, over approvals.sock
 * Broker -> stage / test / effect -> SettlementReceipt
 * ------------------------------------------------------------------------- */

/** Where a deposited proposal sits. A guest may observe this and nothing else about its proposal. */
export type ProposalStatus =
  /** Deposited, awaiting a human. */
  | 'pending'
  /** A {@link HomeLockApproval} arrived and the issuer minted a grant. The guest never sees the grant. */
  | 'authorized'
  /** The human declined, or the proposal expired unanswered. */
  | 'declined'
  /** Terminal, with a {@link SettlementReceipt} available. */
  | 'settled'
  /** Terminal, refused before the effect. */
  | 'refused'

/**
 * What a guest is allowed to learn about its own proposal: the status and, once
 * terminal, the receipt. Never the grant, never the nonce, never the approval.
 * `ProposalId` is a lookup handle, not a capability: it cannot be redeemed.
 */
export interface ProposalHandle {
  /** Discriminant: this is an accepted deposit, not a refusal. */
  readonly ok: true
  readonly proposalId: ProposalId
  readonly status: ProposalStatus
  /** Present only when `status` is `'settled'`. */
  readonly receipt?: SettlementReceipt
}

/**
 * ROLE: supervisor/witness. The broker-owned inbox. THIS INTERFACE IS THE GRANT
 * PATH CORRECTION.
 *
 * The guest deposits and polls. It cannot enumerate other proposals, cannot read
 * an approval, and cannot retrieve a grant, because no method returns one. That
 * absence is deliberate and load-bearing: the bearer capability never enters
 * hostile memory, so a guest compromise after approval yields a status string.
 *
 * It runs at the BROKER account, on the broker's own socket, behind the same
 * confinement gate the effect path is behind. It is not reachable from the human
 * session: the human uid is in neither group of {@link IssuerSockets} and in no
 * broker group this contract declares.
 */
export interface ProposalInbox {
  /**
   * Accept one inert proposal from the guest.
   * @param proposal - the guest's proposal; `proposalId` and `epoch` in it are ignored and reassigned.
   * @param signal - aborts the deposit; an aborted deposit leaves no entry.
   * @returns the handle the guest may poll, or a named refusal.
   */
  deposit(proposal: Proposal, signal: AbortSignal): Promise<ProposalHandle | SettlementRefused>

  /**
   * Read one proposal's status. The only observation a guest gets.
   * @param proposalId - the handle returned by {@link ProposalInbox.deposit}.
   * @returns the current handle, or undefined when the inbox holds no such proposal.
   */
  status(proposalId: ProposalId): Promise<ProposalHandle | undefined>

  /**
   * Render the proposal for a human, from the broker's OWN rebuilt operation
   * rather than the guest's advisory `review` string. The guest cannot call it.
   * WHO CAN is unsettled: what the issuer shows the human is the raw digest and
   * nothing else, and the human uid reaches no broker socket. See
   * {@link OpenDecision} `human-side-rendering-route`.
   * @param proposalId - the proposal to render.
   * @returns the deterministic review artifact and the operation digest it renders, or undefined when unknown.
   */
  render(proposalId: ProposalId): Promise<ProposalRendering | undefined>
}

/** What HomeLock displays and what its approval must name. */
export interface ProposalRendering {
  readonly proposalId: ProposalId
  /** Deterministic multi-line review artifact, from `renderOperation()`. */
  readonly review: string
  /** The broker's own rebuilt operation. */
  readonly operation: Operation
  /** Digest of that operation — what the approval binds. */
  readonly operationDigest: OperationDigest
  /** The closure the effect would run under, as the SUPERVISOR measured it. */
  readonly closureDigest: ImplementationClosureDigest
  /** Present when and only when the proposal is a patch. */
  readonly patch?: PatchBinding
}

/**
 * ROLE: human. The exact approval, delivered from HomeLock to the ISSUER
 * DIRECTLY over `approvals.sock` ({@link IssuerSockets.approvals}), the one
 * socket whose group contains the human uid. It never transits the guest, never
 * transits the broker, and no interface in this file gives the guest a way to
 * observe it.
 *
 * It is exact in the strict sense: it names the digests it saw, and the broker
 * recomputes each of them at settlement. An approval that matched a rendering
 * whose operation has since changed does not merely fail to apply — it refuses by
 * name.
 */
export interface HomeLockApproval {
  /** The proposal being approved. */
  readonly proposalId: ProposalId
  /** The operation digest the human's screen actually rendered. */
  readonly operationDigest: OperationDigest
  /** The closure digest the human's screen actually rendered. */
  readonly closureDigest: ImplementationClosureDigest
  /** For a patch, the result-tree digest the human's screen rendered. Absent for an effect. */
  readonly resultTree?: TreeDigest
  /** When the human answered. */
  readonly approvedAt: IsoInstant
  /**
   * The human's authenticator assertion over the three digests above. Its exact
   * form is the largest open question in this file — see {@link OpenDecision}
   * member `homelock-assertion-form`. What the
   * type fixes is that SOMETHING attributable to the human covers those bytes; a
   * bare boolean on a socket the guest's uid can reach is not an approval.
   */
  readonly assertion: string
}

/**
 * ROLE: issuer. The out-of-process issuer that holds the root private key, at the
 * ISSUER ACCOUNT of {@link AukoraPrincipal} — not at the human session, and not
 * beside the broker. It is reachable from exactly two places, and both are
 * kernel-enforced by {@link IssuerSockets}: the broker over `broker.sock`, and
 * the human over `approvals.sock`.
 *
 * IT HOLDS A PENDING TABLE KEYED BY DIGEST and refuses to sign a digest that is
 * not in it. That table is the far half of the byte-binding rule
 * ({@link ApprovalRoute}): the near half is that only the digest crossed, so the
 * issuer has nothing to re-canonicalise even if it wanted to.
 *
 * WHAT THE TREE DOES TODAY, MEASURED AT c76e893 AND CONTRADICTING ALL OF THE
 * ABOVE. `packages/governed/memory-put/src/bridge.ts` calls
 * `createConnection(config.issuerSocket)` from inside the harness process — the
 * guest talks straight to the issuer, with no broker hop. It sends
 * `{op: 'issue', toolName, arguments: entry.args, expiry}`: the ARGUMENTS, not a
 * digest. `handleIssue` at `aukora/issuer/issuer.mjs:99` then calls
 * `buildOperation(args, expiry)` and `operationDigest(operation)`, re-deriving the
 * digest at the far end from bytes the guest supplied, and it consults no pending
 * table — any well-formed argument set a human confirms at the issuer's own stdin
 * mints a grant. The route works at all only because both sides share uid 501:
 * `issuer.mjs:175` is `chmodSync(socketPath, 0o600)`, so the moment the issuer
 * moves to its own account this connect fails with EACCES. That loudness is why
 * the direct route cannot rot quietly, and it is not a reason to keep it.
 */
export interface GrantIssuer {
  /**
   * Admit one digest to the pending table and start the human ask over
   * `approvals.sock`. Called by the BROKER over `broker.sock`; a call arriving on
   * any other connection is `issuer:peer-not-broker`.
   * @param payload - the digest, and nothing else. A frame carrying an operation,
   *   arguments, or a rendering is `route:preimage-crossed-a-hop`.
   * @param closureDigest - the closure the supervisor measured, which the grant will bind. A digest, not bytes.
   * @param signal - aborts the admission; an aborted admission leaves nothing pending.
   * @returns nothing on success, or a named refusal.
   */
  admit(
    payload: HopPayload,
    closureDigest: ImplementationClosureDigest,
    signal: AbortSignal,
  ): Promise<undefined | SettlementRefused>

  /**
   * Wait for the human's answer on an admitted digest and mint on approval. The
   * approval arrives at the issuer over `approvals.sock`, not through this call:
   * what the broker does here is wait.
   * @param payload - the digest the broker admitted.
   * @param signal - aborts the wait; an aborted wait spends no nonce and leaves the digest pending.
   * @returns the signed grant, or a named refusal. `issuer:digest-not-pending` when the
   *   digest was never admitted, which is the refusal that makes the pending table load-bearing.
   *   The grant goes to the broker only.
   */
  awaitGrant(payload: HopPayload, signal: AbortSignal): Promise<CapabilityGrant | SettlementRefused>

  /**
   * Whether a digest is currently pending. The issuer's own guard, stated on the
   * interface so no implementation treats the table as an optimisation.
   * @param digest - the digest to look up.
   * @returns true only while an admitted digest is unanswered.
   */
  isPending(digest: OperationDigest): boolean
}

/* ------------------------------------------------------------------------- *
 * 11. THE EMISSION CAPABILITY SEAM
 *
 * SCOPE: out of scope. A complete seam is declared here — Service Definition,
 * Service Provider, Consumer — because a seam is never one role, and declaring
 * two of three later invites a fourth. Declaring it is not building it.
 *
 * Service Definition / Service Provider / Consumer — the repo's three roles, all
 * three declared, because one role alone is not a seam.
 * ------------------------------------------------------------------------- */

/** What a consequential tool asks Aukora to emit. Built by the tool from its own arguments. */
export interface EmissionRequest {
  /** The effect name. Must be a governed effect; an unknown name fails closed. */
  readonly toolName: string
  /** The exact arguments about to run. */
  readonly arguments: JsonValue
  /** The tool call this belongs to. */
  readonly callId: CallId
  /** The agent making the call. */
  readonly agentKey: AgentKey
  /** What kind of proposal this is. */
  readonly kind: ProposalKind
  /** Present when and only when `kind` is `'patch'`. */
  readonly patch?: PatchBinding
}

/**
 * SERVICE DEFINITION — the emission capability.
 *
 * This is the interface a consequential tool injects and Aukora SOLELY provides.
 * A tool that wants an effect on the world outside its own process declares
 * `static inject = ['aukora.emission']`, calls {@link EmissionService.emit}, and
 * holds no key, no nonce, no socket, and no grant. Every consequential tool in the
 * system consumes this one interface; there is no second route.
 *
 * WHAT "SOLELY PROVIDES" MEANS MECHANICALLY. Exactly one plugin may `ctx.provide`
 * this service, and it is supervisor-owned. A second provider is a boot refusal,
 * not a last-wins override — because a second provider IS the widening the
 * amendment rule forbids.
 *
 * ABORT PROPAGATION IS REQUIRED, NOT OPTIONAL. `grep -c signal` over
 * `packages/governed/memory-put/src/index.ts` returns 0 today: nothing in the
 * governed path observes cancellation, so a cancelled tool call leaves the broker
 * round trip running. Every method here takes an `AbortSignal` and every
 * implementation must honour it. Aborting BEFORE the broker round trip is a
 * refusal; aborting DURING it is `INDETERMINATE`, because the effect may already
 * have happened.
 *
 * @see AukoraRole for why the tool never holds the grant.
 */
export interface EmissionService {
  /**
   * Propose an effect and wait for it to reach a terminal state. The ordinary
   * call: propose, wait for the human, settle.
   * @param request - the effect the tool wants.
   * @param signal - cancellation. Honouring it is mandatory; see the note above about INDETERMINATE.
   * @returns the terminal settlement, always one of the three states.
   */
  emit(request: EmissionRequest, signal: AbortSignal): Promise<Settlement>

  /**
   * Deposit a proposal without waiting. For a tool that wants to report "asked"
   * and return, leaving the human unhurried.
   * @param request - the effect the tool wants.
   * @param signal - cancellation of the deposit itself.
   * @returns the handle the tool may poll, or a named refusal.
   */
  propose(request: EmissionRequest, signal: AbortSignal): Promise<ProposalHandle | SettlementRefused>

  /**
   * Wait for a previously deposited proposal to reach a terminal state.
   * @param proposalId - from {@link EmissionService.propose}.
   * @param signal - cancellation of the wait, not of the effect.
   * @returns the terminal settlement.
   */
  awaitSettlement(proposalId: ProposalId, signal: AbortSignal): Promise<Settlement>

  /**
   * The implementation closure the running guest is under, as measured by the
   * SUPERVISOR and reported downward. A tool renders this; it never computes it.
   * @returns the digest the supervisor measured at guest launch.
   */
  closureDigest(): ImplementationClosureDigest

  /**
   * The activation epoch this run is under.
   * @returns the epoch; a patch proposal must name a strictly greater one.
   */
  epoch(): ActivationEpoch
}

/**
 * SERVICE PROVIDER — the supervisor-side implementation of {@link EmissionService}.
 *
 * Distinct from the Service Definition because the provider owns lifecycle the
 * consumer must never touch: the broker socket, the inbox, and the measured
 * closure it reports downward. Exactly one provider composes per run, and it is
 * mounted by the supervisor's own patch layer, not by anything the guest can edit.
 */
export interface EmissionProvider extends EmissionService {
  /** Path of the confined broker's unix socket. The provider's only route out. */
  readonly brokerSocket: string
  /**
   * Operations larger than this refuse before any approval is requested. A human
   * cannot review what is not shown, so oversize never truncates; it refuses.
   */
  readonly reviewLimitBytes: number
  /** The confinement class the broker reported at connect. Rendered to the human; never chosen here. */
  readonly servedClass: ConfinementClass
}

/**
 * CONSUMER — what a governed tool declares.
 *
 * Restated as a type so the seam's third role is present in the contract rather
 * than implied. A tool satisfying this is a Consumer of the emission capability
 * and provides nothing.
 */
export interface EmissionConsumer {
  /** Must contain `'aukora.emission'`. Cordis refuses to compose the tool otherwise. */
  readonly inject: readonly string[]
  /** The governed effect name this tool emits. */
  readonly toolName: string
}

/**
 * The Cordis service name, so eight implementations cannot each pick their own.
 * Sits beside the existing `'aukora.memory'` and `'aukora.authority'`.
 *
 * Declaration merging is the mechanism, exactly as the repo requires:
 *
 * ```ts
 * declare module '@deepseek-ai/cordis' {
 *   interface Context {
 *     'aukora.emission': EmissionService
 *   }
 * }
 * ```
 *
 * That block belongs in the PROVIDER package, not here — this file declares no
 * module, so it can never fail to build against a cordis it does not import.
 */
export type EmissionServiceName = 'aukora.emission'

/* ------------------------------------------------------------------------- *
 * 12. THE PRINCIPAL TOPOLOGY AND THE SUPERVISOR
 *
 * SCOPE: bootstrap boundary. THIS SECTION IS THE WAVE, except
 * {@link AukoraSupervisor.activate}, which is marked separately.
 *
 * Launch ceremony -> ownership -> issuer and broker up at their own accounts ->
 * separation verified -> artifact verification -> guest launch. The order is
 * enforced in the type system: each phase takes the previous phase's object, so
 * an implementation cannot start the guest before separation was measured by
 * getting the call order wrong.
 *
 * PHASE 4 USED TO SAY "PRIVILEGE DROPPED" AND PHASE 3 USED TO SAY "BEFORE
 * PRIVILEGE IS DROPPED". Both are gone. The old sentences are quoted verbatim at
 * {@link ServicesStarted}, with the reason, because a deleted line with no
 * epitaph gets restored by the next reader who remembers it.
 * ------------------------------------------------------------------------- */

/**
 * THE FOUR OS PRINCIPALS: one account each, and the separation is the whole
 * security argument. MODE 0600 SEPARATES UIDS, NOT PROCESSES THAT SHARE ONE, so
 * any two principals merged into one account is a co-uid reader of whatever the
 * other one's owner-only files hold. Merging the human session into either
 * neighbour recreates a co-uid reader of one of the two keys.
 *
 * Each member names the attack ITS OWN SPLIT STOPS. That is what the member is
 * for; a principal that cannot name one is a process, not a principal.
 *
 * MECHANICS, and the reason this is buildable on darwin without runtime sudo:
 * launchd jobs with `UserName` set to accounts created at provisioning. The
 * no-sudo constraint measured on this host is a RUNTIME constraint; account
 * creation is install-time and is a human act, which this contract measures the
 * absence of and never performs. NONE OF THE 135 SERVICE ACCOUNTS UNDER UID 500
 * MAY BE REUSED: they carry existing group memberships and duties, and inheriting
 * a stranger's groups is inheriting a stranger's reach.
 */
export type AukoraPrincipal =
  /**
   * The interactive account: the launch ceremony, the approval client, the
   * terminal, config parsing, and every npm dependency in the interactive stack.
   * SPLIT FROM THE ISSUER STOPS: a compromise of the approval UI yielding the
   * root key. Keeping the interactive dependency tree out of the signing account
   * is the entire reason this is not the issuer.
   */
  | 'human-session'
  /**
   * The only account that holds the root private key, in its own state directory
   * at mode 0700 with the key file at 0600.
   * SPLIT FROM THE BROKER STOPS: a compromised broker reading the root key, which
   * turns stolen broker authority into root grant-minting authority and collapses
   * the two-key hierarchy this design rests on. This is the defect the earlier
   * three-principal topology carried — both jobs at one account, where 0600
   * separates nothing.
   */
  | 'issuer'
  /**
   * Holds the receipt-signing key and the nonce book, rebuilds every operation
   * from the guest's arguments, and is the guest's only route out.
   * SPLIT FROM THE GUEST STOPS: the party that submits hostile bytes reading the
   * receipt key and the nonce book — which would let it mint its own evidence and
   * un-spend nonces it had already spent.
   */
  | 'broker'
  /**
   * The harness: the model, the tools, and every dependency the agent can reach.
   * Produces inert proposals and nothing else.
   * SPLIT FROM ALL THREE STOPS: guest-authored bytes reaching a process that
   * holds a key. It reaches the broker's socket and nothing else, and it holds no
   * route to the issuer.
   */
  | 'guest'

/**
 * THE MERGED SUPERVISOR ACCOUNT IS UNREPRESENTABLE, and `tsc` on this file is
 * what enforces it. Re-adding a `supervisor` principal — one account that holds
 * custody AND runs a service — makes this alias non-`never` and the typecheck
 * fails. Do not delete it to make a change compile.
 */
export type NoMergedSupervisorPrincipal = AssertEmpty<Extract<AukoraPrincipal, 'supervisor'>>

/**
 * THE FOUR OBJECTS THE FOUR-ACCOUNT SPLIT EXISTS TO SEPARATE, named as a closed
 * union so custody is stated once as a total function over them instead of as
 * independent booleans that can drift apart. Every member is a thing an attacker
 * wants: the two signing keys, the spend ledger, and the route to the party that
 * signs. See {@link CustodyEstablished} for the runtime measurement of the same
 * four; this union is the requirement, that interface is the observation.
 */
export type CustodyObject =
  /** The root signing key. Whoever reads it mints grants. */
  | 'issuerKey'
  /** The one-use ledger. Whoever writes it un-spends nonces and replays a settled grant. */
  | 'nonceBook'
  /** The receipt signing key. Whoever reads it mints its own evidence. */
  | 'receiptKey'
  /** The route to the party that signs. Whoever reaches it can ask for a signature. */
  | 'issuerSocket'

/**
 * WHICH PRINCIPAL HOLDS EACH CUSTODY OBJECT. The holders are literal types rather
 * than data because this is the topology's requirement, not a reading taken from a
 * running host. `issuerKey` states at the type level what
 * {@link CustodyEstablished.rootKeyOwnedByIssuer} measures at runtime, and
 * `receiptKey` and `nonceBook` likewise pair with
 * {@link CustodyEstablished.receiptKeyOwnedByBroker} and
 * {@link CustodyEstablished.nonceBookOwnedByBroker}.
 */
export interface CustodyHolder {
  /** Held by the issuer account, which is the only account that holds the root private key. */
  readonly issuerKey: 'issuer'
  /** Held by the broker account, which is the party that spends nonces. */
  readonly nonceBook: 'broker'
  /** Held by the broker account, so a compromised issuer cannot also mint evidence. */
  readonly receiptKey: 'broker'
  /** Held by the issuer account; {@link IssuerSockets} carries the kernel facts that keep it reachable from the broker only. */
  readonly issuerSocket: 'issuer'
}

/**
 * CUSTODY IS TOTAL OVER THE FOUR OBJECTS, and `tsc` on this file is what enforces
 * it. Adding a member to {@link CustodyObject} without giving it a holder in
 * {@link CustodyHolder} makes this alias non-`never` and the typecheck fails. An
 * object with no named holder is an object every account may reach.
 * Do not delete it to make a change compile.
 */
export type EveryCustodyObjectHasAHolder = AssertEmpty<Exclude<CustodyObject, keyof CustodyHolder>>

/**
 * AND NO HOLDER NAMES AN OBJECT THE UNION DOES NOT, and `tsc` on this file is what
 * enforces it. The opposite direction of {@link EveryCustodyObjectHasAHolder}:
 * a holder for an object that is not a {@link CustodyObject} is custody assigned
 * over something this contract never enumerated as needing it.
 * Do not delete it to make a change compile.
 */
export type EveryHolderNamesACustodyObject = AssertEmpty<Exclude<keyof CustodyHolder, CustodyObject>>

/**
 * EVERY HOLDER IS A REAL PRINCIPAL, and `tsc` on this file is what enforces it.
 * A holder that is not a member of {@link AukoraPrincipal} — a typo, or an account
 * invented beside the four — makes this alias non-`never` and the typecheck fails.
 * Do not delete it to make a change compile.
 */
export type EveryCustodyHolderIsAPrincipal = AssertEmpty<Exclude<CustodyHolder[CustodyObject], AukoraPrincipal>>

/**
 * THE GUEST HOLDS NO CUSTODY OBJECT, and `tsc` on this file is what enforces it.
 * Assigning any of the four to `guest` makes this alias non-`never` and the
 * typecheck fails. This is the split {@link AukoraPrincipal} names: the party that
 * submits hostile bytes reading the receipt key and the nonce book would mint its
 * own evidence and un-spend nonces it had already spent.
 * Do not delete it to make a change compile.
 */
export type GuestHoldsNoCustodyObject = AssertEmpty<Extract<CustodyHolder[CustodyObject], 'guest'>>

/**
 * THE HUMAN SESSION HOLDS NO CUSTODY OBJECT, and `tsc` on this file is what
 * enforces it. The account that runs the launch ceremony ends it holding no key at
 * all; assigning any of the four to `human-session` puts a key inside the
 * interactive account's dependency tree and fails the typecheck.
 * Do not delete it to make a change compile.
 */
export type HumanSessionHoldsNoCustodyObject = AssertEmpty<Extract<CustodyHolder[CustodyObject], 'human-session'>>

/**
 * NO ONE ACCOUNT HOLDS BOTH SIGNING KEYS, and `tsc` on this file is what enforces
 * it. Giving `issuerKey` and `receiptKey` the same holder makes this alias
 * non-`never` and the typecheck fails, because one reader of both keys is one key:
 * it collapses the two-key hierarchy this design rests on and turns stolen broker
 * authority into root grant-minting authority. This is the defect the earlier
 * three-principal topology carried, expressed as a type.
 * Do not delete it to make a change compile.
 */
export type NoPrincipalHoldsBothSigningKeys = AssertEmpty<
  Extract<CustodyHolder['issuerKey'], CustodyHolder['receiptKey']>
>

/**
 * One provisioned account as the launch MEASURED it, never as it was configured.
 * Provisioning is an install-time human act; this record only observes its
 * result. See {@link OpenDecision} `four-account-provisioning`.
 */
export interface PrincipalAccount {
  /** Which principal this account is. */
  readonly principal: AukoraPrincipal
  /** The account's uid, read from the running process, not from a plist. */
  readonly uid: number
  /** The account name launchd's `UserName` names. */
  readonly accountName: string
  /**
   * True only when this account was created for Aukora at provisioning. False for
   * any of the pre-existing service accounts under uid 500, and false is a boot
   * refusal: their group memberships are not this design's.
   */
  readonly provisionedForAukora: boolean
  /** The account's own state directory at mode 0700, or null for a principal that owns none. */
  readonly stateDir: string | null
}

/**
 * All four accounts. Keyed by principal so a missing one is a compile error
 * rather than an undefined lookup during a launch.
 */
export type PrincipalTopology = Readonly<Record<AukoraPrincipal, PrincipalAccount>>

/**
 * The only mode either governed socket may carry, as a literal type so widening
 * it is a visible diff on one line: 0666 puts the guest in reach of the issuer,
 * and 0600 puts the human session out of reach of it.
 */
export type GovernedSocketMode = '0660'

/**
 * A unix domain socket whose access policy IS its owner, group, and mode. No TCP
 * anywhere on this path: `chmod` and `chgrp` work on sockets, so filesystem
 * permissions are the whole policy and the kernel is the thing enforcing it. A
 * process outside the group gets EACCES from `connect(2)` with no Aukora code
 * consulted and no Aukora decision to subvert.
 *
 * @typeParam Peer - the single principal in this socket's group, as a
 *   one-element tuple, so "who may reach this" is a type fact and a second
 *   reacher is a compile-time change rather than a deployment accident.
 */
export interface GovernedSocket<Peer extends AukoraPrincipal> {
  /** Filesystem path of the socket. */
  readonly path: string
  /** Always the issuer. Both governed sockets are the issuer's, and the issuer is the thing that must be hard to reach. */
  readonly ownerPrincipal: 'issuer'
  /** The issuer account's uid, measured from the socket's own `stat`. */
  readonly ownerUid: number
  /** The group's name, created at provisioning for this socket and for nothing else. */
  readonly groupName: string
  /** That group's gid, measured from the socket's own `stat`. */
  readonly groupGid: number
  /** Exactly one principal is in the group. A second member is a second reacher. */
  readonly groupMembers: readonly [Peer]
  /** Measured from the socket's own `stat`, as four octal digits. */
  readonly mode: GovernedSocketMode
  /**
   * How the restriction is enforced, and the whole point of this interface: a
   * KERNEL FACT, not a declared one. One value, because a second would be a
   * second answer to "what stops the guest", and two answers is none.
   */
  readonly enforcement: 'kernel-filesystem-permissions'
  /**
   * True only when a connect was ATTEMPTED from a principal outside the group and
   * the kernel refused it. False refuses the launch: an unproven kernel fact is a
   * declared one, and a declared one is what this replaces.
   */
  readonly outsiderConnectDenied: boolean
}

/**
 * The issuer's two sockets. There is no third, and the guest is in neither group.
 *
 * NAME COLLISION, STATED SO NOBODY RESOLVES IT BY ACCIDENT. The socket below is
 * `broker.sock` in the sense of "the socket the BROKER may reach", and it is
 * owned by the issuer. The path `/run/aukora/broker.sock` already exists in the
 * tree with the opposite meaning — `profiles/8088-inside-out/cordis.patch.yml`
 * gives it to the guest as its route TO the broker, and it is owned by the
 * broker. The two must not share a path.
 */
export interface IssuerSockets {
  /**
   * `approvals.sock`. Owner issuer, group = a fresh group containing only the
   * human uid, mode 0660. Where the human's client reads what is pending and
   * returns a {@link HomeLockApproval}.
   */
  readonly approvals: GovernedSocket<'human-session'>
  /**
   * `broker.sock`. Owner issuer, group = the broker account, mode 0660. The only
   * route to the issuer for anything that is not a human, and what makes "only
   * the broker may reach the issuer" a kernel fact rather than a promise.
   */
  readonly brokerLink: GovernedSocket<'broker'>
}

/** Every principal that may reach the issuer, derived from the two groups rather than restated beside them. */
export type IssuerSocketPeer = IssuerSockets[keyof IssuerSockets]['groupMembers'][number]

/**
 * THE GUEST REACHES NO ISSUER SOCKET, and `tsc` on this file is what enforces it.
 * Adding the guest to either group makes this alias non-`never` and the typecheck
 * fails. Do not delete it to make a change compile.
 */
export type GuestReachesNoIssuerSocket = AssertEmpty<Extract<IssuerSocketPeer, 'guest'>>

/**
 * What the topology does NOT close, enumerated so a reader learns it from the
 * record instead of assuming it was handled. Every member is accepted, not
 * pending: naming a risk here is a decision to live with it.
 */
export type AcceptedResidualRisk =
  /**
   * MALWARE RUNNING AS THE HUMAN PASSES THE GROUP CHECK on `approvals.sock`. The
   * group contains the human uid and the kernel cannot tell the human's approval
   * client from anything else at that uid. LocalAuthentication and displaying the
   * raw preimage digest are a speed bump, not a boundary. The real boundary is
   * that guest code never runs at the human uid, which is the guest account's
   * reason to exist.
   */
  | 'human-uid-malware-passes-approvals-group-check'
  /**
   * The broker is a liveness chokepoint and sees every proposal. Accepted,
   * because receipts already flow through it: this adds no reader that was not
   * already there, and it adds no key holder at all.
   */
  | 'broker-sees-every-proposal-and-gates-liveness'

/**
 * THE APPROVAL ROUTE: guest -> broker -> issuer. Two hops, no third, no shortcut.
 *
 * WHY NOT guest -> human session: that feeds guest-authored bytes into the most
 * privileged parser on the host and contradicts this contract's own rule that the
 * guest holds no issuer route.
 * WHY NOT guest -> issuer: that is the bug in the tree today, at
 * `packages/governed/memory-put/src/bridge.ts`. See {@link GrantIssuer} for what
 * it measures to.
 *
 * THE BYTE-BINDING RULE, AS AN OBLIGATION AND NOT A HOPE. The ONLY thing that
 * crosses a hop is the preimage digest ({@link HopPayload}), forwarded OPAQUELY.
 * The broker does not re-canonicalise, re-encode, pretty-print, or rebuild it;
 * the operation, its arguments, and its rendering stay at the broker that built
 * them. The issuer holds a pending table keyed by digest and refuses to sign a
 * digest that is not pending. Binding holds because the digest displayed to the
 * human, the digest signed, and the digest in the settled receipt are one value
 * that was computed once. Pretty-printed JSON shown to a human is decoration and
 * is never the signed object.
 */
export interface ApprovalRoute {
  /** The hops, in order. A route with any other shape is not this route. */
  readonly hops: readonly ['guest-to-broker', 'broker-to-issuer']
  /** The socket the guest reaches the broker on. Owned by the broker account, not by the issuer. */
  readonly guestBrokerSocket: string
  /** The issuer's two sockets, and the kernel facts that make the second hop exclusive. */
  readonly issuerSockets: IssuerSockets
  /**
   * True only when the broker forwarded the digest byte for byte. Any
   * re-canonicalisation is `route:preimage-crossed-a-hop`, whether or not the
   * recomputed digest happens to match: a hop that CAN rebuild the value is a hop
   * that can rebuild it differently.
   */
  readonly forwardedOpaquely: boolean
  /** The risks this route accepts rather than closes. */
  readonly acceptedResidualRisks: readonly AcceptedResidualRisk[]
}

/**
 * THE ONLY THING THAT CROSSES A HOP. One field, deliberately, and see
 * {@link HopPayloadCarriesOnlyTheDigest} for the check that keeps it one.
 */
export interface HopPayload {
  /** The preimage digest. Hex, forwarded opaquely, rendered to the human verbatim. */
  readonly digest: OperationDigest
}

/**
 * THE HOP PAYLOAD CARRIES ONE FIELD, and `tsc` on this file is what enforces it.
 * Adding `arguments`, `operation`, `review`, or any other member to
 * {@link HopPayload} makes this alias non-`never` and the typecheck fails,
 * because a hop that carries the bytes is a hop that can re-canonicalise them.
 * Do not delete it to make a change compile.
 */
export type HopPayloadCarriesOnlyTheDigest = AssertEmpty<Exclude<keyof HopPayload, 'digest'>>

/**
 * Named route refusals. Merge-extensible, namespaced by the party that raises
 * them, and each one is a refusal — never a warning and never a retry.
 */
export type ApprovalRouteRefusal =
  /** The issuer was asked to sign a digest its pending table does not hold. THE PENDING TABLE'S WHOLE POINT. */
  | 'issuer:digest-not-pending'
  /** A connection carrying a broker frame arrived from a principal that is not the broker. */
  | 'issuer:peer-not-broker'
  /** A hop carried more than the digest — an operation, arguments, or a rendering. */
  | 'route:preimage-crossed-a-hop'


/** Named supervisor refusals. New in this contract; namespaced `supervisor:` so they never collide with the broker's. */
export type BoundaryRefusal =
  /** The ceremony did not authenticate a human. */
  | 'supervisor:ceremony-unauthenticated'
  /** Hot reload is composed over the governed profile. See {@link HmrDisposition}. */
  | 'supervisor:hmr-present'
  /**
   * The active profile carries a declaration of its own governance. A profile
   * that can call itself governed can call itself ungoverned; the fact comes from
   * the parent launcher or the launch refuses. See {@link GovernanceFactSource}.
   */
  | 'supervisor:governance-self-declared'
  /** The composition the guest will run under contains dynamic configuration. See {@link LiteralConfiguration}. */
  | 'supervisor:dynamic-config-present'
  /** A path in {@link BoundaryClass} is writable by the guest uid. */
  | 'supervisor:boundary-writable-by-guest'
  /** No second uid was obtained and the launch demanded one. */
  | 'supervisor:uid-split-absent'
  /**
   * Two principals of {@link AukoraPrincipal} were measured at the same uid, or an
   * account was one of the pre-existing service accounts under uid 500. REPLACES
   * `supervisor:privilege-retained`, which named a drop that does not happen; see
   * {@link ServicesStarted}.
   */
  | 'supervisor:principals-merged'
  /** A cross-principal reach that must fail was not attempted, or was attempted and succeeded. */
  | 'supervisor:separation-unproven'
  /** The measured closure differs from the pinned one. */
  | 'supervisor:closure-mismatch'
  /** The active artifact pointer moved between verification and launch. */
  | 'supervisor:artifact-moved'
  /** A patch would activate in the epoch that proposed it. THE AMENDMENT RULE. */
  | 'supervisor:self-activation'
  /** More than one plugin provided the emission service. */
  | 'supervisor:duplicate-emission-provider'

/**
 * SCOPE: bootstrap boundary.
 *
 * WHERE A GOVERNANCE FACT IS ALLOWED TO COME FROM, and the reason this type is
 * not a plain string literal.
 *
 * THE ACTIVE PROFILE MUST NOT DECLARE WHETHER IT IS GOVERNED. A profile that can
 * call itself governed can call itself ungoverned, and the profile is exactly the
 * artifact the guest shares a uid with today:
 * `profiles/8088-inside-out/package.json` and `cordis.patch.yml` are writable by
 * uid 501, the uid the harness runs as. A governed fact read out of the guest's
 * own writable closure is a fact the guest sets. So the fact arrives DOWNWARD,
 * from the parent launcher, over a channel that is not in the closure the guest
 * can reach: not the profile manifest, not either patch layer, not the
 * environment, not argv.
 *
 * The sole member is the point. A second member would be a second answer to
 * "who says this run is governed", and two answers is none.
 */
export type GovernanceFactSource = 'parent-launcher'

/**
 * The sources a guest can reach, enumerated so the exclusion is checkable rather
 * than asserted. Each one is writable by, or chosen by, the guest uid today.
 */
export type GuestReachableSource =
  /** `profiles/<name>/package.json`, including `dsh.profile.bundles`. */
  | 'profile-manifest'
  /** `profiles/<name>/cordis.patch.yml`, the file rows A2..A5 of the amendment-channel court write to. */
  | 'profile-patch-layer'
  /** `homePatchPath()`, outside the profile directory and watched all the same. */
  | 'home-patch-layer'
  /** `process.env`, which the guest's own launch controls and `!!js` nodes read. */
  | 'guest-environment'
  /** The guest process's own argv. */
  | 'guest-argv'

/**
 * Instantiating with anything other than `never` is a compile error. The one
 * mechanically checkable invariant this types-only file can carry itself.
 */
export type AssertEmpty<T extends never> = T

/**
 * THE CHECK, executed by `tsc` on this file. Widening {@link GovernanceFactSource}
 * to admit any guest-reachable source makes this alias non-`never` and the
 * typecheck fails. Do not delete it to make a change compile.
 */
export type GovernanceFactSourceIsNotGuestReachable = AssertEmpty<
  Extract<GovernanceFactSource, GuestReachableSource>
>

/**
 * A fact supplied downward by the parent launcher. The wrapper exists so no value
 * of this kind can be written without naming its source, and so the only nameable
 * source is the one the guest cannot alter.
 *
 * @typeParam T - the fact itself.
 */
export interface ParentSupplied<T> {
  /** Closed to {@link GovernanceFactSource}. A profile-declared value is unrepresentable, not merely rejected. */
  readonly source: GovernanceFactSource
  /** What the parent said. */
  readonly value: T
}

/**
 * SCOPE: bootstrap boundary. What the supervisor did about hot reload over the
 * governed profile.
 *
 * `apps/cli/src/profile-boot.ts:279` creates `cordis-plugin-timer` and
 * `cordis-plugin-hmr` and watches the profile's own `patchPath` AND
 * `homePatchPath()` — unconditionally, whenever `ctx.get('hmr') === undefined`.
 * The governed profile declares `bundles: []` and receives the watchers anyway.
 * The in-source comment says a silent skip "would break the documented hot-reload
 * contract".
 *
 * A watcher over the composition the guest is governed by, in a process the guest
 * shares a uid with, is a live route from "write a file" to "recompose the
 * authority that governs me". `courts/harness/amendment-channel/run.mjs` rows A3
 * and A4 are that route walked end to end.
 *
 * ONE DISPOSITION IS DECREED. `'declined-at-launch'` is the only accepted answer:
 * the parent launcher does not compose hmr for this run. The two alternatives
 * previously typed here are deleted, and each for a reason:
 *   - `'disposed-before-guest'` composed the watchers first. Between compose and
 *     dispose the route is live. The run recorded for 0d4fd2e reports row A3
 *     travelling from a write on the running patch file to a model-visible tool in
 *     the SAME RUN in 48 ms, and row A4 rewriting `reviewLimitBytes` mid-run from
 *     8192 to 999999 in 21 ms. Not re-measured by this edit. A window is not a
 *     closure.
 *   - `'paths-unwritable-by-guest'` left the watcher armed and relied on file
 *     modes at the same uid. Row N1 of the composition-closure court is the
 *     answer: a mode set by the guest's own uid is not custody.
 * Path unwritability is not deleted, it is DEMOTED — from an alternative
 * disposition to a required companion measurement below.
 *
 * DECLINING MUST BE PER-LAUNCH, NOT GLOBAL. Row A6 of the amendment-channel court
 * holds today and must keep holding: a NON-governed profile still hot-reloads the
 * identical write. A global kill of hmr is a regression, not a repair, so the
 * decline is scoped to the run the parent launched and to nothing else.
 */
export interface HmrDisposition {
  /**
   * DECREED, and parent-supplied. One value, wrapped so the record states who
   * said it: the launcher declined to compose hmr for this run. The profile has
   * no way to express this and no way to contradict it — see
   * {@link GovernanceFactSource}.
   */
  readonly disposition: ParentSupplied<'declined-at-launch'>
  /**
   * Every path a watcher WOULD have covered, including `homePatchPath()`, which is
   * outside the profile directory. Enumerated even though nothing watches them,
   * because the next field is a claim about this exact set.
   */
  readonly watchedPaths: readonly string[]
  /**
   * True only when every path in {@link HmrDisposition.watchedPaths} is unwritable
   * by the guest uid. REQUIRED IN ADDITION TO THE DECLINE, never instead of it:
   * declining stops this launcher from arming a watcher, and unwritability stops
   * anything else from making one matter. False is
   * {@link BoundaryRefusal} `supervisor:boundary-writable-by-guest`.
   *
   * Measured, and measured from OUTSIDE the guest. A function that returns false
   * while running at the guest's own uid has reported the guest's opinion.
   */
  readonly allWatchedPathsUnwritableByGuest: boolean
}

/**
 * The supervisor's statement that the composition it is about to activate carries
 * no evaluated configuration.
 *
 * `vendor/loader/src/config/utils.ts:5` is `export const evaluate = new
 * Function('ctx','expr', ... return eval(expr))`, and the governed profile USES
 * it: `cordis.patch.yml` USED TO carry `!!js` for `brokerSocket` and
 * `issuerSocket`. An expression evaluated at load with `ctx` in scope is code
 * running inside the authority closure at composition time, and it reads
 * `process.env`, which the guest's own launch controls.
 *
 * The supervisor therefore supplies these values LITERALLY and refuses a governed
 * composition in which any `!!js` node survives.
 */
export interface LiteralConfiguration {
  /**
   * True only when the composed profile contains zero evaluated nodes.
   * False is {@link BoundaryRefusal} `supervisor:dynamic-config-present`.
   */
  readonly allLiteral: boolean
  /** Every value the supervisor substituted literally, by row id and config key, for the record. */
  readonly substituted: readonly { readonly rowId: string; readonly key: string }[]
  /** Any evaluated node that survived, by row id and key. Non-empty means refusal. */
  readonly remainingDynamic: readonly { readonly rowId: string; readonly key: string; readonly expression: string }[]
}

/** How the guest will be confined, stated in full including what is NOT confined. */
export interface GuestConfinementPlan {
  /** The uid the guest will run as. Distinct from every other principal's, or the launch refuses. */
  readonly guestUid: number
  /** The human-session account's uid — the account the ceremony ran at. */
  readonly humanSessionUid: number
  /** All four accounts as measured, so a reader of the plan does not have to infer the topology from two uids. */
  readonly topology: PrincipalTopology
  /** How the second uid was obtained. */
  readonly acquisition: UidSplitAcquisition
  /** Paths mounted read-only: the active artifact and the profile. */
  readonly readOnlyPaths: readonly string[]
  /** The single writable path: scratch. */
  readonly scratchPath: string
  /** The broker socket, the guest's only authority route. */
  readonly brokerSocket: string
  /** The governed model endpoint. */
  readonly modelEndpoint: string
  /**
   * Whether egress is actually restricted. MEASURED FALSE TODAY: `grep -rIl 'deny
   * network'` across the tree returns 0 hits, and Seatbelt as used here denies
   * file-write, not network. A supervisor that leaves this false has confined
   * writes and not exfiltration, and the field exists so a receipt reader learns
   * that from the record rather than from a hopeful assumption.
   */
  readonly networkRestricted: boolean
  /** How egress is restricted, when it is. Null when `networkRestricted` is false. */
  readonly networkMechanism: string | null
}

/**
 * PHASE 1. The privileged launch ceremony: one human, one authentication, at the
 * top of the process tree.
 *
 * Nothing below this phase may re-open custody. The ceremony is the only moment a
 * human's authentication reaches the root key, and it happens before any guest
 * code exists on this host's process tree.
 */
export interface LaunchCeremony {
  /** Marks the phase so a later method cannot be handed the wrong object. */
  readonly phase: 'ceremony'
  /** When the human authenticated. */
  readonly authenticatedAt: IsoInstant
  /** The supervisor's effective uid during the ceremony. */
  readonly euid: number
  /** True when the ceremony ran interactively with a human present. False refuses. */
  readonly attended: boolean
}

/**
 * PHASE 2. Ownership established. Everything the guest must never write is now
 * held BY THE PRINCIPAL THAT OWNS IT, at a mode no other uid can read.
 *
 * Not "by the supervisor": one account holding both keys and the nonce book is
 * the topology {@link AukoraPrincipal} corrects. The human session that runs this
 * ceremony ends it holding no key at all.
 */
export interface CustodyEstablished {
  readonly phase: 'custody'
  /** The ceremony this custody came from. */
  readonly ceremony: LaunchCeremony
  /**
   * The root signing key file is owned by the ISSUER account at mode 0600 and the
   * ceremony did not read it. A root key loaded into the interactive account is a
   * root key inside the interactive account's dependency tree.
   */
  readonly rootKeyOwnedByIssuer: boolean
  /** The receipt-signing key file is owned by the BROKER account at mode 0600. A key the issuer can also read is one key, not two. */
  readonly receiptKeyOwnedByBroker: boolean
  /** The nonce book directory is owned by the BROKER account at mode 0700; the broker is the party that spends nonces. */
  readonly nonceBookOwnedByBroker: boolean
  /** The Aura chain verified from genesis before anything else was started. */
  readonly auraVerified: boolean
  /** The profile that will govern this run, by name. */
  readonly activeProfile: string
  /** The artifact this run will mount. */
  readonly activeArtifact: ArtifactPointer
  /** The epoch this run will be. */
  readonly epoch: ActivationEpoch
  /** How hot reload was closed. */
  readonly hmr: HmrDisposition
  /** The literal-configuration measurement over the governed composition. */
  readonly configuration: LiteralConfiguration
  /** Every {@link BoundaryClass} path, with whether the guest uid can write it. Any true value refuses. */
  readonly boundaryWritability: readonly {
    readonly path: string
    readonly boundaryClass: BoundaryClass
    readonly writableByGuest: boolean
  }[]
}

/** Where the active artifact is, and what it is. The pointer only the supervisor may move. */
export interface ArtifactPointer {
  /** Filesystem path of the artifact root. */
  readonly path: string
  /** The closure digest measured over it. */
  readonly closureDigest: ImplementationClosureDigest
  /** The source tree digest, for joining to a patch's `resultTree`. */
  readonly treeDigest: TreeDigest
  /** Device number of the pointer itself, so a swap between verification and launch is detectable. */
  readonly pointerDev: number
  /** Inode of the pointer itself. */
  readonly pointerIno: number
}

/**
 * PHASE 3. The issuer and the broker are running, EACH AT ITS OWN ACCOUNT, and
 * neither was started by this process.
 *
 * THE LINE THIS REPLACES, quoted so a reader can see why it changed: PHASE 3 read
 * "Broker and issuer are running, at the supervisor's uid, before privilege is
 * dropped", and PHASE 4 read "Privilege dropped." THAT DESCRIBED A LINUX PATTERN
 * WITH NO REFERENT ON THIS HOST — start privileged, bind, `setuid` away. Nothing
 * drops here because nothing starts privileged: launchd starts each job AS its
 * account through `UserName`, so there is no moment at which one process holds
 * another principal's authority, and therefore nothing to give up. Do not restore
 * either sentence.
 *
 * IT WAS ALSO THE DEFECT, not merely an inaccuracy. Putting both jobs at one uid
 * put the root key, the receipt key, and the nonce book under one reader, and
 * mode 0600 separates uids rather than processes sharing one: a compromised
 * broker read the issuer's root key, and stolen broker authority became root
 * grant-minting authority. See {@link AukoraPrincipal}.
 */
export interface ServicesStarted {
  readonly phase: 'services'
  readonly custody: CustodyEstablished
  /** The four accounts as measured from the running jobs. */
  readonly topology: PrincipalTopology
  /**
   * The socket the guest reaches the broker on, owned by the BROKER account. Not
   * one of {@link IssuerSockets}, and not the `broker.sock` named there.
   */
  readonly brokerSocket: string
  /** The issuer's two sockets, with the ownership and mode facts that make the issuer reachable from the broker only. */
  readonly issuerSockets: IssuerSockets
  /** The route those sockets carry, including what it forwards and what it accepts. */
  readonly route: ApprovalRoute
  /**
   * The class the broker's own boot gate measured. `unconfined` never appears
   * here: `assertBootConfinement` throws rather than returning it.
   */
  readonly brokerBootClass: MintableConfinementClass
  /** The state directory's high-water seal class at boot. */
  readonly sealClass: ConfinementClass
  /** The broker's public key, for pinning by whoever will read receipts. */
  readonly brokerPublicKeyPem: string
}

/**
 * PHASE 4. Separation verified. NOTHING WAS DROPPED, because nothing started
 * privileged — see {@link ServicesStarted} for the line this phase replaces.
 *
 * What takes the drop's place is a MEASUREMENT: four principals at four uids, and
 * every cross-principal reach that must fail attempted and observed failing. A
 * separation nobody tried to cross is a separation nobody has evidence for.
 */
export interface SeparationVerified {
  readonly phase: 'separated'
  readonly services: ServicesStarted
  /** The four accounts as measured. */
  readonly topology: PrincipalTopology
  /** True only when all four uids differ. Any collision is `supervisor:principals-merged`. */
  readonly uidsDistinct: boolean
  /**
   * Every reach that was attempted and denied. Empty, or missing any of the four
   * splits {@link AukoraPrincipal} names, is `supervisor:separation-unproven`.
   */
  readonly deniedReaches: readonly PrincipalDenial[]
}

/**
 * One attempted-and-denied cross-principal reach. The successor to "attempt to
 * regain the prior uid and fail": there is no prior uid to regain, so what is
 * measured instead is that each principal cannot touch what another one owns.
 */
export interface PrincipalDenial {
  /** The principal the attempt ran as. */
  readonly from: AukoraPrincipal
  /** What it tried to reach. */
  readonly target: string
  /** Which owned thing that is. */
  readonly targetKind: 'root-key' | 'receipt-key' | 'nonce-book' | 'approvals-socket' | 'broker-link-socket'
  /** True only when the attempt ran and the kernel refused it. */
  readonly denied: boolean
  /**
   * The errno the kernel returned — `EACCES`, or `ENOENT` where the path is also
   * unlistable. Null means no attempt was made, which is not a denial. Who runs
   * the attempt and who attests it is unsettled: see {@link OpenDecision}
   * `separation-probe-attestation`.
   */
  readonly errno: string | null
}

/** PHASE 5. The artifact was verified against what was pinned, after separation was proven and immediately before launch. */
export interface ArtifactVerified {
  readonly phase: 'verified'
  readonly separated: SeparationVerified
  /** The artifact as re-measured now. */
  readonly measured: ArtifactPointer
  /** The artifact custody pinned. A difference is {@link BoundaryRefusal} `supervisor:closure-mismatch`. */
  readonly pinned: ArtifactPointer
  /** True only when pointer dev/ino also match, catching a swap under the same path. */
  readonly pointerStable: boolean
}

/** PHASE 6. The guest is running, at the guest account, under a closure the supervisor measured. */
export interface GuestLaunched {
  readonly phase: 'guest'
  readonly verified: ArtifactVerified
  /** How the guest is confined, including what is not confined. */
  readonly confinement: GuestConfinementPlan
  /** The closure digest reported downward to the guest, which its tools render. */
  readonly closureDigest: ImplementationClosureDigest
  /** The epoch the guest runs under. A patch it proposes must name a strictly greater one. */
  readonly epoch: ActivationEpoch
  /** The guest process id, for teardown. */
  readonly pid: number
}

/**
 * ROLE: supervisor. The launch-downward interface, in order.
 *
 * Each method takes the previous phase's object, so the sequence is enforced by
 * the compiler rather than by a comment: there is no way to call
 * {@link AukoraSupervisor.launchGuest} without having measured separation,
 * because the only source of an {@link ArtifactVerified} is
 * {@link AukoraSupervisor.verifyArtifact}, whose only input is a
 * {@link SeparationVerified}.
 *
 * EVERY REFUSAL IS A BOOT REFUSAL. There is no degraded mode, no warning path, and
 * no configuration field that turns one into a warning. A supervisor that cannot
 * establish the boundary must not start a guest, because a guest running without
 * the boundary produces receipts a reader will take as boundary-backed.
 */
export interface AukoraSupervisor {
  /**
   * PHASE 1. Run the privileged launch ceremony.
   * @param signal - aborts the ceremony before any custody is taken.
   * @returns the ceremony record.
   * @throws when the ceremony did not authenticate a human; `supervisor:ceremony-unauthenticated`.
   */
  ceremony(signal: AbortSignal): Promise<LaunchCeremony>

  /**
   * PHASE 2. Take ownership of keys, nonce state, Aura, profile, and the active
   * artifact pointer; close hot reload; substitute literal configuration.
   * @param ceremony - the completed ceremony.
   * @param signal - aborts before any service is started.
   * @returns what is now owned and what was measured.
   * @throws on any {@link BoundaryRefusal}; in particular `supervisor:hmr-present`,
   *   `supervisor:dynamic-config-present`, and `supervisor:boundary-writable-by-guest`.
   */
  establishCustody(ceremony: LaunchCeremony, signal: AbortSignal): Promise<CustodyEstablished>

  /**
   * PHASE 3. Bring up the issuer and the broker, each at its own account. THIS
   * METHOD SPAWNS NOTHING PRIVILEGED: an unprivileged human-session process
   * cannot start a process at another uid, so the jobs are launchd's and what
   * this does is require them and measure what came up.
   * @param custody - the established custody.
   * @param signal - aborts the wait; it does not stop a launchd job this process did not start.
   * @returns the measured topology, the sockets, and the broker's measured boot class.
   * @throws with a {@link ConfinementRefusal} when the broker's own boot gate refuses.
   */
  startServices(custody: CustodyEstablished, signal: AbortSignal): Promise<ServicesStarted>

  /**
   * PHASE 4. Measure the separation: four uids, and every reach that must fail
   * attempted and denied. There is no drop to perform.
   * @param services - the running issuer and broker.
   * @param signal - aborts the probes; a partial probe set is not a measurement.
   * @returns the measured topology and the denials observed.
   * @throws `supervisor:principals-merged` when two principals share a uid, and
   *   `supervisor:separation-unproven` when a required reach was not attempted or was not denied.
   */
  verifySeparation(services: ServicesStarted, signal: AbortSignal): Promise<SeparationVerified>

  /**
   * PHASE 5. Re-measure the artifact against what custody pinned.
   * @param separated - proof the four principals are separate.
   * @param signal - aborts the measurement.
   * @returns the comparison.
   * @throws `supervisor:closure-mismatch` or `supervisor:artifact-moved`.
   */
  verifyArtifact(separated: SeparationVerified, signal: AbortSignal): Promise<ArtifactVerified>

  /**
   * PHASE 6. Launch the guest at the guest uid.
   * @param verified - the verified artifact.
   * @param plan - the confinement plan, including the honest `networkRestricted` value.
   * @param signal - aborts the launch and reaps the child.
   * @returns the running guest.
   * @throws `supervisor:uid-split-absent` when `plan.guestUid` equals any other principal's uid and the launch
   *   demanded a split. HOW the guest job is started at its own account is unsettled; see {@link OpenDecision}
   *   `guest-job-start-mechanism`.
   */
  launchGuest(verified: ArtifactVerified, plan: GuestConfinementPlan, signal: AbortSignal): Promise<GuestLaunched>

  /**
   * SCOPE: out of scope. Activate an approved patch — THE AMENDMENT RULE'S
   * ENFORCEMENT POINT, and the one method of this interface that is not in this
   * wave. It is declared with the phases so the rule has a named home and so no
   * one adds activation to `launchGuest` for want of a place to put it.
   *
   * Called by the supervisor only, only after the guest that proposed the patch
   * has been torn down, and only for an epoch strictly greater than the proposing
   * run's. It re-derives `closureAfter` over the staged tree and refuses on any
   * difference from what the human approved.
   *
   * @param binding - what the human approved.
   * @param approval - the human's approval over that binding.
   * @param signal - aborts before the pointer moves; an aborted activation leaves the pointer where it was.
   * @returns the new artifact pointer and the epoch it activated in.
   * @throws `supervisor:self-activation` when `binding.activationEpoch` is not strictly greater than
   *   the epoch of the run that proposed it, and `supervisor:closure-mismatch` when the staged tree's
   *   measured closure differs from `binding.closureAfter`.
   */
  activate(
    binding: PatchBinding,
    approval: HomeLockApproval,
    signal: AbortSignal,
  ): Promise<{ readonly artifact: ArtifactPointer; readonly epoch: ActivationEpoch }>
}

/* ------------------------------------------------------------------------- *
 * 13. The witness
 *
 * SCOPE: out of scope. The record as it ships, plus one deferred extension.
 * ------------------------------------------------------------------------- */

/**
 * SCOPE: out of scope for the bootstrap boundary. ROLE: witness. One Aura record
 * entry exactly as `appendEntry` in `aukora/aura/record.mjs` already writes them.
 * The two joins this contract wants are DEFERRED with the receipt they mirror:
 * see {@link DeferredAuraEntry}.
 *
 * The record is appended BEFORE the caller hears about the settlement: the reply
 * is the settlement, and the record is part of it.
 */
export interface AuraEntry {
  /** The receipt's sequence. */
  readonly sequence: ReceiptSequence
  /** The name written. */
  readonly key: string
  /** Digest of the authorized call. */
  readonly requestDigest: PayloadDigest
  /** Digest of the definition that ran. */
  readonly definitionId: DefinitionDigest
  /** The nonce spent. */
  readonly nonce: Nonce
  /** sha256 over the canonical receipt. */
  readonly receiptSha256: Sha256Hex
  /** Where the object landed. */
  readonly path: string
  /** Byte length on disk. */
  readonly bytes: number
  /** sha256 of the bytes written. */
  readonly contentSha256: Sha256Hex
  /** The inode chosen. */
  readonly inode: number
  /** The kernel's modification time. */
  readonly mtimeNs: string
  /** What stood between the broker and the caller. */
  readonly confinement: ConfinementField
}

/**
 * SCOPE: out of scope — DEFERRED TO THE PROTOCOL-MIGRATION BRICK, alongside
 * {@link DeferredSettlementReceiptV2}. The record entry carries the receipt's
 * joins or it carries none: a record that can name a proposal while the receipt
 * cannot is a join with one end.
 */
export interface DeferredAuraEntry extends AuraEntry {
  /** The proposal this settles. */
  readonly proposalId: ProposalId
  /** The closure the effect ran under. */
  readonly closureDigest: ImplementationClosureDigest
}

/* ------------------------------------------------------------------------- *
 * 14. openDecisions
 *
 * Referenced from sections 0, 10, and 12. Two lists and nothing else: what the
 * bootstrap boundary needed decided and therefore IS decided, and what is still
 * open. A decision is moved out of {@link OpenDecision} by being answered here,
 * never by an implementation quietly picking one.
 * ------------------------------------------------------------------------- */

/**
 * RESOLVED. Only what the bootstrap boundary needs to exist as a package and to
 * compile. Each member's JSDoc is the decision, not a pointer to one.
 */
export type ResolvedDecision =
  /**
   * PACKAGE IDENTITY AND EXPORTS. The package is `@deepseek-ai/dsh-aukora-contract`,
   * `private: true`, matching its group sibling `@deepseek-ai/dsh-aukora-memory`
   * (`packages/governed/memory-put/package.json`). Its home is
   * `packages/governed/contract/`. Everything is exported from the package root
   * and there is no subpath export: a second entry point is a second place for
   * frozen names to drift.
   *
   * IT STAYS AT THE REPOSITORY ROOT UNTIL THE PACKAGE IS BUILT PROPERLY. Measured
   * 2026-08-25 at 0d4fd2e: a bare `packages/governed/contract/src/index.ts` broke
   * `npm run build:lib:host` — tsdown failed `resolveEntry` for dsh-root. The
   * package needs the full acceptance surface this repository demands
   * (package.json, tsconfig.json, src/invariant.ts, tests/, README.md and its
   * bilingual pair) and that is the build lane's job, not the oracle's.
   */
  | 'package-identity'
  /**
   * SOURCE VERSUS LIB TYPE IMPORTS. Source plane. Consumers import the workspace
   * package name and tsconfig `paths` resolves it to `src`; no bootstrap-boundary
   * code consumes built `lib/`. The gate that does consume `lib/` is
   * `build:lib:host`, and this file is deliberately outside it — see
   * `package-identity`. Static gates and tests must pass on a clean tree without
   * a prior build.
   */
  | 'source-vs-lib-imports'
  /**
   * SHARED BRANDED-TYPE IMPORTS. `Branded` belongs to `@deepseek-ai/dsh-brand` and
   * `JsonValue` to `@deepseek-ai/dsh-session`. Those are the homes. The copies in
   * section 0 exist for one reason — this file must import nothing — and they are
   * structurally identical, not a parallel vocabulary. THEY ARE DELETED AND
   * REPLACED BY THE IMPORTS in the same commit that creates the package. Two homes
   * for one vocabulary is how a signed preimage drifts.
   */
  | 'shared-branded-imports'
  /**
   * CLOSED VERSUS EXTENSIBLE UNIONS.
   *
   * CLOSED — a `switch` over one ends in `assertNever`, and adding a member is a
   * deliberate change to every consumer: {@link AukoraRole},
   * {@link AukoraPrincipal}, {@link AcceptedResidualRisk},
   * {@link GovernanceFactSource}, {@link GuestReachableSource},
   * {@link BoundaryClass}, {@link ConfinementClass}, {@link UidSplitAcquisition},
   * {@link ProposalKind}, {@link ProposalStatus}, {@link SettlementState}, and the
   * {@link Settlement} object union.
   *
   * MERGE-EXTENSIBLE — the refusal unions {@link GrantRefusal},
   * {@link ReceiptRefusal}, {@link ConfinementRefusal}, {@link BrokerRefusal},
   * {@link BoundaryRefusal}, and {@link ApprovalRouteRefusal}. A new mechanism mints a new refusal name, and a reader
   * that does not know it must still record and render it. THE DOCUMENTED DEFAULT:
   * an unrecognised refusal is a refusal — it is displayed verbatim and it is never
   * downgraded to a warning, a success, or `INDETERMINATE`. Falling through to
   * anything permissive is the failure mode this default exists to prevent.
   */
  | 'union-closure'

/**
 * OPEN. Not decided, and not to be decided by whichever implementation reaches the
 * question first. Each one blocks something named.
 */
export type OpenDecision =
  /**
   * The form of {@link HomeLockApproval.assertion}. What the type fixes is that
   * SOMETHING attributable to the human covers the three digests; what it does not
   * fix is what that something is — a WebAuthn assertion, a hardware-token
   * signature, a signed line over a channel the guest's uid cannot reach. A bare
   * boolean on a socket the guest can reach is not an approval, and that is the
   * only part currently settled. Blocks section 10.
   */
  | 'homelock-assertion-form'
  /**
   * WHO RUNS THE CROSS-PRINCIPAL DENIAL PROBE, AND WHO ATTESTS IT.
   * {@link SeparationVerified} demands that each reach was ATTEMPTED and denied,
   * which is the measurement. The problem is that a reach can only be attempted BY
   * the principal being confined, and a guest reporting its own `EACCES` has
   * reported the guest's opinion — the same objection row N1 of the
   * composition-closure court raises against a file mode set by the guest's own
   * uid. An observer at another account cannot make the attempt on the guest's
   * behalf without becoming it. Blocks phase 4.
   *
   * REPLACES `irreversible-privilege-drop`, which asked how to make a `setuid`
   * unrecoverable. There is no drop, so that question has no referent; see
   * {@link ServicesStarted}.
   */
  | 'separation-probe-attestation'
  /**
   * HOW THE FOUR ACCOUNTS AND THE TWO GROUPS ARE PROVISIONED, and what proves it
   * happened. The mechanics named are `dscl` accounts plus launchd jobs with
   * `UserName`, at install time, and the no-sudo constraint measured on this host
   * (`courts/harness/uid-confinement/run.mjs:10-17`: `setpriv` absent, `sudo -n`
   * password-required, 135 service accounts under uid 500 already present) is a
   * RUNTIME constraint that does not reach an install-time act. NOTHING IN THIS
   * TREE DOES ANY OF IT, and this contract may not: it measures absence, and
   * provisioning is a human act.
   *
   * WHAT IS ACTUALLY UNSETTLED: a job with `UserName` is a LaunchDaemon and only
   * root may load one, so the install is privileged even though the launch is not;
   * whether that install is a one-time attended ceremony or a package receipt is
   * undecided; and a launch has no way yet to tell "never provisioned" from
   * "provisioned and broken", which are different refusals to a human reading one.
   * Blocks phase 3 and the DONE CONDITION.
   *
   * REPLACES `unattended-uid-split-on-darwin`, which asked how to obtain a second
   * uid AT RUNTIME. Under {@link AukoraPrincipal} the accounts already exist and
   * nothing is acquired, so that was the wrong question.
   */
  | 'four-account-provisioning'
  /**
   * HOW THE GUEST JOB IS STARTED AT THE GUEST ACCOUNT. An unprivileged
   * human-session process cannot start a process at another uid — which is why the
   * issuer and the broker are launchd's jobs rather than this process's children,
   * and the guest is no different. Whether it is a launchd job kicked once per
   * run, a resident job that is handed work, or something with a privileged
   * helper is not decided, nor is how it receives its epoch and artifact, nor how
   * it is torn down. THE AMENDMENT RULE NEEDS A FULL TEARDOWN PER ACTIVATION
   * ({@link ActivationEpoch}), so this is not a packaging detail. Blocks phase 6.
   */
  | 'guest-job-start-mechanism'
  /**
   * WHERE THE HUMAN'S DECORATIVE RENDER COMES FROM. Under the byte-binding rule
   * only the digest crosses to the issuer ({@link ApprovalRoute}), so raw hex is
   * the most the issuer can show; the pretty-printed operation is decoration and
   * is never the signed object. But the human uid is in no broker group — it
   * reaches {@link IssuerSockets.approvals} and nothing else — so the decoration
   * has no stated source. Whether the human's client may take it from the guest
   * (adversarial, though it is only decoration), from a third socket the broker
   * would have to expose, or not at all, is undecided. Distinct from
   * `homelock-assertion-form`, which is about what comes back. Blocks
   * {@link ProposalInbox.render} and the approvals hop.
   */
  | 'human-side-rendering-route'
  /**
   * The algorithm and canonicalization of {@link ImplementationClosureDigest}:
   * traversal order, what counts as a closure member, how absence is encoded, and
   * how the supervisor recomputes it cheaply enough to run at every launch. The
   * composition-closure court enumerates the member set and row D1 summarises how
   * many deny the guest; the run recorded for 0d4fd2e counted 726 writable at the
   * guest uid, and this edit did not re-measure it. The member SET is therefore not
   * hypothetical; the digest over it is unspecified.
   * Blocks phases 2 and 5.
   */
  | 'closure-digest-algorithm'
  /**
   * How egress is restricted, if it is. `grep -rIl 'deny network'` across the tree
   * returns 0 hits and Seatbelt as used here denies file-write, not network.
   * {@link GuestConfinementPlan.networkRestricted} exists so a receipt reader learns
   * this from the record rather than from a hopeful assumption; it does not decide
   * it. Blocks nothing in this wave and must not be silently reported as true.
   */
  | 'network-egress-mechanism'
  /**
   * The protocol-migration brick's compatibility decision: whether v2 grants and v1
   * receipts are rejected outright at the domain bump, as the v1-to-v2 move did, or
   * verified through a bounded dual-accept window. Blocks
   * {@link SpecifiedActivationGrant}, {@link DeferredSettlementReceiptV2}, and
   * {@link DeferredAuraEntry}. ORACLE OWNER'S CALL, not the builder's.
   */
  | 'grant-migration-compatibility'
  /**
   * Whether and how the four committed courts enter `scripts/run-gate.mjs`, given
   * that each exits non-zero by design until the boundary holds — a known-breach
   * enrollment, an expected-rows file, or staying out of the gate until the
   * progression completes. ORACLE OWNER'S CALL. A builder that registers, edits,
   * or silences a court has crossed the separation.
   */
  | 'known-breach-enrollment'
