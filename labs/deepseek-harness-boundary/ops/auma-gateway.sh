#!/usr/bin/env bash
# NVIDIA OpenShell gateway for user auma, podman driver, port 17690 (old harness uses 17670).
set -e
export XDG_RUNTIME_DIR=/run/user/$(id -u); cd "$HOME"
export OPENSHELL_LOCAL_TLS_DIR="$HOME/.local/state/openshell/tls" OPENSHELL_TELEMETRY_ENABLED=false OPENSHELL_COMPUTE_DRIVER=podman OPENSHELL_SERVER_PORT=17690
for i in $(seq 1 30); do curl -sf --unix-socket "$XDG_RUNTIME_DIR/podman/podman.sock" http://d/_ping >/dev/null && break; sleep 1; done
[ -f "$OPENSHELL_LOCAL_TLS_DIR/server/tls.crt" ] || openshell-gateway generate-certs --output-dir "$OPENSHELL_LOCAL_TLS_DIR" --server-san host.openshell.internal
openshell-gateway config preflight
exec openshell-gateway
