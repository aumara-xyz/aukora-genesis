"""EXPLORATORY probe (not a hypothesis test): is the 0/32 floor caused by thinking-off / token budget / difficulty?"""
import json, re, sys, time, hashlib, random, collections
from vllm import LLM, SamplingParams
from transformers import AutoTokenizer
from sokoban import verify, generate, solve, canonical_id
from prompts import solve_prompt
def main():
    M, OUT = sys.argv[1], sys.argv[2]
    tok = AutoTokenizer.from_pretrained(M)
    tmpl = open(M + "/chat_template.jinja").read(); tok.chat_template = tmpl
    assert hashlib.sha256(tmpl.encode()).hexdigest() == "182e77dd83bd8e9ca818b240b82e28f243762cd5dda32e6eef327df7b1cd107e"
    hold = json.load(open("holdout.json"))["cases"]
    seen = {c["canonical_id"] for c in hold}; rng = random.Random(31_20261003); easy = []
    while len(easy) < 16:
        b = generate(rng); cid = canonical_id(b)
        if cid in seen: continue
        s, st = solve(b)
        if st == "SOLVED" and 4 <= len(s) <= 8: seen.add(cid); easy.append({"id": f"E{len(easy):02d}", "board": b, "oracle_len": len(s)})
    t = time.time()
    llm = LLM(model=M, dtype="bfloat16", max_model_len=20480, gpu_memory_utilization=0.90, seed=20261003)
    load_s = time.time() - t
    def run(cases, think, max_tokens):
        ps = [tok.apply_chat_template([{"role": "user", "content": solve_prompt(c["board"])}], tokenize=False, add_generation_prompt=True, enable_thinking=think) for c in cases]
        t = time.time(); outs = llm.generate(ps, SamplingParams(temperature=0.0, max_tokens=max_tokens)); dt = time.time() - t
        res = []
        for c, o in zip(cases, outs):
            txt = o.outputs[0].text; final = txt.split("</think>")[-1].strip()
            try: d = json.loads(final); strict = d["moves"] if set(d) == {"moves"} else None
            except Exception: strict = None
            m = re.findall(r'"moves"\s*:\s*"([UDLR]*)"', final); len_ = m[-1] if m else None
            res.append({"id": c["id"], "strict": verify(c["board"], strict) if strict else "FORMAT", "lenient": verify(c["board"], len_) if len_ else "NOPLAN",
                        "gen_tokens": len(o.outputs[0].token_ids), "finish": o.outputs[0].finish_reason, "tail": txt[-400:]})
        summ = {"n": len(res), "strict_ok": sum(r["strict"] == "OK" for r in res), "lenient_ok": sum(r["lenient"] == "OK" for r in res),
                "verdicts_lenient": collections.Counter(r["lenient"][:7] for r in res), "finish": collections.Counter(r["finish"] for r in res),
                "mean_tokens": sum(r["gen_tokens"] for r in res) / len(res), "gen_s": round(dt, 1)}
        print(json.dumps(summ), flush=True)
        return {"summary": summ, "cases": res}
    out = {"load_s": load_s,
           "B_easy_think_off": run(easy, False, 512),
           "C_easy_think_on": run(easy, True, 16384),
           "A_holdout_think_on": run(hold, True, 16384)}
    json.dump(out, open(OUT, "w"), indent=1, default=dict)


if __name__ == "__main__":
    main()
