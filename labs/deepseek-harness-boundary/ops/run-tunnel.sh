#!/usr/bin/env bash
# Cloudflare quick tunnel -> loopback harness port 3091. URL changes when this process restarts
# (then run ops/start.sh so the harness admits the new hostname).
exec "$HOME/.local/bin/cloudflared" tunnel --no-autoupdate --url http://127.0.0.1:3091
