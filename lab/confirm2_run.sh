#!/bin/bash
cd /mnt/glm-data/aukora-run/lab; OUT=/mnt/glm-data/aukora-run/out
export HF_HOME=/mnt/glm-data/aukora-run/hf TMPDIR=/mnt/glm-data/aukora-run/tmp
V=/mnt/glm-data/aukora-run/.vllm/bin; T=/mnt/glm-data/aukora-run/.venv/bin
M=/mnt/glm-data/aukora-run/hf/hub/models--ornith-ai--Ornith-1.5-35B-A3B/snapshots/10fbf86fed7ecee4a061f8b499a618f46001cac1
PATH=$V:$PATH $V/python eval_sampled.py $M base $OUT || echo C2_FAIL base
PATH=$V:$PATH $V/python eval_sampled.py /dev/shm/merged_gen2 gen2 $OUT || echo C2_FAIL gen2
rm -rf /dev/shm/merged_gen2
PATH=$T:$PATH $T/python rebuild_gen1.py $OUT /dev/shm/merged_gen1 || echo C2_FAIL rebuild
PATH=$V:$PATH $V/python eval_sampled.py /dev/shm/merged_gen1 gen1 $OUT || echo C2_FAIL gen1
echo C2_DONE
