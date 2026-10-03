"""wm_PREREG.md analysis (Mac or box; pure python). Reads receipts from OUT and prints/writes OUT/wm_analysis.json.
Usage: python wm_analyze.py OUT [INTER_TAG NORET_TAG RET_TAG [EXTRA_TAG]]
Defaults: base_n2 (wm_interactive --commit-on-truncate) / base_noret_n2 + base_ret_n2 (wm_retrieval_eval) /
          base_wmmax_n2 (wm_interactive --commit-on-truncate --notes; exploratory).
Evidence class of everything here: EXPLORATORY (holdout128 has been evaluated many times; see wm_PREREG.md section 4).
Decision rules (wm_PREREG.md section 3; one-sided exact sign test over boards, paired by id, ties dropped):
  H-WM1 (co-primary): SUPPORTED iff BOTH (a) interactive solved episodes > single-shot lenient-OK samples, p <= 0.05, and
        (b) the tokens-matched version (an episode counts only if solved within <= 16384 cumulative generated tokens),
        p <= 0.05. (a) alone is reported as a compute-unmatched gain, never as SUPPORTED.
  H-WM2: SUPPORTED iff retrieval lenient-OK > no-retrieval lenient-OK, p <= 0.05.
Only H-WM1 and H-WM2 carry a verdict. Every other comparison carries a bare p-value (secondary or exploratory).
Decisions are uncorrected (exploratory, hypothesis-generating); Holm-adjusted p-values over {H-WM1, H-WM2, WMMAX vs NORET}
are reported alongside.
Comparability asserts (any failure -> exception -> NOT EVALUABLE): stage final, same set sha256, same n, same case order,
identical retrieval sampling config, the interactive configs the prereg names, one prereg sha across receipts."""
import json, os, random, sys

from wm_common import sign_test, holm, solved_at_prefix, write_json

EVIDENCE = ("EXPLORATORY: holdout128 reused (CONFIRM-1/2, FORCED-1, posthoc); hypothesis-generating only; not a finding until "
            "confirmed on a fresh sealed set under a new preregistration")
ALPHA, BOOT, BOOT_SEED, MATCH_TOKENS = 0.05, 2000, 20261011, 16384
EXPECT = {"interactive": {"commit_on_truncate": True, "notes": False}, "extra": {"commit_on_truncate": True, "notes": True}}


def _load(path):
    return json.load(open(path)) if os.path.exists(path) else None


def paired(xmap, ymap, ids, band, label):
    """Bare paired sign test (no verdict key)."""
    xs = [xmap[i] for i in ids]; ys = [ymap[i] for i in ids]
    w, l, p = sign_test(xs, ys)
    by_band = {}
    for b in sorted({band[i] for i in ids if band[i]}):
        bi = [i for i in ids if band[i] == b]
        bw, bl, bp = sign_test([xmap[i] for i in bi], [ymap[i] for i in bi])
        by_band[b] = {"x": sum(xmap[i] for i in bi), "y": sum(ymap[i] for i in bi), "wins": bw, "losses": bl, "p_one_sided": round(bp, 6)}
    return {"label": label, "boards": len(ids), "wins": w, "losses": l, "ties": len(ids) - w - l, "p_one_sided": round(p, 6),
            "x_total": sum(xs), "y_total": sum(ys), "by_band": by_band}


def efficiency(per_board, ids, prompt_tokens=None):
    """per_board: id -> (solves, generated tokens). Point estimate + 95% bootstrap CI over boards (fixed seed)."""
    S = sum(per_board[i][0] for i in ids); T = sum(per_board[i][1] for i in ids)
    rng = random.Random(BOOT_SEED); reps = []
    for _ in range(BOOT):
        smp = [rng.choice(ids) for _ in ids]
        t = sum(per_board[i][1] for i in smp)
        reps.append(1e6 * sum(per_board[i][0] for i in smp) / t if t else 0.0)
    reps.sort()
    return {"solves": S, "gen_tokens": T, "prompt_tokens": prompt_tokens, "solves_per_1M_gen_tokens": round(1e6 * S / T, 3) if T else None,
            "ci95_boot_boards": [round(reps[int(0.025 * BOOT)], 3), round(reps[int(0.975 * BOOT) - 1], 3)],
            "gen_tokens_per_solve": round(T / S) if S else None}


def check_interactive(arm, N, ids, role):
    assert arm["stage"] == "final", f"{role}: stage {arm['stage']}"
    assert arm["set_sha256"] == N["set_sha256"] and arm["n_samples"] == N["n_samples"], f"{role}: set/n mismatch"
    assert list(arm["totals"]["per_board_solved"]) == ids, f"{role}: case order mismatch"
    for k, v in EXPECT[role].items():
        assert arm["config"][k] == v, f"{role}: config {k} != {v}"


def within_map(arm, ids):
    m = {i: 0 for i in ids}
    for e in arm["episodes"]:
        m[e["id"]] += int(bool(e["solved"]) and e["gen_tokens_at_solve"] is not None and e["gen_tokens_at_solve"] <= MATCH_TOKENS)
    return m


def inter_eff(arm, ids):
    pb = {i: [0, 0] for i in ids}
    for e in arm["episodes"]:
        pb[e["id"]][0] += int(e["solved"]); pb[e["id"]][1] += e["gen_tokens"]
    return efficiency({i: tuple(v) for i, v in pb.items()}, ids, arm["totals"]["prompt_tokens"])


def ss_eff(R, ids):
    pb = {c["id"]: (c["lenient_ok"], sum(s["tokens"] for s in c["samples"])) for c in R["cases"]}
    return efficiency(pb, ids, R["totals"].get("prompt_tokens"))


def process(arm):
    t = arm["totals"]; n = max(1, t["turns"])
    return {"episodes": t["episodes"], "turns": t["turns"], "end_reasons": t["end_reasons"], "illegal_turns": t["illegal"],
            "truncated_turns": t["truncated_turns"], "truncated_rate": round(t["truncated_turns"] / n, 3),
            "think_closed_turns": t["think_closed_turns"], "think_closed_rate": round(t["think_closed_turns"] / n, 3),
            "committed_turns": t["committed_turns"], "committed_rate": round(t["committed_turns"] / n, 3),
            "strict_format_turns": t["strict_format_turns"], "strict_format_rate": round(t["strict_format_turns"] / n, 3),
            "no_move_json_turns": t.get("no_move_json_turns"), "note_unreadable_turns": t.get("note_unreadable_turns"),
            "clipped": t["clipped"], "resets": t["resets"]}


def analyze(out, inter="base_n2", noret="base_noret_n2", ret="base_ret_n2", extra="base_wmmax_n2"):
    I = _load(os.path.join(out, f"wm_interactive_{inter}.json"))
    N = _load(os.path.join(out, f"wm_retrieval_{noret}.json"))
    R = _load(os.path.join(out, f"wm_retrieval_{ret}.json"))
    X = _load(os.path.join(out, f"wm_interactive_{extra}.json"))
    rep = {"evidence_class": EVIDENCE,
           "receipts": {"interactive": bool(I), "noret": bool(N), "ret": bool(R), "extra": bool(X),
                        "interactive_incomplete_jsonl": os.path.exists(os.path.join(out, f"wm_interactive_{inter}.turns.jsonl")) and not I},
           "tags": {"interactive": inter, "noret": noret, "ret": ret, "extra": extra}}
    if N is None:
        rep["status"] = "NOT EVALUABLE (no-retrieval comparator missing)"; return rep
    assert N["mode"] == "none" and N["stage"] == "final"
    shas = {r.get("prereg_sha256") for r in (I, N, R, X) if r is not None}
    assert len(shas) == 1, f"receipts carry different prereg sha256 values {shas}"
    rep["prereg_sha256"] = shas.pop()
    ids = [c["id"] for c in N["cases"]]
    ny = {c["id"]: c["lenient_ok"] for c in N["cases"]}
    band = {c["id"]: c.get("band") for c in N["cases"]}
    # the interactive harness stops at the solving move; the same any-prefix rule applied to the single-shot plans
    nprefix = {c["id"]: sum(solved_at_prefix(c["board"], s["plan"]) for s in c["samples"]) for c in N["cases"]}
    rep["noret_totals"] = N["totals"]
    rep["noret_prefix_rescored"] = {"lenient_ok": sum(ny.values()), "solved_at_any_prefix": sum(nprefix.values()),
                                    "extra_from_prefix_rule": sum(nprefix.values()) - sum(ny.values())}
    eff = {"noret": ss_eff(N, ids)}; proc = {}; pvals = {}

    if I is None:
        rep["H-WM1"] = "NOT EVALUABLE (receipt missing)"
    else:
        check_interactive(I, N, ids, "interactive")
        pb = I["totals"]["per_board_solved"]
        u = paired(pb, ny, ids, band, f"interactive[{inter}] solved episodes vs single-shot lenient-OK samples (compute-unmatched)")
        m = paired(within_map(I, ids), ny, ids, band, f"interactive[{inter}] solved within <= {MATCH_TOKENS} generated tokens vs single-shot lenient-OK")
        ok = u["p_one_sided"] <= ALPHA and m["p_one_sided"] <= ALPHA
        rep["H-WM1"] = {"verdict": "SUPPORTED" if ok else "NOT SUPPORTED",
                        "rule": "co-primary: unmatched p <= 0.05 AND tokens-matched p <= 0.05",
                        "p_decision": max(u["p_one_sided"], m["p_one_sided"]), "unmatched": u, "tokens_matched": m,
                        "note": ("compute-unmatched gain only (tokens-matched p > 0.05)" if u["p_one_sided"] <= ALPHA and not ok else None)}
        pvals["H-WM1"] = rep["H-WM1"]["p_decision"]
        rep["H-WM1_prefix_scored_SECONDARY"] = paired(pb, nprefix, ids, band, "interactive solved vs single-shot solved-at-any-prefix (same scoring rule)")
        eff["interactive"] = inter_eff(I, ids); proc["interactive"] = process(I)

    if R is None:
        rep["H-WM2"] = "NOT EVALUABLE (receipt missing)"
    else:
        assert R["mode"] == "retrieval" and R["stage"] == "final" and R["set_sha256"] == N["set_sha256"] and R["sampling"] == N["sampling"], \
            "retrieval receipts not comparable"
        assert [c["id"] for c in R["cases"]] == ids
        assert [[s["seed"] for s in c["samples"]] for c in R["cases"]] == [[s["seed"] for s in c["samples"]] for c in N["cases"]], "seeds differ"
        t = paired({c["id"]: c["lenient_ok"] for c in R["cases"]}, ny, ids, band, "retrieval lenient-OK vs no-retrieval lenient-OK")
        rep["H-WM2"] = {"verdict": "SUPPORTED" if t["p_one_sided"] <= ALPHA else "NOT SUPPORTED", "rule": "p <= 0.05", **t}
        pvals["H-WM2"] = t["p_one_sided"]
        rep["H-WM2_strict_SECONDARY"] = paired({c["id"]: c["strict_ok"] for c in R["cases"]}, {c["id"]: c["strict_ok"] for c in N["cases"]},
                                               ids, band, "retrieval strict-OK vs no-retrieval strict-OK")
        rep["ret_totals"] = R["totals"]; eff["ret"] = ss_eff(R, ids)

    if X is None:
        rep["EXTRA_WMMAX_vs_NORET_EXPLORATORY"] = "NOT EVALUABLE (receipt missing)"
    else:
        check_interactive(X, N, ids, "extra")
        xpb = X["totals"]["per_board_solved"]
        t = paired(xpb, ny, ids, band, f"wmmax[{extra}] solved vs single-shot lenient-OK (compute-unmatched)")
        rep["EXTRA_WMMAX_vs_NORET_EXPLORATORY"] = {**t, "tokens_matched": paired(within_map(X, ids), ny, ids, band, "wmmax solved within 16384 tokens vs single-shot")}
        pvals["WMMAX_vs_NORET"] = t["p_one_sided"]
        if I is not None:
            rep["EXTRA_WMMAX_vs_INTERACTIVE_EXPLORATORY"] = paired(xpb, I["totals"]["per_board_solved"], ids, band,
                                                                   "wmmax (commit + notes) vs interactive (commit): the notes effect")
        eff["wmmax"] = inter_eff(X, ids); proc["wmmax"] = process(X)

    rep["efficiency_SECONDARY"] = eff
    rep["interactive_process_SECONDARY"] = proc
    rep["multiplicity"] = {"decisions": "uncorrected (exploratory)", "holm_adjusted_p": holm(pvals) if pvals else {}, "raw_p": pvals}
    return rep


def headline(rep):
    h = {}
    for k in ("H-WM1", "H-WM2"):
        v = rep.get(k)
        if isinstance(v, dict) and k == "H-WM1":
            h[k] = [v["verdict"], v["unmatched"]["wins"], v["unmatched"]["losses"], v["unmatched"]["p_one_sided"], v["tokens_matched"]["p_one_sided"]]
        elif isinstance(v, dict):
            h[k] = [v["verdict"], v["wins"], v["losses"], v["p_one_sided"]]
        else:
            h[k] = v
    for k in ("EXTRA_WMMAX_vs_NORET_EXPLORATORY", "EXTRA_WMMAX_vs_INTERACTIVE_EXPLORATORY"):
        v = rep.get(k)
        if v is not None:
            h[k] = [v["wins"], v["losses"], v["p_one_sided"]] if isinstance(v, dict) else v
    h["evidence_class"] = "EXPLORATORY"
    return h


if __name__ == "__main__":
    out = sys.argv[1]; tags = sys.argv[2:]
    rep = analyze(out, *tags)
    write_json(os.path.join(out, "wm_analysis.json"), rep)
    print("WM_ANALYSIS", json.dumps(headline(rep)), flush=True)
