#!/bin/sh
# Start the pinned OpenShell gateway for AUKORA on loopback, with TLS, mutual-TLS users and sandbox JWTs.
# Usage: start-gateway.sh <state-dir> <openshell-gateway-binary>
# <state-dir> holds config/openshell/gateway.toml, pki/ (from `openshell-gateway generate-certs --output-dir`) and the
# gateway database. It is CONTROL-PLANE state: it must never be inside a workspace, and nothing mounts it into a sandbox.
set -eu
STATE=${1:?state dir}; BIN=${2:?gateway binary}
[ -f "$STATE/pki/jwt/signing.pem" ] || { echo "aukora-openshell: no PKI in $STATE/pki; run: $BIN generate-certs --output-dir $STATE/pki --server-san 127.0.0.1" >&2; exit 2; }
chmod 700 "$STATE" "$STATE/pki"
XDG_CONFIG_HOME="$STATE/config" XDG_STATE_HOME="$STATE/state" OPENSHELL_LOCAL_TLS_DIR="$STATE/pki" OPENSHELL_TELEMETRY_ENABLED=false \
  nohup "$BIN" >"$STATE/gateway.log" 2>&1 &
echo $! > "$STATE/gateway.pid"
