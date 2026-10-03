#!/usr/bin/env bash
# Second Cloudflare quick tunnel -> skunkworks-gate OWNER approval page (127.0.0.1:17792, served by aukora-gate).
# Deliberately NOT routed through the harness, so aukora-host can neither see nor alter owner approvals.
exec "$HOME/.local/bin/cloudflared" tunnel --no-autoupdate --url http://127.0.0.1:17792
