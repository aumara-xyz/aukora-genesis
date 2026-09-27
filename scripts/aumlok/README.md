# scripts/aumlok — the AUMLOK lane's tools

Each file has one job. Three of them touch keys (corrected 2026-09-26): `bind` writes the owner's
controller record and keeps this machine's approval key (a 0600 file by default; a macOS Keychain custodian
is optional); `verify-identity --read-secret-half` reads the stored secret halves; and `signer.mjs` signs
owner approvals with the key file it is given, which `approve-operation` requests. The remaining tools hold
no key.

| File | What it is |
|---|---|
| `regenerate-deep-vectors.mjs` | Runs **Deep's own modules** at the pinned commit and writes the compatibility fixture. Public material only. Refuses a checkout with modified tracked files or without the pin. Reviewer step; needs a Deep checkout. |
| `check-vendor-closure.mjs` | Checks the vendored ML-DSA-65 closure against its manifest: every byte, the closure digest, the licences, no unaccounted file, and no surviving bare `@noble/…` specifier. With `--deep <path>` it re-derives every vendored file from upstream and requires byte equality, which is what proves the specifier rewrite is the ONLY difference. Read-only. |
| `make-disposable-identity.mjs` | Builds one **disposable** identity in a fresh private directory, in Deep's exact on-disk record shape. Test keys only: no default destination, refuses an existing directory, and registers a **real corresponding ML-DSA-65 keypair** whose halves it proves before writing. Deep's own store reader accepts the result. |
| `project.mjs` | The lane's front door — one controller directory in, the public identity facts and the ceilings out. Exits 0 on success, 1 on a named refusal, 2 on usage. |
| `signer.mjs` | The D2 separate-process owner signer (same uid, `OWNER_KEY_SAME_UID`): one Unix socket, one 0600 test key, one mandatory approver. Prints its status lines on startup and refuses to start without a key file or an approver. |
| `bind` | The **binding ceremony**: the owner types their phrase into THIS terminal (never an argument, never the environment, never chat), the root (Ed25519 + ML-DSA-65) is derived with scrypt from `--handle` and the seven words, and the pair is PROVEN to correspond. The root is not kept. A machine key derived from it is kept (a 0600 file by default; a Keychain custodian is optional) under the same-UID ceiling. Only the public commitment and the measured proof are printed. `--allow-non-tty` is test-only and says so. |
| `d3-spike.mjs` | The **D3 measure-only spike**: what Secure Enclave, a keychain biometric policy and WebAuthn PRF actually offer on this host, and the exact ceiling each **retires or keeps**. It creates no key in any store. As of its last recorded run all three retired nothing; its court (`tests/aukora-aumlok-d3-spike.test.mjs`) was deleted in `866a4a0c6`, so nothing re-checks this. |
| `verify-approval` | The **stranger** side of an approval receipt: run from an empty directory with the receipt and the registered public key and nothing else, it re-derives `did:key` from the key, checks the class rules, re-derives the exact signed bytes, verifies the signature, and prints the verdict with its ceilings. Refuses a forged DID and an unmintable class **before** touching the signature. |
| `CANDIDATE-ROW.md` | The exact `--patch` row for mounting this plugin in a release composition, with the disposable-profile evidence that the same row shape mounts and serves. A row to review, not a change made here. |
| `diagnose.mjs` | Read-only diagnostic: reports whether the adapter is PACKAGED, MOUNTED BY A ROW, and PROVISIONED. The release's default composition now mounts the adapter (unbound), but `diagnose.mjs` scans only `tests/fixtures` and `profiles/`, so it does not see that row, and its `HUMAN_KEY_PROVISIONED` line is a hard-coded "no" that `bind` now contradicts. Read its output as its own measurement, not as today's state. |
| `HANDOFF.md` | The Lead's action list: the exact CI patch, artifact-coverage inputs, service mount requirements and ownership boundaries. |
| `PROVENANCE.md` | The source pin, the per-module port map, the measured compatibility mapping between the two layers, the checks this closure cannot perform, and the fixture-vs-production separation (§2.1). |

## Generate a phrase

`node scripts/aumlok/bind --generate` prints one TRUE ACROSTIC — seven dash-joined tokens whose
initial letters spell the first — and exits without prompting, deriving a key or creating a
controller. Run it alone, without binding options.
Output is secret: use your own private terminal, not a recorded chat or shared log.

**IT READS NO FILE, AND THERE IS NO WORD LIST TO SHIP.** This used to draw seven unrelated words from
a bundled copy of the EFF Long Wordlist, pinned by SHA-256 and refused when missing or altered. The
AUMLOK phrase was never seven unrelated words: it is an acrostic drawn from the themed tables in
`plugins/aukora-aumlok/lib/ceremony-phrase.mjs`, so the list and every function that read it were
deleted. There is nothing left to tamper with, no runtime download, and no third-party attribution to
carry — the EFF list, its licence and its digest used to live in this paragraph and went with it.

The output is dash-joined because that is the form the ceremony window displays and compares against.
A court asserts that the string this command prints BINDS: the two used to disagree, and the window
could not bind the phrase it had just drawn.

Binding takes `--directory` and `--handle` (required: the handle salts the KDF).

## Run the lane

```bash
node tests/aukora-aumlok.test.mjs            # the court: 137 arms (run 2026-09-26 at 674fae6bf)
node tests/aukora-aumlok.test.mjs --mutate   # 143 arms: 5 mutation arms plus 'no mutation was missed'
node tests/aukora-aumlok-signer.test.mjs     # the D1/D2 signer channel: 93 arms (99 with --mutate)
AUKORA_DSH_RELEASE=<release> node tests/aukora-aumlok-mount.test.mjs   # mounts the CHECKOUT's adapter into a release's DSH host (not the release's own copy): 22 arms
node scripts/aumlok/diagnose.mjs --release <release>   # read-only: packaged vs mounted vs custody
node tests/aukora-aumlok-verify.test.mjs               # the stranger side: 21 arms, empty-directory runs
node tests/aukora-aumlok-walkthrough.test.mjs         # the ceremony (bind; the old aukora-aumlok-bind court was deleted)
node tests/aukora-aumlok-bind-overlay.test.mjs         # the ceremony's overlay
AUKORA_TEST_ELECTRON=1 node tests/aukora-aumlok-bind-court.test.mjs   # the ceremony through the real window (needs a display)
node tests/aukora-aumlok-pq-keypair.test.mjs           # the ML-DSA-65 pair + the pre-change control: 30 arms
node scripts/aumlok/d3-spike.mjs                       # the spike itself, read-only, keys created: 0 (its court was deleted)
# tests/aukora-aumlok-mount-flow.test.mjs is registered in no gate: it was removed on 2026-09-23 because the
# shell signer server did not exist; that server has since been implemented, and the suite has not been
# re-run or re-registered, so no arm count or expected result is claimed for it.

D="$(mktemp -d)/identity"
node scripts/aumlok/make-disposable-identity.mjs --directory "$D"
node scripts/aumlok/project.mjs "$D"
node scripts/aumlok/project.mjs "$D" --expect-subject aukora:1:0000… --expect-control 0000…

# The signer, on the same disposable identity. Both halves are test keys.
node -e 'const r=require("'"$D"'/local-control.json");require("node:fs").writeFileSync("'"$D"'/test-key.pem",r.ed25519PrivateKeyPem,{mode:0o600})'
node scripts/aumlok/signer.mjs --socket "$D/signer.sock" --key-file "$D/test-key.pem" \
     --registered-key-hex "$(node -p 'require("'"$D"'/local-control.json").activeControl.publicKeys.ed25519')" \
     --approve decline-all
```

Expected: `AUMLOK ADAPTER: GREEN`, `MUTATION ARMS: 5 run, 5 detected, 0 missed`, `AUMLOK SIGNER:
GREEN` and `AUMLOK MOUNT: GREEN`, exit 0. A missing mutation target is a failure, never a skip, and
the mount test refuses — never skips — when no release is available to boot.

`--expect-subject` and `--expect-control` must be given together: a pin names both facts, and half a
pin is a usage error rather than a refusal that a reader would misread as a bad record.

`--approve` accepts `test-all`, `decline-all` and `popup` (a same-uid native dialog that fails closed).
There is no default approver: a real decision procedure is supplied in code through
`createOwnerSigner`'s `review` option, because a flag is how an unconfigured signer silently approves.

## What none of this does

No private key is printed or returned, and no `identityBound` path exists. `bind` is the exception to
"disposable": it writes the owner's own controller and keeps this machine's key at a fixed location
(`machine-seed-v3.json` at 0600 by default; optionally the Keychain service `aukora-aumlok-machine-v3`,
whose write passes the seed JSON on `/usr/bin/security`'s argv, where same-uid process listings can see
it). The `test-all` approver is labelled `NOT a human review`. The signer prints
`OWNER_KEY_SAME_UID: true` and `SIGNER_DEVICE_TRUSTED: not-established` on startup, and every verified
approval receipt carries them. `PROVENANCE.md` §4 cites `archive/research/UNOWNABLE-CORE.md` (a Deep file
not carried in this repository) for placing the `identityBound` milestone behind the observer-succession
court, which is `UNMEASURED`; `bind` exists and derives from the phrase while `identityBound` stays
`false`.
