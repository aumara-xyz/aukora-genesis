#!/usr/bin/env bash
# Verify the skunkworks-gate change ledger (hash chain + Ed25519 signature on every entry). Exit 0 = intact.
exec sudo -n -u aukora-gate -H bash -c 'cd /workspace/skunkworks/gate && exec /workspace/skunkworks/node/bin/node /usr/local/lib/skunkworks/gate.mjs verify'
