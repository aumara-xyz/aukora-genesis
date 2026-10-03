#!/bin/bash
# Resumable Laya fine-tune launcher (RT3 prep). NOT run by the RT3 job.
#   ft-full/run.sh            start (or resume) in the background, detached: setsid + nohup, survives the shell/session ending
#   ft-full/run.sh --fg       run the supervisor loop in the foreground (what the background job executes)
# The supervisor re-launches train_resumable.py --resume after a crash / watchdog kill / OOM until TRAINING_DONE exists
# (max $MAX_RESTARTS restarts). Memory watchdog kills the trainer below 2 GB free; the next attempt resumes from the last state.
# The v1 (non-resumable) launcher is kept as run_v1_nonresumable.sh.
cd /workspace/laya-screen
OUT=${OUT:-ft-full/out_v2}; ITEMS=${ITEMS:-ft-full/train_items_v2.pt}; LOG=${LOG:-ft-full/train_v2.log}
CKPT_EVERY=${CKPT_EVERY:-10}; MAX_RESTARTS=${MAX_RESTARTS:-20}
if [ "$1" != "--fg" ]; then
  [ -f ft-full/.run.pid ] && kill -0 "$(cat ft-full/.run.pid)" 2>/dev/null && { echo "already running (pid $(cat ft-full/.run.pid))"; exit 1; }
  setsid nohup "$0" --fg >> "$LOG" 2>&1 < /dev/null &
  echo $! > ft-full/.run.pid; echo "started supervisor pid $! (log $LOG, out $OUT)"; exit 0
fi
[ -f "$ITEMS" ] || { echo "missing $ITEMS: build it with trainset/make_items.py from trainset/v2 first" ; exit 2; }
tries=0
while [ ! -f "$OUT/TRAINING_DONE" ]; do
  [ $tries -gt $MAX_RESTARTS ] && { echo "$(date +%T) giving up after $MAX_RESTARTS restarts"; exit 3; }
  echo "$(date '+%F %T') attempt $((tries+1)) (resume)"
  OMP_NUM_THREADS=6 HF_HOME=/workspace/laya-screen/hf nice -n 10 .venv/bin/python -u ft-full/train_resumable.py \
    --model-dir ft-smoke/laya_ml_base --items "$ITEMS" --output-dir "$OUT" --device cpu --epochs 4 --micro-batch 4 --grad-accum 8 \
    --ckpt-every "$CKPT_EVERY" --resume &
  P=$!; minfree=999999
  while kill -0 $P 2>/dev/null; do
    av=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo); [ $av -lt $minfree ] && minfree=$av
    if [ $av -lt 2048 ]; then kill $P; echo "WATCHDOG KILL at ${av}MB free (will resume)"; fi
    echo "$(date +%T) free=${av}MB min=${minfree}MB attempt=$((tries+1))" > ft-full/watch.txt; sleep 2
  done
  wait $P; rc=$?; echo "$(date '+%F %T') trainer exit $rc min_free_mb $minfree"; tries=$((tries+1)); [ -f "$OUT/TRAINING_DONE" ] || sleep 10
done
echo "$(date '+%F %T') TRAINING_DONE"; rm -f ft-full/.run.pid
