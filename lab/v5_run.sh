#!/bin/bash
# v5 driver: A (vLLM gen) -> B (train+merge) -> C (vLLM P1). Each stage exits to free the GPU.
cd /mnt/glm-data/aukora-run/lab; OUT=/mnt/glm-data/aukora-run/out; DL=$1
export HF_HOME=/mnt/glm-data/aukora-run/hf TMPDIR=/mnt/glm-data/aukora-run/tmp
st(){ echo "STAGE $1 $(date -u +%T)"; }
st A; PATH=/mnt/glm-data/aukora-run/.vllm/bin:$PATH ../.vllm/bin/python v5_gen.py $OUT || { echo "V5_FAIL stageA"; exit 1; }
n=$(python3 -c "import json;print(json.load(open('$OUT/v5_stageA.json'))['corpus_n'])")
[ "$n" -lt 8 ] && { echo "V5_STOP NO_ELIGIBLE_CORPUS n=$n"; exit 0; }
p0=$(python3 -c "import json;print(json.load(open('$OUT/v5_stageA.json'))['p0a'])")
[ "$p0" -ge 28 ] && { echo "V5_STOP NO_HEADROOM"; exit 0; }
st B; PATH=/mnt/glm-data/aukora-run/.venv/bin:$PATH ../.venv/bin/python v5_train.py $OUT $DL || { echo "V5_FAIL stageB"; exit 1; }
st C; PATH=/mnt/glm-data/aukora-run/.vllm/bin:$PATH ../.vllm/bin/python v5_eval.py $OUT || { echo "V5_FAIL stageC"; exit 1; }
echo "V5_DONE"
