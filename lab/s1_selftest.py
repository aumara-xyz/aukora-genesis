"""S1 regression tests for the 2026-10-03 review fixes (s1_PREREG amendment A1). Mac, CPU, no model weights, ~10 s.
Uses the BFS oracle ONLY to build test expectations (this file is not on the inference path and is not AST-guarded).
Usage: python s1_selftest.py            -> prints S1_SELFTEST OK <n> tests, exits non-zero on the first failure."""
import json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sokoban
from sokoban import parse, solve, _transforms
import s1_common as C
import s1_lookahead as L
import s1_tabu as TB
import s1_ornith_eval as E

CASE0 = json.load(open(os.path.join(HERE, "holdout.json")))["cases"][0]
const = lambda p: (lambda boards: [{"p_solvable": p, "exp_dist": 10.0, "bucket_probs": [0.2] * 5} for _ in boards])
TESTS = []


def test(f):
    TESTS.append(f); return f


def first_optimal_push(board):
    mv, st = solve(board)
    w, g, bx, p = parse(board)
    acts = {a["moves"]: a for a in C.push_actions(w, bx, p)}
    for i in range(1, len(mv) + 1):
        if mv[:i] in acts: return mv, acts[mv[:i]]
    raise AssertionError("no push prefix")


@test
def tabu_short_correct_plan_is_not_a_dead_end():
    b = CASE0["board"]
    mv, a = first_optimal_push(b)
    assert sokoban.verify(b, a["moves"]) == "UNSOLVED"
    d = tempfile.mkdtemp(); path = os.path.join(d, "t.jsonl")
    kinds = [e["kind"] for e in TB.Tabu(b, path, episode=0).record_attempt(a["moves"])]
    assert kinds == ["unsolved_end"], kinds
    t1 = TB.Tabu(b, path, episode=1)
    assert not t1.dead_keys() and len(t1.soft_keys()) == 1
    res = L.Lookahead(const(0.6), top_k=3).analyze(b, tabu=t1)
    assert a["moves"] not in [x["moves"] for x in res["dead_ends"]], "optimal first push listed as a dead end"
    assert a["moves"] in [x["moves"] for x in res["tried_unfinished"]]
    blk = L.render_block(res)
    assert "Tried before, did not finish" in blk and "tabu" not in blk


@test
def tabu_proven_deadlock_is_a_dead_end():
    b = CASE0["board"]
    w, g, bx, p = parse(b)
    acts = [a for a in C.push_actions(w, bx, p) if C.deadlock(w, g, a["boxes"])]
    assert acts, "case 0 has no rule-dead first push"
    a = acts[0]
    d = tempfile.mkdtemp(); path = os.path.join(d, "t.jsonl")
    kinds = [e["kind"] for e in TB.Tabu(b, path).record_attempt(a["moves"])]
    assert kinds == ["dead_rule"], kinds
    t1 = TB.Tabu(b, path)
    assert len(t1.dead_keys()) == 1
    res = L.Lookahead(const(0.6)).analyze(b, tabu=t1)
    k = [x for x in res["dead_ends"] if x["moves"] == a["moves"]]
    assert k and k[0]["kind"] == "proven"


@test
def tabu_is_keyed_by_exact_board_not_symmetry_class():
    b = CASE0["board"]
    rot = _transforms(b.split("\n"))[0]
    assert rot != b and sokoban.canonical_id(rot) == sokoban.canonical_id(b)
    d = tempfile.mkdtemp(); path = os.path.join(d, "t.jsonl")
    TB.Tabu(b, path).record_attempt("RRU")
    assert len(TB.Tabu(b, path).entries) == 1
    assert len(TB.Tabu(rot, path).entries) == 0, "rotated copy loaded the original's (wrong-frame) entries"
    with open(path, "a") as f:                                     # legacy line (no board_sha256) is ignored
        f.write(json.dumps({"board_cid": sokoban.canonical_id(b), "kind": "illegal", "prefix": "L", "boxes": [], "player": [1, 1]}) + "\n")
    assert len(TB.Tabu(b, path).entries) == 1


@test
def dead_ends_split_proven_vs_estimate():
    b = CASE0["board"]
    res = L.Lookahead(const(0.01)).analyze(b)
    kinds = {x["kind"] for x in res["dead_ends"]}
    assert kinds <= {"proven", "estimate"} and "estimate" in kinds
    blk = L.render_block(res)
    assert "Likely dead ends (estimate, may be wrong):" in blk and "Known dead ends" not in blk
    for x in res["dead_ends"]:
        if x["kind"] == "estimate": assert x["why"].startswith("estimated P(solvable)")


@test
def solutions_are_stripped_from_hints():
    # a board solvable by one push: box left of a goal, player left of the box
    b = "########\n#@$.   #\n#      #\n# $  . #\n#      #\n#      #\n#      #\n########"
    b = b.replace("# $  . #", "#    * #").replace("#@$.   #", "#@$.   #")
    w, g, bx, p = parse(b)
    res = L.Lookahead(const(0.6), two_ply=True).analyze(b)
    assert any(o["solves"] for o in res["options"]) or any(o.get("best_next", {}).get("solves") for o in res["options"])
    n = L.strip_solutions(res)
    assert n >= 1 and not any(o["solves"] or o.get("best_next", {}).get("solves") for o in res["options"])
    assert "SOLVES" not in L.render_block(res)


@test
def encode_cells_asserts_wall_border():
    bad = CASE0["board"].split("\n"); bad[3] = " " + bad[3][1:]
    try: C.encode_cells("\n".join(bad)); raise RuntimeError("no assert")
    except AssertionError: pass
    assert C.encode_cells_v2(CASE0["board"]) == " " + C.encode_cells(CASE0["board"])


@test
def load_cases_refuses_sealed_sets():
    for name in ("holdout_v7.json", "holdout_rep1.json", "holdout_v8.json"):
        if not os.path.exists(os.path.join(HERE, name)): continue
        try: E.load_cases(os.path.join(HERE, name)); raise RuntimeError(f"{name} not refused")
        except AssertionError: pass
    E.load_cases(os.path.join(HERE, "holdout.json"))
    d = tempfile.mkdtemp(); f = os.path.join(d, "probe_set.json")
    rep1 = json.load(open(os.path.join(HERE, "holdout_rep1.json")))["cases"][:1]
    json.dump({"cases": rep1}, open(f, "w"))
    try: E.load_cases(f); raise RuntimeError("overlap with a sealed set not refused")
    except AssertionError: pass


def _mock_hints(d, name="holdout128.json", two_ply=False):
    f = os.path.join(d, name)
    shutil.copy(os.path.join(HERE, "holdout.json"), f)
    return f, E.make_hints(f, d, scorer=const(0.6), tag_src="selftest constant scorer", two_ply=two_ply)


@test
def two_ply_refused_for_preregistered_set():
    d = tempfile.mkdtemp()
    try: _mock_hints(d, two_ply=True); raise RuntimeError("two-ply not refused")
    except AssertionError: pass


@test
def run_refuses_unverified_or_missing_hints():
    d = tempfile.mkdtemp()
    f, hp = _mock_hints(d)
    try: E.run("MODEL", "real", d, f, 4); raise RuntimeError("dry-run hints accepted by a real run")
    except AssertionError as e: assert "files_sha256 is null" in str(e), e
    os.remove(hp)
    try: E.run("MODEL", "real", d, f, 4); raise RuntimeError("missing hints accepted")
    except AssertionError as e: assert "never built inline" in str(e), e


@test
def run_is_incremental_and_resumable():
    d = tempfile.mkdtemp()
    f, hp = _mock_hints(d)
    try: E.run("MOCK", "m", d, f, 2, mock=True, chunk_boards=8, llm=E.MockLLM(fail_after_calls=2)); raise RuntimeError("no stop")
    except RuntimeError as e: assert "simulated box stop" in str(e), e
    part = os.path.join(d, "s1_eval_m.partial.jsonl")
    got = [json.loads(x) for x in open(part)]
    assert sum(x["type"] == "board" for x in got) == 16, "chunks before the stop were not persisted"
    assert not os.path.exists(os.path.join(d, "s1_eval_m.json"))
    try: E.run("MOCK", "m", d, f, 2, mock=True, chunk_boards=8); raise RuntimeError("partial overwritten without --resume")
    except AssertionError: pass
    with open(part, "a") as fh: fh.write('{"type": "board", "row": {"id": "torn')         # simulated torn line
    final = E.run("MOCK", "m", d, f, 2, mock=True, chunk_boards=8, resume=True)
    r = json.load(open(final))
    assert len(r["cases"]) == 32 and r["engine_instances"] == 2 and "EXPLORATORY" in r["H_S1b"]["status"] and "verdict" not in r["H_S1b"]
    ids = [x["id"] for x in json.load(open(os.path.join(d, "s1_eval_m.raw.json")))["rows"]]
    assert len(ids) == 32 * 2 * 2


@test
def train_script_guards_fail_fast():
    py, script = sys.executable, os.path.join(HERE, "s1_train_laya.py")
    for args, msg in ((["--dry-run"], "exists; refusing"), (["--dry-run", "--out", os.path.join(HERE, "s1_tmp_x")], "outside lab"),
                      ([], "exists; refusing")):
        r = subprocess.run([py, script] + args, capture_output=True, text=True, timeout=120)
        assert r.returncode != 0 and msg in r.stderr, (args, r.stderr[-300:])
    assert not os.path.exists(os.path.join(HERE, "s1_tmp_x"))


@test
def data_script_refuses_to_overwrite_sealed_data():
    r = subprocess.run([sys.executable, os.path.join(HERE, "s1_data.py"), "--out", HERE], capture_output=True, text=True, timeout=120)
    assert r.returncode != 0 and "refusing to overwrite" in r.stderr, r.stderr[-300:]


if __name__ == "__main__":
    for t in TESTS:
        t(); print("ok", t.__name__, flush=True)
    print("S1_SELFTEST OK", len(TESTS), "tests")
