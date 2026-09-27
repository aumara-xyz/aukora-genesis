#!/usr/bin/env bash
# Regenerate icons/icon.png and icons/icon.icns from the tracked brand asset.
# The iconset ladder is intermediate and is not tracked.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/../../plugins/aukora-foundation/assets/AUMARA-FULL-TRANSPARENT-ICON.png"
[ -f "$src" ] || { echo "missing-brand-asset: $src" >&2; exit 2; }
mkdir -p "$here/icons/icon.iconset"
sips -z 1024 1024 "$src" --out "$here/icons/icon.png" >/dev/null
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" "$src" --out "$here/icons/icon.iconset/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "$d" "$d" "$src" --out "$here/icons/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$here/icons/icon.iconset" -o "$here/icons/icon.icns"
rm -rf "$here/icons/icon.iconset"
echo "icons/icon.png icons/icon.icns regenerated"
