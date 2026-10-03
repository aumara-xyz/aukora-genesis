#!/usr/bin/env bash
# build + start a SCRATCH copy of the NEW gate (box user, /tmp/rt3/scratch). Only HOME/TARGET_ROOT/RUN/port changed,
# plus MAX_PER_WINDOW raised so the 815-row replay is not throttled by the (now global) 3-per-10-min window.
set -e; S=/tmp/rt3/scratch; pkill -f "$S/gate.mjs" 2>/dev/null || true; sleep 0.5; rm -rf $S; mkdir -p $S/home $S/targets/plugins/auma-theme $S/run
printf '{"accent": "#FFD700"}' > $S/targets/plugins/auma-theme/theme.json
sed -e "s#^const HOME = .*#const HOME = '$S/home'#" -e "s#^const TARGET_ROOT = .*#const TARGET_ROOT = '$S/targets'#" -e "s#^const RUN = .*#const RUN = '$S/run'#" \
    -e "s#^const OWNER_HTTP_PORT = .*#const OWNER_HTTP_PORT = 17894#" -e "s#^const MAX_PER_WINDOW = .*#const MAX_PER_WINDOW = ${RT3_WINDOW:-1000000}#" \
    /workspace/skunkworks/gate-src/gate.mjs > $S/gate.mjs
grep -c "$S" $S/gate.mjs >/dev/null
cd $S/home; nohup /workspace/skunkworks/node/bin/node $S/gate.mjs > $S/gate.log 2>&1 &
for i in $(seq 1 40); do [ -S $S/run/gate.sock ] && break; sleep 0.25; done; [ -S $S/run/gate.sock ] && echo "scratch gate up" || { tail -5 $S/gate.log; exit 1; }
