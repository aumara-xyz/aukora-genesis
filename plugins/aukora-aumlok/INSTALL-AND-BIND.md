# Install and bind — the runbook for the acceptance

**Rewritten 2026-09-23 for AUMLOK v3 by the Aumlok v3 lane.** This is the short installation runbook;
the internal ceremony rebuild handoff is not published.

**READ THIS FIRST (corrected 2026-09-26).** As of 2026-09-23, before the first real approval, the
running release did not carry v3. Releases materialized since do; which one a machine is serving cannot be read from this repository, so
run §1's checks to learn what the serving release carries. An installed app bundle built before a v3
release was materialized still shows the v2 window this file no longer describes.

**THE ACCEPTANCE IS PETER'S CLICK.** No court substitutes for it, nothing in this lane claims a person
attended anything, and `ATTENDANCE` stays `reported-not-proven` until it happens.

---

## 1. Three preconditions, and how to check each one

The app is not one artifact. A launch needs all three, and **two of them are not in the app bundle**.

| # | piece | where | check |
|---|---|---|---|
| 1 | the **shell** (app bundle) | `apps/aukora-desktop/dist/mac-arm64/AUKORA.app` | the approval files are packed, the ceremony ones are NOT (§5) |
| 2 | the **Aumlok face** | `plugins/aukora-face/aumlok/lib/client.js` | committed, `cmp` against the release's copy |
| 3 | the **RELEASE** the shell serves | newest `aukora-release-*` | it carries the v3 organ, and no v2 core |

The shell picks its release the way `apps/aukora-desktop/resolve.mjs` does: `AUKORA_DESKTOP_RELEASE`,
else `release` in the shell's `config.json`, else the `aukora-release-*` whose record is **newest by
mtime**. So a stale release is not a missing piece — it is a piece that wins silently. Read the release
from the shell's own launch output (§2); `ls | tail -1` sorts by name and can name a different one. Set
`R` to that path:

```sh
R=<the release the shell's patch line names>; echo "serving $R"
for m in derive-v3.mjs record-v3.mjs store.mjs; do
  printf '%-18s %s\n' "$m" "$(test -f $R/plugins/aukora-aumlok/lib/$m && echo present || echo MISSING)"
done
# the v2 core must be ABSENT -- if any of these exists, the release predates the nuke
for m in custody.mjs owner-record.mjs phrase-change.mjs; do
  test -e $R/plugins/aukora-aumlok/lib/$m && echo "STALE: $m is still there"
done
cmp $R/plugins/aukora-face-aumlok/lib/client.js plugins/aukora-face/aumlok/lib/client.js && echo face-IDENTICAL
```

**THE RELEASE'S LAYOUT IS FLATTENED:** `plugins/aukora-face-aumlok/lib/client.js`, **not**
`plugins/aukora-face/aumlok/…`. Searching the source layout returns nothing and `cmp` against a
missing file reads as *differs* — which produced a false "stale face" finding once already.

## 2. Launch, and what a healthy start looks like

```sh
U=$(mktemp -d)
( exec env AUKORA_DESKTOP_USERDATA="$U" AUKORA_DESKTOP_NO_DIALOG=1 \
    apps/aukora-desktop/dist/mac-arm64/AUKORA.app/Contents/MacOS/AUKORA ) | tee /tmp/launch.log
```

Lines this shell actually prints, read out of its own source rather than remembered:

    aukora-desktop: composition patch from the release …
    aukora-desktop: eye: listening on http://127.0.0.1:<port>/eye/capture
    aukora-desktop: window loaded http://127.0.0.1:<port>

**READ THE PATCH LINE FIRST.** If it names a release other than the one you meant to serve, stop: the
plugin being exercised is that release's, and none of this work is in it.

**AND READ THE SIGNER LINE.** On a bound machine a healthy start serves the signer socket. A refusal
names its cause, for example `aumlok:no-seed` (no machine key kept) or `aumlok:signer-organ-not-v3`. An
app bundle built before 2026-09-23 19:41 may still print
`aumlok:signer-server-not-implemented`; rebuild it from a current release. What would be a fault is
`library.<name> is not a function` for a v2 organ function the nuke removed — a raw TypeError, which
is what this code said before it was taught to refuse by name.

Two isolation seams make this safe on a machine in use: `AUKORA_DESKTOP_USERDATA` (set before anything
reads `userData`) and `AUKORA_DESKTOP_NO_DIALOG` (suppresses the modal that would block on a click).

## 3. Stopping it, and the mistake that bit twice

**`$!` IS NOT THE APP'S PID.** The `AUKORA` binary re-execs, so killing the pid your shell captured
leaves the real process — an `AUKORA` still holding the eye port — alive. Find it by PORT:

```sh
APP=$(lsof -nP -iTCP:<eye port> -sTCP:LISTEN -t | head -1); kill -TERM "$APP"
```

Kill the **app** first: its quit handler stops the backend it spawned. Then confirm:

```sh
lsof -nP -iTCP:<eye port> -iTCP:<backend port> -sTCP:LISTEN   # expect empty
pgrep -f aukora-release-                                 # expect empty
```

## 4. What Peter should see, and what each refusal means

**ON THE AUMLOK SCREEN, INSIDE THE FACE. THERE IS NO SEPARATE WINDOW.** v2 opened a second native
window for this; v3 does not, and nothing in the app can open one.

1. **The words, once.** The app GENERATES seven words from real entropy and shows them ONCE on the
   Aumlok screen. They are shown once and written nowhere: you are the only copy, and that is the
   point of the ritual rather than an inconvenience of it.
2. **Type them back.** Binding is the handle plus the same seven words typed back (`bindV3` refuses
   `aumlok:kdf-handle-absent` without the handle). Case, spaces, underscores and dashes in the words do
   not matter — `normalizePhrase` folds them. A wrong answer gets one content-free refusal and writes
   nothing.
3. **That is also the way back.** The same handle and the same seven words derive the same root on any
   machine; together they are the identity and the way back. A machine you have bound once keeps a
   MACHINE key (`machine-seed-v3.json` at mode 0600 by default; a macOS Keychain custodian is optional)
   and never the root. Approvals are signed with the machine key, and root-class acts re-derive the root
   from the handle and the words.
4. **The one-bit approval window.** When an operation needs your consent, a small modal names the
   identity, the operation digest, the challenge and the window, and asks you to Approve or Refuse. It
   draws no words and asks for none. Approve signs exactly those bytes; Refuse signs nothing.

| what you see | what it means |
|---|---|
| `aumlok:approval-directory-unknown` | no composition patch declares the controller directory, so nothing can be written |
| `aumlok:approval-library-unavailable` | the release you are serving does not carry the v3 organ |
| `aumlok:approval-window-already-open` | one question is already on screen; answer it first |
| `aumlok:approval-sender-not-the-application` | a message arrived from something that is not the app — refused by name |
| `aumlok:signer-organ-not-v3` | the release's organ exports no v3 signing function; see §5 |
| `aumlok:signer-server-not-implemented` | the installed app bundle predates 2026-09-23 19:41 (`5d5368f19`) and has no signer server; rebuild the app from a current release |

**THE SAME-UID CEILING, STATED PLAINLY.** The kept MACHINE seed and the approval window are protected by
POSIX file modes and by the window being modal — `same-uid-posix-mode-only`. A process running as this
same user can read the machine seed and can bypass the dialog entirely, so the approval window raises
what a person can SEE; it does not lower what an attacker who already runs as this UID can DO. The
approval receipt's ceilings say `OWNER_KEY_SAME_UID` for that reason.

## 5. What is deliberately NOT done

- **As of 2026-09-23 the running release carried none of this.** Nothing on the screen changes until a
  release is materialized from this tree and the bundle is rebuilt from that release; §1's checks are how
  you tell which you are looking at.
- **The face court is green:** `tests/aukora-face-aumlok-control.test.mjs`, 36/36 (plain run,
  2026-09-26, at `674fae6bf`); it is a plain CI step.
- **The shell signs approvals on a bound machine** with the machine key over a local socket
  (`apps/aukora-desktop/aumlok-signer.mjs`; court: `tests/aukora-approval-roundtrip.test.mjs`). An
  installed bundle built before 2026-09-23 19:41 still lacks it.
- **Step 6** (retire `state/controller`, repoint the Kira overlay) happens on the **first real binding**,
  not before.
- **Nothing here is proven on a screen.** Every claim above is read out of this tree's source or
  measured by a court; none of it is a claim about what the installed app shows today, because the
  installed app does not carry it.
