#!/bin/bash
cd /workspace/laya-screen
LOG=ft-full/train.log
OMP_NUM_THREADS=6 HF_HOME=/workspace/laya-screen/hf nice -n 10 .venv/bin/python -u src/notebooks/laya_finetune_typed_decisions_mps.py \
  --model-dir ft-smoke/laya_ml_base --items ft-full/train_items.pt --output-dir ft-full/out \
  --device cpu --epochs 4 --micro-batch 4 --grad-accum 8 > $LOG 2>&1 &
P=$!; minfree=999999; start=$(date +%s)
while kill -0 $P 2>/dev/null; do
  av=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo); [ $av -lt $minfree ] && minfree=$av
  if [ $av -lt 2048 ]; then kill $P; echo "WATCHDOG KILL at ${av}MB free" >> $LOG; fi
  echo "$(date +%T) free=${av}MB min=${minfree}MB" > ft-full/watch.txt
  sleep 2
done
wait $P; echo "EXIT $? MIN_FREE_MB $minfree ELAPSED_S $(( $(date +%s)-start ))" >> $LOG
