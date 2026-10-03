#!/usr/bin/env bash
# OWNER path for the box operator: ops/owner-decide.sh pending | approve <id8> <result-sha12> | reject <id8>
exec sudo -n -u aukora-gate -H /workspace/skunkworks/node/bin/node /usr/local/lib/skunkworks/owner-cli.mjs "$@"
