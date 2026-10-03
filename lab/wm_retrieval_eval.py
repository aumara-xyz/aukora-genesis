"""RETRIEVAL eval (box, vLLM): single-shot, thinking on, 16384 new tokens, N_SAMPLES samples per board
(T=0.6 top_p .95 top_k 20). Every sample is its own n=1 request with an explicit seed SEED + 1000*board_index + 500 +
sample_index, IDENTICAL for both modes (no reliance on vLLM's internal child-seed rule for n>1, which would make sample 1
of board i share a seed with sample 0 of board i+1; the +500 offset keeps these seeds disjoint from wm_interactive's
20261009 + 1000*episode + turn, turn <= 12). Lenient + strict scoring as in eval_sampled / eval_forced
(posthoc_lenient.lenient -> sokoban.verify; v5_common.score).
MODE 'retrieval': the prompt = "Here are two similar puzzles with verified solutions:" + 2 entries
retrieved from wm_library.jsonl (wm_library.retrieve, k=2; never the query's canonical id; library is disjoint from
holdout128/holdout_v7 by construction and re-asserted here) + prompts.solve_prompt(board).
MODE 'none': prompts.solve_prompt(board) only (= the H-WM1 single-shot comparator and the H-WM2 control).
(Library entries are 50 base-model and 37 gen-1 solves, so the prefix does not claim "you solved"; see wm_library.)
Usage: python wm_retrieval_eval.py MODEL_DIR TAG OUT SETFILE N_SAMPLES [retrieval|none] [--library PATH]
       python wm_retrieval_eval.py --preflight SETFILE OUT TAG [retrieval|none]    (CPU only; real tokenizer)
Receipts (never overwritten): OUT/wm_retrieval_<TAG>.raw.json (full texts, written right after sampling) and
OUT/wm_retrieval_<TAG>.json (per-sample seed, verdicts, finish, tokens, think-close, token-checkpoint char offsets;
per-board counts and canonical ids). Not recorded: per-token logprobs (see wm_capture_spec.md section 3)."""
import collections, json, os, sys, time

from sokoban import verify
from prompts import solve_prompt
from posthoc_lenient import lenient
from v5_common import score
from wm_common import load_set, ckpt_chars, think_close_char, sha_file, write_json, run_versions, prereg_sha, LAB
import wm_library

SEED, MAXTOK, MAX_MODEL_LEN = 20261010, 16384, 20480
SAMPLING = {"temperature": 0.6, "top_p": 0.95, "top_k": 20}
SEED_OFFSET = 500
PREFIX_HEAD = "Here are two similar puzzles with verified solutions:"
HERE = os.path.dirname(os.path.abspath(__file__))
CODE = ("wm_retrieval_eval.py", "wm_library.py", "wm_common.py", "sokoban.py", "prompts.py", "v5_common.py", "posthoc_lenient.py")
MODES = ("retrieval", "none")


def retrieval_prefix(examples):
    s = PREFIX_HEAD + "\n"
    for i, e in enumerate(examples, 1):
        s += f"\nExample {i}:\n{e['board']}\nSolution: " + json.dumps({"moves": e["moves"]}) + "\n"
    return s + "\nNow the new puzzle.\n\n"


def build_prompts(cases, mode, lib, exclude_ids):
    out = []
    for c in cases:
        if mode == "retrieval":
            ex = wm_library.retrieve(c["board"], k=2, lib=lib, exclude_ids=exclude_ids)
            assert len(ex) == 2 and all(e["canonical_id"] != c["canonical_id"] for e in ex)
            out.append((retrieval_prefix(ex) + solve_prompt(c["board"]), [e["canonical_id"] for e in ex]))
        else:
            out.append((solve_prompt(c["board"]), []))
    return out


def sample_seed(i, j):
    return SEED + 1000 * i + SEED_OFFSET + j


def lverdict(board, text):
    p = lenient(text)
    return verify(board, p) if p else "NOPLAN"


def score_sample(tok, board, s, seed):
    return {"seed": seed, "finish": s.finish_reason, "tokens": len(s.token_ids), "think_close_char": think_close_char(s.text),
            "strict": score(board, s.text), "lenient": lverdict(board, s.text), "plan": lenient(s.text),
            "ckpt_chars": ckpt_chars(tok, s.token_ids), "tail": s.text[-300:]}


def totals(res):
    ss = [s for r in res for s in r["samples"]]
    bands = sorted({r["band"] for r in res if r.get("band")})
    return {"lenient_ok": sum(r["lenient_ok"] for r in res), "strict_ok": sum(r["strict_ok"] for r in res), "of": len(ss),
            "boards_any_lenient": sum(r["lenient_ok"] > 0 for r in res), "truncated": sum(s["finish"] == "length" for s in ss),
            "gen_tokens": sum(s["tokens"] for s in ss), "prompt_tokens": sum(r["prompt_tokens_per_sample"] * len(r["samples"]) for r in res),
            "lenient_verdicts": dict(collections.Counter(s["lenient"].split("@")[0] for s in ss)),
            "per_band": {b: sum(r["lenient_ok"] for r in res if r["band"] == b) for b in bands}}


def code_sha():
    return {f: sha_file(os.path.join(HERE, f)) for f in CODE}


def receipt_paths(out, tag):
    b = os.path.join(out, f"wm_retrieval_{tag}")
    return b + ".json", b + ".raw.json"


def parse_argv(argv):
    args, lib_path, i = [], wm_library.DEFAULT_PATH, 0
    flags = set()
    while i < len(argv):
        if argv[i] == "--library": lib_path = argv[i + 1]; i += 2; continue
        if argv[i].startswith("--"): flags.add(argv[i]); i += 1; continue
        args.append(argv[i]); i += 1
    return args, flags, lib_path


def setup(setfile, mode, lib_path):
    assert mode in MODES, mode
    raw, cases = load_set(setfile)
    lib = wm_library.load(lib_path) if mode == "retrieval" else None
    set_ids = {c["canonical_id"] for c in cases}
    if lib is not None:
        assert not (set_ids & {e["canonical_id"] for e in lib}), "library overlaps the eval set"
    return raw, cases, lib, set_ids


def preflight(setfile, out, tag, mode="retrieval", lib_path=wm_library.DEFAULT_PATH, tok=None, require_think=True):
    raw, cases, lib, set_ids = setup(setfile, mode, lib_path)
    for p in receipt_paths(out, tag): assert not os.path.exists(p), f"{p} exists; refusing to overwrite"
    if tok is None:
        from v5_common import load_tok
        tok = load_tok()
    ps = build_prompts(cases, mode, lib, set_ids)
    chats = [tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True) for p, _ in ps]
    worst = max(len(tok(c, add_special_tokens=False)["input_ids"]) for c in chats)
    assert worst + MAXTOK <= MAX_MODEL_LEN, worst
    tails = {c[c.rindex("<|im_start|>assistant"):] if "<|im_start|>assistant" in c else c[-40:] for c in chats}
    assert len(tails) == 1 and "</think>" not in next(iter(tails)), tails
    tail = next(iter(tails))
    if require_think:
        assert tail.rstrip().endswith("<think>"), f"generation tail does not open thinking: {tail!r}"
    used = collections.Counter(i for _, ids in ps for i in ids)
    print("WM_PREFLIGHT_OK retrieval mode", mode, "set", os.path.basename(setfile), "sha256", sha_file(setfile), "cases", len(cases),
          "worst_prompt_tokens", worst, "library_entries_used", len(used), "max_reuse", max(used.values()) if used else 0,
          "library_sha256", sha_file(lib_path) if lib is not None else None, "gen_tail", json.dumps(tail),
          "opens_think", tail.rstrip().endswith("<think>"), "code", json.dumps(code_sha()), flush=True)
    return worst


def main(argv=None, llm_factory=None, tok=None, sp_factory=None):
    args, flags, lib_path = parse_argv(sys.argv[1:] if argv is None else argv)
    if "--preflight" in flags:
        return preflight(args[0], args[1], args[2], args[3] if len(args) > 3 else "retrieval", lib_path, tok=tok)
    mdl, tag, out, setfile, n = args[0], args[1], args[2], args[3], int(args[4])
    mode = args[5] if len(args) > 5 else "retrieval"
    final_path, raw_path = receipt_paths(out, tag)
    for p in (final_path, raw_path): assert not os.path.exists(p), f"{p} exists; refusing to overwrite"
    raw, cases, lib, set_ids = setup(setfile, mode, lib_path)
    T0 = time.time(); versions = {}
    if llm_factory is None:
        from vllm import LLM, SamplingParams
        from v5_common import load_tok, MODEL
        versions = run_versions()
        tok = load_tok()
        llm = LLM(model=mdl, tokenizer=MODEL, dtype="bfloat16", max_model_len=MAX_MODEL_LEN, gpu_memory_utilization=0.90, seed=SEED,
                  enable_prefix_caching=True)
        sp_factory = lambda seed: SamplingParams(**SAMPLING, max_tokens=MAXTOK, n=1, seed=seed)
    else:
        llm = llm_factory()
    ps = build_prompts(cases, mode, lib, set_ids)
    chats = [tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True) for p, _ in ps]
    head = {"tag": tag, "mode": mode, "model": mdl, "set": os.path.basename(setfile), "set_sha256": sha_file(setfile), "n_samples": n,
            "versions": versions, "code_sha256": code_sha(), "library_sha256": sha_file(lib_path) if lib is not None else None,
            "sampling": {**SAMPLING, "max_tokens": MAXTOK, "n": n, "request_n": 1,
                         "seed_rule": f"{SEED} + 1000*board_index + {SEED_OFFSET} + sample_index (one n=1 request per sample)",
                         "thinking": True, "max_model_len": MAX_MODEL_LEN}, "prereg_sha256": prereg_sha(), "evidence_class": "EXPLORATORY"}
    reqs = [(i, j) for i in range(len(cases)) for j in range(n)]
    t = time.time()
    flat = llm.generate([chats[i] for i, _ in reqs], [sp_factory(sample_seed(i, j)) for i, j in reqs])
    gen_s = round(time.time() - t, 1)
    assert len(flat) == len(reqs) and all(len(x.outputs) == 1 for x in flat)
    o = [[flat[i * n + j].outputs[0] for j in range(n)] for i in range(len(cases))]
    write_json(raw_path, {**head, "stage": "raw", "gen_s": gen_s,
                          "cases": [{"id": c["id"], "canonical_id": c["canonical_id"], "retrieved": ids, "prompt_user": p,
                                     "samples": [{"seed": sample_seed(i, j), "finish": s.finish_reason, "tokens": len(s.token_ids), "text": s.text}
                                                 for j, s in enumerate(x)]}
                                    for i, (c, (p, ids), x) in enumerate(zip(cases, ps, o))]})
    res = []
    for i, (c, (p, ids), x) in enumerate(zip(cases, ps, o)):
        samples = [score_sample(tok, c["board"], s, sample_seed(i, j)) for j, s in enumerate(x)]
        res.append({"id": c["id"], "canonical_id": c["canonical_id"], "board": c["board"], "band": c.get("band"), "oracle_len": c.get("oracle_len"),
                    "retrieved": ids, "prompt_tokens_per_sample": len(tok(chats[i], add_special_tokens=False)["input_ids"]),
                    "lenient_ok": sum(s["lenient"] == "OK" for s in samples), "strict_ok": sum(s["strict"] == "OK" for s in samples),
                    "samples": samples})
    tt = totals(res)
    write_json(final_path, {**head, "stage": "final", "gen_s": gen_s, "wall_s": round(time.time() - T0, 1), "totals": tt, "cases": res})
    print("WM_RETRIEVAL_DONE", tag, mode, "lenient", tt["lenient_ok"], "strict", tt["strict_ok"], "of", tt["of"], "boards_any",
          tt["boards_any_lenient"], "truncated", tt["truncated"], "gen_s", gen_s, flush=True)
    return final_path


if __name__ == "__main__":
    main()
