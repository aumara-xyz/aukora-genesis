"""v8 COLLECT (box, vLLM; 'post' is CPU-only and also runs on the Mac). Runs the current champion candidate (MODEL_DIR; plan:
/dev/shm/merged_v7) on the v8 TRAINING pool (lab/v8_pool.json, 160 boards, never a sealed set):

  interactive  wm_interactive's own episode loop (imported, unmodified; interface-checked and sha-recorded), n=2 episodes per
               pool board, --commit-on-truncate, thinking ON, 4096 tokens per turn, final JSON {"moves": 1-8 UDLR}, the harness
               returns the new board. Receipts (wm_interactive's, never overwritten): OUT/wm_interactive_v8pool.{json,raw.json,
               turns.jsonl}. A crashed run is continued with --resume (wm_interactive replays the logged turns exactly).
  single       single-shot attempts on the same pool (prompts.solve_prompt, thinking ON, 16384 tokens, n=2, T=0.6 top_p .95
               top_k 20, seed 20261012); source (b) of the training data (verified full solutions). OUT/v8_single.json.
  post         CPU: replays every logged turn through wm_interactive.Episode (asserting each replayed turn record equals the
               logged one), captures the EXACT prompt messages the model saw at that turn (rebuilt from harness state only),
               the assistant text, the chosen moves and the harness observation, then grades the turn with v8_grade (oracle
               distance before / after the turn's legal moves, per-move labels, sound prefix). Writes OUT/v8_turns.jsonl (one
               line per turn; oracle fields live ONLY under the "oracle" key) and OUT/v8_collect_summary.json (+ single-shot
               plan grades).

Usage: python v8_collect.py interactive MODEL_DIR OUT [--resume]
       python v8_collect.py single MODEL_DIR OUT
       python v8_collect.py post OUT
       python v8_collect.py --preflight OUT          (CPU only: pool guard, wm interface, receipts absent, real tokenizer)"""
import collections, json, os, sys, time

from sokoban import parse, verify
from prompts import solve_prompt
import v8_common as C
import v8_grade as G

LAB = C.LAB
POOL = os.path.join(LAB, "v8_pool.json")
TAG = "v8pool"
N_INTER = 2
N_SINGLE, SINGLE_SEED, MAXTOK, MAXLEN = 2, 20261012, 16384, 20480
SINGLE_SAMPLING = {"n": N_SINGLE, "temperature": 0.6, "top_p": 0.95, "top_k": 20, "seed": SINGLE_SEED, "max_tokens": MAXTOK,
                   "thinking": True, "max_model_len": MAXLEN}
WI_REQUIRED = ("main", "preflight", "Episode", "Cfg", "new_episodes", "receipt_paths", "parse_reply", "MAX_PER_TURN", "MOVE_BUDGET",
               "MAX_TURNS", "TURN_TOKENS")
CODE = ("v8_collect.py", "v8_grade.py", "v8_common.py", "wm_interactive.py", "wm_common.py", "sokoban.py", "prompts.py", "v5_common.py",
        "posthoc_lenient.py")


def code_sha():
    return {f: C.sha_file(os.path.join(LAB, f)) for f in CODE if os.path.exists(os.path.join(LAB, f))}


def wi():
    import wm_interactive as WI
    missing = [a for a in WI_REQUIRED if not hasattr(WI, a)]
    assert not missing, f"wm_interactive interface changed (missing {missing}); re-check v8_collect before running"
    for m in ("messages", "apply_turn", "summary"):
        assert callable(getattr(WI.Episode, m, None)), f"wm_interactive.Episode.{m} missing"
    return WI


def pool_cases():
    raw = open(POOL, "rb").read(); cases = json.loads(raw)["cases"]
    assert len(cases) == 160 and len({c["canonical_id"] for c in cases}) == 160
    sealed, _ = C.sealed_union(require=("holdout.json", "holdout_v7.json", "holdout_rep1.json", "holdout_v8.json"))
    assert not (sealed & {c["canonical_id"] for c in cases}), "v8 pool overlaps a sealed set; refusing"
    return raw, cases


def paths(out):
    return {"single": os.path.join(out, "v8_single.json"), "turns": os.path.join(out, "v8_turns.jsonl"),
            "summary": os.path.join(out, "v8_collect_summary.json")}


# ---------------------------------------------------------------- interactive (wm_interactive's loop, unmodified)
def interactive(model_dir, out, resume=False, llm_factory=None, tok=None, sp_factory=None, log=print):
    WI = wi(); pool_cases()
    argv = [model_dir, TAG, out, POOL, str(N_INTER), "--commit-on-truncate"] + (["--resume"] if resume else [])
    log("V8_COLLECT interactive", json.dumps({"argv": argv, "wm_interactive_sha256": C.sha_file(os.path.join(LAB, "wm_interactive.py"))}))
    return WI.main(argv, llm_factory=llm_factory, tok=tok, sp_factory=sp_factory)


# ---------------------------------------------------------------- single-shot attempts on the pool
def single(model_dir, out, llm=None, tok=None, make_sp=None, log=print):
    from v5_common import score, load_tok, MODEL
    from posthoc_lenient import lenient
    p = paths(out)["single"]; assert not os.path.exists(p), f"{p} exists; refusing to overwrite"
    raw, cases = pool_cases(); T0 = time.time(); versions = {}
    if llm is None:
        import vllm
        from vllm import LLM, SamplingParams
        versions = {"vllm": vllm.__version__}
        tok = load_tok()
        llm = LLM(model=model_dir, tokenizer=MODEL, dtype="bfloat16", max_model_len=MAXLEN, gpu_memory_utilization=0.90,
                  seed=SINGLE_SEED, enable_prefix_caching=True)
        sp = SamplingParams(temperature=0.6, top_p=0.95, top_k=20, max_tokens=MAXTOK, n=N_SINGLE, seed=SINGLE_SEED)
    else:
        sp = make_sp()
    chat = lambda q: tok.apply_chat_template([{"role": "user", "content": q}], tokenize=False, add_generation_prompt=True, enable_thinking=True)
    prompts = [chat(solve_prompt(c["board"])) for c in cases]
    t = time.time(); o = llm.generate(prompts, sp); gen_s = round(time.time() - t, 1)
    assert len(o) == len(cases) and all(len(x.outputs) == N_SINGLE for x in o)
    res = []
    for c, x in zip(cases, o):
        ss = []
        for s in x.outputs:
            lp = lenient(s.text)
            ss.append({"finish": s.finish_reason, "tokens": len(s.token_ids), "strict": score(c["board"], s.text),
                       "lenient": verify(c["board"], lp) if lp else "NOPLAN", "lenient_plan": lp, "text": s.text})
        res.append({"id": c["id"], "band": c["band"], "oracle_len": c["oracle_len"], "canonical_id": c["canonical_id"], "samples": ss})
    tot = {"samples": sum(len(r["samples"]) for r in res), "strict_ok": sum(s["strict"] == "OK" for r in res for s in r["samples"]),
           "lenient_ok": sum(s["lenient"] == "OK" for r in res for s in r["samples"]),
           "truncated": sum(s["finish"] == "length" for r in res for s in r["samples"]),
           "per_band_strict_ok": dict(collections.Counter(r["band"] for r in res for s in r["samples"] if s["strict"] == "OK"))}
    rcpt = {"tag": TAG, "model": model_dir, "pool_sha256": C.sha_bytes(raw), "sampling": SINGLE_SAMPLING, "versions": versions,
          "code_sha256": code_sha(), "gen_s": gen_s, "wall_s": round(time.time() - T0, 1), "totals": tot, "cases": res}
    with open(p, "w") as f: json.dump(rcpt, f, indent=1)
    log("V8_COLLECT_SINGLE_DONE", json.dumps(tot))
    return p


# ---------------------------------------------------------------- post: replay + capture + grade (CPU)
def read_jsonl_ro(path):
    """Non-destructive jsonl read: a torn trailing fragment (crash mid-write) is ignored, never cut from the file."""
    raw = open(path, "rb").read(); torn = 0
    if raw and not raw.endswith(b"\n"):
        keep = raw.rfind(b"\n") + 1; torn = len(raw) - keep; raw = raw[:keep]
    return [json.loads(l) for l in raw.decode().splitlines() if l.strip()], torn


def _st(boxes, player):
    return {"boxes": sorted(list(b) for b in boxes), "player": list(player)}


def replay_turns(WI, cases, rows, n, config):
    """Yield (episode, turn_row, messages_before, state_before, total_moves_before) while replaying wm turns exactly."""
    cfg = WI.Cfg(commit=bool(config.get("commit_on_truncate")), notes=bool(config.get("notes")))
    eps = WI.new_episodes(cases, n, cfg)
    by = {e.idx: e for e in eps}
    for r in rows:
        ev = r.get("event")
        if ev == "turn":
            e = by[r["episode"]]
            assert not e.done and r["turn"] == e.turns + 1 and r["id"] == e.case["id"] and r["sample"] == e.sample, ("order", r["episode"], r["turn"])
            msgs = e.messages(); before = (e.boxes, e.player); tm = e.total_moves
            e.apply_turn(r["text"], r["finish"], r["ntok"], r["ptok"], r.get("commit_text"), r.get("commit_ntok", 0), r.get("ckpt_chars"),
                         r.get("commit_ptok", 0))
            assert e.turn_log[-1] == r["rec"], ("replayed turn record differs from the logged one", r["episode"], r["turn"])
            yield e, r, msgs, before, tm
        elif ev == "context_limit":
            by[r["episode"]].finish("context_limit")
    yield None, eps, None, None, None


def grade_turn(WI, e, rec, before, total_before):
    """Oracle grade of one turn (kept apart from everything the model saw)."""
    walls, goals = e.walls, e.goals
    dm = G.dist_map(walls, goals)
    d_before = dm.get(before[0], before[1]); d_after = dm.get(e.boxes, e.player)
    o = {"d_before": d_before, "d_after": d_after, "d_start_board": dm.get(e.boxes0, e.player0), "labels": None, "attempted": None,
         "sound_len": None, "delta": (d_before - d_after) if isinstance(d_before, int) and isinstance(d_after, int) else None}
    if rec["kind"] == "moves":
        att = rec["requested"][:WI.MAX_PER_TURN][:max(0, WI.MOVE_BUDGET - total_before)]
        g = G.grade_state(walls, goals, before[0], before[1], att)
        assert g["applied"] == rec["applied"] and g["illegal_at"] == rec["illegal_at"], ("grader/harness disagree", rec, g["applied"], g["illegal_at"])
        assert g["d_end"] == d_after
        o.update(labels=g["labels"], attempted=att, sound_len=g["sound_len"], counts=g["counts"],
                 fatal=("fatal" in g["labels"]), all_legal=(g["illegal_at"] is None))
    return o


def post(out, log=print):
    WI = wi(); raw, cases = pool_cases()
    fp, rp, _, jp = WI.receipt_paths(out, TAG)
    P = paths(out)
    for k in ("turns", "summary"): assert not os.path.exists(P[k]), f"{P[k]} exists; refusing to overwrite"
    rows, torn = read_jsonl_ro(jp)
    assert rows and rows[0].get("event") == "head", "turns.jsonl has no head line"
    head = rows[0]["head"]
    assert head["set_sha256"] == C.sha_bytes(raw), "turns.jsonl was not run on this v8_pool.json"
    n = int(head["n_samples"]); config = head["config"]
    complete = os.path.exists(fp)
    bycase = {c["id"]: c for c in cases}
    stats = collections.defaultdict(collections.Counter); nturn = 0
    with open(P["turns"] + ".tmp", "w") as f:
        for e, r, msgs, before, tm in replay_turns(WI, cases, rows[1:], n, config):
            if e is None:
                eps = r; break
            rec = r["rec"]; o = grade_turn(WI, e, rec, before, tm)
            c = bycase[r["id"]]; band = c["band"]
            row = {"episode": r["episode"], "id": r["id"], "band": band, "oracle_len": c["oracle_len"], "canonical_id": c["canonical_id"],
                   "sample": r["sample"], "turn": r["turn"], "seed": r["seed"], "messages": msgs, "text": r["text"],
                   "commit_text": r.get("commit_text"), "finish": r["finish"], "ntok": r["ntok"], "ptok": r["ptok"],
                   "moves": rec["applied"], "obs": rec["reply"], "rec": rec,
                   "state_before": _st(*before), "state_after": _st(e.boxes, e.player),
                   "oracle": o}
            f.write(json.dumps(row, sort_keys=True) + "\n"); nturn += 1
            s = stats[band]; s["turns"] += 1; s[f"kind_{rec['kind']}"] += 1
            s["truncated"] += r["finish"] == "length"; s["committed"] += bool(rec["committed"]); s["strict_format"] += bool(rec["strict_format"])
            if rec["kind"] == "moves":
                s["illegal"] += rec["illegal_at"] is not None; s["fatal"] += bool(o.get("fatal"))
                s["progress_turns"] += (o["delta"] or 0) > 0; s["progress_moves"] += max(0, o["delta"] or 0)
                s["moves_applied"] += len(rec["applied"])
                s["clean_progress"] += (o["delta"] or 0) > 0 and rec["illegal_at"] is None and not rec["committed"] and rec["think_closed"]
    os.replace(P["turns"] + ".tmp", P["turns"])
    ep_stats = collections.defaultdict(collections.Counter)
    for e in eps:
        b = e.case["band"]; ep_stats[b]["episodes"] += 1; ep_stats[b]["solved"] += bool(e.solved)
        ep_stats[b][f"end_{e.end_reason}"] += 1
        dm = G.dist_map(e.walls, e.goals); d0 = dm.get(e.boxes0, e.player0); d1 = dm.get(e.boxes, e.player)
        ep_stats[b]["end_unsolvable"] += d1 is None
        if isinstance(d0, int) and isinstance(d1, int): ep_stats[b]["dist_closed"] += d0 - d1
    single = {}
    if os.path.exists(P["single"]):
        sj = json.load(open(P["single"]))
        assert sj["pool_sha256"] == C.sha_bytes(raw)
        sc = collections.defaultdict(collections.Counter)
        for cse in sj["cases"]:
            board = bycase[cse["id"]]["board"]
            for s in cse["samples"]:
                t = sc[cse["band"]]; t["samples"] += 1; t["strict_ok"] += s["strict"] == "OK"; t["lenient_ok"] += s["lenient"] == "OK"
                t["truncated"] += s["finish"] == "length"
                if s.get("lenient_plan"):
                    g = G.grade(board, s["lenient_plan"])
                    t["plans"] += 1; t["plan_fatal"] += "fatal" in g["labels"]; t["plan_illegal"] += g["illegal_at"] is not None
                    t["sound_moves"] += g["sound_len"]
        single = {b: dict(v) for b, v in sorted(sc.items())}
    summ = {"pool_sha256": C.sha_bytes(raw), "turns_jsonl": os.path.basename(jp), "torn_tail_bytes_ignored": torn,
            "interactive_complete": complete, "turn_rows": nturn, "config": config, "n_samples": n, "code_sha256": code_sha(),
            "turns_by_band": {b: dict(v) for b, v in sorted(stats.items())},
            "episodes_by_band": {b: dict(v) for b, v in sorted(ep_stats.items())}, "single_by_band": single,
            "oracle_note": "oracle fields are under 'oracle' in v8_turns.jsonl; never shown to the model"}
    with open(P["summary"], "w") as f: json.dump(summ, f, indent=1)
    log("V8_COLLECT_POST_DONE", json.dumps({"turns": nturn, "complete": complete, "torn": torn,
                                           "by_band": {b: {k: v[k] for k in ("turns", "clean_progress", "illegal", "fatal")} for b, v in sorted(stats.items())}}))
    return P["turns"]


def preflight(out, tok=None):
    WI = wi(); raw, cases = pool_cases()
    P = paths(out); fp, rp, _, jp = WI.receipt_paths(out, TAG)
    for p in (P["single"], P["turns"], P["summary"], fp, rp, jp): assert not os.path.exists(p), f"{p} exists; refusing to overwrite"
    if tok is None:
        from v5_common import load_tok
        tok = load_tok()
    worst = WI.preflight(POOL, out, TAG, tok=tok)
    gen = {tok.apply_chat_template([{"role": "user", "content": solve_prompt(c["board"])}], tokenize=False, add_generation_prompt=True,
                                   enable_thinking=True).rsplit("<|im_start|>assistant", 1)[-1] for c in cases}
    assert len(gen) == 1 and "</think>" not in next(iter(gen)), gen
    print("V8_COLLECT_PREFLIGHT_OK pool_sha256", C.sha_bytes(raw), "cases", len(cases), "wm_worst_prompt_tokens", worst,
          "single_gen_tail", json.dumps(gen.pop()), "code", json.dumps(code_sha()), flush=True)


def main():
    a = sys.argv[1:]
    if a[0] == "--preflight": return preflight(a[1])
    if a[0] == "interactive": return interactive(a[1], a[2], resume="--resume" in a)
    if a[0] == "single": return single(a[1], a[2])
    if a[0] == "post": return post(a[1])
    raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
