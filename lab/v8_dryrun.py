"""Mac-side DRY RUN for the v8 pipeline (no vLLM, no GPU). Mocks: a deterministic mock tokenizer, a mock interactive LLM (mixed
policy: oracle steps, non-strict replies, random moves, deadlock-seeking moves, truncation -> forced commit, no JSON, RESET,
>8-move replies), a fake `vllm` module for the single-shot stages. Real code paths exercised:
  v8_grade unit tests; v8_seal --scratch (secret-style env seed); v8_collect interactive (wm_interactive.main, unmodified, on the
  REAL v8_pool.json, n=2) + single + post (exact replay + oracle grading + harness/grader agreement asserts); v8_build_data on the
  mock turns + real v5_corpus / v6_A / v7_cp (guards: oracle vocabulary, sealed grids, replay check); v8_train preflight (mock
  tokenizer) and a REAL mini training run (Qwen2.5-0.5B stand-in from the local HF cache, CPU, a few short rows: LoRA, per-kind
  logging, 2 epochs, adapter save, merge + save); v8_train's merged_v7 deletion guard against the pulled v7_adapter (read-only);
  v8_eval.py for arms v7/v8/base on a SCRATCH seal (fake vllm; forced pass); wm_interactive eval for the three arms on the scratch
  seal; v8_analyze (PRIMARY, CO-PRIMARY, hard-band point GATE incl. a synthetic gate failure and a NOT_EVALUABLE case); PLANTED
  cases built from the REAL pulled holdout_v7 receipts (read-only): the "hybrid" (v7 on 8-16, base on 17-32/33-48: v7's
  hard-band skill lost) must NOT promote (it passed the draft gate), and v7 + 20 hard-board gains must promote;
  v8_driver_test.py (the REAL v8_run.sh/v8_eval.sh control flow with a simulated clock and stub stages); data-count projections.
Usage: python3 v8_dryrun.py [SCRATCH_DIR] [--no-train]"""
import collections, copy, hashlib, json, os, random, re, shutil, subprocess, sys, time, types

LAB = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, LAB)
import v8_common as C, v8_grade as G, v8_collect as K, v8_build_data as BD, v8_train as TR, v8_analyze as AN
import wm_interactive as WI, wm_common as WC
from sokoban import solve, parse, step, verify, canonical_id

LOG = []


def say(*a):
    s = " ".join(str(x) for x in a); LOG.append(s); print(s, flush=True)


class MockTok:
    pad_token_id = 0

    def apply_chat_template(self, msgs, tokenize=False, add_generation_prompt=True, enable_thinking=True):
        roles = [m["role"] for m in msgs]
        assert roles[0] == "user" and roles[-1] == "user" and all(a != b for a, b in zip(roles, roles[1:])), roles
        s = "".join(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n" for m in msgs)
        return s + ("<|im_start|>assistant\n<think>\n" if enable_thinking else "<|im_start|>assistant\n")

    def __call__(self, text, add_special_tokens=False):
        return {"input_ids": [0] * (len(text) // 4 + 1)}

    def decode(self, ids):
        return "x" * (4 * len(ids))

    def convert_tokens_to_ids(self, t):
        return 0


class Out:
    def __init__(self, text, finish, ntok=None):
        self.text, self.finish_reason = text, finish
        self.token_ids = [7] * (ntok if ntok is not None else max(1, len(text) // 4))


class Req:
    def __init__(self, outs): self.outputs = outs


class SP:
    def __init__(self, seed=0, max_tokens=4096, greedy=False, stop=None, n=1, **kw):
        self.seed, self.max_tokens, self.greedy, self.stop, self.n = seed, max_tokens, greedy, stop, n
        self.__dict__.update(kw)


def sp_inter(seed, max_tokens, greedy=False, stop=None):
    return SP(seed, max_tokens, greedy, stop)


def hrng(*k):
    return random.Random(int(hashlib.sha256("|".join(map(str, k)).encode()).hexdigest()[:15], 16))


def think(tag, n=12):
    return f"MOCK-THINK {tag}. " + "Player at (r,c); checking the next cells. " * n


def ans(tag, moves, extra=""):
    return think(tag) + "\n</think>\n\n" + json.dumps({"moves": moves}) + extra


def legal_moves(board):
    w, g, b, p = parse(board); out = []
    for m in "UDLR":
        r = step(w, b, p, m)
        if r is not None: out.append((m, frozenset(r[0]), r[1]))
    return out


def blocked_pair(board):
    w, g, b, p = parse(board)
    for m1 in "UDLR":
        r = step(w, b, p, m1)
        if r is None: return m1
        for m2 in "UDLR":
            if step(w, frozenset(r[0]), r[1], m2) is None: return m1 + m2
    return "UUUUUUUU"


# ------------------------------------------------------------------ mock interactive LLM (collection + interactive eval)
P_ORACLE = {"v7": 0.42, "v8": 0.55, "base": 0.30}


class MockInteractive:
    def __init__(self, arm):
        self.arm, self.calls = arm, collections.Counter()

    def generate(self, prompts, sps):
        assert len(prompts) == len(sps)
        commit = bool(prompts) and prompts[0].endswith(WI.COMMIT_SUFFIX)
        self.calls["commit" if commit else "turn"] += 1
        return [Req([self.one(p, sp, commit)]) for p, sp in zip(prompts, sps)]

    def one(self, prompt, sp, commit):
        grids = list(WC.grids_in_text(prompt)); cur = grids[-1]
        s, st = solve(cur); s = s or ""
        if commit:
            assert sp.greedy and sp.stop == ['"']
            return Out((s[:3] or "U") + '"}', "stop")
        rng = hrng(self.arm, sp.seed, cur); r = rng.random(); po = P_ORACLE[self.arm]; tag = f"{self.arm}-{sp.seed}"
        k = rng.randint(1, 6)
        if r < po: return Out(ans(tag, s[:k] or "U"), "stop")
        r -= po
        if r < 0.08: return Out(ans(tag, s[:k] or "U", "\nThat should push the box."), "stop")        # progress, not strict
        if r < 0.20: return Out(ans(tag, "".join(rng.choice("UDLR") for _ in range(k))), "stop")    # random
        if r < 0.27:                                                                                   # deadlock-seeking
            w, g, b, p = parse(cur); dm = G.dist_map(w, g)
            fat = [m for m, nb, np_ in legal_moves(cur) if dm.get(nb, np_) is None]
            return Out(ans(tag, fat[0] if fat else blocked_pair(cur)), "stop")
        if r < 0.37: return Out(think(tag, 300), "length", ntok=sp.max_tokens)                       # truncation -> commit
        if r < 0.41: return Out(think(tag) + "\n</think>\n\nI will move right twice.", "stop")       # no JSON
        if r < 0.44: return Out(ans(tag, "RESET"), "stop")
        if r < 0.50: return Out(ans(tag, (s + "UDUDUDUDUD")[:10]), "stop")                           # >8 -> clipped
        return Out(ans(tag, blocked_pair(cur)), "stop")                                                # illegal


# ------------------------------------------------------------------ fake vllm (single-shot collect + v8_eval)
P_SOLVE = {"base": 0.22, "v7": 0.30, "v8": 0.40}
FORCE_SUFFIX = "\n</think>\n\n"


class FakeLLM:
    def __init__(self, model=None, **kw):
        self.arm = os.path.basename(str(model)).replace("mock_", "")

    def generate(self, prompts, sp):
        if isinstance(sp, list): raise AssertionError("single-shot path uses one SamplingParams")
        return [Req([self.one(p, sp, j) for j in range(getattr(sp, "n", 1) or 1)]) for p in prompts]

    def one(self, prompt, sp, j):
        board = WC.board_from_solve_prompt(prompt); s, _ = solve(board); L = len(s)
        rng = hrng(self.arm, board, j, getattr(sp, "seed", 0), prompt.endswith(FORCE_SUFFIX))
        if prompt.endswith(FORCE_SUFFIX):
            return Out(json.dumps({"moves": s}) if rng.random() < 0.3 else "Let me restart the analysis.", "length", 96)
        p = P_SOLVE[self.arm] * (1.0 if L <= 16 else 0.55 if L <= 32 else 0.1); r = rng.random(); tag = f"{self.arm}-{j}"
        if r < p: return Out(ans(tag, s), "stop")
        if r < p + 0.08: return Out(think(tag) + "\n</think>\n\n```json\n" + json.dumps({"moves": s}) + "\n```", "stop")
        if r < p + 0.30: return Out(ans(tag, blocked_pair(board)), "stop")
        if r < p + 0.50: return Out(think(tag, 300), "length", ntok=getattr(sp, "max_tokens", 16384))
        return Out(ans(tag, legal_moves(board)[0][0]), "stop")


def install_fake_vllm():
    m = types.ModuleType("vllm"); m.__version__ = "mock-0"; m.LLM = FakeLLM
    m.SamplingParams = lambda **kw: SP(**kw)
    sys.modules["vllm"] = m


# ------------------------------------------------------------------ stages
def stage_grader_tests():
    r = subprocess.run([sys.executable, os.path.join(LAB, "v8_grade_test.py")], capture_output=True, text=True, cwd=LAB)
    tail = (r.stderr or r.stdout).strip().splitlines()[-3:]
    say("GRADER_TESTS rc", r.returncode, "|", " ".join(tail)); assert r.returncode == 0
    return " ".join(tail)


def stage_scratch_seal(scr):
    path = os.path.join(scr, "holdout_v8_scratch.json")
    env = dict(os.environ, V8_SEAL_SEED=str(random.SystemRandom().randrange(1 << 62)))
    r = subprocess.run([sys.executable, os.path.join(LAB, "v8_seal.py"), path, "--scratch"], capture_output=True, text=True, cwd=LAB, env=env)
    say("SCRATCH_SEAL rc", r.returncode, r.stdout.strip().splitlines()[-1][:160] if r.stdout.strip() else r.stderr[-400:]); assert r.returncode == 0
    cs = json.load(open(path))["cases"]; ids = {c["canonical_id"] for c in cs}
    real = {c["canonical_id"] for c in json.load(open(os.path.join(LAB, "holdout_v8.json")))["cases"]}
    pool = {c["canonical_id"] for c in json.load(open(os.path.join(LAB, "v8_pool.json")))["cases"]}
    assert len(cs) == 144 and not (ids & real) and not (ids & pool)
    # refusal checks: real path with a public seed, and a non-default path without --scratch
    r2 = subprocess.run([sys.executable, os.path.join(LAB, "v8_seal.py"), os.path.join(scr, "x.json")], capture_output=True, text=True, cwd=LAB,
                        env=dict(os.environ, V8_SEAL_SEED="12345"))
    assert r2.returncode != 0 and "refusing" in (r2.stdout + r2.stderr)
    return path


def stage_collect(out):
    t = time.time()
    fp = K.interactive("mock_v7", out, llm_factory=lambda: MockInteractive("v7"), tok=MockTok(), sp_factory=sp_inter, log=say)
    fin = json.load(open(fp)); tt = fin["totals"]
    say("COLLECT_I episodes", tt["episodes"], "solved", tt["solved"], "turns", tt["turns"], "illegal", tt["illegal"], "committed", tt["committed_turns"],
        "end", json.dumps(tt["end_reasons"]), f"{time.time() - t:.1f}s")
    try:
        K.interactive("mock_v7", out, llm_factory=lambda: MockInteractive("v7"), tok=MockTok(), sp_factory=sp_inter, log=say)
        raise RuntimeError("overwrite not refused")
    except AssertionError as ex:
        assert "refusing" in str(ex)
    sp = K.single("mock_v7", out, llm=FakeLLM("mock_v7"), tok=MockTok(), make_sp=lambda: SP(n=2, seed=K.SINGLE_SEED, max_tokens=16384), log=say)
    tp = K.post(out, log=say)
    rows = [json.loads(l) for l in open(tp)]
    assert len(rows) == tt["turns"], (len(rows), tt["turns"])
    # every logged turn: state chaining, grader/harness agreement (asserted inside post), oracle kept under 'oracle' only
    by_ep = collections.defaultdict(list)
    for r in rows: by_ep[r["episode"]].append(r)
    for ep, rs in by_ep.items():
        for a, b in zip(rs, rs[1:]): assert a["state_after"] == b["state_before"] and b["turn"] == a["turn"] + 1
        for r in rs:
            p = "\n".join(m["content"] for m in r["messages"])
            for w in BD.ORACLE_WORDS: assert w not in p
    lab = collections.Counter(l for r in rows for l in (r["oracle"]["labels"] or []))
    summ = json.load(open(os.path.join(out, "v8_collect_summary.json")))
    say("POST rows", len(rows), "move labels", json.dumps(dict(lab)))
    return {"interactive_totals": {k: tt[k] for k in ("episodes", "solved", "turns", "illegal", "committed_turns", "end_reasons")},
            "move_labels": dict(lab), "summary_turns_by_band": summ["turns_by_band"], "single_by_band": summ["single_by_band"]}


def stage_build(out):
    p = BD.build(out, log=say); d = json.load(open(p))
    rep = d["report"]
    assert rep["short_unit_frac"] <= BD.SHORT_MAX + 1e-6 and rep["turn_hard_frac"] >= BD.HARD_MIN and rep["turn1_frac"] <= BD.TURN1_MAX + 1e-6
    assert rep["turn_walk_only"] == 0 and d["replay_checked_turns"] == d["turn_selection"]["final"]
    tl = [x for x in d["items"] if x["kind"] == "turn"]
    assert all(x["band"] == BD.band_of_len(x["d_before"]) and x["selection"]["pushes"] >= 1 and x["selection"]["eff"] >= BD.MIN_EFF for x in tl)
    assert all(not (x["selection"]["solved_after"] and x["selection"]["applied_len"] < len(json.loads(x["target"].split("</think>")[-1])["moves"])) for x in tl)
    assert sum(x["kind"] == "cp" for x in d["items"]) == 600
    # guard tests: oracle vocabulary in a prompt -> refused; a sealed grid inside a target -> dropped
    sealed, _ = C.sealed_union(require=("holdout.json", "holdout_v7.json", "holdout_rep1.json", "holdout_v8.json"))
    it = copy.deepcopy(d["items"][0]); it["messages"][0]["content"] += "\nd_before=7"
    try:
        BD.guard([it], sealed); raise RuntimeError("oracle vocabulary not refused")
    except AssertionError as ex:
        assert "oracle vocabulary" in str(ex)
    it = copy.deepcopy(d["items"][0]); sb = json.load(open(os.path.join(LAB, "holdout_v8.json")))["cases"][0]["board"]
    it["target"] = it["target"].replace("</think>", "\n" + sb + "\n</think>", 1)
    kept, dropped = BD.guard([it], sealed); assert not kept and sum(dropped.values()) == 1
    say("BUILD_GUARDS ok (oracle vocabulary refused; sealed grid dropped)")
    return {"report": rep, "turn_selection": d["turn_selection"], "trimmed": d["trimmed_for_mix_rules"],
            "sealed_grid_drops": d["sealed_grid_drops"], "inputs_single": d["inputs"]["v8_single"], "inputs_v6": {k: v for k, v in d["inputs"]["v6_A"].items() if k != "sha256"}}


def stage_train(out, scr, do_train=True):
    stats, units = TR.preflight(out, tok=MockTok())
    res = {"preflight_units_per_epoch": units, "preflight_tokstats_mock": stats}
    TR.check_v7_rebuildable(os.path.join(C.PULLED, "out")); res["v7_rebuildable_guard"] = "OK (pulled v7_adapter matches v7_train.json)"
    say("TRAIN_PREFLIGHT units/epoch", units, "| merged_v7 deletion guard OK on pulled v7_adapter")
    if not do_train: return res
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM
    try:
        qt = AutoTokenizer.from_pretrained("Qwen/Qwen2.5-0.5B-Instruct", local_files_only=True)
    except Exception as ex:
        say("MINI_TRAIN skipped: stand-in tokenizer unavailable", type(ex).__name__); return res
    from huggingface_hub import snapshot_download
    md = snapshot_download("Qwen/Qwen2.5-0.5B-Instruct", local_files_only=True)
    d = json.load(open(os.path.join(out, "v8_data.json"))); items = d["items"]
    pick = sorted([x for x in items if x["kind"] == "cp"], key=lambda x: len(x["target"]))[:12]
    for k in ("turn", "single"):
        pick += sorted([x for x in items if x["kind"] == k], key=lambda x: len(x["target"]) + sum(len(m["content"]) for m in x["messages"]))[:2]
    mo = os.path.join(scr, "mini_out"); os.makedirs(mo, exist_ok=True)
    pick = [{k: v for k, v in x.items() if k != "ptok"} for x in pick]   # ptok was counted by the MOCK collection tokenizer
    with open(os.path.join(mo, "v8_data.json"), "w") as f:
        json.dump({"items": pick, "items_sha256": C.sha_bytes(json.dumps(pick, sort_keys=True)), "report": {"mini": True}}, f)

    def loader(model_dir, device):
        m = AutoModelForCausalLM.from_pretrained(model_dir, torch_dtype=torch.float32)
        names = [n for n, x in m.named_modules() if isinstance(x, torch.nn.Linear) and re.search(r"self_attn\.(q|k|v|o)_proj$", n)]
        return m, names
    save = os.path.join(scr, "mini_merged_v8"); t = time.time()
    rc = TR.main([mo, str(time.time() + 3600)], loader=loader, tok=qt, save=save, model_dir=md, device="cpu", max_tokens=2048, log=say)
    ok = os.path.isfile(os.path.join(mo, "v8_adapter", "adapter_model.safetensors")) and os.path.isfile(os.path.join(mo, "v8_adapter", "epoch1", "adapter_model.safetensors"))
    nk = collections.Counter(x["kind"] for x in pick)
    units = nk["single"] + nk["replay"] + -(-nk["turn"] // TR.TURN_GROUP) + -(-nk["cp"] // TR.CP_GROUP)
    assert ok and rc["stage"] == "merged" and rc["optimizer_steps"] == 2 * units and os.path.isfile(os.path.join(save, "config.json")), (rc["optimizer_steps"], units)
    assert all(r[5] is not None and r[5] >= 0 for r in rc["row_log"]), "answer loss missing"
    assert all(rc["epoch_summary"][0][f"{k}_mean_answer_loss"] is not None for k in ("turn", "single", "cp"))
    kinds = sorted({r[2] for r in rc["row_log"]})
    res.update({"mini_train": {"rows": rc["rows_processed"], "optimizer_steps": rc["optimizer_steps"], "kinds_logged": kinds,
                               "epoch_summary": rc["epoch_summary"], "lora_B_abs_delta": round(rc["lora_B_abs_delta"], 4),
                               "turn_units_paired": TR.TURN_GROUP, "answer_loss_rows": sum(r[5] is not None for r in rc["row_log"]),
                               "wall_s": round(time.time() - t, 1), "merged_saved": True}})
    shutil.rmtree(save, ignore_errors=True)
    say("MINI_TRAIN ok steps", rc["optimizer_steps"], "rows", rc["rows_processed"], "kinds", kinds, f"{time.time() - t:.0f}s")
    return res


def stage_eval(scr, seal_path):
    install_fake_vllm()
    import v8_eval as E
    ev = os.path.join(scr, "evaldir"); os.makedirs(ev, exist_ok=True); out = os.path.join(scr, "eval_out"); os.makedirs(out, exist_ok=True)
    shutil.copy(seal_path, os.path.join(ev, "holdout_v8.json"))
    E.load_tok = lambda *a, **k: MockTok()
    cwd = os.getcwd(); os.chdir(ev)
    try:
        E.preflight(out)
        for arm in ("v7", "v8", "base"):
            sys.argv = ["v8_eval.py", f"mock_{arm}", arm, out]; E.main()
            try:
                E.main(); raise RuntimeError("overwrite not refused")
            except AssertionError:
                pass
    finally:
        os.chdir(cwd)
    for arm in ("v7", "v8", "base"):
        WI.main([f"mock_{arm}", f"v8i_{arm}", out, seal_path, "2", "--commit-on-truncate"], llm_factory=lambda a=arm: MockInteractive(a),
                tok=MockTok(), sp_factory=sp_inter, log=lambda *a: None)
    res = AN.analyze(out)
    p, g = res["PRIMARY_v8_gt_base"], res["GATE_band_guard_vs_v7"]
    cp = res["CO_PRIMARY_v8_gt_v7_hard"]
    say("ANALYZE primary", p["wins"], "-", p["losses"], f"p={p['p_one_sided']:.3g}", p["verdict"], "| co-primary", cp["verdict"], "| gate", g["verdict"],
        {b: (v["D"], v["margin"]) for b, v in g["bands"].items()}, "| promote", res["PROMOTE_v8"])
    assert res["PROMOTE_v8"] == (p["verdict"] == "PASS" and cp["verdict"] == "PASS" and g["verdict"] == "PASS")
    # synthetic gate failure: v8 loses every 17-32 sample it had
    out2 = os.path.join(scr, "eval_out_gatefail"); shutil.copytree(out, out2)
    r8 = json.load(open(os.path.join(out2, "v8_eval_v8.json")))
    for c in r8["cases"]:
        if c["band"] == "17-32":
            for k in ("lenient_ok_raw", "lenient_ok_forced", "strict_ok_raw", "strict_ok_forced"): c[k] = 0
            for s in c["samples"]:
                s["lenient_raw"] = s["lenient_forced"] = s["strict_raw"] = s["strict_forced"] = "UNSOLVED"
    json.dump(r8, open(os.path.join(out2, "v8_eval_v8.json"), "w"))
    r2 = AN.analyze(out2)
    assert r2["GATE_band_guard_vs_v7"]["verdict"] == "FAIL" and not r2["PROMOTE_v8"]
    # NOT_EVALUABLE: v7 receipt missing
    out3 = os.path.join(scr, "eval_out_nov7"); shutil.copytree(out, out3); os.remove(os.path.join(out3, "v8_eval_v7.json"))
    r3 = AN.analyze(out3); assert r3["GATE_band_guard_vs_v7"]["pass"] is None and not r3["PROMOTE_v8"]
    say("ANALYZE synthetic: gate-fail ->", r2["GATE_band_guard_vs_v7"]["verdict"], r2["GATE_band_guard_vs_v7"]["bands"]["17-32"],
        "| no-v7 ->", r3["GATE_band_guard_vs_v7"]["verdict"])
    # band_guard / band_gate unit checks: hard bands are point non-inferiority, 8-16 keeps the noise margin
    assert C.band_guard([0] * 16, [0] * 16)["pass"] and C.band_guard([0] * 15 + [0], [0] * 15 + [1])["pass"]
    assert not C.band_guard([0] * 10, [2] * 10)["pass"]
    assert C.band_gate([0] * 16, [0] * 16, "33-48")["pass"] and not C.band_gate([0] * 15 + [0], [0] * 15 + [1], "17-32")["pass"]
    assert C.band_gate([0] * 15 + [0], [0] * 15 + [1], "8-16")["pass"]
    # interactive receipts that differ -> NOT_COMPARABLE, never raised (single-shot analysis still written)
    out4 = os.path.join(scr, "eval_out_intermismatch"); shutil.copytree(out, out4)
    ri = json.load(open(os.path.join(out4, "wm_interactive_v8i_base.json"))); ri["code_sha256"] = {"wm_interactive.py": "0" * 64}
    json.dump(ri, open(os.path.join(out4, "wm_interactive_v8i_base.json"), "w"))
    r4 = AN.analyze(out4); assert r4["interactive"]["verdict"] == "NOT_COMPARABLE" and "code_sha256" in r4["interactive"]["differs_in"]
    planted = stage_planted(scr)
    inter = res["interactive"]
    return {"primary": {k: p[k] for k in ("wins", "losses", "ties", "p_one_sided", "verdict")}, "gate": g["verdict"],
            "gate_bands": {b: {k: v[k] for k in ("D", "margin", "sum_new", "sum_champ", "pass")} for b, v in g["bands"].items()},
            "promote": res["PROMOTE_v8"], "totals": {a: s["lenient_ok_forced"] for a, s in res["stats"].items()},
            "co_primary": {k: cp[k] for k in ("wins", "losses", "ties", "p_one_sided", "verdict")},
            "plans_v8_all": res["stats"]["v8"]["plans"]["by_band"]["all"],
            "interactive_tests": inter["tests"] if inter else None, "synthetic_gate_fail": r2["GATE_band_guard_vs_v7"]["verdict"],
            "no_v7": r3["GATE_band_guard_vs_v7"]["verdict"], "interactive_mismatch": r4["interactive"]["verdict"], "planted_real_receipts": planted}


def stage_planted(scr):
    """Planted decision cases from the REAL pulled holdout_v7 receipts (v7_eval_{base,v7}.json, read-only), relabelled as v8 receipts."""
    P = os.path.join(C.PULLED, "out")
    src = {a: json.load(open(os.path.join(P, f"v7_eval_{a}.json"))) for a in ("base", "v7")}

    def as_v8(r, tag):
        r = copy.deepcopy(r); r["tag"] = tag; r["holdout"] = "holdout_v8.json"; return r

    def write_case(name, v8):
        d = os.path.join(scr, "planted_" + name); os.makedirs(d, exist_ok=True)
        for tag, r in (("base", as_v8(src["base"], "base")), ("v7", as_v8(src["v7"], "v7")), ("v8", v8)):
            json.dump(r, open(os.path.join(d, f"v8_eval_{tag}.json"), "w"))
        return AN.analyze(d)

    base_by = {c["id"]: c for c in src["base"]["cases"]}
    hyb = as_v8(src["v7"], "v8")
    hyb["cases"] = [copy.deepcopy(c) if c["band"] == "8-16" else copy.deepcopy(base_by[c["id"]]) for c in src["v7"]["cases"]]
    rh = write_case("hybrid", hyb)
    ids_b = {b: [c["id"] for c in hyb["cases"] if c["band"] == b] for b in ("8-16", "17-32", "33-48")}
    per = lambda r: {c["id"]: c["lenient_ok_forced"] for c in r["cases"]}
    old_rule = {b: C.band_guard([per(hyb)[i] for i in ids], [per(src["v7"])[i] for i in ids])["pass"] for b, ids in ids_b.items()}
    assert rh["PRIMARY_v8_gt_base"]["verdict"] == "PASS" and all(old_rule.values()), "hybrid should pass PRIMARY and the DRAFT gate"
    assert rh["CO_PRIMARY_v8_gt_v7_hard"]["verdict"] == "FAIL" and rh["GATE_band_guard_vs_v7"]["verdict"] == "FAIL" and not rh["PROMOTE_v8"]
    gain = as_v8(src["v7"], "v8"); k = 0
    for c in gain["cases"]:
        if c["band"] != "17-32" or k >= 20: continue
        s = next((s for s in c["samples"] if s["lenient_forced"] in ("UNSOLVED",) or s["lenient_forced"].startswith("ILLEGAL")), None)
        if s is None: continue
        s["lenient_raw"] = s["lenient_forced"] = "OK"; c["lenient_ok_raw"] += 1; c["lenient_ok_forced"] += 1; k += 1
    rg = write_case("hardgain", gain)
    assert k == 20 and rg["CO_PRIMARY_v8_gt_v7_hard"]["verdict"] == "PASS" and rg["GATE_band_guard_vs_v7"]["verdict"] == "PASS"
    assert rg["PRIMARY_v8_gt_base"]["verdict"] == "PASS" and rg["PROMOTE_v8"]
    f = lambda r: {"primary": (r["PRIMARY_v8_gt_base"]["wins"], r["PRIMARY_v8_gt_base"]["losses"], round(r["PRIMARY_v8_gt_base"]["p_one_sided"], 4)),
                   "co_primary": (r["CO_PRIMARY_v8_gt_v7_hard"]["wins"], r["CO_PRIMARY_v8_gt_v7_hard"]["losses"], round(r["CO_PRIMARY_v8_gt_v7_hard"]["p_one_sided"], 4)),
                   "gate": {b: (v["D"], v["pass"]) for b, v in r["GATE_band_guard_vs_v7"]["bands"].items()}, "promote": r["PROMOTE_v8"]}
    say("PLANTED hybrid ->", json.dumps(f(rh)), "| draft gate would pass:", old_rule, "| hardgain ->", json.dumps(f(rg)))
    return {"hybrid": f(rh), "hybrid_draft_gate_pass_by_band": old_rule, "hardgain_plus20_17_32": f(rg)}


def stage_driver(scr):
    r = subprocess.run([sys.executable, os.path.join(LAB, "v8_driver_test.py"), os.path.join(scr, "driver_test")], capture_output=True, text=True,
                       cwd=LAB, timeout=900)
    tail = (r.stdout + r.stderr).strip().splitlines()[-1:]
    say("DRIVER_TEST rc", r.returncode, (tail[0] if tail else "")[:300]); assert r.returncode == 0, (r.stdout + r.stderr)[-3000:]
    return json.load(open(os.path.join(scr, "driver_test", "v8_driver_test_summary.json")))


def projections():
    """INFERRED data-count projections for the real collection (n=2 x 160 boards), three scenarios, under the v8_build_data rules
    (GOOD turn = progress + new episode best + >= 1 box moved + eff >= 0.75 + no overshoot; difficulty of a turn = its start
    distance d_before; R1 hard turns >= 50%; R3 short units <= 50% of puzzle units with turn rows at 1/2 unit; CP 600).
    Per-turn rates are guesses anchored on RAN single-shot facts (v7 illegal 39% of samples, 27% truncated at 16k, lenient 8-16
    45%, 17-32 20%) and on the mock: about 56% of the draft-GOOD turns survive the stricter filters."""
    bands = {"9-16": 40, "17-32": 80, "33-48": 40}
    hard_state = {"9-16": 0.0, "17-32": 0.55, "33-48": 0.85}             # INFERRED share of GOOD turns that start >= 17 from the solve
    keep = 0.56
    scen = {"low": {"turns_per_ep": 9, "good": {"9-16": 0.15, "17-32": 0.10, "33-48": 0.07}},
            "mid": {"turns_per_ep": 10, "good": {"9-16": 0.25, "17-32": 0.18, "33-48": 0.13}},
            "high": {"turns_per_ep": 11, "good": {"9-16": 0.35, "17-32": 0.27, "33-48": 0.20}}}
    s8 = {"9-16": 40 * (1 - 0.57 ** 2) * 0.9, "17-32": 80 * (1 - 0.82 ** 2) * 0.9, "33-48": 40 * (1 - 0.99 ** 2) * 0.9}
    v6 = {"8-16": 24, "17-32": 13}                                          # RAN: v6_A direct via=self by band (before filters)
    out = {}
    for name, sc in scen.items():
        good = {b: 2 * n * sc["turns_per_ep"] * sc["good"][b] * keep for b, n in bands.items()}
        capped = {b: min(good[b], n * 4 * 0.85) for b, n in bands.items()}
        th = sum(capped[b] * hard_state[b] for b in bands); te = sum(capped.values()) - th
        te = min(te, th)                                                    # R1
        if th + te > 480: th, te = min(th, max(240, 480 - te)), min(te, 480 - min(th, max(240, 480 - te)))
        S_h, S_s = s8["17-32"] + s8["33-48"] + v6["17-32"], s8["9-16"] + v6["8-16"]
        R_h, R_s = 2, 48
        units = lambda: th / 2 + te / 2 + S_h + S_s + R_h + R_s
        short = lambda: te / 2 + S_s + R_s
        while short() > 0.5 * units() + 1e-9:                               # R3: replay short, then short turns, then short singles
            if R_s >= 1: R_s -= 1
            elif te >= 1: te -= 1
            elif S_s >= 1: S_s -= 1
            else: break
        T = int(th + te); S = int(S_h + S_s); R = int(R_h + R_s)
        steps = 2 * (-(-T // 2) + S + R + 100)
        train_s = 2 * (T * (0.6225 + 1.789e-4 * 6000) + S * (0.6225 + 1.789e-4 * 8500) + R * (0.6225 + 1.789e-4 * 4500) + 100 * 2.568)
        out[name] = {"assumed_good_turn_rate_before_filters": sc["good"], "turn_items": T, "turn_items_hard_state": int(th),
                     "single_items": S, "replay_items": R, "cp_items": 600, "short_unit_frac": round(short() / units(), 3),
                     "full_solution_unit_frac": round((S + R) / units(), 3), "optimizer_steps_2_epochs": steps,
                     "train_min_excl_load_merge": round(train_s / 60, 1)}
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    scr = os.path.abspath(args[0]) if args else os.path.join(os.environ.get("TMPDIR", "/tmp"), "v8_dryrun")
    if os.path.exists(scr): shutil.rmtree(scr)
    out = os.path.join(scr, "out"); os.makedirs(out)
    T0 = time.time(); R = {}
    R["grader_tests"] = stage_grader_tests()
    seal = stage_scratch_seal(scr)
    R["collect"] = stage_collect(out)
    R["build"] = stage_build(out)
    R["train"] = stage_train(out, scr, do_train="--no-train" not in sys.argv)
    R["eval"] = stage_eval(scr, seal)
    R["driver"] = stage_driver(scr)
    R["projections_INFERRED"] = projections()
    R["wall_s"] = round(time.time() - T0, 1)
    with open(os.path.join(scr, "v8_dryrun_summary.json"), "w") as f: json.dump(R, f, indent=1)
    say("V8_DRYRUN_OK", os.path.join(scr, "v8_dryrun_summary.json"), f"{R['wall_s']}s")


if __name__ == "__main__":
    main()
