# External oracle court

Oracle: **transparency-dev/merkle** `testdata/consistency` (98 probes)
Four implementations: membrane (organs/merkle) · independent · python minimal · rust replica

## Headline

| metric | value |
| --- | --- |
| probes | 98 |
| four-way agreement (ok/fail) | 98 agree / 0 disagree |
| all four match oracle | 97 |
| any mismatch vs oracle | 1 |

## Per-implementation vs oracle (wantErr)

| impl | match | miss |
| --- | ---: | ---: |
| membrane | 97 | 1 |
| independent | 97 | 1 |
| python | 97 | 1 |
| rust | 97 | 1 |

## How to read this

- **Oracle match** is success/failure vs `wantErr` (not reason-string equality).
- If all four agree with each other **and** the oracle, the arithmetic is not a private dialect.
- If all four agree with each other **and disagree** with the oracle, that is the most valuable failure mode — file it loud.
- Reason-string differences across implementations are expected; ok/fail is the shared claim.

## Named miss (defended)

When present: `additional/sizes-are-equal-one-and-proof-is-empty.json` — non-digest roots refused.
Gate passes 97/98 with four-way lock; fails on any other miss or any four-way split.

## Permissions

**STRUCK** on single-uid hosts — see `scripts/fixtures/admission-substrate/PERMISSIONS.json`.

## Accusation-path ceiling

**0 / 98** outside probes produce `OBSERVATION_CONFLICT`. Quote beside 97/98.
