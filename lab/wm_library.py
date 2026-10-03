"""PAST-WINS LIBRARY ("aura chain" style, verified-only; Mac-side build + box-side retrieval helper).

Entries come ONLY from verified solves by this model family:
  v5_corpus.json (BASE model traces: v5_gen.py ran vLLM on the base MODEL; model='base') +
  v6_corpus.json rows with via == 'self' (v6_genA.py ran on the GEN-1 merged weights, v6_run.sh $G1; model='gen1').
  Each was selected as the shortest verified-OK trace (<= 12288 tokens) of k=4 samples (selection='shortest_ok_of_4').
  EXCLUDED: via == 'hint_rationalized' (hint-contaminated, AMENDMENTS), via == 'replay_gen1' (duplicate of v5_corpus).
Each entry = {canonical_id, board, moves (the solving model's final plan), oracle_len, features, source, src_id, via, model,
selection}.
Every entry is re-verified with sokoban.verify at build time (dropped if not OK). Boards whose canonical id (all 8
symmetries) is in holdout128 / holdout_v7 / holdout(32) are dropped. Duplicate canonical ids keep the shortest plan.
retrieve(board, k=2): nearest entries by a fixed, hand-set feature distance (no learned parameters), excluding the
query's own canonical id and any caller-supplied ids. Deterministic (ties broken by canonical id).
Usage: python wm_library.py build SRC_OUT_DIR DEST.jsonl [HOLDOUT128_JSON]     (writes DEST.jsonl + DEST.meta.json)
       python wm_library.py check DEST.jsonl                                   (re-verify + sha vs meta)"""
import collections, json, os, sys
from collections import deque

from sokoban import MOVES, parse, verify, solve, canonical_id
from v5_common import strict_plan
from posthoc_lenient import lenient
from wm_common import LAB, board_from_solve_prompt, sealed_ids, sha_file, sha_bytes, write_json

SOURCES = (("v5_corpus.json", None), ("v6_corpus.json", "self"))
MODEL_OF = {"v5_corpus.json": "base", "v6_corpus.json": "gen1"}          # which weights generated the trace
DEFAULT_PATH = os.path.join(LAB, "wm_library.jsonl")
VEC_KEYS = ("match_dist", "inner_walls", "player_box", "box_box", "goal_goal", "box_wall_adj", "box_corner",
            "goal_wall_adj", "reach_q", "pushable", "boxes_on_goal")
VEC_W = (2.0, 1.0, 0.5, 0.5, 0.5, 1.0, 1.0, 0.5, 0.5, 1.0, 2.0)


def _man(p, q):
    return abs(p[0] - q[0]) + abs(p[1] - q[1])


def features(board):
    """Board-only descriptors (no oracle information). Coordinates are (row, col)."""
    walls, goals, boxes, player = parse(board)
    b, g = sorted(boxes), sorted(goals)
    match = min(_man(b[0], g[0]) + _man(b[1], g[1]), _man(b[0], g[1]) + _man(b[1], g[0]))
    adj = lambda p: sum((p[0] + dr, p[1] + dc) in walls for dr, dc in MOVES.values())
    corner = lambda p: (((p[0] - 1, p[1]) in walls) or ((p[0] + 1, p[1]) in walls)) and (((p[0], p[1] - 1) in walls) or ((p[0], p[1] + 1) in walls))
    seen, q = {player}, deque([player])
    while q:
        p = q.popleft()
        for dr, dc in MOVES.values():
            n = (p[0] + dr, p[1] + dc)
            if n not in walls and n not in boxes and n not in seen: seen.add(n); q.append(n)
    push = 0
    for x in boxes:
        for dr, dc in MOVES.values():
            behind, beyond = (x[0] - dr, x[1] - dc), (x[0] + dr, x[1] + dc)
            if behind in seen and beyond not in walls and beyond not in boxes: push += 1
    return {"boxes": b, "goals": g, "player": list(player), "inner_walls": sum(0 < r < 7 and 0 < c < 7 for r, c in walls),
            "match_dist": match, "player_box": min(_man(player, x) for x in b), "box_box": _man(b[0], b[1]),
            "goal_goal": _man(g[0], g[1]), "box_wall_adj": sum(adj(x) for x in b), "box_corner": sum(corner(x) for x in b),
            "goal_wall_adj": sum(adj(x) for x in g), "reach": len(seen), "reach_q": len(seen) // 4, "pushable": push,
            "boxes_on_goal": len(boxes & goals)}


def distance(fa, fb):
    return sum(w * abs(fa[k] - fb[k]) for k, w in zip(VEC_KEYS, VEC_W))


def build(src_dir, dest=DEFAULT_PATH, lab=LAB, h128_path=None):
    excl, excl_src = sealed_ids(lab, h128_path)
    best, stats = {}, collections.Counter()
    inputs = {}
    for fname, via in SOURCES:
        path = os.path.join(src_dir, fname); inputs[fname] = sha_file(path)
        for e in json.load(open(path))["corpus"]:
            stats[f"{fname}:rows"] += 1
            if via is not None and e.get("via") != via:
                stats[f"{fname}:skip_via_{e.get('via')}"] += 1; continue
            board = board_from_solve_prompt(e["prompt"])
            if board is None: stats["drop_no_board"] += 1; continue
            moves = strict_plan(e["target"]) or lenient(e["target"])
            if not moves: stats["drop_no_moves"] += 1; continue
            if verify(board, moves) != "OK": stats["drop_verify_fail"] += 1; continue
            cid = canonical_id(board)
            if cid in excl: stats["drop_sealed_overlap"] += 1; continue
            o, st = solve(board)
            if st != "SOLVED" or len(o) != e.get("oracle_len", len(o)): stats["warn_oracle_len_mismatch"] += 1
            ent = {"canonical_id": cid, "board": board, "moves": moves, "oracle_len": len(o) if o else e.get("oracle_len"),
                   "features": features(board), "source": fname, "src_id": e["id"], "via": e.get("via", "self_v5"),
                   "model": MODEL_OF[fname], "selection": "shortest_ok_of_4"}
            if cid in best:
                stats["dup_canonical"] += 1
                if (len(moves), fname, e["id"]) >= (len(best[cid]["moves"]), best[cid]["source"], best[cid]["src_id"]): continue
            best[cid] = ent
    rows = [best[c] for c in sorted(best)]
    body = "".join(json.dumps(r, sort_keys=True, separators=(",", ":")) + "\n" for r in rows)
    with open(dest, "w") as f: f.write(body)
    meta = {"path": os.path.basename(dest), "sha256": sha_bytes(body), "n": len(rows), "inputs_sha256": inputs, "stats": dict(stats),
            "by_source": dict(collections.Counter(r["source"] for r in rows)), "by_model": dict(collections.Counter(r["model"] for r in rows)),
            "excluded_sealed_sets": excl_src, "n_excluded_ids": len(excl), "features": list(VEC_KEYS), "weights": list(VEC_W),
            "rule": "verified-only solves by base (v5) and gen-1 (v6 self); hint_rationalized excluded; sealed ids excluded; dup canonical -> shortest plan"}
    write_json(dest[:-len(".jsonl")] + ".meta.json" if dest.endswith(".jsonl") else dest + ".meta.json", meta)
    return rows, meta


def load(path=DEFAULT_PATH, check_sha=True):
    raw = open(path, "rb").read()
    meta_p = path[:-len(".jsonl")] + ".meta.json" if path.endswith(".jsonl") else path + ".meta.json"
    if check_sha and os.path.exists(meta_p):
        assert json.load(open(meta_p))["sha256"] == sha_bytes(raw), "library sha256 != meta"
    return [json.loads(l) for l in raw.decode().splitlines() if l.strip()]


def retrieve(board, k=2, lib=None, exclude_ids=frozenset()):
    lib = load() if lib is None else lib
    qid, fq = canonical_id(board), features(board)
    cands = [e for e in lib if e["canonical_id"] != qid and e["canonical_id"] not in exclude_ids]
    cands.sort(key=lambda e: (distance(fq, e["features"]), e["canonical_id"]))
    return cands[:k]


def check(path):
    lib = load(path)
    bad = [e["canonical_id"] for e in lib if verify(e["board"], e["moves"]) != "OK" or canonical_id(e["board"]) != e["canonical_id"]]
    assert not bad, bad
    return len(lib)


if __name__ == "__main__":
    if sys.argv[1] == "build":
        rows, meta = build(sys.argv[2], sys.argv[3], h128_path=sys.argv[4] if len(sys.argv) > 4 else None)
        print("WM_LIBRARY", json.dumps({k: meta[k] for k in ("n", "sha256", "stats", "by_source", "excluded_sealed_sets")}), flush=True)
    elif sys.argv[1] == "check":
        print("WM_LIBRARY_CHECK_OK", check(sys.argv[2]), sha_file(sys.argv[2]), flush=True)
