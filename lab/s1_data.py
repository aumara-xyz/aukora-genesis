"""S1 value-net data (Mac-side, pure python + multiprocessing): labelled Sokoban STATES from procedural boards.
Boards: sokoban.generate with rng seed 1020261003 (sequential), start must be BFS-solvable. Boards and every sampled
state are dropped if their canonical id (8 symmetries) is in the exclusion set: holdout.json (32), holdout128 (exact
replay of confirm.py via v7_common.regen_holdout128, asserted against pulled confirm_base.json), holdout_v7.json (144),
v7_cp.json boards (600), probe_vllm easy boards (16, replayed), every 'pool' board in pulled/out + run-dir receipts, and
every 8x8 grid found in pulled/**, run-dir *.json(l), ledger/**, lab/**.json (v7_common.scan_files).
Since the 2026-10-03 review (s1_PREREG amendment A1) boards are ALSO dropped when their LAYOUT (walls+goals,
symmetry-canonical, boxes/player ignored) occurs in any sealed or evaluated set: every holdout*.json and *pool*.json with
'cases' in lab/ and ledger/prereg/ (holdout32, holdout_v7, holdout_rep1, holdout_v8, v8_pool, ...), the holdout128 replay,
v7_cp, probe easy, pool receipts and every scanned grid. So a sealed puzzle with the player one cell over, or any training
board on a sealed layout, can never enter the data (disjointness by construction, not only by exact state). Outputs are
never overwritten (the sealed v1 data in lab/ is protected; write a new build with --out DIR).
Split by LAYOUT (walls+goals, symmetry-canonical): hash < 8% -> test, < 16% -> val, else train, so test/val boards (and
their states) never share a layout with train.
Labels: for each board the FULL reachable move-level state graph from the start is enumerated (always < STATE_CAP=50000
for 8x8 / 2 boxes; boards that hit the cap are dropped), then a reverse BFS from all solved states gives, for every
reachable state s, exactly what sokoban.solve(render(s)) returns: solvable iff a solved state is reachable, distance =
shortest number of moves. (Equivalence spot-checked against sokoban.solve with --check K.) Solved states (distance 0) are
not sampled. Buckets: 1-4, 5-8, 9-16, 17-32, 33+.
Sampling per board: states along one BFS-optimal path, endpoints/intermediates of push-biased random move walks (they push
boxes into walls/corners -> deadlocks) and post-push states of random push-macro walks (the lookahead's input
distribution), plus uniform random states of the reachable graph ('graph'). Up to 12 solvable + 12 unsolvable states per board (up to 6 of the unsolvable ones 'hard' = no sound
deadlock rule fires, when the board has them); each split is balanced 50/50 at the end. Boards whose start state is
already rule-dead are skipped before labelling (cheap filter; they would be dropped as unsolvable anyway).
Usage: python s1_data.py [--small] [--out DIR] [--workers N] [--check K]
Writes DIR/s1_states_{train,val,test}.jsonl + DIR/s1_states_manifest.json (sha256, label stats, exclusion summary)."""
import argparse, collections, glob, json, os, random, sys, time
from multiprocessing import Pool

from sokoban import H, W, STATE_CAP, parse, generate, canonical_id
from s1_common import (LAB, RUN, BUCKET_NAMES, render, bucket_of, layout_key, push_actions, deadlock, write_json, sha_file,
                       sha_bytes)

SEED = 1_020_261_003
TARGET = {"train": 60000, "val": 6000, "test": 6000}
SMALL = {"train": 600, "val": 60, "test": 60}
PER_BOARD = 12                       # max solvable and max unsolvable states per board
SPLIT_PCT = (("test", 8), ("val", 16), ("train", 100))
DELTA = (-W, W, -1, 1)               # U D L R on the flat 8x8 index
CODE = ("s1_data.py", "s1_common.py", "sokoban.py", "v7_common.py")
OUT_FILES = ("s1_states_train.jsonl", "s1_states_val.jsonl", "s1_states_test.jsonl", "s1_states_manifest.json")


def layout_raw(grid):
    """layout_key without sokoban.parse validation (scanned grids may be partial states): walls '#', goals '.', canonical."""
    rows = grid.split("\n")
    return canonical_id("\n".join("".join("#" if ch == "#" else "." if ch in ".+*" else " " for ch in r) for r in rows))


def _in_s1_path(f):
    return any(part.startswith("s1_") for part in os.path.relpath(os.path.abspath(f), RUN).split(os.sep))


def sealed_set_boards():
    """name -> boards, for every sealed / evaluated set file with 'cases' (holdout*.json, *pool*.json) in lab/ and
    ledger/prereg/, plus v7_cp items. Read-only."""
    out = {}
    pats = [os.path.join(LAB, "holdout*.json"), os.path.join(LAB, "*pool*.json"),
            os.path.join(RUN, "ledger", "prereg", "holdout*.json"), os.path.join(RUN, "ledger", "prereg", "*pool*.json")]
    for f in sorted({os.path.abspath(x) for p in pats for x in glob.glob(p)}):
        try: d = json.load(open(f))
        except (OSError, ValueError): continue
        cases = d.get("cases") if isinstance(d, dict) else None
        if isinstance(cases, list):
            out[os.path.relpath(f, RUN)] = [c["board"] for c in cases if isinstance(c, dict) and "board" in c]
    out["lab/v7_cp.json"] = [x["board"] for x in json.load(open(os.path.join(LAB, "v7_cp.json")))["items"]]
    return out


def split_of(lkey):
    h = int(lkey[:8], 16) % 100
    for name, pct in SPLIT_PCT:
        if h < pct: return name


# ---------------------------------------------------------------- exclusion set (read-only use of v7_common)
def _probe_easy_boards():
    """Exact replay of probe_vllm.py easy set (same as v7_common.probe_easy_ids, but returns boards)."""
    import v7_common
    from sokoban import solve
    seen = v7_common.holdout32_ids(); rng = random.Random(31_20261003); easy = []
    while len(easy) < 16:
        b = generate(rng); cid = canonical_id(b)
        if cid in seen: continue
        s, st = solve(b)
        if st == "SOLVED" and 4 <= len(s) <= 8: seen.add(cid); easy.append(b)
    return easy


def _scan_grids(files):
    """Every 8x8 bordered grid in the files (same scan as v7_common.scan_files, but returns the grids)."""
    import v7_common
    grids, per = set(), {}
    for f in files:
        try: txt = open(f, encoding="utf-8", errors="replace").read()
        except OSError: continue
        texts = [txt]
        if f.endswith(".json"):
            try: texts += list(v7_common._strings(json.loads(txt)))
            except ValueError: pass
        elif f.endswith(".jsonl"):
            for line in txt.splitlines():
                try: texts += list(v7_common._strings(json.loads(line)))
                except ValueError: pass
        found = {g for t in texts for g in v7_common.grids_in_text(t)}
        if found: per[os.path.relpath(f, RUN)] = len(found)
        grids |= found
    return grids, per


def exclusion():
    """-> (excluded canonical ids, excluded layouts, summary). Exact-state ids AND layouts of every sealed/evaluated set."""
    import v7_common
    t = time.time()
    h32 = v7_common.holdout32_ids()
    h128_cases = v7_common.regen_holdout128()                       # replay asserted vs confirm_base.json
    h128 = {c["canonical_id"] for c in h128_cases}
    assert len(h32) == 32 and len(h128) == 128 and not (h32 & h128)
    sets = sealed_set_boards()
    sets["holdout128 (regen)"] = [c["board"] for c in h128_cases]
    sets["probe_easy (replay)"] = _probe_easy_boards()
    pool_files = glob.glob(os.path.join(v7_common.PULLED, "out", "*.json")) + glob.glob(os.path.join(RUN, "*.json"))
    pool_b = []
    for f in pool_files:
        try: d = json.load(open(f))
        except (OSError, ValueError): continue
        if isinstance(d, dict) and isinstance(d.get("pool"), list):
            pool_b += [p["board"] for p in d["pool"] if isinstance(p, dict) and "board" in p]
    sets["pool receipts"] = pool_b
    files = [f for f in v7_common.candidate_files() if not _in_s1_path(f)]
    grids, per_file = _scan_grids(files)
    set_ids = {k: {canonical_id(b) for b in v} for k, v in sets.items()}
    excl = set().union(*set_ids.values()) | {canonical_id(g) for g in grids}
    excl_layouts = {layout_raw(b) for v in sets.values() for b in v} | {layout_raw(g) for g in grids}
    summary = {"sets": {k: len(v) for k, v in set_ids.items()}, "scanned_grids": len(grids), "scanned_files": len(per_file),
               "total_ids": len(excl), "total_layouts": len(excl_layouts),
               "excluded_ids_sha256": sha_bytes("\n".join(sorted(excl))), "excluded_layouts_sha256": sha_bytes("\n".join(sorted(excl_layouts))),
               "rule": "drop a board if its canonical id OR its layout (walls+goals, canonical) is excluded; drop a state if its id is excluded",
               "build_s": round(time.time() - t, 1)}
    return excl, excl_layouts, summary


# ---------------------------------------------------------------- exact state graph labelling (oracle; data only)
def _succ(wall, s):
    b1, b2, p = s
    for d in DELTA:
        n = p + d
        if wall[n]: continue
        if n == b1 or n == b2:
            beyond = n + d
            if wall[beyond] or beyond == b1 or beyond == b2: continue
            nb1, nb2 = (beyond, b2) if n == b1 else (b1, beyond)
            if nb1 > nb2: nb1, nb2 = nb2, nb1
            yield (nb1, nb2, n)
        else:
            yield (b1, b2, n)


def label_graph(board):
    """-> (states list, index dict, dist list (-1 = unsolvable), wall) or None if the reachable set hits STATE_CAP."""
    walls, goals, boxes, player = parse(board)
    wall = [False] * (H * W)
    for (r, c) in walls: wall[r * W + c] = True
    g1, g2 = sorted(r * W + c for (r, c) in goals)
    b1, b2 = sorted(r * W + c for (r, c) in boxes)
    start = (b1, b2, player[0] * W + player[1])
    idx, states, preds = {start: 0}, [start], [[]]
    i = 0
    while i < len(states):
        for ns in _succ(wall, states[i]):
            j = idx.get(ns)
            if j is None:
                j = len(states); idx[ns] = j; states.append(ns); preds.append([])
                if len(states) >= STATE_CAP: return None
            preds[j].append(i)
        i += 1
    dist = [-1] * len(states)
    q = [k for k, s in enumerate(states) if s[0] == g1 and s[1] == g2]
    for k in q: dist[k] = 0
    h = 0
    while h < len(q):
        j = q[h]; h += 1
        for k in preds[j]:
            if dist[k] < 0: dist[k] = dist[j] + 1; q.append(k)
    return states, idx, dist, wall, (walls, goals)


def to_sets(s):
    b1, b2, p = s
    return frozenset({divmod(b1, W), divmod(b2, W)}), divmod(p, W)


def from_sets(boxes, player):
    b1, b2 = sorted(r * W + c for (r, c) in boxes)
    return (b1, b2, player[0] * W + player[1])


def worker(job):
    gi, board, split = job
    rng = random.Random(f"s1:{SEED}:{gi}")
    g = label_graph(board)
    if g is None: return {"gi": gi, "status": "cap"}
    states, idx, dist, wall, (walls, goals) = g
    d0 = dist[0]
    if d0 <= 0: return {"gi": gi, "status": "unsolvable_start" if d0 < 0 else "trivial"}
    cand = collections.OrderedDict()                                  # state -> src (first source wins)
    # (a) one BFS-optimal path (deterministic: first successor in U D L R order with dist-1)
    s = states[0]; path = []
    while dist[idx[s]] > 0:
        path.append(s)
        s = next(n for n in _succ(wall, s) if dist[idx[n]] == dist[idx[s]] - 1)
    for s in path: cand.setdefault(s, "opt")
    # (b) push-biased random move walks
    for _ in range(14):
        s = states[0]; T = rng.randint(1, 60); visited = []
        for _t in range(T):
            nxt = list(_succ(wall, s))
            pushes = [n for n in nxt if (n[0], n[1]) != (s[0], s[1])]
            s = rng.choice(pushes) if pushes and rng.random() < 0.5 else rng.choice(nxt)
            visited.append(s)
        cand.setdefault(s, "walk")
        if len(visited) > 3: cand.setdefault(rng.choice(visited[:-1]), "walk")
    # (c) random push-macro walks (simulator macro-actions, same as s1_lookahead)
    for _ in range(10):
        boxes, player = to_sets(states[0])
        for _k in range(rng.randint(1, 6)):
            acts = push_actions(walls, boxes, player)
            if not acts: break
            a = rng.choice(acts); boxes, player = a["boxes"], a["player"]
            cand.setdefault(from_sets(boxes, player), "push")
            if boxes == goals: break
    # (d) uniform random reachable states (adds 'hard' deadlocks: unsolvable although no sound rule fires)
    for k in rng.sample(range(1, len(states)), min(40, len(states) - 1)):
        cand.setdefault(states[k], "graph")
    sol, uns = [], []
    for s, src in cand.items():
        d = dist[idx[s]]
        if d == 0: continue
        (sol if d > 0 else uns).append((s, src, d))
    # keep the optimal-path states spread over distances: evenly spaced picks first, then random others
    rng.shuffle(sol); rng.shuffle(uns)
    opt = sorted([x for x in sol if x[1] == "opt"], key=lambda x: x[2])
    if opt:
        k = min(len(opt), PER_BOARD // 2)
        pick = [opt[round(i * (len(opt) - 1) / max(1, k - 1))] for i in range(k)] if k > 1 else opt[:1]
        seen = set(); pick = [x for x in pick if not (x[0] in seen or seen.add(x[0]))]
        rest = [x for x in sol if x not in pick]
        sol = pick + rest
    # unsolvable: up to half of the picks are 'hard' (no sound deadlock rule fires), so the net must learn more than the rules
    flag = {x[0]: deadlock(walls, goals, to_sets(x[0])[0]) is not None for x in uns}
    hard = [x for x in uns if not flag[x[0]]]; easy = [x for x in uns if flag[x[0]]]
    nh = min(len(hard), PER_BOARD // 2)
    uns = hard[:nh] + easy[:PER_BOARD - nh] + hard[nh:]
    out = []
    for s, src, d in sol[:PER_BOARD] + uns[:PER_BOARD]:
        boxes, player = to_sets(s)
        b = render(walls, goals, boxes, player)
        dead = deadlock(walls, goals, boxes)
        out.append({"board": b, "solvable": d > 0, "dist": d if d > 0 else None, "bucket": bucket_of(d) if d > 0 else None,
                    "src": src, "rule_dead": dead is not None, "cid": canonical_id(b)})
    return {"gi": gi, "status": "ok", "oracle_len": d0, "n_reachable": len(states), "states": out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--small", action="store_true")
    ap.add_argument("--out", default=LAB)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    ap.add_argument("--check", type=int, default=200, help="spot-check K sampled labels against sokoban.solve")
    a = ap.parse_args()
    T0 = time.time()
    target = SMALL if a.small else TARGET
    for f in OUT_FILES:
        assert not os.path.exists(os.path.join(a.out, f)), f"{os.path.join(a.out, f)} exists; refusing to overwrite (sealed data)"
    os.makedirs(a.out, exist_ok=True)
    excl, excl_layouts, excl_summary = exclusion()
    print("S1_DATA exclusion", json.dumps(excl_summary), flush=True)
    rng = random.Random(SEED)
    pools = {sp: {"sol": [], "uns": []} for sp in target}
    seen_state = {}                                                  # cid -> split
    seen_board = set()
    cnt = collections.Counter(); boards_used = collections.Counter(); layouts = collections.defaultdict(set)
    oracle_lens = collections.defaultdict(list); reach = []
    full = lambda sp: len(pools[sp]["sol"]) >= target[sp] // 2 and len(pools[sp]["uns"]) >= target[sp] // 2
    gi = 0
    with Pool(a.workers) as pool:
        while not all(full(sp) for sp in target):
            jobs = []
            while len(jobs) < 64 * a.workers:
                b = generate(rng); gi += 1; cid = canonical_id(b)
                if cid in excl: cnt["board_excluded"] += 1; continue
                if layout_raw(b) in excl_layouts: cnt["board_layout_excluded"] += 1; continue
                if cid in seen_board: cnt["board_dup"] += 1; continue
                seen_board.add(cid)
                w_, g_, bx_, _p = parse(b)
                if deadlock(w_, g_, bx_) is not None: cnt["board_start_rule_dead"] += 1; continue   # provably unsolvable start
                lk = layout_key(b); sp = split_of(lk)
                if full(sp): cnt["board_split_full"] += 1; continue
                jobs.append((gi, b, sp)); layouts[sp].add(lk)
            for job, r in zip(jobs, pool.imap(worker, jobs, chunksize=4)):
                sp = job[2]
                if r["status"] != "ok": cnt["board_" + r["status"]] += 1; continue
                if full(sp): cnt["board_split_full"] += 1; continue
                boards_used[sp] += 1; oracle_lens[sp].append(r["oracle_len"]); reach.append(r["n_reachable"])
                for st in r["states"]:
                    if st["cid"] in excl: cnt["state_excluded"] += 1; continue
                    if st["cid"] in seen_state:
                        assert seen_state[st["cid"]] == sp, "state shared across splits"
                        cnt["state_dup"] += 1; continue
                    seen_state[st["cid"]] = sp
                    st["board_cid"] = canonical_id(job[1]); st["layout"] = layout_key(job[1])[:16]
                    pools[sp]["sol" if st["solvable"] else "uns"].append(st)
            print("S1_DATA progress", {sp: (len(pools[sp]["sol"]), len(pools[sp]["uns"])) for sp in target}, "boards_generated", gi,
                  round(time.time() - T0, 1), "s", flush=True)
    # balance 50/50 (order-preserving truncation), write
    manifest = {"name": "s1_states", "seed": SEED, "small": a.small, "target": target, "per_board_max": PER_BOARD,
                "split_rule": "layout canonical id hash%100: <8 test, <16 val, else train", "buckets": BUCKET_NAMES,
                "label_method": "full reachable state graph + reverse BFS from solved states (== sokoban.solve per state)",
                "exclusion": excl_summary, "counts": dict(cnt), "files": {}, "stats": {}}
    rows_all = {}
    for sp in target:
        n = target[sp] // 2
        rows = pools[sp]["sol"][:n] + pools[sp]["uns"][:n]
        random.Random(f"s1:shuffle:{sp}").shuffle(rows)
        for i, x in enumerate(rows): x["id"] = f"{sp}{i:06d}"
        rows_all[sp] = rows
        path = os.path.join(a.out, f"s1_states_{sp}.jsonl")
        with open(path, "w") as f:
            for x in rows:
                f.write(json.dumps({k: x[k] for k in ("id", "board", "solvable", "dist", "bucket", "src", "rule_dead", "cid", "board_cid", "layout")}) + "\n")
        sol = [x for x in rows if x["solvable"]]; uns = [x for x in rows if not x["solvable"]]
        ol = sorted(oracle_lens[sp])
        manifest["files"][os.path.basename(path)] = sha_file(path)
        manifest["stats"][sp] = {
            "n": len(rows), "solvable": len(sol), "unsolvable": len(uns),
            "bucket_hist": {BUCKET_NAMES[k]: v for k, v in sorted(collections.Counter(x["bucket"] for x in sol).items())},
            "src_hist": {"solvable": dict(collections.Counter(x["src"] for x in sol)), "unsolvable": dict(collections.Counter(x["src"] for x in uns))},
            "unsolvable_rule_detectable": sum(x["rule_dead"] for x in uns), "solvable_rule_flagged_MUST_BE_0": sum(x["rule_dead"] for x in sol),
            "boards": boards_used[sp], "layouts": len({x["layout"] for x in rows}), "distinct_boards_in_rows": len({x["board_cid"] for x in rows}),
            "board_oracle_len": {"min": ol[0], "median": ol[len(ol) // 2], "max": ol[-1]} if ol else None}
        assert manifest["stats"][sp]["solvable_rule_flagged_MUST_BE_0"] == 0, "deadlock rule flagged a solvable state (unsound rule)"
    lay = {sp: {x["layout"] for x in rows_all[sp]} for sp in rows_all}
    bc = {sp: {x["board_cid"] for x in rows_all[sp]} for sp in rows_all}
    manifest["disjoint"] = {"layouts_train_test": len(lay["train"] & lay["test"]), "layouts_train_val": len(lay["train"] & lay["val"]),
                            "boards_train_test": len(bc["train"] & bc["test"]), "boards_train_val": len(bc["train"] & bc["val"])}
    assert all(v == 0 for v in manifest["disjoint"].values()), manifest["disjoint"]
    every = [x for sp in rows_all for x in rows_all[sp]]
    manifest["sealed_overlap"] = {"state_ids": sum(x["cid"] in excl for x in every),
                                  "layouts": sum(layout_raw(x["board"]) in excl_layouts for x in every)}
    assert all(v == 0 for v in manifest["sealed_overlap"].values()), manifest["sealed_overlap"]
    manifest["reachable_states_per_board"] = {"max": max(reach), "mean": round(sum(reach) / len(reach), 1), "STATE_CAP": STATE_CAP}
    # spot-check labels against the real BFS oracle
    if a.check:
        from sokoban import solve
        rr = random.Random(f"s1:check:{SEED}"); allrows = [x for sp in rows_all for x in rows_all[sp]]
        bad = []
        for x in rr.sample(allrows, min(a.check, len(allrows))):
            mv, st = solve(x["board"])
            ok = (st == "SOLVED" and x["solvable"] and len(mv) == x["dist"]) or (st == "UNSOLVABLE" and not x["solvable"])
            if not ok: bad.append({"id": x["id"], "status": st, "len": None if mv is None else len(mv), "label": (x["solvable"], x["dist"])})
        manifest["oracle_check"] = {"k": min(a.check, len(allrows)), "mismatches": len(bad), "examples": bad[:5]}
        assert not bad, bad[:5]
    manifest["code_sha256"] = {f: sha_file(os.path.join(LAB, f)) for f in CODE}
    manifest["wall_s"] = round(time.time() - T0, 1); manifest["workers"] = a.workers
    write_json(os.path.join(a.out, "s1_states_manifest.json"), manifest)
    print("S1_DATA done", json.dumps({sp: manifest["stats"][sp]["n"] for sp in target}), "files", json.dumps(manifest["files"]),
          "wall_s", manifest["wall_s"], flush=True)


if __name__ == "__main__":
    main()
