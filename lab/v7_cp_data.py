"""v7 consequence-prediction (CP) aux data (Mac-side, pure python). 600 items from procedural boards (seed 9120261003),
boards disjoint from holdout.json + holdout128 (holdout_v7 is sealed AFTER this file and excludes these boards itself).
Item: RULES + board + move string (len 3-12) + TASK. Trained in THINKING mode (enable_thinking=True, same template path
as the v5 traces). Target = explicit per-move simulation trace in the model's own verification style (v5 traces / probe:
"Move i: M, player (r,c)->(r,c). (r,c) floor. Valid. Player (r,c).") + "\\n</think>\\n\\n" + answer, where answer = the
exact final 8-line board, or ILLEGAL@i at the FIRST blocked move (the trace stops there).
Mix per 12 items: 3 random legal walks, 1 legal walk ending with player/box on a goal ('+'/'*'), 2 oracle-solution prefixes
(boxes reach goals), 3 illegal-by-wall-bump, 3 illegal-by-blocked-push (legal prefix, the blocked move at index i, then
random filler; answer = first blocked index). Boards/move strings are identical to the first (non-thinking) v7_cp draft:
only the TASK text and the target format changed (RNG consumption unchanged).
Usage: python v7_cp_data.py [out_path=v7_cp.json]"""
import collections, json, os, random, sys
from sokoban import MOVES, parse, step, generate, solve, canonical_id
from prompts import RULES
from v5_common import sha
from v7_common import LAB, CP_SEED, render, sealed_known_ids

N = 600
TASK = ("Simulate these moves step by step. Reply with only the final 8-line board, "
        "or ILLEGAL@i where i is the first (0-indexed) move that is blocked.")
THINK_CLOSE = "\n</think>\n\n"
SCHEDULE = ["legal", "push", "oracle", "wall", "legal_goal", "push", "legal", "wall", "oracle", "push", "legal", "wall"]
TRIES = 40


def cp_prompt(board, moves):
    return RULES + "\nPuzzle (8 lines):\n" + board + "\n\nMoves: " + moves + "\n\n" + TASK


def simulate(board, moves):
    walls, goals, boxes, player = parse(board)
    for i, m in enumerate(moves):
        res = step(walls, boxes, player, m)
        if res is None: return f"ILLEGAL@{i}"
        boxes, player = res
    return render(walls, goals, boxes, player)


def fmt(p): return f"({p[0]},{p[1]})"


def cp_trace(board, moves):
    """Deterministic thinking text + answer. Boxes are named A/B in row-major order of their start cells and keep their
    names when pushed. Stops at the first blocked move. Own stepping logic (cross-checked against sokoban.step below)."""
    walls, goals, boxes, player = parse(board)
    label = {b: n for n, b in zip("AB", sorted(boxes))}
    where = lambda p, name: f"{name} on goal {fmt(p)}" if p in goals else f"{name} {fmt(p)}"
    cell = lambda p: "wall" if p in walls else f"box {label[p]}" if p in label else "goal" if p in goals else "floor"
    state = lambda: ". ".join(where(b, f"Box {n}") for b, n in sorted(label.items(), key=lambda kv: kv[1]))
    lines = ["Coordinates are (row, col), 0-indexed from the top-left.",
             f"Start: {where(player, 'player')}. {state()}. Goals {', '.join(fmt(g) for g in sorted(goals))}.",
             f"Moves: {moves} ({len(moves)} moves)."]
    for i, m in enumerate(moves):
        dr, dc = MOVES[m]; nxt = (player[0] + dr, player[1] + dc)
        head = f"Move {i}: {m}, player {fmt(player)}->{fmt(nxt)}. {fmt(nxt)} {cell(nxt)}."
        blocked = nxt in walls
        if not blocked and nxt in label:
            beyond = (nxt[0] + dr, nxt[1] + dc); name = label[nxt]
            head += f" Push to {fmt(beyond)}. {fmt(beyond)} {cell(beyond)}."
            blocked = beyond in walls or beyond in label
            if not blocked:
                label[beyond] = label.pop(nxt); player = nxt
                lines.append(f"{head} Valid. Player {fmt(player)}. {where(beyond, f'Box {name}')}.")
                continue
        if blocked:
            lines += [f"{head} Blocked.", "", f"Move {i} is blocked. Answer: ILLEGAL@{i}"]
            return "\n".join(lines), f"ILLEGAL@{i}"
        player = nxt
        lines.append(f"{head} Valid. Player {fmt(player)}.")
    lines += ["", f"All {len(moves)} moves valid. Final: {where(player, 'player')}. {state()}.", "Final board below."]
    return "\n".join(lines), render(walls, goals, frozenset(label), player)


def blocked_moves(walls, boxes, player):
    out = []
    for m, (dr, dc) in MOVES.items():
        nxt = (player[0] + dr, player[1] + dc)
        if nxt in walls: out.append((m, "wall"))
        elif nxt in boxes and ((nxt[0] + dr, nxt[1] + dc) in walls or (nxt[0] + dr, nxt[1] + dc) in boxes): out.append((m, "push"))
    return out


def legal_walk(rng, walls, boxes, player, k):
    moves = ""
    for _ in range(k):
        opts = [m for m in "UDLR" if step(walls, boxes, player, m) is not None]
        if not opts: return None
        m = rng.choice(opts); boxes, player = step(walls, boxes, player, m); moves += m
    return moves, boxes, player


def make_item(rng, board, want):
    """want in legal | legal_goal | oracle | wall | push. Returns None if this board cannot serve (caller draws a new board)."""
    walls, goals, boxes, player = parse(board)
    L = rng.randint(3, 12); idx = btype = None
    if want == "oracle":
        sol, st = solve(board)
        if st != "SOLVED" or len(sol) < 3: return None
        moves = sol if len(sol) <= 12 else sol[:L]
    elif want in ("legal", "legal_goal"):
        for _ in range(TRIES if want == "legal_goal" else 1):
            w = legal_walk(rng, walls, boxes, player, L)
            if w is not None and (want == "legal" or w[2] in goals or (w[1] & goals)): break
        else: return None
        if w is None: return None
        moves = w[0]
    else:
        for _ in range(TRIES):
            idx = rng.randrange(L)
            w = legal_walk(rng, walls, boxes, player, idx)
            bl = [b for b in blocked_moves(walls, w[1], w[2]) if b[1] == want] if w is not None else []
            if bl: break
        else: return None
        m, btype = rng.choice(bl)
        moves = w[0] + m + "".join(rng.choice("UDLR") for _ in range(L - 1 - idx))
    kind = "illegal" if want in ("wall", "push") else want
    answer = simulate(board, moves)
    trace, answer2 = cp_trace(board, moves)
    assert answer2 == answer, (board, moves, answer, answer2)
    assert 3 <= len(moves) <= 12
    assert (answer == f"ILLEGAL@{idx}") if kind == "illegal" else (not answer.startswith("ILLEGAL"))
    target = trace + THINK_CLOSE + answer
    assert target.count("</think>") == 1 and "<think>" not in target and target.endswith(THINK_CLOSE + answer)
    return {"kind": kind, "board": board, "canonical_id": canonical_id(board), "moves": moves, "illegal_index": idx,
            "illegal_type": btype, "prompt": cp_prompt(board, moves), "answer": answer, "target": target}


def build():
    h32, h128 = sealed_known_ids()
    excl = h32 | h128
    rng = random.Random(CP_SEED); used, items = set(), []
    while len(items) < N:
        b = generate(rng); cid = canonical_id(b)
        if cid in excl or cid in used: continue
        it = make_item(rng, b, SCHEDULE[len(items) % len(SCHEDULE)])
        used.add(cid)
        if it is None: continue
        items.append(dict(id=f"P{len(items):03d}", **it))
    v7 = os.path.join(LAB, "holdout_v7.json")          # if already sealed, must be disjoint (never silently change CP)
    if os.path.exists(v7):
        assert not ({c["canonical_id"] for c in json.load(open(v7))["cases"]} & {x["canonical_id"] for x in items}), "CP overlaps holdout_v7"
    return items, len(excl)


def stats(items):
    fin = [x["answer"] for x in items if not x["answer"].startswith("ILLEGAL")]
    tl = [len(x["target"]) for x in items]
    return {"kind": dict(collections.Counter(x["kind"] for x in items)),
            "illegal_type": dict(collections.Counter(x["illegal_type"] for x in items if x["illegal_type"])),
            "move_len": dict(sorted(collections.Counter(len(x["moves"]) for x in items).items())),
            "illegal_index": dict(sorted(collections.Counter(x["illegal_index"] for x in items if x["illegal_index"] is not None).items())),
            "final_with_box_on_goal": sum("*" in t for t in fin), "final_all_boxes_on_goals": sum(t.count("*") == 2 for t in fin),
            "final_player_on_goal": sum("+" in t for t in fin), "final_board_unchanged": sum(x["answer"] == x["board"] for x in items),
            "target_chars_mean": round(sum(tl) / len(tl), 1), "target_chars_max": max(tl),
            "distinct_boards": len({x["canonical_id"] for x in items})}


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(LAB, "v7_cp.json")
    items, n_excl = build()
    st = stats(items); assert st["distinct_boards"] == N
    obj = {"name": "v7_cp", "seed": CP_SEED, "n": N, "task": TASK, "thinking": True, "target_format": "trace + '\\n</think>\\n\\n' + answer",
           "excluded_sealed_ids": n_excl, "stats": st, "sha256": sha(json.dumps(items, sort_keys=True)), "items": items}
    with open(out, "w") as f: json.dump(obj, f, indent=1)
    print("V7_CP", out, "items_sha256", obj["sha256"], "file_sha256", sha(open(out, "rb").read()))
    print(json.dumps(st))


if __name__ == "__main__":
    main()
