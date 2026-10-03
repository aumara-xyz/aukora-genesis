#!/usr/bin/env bash
# skunkworks-gate as Linux user aukora-gate (run via: sudo -n -u aukora-gate -H). Owns proposals, the
# append-only signed ledger, the receipt key and the allowlisted target files; harness reaches it only
# via /run/skunkworks-gate/gate.sock (group skgate = aukora-host + aukora-gate).
set -e
umask 027
export HOME=/workspace/skunkworks/gate PATH=/workspace/skunkworks/node/bin:/usr/bin:/bin
export SKGATE_GID=$(getent group skgate | cut -d: -f3)
cd "$HOME"
exec node /usr/local/lib/skunkworks/gate.mjs
