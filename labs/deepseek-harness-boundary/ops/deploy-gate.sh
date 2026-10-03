#!/usr/bin/env bash
# Deploy gate-src/{gate.mjs,owner-cli.mjs} -> /usr/local/lib/skunkworks/ (root 0755) with MINIMAL restart: only pm2 app sk-gate
# restarts (harness, tunnels and sandbox keep running; the harness talks to the socket per call). Refuses while a proposal
# is pending. The restart rotates the owner bearer; ops/.gate-access is rewritten by gate-link.sh. Backups: *.bak-<ts>.
set -e
export PM2_HOME=$HOME/.pm2-skunk
L=/usr/local/lib/skunkworks N=/workspace/skunkworks/node/bin/node SRC=/workspace/skunkworks/gate-src OPS=/workspace/skunkworks/ops
$N --check $SRC/gate.mjs; $N --check $SRC/owner-cli.mjs
P=$($OPS/owner-decide.sh pending | grep -c '^[0-9a-f]\{8\} ' || true)
[ "$P" = 0 ] || { echo "REFUSING: $P pending proposal(s); decide them first" >&2; exit 3; }
TS=$(date +%Y%m%d-%H%M%S); M0=$(sudo -n stat -c %Y.%Z /workspace/skunkworks/gate/owner-secret.json)
for f in gate.mjs owner-cli.mjs; do sudo cp -p $L/$f $L/$f.bak-$TS; sudo install -o root -g root -m 0755 $SRC/$f $L/$f.new; sudo mv -f $L/$f.new $L/$f; done
npx -y pm2 restart sk-gate >/dev/null
for i in $(seq 1 60); do [ "$(sudo -n stat -c %Y.%Z /workspace/skunkworks/gate/owner-secret.json)" != "$M0" ] && sudo -n test -S /run/skunkworks-gate/owner.sock && \
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:17792/)" = 401 ] && break; sleep 0.5; done
$OPS/ledger-verify.sh >/dev/null && echo "ledger verify OK" || { echo "LEDGER VERIFY FAILED" >&2; exit 4; }
$OPS/gate-link.sh
echo "deployed gate.mjs $(sha256sum $L/gate.mjs | cut -c1-16) (backups *.bak-$TS)"
