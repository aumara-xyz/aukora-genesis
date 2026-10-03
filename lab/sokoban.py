"""8x8 Sokoban: deterministic BFS oracle, move verifier, board generator, canonical identity."""
import hashlib, random
from collections import deque

W = H = 8
MOVES = {"U": (-1, 0), "D": (1, 0), "L": (0, -1), "R": (0, 1)}
STATE_CAP = 50000


def parse(board):
    rows = board.split("\n")
    assert len(rows) == H and all(len(r) == W for r in rows), "not 8x8"
    walls, goals, boxes, player = set(), set(), set(), None
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch not in "#.@$+* ":
                raise ValueError(f"bad tile {ch!r}")
            if ch == "#": walls.add((r, c))
            if ch in ".+*": goals.add((r, c))
            if ch in "$*": boxes.add((r, c))
            if ch in "@+":
                if player: raise ValueError("two players")
                player = (r, c)
    for r in range(H):
        for c in range(W):
            if (r in (0, H - 1) or c in (0, W - 1)) and (r, c) not in walls:
                raise ValueError("outer wall missing")
    if player is None or len(boxes) != 2 or len(goals) != 2:
        raise ValueError("need 1 player, 2 boxes, 2 goals")
    return frozenset(walls), frozenset(goals), frozenset(boxes), player


def step(walls, boxes, player, m):
    dr, dc = MOVES[m]
    nxt = (player[0] + dr, player[1] + dc)
    if nxt in walls: return None
    if nxt in boxes:
        beyond = (nxt[0] + dr, nxt[1] + dc)
        if beyond in walls or beyond in boxes: return None
        boxes = (boxes - {nxt}) | {beyond}
    return boxes, nxt


def solve(board):
    """Shortest solution via BFS, fixed move order UDLR. Returns (moves|None, status)."""
    walls, goals, boxes, player = parse(board)
    start = (boxes, player)
    if boxes == goals: return "", "SOLVED_TRIVIAL"
    prev = {start: None}
    q = deque([start])
    while q:
        state = q.popleft()
        for m in "UDLR":
            res = step(walls, state[0], state[1], m)
            if res is None: continue
            ns = (frozenset(res[0]), res[1])
            if ns in prev: continue
            prev[ns] = (state, m)
            if ns[0] == goals:
                path = []
                while prev[ns] is not None:
                    ns, mv = prev[ns]; path.append(mv)
                return "".join(reversed(path)), "SOLVED"
            if len(prev) >= STATE_CAP: return None, "UNVERIFIED_CAP"
            q.append(ns)
    return None, "UNSOLVABLE"


def verify(board, moves):
    """Typed verdict for a model plan: OK | FORMAT | ILLEGAL@i | UNSOLVED."""
    if not moves or len(moves) > 64 or any(ch not in MOVES for ch in moves):
        return "FORMAT"
    walls, goals, boxes, player = parse(board)
    for i, m in enumerate(moves):
        res = step(walls, boxes, player, m)
        if res is None: return f"ILLEGAL@{i}"
        boxes, player = res
    return "OK" if boxes == goals else "UNSOLVED"


def _transforms(rows):
    g = [list(r) for r in rows]
    out = []
    for _ in range(4):
        g = [list(r) for r in zip(*g[::-1])]
        out.append(g); out.append([r[::-1] for r in g])
    return ["\n".join("".join(r) for r in t) for t in out]


def canonical_id(board):
    return hashlib.sha256(min(_transforms(board.split("\n"))).encode()).hexdigest()


def generate(rng, n_walls=(3, 9)):
    g = [["#" if r in (0, H - 1) or c in (0, W - 1) else " " for c in range(W)] for r in range(H)]
    interior = [(r, c) for r in range(1, H - 1) for c in range(1, W - 1)]
    rng.shuffle(interior)
    k = rng.randint(*n_walls)
    for (r, c) in interior[:k]: g[r][c] = "#"
    free = interior[k:]
    goals, boxes, player = free[0:2], free[2:4], free[4]
    for p in goals: g[p[0]][p[1]] = "."
    for p in boxes: g[p[0]][p[1]] = "$"
    g[player[0]][player[1]] = "@"
    return "\n".join("".join(r) for r in g)
