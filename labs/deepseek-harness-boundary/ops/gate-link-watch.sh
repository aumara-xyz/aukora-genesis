#!/usr/bin/env bash
# pm2 app sk-gate-link (runs as box): keeps ops/.gate-access current. The gate rotates its owner bearer on every start
# (incl. pm2 auto-restarts of sk-gate) and on 'rotate_bearer'; whenever owner-secret.json changes, or the gate tunnel URL
# changes, re-run gate-link.sh. Polls every 5 s; never prints the bearer.
cd /workspace/skunkworks/ops
export PM2_HOME=$HOME/.pm2-skunk
last=""
while true; do
  m=$(sudo -n stat -c %Y.%Z /workspace/skunkworks/gate/owner-secret.json 2>/dev/null)
  u=$(grep -ho 'https://[a-z0-9-]*\.trycloudflare\.com' $PM2_HOME/logs/sk-gate-tunnel-out.log $PM2_HOME/logs/sk-gate-tunnel-error.log 2>/dev/null | tail -1)
  cur="$m|$(printf %s "$u" | sha256sum | cut -c1-12)"
  if [ -n "$m" ] && [ -n "$u" ] && [ "$cur" != "$last" ]; then
    sleep 1; ./gate-link.sh && last="$cur"
  fi
  sleep 5
done
