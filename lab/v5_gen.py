"""v5 stage A (vLLM): P0a, P0b on 32 holdouts; self-attempts on 96 procedural boards; locked forecast; seal corpus."""
import json, sys, time, random, collections
from v5_common import *
from sokoban import generate, solve, canonical_id
from prompts import solve_prompt, FORECAST

def main():
    out = sys.argv[1]; T0 = time.time()
    from vllm import LLM, SamplingParams
    tok = load_tok()
    hold = json.load(open("holdout.json"))["cases"]
    seen = {c["canonical_id"] for c in hold}
    # also exclude probe easy boards (seed 31_20261003) from training pool for cleanliness
    rng = random.Random(41_20261003); pool = []
    quota = {(4, 8): 32, (9, 16): 40, (17, 24): 24}; got = collections.Counter()
    while sum(got.values()) < 96:
        b = generate(rng); cid = canonical_id(b)
        if cid in seen: continue
        s, st = solve(b)
        if st != "SOLVED": continue
        for (lo, hi), q in quota.items():
            if lo <= len(s) <= hi and got[(lo, hi)] < q:
                seen.add(cid); got[(lo, hi)] += 1; pool.append({"id": f"T{len(pool):03d}", "board": b, "oracle_len": len(s)})
    llm = LLM(model=MODEL, dtype="bfloat16", max_model_len=20480, gpu_memory_utilization=0.90, seed=20261003, enable_prefix_caching=True)
    chat = lambda p: tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True)
    greedy = SamplingParams(temperature=0.0, max_tokens=16384)
    def evalrun(tag):
        t = time.time(); o = llm.generate([chat(solve_prompt(c["board"])) for c in hold], greedy)
        res = [{"id": c["id"], "verdict": score(c["board"], x.outputs[0].text), "tokens": len(x.outputs[0].token_ids), "finish": x.outputs[0].finish_reason} for c, x in zip(hold, o)]
        r = {"tag": tag, "solved": sum(x["verdict"] == "OK" for x in res), "gen_s": round(time.time() - t, 1), "cases": res}
        write(f"{out}/v5_{tag}.json", r); print(tag, r["solved"], r["gen_s"], flush=True); return r
    p0a = evalrun("P0a"); p0b = evalrun("P0b")
    noise = sum(1 for a, b in zip(p0a["cases"], p0b["cases"]) if (a["verdict"] == "OK") != (b["verdict"] == "OK"))
    t = time.time()
    sp = SamplingParams(temperature=0.6, top_p=0.95, top_k=20, max_tokens=16384, n=4, seed=20261003)
    o = llm.generate([chat(solve_prompt(p["board"])) for p in pool], sp)
    attempts, corpus = [], []
    for p, x in zip(pool, o):
        cands = [(len(c.token_ids), c.text, score(p["board"], c.text)) for c in x.outputs]
        ok = sorted([c for c in cands if c[2] == "OK" and c[0] <= 12288])
        attempts.append({"id": p["id"], "oracle_len": p["oracle_len"], "verdicts": [c[2] for c in cands], "tokens": [c[0] for c in cands]})
        if ok: corpus.append({"id": p["id"], "oracle_len": p["oracle_len"], "prompt": solve_prompt(p["board"]), "target": ok[0][1], "target_tokens": ok[0][0]})
    write(f"{out}/v5_attempts.json", {"pool": pool, "attempts": attempts, "gen_s": round(time.time() - t, 1),
                                      "tasks_with_ok": len(corpus), "samples_ok": sum(v == "OK" for a in attempts for v in a["verdicts"])})
    print("attempts", len(corpus), "tasks ok of", len(pool), round(time.time() - t, 1), flush=True)
    corpus = corpus[:64]
    write(f"{out}/v5_corpus.json", {"n": len(corpus), "sha256": sha(json.dumps(corpus, sort_keys=True)), "corpus": corpus})
    # locked forecast (thinking on), before any update
    fp = FORECAST.format(p0_solved=p0a["solved"], accepted_count=len(corpus), epochs=2)
    fo = llm.generate([chat(fp)], SamplingParams(temperature=0.0, max_tokens=4096))[0].outputs[0].text
    final = fo.split("</think>")[-1].strip()
    import re
    fval = int(final) if re.fullmatch(r"(?:[0-9]|[12][0-9]|3[0-2])", final) else None
    write(f"{out}/v5_forecast.json", {"prompt_sha256": sha(fp), "raw_final": final, "raw_sha256": sha(fo), "forecast": fval})
    write(f"{out}/v5_stageA.json", {"p0a": p0a["solved"], "p0b": p0b["solved"], "p0_flip_noise": noise, "corpus_n": len(corpus),
                                    "forecast": fval, "wall_s": round(time.time() - T0, 1)})
    print("STAGE_A_DONE", p0a["solved"], p0b["solved"], noise, len(corpus), fval, flush=True)

if __name__ == "__main__":
    main()
