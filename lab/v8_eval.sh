#!/bin/bash
# v8 eval of ONE arm on the sealed holdout_v8.json (box). Called by v8_run.sh; can be run alone.
#   single       v8_eval.py  (= v7_eval protocol: n=4, T=0.6, 16384 thinking tokens, forced answer)  -> OUT/v8_eval_<ARM>.json   PRIMARY/GATE input
#   interactive  wm_interactive.py --commit-on-truncate, n=2, tag v8i_<ARM>                         -> OUT/wm_interactive_v8i_<ARM>.json  SECONDARY
# Usage: bash v8_eval.sh <ARM: v8|v7|base> <MODEL_DIR> <DL_epoch_s> [single|interactive|both]
# A stage starts only if its whole budget fits before DL. A stage whose final receipt exists is skipped (never overwritten).
# A single-shot run that fails WITHOUT leaving a raw or final receipt (e.g. engine start lost a GPU race / OOM) is retried
# once after the GPU is free again (3 consecutive empty nvidia-smi checks 30 s apart) if its budget still fits; a failure that
# left a receipt is never re-run (v8_eval.py refuses; that needs an AMENDMENTS entry).
# An interactive stage whose turns.jsonl exists (crash) is continued with --resume (wm_interactive replays the logged turns).
# Test override only (Mac driver test): V8_ROOT. Unset on the box.
set -u
R=${V8_ROOT:-/mnt/glm-data/aukora-run}; OUT=$R/out; V=$R/.vllm/bin
cd $R/lab || { echo "V8E_FAIL cd"; exit 1; }
export HF_HOME=$R/hf TMPDIR=$R/tmp
ARM=${1:-}; MD=${2:-}; DL=${3:-}; MODE=${4:-both}
case "$ARM" in v8|v7|base) ;; *) echo "V8E_FAIL arm must be v8|v7|base"; exit 2;; esac
[ -n "$MD" ] && [ -n "$DL" ] || { echo "V8E_FAIL usage: v8_eval.sh ARM MODEL_DIR DL_epoch [single|interactive|both]"; exit 2; }
[ -f "$MD/config.json" ] || { echo "V8E_FAIL no model at $MD"; exit 1; }
B_SINGLE=1500; B_INTER=3000          # s: single-shot RAN 16-18 min + engine start; interactive INFERRED 30-45 min (n=2 x 144)
left(){ echo $(( DL - $(date +%s) )); }
mk(){ echo "V8E_$1 arm=$ARM $(date -u +%FT%TZ) left_s=$(left) ${2:-}"; }
gpu_free(){ [ -z "$(nvidia-smi --query-compute-apps=pid --format=csv,noheader 2>/dev/null)" ]; }
wait_free(){ local f=0; while [ $f -lt 3 ]; do [ "$(left)" -lt "$1" ] && return 1; if gpu_free; then f=$((f + 1)); else f=0; fi
                                              [ $f -lt 3 ] && sleep 30; done; return 0; }
rc=0
if [ "$MODE" = single ] || [ "$MODE" = both ]; then
  if [ -f $OUT/v8_eval_$ARM.json ]; then mk SKIP_SINGLE "receipt exists"
  elif [ "$(left)" -lt $B_SINGLE ]; then mk STOP_SINGLE "needs $B_SINGLE s"; rc=3
  else
    for try in 1 2; do
      mk SINGLE_START "try=$try"; t=$SECONDS
      if PATH=$V:$PATH $V/python v8_eval.py "$MD" $ARM $OUT; then mk SINGLE_END "wall_s=$((SECONDS - t))"; rc=0; break; fi
      mk FAIL_SINGLE "try=$try wall_s=$((SECONDS - t))"; rc=1
      if [ -f $OUT/v8_eval_$ARM.raw.json ] || [ -f $OUT/v8_eval_$ARM.json ]; then mk NO_RETRY "a receipt exists"; break; fi
      [ $try -eq 2 ] && break
      wait_free $B_SINGLE || { mk STOP_SINGLE "no budget for a retry"; rc=3; break; }
    done
  fi
fi
if [ "$MODE" = interactive ] || [ "$MODE" = both ]; then
  if [ -f $OUT/wm_interactive_v8i_$ARM.json ]; then mk SKIP_INTER "receipt exists"
  elif [ "$(left)" -lt $B_INTER ]; then mk STOP_INTER "needs $B_INTER s"; [ $rc -eq 0 ] && rc=3
  else
    for try in 1 2 3; do
      res=""; [ -f $OUT/wm_interactive_v8i_$ARM.turns.jsonl ] && res="--resume"
      mk INTER_START "try=$try $res"; t=$SECONDS
      PATH=$V:$PATH $V/python wm_interactive.py "$MD" v8i_$ARM $OUT holdout_v8.json 2 --commit-on-truncate $res && { mk INTER_END "wall_s=$((SECONDS - t))"; break; }
      mk FAIL_INTER "try=$try wall_s=$((SECONDS - t))"
      [ -f $OUT/wm_interactive_v8i_$ARM.turns.jsonl ] || { rc=1; break; }
      [ "$(left)" -lt 600 ] && { rc=3; break; }
      [ $try -eq 3 ] && rc=1
      sleep 30
    done
  fi
fi
mk DONE "rc=$rc"
exit $rc
