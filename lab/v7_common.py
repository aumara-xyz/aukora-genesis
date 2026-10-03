"""v7 shared pure-python helpers (Mac-side; no GPU imports): board render, holdout128 replay, board scanning."""
import collections, glob, json, os, random
from sokoban import H, W, generate, solve, canonical_id

LAB = os.path.dirname(os.path.abspath(__file__))
RUN = os.path.dirname(LAB)
PULLED = os.environ.get("V7_PULLED", os.path.join(RUN, "pulled"))
H128_SEED = 51_20261003                       # confirm.py
H128_QUOTA = {(8, 16): 43, (17, 32): 43, (33, 48): 42}
CP_SEED = 91_20261003                          # 9120261003 (v7 CP aux data)
TILES = set("#.@$+* ")


def render(walls, goals, boxes, player):
    """Inverse of sokoban.parse: same tile alphabet, player on goal '+', box on goal '*'."""
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


def holdout32_ids(lab=LAB):
    return {c["canonical_id"] for c in json.load(open(os.path.join(lab, "holdout.json")))["cases"]}


def regen_holdout128(lab=LAB, attempts=None):
    """Exact replay of confirm.make(): exclusion = holdout.json + v5_attempts pool; rng seed 5120261003.
    Cross-checked against pulled confirm_base.json (ids + bands) when present; also against lab/holdout128.json if present."""
    attempts = attempts or os.path.join(PULLED, "out", "v5_attempts.json")
    excl = holdout32_ids(lab) | {canonical_id(p["board"]) for p in json.load(open(attempts))["pool"]}
    rng = random.Random(H128_SEED); got = collections.Counter(); cases = []
    while len(cases) < 128:
        b = generate(rng); cid = canonical_id(b)
        if cid in excl: continue
        s, st = solve(b)
        if st != "SOLVED": continue
        for (lo, hi), q in H128_QUOTA.items():
            if lo <= len(s) <= hi and got[(lo, hi)] < q:
                excl.add(cid); got[(lo, hi)] += 1
                cases.append({"id": f"C{len(cases):03d}", "band": f"{lo}-{hi}", "board": b, "canonical_id": cid, "oracle_len": len(s)})
    cb = os.path.join(PULLED, "out", "confirm_base.json")
    if os.path.exists(cb):
        ref = [(c["id"], c["band"]) for c in json.load(open(cb))["cases"]]
        assert ref == [(c["id"], c["band"]) for c in cases], "holdout128 replay does not match confirm_base.json id/band sequence"
    box = os.path.join(lab, "holdout128.json")
    if os.path.exists(box):
        assert [c["canonical_id"] for c in json.load(open(box))["cases"]] == [c["canonical_id"] for c in cases], "holdout128 replay != holdout128.json"
    return cases


def sealed_known_ids(lab=LAB):
    """canonical ids of the two already-sealed sets (holdout.json 32 + holdout128 128)."""
    h32 = holdout32_ids(lab); h128 = {c["canonical_id"] for c in regen_holdout128(lab)}
    assert len(h32) == 32 and len(h128) == 128 and not (h32 & h128)
    return h32, h128


def probe_easy_ids(lab=LAB):
    """Exact replay of probe_vllm.py easy set (seed 3120261003, 16 boards depth 4-8; seen at inference only)."""
    seen = holdout32_ids(lab); rng = random.Random(31_20261003); easy = set()
    while len(easy) < 16:
        b = generate(rng); cid = canonical_id(b)
        if cid in seen: continue
        s, st = solve(b)
        if st == "SOLVED" and 4 <= len(s) <= 8: seen.add(cid); easy.add(cid)
    return easy


def grids_in_text(s):
    """Every 8x8 bordered grid (8 consecutive lines of exactly 8 tiles, first/last '########')."""
    lines = s.split("\n")
    for i in range(len(lines) - 7):
        win = lines[i:i + 8]
        if win[0] == "########" and win[7] == "########" and all(
                len(l) == 8 and l[0] == "#" and l[7] == "#" and set(l) <= TILES for l in win):
            yield "\n".join(win)


def _strings(o):
    if isinstance(o, str): yield o
    elif isinstance(o, dict):
        for v in o.values(): yield from _strings(v)
    elif isinstance(o, list):
        for v in o: yield from _strings(v)


def scan_files(files):
    """canonical ids of every grid found in JSON strings (.json/.jsonl) or raw text (.log/.txt/.md). Returns (ids, per_file_counts)."""
    ids, per = set(), {}
    for f in files:
        try: txt = open(f, encoding="utf-8", errors="replace").read()
        except OSError: continue
        texts = [txt]
        if f.endswith(".json"):
            try: texts += list(_strings(json.loads(txt)))
            except ValueError: pass
        elif f.endswith(".jsonl"):
            for line in txt.splitlines():
                try: texts += list(_strings(json.loads(line)))
                except ValueError: pass
        found = {canonical_id(g) for t in texts for g in grids_in_text(t)}
        if found: per[os.path.relpath(f, RUN)] = len(found)
        ids |= found
    return ids, per


def pool_boards(files):
    """Boards listed under a top-level 'pool' key (attempt / pool receipts)."""
    ids = set()
    for f in files:
        try: d = json.load(open(f))
        except (OSError, ValueError): continue
        if isinstance(d, dict) and isinstance(d.get("pool"), list):
            ids |= {canonical_id(p["board"]) for p in d["pool"] if isinstance(p, dict) and "board" in p}
    return ids


def candidate_files(exclude=()):
    ex = {os.path.abspath(e) for e in exclude}
    pats = [os.path.join(PULLED, "**", "*.json"), os.path.join(PULLED, "**", "*.jsonl"), os.path.join(PULLED, "**", "*.log"),
            os.path.join(RUN, "*.json"), os.path.join(RUN, "*.jsonl"), os.path.join(RUN, "ledger", "**", "*.json"),
            os.path.join(LAB, "**", "*.json")]
    fs = sorted({os.path.abspath(f) for p in pats for f in glob.glob(p, recursive=True)})
    return [f for f in fs if f not in ex and not os.path.basename(f).startswith("holdout_v7")]
