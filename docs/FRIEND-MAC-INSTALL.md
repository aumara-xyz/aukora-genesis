# Friend preview on a Mac

A normal macOS account can install AUKORA from a clone, open it, and bind Aumlok locally. That bind is a software key in your account. It is a preview for reading the app and approving local demo steps. It is not the owner's Airlock.

Nobody has run this on a clean Mac from this change. Treat every launch step below as the path the scripts implement. A live open on your Mac is still yours to confirm.

Alpha R1–R3 custody (separate-UID proof store, commit SSH outside the app account) is open. This install leaves those switches off.

## What works here

- Clone, build, and open an unsigned app.
- First launch with no plugin-set approval yet: the shell waives that check once so you can link a phrase. The waiver is not saved.
- Aumlok: the app shows seven words once. You type them back. The machine key lands in `~/Library/Application Support/AUKORA/state/aumlok`. Approve in the app signs with that key.
- Gatekeeper steps for the unsigned app.

## What stays on the owner's Mac

These stop with a named refusal. The friend profile does not imitate Airlock.

| Action | Refusal |
|---|---|
| Airlock (`/etc/aukora/owner-daemon.json`, second macOS account) | `friend-preview:owner-only-airlock` or `airlock:config-refused` |
| Commit SSH (`AUKORA_REQUIRE_COMMIT_SSH`) | `friend-preview:owner-only-commit-ssh` |
| Proof store / issuer UID (`AUKORA_COMMIT_BIND_PROOF_UID`, including a 602 pin) | `friend-preview:owner-only-proof-dir` |
| `scripts/aukora/self-change.mjs` | `friend-preview:owner-only-self-change` |
| `scripts/aukora/become.mjs` | `friend-preview:owner-only-become` |
| `scripts/aukora/advance.mjs` | `friend-preview:owner-only-advance` |

Also still the owner's, and not in this install: his support folder, API keys, Aumlok words, approved plugin set, memories, voice weights, OpenViking, and `scripts/aukora/cut-release.sh` (it requires his `--support` copy and a home session).

If a file is already at `/etc/aukora/owner-daemon.json` and this account cannot trust it, local Aumlok stays closed. The signer logs `airlock:config-refused` and the sentence from `friend-preview:airlock-config-untrusted`. Repair that file on the owner machine, or remove it when this Mac is a friend preview. Copying the owner's Airlock config here does not create Airlock.

## Install

You need macOS, Xcode Command Line Tools (`xcode-select --install`), Node.js 22.23.0 or newer, pnpm 11.7.0 or newer (`corepack enable`), python3, perl, git, 10 GB free, and a network. There is no GitHub release binary.

```sh
git clone https://github.com/aumara-xyz/aukora-genesis
cd aukora-genesis
scripts/install-mac.sh --dry-run
scripts/install-mac.sh
```

`install-mac.sh` builds the pinned harness, materializes `~/aukora-release-<commit>`, and packages an unsigned app (`electron-builder --mac dir`, `"identity": null`). Full build time on a new Mac is not measured here.

It writes your support folder at `~/Library/Application Support/AUKORA` (the folder the app opens). It records `"repo"` and `"profile": "friend-preview"` in `config.json`, and `friend-preview.json` beside it. It creates `state/aumlok` at mode 0700. It does not set `allowUnapproved` to true. It does not set `AUKORA_REQUIRE_COMMIT_SSH` or `AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID`.

When an owner Airlock config is already trusted, the script leaves that profile alone and does not write the friend marker.

Open:

```sh
cd apps/aukora-desktop && npm start
```

The launch log includes a `FRIEND PREVIEW:` line when the profile is set.

On the Aumlok screen: write down the seven words, then type them back. They are the whole key and they are shown once. Losing them means a new phrase and a new instance. The words are short (about 34 bits at the weakest anchor) and can be guessed offline. The machine key file is mode 0600. Any process running as you can read it. A click is recorded. Attendance is not proven.

Then add your own model API key under Models. It is stored in `state/home/.credentials.yaml`.

## Gatekeeper

The packaged app is unsigned. A copy you built inside the clone is usually not quarantined. A zip from another Mac, a browser, or AirDrop is.

When Finder says the developer cannot be verified:

```sh
xattr -dr com.apple.quarantine /path/to/AUKORA.app
```

Then right-click `AUKORA.app`, choose Open, and confirm Open. Leave Gatekeeper on for the rest of the machine.

`scripts/friend-mac-pack.sh --explain` prints this. `scripts/friend-mac-pack.sh` with no arguments builds an unsigned zip on macOS only (`CSC_IDENTITY_AUTO_DISCOVERY=false`). On any other host it exits `friend-pack:not-darwin`.

## Known gaps

- A zip by itself cannot launch. The shell refuses `repo-not-configured` until `config.json` names a Genesis clone, because the launcher checks the release against that checkout. `install-mac.sh` writes the path. A friend who receives only the zip still needs the clone.
- `npm start` from `apps/aukora-desktop` is the open path this repo already uses. The `.app` under `apps/aukora-desktop/dist/` uses the same config once `repo` is set.
- Plugin-set approval after the first launch is optional and local: `node scripts/aukora/plugin-set.mjs approve --release ~/aukora-release-<commit>`. After that, changed plugin bytes need a new approval. Not run on a clean Mac from this change.
- Voice and OpenViking are separate, optional, and not part of this path. See `docs/RUNNING.md`.
- Same-uid ceiling: this preview is a procedure on one account. It is not a second account and not key isolation.
- Custody milestones R1–R3 are open. Nothing here closes them.

## Undo the friend profile on an owner machine

If this Mac is the owner's and `install-mac.sh` wrote the marker because no Airlock config was present, delete `~/Library/Application Support/AUKORA/friend-preview.json` and remove `"profile": "friend-preview"` from `config.json`. Owner actions follow the existing switches again, and those switches still default off.

## Check

```sh
node tests/aukora-friend-preview.test.mjs
```

That check uses a scratch directory. It does not open the app, mint a real phrase, or talk to an owner daemon.
