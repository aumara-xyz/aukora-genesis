# Security policy

AUKORA Genesis is **pre-release** software. It has no tagged releases, no packaged build offered
for download, and no supported deployment. This policy covers the source in this repository at
the tip of its default branch.

## Reporting a vulnerability

Report privately through **GitHub Private Vulnerability Reporting**: the *Report a vulnerability*
button on this repository's **Security** tab. That channel becomes active when the public
repository exists, and it is the only reporting channel. There is no security email address.

Please do not open a public issue, pull request or discussion for a suspected vulnerability.

A useful report gives:

- the commit you tested;
- the organ and the file or command involved (see *Scope* below);
- what you expected the code to refuse or print, and what it did instead;
- the smallest steps or bytes that reproduce it. If a court is involved, say whether its red
  arm still goes red.

Do not put real secrets, real API keys or anyone's personal data in a report. Use disposable
keys and test fixtures; `scripts/aumlok/make-disposable-identity.mjs` makes a throwaway Aumlok
identity for this purpose.

## What happens after you report

The project is maintained by a small team. There is no committed response time, fix time or
disclosure date, and there is no bug bounty. The aim is to tell you whether a report is in
scope once it has been read, and to agree any publication with you rather than announce it over
you. If you would like to be credited, say so in the report.

## Supported versions

Only the latest commit on the default branch. There are no releases to patch and no backports.

The DeepSeek Harness revision Genesis builds on is pinned in `upstream-dsh.json`. The pin is not
bumped automatically, so a report written against a different upstream revision may not apply
here, and an upstream fix does not reach Genesis until the pin moves.

## Scope: what is Genesis's own

In scope is AUKORA's own code in this repository:

| Organ | What it does | Where it lives |
| --- | --- | --- |
| Composition gate | admits or refuses a declared module before it loads; issues and verifies one-use grants and receipts | `plugins/aukora-composition-gate/`, `plugins/aukora-gate-demo/`, `scripts/composition/`, `vendor/receipt/` |
| Kira | memory records, their receipts, owner-approved settlement, and the Experience Court | `plugins/aukora-kira/`, `scripts/kira/` |
| Aumlok | identity records, owner approvals, the separate signer and its approval popup | `plugins/aukora-aumlok/`, `scripts/aumlok/` |
| Aura | the hash-linked, tamper-evident evidence log (append-only is judged between retained observations, not enforced on the file), retained observations, the witness and the consistency court | `scripts/aura/`, `scripts/phase0/`, `vendor/append-only/` |
| Desktop shell | the Electron window that starts or attaches to one local harness | `apps/aukora-desktop/` |
| Checks | the keyless commands `docs/CLAIMS.md` lists, which must fail when their protection is removed | `tests/`, `plugins/aukora-kira/lib/wasm-cell/courts/`, `scripts/phase0-check-pins.py`, `vendor/append-only/verify.py` |
| Release materializer | builds the pinned host, strips it, records it and launches it | `scripts/build-dsh.py`, `scripts/materialize-aukora-release.py`, `scripts/release-strip.mjs`, `scripts/artifact-record.mjs`, `scripts/genesis-check.mjs`, `scripts/launch-dsh.py`, `scripts/artifacts-coverage.json` |
| Other AUKORA plugins | the foundation preset and the faces | `plugins/aukora-foundation/`, `plugins/aukora-face/` |

`vendor/receipt/` and `vendor/append-only/` are byte-pinned copies of AUKORA's own
verifier code. Report problems in them here; a fix is made where those bytes come from and then
re-pinned, never by editing the pinned copy.

Examples of what is in scope:

- a governed module whose body runs although the gate reports it refused;
- a grant, receipt, approval or memory record that verifies when it should be refused — forged,
  replayed, re-bound to different bytes, or checked against a key the caller did not anchor;
- a court that stays green when the protection it measures is removed;
- a path that drops its printed ceilings, or prints a stronger claim than the code measured;
- a launch token or session secret written somewhere the desktop shell says it never writes one
  (a command line or the window title);
- the desktop shell granting a permission to, or loading, an origin other than the harness it
  started or was told to attach to;
- a release that passes the artifact check after a covered file changed, beyond the limits
  stated below.

## What is upstream's

Genesis builds on a pinned copy of the **DeepSeek Harness** (DSH), including its Cordis plugin
loader and the packages it pins (`upstream-dsh.json`). AUKORA is not affiliated with or endorsed
by DeepSeek.

A vulnerability in DSH itself belongs upstream: report it to the DeepSeek Harness project through
the channel its own repository publishes.

**Tell AUKORA as well** — through the channel above — if Genesis's integration makes an upstream
issue worse: for example, if a composition row, a patch overlay, the launcher, a strip rule or the
desktop shell exposes it, widens it, or keeps an upstream fix from applying.

The same split applies to third-party libraries that keep their own notices, such as the noble
cryptography modules under `plugins/aukora-aumlok/lib/vendor/noble-ml-dsa/`, and to Electron,
which the desktop shell runs on.

## Known ceilings

Genesis runs as your user account. Nothing in it separates one process running as that user
from another, so an attacker who can already run code as your user is outside what Genesis
defends against. The organs print what they do **not** establish, by name, beside their results.

The names below are read from the code, and the code is the authority if the two ever disagree.
A report that only restates a ceiling describes the design as it stands. A way past something a
ceiling says *is* detected or refused — for example a same-user rewrite that goes undetected where
the code says it detects one — is in scope.

Auma Live, the voice face in `plugins/aukora-face/apps/`, sends each turn to a remote model provider
(OpenRouter) by default and writes the full body of every request it sends to a file under its DSH
home. Kira does not govern those files and no code deletes them. Two ceilings in the face's source
name this, `REMOTE_PROVIDER_EGRESS` and `TRANSCRIPTS_UNGOVERNED`; Auma Live's claims packet quotes them,
and nothing else prints them. `README.md` (*Limits first*) lists what leaves the machine.

CORE, a harness session running `presets/core/agent.cordis.yml`, has no shell or network tool of its
own, but its two subagent tools are on (`agent.cordis.yml:253-267`). In a materialized release they
start Codex and Claude Code as your user through upstream's adapters, and the pins in
`plugins/aukora-subscription-hands/lib/pins.mjs` are not on that path
(`scripts/materialize-aukora-release.py:440-457`; `plugins/aukora-subscription-hands/CONFIG.md`,
section 2). The preset's own header says both tools are on. No ceiling names this yet.

### Composition gate

Spelled in `scripts/composition/ceilings.py` and `plugins/aukora-composition-gate/src/policy.js`.

- `BOOTSTRAP_UNGATED` — there is no owner key at the gate. The governor key is generated
  locally, so a grant shows that this installation authorized a transition, not that a person
  did. Live receipts are `unattributed` / `NON-CONFORMING`.
- `SAME_UID` — an admitted module shares the process and the uid. The coeffect envelope is a
  digest binding, not isolation.
- `MEDIATOR_OFF` — with the mediator off, every transition refuses and no new governed effect
  happens.
- `STOCK_PLUGINS_NOT_YET_UNDER_POLICY` — upstream's own plugins load ungoverned. The launch-time
  hook is what enforces admission. Without it, a gate row that names a `stateDir` installs the policy
  late (imports before that are not covered), and a row without one (the shipped composition's) prints
  `NO ENFORCEMENT IS IN PLACE`; no court drives either message yet.
- A grant binds the governed entry file's bytes, its release-relative path and its relative import
  closure (D3 closed: a byte-identical copy at another path is refused), not bare-specifier
  dependencies or anything it fetches at run time. Attendance is `reported-not-proven`.
- The AUKORA plugin set is admitted by one Aumlok approval of the release's record
  (`plugins/aukora-composition-gate/GOVERNED.md`). The approving key is a software key on this Mac, and
  the record, the approval and the pinned approver are files the same uid can rewrite.

### Kira

Spelled in `plugins/aukora-kira/lib/memory-owner.mjs` and returned on every path.

- `SAME_UID` — the memory owner shares its caller's process and uid.
- `ISSUER_LOCAL` — the issuer key is generated by this installation and stored in the clear in
  its state directory; a grant shows this installation authorized a write, never that a person did.
- `NOT_CONFINEMENT` — nothing stops another process, or a caller that skips the module, from
  writing the same state directory.
- `NO_LATESTNESS` — a receipt names the log head at its own position, not the tip of every fork.
- `TRUNCATION_UNANCHORED` — a tail removed together with the store's own sequence marker is
  indistinguishable from a log that was never extended, unless a head is retained elsewhere.
- `APPROVAL_CONSUMED_IN_STORE` — an approval is spent by a marker inside one store, so
  single use holds for one writer over one store.

### Aumlok

Spelled in `plugins/aukora-aumlok/lib/ceilings.mjs`.

- `AUMLOK_SUBJECT_IS_A_NAME` — the subject is a stable name for an identity record, not a
  person, not consent and not a permission.
- `CONTROL_SIGNATURES_UNVERIFIED` — the projection path re-derives digests and rules but
  verifies no signature.
- `ED25519_POINT_UNVALIDATED` — Ed25519 public keys are checked for length and hex only, so
  promotion verification refuses unless a point validator is supplied.
- `ML_DSA_65_UNMEASURED` — conformance of the vendored ML-DSA-65 implementation to FIPS 204 is
  not measured, and promotion refuses without a verifier capability.
- `SAME_UID_POSIX_MODE_ONLY` — key custody is checked by owner, mode and link count only. ACLs
  are not checked, and the reader shares the uid. This is not key custody and not isolation.
- `OWNER_KEY_SAME_UID` and `SIGNER_DEVICE_TRUSTED: not-established` — the signer and the broker
  share a uid, and no platform custody measurement exists.
- `SUCCESSION_UNMEASURED` and `NO_IDENTITY_BINDING` — no identity binding, ceremony, hardware
  custody or succession claim is made. A signature shows that a key signed, never that a person
  attended.
- The owner's root key is derived with scrypt from the seven words and a public handle
  (`plugins/aukora-aumlok/lib/derive-v3.mjs`). The desktop draw is a seven-word acrostic: a six-letter
  anchor, then Nature, Nature, People, People, Spirit, Spirit
  (`plugins/aukora-aumlok/lib/themed-entropy.mjs`, `apps/aukora-desktop/aumlok-draw.mjs`). `measure()`
  prints the weakest and strongest anchors. That figure is not 128 bits and not 256 bits. scrypt's
  output length is not the phrase entropy. The theme only groups the words. Because the handle is
  public, someone who has the public key can search for the words offline; the scrypt cost slows
  each guess but does not stop the search. An old phrase still derives: the key is the seven words
  and the handle, not a lookup in the current theme pools.

### Aura

Spelled in `scripts/aura/`, `scripts/phase0/retainer.py` and
`scripts/aura/composition/association-plugin.js`.

- `RETAINER_SAME_OWNER` — a retained copy this host can reach belongs to the same principal as the
  system it checks. It is not an independent party agreeing.
- `CONSISTENCY_UNCHECKED` — a receipt checked without its retained observation says nothing about
  consistency over time.
- An association verdict is evidence, not truth, authorization, latestness or custody.

### Desktop shell

- The packaged app is **unsigned**: `"identity": null` in `apps/aukora-desktop/package.json`.
  macOS treats it as coming from an unidentified developer, and nothing verifies who built it.
- The backend's token is written to the backend's private server log (which the shell reads; the
  shell's own log redacts it) and to the window's cookie jar. In attach mode it is also held in
  `config.json` (mode `0600`) until the first successful load, which rewrites that file to the bare
  origin (the Electron arm that asserted this was archived with the test forest, so nothing in this
  tree checks it), or taken from `AUKORA_DESKTOP_URL`. Any process
  running as your user can read them. Upstream's backend accepts the token until it restarts (not
  measured here); it is not single-use.
- `allowUnapproved` defaulted to `true` until 2026-09-27 and now ships `false`
  (`apps/aukora-desktop/resolve.mjs`). With `true` in `config.json` the shell passes
  `--allow-unapproved` to the launcher, which also waives the plugin set. When `approvedRecordSha` lists no digest, the launcher then
  starts a release whose artifact record nobody approved (`apps/aukora-desktop/supervisor.mjs:334`;
  `scripts/launch-dsh.py:67-72`). The shell's launch diagnostics say when the value came from the
  shipped default (`resolve.mjs:294-297`). Changing the default to `false` is planned after the next
  cutover.

### Release materializer and artifact record

Stated in `scripts/artifacts-coverage.json` (`limits`).

- The artifact record is producer attestation from the run that wrote it.
- A producer that rewrites a host-only covered file and the whole record consistently is not
  detectable until a release digest is pinned in committed source.
- Cross-machine byte reproducibility is not claimed.
- A release materialized with `--development` keeps the hot-reload channel mounted. The
  `client-hmr-events-auth` patch (named and hashed in `upstream-dsh.json`, which `scripts/build-dsh.py`
  applies) makes it apply the app's browser authentication; the 401 without a cookie was observed live
  once, and no check drives it. A packaged release disables the channel. Development releases are for local editing
  only. (This limit is not in `artifacts-coverage.json`'s `limits`, and the materializer's own
  `--development` text still calls the channel unauthenticated.)

### Checks

A passing check is evidence about the revision and the machine it ran on. The checks in
`docs/CLAIMS.md` use disposable state and test keys; none of them measures the owner's installed app.
CI runs `sh scripts/check.sh` on every push (`.github/workflows/check.yml`, a macOS runner); it checks the
repository, not the installed app. The court forest that used to run here was archived on 2026-09-27
(`ARCHIVE.md`).

