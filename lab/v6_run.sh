#!/bin/bash
cd /mnt/glm-data/aukora-run/lab; OUT=/mnt/glm-data/aukora-run/out; DL=$1
export HF_HOME=/mnt/glm-data/aukora-run/hf TMPDIR=/mnt/glm-data/aukora-run/tmp
V=/mnt/glm-data/aukora-run/.vllm/bin; T=/mnt/glm-data/aukora-run/.venv/bin; G1=/dev/shm/merged; G2=/dev/shm/merged_gen2
echo "V6 STAGE A $(date -u +%T)"; PATH=$V:$PATH $V/python v6_genA.py $OUT $G1 || { echo V6_FAIL A; exit 1; }
echo "V6 WAIT_HINTS $(date -u +%T)"; for i in $(seq 1 120); do [ -f $OUT/v6_hints.json ] && break; sleep 10; done
[ -f $OUT/v6_hints.json ] || echo '{}' > $OUT/v6_hints.json
echo "V6 STAGE B $(date -u +%T)"; PATH=$V:$PATH $V/python v6_genB.py $OUT $G1 || { echo V6_FAIL B; exit 1; }
echo "V6 TRAIN $(date -u +%T)"; PATH=$T:$PATH $T/python v6_train.py $OUT $DL $G1 v6 $G2 || { echo V6_FAIL train; exit 1; }
echo "V6 EVAL $(date -u +%T)"; PATH=$V:$PATH $V/python v6_eval.py $OUT $G2 || { echo V6_FAIL eval; exit 1; }
echo V6_DONE
