"""S1 shared pure-python helpers (no torch, no oracle). Used by s1_data / s1_lookahead / s1_tabu / s1_ornith_eval.
- render (inverse of sokoban.parse, same tile alphabet)
- value-net input encodings: 'cells' (default; interior 6x6, one token per tile, rows separated by '|') and 'plain'
- distance buckets {1-4, 5-8, 9-16, 17-32, 33+}
- simulator macro-actions: player BFS (no pushing) to every push position, then one push
- SOUND deadlock rules only (a rule never marks a solvable state dead): dead squares (incl. non-goal corners) and frozen
  2x2 blocks. Nothing here calls or imports sokoban.solve (checked by s1_lookahead.assert_no_oracle)."""
from collections import deque
import hashlib, json, os

from sokoban import H, W, MOVES, parse, step, canonical_id

LAB = os.path.dirname(os.path.abspath(__file__))
RUN = os.path.dirname(LAB)
DIRS = "UDLR"
WORD = {"U": "UP", "D": "DOWN", "L": "LEFT", "R": "RIGHT"}
BUCKETS = ((1, 4), (5, 8), (9, 16), (17, 32), (33, None))
BUCKET_NAMES = ("1-4", "5-8", "9-16", "17-32", "33+")
BUCKET_MID = (2.5, 6.5, 12.5, 24.5, 40.0)          # expected-distance read-out from bucket probabilities
CELL_TOK = {"#": "#", " ": "_", ".": ".", "$": "$", "*": "*", "@": "@", "+": "+"}
CELLS_LEN = 1 + 36 + 5 + 1                          # [CLS] + 36 tiles + 5 row separators + [SEP] (asserted by s1_value)


def sha_bytes(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()


def sha_file(path):
    with open(path, "rb") as f:
        return sha_bytes(f.read())


def render(walls, goals, boxes, player):
    rows = []
    for r in range(H):
        row = ""
        for c in range(W):
            p = (r, c)
            if p in walls: row += "#"
            elif p == player: row += "+" if p in goals else "@"
            elif p in boxes: row += "*" if p in goals else "$"
            elif p in goals: row += "."
            else: row += " "
        rows.append(row)
    return "\n".join(rows)


def _interior_rows(board):
    rows = board.split("\n")
    assert len(rows) == H and all(len(r) == W for r in rows)
    # the border is dropped by the encoding, so it must be all wall (sokoban.generate always walls it)
    assert rows[0] == "#" * W and rows[-1] == "#" * W and all(r[0] == "#" and r[-1] == "#" for r in rows), "non-wall border cell"
    return rows


def encode_cells(board):
    """Interior 6x6 (the outer border is always wall; asserted), every tile its own space-separated token, floor -> '_',
    rows separated by '|'. With the Laya/ModernBERT tokenizer every tile is exactly one token (verified), so token
    position == board cell (spatially aligned input). Known quirk (kept: the sealed s1_laya artifact was trained on it):
    cell (1,1) has no leading space, so it gets the bare-character token id while every other tile gets the 'G'-prefixed
    id. 'cells_v2' fixes this for the next encoding version (new prereg + retrain)."""
    rows = _interior_rows(board)
    return " | ".join(" ".join(CELL_TOK[ch] for ch in rows[r][1:W - 1]) for r in range(1, H - 1))


def encode_cells_v2(board):
    """cells with a leading space, so all 36 cells use the same space-prefixed token ids. NOT used by the sealed artifact."""
    return " " + encode_cells(board)


def encode_plain(board):
    """The literal variant: full 8 rows joined by '|' (BPE merges runs of tiles; not cell-aligned)."""
    return board.replace("\n", "|")


ENCODERS = {"cells": encode_cells, "cells_v2": encode_cells_v2, "plain": encode_plain}
CELL_ALIGNED = ("cells", "cells_v2")


def bucket_of(d):
    for i, (lo, hi) in enumerate(BUCKETS):
        if d >= lo and (hi is None or d <= hi): return i
    raise ValueError(d)


def layout_key(board):
    """Symmetry-canonical id of walls+goals only (boxes/player removed): train/val/test are split by layout."""
    walls, goals, _, _ = parse(board)
    rows = []
    for r in range(H):
        rows.append("".join("#" if (r, c) in walls else "." if (r, c) in goals else " " for c in range(W)))
    return canonical_id("\n".join(rows))


# ---------------------------------------------------------------- simulator macro-actions (no oracle)
def player_paths(walls, boxes, player):
    """BFS over floor without pushing. Returns {cell: move string from player}."""
    paths = {player: ""}
    q = deque([player])
    while q:
        p = q.popleft()
        for m in DIRS:
            dr, dc = MOVES[m]; n = (p[0] + dr, p[1] + dc)
            if n in walls or n in boxes or n in paths: continue
            paths[n] = paths[p] + m; q.append(n)
    return paths


def push_actions(walls, boxes, player):
    """All one-push macro-actions: list of dict(box, dir, path, moves, boxes, player). Deterministic order
    (box row-major, then U D L R)."""
    paths = player_paths(walls, boxes, player)
    out = []
    for b in sorted(boxes):
        for m in DIRS:
            dr, dc = MOVES[m]
            stand, dest = (b[0] - dr, b[1] - dc), (b[0] + dr, b[1] + dc)
            if stand not in paths or dest in walls or dest in boxes: continue
            nb = frozenset((boxes - {b}) | {dest})
            out.append({"box": b, "dir": m, "path": paths[stand], "moves": paths[stand] + m, "boxes": nb, "player": b, "dest": dest})
    return out


def replay(walls, boxes, player, moves):
    """Apply a move string with sokoban.step. Returns (boxes, player, first_illegal_index|None)."""
    for i, m in enumerate(moves):
        res = step(walls, boxes, player, m)
        if res is None: return boxes, player, i
        boxes, player = frozenset(res[0]), res[1]
    return boxes, player, None


# ---------------------------------------------------------------- sound deadlock rules
_DEAD_CACHE = {}


def dead_squares(walls, goals):
    """Cells (non-wall) from which a lone box can never reach any goal, even with the player anywhere and no other box
    in the way (reverse 'pull' search from the goals). Other boxes only add obstacles, so a box on such a cell is a
    proven deadlock. Includes every non-goal corner."""
    key = (walls, goals)
    if key in _DEAD_CACHE: return _DEAD_CACHE[key]
    live, q = set(goals), deque(goals)
    while q:
        y = q.popleft()
        for m in DIRS:
            dr, dc = MOVES[m]
            x = (y[0] - dr, y[1] - dc); stand = (x[0] - dr, x[1] - dc)   # box at x pushed by m from 'stand' lands on y
            if x in walls or stand in walls or x in live: continue
            live.add(x); q.append(x)
    dead = frozenset((r, c) for r in range(H) for c in range(W) if (r, c) not in walls and (r, c) not in live)
    _DEAD_CACHE[key] = dead
    return dead


def is_corner(walls, p):
    up, dn, lf, rt = ((p[0] - 1, p[1]) in walls, (p[0] + 1, p[1]) in walls, (p[0], p[1] - 1) in walls, (p[0], p[1] + 1) in walls)
    return (up or dn) and (lf or rt)


def deadlock(walls, goals, boxes):
    """None if no sound rule fires, else a short plain-words reason."""
    dead = dead_squares(walls, goals)
    for b in sorted(boxes):
        if b in goals: continue
        if is_corner(walls, b): return f"box at row {b[0]} col {b[1]} is stuck in a corner that is not a goal"
        if b in dead: return f"box at row {b[0]} col {b[1]} can never reach any goal from there"
    occ = walls | boxes
    for b in sorted(boxes):
        for r0 in (b[0] - 1, b[0]):
            for c0 in (b[1] - 1, b[1]):
                blk = [(r0, c0), (r0, c0 + 1), (r0 + 1, c0), (r0 + 1, c0 + 1)]
                if all(x in occ for x in blk) and any(x in boxes and x not in goals for x in blk):
                    return f"box at row {b[0]} col {b[1]} is frozen against walls/the other box (2x2 block)"
    return None


def describe_push(a):
    b = a["box"]
    path = a["path"] if a["path"] else "(none, already in place)"
    return f"push the box at row {b[0]} col {b[1]} {WORD[a['dir']]}; player path {path}; moves {a['moves']}"


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=1, default=list)
    os.replace(tmp, path)
