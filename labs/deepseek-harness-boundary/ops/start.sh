#!/usr/bin/env bash
# Idempotent (re)start of SKUNKWORKS: auma podman + OpenShell gateway, sandbox auma-ws, skunkworks-gate, tunnel, harness.
# Prints the login URL (launch token changes on every harness restart; existing browser cookies stay valid
# unless the tunnel hostname changes). No systemd on this box: after a reboot, run this script.
set -e
export PM2_HOME=$HOME/.pm2-skunk
U=$(id -u auma); [ -d /run/user/$U ] || { sudo mkdir -p /run/user/$U; sudo chown auma:auma /run/user/$U; sudo chmod 700 /run/user/$U; }
G=/run/skunkworks-gate; [ -d $G ] || sudo install -d -o aukora-gate -g skgate -m 0750 $G
cd /workspace/skunkworks/ops
# start (never restart) podman+gateway. If the sandbox ends up in Error (e.g. after a Podman restart), auma-ensure-sandbox.sh
# tries "sandbox start" first, else recreates it and restores /sandbox from /home/auma/sandbox-persist (network none enforced).
for a in sk-auma-podman sk-auma-gateway; do npx -y pm2 describe $a 2>/dev/null | grep -q online || npx -y pm2 start ecosystem.config.js --only $a >/dev/null; done
sudo -n -u auma -H /workspace/skunkworks/ops/auma-ensure-sandbox.sh
# approval/state authority (separate Linux user); harness self-check fails closed without it
npx -y pm2 describe sk-gate 2>/dev/null | grep -q online || npx -y pm2 start ecosystem.config.js --only sk-gate >/dev/null
for i in $(seq 1 20); do sudo -n test -S $G/gate.sock && break; sleep 0.5; done
npx -y pm2 describe sk-tunnel >/dev/null 2>&1 || npx -y pm2 start ecosystem.config.js --only sk-tunnel >/dev/null
for i in $(seq 1 30); do URL=$(grep -ho 'https://[a-z0-9-]*\.trycloudflare\.com' $PM2_HOME/logs/sk-tunnel-*.log | tail -1); [ -n "$URL" ] && break; sleep 1; done
echo "${URL#https://}" > .tunnel-host
OLD=$(grep -o "token=[A-Za-z0-9_-]*" $PM2_HOME/logs/sk-harness-out.log 2>/dev/null | tail -1)
npx -y pm2 startOrRestart ecosystem.config.js --only sk-harness --update-env >/dev/null
for i in $(seq 1 40); do T=$(grep -o 'token=[A-Za-z0-9_-]*' $PM2_HOME/logs/sk-harness-out.log 2>/dev/null | tail -1); [ -n "$T" ] && [ "$T" != "$OLD" ] && break; sleep 1; done
umask 077; echo "$URL/?$T" > .access
npx -y pm2 save >/dev/null
echo "Open: $URL/?$T"
