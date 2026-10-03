"""Unit tests for v8_grade (Mac, pure python): hand-made cases (corner deadlock, push into wall, walk into wall, double push,
neutral/back-and-forth, sound prefix, stop at solve, cap -> unknown) + property tests against the forward BFS oracle
(sokoban.solve on rendered states) on random boards and random-walk states.
Usage: python3 v8_grade_test.py [-v]"""
import random, unittest

import v8_grade as G
from sokoban import generate, solve, parse, step
from v7_common import render

# Corner-deadlock board. Box A at (1,2) against the top wall (only L/R pushes possible); goal (1,5) on the same row.
# Player (1,3): 'L' pushes A into the non-goal corner (1,1) -> unsolvable. Box B (4,3) -> goal (4,5).
CORNER = "\n".join([
    "########",
    "# $@ . #",
    "#      #",
    "#      #",
    "#  $ . #",
    "#      #",
    "#      #",
    "########"])
# Push-into-wall board: player (3,3), box (3,4), interior wall (3,5): 'R' is blocked.
WALLPUSH = "\n".join([
    "########",
    "#.     #",
    "#      #",
    "#  @$# #",
    "#      #",
    "#   $ .#",
    "#      #",
    "########"])
# Two boxes in a row: player (2,2), boxes (2,3),(2,4): 'R' would push two boxes -> blocked.
DOUBLE = "\n".join([
    "########",
    "#      #",
    "# @$$  #",
    "#      #",
    "#   .  #",
    "#   .  #",
    "#      #",
    "########"])


class HandMade(unittest.TestCase):
    def test_corner_deadlock_is_fatal(self):
        d0 = G.distance(CORNER)
        self.assertIsInstance(d0, int)
        g = G.grade(CORNER, "L")
        self.assertEqual(g["labels"], ["fatal"]); self.assertIsNone(g["dist"][1]); self.assertEqual(g["sound_len"], 0)
        g = G.grade(CORNER, "LRD")
        self.assertEqual(g["labels"], ["fatal", "dead", "dead"]); self.assertIsNone(g["delta"])

    def test_push_into_wall_is_illegal(self):
        g = G.grade(WALLPUSH, "RUL")
        self.assertEqual(g["labels"], ["illegal", "unused", "unused"])
        self.assertEqual(g["illegal_at"], 0); self.assertEqual(g["applied"], ""); self.assertEqual(g["sound_len"], 0)

    def test_walk_into_outer_wall_is_illegal(self):
        g = G.grade(CORNER, "DDDDDDD")
        # D from (1,3): (2,3), (3,3), push box B (4,3)->(5,3), push (5,3)->(6,3), then the push into the row-7 wall is blocked
        self.assertEqual(g["illegal_at"], 4); self.assertEqual(g["applied"], "DDDD")
        self.assertEqual(g["labels"][4:], ["illegal", "unused", "unused"])

    def test_push_two_boxes_is_illegal(self):
        g = G.grade(DOUBLE, "R")
        self.assertEqual(g["labels"], ["illegal"])

    def test_bad_char_is_illegal(self):
        g = G.grade(CORNER, "DxD")
        self.assertEqual(g["labels"], [g["labels"][0], "illegal", "unused"]); self.assertEqual(g["illegal_at"], 1)

    def test_oracle_solution_all_progress(self):
        s, st = solve(CORNER); self.assertEqual(st, "SOLVED")
        g = G.grade(CORNER, s)
        self.assertTrue(all(l == "progress" for l in g["labels"]), g["labels"])
        self.assertEqual(g["dist"], list(range(len(s), -1, -1)))
        self.assertTrue(g["solved"]); self.assertEqual(g["sound_prefix"], s); self.assertEqual(g["delta"], len(s))

    def test_back_and_forth_neutral_progress_and_sound_prefix(self):
        d0 = G.distance(CORNER)
        g = G.grade(CORNER, "RL")                           # (1,3)->(1,4) walks away from the push spot (1,1), then back
        self.assertEqual(g["labels"], ["neutral", "progress"]); self.assertEqual(g["dist"], [d0, d0 + 1, d0])
        self.assertEqual(g["sound_len"], 0)                 # ends at the start distance: not strictly better -> empty
        g = G.grade(CORNER, "DU")                           # D is on a shortest path (towards (1,1) via row 2), U undoes it
        self.assertEqual(g["labels"], ["progress", "neutral"]); self.assertEqual(g["sound_prefix"], "D")

    def test_sound_prefix_stops_before_fatal(self):
        s, _ = solve(CORNER)
        # find a prefix of the oracle path after which some move is fatal
        walls, goals, boxes, player = parse(CORNER)
        found = False
        for k in range(1, len(s)):
            g0 = G.grade(CORNER, s[:k])
            st = G.replay_path(CORNER, [s[:k]])
            for m in "UDLR":
                g1 = G.grade_state(st[0], st[1], st[2], st[3], m)
                if g1["labels"] == ["fatal"]:
                    g = G.grade(CORNER, s[:k] + m + s[k:])
                    self.assertEqual(g["labels"][k], "fatal"); self.assertEqual(g["sound_len"], k)
                    self.assertEqual(g["sound_prefix"], s[:k]); found = True; break
            if found: break
        self.assertTrue(found)

    def test_stop_at_solve(self):
        s, _ = solve(CORNER)
        g = G.grade(CORNER, s + "UD")
        self.assertEqual(g["labels"][-2:], ["unused", "unused"]); self.assertEqual(g["solved_at"], len(s) - 1)
        g2 = G.grade(CORNER, s + "UD", stop_at_solve=False)
        self.assertNotIn("unused", g2["labels"])

    def test_cap_gives_unknown(self):
        g = G.grade(CORNER, "DU", cap=10)
        self.assertEqual(g["d_start"], G.UNKNOWN)
        self.assertTrue(all(l == "unknown" for l in g["labels"]), g["labels"]); self.assertEqual(g["sound_len"], 0)

    def test_replay_path_reset(self):
        st = G.replay_path(CORNER, ["D", "RESET", "D", "U"])
        self.assertEqual(st[3], parse(CORNER)[3])


class Property(unittest.TestCase):
    def test_against_forward_bfs(self):
        rng = random.Random(8120261003); n_boards = n_states = n_dead = 0
        while n_boards < 60:
            b = generate(rng); s, st = solve(b)
            if st != "SOLVED": continue
            n_boards += 1
            walls, goals, boxes, player = parse(b)
            self.assertEqual(G.distance(b), len(s))
            g = G.grade(b, s)
            self.assertTrue(all(l == "progress" for l in g["labels"]))
            for _ in range(6):                                  # random-walk states, checked against forward BFS
                bx, pl = boxes, player
                for _ in range(rng.randint(1, 25)):
                    r = step(walls, bx, pl, rng.choice("UDLR"))
                    if r is not None: bx, pl = frozenset(r[0]), r[1]
                d = G.dist_map(walls, goals).get(bx, pl)
                fs, fst = solve(render(walls, goals, bx, pl))
                if fst == "SOLVED_TRIVIAL": self.assertEqual(d, 0)
                elif fst == "SOLVED": self.assertEqual(d, len(fs))
                elif fst == "UNSOLVABLE": self.assertIsNone(d); n_dead += 1
                n_states += 1
                if isinstance(d, int) and d > 0:                 # some move makes progress; no move lowers d by > 1
                    nds = []
                    for m in "UDLR":
                        r = step(walls, bx, pl, m)
                        if r is not None: nds.append(G.dist_map(walls, goals).get(frozenset(r[0]), r[1]))
                    self.assertIn(d - 1, nds)
                    self.assertTrue(all(x is None or x >= d - 1 for x in nds))
        self.assertGreater(n_dead, 0)


if __name__ == "__main__":
    unittest.main()
