"""v8 eval (box, vLLM) = v7_eval.py with ONLY these changes: holdout_v8.json, seed 20261011, tags v8/v7/base, receipt prefix
v8_eval_, own sha in CODE, log prefixes V8_. Protocol otherwise identical to v7_eval (copy, not import, so the receipt hashes the
exact code that ran). holdout_v8.json (144 sealed), n=4 samples T=0.6 top_p .95 top_k 20 seed 20261011, thinking on,
max_tokens 16384. FORCED ANSWER: every sample with finish_reason=='length' that NEVER closed thinking ('</think>' not in
its text) is continued in the SAME engine from prompt_text + sample_text + "\\n</think>\\n\\n", greedy, max_tokens 96.
All other samples (stopped, or truncated after '</think>') keep forced == raw, so forcing can never lower a verdict.
Per sample: strict + lenient (posthoc_lenient.lenient), raw and forced. Per board: lenient_ok_raw, lenient_ok_forced,
strict_ok_raw, strict_ok_forced (0..4).
Receipts: OUT/v8_eval_<TAG>.raw.json (full sample texts + raw verdicts, written right after sampling, before forcing) and
OUT/v8_eval_<TAG>.json (final). Both are never overwritten: a re-run needs the old receipts moved aside + an AMENDMENTS entry.
If the forced pass raises, the error is recorded (forcing_complete=false, forced == raw) and the final receipt is still written.
Usage: python v8_eval.py <MODEL_DIR> <TAG> <OUT>      (cwd = lab)
       python v8_eval.py --preflight <OUT>             (CPU only, no vLLM: holdout, receipts-absent, template, prompts)"""
import collections, json, os, sys, time
from v5_common import *
from sokoban import verify
from prompts import solve_prompt
from posthoc_lenient import lenient

HOLDOUT, N, SEED, MAXTOK, FORCE_SUFFIX, FORCE_TOK = "holdout_v8.json", 4, 20261011, 16384, "\n</think>\n\n", 96
TAGS = ("v8", "v7", "base")
HERE = os.path.dirname(os.path.abspath(__file__))
CODE = ("v8_eval.py", "posthoc_lenient.py", "v5_common.py", "sokoban.py", "prompts.py")
SAMPLING = {"n": N, "temperature": 0.6, "top_p": 0.95, "top_k": 20, "seed": SEED, "max_tokens": MAXTOK, "thinking": True, "max_model_len": 20480}
FORCING = {"suffix": FORCE_SUFFIX, "max_tokens": FORCE_TOK, "temperature": 0.0, "rule": "finish_reason=='length' and '</think>' not in text"}


def lverdict(board, text):
    p = lenient(text)
    return verify(board, p) if p else "NOPLAN"


def needs_forcing(finish, text):
    return finish == "length" and "</think>" not in text


def score_sample(board, text, finish, ntok, forced=None):
    """forced = (forced_text, forced_ntok) for a sample selected by needs_forcing, else None (forced verdict = raw)."""
    sr, lr = score(board, text), lverdict(board, text)
    r = {"finish": finish, "tokens": ntok, "had_think_close": "</think>" in text, "strict_raw": sr, "lenient_raw": lr,
         "raw_tail": text[-400:], "forced_text": None, "forced_tokens": None, "strict_forced": sr, "lenient_forced": lr}
    if forced is not None:
        assert needs_forcing(finish, text)
        ft = text + FORCE_SUFFIX + forced[0]
        r.update({"forced_text": forced[0], "forced_tokens": forced[1], "strict_forced": score(board, ft), "lenient_forced": lverdict(board, ft)})
    return r


def board_counts(samples):
    ok = lambda k: sum(s[k] == "OK" for s in samples)
    return {"lenient_ok_raw": ok("lenient_raw"), "lenient_ok_forced": ok("lenient_forced"),
            "strict_ok_raw": ok("strict_raw"), "strict_ok_forced": ok("strict_forced")}


def totals(res):
    keys = ["lenient_ok_raw", "lenient_ok_forced", "strict_ok_raw", "strict_ok_forced"]
    t = {k: sum(r[k] for r in res) for k in keys}
    ss = [s for r in res for s in r["samples"]]
    t.update({"of": len(ss), "truncated": sum(s["finish"] == "length" for s in ss),
              "truncated_after_think_close": sum(s["finish"] == "length" and s["had_think_close"] for s in ss),
              "forced": sum(s["forced_text"] is not None for s in ss),
              "lenient_rescued": sum(s["lenient_raw"] != "OK" and s["lenient_forced"] == "OK" for s in ss),
              "strict_rescued": sum(s["strict_raw"] != "OK" and s["strict_forced"] == "OK" for s in ss),
              "lenient_lost": sum(s["lenient_raw"] == "OK" and s["lenient_forced"] != "OK" for s in ss),
              "strict_lost": sum(s["strict_raw"] == "OK" and s["strict_forced"] != "OK" for s in ss),
              "boards_any_lenient_forced": sum(r["lenient_ok_forced"] > 0 for r in res),
              "lenient_forced_verdicts": dict(collections.Counter(s["lenient_forced"].split("@")[0] for s in ss)),
              "per_band": {b: {k: sum(r[k] for r in res if r["band"] == b) for k in keys} for b in sorted({r["band"] for r in res})}})
    return t


def code_sha():
    return {f: sha(open(os.path.join(HERE, f), "rb").read()) for f in CODE}


def load_cases():
    raw = open(HOLDOUT, "rb").read(); cases = json.loads(raw)["cases"]
    assert len(cases) == 144 and len({c["canonical_id"] for c in cases}) == 144
    return raw, cases


def receipt_paths(out, tag):
    return f"{out}/v8_eval_{tag}.raw.json", f"{out}/v8_eval_{tag}.json"


def chat_fn(tok):
    return lambda p: tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True)


def preflight(out):
    raw, cases = load_cases()
    for tag in TAGS:
        for p in receipt_paths(out, tag): assert not os.path.exists(p), f"{p} exists; refusing to overwrite"
    chat = chat_fn(load_tok()); prompts = [chat(solve_prompt(c["board"])) for c in cases]
    gen = {p[p.rindex("<|im_start|>assistant"):] for p in prompts}
    assert len(gen) == 1 and "</think>" not in next(iter(gen)), gen
    print("V8_PREFLIGHT_OK eval holdout_sha256", sha(raw), "cases", len(cases), "gen_prompt_tail", json.dumps(gen.pop()),
          "code", json.dumps(code_sha()), flush=True)


def main():
    if sys.argv[1] == "--preflight": return preflight(sys.argv[2])
    mdl, tag, out = sys.argv[1], sys.argv[2], sys.argv[3]; T0 = time.time()
    raw_path, final_path = receipt_paths(out, tag)
    for p in (raw_path, final_path): assert not os.path.exists(p), f"{p} exists; refusing to overwrite (re-runs need an AMENDMENTS entry)"
    raw, cases = load_cases()
    import vllm
    from vllm import LLM, SamplingParams
    try:
        import torch, transformers; versions = {"vllm": vllm.__version__, "torch": torch.__version__, "transformers": transformers.__version__}
    except Exception:
        versions = {"vllm": vllm.__version__}
    tok = load_tok()
    llm = LLM(model=mdl, tokenizer=MODEL, dtype="bfloat16", max_model_len=SAMPLING["max_model_len"], gpu_memory_utilization=0.90, seed=SEED,
              enable_prefix_caching=True)
    chat = chat_fn(tok)
    prompts = [chat(solve_prompt(c["board"])) for c in cases]
    head = {"tag": tag, "model": mdl, "holdout": HOLDOUT, "holdout_sha256": sha(raw), "versions": versions, "code_sha256": code_sha(),
            "sampling": SAMPLING, "forcing": FORCING}
    t = time.time()
    o = llm.generate(prompts, SamplingParams(temperature=0.6, top_p=0.95, top_k=20, max_tokens=MAXTOK, n=N, seed=SEED))
    gen_s = round(time.time() - t, 1)
    assert len(o) == len(cases) and all(len(x.outputs) == N for x in o)
    write(raw_path, {**head, "stage": "sampled", "gen_s": gen_s,
                     "cases": [{"id": c["id"], "band": c["band"],
                                "samples": [{"finish": s.finish_reason, "tokens": len(s.token_ids), "strict_raw": score(c["board"], s.text),
                                             "lenient_raw": lverdict(c["board"], s.text), "text": s.text} for s in x.outputs]}
                               for c, x in zip(cases, o)]})
    jobs = [(ci, si) for ci, x in enumerate(o) for si, s in enumerate(x.outputs) if needs_forcing(s.finish_reason, s.text)]
    print("V8_EVAL", tag, "sampled", gen_s, "s; truncated", sum(s.finish_reason == "length" for x in o for s in x.outputs),
          "to_force", len(jobs), "raw receipt", raw_path, flush=True)
    t = time.time(); forced, ferr = {}, None
    if jobs:
        try:
            fo = llm.generate([prompts[ci] + o[ci].outputs[si].text + FORCE_SUFFIX for ci, si in jobs], SamplingParams(temperature=0.0, max_tokens=FORCE_TOK))
            assert len(fo) == len(jobs)
            forced = {j: (f.outputs[0].text, len(f.outputs[0].token_ids)) for j, f in zip(jobs, fo)}
        except Exception as ex:                       # keep the sampled results; H1 handling of this case is in the PREREG
            ferr = f"{type(ex).__name__}: {ex}"[:2000]; forced = {}
            print("V8_EVAL_WARN", tag, "forced pass failed:", ferr[:300], flush=True)
    forced_s = round(time.time() - t, 1)
    res = []
    for ci, (c, x) in enumerate(zip(cases, o)):
        samples = [score_sample(c["board"], s.text, s.finish_reason, len(s.token_ids), forced.get((ci, si))) for si, s in enumerate(x.outputs)]
        res.append({"id": c["id"], "band": c["band"], "oracle_len": c["oracle_len"], **board_counts(samples), "samples": samples})
    r = {**head, "stage": "final", "forcing_run": {"n_jobs": len(jobs), "n_forced": len(forced), "error": ferr},
         "forcing_complete": ferr is None and len(forced) == len(jobs),
         "totals": totals(res), "gen_s": gen_s, "forced_s": forced_s, "wall_s": round(time.time() - T0, 1), "cases": res}
    write(final_path, r)
    tt = r["totals"]
    print("V8_EVAL_DONE", tag, "lenient raw/forced", tt["lenient_ok_raw"], tt["lenient_ok_forced"], "strict raw/forced",
          tt["strict_ok_raw"], tt["strict_ok_forced"], "of", tt["of"], "trunc", tt["truncated"], "forced", tt["forced"],
          "lost", tt["lenient_lost"], "forcing_complete", r["forcing_complete"], flush=True)


if __name__ == "__main__":
    main()
