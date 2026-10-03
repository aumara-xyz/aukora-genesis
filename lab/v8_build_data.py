"""v8 BUILD DATA (Mac or box CPU, pure python). Training items for v8_train.py, written to OUT/v8_data.json.

DIFFICULTY of an item = how far its start state is from the solve (oracle move distance):
  turn items   the turn's own start state, oracle d_before (NOT the board's start length: a late turn on a 33-48 board can start
               2 moves from the solve);
  single/replay  the board's oracle_len (a full solution starts at the board start).
  HARD = difficulty >= 17, SHORT = difficulty <= 16. "band" is the difficulty band; turn items also keep "board_band".

 (a) GOOD TURNS from OUT/v8_turns.jsonl (v8_collect post): kind 'turn'. A turn is GOOD iff
       - the model's own reply closed thinking and stopped (finish 'stop', not a forced commit), its post-think text is exactly
         one JSON with 1-8 moves (strict_format; no clipping), and every move was legal;
       - it did not overshoot: a solving turn applied every requested move (the harness stops at the solve; a target with
         extra moves would teach a habit that fails single-shot verify);
       - the oracle distance strictly decreased (d_after < d_before; a fatal move makes d_after unsolvable) AND reached a new
         best for its episode (d_after < min(d_start_board, d_after of every earlier turn)): undoing an earlier regression is
         not progress;
       - it moved at least one box (net box configuration changed): walk-only turns carry no push decision;
       - efficiency (distance gained per applied move) >= MIN_EFF.
     Target = that turn's full assistant text (thinking + final JSON); context = the exact bounded multi-turn messages the model
     saw. Ranked by efficiency, then hard start state, then pushes, then distance gained; at most CAP_PER_BOARD per board and
     CAP_PER_EPISODE per episode; at most MAX_TURN_ITEMS.
 (b) VERIFIED FULL SOLUTIONS from single-shot attempts, kind 'single': OUT/v8_single.json (strict OK, finish 'stop',
     <= 12288 tokens, shortest per board) + the 37 gen-1 self-solves in v6_A.json 'direct' (re-verified strictly here).
 (c) REPLAY of the v5 corpus (50 verified traces), kind 'replay'.
 (d) CP: all 600 v7_cp.json items (v7's absolute CP dose: 100 units per epoch), kind 'cp'.
MIX RULES over PUZZLE OPTIMIZER UNITS (CP excluded; a turn row counts 1/TURN_GROUP because v8_train pairs turn rows per unit,
single/replay rows count 1), enforced together by trimming until all hold:
   R1  turn items with a HARD start state >= HARD_MIN of turn items          (trim: worst-ranked short turn)
   R2  turn-1 items <= TURN1_MAX of turn items (closest structural match to single-shot)   (trim: worst short turn-1, else hard)
   R3  SHORT units <= SHORT_MAX of puzzle units  (trim order: short replay (seeded), short turns (worst), short singles (longest))
Guards (hard failures): no item board is in a sealed set; prompts contain no oracle vocabulary; every selected turn's messages
are re-derived from wm_interactive's turn log by an independent replay and must match byte-for-byte (so they come from the
harness only, never from the grader). Items whose prompt or target contains ANY 8x8 grid of a sealed board are dropped.
Usage: python3 v8_build_data.py OUT [--no-v6] [--allow-nonstrict] [--skip-replay-check]   -> OUT/v8_data.json (+ report on stdout)"""
import collections, hashlib, json, os, random, statistics, sys, time

from sokoban import canonical_id, parse, step
import v8_common as C
from wm_common import grids_in_text, board_from_solve_prompt

LAB = C.LAB
CAP_PER_BOARD, CAP_PER_EPISODE, MAX_TURN_ITEMS, TURN_GROUP = 4, 3, 480, 2
HARD_MIN, SHORT_MAX, SHORT_LEN, TURN1_MAX, MIN_EFF = 0.50, 0.50, 16, 1 / 3, 0.75
CP_N, MAX_SINGLE_TOKENS, SEED = 600, 12288, 1220261003
ORACLE_WORDS = ('"oracle"', "d_before", "d_after", "sound_len", "sound_prefix", "dist_map", "distance-to-solve", "oracle distance")
V7_TRACE_FIT = (0.6225, 1.789e-4)          # RAN: v7_train.json trace rows, seconds per row = a + b * seq_len
V7_CP_UNIT_S = 2.568                       # RAN: v7_train.json mean CP unit (6 rows)
EPS = 1e-9


def band_of_len(n):
    return "<9" if n < 9 else C.band_of(n, [(9, 16), (17, 32), (33, 48)]) or ">48"


def tiebreak(*k):
    return hashlib.sha256(("|".join(map(str, k)) + str(SEED)).encode()).hexdigest()


def is_short(x):
    return x["kind"] != "cp" and x["difficulty"] is not None and x["difficulty"] <= SHORT_LEN


def is_hard(x):
    return x["kind"] != "cp" and x["difficulty"] is not None and x["difficulty"] > SHORT_LEN


def unit_w(x):
    return 0.0 if x["kind"] == "cp" else (1.0 / TURN_GROUP if x["kind"] == "turn" else 1.0)


def short_share(items):
    w = sum(map(unit_w, items)); s = sum(unit_w(x) for x in items if is_short(x))
    return s / w if w else 0.0


def push_count(board, state_before, applied, state_after):
    """Pushes in the applied moves, replayed with sokoban.step from the logged start state (asserts the logged end state)."""
    walls, _, _, _ = parse(board)
    boxes = frozenset(tuple(b) for b in state_before["boxes"]); player = tuple(state_before["player"]); n = 0
    for m in applied:
        res = step(walls, boxes, player, m); assert res is not None, ("logged applied move is blocked", applied)
        nb = frozenset(res[0]); n += nb != boxes; boxes, player = nb, res[1]
    assert sorted(list(b) for b in boxes) == state_after["boxes"] and list(player) == state_after["player"], "push replay end state"
    return n


def episode_best_before(rows):
    """{(episode, turn): best oracle distance reached in the episode BEFORE this turn} (the board start counts)."""
    by = collections.defaultdict(list); out = {}
    for r in rows: by[r["episode"]].append(r)
    for ep, rs in by.items():
        rs.sort(key=lambda r: r["turn"]); best = rs[0]["oracle"]["d_start_board"]
        for r in rs:
            out[(ep, r["turn"])] = best
            d = r["oracle"]["d_after"]
            if isinstance(d, int) and (not isinstance(best, int) or d < best): best = d
    return out


def turn_reject(r, strict=True, best_before=None):
    rec, o, t = r["rec"], r["oracle"], r["text"]
    if rec["kind"] != "moves": return "not_moves_" + rec["kind"]
    if rec["committed"]: return "forced_commit"
    if not rec["think_closed"]: return "think_not_closed"
    if r["finish"] != "stop": return "truncated_after_close"
    if t.count("</think>") != 1 or "<think>" in t: return "think_tags"
    if strict and not rec["strict_format"]: return "not_strict_format"
    if rec["clipped"] or rec["budget_clipped"] or rec["requested_len"] > 8: return "clipped"
    if rec["illegal_at"] is not None: return "illegal"
    if o.get("fatal"): return "fatal"
    if not isinstance(o["d_before"], int) or not isinstance(o["d_after"], int): return "unsolvable_or_unknown"
    if rec["solved_after"] and len(rec["applied"]) < rec["requested_len"]: return "overshoot"
    if o["d_after"] >= o["d_before"]: return "no_progress"
    if isinstance(best_before, int) and o["d_after"] >= best_before: return "no_new_best"
    if r["state_before"]["boxes"] == r["state_after"]["boxes"]: return "walk_only"
    if (o["d_before"] - o["d_after"]) / max(1, len(rec["applied"])) < MIN_EFF - EPS: return "inefficient"
    return None


def drop_worst(items, eligible):
    """Remove (in place) the eligible item whose board currently has the most items; ties -> its worst-ranked item."""
    cnt = collections.Counter(x["board_cid"] for x in items)
    x = max(eligible, key=lambda z: (cnt[z["board_cid"]], z["_rank"])); items.remove(x)
    return x


def trim_by_board(items, k):
    """Keep k items: repeatedly drop the worst-ranked item of the board that currently has the most items."""
    items = sorted(items, key=lambda x: x["_rank"]); by = collections.defaultdict(list)
    for x in items: by[x["board_cid"]].append(x)
    n = len(items)
    while n > k:
        b = max(by, key=lambda q: (len(by[q]), q)); by[b].pop(); n -= 1
        if not by[b]: del by[b]
    return sorted([x for v in by.values() for x in v], key=lambda x: x["_rank"])


def select_turns(rows, strict=True, pool=None):
    pool = pool or {c["id"]: c for c in C.load_cases(os.path.join(LAB, "v8_pool.json"))}
    best = episode_best_before(rows)
    rej = collections.Counter(); cands = []
    for r in rows:
        why = turn_reject(r, strict, best.get((r["episode"], r["turn"])))
        rej[why or "GOOD"] += 1
        if why: continue
        o = r["oracle"]; d = o["d_before"] - o["d_after"]; eff = d / max(1, len(r["rec"]["applied"]))
        pushes = push_count(pool[r["id"]]["board"], r["state_before"], r["rec"]["applied"], r["state_after"])
        assert pushes >= 1
        cands.append({"kind": "turn", "src": "v8_turns", "id": f"{r['id']}/s{r['sample']}/t{r['turn']}", "board_cid": r["canonical_id"],
                      "band": band_of_len(o["d_before"]), "board_band": r["band"], "difficulty": o["d_before"], "d_before": o["d_before"],
                      "oracle_len": r["oracle_len"], "episode": r["episode"], "turn": r["turn"],
                      "messages": r["messages"], "target": r["text"], "ptok": r["ptok"], "ntok": r["ntok"],
                      "selection": {"gain": d, "eff": round(eff, 4), "pushes": pushes, "applied_len": len(r["rec"]["applied"]),
                                    "best_before": best.get((r["episode"], r["turn"])), "solved_after": r["rec"]["solved_after"]},
                      "_rank": (-eff, -int(o["d_before"] > SHORT_LEN), -pushes, -d, r["turn"], tiebreak(r["id"], r["sample"], r["turn"]))})
    by = collections.defaultdict(list)
    for x in cands: by[x["board_cid"]].append(x)
    kept = []
    for b, xs in by.items():
        per_ep = collections.Counter(); k = 0
        for x in sorted(xs, key=lambda x: x["_rank"]):
            if k >= CAP_PER_BOARD: break
            if per_ep[x["episode"]] >= CAP_PER_EPISODE: continue
            kept.append(x); per_ep[x["episode"]] += 1; k += 1
    hard = [x for x in kept if is_hard(x)]; easy = [x for x in kept if not is_hard(x)]
    if len(easy) > len(hard): easy = trim_by_board(easy, len(hard))          # R1 first pass (hard >= 50%)
    if len(hard) + len(easy) > MAX_TURN_ITEMS:
        hk = min(len(hard), max(MAX_TURN_ITEMS // 2, MAX_TURN_ITEMS - len(easy))); ek = min(len(easy), MAX_TURN_ITEMS - hk)
        hard, easy = trim_by_board(hard, hk), trim_by_board(easy, ek)
    return sorted(hard + easy, key=lambda x: x["_rank"]), rej, len(cands), len(kept)


def enforce_mix(turns, singles, replay):
    """Apply R1-R3 together (module doc). Every step removes one item, so the loop ends; all three rules hold at the end."""
    turns, singles = list(turns), list(singles)
    rng = random.Random(SEED + 1)
    rep_short = sorted([x for x in replay if is_short(x)], key=lambda x: x["_rank"]); rng.shuffle(rep_short)
    replay = [x for x in replay if not is_short(x)] + rep_short           # short replay is dropped from the END of this list
    trimmed = collections.Counter()
    while True:
        n_t = len(turns); t_short = [x for x in turns if is_short(x)]
        if n_t and len(t_short) > (1 - HARD_MIN) * n_t + EPS:                                   # R1
            drop_worst(turns, t_short); trimmed["R1_turns_short"] += 1; continue
        t1 = [x for x in turns if x["turn"] == 1]
        if n_t and len(t1) > TURN1_MAX * n_t + EPS:                                             # R2
            drop_worst(turns, [x for x in t1 if is_short(x)] or t1); trimmed["R2_turn1"] += 1; continue
        if short_share(turns + singles + replay) > SHORT_MAX + EPS:                            # R3
            rs = [x for x in replay if is_short(x)]
            if rs: replay.remove(rs[-1]); trimmed["R3_replay_short"] += 1; continue
            if t_short: drop_worst(turns, t_short); trimmed["R3_turns_short"] += 1; continue
            ss = [x for x in singles if is_short(x)]
            assert ss, "cannot satisfy the short-unit rule"
            singles.remove(max(ss, key=lambda x: x["_rank"])); trimmed["R3_singles_short"] += 1; continue
        break
    return turns, singles, replay, dict(trimmed)


def singles_v8(out, sealed):
    p = os.path.join(out, "v8_single.json"); items = []; seen = collections.Counter()
    if not os.path.exists(p): return items, {"v8_single": "ABSENT"}
    sj = json.load(open(p)); pool = {c["id"]: c for c in C.load_cases(os.path.join(LAB, "v8_pool.json"))}
    assert sj["pool_sha256"] == C.sha_file(os.path.join(LAB, "v8_pool.json"))
    from prompts import solve_prompt
    from v5_common import score
    for cse in sj["cases"]:
        c = pool[cse["id"]]; ok = []
        for i, s in enumerate(cse["samples"]):
            seen["samples"] += 1
            if s["strict"] != "OK" or s["finish"] != "stop" or s["tokens"] > MAX_SINGLE_TOKENS: continue
            if s["text"].count("</think>") != 1 or "<think>" in s["text"]: continue
            assert score(c["board"], s["text"]) == "OK"
            ok.append((s["tokens"], i, s))
        if not ok: continue
        tk, i, s = min(ok, key=lambda z: (z[0], z[1]))
        assert c["canonical_id"] not in sealed
        items.append({"kind": "single", "src": "v8_single", "id": f"{c['id']}/s{i}", "board_cid": c["canonical_id"],
                      "band": band_of_len(c["oracle_len"]), "difficulty": c["oracle_len"], "oracle_len": c["oracle_len"],
                      "messages": [{"role": "user", "content": solve_prompt(c["board"])}],
                      "target": s["text"], "ntok": tk, "_rank": (tk, c["id"])})
        seen["boards_verified"] += 1
    return items, dict(seen)


def singles_v6(sealed):
    from v5_common import score
    p = next((q for q in (os.path.join(C.PULLED, "out", "v6_A.json"), os.path.join(C.RUN, "v6_A.json"),
                          os.path.join(C.RUN, "out", "v6_A.json")) if os.path.exists(q)), None)
    if p is None: return [], {"v6_A": "ABSENT"}
    d = json.load(open(p)); pool = {x["id"]: x for x in d["pool"]}; items = []; cnt = collections.Counter()
    for x in d["direct"]:
        cnt["direct"] += 1
        if x.get("via") != "self": cnt["not_self"] += 1; continue
        b = board_from_solve_prompt(x["prompt"]); assert b == pool[x["id"]]["board"]
        if score(b, x["target"]) != "OK" or x["target_tokens"] > MAX_SINGLE_TOKENS: cnt["not_strict_ok"] += 1; continue
        if x["target"].count("</think>") != 1 or "<think>" in x["target"]: cnt["think_tags"] += 1; continue
        cid = canonical_id(b); assert cid not in sealed
        L = pool[x["id"]]["oracle_len"]
        items.append({"kind": "single", "src": "v6_A_self", "id": "v6A/" + x["id"], "board_cid": cid, "band": band_of_len(L),
                      "difficulty": L, "oracle_len": L, "messages": [{"role": "user", "content": x["prompt"]}], "target": x["target"],
                      "ntok": x["target_tokens"], "_rank": (x["target_tokens"], x["id"])})
        cnt["kept"] += 1
    return items, {"file": os.path.relpath(p, C.RUN), "sha256": C.sha_file(p), **cnt}


def replay_v5(out):
    p = next((q for q in (os.path.join(out, "v5_corpus.json"), os.path.join(C.PULLED, "out", "v5_corpus.json")) if os.path.exists(q)))
    v5 = json.load(open(p)); corpus = v5["corpus"]
    assert len(corpus) == 50 and C.sha_bytes(json.dumps(corpus, sort_keys=True)) == v5["sha256"], "v5_corpus integrity"
    items = []
    for x in corpus:
        b = board_from_solve_prompt(x["prompt"])
        items.append({"kind": "replay", "src": "v5_corpus", "id": "v5/" + x["id"], "board_cid": canonical_id(b), "band": band_of_len(x["oracle_len"]),
                      "difficulty": x["oracle_len"], "oracle_len": x["oracle_len"], "messages": [{"role": "user", "content": x["prompt"]}],
                      "target": x["target"], "ntok": x["target_tokens"], "_rank": (tiebreak("v5", x["id"]),)})
    return items, {"file": os.path.relpath(p, C.RUN), "sha256": v5["sha256"]}


def cp_items():
    cp = json.load(open(os.path.join(LAB, "v7_cp.json"))); items = cp["items"]
    assert len(items) == 600 and C.sha_bytes(json.dumps(items, sort_keys=True)) == cp["sha256"] and cp.get("thinking") is True
    rng = random.Random(SEED); by = collections.defaultdict(list)
    for it in items: by[it["kind"]].append(it)
    pick = []
    for k in sorted(by):
        xs = sorted(by[k], key=lambda it: it["id"]); rng.shuffle(xs); pick += xs[:round(CP_N * len(xs) / 600)]
    assert len(pick) == CP_N, len(pick)
    return [{"kind": "cp", "src": "v7_cp", "id": "cp/" + it["id"], "board_cid": it["canonical_id"], "band": "cp", "difficulty": None,
             "oracle_len": None, "messages": [{"role": "user", "content": it["prompt"]}], "target": it["target"], "_rank": (it["id"],)}
            for it in pick], {"v7_cp_sha256": cp["sha256"], "by_kind": dict(collections.Counter(it["kind"] for it in pick))}


def replay_check(out, turn_items):
    """Re-derive each selected turn's messages from wm_interactive's own turn log (independent of v8_turns.jsonl)."""
    import v8_collect as K
    WI = K.wi(); _, cases = K.pool_cases(); _, _, _, jp = WI.receipt_paths(out, K.TAG)
    rows, _ = K.read_jsonl_ro(jp); head = rows[0]["head"]
    want = {(x["episode"], x["turn"]): x for x in turn_items}; got = 0
    for e, r, msgs, before, tm in K.replay_turns(WI, cases, rows[1:], int(head["n_samples"]), head["config"]):
        if e is None: break
        x = want.get((r["episode"], r["turn"]))
        if x is not None:
            assert msgs == x["messages"], ("messages differ from the harness replay", x["id"])
            assert r["text"] == x["target"], ("target differs from the logged turn text", x["id"])
            got += 1
    assert got == len(want), (got, len(want))
    return got


def guard(items, sealed):
    dropped = collections.Counter()
    keep = []
    for x in items:
        assert x["board_cid"] not in sealed, ("item board is sealed", x["id"])
        ms = x["messages"]
        assert ms and ms[0]["role"] == "user" and ms[-1]["role"] == "user" and all(a["role"] != b["role"] for a, b in zip(ms, ms[1:])), x["id"]
        prompt = "\n".join(m["content"] for m in ms)
        for w in ORACLE_WORDS: assert w not in prompt, ("oracle vocabulary in a prompt", w, x["id"])
        assert x["target"].count("</think>") == 1 and "<think>" not in x["target"], ("think tags", x["id"])
        if any(canonical_id(g) in sealed for g in grids_in_text(prompt + "\n" + x["target"])):
            dropped[x["kind"]] += 1; continue
        keep.append(x)
    return keep, dict(dropped)


def report(items, v5_ratio):
    by = collections.defaultdict(collections.Counter); toks = collections.Counter(); proj = 0.0; cp_n = 0
    for x in items:
        by[x["kind"]][x["band"]] += 1
        tt = x.get("ntok") or len(x["target"]) / v5_ratio
        pt = x.get("ptok") or sum(len(m["content"]) for m in x["messages"]) / v5_ratio + 20
        toks[x["kind"] + "_target_tokens"] += int(tt)
        if x["kind"] == "cp": cp_n += 1
        else: proj += V7_TRACE_FIT[0] + V7_TRACE_FIT[1] * (tt + pt)
    proj += (cp_n / 6) * V7_CP_UNIT_S
    n = len(items); puzzle = [x for x in items if x["kind"] != "cp"]
    turns = [x for x in items if x["kind"] == "turn"]; full = [x for x in puzzle if x["kind"] != "turn"]
    w_p = sum(map(unit_w, puzzle)); w_full = sum(map(unit_w, full))
    t_units = -(-len(turns) // TURN_GROUP); cp_units = -(-cp_n // 6)
    ratio = [x["d_before"] / x["oracle_len"] for x in turns if x["oracle_len"]]
    return {"n_items": n, "by_kind_band": {k: dict(v) for k, v in sorted(by.items())},
            "turn_state_band": dict(collections.Counter(x["band"] for x in turns)),
            "turn_board_band": dict(collections.Counter(x["board_band"] for x in turns)),
            "turn_index_hist": dict(sorted(collections.Counter(x["turn"] for x in turns).items())),
            "turn_push_hist": dict(sorted(collections.Counter(x["selection"]["pushes"] for x in turns).items())),
            "turn_eff_hist": dict(sorted(collections.Counter(x["selection"]["eff"] for x in turns).items())),
            "turn_walk_only": sum(x["selection"]["pushes"] == 0 for x in turns),
            "turn_hard_frac": round(sum(map(is_hard, turns)) / max(1, len(turns)), 4),
            "turn1_frac": round(sum(x["turn"] == 1 for x in turns) / max(1, len(turns)), 4),
            "turn_d_before_median": statistics.median([x["d_before"] for x in turns]) if turns else None,
            "turn_d_before_over_board_len_median": round(statistics.median(ratio), 3) if ratio else None,
            "short_items": sum(map(is_short, items)), "short_unit_frac": round(short_share(puzzle), 4),
            "hard_unit_frac": round(1 - short_share(puzzle), 4) if puzzle else None,
            "short_frac_of_puzzle_items": round(sum(map(is_short, puzzle)) / max(1, len(puzzle)), 4),
            "full_solution_unit_frac": round(w_full / w_p, 4) if w_p else None,
            "est_tokens": dict(toks), "chars_per_token_used": round(v5_ratio, 3),
            "optimizer_units_per_epoch": t_units + len(full) + cp_units,
            "units_per_epoch_by_kind": {"turn": t_units, "single": sum(x["kind"] == "single" for x in full),
                                        "replay": sum(x["kind"] == "replay" for x in full), "cp": cp_units},
            "projected_train_s_2_epochs_excl_load_merge": round(2 * proj)}


def build(out, use_v6=True, strict=True, check_replay=True, log=print):
    dst = os.path.join(out, "v8_data.json"); assert not os.path.exists(dst), f"{dst} exists; refusing to overwrite"
    sealed, sealed_n = C.sealed_union(require=("holdout.json", "holdout_v7.json", "holdout_rep1.json", "holdout_v8.json"))
    tp = os.path.join(out, "v8_turns.jsonl"); rows = [json.loads(l) for l in open(tp)] if os.path.exists(tp) else []
    turns, rej, n_good, n_capped = select_turns(rows, strict)
    s8, s8_info = singles_v8(out, sealed)
    s6, s6_info = singles_v6(sealed) if use_v6 else ([], {"v6_A": "DISABLED"})
    replay, rp_info = replay_v5(out)
    cp, cp_info = cp_items()
    singles = sorted(s8 + s6, key=lambda x: x["_rank"])
    turns, singles, replay, trimmed = enforce_mix(turns, singles, replay)
    items = turns + singles + replay + cp
    items, sealed_grid_drops = guard(items, sealed)
    if check_replay and any(x["kind"] == "turn" for x in items):
        n_chk = replay_check(out, [x for x in items if x["kind"] == "turn"])
    else:
        n_chk = 0 if not check_replay else "no_turn_items"
    v5 = json.load(open(next(q for q in (os.path.join(out, "v5_corpus.json"), os.path.join(C.PULLED, "out", "v5_corpus.json")) if os.path.exists(q))))
    ratio = sum(len(x["target"]) for x in v5["corpus"]) / sum(x["target_tokens"] for x in v5["corpus"])
    rep = report(items, ratio)
    tl = [x for x in items if x["kind"] == "turn"]
    assert rep["short_unit_frac"] <= SHORT_MAX + 1e-6, rep
    assert not tl or (rep["turn_hard_frac"] >= HARD_MIN - 1e-6 and rep["turn1_frac"] <= TURN1_MAX + 1e-6 and rep["turn_walk_only"] == 0), rep
    clean = [{k: v for k, v in x.items() if k != "_rank"} for x in items]
    obj = {"name": "v8_data", "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "params": {"cap_per_board": CAP_PER_BOARD, "cap_per_episode": CAP_PER_EPISODE, "max_turn_items": MAX_TURN_ITEMS,
                      "turn_group": TURN_GROUP, "hard_min": HARD_MIN, "short_max_of_puzzle_units": SHORT_MAX, "short_len": SHORT_LEN,
                      "turn1_max": round(TURN1_MAX, 4), "min_eff": MIN_EFF, "difficulty": "turn: oracle d_before; single/replay: oracle_len",
                      "cp_n": CP_N, "seed": SEED, "strict_format_required": strict, "v6_included": use_v6, "max_single_tokens": MAX_SINGLE_TOKENS},
           "inputs": {"v8_turns_sha256": C.sha_file(tp) if rows else None, "turn_rows": len(rows), "v8_single": s8_info, "v6_A": s6_info,
                      "v5_corpus": rp_info, "cp": cp_info, "v8_pool_sha256": C.sha_file(os.path.join(LAB, "v8_pool.json")),
                      "sealed_sizes": sealed_n, "code_sha256": {f: C.sha_file(os.path.join(LAB, f)) for f in ("v8_build_data.py", "v8_collect.py", "v8_grade.py", "v8_common.py")}},
           "turn_selection": {"reject_reasons": dict(rej), "good": n_good, "after_caps": n_capped, "final": len(tl)},
           "trimmed_for_mix_rules": trimmed, "sealed_grid_drops": sealed_grid_drops, "replay_checked_turns": n_chk,
           "oracle_guard": {"words_absent_from_prompts": list(ORACLE_WORDS), "fields_used_for_training": ["messages", "target"]},
           "report": rep, "items_sha256": C.sha_bytes(json.dumps(clean, sort_keys=True)), "items": clean}
    with open(dst + ".tmp", "w") as f: json.dump(obj, f, indent=1)
    os.replace(dst + ".tmp", dst)
    log("V8_BUILD_DATA", json.dumps({"report": rep, "turn_selection": obj["turn_selection"], "trimmed": trimmed,
                                     "sealed_grid_drops": sealed_grid_drops, "replay_checked_turns": n_chk}))
    return dst


def main():
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    build(a[0], use_v6="--no-v6" not in sys.argv, strict="--allow-nonstrict" not in sys.argv, check_replay="--skip-replay-check" not in sys.argv)


if __name__ == "__main__":
    main()
