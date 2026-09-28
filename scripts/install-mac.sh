#!/bin/sh
# install-mac.sh — ONE COMMAND from a clone to a running AUKORA on a friend's Mac.
#
#   scripts/install-mac.sh              check everything, then build and say how to open it
#   scripts/install-mac.sh --dry-run    walk every check and every step, build nothing
#
# WHAT IT REFUSES TO DO: it writes nothing outside this repository and the user's own AUKORA state directory, it
# cleans its temporary directories on EVERY exit path, and it refuses BY NAME the moment a prerequisite is missing
# rather than half-installing and leaving somebody to guess which part failed.
#
# EVERY HEAVY STEP GOES THROUGH scripts/heavy-run.sh, which takes the one heavy-run lock and — important — EXITS
# WITH THE COMMAND'S OWN CODE. A step that fails stops this script.
#
# IT IS IDEMPOTENT. A step whose result is already there is skipped with a word rather than rebuilt, so a second run
# on a partly-built tree finishes the job instead of starting over.

set -eu

# ── WHERE THINGS ARE ────────────────────────────────────────────────────────────────────────────────────────────────
# The repository is wherever THIS script lives, so a friend who clones anywhere gets a working installer.
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/.." && pwd)
cd "$ROOT"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "install-mac: unknown argument: $arg" >&2; echo "usage: scripts/install-mac.sh [--dry-run]" >&2; exit 2 ;;
  esac
done

# ── ITS OWN TEMPORARY DIRECTORY, REMOVED ON EVERY EXIT PATH ─────────────────────────────────────────────────────────
# The trap covers success, failure and a signal. Nothing this script makes outlives it, which is also why a run that
# fails does not leave a half-built tree behind for the next person to misread.
TMP_ROOT="${TMPDIR:-/tmp}"
WORK=$(mktemp -d "$TMP_ROOT/aukora-install-XXXXXX") || { echo "install-mac: cannot make a temporary directory in $TMP_ROOT" >&2; exit 1; }
cleanup() { rm -rf "$WORK" 2>/dev/null || true; }
trap cleanup EXIT INT TERM HUP

say()  { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
ok()   { printf '   ok: %s\n' "$*"; }
skip() { printf '   already there: %s\n' "$*"; }

# ── THE PREREQUISITES, EACH NAMED WITH HOW TO GET IT ────────────────────────────────────────────────────────────────
# **THE POINT IS THE SENTENCE A PERSON READS WHEN SOMETHING IS MISSING.** "command not found" costs an afternoon;
# "node 22.23.0 or newer is missing — install it from https://nodejs.org or with: brew install node@22" does not.
MISSING=0
NODE_MIN="22.23.0"
PNPM_MIN="11.7.0"
DISK_MIN_GB=10

need_cmd() {  # need_cmd <name> <how to get it>
  if command -v "$1" >/dev/null 2>&1; then return 0; fi
  say "MISSING: $1"
  say "  how to get it: $2"
  MISSING=$((MISSING + 1))
  return 1
}

version_at_least() {  # version_at_least <have> <want>
  # Sorts by version, not by string: 22.9.0 is older than 22.23.0 and a string compare says otherwise.
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$2" ]
}

step "Prerequisites"

if need_cmd node "https://nodejs.org, or: brew install node@22"; then
  HAVE_NODE=$(node -v | sed 's/^v//')
  if version_at_least "$HAVE_NODE" "$NODE_MIN"; then
    ok "node $HAVE_NODE (need $NODE_MIN or newer)"
  else
    say "MISSING: node is too old — found $HAVE_NODE, need $NODE_MIN or newer"
    say "  how to get it: https://nodejs.org, or: brew install node@22"
    MISSING=$((MISSING + 1))
  fi
fi

if need_cmd pnpm "corepack enable, or: npm install -g pnpm"; then
  HAVE_PNPM=$(pnpm -v 2>/dev/null || echo none)
  if version_at_least "$HAVE_PNPM" "$PNPM_MIN"; then
    ok "pnpm $HAVE_PNPM (need $PNPM_MIN or newer)"
  else
    say "MISSING: pnpm is too old — found $HAVE_PNPM, need $PNPM_MIN or newer"
    say "  how to get it: corepack enable, or: npm install -g pnpm"
    MISSING=$((MISSING + 1))
  fi
fi

need_cmd python3 "https://www.python.org/downloads/macos/, or: brew install python3" && ok "python3 $(python3 -V 2>&1 | sed 's/^Python //')"
need_cmd git "xcode-select --install, or: brew install git" && ok "git $(git --version | awk '{print $3}')"

# A C COMPILER, through the developer tools — the check a Mac actually needs, because `cc` can exist and still be a
# stub that fails on first use.
if xcode-select -p >/dev/null 2>&1; then
  ok "developer tools at $(xcode-select -p)"
else
  say "MISSING: the developer tools (a C compiler)"
  say "  how to get it: xcode-select --install"
  MISSING=$((MISSING + 1))
fi

# FREE DISK — the one that filled to 45 GB today, so this check is not theoretical.
#
# **`df -g` IS macOS-ONLY, AND LINUX REJECTS IT** — `df: invalid option -- 'g'` is how this court went red in BETA's
# Linux rehearsal (steps 179-180). The comment beside it even said "gives gigabytes on macOS", which is the trap: it
# reads as a description rather than as the portability defect it is. `-Pk` is the POSIX form — 1024-byte blocks on
# every platform, in the portable one-line-per-filesystem output format — and the arithmetic below turns it into the
# same number the message has always printed.
FREE_KB=$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')
FREE_GB=$((FREE_KB / 1024 / 1024))
if [ -n "$FREE_GB" ] && [ "$FREE_GB" -ge "$DISK_MIN_GB" ] 2>/dev/null; then
  ok "free disk: ${FREE_GB} GB (need ${DISK_MIN_GB} GB)"
else
  say "MISSING: free disk — found ${FREE_GB:-unknown} GB, need ${DISK_MIN_GB} GB"
  say "  how to get it: empty the Trash, or remove large files under your home directory"
  MISSING=$((MISSING + 1))
fi

if [ "$MISSING" -ne 0 ]; then
  say ""
  say "install-mac: refusing — $MISSING prerequisite(s) missing. Nothing was built and nothing was written."
  exit 1
fi

# ── THE STATE DIRECTORY, THE ONE PLACE OUTSIDE THE REPO THIS SCRIPT MAY WRITE ───────────────────────────────────────
# The desktop app keeps config and state under ~/Library/Application Support/AUKORA
# (apps/aukora-desktop/main.mjs sets userData there). $HOME/.aukora is not that folder.
SUPPORT="${AUKORA_SUPPORT_ROOT:-$HOME/Library/Application Support/AUKORA}"
STATE="${AUKORA_STATE_ROOT:-${AUKORA_STATE:-$SUPPORT/state}}"
step "Your AUKORA state"
say "   support directory: $SUPPORT"
say "   state directory: $STATE"
if [ "$DRY_RUN" -eq 1 ]; then
  say "   would create it if it is not there (this run creates nothing)"
else
  mkdir -p "$STATE"
  chmod 700 "$SUPPORT" 2>/dev/null || true
  chmod 700 "$STATE" 2>/dev/null || true
  ok "ready, mode 700"
fi

# ── THE BUILD, EVERY STEP THROUGH THE HEAVY-RUN LOCK ────────────────────────────────────────────────────────────────
heavy() {  # heavy <description> <command...>
  what=$1; shift
  if [ "$DRY_RUN" -eq 1 ]; then
    say "   would run (under the heavy-run lock): $*"
    return 0
  fi
  say "   $what"
  # --heavy-run.sh EXITS WITH THE COMMAND'S OWN CODE, so `set -e` above stops this script on a real failure.
  scripts/heavy-run.sh -- "$@"
}

step "The harness (vendor/dsh)"
if [ -d vendor/dsh/packages ] && [ "$DRY_RUN" -eq 0 ]; then
  skip "vendor/dsh is already unpacked (delete it to rebuild)"
else
  heavy "building the harness — this is the long one" python3 scripts/build-dsh.py
fi

step "The faces"
if [ -d plugins/aukora-face/apps/lib ] && [ "$DRY_RUN" -eq 0 ]; then
  skip "the face bundles are already built (delete plugins/aukora-face/apps/lib to rebuild)"
else
  heavy "building the faces" python3 scripts/build-face.py
fi

step "A release"
# THE MATERIALIZER, NOT cut-release.sh. MEASURED from a fresh clone (2026-09-27): `cut-release.sh <commit>` refuses
# `usage-missing-commit: no --support` before doing anything, because it is the owner's cutover path and needs a copy
# of a live support root and a home session. A friend has neither. The desktop app finds the newest
# `~/aukora-release-*` on its own (apps/aukora-desktop/resolve.mjs), so this is the release it will run.
SHORT=$(git rev-parse --short=12 HEAD 2>/dev/null || echo HEAD)
RELEASE="$HOME/aukora-release-$SHORT"
if [ -d "$RELEASE" ] && [ "$DRY_RUN" -eq 0 ]; then
  skip "$RELEASE (delete it to cut again)"
else
  heavy "materializing a release at $SHORT into $RELEASE" python3 scripts/materialize-aukora-release.py --to "$RELEASE"
fi

step "The desktop app"
if [ -d apps/aukora-desktop/dist ] && [ "$DRY_RUN" -eq 0 ]; then
  skip "the app bundle is already built (delete apps/aukora-desktop/dist to rebuild)"
else
  # The app's own packaging command, which is `electron-builder --mac dir` (measured in its package.json). Its
  # dependencies come first: a fresh clone has no apps/aukora-desktop/node_modules, and the app's lockfile is npm's.
  heavy "packaging the app" sh -c 'cd apps/aukora-desktop && npm ci && npm run dist'
fi

# ── FRIEND PREVIEW MARKER ───────────────────────────────────────────────────────────────────────────────────────────
# Writes config.json "repo" and profile friend-preview when this Mac has no owner-daemon config.
# A trusted Airlock config is left alone. The marker makes self-change, become, advance and commit-SSH
# fail closed. It does not turn on REQUIRE_COMMIT_SSH or separate-UID mint.
step "Friend preview"
if [ "$DRY_RUN" -eq 1 ]; then
  say "   would write friend-preview config into $SUPPORT when no owner-daemon config is present"
  node apps/aukora-desktop/friend-preview.mjs --write-bootstrap --dry-run --repo "$ROOT" --support "$SUPPORT" || true
else
  node apps/aukora-desktop/friend-preview.mjs --write-bootstrap --repo "$ROOT" --support "$SUPPORT"
fi

# ── HOW TO OPEN IT ──────────────────────────────────────────────────────────────────────────────────────────────────
step "Done"
say "   Open AUKORA from this clone with:"
say "       cd apps/aukora-desktop && npm start"
say "   The packaged app is unsigned (identity null, no notarization)."
say "   If macOS says the developer cannot be verified, from the clone root:"
say "       xattr -dr com.apple.quarantine apps/aukora-desktop/dist/*/*.app 2>/dev/null || true"
say "   Then right-click AUKORA.app, choose Open, and confirm Open."
say "   Aumlok: on the Aumlok screen, write down the seven words, then type them back."
say "   That keeps a software machine key in $STATE/aumlok. Any process you run can read it."
say "   Then add your own model API key in Models."
say "   Owner-only, and this install stops those by name: Airlock, commit SSH, a second-account proof store,"
say "   self-change, become, and advance. Steps: docs/FRIEND-MAC-INSTALL.md"
say "   To remove everything: delete this clone, $RELEASE, and $SUPPORT"
