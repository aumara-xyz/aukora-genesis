#!/bin/bash
# v7 driver (box). Order puts the H1 pair first:
#   eval gen1 (uses /dev/shm/merged_gen1 left by CONFIRM-2; rebuilt from OUT/v5_adapter only if absent)
#   -> train v7 (+ merge to /dev/shm/merged_v7; deletes merged_gen1 only if /dev/shm free < 70 GiB, after the gen1 eval)
#   -> eval v7 -> eval base (last, NON-fatal, loads from the disk snapshot, skipped if its budget no longer fits).
# Usage: bash v7_run.sh <WATCHDOG_deadline_epoch_s> <holdout_v7_sha256>
#   Pass the Mac watchdog's own deadline (the `deadline` file). DL = that - 900 s, so the last receipts are written >= 15 min
#   before the stop and pull_loop (300 s cadence) exports them. A stage starts only if its full budget fits before DL;
#   the H1 chain (gen1 eval + train + v7 eval) starts only if the whole chain fits.
# Each python stage runs in its own process (frees the GPU). Nothing is deleted here; the only deletion in the pipeline is
# the conditional /dev/shm/merged_gen1 removal inside v7_train.py.
set -u
cd /mnt/glm-data/aukora-run/lab || { echo "V7_FAIL cd"; exit 1; }
OUT=/mnt/glm-data/aukora-run/out; WD=${1:-}; HSHA=${2:-}
[ -n "$WD" ] && [ -n "$HSHA" ] || { echo "V7_FAIL usage: v7_run.sh <watchdog_deadline_epoch> <holdout_v7_sha256>"; exit 2; }
DL=$(( ${WD%.*} - 900 ))
export HF_HOME=/mnt/glm-data/aukora-run/hf TMPDIR=/mnt/glm-data/aukora-run/tmp
V=/mnt/glm-data/aukora-run/.vllm/bin; T=/mnt/glm-data/aukora-run/.venv/bin
M=/mnt/glm-data/aukora-run/hf/hub/models--ornith-ai--Ornith-1.5-35B-A3B/snapshots/10fbf86fed7ecee4a061f8b499a618f46001cac1
G1=/dev/shm/merged_gen1; G7=/dev/shm/merged_v7
B_EVAL=1800; B_TRAIN=1500; B_REBUILD=600          # stage budgets in s (eval ~25 min, train+load+merge ~15-20 min)
CHAIN=$(( B_EVAL + B_TRAIN + B_EVAL ))
left(){ echo $(( DL - $(date +%s) )); }
mk(){ echo "V7_$1 $(date -u +%T) left_s=$(left) shm_free=$(df -BG --output=avail /dev/shm | tail -1 | tr -d ' ')"; }
need(){ [ "$(left)" -ge "$2" ] || { echo "V7_STOP before $1: needs $2 s, $(left) s left before DL $(date -u -d @$DL +%T)Z"; exit 3; }; }
gpu_busy(){ pgrep -f 'eval_sampled.py|confirm2_run.sh|rebuild_gen1.py|v6_run.sh|v5_run.sh|posthoc_lenient.py' >/dev/null ||
            [ -n "$(nvidia-smi --query-compute-apps=pid --format=csv,noheader 2>/dev/null)" ]; }

echo "V7_ARGS watchdog=$(date -u -d @${WD%.*} +%T)Z DL=$(date -u -d @$DL +%T)Z chain_s=$CHAIN"
got=$(sha256sum holdout_v7.json | cut -d' ' -f1)
[ "$got" = "$HSHA" ] || { echo "V7_FAIL holdout_v7 sha256 mismatch ($got)"; exit 1; }
sha256sum --quiet -c v7_manifest.sha256 || { echo "V7_FAIL code/data sha256 mismatch vs v7_manifest.sha256"; exit 1; }
for f in $OUT/v5_corpus.json $OUT/v5_train.json $OUT/v5_adapter/adapter_model.safetensors $OUT/v5_adapter/adapter_config.json; do
  [ -f "$f" ] || { echo "V7_FAIL missing $f"; exit 1; }
done
# CPU-only preflights (no GPU context; safe while CONFIRM-2 is still running): data, template, tokenization, receipts absent
CUDA_VISIBLE_DEVICES= PATH=$T:$PATH $T/python v7_train.py --preflight $OUT || { echo "V7_FAIL preflight train"; exit 1; }
CUDA_VISIBLE_DEVICES= PATH=$V:$PATH $V/python v7_eval.py --preflight $OUT || { echo "V7_FAIL preflight eval"; exit 1; }
mk PREFLIGHT_OK

# wait for CONFIRM-2 (or any other GPU job) to finish; give up as soon as the H1 chain can no longer fit
while gpu_busy; do need wait_gpu $CHAIN; sleep 30; done
mk GPU_FREE

if [ ! -f $G1/model.safetensors.index.json ] || [ ! -f $G1/config.json ]; then
  need rebuild_gen1 $(( CHAIN + B_REBUILD )); mk REBUILD_GEN1
  PATH=$T:$PATH $T/python rebuild_gen1.py $OUT $G1 || { echo "V7_FAIL rebuild_gen1"; exit 1; }
fi
need eval_gen1 $CHAIN; mk EVAL_GEN1
PATH=$V:$PATH $V/python v7_eval.py $G1 gen1 $OUT || { echo "V7_FAIL eval_gen1"; exit 1; }

need train $(( B_TRAIN + B_EVAL )); mk TRAIN
PATH=$T:$PATH $T/python v7_train.py $OUT $DL || { echo "V7_FAIL train"; exit 1; }

need eval_v7 $B_EVAL; mk EVAL_V7
PATH=$V:$PATH $V/python v7_eval.py $G7 v7 $OUT || { echo "V7_FAIL eval_v7"; exit 1; }
mk H1_PAIR_DONE

if [ "$(left)" -ge "$B_EVAL" ]; then
  mk EVAL_BASE
  PATH=$V:$PATH $V/python v7_eval.py $M base $OUT || echo "V7_WARN eval_base failed (non-fatal; H1 unaffected)"
else
  echo "V7_SKIP eval_base: $(left) s left < $B_EVAL s"
fi
mk DONE
