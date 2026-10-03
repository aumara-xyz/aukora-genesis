"""v8 analysis (Mac or box, pure python) over OUT/v8_eval_{base,v7,v8}.json (+ OUT/wm_interactive_v8i_{base,v7,v8}.json if present).
Decision rules (v8_PREREG.md section 6):
  PRIMARY      v8 > base on per-board lenient_ok_forced (0..4), one-sided exact sign test over the 144 holdout_v8 boards, ties
               dropped; PASS iff p <= 0.05. NOT_EVALUABLE if the forced pass failed in the v8 or base receipt.
  CO-PRIMARY   v8 > v7 on per-board lenient_ok_forced over the 80 HARD boards (bands 17-32 and 33-48), same test; PASS iff
               p <= 0.05. This is the test of "graded hard turns help". NOT_EVALUABLE without final, forcing-complete v7/v8 receipts.
  GATE         band guard vs the champion v7, per band b: D_b = sum over the band's boards of (v8 - v7). Hard bands (17-32, 33-48):
               PASS iff D_b >= 0 (point non-inferiority). 8-16: PASS iff D_b >= -1.96*sqrt(sum d_i^2) (sign-flip noise margin).
               GATE PASS iff every band passes. NOT_EVALUABLE without final, forcing-complete v7/v8 receipts.
  PROMOTE      iff PRIMARY PASS and CO-PRIMARY PASS and GATE PASS (intersection-union: each at alpha 0.05). Everything else is
               secondary, including format-bleed measures (short_plan: a lenient plan of <= 8 moves on a board whose oracle needs
               > 8; plan_len / oracle_len) per arm and band.
Refuses receipts that differ in holdout sha / board ids / sampling / forcing / eval-code sha; asserts forcing never lowered a
verdict. Interactive receipts that differ in set / config / code / n are reported NOT_COMPARABLE (never raised), so the
single-shot analysis is always written. Usage: python3 v8_analyze.py OUT [--holdout-sha SHA] [--json out.json]"""
import collections, json, os, statistics, sys

import v8_common as C
from posthoc_lenient import lenient

KEYS = ["lenient_ok_raw", "lenient_ok_forced", "strict_ok_raw", "strict_ok_forced"]
ARMS = ("base", "v7", "v8")
HARD = C.HARD_GATE_BANDS
ALPHA = 0.05
FORCE_SUFFIX = "\n</think>\n\n"
SHORT_PLAN = 8


def per_board(r, key):
    return {c["id"]: c[key] for c in r["cases"]}


def paired(a, b, key, ids=None):
    pa, pb = per_board(a, key), per_board(b, key); ids = ids or [c["id"] for c in a["cases"]]
    return [pa[i] for i in ids], [pb[i] for i in ids]


def sign(a, b, key="lenient_ok_forced", ids=None):
    x, y = paired(a, b, key, ids); w, l, t, p = C.sign_test(x, y)
    return {"key": key, "boards": len(x), "wins": w, "losses": l, "ties": t, "p_one_sided": p}


def bands_of(r):
    return sorted({c["band"] for c in r["cases"]}, key=lambda s: int(s.split("-")[0]))


def hard_ids(r):
    return [c["id"] for c in r["cases"] if c["band"] in HARD]


def gate(new, champ, key="lenient_ok_forced"):
    out = {}
    for b in bands_of(new):
        ids = [c["id"] for c in new["cases"] if c["band"] == b]
        x, y = paired(new, champ, key, ids); out[b] = C.band_gate(x, y, b)
    return {"bands": out, "pass": all(v["pass"] for v in out.values())}


def sample_plan(s, full_text=None):
    """The lenient plan the forced verdict was scored on: (plan | None, known)."""
    if s.get("forced_text") is not None: return lenient(FORCE_SUFFIX + s["forced_text"]), True
    if full_text is not None: return lenient(full_text), True
    if "</think>" in s["raw_tail"]: return lenient(s["raw_tail"]), True
    return None, not s["had_think_close"]


def plan_stats(r, raw=None):
    """Format-bleed measures per band: short_plan (plan <= 8 moves on a board whose oracle needs > 8), plan_len/oracle_len."""
    texts = {}
    if raw:
        for c in raw["cases"]: texts[c["id"]] = [s.get("text") for s in c["samples"]]
    acc = collections.defaultdict(lambda: {"samples": 0, "planned": 0, "short_plan": 0, "eligible": 0, "unknown": 0, "ratios": [],
                                           "noplan_mismatch": 0})
    for c in r["cases"]:
        L = c.get("oracle_len"); tl = texts.get(c["id"]) or [None] * len(c["samples"])
        for s, ft in zip(c["samples"], tl):
            for b in (c["band"], "all"):
                a = acc[b]; a["samples"] += 1
            plan, known = sample_plan(s, ft)
            for b in (c["band"], "all"):
                a = acc[b]
                if not known: a["unknown"] += 1; continue
                a["noplan_mismatch"] += (plan is None) != (s["lenient_forced"] == "NOPLAN")
                if plan is None: continue
                a["planned"] += 1
                if L: a["ratios"].append(len(plan) / L)
                if L and L > SHORT_PLAN:
                    a["eligible"] += 1; a["short_plan"] += len(plan) <= SHORT_PLAN
    out = {}
    for b, a in acc.items():
        rs = a.pop("ratios")
        out[b] = {**a, "short_plan_frac_of_eligible_plans": round(a["short_plan"] / a["eligible"], 4) if a["eligible"] else None,
                  "median_plan_over_oracle_len": round(statistics.median(rs), 3) if rs else None}
    return {"source": "raw receipt texts" if raw else "raw_tail/forced_text", "by_band": dict(sorted(out.items()))}


def stats(r, raw=None):
    ss = [s for c in r["cases"] for s in c["samples"]]; n = len(ss)
    ill = sum(s["lenient_forced"].startswith("ILLEGAL") for s in ss); planned = sum(s["lenient_forced"] != "NOPLAN" for s in ss)
    return {**{k: sum(c[k] for c in r["cases"]) for k in KEYS}, "of": n, "forcing_complete": r.get("forcing_complete", False),
            "truncated": sum(s["finish"] == "length" for s in ss), "forced": sum(s["forced_text"] is not None for s in ss),
            "lenient_rescued": sum(s["lenient_raw"] != "OK" and s["lenient_forced"] == "OK" for s in ss),
            "lenient_lost": sum(s["lenient_raw"] == "OK" and s["lenient_forced"] != "OK" for s in ss),
            "illegal_rate_forced": round(ill / max(1, n), 4), "illegal_rate_of_planned": round(ill / max(1, planned), 4),
            "noplan_forced": n - planned, "mean_tokens": round(sum(s["tokens"] for s in ss) / max(1, n), 1),
            "per_band": {b: {k: sum(c[k] for c in r["cases"] if c["band"] == b) for k in ("lenient_ok_forced", "strict_ok_forced")}
                         | {"mean_tokens": round(statistics.mean([s["tokens"] for c in r["cases"] if c["band"] == b for s in c["samples"]]), 1)}
                         for b in bands_of(r)},
            "plans": plan_stats(r, raw)}


def interactive(out, ids):
    R = {}
    for a in ARMS:
        p = os.path.join(out, f"wm_interactive_v8i_{a}.json")
        if os.path.exists(p):
            r = json.load(open(p))
            if r.get("stage") == "final": R[a] = r
    if not R: return None
    why = []
    if len({r["set_sha256"] for r in R.values()}) != 1: why.append("set_sha256")
    for k in ("config", "code_sha256", "n_samples"):
        if len({json.dumps(r.get(k), sort_keys=True) for r in R.values()}) != 1: why.append(k)
    if any(list(r["totals"]["per_board_solved"]) != ids for r in R.values()): why.append("board ids/order vs the single-shot set")
    S = {}
    for a, r in R.items():
        t = r["totals"]
        S[a] = {"solved": t["solved"], "episodes": t["episodes"], "boards_any": t["boards_any_solved"], "per_band": t["per_band"],
                "turns": t["turns"], "illegal_per_turn": round(t["illegal"] / max(1, t["turns"]), 4),
                "truncated_turn_rate": round(t["truncated_turns"] / max(1, t["turns"]), 4), "committed_turns": t["committed_turns"],
                "solves_per_1M_gen_tokens": t["solves_per_1M_gen_tokens"], "end_reasons": t["end_reasons"],
                "code_sha256": r.get("code_sha256")}
    if why:
        return {"verdict": "NOT_COMPARABLE", "differs_in": why, "stats": S, "tests": {}}
    tests = {}
    for a, b in (("v8", "base"), ("v8", "v7"), ("v7", "base")):
        if a in R and b in R:
            x = [R[a]["totals"]["per_board_solved"][i] for i in ids]; y = [R[b]["totals"]["per_board_solved"][i] for i in ids]
            w, l, t_, p = C.sign_test(x, y); tests[f"{a}>{b}"] = {"wins": w, "losses": l, "ties": t_, "p_one_sided": p}
    return {"verdict": "COMPARABLE", "stats": S, "tests": tests, "set_sha256": next(iter(R.values()))["set_sha256"]}


def decide(R, S):
    """PRIMARY / CO-PRIMARY / GATE / PROMOTE from final receipts R and their stats S (arms may be missing)."""
    fc = lambda *arms: all(a in R and S[a]["forcing_complete"] for a in arms)
    if "v8" in R and "base" in R:
        t = sign(R["v8"], R["base"])
        t["verdict"] = ("PASS" if t["p_one_sided"] <= ALPHA else "FAIL") if fc("v8", "base") else "NOT_EVALUABLE (forced pass failed)"
    else:
        t = {"verdict": "NOT_EVALUABLE (missing v8 or base receipt)"}
    if fc("v8", "v7"):
        cp = sign(R["v8"], R["v7"], ids=hard_ids(R["v8"])); cp["bands"] = list(HARD)
        cp["verdict"] = "PASS" if cp["p_one_sided"] <= ALPHA else "FAIL"
        g = gate(R["v8"], R["v7"]); g["verdict"] = "PASS" if g["pass"] else "FAIL"
    else:
        cp = {"verdict": "NOT_EVALUABLE (missing or forcing-incomplete v7/v8 receipt)"}
        g = {"verdict": "NOT_EVALUABLE (missing or forcing-incomplete v7/v8 receipt)", "pass": None}
    promote = t.get("verdict") == "PASS" and cp.get("verdict") == "PASS" and g.get("verdict") == "PASS"
    return t, cp, g, bool(promote)


def analyze(out, holdout_sha=None):
    R, RAW = {}, {}
    for a in ARMS:
        p = os.path.join(out, f"v8_eval_{a}.json")
        if os.path.exists(p): R[a] = json.load(open(p))
        rp = os.path.join(out, f"v8_eval_{a}.raw.json")
        if a in R and os.path.exists(rp): RAW[a] = json.load(open(rp))
    assert R, "no v8_eval receipts"
    shas = {r["holdout_sha256"] for r in R.values()}; idsets = {tuple(c["id"] for c in r["cases"]) for r in R.values()}
    assert len(shas) == 1 and len(idsets) == 1, "receipts are not on the same sealed set"
    if holdout_sha: assert shas == {holdout_sha}, f"holdout sha {shas} != preregistered {holdout_sha}"
    for a, r in R.items():
        assert r["tag"] == a and r.get("stage") == "final" and r["holdout"] == "holdout_v8.json", f"{a}: not a final v8_eval receipt"
    for k in ("sampling", "forcing", "code_sha256"):
        assert len({json.dumps(r[k], sort_keys=True) for r in R.values()}) == 1, f"receipts differ in {k}"
    for a, raw in RAW.items():
        assert [c["id"] for c in raw["cases"]] == [c["id"] for c in R[a]["cases"]], f"{a}: raw receipt board order differs"
    S = {a: stats(r, RAW.get(a)) for a, r in R.items()}
    for a, s in S.items(): assert s["lenient_lost"] == 0, f"{a}: forcing lowered a verdict"
    res = {"holdout_sha256": shas.pop(), "stats": S, "rules": "v8_PREREG section 6 (hard-band point gate + hard-board co-primary)"}
    res["PRIMARY_v8_gt_base"], res["CO_PRIMARY_v8_gt_v7_hard"], res["GATE_band_guard_vs_v7"], res["PROMOTE_v8"] = decide(R, S)
    sec = {}
    for a, b in (("v8", "v7"), ("v7", "base"), ("v8", "base")):
        if a in R and b in R:
            for key in ("lenient_ok_forced", "strict_ok_forced", "lenient_ok_raw"):
                if (a, b, key) == ("v8", "base", "lenient_ok_forced"): continue
                sec[f"{a}>{b}:{key}"] = sign(R[a], R[b], key)
            sec[f"{a}>{b}:lenient_ok_forced:hard_boards"] = sign(R[a], R[b], ids=hard_ids(R[a]))
    if "v8" in R and "base" in R: sec["band_guard_v8_vs_base"] = gate(R["v8"], R["base"])
    res["secondary"] = sec
    res["interactive"] = interactive(out, [c["id"] for c in next(iter(R.values()))["cases"]])
    return res


def main():
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    hs = sys.argv[sys.argv.index("--holdout-sha") + 1] if "--holdout-sha" in sys.argv else None
    jout = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
    a = [x for x in a if x not in (hs, jout)]
    res = analyze(a[0], hs)
    S = res["stats"]
    for k, s in S.items():
        pa = s["plans"]["by_band"].get("all", {})
        print(f"{k:>5} lenient raw/forced {s['lenient_ok_raw']}/{s['lenient_ok_forced']} strict {s['strict_ok_raw']}/{s['strict_ok_forced']} of {s['of']} "
              f"trunc {s['truncated']} illegal {100 * s['illegal_rate_forced']:.1f}% tok {s['mean_tokens']} short_plan {pa.get('short_plan')}/{pa.get('eligible')} "
              f"plan/oracle {pa.get('median_plan_over_oracle_len')} bands " + " ".join(f"{b}:{v['lenient_ok_forced']}" for b, v in s["per_band"].items()))
    p = res["PRIMARY_v8_gt_base"]
    print("PRIMARY v8>base lenient_ok_forced:", p.get("wins"), "-", p.get("losses"), "p=%s" % p.get("p_one_sided"), "->", p["verdict"])
    cp = res["CO_PRIMARY_v8_gt_v7_hard"]
    print("CO-PRIMARY v8>v7 hard boards:", cp.get("wins"), "-", cp.get("losses"), "p=%s" % cp.get("p_one_sided"), "->", cp["verdict"])
    g = res["GATE_band_guard_vs_v7"]
    for b, v in (g.get("bands") or {}).items():
        print(f"  GATE {b}: D={v['D']} rule[{v['rule']}] margin={v['margin']} ({v['sum_new']} vs {v['sum_champ']}) -> {'pass' if v['pass'] else 'FAIL'}")
    print("GATE:", g["verdict"], "| PROMOTE v8:", res["PROMOTE_v8"])
    if res["interactive"]:
        print("  [interactive]", res["interactive"]["verdict"], res["interactive"].get("differs_in", ""))
        for k, v in res["interactive"]["stats"].items(): print(f"  [interactive] {k}: solved {v['solved']}/{v['episodes']} illegal/turn {v['illegal_per_turn']}")
        for k, v in res["interactive"]["tests"].items(): print(f"  [interactive] {k}: +{v['wins']} -{v['losses']} p={v['p_one_sided']:.3g}")
    if jout:
        with open(jout + ".tmp", "w") as f: json.dump(res, f, indent=1)
        os.replace(jout + ".tmp", jout)


if __name__ == "__main__":
    main()
