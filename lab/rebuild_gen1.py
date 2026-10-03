"""Rebuild gen-1 merged weights exactly from base + saved v5_adapter (lineage restore)."""
import os, shutil, sys, torch
from v5_common import *
from transformers import AutoModelForImageTextToText
from peft import PeftModel
out, save = sys.argv[1], sys.argv[2]
m = AutoModelForImageTextToText.from_pretrained(MODEL, dtype=torch.bfloat16, device_map="cuda")
m = PeftModel.from_pretrained(m, f"{out}/v5_adapter").merge_and_unload()
shutil.rmtree(save, ignore_errors=True); m.save_pretrained(save, max_shard_size="5GB")
for f in os.listdir(MODEL):
    if f.endswith((".jinja", ".txt")) or f.startswith(("tokenizer", "preprocessor", "processor", "video_preprocessor", "generation_config", "special_tokens")):
        shutil.copy(os.path.join(MODEL, f), save)
print("GEN1_REBUILT", flush=True)
