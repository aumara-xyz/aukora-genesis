"""Rebuild merged weights from BASE + a saved adapter (generic rebuild_gen1.py): used to restore /dev/shm/merged_v7 from
OUT/v7_adapter (after v8_train freed /dev/shm), or to merge OUT/v8_adapter if v8_train stopped before its merge.
Refuses an existing SAVE_DIR. Usage: python v8_rebuild.py ADAPTER_DIR SAVE_DIR"""
import os, shutil, sys

from v5_common import MODEL


def main():
    ad, save = sys.argv[1], sys.argv[2]
    assert os.path.isfile(os.path.join(ad, "adapter_model.safetensors")), f"no adapter in {ad}"
    assert not os.path.exists(save), f"{save} exists; refusing to overwrite"
    import torch
    from transformers import AutoModelForImageTextToText
    from peft import PeftModel
    m = AutoModelForImageTextToText.from_pretrained(MODEL, dtype=torch.bfloat16, device_map="cuda")
    m = PeftModel.from_pretrained(m, ad).merge_and_unload()
    m.save_pretrained(save, max_shard_size="5GB")
    for f in os.listdir(MODEL):
        if f.endswith((".jinja", ".txt")) or f.startswith(("tokenizer", "preprocessor", "processor", "video_preprocessor", "generation_config", "special_tokens")):
            shutil.copy(os.path.join(MODEL, f), save)
    print("V8_REBUILT", ad, "->", save, flush=True)


if __name__ == "__main__":
    main()
