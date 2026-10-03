"""v7 sealed eval set (Mac-side, run ONCE, after v7_cp_data.py): holdout_v7.json = 144 boards
(64 depth 8-16, 64 depth 17-32, 16 depth 33-48), rng seed from env V7_SEAL_SEED (never printed or stored).
Excludes canonical ids (all 8 symmetries) of: holdout.json, holdout128 (exact replay of confirm.py, cross-checked),
v7_cp.json boards, probe_vllm.py easy boards (replayed), every 'pool' board in pulled/out receipts (*attempts*.json, 02_pool.json, v6_A.json), and every 8x8
grid found anywhere in pulled/**, run-dir *.json(l), ledger/**, lab/** JSON (prompts, traces, logs).
Usage: V7_SEAL_SEED=<secret int> python v7_seal.py <out_path> [cp_path=lab/v7_cp.json] [--scratch]
A relative <out_path> is resolved against lab/ (not the cwd). The real seal must be lab/holdout_v7.json with a non-public
seed; any other location is refused unless --scratch is given (dry runs only; never used by v7_run.sh).
Suggested: V7_SEAL_SEED=$(python3 -c 'import secrets;print(secrets.randbits(63))') python v7_seal.py holdout_v7.json"""
import glob, hashlib, json, os, random, sys, time
from sokoban import generate, solve, canonical_id
from v5_common import sha
from v7_common import LAB, RUN, PULLED, sealed_known_ids, probe_easy_ids, scan_files, pool_boards, candidate_files

QUOTA = {(8, 16): 64, (17, 32): 64, (33, 48): 16}
PUBLIC_SEEDS = {7_20261003, 9_20261003, 31_20261003, 41_20261003, 51_20261003, 61_20261003, 91_20261003, 20261003, 20261005, 20261007, 12345}


def main():
    args = [a for a in sys.argv[1:] if a != "--scratch"]; scratch = "--scratch" in sys.argv[1:]
    out = os.path.abspath(os.path.join(LAB, args[0]))            # relative -> lab/, absolute stays absolute
    cp_path = os.path.abspath(os.path.join(LAB, args[1])) if len(args) > 1 else os.path.join(LAB, "v7_cp.json")
    assert not os.path.exists(out), f"{out} exists; sealing is run once (refusing to overwrite)"
    seed = int(os.environ["V7_SEAL_SEED"])
    real = out == os.path.join(LAB, "holdout_v7.json")
    if real and (scratch or seed in PUBLIC_SEEDS):
        raise SystemExit("refusing: the real seal lab/holdout_v7.json needs a non-public seed and no --scratch")
    if not real and not scratch:
        raise SystemExit(f"refusing: {out} is not lab/holdout_v7.json (pass --scratch for a dry run)")
    cp = json.load(open(cp_path)); items = cp["items"]
    assert len(items) == 600 and sha(json.dumps(items, sort_keys=True)) == cp["sha256"], "v7_cp.json missing/corrupt"
    h32, h128 = sealed_known_ids()
    cp_ids = {x["canonical_id"] for x in items}
    probe = probe_easy_ids()
    pools = pool_boards(glob.glob(os.path.join(PULLED, "out", "*.json")) + glob.glob(os.path.join(RUN, "*.json")))
    files = candidate_files(exclude=[out])
    scanned, per_file = scan_files(files)
    excl = h32 | h128 | cp_ids | probe | pools | scanned
    rng = random.Random(seed); got = {b: [] for b in QUOTA}; seen = set()
    while any(len(got[b]) < q for b, q in QUOTA.items()):
        b = generate(rng); cid = canonical_id(b)
        if cid in excl or cid in seen: continue
        seen.add(cid)
        s, st = solve(b)
        if st != "SOLVED": continue
        for (lo, hi), q in QUOTA.items():
            if lo <= len(s) <= hi and len(got[(lo, hi)]) < q:
                got[(lo, hi)].append({"board": b, "canonical_id": cid, "oracle_len": len(s),
                                      "oracle_sha256": hashlib.sha256(s.encode()).hexdigest()}); break
    cases = [dict(id=f"V{i:03d}", band=f"{lo}-{hi}", **x) for i, ((lo, hi), x) in enumerate((b, x) for b in QUOTA for x in got[b])]
    ids = [c["canonical_id"] for c in cases]
    assert len(cases) == 144 and len(set(ids)) == 144 and not (set(ids) & excl)
    obj = {"name": "holdout_v7", "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "seed": "env V7_SEAL_SEED (deliberately not recorded)", "quota": {f"{lo}-{hi}": q for (lo, hi), q in QUOTA.items()},
           "exclusion": {"total_ids": len(excl), "holdout32": len(h32), "holdout128": len(h128), "cp": len(cp_ids), "probe_easy": len(probe),
                         "pool_boards": len(pools), "scanned_grids": len(scanned), "scanned_files": per_file,
                         "excluded_ids_sha256": sha("\n".join(sorted(excl))), "cp_items_sha256": cp["sha256"]},
           "cases": cases}
    with open(out, "w") as f: json.dump(obj, f, indent=1)
    print("V7_SEAL" if real else "V7_SEAL_SCRATCH (dry run, not the real seal)", out, sha(open(out, "rb").read()))
    print("excluded", len(excl), "h32", len(h32), "h128", len(h128), "cp", len(cp_ids), "pools", len(pools), "scanned", len(scanned))


if __name__ == "__main__":
    main()
