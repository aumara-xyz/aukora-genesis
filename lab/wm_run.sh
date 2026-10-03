#!/bin/bash
# wm driver (box). EXPLORATORY working-memory runs, base model, holdout128 ONLY (never holdout_v7), n=2 samples:
#   1 NORET       wm_retrieval_eval.py ... none                         -> out/wm_retrieval_base_noret_n2.json    (H-WM1 comparator, H-WM2 control)
#   2 INTERACTIVE wm_interactive.py --commit-on-truncate                -> out/wm_interactive_base_n2.json        (H-WM1)
#   3 RET         wm_retrieval_eval.py ... retrieval                    -> out/wm_retrieval_base_ret_n2.json      (H-WM2)
#   4 WMMAX       wm_interactive.py --commit-on-truncate --notes        -> out/wm_interactive_base_wmmax_n2.json  (EXPLORATORY; WM_EXTRA=0 skips)
#   then wm_analyze.py -> out/wm_analysis.json, then out/wm_DONE.json (stage exit codes, tries, UTC times) LAST.
#   out/wm_STATUS.json is rewritten after every stage (pull_loop exports both).
# The comparator runs first, so a stop at any point after stage 2 still leaves H-WM1 testable.
# Requires WM_PREREG_SHA = sha256 of the locked wm_PREREG.md (copied next to this script); it is checked here and written
# into every receipt head and into wm_analysis.json.
# Before any GPU work it waits until the v7 driver and every other GPU job are gone (no known driver process and an empty
# nvidia-smi compute-app list on 3 consecutive checks 30 s apart). It re-checks before every stage. While waiting it logs the
# blocking processes / GPU apps every ~10 min and WM_WAIT_GPU_LONG every 30 min of waiting (it never kills anything).
# Each stage is a fresh python process with the vLLM venv first on PATH (ninja for JIT). Retry rules: see stage().
# Nothing is deleted; receipts are never overwritten (scripts refuse).
# After WM_ALL_DONE nothing else is queued: the GPU is idle but the box keeps billing (~$5.4/h) until it is stopped.
# Launch (box): WM_PREREG_SHA=<sha> nohup bash /mnt/glm-data/aukora-run/lab/wm_run.sh > /mnt/glm-data/aukora-run/wm.log 2>&1 &
set -u
R=/mnt/glm-data/aukora-run
cd $R/lab || { echo "WM_FAIL cd"; exit 1; }
OUT=$R/out; SET=holdout128.json; N=2
export HF_HOME=$R/hf TMPDIR=$R/tmp
V=$R/.vllm/bin
M=$R/hf/hub/models--ornith-ai--Ornith-1.5-35B-A3B/snapshots/10fbf86fed7ecee4a061f8b499a618f46001cac1
H128=9dd07cd7774fc6937ff830165d83b08fdd011edb4c1ac897222cf058a6024e1b
BUSY_RE='v7_run.sh|v7_eval.py|v7_train.py|rebuild_gen1.py|eval_sampled.py|eval_forced.py|confirm2_run.sh|confirm.py|posthoc_lenient.py|v6_run.sh|v5_run.sh|probe_vllm.py'
SJ=""                                   # JSON fragments of finished stages
mk(){ echo "WM_$1 $(date -u +%FT%TZ) ${2:-}"; }
wjson(){ printf '{"prereg_sha256":"%s","set":"%s","n":%s,"final":%s,"utc":"%s","stages":{%s}}\n' \
           "${WM_PREREG_SHA:-}" "$SET" "$N" "$2" "$(date -u +%FT%TZ)" "$SJ" > "$1.tmp" && mv "$1.tmp" "$1"; }
fail(){ echo "WM_FAIL $*"; SJ="${SJ:+$SJ,}\"FATAL\":{\"reason\":\"$*\"}"; wjson $OUT/wm_DONE.json true; exit 1; }
note_stage(){ SJ="${SJ:+$SJ,}\"$1\":{\"exit\":$2,\"tries\":$3,\"start\":\"$4\",\"end\":\"$(date -u +%FT%TZ)\",\"wall_s\":$5}"; wjson $OUT/wm_STATUS.json false; }
gpu_apps(){ nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader 2>/dev/null | tr '\n' ';'; }
busy_procs(){ pgrep -af "$BUSY_RE" 2>/dev/null | cut -c1-160 | tr '\n' ';'; }
busy(){ pgrep -f "$BUSY_RE" >/dev/null || [ -n "$(nvidia-smi --query-compute-apps=pid --format=csv,noheader 2>/dev/null)" ]; }
wait_gpu(){ local free=0 n=0 t0=$SECONDS long=0
            while [ $free -lt 3 ]; do
              if busy; then
                free=0
                [ $((n % 20)) -eq 0 ] && mk WAIT_GPU "before $1 waited_s=$((SECONDS - t0)) procs=[$(busy_procs)] gpu_apps=[$(gpu_apps)]"
                if [ $(((SECONDS - t0) / 1800)) -gt $long ]; then
                  long=$(((SECONDS - t0) / 1800)); mk WAIT_GPU_LONG "before $1 waited_s=$((SECONDS - t0)) procs=[$(busy_procs)] gpu_apps=[$(gpu_apps)] (no auto-kill)"
                fi
                n=$((n + 1))
              else free=$((free + 1)); fi
              [ $free -lt 3 ] && sleep 30
            done; mk GPU_FREE "$1 waited_s=$((SECONDS - t0))"; }
# stage NAME RECEIPT TURNS_JSONL cmd...   (TURNS_JSONL is "-" for single-shot stages)
#   exit 0 -> done. A failure that left the final receipt is logged and not retried.
#   An interactive stage whose turns log exists is retried with --resume (up to 3 tries in all, any wall time): the
#   script replays the logged turns exactly and continues with the next round under the same seed rule.
#   Any other failure within 600 s without a receipt (e.g. another job grabbed the GPU between the free-check and engine
#   start) is retried once after the GPU is free again; otherwise it is logged and the next stage still runs.
stage(){ local name=$1 rcpt=$2 jl=$3; shift 3; local try t t0=$SECONDS ec=1 res="" start
         start=$(date -u +%FT%TZ)
         for try in 1 2 3; do
           wait_gpu $name; mk STAGE_$name "try=$try${res:+ resume}"; t=$SECONDS
           PATH=$V:$PATH "$@" $res; ec=$?
           if [ $ec -eq 0 ]; then mk DONE_$name "wall_s=$((SECONDS - t))"; break; fi
           mk WARN_$name "exit=$ec try=$try wall_s=$((SECONDS - t))"
           [ -f "$rcpt" ] && break
           if [ "$jl" != - ] && [ -s "$jl" ]; then res=--resume; continue; fi
           if [ $try -ge 2 ] || [ $((SECONDS - t)) -ge 600 ]; then break; fi
         done
         note_stage $name $ec $try "$start" $((SECONDS - t0)); return $ec; }

mk START "set=$SET n=$N extra=${WM_EXTRA:-1} prereg=${WM_PREREG_SHA:-unset}"
[ -n "${WM_PREREG_SHA:-}" ] || fail "WM_PREREG_SHA not set: lock wm_PREREG.md first and pass its sha256"
export WM_PREREG_SHA
[ -f wm_PREREG.md ] && [ "$(sha256sum wm_PREREG.md | cut -d' ' -f1)" = "$WM_PREREG_SHA" ] || fail "wm_PREREG.md missing or sha256 != WM_PREREG_SHA"
[ "$(sha256sum $SET | cut -d' ' -f1)" = "$H128" ] || fail "holdout128 sha256 mismatch"
sha256sum --quiet -c wm_manifest.sha256 || fail "wm_manifest.sha256 mismatch"
for f in $OUT/v5_corpus.json $OUT/v6_corpus.json $M/config.json; do [ -f "$f" ] || fail "missing $f"; done
mkdir -p $TMPDIR
# the shipped library must be reproducible on the box from the box's own corpora, byte for byte
CUDA_VISIBLE_DEVICES= PATH=$V:$PATH $V/python wm_library.py build $OUT $TMPDIR/wm_library_box.jsonl $SET || fail "library rebuild"
[ "$(sha256sum < $TMPDIR/wm_library_box.jsonl | cut -d' ' -f1)" = "$(sha256sum < wm_library.jsonl | cut -d' ' -f1)" ] || fail "library rebuild sha differs"
# CPU-only preflights: set guard, receipts absent, real tokenizer + chat template, generation tail opens <think>, worst-case prompt length
CUDA_VISIBLE_DEVICES= PATH=$V:$PATH $V/python wm_retrieval_eval.py --preflight $SET $OUT base_noret_n2 none || fail "preflight noret"
CUDA_VISIBLE_DEVICES= PATH=$V:$PATH $V/python wm_interactive.py --preflight $SET $OUT base_n2 || fail "preflight interactive"
CUDA_VISIBLE_DEVICES= PATH=$V:$PATH $V/python wm_retrieval_eval.py --preflight $SET $OUT base_ret_n2 retrieval || fail "preflight ret"
[ "${WM_EXTRA:-1}" = 1 ] && { CUDA_VISIBLE_DEVICES= PATH=$V:$PATH $V/python wm_interactive.py --preflight $SET $OUT base_wmmax_n2 --notes || fail "preflight wmmax"; }
mk PREFLIGHT_OK

stage NORET       $OUT/wm_retrieval_base_noret_n2.json   - \
      $V/python wm_retrieval_eval.py $M base_noret_n2 $OUT $SET $N none
stage INTERACTIVE $OUT/wm_interactive_base_n2.json       $OUT/wm_interactive_base_n2.turns.jsonl \
      $V/python wm_interactive.py    $M base_n2       $OUT $SET $N --commit-on-truncate
stage RET         $OUT/wm_retrieval_base_ret_n2.json     - \
      $V/python wm_retrieval_eval.py $M base_ret_n2   $OUT $SET $N retrieval
if [ "${WM_EXTRA:-1}" = 1 ]; then
  stage WMMAX     $OUT/wm_interactive_base_wmmax_n2.json $OUT/wm_interactive_base_wmmax_n2.turns.jsonl \
      $V/python wm_interactive.py    $M base_wmmax_n2 $OUT $SET $N --commit-on-truncate --notes
else
  mk SKIP_WMMAX
fi
t=$SECONDS; a0=$(date -u +%FT%TZ)
CUDA_VISIBLE_DEVICES= PATH=$V:$PATH $V/python wm_analyze.py $OUT base_n2 base_noret_n2 base_ret_n2 base_wmmax_n2; aec=$?
[ $aec -eq 0 ] || mk WARN_ANALYZE "exit=$aec"
note_stage ANALYZE $aec 1 "$a0" $((SECONDS - t))
wjson $OUT/wm_DONE.json true
mk ALL_DONE "nothing else is queued: the GPU is idle from here and the box bills until it is stopped"
