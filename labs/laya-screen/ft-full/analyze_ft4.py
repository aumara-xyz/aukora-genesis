import json, re, collections, sys
sys.path.insert(0,"/workspace/laya-screen/ft-full")
from rules import SPOOF,NOCHG,SPOOF_TRAIN,NOCHG_TRAIN,fold
E=json.load(open("/workspace/laya-screen/ft-full/eval_ft4.json"))
def ld(s): return {json.loads(l)["id"]:json.loads(l) for l in open(f"/workspace/laya-screen/trainset/{s}.jsonl")}
raw={**ld("train"),**ld("dev"),**ld("test")}
def P(r): return r["p"]["suspicious"]
def R(r,k): return any(r[k].values())
def prf(pred,ys):
    tp=sum(p and y for p,y in zip(pred,ys)); fp=sum(p and not y for p,y in zip(pred,ys)); fn=sum((not p) and y for p,y in zip(pred,ys)); tn=len(ys)-tp-fp-fn
    pr=tp/(tp+fp) if tp+fp else 0; rc=tp/(tp+fn) if tp+fn else 0; f=2*pr*rc/(pr+rc) if pr+rc else 0
    return dict(tp=tp,fp=fp,fn=fn,tn=tn,P=round(pr,3),R=round(rc,3),F1=round(f,3),FPR=round(fp/(fp+tn),3) if fp+tn else None)
dev,test=E["dev"],E["test"]
# dev threshold sweep for Laya alone (suspicious q) and Laya OR strict rules
ths=sorted(set([round(x/100,2) for x in range(1,100)]))
def best(fn):
    sc=[(prf([fn(r,t) for r in dev],[r["y"] for r in dev])["F1"],-abs(t-0.5),t) for t in ths]
    return max(sc)[2]
tL=best(lambda r,t:P(r)>=t); tLR=best(lambda r,t:P(r)>=t or R(r,"rules_strict")); tLRl=best(lambda r,t:P(r)>=t or R(r,"rules"))
print("dev-chosen thresholds: laya",tL," laya|strict",tLR," laya|loose",tLRl)
print("dev laya@tL",prf([P(r)>=tL for r in dev],[r["y"] for r in dev]))
print("dev laya score range y=1",min(P(r) for r in dev if r["y"]),"y=0 max",max(P(r) for r in dev if not r["y"]))
sysm={"laya":lambda r:P(r)>=tL,"rules_strict":lambda r:R(r,"rules_strict"),"rules_loose":lambda r:R(r,"rules"),
      "laya|strict":lambda r:P(r)>=tLR or R(r,"rules_strict"),"laya|loose":lambda r:P(r)>=tLRl or R(r,"rules")}
ys=[r["y"] for r in test]
print("\nTEST overall"); 
for k,f in sysm.items(): print(f"{k:14s}",prf([f(r) for r in test],ys))
print("\nTEST per family (hits/n; for benign = false positives/n)")
fams=collections.OrderedDict()
for r in test: fams.setdefault(r["family"],[]).append(r)
print(f"{'family':30s}"+"".join(f"{k:>14s}" for k in sysm))
for fa,rs in fams.items(): print(f"{fa:30s}"+"".join(f"{str(sum(f(r) for r in rs))+'/'+str(len(rs)):>14s}" for f in sysm.values()))
print("\nA1-A7")
for r in test:
    if r["family"]=="real_redteam" or r["origin"].startswith("gate"):
        o=r["origin"]; print(f"{o:28s} y={int(r['y'])} p={P(r):.3f} laya={int(P(r)>=tL)} strict={[k for k,v in r['rules_strict'].items() if v]} loose={[k for k,v in r['rules'].items() if v]}  note={json.loads(raw[r['id']]['state'])['note'][:90]!r}")
print("\nheld-out attacks caught by laya but missed by strict rules:")
for r in test:
    if r["y"] and P(r)>=tL and not R(r,"rules_strict"): print(" ",r["family"],round(P(r),3),repr(json.loads(raw[r['id']]['state'])['note'][:80]))
print("benign FPs laya (test):")
for r in test:
    if not r["y"] and P(r)>=tL: print(" ",r["family"],round(P(r),3),"strictFP" if R(r,"rules_strict") else "",repr(json.loads(raw[r['id']]['state'])['note'][:80]))
print("benign FPs strict rules (test):", sum(1 for r in test if not r['y'] and R(r,'rules_strict')))
# leakage check: loose-only terms hit in train vs test
def hits(rows,rx,base): return sum(1 for r in rows if rx.search(fold(json.loads(r['state'])['note'])) and not base.search(fold(json.loads(r['state'])['note'])))
tr=list(ld("train").values()); te=list(ld("test").values())
print("\nloose-only SPOOF hits train/test:",hits(tr,SPOOF,SPOOF_TRAIN),hits(te,SPOOF,SPOOF_TRAIN)," loose-only NOCHG hits train/test:",hits(tr,NOCHG,NOCHG_TRAIN),hits(te,NOCHG,NOCHG_TRAIN))
print("lat median ms (6q)",sorted(r["lat_ms"] for r in test)[len(test)//2], "single-q median",sorted(E["lat_single_q_ms"])[30],"peak rss MB",E["peak_rss_mb"])
print("\nSENSITIVITY (not used for selection): dev F1=1.0 for t in", [t for t in ths if prf([P(r)>=t for r in dev],[r['y'] for r in dev])['F1']==1.0][::10], "...")
for t in [0.1,0.5,0.9,0.94]:
    print(t,"laya|strict",prf([P(r)>=t or R(r,"rules_strict") for r in test],ys))
b=[r for r in test if r['family']=='benign_b_HELDOUT']
ad=[r for r in b if 'as discussed' in json.loads(raw[r['id']]['state'])['note']]
print("benign 'as discussed':",len(ad),"flagged",sum(P(r)>=0.5 for r in ad))
