"""FORCED-ANSWER test (H2): holdout128, n=4 samples T0.6/top_p.95/top_k20 seed 20261008, thinking on, 16384 tok.
For samples with finish_reason=='length': continue the SAME text with '\n</think>\n\n' and greedy 96 tokens in the same engine.
Score lenient+strict raw vs forced per sample; rescue = raw not OK and forced OK."""
import json, re, sys, time
from v5_common import *
from sokoban import verify
from prompts import solve_prompt
def lenient(final):
    m = re.findall(r'"moves"\s*:\s*"([UDLR]{1,64})"', final); return m[-1] if m else None
def judge(board, final):
    lp = lenient(final); return verify(board, lp) if lp else "NOPLAN"
def main():
    mdl, tag, out = sys.argv[1], sys.argv[2], sys.argv[3]
    from vllm import LLM, SamplingParams
    tok = load_tok(); cases = json.load(open("holdout128.json"))["cases"]
    llm = LLM(model=mdl, tokenizer=MODEL, dtype="bfloat16", max_model_len=20480, gpu_memory_utilization=0.90, seed=20261008, enable_prefix_caching=True)
    chat = lambda p: tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True)
    prompts = [chat(solve_prompt(c["board"])) for c in cases]
    t = time.time(); o = llm.generate(prompts, SamplingParams(temperature=0.6, top_p=0.95, top_k=20, max_tokens=16384, n=4, seed=20261008))
    cont, idx = [], []
    for i, x in enumerate(o):
        for j, s in enumerate(x.outputs):
            if s.finish_reason == "length": cont.append(prompts[i] + s.text + "\n</think>\n\n"); idx.append((i, j))
    f = llm.generate(cont, SamplingParams(temperature=0.0, max_tokens=96)) if cont else []
    forced = {k: r.outputs[0].text for k, r in zip(idx, f)}
    res = []
    for i, (c, x) in enumerate(zip(cases, o)):
        row = {"id": c["id"], "band": c["band"], "samples": []}
        for j, s in enumerate(x.outputs):
            raw_final = s.text.split("</think>")[-1] if "</think>" in s.text else ""
            rv = judge(c["board"], raw_final); fv = judge(c["board"], forced[(i, j)]) if (i, j) in forced else rv
            row["samples"].append({"finish": s.finish_reason, "tokens": len(s.token_ids), "raw": rv, "forced": fv, "forced_text": forced.get((i, j), "")[:200]})
        res.append(row)
    S = lambda k: sum(1 for r in res for s in r["samples"] if s[k] == "OK")
    rescued = sum(1 for r in res for s in r["samples"] if s["raw"] != "OK" and s["forced"] == "OK")
    rep = {"tag": tag, "raw_lenient_ok": S("raw"), "forced_lenient_ok": S("forced"), "rescued": rescued, "truncated": len(cont), "of": 4 * len(cases),
           "by_band_forced": {b: sum(1 for r in res if r["band"] == b for s in r["samples"] if s["forced"] == "OK") for b in ["8-16", "17-32", "33-48"]},
           "gen_s": round(time.time() - t, 1), "cases": res}
    write(f"{out}/forced_{tag}.json", rep); print("FORCED", tag, rep["raw_lenient_ok"], rep["forced_lenient_ok"], rep["rescued"], rep["truncated"], flush=True)
if __name__ == "__main__":
    main()
