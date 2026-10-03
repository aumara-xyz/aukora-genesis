"""v5 stage B (HF+PEFT): fresh attention LoRA on self-generated verified thinking traces; save adapter; merge -> /dev/shm/merged."""
import json, os, re, shutil, sys, time, random, torch
from v5_common import *

def main():
    out, deadline, BASE, TAG, SAVE = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5]; T0 = time.time()
    from transformers import AutoModelForImageTextToText
    from peft import LoraConfig, get_peft_model
    tok = load_tok()
    corpus = json.load(open(f"{out}/{TAG}_corpus.json"))["corpus"]
    model, info = AutoModelForImageTextToText.from_pretrained(BASE, dtype=torch.bfloat16, device_map="cuda", output_loading_info=True)
    assert not info["missing_keys"], info["missing_keys"][:5]
    if BASE.startswith("/dev/shm/"): shutil.rmtree(BASE)   # free RAM; reconstructible from base + saved adapters
    names = [n for n, m in model.named_modules() if isinstance(m, torch.nn.Linear) and "visual" not in n
             and (re.search(r"self_attn\.(q|k|v|o)_proj$", n) or re.search(r"linear_attn\.(in_proj_qkv|out_proj)$", n))]
    assert len(names) == 100, len(names)
    model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.0, bias="none", target_modules=names))
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False}); model.enable_input_require_grads()
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=1e-4, betas=(0.9, 0.999), eps=1e-8, weight_decay=0)
    chat = lambda p: tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True)
    data = []
    for ex in corpus:
        pt = chat(ex["prompt"]); pid = tok(pt, add_special_tokens=False)["input_ids"]
        ids = tok(pt + ex["target"] + "<|im_end|>", add_special_tokens=False)["input_ids"]
        assert ids[:len(pid)] == pid
        data.append((ids, len(pid)))
    init = {n: p.detach().clone() for n, p in model.named_parameters() if p.requires_grad and "lora_B" in n}
    model.train(); losses, times = [], []
    def one(i):
        ids, pl = data[i]; x = torch.tensor([ids], device="cuda"); y = x.clone(); y[:, :pl] = -100
        t = time.time(); loss = model(input_ids=x, labels=y).loss
        if not torch.isfinite(loss): raise RuntimeError("non-finite loss")
        loss.backward(); torch.nn.utils.clip_grad_norm_(params, 1.0); opt.step(); opt.zero_grad(set_to_none=True)
        torch.cuda.synchronize(); times.append(time.time() - t); losses.append(round(loss.item(), 5))
    order1 = random.Random(20261003).sample(range(len(data)), len(data))
    for i in order1[:3]: one(i)
    per_tok = sum(times[1:]) / sum(len(data[i][0]) for i in order1[1:3])   # step 1 excluded (kernel compile warmup)
    proj_epoch = per_tok * sum(len(d[0]) for d in data)
    epochs = 2 if 2 * proj_epoch <= 2700 else 1           # preregistered rule
    print(f"step_s {times} proj_epoch_s {proj_epoch:.0f} epochs {epochs} peakGiB {torch.cuda.max_memory_allocated()/2**30:.1f}", flush=True)
    order = order1[3:] + [i for e in range(1, epochs) for i in random.Random(20261003 + e).sample(range(len(data)), len(data))]
    for k, i in enumerate(order):
        if time.time() > deadline: raise RuntimeError("deadline during training")
        one(i)
        if k % 8 == 0: print(f"step {k+4}/{len(order)+3} loss {losses[-1]} s {times[-1]:.1f}", flush=True)
    delta = sum((p.detach() - init[n]).abs().sum().item() for n, p in model.named_parameters() if n in init)
    model.save_pretrained(f"{out}/{TAG}_adapter")
    write(f"{out}/{TAG}_train.json", {"steps": len(losses), "epochs": epochs, "losses": losses, "step_s": [round(t, 2) for t in times],
                                   "lora_B_abs_delta": delta, "peak_GiB": round(torch.cuda.max_memory_allocated() / 2**30, 1),
                                   "adapter_sha256": {f: sha(open(f"{out}/{TAG}_adapter/{f}", "rb").read()) for f in os.listdir(f"{out}/{TAG}_adapter")},
                                   "wall_s": round(time.time() - T0, 1)})
    assert delta > 0
    model.eval(); merged = model.merge_and_unload()
    shutil.rmtree(SAVE, ignore_errors=True)
    merged.save_pretrained(SAVE, max_shard_size="5GB")
    for f in os.listdir(MODEL):
        if f.endswith((".jinja", ".txt")) or f.startswith(("tokenizer", "preprocessor", "processor", "video_preprocessor", "generation_config", "special_tokens")):
            shutil.copy(os.path.join(MODEL, f), SAVE)
    print("STAGE_B_DONE", len(losses), epochs, delta, flush=True)

if __name__ == "__main__":
    main()
