"""v8 hard-biased TRAINING pool (Mac, pure python, deterministic): 160 procedural boards, oracle-length bands
9-16: 40, 17-32: 80, 33-48: 40 (75% at depth >= 17), rng seed 1120261003 (public: this is a training pool, not a sealed set).
Excludes by canonical id (8 symmetries): every sealed set (holdout.json, holdout128, holdout_v7, holdout_rep1, and
holdout_v8 if it already exists), every earlier pool / CP / probe / wm_library board, and every 8x8 grid found in pulled/**,
run-dir json(l), ledger/** json, lab/** json + jsonl (v8_common.exclusion).
Usage: python3 v8_pool.py [OUT=lab/v8_pool.json] [--scratch]     (a relative OUT resolves against lab/; refuses to overwrite)"""
import hashlib, json, os, random, sys, time

from sokoban import generate, solve, canonical_id
import v8_common as C

SEED = 1120261003


def make(excl, seed=SEED, quota=C.POOL_BANDS, max_tries=2_000_000):
    rng = random.Random(seed); got = {b: [] for b in quota}; seen = set(); tries = 0
    while any(len(got[b]) < q for b, q in quota.items()):
        tries += 1; assert tries < max_tries, "pool generation did not converge"
        b = generate(rng); cid = canonical_id(b)
        if cid in excl or cid in seen: continue
        seen.add(cid)
        s, st = solve(b)
        if st != "SOLVED": continue
        for (lo, hi), q in quota.items():
            if lo <= len(s) <= hi and len(got[(lo, hi)]) < q:
                got[(lo, hi)].append({"board": b, "canonical_id": cid, "oracle_len": len(s),
                                      "oracle_sha256": hashlib.sha256(s.encode()).hexdigest()}); break
    cases = [dict(id=f"P8_{i:03d}", band=f"{lo}-{hi}", **x)
             for i, ((lo, hi), x) in enumerate((bd, x) for bd in quota for x in got[bd])]
    return cases, tries


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]; scratch = "--scratch" in sys.argv
    out = os.path.abspath(os.path.join(C.LAB, args[0] if args else "v8_pool.json"))
    real = out == os.path.join(C.LAB, "v8_pool.json")
    assert real or scratch, "non-default output path needs --scratch"
    assert not os.path.exists(out), f"{out} exists; refusing to overwrite"
    t = time.time()
    excl, summ, _ = C.exclusion(exclude_files=[out])
    cases, tries = make(excl)
    ids = [c["canonical_id"] for c in cases]
    assert len(ids) == 160 and len(set(ids)) == 160 and not (set(ids) & excl)
    obj = {"name": "v8_pool", "purpose": "TRAINING pool (interactive collection + single-shot attempts); never an eval set",
           "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "seed": SEED,
           "quota": {f"{lo}-{hi}": q for (lo, hi), q in C.POOL_BANDS.items()}, "generator_draws": tries,
           "exclusion": summ, "cases": cases}
    with open(out, "w") as f: json.dump(obj, f, indent=1)
    print("V8_POOL", out, C.sha_file(out), "cases", len(cases), "excluded", summ["total_ids"], "draws", tries, f"{time.time() - t:.1f}s")


if __name__ == "__main__":
    main()
