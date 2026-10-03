"""Seal 32 holdout boards: depth bands 8-16 / 17-32 / 33-48 with quotas 11/11/10. Seed fixed."""
import json, random, hashlib, sys
from sokoban import generate, solve, canonical_id
SEED, QUOTA = 7_20261003, {(8, 16): 11, (17, 32): 11, (33, 48): 10}
rng = random.Random(SEED)
got, seen = {b: [] for b in QUOTA}, set()
tries = 0
while any(len(got[b]) < q for b, q in QUOTA.items()):
    tries += 1
    board = generate(rng)
    cid = canonical_id(board)
    if cid in seen: continue
    sol, status = solve(board)
    if status != "SOLVED": continue
    for (lo, hi), q in QUOTA.items():
        if lo <= len(sol) <= hi and len(got[(lo, hi)]) < q:
            seen.add(cid)
            got[(lo, hi)].append({"board": board, "canonical_id": cid, "oracle_len": len(sol),
                                  "oracle_sha256": hashlib.sha256(sol.encode()).hexdigest()})
holdout = [dict(id=f"H{i:02d}", band=f"{lo}-{hi}", **x) for i, ((lo, hi), x) in
           enumerate((b, x) for b in QUOTA for x in got[b])]
json.dump({"seed": SEED, "tries": tries, "cases": holdout}, open(sys.argv[1], "w"), indent=1)
print("tries", tries, "cases", len(holdout))
