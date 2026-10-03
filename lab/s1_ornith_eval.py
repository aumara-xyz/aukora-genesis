"""S1 Ornith eval with Laya intuition (box: hints on CPU torch, generation on vLLM). EXPLORATORY (H-S1b in s1_PREREG.md).
Two arms on the SAME boards, same engine instance, same sampling seed:
  A  plain   prompts.solve_prompt(board)
  B  hinted  the same prompt with the s1_lookahead block ("Intuition (fast estimates, may be wrong):" top-3 first pushes
             with P(solvable) / est. moves + known dead ends) inserted right before the final reply instruction.
Hints are computed BEFORE any generation by the trained value net on CPU (no GPU, no oracle: s1_lookahead.assert_no_oracle +
runtime tripwire) and written to OUT/s1_hints_<set>.json with a sha256 per hint text and over all hints; the run stage
re-verifies that file's sha and the value-net artifact shas before generating.
Sampling (like eval_sampled / CONFIRM-2): n=N, T=0.6, top_p 0.95, top_k 20, seed 20261010 (per request, so a request's
sample stream does not depend on chunking), thinking ON, max_tokens 16384, max_model_len 20480. Scoring per sample: lenient (posthoc_lenient.lenient: last {"moves": "..."} after </think>, verified)
and strict (v5_common.score). Receipt per board: lenient_ok / strict_ok per arm (0..N), tokens, finish reasons, whether the
plan starts with the hint's top-1 move string. Primary analysis: one-sided exact sign test B > A on per-board lenient counts.
Usage (cwd = lab):
  CUDA_VISIBLE_DEVICES= $T/python s1_ornith_eval.py --hints SETFILE OUT [--value-net DIR --expect-meta-sha SHA]     (training .venv)
  $V/python s1_ornith_eval.py MODEL_DIR TAG OUT SETFILE N [--chunk-boards 32] [--resume]                            (vLLM .venv)
  python s1_ornith_eval.py MODEL_DIR TAG OUT SETFILE N --mock [--hints-file F]                                       (Mac dry run)
Guards (2026-10-03 review, s1_PREREG amendment A1):
- Sealed sets are refused (any holdout*.json other than holdout.json / holdout128.json, e.g. holdout_v7, holdout_rep1,
  holdout_v8; and any set sharing a board with them) unless --allow-sealed.
- Hints: the value net must be the sealed artifact (meta.json sha == SEALED_META_SHA256 and every file sha == the
  receipt's), unless --value-net + --expect-meta-sha name another one; parity vs the artifact's reference scores <= 0.02;
  no hint line may hand over a solution (solving options / best-next lines are stripped, then asserted absent);
  --two-ply is refused for preregistered sets. The hints file records torch / transformers / threads / platform.
- Run (non-mock): the hints file must already exist (never built inline), must be 1-ply top-3, and its value-net record
  must carry non-null file shas, an existing dir, parity <= 0.02 and the sealed meta sha.
- Receipts are incremental: boards are generated in chunks (default 32 boards = 64 prompts x n), prompts interleaved
  [A_i, B_i] per board; after every chunk the scored rows AND raw texts are appended to OUT/s1_eval_<tag>.partial.jsonl
  (flush + fsync). --resume continues a stopped run from that file (same hints / set / n / sampling / model). The final
  receipt and raw file are built from the JSONL. Code shas are taken at start-up. Receipts are never overwritten.

INTERACTIVE HOOK (wm_interactive.py, not edited): per-turn injection is a runtime wrapper, e.g.
    import wm_interactive as wm, s1_lookahead as L, s1_tabu as TB
    orig = wm.Episode.apply_turn
    def apply_turn(self, *a, **k):
        orig(self, *a, **k)
        if not self.done:
            asst, obs = self.hist[-1]
            board = wm.render(self.walls, self.goals, self.boxes, self.player)
            obs2, _ = L.inject_into_observation(obs, board, LOOKAHEAD, tabu=TABU.get(self.case["id"]))
            self.hist[-1] = (asst, obs2); self.turn_log[-1]["reply"] = obs2
    wm.Episode.apply_turn = apply_turn
(and wrap wm.initial_prompt likewise for the start board; feed TABU via Tabu.record_attempt(self.path) on ILLEGAL turns /
RESET). install_wm_hook() below does exactly this. The value net must then run DURING generation: put it on the GPU
(vLLM gpu_memory_utilization <= 0.85 leaves room; ~1.6 GB fp32) or keep 1-ply on CPU; one batched scorer call per round
is the efficient form (all live episodes' push states in one forward)."""
import collections, glob, json, math, os, platform, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
SEED, MAXTOK, MAXLEN = 20261010, 16384, 20480
SAMPLING = {"temperature": 0.6, "top_p": 0.95, "top_k": 20, "seed": SEED, "max_tokens": MAXTOK, "thinking": True, "max_model_len": MAXLEN}
CODE = ("s1_ornith_eval.py", "s1_lookahead.py", "s1_value.py", "s1_common.py", "s1_tabu.py", "sokoban.py", "prompts.py",
        "posthoc_lenient.py", "v5_common.py")
REPLY_MARK = "\n\nReply with only a JSON object"
# the sealed value-net artifact (s1_laya_eval.json, H-S1a PASS as preregistered)
SEALED_META_SHA256 = "ad01782101478ff1fa0e2ace254361e503bcc5dd64736f8124ce17cf7f88f96a"
SEALED_FILES_SHA256 = {"encoder.safetensors": "b169fdef9591c1ba9cb4f4cf6caa49f689dcf3033113098c225c03521ee7eb95",
                       "head.safetensors": "f07f7377ef1660736fbfff74713983ec683b0802796b532a1490a15b599348e8",
                       "encoder_config.json": "bf3ab80598fdccf414855a2ce80f22859e4492d06ca8a62ddd1cfb63972f8979",
                       "tokenizer/tokenizer.json": "6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30"}
OPEN_SETS = ("holdout.json", "holdout128.json")       # already evaluated many times; every other holdout*.json is sealed
PREREG_SETS = ("holdout128.json",)                    # H-S1b set: 1-ply top-3 hints only
PARITY_MAX = 0.02
EXPLORATORY = ("EXPLORATORY - holdout128 already used by CONFIRM-1/2 and FORCED-1; a PASS only motivates a confirmatory "
               "rerun on a fresh sealed set")


def sha_bytes(b):
    import hashlib
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()


def sha_file(p):
    return sha_bytes(open(p, "rb").read())


def _sealed_set_files():
    pats = [os.path.join(HERE, "holdout*.json"), os.path.join(os.path.dirname(HERE), "ledger", "prereg", "holdout*.json")]
    return sorted({os.path.abspath(f) for p in pats for f in glob.glob(p) if os.path.basename(f) not in OPEN_SETS})


def load_cases(setfile, allow_sealed=False):
    """Refuses every sealed set (any holdout*.json other than OPEN_SETS) and any set sharing a board with one, unless
    allow_sealed (then only the named set itself is exempt from the overlap check)."""
    from sokoban import canonical_id
    base = os.path.basename(setfile)
    if base.startswith("holdout") and base not in OPEN_SETS:
        assert allow_sealed, f"{base} is a sealed set; refusing (pass --allow-sealed only for its own preregistered eval)"
    raw = open(setfile, "rb").read(); cases = json.loads(raw)["cases"]
    sealed_ids = {}
    for f in _sealed_set_files():
        if allow_sealed and os.path.basename(f) == base: continue
        try: sealed_ids.update({c["canonical_id"]: os.path.basename(f) for c in json.load(open(f))["cases"]})
        except (OSError, ValueError, KeyError, TypeError): continue
    for c in cases:
        cid = canonical_id(c["board"])
        assert c.get("canonical_id", cid) == cid, f"canonical id mismatch {c['id']}"
        assert cid not in sealed_ids, f"set overlaps sealed set {sealed_ids.get(cid)}; refusing"
    return raw, cases


def hinted_prompt(board, block):
    from prompts import solve_prompt
    p = solve_prompt(board); i = p.index(REPLY_MARK)
    return p[:i] + "\n\n" + block + p[i:]


def hints_path(out, setfile):
    return os.path.join(out, "s1_hints_" + os.path.splitext(os.path.basename(setfile))[0] + ".json")


def check_artifact(value_net, expect_meta_sha=None):
    """The value net must be the expected artifact: meta.json sha (temperatures + reference scores live there) and every
    file sha. Default expectation = the sealed artifact (and lab/s1_laya_eval.json, when present, must agree)."""
    exp = expect_meta_sha or SEALED_META_SHA256
    got = sha_file(os.path.join(value_net, "meta.json"))
    assert got == exp, f"value net meta.json sha {got[:12]} != expected {exp[:12]} (overwritten or wrong artifact?)"
    files = SEALED_FILES_SHA256 if exp == SEALED_META_SHA256 else json.load(open(os.path.join(value_net, "meta.json")))["files_sha256"]
    rec = os.path.join(HERE, "s1_laya_eval.json")
    if exp == SEALED_META_SHA256 and os.path.exists(rec):
        r = json.load(open(rec))
        assert r["artifact_meta_sha256"] == exp and r["artifact_files_sha256"] == files, "s1_laya_eval.json disagrees with the pinned shas"
    for f, h in files.items():
        assert sha_file(os.path.join(value_net, f)) == h, f"value net {f} sha mismatch"
    return got, files


# ---------------------------------------------------------------- stage 1: hints (CPU torch, before generation)
def make_hints(setfile, out, value_net=None, two_ply=False, device="cpu", scorer=None, tag_src=None, expect_meta_sha=None,
               allow_sealed=False):
    import torch
    import s1_lookahead as L
    import s1_value as V
    raw, cases = load_cases(setfile, allow_sealed)
    assert not (two_ply and os.path.basename(setfile) in PREREG_SETS), "two-ply hints are refused for a preregistered set (1-ply only)"
    path = hints_path(out, setfile)
    assert not os.path.exists(path), f"{path} exists; refusing to overwrite"
    code = {f: sha_file(os.path.join(HERE, f)) for f in CODE}
    value_net = value_net or os.path.join(HERE, "s1_laya")
    if scorer is None:
        meta_sha, files = check_artifact(value_net, expect_meta_sha)
        torch.set_num_threads(max(1, (os.cpu_count() or 2) - 1))
        model, tok, meta = V.load(value_net, device=device)
        scorer = V.Scorer(model, tok, meta, device=device)
        vn = {"dir": os.path.abspath(value_net), "files_sha256": meta["files_sha256"], "meta_sha256": meta_sha,
              "temperature_solvable": meta.get("temperature_solvable"), "temperature_dist": meta.get("temperature_dist")}
        ref = meta.get("reference_scores")
        assert ref, "artifact has no reference_scores; parity cannot be checked"
        got = [x["p_solvable"] for x in scorer(ref["boards"])]           # parity with the training machine's outputs
        dmax = max(abs(a - b) for a, b in zip(got, ref["p_solvable"]))
        vn["parity_max_abs_dp"] = dmax
        assert dmax <= PARITY_MAX, f"value net parity failure vs reference_scores: max |dp| = {dmax:.4f}"
    else:
        vn = {"dir": tag_src or "injected scorer (dry run)", "files_sha256": None}
    la = L.Lookahead(scorer, top_k=3, two_ply=two_ply)
    t = time.time(); rows = []
    for c in cases:
        r = la.analyze(c["board"])
        stripped = L.strip_solutions(r)
        assert not any(o.get("solves") or o.get("best_next", {}).get("solves") for o in r["options"])
        blk = L.render_block(r)
        assert "SOLVES" not in blk
        rows.append({"id": c["id"], "block": blk, "block_sha256": sha_bytes(blk), "ms": r["ms"], "n_actions": r.get("n_actions"),
                     "stripped_solution_lines": stripped, "top1_moves": r["options"][0]["moves"] if r["options"] else None,
                     "options": r["options"], "dead_ends": r["dead_ends"]})
    obj = {"set": os.path.basename(setfile), "set_sha256": sha_bytes(raw), "value_net": vn, "two_ply": two_ply, "top_k": 3,
           "device": device, "no_oracle": L.NO_ORACLE, "code_sha256": code,
           "prereg_sha256": sha_file(os.path.join(HERE, "s1_PREREG.md")) if os.path.exists(os.path.join(HERE, "s1_PREREG.md")) else None,
           "evidence_class": ("DRY RUN (injected scorer)" if vn["files_sha256"] is None else
                              "RAN (CPU value-net hints for H-S1b; " + EXPLORATORY + ")"),
           "env": {"torch": torch.__version__, "transformers": __import__("transformers").__version__, "threads": torch.get_num_threads(),
                   "platform": platform.platform(), "machine": platform.machine(), "python": platform.python_version()},
           "hints_sha256": sha_bytes(json.dumps([[x["id"], x["block"]] for x in rows])), "hint_s": round(time.time() - t, 1),
           "stripped_solution_lines_total": sum(x["stripped_solution_lines"] for x in rows), "cases": rows}
    os.makedirs(out, exist_ok=True)
    with open(path, "w") as f: json.dump(obj, f, indent=1)
    print("S1_HINTS", path, sha_file(path), "hints_sha256", obj["hints_sha256"], "boards", len(rows), "hint_s", obj["hint_s"], flush=True)
    return path


# ---------------------------------------------------------------- stage 2: generation + scoring
class _Out:
    def __init__(self, text, finish, ntok): self.text, self.finish_reason, self.token_ids = text, finish, [0] * ntok


class _Req:
    def __init__(self, outs): self.outputs = outs


class MockLLM:
    """Mac dry run: arm B answers with the hint's top-1 moves (plain words parsed back), arm A with a fixed plan.
    fail_after_calls: raise on that generate call (tests the incremental receipt / --resume path)."""
    def __init__(self, fail_after_calls=None): self.calls, self.fail_after = 0, fail_after_calls

    def generate(self, prompts, sp=None):
        import re
        self.calls += 1
        if self.fail_after is not None and self.calls > self.fail_after:
            raise RuntimeError("mock engine stopped (simulated box stop)")
        res = []
        for p in prompts:
            m = re.search(r"; moves ([UDLR]+)\. ", p)
            plan = m.group(1) if m else "UDLR"
            outs = [_Out("<think>mock reasoning</think>\n" + json.dumps({"moves": plan}), "stop", 12),
                    _Out("<think>mock truncated", "length", MAXTOK)]
            res.append(_Req(outs))
        return res


def _append_jsonl(path, objs):
    if os.path.exists(path) and os.path.getsize(path):
        with open(path, "rb") as f:
            f.seek(-1, 2); torn = f.read(1) != b"\n"
        if torn:                                         # a stop mid-write left a partial line: terminate it first
            with open(path, "a") as f: f.write("\n")
    with open(path, "a") as f:
        for o in objs: f.write(json.dumps(o) + "\n")
        f.flush(); os.fsync(f.fileno())


def _read_jsonl(path):
    out = []
    with open(path) as f:
        for line in f:
            try: out.append(json.loads(line))
            except ValueError: continue                  # a torn last line from a stop mid-write
    return out


def _check_hints(H, raw, mock):
    assert H["set_sha256"] == sha_bytes(raw), "hints were computed for a different set file"
    assert H["hints_sha256"] == sha_bytes(json.dumps([[x["id"], x["block"]] for x in H["cases"]])), "hints file tampered"
    vn = H["value_net"]
    if mock: return vn
    assert H["two_ply"] is False and H["top_k"] == 3, "hints must be the preregistered 1-ply top-3 form"
    assert vn.get("files_sha256"), "hints were not made by a verified value net (files_sha256 is null: dry-run / injected scorer)"
    assert os.path.isdir(vn["dir"]), f"value net dir {vn['dir']} not found on this machine"
    assert vn.get("parity_max_abs_dp") is not None and vn["parity_max_abs_dp"] <= PARITY_MAX, "hints lack a passing parity check"
    assert vn.get("meta_sha256") == SEALED_META_SHA256, "hints were made with a value net other than the sealed artifact"
    assert sha_file(os.path.join(vn["dir"], "meta.json")) == vn["meta_sha256"], "value net meta.json changed since hints were made"
    for f, h in vn["files_sha256"].items():
        assert sha_file(os.path.join(vn["dir"], f)) == h, f"value net {f} changed since hints were made"
    assert all("SOLVES" not in x["block"] for x in H["cases"]), "a hint block hands over a solution"
    return vn


def _score_board(c, h, outs, n, verify, lenient, score):
    row = {"id": c["id"], "band": c.get("band"), "hint_sha256": h["block_sha256"], "top1_moves": h["top1_moves"]}
    raw = []
    for arm, x in outs:
        ss = []
        for s in x.outputs[:n]:
            lp = lenient(s.text); lv = verify(c["board"], lp) if lp else "NOPLAN"
            st = score(c["board"], s.text)
            t1 = row["top1_moves"]
            ss.append({"finish": s.finish_reason, "tokens": len(s.token_ids), "lenient": lv, "strict": st,
                       "plan_starts_with_top1": bool(lp and t1 and lp.startswith(t1))})
            raw.append({"id": c["id"], "arm": arm, "text": s.text, "finish": s.finish_reason, "tokens": len(s.token_ids)})
        row[arm] = {"lenient_ok": sum(v["lenient"] == "OK" for v in ss), "strict_ok": sum(v["strict"] == "OK" for v in ss),
                    "truncated": sum(v["finish"] == "length" for v in ss), "follows_top1": sum(v["plan_starts_with_top1"] for v in ss),
                    "verdicts": dict(collections.Counter(v["lenient"].split("@")[0] for v in ss)),
                    "tokens": [v["tokens"] for v in ss]}
    return row, raw


def _sign(a, b):
    w = sum(y > x for x, y in zip(a, b)); l_ = sum(y < x for x, y in zip(a, b)); nn = w + l_
    p = 1.0 if nn == 0 else sum(math.comb(nn, k) for k in range(w, nn + 1)) / 2 ** nn
    return w, l_, p


def run(model_dir, tag, out, setfile, n, mock=False, hints_file=None, chunk_boards=32, resume=False, allow_sealed=False, llm=None):
    from sokoban import verify
    from posthoc_lenient import lenient
    from v5_common import score
    T0 = time.time()
    code = {f: sha_file(os.path.join(HERE, f)) for f in CODE}                 # at start-up: a missing file fails before any GPU work
    raw, cases = load_cases(setfile, allow_sealed)
    final = os.path.join(out, f"s1_eval_{tag}.json"); rawp = os.path.join(out, f"s1_eval_{tag}.raw.json")
    part = os.path.join(out, f"s1_eval_{tag}.partial.jsonl")
    for p in (final, rawp): assert not os.path.exists(p), f"{p} exists; refusing to overwrite"
    assert resume or not os.path.exists(part), f"{part} exists; pass --resume to continue that run (never overwritten)"
    hp = hints_file or hints_path(out, setfile)
    assert os.path.exists(hp), f"hints file {hp} missing: make it first with --hints (training .venv, CPU); it is never built inline"
    H = json.load(open(hp))
    vn = _check_hints(H, raw, mock)
    hint = {x["id"]: x for x in H["cases"]}
    assert [c["id"] for c in cases] == [x["id"] for x in H["cases"]]
    pa = {c["id"]: __import__("prompts").solve_prompt(c["board"]) for c in cases}
    pb = {c["id"]: hinted_prompt(c["board"], hint[c["id"]]["block"]) if hint[c["id"]]["block"] else pa[c["id"]] for c in cases}
    header = {"type": "header", "tag": tag, "model": model_dir, "set": os.path.basename(setfile), "set_sha256": sha_bytes(raw), "n": n,
              "mock": mock, "sampling": SAMPLING, "hints_file_sha256": sha_file(hp), "hints_sha256": H["hints_sha256"]}
    done = {}
    if os.path.exists(part):
        lines = _read_jsonl(part)
        h0 = lines[0] if lines and lines[0].get("type") == "header" else None
        assert h0 and all(h0[k] == header[k] for k in header if k != "type"), "partial file belongs to a different run; refusing to resume"
        done = {x["row"]["id"]: x for x in lines if x.get("type") == "board"}
    else:
        os.makedirs(out, exist_ok=True)
        _append_jsonl(part, [dict(header, code_sha256=code, utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))])
    instance = f"{os.getpid()}-{time.time_ns()}"
    _append_jsonl(part, [{"type": "start", "instance": instance, "resumed_boards": len(done), "code_sha256": code,
                          "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}])
    todo = [c for c in cases if c["id"] not in done]
    versions = {}
    if todo:
        if mock:
            llm, chat, sp = llm or MockLLM(), (lambda p: p), None
        else:
            import vllm
            from vllm import LLM, SamplingParams
            from v5_common import load_tok, MODEL
            versions["vllm"] = vllm.__version__
            tok = load_tok()
            chat = lambda p: tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True)
            llm = LLM(model=model_dir, tokenizer=MODEL, dtype="bfloat16", max_model_len=MAXLEN, gpu_memory_utilization=0.90, seed=SEED,
                      enable_prefix_caching=True)
            sp = SamplingParams(temperature=0.6, top_p=0.95, top_k=20, max_tokens=MAXTOK, n=n, seed=SEED)
        step = max(1, chunk_boards or len(todo))
        for k in range(0, len(todo), step):
            chunk = todo[k:k + step]
            prompts = [q for c in chunk for q in (chat(pa[c["id"]]), chat(pb[c["id"]]))]      # [A_i, B_i] interleaved per board
            t = time.time(); o = llm.generate(prompts, sp); gs = round(time.time() - t, 1)
            assert len(o) == 2 * len(chunk)
            recs = []
            for i, c in enumerate(chunk):
                row, rr = _score_board(c, hint[c["id"]], (("A", o[2 * i]), ("B", o[2 * i + 1])), n, verify, lenient, score)
                recs.append({"type": "board", "row": row, "raw": rr, "instance": instance, "chunk_gen_s": gs})
            _append_jsonl(part, recs)
            print("S1_CHUNK", tag, f"{k + len(chunk)}/{len(todo)}", "gen_s", gs, flush=True)
    # ---- final receipt from the JSONL (the receipt of record for every board)
    lines = _read_jsonl(part)
    recs = {x["row"]["id"]: x for x in lines if x.get("type") == "board"}
    assert set(recs) == {c["id"] for c in cases}, "partial file is missing boards"
    res = [recs[c["id"]]["row"] for c in cases]
    rawrows = [r for c in cases for r in recs[c["id"]]["raw"]]
    starts = [x for x in lines if x.get("type") == "start"]
    la, lb = [r["A"]["lenient_ok"] for r in res], [r["B"]["lenient_ok"] for r in res]
    w, l_, p = _sign(la, lb)
    sa, sb = [r["A"]["strict_ok"] for r in res], [r["B"]["strict_ok"] for r in res]
    ws, ls, ps = _sign(sa, sb)
    bands = sorted({r["band"] for r in res if r["band"]})
    gen_by_instance = {}
    for x in recs.values(): gen_by_instance.setdefault(x["instance"], set()).add(x["chunk_gen_s"])
    rep = {"tag": tag, "model": model_dir, "set": os.path.basename(setfile), "set_sha256": sha_bytes(raw), "n": n, "mock": mock,
           "evidence_class": "DRY RUN (mock LLM; plumbing only)" if mock else "RAN (" + EXPLORATORY + ", H-S1b)", "versions": versions,
           "sampling": SAMPLING, "hints_file": os.path.basename(hp), "hints_file_sha256": sha_file(hp), "hints_sha256": H["hints_sha256"],
           "value_net": vn, "code_sha256": code, "code_sha256_per_instance": {x["instance"]: x["code_sha256"] for x in starts},
           "engine_instances": len(gen_by_instance), "chunk_boards": chunk_boards,
           "gen_s": round(sum(sum(v) for v in gen_by_instance.values()), 1), "partial_file": os.path.basename(part),
           "partial_file_sha256": sha_file(part),
           "totals": {"A_lenient": sum(la), "B_lenient": sum(lb), "A_strict": sum(sa), "B_strict": sum(sb), "of": n * len(cases),
                      "A_truncated": sum(r["A"]["truncated"] for r in res), "B_truncated": sum(r["B"]["truncated"] for r in res),
                      "B_follows_top1": sum(r["B"]["follows_top1"] for r in res), "A_follows_top1": sum(r["A"]["follows_top1"] for r in res),
                      "per_band_lenient": {b: [sum(r["A"]["lenient_ok"] for r in res if r["band"] == b),
                                               sum(r["B"]["lenient_ok"] for r in res if r["band"] == b)] for b in bands}},
           "H_S1b": {"status": EXPLORATORY, "test": "one-sided exact sign test, per-board lenient count B > A, ties dropped",
                     "boards_up": w, "boards_down": l_, "p_one_sided": p,
                     "exploratory_signal": "B>A (p<=0.05)" if p <= 0.05 else "none (p>0.05)"},
           "secondary_strict_sign": {"boards_up": ws, "boards_down": ls, "p_one_sided": ps},
           "wall_s": round(time.time() - T0, 1), "cases": res}
    with open(rawp, "w") as f: json.dump({"tag": tag, "rows": rawrows}, f)
    with open(final, "w") as f: json.dump(rep, f, indent=1)
    print("S1_EVAL", tag, json.dumps(rep["totals"]), json.dumps(rep["H_S1b"]), final, flush=True)
    return final


def install_wm_hook(wm, lookahead, tabu_factory=None):
    """Runtime wrapper for wm_interactive (no file edits). tabu_factory(case) -> s1_tabu.Tabu or None."""
    import s1_lookahead as L
    tabus = {}
    orig_turn, orig_init = wm.Episode.apply_turn, wm.Episode.__init__

    def init(self, case, *a, **k):
        orig_init(self, case, *a, **k)
        tb = tabus.setdefault(case["id"], tabu_factory(case) if tabu_factory else None)
        self.initial, _ = L.inject_into_observation(self.initial, case["board"], lookahead, tabu=tb)

    def apply_turn(self, *a, **k):
        before = self.path
        orig_turn(self, *a, **k)
        tb = tabus.get(self.case["id"])
        last = self.turn_log[-1]
        req = last.get("requested") or ""
        if tb is not None and req and req != "RESET":
            if last.get("illegal_at") is not None:
                tb.record_attempt(before + req[:last["illegal_at"] + 1], final=False)     # blocked prefix
            elif self.path:
                tb.record_attempt(self.path, final=False)                                  # proven deadlocks on the way
        if not self.done:
            asst, obs = self.hist[-1]
            board = wm.render(self.walls, self.goals, self.boxes, self.player)
            cut = obs.rfind("\nReply with your next")                       # keep the reply instruction last
            head, tail = (obs[:cut], obs[cut:]) if cut >= 0 else (obs, "")
            obs2, _ = L.inject_into_observation(head, board, lookahead, tabu=tb)
            obs2 += tail
            self.hist[-1] = (asst, obs2); last["reply"] = obs2
    wm.Episode.__init__, wm.Episode.apply_turn = init, apply_turn
    return tabus


def main():
    takes_value = ("--value-net", "--expect-meta-sha", "--hints-file", "--chunk-boards")
    args, flags, kv, it = [], [], {}, iter(sys.argv[1:])
    for x in it:
        if x in takes_value: kv[x] = next(it)
        elif x.startswith("--"): flags.append(x)
        else: args.append(x)
    opt = lambda name, default=None: kv.get(name, default)
    if "--hints" in flags:
        return make_hints(args[0], args[1], value_net=opt("--value-net"), two_ply="--two-ply" in flags,
                          expect_meta_sha=opt("--expect-meta-sha"), allow_sealed="--allow-sealed" in flags)
    model_dir, tag, out, setfile, n = args[0], args[1], args[2], args[3], int(args[4])
    return run(model_dir, tag, out, setfile, n, mock="--mock" in flags, hints_file=opt("--hints-file"),
               chunk_boards=int(opt("--chunk-boards", 32)), resume="--resume" in flags, allow_sealed="--allow-sealed" in flags)


if __name__ == "__main__":
    main()
