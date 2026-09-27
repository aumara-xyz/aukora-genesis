# AUKORA-37 review → Diamond obligations

Source review: AUKORA-37 `3f45ffb7d17e2522ff3d97cdcf13acd8f0bb7e81`, R1–R12.
No AUKORA-37 producer or verifier source is imported. A finding in that different
profile is not evidence of the same defect in Diamond. This table keeps every
request assigned without pretending a cold reader can observe unexported events.

| Finding | Diamond disposition | Executable evidence / remaining owner |
|---|---|---|
| R1 vendor identity | Alpha imports checked against fixed manifest + SHA256 + Git blob + size, before execution | `scripts/verify-alpha-profile.py`; `tests/alpha-runner/test_runner.py`. Kimi’s Ed25519 copy bug was not in Diamond. |
| R2 uncertain consumption | Existing toy reports `AUTHORITY_CONSUMED_EFFECT_UNKNOWN`; cold files cannot establish an unseen producer journal | Existing `diamond/settlement.py` and court; crash reconciliation remains producer work. |
| R3 object integrity | Existing Kira consumer checks the supplied object bytes/digest and receipt relationship | `tests/kira-evidence/run-empty-dir-arms.sh`; live recall is Genesis’s responsibility. |
| R4 later decline | Unobserved later decisions cannot be inferred from a signed earlier approval | Producer must enforce latest decision. A future exported decision profile needs explicit producer/consumer review; no invented field accepted here. |
| R5 coverage/cross-binding | Use each existing profile’s own complete required inputs and bindings | `tests/kira-artifact/test_kira_artifact.py`, `scripts/verify-kira-evidence.py`; not acceptance of Kimi’s v3-37 profile. |
| R6 export privacy | Consumer input checks do not prove the producer excluded all private material | Genesis/Kimi exporters own fresh-destination and private-material handling. No exporter added to Diamond. |
| R7 confinement | NOT_ESTABLISHED by cold artifacts | `tests/continuity-spine/test_check18.py`; no guest launcher imported. |
| R8 acceptance aggregation | Exit and expected result both required; empty/skipped suites fail | `tests/alpha-runner/test_runner.py`, `test_ladder.py`; `verify-cold-distillation.py`. |
| R9 atomic current authority | Clock/rotation atomicity is a producer property | Keep host-time and currentness limits; offline signature validity cannot establish the execution-time control head. |
| R10 approval presentation | Existing approval artifact binds exact content with external approver anchor | Artifact suite; a truthful UI and live presentation remain Genesis obligations. No unsigned field can upgrade attendance. |
| R11 reached checks | Separate profile, pin, budget, runner, freeze tests assert specific outcomes | Do not claim outer manifest refusal proves every inner signature or chain check. Existing consumer suites remain mandatory. |
| R12 scope on errors | Existing cold receipt scope regression retained; freeze CLI must print scope on all exits | `tests/continuity-spine/test_check18.py`; `tests/alpha-freeze/`. |

Successful local tests establish only their named scope. They cannot make the
whole system current, complete, independently custodial, human-attended or safe.
The original repositories are not marked deletable by this inventory.
