"""Gen-2 stage B (vLLM on gen-1): hinted retries (k=4); rationalized targets keep the ORIGINAL prompt (no hint);
corpus = gen-1 replay + self + rationalized; locked forecast."""
import json, sys, time, re
from v5_common import *
from prompts import solve_prompt, FORECAST
def main():
    out, mdl = sys.argv[1], sys.argv[2]
    from vllm import LLM, SamplingParams
    tok = load_tok(); A = json.load(open(f"{out}/v6_A.json")); hints = json.load(open(f"{out}/v6_hints.json"))
    llm = LLM(model=mdl, tokenizer=MODEL, dtype="bfloat16", max_model_len=20480, gpu_memory_utilization=0.90, seed=20261003, enable_prefix_caching=True)
    chat = lambda p: tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True)
    todo = [f for f in A["failed"] if hints.get(f["id"])]
    t = time.time()
    o = llm.generate([chat(solve_prompt(f["board"]) + "\n\nA coach's hint: " + hints[f["id"]]) for f in todo],
                     SamplingParams(temperature=0.6, top_p=0.95, top_k=20, max_tokens=16384, n=4, seed=20261004)) if todo else []
    rat, retry_log = [], []
    for f, x in zip(todo, o):
        cands = sorted((len(c.token_ids), c.text) for c in x.outputs if score(f["board"], c.text) == "OK" and len(c.token_ids) <= 12288)
        retry_log.append({"id": f["id"], "ok": len(cands)})
        if cands:
            txt = re.sub(r"(?i)(the )?(coach'?s? )?hint", "idea", cands[0][1])   # strip hint references from target text
            rat.append({"id": f["id"], "prompt": solve_prompt(f["board"]), "target": txt, "target_tokens": cands[0][0], "via": "hint_rationalized"})
    replay = json.load(open(f"{out}/v5_corpus.json"))["corpus"]
    for r in replay: r["via"] = "replay_gen1"
    corpus = replay + A["direct"] + rat
    write(f"{out}/v6_corpus.json", {"n": len(corpus), "by_via": {v: sum(c["via"] == v for c in corpus) for v in ["replay_gen1", "self", "hint_rationalized"]},
                                    "sha256": sha(json.dumps(corpus, sort_keys=True)), "retry_log": retry_log, "corpus": corpus, "gen_s": round(time.time() - t, 1)})
    p1 = json.load(open(f"{out}/v5_P1.json"))["solved"]
    fp = FORECAST.format(p0_solved=p1, accepted_count=len(corpus), epochs=2)
    fo = llm.generate([chat(fp)], SamplingParams(temperature=0.0, max_tokens=4096))[0].outputs[0].text
    final = fo.split("</think>")[-1].strip()
    fval = int(final) if re.fullmatch(r"(?:[0-9]|[12][0-9]|3[0-2])", final) else None
    write(f"{out}/v6_forecast.json", {"prompt_sha256": sha(fp), "raw_final": final, "raw_sha256": sha(fo), "forecast": fval})
    print("V6B_DONE corpus", len(corpus), "rationalized", len(rat), "of", len(todo), "forecast", fval, flush=True)
if __name__ == "__main__":
    main()
