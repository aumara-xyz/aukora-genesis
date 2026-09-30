#!/bin/sh
# friend-mac-pack.sh — unsigned Mac app zip for a friend preview.
#
#   scripts/friend-mac-pack.sh --explain     print the path; build nothing
#   scripts/friend-mac-pack.sh               on macOS, zip the unsigned app
#
# The app stays unsigned: apps/aukora-desktop/package.json sets "identity": null.
# This script does not notarize, does not set a Developer ID, and does not turn on
# AUKORA_REQUIRE_COMMIT_SSH or AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID.
# A zip is not a clone-free install. The shell still needs the Genesis checkout
# named in config.json (docs/FRIEND-MAC-INSTALL.md).

set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/.." && pwd)
cd "$ROOT"

explain() {
  cat <<'EOF'
Friend preview pack (unsigned, Mac only)

What you get
  An unsigned AUKORA.app inside a zip. macOS Gatekeeper will say the developer
  cannot be verified. There is no notarization ticket and no Developer ID.

What you do not get
  A clone-free app. After unzip, the shell still needs "repo" set to a Genesis
  checkout (scripts/install-mac.sh writes that). Airlock, commit SSH, and a
  second-account proof store stay on the owner Mac. This pack leaves
  AUKORA_REQUIRE_COMMIT_SSH and AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID unset.

Build, on a Mac, from the clone root
  scripts/install-mac.sh
  scripts/friend-mac-pack.sh

Gatekeeper, after the zip is on the friend's Mac
  unzip the archive, then:
    xattr -dr com.apple.quarantine /path/to/AUKORA.app
  Right-click AUKORA.app, choose Open, and confirm Open.
  Do not disable Gatekeeper for the whole machine.

Open
  cd apps/aukora-desktop && npm start
  or open the .app once config.json names this clone (install-mac.sh writes it).
EOF
}

for arg in "$@"; do
  case "$arg" in
    --explain|-h|--help) explain; exit 0 ;;
    --require-commit-ssh|--separate-uid|--notarize)
      echo "friend-pack: refusing $arg: friend preview leaves those switches off" >&2
      exit 1
      ;;
    *) echo "friend-pack: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ "$(uname -s)" != Darwin ]; then
  echo "friend-pack:not-darwin: an unsigned Mac zip is built on macOS. On this host run: scripts/friend-mac-pack.sh --explain" >&2
  exit 1
fi

# identity null is the package.json setting. Keep electron-builder from hunting for a signing identity.
export CSC_IDENTITY_AUTO_DISCOVERY=false
cd apps/aukora-desktop
if [ ! -d node_modules ]; then
  npm ci
fi
./node_modules/.bin/electron-builder --mac zip
echo "friend-pack: unsigned zip is under apps/aukora-desktop/dist"
echo "friend-pack: Gatekeeper: xattr -dr com.apple.quarantine /path/to/AUKORA.app"
