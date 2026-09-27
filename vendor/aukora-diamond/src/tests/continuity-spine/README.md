# Continuity regression court

Run `python3 -B tests/continuity-spine/boundary.py --root .` and
`python3 -B -m unittest discover -s tests/continuity-spine -p 'test_*.py'`.
Both are mandatory in `scripts/diamond.sh`, the existing CI entry point. No new
workflow or paid review is needed. The tests use only committed data and Python's
standard library; no sibling checkout, WASM runtime, network, or live service.

The static court checks the cold consumer's declared import surface, closed
runtime-module inventory, named forbidden runtime symbols, required spine and
security prohibitions. Existing control-plane toy modules stay separate. Its
negative controls inject prohibited imports/symbols, remove required docs, and
introduce runtime files in disposable copies. It is a source regression rule,
**not a sandbox or a proof against arbitrarily obfuscated hostile Python**.
A contributor able to alter the policy and its tests still needs independent review.

Check-18 exercises real committed Genesis receipt fixtures through Diamond. A
green receipt check reports execution as NOT_ESTABLISHED; different unsigned
producer claims over identical evidence do not change that. Added moduleSha256
receipt fields are refused under today's closed contract. It also tests bad
signatures, missing anchors, early CLI refusals, and a deliberately false upgrade.
Existing `tests/kira-artifact/make-fixtures.mjs` regenerates the historical fixture
format; these tests do not mint, claim a fresh producer run, or execute the proposal cell.

Cold CLI scope rendering is shared through `finally`, including verification
refusals and argument-parser exits. Wrong/unreadable keys, malformed receipts,
absent/conflicting anchors and bad signatures keep the scope without a success
label. Controls remove or falsify the renderer and demonstrate detection.

`test_court_refusal.py` exercises all four verdict/exit combinations through the
helper the real rewrite-both court calls. An `or` to `and` mutation fails both
single-error cases. These are committed regressions, not handoff-only diagnostics.

`test_kira_numbers.py` and `test_artifact_numbers.py` exercise numeric refusals in
the library and real CLI, including wrapper and approval-artifact paths. Decimal
JSON numbers report `UNSUPPORTED_NUMBER`/`UNSUPPORTED`; integer and decimal-string
fixtures still verify. No ECMAScript floating-point serialization is guessed.

`test_content_tamper.py` changes arbitrary supported content while preserving
canonical JSON. The actual approval verifier must report the primary refusal
`APPROVAL_CONTENT_MISMATCH`, with the signature still valid. It detects the former
no-`Cedar` fallback that corrupted JSON and refused for the wrong reason. The helper
is acceptance tooling, shipped outside the isolated consumer import closure.

`test_retained_receipt.py` supplies an independently retained **Kira receipt** via
the library or `--retained-receipt <file>`. It uses the existing signed receipt
profile and the separately supplied issuer anchor. This is not the distinct Aura
Merkle-checkpoint or Diamond toy-checkpoint wire. The consumer never discovers a
checkpoint in a wrapper or accepts another profile as this one. A short honest log
still verifies without retention; a supplied later receipt makes the same prefix
refuse `RETAINED_CHECKPOINT_TRUNCATED`. A rehashed divergent prefix refuses
`RETAINED_CHECKPOINT_CONFLICT`; malformed or bad-signature checkpoints refuse by
name. Even `SUPPLIED_PREFIX_MATCH` leaves completeness `UNDETERMINED` and latestness
`NO_LATESTNESS`. The caller must retain and supply this input separately from the
untrusted presented bundle. Storage, independent custody, key continuity across
rotations, and a guarantee of the world's latest entry are not implemented here.

`measure_pins.py` is a separate opt-in source measurement command for a machine
holding Deep/Genesis/Membrane checkouts. `local-pins.json` records the measured
bytes and commits, including decoded WASM hash and Seatbelt observation literal.
It does not exercise a sandbox or establish deployment. It is not imported by
the consumer and is not needed on CI.

Genesis handoff: consume the updated cold consumer only after its normal review
and merge gates. Do not treat green Diamond verification as a cell invocation,
human attendance, custody or authorization. The application mount remains an
independent task against its exact release. Keep the minimal history verifier's
wire format distinct from Kira receipts and the separate experimental toy projection.

The Spec Alpha increment adds real receipt-class refusal controls and public-only
stranger verification. `test_authority_mode.py` signs adversarial receipt classes
with disposable test keys: `human-ceremony` refuses, while producer-supported
scripted/delegated/unattributed labels remain reported, never human presence.
Adding Alpha's incompatible presence/authority fields still fails the closed v3
schema. No new wire fields are accepted.

`test_stranger_keys.py` constructs coherent honest and attacker histories in a
disposable producer process, removes only its generated private-key files, then
runs public-only cold consumers. Missing/wrong expected keys, tampering and stripped
signatures refuse. Checkpoint-pair verification now requires `--pub`; the explicit
`--allow-unsigned` demo route cannot claim signer identity or ignore a supplied key.
Cold receipt verification refuses two simultaneous anchor sources and explicit
empty anchor paths, including when the unanchored demo flag is supplied.
Mutation controls remove real verifier guards and demonstrate the resulting false
acceptance. These are synthetic universes, not new Genesis-produced transactions.

The closed ceiling table in `CEILINGS.md` is mandatory. Its external rows refer to
source claims, not confinement reruns. `measure_pins.py --spec-alpha <checkout>`
optionally records Alpha source hashes; absence of the flag requires no Alpha tree.
Model loaders, Node bridges and Seatbelt launch helpers are prohibited source
dependencies. The AST guard still does not confine arbitrary Python execution.

Genesis caller migration: supply the expected checkpoint signer via `--pub` (or
`expect_pk=` at the library boundary), preserve `authorityScope` and `execution`
through every output schema, and keep grant validation separate. Do not infer
attendance, latestness, rollback protection or cell execution from a green check.
