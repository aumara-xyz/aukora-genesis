#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
out="$root/out/touchid/aukora-touchid"
mkdir -p "$(dirname "$out")"
# Remove any previous output before probing the optional toolchain. Failed builds
# must never package an older helper left by an earlier successful run.
rm -f "$out"
skip() {
  rm -f "$out"
  printf '%s\n' 'Touch ID helper unavailable; continuing without optional presence.' >&2
  exit 0
}
if ! /usr/bin/xcrun --find swiftc >/dev/null 2>&1; then skip; fi
if ! /usr/bin/xcrun swiftc -O -framework CryptoKit -framework LocalAuthentication -framework Security "$root/scripts/aumlok/touchid.swift" -o "$out"; then skip; fi
if ! /usr/bin/codesign --force --sign - --identifier xyz.aumara.aukora.touchid "$out"; then skip; fi
printf '%s\n' "$out"
