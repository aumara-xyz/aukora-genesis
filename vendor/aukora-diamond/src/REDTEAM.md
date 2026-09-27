# REDTEAM — Astra attack-surface checklist

Sealed toy only. Expected verdicts for GPT Astra. Do not claim CONFORMING.

## How to run the courts first

```bash
./scripts/diamond.sh         # must print DIAMOND: GREEN
./scripts/stranger-demo.sh   # must print STRANGER-DEMO: GREEN
```

## Attacks and expected verdicts

| # | Try | Expected |
|---|-----|----------|
| 1 | **Grant replay** — activate twice with the same grant nonce | `GrantError: grant:replayed` / REFUSE |
| 2 | **Cross-process nonce race** — two processes race the same valid grant | exactly one success, one `grant:replayed` |
| 3 | **`alg` field** — inject `alg: Ed25519` on receipt or grant | `ReceiptError` / `GrantError` — alg forbidden |
| 4 | **Field injection** — add unknown top-level key on receipt or grant | closed-field refuse |
| 5 | **Identity / owner / did** — forge `owner`, `identity`, or `did` on a receipt and cold-verify | refuse (`identity field refused` or closed fields); **never** treats as permission |
| 6 | **pow2 blind spot** — retain size power-of-two, present larger | Phase 0 `UNDETERMINED` (honest limit; see `vendor/phase0/CLAIM.md`) |
| 7 | **Same-UID rewrite** — mutate coeffect / claim isolation | Ceiling `SAME_UID` always printed; envelope is digest binding, not isolation |
| 8 | **Skip Phase 0** — cold-verify only | `CONSISTENCY_UNCHECKED` mandatory; not APPEND_ONLY |
| 9 | **Mutate retainer-A only** — flip `retained.root` on A, leave B (separate root) | A → `OBSERVATION_CONFLICT`; B → `APPEND_ONLY` |
| 10 | **Unload without load** | `GrantError: nothing loaded` |
| 11 | **Activate without grant** | `REFUSE: no grant` + ceilings |
| 12 | **Mediator absence** — `Loader(out, mediator=None)` | `CompositionError` / `MEDIATOR_REQUIRED` — cannot build |
| 13 | **Mediator-off** — `mediator.disable()` then activate | `MEDIATOR_OFF` **before** grant evaluation |
| 14 | **Mediator remove** — `mediator.remove()` then activate | `MEDIATOR_OFF` |
| 15 | **Float in JCS** — put a float in a signed body | `JCSError: floats are not permitted` |
| 16 | **Mutate presented.root** after honest pair | `OBSERVATION_CONFLICT` |
| 17 | **Relabel class** — claim `human-ceremony` / CONFORMING on live toy receipt | Forbidden. Live stays `unattributed` / `NON-CONFORMING`. Toy has **no human-ceremony**. |
| 18 | **Treat issuerPk / did as authority** | Identity never crowns. Grants authorize composition only. |
| 19 | **Expired grant** | `GrantError: expired` |
| 20 | **Operation / pluginDigest / coeffect mismatch** | mismatch refuse |
| 21 | **Fixture kind as live ceremony** | Fixture → class `fixture` / `FIXTURE` only; not human attendance |
| 22 | **Unanchored signer** — cold-verify without `--pub` / trust-anchors | **fail closed** (refuse). `--allow-unanchored` → `SIGNER_IDENTITY_UNANCHORED` (demo only) |
| 23 | **Anchored signer mismatch** — `--pub` with wrong key | refuse `issuerPk mismatch` |
| 24 | **Truncated / corrupt aura JSONL** mid-file | load refuses / `UNDETERMINED` — never silent fake history |
| 25 | **Cross-process loader race** — two processes race the same load grant on one state root | 1 ok / 1 `grant:replayed`; cold-reopen: exactly one composition/load settlement in Aura, one active plugin, one spent nonce for that grant, Aura chain/head verifies, zero second effect from the loser |
| 26 | **Same-temp-file theater for B** — claim device independence from a copy in `out/` | Rejected. B must be separate process + separate root measured. |
| 27 | **CRT / ghost-mesh / immortal-organism claims** | Reject — not in this repo (see `SECURITY.md`) |
| 28 | **Receipt used as grant** — pass a cold-valid `aukora-receipt/v3-toy` into activate as `grant=` | `GrantError: evidence:never-authorizes` (verify ≠ activate) |
| 29 | **Reconstruction as auth** — pass `recommendation` / `evidence` / `receipt` / `confidence` into activate (kwargs or stuffed on grant) | `GrantError: reconstruction:cannot-mint` |
| 30 | **Grant TTL unbounded** — `expiry - issuedAt > maxTTL` (`maxTTL` = max **issuance duration**; `issuedAt` required in signed preimage) | `GrantError: grant:ttl-unbounded` |
| 31 | **Depth > maxDepth** — activate with `depth` exceeding grant `maxDepth` (default 1) | `GrantError: grant:depth-exceeded` |
| 32 | **Activate doctrine labels** — any activate path (refuse or succeed) | Always prints `CEILING: SUCCESSION_UNMEASURED`, `identityBound: false`, `UNOWNABLE_CORE: target-not-achievement` (target, not achievement) |
| 33 | **Patent-license strict refuse** — `AUKORA_STRICT_PATENT_LICENSE=1` or mediator `require_patent_license` without `aukora-patent-license/v1` | `PatentLicenseError` / `PATENT_LICENSE_REQUIRED` |
| 34 | **Future issuedAt** — `issuedAt > now + skew` | `GrantError: grant:issued-in-future` |
| 35 | **Negative lifetime** — `expiry < issuedAt` | `GrantError: grant:negative-lifetime` |
| 36 | **Activation mismatch** — grant from activation A after restart into B (non-portable) | `GrantError: grant:activation-mismatch` |
| 37 | **Evil governor** — grant signed by self-declared non-loader governorPk | `GrantError: grant:governor-mismatch` |
| 38 | **Rewrite-both unsigned checkpoints** — forge retained+presented without valid sig | verify-pair `CHECKPOINT_SIG_FAIL` |
| 39 | **Signed fork** — alternate Merkle presented (re-signed) vs signed retained | `OBSERVATION_CONFLICT` |
| 40 | **Unload without revertOf / unknown / digest mismatch** | `unload:revertOf-required` / `unknown` / `pluginDigest-mismatch` |
| 41 | **Majority as auth** — pass `majority` into activate | `GrantError: reconstruction:cannot-mint (majority)` |
| 42 | **Subject substitution** — grant minted for subject A exercised as subject B, with `pluginDigest`, `activationDigest`, `governorPk`, TTL and depth all matching | `GrantError: grant:subject-mismatch` |
| 43 | **Subject swap + re-sign attempt** — edit `subjectDigest` to the exercising subject without the governor seed | `GrantError: signature` (the digest is inside the signed body) |
| 44 | **Session substitution** — session-pinned grant exercised under a different session, or with no session at all | `GrantError: grant:session-mismatch` |
| 45 | **Composition substitution** — grant approving composition A used for composition B that shares one `pluginDigest` | `GrantError: grant:composition-mismatch` (also distinguishes load from unload composition) |
| 46 | **Delegation widening** — child grant broadens operation / plugin / activation / subject / expiry / `maxTTL` / `maxDepth` beyond its parent | `GrantError: grant:delegation-widened: <dimension>` |
| 47 | **Re-parenting a child** — take a narrow child and present it under a different (wider) parent | `GrantError: grant:delegation-widened: parentDigest` |
| 48 | **Portable flag on a normal grant** — set `portable: true` on `aukora-grant/v1-toy` | `GrantError: grant:portable-kind-required` (portability is a distinct kind) |
| 49 | **Portable escape, measured** — portable-kind grant exercised after activation restart | **Accepted** — this is the documented escape from epoch revocation, printed rather than hidden |
| 50 | **Permissive mediator subclass** — subclass `MediatorProvider` with a no-op `require()` | `MEDIATOR_INTEGRITY` refuse |
| 51 | **Monkey-patched mediator** — replace `require()` on the provider instance or the class | `MEDIATOR_INTEGRITY` refuse |
| 52 | **Mediator implementation replacement** — pass a non-`MediatorProvider` gate | `MEDIATOR_INTEGRITY` / `MEDIATOR_REQUIRED` refuse |
| 53 | **Direct same-UID state write** — bypass the load gate and write `loader-state.json` directly as the same uid | Detected `direct-state-bypass` (no Aura load entry); **not prevented** — yields no grant, no receipt, no authority |
| 54 | **Crash after nonce reservation** — inject failure at each durable boundary, then cold reopen | `AUTHORITY_CONSUMED_EFFECT_UNKNOWN` / `INDETERMINATE` — never success, never a clean refusal; consumed grant stays in accounting |
| 55 | **Crash then replay** — replay the consumed grant after a mid-settlement crash | `GrantError: grant:replayed` (no silent second effect) |
| 56 | **Corrupt settlement journal** — truncate / garble a settlement record | `settlement:journal-unreadable` — loud, never treated as clean |
| 57 | **Object-role substitution** — pass a receipt, checkpoint or patent license as `grant`, or a grant as a checkpoint | `role:mismatch: <role> requires kind <kind>*` |
| 58 | **Stale signed checkpoint** — present an older, correctly signed checkpoint as the current head | `CHECKPOINT_STALE` — signature validity ≠ consistency ≠ latestness |
| 59 | **Checkpoint beyond the log** — sign an observation claiming a size the log has not reached | `CHECKPOINT_STALE` (a bigger claim is not a fresher state) |
| 60 | **Doc-claim drift** — quote a refuse code in docs that does not exist in `diamond/refuse_codes.py`, or assert the observer-survival claim | `claim-integrity` court fails (`DIAMOND: RED`) |
| 61 | **Protection removed** — delete one protection and re-run the court on a throwaway copy | Court must go `RED`; a court that stays `DIAMOND: GREEN` is decoration and fails `sensitivity-mutants` |
| 62 | **Portable authority does not need a separate key** — the same governor key that mints epoch-bound grants also mints the portable kind | **Unclosed design gap, stated not hidden.** The key holder can already mint a fresh grant for any activation they know of, so portability adds little *to them*; but a distinct portable-ceremony key is the honest next step and is **not** implemented here |
| 63 | **Unknown or contradictory composition base** — declare a `compositionBase` outside the closed vocabulary, or declare one that its own block does not satisfy | Refused **by name**: `compositionBase unknown` quotes the string it did not recognise, and a contradiction is reported as `composition closed fields (base v1)` or `(base v2)` — the verifier states the base it checked instead of refusing on a field count. Both bases are accepted, each under its own name. Proved by `scripts/verify-composition-base.py` (arms 5–8) and the `genesis-5field-declared-v1` row of the pinned-contract check |
| 64 | **Physical fault** — command a device past the reference limit, outside the geofence, or after the grant's period has run out | `LIMIT_EXCEEDED` / `GEOFENCE_VIOLATION` / `GRANT_EXPIRED`, each naming the reading and the bound it broke |
| 65 | **Physical variance, then try again** — a reading beyond the reference tolerance, followed by a retry with valid authority | `PHYSICAL_VARIANCE_HALT` — a **latched** halt. The retry is refused under the same code and this brick ships no clear path, because "try again" is the move a physical fault must not reward |
| 66 | **Authority bound to a different reference** — present a grant whose `referenceDigest` names another reference file, or no reference at all | `grant:reference-mismatch`, refused before anything moves. Editing the reference file changes its digest, so the old authority stops applying |
| 67 | **Envelope edited after signing** — mutate a signed device command | Refused on the `signature` before any authority is exercised |
| 68 | **Delegation sheds the bound** — a child grant exchanges or drops `referenceDigest` | `grant:delegation-widened: reference`, refused when the child is minted (dropping it is not mintable either, and hand-building one still refuses) |
| 69 | **Envelope reused with another grant** — present one signed device command with a different grant, including one naming the same reference | `envelope:grant-mismatch`. An envelope names the grant it was sealed for, so it is not transferable between grants |
| 70 | **Clearance without a halt** — present a clearance grant to a device that is not latched | `HALT_NOT_LATCHED` |
| 71 | **Clearance naming the wrong halt** — a new grant that names a different halt id from the one the device recorded | `grant:halt-mismatch`, quoting both ids |
| 72 | **Clearance predicted in advance** — over a simulated device the halt id is computable, so mint a grant naming it BEFORE the halt happens | `grant:not-new`: the grant must be issued at or after the halt, so a pre-authorized one clears nothing. The arms compute the real id in advance and show both halves |

## Out of scope (do not demand of this toy)

- Real second device / network retainer (separate process + root is what is measured)
- Owner-key human-ceremony
- Process / uid isolation
- Full RFC 9162 §2.1.4.2 step 2 (pow2 prepend)
- Crash-safe disk WAL — rows 54–56 account for a crash, they do not recover from one
- Immutable in-process objects (rows 50–52 detect substitution; see `PYTHON_RUNTIME_TCB`)
- Deep monorepo / Cordis / product membrane / CRT / ghost-mesh
- WASM proposal-cell execution, Seatbelt guest spawn, broker/issuer, or
  Electron (Diamond is a cold verifier; see `CONTINUITY-SPINE.md`)

## Pass criterion for Astra

Every row above either refuses with the named code, or returns the named
Phase 0 / cold-court verdict. No silent accept. No CONFORMING claim.
`./scripts/diamond.sh` → `DIAMOND: GREEN` including foreign smoke + nonce race.
