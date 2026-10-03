"""v8 shared pure-python helpers (Mac + box; no GPU imports): sealed-set and prior-data exclusion ids, bands, file sha,
paired sign test and the band-guard noise margin.

Exclusion sources (canonical id = all 8 symmetries, sokoban.canonical_id):
  SEALED   holdout.json (32), holdout128 (lab/holdout128.json on the box; exact replay of confirm.py on the Mac, asserted against
           pulled confirm_base.json), holdout_v7.json, holdout_rep1.json, holdout_v8.json (when it exists). These are read
           EXPLICITLY by file: v7_common.candidate_files() skips holdout_v7* files, so a v7_seal.py-style scan alone does not
           exclude holdout_v7 (RAN: the rep1 seal reached holdout_v7 only through grids in eval receipts, 142/144).
  PRIOR    every 'pool' board (v5_attempts, 02_pool, v6_A), v7_cp boards, probe_vllm easy boards, wm_library boards,
           v8_pool.json, and every 8x8 grid found in pulled/**, run-dir json/jsonl, ledger/** json, lab/** json AND jsonl
           (s1 state files, wm library/export), plus s1 'board_cid' values."""
import glob, hashlib, json, math, os

from sokoban import canonical_id
import v7_common as V7

LAB = V7.LAB
RUN = V7.RUN
PULLED = V7.PULLED
SEALED_FILES = ("holdout.json", "holdout_v7.json", "holdout_rep1.json", "holdout_v8.json")
SEALED_SIZES = {"holdout.json": 32, "holdout_v7.json": 144, "holdout_rep1.json": 144, "holdout_v8.json": 144}
POOL_BANDS = {(9, 16): 40, (17, 32): 80, (33, 48): 40}
EVAL_BANDS = {(8, 16): 64, (17, 32): 64, (33, 48): 16}
HEX64 = set("0123456789abcdef")


def sha_bytes(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()


def sha_file(p):
    with open(p, "rb") as f:
        return sha_bytes(f.read())


def band_of(n, bands):
    for lo, hi in bands:
        if lo <= n <= hi: return f"{lo}-{hi}"
    return None


def load_cases(path):
    return json.load(open(path))["cases"]


def sealed_ids(lab=LAB, require=("holdout.json", "holdout_v7.json", "holdout_rep1.json")):
    """{name: set(canonical ids)} for every sealed set. holdout128 from lab/holdout128.json if present (box), else replay."""
    out = {}
    for f in SEALED_FILES:
        p = os.path.join(lab, f)
        if not os.path.exists(p):
            assert f not in require, f"sealed set {f} missing in {lab}"
            continue
        cs = load_cases(p); ids = {c["canonical_id"] for c in cs}
        assert len(ids) == SEALED_SIZES[f] and all(canonical_id(c["board"]) == c["canonical_id"] for c in cs), f"{f} corrupt"
        out[f] = ids
    h128 = os.path.join(lab, "holdout128.json")
    if os.path.exists(h128):
        out["holdout128"] = {c["canonical_id"] for c in load_cases(h128)}
    else:
        out["holdout128"] = {c["canonical_id"] for c in V7.regen_holdout128(lab)}
    assert len(out["holdout128"]) == 128
    return out


def prior_pool_ids(lab=LAB):
    """Boards that earlier stages trained on or attempted: pools, CP, probe easy, wm library."""
    out = {}
    pools = glob.glob(os.path.join(PULLED, "out", "*.json")) + glob.glob(os.path.join(RUN, "*.json"))
    out["pool_boards"] = V7.pool_boards(pools)
    cp = os.path.join(lab, "v7_cp.json")
    if os.path.exists(cp):
        out["v7_cp"] = {x["canonical_id"] for x in json.load(open(cp))["items"]}
    try:
        out["probe_easy"] = V7.probe_easy_ids(lab)
    except (OSError, AssertionError):
        out["probe_easy"] = set()
    lib = os.path.join(lab, "wm_library.jsonl")
    if os.path.exists(lib):
        ids = set()
        for line in open(lib):
            try: d = json.loads(line)
            except ValueError: continue
            if isinstance(d, dict) and isinstance(d.get("board"), str):
                try: ids.add(canonical_id(d["board"]))
                except Exception: pass
        out["wm_library"] = ids
    return out


def scan_targets(exclude=()):
    """All files to scan for 8x8 grids (a superset of v7_common.candidate_files: adds lab/**/*.jsonl and holdout_* files)."""
    ex = {os.path.abspath(e) for e in exclude}
    pats = [os.path.join(PULLED, "**", "*.json"), os.path.join(PULLED, "**", "*.jsonl"), os.path.join(PULLED, "**", "*.log"),
            os.path.join(RUN, "*.json"), os.path.join(RUN, "*.jsonl"), os.path.join(RUN, "ledger", "**", "*.json"),
            os.path.join(LAB, "**", "*.json"), os.path.join(LAB, "**", "*.jsonl")]
    fs = sorted({os.path.abspath(f) for p in pats for f in glob.glob(p, recursive=True)})
    return [f for f in fs if f not in ex]


def s1_board_cids(lab=LAB):
    ids = set()
    for f in glob.glob(os.path.join(lab, "s1_states_*.jsonl")):
        for line in open(f):
            try: d = json.loads(line)
            except ValueError: continue
            v = d.get("board_cid") if isinstance(d, dict) else None
            if isinstance(v, str) and len(v) == 64 and set(v) <= HEX64: ids.add(v)
    return ids


def exclusion(lab=LAB, scan=True, exclude_files=(), require_sealed=("holdout.json", "holdout_v7.json", "holdout_rep1.json")):
    """(all_ids, summary). summary has per-source counts + sha256 of the sorted id list (ids themselves are not printed)."""
    parts = {}
    parts.update(sealed_ids(lab, require_sealed))
    parts.update(prior_pool_ids(lab))
    v8p = os.path.join(lab, "v8_pool.json")
    if os.path.exists(v8p) and os.path.abspath(v8p) not in {os.path.abspath(e) for e in exclude_files}:
        parts["v8_pool"] = {c["canonical_id"] for c in load_cases(v8p)}
    per_file = {}
    if scan:
        parts["scanned_grids"], per_file = V7.scan_files(scan_targets(exclude_files))
        parts["s1_board_cid"] = s1_board_cids(lab)
    allids = set().union(*parts.values())
    summ = {"total_ids": len(allids), **{k: len(v) for k, v in parts.items()}, "scanned_files": per_file,
            "excluded_ids_sha256": sha_bytes("\n".join(sorted(allids)))}
    return allids, summ, parts


def sealed_union(lab=LAB, require=("holdout.json", "holdout_v7.json", "holdout_rep1.json")):
    s = sealed_ids(lab, require)
    return set().union(*s.values()), {k: len(v) for k, v in s.items()}


def sign_test(xs, ys):
    """One-sided exact sign test that x > y, paired, ties dropped. Returns (wins, losses, ties, p)."""
    w = sum(1 for a, b in zip(xs, ys) if a > b); l = sum(1 for a, b in zip(xs, ys) if a < b); n = w + l
    p = 1.0 if n == 0 else sum(math.comb(n, k) for k in range(w, n + 1)) / 2 ** n
    return w, l, len(xs) - n, p


HARD_GATE_BANDS = ("17-32", "33-48")


def band_gate(new, champ, band, z=1.96):
    """Promotion-gate rule for one band (v8_PREREG section 6). Hard bands (17-32, 33-48): POINT NON-INFERIORITY, PASS iff
    D = sum(new - champ) >= 0 (no noise allowance: losing hard-board skill is exactly the failure v8 exists to avoid; under the
    paired null this false-fails a band with probability about 0.3-0.5, the accepted cost). 8-16: the sign-flip noise margin of
    band_guard (z = 1.96, i.e. a lenient one-sided check)."""
    g = band_guard(new, champ, z)
    if band in HARD_GATE_BANDS:
        g.update(rule="point: D >= 0", margin_unused=g["margin"], margin=0.0, **{"pass": g["D"] >= 0})
    else:
        g["rule"] = f"margin: D >= -{z}*sqrt(sum d^2)"
    return g


def band_guard(new, champ, z=1.96):
    """Promotion-gate statistic for one band. new/champ: per-board counts paired by board.
    D = sum(new - champ); margin = z * sqrt(sum d_i^2) (the exact variance of D under the paired sign-flip null, i.e. the
    null that each board's difference is symmetric about 0). PASS iff D >= -margin. With every d_i = 0, margin = 0 and D = 0
    -> PASS."""
    d = [a - b for a, b in zip(new, champ)]
    D = sum(d); margin = z * math.sqrt(sum(x * x for x in d))
    return {"D": D, "margin": round(margin, 3), "sum_new": sum(new), "sum_champ": sum(champ), "boards": len(d),
            "boards_up": sum(x > 0 for x in d), "boards_down": sum(x < 0 for x in d), "pass": D >= -margin}
