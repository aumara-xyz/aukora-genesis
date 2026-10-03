"""S1 tabu memory ("nope, that didn't work last time"): per-board memory of failed attempts, persisted across episodes.
Entry kinds:
  dead_rule     a state reached by a move prefix is a PROVEN deadlock (sound rule: non-goal corner / dead square / frozen
                2x2); the prefix up to the push that created it is failed. Proven = certain.
  illegal       a move prefix whose last move was blocked (verifier ILLEGAL@i): prefix = moves[:i+1].
  unsolved_end  a legal plan that ended without solving (verifier UNSOLVED): the end state was tried and did not finish.
                NOT proven dead (the plan may just have stopped early) -> shown as 'tried, did not finish'. It is a SOFT
                memory only: dead_keys() never returns it (2026-10-03 review fix: a correct-but-short plan such as the
                optimal first push must not be turned into a "dead end"); soft_keys() returns it for a soft note.
Only the simulator (sokoban.step), the typed verifier verdict and the sound rules are used; never the BFS oracle.
Persistence: append-only JSONL, one line per entry, keyed by the sha256 of the EXACT board string (board_sha256; the
symmetry-canonical id board_cid is kept only as a secondary index, because prefixes and coordinates are stored in the
recording board's own orientation and are wrong for a rotated / mirrored copy). Tabu(board, path) loads every earlier
entry for exactly that board (any episode); legacy lines without board_sha256 are ignored. Lines are < 4 KB and written with O_APPEND, so parallel episodes of the same
board (n samples / parallel games) can share one file as a common workspace.
avoid_block() renders an 'Avoid (tried, failed):' block for prompts / harness observations."""
import json, os, time

from sokoban import parse, step, verify, canonical_id
from s1_common import deadlock, render, sha_bytes, WORD

KINDS = ("dead_rule", "illegal", "unsolved_end")
HARD_KINDS = ("dead_rule",)                 # proven dead -> lookahead dead-end list
SOFT_KINDS = ("unsolved_end",)              # tried, did not finish -> soft note only (never P=0, never a dead end)


def state_key(boxes, player):
    return (tuple(sorted(boxes)), player)


class Tabu:
    def __init__(self, board, path=None, episode=None):
        self.board, self.path, self.episode = board, path, episode
        self.walls, self.goals, self.boxes0, self.player0 = parse(board)
        self.bid = canonical_id(board)                 # secondary index only
        self.bsha = sha_bytes(board)                   # primary key: exact board string (orientation-exact)
        self.entries, self._seen = [], set()
        if path and os.path.exists(path):
            with open(path) as f:
                for line in f:
                    try: e = json.loads(line)
                    except ValueError: continue
                    if e.get("board_sha256") == self.bsha and e.get("board_cid") == self.bid: self._add(e, persist=False)

    # ------------------------------------------------------------ recording
    def _add(self, e, persist=True):
        sig = (e["kind"], e["prefix"])
        if sig in self._seen: return None
        self._seen.add(sig); self.entries.append(e)
        if persist and self.path:
            line = json.dumps(e) + "\n"
            fd = os.open(self.path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
            try: os.write(fd, line.encode())
            finally: os.close(fd)
        return e

    def _entry(self, kind, prefix, boxes, player, reason):
        return {"board_sha256": self.bsha, "board_cid": self.bid, "episode": self.episode, "kind": kind, "prefix": prefix, "reason": reason,
                "state": render(self.walls, self.goals, boxes, player), "boxes": sorted(map(list, boxes)), "player": list(player),
                "t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    def record_attempt(self, moves, verdict=None, final=True):
        """Replay a plan from the start board. verdict (OK / FORMAT / ILLEGAL@i / UNSOLVED) is recomputed with
        sokoban.verify when not given (it must agree). final=False (mid-episode path in an interactive harness): a legal
        non-solving path is not recorded as 'unsolved_end'. Returns the new entries."""
        if not moves or any(m not in "UDLR" for m in moves):
            return []
        v = verify(self.board, moves)
        assert verdict is None or verdict == v, (verdict, v)
        new = []
        boxes, player = self.boxes0, self.player0
        for i, m in enumerate(moves):
            res = step(self.walls, boxes, player, m)
            if res is None:
                nxt = (player[0] + {"U": -1, "D": 1}.get(m, 0), player[1] + {"L": -1, "R": 1}.get(m, 0))
                what = "a wall" if nxt in self.walls else "a box that cannot move"
                new.append(self._add(self._entry("illegal", moves[:i + 1], boxes, player,
                                                 f"move {i} ({WORD[m]}) is blocked by {what}")))
                break
            pushed = frozenset(res[0]) != boxes
            boxes, player = frozenset(res[0]), res[1]
            if pushed:
                why = deadlock(self.walls, self.goals, boxes)
                if why:
                    new.append(self._add(self._entry("dead_rule", moves[:i + 1], boxes, player, why)))
                    break                                                # everything after a proven deadlock is moot
        else:
            if v == "UNSOLVED" and final:
                new.append(self._add(self._entry("unsolved_end", moves, boxes, player, "all moves legal but boxes not on goals")))
        return [e for e in new if e]

    def record_dead_state(self, boxes, player, reason, prefix=""):
        return self._add(self._entry("dead_rule", prefix, frozenset(map(tuple, boxes)), tuple(player), reason))

    # ------------------------------------------------------------ queries
    def dead_keys(self):
        """State keys a lookahead may treat as dead ends: PROVEN deadlocks only (dead_rule)."""
        return {state_key(map(tuple, e["boxes"]), tuple(e["player"])) for e in self.entries if e["kind"] in HARD_KINDS}

    def soft_keys(self):
        """End states of legal plans that did not finish (unsolved_end). NOT proven dead: a lookahead may only note them
        as 'tried before, did not finish' (no P=0, no dead-end listing)."""
        return {state_key(map(tuple, e["boxes"]), tuple(e["player"])) for e in self.entries if e["kind"] in SOFT_KINDS}

    def failed_prefixes(self):
        return [e["prefix"] for e in self.entries if e["kind"] in ("dead_rule", "illegal")]

    def avoid_block(self, max_items=8, max_prefix=24):
        if not self.entries: return ""
        L = ["Avoid (tried, failed):"]
        order = sorted(self.entries, key=lambda e: KINDS.index(e["kind"]))
        for e in order[:max_items]:
            p = e["prefix"] if len(e["prefix"]) <= max_prefix else e["prefix"][:max_prefix] + "..."
            if e["kind"] == "dead_rule": L.append(f"- moves {p}: dead end for certain ({e['reason']}).")
            elif e["kind"] == "illegal": L.append(f"- moves {p}: {e['reason']}.")
            else: L.append(f"- moves {p}: legal but did not finish (boxes not on goals); not proven dead, the plan may have stopped early.")
        if len(order) > max_items: L.append(f"- ... and {len(order) - max_items} more failed attempts.")
        return "\n".join(L)

    def summary(self):
        return {"board_sha256": self.bsha, "board_cid": self.bid, "entries": len(self.entries), "by_kind": {k: sum(e["kind"] == k for e in self.entries) for k in KINDS},
                "block_sha256": sha_bytes(self.avoid_block())}
