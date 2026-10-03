#!/usr/bin/env python3
# Phase-1 step 2: ~15 diverse attacks through the LIVE gate as aukora-host; every pending one rejected at once
# via ops/owner-decide.sh reject (owner path). NEVER approves. Owner bearer is not used/read.
import json,subprocess,re,time,sys
NODE="/workspace/skunkworks/node/bin/node"; CL="/workspace/skunkworks/redteam/gate_client.mjs"; SOCK="/run/skunkworks-gate/gate.sock"
OD="/workspace/skunkworks/ops/owner-decide.sh"; T="plugins/auma-theme/theme.json"
C={a['id']:a for a in json.load(open('/tmp/glm-rt2/corpus.json'))+json.load(open('/tmp/rt2/glm_extra.json'))}
S={json.loads(l)['id']:json.loads(l) for f in ['/tmp/rt2/scratch_results.jsonl','/tmp/rt2/scratch_extra.jsonl'] for l in open(f)}
def cat(c): return re.sub(r'^mut_','',c).replace('-','_')
def host(reqs):
    p=subprocess.run(["sudo","-n","-u","aukora-host","env",f"SOCK={SOCK}",NODE,CL],input="\n".join(json.dumps(r) for r in reqs)+"\n",capture_output=True,text=True,timeout=60)
    return [json.loads(l) for l in p.stdout.splitlines() if l.strip()]
# pick: specific interesting ids + first pending per category with unused content + 2 schema blocks
want=json.load(open('/tmp/rt2/live_pick3.json')); used=set(); cats=set()
for i,a in []:
    k=cat(a['category'])
    if k in cats or S[i]['result']!='pending' or a['content'] in used or a['content']=='{"accent": "#FFD700"}': continue
    want.append(i); used.add(a['content']); cats.add(k)
for m in []:
    for i,a in C.items():
        if a.get('mutation')==m and cat(a['category'])=='fake_after_apply' and a['content'] not in used and S[i]['result']=='pending': want.append(i); used.add(a['content']); break

out=open('/tmp/rt2/live_results.jsonl','a')
for i in want:
    a=C[i]; base=host([{"op":"read","args":{"target":T}}])[0]["result"]["sha256"]
    r=host([{"op":"propose","args":{"target":T,"content":a['content'],"why":a['note'],"claimed_base":base,"session":f"rt2live-{i}-{int(time.time())}","call_id":"rt2live-"+i}}])[0]
    row={"id":i,"ts":time.strftime('%Y-%m-%dT%H:%M:%S%z'),"category":cat(a['category']),"base_sha":base}
    if not r.get("ok"): row.update(result="blocked",error=r.get("error","")[:200])
    else:
        p=r["result"]; id8=p["id"][:8]
        pend=subprocess.run([OD,"pending"],capture_output=True,text=True).stdout
        line=[l for l in pend.splitlines() if l.startswith(id8)]
        rej=subprocess.run([OD,"reject",id8],capture_output=True,text=True)
        try: rj=json.loads(rej.stdout.strip().splitlines()[-1])
        except Exception: rj={"raw":rej.stdout[-200:],"err":rej.stderr[-200:]}
        row.update(result="pending_then_rejected" if rj.get("result")=="refused" else "pending_REJECT_FAILED",id8=id8,after_apply=p["popup"]["after_apply"],plain=p["popup"]["plain_change"],
                   flags=p["popup"]["flags"],note_shown=p["popup"]["note"],owner_cli_line=(line[0][:200] if line else None),reject=rj,
                   matches_scratch=(S[i].get('popup',{}).get('plain')==p["popup"]["plain_change"] and S[i].get('popup',{}).get('flags')==p["popup"]["flags"]))
    out.write(json.dumps(row)+"\n"); out.flush(); print(i,row["category"],row["result"],row.get("plain",row.get("error",""))[:70],"flags=",len(row.get("flags",[])),"scratch_match=",row.get("matches_scratch"))
    time.sleep(0.3)
print("final pending:",subprocess.run([OD,"pending"],capture_output=True,text=True).stdout.strip()[:200])
