# @aukora/dsh-plugin-aumlok

The public identity/control adapter. One question, answered the same way for every consumer:
**which AUKORA subject is this, and is it still the one that was pinned?**

```js
import { projectPublicControl, admitPublicControl } from '@aukora/dsh-plugin-aumlok'

const projection = projectPublicControl({ genesis, activeControl, custodyClass })
// { domain, subject, epoch, activeControlDigest, revoked, approvalKeyDid, custodyClass }

const verdict = admitPublicControl({ projection, expected: pinned, signerPublicKeyPem })
// { ok: true, subject, epoch, activeControlDigest, approvalKeyDid }
// { ok: false, reason: 'aumlok:control-signer-mismatch', detail: '…' }
```

As a Cordis plugin (`exports["./service"]`), mounted from a composition row by absolute path:

```yaml
- id: aukora-aumlok
  name: "<release>/plugins/aukora-aumlok/lib/service.mjs"
  config:
    directory: "<controller-directory>"
```

It registers `ctx.aumlokControl`, injects no service (`inject = []`), and imports only its sibling
modules, never `@deepseek-ai/cordis`. See the mount note in
`scripts/aumlok/PROVENANCE.md` for why it must not import `@deepseek-ai/cordis`.

## The four facts it keeps distinct

| Field | Source | Changes when |
|---|---|---|
| `subject` | `sha256` over the content-addressed **genesis** record (a changed record yields a different subject) | a different genesis. **Never** on a key rotation. |
| `epoch` | the active control head | a control transition |
| `activeControlDigest` | digest of the active head | a rotation or a revocation |
| `revoked` | the active head's terminal state | revocation only |
| `approvalKeyDid` | `did:key` of the registered Ed25519 approval key | a rotation |

`custodyClass` and `domain` travel with them so a consumer cannot read the identity facts without
being able to read which class of custody produced them.

A fifth thing — scoped `root`/`device`/`session`/`agent` delegation claims — is *checked* here and
granted nowhere. `verifyDelegationAttenuation` returns named refusals about scope and never returns
"allowed". A matching name, a matching DID, or an unsigned claim never authorizes.

## The owner approval channel (D2)

A separate signer process on the same uid holds the registered key and signs over an exact preimage;
the broker verifies before anything settles. This is process separation, not isolation
(`OWNER_KEY_SAME_UID: true`).

```js
const session = createOwnerApprovalSession({ projection, expectation, socketPath })
await session.approve({ operationDigest, expiresAt })
// { ok: true, subject, activeControlDigest, approvalKeyDid, operationDigest, challenge, signature }
// { ok: false, reason: 'aumlok:channel-unavailable', detail: 'ENOENT: …' }
```

Each `approve()` re-admits the projection the session was opened with; it does not re-read the
controller. `approveOperation` and `settleOperation` reload and re-admit the controller on every call,
so they catch a rotation or revocation between two calls. A long-lived session does not. The signed bytes are
`'aukora:owner-approval-signature:v1' + NUL + canonicalJSON({subject, activeControlDigest,
operationDigest, challenge, issuedAt, expiresAt})`, re-derived by the verifier from **its own**
request, and verified under the key decoded back out of `approvalKeyDid` — D1's rule that the
verifier derives the DID from the key whose signature it verified.

`approve()` returns a named refusal rather than throwing. `APPROVAL_REFUSE` names ten: unavailable,
malformed, expired, channel-unavailable, channel-timeout, channel-protocol, refused, challenge-mismatch,
replayed and signature-invalid. The signer's not-ready reasons (`aumlok:unbound`, `aumlok:no-seed`) and
`aumlok:signer-socket-path-too-long` pass through under their own names. Opening a session without a
socket path throws a `TypeError`. The names are distinct because whether to restart a process, replace a
key or investigate is a different decision in each case.

The signer mandates a `review` procedure and ships no default: `signer:no-reviewer` exists so that an
unconfigured signer cannot approve by omission. `scripts/aumlok/signer.mjs` has three approver modes:
`test-all` (prints `NOT a human review`), `decline-all`, and `popup` (a native dialog that fails closed).
No court drives `popup` or `lib/approval-popup.mjs` **[CODE ONLY]**.

## The interface another lane consumes: one digest in, one artifact, one gate

`lib/operation-approval.mjs` is the NAMED surface, and `scripts/aumlok/` wraps it in three commands.
The artifact is an `aukora:approval-receipt:v1` record and nothing else — no envelope, no second copy
of the digest. `scripts/aumlok/verify-approval` runs from an empty working directory given only the
receipt and the public key. It still loads this checkout's adapter and rebuilds the signed bytes with the
functions that produced them, so it is a same-implementation check, not an independent verifier.

```
scripts/aumlok/approve-operation \
  --controller <dir> --expect-subject <aukora:1:…> --expect-control-digest <64 hex> \
  --operation <content file> --operation-digest <64 hex> \
  --signer-socket <path> --artifact-out <artifact.json> --expires-at <unix seconds> \
  [--approval-class scripted|delegated|unattributed] [--key-class B]

scripts/aumlok/settle-operation \
  --controller <dir> --expect-subject <aukora:1:…> --expect-control-digest <64 hex> \
  --operation <content file> --state <disposable dir> [--artifact <artifact.json>]
```

The digest is fixed and re-derivable by anyone holding the content — `operationDigestOf` computes it,
and there is exactly one accepted convention:

```
operationDigest = sha256( utf8("aukora:operation-content:v1") ‖ 0x00 ‖ contentBytes )
```

```js
import { operationDigestOf, approveOperation, settleOperation } from '@aukora/dsh-plugin-aumlok'
const receipt = await approveOperation({ directory, expectation, content, operationDigest, socketPath, expiresAt })
const verdict = settleOperation({ directory, expectation, artifact, content, stateDirectory })
// { ok: false, reason: 'aumlok:approval-operation-mismatch', detail: '…', results: […] }
```

Neither function throws on an operational failure and neither holds a key: approvals go to the
separate signer process over its socket, and a missing signer is `aumlok:channel-unavailable` rather than a
fallback signature. Refusals, by name:

| Refusal | The fact it names |
|---|---|
| `aumlok:settlement-no-approval` | no artifact at all: an bound identity is not an approval |
| `aumlok:approval-unavailable` | the identity is not the pinned/admitted one, or the artifact names another |
| `aumlok:approval-expired` | the window had closed at mint time or at use time |
| `aumlok:approval-key-mismatch` | the artifact names a key the pinned identity does not register |
| `aumlok:approval-operation-mismatch` | the presented content does not derive the approved digest |
| `aumlok:approval-signature-invalid` | the signature does not verify under the registered key |
| `aumlok:approval-replayed` | this challenge was already consumed once |
| `aumlok:approval-boolean-is-not-consent` | a boolean was offered as the approval |

**No boolean is an approval.** `approve-operation` has no `--confirm`/`--yes`/`--force` that produces
anything; passing one is refused by that last name, with or without a signer, and writes no artifact.

**A second invocation that presents the same challenge is refused**: an `O_EXCL` marker per challenge
in `--state`, measured on a local filesystem across two processes. The marker is written only after the
signature verifies; that ordering is code-read, and no arm yet presents a bad signature over the same
challenge and counts markers. The marker is not fsynced, so crash durability is not measured. NFS, a
second host, and a writer that rewrites the state directory are not measured either.

**An approval is not attendance.** The signer's approver is a labelled procedure, the artifact records
`attendance: reported-not-proven`, `identityBound` is `false` on every path, and the settlement record
says the gate opened — not that anything in the world was performed.

## Is the key in this record the key this record registers?

`lib/identity-correspondence.mjs` answers that over the **stored bytes**, which nothing else did: every
other reader checks the public half, and the genesis commitment covers public keys, so a record whose
`mlDsa65SecretKeyHex` was filler of the right LENGTH reads back perfectly.

```
scripts/aumlok/verify-identity --controller <dir> --read-secret-half [--expect-subject … --expect-control-digest …] [--json]
```

It proves, in one process: Ed25519 correspondence (stored private key → registered public key, DID
re-derived rather than string-matched), ML-DSA-65 correspondence (`getPublicKey(storedSecretKey)` equals
the registered public key), and an ML-DSA-65 round trip **with a negative probe**, so a verifier that
answered `true` unconditionally could not pass. It refuses by name
(`aukora:identity-ed25519-correspondence-failed`, `aukora:identity-ml-dsa-65-correspondence-failed`, …)
and prints `ML_DSA_65_CONFORMANCE: not-established`, `IDENTITY_BOUND: false`, `AUTHORITY: none` and
every ceiling on the accepting path too.

`--read-secret-half` is required: the flag is the acknowledgement that this reads private key material,
which is itself a same-uid act, not isolation. `--json` prints one machine-readable document — and
still no private material.

## What it refuses to do

* The public projection and admission path (`projectPublicControl`, `admitPublicControl`, the loader)
  does not authorize, sign, or create or rotate a controller. The package also ships the v3 ceremony
  (`bindV3`, `refreshBindingV3`), signers (the owner signer, the machine signer, the handover and
  root-class signing) and a settlement gate (`settleOperation`). Those modules do create, rotate, sign
  and open a gate, each with its own courts.
* `projectPublicControl` and the loader never return private key material (the result is built field by
  field). The ceremony exports `bindV3`, `readKeptMachineSeed` and `rootPrivateKeyOf` return seeds or
  private keys by design.
* No module in the package emits `identityBound: true` (`tests/aukora-aumlok.test.mjs` asserts it), and
  it claims no hardware custody or succession.
* It does not half-verify. The root-control suite is hybrid; a promotion refuses by name unless
  **both** halves can be verified.

`project`, `make-disposable-identity`, `verify-identity`, `approve-operation`, `settle-operation` and
`bind` print the ceilings in `lib/ceilings.mjs`, and `signer.mjs` and `diagnose` print its signer ceilings.
Courts assert them on the accepting paths of `verify-identity`, `approve-operation` and `settle-operation`
(all lines) and of `project` and `make-disposable-identity` (one line each); not for `bind`, `diagnose` or
the signer's stdout. `rehearse-rotation`, `bind-overlay` and `verify-repoint` print none. `verify-approval`
prints the ceilings carried in the receipt, which the signature does not cover.

## No build step

The modules under `lib/` are the shipped bytes. Nothing transpiles or bundles them, so the digest a
reviewer checks is the digest that runs. Every static single-quoted `from` import in the top-level
`lib/*.mjs` is a `node:*` builtin or a sibling (an arm in `tests/aukora-aumlok.test.mjs`).
`pq-generator.mjs` also dynamically imports the vendored, pinned `@noble/post-quantum` closure in
`lib/vendor/noble-ml-dsa` (see its `PROVENANCE.md`), which that arm does not scan.

## Reviewing it

```bash
node tests/aukora-aumlok.test.mjs            # 137 arms (run 2026-09-26 at 674fae6bf)
node tests/aukora-aumlok.test.mjs --mutate   # 143 arms: five mutation arms plus 'no mutation was missed'
node tests/aukora-aumlok-signer.test.mjs     # 93 arms over real Unix sockets (99 with --mutate)
node tests/aukora-aumlok-approve.test.mjs    # 41 arms: correspondence, the artifact, the gate
AUKORA_DSH_RELEASE=<release> node tests/aukora-aumlok-mount.test.mjs   # 22 arms, a real DSH boot
```

The mount suite is the one that needed a host: it boots a disposable DSH profile over a release,
lets the **real Cordis loader** load `lib/service.mjs` from an absolute composition path, and has a
second plugin with `inject = ['aumlokControl']` consume it. Its negative control mounts the same
consumer with no aumlok row — Cordis withholds an unsatisfied dependency, so the consumer does not
activate and its report is absent. Because the mount row configures no `capabilities`, the consumer's
promotion call must come back `aumlok:ed25519-point-validator-unavailable`, which is the fail-closed
behaviour arriving in the host rather than a gap the mount fills.

`scripts/aumlok/PROVENANCE.md` records the Deep source pin, the per-module port map, the measured
compatibility mapping between Deep's hybrid root-control layer and Genesis's Ed25519 action signer,
and the two checks this closure cannot perform.
