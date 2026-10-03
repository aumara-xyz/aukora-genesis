#!/usr/bin/env bash
# Write the OWNER approval link (gate tunnel URL + current owner bearer) to ops/.gate-access: box-only 0600, atomic tmp+rename.
# The gate rotates the bearer on EVERY start and it expires after 12 h, so run this after any gate restart
# (start.sh and deploy-gate.sh call it). --rotate: ask the gate (owner.sock) for a fresh bearer first (no restart).
# Never prints the bearer; prints only the expiry time.
set -e
export PM2_HOME=$HOME/.pm2-skunk
cd /workspace/skunkworks/ops
if [ "$1" = --rotate ]; then
  sudo -n -u aukora-gate -H /workspace/skunkworks/node/bin/node -e 'const c=require("net").createConnection("/run/skunkworks-gate/owner.sock");let b="";c.on("connect",()=>c.write(JSON.stringify({op:"rotate_bearer",args:{}})+"\n"));c.on("data",d=>b+=d);c.on("end",()=>{const r=JSON.parse(b);if(!r.ok){console.error(r.error);process.exit(1)}})' >/dev/null
fi
GU=$(grep -ho 'https://[a-z0-9-]*\.trycloudflare\.com' $PM2_HOME/logs/sk-gate-tunnel-out.log $PM2_HOME/logs/sk-gate-tunnel-error.log 2>/dev/null | tail -1)
[ -n "$GU" ] || { echo "no gate tunnel URL found in pm2 logs" >&2; exit 1; }
umask 077; tmp=$(mktemp .gate-access.XXXXXX)
EXP=$(sudo -n cat /workspace/skunkworks/gate/owner-secret.json | python3 -c '
import json,sys,time
d=json.load(sys.stdin); open(sys.argv[2],"w").write(sys.argv[1]+"/?k="+d["bearer"]+"\n")
e=d.get("bearer_expires"); print(time.strftime("%Y-%m-%d %H:%M", time.localtime(e/1000))+" WITA" if e else "unknown (old gate?)")' "$GU" "$tmp")
chmod 600 "$tmp"; mv -f "$tmp" .gate-access
echo "wrote ops/.gate-access (0600, box only); owner link expires $EXP"
