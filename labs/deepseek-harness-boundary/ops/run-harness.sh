#!/usr/bin/env bash
# DeepSeek Harness web profile as Linux user aukora-host (run via: sudo -n -u aukora-host -H).
# Loopback only; the tunnel hostname is admitted with --trusted-host; launch token + signed cookie authenticate.
set -e
umask 077
APP=/workspace/skunkworks/app
mkdir -p "$APP/session-root"
cd "$APP/session-root"
export HOME=/home/aukora-host DSH_HOME="$APP/dsh-home" DSH_TELEMETRY_MODE=DISABLED NODE_ENV=production
export PATH=/workspace/skunkworks/node/bin:/usr/bin:/bin
unset DEEPSEEK_API_KEY
# SKUNK_SCRIPT_KEY: set an inert random value here only if you use the optional loopback scripted driver (see auma-core). Not published.
TH=$(cat /workspace/skunkworks/ops/.tunnel-host 2>/dev/null || true)
exec node "$APP/node_modules/@deepseek-ai/dsh/lib/bin.js" --profile web --patch "$APP/skunkworks.patch.yml" \
  --no-open --port 3091 ${TH:+--trusted-host "$TH"}
