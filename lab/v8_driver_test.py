"""Mac CONTROL-FLOW test of v8_run.sh + v8_eval.sh (no GPU, no vLLM, no real model). The REAL shell scripts run in a scratch
root (V8_ROOT/V8_SHM/V8_MODEL test overrides) with:
  - a SIMULATED CLOCK: shims for `date` (GNU-style +%s, -u, -d @N) and `sleep` (advances the clock file, never sleeps);
  - shims for nvidia-smi (busy while simulated time < a 'gpu busy until' value, or always if a flag file exists), pgrep
    (never matches: the BUSY_RE path is covered by nvidia-smi), df (GNU -BG output);
  - stub python executables for .vllm/bin and .venv/bin: every stage script is a stub that checks its arguments, refuses to
    overwrite receipts like the real scripts, writes the receipts the driver looks for, advances the clock by a stage duration,
    logs each call, and can be told to fail (with or without leaving a receipt / turns log). `python -c` runs the real python.
Scenarios (each asserts the call sequence and outcome):
  happy     WAIT_FOR file appears later, GPU busy until later: DL is set at the first GPU_FREE (not at launch); every stage
            runs once in order; base single runs BEFORE training; --free-merged-v7 passed; DONE.
  resume    same root re-launched: every stage skipped (no stage stub called), DONE again.
  v7fail    v7 single fails twice without a receipt: v8_eval.sh retries once; base single still runs; then the driver dies
            before the v7 interactive eval and before training; merged_v7 kept; train never called.
  budget    GPU stays busy after collection: wait_gpu STOPs (exit 3) when the remaining chain no longer fits; then re-launched
            with the GPU free: collection is skipped (receipt), the run resumes at post and finishes.
  wmchange  wm_interactive.py changes after BUILD (another workflow copies a new one): interactive evals are skipped, the core
            path (single evals, train, analysis) still completes.
  nointer   V8_NO_INTER=1: no interactive eval runs.
  collectretry  collect fails once WITHOUT a turns log (engine start), then succeeds on the plain retry.
Usage: python3 v8_driver_test.py [SCRATCH_DIR]"""
import json, os, shutil, stat, subprocess, sys

LAB = os.path.dirname(os.path.abspath(__file__))
REAL_PY = sys.executable
HSHA = "538c87b9e80c51f33841025d8c44430f9c8d01dfd8a0a568798d2ae96f9a175c"
DUR = {"collect_i": 2400, "collect_s": 900, "post": 60, "build": 30, "eval_single": 1100, "inter": 1800, "train": 2700}

STUB = r'''
import json, os, sys, time
R = os.environ["V8T_ROOT"]; CLK = os.path.join(R, "clock"); LOG = os.path.join(R, "calls.jsonl"); FAIL = os.path.join(R, "fail")
DUR = json.loads(os.environ["V8T_DUR"])
def now(): return int(open(CLK).read().strip() or 0)
def adv(s):
    t = now() + s; open(CLK, "w").write(str(t))
def log(**k): open(LOG, "a").write(json.dumps({"t": now(), **k}) + "\n")
def failing(name):
    p = os.path.join(FAIL, name)
    if not os.path.exists(p): return None
    spec = open(p).read().split(); n = int(spec[0]); mode = spec[1] if len(spec) > 1 else "none"
    if n <= 0: return None
    open(p, "w").write(f"{n - 1} {mode}"); return mode
def W(p, obj): os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "w").write(json.dumps(obj))
a = sys.argv[1:]
if a and a[0] == "-c": os.execv(os.environ["V8T_REAL_PY"], [os.environ["V8T_REAL_PY"]] + a)
script = os.path.basename(a[0]); args = a[1:]
log(script=script, args=args)
if script in ("v8_collect.py", "v8_eval.py") and args[0] == "--preflight":
    assert not [f for f in os.listdir(args[1]) if f.startswith(("v8_", "wm_"))], "preflight dir must be empty"; sys.exit(0)
if script == "wm_interactive.py" and args[0] == "--preflight": sys.exit(0)
if script == "v8_collect.py":
    mode, rest = args[0], args[1:]
    if mode == "interactive":
        out = rest[1]; fin = f"{out}/wm_interactive_v8pool.json"; jl = f"{out}/wm_interactive_v8pool.turns.jsonl"
        assert not os.path.exists(fin)
        assert ("--resume" in rest) == os.path.exists(jl), ("resume flag must match the turns log", rest)
        f = failing("collect_i")
        if f == "log": open(jl, "a").write("{}\n"); adv(600); sys.exit(1)
        if f == "none": adv(60); sys.exit(1)
        open(jl, "a").write("{}\n"); W(fin, {"stage": "final"}); adv(DUR["collect_i"]); sys.exit(0)
    if mode == "single":
        p = f"{rest[1]}/v8_single.json"; assert not os.path.exists(p); W(p, {}); adv(DUR["collect_s"]); sys.exit(0)
    if mode == "post":
        out = rest[0]
        for f in ("v8_turns.jsonl", "v8_collect_summary.json"): assert not os.path.exists(f"{out}/{f}")
        assert os.path.exists(f"{out}/wm_interactive_v8pool.turns.jsonl")
        W(f"{out}/v8_turns.jsonl", {}); W(f"{out}/v8_collect_summary.json", {}); adv(DUR["post"]); sys.exit(0)
if script == "v8_build_data.py":
    out = args[0]; assert not os.path.exists(f"{out}/v8_data.json"); W(f"{out}/v8_data.json", {}); adv(DUR["build"])
    if os.path.exists(os.path.join(R, "mutate_wm_after_build")): open(os.path.join(R, "lab", "wm_interactive.py"), "a").write("# changed\n")
    sys.exit(0)
if script == "v8_train.py":
    shm = os.environ["V8_SHM"]
    if args[0] == "--preflight":
        out = args[1]
        for p in (f"{shm}/merged_v8", f"{out}/v8_adapter", f"{out}/v8_train.json"): assert not os.path.exists(p), p
        sys.exit(0)
    out, dl = args[0], int(args[1]); assert dl > now(), "train deadline already passed"
    for p in (f"{shm}/merged_v8", f"{out}/v8_adapter", f"{out}/v8_train.json"): assert not os.path.exists(p), p
    assert os.path.exists(f"{out}/v8_eval_v7.json") and os.path.exists(f"{out}/v8_eval_base.json"), "v7 + base single must precede train"
    os.makedirs(f"{out}/v8_adapter"); adv(DUR["train"])
    if "--free-merged-v7" in args and os.path.isdir(f"{shm}/merged_v7"):
        import shutil; shutil.rmtree(f"{shm}/merged_v7")
    W(f"{shm}/merged_v8/config.json", {}); W(f"{out}/v8_train.json", {"stage": "merged"}); sys.exit(0)
if script == "v8_eval.py":
    md, tag, out = args
    raw, fin = f"{out}/v8_eval_{tag}.raw.json", f"{out}/v8_eval_{tag}.json"
    if os.path.exists(raw) or os.path.exists(fin): sys.exit(1)                 # the real script refuses to overwrite
    assert os.path.exists(f"{md}/config.json"), f"no model at {md}"
    f = failing(f"eval_{tag}")
    if f == "none": adv(120); sys.exit(1)
    if f == "raw": W(raw, {"stage": "sampled"}); adv(900); sys.exit(1)
    W(raw, {"stage": "sampled"}); W(fin, {"stage": "final", "forcing_complete": True, "tag": tag}); adv(DUR["eval_single"]); sys.exit(0)
if script == "wm_interactive.py":
    md, tag, out = args[0], args[1], args[2]
    fin = f"{out}/wm_interactive_{tag}.json"; assert not os.path.exists(fin); W(fin, {"stage": "final"}); adv(DUR["inter"]); sys.exit(0)
if script == "v8_analyze.py":
    j = args[args.index("--json") + 1]; W(j, {"ok": True}); sys.exit(0)
raise SystemExit(f"stub: unexpected call {a}")
'''

SHIMS = {
    "date": r'''#!/bin/bash
off=$(cat "$V8T_ROOT/clock"); t=$off; utc=""; fmt="+%a %b %e %T %Z %Y"
while [ $# -gt 0 ]; do case "$1" in -u) utc=-u;; -d) t=${2#@}; shift;; +*) fmt="$1";; esac; shift; done
[ "$fmt" = "+%s" ] && { echo "$t"; exit 0; }
exec /bin/date $utc -r "$t" "$fmt"
''',
    "sleep": r'''#!/bin/bash
t=$(( $(cat "$V8T_ROOT/clock") + ${1%.*} )); echo $t > "$V8T_ROOT/clock"
if [ -n "${V8T_WAITFOR_AT:-}" ] && [ "$t" -ge "$V8T_WAITFOR_AT" ]; then touch "$V8T_ROOT/out/wm_DONE.json"; fi
''',
    "nvidia-smi": r'''#!/bin/bash
now=$(cat "$V8T_ROOT/clock"); until=$(cat "$V8T_ROOT/gpu_busy_until" 2>/dev/null || echo 0)
if [ -f "$V8T_ROOT/gpu_busy_forever" ] || [ "$now" -lt "$until" ]; then echo 4242; fi
exit 0
''',
    "pgrep": "#!/bin/bash\nexit 1\n",
    "df": "#!/bin/bash\necho Avail; echo ' 50G'\n",
}


def write_exec(p, text):
    with open(p, "w") as f: f.write(text)
    os.chmod(p, os.stat(p).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def make_root(base, name):
    R = os.path.join(base, name)
    if os.path.exists(R): shutil.rmtree(R)
    for d in ("lab", "out/v7_adapter", "shm/merged_v7", "model", "fail", "shim", ".vllm/bin", ".venv/bin", "tmp", "hf"):
        os.makedirs(os.path.join(R, d), exist_ok=True)
    for f in ("v8_run.sh", "v8_eval.sh", "holdout_v8.json"): shutil.copy(os.path.join(LAB, f), os.path.join(R, "lab", f))
    for f in ("v7_cp.json", "v8_pool.json", "holdout.json", "holdout_v7.json", "holdout_rep1.json", "holdout128.json", "v8_common.py"):
        open(os.path.join(R, "lab", f), "w").write("{}\n")
    open(os.path.join(R, "lab", "wm_interactive.py"), "w").write("# stub\n")
    man = subprocess.run(["shasum", "-a", "256", "v8_common.py", "wm_interactive.py", "holdout_v8.json"], cwd=os.path.join(R, "lab"),
                         capture_output=True, text=True, check=True).stdout
    open(os.path.join(R, "lab", "v8_manifest.sha256"), "w").write(man)
    for f in ("v5_corpus.json", "v7_train.json"): open(os.path.join(R, "out", f), "w").write("{}\n")
    open(os.path.join(R, "out", "v7_adapter", "adapter_model.safetensors"), "w").write("x")
    v6 = os.path.join(os.path.dirname(LAB), "pulled", "out", "v6_A.json"); shutil.copy(v6, os.path.join(R, "out", "v6_A.json"))
    for f in ("config.json", "model.safetensors.index.json"): open(os.path.join(R, "shm", "merged_v7", f), "w").write("{}")
    open(os.path.join(R, "model", "config.json"), "w").write("{}")
    open(os.path.join(R, "stub.py"), "w").write(STUB)
    for v in (".vllm/bin/python", ".venv/bin/python"):
        write_exec(os.path.join(R, v), f'#!/bin/bash\nexec "{REAL_PY}" "$V8T_ROOT/stub.py" "$@"\n')
    for k, t in SHIMS.items(): write_exec(os.path.join(R, "shim", k), t)
    open(os.path.join(R, "clock"), "w").write("1000000")
    return R


def run(R, budget, wait_for=True, env_extra=None):
    env = dict(os.environ, V8_ROOT=R, V8_SHM=os.path.join(R, "shm"), V8_MODEL=os.path.join(R, "model"), V8T_ROOT=R, V8T_REAL_PY=REAL_PY,
               V8T_DUR=json.dumps(DUR), PATH=os.path.join(R, "shim") + ":" + os.environ["PATH"])
    env.update(env_extra or {})
    args = ["bash", os.path.join(R, "lab", "v8_run.sh"), str(budget), HSHA] + ([os.path.join(R, "out", "wm_DONE.json")] if wait_for else [])
    p = subprocess.run(args, env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, p.stdout + p.stderr


def calls(R):
    p = os.path.join(R, "calls.jsonl")
    return [json.loads(l) for l in open(p)] if os.path.exists(p) else []


def stage_calls(R, since=0):
    out = []
    for c in calls(R)[since:]:
        s, a = c["script"], c["args"]
        if a and a[0] in ("--preflight", "-c"): continue
        if s == "v8_collect.py": out.append("collect_" + a[0])
        elif s == "v8_eval.py": out.append("eval_" + a[1])
        elif s == "wm_interactive.py": out.append("inter_" + a[1].replace("v8i_", ""))
        elif s == "v8_train.py": out.append("train" + ("+free" if "--free-merged-v7" in a else ""))
        elif s == "v8_build_data.py": out.append("build")
        elif s == "v8_analyze.py": out.append("analyze")
    return out


def lines(log, tag):
    return [l for l in log.splitlines() if l.startswith("V8_" + tag)]


def main():
    base = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(os.environ.get("TMPDIR", "/tmp"), "v8_driver_test")
    os.makedirs(base, exist_ok=True); res = {}
    t0 = 1000000
    full = ["collect_interactive", "collect_single", "collect_post", "build", "eval_v7", "eval_base", "inter_v7", "train+free",
            "eval_v8", "analyze", "inter_v8", "inter_base", "analyze"]

    # happy: wm_DONE appears at t0+3000; the GPU is busy until t0+5000 -> DL = first GPU_FREE + budget
    R = make_root(base, "happy"); open(os.path.join(R, "gpu_busy_until"), "w").write(str(t0 + 5000))
    rc, log = run(R, 30000, env_extra={"V8T_WAITFOR_AT": str(t0 + 3000)})
    sc = stage_calls(R)
    assert rc == 0 and sc == full, (rc, sc, log[-3000:])
    dl_line = lines(log, "DL_SET")[0]; first_collect = [c for c in calls(R) if c["script"] == "v8_collect.py" and c["args"][0] == "interactive"][0]
    st = json.load(open(os.path.join(R, "out", "v8_STATUS.json"))); dl = int(st["dl"])
    assert dl - 30000 >= t0 + 5000 and first_collect["t"] >= t0 + 5000, ("DL must start at the first GPU_FREE", dl, first_collect)
    assert not os.path.exists(os.path.join(R, "shm", "merged_v7")) and json.load(open(os.path.join(R, "out", "v8_DONE.json")))["final"]
    res["happy"] = {"rc": rc, "stages": sc, "dl_minus_budget_minus_t0": dl - 30000 - t0, "dl_line": dl_line[:80]}

    # resume: same root, everything skipped
    n0 = len(calls(R)); rc, log = run(R, 30000, env_extra={"V8T_WAITFOR_AT": str(t0)})
    sc = stage_calls(R, n0)
    assert rc == 0 and sc == ["analyze", "analyze"], (rc, sc, log[-2000:])
    res["resume"] = {"rc": rc, "stages": sc, "skips": len([l for l in log.splitlines() if "V8_SKIP" in l])}

    # v7fail: v7 single fails twice without a receipt -> one retry in v8_eval.sh, then die before training
    R = make_root(base, "v7fail"); open(os.path.join(R, "fail", "eval_v7"), "w").write("2 none")
    rc, log = run(R, 30000, wait_for=False)
    sc = stage_calls(R)
    assert rc == 1 and sc[:5] == ["collect_interactive", "collect_single", "collect_post", "build", "eval_v7"] and sc.count("eval_v7") == 2, (rc, sc)
    assert "eval_base" in sc and "inter_v7" not in sc and not any(s.startswith("train") for s in sc) and os.path.isdir(os.path.join(R, "shm", "merged_v7")), sc
    assert "v8_eval_v7.json missing" in log, log[-1500:]
    res["v7fail"] = {"rc": rc, "stages": sc, "merged_v7_kept": True}

    # budget: the GPU becomes busy forever right after collection -> wait_gpu STOPs (exit 3) once the chain no longer fits;
    # re-launched with the GPU free -> collection skipped (receipt), the run resumes and finishes
    core = ["collect_single", "collect_post", "build", "eval_v7", "eval_base", "train+free", "eval_v8", "analyze", "analyze"]
    R = make_root(base, "budget"); env = {"V8_NO_INTER": "1"}
    rc2, log2 = run_busy_after_collect(R, 14000, env)
    sc2 = stage_calls(R)
    assert rc2 == 3 and sc2 == ["collect_interactive"] and lines(log2, "STOP"), (rc2, sc2, log2[-1500:])
    assert json.load(open(os.path.join(R, "out", "v8_DONE.json")))["stages"].get("STOP")
    os.remove(os.path.join(R, "gpu_busy_forever"))
    n0 = len(calls(R)); rc3, log3 = run(R, 30000, wait_for=False, env_extra=env)
    sc3 = stage_calls(R, n0)
    assert rc3 == 0 and sc3 == core, (rc3, sc3, log3[-1500:])
    assert any("SKIP_COLLECT_I" in l for l in log3.splitlines())
    # core path fits a 15000 s budget (V8_NO_INTER=1)
    R = make_root(base, "core_budget"); rc1, log1 = run(R, 15000, wait_for=False, env_extra=env)
    sc1 = stage_calls(R); assert rc1 == 0 and sc1 == ["collect_interactive"] + core, (rc1, sc1, log1[-1500:])
    res["budget"] = {"first_run_rc": rc2, "first_run_stages": sc2, "stop_line": lines(log2, "STOP")[0][:120], "resume_rc": rc3,
                     "resume_stages": sc3, "core_only_budget_15000": {"rc": rc1, "stages": sc1}}

    # wmchange: wm_interactive.py changes after BUILD -> interactive skipped, core completes
    R = make_root(base, "wmchange"); open(os.path.join(R, "mutate_wm_after_build"), "w").write("1")
    rc, log = run(R, 30000, wait_for=False)
    sc = stage_calls(R)
    assert rc == 0 and sc == ["collect_interactive", "collect_single", "collect_post", "build", "eval_v7", "eval_base", "train+free", "eval_v8",
                              "analyze", "analyze"], (rc, sc, log[-1500:])
    assert sum("wm_* manifest mismatch" in l for l in log.splitlines()) == 3
    res["wmchange"] = {"rc": rc, "stages": sc}

    # nointer
    R = make_root(base, "nointer"); rc, log = run(R, 30000, wait_for=False, env_extra={"V8_NO_INTER": "1"})
    sc = stage_calls(R); assert rc == 0 and not any(s.startswith("inter_") for s in sc), sc
    res["nointer"] = {"rc": rc, "stages": sc}

    # collectretry: engine-start failure without a turns log, then success
    R = make_root(base, "collectretry"); open(os.path.join(R, "fail", "collect_i"), "w").write("1 none")
    rc, log = run(R, 30000, wait_for=False, env_extra={"V8_NO_INTER": "1"})
    sc = stage_calls(R); assert rc == 0 and sc.count("collect_interactive") == 2, (sc, log[-1500:])
    # and a crash WITH a turns log resumes with --resume (asserted inside the stub)
    R = make_root(base, "collectresume"); open(os.path.join(R, "fail", "collect_i"), "w").write("1 log")
    rc2, log2 = run(R, 30000, wait_for=False, env_extra={"V8_NO_INTER": "1"})
    sc2 = stage_calls(R); assert rc2 == 0 and sc2.count("collect_interactive") == 2, (sc2, log2[-1500:])
    res["collectretry"] = {"no_log": sc[:3], "with_log_resume": sc2[:3]}

    with open(os.path.join(base, "v8_driver_test_summary.json"), "w") as f: json.dump(res, f, indent=1)
    print("V8_DRIVER_TEST_OK", json.dumps({k: (v.get("rc"), v.get("stages")) if isinstance(v, dict) and "stages" in v else v for k, v in res.items()})[:1500])
    return res


def run_busy_after_collect(R, budget, env):
    """Run with a hook: the GPU becomes busy forever right after the interactive collection (simulates a job that grabbed it)."""
    stub = os.path.join(R, "stub.py"); s = open(stub).read()
    s = s.replace('open(jl, "a").write("{}\\n"); W(fin, {"stage": "final"}); adv(DUR["collect_i"]); sys.exit(0)',
                  'open(jl, "a").write("{}\\n"); W(fin, {"stage": "final"}); adv(DUR["collect_i"]); '
                  'open(os.path.join(R, "gpu_busy_forever"), "w").write("1"); sys.exit(0)')
    assert "gpu_busy_forever" in s
    open(stub, "w").write(s)
    try:
        return run(R, budget, wait_for=False, env_extra=env)
    finally:
        open(stub, "w").write(STUB)


if __name__ == "__main__":
    main()
