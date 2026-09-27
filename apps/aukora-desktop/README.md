# AUKORA desktop shell

A door onto the organism. In OWNED mode it starts one harness process against a state root it
claims, reads that process's authenticated URL out of its own private log, and shows it.
In ATTACH mode it shows a backend somebody else is running and starts nothing at all.

**It holds keys and adds capabilities the harness does not serve, all in OWNED mode only**
(corrected 2026-09-26; `main.mjs`'s own header still says otherwise):

1. On a bound machine it reads the kept machine seed and holds the machine signing key in memory.
   It signs approvals, Nostr bindings and SAS confirmations with it after a one-bit approval window.
2. On a first binding it draws the seven words, derives the root from them in its own process, and
   writes the controller record and the machine seed. The root is never written to disk.
3. A token-fenced loopback eye door that can photograph, snapshot, and click or type in its own
   window.
4. A token-fenced lane door that posts one message into a session.

What it keeps: the session cookie, in a persistent partition under `userData` (its persistence arm
runs only with `AUKORA_TEST_ELECTRON`, not in CI; the shell states the backend keeps accepting the
launch token until it restarts, which is not measured here). In
attach mode, `config.json` is rewritten once to drop a spent token. While it owns a backend, it
also keeps: one claim file in that state root, so a second shell cannot become a second writer;
the eye-door token (written to `<state>/eye/door.token`, although `eye.mjs`'s header says it is
never in a file); the lane-door token, port file and request ledger; the chained lane card ledger
and its head; and the approval-signer socket and its decision log. On a bound machine the machine
signing key is held in memory. A first binding writes the controller record and the machine seed
into the Aumlok directory the composition names, which need not be inside the state root.

## The two permissions it grants

The window denies every permission a page can ask for — camera, location,
notifications, clipboard reads, MIDI, USB, screen capture — with two exceptions. Both
apply only to the exact loopback origin the window loaded, whether this shell started
that backend or attached to it: the **microphone** (audio only, on requests), and
**clipboard write** (`clipboard-sanitized-write`). Clipboard reads stay denied. Auma
Live's voice channel captures the page's microphone and streams it to the local voice
process, so a blanket denial is a blanket denial of the voice app. By reading the
code (no court covers it), the permission CHECK handler at `main.mjs:362` passes
`details?.mediaTypes`, while Electron's check details carry the singular
`mediaType`, so a check for video from the app origin answers true; requests still
refuse video. A request that includes video is refused, and a
frame on any other origin is refused whatever it asks for.

## What it will not do

- It refuses to start a second backend against a state root whose recorded process is still alive
  (`state-root-in-use`, court-driven). It will start against any state root that config or
  `AUKORA_DESKTOP_STATE` names. The launcher refuses a recorded live root only for an unapproved
  preview (`state-root-is-live`, code only). The Aumlok directory and signer socket come from the
  composition and the environment and need not lie inside that root. No court asserts that it never
  touches another deployment's state.
- It never signals a process it did not spawn. There is no kill-by-port path: the
  listener on a port is not necessarily the process you started.
- It never edits a release, a composition patch, the materializer or a plugin.
- It never puts the token on a command line or in the window title. Attach mode accepts
  one through `AUKORA_DESKTOP_URL` or `config.json` (written 0600); owned mode reads it
  from its own `logs/server.log` (mode 0700). The backend accepts that token until it
  restarts.

## Running it

### From a fresh clone, first

No packaged app is distributed. `npm run dist` builds an unsigned bundle that still needs a Genesis checkout at the release's own commit (see 'Why a checkout is required today' below). From a clone, three things this repository does not carry have to exist first, and each fails loudly rather than silently if it does not:

```bash
# 1. The pinned harness. vendor/dsh is gitignored: it is built, not committed.
python3 scripts/build-dsh.py          # needs pnpm and network; minutes, not seconds

# 2. The faces are committed, built against that harness. Do NOT rebuild them on a fresh clone:
#    build-face.py run in another directory changes their bytes, and step 3 then refuses the dirty tree.

# 3. A release for the shell to run, and the shell's own dependencies.
python3 scripts/materialize-aukora-release.py --to ~/aukora-release-local
cd apps/aukora-desktop && npm ci && npm start
```

Prerequisites: node 22 (the CI pin is 22.23.0), python3, pnpm, and on macOS the Xcode
command line tools. `npm run dist` packages an app bundle into `dist/`; it is unsigned
(`identity: null`), so macOS will treat it as an unidentified developer.

### Once a release exists

With nothing configured the shell finds the newest
`aukora-release-*` on the machine, reads the Genesis commit that release records
about itself, prepares a private checkout pinned to exactly that commit under its
own user-data directory, and starts there. It writes a commented `config.json`
into that user-data directory on first run — beside the checkout's parent, not
inside the checkout — so a different release, repository or checkout
can be named later without touching the code.

Three ways to name the target, and two modes of ownership — discover is how the
**own** target gets chosen, not a third kind of relationship to the backend.
**Discover**, the default: run it with no environment at all.
**Own the process**, when the target is named:

```bash
AUKORA_DESKTOP_RELEASE=/path/to/aukora-release-<sha> \
AUKORA_DESKTOP_CHECKOUT=/path/to/checkout-at-<sha> \
npm start
```

**Attach** to an app that is already serving, spawning and stopping nothing:

```bash
AUKORA_DESKTOP_URL='http://127.0.0.1:3187/?token=…' npm start
```

Three settings have **no environment variable** and are reachable only through
`config.json`; they are marked below. An earlier version of this table listed them as
`AUKORA_DESKTOP_*` names and the launch example above set one of them, which did nothing —
nothing in `apps/aukora-desktop` reads those names.

| Variable | Meaning |
| --- | --- |
| `AUKORA_DESKTOP_RELEASE` | a materialized release directory |
| `AUKORA_DESKTOP_CHECKOUT` | a Genesis checkout **at the release's own commit** |
| `AUKORA_DESKTOP_STATE` | private state root; defaults to `<userData>/state` |
| `AUKORA_DESKTOP_PORT` | a port to ask for; one is chosen when absent |
| `patch` (config.json only) | comma-separated composition patch overlays |
| `approvedRecordSha` (config.json only) | comma-separated approved artifact record digests |
| `allowUnapproved` (config.json only) | **defaults to false** (template `resolve.mjs`). Only the boolean `true` permits: it launches a release with no approved record AND waives the AUKORA plugin set, so every AUKORA plugin loads without its approved record being enforced. The court for this (`tests/release-door.test.mjs`) runs nowhere |
| `AUKORA_DESKTOP_URL` | attach to this URL instead of starting anything; wins over `attachUrl` |
| `AUKORA_DESKTOP_USERDATA` | override the Electron user-data directory |

`config.json` keys: `attachUrl`, `release`, `repo` (a Genesis clone to prepare a pinned
checkout from), `checkout`, `stateRoot`, `nodePath`, `patch`, `approvedRecordSha`,
`allowUnapproved`, `searchRoots`.

### Two modes, and the difference is ownership

**Own** (the default): the shell starts a harness process, is responsible for it, and
stops it when the window quits. **Attach**: the shell shows a backend somebody else is
running, starts nothing, stops nothing, and leaves it running when the window closes.

A fresh owned window shows no threads and asks for an API key, and that is not a fault:
it has a **private state root**, and a state root is the whole organism — its own
workspaces, sessions, settings and credentials.

To show a Genesis that is already running, attach to it:

```json
{ "attachUrl": "http://127.0.0.1:3187/?token=…" }
```

`AUKORA_DESKTOP_URL` does the same for one run and wins over config. An attach target
short-circuits resolution entirely: no release is discovered, no checkout prepared, no
state root chosen. A named backend that cannot be loaded is **refused** — the shell
never falls back to starting one of its own, because an operator who pointed at a
specific deployment did not ask for a different application.

Two things to know before you use it. That URL carries the backend's token, so
`config.json` is written `0600` and should be treated as a secret. And **the frontend is
served by the backend**: attaching shows whatever interface that deployment serves. An
older deployment will show its older interface — attaching does not install this app's.

#### `stateRoot` is not attachment

A correction to earlier wording in this file. `stateRoot` **starts an owned backend**
against the directory you name. It does not attach to anything: a harness process is
spawned there exactly as it would be by default. Pointing it at a deployment that is
already running would put two writers on one set of storages, which is corruption and
not sharing — so the shell reads the launch record in that directory and **refuses when
the process in it is still alive**, naming the pid. Use it to run an owned backend
against data you keep somewhere else, with nothing else running against it. To show a
running deployment, use `attachUrl`.

The directory must be private, mode `0700`: the launcher writes the launch token into a
log inside it, and the shell refuses a wider directory rather than quietly narrowing one
somebody else may be able to read.

### Editing a face and seeing it, without rebuilding the world

Run end to end on 2026-09-20 against `aukora-release-dev-1a610ca`. Every number below was
measured on that run, including the part that does not work.

```bash
# 0. A development release, ONCE. The flag is what mounts the reload channel; a release
#    materialized without it cannot hot-reload no matter how it is marked afterwards.
python3 scripts/materialize-aukora-release.py --to ~/aukora-release-dev-<sha> --development

# 1. Edit one face's source, then build only that face.          measured: 4 seconds
#    Build a face together with any face it imports — aumlok imports @aukora/face-layout,
#    so `--only aumlok` alone fails to typecheck. `--only layout --only aumlok` works.
python3 scripts/build-face.py --only layout

# 2. Push the rebuilt bundle into a release marked as development.
python3 scripts/face-dev-push.py --release ~/aukora-release-dev-1a610ca --face layout

# 3. Reload the page.  Not optional — see below.
```

**Two things must be true of the release, and the second is not obvious.**

It must be marked development, and the marker lives BESIDE it — `<release>.development`,
never inside. `--development` writes that marker for you; `face-dev-push.py
--mark-development` marks a release you already have. The marker names the release's record
digest and the materializer clears it on every run, so a marker cannot outlive the build it
authorised and silently bless a packaged release later materialized at the same path. A marker inside the release is one more file, and `launch-dsh.py`
re-measures the tree against `strip-manifest.json` and refuses on any difference. Measured:
`strip-totals-mismatch: the tree holds 14929 file(s)/141946154 bytes but
strip-manifest.json records 14928/141945889` — a delta of exactly one file and 265 bytes,
which was the marker. Marking a release used to make it unlaunchable, which broke this loop
at step zero.

It must also be launched from **a Genesis checkout at the release's own commit**. The
launcher hands the release to `genesis-check.mjs`, and that script hashes the Genesis
artifacts against the tree IT lives in, not against the release — `genesisRoot` is
`new URL('../', import.meta.url)`. From the wrong branch the result is a twelve-line
integrity failure that reads like a tampered release and is not one. This is what
`AUKORA_DESKTOP_CHECKOUT` is for, and why it is documented as "a checkout **at the
release's own commit**".

**What the push does, and what it does not.** The server re-hashes its bundle set at once:
the combo `rev` moved `9d625d10947a` → `b8e01f579b0d` and the new token appeared in the
served bytes. An already-open page does **not** survive the swap. It requests the old rev,
takes two 404s, and throws `renderSlot('root') before any 'root' registration (boot
order)`. Measured in a browser: `navigations` stayed at 1 and `#root` went from 112718
bytes of markup to 0 — a blank window, with the app gone and nothing on screen saying why.
A reload brings it back, with the change. So the loop is edit → build → push → **reload**,
and `face-dev-push.py` now says so instead of promising a reload that does not happen.

**The checkpoint edit** is one line: `--dsw-specific-spatial-accent-center` in
`plugins/aukora-face/layout/src/client/spatial-tokens.css`. It touches no logic and the
bundler inlines it into `lib/client.js`, so it travels by this path. Measured round trip:
source `rgba(86, 134, 254, 0.28)` → edited to `rgba(254, 134, 86, 0.28)` → built
`#fe865647` → served `#fe865647` → visible in the
page's own stylesheets; then reverted, rebuilt, pushed, and `face-dev-push.py` reported
`skipped layout: unchanged`, which is the restoration proving itself.

**What this proves and what it does not.** It proves the source-to-screen loop: a file in
this repository is what the running window shows, and the distance is seconds. It proves
nothing about the backend, about governance, or about a packaged app. A packaged release
disables this channel: the materializer writes `client-hmr` `disabled: true`, so `/plugins/events`
is not served. Since the `client-hmr-events-auth` patch (`d72d5b807`), a development release's
channel also requires the app's cookie. The patch layer is court-checked (`aukora-patch-layer`), and
the 401 without a cookie was measured once live on 2026-09-22. Neither HTTP answer is court-driven.
Before the patch it answered 200 unauthenticated (measured 2026-09-20). The materializer's own
`--development` text still predates the patch.

**What it costs.** A bundle rewritten in place changes the strip totals the release records
about itself, so a pushed-to release is spent for relaunch until it is materialized again.

### What the window tells you

The title bar carries four facts: origin, ownership, release, and which frontend the page loaded:

```
AUKORA — http://127.0.0.1:52878 · owned by this window · release aukora-release-face @ 7dac99fb6ed0 · spatial frontend
AUKORA — http://127.0.0.1:3187 · attached · not owned by this window · release unknown to this window · frontend not yet known
```

The page cannot change it — `page-title-updated` is prevented — so that line is the
shell's, not the backend's. The **token never appears in it**, nor in the shell log, nor
in any dialog: every display path formats from `new URL(url).origin`, which structurally
cannot contain a query string. An attached backend's release is reported as unknown
rather than guessed, because finding out would mean reading a launch record out of
another deployment's private state root.

## Why a checkout is required today, and why that blocks distribution

`scripts/launch-dsh.py` verifies the release against the artifact record **using the
checkout it runs from**, so the checkout must sit at the release's own commit. A
downloaded app has no checkout at all. Two known blockers, both owned by the Lead
lane, stand between this shell and a build somebody else can run:

1. **Verification needs a checkout.** Either the release carries what the checker
   needs, or the shell ships a verifier that reads only release-local bytes.
2. **Organ rows (corrected 2026-09-26).** Organ rows are release-relative now
   (`./plugins/...`), and the launcher refuses a row outside the verified release
   (`patch-not-release-local`, court-driven by `aukora-launch-staging`). Nobody has
   measured a copied release mounting its organs on another machine, so this blocker
   is not recorded as closed. The default composition also still bakes the materializing
   machine's live DSH home into the subscription hands' `CODEX_HOME` and
   `CLAUDE_CONFIG_DIR` (and the organism row's `organismDshHome`). (A comment in the
   materializer still says the rows are absolute.)

Until both are closed, this shell runs on a machine that has a checkout and a
release. That is a real limit, not a packaging detail.

## Tests

```bash
AUKORA_TEST_RELEASE=/path/to/release AUKORA_TEST_CHECKOUT=/path/to/checkout \
  node --test tests/aukora-desktop-supervisor.test.mjs
```

Thirty-two arms: **27 run without a release, 4 need one, and 1 runs only under `--mutate`**
(that last arm removes the port wait and requires the launcher to be spawned into the held
port). The ungated ones cover
private mode on every directory, refusal to repair a loose state root, a free port
that is really free, the pid guard, discovery picking the newest record and
ignoring a directory without one, no release rather than a guess, a release that
records no commit being refused, a prepared checkout sitting exactly at the
release commit and staying there on a second call, a config file written once and
read back private, this shell re-entering its own claim, and a claim carrying our
pid but a stranger's instance still being refused.

The four gated on `AUKORA_TEST_RELEASE` are the ones that need a real release: a
launch that fails verification leaves no listener; a started harness reports a URL
the shell reads from its own log while the app refuses the unauthenticated root; a
started backend actually serves the AUKORA faces rather than the stock harness;
and a second start never returns the first URL. **They are skipped by default, and
a skipped arm has verified nothing** — run them with a release materialized from
the checkout you are on, or the launcher refuses it on a Genesis-artifact
mismatch that looks like tampering and is not.
