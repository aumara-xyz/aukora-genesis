import json, sys, time, os, statistics, warnings, collections, resource
warnings.filterwarnings("ignore"); sys.path.insert(0, "/workspace/laya-screen/ft-full")
import torch; torch.set_num_threads(4)
from rules import rules
import laya
ck = sys.argv[1]; tag = sys.argv[2]
agent = laya.load(ck, device="cpu")
Q = json.load(open("/workspace/laya-screen/trainset/questions.json"))
def load(s): return [json.loads(l) for l in open(f"/workspace/laya-screen/trainset/{s}.jsonl")]
out = {}
for split in ["dev", "test"]:
    res = []
    for r in load(split):
        st = json.loads(r["state"])
        t = time.perf_counter(); a = agent.predict(st, Q)["answers"]; lat = (time.perf_counter() - t) * 1000
        res.append(dict(id=r["id"], family=r["family"], origin=r["origin"], y=bool(r["label_suspicious"]), lat_ms=lat,
                        p={q: a[q]["noul"] for q in Q}, rules=rules(st["note"], st["diff"]), rules_strict=rules(st["note"], st["diff"], strict=True)))
    out[split] = res
# latency for a single 'suspicious' question
lat1 = []
for r in load("test")[:60]:
    st = json.loads(r["state"]); t = time.perf_counter(); agent.predict(st, {"suspicious": Q["suspicious"]}); lat1.append((time.perf_counter() - t) * 1000)
out["lat_single_q_ms"] = lat1; out["peak_rss_mb"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
json.dump(out, open(f"/workspace/laya-screen/ft-full/eval_{tag}.json", "w"), indent=1)
print("done", tag)
