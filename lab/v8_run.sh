#!/bin/bash
# v8 HARD-PUSH driver (box). Order (everything that needs /dev/shm/merged_v7 runs before training frees /dev/shm):
#   0 checks: holdout_v8 sha, v8_manifest.sha256, inputs (v6_A.json sha); CPU preflights in a scratch dir (restart-safe)
#   1 wait for WAIT_FOR_FILE (e.g. OUT/wm_DONE.json), then until no other GPU job runs (3 consecutive free checks 30 s apart;
#     never kills anything). The BUDGET clock starts HERE (DL = first GPU_FREE + BUDGET_s), not at launch.
#   2 COLLECT interactive  merged_v7 on v8_pool (n=2, wm_interactive loop, --commit-on-truncate)   [resume on crash]
#   3 COLLECT single       merged_v7 on v8_pool (n=2, 16384 thinking tokens)                        [non-fatal, budget]
#   4 POST + BUILD DATA + train preflight (CPU)
#   5 EVAL v7 single (GATE / CO-PRIMARY input), EVAL base single (PRIMARY comparator; disk snapshot), then v7 interactive
#     (secondary) if it fits and V8_NO_INTER is not 1
#   6 TRAIN v8 (fresh LoRA on BASE, 2 epochs) -> merge /dev/shm/merged_v8. --free-merged-v7 is passed ONLY if OUT/v8_eval_v7.json
#     is final with forcing_complete true; otherwise the driver stops before training (merged_v7 kept, decide manually).
#   7 EVAL v8 single (PRIMARY) -> ANALYZE -> OUT/v8_analysis.json
#   8 interactive v8, then base, if they fit and V8_NO_INTER is not 1 and the full manifest still matches
#   9 final ANALYZE -> OUT/v8_analysis_final.json; OUT/v8_DONE.json last.  OUT/v8_STATUS.json after every stage.
# RESTARTABLE: a stage whose final receipt exists is skipped, never re-run or overwritten; an interrupted interactive stage
# resumes from its turns log. Re-launch the same command after a STOP (exit 3) or a FAIL once the cause is fixed.
# Manifest: re-checked before every GPU stage. Through BUILD the full manifest must match (collect/post import wm_interactive);
# afterwards single-shot evals and training need the non-wm_* lines; interactive evals are SKIPPED if a wm_* file changed.
# Usage: nohup bash v8_run.sh <BUDGET_s> <holdout_v8_sha256> [WAIT_FOR_FILE] > /mnt/glm-data/aukora-run/v8.log 2>&1 &
#   Env V8_NO_INTER=1 skips every interactive eval (core path: PRIMARY + CO-PRIMARY + GATE only).
#   Core path needs <= B_COLLECT_I + B_COLLECT_S + B_POST + 3*B_SINGLE + B_TRAIN = 15000 s of budget (stage budgets are upper bounds).
# Do NOT launch or restart wm_run.sh while this driver is alive (wm's BUSY_RE does not know v8). s1_run.sh waits for any v8_
# process by itself; v8 must NOT list s1_run.sh (the two waits would deadlock); s1's GPU process s1_ornith_eval.py is listed.
# Test overrides only (Mac driver test, v8_driver_test.py): V8_ROOT, V8_SHM, V8_MODEL. Unset on the box.
set -u
R=${V8_ROOT:-/mnt/glm-data/aukora-run}
cd $R/lab || { echo "V8_FAIL cd"; exit 1; }
OUT=$R/out; BUDGET=${1:-}; HSHA=${2:-}; WAIT_FOR=${3:-}
[ -n "$BUDGET" ] && [ -n "$HSHA" ] || { echo "V8_FAIL usage: v8_run.sh <BUDGET_s> <holdout_v8_sha256> [WAIT_FOR_FILE]"; exit 2; }
case "$BUDGET" in ''|*[!0-9]*) echo "V8_FAIL BUDGET_s must be an integer number of seconds"; exit 2;; esac
[ "$BUDGET" -le 86400 ] || { echo "V8_FAIL BUDGET_s=$BUDGET looks like an epoch time; pass a duration in seconds"; exit 2; }
export HF_HOME=$R/hf TMPDIR=$R/tmp
mkdir -p $TMPDIR
V=$R/.vllm/bin; T=$R/.venv/bin
M=${V8_MODEL:-$R/hf/hub/models--ornith-ai--Ornith-1.5-35B-A3B/snapshots/10fbf86fed7ecee4a061f8b499a618f46001cac1}
SHM=${V8_SHM:-/dev/shm}; G7=$SHM/merged_v7; G8=$SHM/merged_v8
V6A_SHA=12e83c447810c20f722ae3193608177d2f952c90609967240cf899dda7501fef
B_COLLECT_I=3600; B_COLLECT_S=1500; B_POST=900; B_TRAIN=3600; B_SINGLE=1500; B_INTER=3000   # s; see v8_PREREG.md section 9
BUSY_RE='rep1_|v7_run.sh|v7_eval.py|v7_train.py|wm_run.sh|wm_interactive.py|wm_retrieval_eval.py|s1_ornith_eval.py|s1_train_laya.py|rebuild_gen1.py|eval_sampled.py|eval_forced.py|confirm.py|posthoc_lenient.py|v6_run.sh|v5_run.sh|probe_vllm.py'
SJ=""; DL=""
left(){ if [ -z "$DL" ]; then echo "$BUDGET"; else echo $(( DL - $(date +%s) )); fi; }
mk(){ echo "V8_$1 $(date -u +%FT%TZ) left_s=$(left) shm_free=$(df -BG --output=avail $SHM 2>/dev/null | tail -1 | tr -d ' ') ${2:-}"; }
status(){ printf '{"final":%s,"utc":"%s","holdout_v8_sha256":"%s","budget_s":%s,"dl":"%s","stages":{%s}}\n' "$2" "$(date -u +%FT%TZ)" "$HSHA" "$BUDGET" "$DL" "$SJ" > "$1.tmp" && mv "$1.tmp" "$1"; }
note(){ SJ="${SJ:+$SJ,}\"$1\":{\"exit\":$2,\"end\":\"$(date -u +%FT%TZ)\"}"; status $OUT/v8_STATUS.json false; }
die(){ echo "V8_FAIL $*"; SJ="${SJ:+$SJ,}\"FATAL\":{\"reason\":\"$*\"}"; status $OUT/v8_DONE.json true; exit 1; }
stop(){ mk STOP "$*"; SJ="${SJ:+$SJ,}\"STOP\":{\"reason\":\"$*\"}"; status $OUT/v8_DONE.json true; exit 3; }
need(){ [ "$(left)" -ge "$2" ] || stop "before $1: needs $2 s"; }
busy(){ pgrep -f "$BUSY_RE" >/dev/null || [ -n "$(nvidia-smi --query-compute-apps=pid --format=csv,noheader 2>/dev/null)" ]; }
# wait_gpu NAME NEED_S: waits for 3 consecutive free checks; once DL is set, STOPs cleanly when the remaining chain no longer fits.
wait_gpu(){ local free=0 n=0
            while [ $free -lt 3 ]; do
              [ -n "$DL" ] && [ "$(left)" -lt "$2" ] && stop "waiting for the GPU before $1: needs $2 s"
              if busy; then free=0; [ $((n % 20)) -eq 0 ] && mk WAIT_GPU "before $1 procs=[$(pgrep -af "$BUSY_RE" | cut -c1-120 | tr '\n' ';')]"; n=$((n + 1))
              else free=$((free + 1)); fi
              [ $free -lt 3 ] && sleep 30
            done
            if [ -z "$DL" ]; then DL=$(( $(date +%s) + BUDGET )); mk DL_SET "DL=$(date -u -d @$DL +%FT%TZ) budget_s=$BUDGET"; fi
            mk GPU_FREE "$1"; }
man_full(){ sha256sum --quiet -c v8_manifest.sha256 >/dev/null 2>&1; }
man_core(){ grep -v '  wm_' v8_manifest.sha256 | sha256sum --quiet -c - >/dev/null 2>&1; }
pyok(){ CUDA_VISIBLE_DEVICES= $V/python -c "import json,sys; r=json.load(open(sys.argv[1])); sys.exit(0 if ($2) else 1)" "$1" 2>/dev/null; }
done_post(){ [ -f $OUT/v8_data.json ]; }
done_single(){ [ -f $OUT/v8_eval_$1.json ]; }
done_train(){ [ -f $G8/config.json ] && [ -f $OUT/v8_train.json ] && pyok $OUT/v8_train.json "r.get('stage') == 'merged'"; }
v7_ok(){ [ -f $OUT/v8_eval_v7.json ] && pyok $OUT/v8_eval_v7.json "r.get('stage') == 'final' and r.get('forcing_complete') is True"; }
core_rest(){ local s=0
             done_post || s=$((s + B_POST)); done_single v7 || s=$((s + B_SINGLE)); done_single base || s=$((s + B_SINGLE))
             done_train || s=$((s + B_TRAIN)); done_single v8 || s=$((s + B_SINGLE)); echo $s; }
inter_on(){ [ "${V8_NO_INTER:-0}" != 1 ]; }

mk ARGS "budget_s=$BUDGET wait_for=${WAIT_FOR:-none} no_inter=${V8_NO_INTER:-0}"
got=$(sha256sum holdout_v8.json | cut -d' ' -f1); [ "$got" = "$HSHA" ] || die "holdout_v8 sha256 mismatch ($got)"
man_full || die "code/data sha256 mismatch vs v8_manifest.sha256"
for f in $OUT/v5_corpus.json $OUT/v6_A.json $OUT/v7_train.json $OUT/v7_adapter/adapter_model.safetensors \
         v7_cp.json v8_pool.json holdout.json holdout_v7.json holdout_rep1.json holdout128.json; do
  [ -f "$f" ] || die "missing $f"
done
[ "$(sha256sum $OUT/v6_A.json | cut -d' ' -f1)" = "$V6A_SHA" ] || die "out/v6_A.json sha256 differs from the Mac copy"
# merged_v7 is needed until collection and the v7 single eval are done
if [ ! -f $OUT/wm_interactive_v8pool.json ] || ! done_single v7; then
  for f in $G7/config.json $G7/model.safetensors.index.json; do [ -f "$f" ] || die "missing $f"; done
fi
PF=$TMPDIR/v8_preflight_$$; mkdir -p $PF            # empty dir: preflights check code/template/sets, not this run's receipts
CUDA_VISIBLE_DEVICES= PATH=$V:$PATH $V/python v8_collect.py --preflight $PF || die "preflight collect"
CUDA_VISIBLE_DEVICES= PATH=$V:$PATH $V/python v8_eval.py --preflight $PF || die "preflight eval"
CUDA_VISIBLE_DEVICES= PATH=$V:$PATH $V/python wm_interactive.py --preflight holdout_v8.json $PF v8i_v8 || die "preflight wm on holdout_v8"
mk PREFLIGHT_OK
if [ -n "$WAIT_FOR" ]; then
  n=0; while [ ! -f "$WAIT_FOR" ]; do [ $((n % 30)) -eq 0 ] && mk WAIT_FOR "$WAIT_FOR"; n=$((n + 1)); sleep 60; done
  mk WAIT_FOR_OK "$WAIT_FOR"
fi

# 2 COLLECT interactive (resume while the turns log exists; one plain retry if an engine start failed without a log)
if [ -f $OUT/wm_interactive_v8pool.json ]; then mk SKIP_COLLECT_I "receipt exists"
else
  nolog=0
  for try in 1 2 3; do
    wait_gpu collect_interactive $(( B_COLLECT_I + $(core_rest) )); need collect_interactive $(( B_COLLECT_I + $(core_rest) ))
    man_full || die "manifest mismatch before collect_interactive"
    res=""; [ -f $OUT/wm_interactive_v8pool.turns.jsonl ] && res="--resume"
    mk COLLECT_I "try=$try $res"
    PATH=$V:$PATH $V/python v8_collect.py interactive $G7 $OUT $res && break
    if [ ! -f $OUT/wm_interactive_v8pool.turns.jsonl ]; then nolog=$((nolog + 1)); [ $nolog -ge 2 ] && die "collect interactive failed twice without a turns log"; fi
    [ $try -eq 3 ] && die "collect interactive failed 3 times"
  done
  note collect_interactive 0
fi

# 3 COLLECT single (non-fatal: source (b) is optional)
if [ -f $OUT/v8_single.json ]; then mk SKIP_COLLECT_S "receipt exists"
elif done_post; then mk SKIP_COLLECT_S "v8_data.json already built"
elif [ "$(left)" -ge $(( B_COLLECT_S + $(core_rest) )) ]; then
  wait_gpu collect_single $(( B_COLLECT_S + $(core_rest) ))
  if [ "$(left)" -ge $(( B_COLLECT_S + $(core_rest) )) ] && man_full; then
    mk COLLECT_S; PATH=$V:$PATH $V/python v8_collect.py single $G7 $OUT; note collect_single $?
  else mk SKIP_COLLECT_S "budget or manifest after wait"; fi
else mk SKIP_COLLECT_S "budget"; fi

# 4 POST + BUILD + train preflight (CPU)
if done_post; then mk SKIP_POST_BUILD "v8_data.json exists"
else
  man_full || die "manifest mismatch before post/build"
  mk POST
  if [ -f $OUT/v8_turns.jsonl ] && [ -f $OUT/v8_collect_summary.json ]; then mk SKIP_POST "v8_turns.jsonl exists"
  elif [ -f $OUT/v8_turns.jsonl ]; then die "v8_turns.jsonl exists without v8_collect_summary.json (post died mid-write): move it aside + AMENDMENTS"
  else CUDA_VISIBLE_DEVICES= PATH=$V:$PATH $V/python v8_collect.py post $OUT || die "post"; fi
  CUDA_VISIBLE_DEVICES= PATH=$V:$PATH $V/python v8_build_data.py $OUT || die "build_data"
  note post_build 0
fi
if done_train; then mk SKIP_TRAIN_PREFLIGHT "merged_v8 exists"
elif [ -e $OUT/v8_adapter ] || [ -e $OUT/v8_train.json ] || [ -e $G8 ]; then
  die "partial v8 training output (v8_adapter / v8_train.json / merged_v8) without a merged receipt: move aside or merge with v8_rebuild.py + AMENDMENTS"
else
  CUDA_VISIBLE_DEVICES= PATH=$T:$PATH $T/python v8_train.py --preflight $OUT || die "preflight train"
fi

# 5 EVAL v7 single (GATE/CO-PRIMARY), EVAL base single (PRIMARY comparator), v7 interactive (secondary) while merged_v7 exists
if done_single v7; then mk SKIP_EVAL_V7 "receipt exists"
else
  wait_gpu eval_v7 $(core_rest); need eval_v7 $(core_rest); man_core || die "manifest mismatch before eval_v7"
  bash v8_eval.sh v7 $G7 $DL single; note eval_v7_single $?
fi
if done_single base; then mk SKIP_EVAL_BASE "receipt exists"
else
  wait_gpu eval_base $(core_rest); need eval_base $(core_rest); man_core || die "manifest mismatch before eval_base"
  bash v8_eval.sh base $M $DL single; note eval_base_single $?
fi
done_train || v7_ok || die "v8_eval_v7.json missing or forcing incomplete: merged_v7 kept and training NOT started (CO-PRIMARY/GATE need v7); decide manually"
if ! inter_on; then mk SKIP_EVAL_V7_I "V8_NO_INTER=1"
elif [ -f $OUT/wm_interactive_v8i_v7.json ]; then mk SKIP_EVAL_V7_I "receipt exists"
elif [ ! -f $G7/config.json ]; then mk SKIP_EVAL_V7_I "merged_v7 gone"
elif ! man_full; then mk SKIP_EVAL_V7_I "wm_* manifest mismatch"
elif [ "$(left)" -ge $(( B_INTER + $(core_rest) )) ]; then
  wait_gpu eval_v7_i $(( B_INTER + $(core_rest) ))
  if [ "$(left)" -ge $(( B_INTER + $(core_rest) )) ]; then bash v8_eval.sh v7 $G7 $DL interactive; note eval_v7_inter $?
  else mk SKIP_EVAL_V7_I "budget after wait"; fi
else mk SKIP_EVAL_V7_I "budget"; fi

# 6 TRAIN v8 (merged_v7 may be freed only after a final, forcing-complete v7 single receipt)
if done_train; then mk SKIP_TRAIN "merged_v8 + merged receipt exist"
else
  v7_ok || die "v8_eval_v7.json missing or forcing incomplete: merged_v7 kept and training NOT started (CO-PRIMARY/GATE need v7); decide manually"
  wait_gpu train $(core_rest); need train $(core_rest); man_core || die "manifest mismatch before train"
  mk TRAIN
  PATH=$T:$PATH $T/python v8_train.py $OUT $(( DL - B_SINGLE )) --free-merged-v7 || die "train"
  note train 0
fi

# 7 EVAL v8 single (PRIMARY) + analysis
if done_single v8; then mk SKIP_EVAL_V8 "receipt exists"
else
  wait_gpu eval_v8 $(core_rest); need eval_v8 $(core_rest); man_core || die "manifest mismatch before eval_v8"
  bash v8_eval.sh v8 $G8 $DL single; note eval_v8_single $?
fi
mk PRIMARY_INPUTS_DONE
CUDA_VISIBLE_DEVICES= PATH=$V:$PATH $V/python v8_analyze.py $OUT --holdout-sha $HSHA --json $OUT/v8_analysis.json; note analyze_primary $?

# 8 interactive v8, base (secondary)
for arm in v8 base; do
  md=$G8; [ $arm = base ] && md=$M
  if ! inter_on; then mk SKIP_EVAL_${arm}_I "V8_NO_INTER=1"
  elif [ -f $OUT/wm_interactive_v8i_$arm.json ]; then mk SKIP_EVAL_${arm}_I "receipt exists"
  elif ! man_full; then mk SKIP_EVAL_${arm}_I "wm_* manifest mismatch"
  elif [ "$(left)" -ge $B_INTER ]; then
    wait_gpu eval_${arm}_i $B_INTER
    if man_full; then bash v8_eval.sh $arm $md $DL interactive; note eval_${arm}_inter $?; else mk SKIP_EVAL_${arm}_I "manifest after wait"; fi
  else mk SKIP_EVAL_${arm}_I budget; fi
done

# 9 final analysis (adds the interactive secondaries; interactive receipts that differ are reported NOT_COMPARABLE)
CUDA_VISIBLE_DEVICES= PATH=$V:$PATH $V/python v8_analyze.py $OUT --holdout-sha $HSHA --json $OUT/v8_analysis_final.json; note analyze_final $?
status $OUT/v8_DONE.json true
mk DONE
