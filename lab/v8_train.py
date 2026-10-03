"""v8 train (box, HF+PEFT): FRESH attention LoRA on BASE (not stacked on v7): same 100 targets, r16 a32, dropout 0, AdamW 1e-4
(betas .9/.999, eps 1e-8, wd 0), clip 1.0, torch seed 20261007 before LoRA init, prompt masked, HF mean loss over target tokens
per row, rows right-padded to a multiple of 128 (labels -100) - all as v7_train.py (helpers imported from it). EXACTLY 2 epochs.
Data = OUT/v8_data.json (v8_build_data.py; integrity-checked by items_sha256): kinds turn | single | replay | cp. Every row is
rendered with the chat template, enable_thinking=True, add_generation_prompt=True, from the item's messages (multi-turn for
'turn' items: the exact bounded context the model saw), then target + '<|im_end|>'. Optimizer units: each single/replay row =
1 unit; turn rows paired TURN_GROUP=2 per unit (loss/2 each) and CP rows grouped CP_GROUP=6 per unit (loss/6 each), as v7 did
for CP. Units shuffled per epoch with random.Random(SEED+epoch).
Per-kind loss and pre-clip grad-norm logging (rows and units), plus the ANSWER loss of every row: mean cross-entropy over the
target tokens after '</think>' (the final JSON + <|im_end|>), computed from the logits of the same forward pass (no extra pass).
Turn rows: the rendered prompt must tokenize to exactly the logged 'ptok' (the prompt length the model saw at collection, in
the vLLM venv); any mismatch fails (preflight included), so a template/venv rendering difference is caught on CPU.
Rows whose prompt tokenization is not a prefix of prompt+target, or longer than MAX_ROW_TOKENS, are DROPPED and counted
(the run refuses if more than 2% of rows drop).
Adapter: OUT/v8_adapter/epoch1 (diagnostic only), OUT/v8_adapter (final). Merge -> /dev/shm/merged_v8. /dev/shm holds one merged
model: if free space is short, /dev/shm/merged_v7 is deleted ONLY when --free-merged-v7 is passed (v8_run.sh passes it after the
v7 evals) AND OUT/v7_adapter matches the v7_train.json adapter hashes (v7 stays rebuildable with v8_rebuild.py).
Receipt OUT/v8_train.json.
Usage: python v8_train.py OUT DEADLINE_epoch_s [--free-merged-v7]
       python v8_train.py --preflight OUT          (CPU only: data, template, tokenization, units)"""
import collections, json, os, random, re, shutil, sys, time

from v5_common import MODEL, TEMPLATE_SHA, load_tok, sha, write
from v7_train import ASSIST, PAD_TO, file_sha, pad_id_of, padded, tree_sha

EPOCHS, SEED, LR, CP_GROUP, TURN_GROUP = 2, 20261007, 1e-4, 6, 2
MAX_ROW_TOKENS, MAX_DROP_FRAC = 12800, 0.02
SHM, SAVE, V7M = "/dev/shm", "/dev/shm/merged_v8", "/dev/shm/merged_v7"
KIND = {"turn": 0, "single": 1, "replay": 2, "cp": 3}
HERE = os.path.dirname(os.path.abspath(__file__))


def load_data(out):
    p = f"{out}/v8_data.json"; d = json.load(open(p)); items = d["items"]
    assert sha(json.dumps(items, sort_keys=True)) == d["items_sha256"], "v8_data integrity"
    rows = []
    for it in items:
        assert it["kind"] in KIND, it["kind"]
        assert it["target"].count("</think>") == 1 and "<think>" not in it["target"], ("think tags", it["id"])
        rows.append((it["kind"], it["id"], it["messages"], it["target"], it.get("ptok")))
    h = {"v8_data_items_sha256": d["items_sha256"], "v8_data_file_sha256": file_sha(p), "v8_train_py_sha256": file_sha(os.path.join(HERE, "v8_train.py")),
         "v7_train_py_sha256": file_sha(os.path.join(HERE, "v7_train.py")), "v8_data_report": d.get("report")}
    return rows, h


def build_rows(tok, rows, max_tokens=MAX_ROW_TOKENS):
    """data rows = (ids, prompt_len, kind, id, answer_offset): answer_offset = index of the first target token after '</think>'
    (None if the tokenization of prompt + target-through-'</think>' is not a prefix of the full row)."""
    chat = lambda m: tok.apply_chat_template(m, tokenize=False, add_generation_prompt=True, enable_thinking=True)
    data, gens, drops, ptok_bad, no_aoff = [], set(), collections.Counter(), [], collections.Counter()
    for kind, rid, msgs, target, ptok in rows:
        pt = chat(msgs); gen = pt[pt.rindex(ASSIST):]
        assert "</think>" not in gen, (kind, rid, gen)
        gens.add(gen)
        pid = tok(pt, add_special_tokens=False)["input_ids"]
        if kind == "turn" and ptok is not None and len(pid) != ptok: ptok_bad.append((rid, len(pid), ptok))
        ids = tok(pt + target + "<|im_end|>", add_special_tokens=False)["input_ids"]
        if ids[:len(pid)] != pid or len(ids) <= len(pid): drops[f"{kind}:prefix"] += 1; continue
        if len(ids) > max_tokens: drops[f"{kind}:too_long"] += 1; continue
        aoff = answer_offset(tok, pt, target, ids, len(pid))
        if aoff is None: no_aoff[kind] += 1
        data.append((ids, len(pid), kind, rid, aoff))
    assert not ptok_bad, f"turn prompts re-render to a different token count than the model saw ({len(ptok_bad)}): {ptok_bad[:3]}"
    assert len(gens) == 1, f"generation prompt differs across rows: {sorted(gens)[:3]}"
    assert sum(drops.values()) <= MAX_DROP_FRAC * len(rows), f"too many dropped rows: {dict(drops)} of {len(rows)}"
    tokstats = {k: {"n": sum(d[2] == k for d in data), "target_tokens": sum(len(d[0]) - d[1] for d in data if d[2] == k),
                    "answer_tokens": sum(len(d[0]) - d[4] for d in data if d[2] == k and d[4] is not None),
                    "no_answer_offset": no_aoff[k], "prompt_tokens": sum(d[1] for d in data if d[2] == k),
                    "max_len": max([len(d[0]) for d in data if d[2] == k] or [0])} for k in KIND}
    tokstats["turn"]["ptok_checked"] = sum(1 for r in rows if r[0] == "turn" and r[4] is not None)
    return data, tokstats, gens.pop(), dict(drops)


def answer_offset(tok, pt, target, ids, plen):
    """Index of the first token that starts at or after the end of '</think>' in prompt + target (a token straddling the
    boundary counts as thinking). Uses the fast tokenizer's character offsets; falls back to a token-prefix check."""
    full = pt + target + "<|im_end|>"; boundary = len(pt) + target.index("</think>") + len("</think>")
    try:
        enc = tok(full, add_special_tokens=False, return_offsets_mapping=True)
        if list(enc["input_ids"]) == list(ids):
            k = next((i for i, (a, b) in enumerate(enc["offset_mapping"]) if a >= boundary), None)
            return k if k is not None and plen < k < len(ids) else None
    except (TypeError, KeyError, NotImplementedError, ValueError):
        pass
    aid = tok(full[:boundary], add_special_tokens=False)["input_ids"]
    return len(aid) if ids[:len(aid)] == aid and plen < len(aid) < len(ids) else None


def answer_ce(logits, ids, aoff):
    """Mean CE over the answer tokens ids[aoff:] from the logits of the training forward pass (no grad, small slice)."""
    if logits is None or aoff is None or not 0 < aoff < len(ids): return None
    import torch
    with torch.no_grad():
        lg = logits[0, aoff - 1:len(ids) - 1].float()
        return float(torch.nn.functional.cross_entropy(lg, torch.tensor(ids[aoff:], device=lg.device)))


def epoch_units(data, e):
    rng = random.Random(SEED + e)
    cp = [i for i, d in enumerate(data) if d[2] == "cp"]; rng.shuffle(cp)
    tu = [i for i, d in enumerate(data) if d[2] == "turn"]; rng.shuffle(tu)
    units = ([[i] for i, d in enumerate(data) if d[2] not in ("cp", "turn")] + [tu[k:k + TURN_GROUP] for k in range(0, len(tu), TURN_GROUP)]
             + [cp[k:k + CP_GROUP] for k in range(0, len(cp), CP_GROUP)])
    rng.shuffle(units)
    return units


def check_v7_rebuildable(out):
    ad = f"{out}/v7_adapter"
    for f in ("adapter_config.json", "adapter_model.safetensors"): assert os.path.isfile(f"{ad}/{f}"), f"missing {ad}/{f}"
    ref = json.load(open(f"{out}/v7_train.json"))["adapter_sha256"]
    got = tree_sha(ad)
    assert got == ref, "OUT/v7_adapter differs from the v7_train.json adapter hashes; refusing to delete merged_v7"


def refuse_overwrite(out, save=SAVE):
    for p in (save, f"{out}/v8_adapter", f"{out}/v8_train.json"):
        assert not os.path.exists(p), f"{p} exists; refusing to overwrite (move it away and log an amendment first)"


def preflight(out, tok=None):
    refuse_overwrite(out)
    rows, hashes = load_data(out)
    tok = tok or load_tok(); data, tokstats, gen, drops = build_rows(tok, rows); pid = pad_id_of(tok)
    us = [epoch_units(data, e) for e in range(EPOCHS)]
    for u in us: assert sorted(i for x in u for i in x) == list(range(len(data))), "epoch units must cover every row once"
    print("V8_PREFLIGHT_OK train", json.dumps(tokstats), "drops", json.dumps(drops), "gen_prompt_tail", json.dumps(gen),
          "pad_id", pid, "units_per_epoch", len(us[0]), "opt_steps", sum(len(u) for u in us), "data", hashes["v8_data_items_sha256"], flush=True)
    return tokstats, len(us[0])


def default_loader(model_dir, device):
    import torch
    from transformers import AutoModelForImageTextToText
    model, info = AutoModelForImageTextToText.from_pretrained(model_dir, dtype=torch.bfloat16, device_map=device, output_loading_info=True)
    assert not info["missing_keys"], info["missing_keys"][:5]
    names = [n for n, m in model.named_modules() if isinstance(m, torch.nn.Linear) and "visual" not in n
             and (re.search(r"self_attn\.(q|k|v|o)_proj$", n) or re.search(r"linear_attn\.(in_proj_qkv|out_proj)$", n))]
    assert len(names) == 100, len(names)
    return model, names


def main(argv=None, loader=None, tok=None, save=SAVE, model_dir=MODEL, device="cuda", max_tokens=MAX_ROW_TOKENS, log=print):
    argv = sys.argv[1:] if argv is None else argv
    if argv[0] == "--preflight": return preflight(argv[1], tok)
    out, deadline = argv[0], float(argv[1]); free_v7 = "--free-merged-v7" in argv; T0 = time.time()
    if T0 > deadline: raise SystemExit("V8_TRAIN deadline already passed")
    refuse_overwrite(out, save)
    rows, hashes = load_data(out)
    import torch, transformers, peft
    from peft import LoraConfig, get_peft_model
    tok = tok or load_tok(); data, tokstats, gen, drops = build_rows(tok, rows, max_tokens); pad_id = pad_id_of(tok)
    log("V8_TRAIN data", json.dumps(tokstats), "drops", json.dumps(drops), "gen_prompt_tail", json.dumps(gen))
    model, names = (loader or default_loader)(model_dir, device)
    cuda = device == "cuda"
    torch.manual_seed(SEED)
    if cuda: torch.cuda.manual_seed_all(SEED)
    model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.0, bias="none", target_modules=names))
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False}); model.enable_input_require_grads()
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=LR, betas=(0.9, 0.999), eps=1e-8, weight_decay=0)
    init = {n: p.detach().clone() for n, p in model.named_parameters() if p.requires_grad and "lora_B" in n}
    receipt = {"stage": "training", "model": model_dir, "template_sha256": TEMPLATE_SHA, **hashes, "epochs": EPOCHS, "seed": SEED, "lr": LR,
               "base": "fresh LoRA on BASE (not stacked on v7)", "cp_group": CP_GROUP, "turn_group": TURN_GROUP, "pad_to": PAD_TO, "pad_id": pad_id, "thinking": True,
               "lora": {"r": 16, "alpha": 32, "dropout": 0.0, "targets": len(names)}, "data": tokstats, "dropped_rows": drops,
               "max_row_tokens": max_tokens, "gen_prompt_tail": gen, "deadline": deadline,
               "versions": {"torch": torch.__version__, "transformers": transformers.__version__, "peft": peft.__version__}}
    peak = (lambda: torch.cuda.max_memory_allocated() / 2**30) if cuda else (lambda: 0.0)
    model.train(); rows_log, steps_log, ep_summary, step = [], [], [], 0
    for e in range(EPOCHS):
        units = epoch_units(data, e)
        for k, unit in enumerate(units):
            if time.time() > deadline: raise RuntimeError(f"deadline during training (epoch {e + 1} unit {k})")
            t = time.time(); kind = data[unit[0]][2]
            for i in unit:
                ids, pl, kd, rid, aoff = data[i]; assert kd == kind
                xi, yi = padded(ids, pl, pad_id)
                o = model(input_ids=torch.tensor([xi], device=device), labels=torch.tensor([yi], device=device))
                loss = o.loss; al = answer_ce(getattr(o, "logits", None), ids, aoff); del o
                if not torch.isfinite(loss): raise RuntimeError(f"non-finite loss at {kind} {rid}")
                (loss / len(unit)).backward()
                rows_log.append([e + 1, step, KIND[kind], round(loss.item(), 5), len(ids), None if al is None else round(al, 5)])
            gn = float(torch.nn.utils.clip_grad_norm_(params, 1.0))
            if gn != gn or gn == float("inf"): raise RuntimeError(f"non-finite grad norm at step {step}")
            opt.step(); opt.zero_grad(set_to_none=True)
            if cuda: torch.cuda.synchronize()
            steps_log.append([e + 1, step, KIND[kind], len(unit), round(gn, 5), round(time.time() - t, 2)]); step += 1
            if k % 25 == 0 or k == len(units) - 1:
                last = steps_log[-25:]; s0 = last[0][1]
                rl = {kn: [r[3] for r in rows_log if r[1] >= s0 and r[2] == kc] for kn, kc in KIND.items()}
                al_ = {kn: [r[5] for r in rows_log if r[1] >= s0 and r[2] == kc and r[5] is not None] for kn, kc in KIND.items()}
                gl = {kn: [r[4] for r in last if r[2] == kc] for kn, kc in KIND.items()}
                fa = lambda v: f"{sum(v) / len(v):.4f}" if v else "na"
                log(f"V8_TRAIN e{e + 1} unit {k + 1}/{len(units)} " + " ".join(
                    f"{kn} loss {sum(rl[kn]) / len(rl[kn]):.4f} ans {fa(al_[kn])} gn {sum(gl[kn]) / len(gl[kn]):.3f}(n{len(gl[kn])})" for kn in KIND if gl[kn])
                    + f" s {time.time() - T0:.0f} peakGiB {peak():.1f}")
        er = [r for r in rows_log if r[0] == e + 1]; es = [r for r in steps_log if r[0] == e + 1]
        mean = lambda v: round(sum(v) / len(v), 5) if v else None
        ep_summary.append({"epoch": e + 1, "optimizer_steps": len(es), "rows": len(er),
                           **{f"{kn}_mean_loss": mean([r[3] for r in er if r[2] == kc]) for kn, kc in KIND.items()},
                           **{f"{kn}_mean_answer_loss": mean([r[5] for r in er if r[2] == kc and r[5] is not None]) for kn, kc in KIND.items()},
                           **{f"{kn}_mean_grad_norm": mean([r[4] for r in es if r[2] == kc]) for kn, kc in KIND.items()},
                           "step_s_sum": round(sum(r[5] for r in es), 1)})
        dst = f"{out}/v8_adapter" if e == EPOCHS - 1 else f"{out}/v8_adapter/epoch{e + 1}"
        model.save_pretrained(dst); log("V8_TRAIN saved", dst, json.dumps(ep_summary[-1]))
    delta = sum((p.detach() - init[n]).abs().sum().item() for n, p in model.named_parameters() if n in init)
    receipt.update({"stage": "adapter_saved", "optimizer_steps": len(steps_log), "rows_processed": len(rows_log),
                    "row_log_cols": ["epoch", "opt_step", "kind(0=turn,1=single,2=replay,3=cp)", "loss", "seq_len", "answer_loss(after </think>)"],
                    "row_log": rows_log,
                    "step_log_cols": ["epoch", "opt_step", "kind", "rows", "grad_norm_preclip", "step_s"], "step_log": steps_log,
                    "epoch_summary": ep_summary, "lora_B_abs_delta": delta, "peak_GiB": round(peak(), 1),
                    "adapter_sha256": tree_sha(f"{out}/v8_adapter"), "train_wall_s": round(time.time() - T0, 1),
                    "note": "epoch1 adapter is diagnostic only"})
    write(f"{out}/v8_train.json", receipt)
    assert delta > 0
    if time.time() > deadline: raise RuntimeError("deadline before merge (adapter saved; merge later with v8_rebuild.py)")
    need = sum(os.path.getsize(os.path.join(model_dir, f)) for f in os.listdir(model_dir) if f.endswith(".safetensors")) + 2**30
    shm_dir = os.path.dirname(save) or "."
    shm = {"need_bytes": need, "free_before": shutil.disk_usage(shm_dir).free, "deleted_merged_v7": False, "free_merged_v7_flag": free_v7}
    if shm["free_before"] < need and free_v7 and os.path.isdir(V7M):
        check_v7_rebuildable(out); shutil.rmtree(V7M); shm["deleted_merged_v7"] = True
    shm["free_after"] = shutil.disk_usage(shm_dir).free
    receipt["shm"] = shm; write(f"{out}/v8_train.json", receipt)
    if shm["free_after"] < need: raise RuntimeError(f"{shm_dir} free {shm['free_after']} < need {need}; adapter saved, merge not attempted")
    model.eval(); merged = model.merge_and_unload()
    merged.save_pretrained(save, max_shard_size="5GB")
    for f in os.listdir(model_dir):
        if f.endswith((".jinja", ".txt")) or f.startswith(("tokenizer", "preprocessor", "processor", "video_preprocessor", "generation_config", "special_tokens")):
            shutil.copy(os.path.join(model_dir, f), save)
    receipt.update({"stage": "merged", "merged_dir": save, "merged_bytes": sum(os.path.getsize(os.path.join(save, f)) for f in os.listdir(save)),
                    "wall_s": round(time.time() - T0, 1)})
    write(f"{out}/v8_train.json", receipt)
    log("V8_TRAIN_DONE opt_steps", len(steps_log), "rows", len(rows_log), "delta", round(delta, 1), "epochs", json.dumps(ep_summary), "shm", json.dumps(shm))
    return receipt


if __name__ == "__main__":
    main()
