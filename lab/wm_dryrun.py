"""Mac-side DRY RUN for the wm_* box scripts (no vLLM, no GPU). A deterministic mock LLM drives every harness branch:
solved episodes, malformed JSON, fenced/multiple JSON, truncation (+ forced commit), think-not-closed stop, illegal moves,
RESET (incl. a refused 3rd reset), >8-move clipping, solve mid-string, move-budget end, budget clipping, turn-limit end,
3x-unparseable end, context-limit end, notes echo, bounded history, per-round batching, seeds, receipts, overwrite refusal,
sealed-set refusal; durable turns.jsonl + crash -> incomplete receipt -> --resume (twice, incl. a torn last line) giving
episodes identical to an uninterrupted run; >64-move replies clipped not rejected; notes with braces; retrieval prompts on
the real library with one n=1 request per sample and disjoint seeds; analysis on the mock receipts (co-primary H-WM1,
bare p for secondaries, WMMAX vs INTERACTIVE, any-prefix rescoring, efficiency CIs, Holm); the Laya export join on the mock
receipts; preflights on the real holdout128 replay with a stand-in tokenizer (Qwen2.5 from the local HF cache when
available, else the mock tokenizer), including the check that a tail without <think> is refused.
Usage: python3 wm_dryrun.py [SCRATCH_DIR]"""
import collections, json, os, random, shutil, sys, tempfile

LAB = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, LAB)
import wm_common as WC, wm_interactive as WI, wm_retrieval_eval as WR, wm_library as WL, wm_analyze as WA, wm_laya_export as WX
from sokoban import generate, solve, parse, step, canonical_id, verify, MOVES

OPP = {"U": "D", "D": "U", "L": "R", "R": "L"}
LOG = []


def say(*a):
    s = " ".join(str(x) for x in a); LOG.append(s); print(s, flush=True)


class MockTok:
    def apply_chat_template(self, msgs, tokenize=False, add_generation_prompt=True, enable_thinking=True):
        roles = [m["role"] for m in msgs]
        assert roles[0] == "user" and roles[-1] == "user" and all(a != b for a, b in zip(roles, roles[1:])), roles
        s = "".join(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n" for m in msgs)
        return s + ("<|im_start|>assistant\n<think>\n" if enable_thinking else "<|im_start|>assistant\n")

    def __call__(self, text, add_special_tokens=False):
        return {"input_ids": [0] * (len(text) // 4 + 1)}

    def decode(self, ids):
        return "x" * (4 * len(ids))


class Out:
    def __init__(self, text, finish, ntok=None):
        self.text, self.finish_reason = text, finish
        self.token_ids = [7] * (ntok if ntok is not None else max(1, len(text) // 4))


class Req:
    def __init__(self, outs): self.outputs = outs


class SP:
    def __init__(self, seed, max_tokens, greedy=False, stop=None, n=1):
        self.seed, self.max_tokens, self.greedy, self.stop, self.n = seed, max_tokens, greedy, stop, n


def sp_inter(seed, max_tokens, greedy=False, stop=None):
    return SP(seed, max_tokens, greedy, stop)


def state_of(board):
    w, g, b, p = parse(board); return w, g, b, p


def legal_osc(board):
    w, g, b, p = state_of(board)
    for d in "UDLR":
        r = step(w, b, p, d)
        if r is not None and frozenset(r[0]) == b: return d
    raise RuntimeError("no free move")


def blocked_after(board):
    """(m1, m2): m1 legal, m2 blocked right after m1."""
    w, g, b, p = state_of(board)
    for m1 in "UDLR":
        r = step(w, b, p, m1)
        if r is None: continue
        for m2 in "UDLR":
            if step(w, frozenset(r[0]), r[1], m2) is None: return m1, m2
    raise RuntimeError("no blocked pair")


def overshoot(board, sol):
    """sol + one move that is blocked or pushes a box: solved at a prefix, but verify() says ILLEGAL/UNSOLVED."""
    w, g, b, p = state_of(board)
    for m in sol:
        r = step(w, b, p, m); b, p = frozenset(r[0]), r[1]
    for m in "UDLR":
        r = step(w, b, p, m)
        if r is None or frozenset(r[0]) != b: return sol + m
    return sol + "U"


def think(tag, n=30):
    return f"THINK-{tag} " + "Let me trace the board carefully. " * n


def ans(tag, moves, fence=False, note=None):
    obj = {"moves": moves}
    if note: obj["note"] = note
    js = json.dumps(obj)
    if fence: js = 'First idea {"moves": "LLLL"} was wrong.\n```json\n' + js + "\n```"
    return think(tag) + "\n</think>\n\n" + js


class Crashy:
    """Wraps MockInteractive; raises on the crash_at-th per-round ('turn') generate call (an engine death)."""
    def __init__(self, inner, crash_at):
        self.inner, self.crash_at, self.turn_calls = inner, crash_at, 0

    def generate(self, prompts, sps):
        if not (prompts and prompts[0].endswith(WI.COMMIT_SUFFIX)):
            self.turn_calls += 1
            if self.turn_calls == self.crash_at: raise RuntimeError("mock engine death")
        return self.inner.generate(prompts, sps)


class MockInteractive:
    """Policies are keyed by case id; episode and turn are decoded from the per-request seed."""
    def __init__(self, cases, n, policies):
        self.by_board = {c["board"]: c for c in cases}; self.n = n; self.policies = policies
        self.calls, self.seen = [], []

    def generate(self, prompts, sps):
        assert len(prompts) == len(sps)
        kind = "commit" if prompts and prompts[0].endswith(WI.COMMIT_SUFFIX) else "turn"
        self.calls.append((kind, len(prompts)))
        return [Req([self.one(p, sp, kind)]) for p, sp in zip(prompts, sps)]

    def one(self, prompt, sp, kind):
        ep, turn = divmod(sp.seed - WI.SEED, 1000)
        grids = list(WC.grids_in_text(prompt))
        case = self.by_board[grids[0]]; cur = grids[-1]
        pol = self.policies[case["id"]]
        tag = f"ep{ep}-t{turn}"
        if kind == "commit":
            assert sp.greedy and sp.stop == ['"'] and "THINK-" in prompt
            s, _ = solve(cur)
            return Out((s[:8] if s else "RESET") + '"}', "stop")
        self.seen.append({"ep": ep, "turn": turn, "case": case["id"], "assistant_msgs": prompt.count("<|im_start|>assistant\n") - 1,
                          "turn_markers": prompt.count("[Turn "), "old_think_leak": "THINK-" in prompt, "prompt": prompt, "max_tokens": sp.max_tokens})
        s, _ = solve(cur)
        if pol == "solver":
            return Out(ans(tag, s[:8] if s else "RESET"), "stop")
        if pol == "fence":
            return Out(ans(tag, s[:8], fence=True), "stop")
        if pol == "garbage":
            return Out(think(tag) + "\n</think>\n\nI will move right twice.", "stop")
        if pol == "truncate":
            return Out(think(tag, 400), "length", ntok=sp.max_tokens)
        if pol == "mixed_unparse":                 # stop w/o </think>, then garbage, then solver: counter must reset
            if turn == 1: return Out(think(tag), "stop")
            if turn == 2: return Out(think(tag) + "\n</think>\n\n{\"moves\": \"udlr\"} then {\"moves\": \"RRU", "stop")
            return Out(ans(tag, s[:8]), "stop")
        if pol == "illegal_first":
            if turn == 1:
                m1, m2 = blocked_after(cur); return Out(ans(tag, m1 + m2 + "UU"), "stop")
            return Out(ans(tag, s[:8] if s else "RESET"), "stop")
        if pol == "reset":
            if turn in (1, 3): return Out(ans(tag, legal_osc(cur)), "stop")
            if turn in (2, 4, 5): return Out(ans(tag, "RESET"), "stop")
            return Out(ans(tag, s[:8] if s else "RESET"), "stop")
        if pol == "overlong":
            return Out(ans(tag, s if len(s) > 8 else s + "UDUDUDUDU"[: 9 - len(s)] + s[:0]), "stop")
        if pol == "solver_plus":
            m = s[:8] if len(s) > 8 else (s + (legal_osc(cur) * 8))[:8]
            return Out(ans(tag, m), "stop")
        if pol in ("osc8", "osc2", "osc7"):
            d = legal_osc(cur); k = int(pol[3:])
            return Out(ans(tag, "".join(d if i % 2 == 0 else OPP[d] for i in range(k))), "stop")
        if pol == "overlong65":                    # > 64 moves in one reply: clipped to 8, never rejected
            return Out(ans(tag, (s + "U" * 80)[:max(70, len(s))]), "stop")
        if pol == "notes":
            mv = s[:3] if s else "RESET"
            if turn == 1: return Out(think(tag) + "\n</think>\n\n" + json.dumps({"moves": mv, "note": f"NOTE-{tag} box at {{4,5}} first"}), "stop")
            if turn == 2: return Out(think(tag) + "\n</think>\n\n" + '{"moves": "' + mv + '", "note": "NOTE-broken {x}', "stop")
            return Out(ans(tag, mv, note=f"NOTE-{tag} keep pushing"), "stop")
        raise ValueError(pol)


class MockRetrieval:
    def __init__(self, cases):
        self.by_board = {c["board"]: c for c in cases}; self.cases = cases; self.calls = []

    def generate(self, prompts, sps):
        self.calls.append([sp.seed for sp in sps]); res = []
        for p, sp in zip(prompts, sps):
            assert sp.n == 1, "one n=1 request per sample"
            b = WC.board_from_solve_prompt(p); c = self.by_board[b]; s, _ = solve(b)
            off = sp.seed - WR.SEED; bi, j = off // 1000, off % 1000 - WR.SEED_OFFSET
            assert c is self.cases[bi] and 0 <= j < 1000 - WR.SEED_OFFSET, "seed rule"
            ret = WR.PREFIX_HEAD in p; i = int(c["id"][1:]); outs = []
            for _ in range(1):
                k = (i + j + (1 if ret else 0)) % 6
                if k == 0: t = think("r") + "\n</think>\n\n" + json.dumps({"moves": s})                       # strict + lenient OK
                elif k == 1: t = think("r") + "\n</think>\n\n```json\n" + json.dumps({"moves": s}) + "\n```"    # lenient OK only
                elif k == 2: t = think("r", 300)                                                                 # truncated
                elif k == 3:
                    m1, m2 = blocked_after(b); t = think("r") + "\n</think>\n\n" + json.dumps({"moves": m1 + m2})   # ILLEGAL
                elif k == 4 and i % 2 == 0: t = think("r") + "\n</think>\n\n" + json.dumps({"moves": overshoot(b, s)})  # solves, then breaks it
                elif k == 4: t = think("r") + "\n</think>\n\n" + json.dumps({"moves": legal_osc(b)})            # UNSOLVED
                else: t = think("r") + "\n</think>\n\nno plan"                                                    # NOPLAN
                outs.append(Out(t, "length" if k == 2 else "stop", ntok=16384 if k == 2 else None))
            res.append(Req(outs))
        return res


def synth_cases(n, seed, lo=6, hi=20, avoid=()):
    rng = random.Random(seed); cases = []; seen = set(avoid)
    while len(cases) < n:
        b = generate(rng); cid = canonical_id(b)
        if cid in seen: continue
        s, st = solve(b)
        if st == "SOLVED" and lo <= len(s) <= hi:
            seen.add(cid); cases.append({"id": f"D{len(cases):03d}", "band": "8-16" if len(s) <= 16 else "17-32", "board": b,
                                         "canonical_id": cid, "oracle_len": len(s)})
    return cases


def check(cond, msg):
    if not cond: raise AssertionError(msg)
    say("  PASS", msg)


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="wm_dry_")
    if os.path.exists(root): shutil.rmtree(root)
    out = os.path.join(root, "out"); os.makedirs(out)
    lib = WL.load(os.path.join(LAB, "wm_library.jsonl"))
    libids = {e["canonical_id"] for e in lib}
    sealed, _ = WC.sealed_ids(LAB)
    tok = MockTok()

    # ---------------- interactive: every branch ----------------
    pols = ["solver", "fence", "garbage", "truncate", "mixed_unparse", "illegal_first", "reset", "overlong", "solver_plus",
            "osc8", "osc2", "osc7", "notes", "overlong65"]

    # ---------------- unit checks: parsing, any-prefix rule, Holm ----------------
    pr = WI.parse_reply("t\n</think>\n\n" + json.dumps({"moves": "R" * 65}))
    check(pr["kind"] == "moves" and len(pr["value"]) == 65, "parse: a 65-move reply is parsed (clipped later, not rejected)")
    pr = WI.parse_reply('t\n</think>\n\n{"moves": "RRU", "note": "box at {4,5} first"}', notes=True)
    check(pr["note"] == "box at {4,5} first" and not pr["note_unreadable"], "parse: a note containing braces is read")
    pr = WI.parse_reply('t\n</think>\n\n{"moves": "RRU", "note": "unterminated {x}', notes=True)
    check(pr["kind"] == "moves" and pr["note"] is None and pr["note_unreadable"], "parse: an undecodable note is flagged, moves still used")
    hb = "########\n#      #\n# @$ . #\n#      #\n#  $   #\n#  .   #\n#      #\n########"
    check(WC.solved_at_prefix(hb, "RDLDDR") is False and verify(hb, "R") == "UNSOLVED", "prefix rule: unsolved plan stays unsolved")
    sol, _ = solve(hb); over = overshoot(hb, sol)
    check(WC.solved_at_prefix(hb, over) and verify(hb, over) != "OK" and WC.solved_at_prefix(hb, sol), f"prefix rule: solve-then-overshoot counts ({verify(hb, over)})")
    hp_ = WC.holm({"a": 0.01, "b": 0.04, "c": 0.03})
    check(hp_ == {"a": 0.03, "c": 0.06, "b": 0.06}, f"Holm adjusted p {hp_}")
    cases = synth_cases(len(pols), 4242, lo=6, hi=14, avoid=libids | sealed)
    policies = {c["id"]: p for c, p in zip(cases, pols)}
    setf = os.path.join(root, "dry_set.json"); WC.write_json(setf, {"cases": cases})
    say("WM_DRY interactive: cases", len(cases), "policies", pols)

    def run_inter(tag, extra_flags=(), n=2):
        mock = MockInteractive(cases, n, policies)
        fp = WI.main(["MOCK", tag, out, setf, str(n), *extra_flags], llm_factory=lambda: mock, tok=tok, sp_factory=sp_inter)
        return mock, json.load(open(fp)), json.load(open(fp.replace(".json", ".raw.json")))

    mock, R, RAW = run_inter("dry_inter")
    jl = [json.loads(l) for l in open(os.path.join(out, "wm_interactive_dry_inter.turns.jsonl"))]
    tlines = [r for r in jl if r["event"] == "turn"]
    check(jl[0]["event"] == "head" and len(tlines) == R["totals"]["turns"] and sum(r["event"] == "round" for r in jl) == len(R["rounds"])
          and all(set(r) >= {"episode", "id", "sample", "turn", "seed", "text", "commit_text", "finish", "ntok", "ptok", "ckpt_chars", "rec"} for r in tlines),
          f"turns.jsonl: head + {len(tlines)} turn lines (= all turns) + one line per round")
    E = {(e["id"], e["sample"]): e for e in R["episodes"]}
    ep = lambda pol, s=0: E[(next(c["id"] for c in cases if policies[c["id"]] == pol), s)]
    for pol in ("solver", "fence", "illegal_first", "reset", "overlong", "solver_plus", "notes", "mixed_unparse"):
        e = ep(pol); check(e["solved"] and e["verified"] and e["end_reason"] == "solved" and verify(next(c["board"] for c in cases if c["id"] == e["id"]), e["path"]) == "OK",
                           f"{pol}: solved+verified (turns={e['turns']}, path_len={e['path_len']})")
    check(not any(t["strict_format"] for t in ep("fence")["turns_log"]), "fence: last JSON taken, strict_format False")
    check(all(t["strict_format"] for t in ep("solver")["turns_log"]), "solver: strict_format True")
    e = ep("garbage"); check(e["end_reason"] == "unparseable_x3" and e["turns"] == 3 and not e["solved"], "garbage: ends unparseable_x3 after 3 turns")
    e = ep("truncate"); check(e["end_reason"] == "unparseable_x3" and e["turns"] == 3 and all(t["finish"] == "length" for t in e["turns_log"]),
                              "truncate (no commit): 3 truncated turns -> unparseable_x3")
    check("token limit" in ep("truncate")["turns_log"][0]["reply"], "truncate: reply names the token limit")
    e = ep("mixed_unparse"); check(e["unparseable"] == 2 and "before your thinking was closed" in e["turns_log"][0]["reply"],
                                   "mixed_unparse: stop-without-</think> + invalid JSON counted, counter reset by a valid turn")
    t1 = ep("illegal_first")["turns_log"][0]
    check(t1["illegal_at"] == 1 and len(t1["applied"]) == 1 and "ILLEGAL@1" in t1["reply"], "illegal_first: ILLEGAL@1 reported, legal prefix applied")
    c0 = next(c for c in cases if policies[c["id"]] == "illegal_first"); w, g, b, p = parse(c0["board"]); r = step(w, b, p, t1["applied"])
    check(WC.render(w, g, frozenset(r[0]), r[1]) in t1["reply"], "illegal_first: reply shows the board after the legal prefix")
    e = ep("reset"); check(e["resets"] == 2 and e["reset_refused"] == 1 and "RESET refused" in e["turns_log"][4]["reply"], "reset: 2 resets done, 3rd refused (costs a turn)")
    check("since your last RESET" in e["turns_log"][5]["reply"], "reset: moves-so-far counted since last RESET")
    e = ep("overlong"); check(e["clipped"] >= 1 and all(len(t["applied"]) <= 8 for t in e["turns_log"]), f"overlong: clipped to 8 ({e['clipped']} turns)")
    e = ep("overlong65"); t0_ = e["turns_log"][0]
    check(e["solved"] and e["unparseable"] == 0 and t0_["clipped"] and t0_["requested_len"] >= 70 and len(t0_["requested"]) == WI.ECHO_MAX
          and "only the first 64 are shown" in t0_["reply"], "overlong65: >64-move replies parsed, clipped to 8, echo bounded to 64")
    e = ep("solver_plus"); last = e["turns_log"][-1]
    check("were not needed" in last["reply"] and len(last["applied"]) < 8, "solver_plus: application stops at the solving move")
    e = ep("osc8"); check(e["end_reason"] == "move_budget" and e["total_moves"] == 64 and e["turns"] == 8, "osc8: ends move_budget at 64 moves / 8 turns")
    e = ep("osc2"); check(e["end_reason"] == "turn_limit" and e["turns"] == 12 and e["total_moves"] == 24, "osc2: ends turn_limit at 12 turns")
    e = ep("osc7"); check(e["end_reason"] == "move_budget" and e["budget_clipped"] == 1 and e["turns_log"][-1]["applied"] and len(e["turns_log"][-1]["applied"]) == 1,
                          "osc7: last turn budget-clipped to the 1 remaining move")
    check(all("Change: none" in t["reply"] for t in ep("osc2")["turns_log"]) and all("Change: player" in t["reply"] for t in ep("osc7")["turns_log"]),
          "delta line = NET change (even oscillation -> none; odd -> player displaced)")
    pushes = [t for t in ep("solver")["turns_log"] if "box (" in t["reply"]]
    check(len(pushes) >= 1, "delta line reports box displacements")
    ok_hist = all(s["assistant_msgs"] == min(WI.KEEP_ASSISTANT, s["turn"] - 1) and s["turn_markers"] == s["turn"] - 1 and not s["old_think_leak"] for s in mock.seen)
    check(ok_hist, f"bounded history on all {len(mock.seen)} requests: last-3 assistant JSONs, all observations, no old thinking")
    turn_calls = [k for k, _ in mock.calls if k == "turn"]
    check(len(turn_calls) == len(R["rounds"]) and all(r["requests"] == n for r, (k, n) in zip(R["rounds"], [c for c in mock.calls if c[0] == "turn"])),
          f"one batched generate per round ({len(R['rounds'])} rounds; batch sizes {[n for k, n in mock.calls]})")
    seeds = [(s["ep"], s["turn"]) for s in mock.seen]; check(len(seeds) == len(set(seeds)), "per-(episode,turn) seeds unique")
    check(R["totals"]["solved"] == sum(e["solved"] for e in R["episodes"]) and sum(R["totals"]["per_board_solved"].values()) == R["totals"]["solved"], "totals consistent")
    check(len(RAW["episodes"]) == len(R["episodes"]) and all(len(x["turns"]) == E[(x["id"], x["sample"])]["turns"] for x in RAW["episodes"]), "raw receipt has every turn's text")
    check(not os.path.exists(os.path.join(out, "wm_interactive_dry_inter.partial.json")), "partial receipt removed at end")
    try:
        run_inter("dry_inter"); raise RuntimeError("overwrite not refused")
    except AssertionError as ex:
        check("refusing to overwrite" in str(ex), "re-run with same TAG refused (no overwrite)")
    mock2, R2, _ = run_inter("dry_inter_repeat")
    strip = lambda r: [{k: v for k, v in e.items()} for e in r["episodes"]]
    check(strip(R2) == strip(R), "deterministic: identical episodes on a repeat run")

    # PRIMARY interactive config: commit-on-truncate (no notes)
    mockc, RC, _ = run_inter("dry_commit", ("--commit-on-truncate",))
    EC = {(e["id"], e["sample"]): e for e in RC["episodes"]}
    tid = next(c["id"] for c in cases if policies[c["id"]] == "truncate")
    e = EC[(tid, 0)]; check(e["solved"] and e["committed_turns"] >= 1 and RC["config"]["commit_on_truncate"] and not RC["config"]["notes"],
                            f"primary (commit): truncated turns committed -> solved ({e['committed_turns']} commits)")
    check(all(t["commit_prompt_tokens"] > 0 for t in e["turns_log"] if t["committed"]) and e["prompt_tokens"] > sum(t["prompt_tokens"] for t in e["turns_log"]),
          "commit prefill counted in prompt_tokens")

    # crash -> incomplete receipt -> refused without --resume -> resume (torn last line) -> crash again -> resume -> identical
    tag = "dry_crash"; fpc, rpc, ppc, jpc = WI.receipt_paths(out, tag)
    try:
        WI.main(["MOCK", tag, out, setf, "2"], llm_factory=lambda: Crashy(MockInteractive(cases, 2, policies), 3), tok=tok, sp_factory=sp_inter,
                log=lambda *a: None)
        raise RuntimeError("crash not raised")
    except RuntimeError as ex:
        check("mock engine death" in str(ex), "crash propagates (non-zero exit for the driver)")
    P = json.load(open(ppc))
    check(P["stage"] == "incomplete" and P["rounds_done"] == 2 and "mock engine death" in P["error"] and not os.path.exists(fpc)
          and P["finished_episodes"], f"incomplete receipt: rounds_done=2, {len(P['finished_episodes'])} finished episode summaries, no final")
    try:
        WI.main(["MOCK", tag, out, setf, "2"], llm_factory=lambda: MockInteractive(cases, 2, policies), tok=tok, sp_factory=sp_inter, log=lambda *a: None)
        raise RuntimeError("restart over an existing turns.jsonl not refused")
    except AssertionError as ex:
        check("--resume" in str(ex), "restart without --resume refused (turns.jsonl never overwritten)")
    with open(jpc, "a") as f: f.write('{"event": "turn", "episode": 0, "te')          # torn write
    try:
        WI.main(["MOCK", tag, out, setf, "2", "--resume"], llm_factory=lambda: Crashy(MockInteractive(cases, 2, policies), 2), tok=tok,
                sp_factory=sp_inter, log=lambda *a: None)
        raise RuntimeError("second crash not raised")
    except RuntimeError as ex:
        check("mock engine death" in str(ex), "resume #1 replays, then crashes again one round later")
    fp2 = WI.main(["MOCK", tag, out, setf, "2", "--resume"], llm_factory=lambda: MockInteractive(cases, 2, policies), tok=tok, sp_factory=sp_inter,
                  log=lambda *a: None)
    RR, RRAW = json.load(open(fp2)), json.load(open(rpc))
    check(strip(RR) == strip(R) and RR["totals"] == R["totals"] and len(RR["rounds"]) == len(R["rounds"]),
          "resumed run: episodes, totals and round count identical to the uninterrupted run")
    check(len(RR["resumes"]) == 2 and RR["resumes"][0]["cut_bytes"] > 0 and RR["resumes"][0]["rounds_done"] == 2 and RR["resumes"][1]["rounds_done"] == 3,
          f"resume log: 2 resumes, torn line cut ({RR['resumes'][0]['cut_bytes']} bytes), rounds_done 2 then 3")
    check([[t["text"] for t in x["turns"]] for x in RRAW["episodes"]] == [[t["text"] for t in x["turns"]] for x in RAW["episodes"]],
          "resumed raw receipt has every turn text")
    check(not os.path.exists(ppc), "partial removed after the resumed run finished")

    # exploratory flags: commit-on-truncate + notes
    mockx, RX, _ = run_inter("dry_max", ("--commit-on-truncate", "--notes"))
    EX = {(e["id"], e["sample"]): e for e in RX["episodes"]}
    tid = next(c["id"] for c in cases if policies[c["id"]] == "truncate")
    e = EX[(tid, 0)]; check(e["solved"] and e["committed_turns"] >= 1, f"commit-on-truncate: truncated turns committed -> solved ({e['committed_turns']} commits)")
    check(any(k == "commit" for k, _ in mockx.calls), "commit requests batched in their own generate call")
    nid = next(c["id"] for c in cases if policies[c["id"]] == "notes")
    later = [s for s in mockx.seen if s["case"] == nid and s["turn"] >= 2]
    check(later and all(f'Your latest note: "NOTE-' in s["prompt"] for s in later), "notes: latest note echoed in every later prompt")
    en = EX[(nid, 0)]["turns_log"]
    check("{4,5}" in (en[0]["note"] or "") and en[1]["note_unreadable"] and "could not be read" in en[1]["reply"]
          and any("box at {4,5} first" in s["prompt"] for s in later if s["turn"] == 3),
          "notes: brace note kept, undecodable note flagged in the reply, previous note kept")
    check(all("NOTE-" not in s["prompt"] for s in mock.seen), "notes absent without --notes")

    # context limit
    ccase = [c for c in cases if policies[c["id"]] == "osc2"]
    init_tok = len(tok.apply_chat_template([{"role": "user", "content": WI.initial_prompt(ccase[0]["board"])}])) // 4 + 1
    cfg = WI.Cfg(max_model_len=init_tok + WI.MIN_ROOM + 60)
    eps, rounds = WI.run_episodes(MockInteractive(ccase, 1, policies), tok, ccase, 1, sp_inter, cfg, log=lambda *a: None)
    check(eps[0].end_reason == "context_limit" and eps[0].turns >= 1, f"context_limit end after {eps[0].turns} turn(s)")

    # sealed-set refusal
    fake_lab = os.path.join(root, "fake_lab"); os.makedirs(fake_lab)
    WC.write_json(os.path.join(fake_lab, "holdout_v7.json"), {"cases": cases[:1]})
    try:
        WC.load_set(setf, lab=fake_lab); raise RuntimeError("overlap not refused")
    except AssertionError as ex:
        check("holdout_v7" in str(ex), "load_set refuses a set overlapping holdout_v7 (by canonical id)")
    try:
        WC.load_set(os.path.join(LAB, "holdout_v7.json")); raise RuntimeError("v7 not refused")
    except AssertionError as ex:
        check("sealed" in str(ex), "load_set refuses holdout_v7.json by name")

    # ---------------- retrieval eval ----------------
    rmock_n, rmock_r = MockRetrieval(cases), MockRetrieval(cases)
    spr = lambda seed: SP(seed, WR.MAXTOK, n=1)
    fn = WR.main(["MOCK", "dry_noret", out, setf, "2", "none"], llm_factory=lambda: rmock_n, tok=tok, sp_factory=spr)
    fr = WR.main(["MOCK", "dry_ret", out, setf, "2", "retrieval"], llm_factory=lambda: rmock_r, tok=tok, sp_factory=spr)
    N, Rr = json.load(open(fn)), json.load(open(fr))
    rawN, rawR = json.load(open(fn.replace(".json", ".raw.json"))), json.load(open(fr.replace(".json", ".raw.json")))
    want = [WR.sample_seed(i, j) for i in range(len(cases)) for j in range(2)]
    iseeds = {WI.SEED + 1000 * e + t for e in range(len(cases) * 2) for t in range(1, WI.MAX_TURNS + 1)}
    check(rmock_n.calls == rmock_r.calls == [want] and len(set(want)) == len(want) and not (set(want) & iseeds),
          "retrieval: one n=1 request per sample, seeds identical across modes, all distinct, disjoint from interactive seeds")
    check(all([s["seed"] for s in c["samples"]] == [WR.sample_seed(i, j) for j in range(2)] for i, c in enumerate(N["cases"]))
          and all(c["canonical_id"] == canonical_id(c["board"]) for c in N["cases"]) and N["totals"]["prompt_tokens"] > 0,
          "receipts carry per-sample seed, canonical_id, board, prompt tokens")
    check(all(WR.PREFIX_HEAD not in c["prompt_user"] for c in rawN["cases"]), "noret prompts carry no retrieval prefix")
    good = True
    for c in rawR["cases"]:
        q = WC.board_from_solve_prompt(c["prompt_user"]); grids = list(WC.grids_in_text(c["prompt_user"]))
        good &= (c["prompt_user"].startswith(WR.PREFIX_HEAD) and len(grids) == 3 and grids[-1] == q and len(c["retrieved"]) == 2
                 and canonical_id(q) not in c["retrieved"] and set(c["retrieved"]) <= libids)
    check(good, "ret prompts: exact prefix sentence, 2 library examples (not the query), query board last")
    vc = collections.Counter(s["lenient"].split("@")[0] for r in N["cases"] for s in r["samples"])
    check({"OK", "ILLEGAL", "UNSOLVED", "NOPLAN"} <= set(vc), f"noret verdict mix exercised {dict(vc)}")
    check(N["totals"]["strict_ok"] < N["totals"]["lenient_ok"], "strict < lenient (fenced answers count lenient only)")
    check(all(s["ckpt_chars"]["1024"] is not None for r in N["cases"] for s in r["samples"] if s["finish"] == "length"), "token-checkpoint offsets recorded")
    try:
        WR.main(["MOCK", "dry_ret", out, setf, "2", "retrieval"], llm_factory=lambda: rmock_r, tok=tok, sp_factory=spr); raise RuntimeError
    except AssertionError as ex:
        check("refusing to overwrite" in str(ex), "retrieval re-run with same TAG refused")

    # ---------------- analysis on mock receipts ----------------
    rep = WA.analyze(out, "dry_commit", "dry_noret", "dry_ret", "dry_max")
    h1 = rep["H-WM1"]
    check(h1["verdict"] in ("SUPPORTED", "NOT SUPPORTED") and h1["p_decision"] == max(h1["unmatched"]["p_one_sided"], h1["tokens_matched"]["p_one_sided"])
          and rep["H-WM2"]["verdict"] in ("SUPPORTED", "NOT SUPPORTED"),
          f"analysis: H-WM1 co-primary {h1['verdict']} (unmatched {h1['unmatched']['wins']}/{h1['unmatched']['losses']} p={h1['unmatched']['p_one_sided']}, "
          f"matched p={h1['tokens_matched']['p_one_sided']}); H-WM2 {rep['H-WM2']['verdict']} p={rep['H-WM2']['p_one_sided']}")
    nov = [k for k, v in rep.items() if k not in ("H-WM1", "H-WM2") and isinstance(v, dict) and "verdict" in v]
    check(not nov and rep["evidence_class"].startswith("EXPLORATORY") and "EXTRA_WMMAX_vs_INTERACTIVE_EXPLORATORY" in rep
          and set(rep["efficiency_SECONDARY"]) == {"noret", "ret", "interactive", "wmmax"}
          and all(len(v["ci95_boot_boards"]) == 2 for v in rep["efficiency_SECONDARY"].values())
          and set(rep["multiplicity"]["holm_adjusted_p"]) == {"H-WM1", "H-WM2", "WMMAX_vs_NORET"}
          and "strict_format_rate" in rep["interactive_process_SECONDARY"]["interactive"],
          "analysis: only H-WM1/H-WM2 carry verdicts; evidence class; WMMAX vs INTERACTIVE; efficiency+CI for all 4 arms; Holm; strict-format rate")
    check(rep["noret_prefix_rescored"]["extra_from_prefix_rule"] > 0 and "H-WM1_prefix_scored_SECONDARY" in rep,
          f"analysis: single-shot any-prefix rescoring ({rep['noret_prefix_rescored']})")
    hl = WA.headline(rep)
    check(set(hl) == {"H-WM1", "H-WM2", "EXTRA_WMMAX_vs_NORET_EXPLORATORY", "EXTRA_WMMAX_vs_INTERACTIVE_EXPLORATORY", "evidence_class"},
          f"headline line holds primaries + exploratory p only: {json.dumps(hl)}")
    try:
        WA.analyze(out, "dry_inter", "dry_noret", "dry_ret", "dry_max"); raise RuntimeError("config not checked")
    except AssertionError as ex:
        check("commit_on_truncate" in str(ex), "analysis refuses an H-WM1 receipt without commit-on-truncate")

    # ---------------- Laya export join on the mock receipts ----------------
    xr = WX.export(out, os.path.join(root, "dry_laya.jsonl"), corpus_dir=None)
    gate = [json.loads(l) for l in open(os.path.join(root, "dry_laya.jsonl"))]
    tokv = [g for g in gate if g["view"] == "tok_ckpt"]
    check(tokv and all(g["selection"] == "unselected" and g["model"] == "MOCK" and len(g["input"]) == 73 + g["prefix_chars"] for g in tokv)
          and all(g["k"] in (1024, 2048, 4096, 8192) for g in tokv) and {g["label"] for g in gate} <= {0, 1},
          f"laya export: {len(tokv)} token-checkpoint examples joined from receipts (ckpt_chars), unselected same-model samples")
    check(all(g["think_close_char"] is None or g["think_close_char"] > g["prefix_chars"] for g in tokv), "laya export: prefixes lie strictly inside thinking")
    check(WC.sign_test([1] * 10, [0] * 10)[2] == 2 ** -10 and WC.sign_test([0, 1], [0, 1])[2] == 1.0, "sign test exact values")

    # ---------------- real holdout128 replay: retrieval coverage + preflights ----------------
    import v7_common
    from v5_common import write as v5write
    h128 = v7_common.regen_holdout128(LAB); hp = os.path.join(root, "holdout128.json")
    v5write(hp, {"seed": 51_20261003, "cases": h128})
    check(WC.sha_file(hp) == WC.H128_SHA256, "holdout128 replay sha256 == PREREG-CONFIRM-1 (9dd07cd7...)")
    ps = WR.build_prompts(h128, "retrieval", lib, {c["canonical_id"] for c in h128})
    use = collections.Counter(i for _, ids in ps for i in ids)
    check(all(len(ids) == 2 for _, ids in ps) and not (set(use) & {c["canonical_id"] for c in h128}),
          f"holdout128 retrieval: 2 examples/board, {len(use)} distinct library entries used, max reuse {max(use.values())}")
    std = None
    try:
        from transformers import AutoTokenizer
        std = AutoTokenizer.from_pretrained("Qwen/Qwen2.5-0.5B-Instruct", local_files_only=True)
    except Exception as ex:
        say("  NOTE stand-in tokenizer unavailable:", type(ex).__name__)
    for name, tk in (("mock", tok), ("qwen2.5-standin", std)):
        if tk is None: continue
        req = name == "mock"                       # the Qwen2.5 stand-in template has no <think>: it must be REFUSED by default
        if not req:
            for fn_ in (lambda: WI.preflight(hp, out, "pf_" + name, notes=True, tok=tk), lambda: WR.preflight(hp, out, "pf_" + name, "retrieval", tok=tk)):
                try:
                    fn_(); raise RuntimeError("tail without <think> not refused")
                except AssertionError as ex:
                    check("does not open thinking" in str(ex), f"preflight[{name}]: generation tail without <think> refused")
        wi = WI.preflight(hp, out, "pf_" + name, notes=True, tok=tk, require_think=req)
        wr = WR.preflight(hp, out, "pf_" + name, "retrieval", tok=tk, require_think=req)
        check(wi + WI.TURN_TOKENS + WI.COMMIT_TOKENS + WI.COMMIT_RESERVE <= WI.MAX_MODEL_LEN and wr + WR.MAXTOK <= WR.MAX_MODEL_LEN,
              f"preflight[{name}]: interactive worst prompt {wi} tok, retrieval worst prompt {wr} tok (both fit 20480)")
    say("WM_DRY_ALL_PASS", root)
    return root


if __name__ == "__main__":
    main()
