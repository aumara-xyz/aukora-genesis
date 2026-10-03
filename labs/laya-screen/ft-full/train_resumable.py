"""Resumable wrapper around src/notebooks/laya_finetune_typed_decisions_mps.py (same model, loss, optimizer, schedule, shuffles).
Adds (RT3 prep, 2026-10-03):
  * a full training-state checkpoint every --ckpt-every optimizer updates AND at every epoch end:
    fp32 model state_dict + AdamW optimizer state + cosine scheduler + epoch/micro-batch position + running loss + torch/python RNG
  * every write is atomic: tmp file/dir in the same folder -> fsync -> os.replace/rename (a kill mid-write never corrupts the last good state)
  * --resume: continue from <output-dir>/resume/state.pt (refuses if the run fingerprint - items file, epochs, batch sizes - differs)
  * done-marker <output-dir>/TRAINING_DONE written after the final export, so run.sh stops re-launching.
Checkpoints are saved only on optimizer-update boundaries (gradients are zero there), so resume is exact up to nondeterministic kernels."""
import argparse, gc, hashlib, importlib.util, json, math, os, random, shutil, sys, time
from pathlib import Path
import torch
spec = importlib.util.spec_from_file_location("ft", "/workspace/laya-screen/src/notebooks/laya_finetune_typed_decisions_mps.py")
ft = importlib.util.module_from_spec(spec); spec.loader.exec_module(ft)

def fsync_dir(d):
    fd = os.open(str(d), os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)
def atomic_torch_save(obj, path):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True); tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    with open(tmp, "wb") as f: torch.save(obj, f); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path); fsync_dir(path.parent)
def atomic_json(obj, path):
    path = Path(path); tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    with open(tmp, "w") as f: json.dump(obj, f, indent=2); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path); fsync_dir(path.parent)
def atomic_export(model, tokenizer, cfg, output_dir, epoch, final=False):
    """upstream save_checkpoint into a tmp dir, then swap it in by rename (old copy removed only after the swap)."""
    out = Path(output_dir); dest = out if final else out / "checkpoint_latest"
    if final:   # final export writes files into output_dir itself: write each file atomically via a staging dir
        stage = out / f".final-stage-{os.getpid()}"; shutil.rmtree(stage, ignore_errors=True)
        ft.save_checkpoint(model, tokenizer, cfg, stage, epoch, final=True)
        for p in stage.iterdir():
            target = out / p.name
            if p.is_dir():
                old = out / f".old-{p.name}-{os.getpid()}"
                if target.exists(): os.rename(target, old)
                os.rename(p, target); shutil.rmtree(old, ignore_errors=True)
            else: os.replace(p, target)
        shutil.rmtree(stage, ignore_errors=True); fsync_dir(out); return
    stage = out / f".ckpt-stage-{os.getpid()}"; shutil.rmtree(stage, ignore_errors=True); stage.mkdir(parents=True)
    ft.save_checkpoint(model, tokenizer, cfg, stage, epoch, final=True)   # final=True -> writes straight into `stage`
    atomic_json({"epoch": epoch, "final": False}, stage / "checkpoint_meta.json")
    old = out / f".old-checkpoint_latest-{os.getpid()}"
    if dest.exists(): os.rename(dest, old)
    os.rename(stage, dest); fsync_dir(out); shutil.rmtree(old, ignore_errors=True)

def fingerprint(args, n_items):
    h = hashlib.sha256(open(args.items, "rb").read(1 << 20)).hexdigest()[:16]
    return {"items": os.path.abspath(args.items), "items_head_sha": h, "n_items": n_items, "epochs": args.epochs, "micro_batch": args.micro_batch,
            "grad_accum": args.grad_accum, "calib_max": args.calib_max, "model_dir": os.path.abspath(args.model_dir)}

def train(args, model_dir, device):
    cfg = json.load(open(Path(model_dir) / "rl_agent_config.json"))
    cfg.update({"max_tokens_per_batch": 2048, "max_len": 1024, "head_max_len": 256})
    if not args.no_checkpointing: cfg["gradient_checkpointing"] = True
    tokenizer = ft.AutoTokenizer.from_pretrained(Path(model_dir) / "tokenizer")
    model = ft.build_model(cfg, encoder_dir=Path(model_dir) / "encoder")
    model.load_state_dict(ft.load_file(str(Path(model_dir) / "model.safetensors")), strict=True); model.float()
    if not args.no_checkpointing:
        model.encoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False}); model.head_checkpointing = True
    model.to(device).train()
    all_items = torch.load(args.items, map_location="cpu", weights_only=False)
    order = list(range(len(all_items))); random.Random(20260922).shuffle(order)
    n_calib = min(args.calib_max, len(all_items) // 10)
    calib_items = [all_items[i] for i in sorted(order[:n_calib])]; train_items = [all_items[i] for i in sorted(order[n_calib:])]
    enc = [p for n, p in model.named_parameters() if "encoder." in n]; head = [p for n, p in model.named_parameters() if "encoder." not in n]
    optimizer = torch.optim.AdamW([{"params": enc, "lr": 2.5e-5}, {"params": head, "lr": 1e-4}], weight_decay=0.01)
    updates = max(1, math.ceil(len(train_items) / args.micro_batch / args.grad_accum) * args.epochs)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=updates, eta_min=1e-6)
    fp = fingerprint(args, len(all_items)); state_path = Path(args.output_dir) / "resume" / "state.pt"
    start_epoch, start_batch, total_loss, n_updates = 0, 0, 0.0, 0
    if args.resume and state_path.exists():
        st = torch.load(state_path, map_location="cpu", weights_only=False)
        if st["fingerprint"] != fp: sys.exit(f"REFUSING --resume: run fingerprint differs\n saved {st['fingerprint']}\n now   {fp}")
        model.load_state_dict(st["model"]); optimizer.load_state_dict(st["optimizer"]); scheduler.load_state_dict(st["scheduler"])
        start_epoch, start_batch, total_loss, n_updates = st["epoch"], st["batch"], st["total_loss"], st["n_updates"]
        torch.set_rng_state(st["torch_rng"]); random.setstate(st["py_rng"])
        print(f"RESUMED from {state_path}: epoch {start_epoch + 1}, micro-batch {start_batch}, update {n_updates}/{updates}", flush=True)
    elif args.resume: print("--resume: no saved state yet, starting fresh", flush=True)
    def save_state(epoch, batch):
        atomic_torch_save({"fingerprint": fp, "model": model.state_dict(), "optimizer": optimizer.state_dict(), "scheduler": scheduler.state_dict(),
                           "epoch": epoch, "batch": batch, "total_loss": total_loss, "n_updates": n_updates, "torch_rng": torch.get_rng_state(),
                           "py_rng": random.getstate(), "saved_at": time.strftime("%Y-%m-%d %H:%M:%S")}, state_path)
        print(f"state saved: epoch {epoch + 1} micro-batch {batch} update {n_updates}", flush=True)
    print(f"Device: {device}; training items {len(train_items)}; calibration {len(calib_items)}; updates {updates}; ckpt every {args.ckpt_every} updates", flush=True)
    for epoch in range(args.epochs):
        random.Random(42 + epoch).shuffle(train_items)          # in-place, cumulative - replayed for skipped epochs too
        if epoch < start_epoch: continue
        sigma = 0.4 + (0.1 - 0.4) * epoch / max(1, args.epochs - 1)
        skip = start_batch if epoch == start_epoch else 0
        if skip == 0: total_loss = 0.0
        optimizer.zero_grad(set_to_none=True); n_batches = skip
        for start in range(skip * args.micro_batch, len(train_items), args.micro_batch):
            chunk = train_items[start:start + args.micro_batch]
            ids, attention, positions, mask, target, qtype = [t.to(device) for t in ft.collate(chunk, tokenizer.pad_token_id)]
            logits, activation = model(ids, attention, positions, mask, qtype); logits = logits.float()
            k = mask.sum(-1, keepdim=True).float()
            eps = torch.randn((4,) + logits.shape, device=device) * sigma * mask; eps = (eps - eps.sum(-1, keepdim=True) / k) * mask
            noisy = logits.detach().unsqueeze(0) + eps; probs = torch.softmax(noisy.masked_fill(~mask, -1e4), -1)
            with torch.no_grad():
                reward = ft.proper_reward(probs, target.unsqueeze(0), qtype, mask, w_sph=0.75, w_rps=1.0)
                adv = reward - reward.mean(0, keepdim=True); adv = adv / (adv.std() + 1e-6)
            logp = -(((noisy - logits.unsqueeze(0)) ** 2) * mask).sum(-1) / (2 * sigma ** 2)
            loss = (-(adv * logp).mean() - (target * torch.log_softmax(logits.masked_fill(~mask, -1e4), -1)).sum(-1).mean() + 0.0 * activation.sum()) / args.grad_accum
            loss.backward(); n_batches += 1; total_loss += loss.item() * args.grad_accum
            if n_batches % args.grad_accum == 0 or start + args.micro_batch >= len(train_items):
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); optimizer.step(); scheduler.step(); optimizer.zero_grad(set_to_none=True); n_updates += 1
                if args.ckpt_every and n_updates % args.ckpt_every == 0 and start + args.micro_batch < len(train_items): save_state(epoch, n_batches)
            if n_batches % 100 == 0: print(f"epoch {epoch + 1}/{args.epochs}, step {n_batches}, loss={loss.item() * args.grad_accum:.4f}", flush=True)
        print(f"Epoch {epoch + 1}/{args.epochs} complete; avg_loss={total_loss / max(1, n_batches):.4f}", flush=True)
        atomic_export(model, tokenizer, cfg, args.output_dir, epoch + 1)
        total_loss = 0.0; save_state(epoch + 1, 0)
    print("Running temperature calibration ...", flush=True)
    model.eval(); samples = [[] for _ in range(3)]
    with torch.no_grad():
        for start in range(0, len(calib_items), args.micro_batch):
            chunk = calib_items[start:start + args.micro_batch]
            ids, attention, positions, mask, target, qtype = [t.to(device) for t in ft.collate(chunk, tokenizer.pad_token_id)]
            logits, _ = model(ids, attention, positions, mask, qtype)
            for i, item in enumerate(chunk): samples[item["qtype"]].append((logits[i, :len(item["markers"])].cpu(), item["target"]))
    temps = [ft.fit_temperature(g) if g else 1.2 for g in samples]
    atomic_export(model, tokenizer, cfg, args.output_dir, args.epochs, final=True)
    cfg.update({"fine_tuned": True, "model_name": "laya-typed-decisions", "temperature": temps}); cfg.pop("temperature_by_options", None)
    atomic_json(cfg, Path(args.output_dir) / "rl_agent_config.json"); atomic_json(cfg, Path(args.output_dir) / "checkpoint_latest" / "rl_agent_config.json")
    atomic_json({"finished_at": time.strftime("%Y-%m-%d %H:%M:%S"), "temperatures": temps, "fingerprint": fp}, Path(args.output_dir) / "TRAINING_DONE")
    print(f"Model saved to {args.output_dir}; temperatures {temps}", flush=True)

def main():
    p = argparse.ArgumentParser(description="Resumable Laya fine-tune (CPU/MPS)")
    p.add_argument("--model-dir", required=True); p.add_argument("--output-dir", required=True); p.add_argument("--items", required=True)
    p.add_argument("--epochs", type=int, default=4); p.add_argument("--micro-batch", type=int, default=2); p.add_argument("--grad-accum", type=int, default=16)
    p.add_argument("--calib-max", type=int, default=400); p.add_argument("--device", choices=["auto", "mps", "cpu"], default="cpu")
    p.add_argument("--no-checkpointing", action="store_true"); p.add_argument("--ckpt-every", type=int, default=10, help="save full state every N optimizer updates")
    p.add_argument("--resume", action="store_true", help="continue from <output-dir>/resume/state.pt if present")
    a = p.parse_args()
    if (Path(a.output_dir) / "TRAINING_DONE").exists() and a.resume: print("TRAINING_DONE present; nothing to do"); return
    torch.set_float32_matmul_precision("high"); device = ft.choose_device(a.device)
    model_dir = ft.prepare_model(a.model_dir); ft.prepare_items(model_dir, a.items)
    train(a, model_dir, device); gc.collect()

if __name__ == "__main__": main()
