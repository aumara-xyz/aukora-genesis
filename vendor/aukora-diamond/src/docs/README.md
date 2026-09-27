# Documentation

[Repository overview](../README.md) · [License scope](../LICENSING.md) · [Contributing](../CONTRIBUTING.md)

## Verification and integration

| Guide | Purpose |
| --- | --- |
| [Verification guide](VERIFICATION-GUIDE.md) | Commands, artifact profiles, trust inputs and canonicalization |
| [Continuity spine](../CONTINUITY-SPINE.md) | Cold-consumer boundary, blob pins and execution non-claims |
| [Genesis handoff](DISTILL-TO-GENESIS.md) | Consumer interfaces for the producer integration |
| [Alpha byte inventory](../SPEC-ALPHA-BYTES-MIGRATED.md) | Imported source and adaptations; remaining producer work |
| [Alpha legacy profile](../profiles/alpha/legacy/README.md) | v1/v2, rotation and witness verification |
| [AUKORA-37 mapping](../AUKORA37-INVARIANTS-MIGRATED.md) | Which demo invariants have an executable Diamond counterpart |
| [Stage 0 readiness](../STAGE0-CONSUMER-READINESS.md) | Consumer evidence and the limits of release/runtime claims |

[2026-09-22 defensive review](REVIEW-2026-09-22.md) records the latest corrections and local acceptance.

## Courts and public fixtures

[Diamond court inventory](../REDTEAM.md), [continuity checks](../tests/continuity-spine/README.md),
[Kira evidence](../tests/kira-evidence/README.md), [approval artifacts](../tests/kira-artifact/README.md),
[signed freeze statements](../tests/alpha-freeze/README.md), and
[pinned compatibility](../tests/pinned-contract/README.md).

A court is an executable acceptance check. The fixture README files distinguish
synthetic controls from historical producer output. Neither substitutes for a
new live transaction.

## Limits and historical material

[SECURITY](../SECURITY.md) and [CEILINGS](../CEILINGS.md) define current claims.
The [reviewer checklist](../REVIEWER-CHECKLIST.md) describes the review method.
[PITCH](../PITCH.md) describes the original reference demo. `legal/` preserves
historical legal/design notes; it is not part of the cold runtime or a statement
of present product capability.

The [architecture graphic](assets/diamond-overview.svg) is editable, self-contained
SVG. It depicts the cold verification path, not the separate authority demo.
