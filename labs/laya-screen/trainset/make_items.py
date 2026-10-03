"""Turn train.jsonl into the tokenized items file Laya's fine-tune script expects (--items).
Usage: ../.venv/bin/python make_items.py <laya_model_dir> [train.jsonl] [train_items.pt]
Then:  ../.venv/bin/python ../src/notebooks/laya_finetune_typed_decisions_mps.py --model-dir <laya_model_dir> \
         --items train_items.pt --device cpu --epochs 4 --micro-batch 4 --grad-accum 8 --output-dir <out>
(The script reuses an existing --items file; it only downloads its own dataset when the file is missing.
 It carves its own 10% calibration slice out of the items; dev.jsonl/test.jsonl stay untouched for threshold picking/eval.)"""
import json, sys, importlib.util, torch
from transformers import AutoTokenizer
md = sys.argv[1]; src = sys.argv[2] if len(sys.argv) > 2 else "train.jsonl"; dst = sys.argv[3] if len(sys.argv) > 3 else "train_items.pt"
spec = importlib.util.spec_from_file_location("ft", "/workspace/laya-screen/src/notebooks/laya_finetune_typed_decisions_mps.py")
ft = importlib.util.module_from_spec(spec); spec.loader.exec_module(ft)
cfg = json.load(open(md + "/rl_agent_config.json")); cfg.update({"max_len": 1024, "head_max_len": 256})
tok = AutoTokenizer.from_pretrained(md + "/tokenizer"); items = []
for line in open(src):
    r = json.loads(line); st = json.loads(r["state"]); qs = json.loads(r["questions"]); g = json.loads(r["gold"])
    for q, qd in qs.items():
        it = ft.build_training_item(tok, cfg, st, qd, g[q])
        if it: items.append(it)
torch.save(items, dst); print(len(items), "items ->", dst)
