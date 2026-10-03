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
# NOT THE SAME AS skip(). It names the file an earlier, unfinished run did not leave, so a person reading the log can
# tell "nothing to do" from "this had to be repaired"; the line after it says what this run does about it.
incomplete() { printf '   incomplete: %s\n' "$*"; }

# ── DID A STAGE ACTUALLY FINISH? ────────────────────────────────────────────────────────────────────────────────
# **A DIRECTORY THAT EXISTS IS NOT A STAGE THAT FINISHED.** An interrupted build leaves the directory behind and not
# its outputs, and the test this script used — `[ -d <dir> ]` — then skipped that stage for good: the run reached
# "Done" over a tree it had never built, which is the one outcome the person installing cannot debug. Each predicate
# below names the file the stage's own build writes LAST, so "already there" means what the header always claimed.
#
# Each returns the missing paths on stdout and nothing at all when the stage is complete, so the caller decides and
# prints from one fact. `set -e` IS IN FORCE: every caller tests with `if`, never with a bare `[ ... ] && ...`,
# because a false test as the last command of a line would stop the installer.
harness_missing() {
  # build-dsh.py DELETES `.dsh-build/pinned-harness-build.json` before it touches the tree and writes it again only
  # after unpack, patches, `pnpm install`, `pnpm run build` and the artifact record have all finished and verified
  # (scripts/build-dsh.py, binding_path). The materializer reads it, so a tree without it cannot become a release.
  # pnpm's `node_modules/.modules.yaml` is NOT enough: it is written before `pnpm run build`, the long part.
  [ -f vendor/dsh/.dsh-build/pinned-harness-build.json ] || printf 'vendor/dsh/.dsh-build/pinned-harness-build.json '
}

faces_missing() {
  # EVERY FACE, READ FROM THE TREE. build-face.py carries its own FACES tuple; a second copy of that list here is a
  # second list that drifts, and the drift is silent because both halves look correct on their own. The old test named
  # ONE face (`apps`), so a tree carrying `apps/lib` and no `memory/lib` skipped the stage that builds both.
  # `.build-inputs.json` is the marker because copy_back writes it for every face unconditionally, while
  # index.js/client.js/invariant.js are written only when that face produced them.
  for dir in plugins/aukora-face/*/; do
    [ -f "${dir}lib/.build-inputs.json" ] || printf '%s ' "${dir}lib"
  done
}

release_missing() {
  # The materializer writes its own record into the release's .dsh-build/ as its last write. A directory named
  # ~/aukora-release-<sha> can be left behind by a cut that failed part-way; the record is written when it completed.
  [ -f "$1/.dsh-build/aukora-release.json" ] || printf '%s ' "$1/.dsh-build/aukora-release.json"
}

app_missing() {
  # electron-builder writes app.asar into Electron.app BEFORE it renames that to AUKORA.app, so app.asar is there
  # whenever AUKORA.app is. After the rename it still copies extraFiles (the owner-daemon, aumlok and kira libs the
  # app imports) and then ad-hoc signs the bundle (identity "-" in package.json build.mac). The seal is the LAST
  # write: a run cut short during the copy or the signing leaves app.asar and a seal that does not verify. The
  # output directory follows the arch of the node that runs electron-builder (process.arch): `mac-arm64` on Apple
  # silicon, plain `mac` for x64 (Intel, or a node under Rosetta).
  arch=$(node -p process.arch)
  if [ "$arch" = x64 ]; then out=mac; else out="mac-$arch"; fi
  asar="apps/aukora-desktop/dist/$out/AUKORA.app/Contents/Resources/app.asar"
  [ -f "$asar" ] || printf '%s ' "$asar"
  codesign --verify --deep --strict "apps/aukora-desktop/dist/$out/AUKORA.app" >/dev/null 2>&1 || printf '%s ' "apps/aukora-desktop/dist/$out/AUKORA.app (signature)"
}

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
# The same variable the running app reads (plugins/aukora-eye/lib/token-file.mjs), so what the installer prepares is
# what the app will open.
STATE="${AUKORA_STATE_ROOT:-${AUKORA_STATE:-$HOME/.aukora}}"
step "Your AUKORA state"
say "   state directory: $STATE"
if [ "$DRY_RUN" -eq 1 ]; then
  say "   would create it if it is not there (this run creates nothing)"
else
  mkdir -p "$STATE"
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
MISSING_FROM=$(harness_missing)
if [ "$DRY_RUN" -eq 0 ] && [ -z "$MISSING_FROM" ]; then
  skip "vendor/dsh is already unpacked and installed (delete it to rebuild)"
elif [ -n "$MISSING_FROM" ] && [ -d vendor/dsh ]; then
  # A HARNESS THAT DID NOT FINISH CANNOT BE FINISHED IN PLACE. build-dsh.py compares every file of an existing
  # vendor/dsh with the pinned archive before it builds, and its patches have already rewritten some of them, so it
  # stops on `source-file-mismatch` (or a missing file after a cut-short unpack). The archive itself is kept.
  incomplete "$MISSING_FROM"
  say "   build-dsh.py does not build over a tree it already started."
  say "   Delete vendor/dsh and run this script again; vendor/dsh-source.tar.gz is kept, so nothing downloads twice."
  if [ "$DRY_RUN" -eq 0 ]; then exit 1; fi
else
  heavy "building the harness — this is the long one" python3 scripts/build-dsh.py
  # A BUILD THAT CLAIMS SUCCESS AND LEFT NOTHING IS THE FAILURE THIS WHOLE CHANGE IS ABOUT, so the same predicate
  # is asked again. `set -e` already stops on a non-zero exit; this catches the other half, a step that exited 0.
  if [ "$DRY_RUN" -eq 0 ]; then
    MISSING_FROM=$(harness_missing)
    if [ -n "$MISSING_FROM" ]; then
      say "install-mac: the harness step finished but vendor/dsh is still incomplete — missing: $MISSING_FROM"
      say "  Nothing further was built. Delete vendor/dsh and run this script again."
      exit 1
    fi
  fi
fi

step "The faces"
MISSING_FROM=$(faces_missing)
if [ "$DRY_RUN" -eq 0 ] && [ -z "$MISSING_FROM" ]; then
  skip "every face bundle is already built (delete a face's lib to rebuild it)"
else
  if [ -n "$MISSING_FROM" ]; then incomplete "$MISSING_FROM"; fi
  heavy "building the faces" python3 scripts/build-face.py
  if [ "$DRY_RUN" -eq 0 ]; then
    MISSING_FROM=$(faces_missing)
    if [ -n "$MISSING_FROM" ]; then
      say "install-mac: the face step finished but these face bundles are still incomplete — missing: $MISSING_FROM"
      say "  Nothing further was built. Run: python3 scripts/build-face.py"
      exit 1
    fi
  fi
fi

step "A release"
# THE MATERIALIZER, NOT cut-release.sh. MEASURED from a fresh clone (2026-09-27): `cut-release.sh <commit>` refuses
# `usage-missing-commit: no --support` before doing anything, because it is the owner's cutover path and needs a copy
# of a live support root and a home session. A friend has neither. The desktop app finds the newest
# `~/aukora-release-*` on its own (apps/aukora-desktop/resolve.mjs), so this is the release it will run.
SHORT=$(git rev-parse --short=12 HEAD 2>/dev/null || echo HEAD)
RELEASE="$HOME/aukora-release-$SHORT"
MISSING_FROM=$(release_missing "$RELEASE")
if [ "$DRY_RUN" -eq 0 ] && [ -z "$MISSING_FROM" ]; then
  skip "$RELEASE (delete it to cut again)"
elif [ -n "$MISSING_FROM" ] && [ -d "$RELEASE" ] && [ ! -L "$RELEASE" ]; then
  # The materializer refuses `release-exists` for any target already there; `--force` is its own way to replace
  # one, and it is passed only for a plain directory that carries no completion record, so a finished release is
  # never it.
  incomplete "$MISSING_FROM"
  heavy "materializing a release at $SHORT into $RELEASE, replacing the unfinished one" \
    python3 scripts/materialize-aukora-release.py --to "$RELEASE" --force
elif [ -n "$MISSING_FROM" ] && { [ -e "$RELEASE" ] || [ -L "$RELEASE" ]; }; then
  # NEVER --force A LINK OR A FILE. The materializer resolves the target and then rmtree's it, so a symlink here
  # would delete whatever it points at.
  incomplete "$MISSING_FROM"
  say "   $RELEASE is not a plain directory (a symlink or a file), so this script will not replace it."
  say "   Remove $RELEASE yourself and run this script again."
  if [ "$DRY_RUN" -eq 0 ]; then exit 1; fi
else
  heavy "materializing a release at $SHORT into $RELEASE" python3 scripts/materialize-aukora-release.py --to "$RELEASE"
fi
if [ "$DRY_RUN" -eq 0 ] && [ -n "$MISSING_FROM" ]; then  # the materializer ran above
  MISSING_FROM=$(release_missing "$RELEASE")
  if [ -n "$MISSING_FROM" ]; then
    say "install-mac: the release step finished but $RELEASE carries no record — missing: $MISSING_FROM"
    say "  Nothing further was built. Delete $RELEASE and run this script again."
    exit 1
  fi
fi

step "The desktop app"
MISSING_FROM=$(app_missing)
if [ "$DRY_RUN" -eq 0 ] && [ -z "$MISSING_FROM" ]; then
  skip "the app bundle is already built (delete apps/aukora-desktop/dist to rebuild)"
else
  if [ -n "$MISSING_FROM" ] && [ -d apps/aukora-desktop/dist ]; then incomplete "$MISSING_FROM"; fi
  # The app's own packaging command, which is `electron-builder --mac dir` (measured in its package.json). Its
  # dependencies come first: a fresh clone has no apps/aukora-desktop/node_modules, and the app's lockfile is npm's.
  heavy "packaging the app" sh -c 'cd apps/aukora-desktop && npm ci && npm run dist'
  if [ "$DRY_RUN" -eq 0 ]; then
    MISSING_FROM=$(app_missing)
    if [ -n "$MISSING_FROM" ]; then
      say "install-mac: the packaging step finished but the bundle is still incomplete — missing: $MISSING_FROM"
      say "  Nothing further was done. Run: cd apps/aukora-desktop && npm run dist"
      exit 1
    fi
  fi
fi

# ── HOW TO OPEN IT ──────────────────────────────────────────────────────────────────────────────────────────────────
step "Done"
say "   Open AUKORA from this clone with:"
say "       cd apps/aukora-desktop && npm start"
# The packaged bundle cannot find this clone from inside its asar (apps/aukora-desktop/resolve.mjs refuses
# `repo-not-configured`), so it needs the clone named once in its config file.
say "   The packaged app in apps/aukora-desktop/dist needs \"repo\": \"$ROOT\" in its config.json"
say "   (~/Library/Application Support/AUKORA/config.json) before it can start."
say "   Then add your own model API key in Models, and link your Aumlok phrase in Aumlok."
say "   Things that are OFF until you turn them on: voice (it needs a one-time local setup), approvals, and messaging."
say "   To remove everything: delete this clone, $RELEASE, ~/Library/Application Support/AUKORA and $STATE"
