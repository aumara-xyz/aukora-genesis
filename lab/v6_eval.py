"""Gen-2 eval (vLLM): 32-holdout and 128-holdout on the gen-2 merged weights."""
import json, sys, time
from v5_common import *
from prompts import solve_prompt
def main():
    out, mdl = sys.argv[1], sys.argv[2]
    from vllm import LLM, SamplingParams
    tok = load_tok()
    llm = LLM(model=mdl, tokenizer=MODEL, dtype="bfloat16", max_model_len=20480, gpu_memory_utilization=0.90, seed=20261003, enable_prefix_caching=True)
    chat = lambda p: tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True)
    for tag, f in [("gen2_h32", "holdout.json"), ("gen2", "holdout128.json")]:
        cases = json.load(open(f))["cases"]; t = time.time()
        o = llm.generate([chat(solve_prompt(c["board"])) for c in cases], SamplingParams(temperature=0.0, max_tokens=16384))
        res = [{"id": c["id"], "verdict": score(c["board"], x.outputs[0].text), "tokens": len(x.outputs[0].token_ids)} for c, x in zip(cases, o)]
        r = {"tag": tag, "solved": sum(x["verdict"] == "OK" for x in res), "gen_s": round(time.time() - t, 1), "cases": res}
        write(f"{out}/confirm_{tag}.json", r); print("V6EVAL", tag, r["solved"], flush=True)
if __name__ == "__main__":
    main()
