# Ceilings

This toy prints its limits. It does not outgrow them by naming.

## BOOTSTRAP_UNGATED

The load/unload seam accepts a grant signed by a **locally generated
governor key**. There is no owner key at the load gate. There is no
human-ceremony. Live receipts are therefore `unattributed` /
`NON-CONFORMING`.

Do not claim CONFORMING. Do not claim an owner bound the plugin.

## SAME_UID

The ephemeral plugin and the loader share a process and a uid. The
coeffect envelope is `{kind: same-uid-envelope, uid}`. That is a digest
binding, not isolation. A real uid/process boundary is a later brick.

## PYTHON_RUNTIME_TCB

Every check in this toy runs inside one CPython process that the same uid
can also run code in. The loader therefore cannot make any object
immutable: `verify_mediator_integrity` catches a subclassed, monkey-patched
or replaced mediator **and does not close it** — whoever can patch the
mediator can also patch the check. Closing this needs a host boundary
(separate process, separate OS principal, or an enforced module import
gate), which this toy does not have and does not claim.

## MEDIATOR_INPROCESS

The mediator is a Python object, not a broker and not a service. Its gate
is checked structurally before grant evaluation and re-checked under the
state lock, and the P6 courts prove that a permissive subclass, a patched
`require()`, and an implementation replacement are all refused. All three
refusals are in-process detections. The larger graduation target is binding
the accepted mediator/provider *implementation digest* into the composition
so that swapping the gate invalidates the grant rather than merely failing
a runtime check.

## Direct same-UID state bypass

Same UID can write `loader-state.json` directly and claim an active
composition that no grant ever authorized. The P7 court does exactly that.
The result is detectable (`direct-state-bypass`, because an active
composition has no matching Aura load entry) and it mints **no authority**:
no receipt, no grant, and no cold-verify verdict reflects the forgery. It
is not prevented. Local file ownership is not a tamper boundary, and the
`SAME_UID` ceiling stays printed for that reason.

## Indeterminate settlement is a named outcome

A crash between the nonce reservation and the committed settlement leaves
authority provably consumed and the effect unknown. That state is reported
as `AUTHORITY_CONSUMED_EFFECT_UNKNOWN` or `INDETERMINATE` — never as
success and never as a clean refusal — and the consumed grant stays in
accounting. There is no recovery, no rollback and no WAL here: only honest
accounting of an ambiguous outcome.

## Grant subject / session binding

Grants carry a signed `subjectDigest` (required) and an optional
`sessionDigest`. A granted subject is a capability-shaped target — the path
an activation acts upon — and carries no owner, identity, DID or personhood
claim. A grant minted for subject A refuses `grant:subject-mismatch` when
exercised as subject B even when `pluginDigest`, `activationDigest`,
`governorPk`, TTL and depth all match. A grant that pins a session refuses
`grant:session-mismatch` without that exact session. A subject is not a
person and this is not authentication.

## Monotonic delegation

`maxDepth` alone bounds recursion depth; it does not prove a child cannot
*widen*. Every grant now also carries `compositionDigest`, and children are
issued through `grant.delegate()`, which inherits every authority dimension
and binds `parentDigest` to the parent's signed body. A child that widens
operation, plugin, coeffect, activation, subject, session, expiry, `maxTTL`
or `maxDepth` — or that is re-parented onto a different grant — refuses
`grant:delegation-widened: <dimension>`. This is one comparison per
dimension, not a policy language.

## Portable authority is a distinct kind

Portability is the single escape from epoch/restart revocation, so it is
`aukora-grant/v1-toy-portable`, a different kind signed under a different
domain — not a casual boolean. Setting `portable: true` on a normal grant
is refused (`grant:portable-kind-required` / closed fields), and a portable
child cannot descend from a non-portable parent. The P-court measures the
escape explicitly: a portable grant **does** cross an activation restart.

## MEDIATOR_OFF / MEDIATOR_REQUIRED

Loader construction **requires** a `MediatorProvider` object. Absence
raises `CompositionError` (`MEDIATOR_REQUIRED`) before any grant path.

When the mediator is disabled (`mediator.disable()`, `remove()`, or
constructed with `enabled=False`), activate refuses with named code
`MEDIATOR_OFF` **before** grant evaluation. No new governed effects.
Fail closed. (Env `AUKORA_MEDIATOR=0` still seeds the provider default.)

## Attendance reported, not proven

Human-facing paths print `ATTENDANCE: reported-not-proven`. A live
receipt class is derived, not a claim that a human was present. This toy
has **no human-ceremony**.

## Continuity spine — Diamond is not a proposer

See `CONTINUITY-SPINE.md`. This repository is Channel 1 (stranger
check). Channel 0 (WASM proposal cell + same-UID Seatbelt guest) was
measured in `aukora-deep` and is **not mounted here**.

Diamond does not execute a WASM proposal cell, does not spawn a
Seatbelt guest, does not run a broker or issuer, and does not grow an
Electron shell. Importing the deep cell binary as a runtime would
destroy the stranger property this toy exists to hold.

A valid receipt is not proof the cell ran (Check-18). Same-UID
Seatbelt is `MACOS_SEATBELT_GUEST / SAME_UID_AUTHORITIES /
NO_CUSTODY_CLAIM` — permitted guest OS effects constrained by the applied profile;
not proof of a computation path, cell execution or independent custody.
Aura is an append-only evidence spine, not a money blockchain.

## Cold honesty contract absorbed from Spec Alpha

This closed table distinguishes what Diamond enforces or prints from source reports
about a different runtime. `IN_DIAMOND_COLD` means the stated refusal or limitation
is in this cold surface; it does not mean the underlying threat has been eliminated.
`MEASURED_ELSEWHERE` refers to the pinned Alpha source's reported observations,
**not executed here**. `NOT_CLAIMED` is a property Diamond does not establish.
The continuity court requires these names and classifications.

| Ceiling | Scope | Meaning / evidence |
| --- | --- | --- |
| `SAME_UID` | `IN_DIAMOND_COLD` | Printed: this Python verifier is not a principal-isolation boundary. |
| `SAME_UID_HOST` | `IN_DIAMOND_COLD` | Printed: a hostile same-UID host can alter the interpreter, keys or verifier. |
| `PYTHON_RUNTIME_TCB` | `IN_DIAMOND_COLD` | Printed: Python and the verifier source are trusted to execute these checks. |
| `KERNEL_TRUSTED` | `IN_DIAMOND_COLD` | Printed: cold verification does not establish kernel integrity. |
| `OPERATOR_IDENTITY_NOT_STRONGLY_AUTHENTICATED` | `IN_DIAMOND_COLD` | Presence remains NOT_ESTABLISHED. Receipt labels cannot establish human attendance; unsupported human-ceremony Kira claims refuse. |
| `POWER_LOSS_DURABILITY_UNMEASURED` | `IN_DIAMOND_COLD` | Printed: valid stored bytes do not demonstrate persistence across power loss. |
| `HOST_CLOCK_TRUSTED_FOR_EXPIRY` | `IN_DIAMOND_COLD` | Approval-artifact output names its optional caller-supplied time; no independent clock or freshness proof. |
| `CELL_EXECUTION` | `IN_DIAMOND_COLD` | Always NOT_ESTABLISHED by these receipt checks, including Check-18. |
| `SAME_UID_WITNESS` | `MEASURED_ELSEWHERE` | Alpha A1/A4: witness and keys share the host UID; not independent custody. Not executed here. |
| `SEATBELT_DENYLIST` | `MEASURED_ELSEWHERE` | Alpha A1/A2: reported profile is deny-list. Court-46 corrects deny-default to an implementation choice, not a platform impossibility. Not executed here. |
| `SINGLE_HOST_SIGNING_AUTHORITY` | `MEASURED_ELSEWHERE` | Alpha A1: one compromised host signing key can authorize and sign its evidence. Not executed here. |
| `RESTART_PERSISTENT_NOT_ANTI_ROLLBACK` | `NOT_CLAIMED` | Diamond cannot detect a coherent rollback without an externally retained observation. Alpha A1 reports its separate restart-persistence/rollback limit; not executed here. |

Alpha source pins at `ddb6a9cc9860fce840283b0010e24e7d627fa9db` (committed
bytes re-hashed locally; no Alpha imports or runtime execution):

| Source | Path | SHA-256 |
| --- | --- | --- |
| A1 | `THREAT-MODEL.md` | `9942f8866d6530dbef79e4817672ded31373a826d91e7de6434b1bbed4f13ba3` |
| A2 | `src/guest/launch.mjs` | `edd7dae4786530dd34c6f59e30666cb6ca8357a4c9bd4e4d5aa9804fec2b6617` |
| A3 | `src/evidence/verify.py` | `8993b4cfcca1b41ee1f7fdf4d9148ccd261a7e682d35b623199c79ee6979e585` |
| A4 | `src/evidence/witness.py` | `32db6eedf9fa397043483a09ffcdb5d3ff2a383f30bda8847028903f31841a15` |

The receipt verifier and acceptance-document hashes are also recorded in
`tests/continuity-spine/local-pins.json`. These are provenance records, not proof
that the historical courts ran here.

## Evidence never authorizes. Identity never crowns.

Cold verify and receipt courts refuse forged `owner` / `identity` /
`did` fields (closed-field). Those fields never become permission.
**Grants authorize** composition transitions.

## Signer identity (cold court)

- Default **fail closed** without `--pub` or `--trust-anchors`.
- Supplying both sources refuses `ANCHOR_SOURCE_AMBIGUOUS`; neither can silently override the other.
- With `--pub` / matching trust-anchor: print `SIGNER_KEY_MATCHED`, or refuse on mismatch.
- `--allow-unanchored` (demo only): `SIGNATURE_VALID` + `SIGNER_IDENTITY_UNANCHORED`
  against embedded `issuerPk` — **never** imply a trusted signer.

## Flip-risk note (agent keys)

Agent / governor / issuer keys in this toy must **not** mint
`human-ceremony`. This toy has **no human-ceremony path at all** — live
receipts stay `unattributed` / `NON-CONFORMING`. Do not relabel them.

## Separate-root retainer (measured)

Retainer-B is written by a **separate Python process**
(`python3 -m diamond.retain_handoff`) under a **separate root**
(`--retainer-b-root` / `out-b/`). Claim measured:
**separate process + separate root** — **not** device independence.
Mutating only A’s observation yields A `OBSERVATION_CONFLICT` while B
stays `APPEND_ONLY`.

## Append-only is cryptographic/logical — not crash-safe WAL

Aura `aura.jsonl` append-only is hash-linked + Merkle. It is **not** a
crash-safe disk WAL. A truncated or corrupt mid-file refuses load
(`UNDETERMINED` / named error) — never silent fake history.

## Atomic one-use nonce

Grant nonces are reserved with `O_EXCL` file-per-nonce under the state
root. Two processes racing one valid grant → exactly one success, one
`grant:replayed`. Activate is also covered by a state-root file lock so
load/unload cannot fork inconsistent settled state.

## CONSISTENCY_UNCHECKED

Cold receipt verify and Phase 0 are **different courts**. If you only
cold-verify a receipt JSON + public key, print / treat consistency as
`CONSISTENCY_UNCHECKED`. Run `./scripts/verify-pair` (or the stranger
demo) for retained-vs-presented `APPEND_ONLY` / `OBSERVATION_CONFLICT`.

## Phase 0 power-of-two

`vendor/phase0/verify.py` returns `UNDETERMINED` when the retained size
is a power of two and the presented size is larger. It does not implement
RFC 9162 §2.1.4.2 step 2 (prepend `first_hash`). See
`vendor/phase0/CLAIM.md`.

## foreign/ second implementation smoke

`foreign/` verifies sealed receipt format (+ minimal Phase 0 shape)
**without importing `toy.*`**. It is a **second implementation smoke**,
not a standard.

## Two courts

Phase 0 checks retained-vs-presented Aura heads. Cold verify checks a
receipt JSON against a public key (optional). Neither court is the other.
A complete demo runs both.

## Not claimed

Not L1. Not a blockchain. Not ENS/Farcaster/Lens/zkTLS/Semaphore.
Not Kira, not Aumlok, not Desktop, not a Cordis fork.
Not a third Deep monorepo. Not CONFORMING. Not a product membrane.
Not CRT / ghost-mesh / immortal-organism (reject — not in this repo).
Not a propose runtime: no WASM proposal-cell execution, no Seatbelt
guest spawn, no broker/issuer, no Electron (see `CONTINUITY-SPINE.md`).
Not device independence. Not crash-safe WAL. Not trusted signer without `--pub`.

## Patent-license strict mode (optional)

When `AUKORA_STRICT_PATENT_LICENSE=1` or the mediator is constructed with
`require_patent_license=True`, activate also requires a one-use
`aukora-patent-license/v1` grant signed by **patentee root** (separate key
from governor), with `scopeDigest` matching `pluginDigest`. Receipt
composition may cite `patentLicenseNonce` / `patentDocketId`.

This does **not** cryptographically control hostile forks. It is a
conforming-loader authorization gate. Stranger demo leaves it off.

## SUCCESSION_UNMEASURED

Observer-succession / no-sovereign-operator court is **not** executed in
this toy. Print `SUCCESSION_UNMEASURED` on activate. Do **not** claim the
boundary SURVIVES its observer. Unownable Core is a **target**, not an
achievement (`UNOWNABLE_CORE: target-not-achievement`).

## identityBound: false (always)

This toy always prints `identityBound: false`. No ceremony binds a human.
Identity never crowns. Do not flip this label.

## Evidence never authorizes (court)

Presenting a valid receipt (or receipt-shaped object) where a grant is
required refuses with `evidence:never-authorizes`. Receipt verify ≠
activate. Cold-verify may still succeed for the same bytes.

## Grant blast-radius (signed preimage)

Composition grants require `issuedAt` + `maxTTL` in the signed body;
optional `maxDepth` defaults to 1. `maxTTL` is max **issuance duration**:
`expiry - issuedAt <= maxTTL`, with `issuedAt <= now <= expiry` (small
clock skew allowed on `issuedAt`). Activate refuses `grant:ttl-unbounded`
when lifetime exceeds `maxTTL`, `grant:issued-in-future` /
`grant:negative-lifetime` for bad clocks, and `grant:depth-exceeded` when
requested depth exceeds `maxDepth` (child-style).

## Activation / epoch binding

Grants bind to `activationDigest` (hash of activation epoch identity at
issue). After loader restart into a new activation, a prior grant refuses
`grant:activation-mismatch` unless it is of the **portable kind** (see
above; default: not portable). A normal grant cannot opt into that escape by
flipping a flag.

## Governor pin

`verify_grant(..., want_governor_pk=)` constant-time-compares to the
loader's governor. Evil self-declared `governorPk` → `grant:governor-mismatch`.

## Cold verify fail-closed

Require `--pub` or `--trust-anchors`. Without anchors: refuse (fail
closed). Explicit `--allow-unanchored` is a demo escape only. Anchored
paths print `SIGNER_KEY_MATCHED`.

## Signed checkpoints

Retained/presented are `aukora-checkpoint/v1-toy` signed (issuer).
`./scripts/verify-pair` checks signatures before Phase 0. Rewrite-both
without valid sig fails closed. Alternate Merkle fork vs signed retained
→ `OBSERVATION_CONFLICT`.

Freshness is separate from signature validity. An **older but correctly
signed** checkpoint refuses `CHECKPOINT_STALE`: valid-old state is not
latest state, and `consistency`, `signature validity` and `latestness` are
three different verdicts. The freshness check compares head and size only —
it does not re-verify the Merkle consistency path, which stays with the
vendored Phase 0 membrane (`vendor/phase0/verify.py`) rather than being
re-derived here.

## Unload link

`revertOf` must reference a prior load composition entry with matching
`pluginDigest` (`unload:revertOf-required` / `unknown` / `pluginDigest-mismatch`).

## Reconstruction cannot mint authority

Passing `recommendation` / `evidence` / `receipt` / `confidence` /
`majority` as an authorization substitute (activate kwargs or grant
fields) refuses with `reconstruction:cannot-mint (…)`. Closed grant
schema remains; these are explicit named codes + diamond courts.

## Golden Boundary / Cordis-aligned ceilings (honesty, not achievement)

- **evidence ≠ authorization** — receipts/cold-verify never activate.
- **identity ≠ crown** — owner/did/issuerPk never permission.
- **recommendation ≠ authorization** — advisory scores cannot mint grants.
- **exclusion ≠ selection** — patent/legal exclusion is not composition selection.
- **representation-change ≠ preserve authority** — restart/new activation
  drops non-portable grants; rewritten observation without valid sig fails.
- **composition gate** — load/unload only via one-use grant + mediator.
- **temporal unload** — unload linked to prior load (`revertOf`).
- **mediator removal fail-closed** — `MEDIATOR_OFF` before grant evaluation.

## B3c — a simulated device (three ceilings, printed on every verdict)

`python3 -m diamond.simulated_device` is a **model** of a device, not hardware. It holds a
reference file and acts only inside the bounds that file states, under a grant whose signed
preimage carries `referenceDigest` — the digest of that file. Three ceilings are printed on
every verdict it reaches, because each removes a claim a reader might otherwise make:

- **`SIMULATED_DEVICE`** — the thing under test is this model. The reference file, the
  telemetry and the clock are arguments to the process, not measurements of anything, and no
  physical claim survives the model.
- **`DEVICE_KEY_CLASS_B`** — the device's key is a software key in this process. It signs a
  record of what the device did and that record verifies, but it is not a secure element, and
  possession of the key file is possession of the device's voice.
- **`ATTESTATION_ABSENT`** — nothing proves the device is the device it claims. The reference
  file names a `deviceId` and no attestation backs that name; the device does not check one.

What it refuses by name: `LIMIT_EXCEEDED`, `GEOFENCE_VIOLATION`, `GRANT_EXPIRED`,
`PHYSICAL_VARIANCE_HALT` — a **latched** halt, where a retry is refused under the same code —
`grant:reference-mismatch` when the bound and the file the device holds disagree,
`envelope:grant-mismatch` when an envelope is presented with a grant it was not sealed for,
and `signature` when an envelope was edited after signing. Editing the reference file changes
its digest, so authority bound to the old file stops applying. That is the whole binding, and
each protection has an arm that goes red when it is removed.

**The way out of a latched halt is measured, not implied.** A halt records a `haltId`, and
clearing it takes a NEW grant naming that id: `grant:halt-mismatch` if it names another one,
`grant:not-new` if it was issued before the halt. The second check is the one that matters,
because over a simulated device the id is computable in advance — the arms compute it *before*
the halt happens and show that the grant minted for it clears nothing. Clearing is itself an
act: it goes through the same envelope, signature and binding checks as any other command,
writes a signed record naming the halt it cleared, and the device has to act again afterwards.

## Next brick

Owner key at the load gate + real second device.
