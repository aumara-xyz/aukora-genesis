"""POST-HOC (labelled exploratory): re-run a model on holdout128 saving raw finals; score strict AND lenient
(lenient = last {"moves": "..."} object anywhere after </think>, code fences allowed). Same decoding as confirm.py."""
import json, re, sys, time
from v5_common import *
from sokoban import verify
from prompts import solve_prompt
def lenient(text):
    final = text.split("</think>")[-1] if "</think>" in text else ""
    m = re.findall(r'"moves"\s*:\s*"([UDLR]{1,64})"', final)
    return m[-1] if m else None
def main():
    mdl, tag, out = sys.argv[1], sys.argv[2], sys.argv[3]
    from vllm import LLM, SamplingParams
    tok = load_tok(); cases = json.load(open("holdout128.json"))["cases"]
    llm = LLM(model=mdl, tokenizer=MODEL, dtype="bfloat16", max_model_len=20480, gpu_memory_utilization=0.90, seed=20261003, enable_prefix_caching=True)
    chat = lambda p: tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True)
    o = llm.generate([chat(solve_prompt(c["board"])) for c in cases], SamplingParams(temperature=0.0, max_tokens=16384))
    res = []
    for c, x in zip(cases, o):
        t = x.outputs[0].text; lp = lenient(t)
        res.append({"id": c["id"], "strict": score(c["board"], t), "lenient": verify(c["board"], lp) if lp else "NOPLAN",
                    "tokens": len(x.outputs[0].token_ids), "final_tail": t.split("</think>")[-1][-300:] if "</think>" in t else ""})
    r = {"tag": tag, "strict_ok": sum(v["strict"] == "OK" for v in res), "lenient_ok": sum(v["lenient"] == "OK" for v in res), "cases": res}
    write(f"{out}/posthoc_lenient_{tag}.json", r); print("POSTHOC", tag, r["strict_ok"], r["lenient_ok"], flush=True)
if __name__ == "__main__":
    main()
