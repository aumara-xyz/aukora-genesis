"""Gen-2 stage A (vLLM on gen-1 weights): k=4 self-attempts on 96 new boards; export failures for the coach."""
import json, sys, time, random, collections
from v5_common import *
from sokoban import generate, solve, canonical_id
from prompts import solve_prompt
def main():
    out, mdl = sys.argv[1], sys.argv[2]
    from vllm import LLM, SamplingParams
    tok = load_tok()
    excl = {c["canonical_id"] for c in json.load(open("holdout.json"))["cases"]} | {c["canonical_id"] for c in json.load(open("holdout128.json"))["cases"]}
    excl |= {canonical_id(p["board"]) for p in json.load(open(f"{out}/v5_attempts.json"))["pool"]}
    rng = random.Random(61_20261003); quota = {(9, 16): 32, (17, 32): 40, (33, 48): 24}; got = collections.Counter(); pool = []
    while len(pool) < 96:
        b = generate(rng); cid = canonical_id(b)
        if cid in excl: continue
        s, st = solve(b)
        if st != "SOLVED": continue
        for (lo, hi), q in quota.items():
            if lo <= len(s) <= hi and got[(lo, hi)] < q:
                excl.add(cid); got[(lo, hi)] += 1; pool.append({"id": f"U{len(pool):03d}", "board": b, "oracle_len": len(s)})
    llm = LLM(model=mdl, tokenizer=MODEL, dtype="bfloat16", max_model_len=20480, gpu_memory_utilization=0.90, seed=20261003, enable_prefix_caching=True)
    chat = lambda p: tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True)
    t = time.time()
    o = llm.generate([chat(solve_prompt(p["board"])) for p in pool], SamplingParams(temperature=0.6, top_p=0.95, top_k=20, max_tokens=16384, n=4, seed=20261003))
    attempts, direct, failed = [], [], []
    for p, x in zip(pool, o):
        cands = [(len(c.token_ids), c.text, score(p["board"], c.text)) for c in x.outputs]
        ok = sorted(c for c in cands if c[2] == "OK" and c[0] <= 12288)
        attempts.append({"id": p["id"], "oracle_len": p["oracle_len"], "verdicts": [c[2] for c in cands], "tokens": [c[0] for c in cands]})
        if ok: direct.append({"id": p["id"], "prompt": solve_prompt(p["board"]), "target": ok[0][1], "target_tokens": ok[0][0], "via": "self"})
        else:
            last = cands[0]; failed.append({"id": p["id"], "board": p["board"], "attempt": last[1].split("</think>")[-1].strip()[-300:], "verdict": last[2]})
    write(f"{out}/v6_A.json", {"pool": pool, "attempts": attempts, "direct": direct, "failed": failed, "gen_s": round(time.time() - t, 1)})
    print("V6A_DONE direct", len(direct), "failed", len(failed), round(time.time() - t, 1), flush=True)
if __name__ == "__main__":
    main()
