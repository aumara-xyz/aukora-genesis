# -*- coding: utf-8 -*-
"""THE ZETA HARP fixture generator (Gate 2 of docs/zeta-harp/VALIDATION_PLAN.md).

mpmath at 80 working digits. Emits, per window: samples of t, theta, theta',
N, M, C0, Z_ref, R_ref; zeros refined inside a declared subwindow with the
Riemann-von Mangoldt completeness check recorded beside the count; Z' at
each refined zero; per-term tables where the plan asks. theta' is analytic
(theta'(t) = Re(digamma(1/4 + it/2))/2 - log(pi)/2), verified against the
numerical derivative before this script was trusted.

The five windows cost very different amounts (siegelz grows like sqrt(t)),
so the script takes window names as arguments and writes one part file per
invocation; merge with: python scripts/harpFixtures.py merge

Run:
    python scripts/harpFixtures.py W1 W2 W3
    python scripts/harpFixtures.py W4
    python scripts/harpFixtures.py W5
    python scripts/harpFixtures.py merge
"""
import json, hashlib, sys, time, glob, os
from mpmath import (mp, mpf, mpc, pi, log, sqrt, cos, floor, frac,
                    findroot, siegelz, siegeltheta, digamma)

mp.dps = 80
TAU = 2 * pi

def N_of(t):
    return int(floor(sqrt(mpf(t) / TAU)))

def thetap_of(t):
    return digamma(mpc(mpf(1) / 4, mpf(t) / 2)).real / 2 - log(pi) / 2

def main_sum(t, th=None):
    t = mpf(t)
    th = siegeltheta(t) if th is None else th
    s = mpf(0)
    for n in range(1, N_of(t) + 1):
        s += 2 * cos(th - t * log(n)) / sqrt(n)
    return s

def C0_of(t):
    t = mpf(t)
    p = frac(sqrt(t / TAU))
    psi = cos(2 * pi * (p * p - p - mpf(1) / 16)) / cos(2 * pi * p)
    return (-1) ** (N_of(t) - 1) * (t / TAU) ** mpf(-0.25) * psi

def rvm(T):
    T = mpf(T)
    return float(T / TAU * log(T / (TAU * mp.e)) + mpf(7) / 8)

def sample(t):
    t = mpf(t)
    th = siegeltheta(t)
    M = main_sum(t, th)
    Z = siegelz(t)
    return {"t": float(t), "theta": float(th), "thetap": float(thetap_of(t)),
            "N": N_of(t), "M": float(M), "C0": float(C0_of(t)),
            "Z": float(Z), "R": float(Z - M)}

def refine_zeros(z0, z1, step, cap=None):
    """Bracket by sign scan at `step`, refine by ridder, derivative by
    central difference; completeness recorded against Riemann-von Mangoldt."""
    zeros = []
    t, prev = mpf(z0), siegelz(z0)
    while t < z1 and (cap is None or len(zeros) < cap):
        nxt = t + step
        cur = siegelz(nxt)
        if (prev < 0) != (cur < 0):
            # hand-rolled hybrid: twenty bisections to a tight bracket, then
            # five secant steps. mpmath's own solvers stalled twice at height
            # (ridder then bisect+secant, W4, 2026-08-03, failures recorded);
            # this loop is under our control and costs ~25 evaluations.
            a, b, fa, fb = t, nxt, prev, cur
            for _ in range(20):
                m = (a + b) / 2
                fm = siegelz(m)
                if (fm < 0) == (fa < 0):
                    a, fa = m, fm
                else:
                    b, fb = m, fm
            x0, x1, f0, f1 = a, b, fa, fb
            for _ in range(5):
                if f1 == f0:
                    break
                x2 = x1 - f1 * (x1 - x0) / (f1 - f0)
                x0, f0, x1, f1 = x1, f1, x2, siegelz(x2)
            g = x1
            h = mpf(10) ** (-6)
            zp = (siegelz(g + h) - siegelz(g - h)) / (2 * h)
            zeros.append({"gamma": float(g), "Zp": float(zp)})
        t, prev = nxt, cur
    return zeros

WINDOWS = {
    # name: (t0, t1, n_samples, zero-subwindow (z0, z1, scan step, cap))
    "W1": (100, 160, 121, (100, 160, mpf("0.2"), None)),
    "W2": (9990, 10010, 41, (9990, 10010, mpf("0.3"), None)),
    "W3": (float(TAU * 676) + 1e-6, float(TAU * 729) - 1e-9, 65,   # start nudged off the half-open boundary: floor(sqrt(t/2pi)) is not double-stable exactly at 2 pi 676, and a sample must not sit on the knife edge the window26 block already checks exactly
           (4400, 4412, mpf("0.3"), None)),
    "W4": (999990, 1000010, 41, (999998, 1000002, mpf("0.2"), None)),
    "W5": (100000000, 100000005, 9, (100000000, 100000002, mpf("0.15"), 2)),
}

def build(name):
    t0, t1, ns, (z0, z1, zstep, cap) = WINDOWS[name]
    tic = time.time()
    ts = [mpf(t0) + (mpf(t1) - mpf(t0)) * i / (ns - 1) for i in range(ns)]
    samples = [sample(t) for t in ts]
    zeros = refine_zeros(z0, z1, zstep, cap)
    expected = rvm(z1) - rvm(z0)
    print(f"  {name}: {ns} samples, {len(zeros)} zeros refined in "
          f"[{z0}, {z1}] against {expected:.3f} expected (RvM), "
          f"{time.time()-tic:.1f}s", flush=True)
    return {"name": name, "t0": float(t0), "t1": float(t1), "samples": samples,
            "zeroSubwindow": {"z0": float(z0), "z1": float(z1)},
            "zeros": zeros, "zerosExpectedRvM": expected}

def term_table(t, upto=None):
    t = mpf(t)
    th = siegeltheta(t)
    N = N_of(t)
    rows = [{"n": n, "a": float(2 / sqrt(n)), "phi": float(th - t * log(n))}
            for n in range(1, min(N, upto or N) + 1)]
    return {"t": float(t), "N": N, "terms": rows}

def extras():
    W26_LO, W26_HI = TAU * 676, TAU * 729
    gq, g3q = TAU * mpf("26.25") ** 2, TAU * mpf("26.75") ** 2
    return {
        "window26": {"lo": float(W26_LO), "hi": float(W26_HI),
                     "N_below": N_of(W26_LO - mpf(10) ** -9),
                     "N_at_lo": N_of(W26_LO), "N_at_hi": N_of(W26_HI)},
        "termTables": [term_table(130),
                       term_table((W26_LO + W26_HI) / 2),
                       term_table(1000000, upto=398)],
        "psiGuards": {
            "quarter": {"t": float(gq),
                        "near": [{"t": float(gq + d), "C0": float(C0_of(gq + d))}
                                 for d in (mpf("-0.001"), mpf("0.001"))]},
            "threeQuarter": {"t": float(g3q),
                             "near": [{"t": float(g3q + d), "C0": float(C0_of(g3q + d))}
                                      for d in (mpf("-0.001"), mpf("0.001"))]}},
    }

def merge():
    parts = {}
    for f in glob.glob("spatial/app/harp-fixtures-part-*.json"):
        with open(f) as fh:
            parts.update(json.load(fh))
    fixtures = {"meta": {"generator": "scripts/harpFixtures.py", "dps": 80,
                         "date": "2026-08-03"},
                "windows": [parts[w] for w in ("W1", "W2", "W3", "W4", "W5")
                            if w in parts]}
    fixtures.update(extras())
    if len(fixtures["windows"]) != 5:
        raise SystemExit("merge refused: " + str(len(fixtures["windows"]))
                         + " of 5 windows present; regenerate the missing parts")
    out = json.dumps(fixtures)
    with open("spatial/app/harp-fixtures.json", "w") as fh:
        fh.write(out)
    # parts are kept: they are cheap to hold and expensive to lose, as the
    # first merge proved by deleting them and orphaning a partial rebuild
    print("wrote spatial/app/harp-fixtures.json", len(out), "bytes")
    print("sha256:", hashlib.sha256(out.encode()).hexdigest())

if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["merge"]:
        merge()
    else:
        print("harp fixtures: dps =", mp.dps, "windows:", args, flush=True)
        part = {}
        for name in args:
            part[name] = build(name)
        fn = "spatial/app/harp-fixtures-part-" + "-".join(args) + ".json"
        with open(fn, "w") as fh:
            json.dump(part, fh)
        print("part written:", fn, flush=True)
