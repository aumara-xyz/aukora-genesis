"""S1 lookahead ("fast intuition"): for a board state, enumerate every reachable box-push macro-action (player BFS to the
push position, then one push), simulate it, and score the resulting state with the trained value net (P(solvable),
expected moves to solve) plus SOUND deadlock rules (dead squares incl. non-goal corners, frozen 2x2 blocks). Optional
2-ply: each first push is also scored by the best of its next pushes. Returns the top-k options in plain words and two
dead-end lists, kept apart since the 2026-10-03 review (amendment A1 in s1_PREREG.md):
  proven  a sound deadlock rule fires, or a s1_tabu.Tabu recorded a PROVEN deadlock there (dead_rule) -> certain;
  likely  value-net P(solvable) < 0.05 -> a learned estimate that can be wrong.
States a Tabu saw at the end of a legal plan that did not finish (unsolved_end) are NOT dead ends: they are only noted as
'tried before, did not finish' (no P change).
NO ORACLE: this module never calls sokoban.solve. Enforced twice: (1) assert_no_oracle() AST-scans s1_lookahead.py,
s1_common.py, s1_value.py, s1_tabu.py at import time for any use of `solve` / s1_data; (2) every analyze() call runs with
sokoban.solve replaced by a tripwire that raises.
Ranking score = P - 0.01 * est_total_moves (P = 2-ply value when available). Coordinates (row, col) are 0-indexed from the
top-left corner (row 0 = top wall line), the same convention as the v7 consequence-prediction traces.
CLI (Mac dry run / latency): python s1_lookahead.py [--model s1_laya | --random-head] [--set holdout.json | STATES.jsonl]
                                                     [--n 6] [--two-ply] [--device mps|cpu] [--fp16] [--dump OUT.json]
A .jsonl --set (s1_states_*.jsonl rows) uses the first N rows from distinct boards (board_cid), in file order."""
import ast, contextlib, json, os, sys, time

import sokoban
from sokoban import parse
from s1_common import LAB, push_actions, deadlock, describe_push, render, WORD, sha_bytes

GUARDED = ("s1_lookahead.py", "s1_common.py", "s1_value.py", "s1_tabu.py")
FORBIDDEN_NAMES = {"solve", "label_graph", "s1_data", "regen_holdout128"}


def assert_no_oracle(files=GUARDED):
    """Static check: none of the inference-path modules reference the BFS oracle. Returns a small report."""
    rep = {}
    for f in files:
        src = open(os.path.join(LAB, f)).read(); hits = []
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES: hits.append(node.id)
            elif isinstance(node, ast.Attribute) and node.attr in FORBIDDEN_NAMES: hits.append(node.attr)
            elif isinstance(node, ast.ImportFrom):
                hits += [a.name for a in node.names if a.name in FORBIDDEN_NAMES]
                if node.module in FORBIDDEN_NAMES: hits.append(node.module)
            elif isinstance(node, ast.Import):
                hits += [a.name for a in node.names if a.name in FORBIDDEN_NAMES]
        assert not hits, f"oracle reference in {f}: {hits}"
        rep[f] = sha_bytes(src)
    return {"checked": rep, "forbidden": sorted(FORBIDDEN_NAMES), "ok": True}


NO_ORACLE = assert_no_oracle()


@contextlib.contextmanager
def oracle_tripwire():
    name = "sol" + "ve"                       # string, not an AST reference: the tripwire only replaces the oracle
    real = getattr(sokoban, name)

    def tripped(*a, **k):
        raise RuntimeError("sokoban oracle called during lookahead inference (oracle use is forbidden)")
    setattr(sokoban, name, tripped)
    try:
        yield
    finally:
        setattr(sokoban, name, real)


def _key(boxes, player):
    return (tuple(sorted(boxes)), player)


class Lookahead:
    def __init__(self, scorer, top_k=3, dead_p=0.05, two_ply=False, expand=None, budget_ms=None):
        """scorer(list_of_8line_boards) -> [{'p_solvable', 'exp_dist', ...}]. expand: 2-ply expands only the best `expand`
        first pushes by 1-ply score (None = all). budget_ms (online use only; makes output machine-speed dependent, so it
        is NOT used for preregistered hints): 2-ply expands as many first pushes, best first, as the measured per-state
        cost of the 1-ply batch predicts will fit in the budget."""
        self.scorer, self.top_k, self.dead_p, self.two_ply, self.expand, self.budget_ms = scorer, top_k, dead_p, two_ply, expand, budget_ms

    def warmup(self, max_batch=48):
        """Compile/caches every padded batch shape once (MPS builds a kernel graph per shape)."""
        dummy = "########\n#@ $ . #\n#      #\n# $  . #\n#      #\n#      #\n#      #\n########"
        step_ = max(1, getattr(self.scorer, "pad_to", 1))
        for b in range(step_, max_batch + 1, step_):
            self.scorer([dummy] * b)

    def _children(self, walls, goals, boxes, player, tabu_keys, soft_keys=frozenset()):
        out = []
        for a in push_actions(walls, boxes, player):
            a = dict(a)
            a["solved"] = a["boxes"] == goals
            a["rule"] = None if a["solved"] else deadlock(walls, goals, a["boxes"])
            k = _key(a["boxes"], a["player"])
            a["tabu"] = k in tabu_keys                     # proven dead (Tabu dead_rule)
            a["tried"] = k in soft_keys and not a["tabu"]  # soft: tried before, did not finish (not proven dead)
            a["board_after"] = render(walls, goals, a["boxes"], a["player"])
            out.append(a)
        return out

    def analyze(self, board, two_ply=None, tabu=None):
        two_ply = self.two_ply if two_ply is None else two_ply
        t0 = time.perf_counter()
        with oracle_tripwire():
            walls, goals, boxes, player = parse(board)
            tabu_keys = tabu.dead_keys() if tabu is not None else set()
            soft_keys = tabu.soft_keys() if tabu is not None and hasattr(tabu, "soft_keys") else set()
            if boxes == goals:
                return {"solved_already": True, "options": [], "dead_ends": [], "ms": 0.0, "two_ply": two_ply}
            first = self._children(walls, goals, boxes, player, tabu_keys, soft_keys)
            need = {a["board_after"] for a in first if not a["solved"] and not a["rule"]}
            t1 = time.perf_counter()
            sc = dict(zip(sorted(need), self.scorer(sorted(need))))
            per_state = (time.perf_counter() - t1) * 1000 / max(1, len(need))
            for a in first: self._fill(a, sc)
            n_scored = len(need); expanded = 0
            if two_ply:
                live = sorted([a for a in first if not a["solved"] and not a["rule"]], key=lambda a: -a["score1"])
                if self.expand: live = live[:self.expand]
                if self.budget_ms is not None:
                    left = self.budget_ms - (time.perf_counter() - t0) * 1000 - 5.0
                    kids_per = max(1.0, sum(len(push_actions(walls, a["boxes"], a["player"])) for a in live) / max(1, len(live)))
                    live = live[:max(0, int(left / (per_state * kids_per)))]
                expanded = len(live)
                for a in live:
                    a["kids"] = self._children(walls, goals, a["boxes"], a["player"], tabu_keys, soft_keys)
                need2 = {k["board_after"] for a in live for k in a["kids"] if not k["solved"] and not k["rule"] and k["board_after"] not in sc}
                sc.update(zip(sorted(need2), self.scorer(sorted(need2))))
                n_scored += len(need2)
                for a in live:
                    for k in a["kids"]: self._fill(k, sc, base=len(a["moves"]))
                    best = max(a["kids"], key=lambda k: k["score1"]) if a["kids"] else None
                    a["best_next"] = best
                    a["p2"] = best["p"] if best else 0.0                         # no next push possible -> stuck
                    a["est2"] = best["est_total"] if best else a["est_total"]
            for a in first:
                p = a.get("p2", a["p"]); est = a.get("est2", a["est_total"])
                a["score"] = 1e9 if a["solved"] else p - 0.01 * est
            ranked = sorted(first, key=lambda a: -a["score"])
            proven = [a for a in first if a["rule"] or a["tabu"]]
            likely = [a for a in first if not (a["rule"] or a["tabu"]) and not a["solved"] and a["p"] < self.dead_p]
            dead = proven + likely
            dead_ids = {id(a) for a in dead}
            opts = [a for a in ranked if id(a) not in dead_ids][:self.top_k]
            tried = [a for a in ranked if a["tried"] and id(a) not in dead_ids]
        ms = (time.perf_counter() - t0) * 1000
        return {"solved_already": False, "two_ply": two_ply, "expanded": expanded, "n_actions": len(first), "n_scored": n_scored, "ms": round(ms, 1),
                "options": [self._public(a) for a in opts], "dead_ends": [self._public(a, dead=True) for a in dead],
                "tried_unfinished": [self._public(a) for a in tried]}

    @staticmethod
    def _fill(a, sc, base=0):
        if a["solved"]: a["p"], a["exp_dist"] = 1.0, 0.0
        elif a["rule"]: a["p"], a["exp_dist"] = 0.0, None
        else: a["p"], a["exp_dist"] = sc[a["board_after"]]["p_solvable"], sc[a["board_after"]]["exp_dist"]
        a["est_total"] = base + len(a["moves"]) + (a["exp_dist"] or 0.0)
        a["score1"] = 1e9 if a["solved"] else a["p"] - 0.01 * a["est_total"]

    @staticmethod
    def _public(a, dead=False):
        r = {"text": describe_push(a), "moves": a["moves"], "box": list(a["box"]), "dir": a["dir"], "solves": a["solved"],
             "p_solvable": round(a["p"], 3), "est_total_moves": None if a["rule"] else round(a["est_total"], 1),
             "tried_unfinished": bool(a.get("tried"))}
        if "p2" in a:
            r["p_best_next"] = round(a["p2"], 3)
            if a.get("best_next"): r["best_next"] = {"text": describe_push(a["best_next"]), "moves": a["best_next"]["moves"],
                                                     "p_solvable": round(a["best_next"]["p"], 3), "solves": a["best_next"]["solved"]}
        if dead:
            r["kind"] = "proven" if (a["rule"] or a["tabu"]) else "estimate"
            r["why"] = a["rule"] or ("an earlier attempt proved this a dead end (tabu)" if a["tabu"] else f"estimated P(solvable) {a['p']:.2f}")
        return r


def render_block(res, max_dead=6):
    """Prompt block for arm B / harness observations."""
    if res.get("solved_already"): return ""
    L = ["Intuition (fast estimates, may be wrong):",
         "Coordinates are (row, col), 0-indexed from the top-left corner (row 0 is the top wall line).",
         "P = estimated chance the puzzle is still solvable after that push; est = estimated total moves to finish."]
    if res["options"]:
        L.append("Most promising first pushes:")
        for i, o in enumerate(res["options"], 1):
            if o["solves"]:
                L.append(f"{i}. {o['text']}. This push SOLVES the puzzle."); continue
            s = f"{i}. {o['text']}. P={o['p_solvable']:.2f}, est {o['est_total_moves']:.0f} moves"
            if o.get("best_next"):
                s += f"; then best next: {o['best_next']['text']} (P={o['best_next']['p_solvable']:.2f})"
            if o.get("tried_unfinished"):
                s += " (tried before, did not finish; not proven dead)"
            L.append(s + ".")
    else:
        L.append("No promising push found from this position (every push looks like a dead end).")
    proven = [d for d in res["dead_ends"] if d.get("kind", "proven") == "proven"][:max_dead]
    likely = [d for d in res["dead_ends"] if d.get("kind") == "estimate"][:max(0, max_dead - len(proven))]
    if proven:
        L.append("Proven dead ends (a sound rule shows the puzzle can no longer be solved; avoid):")
        for d in proven:
            L.append(f"- {d['text']}: {d['why']}.")
    if likely:
        L.append("Likely dead ends (estimate, may be wrong):")
        for d in likely:
            L.append(f"- {d['text']}: {d['why']}.")
    tried = res.get("tried_unfinished") or []
    if tried:
        L.append("Tried before, did not finish (not proven dead; the earlier plan may have stopped early):")
        for o in tried[:3]:
            L.append(f"- {o['text']}.")
    return "\n".join(L)


def strip_solutions(res):
    """Remove any option / best-next line that would hand over a complete solution (a push that SOLVES the puzzle).
    Returns the number of lines removed. Used by s1_ornith_eval.make_hints before any hint text is rendered."""
    n = 0
    keep = []
    for o in res.get("options", []):
        if o.get("solves"): n += 1; continue
        if o.get("best_next", {}).get("solves"):
            o = dict(o); o.pop("best_next"); n += 1
        keep.append(o)
    res["options"] = keep
    return n


def inject_into_observation(obs_text, board, lookahead, tabu=None, two_ply=None):
    """Harness hook: append the intuition block (and the tabu 'Avoid' block) for the CURRENT board to an observation."""
    res = lookahead.analyze(board, two_ply=two_ply, tabu=tabu)
    parts = [obs_text, render_block(res)]
    if tabu is not None:
        av = tabu.avoid_block()
        if av: parts.append(av)
    return "\n\n".join(p for p in parts if p), res


def _cli():
    import argparse, torch
    import s1_value as V
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.path.join(LAB, "s1_laya"))
    ap.add_argument("--random-head", action="store_true")
    ap.add_argument("--set", default=os.path.join(LAB, "holdout.json"))
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--two-ply", action="store_true")
    ap.add_argument("--expand", type=int, default=None)
    ap.add_argument("--budget-ms", type=float, default=None)
    ap.add_argument("--device", default=None)
    ap.add_argument("--fp16", action="store_true")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--show", type=int, default=2)
    ap.add_argument("--dump", default=None, help="write per-board 1-ply results (options, dead ends, ms) to this JSON file")
    ap.add_argument("--net-input-only", action="store_true", help=".jsonl sets: skip states a sound rule already flags (rule_dead)")
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    dev = V.pick_device(a.device)
    if dev == "mps": torch.mps.set_per_process_memory_fraction(0.5)
    dt = torch.float16 if a.fp16 else torch.float32
    if a.random_head:
        scorer, info = V.random_head_scorer(device=dev, dtype=dt); src = "laya encoder + RANDOM heads (untrained)"
    else:
        m, tok, meta = V.load(a.model, device=dev); scorer = V.Scorer(m, tok, meta, device=dev, dtype=dt if a.fp16 else None)
        src = a.model
    if a.set.endswith(".jsonl"):
        cases, seen = [], set()
        for line in open(a.set):
            x = json.loads(line)
            if x.get("board_cid") in seen or (a.net_input_only and x.get("rule_dead")): continue
            seen.add(x.get("board_cid")); cases.append({"id": x["id"], "board": x["board"]})
            if len(cases) >= a.n: break
    else:
        cases = json.load(open(a.set))["cases"][:a.n]
    la = Lookahead(scorer, two_ply=a.two_ply, expand=a.expand, budget_ms=a.budget_ms)
    tw = time.time(); la.warmup(); warm_s = round(time.time() - tw, 1)                     # compile every padded batch shape once
    rows, dump = [], []
    for c in cases:
        r1 = la.analyze(c["board"], two_ply=False); r2 = la.analyze(c["board"], two_ply=True)
        dump.append({"id": c["id"], "board": c["board"], "one_ply": r1, "block": render_block(r1)})
        rows.append({"id": c["id"], "ms_1ply": r1["ms"], "scored_1ply": r1["n_scored"], "ms_2ply": r2["ms"], "scored_2ply": r2["n_scored"],
                     "expanded_2ply": r2["expanded"],
                     "n_actions": r1["n_actions"], "dead_ends": len(r1["dead_ends"])})
    for c in cases[:a.show]:
        print("----", c["id"]); print(c["board"]); print(render_block(la.analyze(c["board"], two_ply=a.two_ply)))
    ms1 = sorted(r["ms_1ply"] for r in rows); ms2 = sorted(r["ms_2ply"] for r in rows)
    print("S1_LOOKAHEAD", json.dumps({"scorer": src, "device": dev, "dtype": str(dt), "boards": len(rows), "warmup_s": warm_s,
                                      "expand": a.expand, "budget_ms": a.budget_ms, "median_ms_1ply": ms1[len(ms1) // 2],
                                      "max_ms_1ply": ms1[-1], "median_ms_2ply": ms2[len(ms2) // 2], "max_ms_2ply": ms2[-1],
                                      "no_oracle": NO_ORACLE["ok"], "rows": rows}))
    if a.dump:
        with open(a.dump, "w") as f: json.dump({"scorer": src, "device": dev, "set": os.path.basename(a.set), "cases": dump}, f, indent=1)


if __name__ == "__main__":
    _cli()
