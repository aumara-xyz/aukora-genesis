"""Ornith-35B Sokoban dojo, generation 1. Stages write receipts to OUT; any exit writes outcome.json.
Usage: python runner.py --model DIR --out DIR --deadline EPOCH [--smoke]"""
import argparse, hashlib, json, os, random, re, sys, time, traceback
import torch
from sokoban import solve, verify, parse, canonical_id, generate
from prompts import solve_prompt, revise_prompt, propose_prompt, FORECAST

TEMPLATE_SHA = "182e77dd83bd8e9ca818b240b82e28f243762cd5dda32e6eef327df7b1cd107e"
ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--deadline", type=float, required=True); ap.add_argument("--smoke", action="store_true")
ap.add_argument("--batch", type=int, default=32)
ap.add_argument("--device", default="cuda"); ap.add_argument("--unpinned-template-for-smoke", action="store_true")
ap.add_argument("--smoke-oracle-corpus", action="store_true", help="SMOKE ONLY: inject BFS answers so the train path runs")
A = ap.parse_args()
os.makedirs(A.out, exist_ok=True)
T0 = time.time()
STATE = {"stage": "init", "t0": T0}
sha = lambda b: hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()

def receipt(name, obj):
    obj = dict(obj, stage=name, wall_s=round(time.time() - T0, 1), utc=time.strftime("%FT%TZ", time.gmtime()))
    with open(os.path.join(A.out, f"{name}.json"), "w") as f: json.dump(obj, f, indent=1)
    print(f"[{obj['wall_s']}s] {name}: " + json.dumps({k: v for k, v in obj.items() if not isinstance(v, (list, dict))})[:300], flush=True)

class Deadline(Exception): pass
def guard(stage):
    STATE["stage"] = stage
    if time.time() > A.deadline: raise Deadline(stage)
    if os.path.exists(os.path.join(A.out, "STOP_REQUEST")): raise Deadline("stop_request@" + stage)

def gpu():
    if not torch.cuda.is_available(): return {}
    return {"alloc_GiB": round(torch.cuda.memory_allocated() / 2**30, 2), "peak_GiB": round(torch.cuda.max_memory_allocated() / 2**30, 2)}

def main():
    from transformers import AutoTokenizer, AutoModelForCausalLM
    import transformers, peft
    guard("load")
    tok = AutoTokenizer.from_pretrained(A.model)
    tok.padding_side = "left"
    tmpl = tok.chat_template if isinstance(tok.chat_template, str) else None
    t_ok = tmpl is not None and (sha(tmpl) == TEMPLATE_SHA or sha(tmpl + "\n") == TEMPLATE_SHA)
    if not t_ok:  # force the pinned standalone template
        p = os.path.join(A.model, "chat_template.jinja")
        if os.path.exists(p) and sha(open(p, "rb").read()) == TEMPLATE_SHA:
            tok.chat_template = open(p).read(); t_ok = True
    if not t_ok and not A.unpinned_template_for_smoke: raise RuntimeError("chat template hash mismatch")
    t = time.time()
    dkw = {"dtype": torch.bfloat16} if int(transformers.__version__.split(".")[0]) >= 5 else {"torch_dtype": torch.bfloat16}
    # Checkpoint keys are model.language_model.* (ConditionalGeneration); load that class natively, require no missing keys.
    from transformers import AutoModelForImageTextToText
    try:
        model, info = AutoModelForImageTextToText.from_pretrained(A.model, device_map=A.device, output_loading_info=True, **dkw)
    except ValueError as e:
        print("ImageTextToText not applicable, using CausalLM:", repr(e)[:200], flush=True)
        model, info = AutoModelForCausalLM.from_pretrained(A.model, device_map=A.device, output_loading_info=True, **dkw)
    missing = list(info.get("missing_keys", []))
    if missing: raise RuntimeError(f"missing keys on load ({len(missing)}): {missing[:5]}")
    unexpected = len(info.get("unexpected_keys", []))
    model.eval()
    receipt("00_load", {"load_s": round(time.time() - t, 1), "class": type(model).__name__, "unexpected_keys": unexpected, "transformers": transformers.__version__,
                        "peft": peft.__version__, "torch": torch.__version__, "template_ok": t_ok, **gpu()})

    def chat(prompts):
        return [tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=False) for p in prompts]

    @torch.no_grad()
    def gen(prompts, max_new, sample=False, n=1, seed=20261003):
        outs = []
        texts = chat(prompts)
        for i in range(0, len(texts), A.batch):
            guard(STATE["stage"])
            enc = tok(texts[i:i + A.batch], return_tensors="pt", padding=True).to(A.device)
            kw = dict(max_new_tokens=max_new, num_beams=1, pad_token_id=tok.pad_token_id)
            if sample:
                torch.manual_seed(seed + i)
                kw.update(do_sample=True, temperature=0.6, top_p=0.95, top_k=20, num_return_sequences=n)
            else:
                kw.update(do_sample=False)
            o = model.generate(**enc, **kw)
            dec = tok.batch_decode(o[:, enc["input_ids"].shape[1]:], skip_special_tokens=True)
            outs += [dec[j * n:(j + 1) * n] for j in range(len(dec) // n)] if n > 1 else dec
        return outs

    def plan_of(text):
        try:
            d = json.loads(text.strip())
            return d["moves"] if isinstance(d, dict) and set(d) == {"moves"} and isinstance(d["moves"], str) else None
        except Exception: return None

    def evaluate(tag, cases):
        guard(tag); t = time.time()
        raw = gen([solve_prompt(c["board"]) for c in cases], 256)
        res = []
        for c, r in zip(cases, raw):
            p = plan_of(r); v = verify(c["board"], p) if p is not None else "FORMAT"
            res.append({"id": c["id"], "solved": v == "OK", "verdict": v, "raw": r})
        receipt(tag, {"solved": sum(x["solved"] for x in res), "n": len(res), "gen_s": round(time.time() - t, 1), **gpu(), "cases": res})
        return res

    holdout = json.load(open("holdout.json"))["cases"]
    if A.smoke: holdout = holdout[:4]
    p0 = evaluate("01_P0_eval", holdout)
    p0_solved = sum(x["solved"] for x in p0)
    if p0_solved >= 28: return finish("NO_HEADROOM")

    # Dojo task pool: model-proposed boards (measured, valid novel ones kept) + procedural boards (distinct seed).
    guard("02_pool"); t = time.time()
    hold_ids = {c["canonical_id"] for c in holdout}
    n_prop, n_proc, k = (4, 8, 2) if A.smoke else (32, 64, 4)
    props = gen([propose_prompt()] * n_prop, 160, sample=True)
    pool, prop_log, seen = [], [], set(hold_ids)
    for r in props:
        b = r.strip().strip("`").strip("\n")
        try: parse(b); sol, st = solve(b)
        except Exception as e: prop_log.append({"raw": r, "verdict": "INVALID:" + str(e)[:60]}); continue
        cid = canonical_id(b)
        verdict = "DUPLICATE" if cid in seen else st
        prop_log.append({"raw": r, "verdict": verdict, "oracle_len": len(sol) if sol else None})
        if verdict == "SOLVED": seen.add(cid); pool.append({"id": f"M{len(pool):02d}", "board": b, "src": "model", "oracle_len": len(sol)})
    rng = random.Random(9_20261003)
    while sum(1 for p in pool if p["src"] == "proc") < n_proc:
        b = generate(rng); cid = canonical_id(b)
        if cid in seen: continue
        sol, st = solve(b)
        if st == "SOLVED" and 4 <= len(sol) <= 48:
            seen.add(cid); pool.append({"id": f"G{len(pool):02d}", "board": b, "src": "proc", "oracle_len": len(sol)})
    receipt("02_pool", {"proposed": len(props), "model_valid_novel": sum(p["src"] == "model" for p in pool),
                        "procedural": n_proc, "gen_s": round(time.time() - t, 1), "proposals": prop_log, "pool": pool})

    # Attempts: k sampled drafts per task; failed tasks get one greedy revision on the first failed draft.
    guard("03_attempts"); t = time.time()
    drafts = gen([solve_prompt(p["board"]) for p in pool], 256, sample=True, n=k)
    attempts, need_rev = [], []
    for p, ds in zip(pool, drafts):
        ok = [plan_of(d) for d in ds if plan_of(d) is not None and verify(p["board"], plan_of(d)) == "OK"]
        a = {"id": p["id"], "drafts": ds, "draft_verdicts": [verify(p["board"], plan_of(d)) if plan_of(d) else "FORMAT" for d in ds],
             "accepted": min(ok, key=len) if ok else None, "via": "draft" if ok else None, "revision": "NOT_RUN"}
        attempts.append(a)
        if not ok: need_rev.append((p, a))
    revs = gen([revise_prompt(p["board"], a["drafts"][0], a["draft_verdicts"][0]) for p, a in need_rev], 256) if need_rev else []
    for (p, a), r in zip(need_rev, revs):
        pl = plan_of(r); v = verify(p["board"], pl) if pl else "FORMAT"
        a["revision"] = {"raw": r, "verdict": v}
        if v == "OK": a["accepted"], a["via"] = pl, "revision"
    acc = [(p, a) for p, a in zip(pool, attempts) if a["accepted"]]
    receipt("03_attempts", {"tasks": len(pool), "accepted": len(acc), "via_revision": sum(a["via"] == "revision" for _, a in acc),
                            "gen_s": round(time.time() - t, 1), "attempts": attempts})
    if A.smoke_oracle_corpus:
        assert A.smoke, "oracle corpus is smoke-only"
        for p, a in zip(pool, attempts):
            if not a["accepted"]: a["accepted"], a["via"] = solve(p["board"])[0], "SMOKE_ORACLE"
        acc = [(p, a) for p, a in zip(pool, attempts) if a["accepted"]]
    min_corpus = 2 if A.smoke else 8
    if len(acc) < min_corpus: return finish("NO_ELIGIBLE_CORPUS")
    acc = sorted(acc, key=lambda x: (x[1]["via"] != "revision", x[0]["id"]))[:48]
    corpus = [{"id": p["id"], "prompt": solve_prompt(p["board"]), "target": json.dumps({"moves": a["accepted"]})} for p, a in acc]
    corpus_sha = sha(json.dumps(corpus, sort_keys=True))
    epochs = 1 if A.smoke else 3
    order = [i for e in range(epochs) for i in random.Random(e + 20261003).sample(range(len(corpus)), len(corpus))]
    receipt("04_corpus_sealed", {"n": len(corpus), "corpus_sha256": corpus_sha, "order_sha256": sha(json.dumps(order)), "corpus": corpus, "order": order})

    guard("05_forecast")
    fprompt = FORECAST.format(p0_solved=p0_solved, accepted_count=len(corpus), epochs=epochs)
    fraw = gen([fprompt], 64)[0]
    fval = int(fraw.strip()) if re.fullmatch(r"(?:[0-9]|[12][0-9]|3[0-2])", fraw.strip()) else None
    receipt("05_forecast", {"prompt_sha256": sha(fprompt), "raw": fraw, "raw_sha256": sha(fraw), "forecast": fval,
                            "valid": fval is not None})
    if fval is None: return finish("INVALID_FORECAST")

    # Train fresh attention-only LoRA.
    guard("06_train")
    from peft import LoraConfig, get_peft_model
    names = [n for n, m in model.named_modules() if isinstance(m, torch.nn.Linear) and "visual" not in n and "vision" not in n
             and (re.search(r"self_attn\.(q|k|v|o)_proj$", n) or re.search(r"linear_attn\.(in_proj_qkv|out_proj)$", n))]
    if not names: raise RuntimeError("no LoRA targets found")
    model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.0, bias="none", target_modules=names, init_lora_weights=True))
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    model.gradient_checkpointing_enable(); model.enable_input_require_grads(); model.config.use_cache = False
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=1e-4, betas=(0.9, 0.999), eps=1e-8, weight_decay=0)
    init = {n: p.detach().clone() for n, p in model.named_parameters() if p.requires_grad and "lora_B" in n}
    losses, t = [], time.time()
    model.train()
    for step, i in enumerate(order):
        guard("06_train")
        ex = corpus[i]
        ptxt = chat([ex["prompt"]])[0]
        full = ptxt + ex["target"] + tok.eos_token
        pid = tok(ptxt, add_special_tokens=False)["input_ids"]; ids = tok(full, add_special_tokens=False)["input_ids"]
        assert ids[:len(pid)] == pid and len(ids) <= 1024, "prefix/length gate"
        x = torch.tensor([ids], device=A.device); y = x.clone(); y[:, :len(pid)] = -100
        loss = model(input_ids=x, labels=y).loss
        if not torch.isfinite(loss): raise RuntimeError(f"non-finite loss at step {step}")
        loss.backward()
        torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0)
        opt.step(); opt.zero_grad(set_to_none=True)
        losses.append(round(loss.item(), 5))
        if step % 16 == 0: print(f"step {step}/{len(order)} loss {losses[-1]} {gpu()}", flush=True)
        if (step + 1) % len(corpus) == 0:
            ep = (step + 1) // len(corpus); model.save_pretrained(os.path.join(A.out, f"adapter_epoch{ep}"))
    delta = sum((p.detach() - init[n]).abs().sum().item() for n, p in model.named_parameters() if n in init)
    receipt("06_train", {"steps": len(order), "targets": len(names), "trainable_params": trainable, "train_s": round(time.time() - t, 1),
                         "lora_B_abs_delta": delta, "losses": losses, "target_names": names, **gpu()})
    if not delta > 0: raise RuntimeError("adapter did not change")

    # Reload saved final adapter onto the exact parent and evaluate P1.
    guard("07_reload")
    from peft import PeftModel
    base = model.unload() if hasattr(model, "unload") else model.get_base_model()
    del model; torch.cuda.empty_cache()
    ad = os.path.join(A.out, f"adapter_epoch{epochs}")
    model = PeftModel.from_pretrained(base, ad); model.eval(); model.config.use_cache = True
    asha = {f: sha(open(os.path.join(ad, f), "rb").read()) for f in sorted(os.listdir(ad))}
    receipt("07_reload", {"adapter": ad, "files_sha256": asha})
    p1 = evaluate("08_P1_eval", holdout)
    return finish("COMPLETE", p0=p0, p1=p1, forecast=fval)

def finish(outcome, p0=None, p1=None, forecast=None):
    o = {"outcome": outcome}
    if p0 and p1:
        b = sum(1 for x, y in zip(p0, p1) if not x["solved"] and y["solved"])
        c = sum(1 for x, y in zip(p0, p1) if x["solved"] and not y["solved"])
        from math import comb
        n = b + c; pval = sum(comb(n, j) for j in range(b, n + 1)) / 2 ** n if n else 1.0
        s1 = sum(y["solved"] for y in p1)
        o.update(b=b, c=c, p_one_sided=pval, verdict="PASS" if pval <= 0.05 else "FAIL",
                 p0_solved=sum(x["solved"] for x in p0), p1_solved=s1,
                 forecast=forecast, forecast_grade="HIT" if forecast == s1 else "MISS", forecast_abs_err=abs(forecast - s1))
    receipt("outcome", o)
    return o

if __name__ == "__main__":
    try:
        main()
    except Deadline as e:
        receipt("outcome", {"outcome": "INCOMPLETE_DEADLINE", "at": str(e)})
    except Exception as e:
        receipt("outcome", {"outcome": "INCOMPLETE_ERROR", "at": STATE["stage"], "error": repr(e)[:2000], "tb": traceback.format_exc()[-4000:]})
        sys.exit(1)
