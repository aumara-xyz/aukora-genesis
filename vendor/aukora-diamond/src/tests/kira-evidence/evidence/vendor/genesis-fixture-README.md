# operation-envelope-v1 — the shared public fixture

One operation, one record, one set of digests, so that **"it verifies" cannot mean four different
things** across Aura, Kira, Aumlok and Diamond.

Regenerate (must be byte-identical — determinism is part of the fixture, not a nicety):

```bash
node tests/fixtures/operation-envelope-v1/build.mjs
```

## What this is NOT — read this before using it

**It is not an approval, not a grant, and not usable in a live path.** The envelope carries
`authority.grants: false`, `fixtureOnly: true`, a published `challenge`, and a
`subjectControlDigest` whose value is literally `FIXTURE-ONLY-NOT-A-REAL-CONTROL-DIGEST`.

That is deliberate: **every lane is expected to demonstrate that it REFUSES this fixture when it is
offered as authority.** A consumer that accepts it is broken, and finding that out here is the point.
No model `confirm:true`, no local grant mint, no identity label and no digest alone substitutes for the
owner approval that a real operation requires.

## Files

| file | what it is |
|---|---|
| `operation.json` | the operation envelope: identity, content, destination, scope/privacy, challenge, expiry, and the record identity it proposes |
| `record.json` | the Kira record, produced by `plugins/aukora-kira/lib/record.mjs` — the same producer the settlement path uses, so `recordId` is the real deterministic one |
| `DIGESTS.txt` | sha256 of each file, plus `recordId` and `recordDigest` |
| `build.mjs` | the generator. Fixed inputs, no clock, no randomness. |

## The fields, and what each one binds

- **exact content** — `operation.content`. This is what the digest covers. Change one byte and both the
  record digest and the operation digest change.
- **stable destination** — `operation.destination`. Where the effect is proposed to land. A consumer must
  check it against the path it actually writes to, not trust it.
- **record/content digest** — `record.digest` (sha256 over canonical JSON of the record) and
  `record.recordId`. Canonicalization is RFC 8785 JCS via the producer's own `canonicalJSON`;
  `scripts/composition/jcs.py` implements the same restricted subset.
- **subject / control revision** — `operation.subject`, `operation.subjectControlRevision`,
  `operation.subjectControlDigest`. The digest is a fixture placeholder ON PURPOSE: Aumlok's control
  binding is a separate, not-yet-landed increment, and this fixture must not pretend it exists.
- **privacy/scope** — `operation.privacy` (`local` | `exportable` | `private`), `operation.scope`.
  `exportable` is chosen so this fixture may be redistributed and used as public evaluation data.
- **challenge / nonce** — `operation.challenge`. Published here, therefore single-use in production by
  definition: a real operation must mint a fresh one and a consumer must refuse a replay.
- **expiry** — `operation.expiresAt`. A real consumer must refuse an expired operation; the fixture's
  value is fixed so the bytes stay stable.

## What each lane owes on this fixture

- **Kira** — settle this exact record on a disposable store; the receipt must bind content, recordId and
  historical position; after a second and a third valid write, the FIRST receipt must still verify.
- **Aura** — associate this record's observation to the history; the receipt's Aura side must be
  recomputable from the record, not asserted.
- **Aumlok** — refuse this fixture as approval and say why by name; when the real control binding lands,
  the operation digest must be recomputed independently by signer and consumer.
- **Diamond** — verify offline, from an empty directory containing only this fixture and the shipped
  verifier closure. Report `OWNER_APPROVAL_UNCHECKED` rather than upgrading it: an unsigned wrapper cannot
  turn legacy evidence into owner approval.

Each lane states, in its report: the command, the observed verdict, and **which refusal it proves**.
