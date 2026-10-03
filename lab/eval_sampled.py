"""CONFIRM-2: format-independent, noise-reduced eval. holdout128, n=4 samples T=0.6 top_p .95 top_k 20 seed 20261005,
thinking on, 16384 tokens. Per board: count of LENIENT-OK samples (0..4) and STRICT-OK samples. Saves per-board counts."""
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
    llm = LLM(model=mdl, tokenizer=MODEL, dtype="bfloat16", max_model_len=20480, gpu_memory_utilization=0.90, seed=20261005, enable_prefix_caching=True)
    chat = lambda p: tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True)
    t = time.time()
    o = llm.generate([chat(solve_prompt(c["board"])) for c in cases], SamplingParams(temperature=0.6, top_p=0.95, top_k=20, max_tokens=16384, n=4, seed=20261005))
    res = []
    for c, x in zip(cases, o):
        len_ok = sum(1 for s in x.outputs if (lambda p: p is not None and verify(c["board"], p) == "OK")(lenient(s.text)))
        str_ok = sum(1 for s in x.outputs if score(c["board"], s.text) == "OK")
        res.append({"id": c["id"], "band": c["band"], "lenient_ok": len_ok, "strict_ok": str_ok, "tokens": [len(s.token_ids) for s in x.outputs]})
    r = {"tag": tag, "lenient_total": sum(v["lenient_ok"] for v in res), "strict_total": sum(v["strict_ok"] for v in res), "of": 4 * len(cases), "gen_s": round(time.time() - t, 1), "cases": res}
    write(f"{out}/sampled_{tag}.json", r); print("SAMPLED", tag, r["lenient_total"], r["strict_total"], r["of"], r["gen_s"], flush=True)
if __name__ == "__main__":
    main()
