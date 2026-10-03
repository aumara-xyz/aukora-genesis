"""wm_* shared pure-python helpers (no GPU / vLLM imports; Mac + box).
render (inverse of sokoban.parse), board extraction from prompts, set loading with a sealed-set guard,
token-checkpoint char offsets (capture spec), exact one-sided sign test, Holm adjustment, solved-at-any-prefix rescoring,
append-only fsynced jsonl, environment/version capture, sha helpers."""
import hashlib, json, math, os, re

from sokoban import H, W, parse, step, canonical_id

LAB = os.path.dirname(os.path.abspath(__file__))
H128_SHA256 = "9dd07cd7774fc6937ff830165d83b08fdd011edb4c1ac897222cf058a6024e1b"   # PREREG-CONFIRM-1
CKPTS = (1024, 2048, 4096, 8192)                                                   # wm_capture_spec.md
TILES = set("#.@$+* ")


def sha_bytes(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()


def sha_file(path):
    with open(path, "rb") as f:
        return sha_bytes(f.read())


def render(walls, goals, boxes, player):
    """Inverse of sokoban.parse (same alphabet; '+' player on goal, '*' box on goal)."""
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


def grids_in_text(s):
    """Every 8x8 bordered grid in s (8 consecutive lines of 8 tiles, first/last '########')."""
    lines = s.split("\n")
    for i in range(len(lines) - 7):
        win = lines[i:i + 8]
        if win[0] == "#" * W and win[7] == "#" * W and all(
                len(l) == W and l[0] == "#" and l[-1] == "#" and set(l) <= TILES for l in win):
            yield "\n".join(win)


def board_from_solve_prompt(prompt):
    """Board inside a prompts.solve_prompt text ('Puzzle (8 lines):\\n' ... '\\n\\nReply'). Returns None if absent/invalid."""
    m = re.search(r"Puzzle \(8 lines\):\n((?:[^\n]{8}\n){7}[^\n]{8})\n", prompt)
    cand = [m.group(1)] if m else list(grids_in_text(prompt))
    for b in cand:
        try:
            parse(b); return b
        except (ValueError, AssertionError):
            continue
    return None


def load_set(setfile, allow_sealed=False, lab=LAB):
    """Load {"cases":[{id, band, board, canonical_id, oracle_len}]}. Refuses holdout_v7 (by name or by any canonical-id
    overlap with lab/holdout_v7.json) unless allow_sealed (a future, separately preregistered final eval)."""
    raw = open(setfile, "rb").read(); cases = json.loads(raw)["cases"]
    for c in cases:
        assert canonical_id(c["board"]) == c["canonical_id"], f"canonical id mismatch {c['id']}"
    if not allow_sealed:
        assert not os.path.basename(setfile).startswith("holdout_v7"), "holdout_v7 is sealed for the v7 final eval only"
        v7 = os.path.join(lab, "holdout_v7.json")
        if os.path.exists(v7):
            v7ids = {c["canonical_id"] for c in json.load(open(v7))["cases"]}
            assert not (v7ids & {c["canonical_id"] for c in cases}), "set overlaps holdout_v7 (sealed); refusing"
    return raw, cases


def sealed_ids(lab=LAB, h128_path=None):
    """canonical ids of holdout128 + holdout_v7 + holdout.json (32). holdout128: lab/holdout128.json if present (box),
    else exact replay via v7_common.regen_holdout128 (Mac; asserted against pulled confirm_base.json)."""
    ids, src = set(), {}
    h128_path = h128_path or os.path.join(lab, "holdout128.json")
    if os.path.exists(h128_path):
        h128 = {c["canonical_id"] for c in json.load(open(h128_path))["cases"]}; src["holdout128"] = "file"
    else:
        import v7_common                                   # read-only import (pure python); never modified
        h128 = {c["canonical_id"] for c in v7_common.regen_holdout128(lab)}; src["holdout128"] = "regen"
    assert len(h128) == 128, len(h128)
    ids |= h128
    v7 = os.path.join(lab, "holdout_v7.json")
    if os.path.exists(v7):
        v7ids = {c["canonical_id"] for c in json.load(open(v7))["cases"]}; assert len(v7ids) == 144
        ids |= v7ids; src["holdout_v7"] = len(v7ids)
    else:
        src["holdout_v7"] = "ABSENT"
    h32 = os.path.join(lab, "holdout.json")
    if os.path.exists(h32):
        ids |= {c["canonical_id"] for c in json.load(open(h32))["cases"]}; src["holdout32"] = "file"
    return ids, src


def ckpt_chars(tok, token_ids, ckpts=CKPTS):
    """{k: len(decode(ids[:k]))} for each checkpoint k < len(ids); None when the sample is shorter than k."""
    out = {}
    for k in ckpts:
        out[str(k)] = len(tok.decode(list(token_ids[:k]))) if len(token_ids) > k else None
    return out


def think_close_char(text):
    i = text.find("</think>")
    return None if i < 0 else i


def sign_test(xs, ys):
    """One-sided exact sign test that x > y, paired, ties dropped. Returns (wins, losses, p)."""
    w = sum(1 for a, b in zip(xs, ys) if a > b); l = sum(1 for a, b in zip(xs, ys) if a < b); n = w + l
    p = 1.0 if n == 0 else sum(math.comb(n, k) for k in range(w, n + 1)) / 2 ** n
    return w, l, p


def holm(pvals):
    """Holm step-down adjusted p-values for {name: p} (family-wise; informational in wm_PREREG.md section 3)."""
    items = sorted(pvals.items(), key=lambda kv: kv[1]); m = len(items); out, run = {}, 0.0
    for i, (k, p) in enumerate(items):
        run = max(run, min(1.0, (m - i) * p)); out[k] = round(run, 6)
    return out


def solved_at_prefix(board, plan):
    """True iff some prefix of plan (before its first blocked move) puts both boxes on goals. This is the interactive
    harness's scoring rule (it stops applying moves at the solving move), applied to a single-shot plan."""
    if not plan: return False
    walls, goals, boxes, player = parse(board)
    for m in plan:
        if m not in "UDLR": return False
        res = step(walls, boxes, player, m)
        if res is None: return False
        boxes, player = frozenset(res[0]), res[1]
        if boxes == goals: return True
    return False


def append_jsonl(path, rows):
    """Append rows as JSON lines in one write, then flush + fsync (durable per call)."""
    if not rows: return
    body = "".join(json.dumps(r, sort_keys=True, default=dict) + "\n" for r in rows)
    with open(path, "a") as f:
        f.write(body); f.flush(); os.fsync(f.fileno())


def read_jsonl(path):
    """Parse an append-only jsonl. A trailing fragment without a newline (crash mid-write) is cut off the file first;
    returns (rows, cut_bytes)."""
    raw = open(path, "rb").read(); cut = 0
    if raw and not raw.endswith(b"\n"):
        keep = raw.rfind(b"\n") + 1; cut = len(raw) - keep
        with open(path, "r+b") as f:
            f.truncate(keep); f.flush(); os.fsync(f.fileno())
        raw = raw[:keep]
    return [json.loads(l) for l in raw.decode().splitlines() if l.strip()], cut


def run_versions():
    """Library versions + chat-template sha for receipt heads (box). Missing libraries are recorded as None."""
    v = {}
    for name in ("vllm", "torch", "transformers"):
        try:
            v[name] = __import__(name).__version__
        except Exception:
            v[name] = None
    try:
        from v5_common import TEMPLATE_SHA
        v["chat_template_sha256"] = TEMPLATE_SHA
    except Exception:
        v["chat_template_sha256"] = None
    return v


def prereg_sha():
    """sha256 of the locked wm_PREREG.md, passed by wm_run.sh as WM_PREREG_SHA (None in dry runs)."""
    return os.environ.get("WM_PREREG_SHA") or None


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=1, default=dict)
    os.replace(tmp, path)
