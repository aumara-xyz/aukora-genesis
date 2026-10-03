"""v8 ORACLE MOVE GRADER (environment ground truth). Used ONLY for training-data construction and analysis; its output is
never shown to the model at inference and never enters a prompt (v8_build_data asserts this).

Distance = exact number of moves (pushes and plain walks, the env's own unit; sokoban.solve's BFS unit) from a state to any
state with every box on a goal. One DistMap per layout (walls + goals) is built by a REVERSE BFS (pull moves) from all solved
states, so every state that can still reach a solve gets its exact distance in one pass; a state the reverse BFS did not
reach is UNSOLVABLE (the reverse search is complete) unless the state cap was hit, in which case it is 'unknown'.
Maps are cached by layout (LRU); inside a map, states are keyed by a compact canonical int (sorted box cells + player cell).

Per-move labels for a move string applied from a start state (stops at the first blocked move, like sokoban.verify and the
interactive harness; by default also stops at the solving move, like the harness):
  progress  distance decreased (always by exactly 1)
  neutral   distance unchanged or increased, state still solvable
  fatal     the state became unsolvable (deadlock), e.g. a box pushed into a non-goal corner
  illegal   the move is blocked (wall, or a push into a wall/box); it and later moves are not applied
  dead      the state was already unsolvable before this move (after a fatal move)
  unknown   a distance involved is unknown (state cap hit)
  unused    not applied (after an illegal move, or after the solving move when stop_at_solve)
sound prefix = the longest applied prefix with no fatal/illegal/dead/unknown move that ends at a state whose distance is
strictly less than the start distance (possibly empty).
Usage (self-check): python3 v8_grade.py BOARD_FILE MOVES"""
import collections, sys

from sokoban import H, W, MOVES, STATE_CAP, parse, step

LABELS = ("progress", "neutral", "fatal", "illegal", "dead", "unknown", "unused")
UNKNOWN = "unknown"
DIRS = tuple(MOVES.items())
MAP_CACHE_SIZE = 16


def enc(boxes, player):
    """Compact canonical key of a 2-box state (box order irrelevant)."""
    a, b = sorted(r * W + c for r, c in boxes)
    return (a * 64 + b) * 64 + player[0] * W + player[1]


class DistMap:
    """Exact move distance-to-solve for every state of one layout, by reverse BFS from every solved state."""

    def __init__(self, walls, goals, cap=STATE_CAP):
        self.walls, self.goals, self.cap = frozenset(walls), frozenset(goals), cap
        floor = [(r, c) for r in range(H) for c in range(W) if (r, c) not in self.walls]
        self.dist, self.capped = {}, False
        q = collections.deque()
        for p in floor:
            if p in self.goals: continue
            k = enc(self.goals, p)
            if k not in self.dist:
                self.dist[k] = 0; q.append((self.goals, p))
        while q:
            boxes, p = q.popleft(); d = self.dist[enc(boxes, p)]
            for _, (dr, dc) in DIRS:
                prev = (p[0] - dr, p[1] - dc)                       # where the player stood before moving (dr, dc)
                if prev in self.walls or prev in boxes: continue
                cands = [boxes]                                     # plain walk (p was empty before: it holds no box now)
                ahead = (p[0] + dr, p[1] + dc)
                if ahead in boxes:                                  # push: the box at `ahead` was at p before the move
                    cands.append(frozenset((boxes - {ahead}) | {p}))
                for b0 in cands:
                    k = enc(b0, prev)
                    if k in self.dist: continue
                    if len(self.dist) >= self.cap:
                        self.capped = True; q.clear(); break
                    self.dist[k] = d + 1; q.append((b0, prev))
                if self.capped: break
            if self.capped: break

    def get(self, boxes, player):
        """int distance | None (unsolvable) | 'unknown' (cap hit and state not reached)."""
        k = enc(boxes, player)
        if k in self.dist: return self.dist[k]
        return UNKNOWN if self.capped else None


_CACHE = collections.OrderedDict()


def dist_map(walls, goals, cap=STATE_CAP):
    key = (frozenset(walls), frozenset(goals), cap)
    m = _CACHE.get(key)
    if m is None:
        m = DistMap(walls, goals, cap); _CACHE[key] = m
        while len(_CACHE) > MAP_CACHE_SIZE: _CACHE.popitem(last=False)
    else:
        _CACHE.move_to_end(key)
    return m


def distance(board, cap=STATE_CAP):
    walls, goals, boxes, player = parse(board)
    return dist_map(walls, goals, cap).get(boxes, player)


def _known(d):
    return isinstance(d, int)


def grade_state(walls, goals, boxes, player, moves, stop_at_solve=True, cap=STATE_CAP):
    """Grade a move string from an arbitrary state. Characters outside UDLR make the move 'illegal' (not applied)."""
    dm = dist_map(walls, goals, cap)
    boxes = frozenset(boxes); d0 = dm.get(boxes, player)
    labels, dists, applied = [], [d0], ""
    illegal_at = solved_at = None
    d = d0
    for i, m in enumerate(moves):
        if illegal_at is not None or solved_at is not None:
            labels.append("unused"); continue
        res = step(walls, boxes, player, m) if m in MOVES else None
        if res is None:
            illegal_at = i; labels.append("illegal"); continue
        nb, npl = frozenset(res[0]), res[1]
        nd = dm.get(nb, npl)
        if d is None: lab = "dead"
        elif d == UNKNOWN or nd == UNKNOWN: lab = UNKNOWN
        elif nd is None: lab = "fatal"
        elif nd < d: lab = "progress"
        else: lab = "neutral"
        labels.append(lab); dists.append(nd); applied += m
        boxes, player, d = nb, npl, nd
        if boxes == goals and stop_at_solve: solved_at = i
    sound = 0
    if _known(d0):
        for k in range(1, len(applied) + 1):
            if labels[k - 1] not in ("progress", "neutral"): break
            if _known(dists[k]) and dists[k] < d0: sound = k
    d_end = dists[-1]
    return {"labels": labels, "dist": dists, "applied": applied, "illegal_at": illegal_at,
            "solved": boxes == goals, "solved_at": solved_at, "d_start": d0, "d_end": d_end,
            "delta": (d0 - d_end) if (_known(d0) and _known(d_end)) else None,
            "sound_prefix": applied[:sound], "sound_len": sound,
            "counts": dict(collections.Counter(labels)), "end_boxes": sorted(boxes), "end_player": player}


def grade(board, moves, stop_at_solve=True, cap=STATE_CAP):
    walls, goals, boxes, player = parse(board)
    return grade_state(walls, goals, boxes, player, moves, stop_at_solve, cap)


def replay_path(board, turns_applied):
    """State after a sequence of harness 'applied' strings ('RESET' restores the start). Every move must be legal."""
    walls, goals, boxes0, player0 = parse(board)
    boxes, player = boxes0, player0
    for a in turns_applied:
        if a == "RESET":
            boxes, player = boxes0, player0; continue
        for m in a:
            res = step(walls, boxes, player, m)
            assert res is not None, ("replay hit a blocked move", a)
            boxes, player = frozenset(res[0]), res[1]
    return walls, goals, frozenset(boxes), player


if __name__ == "__main__":
    b = open(sys.argv[1]).read().rstrip("\n")
    g = grade(b, sys.argv[2])
    print({k: g[k] for k in ("labels", "dist", "applied", "illegal_at", "solved", "sound_prefix", "delta")})
