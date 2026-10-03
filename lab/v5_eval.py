"""v5 stage C (vLLM): P1 on merged weights; preregistered outcome."""
import json, sys, time
from math import comb
from v5_common import *
from prompts import solve_prompt

def main():
    out = sys.argv[1]
    from vllm import LLM, SamplingParams
    tok = load_tok()
    hold = json.load(open("holdout.json"))["cases"]
    llm = LLM(model="/dev/shm/merged", tokenizer=MODEL, dtype="bfloat16", max_model_len=20480, gpu_memory_utilization=0.90, seed=20261003, enable_prefix_caching=True)
    chat = lambda p: tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True)
    t = time.time(); o = llm.generate([chat(solve_prompt(c["board"])) for c in hold], SamplingParams(temperature=0.0, max_tokens=16384))
    p1 = [{"id": c["id"], "verdict": score(c["board"], x.outputs[0].text), "tokens": len(x.outputs[0].token_ids)} for c, x in zip(hold, o)]
    write(f"{out}/v5_P1.json", {"solved": sum(x["verdict"] == "OK" for x in p1), "gen_s": round(time.time() - t, 1), "cases": p1})
    A = json.load(open(f"{out}/v5_stageA.json")); p0 = json.load(open(f"{out}/v5_P0a.json"))["cases"]
    b = sum(1 for x, y in zip(p0, p1) if x["verdict"] != "OK" and y["verdict"] == "OK")
    c = sum(1 for x, y in zip(p0, p1) if x["verdict"] == "OK" and y["verdict"] != "OK")
    n = b + c; pval = sum(comb(n, j) for j in range(b, n + 1)) / 2 ** n if n else 1.0
    s0, s1 = A["p0a"], sum(x["verdict"] == "OK" for x in p1)
    passed = pval <= 0.05 and (s1 - s0) > A["p0_flip_noise"]
    f = A["forecast"]
    o = {"outcome": "COMPLETE", "verdict": "PASS" if passed else "FAIL", "b": b, "c": c, "p_one_sided": pval, "P0a": s0, "P0b": A["p0b"],
         "p0_flip_noise": A["p0_flip_noise"], "P1": s1, "forecast": f, "forecast_grade": None if f is None else ("HIT" if f == s1 else "MISS"),
         "forecast_abs_err": None if f is None else abs(f - s1)}
    write(f"{out}/v5_outcome.json", o); print("OUTCOME", json.dumps(o), flush=True)

if __name__ == "__main__":
    main()
