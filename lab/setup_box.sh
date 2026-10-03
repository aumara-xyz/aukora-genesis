#!/bin/bash
# Runs ON the H200. Read-mostly inventory, then env + model staging. Never formats, deletes or creates disks.
set -euo pipefail
REPO=ornith-ai/Ornith-1.5-35B-A3B; REV=10fbf86fed7ecee4a061f8b499a618f46001cac1
echo "== inventory"; date -u; nvidia-smi --query-gpu=name,memory.total,memory.used,driver_version --format=csv
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT; df -h -x tmpfs -x overlay; free -g; nproc
systemctl list-units --type=service --state=running --no-pager | grep -i -E "vllm|sglang|llama|auma|ollama|triton" || echo "no serving units"
# pick staging root: mounted data disk with >=100GiB free, else /dev/shm (RAM)
ROOT="${ROOT:-}"
[ -n "$ROOT" ] || for m in $(df --output=target -x tmpfs -x overlay | tail -n +2); do
  free=$(df --output=avail -BG "$m" | tail -1 | tr -dc 0-9)
  if [ "$free" -ge 100 ] && [ "$m" != "/" ]; then ROOT=$m; break; fi
done
if [ -z "$ROOT" ]; then
  shm=$(df --output=avail -BG /dev/shm | tail -1 | tr -dc 0-9); echo "no disk with 100G free; /dev/shm avail ${shm}G"
  [ "$shm" -ge 90 ] && ROOT=/dev/shm || { echo "STAGING_REFUSED"; exit 3; }
fi
echo "STAGING_ROOT=$ROOT"; W=$ROOT/aukora-run; sudo mkdir -p $W && sudo chown $USER $W
export TMPDIR=$W/tmp HF_HOME=$W/hf UV_CACHE_DIR=$W/uvcache PIP_CACHE_DIR=$W/pipcache; mkdir -p $TMPDIR
echo "== env"; cd $W
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH=$HOME/.local/bin:$PATH
uv venv -q --python 3.12 .venv && source .venv/bin/activate
uv pip install -q torch --index-url https://download.pytorch.org/whl/cu128
uv pip install -q "transformers>=5.8.1" peft accelerate safetensors "huggingface_hub[hf_transfer]"
uv pip install -q flash-linear-attention 2>&1 | tail -1 || echo "fla not installed (torch fallback)"
uv pip freeze > $W/pip-freeze.txt; python -c "import torch,transformers,peft;print(torch.__version__,torch.cuda.is_available(),transformers.__version__,peft.__version__)"
echo "== model download (pinned revision)"
export HF_HUB_ENABLE_HF_TRANSFER=1
python - <<PY
import time; t=time.time()
from huggingface_hub import snapshot_download
p=snapshot_download("$REPO", revision="$REV", allow_patterns=["*.json","*.safetensors","*.jinja","*.txt","tokenizer*"])
print("MODEL_DIR", p, "download_s", round(time.time()-t,1))
PY
