#!/bin/bash
# S1 box driver: H-S1b (EXPLORATORY), base Ornith on holdout128, n=4, arms A (plain) + B (1-ply Laya intuition block).
#   1 checks: holdout128 sha, s1_manifest.sha256 (s1 code + prereg + sealed s1_laya artifact + deps)
#   2 HINTS (CPU, training .venv, no GPU context): OUT/s1_hints_holdout128.json; skipped if it already exists
#     (s1_ornith_eval re-verifies it before generation)
#   3 waits until no other GPU job runs (no known driver/eval process AND an empty nvidia-smi compute-app list on 3
#     consecutive checks 30 s apart); it never kills anything
#   4 EVAL (vLLM .venv): chunked generation, OUT/s1_eval_base.partial.jsonl appended + fsynced after every chunk;
#     on a failure without a final receipt it waits for the GPU again and retries ONCE with --resume
# Receipts: OUT/s1_hints_holdout128.json, OUT/s1_eval_base.partial.jsonl, OUT/s1_eval_base.json, OUT/s1_eval_base.raw.json
# (never overwritten; the python scripts refuse). Expected ~40 min of H200 when the GPU is free (s1_PREREG.md).
# Launch (box): nohup bash /mnt/glm-data/aukora-run/lab/s1_run.sh > /mnt/glm-data/aukora-run/s1.log 2>&1 &
# Test overrides only (Mac dry run): S1_ROOT S1_OUT S1_T S1_V S1_MODEL S1_EXTRA (e.g. --mock).
set -u
R=${S1_ROOT:-/mnt/glm-data/aukora-run}
cd "$R/lab" || { echo "S1_FAIL cd $R/lab"; exit 1; }
OUT=${S1_OUT:-$R/out}; SET=holdout128.json; N=4; TAG=base
export HF_HOME=$R/hf TMPDIR=$R/tmp
mkdir -p "$TMPDIR" "$OUT"
T=${S1_T:-$R/.venv/bin}; V=${S1_V:-$R/.vllm/bin}
M=${S1_MODEL:-$R/hf/hub/models--ornith-ai--Ornith-1.5-35B-A3B/snapshots/10fbf86fed7ecee4a061f8b499a618f46001cac1}
H128=9dd07cd7774fc6937ff830165d83b08fdd011edb4c1ac897222cf058a6024e1b
BUSY_RE='wm_run.sh|wm_interactive.py|wm_retrieval_eval.py|rep1_eval.py|v8_|v7_run.sh|v7_eval.py|v7_train.py|rebuild_gen1.py|eval_sampled.py|eval_forced.py|confirm2_run.sh|confirm.py|posthoc_lenient.py|v6_run.sh|v5_run.sh|probe_vllm.py'
mk(){ echo "S1_$1 $(date -u +%FT%TZ) ${2:-}"; }
busy(){ pgrep -f "$BUSY_RE" >/dev/null || [ -n "$(nvidia-smi --query-compute-apps=pid --format=csv,noheader 2>/dev/null)" ]; }
wait_gpu(){ local free=0 n=0
            while [ $free -lt 3 ]; do
              if busy; then free=0; [ $((n % 20)) -eq 0 ] && mk WAIT_GPU "procs=[$(pgrep -af "$BUSY_RE" 2>/dev/null | cut -c1-120 | tr '\n' ';')]"; n=$((n + 1))
              else free=$((free + 1)); fi
              [ $free -lt 3 ] && sleep 30
            done; mk GPU_FREE; }

[ "$(sha256sum $SET | cut -d' ' -f1)" = "$H128" ] || { echo "S1_FAIL $SET sha256 mismatch"; exit 1; }
sha256sum --quiet -c s1_manifest.sha256 || { echo "S1_FAIL s1_manifest.sha256 mismatch"; exit 1; }
mk CHECKS_OK

if [ ! -f "$OUT/s1_hints_holdout128.json" ]; then
  mk HINTS
  CUDA_VISIBLE_DEVICES= PATH=$T:$PATH "$T/python" s1_ornith_eval.py --hints $SET "$OUT" || { echo "S1_FAIL hints"; exit 1; }
fi
mk HINTS_OK "$(sha256sum "$OUT/s1_hints_holdout128.json" | cut -d' ' -f1)"

RES=""; [ -f "$OUT/s1_eval_$TAG.partial.jsonl" ] && RES=--resume
for try in 1 2; do
  wait_gpu
  mk EVAL "try=$try $RES"
  PATH=$V:$PATH "$V/python" s1_ornith_eval.py "$M" $TAG "$OUT" $SET $N $RES ${S1_EXTRA:-} && { mk DONE; exit 0; }
  [ -f "$OUT/s1_eval_$TAG.json" ] && { mk FAIL_AFTER_RECEIPT; exit 1; }
  [ -f "$OUT/s1_eval_$TAG.partial.jsonl" ] && RES=--resume
done
mk FAIL "no final receipt after 2 tries; partial file (if any) is kept: rerun with --resume"
exit 1
