#!/usr/bin/env python3
# Runs the corpus through (1) a SCRATCH gate instance (real gate code, scratch target/socket) at volume,
# (2) a rate-limit battery on scratch, (3) a representative sample through the LIVE gate (every one rejected).
import json, subprocess, sys, time, re, os, random, hashlib
random.seed(7)
OUT=os.environ.get("RT_OUT","/tmp/glm-rt2"); NODE="/workspace/skunkworks/node/bin/node"
RT="/workspace/skunkworks/redteam"
SCRATCH=os.environ.get("SCRATCH_SOCK","/tmp/sgate/run/gate.sock"); LIVE="/run/skunkworks-gate/gate.sock"
TARGET="plugins/auma-theme/theme.json"
GATE_LABEL=os.environ.get("GATE_LABEL","current")
def log(*a): print(f"[{time.strftime('%H:%M:%S')}]",*a,flush=True)

def batch(sock, reqs, as_host=False):
    data="\n".join(json.dumps(r) for r in reqs)+"\n"
    cmd=[NODE,f"{RT}/gate_client.mjs"]
    if as_host: cmd=["sudo","-n","-u","aukora-host","env",f"SOCK={sock}",NODE,f"{RT}/gate_client.mjs"]
    p=subprocess.run(cmd,input=data,capture_output=True,text=True,timeout=600,env={**os.environ,"SOCK":sock})
    out=[]
    for l in p.stdout.splitlines():
        try: out.append(json.loads(l))
        except: out.append({"ok":False,"error":"unparseable:"+l[:80]})
    return out

def cur_sha(sock, as_host=False):
    return batch(sock,[{"op":"read","args":{"target":TARGET}}],as_host)[0]["result"]["sha256"]

FLAGMAP=[(r
