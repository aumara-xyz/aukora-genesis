# SECURITY — permitted and forbidden claims

Diamond provides **cold evidence verification** and preserves a separate
**sealed control-plane reference toy**. The demo-specific claims below do not
expand the cold consumer's authority. Neither surface is a product membrane,
L1, or **CONFORMING**.

## Permitted claims

- Retaining Aura observation N enables checking presentation M (Phase 0).
- Verdicts: `APPEND_ONLY` | `OBSERVATION_CONFLICT` | `UNDETERMINED`.
- Composition load/unload requires a one-use Ed25519 grant.
- Loader **requires** a `MediatorProvider` to construct; absence →
  `CompositionError` / `MEDIATOR_REQUIRED` before any grant path.
- `mediator.disable()` / `remove()` → activate refuses with `MEDIATOR_OFF`
  before grant evaluation (no new governed effects).
- Cold verify of `aukora-receipt/v3-toy` with JSON + `--pub` or `--trust-anchors`
  (fail closed without; `--allow-unanchored` demo escape only).
  - Anchored: `SIGNER_KEY_MATCHED` (or refuse mismatch).
  - `--allow-unanchored`: `SIGNATURE_VALID` + `SIGNER_IDENTITY_UNANCHORED`
    (never implies a trusted signer).
- Live class derived as `unattributed` / `NON-CONFORMING` (no owner keys).
- Skipping Phase 0 ⇒ consistency is `CONSISTENCY_UNCHECKED`.
- Attendance on human-facing paths is **reported-not-proven**.
- Retainer-B is a **separate process + separate root** measurement — not
  device independence.
- Nonce one-use is **atomic** (`O_EXCL` file-per-nonce) across processes.
- Append-only is **cryptographic/logical** (hash links + Merkle), **not** a
  crash-safe disk WAL. Truncate/corrupt aura JSONL → load refuses /
  `UNDETERMINED` — never silent fake history.
- `foreign/` is a **second implementation smoke**, not a standard.
- Optional strict patent-license grant (`aukora-patent-license/v1`) for
  conforming loaders; **not** DRM over arbitrary forks; patents remain
  exclusionary legal rights (see `legal/COUNSEL-DISCLOSURE-AND-CONTROL.md`).
- Activate prints `SUCCESSION_UNMEASURED`, `identityBound: false`,
  `UNOWNABLE_CORE: target-not-achievement`, plus `PYTHON_RUNTIME_TCB` and
  `MEDIATOR_INPROCESS` (honest labels — not claims).
- Receipt-as-grant refuses `evidence:never-authorizes` (verify ≠ activate).
- Grant signed blast-radius: required `issuedAt` + `maxTTL`; optional
  `maxDepth` (default 1) → `grant:ttl-unbounded` / `grant:issued-in-future` /
  `grant:negative-lifetime` / `grant:depth-exceeded`.
  `maxTTL` is max **issuance duration** (`expiry - issuedAt <= maxTTL`).
- Grants bind `activationDigest` → `grant:activation-mismatch` after restart.
  The only escape is the **portable kind** (`aukora-grant/v1-toy-portable`,
  a different kind under a different signed domain); setting `portable: true`
  on a normal grant refuses `grant:portable-kind-required`.
- GovernorPk pinned constant-time → `grant:governor-mismatch`.
- Grants carry a signed `subjectDigest` (required) and optional
  `sessionDigest` → `grant:subject-mismatch` / `grant:session-mismatch`.
  A subject is a capability-shaped target, not a person or an identity.
- Grants also bind `compositionDigest` (the canonical governed tuple:
  coeffect envelope, kind, operation, plugin digest, subject digest) →
  `grant:composition-mismatch` when one plugin digest tries to authorize a
  different composition.
- Monotonic delegation: `grant.delegate()` inherits every dimension and binds
  `parentDigest`; a child that widens operation / plugin / resource /
  activation / subject / session / reference / halt / expiry / `maxTTL` / `maxDepth`, or that
  is re-parented, refuses `grant:delegation-widened: <dimension>`.
- A grant may carry `referenceDigest`, the digest of the reference file a device holds
  (`python3 -m diamond.simulated_device`). A device shown authority bound to a different
  reference — or to none at all — refuses `grant:reference-mismatch`; an envelope is sealed
  for ONE grant, so presenting it with another (even one naming the same reference) refuses
  `envelope:grant-mismatch`; and an envelope edited after signing refuses `signature`. That
  device is a model: it prints `SIMULATED_DEVICE`, `DEVICE_KEY_CLASS_B` and
  `ATTESTATION_ABSENT` on every verdict, and its fault arms are `LIMIT_EXCEEDED`,
  `GEOFENCE_VIOLATION`, `GRANT_EXPIRED` and `PHYSICAL_VARIANCE_HALT` (latched — a retry is
  refused under the same code). A latch clears only on a new grant naming the `haltId` it
  recorded, refused as `grant:halt-mismatch` or `grant:not-new` otherwise, and the clearance
  is itself recorded and signed.
- Signed checkpoints + verify-pair sig check. An older but correctly signed
  checkpoint refuses `CHECKPOINT_STALE`: signature validity, consistency and
  latestness are three separate verdicts. Unload `revertOf` linked.
- Role separation: a receipt, checkpoint or patent license placed in the
  grant slot refuses `role:mismatch` — one Ed25519 algorithm does not collapse
  authority roles.
- Settlement accounting: a crash between nonce reservation and commit yields
  `AUTHORITY_CONSUMED_EFFECT_UNKNOWN` or `INDETERMINATE`, never success and
  never a clean refusal; an unreadable journal is `settlement:journal-unreadable`.
- Direct same-UID writes to `loader-state.json` are detected
  (`direct-state-bypass`) because no Aura load entry backs them. Detected, not
  prevented, and they mint no authority.
- Court self-checks: `claim-integrity` (docs may not quote codes that do not
  exist, and no executable path may emit the observer-survival claim),
  `ceiling-presence`, and `sensitivity-mutants` (removing one protection must
  turn the court RED, or the court is decoration).
- Reconstruction substitutes (`recommendation`/`evidence`/`receipt`/
  `confidence`/`majority`) refuse `reconstruction:cannot-mint`.
- Cordis-aligned honesty: evidence≠auth, identity≠crown,
  recommendation≠authorization, exclusion≠selection,
  representation-change≠preserve authority; composition gate; temporal
  unload; mediator removal fail-closed.

## Forbidden claims

- CONFORMING / human-ceremony / owner-bound plugin (this toy has none).
- Evidence authorizes / identity crowns / did grants permission.
- Process isolation, cross-uid boundary, trusted renderer.
- L1, blockchain, ENS/Farcaster/Lens/zkTLS/Semaphore.
- Cordis fork, Deep monorepo, product membrane, Kira/Aumlok/Desktop.
- **Diamond as a proposer.** This repository is a cold stranger verifier
  (Channel 1). It does not execute aukora-deep's WASM proposal cell,
  does not spawn a Seatbelt guest, and does not grow a broker, issuer,
  or Electron shell. See `CONTINUITY-SPINE.md`.
  The existing sealed control-plane demo is preserved separately; its authority
  modules are outside the cold consumer closure. This prohibition does not mean
  those historical demo files or shared signing helpers have disappeared.
- Receipts / identical JSON as proof a proposal cell ran (Check-18).
  Cold output explicitly reports `CELL_EXECUTION: NOT_ESTABLISHED`; Kira's
  structured `execution.cellRan` remains null even on a verified receipt.
- Independent custody from a same-UID Seatbelt guest
  (`MACOS_SEATBELT_GUEST / SAME_UID_AUTHORITIES / NO_CUSTODY_CLAIM`).
- Tokenomics, coins, or consensus from the Aura evidence spine.
- Agent keys minting human-ceremony (flip-risk — explicitly absent here).
  Current Kira receipts claiming the unsupported `human-ceremony` class refuse
  `APPROVAL_CLASS_UNSUPPORTED`; other mode labels are reported, not presence proof.
  Composition receipts remain mode-unbound and reject added approval/presence fields.
- Trusted checkpoint signer from an embedded key alone. Normal `verify-pair`
  requires a separately supplied public key; its explicit unsigned demo route
  establishes neither signature validity nor signer identity.
- Occurrence, world truth, code-execution proof from APPEND_ONLY.
- Single-log assumption; latestness; presence proven by attendance print.
- Device independence from retainer-B (only separate process + root measured).
- Trusted signer from cold-verify without `--pub` / trust-anchors.
- Remaining-lifetime TTL loophole (issuance-duration is enforced).
- Crash-safe / durable WAL from aura.jsonl append-only.
- Cryptographic control over non-conforming forks / leaked snapshots.
- “Anything anyone does is under your technical control.”
- **CRT / ghost-mesh / immortal-organism** — not in this repo; reject those
  claims here. This toy does not implement or endorse them.
- Unownable Core **achieved** / boundary SURVIVES its observer /
  `identityBound: true` / succession measured. Those are targets or
  unmeasured — not claims of this tip.
- Tamper-proofing from the same-UID detection: rows 50–53 are **detections**
  in one CPython process, not an enforcement boundary. See `PYTHON_RUNTIME_TCB`.
- Crash recovery / rollback from the settlement journal: it accounts for an
  ambiguous outcome, it does not resolve one.
- Immutable mediator from `verify_mediator_integrity`: it catches subclass,
  monkey-patch and replacement, and a same-process attacker can patch the
  check itself.

## Invariants (code + courts)

1. **Evidence never authorizes. Identity never crowns.** Grants authorize.
2. Closed fields everywhere; refuse unknown keys; refuse `alg`; refuse floats in JCS.
3. Mediator provider required to construct; mediator-off → no new governed effects.
4. Attendance reported, not proven.
5. Cold court always prints `CONSISTENCY_UNCHECKED` when Phase 0 is skipped.
6. Unanchored cold verify never implies trusted signer.

See `CEILINGS.md`, `REDTEAM.md`, `CONTINUITY-SPINE.md`,
`vendor/phase0/CLAIM.md`.
