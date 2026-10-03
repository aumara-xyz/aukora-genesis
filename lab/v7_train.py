"""v7 train (box, HF+PEFT): fresh attention LoRA (r16 a32, same 100 targets) on BASE; data = v5_corpus (50 verified thinking
traces) + v7_cp.json (600 consequence-prediction items). ALL rows use enable_thinking=True (CP targets are explicit
thinking-mode simulation traces + "</think>" + answer, same template path as the traces). Exactly 2 epochs, AdamW 1e-4,
clip 1.0, prompt masked, HF mean loss over target tokens per example. Optimizer step units: each trace = 1 unit (1 row);
CP rows are grouped CP_GROUP=6 per unit (gradient accumulation, loss/6 each) -> per epoch 50 trace + 100 CP units = 150
optimizer steps (300 total; 1300 forward/backward rows). Units shuffled per epoch with random.Random(SEED+epoch); torch
seeded with SEED before LoRA init. Rows right-padded to a multiple of PAD_TO (labels -100; causal model -> no effect on
real positions) to bound the number of distinct kernel shapes.
Adapter: OUT/v7_adapter/epoch1 after epoch 1 (DIAGNOSTIC ONLY, not an H1 arm), OUT/v7_adapter after epoch 2. Merge ->
/dev/shm/merged_v7 (deletes /dev/shm/merged_gen1 ONLY if /dev/shm free < 70 GiB, after checking OUT/v5_adapter is intact).
Receipt OUT/v7_train.json.
Usage: python v7_train.py <OUT> <DEADLINE_epoch_s>      (cwd = lab, for v7_cp.json)
       python v7_train.py --preflight <OUT>            (CPU only, no model load: data + template + tokenization checks)"""
import json, os, re, shutil, sys, time, random
from v5_common import *

EPOCHS, SEED, LR, CP_GROUP, PAD_TO = 2, 20261007, 1e-4, 6, 128
SHM, SAVE, GEN1 = "/dev/shm", "/dev/shm/merged_v7", "/dev/shm/merged_gen1"
SHM_MIN_FREE = 70 * 2**30
KIND = {"trace": 0, "cp": 1}
ASSIST = "<|im_start|>assistant"


def file_sha(p): return sha(open(p, "rb").read())


def tree_sha(d):
    return {os.path.relpath(os.path.join(r, f), d): file_sha(os.path.join(r, f)) for r, _, fs in os.walk(d) for f in sorted(fs)}


def load_data(out, cp_path="v7_cp.json"):
    """Pure-python: load + integrity-check both corpora. Returns (rows, receipt_hashes); row = (kind, id, prompt, target)."""
    v5 = json.load(open(f"{out}/v5_corpus.json")); corpus = v5["corpus"]
    assert len(corpus) == 50 and sha(json.dumps(corpus, sort_keys=True)) == v5["sha256"], "v5_corpus integrity"
    cp = json.load(open(cp_path)); items = cp["items"]
    assert len(items) == 600 and sha(json.dumps(items, sort_keys=True)) == cp["sha256"], "v7_cp integrity"
    assert cp.get("thinking") is True and len(items) % CP_GROUP == 0, "v7_cp must be the thinking-mode build"
    rows = [("trace", ex["id"], ex["prompt"], ex["target"]) for ex in corpus] + [("cp", it["id"], it["prompt"], it["target"]) for it in items]
    for kind, rid, _, target in rows:
        assert target.count("</think>") == 1 and "<think>" not in target, f"target think tags {kind} {rid}"
    h = {"v5_corpus_sha256": v5["sha256"], "v5_corpus_file_sha256": file_sha(f"{out}/v5_corpus.json"),
         "v7_cp_sha256": cp["sha256"], "v7_cp_file_sha256": file_sha(cp_path), "v7_train_py_sha256": file_sha(os.path.abspath(__file__))}
    return rows, h


def pad_id_of(tok):
    p = getattr(tok, "pad_token_id", None)
    if p is None: p = tok.convert_tokens_to_ids("<|endoftext|>")
    assert isinstance(p, int) and p >= 0, f"no usable pad id ({p})"
    return p


def build_data(tok, rows):
    """CPU only. Tokenize every row with the thinking-ON generation prompt and check: one identical generation-prompt tail
    for all rows (no '</think>' in it), exact prompt-prefix tokenization. Returns (data, tokstats, gen_tail)."""
    chat = lambda p: tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=True)
    data, gens = [], set()
    for kind, rid, prompt, target in rows:
        pt = chat(prompt); gen = pt[pt.rindex(ASSIST):]
        assert "</think>" not in gen, (kind, rid, gen)
        gens.add(gen)
        pid = tok(pt, add_special_tokens=False)["input_ids"]
        ids = tok(pt + target + "<|im_end|>", add_special_tokens=False)["input_ids"]
        assert ids[:len(pid)] == pid and len(ids) > len(pid), (kind, rid)
        data.append((ids, len(pid), kind, rid))
    assert len(gens) == 1, f"generation prompt differs across rows: {sorted(gens)[:3]}"
    tokstats = {k: {"n": sum(d[2] == k for d in data), "target_tokens": sum(len(d[0]) - d[1] for d in data if d[2] == k),
                    "max_len": max(len(d[0]) for d in data if d[2] == k),
                    "distinct_padded_lens": len({-(-len(d[0]) // PAD_TO) * PAD_TO for d in data if d[2] == k})} for k in KIND}
    return data, tokstats, gens.pop()


def padded(ids, pl, pad_id):
    """(input_ids, labels) as lists: right-pad to a multiple of PAD_TO; prompt and pad positions labelled -100."""
    n = -(-len(ids) // PAD_TO) * PAD_TO
    return ids + [pad_id] * (n - len(ids)), [-100] * pl + ids[pl:] + [-100] * (n - len(ids))


def epoch_units(data, e):
    rng = random.Random(SEED + e)
    cp = [i for i, d in enumerate(data) if d[2] == "cp"]; rng.shuffle(cp)
    assert len(cp) % CP_GROUP == 0
    units = [[i] for i, d in enumerate(data) if d[2] == "trace"] + [cp[k:k + CP_GROUP] for k in range(0, len(cp), CP_GROUP)]
    rng.shuffle(units)
    return units


def check_gen1_rebuildable(out):
    """gen-1 = BASE + OUT/v5_adapter (rebuild_gen1.py). Adapter files must exist and match the v5_train.json receipt if present."""
    ad = f"{out}/v5_adapter"
    for f in ("adapter_config.json", "adapter_model.safetensors"): assert os.path.isfile(f"{ad}/{f}"), f"missing {ad}/{f}"
    if os.path.exists(f"{out}/v5_train.json"):
        ref = json.load(open(f"{out}/v5_train.json"))["adapter_sha256"]
        for f in ("adapter_config.json", "adapter_model.safetensors"): assert file_sha(f"{ad}/{f}") == ref[f], f"v5_adapter/{f} sha mismatch"


def refuse_overwrite(out):
    for p in (SAVE, f"{out}/v7_adapter", f"{out}/v7_train.json"):
        assert not os.path.exists(p), f"{p} exists; refusing to overwrite (move it away and log an amendment first)"


def preflight(out):
    check_gen1_rebuildable(out); refuse_overwrite(out)
    rows, hashes = load_data(out)
    tok = load_tok(); data, tokstats, gen = build_data(tok, rows); pid = pad_id_of(tok)
    units = [epoch_units(data, e) for e in range(EPOCHS)]
    for us in units:
        assert len(us) == 150 and sorted(i for u in us for i in u) == list(range(len(data))), "epoch units must cover every row once"
    print("V7_PREFLIGHT_OK train", json.dumps(tokstats), "gen_prompt_tail", json.dumps(gen), "opens_think", "<think>" in gen,
          "pad_id", pid, "opt_steps", sum(len(u) for u in units), json.dumps(hashes), flush=True)


def main():
    if sys.argv[1] == "--preflight": return preflight(sys.argv[2])
    out, deadline = sys.argv[1], float(sys.argv[2]); T0 = time.time()
    if T0 > deadline: raise SystemExit("V7_TRAIN deadline already passed")
    refuse_overwrite(out); check_gen1_rebuildable(out)
    rows, hashes = load_data(out)
    import torch, transformers, peft
    from transformers import AutoModelForImageTextToText
    from peft import LoraConfig, get_peft_model
    tok = load_tok(); data, tokstats, gen = build_data(tok, rows); pad_id = pad_id_of(tok)
    print("V7_TRAIN data", json.dumps(tokstats), "gen_prompt_tail", json.dumps(gen), flush=True)
    model, info = AutoModelForImageTextToText.from_pretrained(MODEL, dtype=torch.bfloat16, device_map="cuda", output_loading_info=True)
    assert not info["missing_keys"], info["missing_keys"][:5]
    names = [n for n, m in model.named_modules() if isinstance(m, torch.nn.Linear) and "visual" not in n
             and (re.search(r"self_attn\.(q|k|v|o)_proj$", n) or re.search(r"linear_attn\.(in_proj_qkv|out_proj)$", n))]
    assert len(names) == 100, len(names)
    torch.manual_seed(SEED); torch.cuda.manual_seed_all(SEED)
    model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.0, bias="none", target_modules=names))
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False}); model.enable_input_require_grads()
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=LR, betas=(0.9, 0.999), eps=1e-8, weight_decay=0)
    init = {n: p.detach().clone() for n, p in model.named_parameters() if p.requires_grad and "lora_B" in n}
    receipt = {"stage": "training", "model": MODEL, "template_sha256": TEMPLATE_SHA, **hashes, "epochs": EPOCHS, "seed": SEED, "lr": LR,
               "seed_covers": "python unit shuffle (SEED+epoch) and torch init of lora_A (torch.manual_seed(SEED))",
               "cp_group": CP_GROUP, "pad_to": PAD_TO, "pad_id": pad_id, "thinking": True,
               "lora": {"r": 16, "alpha": 32, "targets": len(names)}, "data": tokstats, "gen_prompt_tail": gen,
               "versions": {"torch": torch.__version__, "transformers": transformers.__version__, "peft": peft.__version__}, "deadline": deadline}
    model.train(); rows_log, steps_log, ep_summary, step = [], [], [], 0
    for e in range(EPOCHS):
        units = epoch_units(data, e)
        for k, unit in enumerate(units):
            if time.time() > deadline: raise RuntimeError(f"deadline during training (epoch {e + 1} unit {k})")
            t = time.time(); kind = data[unit[0]][2]
            for i in unit:
                ids, pl, kd, rid = data[i]; assert kd == kind
                xi, yi = padded(ids, pl, pad_id)
                loss = model(input_ids=torch.tensor([xi], device="cuda"), labels=torch.tensor([yi], device="cuda")).loss
                if not torch.isfinite(loss): raise RuntimeError(f"non-finite loss at {kind} {rid}")
                (loss / len(unit)).backward()
                rows_log.append([e + 1, step, KIND[kind], round(loss.item(), 5), len(ids)])
            gn = float(torch.nn.utils.clip_grad_norm_(params, 1.0))
            if gn != gn or gn == float("inf"): raise RuntimeError(f"non-finite grad norm at step {step}")
            opt.step(); opt.zero_grad(set_to_none=True); torch.cuda.synchronize()
            steps_log.append([e + 1, step, KIND[kind], len(unit), round(gn, 5), round(time.time() - t, 2)]); step += 1
            if k % 25 == 0 or k == len(units) - 1:
                last = steps_log[-25:]; s0 = last[0][1]
                rl = {kn: [r[3] for r in rows_log if r[1] >= s0 and r[2] == kc] for kn, kc in KIND.items()}
                gl = {kn: [r[4] for r in last if r[2] == kc] for kn, kc in KIND.items()}
                print(f"V7_TRAIN e{e + 1} unit {k + 1}/{len(units)} " + " ".join(
                      f"{kn} loss {sum(rl[kn]) / len(rl[kn]):.4f} gn {sum(gl[kn]) / len(gl[kn]):.3f}(n{len(gl[kn])})" for kn in KIND if gl[kn])
                      + f" s {time.time() - T0:.0f} peakGiB {torch.cuda.max_memory_allocated() / 2**30:.1f}", flush=True)
        er = [r for r in rows_log if r[0] == e + 1]; es = [r for r in steps_log if r[0] == e + 1]
        mean = lambda v: round(sum(v) / max(1, len(v)), 5)
        ep_summary.append({"epoch": e + 1, "optimizer_steps": len(es), "rows": len(er),
                           **{f"{kn}_mean_loss": mean([r[3] for r in er if r[2] == kc]) for kn, kc in KIND.items()},
                           **{f"{kn}_mean_grad_norm": mean([r[4] for r in es if r[2] == kc]) for kn, kc in KIND.items()},
                           "step_s_sum": round(sum(r[5] for r in es), 1)})
        dst = f"{out}/v7_adapter" if e == EPOCHS - 1 else f"{out}/v7_adapter/epoch{e + 1}"
        model.save_pretrained(dst); print("V7_TRAIN saved", dst, json.dumps(ep_summary[-1]), flush=True)
    delta = sum((p.detach() - init[n]).abs().sum().item() for n, p in model.named_parameters() if n in init)
    receipt.update({"stage": "adapter_saved", "steps": len(steps_log), "optimizer_steps": len(steps_log), "rows_processed": len(rows_log),
                    "losses": [r[3] for r in rows_log],
                    "row_log_cols": ["epoch", "opt_step", "kind(0=trace,1=cp)", "loss", "seq_len"], "row_log": rows_log,
                    "step_log_cols": ["epoch", "opt_step", "kind(0=trace,1=cp)", "rows", "grad_norm_preclip", "step_s"], "step_log": steps_log,
                    "epoch_summary": ep_summary, "lora_B_abs_delta": delta, "peak_GiB": round(torch.cuda.max_memory_allocated() / 2**30, 1),
                    "adapter_sha256": tree_sha(f"{out}/v7_adapter"), "train_wall_s": round(time.time() - T0, 1),
                    "note": "epoch1 adapter is diagnostic only; any eval of it is exploratory and cannot change the H1 verdict"})
    write(f"{out}/v7_train.json", receipt)
    assert delta > 0
    if time.time() > deadline: raise RuntimeError("deadline before merge (adapter saved; merge later from OUT/v7_adapter)")
    # merge -> /dev/shm/merged_v7
    need = sum(os.path.getsize(os.path.join(MODEL, f)) for f in os.listdir(MODEL) if f.endswith(".safetensors")) + 2**30
    shm = {"need_bytes": need, "free_before": shutil.disk_usage(SHM).free, "deleted_gen1": False}
    if shm["free_before"] < SHM_MIN_FREE:
        check_gen1_rebuildable(out)
        if os.path.isdir(GEN1): shutil.rmtree(GEN1); shm["deleted_gen1"] = True
    shm["free_after"] = shutil.disk_usage(SHM).free
    receipt["shm"] = shm; write(f"{out}/v7_train.json", receipt)
    if shm["free_after"] < need: raise RuntimeError(f"/dev/shm free {shm['free_after']} < need {need}; adapter saved, merge not attempted")
    model.eval(); merged = model.merge_and_unload()
    merged.save_pretrained(SAVE, max_shard_size="5GB")
    for f in os.listdir(MODEL):
        if f.endswith((".jinja", ".txt")) or f.startswith(("tokenizer", "preprocessor", "processor", "video_preprocessor", "generation_config", "special_tokens")):
            shutil.copy(os.path.join(MODEL, f), SAVE)
    receipt.update({"stage": "merged", "merged_dir": SAVE, "merged_bytes": sum(os.path.getsize(os.path.join(SAVE, f)) for f in os.listdir(SAVE)),
                    "wall_s": round(time.time() - T0, 1)})
    write(f"{out}/v7_train.json", receipt)
    print("V7_TRAIN_DONE opt_steps", len(steps_log), "rows", len(rows_log), "delta", round(delta, 1), "epochs", json.dumps(ep_summary),
          "shm", json.dumps(shm), flush=True)


if __name__ == "__main__":
    main()
