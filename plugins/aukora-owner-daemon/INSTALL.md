# THE OWNER DAEMON — INSTALL LAYOUT AND ENTRY POINT (for Alpha)

**Status: the daemon is built and courted by `tests/aukora-owner-protocol.test.mjs`, plain and with
`--mutate` on the front door. Its three two-uid courts skip with a named ceiling wherever the `aukora-owner`
account is absent or unreachable by `sudo -n` (every Mac today); they run with a real second uid only in
the Linux `owner-cut-linux` CI job.
INSTALL IS TWO PHASES — Phase A is `/bin/sh scripts/owner/setup-owner.sh --from .`, unprivileged, which
builds and verifies the bundle; Phase B is the BOOTSTRAP in §1b, a fixed ≤25-line block Peter reads and runs
under `sudo env -i`, which stages and verifies those exact bytes before any of them executes as root. It is
still NOT installed
anywhere: no LaunchDaemon exists and the `aukora-owner` account has not been created, because every command
needs sudo and Peter runs those. This file is the layout that script implements. The daemon checks at

## THE PLUGIN'S OWN LAYOUT, WHICH THIS FILE DID NOT DESCRIBE (row 46)

**MEASURED:** this file said it *"is the layout that script implements"* and then documented the INSTALLED layout —
the launchd plist, the state directory, the ledger — **while saying nothing about the plugin's own two
directories.** `aukora-kira` and `aukora-nostr` both name their `bin/` in their READMEs; this plugin has no README
at all, so there was nowhere the structure was written down. *A reader arriving at the directory could not tell
an entry point from a module.*

```
plugins/aukora-owner-daemon/
  bin/     TWO ENTRY POINTS. Both are launched by absolute path and neither is imported by anything.
             owner-daemon.mjs    the daemon: the launchd job's program, and the process after-install.mjs
                                 looks for by name (`pgrep -f owner-daemon.mjs`)
             owner-console.mjs   the operator's console
  lib/     TWELVE MODULES. None of them is run directly; `bin/` imports them.
             binding  boundary  client  detect  dispatch  is-main  journal
             listener  operations  owner-separation  settle-adapter  visible
```

**THE RULE, SO THE NEXT FILE KNOWS WHERE IT GOES:** *if it is launched, it is in `bin/`; if it is imported, it is
in `lib/`.* MEASURED at HEAD, no module in `lib/` imports from `bin/` — the dependency runs one way, entry points
to modules, and that is what makes the two directories mean something.

**AND WHERE THEY ARE NAMED:** `scripts/owner/setup-owner.sh:58-59` sets `ENTRY` and `CONSOLE` to these two paths,
and `scripts/owner/owner-closure.mjs` checks the closure from `bin/owner-daemon.mjs`. **If either file moves,
those three places move with it** — which is the reason to write the layout down rather than infer it.

start: the owner directory (`0700`), the key file (`0600`, inside the owner directory), the run directory
(`0750`, no group write) and the approve directory (`0700`), plus the trust of their ancestors. It sets the
socket and `owner.pub` modes itself. `setup-owner.sh` checks the installed-code, config and plist modes at
install time.

## 0. WHAT THE DAEMON DOES NOT DO YET — A NAMED CEILING

**PENDING PROPOSALS DO NOT SURVIVE A RESTART.** The proposal store is **in memory and per daemon**, so a
restart empties it: a proposal that was frozen and not yet approved is **gone**, and the agent resubmits it.

**NOTHING IS APPROVED OR CONSUMED BY THE LOSS**, which is why this is acceptable for now. No approval existed,
no effect ran, no nonce was spent — **the worst outcome is that the owner is asked again about work nobody had
decided yet.**

**WHAT IS *NOT* LOST IS ANYTHING THAT WAS DECIDED.** A settled nonce lives in the journal, and the owner
recovers its result with **`result <nonce>` on `approve.sock`** — a read-only op that never settles anything, so
a grant signed and lost before delivery can still be handed back. The replay of a spent approval still answers
`APPROVAL_SPENT`, deliberately: **that refusal is what stops one approval writing two memories, and recovering a
result must not weaken it.**

**THE MATERIAL TO RESTORE PENDING PROPOSALS IS NOT ON DISK (corrected 2026-09-26).** The journal records
the complete frozen proposal once the owner approves it, so an in-flight settlement can be finished or refused
after a crash. Pending (unapproved) proposals are not journaled. Restoring them would need a journal write at
submit time, which does not exist.

## 1. The account (Peter only — it needs sudo)

    sudo sysadminctl -addUser aukora-owner -shell /usr/bin/false -home /private/var/empty
    sudo dseditgroup -o create -n . aukora-submit          # the submit group
    sudo dseditgroup -o edit -a <peter's short name> -t user aukora-submit

`aukora-owner` gets no shell and its authentication is disabled, and neither account is an administrator: its
only job is to run one daemon and answer one console. That is a statement about the ACCOUNT, not a claim that
the boundary is unbreakable — Peter is an administrator, so Peter can become root with sudo, and so can any
agent process that can use Peter's sudo authority. See §6 for the wording that must be used whenever this cut
is described.

## 1b. TWO PHASES FOR PETER — AND WHY THE RUN DIRECTORY MOVED (Alpha, 2026-09-25; restructured after Codex's review)

    /bin/sh scripts/owner/setup-owner.sh --from .            # PHASE A, unprivileged: builds and verifies the
                                                             # bundle, prints THE BUNDLE DIGEST + the reviewed
                                                             # commit + the digest of the script, changes nothing

Then Phase B, and **this is the whole of it** — read it before you run it, because it is the only part that
runs as root and the only part you have to trust. Peter runs exactly one command:

    sudo env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin /bin/bash

and pastes the block below as its input. So the copying and hashing tools run in the same clean environment
Phase B gets, and nothing from the checkout runs as root: the script and the bundle are staged into a fresh
root-owned `0700` directory, both digests are compared against the two numbers from the CI log line, and only
the STAGED copy is executed. Fill in the four values — the **commit and both digests come from the CI log
line**, never from Phase A's output, because Phase A's output is written by the same uid that can write the
checkout.

```sh
# ── THE BOOTSTRAP. Peter runs ONE command, and this block is its stdin: `sudo env -i
#    PATH=/usr/bin:/bin:/usr/sbin:/sbin /bin/bash` — the clean environment Phase B gets, and only the STAGED
#    copy runs as root. The owner check below reads the uid RUNNING this, which the gate has already made 0.
set -eu
SRC="$(/bin/pwd)"                                # the checkout you cloned and reviewed
BUNDLE="<bundle dir>"                            # the bundle directory PHASE A printed
SHA="<commit>"                                   # the REVIEWED COMMIT — from the CI log line
WANT_SCRIPT="<script digest>"                    # sha256 of setup-owner.sh — from the CI log line
WANT_BUNDLE="<bundle digest>"                    # OWNER BUNDLE DIGEST — from the CI log line
P=/private/var/root                              # FIXED. This is never taken from the environment.
AGENT="$(/usr/bin/stat -f '%Su' "$SRC")"               # the unprivileged human: whoever owns the checkout
[ "$(/usr/bin/id -u)" = 0 ] || { echo "REFUSED: run this under sudo — it installs root-owned code"; exit 2; }
c=""; for s in $(printf '%s' "$P" | /usr/bin/tr '/' ' '); do c="$c/$s"; [ -L "$c" ] && { echo "REFUSED: $c is a symlink"; exit 2; }; done
[ "$(/usr/bin/stat -f '%u' "$P")" = "$(/usr/bin/id -u)" ] || { echo "REFUSED: $P is not owned by root"; exit 2; }; n="$(/usr/bin/stat -f '%Lp' "$P")"; case "${n#?}" in *[2367]*) echo "REFUSED: $P is $n, writable by group or other"; exit 2;; esac
[ -z "$(/bin/ls -led "$P" | /usr/bin/grep -E '^ *[0-9]+: ' || true)" ] || { echo "REFUSED: $P carries an ACL"; exit 2; }
q="$P"; while [ "$q" != / ]; do q="$(/usr/bin/dirname "$q")"; u="$(/usr/bin/stat -f '%u' "$q")"; { [ "$u" = 0 ] || [ "$u" = "$(/usr/bin/id -u)" ]; } || { echo "REFUSED: ancestor $q is owned by uid $u, not root"; exit 2; }; n="$(/usr/bin/stat -f '%Lp' "$q")"; case "${n#?}" in *[2367]*) echo "REFUSED: ancestor $q is $n, writable by group or other"; exit 2;; esac; a="$(/bin/ls -led "$q" | /usr/bin/grep -E '^ *[0-9]+: ' || true)"; [ -z "$a" ] || { echo "REFUSED: ancestor $q carries an ACL: $a"; exit 2; }; done
STAGE="$(/usr/bin/mktemp -d "$P/aukora-bootstrap.XXXXXX")"
/bin/chmod 0700 "$STAGE"
/usr/bin/install -m 0755 "$SRC/scripts/owner/setup-owner.sh" "$STAGE/setup-owner.sh"
/bin/cp -RP "$BUNDLE" "$STAGE/bundle"
digest() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'; }
[ "$(digest "$STAGE/setup-owner.sh")" = "$WANT_SCRIPT" ] || { echo "REFUSED: the staged script is not the one CI hashed"; exit 2; }; [ "$(digest "$STAGE/bundle/payload/MANIFEST.sha256")" = "$WANT_BUNDLE" ] || { echo "REFUSED: the staged bundle is not the one CI hashed"; exit 2; }
set -- --bundle "$STAGE/bundle" --bundle-digest "$WANT_BUNDLE" --sha "$SHA" --script-sha256 "$WANT_SCRIPT" --from "$SRC" --agent-user "$AGENT"
exec /bin/bash "$STAGE/setup-owner.sh" phase-b "$@"
```

Four checks stand between the paste and the copy, and they are the reason the staging directory can be
trusted as a place to verify in: the staging parent is **fixed in the text** (`P=/private/var/root`, never
read from the environment), it must be **owned by root** (the uid running this, which `sudo` makes 0), it
must be **writable by nobody but root — the same rule, in the same words, that every ancestor below must
satisfy**, it must carry **no ACL** (`ls -led`, the directory's own), and **no component of it may be
a symlink**. Then the script and the bundle are staged, and both digests are compared against the two numbers
from the CI log line — including the commit, which is read from that same line and never from Phase A's
output. A mismatch refuses before anything executes.

**WHY NOT `0700` (corrected 2026-09-25, MEASURED):** this block used to demand mode `700` of the parent,
and `/private/var/root` — the parent it names — is **`0755 root:wheel`** on a stock macOS install
(`stat -f '%Lp' /private/var/root` → `755`). The check therefore refused on its own first line, before it
could stage anything, so Peter's paste could never work at all. The property that actually matters is that
**no principal other than root can add, rename or remove an entry in the parent**, because that is what
would let the verified copy be swapped after it was verified; `0755` grants group and other `r-x` and no
write, so it is safe, and `0775` or `0777` are not. A tighter mode buys nothing here and costs the install.

`cp -RP` is deliberate: `-P` stops `cp` from following symlinks, and Phase B refuses any non-regular entry
in the staged bundle before it verifies anything, because a hash follows a link to whatever it points at.

`--from "$SRC"` is load-bearing and was missing in the first draft: the staged script derives the checkout
from its own location, so without it Phase B looked for the courts under the staging root (MEASURED: "no
tests/aukora-owner-protocol.test.mjs under /private/tmp — the courts were NOT run"). The install would have
completed while the closing line claimed the courts ran.

**The court cannot be root, and it says what that costs.** `tests/aukora-owner-bootstrap.test.mjs` runs this
exact text under `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin /bin/bash` at an unprivileged uid, so the root
gate is exercised for real (it refuses), and the staging and digest checks are exercised with that one gate
removed and the parent literal pointed at a directory this uid owns. What that does NOT measure is sudo's
own half: root ownership of the real staging parent, the accounts, launchd, and the kernel refusal on
`approve.sock`.

**WHY TWO PHASES: NO AGENT-WRITABLE CODE EVER RUNS AS ROOT.** Phase A is where every read, computation and
interpretation of agent-authored bytes happens — it runs the checkout's closure tool **as Peter**, downloads
the pinned interpreter from nodejs.org and verifies it against the `SHASUMS256.txt` that travels inside the
bundle, extracts `bin/node`, runs it once as Peter to check its version, and writes a manifest with every
file's sha256 plus one bundle digest. Phase B re-execs itself under `env -i` with
`PATH=/usr/bin:/bin:/usr/sbin:/sbin`, uses only trusted system tools **by absolute path**, stages into a fresh
`0700` directory under a root-owned parent, verifies every file against the manifest, refuses any file the
manifest does not list, and moves the tree into place only then. The interpreter is executed again after it is
root-owned in place, and only to compare its version with the version recorded in the bundle. All four of
`--bundle`, `--bundle-digest`, `--sha` and `--script-sha256` are **required**: a digest this script defaulted
would confirm nothing. Compare both digests with the reviewed revision before running Phase B.

**WHAT THE BUNDLE DIGEST DOES AND DOES NOT COVER, because the bootstrap checks both numbers.** It covers the
bundle's `payload/` — the import closure, `REVISION`, `NODE-VERSION`, `NODE-SHASUMS256.txt` and the recorded
runtime-loading ceiling. It does NOT cover `interpreter/node`: that binary differs per platform, so putting it
inside the digest would make two builders of one commit print different numbers. The interpreter is verified
instead against the platform's line in the pinned official list, and that check travels with the payload:
Phase A checks the ARCHIVE's sha256 against `payload/NODE-SHASUMS256.txt` (inside the digest) and runs the
extracted binary once, as the agent, to read its version; Phase B extracts its own copy from that same
archive, checks the archive against the same payload list, and compares the binary's **reported version** with
`payload/NODE-VERSION`. The bundle's `interpreter/node` and `build-info.txt` are build records beside the
payload — **neither is consulted by Phase B**, because neither is inside the digest and nothing outside the
digest decides what root executes.

**`--prefix <dir>`** runs the Phase B procedure unprivileged under a temporary root: bundle verification,
file layout, modes and the courts. It prints the parts it cannot perform (ownership, accounts, the loaded
service, the kernel refusal on `approve.sock`, a root-owned staging parent) as `CEILING` lines. No court yet
drives a successful prefix run; the fake-root court covers Phase B itself against stubs.

**`/private/var/run` IS EMPTIED AT EVERY BOOT**, so the layout below cannot live there: the daemon runs as
`aukora-owner` and cannot recreate a directory under the root-owned `/private/var`. A run directory inside
the owner's home does not work either — the home is `0700 aukora-owner:aukora-owner` by rule, so the AGENT
could not traverse it to reach `submit.sock`. The run root is therefore persistent, root-owned and
traversable, with the same three rules inside it:

| path | owner:group | mode | why |
|---|---|---|---|
| `/Library/Application Support/AUKORA-Run/` | `root:wheel` | `0755` | persistent, traversable, not world-writable |
| `…/AUKORA-Run/` | `aukora-owner:aukora-submit` | `0750` | what `assertRunDirectory` checks; `submit.sock` lives here |
| `…/AUKORA-Run/submit.sock` | | `0660` | the agent submits here |
| `…/AUKORA-Run/owner.pub` | `aukora-owner:aukora-submit` | `0640` | **THE PUBLIC KEY, PUBLISHED WHERE THE AGENT CAN READ IT** — written by the daemon on start; the detector derives this path from the config's `runDir`, and the `0750` run directory is what makes the group bits apply (courted). If a config names no `runDir`, the detector falls back to the owner-directory path, which the agent cannot traverse, and reports `unreachable` (`detect.mjs:141`); the daemon itself refuses a config without `runDir` |
| `…/AUKORA-Run/owner/` | `aukora-owner:aukora-owner` | `0700` | **THE BOUNDARY** — an agent-uid connect is designed to fail `EACCES` in the kernel. Measured with a real second uid on the Linux CI runner, and on macOS by a same-uid directory-mode proxy; not measured on an installed macOS layout |
| `…/AUKORA-Run/owner/approve.sock` | | `0600` | the owner console answers here — role from WHICH SOCKET ACCEPTED |

## 2. Directories, and the three different rules

| path | owner:group | mode | why |
|---|---|---|---|
| `/Library/Application Support/AUKORA-Owner/` | `aukora-owner:aukora-owner` | `0700` | keys, journal, witness — nobody else, ever |
| `…/AUKORA-Owner/owner.key` | `aukora-owner` | `0600` | generated on first start; **never** imported from Peter's real Aumlok root |
| see §1b | | | the run root moved off `/private/var/run`; `setup-owner.sh` creates all of it |

**THE ROLE COMES FROM WHICH SOCKET ACCEPTED, NOT FROM A PEER-CREDENTIAL CHECK.** The daemon does not read
`getpeereid`/`LOCAL_PEERCRED` (measured at `012580e4`): `submit.sock` is reachable by the agent because the
run root is `0750 aukora-owner:aukora-submit`, and `approve.sock` sits behind a `0700` directory the agent
cannot traverse, so an agent connect to it fails `EACCES` in the kernel before the daemon sees a byte. The
separation is filesystem permissions, which is why the modes above are not decoration.
| `/usr/local/libexec/aukora-owner/` | `root:wheel` | `0755` | the INSTALLED CODE — root-owned, **not** the checkout |

**The run directory is `0750` on purpose and the daemon's first version wrongly demanded `0700` of it** —
which made it refuse to start on this very layout. The rules live in `lib/boundary.mjs`
(`assertPrivateDirectory`, `assertRunBoundary`, `assertTrustedAncestors`); `bin/owner-daemon.mjs` delegates to
them, adding only existence, type and owner checks for the run directory.

The daemon also refuses to start if **any ancestor of the owner directory is owned by anyone other than root
or the daemon's uid, is group- or world-writable, or carries an ACE granting write to another principal**
(courted in `tests/aukora-owner-boundary.test.mjs`): a directory you cannot write is still one somebody else
can RENAME if they can write its parent.

## 3. Install the code, root-owned

**PHASE B INSTALLS THE CODE — THERE IS NO MANUAL COPY STEP, AND DO NOT ADD ONE.** An earlier revision of this
page told the reader to `sudo install -d` and `sudo cp -R` the daemon into place by hand. That is the same
root-owned install Phase B performs, except that it puts bytes under a root path with nothing having verified
them: no manifest, no digest, no refusal when the tree does not match the reviewed commit. Phase B stages the
bundle, verifies every file against the manifest, and moves the tree into place only then.

The shape it produces — exactly the manifest's files, plus `MANIFEST.sha256` and `bin/node`:

    /usr/local/libexec/aukora-owner/    root:wheel   0755

It runs from `/usr/local/libexec/aukora-owner`, never from the agent's checkout — a daemon that loaded its
code from a directory the agent can write is a daemon the agent can rewrite.

## 4. Config and the LaunchDaemon

`/usr/local/etc/aukora-owner.json` (root-owned `0644`):

    { "ownerDir": "/Library/Application Support/AUKORA-Owner",
      "runDir": "/Library/Application Support/AUKORA-Run",
      "submitSocket": "/Library/Application Support/AUKORA-Run/submit.sock",
      "approveSocket": "/Library/Application Support/AUKORA-Run/owner/approve.sock",
      "keyFile": "/Library/Application Support/AUKORA-Owner/owner.key" }

`scripts/owner/setup-owner.sh` writes this file (root:wheel `0644`) and the plist below from measured
paths — do not hand-edit either; re-run the script instead, which verifies every step it takes, prints the
modes, prints the daemon's own first answer through the owner console, and runs
`tests/aukora-owner-protocol.test.mjs` (the three two-uid arms) now that the second uid exists.

**`0644` IS A REQUIREMENT, NOT A DEFAULT (R5).** The AGENT reads this file: the key's path is derived from
its `runDir`, so an app that cannot read the config cannot find the key and answers `absent` forever. `0644`
is therefore checked in two halves — the file needs `o+r`, and **every component above it needs `o+x`** —
because the installer's other path rules refuse group/other *write* and a `0750 /usr/local/etc` would pass
all of them while leaving the agent unable to traverse to the file. If either half fails, Phase B refuses by
name and prints the `chmod` that fixes it, rather than installing a daemon nobody can detect.

**THE SETTLEMENT RECORD IS KEPT BY DEFAULT.** `scripts/owner/teardown-owner.sh` removes the service, the
plist, the installed code, the config and the run root, and leaves `/Library/Application Support/AUKORA-Owner`
(keys, journal, witness, marks) exactly where it is. Destroying it takes `--delete-settlement-record` AND
typing the path at a prompt; every `rm -rf` in that script compares its argument to an exact literal first.
**It is root code like everything else here, so it is run the same way §1b runs Phase B — from a root-owned
staged copy of the reviewed revision, never from the agent's checkout.**

`/Library/LaunchDaemons/com.aukora.owner.plist` (root-owned **`0644`**), written by `setup-owner.sh`, entry point:

    ProgramArguments = [<absolute node>,
                        "/usr/local/libexec/aukora-owner/plugins/aukora-owner-daemon/bin/owner-daemon.mjs",
                        "/usr/local/etc/aukora-owner.json"]

(The plist also sets `GroupName`, `Umask`, `WorkingDirectory`, log paths and `PATH`; the source of truth is
`scripts/owner/setup-owner.sh`, about :1022-1048, not this excerpt.)
    UserName        = "aukora-owner"
    RunAtLoad       = true
    KeepAlive       = true
    EnvironmentVariables = { AUKORA_OWNER_CONFIG = "/usr/local/etc/aukora-owner.json" }

`UserName=aukora-owner` is what makes it the owner in production; **nothing in the process asks who it is**,
which is why the whole cut is testable as one uid.

## 5. The owner console

    sudo -u aukora-owner /usr/local/libexec/aukora-owner/bin/node \
      /usr/local/libexec/aukora-owner/plugins/aukora-owner-daemon/bin/owner-console.mjs \
      --config /usr/local/etc/aukora-owner.json list
    … … approve <nonce>
    … … decline <nonce>

The interpreter is named by ABSOLUTE PATH inside the install, never `node` from `PATH`: the daemon's copy is
root-owned and digest-recorded, while a `PATH` lookup would find whatever the caller's environment happens to
name — which for an agent-authored shell is agent-writable code. (Codex, 2026-09-25.)

With a real second uid (measured on the Linux CI runner, not on an installed macOS layout), the agent cannot
read the owner key or write in the owner directory. That is a filesystem-permission property, and `sudo`
remains a path around it. **A `--socket` flag pointing
anywhere else is how a court runs it; it is not how a person should.**

## 6. What the README MUST say until an independent approval path exists

**"This isolates the unprivileged agent process through filesystem permissions. Peter remains an
administrator and can become root using sudo. Any agent process with usable sudo authority can cross this
boundary. Shell-console approval is not independent proof of human consent."**

The console is the owner uid answering on a terminal — it is not proof that a person read anything.
A phone approval (a kind-30333 event verified against the owner-enrolled pin) is wired as its own daemon
path and courted (`tests/aukora-owner-phone.test.mjs`). `createApprovalChannel` is a slot that nothing in the
daemon calls yet. Touch ID and FIDO2 are designed (a comment in `binding.mjs`) and not built. Until one of
these is enrolled and measured on an installed machine, no claim above "the agent cannot read the keys or rewrite the
journal" is earned — and that claim is about filesystem permissions, not about `sudo`, which remains a root
path around every one of them.
