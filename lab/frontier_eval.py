"""Frontier head-to-head via OpenRouter on holdout128 (NOT a sealed set). n=1 per board, same solve_prompt,
max_tokens 16384, lenient+strict scoring identical to Ornith evals. Hard spend cap from usage.cost. Key read from file, never printed."""
import json, os, re, sys, time, threading, concurrent.futures as cf, urllib.request, hashlib
sys.path.insert(0, os.path.dirname(__file__))
from sokoban import verify
from prompts import solve_prompt
MODEL, CAP, OUT = sys.argv[1], float(sys.argv[2]), sys.argv[3]
KEY = open(os.path.expanduser("~/aukora-nebius-run/.openrouter_key")).read().strip()
cases = json.load(open(os.path.join(os.path.dirname(__file__), "holdout128.json")))["cases"]
lock = threading.Lock(); spent = [0.0]; stop = [False]; res = {}
def lenient(final):
    m = re.findall(r'"moves"\s*:\s*"([UDLR]{1,64})"', final); return m[-1] if m else None
def strict(final):
    try:
        d = json.loads(final.strip()); return d["moves"] if isinstance(d, dict) and set(d) == {"moves"} else None
    except Exception: return None
def one(c):
    if stop[0]: return
    body = json.dumps({"model": MODEL, "messages": [{"role": "user", "content": solve_prompt(c["board"])}], "max_tokens": 16384, "temperature": 0.6}).encode()
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=body, headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    t = time.time()
    try: r = json.load(urllib.request.urlopen(req, timeout=900))
    except Exception as e:
        with lock: res[c["id"]] = {"error": repr(e)[:200]}
        return
    msg = r["choices"][0]["message"]; final = msg.get("content") or ""; u = r.get("usage") or {}
    lp, sp = lenient(final), strict(final)
    row = {"band": c["band"], "lenient": verify(c["board"], lp) if lp else "NOPLAN", "strict": verify(c["board"], sp) if sp else "FORMAT",
           "completion_tokens": u.get("completion_tokens"), "reasoning_tokens": (u.get("completion_tokens_details") or {}).get("reasoning_tokens"),
           "cost": u.get("cost"), "finish": r["choices"][0].get("finish_reason"), "s": round(time.time() - t, 1), "final_tail": final[-300:]}
    with lock:
        res[c["id"]] = row; spent[0] += float(u.get("cost") or 0)
        if spent[0] >= CAP: stop[0] = True
        done = len(res); ok = sum(1 for v in res.values() if v.get("lenient") == "OK")
        print(f"{done}/128 lenient_ok={ok} spent=${spent[0]:.2f}", flush=True)
        json.dump({"model": MODEL, "set": "holdout128", "n": 1, "spent": spent[0], "cap": CAP, "stopped_by_cap": stop[0], "results": res}, open(OUT, "w"), indent=1)
with cf.ThreadPoolExecutor(8) as ex: list(ex.map(one, cases))
ok = sum(1 for v in res.values() if v.get("lenient") == "OK"); sok = sum(1 for v in res.values() if v.get("strict") == "OK")
print("FRONTIER_DONE", MODEL, "lenient", ok, "strict", sok, "of", len(res), "spent", round(spent[0], 2), "stopped_by_cap", stop[0], flush=True)
