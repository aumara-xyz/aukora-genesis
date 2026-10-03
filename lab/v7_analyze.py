"""v7 analysis (Mac-side, pure python) over v7_eval_{base,gen1,v7}.json.
PRIMARY (PREREG H1): one-sided exact sign test over boards on per-board lenient_ok_forced, v7 vs gen1; PASS iff p <= 0.05.
Secondary: v7 vs base, gen1 vs base (same test); forced-vs-raw rescue counts (H2: base lenient rescues >= 5); illegal-move
rate; per-band totals; strict. Refuses receipts that differ in sampling/forcing config or eval-code sha256; asserts forcing
never lowered a verdict; H1 is NOT_EVALUABLE if the forced pass failed in either H1 arm (receipt forcing_complete=false). Usage: python v7_analyze.py [base.json gen1.json v7.json] [--json out.json]"""
import json, os, sys
from math import comb

DEF = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pulled", "out")
KEYS = ["lenient_ok_raw", "lenient_ok_forced", "strict_ok_raw", "strict_ok_forced"]


def sign_test(a, b, key="lenient_ok_forced"):
    """H1: model a > model b. Boards paired by id; ties dropped. p = P(X >= wins | Bin(wins+losses, 1/2))."""
    bb = {c["id"]: c[key] for c in b["cases"]}
    d = [c[key] - bb[c["id"]] for c in a["cases"]]
    w, l = sum(x > 0 for x in d), sum(x < 0 for x in d); n = w + l
    p = sum(comb(n, j) for j in range(w, n + 1)) / 2 ** n if n else 1.0
    return {"key": key, "wins": w, "losses": l, "ties": len(d) - n, "p_one_sided": p, "pass": p <= 0.05}


def model_stats(r):
    ss = [s for c in r["cases"] for s in c["samples"]]; n = len(ss)
    ill = lambda k: sum(s[k].startswith("ILLEGAL") for s in ss)
    planned = lambda k: sum(s[k] != "NOPLAN" for s in ss)
    return {**{k: sum(c[k] for c in r["cases"]) for k in KEYS}, "of": n,
            "truncated": sum(s["finish"] == "length" for s in ss),
            "lenient_rescued": sum(s["lenient_raw"] != "OK" and s["lenient_forced"] == "OK" for s in ss),
            "strict_rescued": sum(s["strict_raw"] != "OK" and s["strict_forced"] == "OK" for s in ss),
            "lenient_lost": sum(s["lenient_raw"] == "OK" and s["lenient_forced"] != "OK" for s in ss),
            "forced": sum(s["forced_text"] is not None for s in ss),
            "truncated_after_think_close": sum(s["finish"] == "length" and s["had_think_close"] for s in ss),
            "forcing_complete": r.get("forcing_complete", False),
            "boards_rescued": sum(c["lenient_ok_forced"] > c["lenient_ok_raw"] for c in r["cases"]),
            "illegal_raw": ill("lenient_raw"), "illegal_forced": ill("lenient_forced"),
            "illegal_rate_forced": round(ill("lenient_forced") / n, 4),
            "illegal_rate_forced_of_planned": round(ill("lenient_forced") / max(1, planned("lenient_forced")), 4),
            "noplan_forced": n - planned("lenient_forced"),
            "mean_tokens": round(sum(s["tokens"] for s in ss) / n, 1),
            "per_band": {b: {k: sum(c[k] for c in r["cases"] if c["band"] == b) for k in ("lenient_ok_forced", "strict_ok_forced")}
                         for b in sorted({c["band"] for c in r["cases"]}, key=lambda s: int(s.split("-")[0]))}}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    jout = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
    if jout in args: args.remove(jout)
    paths = dict(zip(["base", "gen1", "v7"], args or [os.path.join(DEF, f"v7_eval_{t}.json") for t in ("base", "gen1", "v7")]))
    R = {t: json.load(open(p)) for t, p in paths.items() if os.path.exists(p)}
    assert R, "no receipts found"
    shas = {r["holdout_sha256"] for r in R.values()}; ids = {tuple(c["id"] for c in r["cases"]) for r in R.values()}
    assert len(shas) == 1 and len(ids) == 1, "receipts are not on the same sealed set"
    for t, r in R.items():
        assert r["tag"] == t and r.get("stage") == "final", f"{t}: not a final v7_eval receipt"
    for k in ("sampling", "forcing", "code_sha256"):   # identical protocol + identical eval code across arms
        vals = {json.dumps(r[k], sort_keys=True) for r in R.values()}
        assert len(vals) == 1, f"receipts differ in {k}: {vals}"
    S = {t: model_stats(r) for t, r in R.items()}
    for t, s in S.items():
        assert s["lenient_lost"] == 0, f"{t}: forcing lowered {s['lenient_lost']} lenient verdicts (must be 0 by construction)"
    bands = list(next(iter(S.values()))["per_band"])
    print(f"holdout_v7 sha256 {shas.pop()[:16]}..  boards {len(next(iter(ids)))}  samples/model {next(iter(S.values()))['of']}")
    hdr = ["model", "len_raw", "len_forced", "str_raw", "str_forced", "trunc", "forced", "rescue_len", "rescue_str", "illegal%", "noplan", "mean_tok"] + [f"Lf {b}" for b in bands]
    print(" ".join(f"{h:>11}" for h in hdr))
    for t, s in S.items():
        row = [t, s["lenient_ok_raw"], s["lenient_ok_forced"], s["strict_ok_raw"], s["strict_ok_forced"], s["truncated"], s["forced"], s["lenient_rescued"],
               s["strict_rescued"], f"{100 * s['illegal_rate_forced']:.1f}", s["noplan_forced"], s["mean_tokens"]] + [s["per_band"][b]["lenient_ok_forced"] for b in bands]
        print(" ".join(f"{str(x):>11}" for x in row))
    tests = {}
    for a, b, role in [("v7", "gen1", "PRIMARY"), ("v7", "base", "secondary"), ("gen1", "base", "secondary")]:
        if a in R and b in R:
            for key in ("lenient_ok_forced", "strict_ok_forced", "lenient_ok_raw"):
                tr = sign_test(R[a], R[b], key); tests[f"{a}>{b}:{key}"] = tr
                if role == "PRIMARY" and key == "lenient_ok_forced":
                    if not (S["v7"]["forcing_complete"] and S["gen1"]["forcing_complete"]):
                        tr["pass"] = None; tr["verdict"] = "NOT_EVALUABLE (forced pass failed in an H1 arm; see PREREG 5)"
                    else:
                        tr["verdict"] = "PASS" if tr["pass"] else "FAIL"
                    print(f"PRIMARY H1 v7>gen1 lenient_ok_forced: wins {tr['wins']} losses {tr['losses']} ties {tr['ties']} p={tr['p_one_sided']:.3g} -> {tr['verdict']}")
                else:
                    print(f"  [secondary] {a}>{b} {key}: +{tr['wins']} -{tr['losses']} ={tr['ties']} p={tr['p_one_sided']:.3g}")
    h2 = None
    if "base" in S:
        h2 = S["base"]["lenient_rescued"] >= 5 if S["base"]["forcing_complete"] else None
        print(f"H2 forcing rescues >=5 base board-samples (lenient): {S['base']['lenient_rescued']} -> "
              f"{'NOT_EVALUABLE (forced pass failed)' if h2 is None else 'SUPPORTED' if h2 else 'NOT SUPPORTED'}")
    if jout:
        with open(jout, "w") as f: json.dump({"paths": paths, "stats": S, "tests": tests, "H2_supported": h2}, f, indent=1)


if __name__ == "__main__":
    main()
