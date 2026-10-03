"""Confirmatory eval: 128 NEW sealed puzzles (seed 5120261003, bands 8-16:43, 17-32:43, 33-48:42), greedy thinking 16k, strict.
Usage: python confirm.py make holdout128.json | python confirm.py eval <model_dir> <tag> <out_dir>"""
import json, sys, time, random, collections
from v5_common import *
from sokoban import generate, solve, canonical_id
from prompts import solve_prompt

def make(path):
    excl = {c["canonical_id"] for c in json.load(open("holdout.json"))["cases"]}
    for f in ["/mnt/glm-data/aukora-run/out/v5_attempts.json"]:
        try: excl |= {canonical_id(p["board"]) for p in json.load(open(f))["pool"]}
        except FileNotFoundError: pass
    rng = random.Random(51_20261003); quota = {(8, 16): 43, (17, 32): 43, (33, 48): 42}; got = collections.Counter(); cases = []
    while len(cases) < 128:
        b = generate(rng); cid = canonical_id(b)
        if cid in excl: continue
        s, st = solve(b)
        if st != "SOLVED": continue
        for (lo, hi), q in quota.items():
            if lo <= len(s) <= hi and got[(lo, hi)] < q:
                excl.add(cid); got[(lo, hi)] += 1; cases.append({"id": f"C{len(cases):03d}", "band": f"{lo}-{hi}", "board": b, "canonical_id": cid, "oracle_len": len(s)})
    write(path, {"seed": 51_20261003, "cases": cases}); print(path, sha(open(path, "rb").read()))

def evaluate(model_dir, tag, out):
    from vllm import LLM, SamplingParams
    tok = load_tok(); cases = json.load(open("holdout128.json"))["cases"]
    llm = LLM(model=model_dir, tokenizer=MODEL, dtype="bfloat16", max_model_len=20480, gpu_memory_utilization=0.90, seed=20261003, enable_prefix_caching=True)
    chat = lambda p: tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True)
    t = time.time(); o = llm.generate([chat(solve_prompt(c["board"])) for c in cases], SamplingParams(temperature=0.0, max_tokens=16384))
    res = [{"id": c["id"], "band": c["band"], "verdict": score(c["board"], x.outputs[0].text), "tokens": len(x.outputs[0].token_ids)} for c, x in zip(cases, o)]
    r = {"tag": tag, "model": model_dir, "solved": sum(x["verdict"] == "OK" for x in res), "gen_s": round(time.time() - t, 1), "cases": res}
    write(f"{out}/confirm_{tag}.json", r); print("CONFIRM", tag, r["solved"], r["gen_s"], flush=True)

if __name__ == "__main__":
    make(sys.argv[2]) if sys.argv[1] == "make" else evaluate(sys.argv[2], sys.argv[3], sys.argv[4])
