"""v8 SEALED eval set (Mac, run ONCE, after v8_pool.json exists): holdout_v8.json = 144 boards (64 depth 8-16, 64 depth 17-32,
16 depth 33-48; same quotas, generator and BFS oracle as v7_seal.py). Seed: env V8_SEAL_SEED, or --auto-seed (drawn inside this
process with secrets.randbits(63)); the seed is never printed or stored.
Exclusion (v8_common.exclusion, canonical ids, 8 symmetries): holdout.json, holdout128, holdout_v7, holdout_rep1 (all read
EXPLICITLY by file; v7_seal's own scan skips holdout_v7*), every earlier pool / CP / probe / wm_library board, v8_pool.json
(REQUIRED to exist), s1 board ids, and every 8x8 grid in pulled/**, run-dir json(l), ledger/** json, lab/** json + jsonl.
Usage: python3 v8_seal.py holdout_v8.json --auto-seed            (the real seal: lab/holdout_v8.json)
       V8_SEAL_SEED=<int> python3 v8_seal.py <path> --scratch    (dry runs: any other path)"""
import hashlib, json, os, random, secrets, sys, time

from sokoban import generate, solve, canonical_id
import v8_common as C

PUBLIC_SEEDS = {7_20261003, 9_20261003, 10_20261003, 11_20261003, 31_20261003, 41_20261003, 51_20261003, 61_20261003, 81_20261003,
                91_20261003, 20261003, 20261005, 20261007, 20261009, 20261010, 20261011, 20261012, 12345}


def make(excl, seed, quota=C.EVAL_BANDS):
    rng = random.Random(seed); got = {b: [] for b in quota}; seen = set()
    while any(len(got[b]) < q for b, q in quota.items()):
        b = generate(rng); cid = canonical_id(b)
        if cid in excl or cid in seen: continue
        seen.add(cid)
        s, st = solve(b)
        if st != "SOLVED": continue
        for (lo, hi), q in quota.items():
            if lo <= len(s) <= hi and len(got[(lo, hi)]) < q:
                got[(lo, hi)].append({"board": b, "canonical_id": cid, "oracle_len": len(s),
                                      "oracle_sha256": hashlib.sha256(s.encode()).hexdigest()}); break
    return [dict(id=f"V8_{i:03d}", band=f"{lo}-{hi}", **x) for i, ((lo, hi), x) in enumerate((bd, x) for bd in quota for x in got[bd])]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]; flags = {a for a in sys.argv[1:] if a.startswith("--")}
    out = os.path.abspath(os.path.join(C.LAB, args[0]))
    real = out == os.path.join(C.LAB, "holdout_v8.json"); scratch = "--scratch" in flags
    assert not os.path.exists(out), f"{out} exists; sealing is run once (refusing to overwrite)"
    if "--auto-seed" in flags:
        seed = secrets.randbits(63)
    else:
        seed = int(os.environ["V8_SEAL_SEED"])
    if real and (scratch or seed in PUBLIC_SEEDS):
        raise SystemExit("refusing: the real seal lab/holdout_v8.json needs a non-public seed and no --scratch")
    if not real and not scratch:
        raise SystemExit(f"refusing: {out} is not lab/holdout_v8.json (pass --scratch for a dry run)")
    assert os.path.exists(os.path.join(C.LAB, "v8_pool.json")), "v8_pool.json must exist first (the seal excludes it)"
    t = time.time()
    excl, summ, parts = C.exclusion(exclude_files=[out])
    assert "v8_pool" in parts and len(parts["v8_pool"]) == 160
    cases = make(excl, seed); del seed
    ids = [c["canonical_id"] for c in cases]
    assert len(cases) == 144 and len(set(ids)) == 144 and not (set(ids) & excl)
    obj = {"name": "holdout_v8" if real else "holdout_v8_SCRATCH", "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "seed": "secret (env V8_SEAL_SEED or in-process secrets.randbits(63)); deliberately not recorded",
           "quota": {f"{lo}-{hi}": q for (lo, hi), q in C.EVAL_BANDS.items()}, "exclusion": summ,
           "note": "v8 PRIMARY eval set. Never training data, never a pool board. Excludes holdout_rep1 (in use by REP1).",
           "cases": cases}
    with open(out, "w") as f: json.dump(obj, f, indent=1)
    print("V8_SEAL" if real else "V8_SEAL_SCRATCH (dry run, not the real seal)", out, C.sha_file(out), "excluded", summ["total_ids"],
          f"{time.time() - t:.1f}s")


if __name__ == "__main__":
    main()
