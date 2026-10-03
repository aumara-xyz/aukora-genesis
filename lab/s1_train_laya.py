"""S1 value net training (Mac, MPS): Laya encoder (convaiinnovations/laya, ModernBERT-large 28 layers, native
transformers classes only; see s1_value.py) + solvable head (2-way) + distance-bucket head (5-way, masked on unsolvable).
Input: s1_common.encode_cells (interior 6x6, one token per tile, rows separated by '|'; 43 tokens incl. CLS/SEP).
Memory/time caps for a shared 16 GB Mac: embeddings + bottom layers frozen and kept in fp16 (exact Laya values, no
autograd graph); top --train-layers layers + final norm + heads trained in fp32; batch 32; MPS memory fraction capped;
AdamW lr 3e-5 (wd 0.01), 100 warmup steps then linear decay to 0 over the PLANNED steps = min(1 epoch, budget/step time
measured on steps 5-25); hard stop at --minutes of training.
After training: save s1_laya/ (s1_value.save), RELOAD it from disk in fp32 and evaluate the reloaded artifact:
val -> temperatures (solvable head, dist head; NLL grid fit), test -> accuracy, AUROC (solvable = positive), ECE 15 bins
(top-label; also positive-class reliability ECE) before/after temperature scaling, NLL, Brier, bucket accuracy, plus
secondary subsets (hard = unsolvable states no sound deadlock rule detects) and a rule-only baseline. Latency per state on
MPS at batch 64 and batch 8. Writes s1_laya_eval.json (with H-S1a verdict per s1_PREREG.md if present).
Since the 2026-10-03 review (s1_PREREG amendment A1), non-gating extras are reported next to the preregistered gate:
the value net's REAL input population (test states no sound rule flags = what s1_lookahead sends to the net), its
'push'-source part (closest to the lookahead's post-push children), per-source AUROC, the combined system score
(P = 0 when a rule fires, else net P), and a post-hoc temperature fitted on val[not rule_dead] (never written to the
artifact).
Guards: nothing is overwritten (--out and the eval file must not exist, in every mode); --dry-run needs an explicit --out
outside lab/; --total-minutes bounds the whole run from process start (training budget = min(--minutes, total - load
time - --eval-reserve-s); latency and non-gating extras are skipped when time is short).
--eval-only: re-evaluate an EXISTING artifact (inference only; nothing written into it). Its shas are checked against
the sealed receipt (--expect-receipt, default lab/s1_laya_eval.json) before anything else.
Usage: python s1_train_laya.py [--data DIR] [--out DIR] [--minutes 28] [--total-minutes 35] [--dry-run --out DIR]
       python s1_train_laya.py --eval-only [--out lab/s1_laya] [--eval-out FILE]"""
import argparse, json, math, os, random, sys, time

import torch
import torch.nn.functional as F

from s1_common import LAB, BUCKET_NAMES, sha_file, write_json
import s1_value as V

CODE = ("s1_train_laya.py", "s1_value.py", "s1_common.py", "sokoban.py")


def read_jsonl(path, limit=None):
    rows = []
    with open(path) as f:
        for line in f:
            rows.append(json.loads(line))
            if limit and len(rows) >= limit: break
    return rows


def tensors(tok, rows, enc):
    ids, am = V.tokenize(tok, [r["board"] for r in rows], enc)
    ys = torch.tensor([1 if r["solvable"] else 0 for r in rows])
    yd = torch.tensor([r["bucket"] if r["solvable"] else -100 for r in rows])
    return ids.to(torch.int32), am.to(torch.int8), ys, yd


# ---------------------------------------------------------------- metrics (no sklearn)
def auroc(scores, labels):
    pairs = sorted(zip(scores, labels))
    n = len(pairs); ranks = [0.0] * n; i = 0
    while i < n:
        j = i
        while j + 1 < n and pairs[j + 1][0] == pairs[i][0]: j += 1
        for k in range(i, j + 1): ranks[k] = (i + j) / 2 + 1
        i = j + 1
    npos = sum(l for _, l in pairs); nneg = n - npos
    if npos == 0 or nneg == 0: return None
    return (sum(r for r, (_, l) in zip(ranks, pairs) if l) - npos * (npos + 1) / 2) / (npos * nneg)


def ece(conf, correct, bins=15):
    n = len(conf); tot = 0.0
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        idx = [i for i, c in enumerate(conf) if (c > lo or (b == 0 and c >= lo)) and c <= hi]
        if idx: tot += abs(sum(correct[i] for i in idx) / len(idx) - sum(conf[i] for i in idx) / len(idx)) * len(idx) / n
    return tot


def fit_temperature(logits, y):
    """argmin_T NLL(softmax(logits/T), y) on a log grid (0.05..20) + local refinement. y may contain -100 (ignored)."""
    m = y != -100; lg, yy = logits[m].float(), y[m]
    nll = lambda T: F.cross_entropy(lg / T, yy).item()
    grid = [math.exp(math.log(0.05) + i * (math.log(20) - math.log(0.05)) / 399) for i in range(400)]
    best = min(grid, key=nll)
    fine = [best * math.exp(-0.02 + 0.04 * i / 80) for i in range(81)]
    best = min(fine, key=nll)
    return best, nll(1.0), nll(best)


def subset_metrics(p, y, idx):
    """AUROC / ECE (top-label, positive-class) / acc on a subset of indices."""
    pp, yy = [p[i] for i in idx], [y[i] for i in idx]
    if not pp: return {"n": 0}
    conf = [max(q, 1 - q) for q in pp]; correct = [int((q > 0.5) == bool(t)) for q, t in zip(pp, yy)]
    return {"n": len(pp), "n_unsolvable": len(pp) - sum(yy), "auroc": auroc(pp, yy), "acc": sum(correct) / len(pp),
            "ece15_toplabel": ece(conf, correct), "ece15_posclass": ece(pp, yy)}


def net_input_metrics(p, y, rows):
    """Non-gating (amendment A1): the population the lookahead actually sends to the net, its push-source part, per-source
    AUROC, and the combined system score (rule -> P=0, else net P)."""
    net = [i for i, r in enumerate(rows) if not r["rule_dead"]]
    push = [i for i in net if rows[i]["src"] == "push"]
    system = [0.0 if r["rule_dead"] else q for q, r in zip(p, rows)]
    return {"net_input_not_rule_dead": subset_metrics(p, y, net), "push_and_not_rule_dead": subset_metrics(p, y, push),
            "system_score_auroc": auroc(system, y),
            "by_src": {s: subset_metrics(p, y, [i for i, r in enumerate(rows) if r["src"] == s]) for s in sorted({r["src"] for r in rows})}}


def solv_metrics(logits, ys, T, rows=None):
    p = torch.softmax(logits.float() / T, -1)[:, 1].tolist(); y = ys.tolist()
    conf = [max(q, 1 - q) for q in p]; correct = [int((q > 0.5) == bool(t)) for q, t in zip(p, y)]
    out = {"n": len(y), "acc": sum(correct) / len(y), "auroc": auroc(p, y), "ece15_toplabel": ece(conf, correct),
           "ece15_posclass": ece(p, y), "nll": F.cross_entropy(logits.float() / T, ys).item(),
           "brier": sum((q - t) ** 2 for q, t in zip(p, y)) / len(y)}
    if rows is not None:                                   # secondary subsets
        hard = [i for i, r in enumerate(rows) if r["solvable"] or not r["rule_dead"]]
        out["auroc_hard_subset"] = auroc([p[i] for i in hard], [y[i] for i in hard])
        out["n_hard_unsolvable"] = sum(1 for r in rows if not r["solvable"] and not r["rule_dead"])
        out["auroc_rule_only_baseline"] = auroc([0.0 if r["rule_dead"] else 1.0 for r in rows], y)
        out["auroc_by_src"] = {}
        for s in sorted({r["src"] for r in rows}):
            ii = [i for i, r in enumerate(rows) if r["src"] == s]
            out["auroc_by_src"][s] = auroc([p[i] for i in ii], [y[i] for i in ii])
        out["acc_on_rule_dead"] = sum(correct[i] for i, r in enumerate(rows) if r["rule_dead"]) / max(1, sum(r["rule_dead"] for r in rows))
        out["non_gating"] = net_input_metrics(p, y, rows)
    return out


def dist_metrics(logits, yd, T, rows):
    m = yd != -100; lg = logits[m].float() / T; yy = yd[m]
    pr = torch.softmax(lg, -1); pred = pr.argmax(-1)
    conf = pr.max(-1).values.tolist(); correct = (pred == yy).int().tolist()
    mid = torch.tensor([2.5, 6.5, 12.5, 24.5, 40.0]); ed = (pr * mid).sum(-1).tolist()
    true = [r["dist"] for r in rows if r["solvable"]]
    return {"n": int(m.sum()), "acc": sum(correct) / len(correct), "within_one_bucket": float(((pred - yy).abs() <= 1).float().mean()),
            "nll": F.cross_entropy(lg, yy).item(), "ece15_toplabel": ece(conf, correct),
            "mae_expected_dist_moves": sum(abs(a - b) for a, b in zip(ed, true)) / len(true),
            "confusion": [[int(((yy == i) & (pred == j)).sum()) for j in range(5)] for i in range(5)]}


@torch.no_grad()
def logits_of(model, ids, am, device, bs=128):
    model.eval(); outs, outd = [], []
    for i in range(0, len(ids), bs):
        ls, ld = model(ids[i:i + bs].long().to(device), am[i:i + bs].long().to(device))
        outs.append(ls.float().cpu()); outd.append(ld.float().cpu())
    return torch.cat(outs), torch.cat(outd)


@torch.no_grad()
def latency(model, ids, am, device, bs, reps=10):
    x, m = ids[:bs].long().to(device), am[:bs].long().to(device)
    sync = (lambda: torch.mps.synchronize()) if device == "mps" else (lambda: None)
    for _ in range(3): model(x, m)
    sync(); ts = []
    for _ in range(reps):
        t = time.time(); model(x, m); sync(); ts.append(time.time() - t)
    ts.sort(); return {"batch": bs, "median_batch_ms": round(1000 * ts[len(ts) // 2], 2), "per_state_ms": round(1000 * ts[len(ts) // 2] / bs, 3)}


def evaluate(model, data, rows, device, deadline, with_extras=True):
    """val -> temperatures (preregistered: all val states), test metrics before/after; non-gating extras incl. a post-hoc
    temperature fitted on val[not rule_dead] (reported only; never written to the artifact). Latency and extras are skipped
    when less than 90 s remain before the total-time deadline."""
    ev = {"skipped": []}
    lv = logits_of(model, *data["val"][:2], device); lt = logits_of(model, *data["test"][:2], device)
    Ts, nll1_s, nllT_s = fit_temperature(lv[0], data["val"][2])
    Td, nll1_d, nllT_d = fit_temperature(lv[1], data["val"][3])
    ev["temperature"] = {"solvable": Ts, "dist": Td, "val_nll_solv": [nll1_s, nllT_s], "val_nll_dist": [nll1_d, nllT_d]}
    ev["test_solvable_before"] = solv_metrics(lt[0], data["test"][2], 1.0, rows["test"])
    ev["test_solvable_after"] = solv_metrics(lt[0], data["test"][2], Ts, rows["test"])
    ev["val_solvable_after"] = solv_metrics(lv[0], data["val"][2], Ts)
    ev["test_dist_before"] = dist_metrics(lt[1], data["test"][3], 1.0, rows["test"])
    ev["test_dist_after"] = dist_metrics(lt[1], data["test"][3], Td, rows["test"])
    if with_extras and deadline - time.time() > 90:
        vnet = torch.tensor([not r["rule_dead"] for r in rows["val"]])
        Tn, nll1_n, nllT_n = fit_temperature(lv[0][vnet], data["val"][2][vnet])
        p = torch.softmax(lt[0].float() / Tn, -1)[:, 1].tolist()
        ev["posthoc_net_temperature"] = {"T_fit_on_val_not_rule_dead": Tn, "val_nll": [nll1_n, nllT_n],
                                         "test": net_input_metrics(p, data["test"][2].tolist(), rows["test"]),
                                         "note": "POST-HOC, non-gating, not written to the artifact"}
    else:
        ev["skipped"].append("posthoc_net_temperature")
    if deadline - time.time() > 90:
        ev["latency_" + device] = [latency(model, *data["test"][:2], device, 64), latency(model, *data["test"][:2], device, 8)]
    else:
        ev["skipped"].append("latency")
    return ev


def h_s1a(ev):
    after = ev["test_solvable_after"]; ng = after.get("non_gating", {})
    return {"rule": "test AUROC >= 0.90 AND test ECE15 (top-label, after temperature) <= 0.05",
            "auroc": after["auroc"], "ece15_toplabel_after": after["ece15_toplabel"],
            "verdict": "PASS" if (after["auroc"] or 0) >= 0.90 and after["ece15_toplabel"] <= 0.05 else "FAIL",
            "non_gating_A1": {"auroc_by_src": after.get("auroc_by_src"),
                              "net_input_not_rule_dead": ng.get("net_input_not_rule_dead"),
                              "push_and_not_rule_dead": ng.get("push_and_not_rule_dead"),
                              "system_score_auroc": ng.get("system_score_auroc"),
                              "note": "operative value-net quality = net-input population (amendment A1); the gate above is as preregistered"}}


def eval_only(a, eval_out, T0, deadline):
    """Inference-only re-evaluation of an existing artifact (nothing is written into it)."""
    rec = json.load(open(a.expect_receipt))
    meta_path = os.path.join(a.out, "meta.json")
    assert sha_file(meta_path) == rec["artifact_meta_sha256"], "artifact meta.json != sealed receipt artifact_meta_sha256"
    for f, h in rec["artifact_files_sha256"].items():
        assert sha_file(os.path.join(a.out, f)) == h, f"artifact {f} != sealed receipt"
    torch.set_num_threads(a.threads)
    device = V.pick_device(a.device)
    if device == "mps": torch.mps.set_per_process_memory_fraction(a.mem_frac)
    man_path = os.path.join(a.data, "s1_states_manifest.json")
    assert sha_file(man_path) == rec["data_manifest_sha256"], "data manifest != the one the artifact was trained/evaluated on"
    manifest = json.load(open(man_path))
    for f, h in manifest["files"].items():
        assert sha_file(os.path.join(a.data, f)) == h, f"data sha mismatch {f}"
    rows = {"val": read_jsonl(os.path.join(a.data, "s1_states_val.jsonl")), "test": read_jsonl(os.path.join(a.data, "s1_states_test.jsonl"))}
    model, tok, meta = V.load(a.out, device=device)
    data = {k: tensors(tok, v, meta.get("encoding", "cells")) for k, v in rows.items()}
    t = time.time(); ev = evaluate(model, data, rows, device, deadline); eval_s = round(time.time() - t, 1)
    ref = meta.get("reference_scores") or {}
    got = [x["p_solvable"] for x in V.Scorer(model, tok, meta, device=device)(ref.get("boards", []))]
    sealed = rec["eval"]["test_solvable_after"]
    repro = {"temperature_solvable_refit_minus_sealed": ev["temperature"]["solvable"] - meta["temperature_solvable"],
             "test_auroc_minus_sealed": (ev["test_solvable_after"]["auroc"] or 0) - sealed["auroc"],
             "test_ece_after_minus_sealed": ev["test_solvable_after"]["ece15_toplabel"] - sealed["ece15_toplabel"],
             "reference_scores_max_abs_dp": max((abs(x - y) for x, y in zip(got, ref.get("p_solvable", []))), default=None)}
    res = {"evidence_class": f"RAN ({device}; inference-only re-evaluation of the sealed artifact; extras POST-HOC, non-gating)",
           "artifact": a.out, "artifact_meta_sha256": rec["artifact_meta_sha256"], "artifact_files_sha256": rec["artifact_files_sha256"],
           "sealed_receipt": os.path.basename(a.expect_receipt), "sealed_receipt_sha256": sha_file(a.expect_receipt),
           "code_sha256": {f: sha_file(os.path.join(LAB, f)) for f in CODE},
           "versions": {"torch": torch.__version__, "transformers": __import__("transformers").__version__}, "device": device,
           "eval": ev, "H_S1a_recomputed": h_s1a(ev), "reproduction_vs_sealed": repro, "eval_s": eval_s,
           "wall_s": round(time.time() - T0, 1), "within_total_cap": time.time() <= deadline}
    write_json(eval_out, res)
    print("S1_REEVAL", json.dumps({"H_S1a": res["H_S1a_recomputed"], "repro": repro, "wall_s": res["wall_s"]}), "->", eval_out, flush=True)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=LAB)
    ap.add_argument("--out", default=os.path.join(LAB, "s1_laya"))
    ap.add_argument("--eval-out", default=None)
    ap.add_argument("--minutes", type=float, default=28.0)
    ap.add_argument("--bs", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-5)
    ap.add_argument("--train-layers", type=int, default=6)
    ap.add_argument("--enc", default="cells")
    ap.add_argument("--device", default=None)
    ap.add_argument("--mem-frac", type=float, default=0.55)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--seed", type=int, default=1020261003)
    ap.add_argument("--dry-run", action="store_true", help="tiny: 12 steps on 384 train rows, eval on 256 val/test rows")
    ap.add_argument("--total-minutes", type=float, default=35.0, help="hard cap on this process's wall time (from start)")
    ap.add_argument("--eval-reserve-s", type=float, default=360.0, help="wall time kept free for save/reload/eval")
    ap.add_argument("--eval-only", action="store_true", help="re-evaluate the existing artifact at --out (inference only)")
    ap.add_argument("--expect-receipt", default=os.path.join(LAB, "s1_laya_eval.json"))
    a = ap.parse_args()
    T0 = time.time()
    deadline = T0 + a.total_minutes * 60
    out_abs = os.path.abspath(a.out)
    if a.eval_only:
        eval_out = a.eval_out or os.path.join(os.path.dirname(out_abs), "s1_laya_reeval.json")
        assert os.path.isdir(out_abs), f"--eval-only: {out_abs} does not exist"
        assert os.path.abspath(eval_out) != os.path.abspath(a.expect_receipt), "--eval-only must not overwrite the sealed receipt"
    else:
        eval_out = a.eval_out or os.path.join(os.path.dirname(out_abs), "s1_laya_eval.json")
        assert not os.path.exists(out_abs), f"{out_abs} exists; refusing to overwrite the artifact (any mode)"
        if a.dry_run:
            assert "--out" in sys.argv, "--dry-run needs an explicit --out (outside lab/)"
            assert os.path.commonpath([out_abs, LAB]) != LAB, "--dry-run --out must be outside lab/ (protects lab/s1_laya)"
            assert os.path.commonpath([os.path.abspath(eval_out), LAB]) != LAB, "--dry-run eval file must be outside lab/"
    assert not os.path.exists(eval_out), f"{eval_out} exists; refusing to overwrite"
    if a.eval_only:
        return eval_only(a, eval_out, T0, deadline)
    torch.manual_seed(a.seed); random.seed(a.seed); torch.set_num_threads(a.threads)
    device = V.pick_device(a.device)
    if device == "mps": torch.mps.set_per_process_memory_fraction(a.mem_frac)
    man_path = os.path.join(a.data, "s1_states_manifest.json")
    manifest = json.load(open(man_path))
    for f, h in manifest["files"].items():
        assert sha_file(os.path.join(a.data, f)) == h, f"data sha mismatch {f}"
    lim = (384, 256) if a.dry_run else (None, None)
    rows = {"train": read_jsonl(os.path.join(a.data, "s1_states_train.jsonl"), lim[0]),
            "val": read_jsonl(os.path.join(a.data, "s1_states_val.jsonl"), lim[1]),
            "test": read_jsonl(os.path.join(a.data, "s1_states_test.jsonl"), lim[1])}
    prereg = os.path.join(LAB, "s1_PREREG.md")
    head = {"prereg_sha256": sha_file(prereg) if os.path.exists(prereg) else None, "data_manifest_sha256": sha_file(man_path),
            "data_files_sha256": manifest["files"], "code_sha256": {f: sha_file(os.path.join(LAB, f)) for f in CODE},
            "versions": {"torch": torch.__version__, "transformers": __import__("transformers").__version__}, "device": device,
            "dry_run": a.dry_run, "args": vars(a)}

    # ---------------- model
    enc, tok, base_info = V.load_laya_encoder(dtype=torch.float16)
    model = V.ValueNet(enc)
    split_info, _hooks = V.mixed_precision_split(model, a.train_layers, frozen_dtype=torch.float16)
    model.to(device)
    print("S1_TRAIN base", json.dumps(base_info), json.dumps(split_info), "load_s", round(time.time() - T0, 1), flush=True)
    data = {k: tensors(tok, v, a.enc) for k, v in rows.items()}
    ids, am, ys, yd = data["train"]
    N = len(ids); epoch_steps = N // a.bs
    if a.dry_run: epoch_steps = min(epoch_steps, 12)
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=a.lr, weight_decay=0.01)
    g = torch.Generator().manual_seed(a.seed); perm = torch.randperm(N, generator=g)
    budget = min(a.minutes * 60, deadline - time.time() - a.eval_reserve_s)
    assert budget > 60, f"--total-minutes leaves only {budget:.0f} s of training after load + eval reserve"
    warm, planned = 100, epoch_steps
    lr_at = lambda s: a.lr * (min(1.0, (s + 1) / warm) if s < warm else max(0.0, (planned - s) / max(1, planned - warm)))
    model.train(); t_train = time.time(); log = []; step = 0; t5 = None; stop_reason = "epoch"
    run_loss = run_acc = 0.0; nrun = 0
    sync = (lambda: torch.mps.synchronize()) if device == "mps" else (lambda: None)
    while step < planned:
        if time.time() - t_train > budget: stop_reason = "time_cap"; break
        bi = perm[step * a.bs:(step + 1) * a.bs]
        x, m = ids[bi].long().to(device), am[bi].long().to(device)
        tys, tyd = ys[bi].to(device), yd[bi].to(device)
        for gr in opt.param_groups: gr["lr"] = lr_at(step)
        ls, ld = model(x, m)
        loss_s = F.cross_entropy(ls.float(), tys)
        loss_d = F.cross_entropy(ld.float(), tyd, ignore_index=-100) if bool((tyd != -100).any()) else ls.sum() * 0
        loss = loss_s + loss_d
        opt.zero_grad(set_to_none=True); loss.backward()
        torch.nn.utils.clip_grad_norm_(params, 1.0); opt.step()
        step += 1
        run_loss += loss.item(); run_acc += (ls.argmax(-1) == tys).float().mean().item(); nrun += 1
        if step == 5: sync(); t5 = time.time()
        if step == 25 and not a.dry_run:
            sync(); st = (time.time() - t5) / 20
            planned = min(epoch_steps, int((budget - (time.time() - t_train)) / st) + step)
            stop_reason = "time_planned" if planned < epoch_steps else "epoch"
            print("S1_TRAIN step_s", round(st, 3), "epoch_steps", epoch_steps, "planned_steps", planned, flush=True)
        if step % 50 == 0 or step == planned:
            rec = {"step": step, "loss": round(run_loss / nrun, 4), "acc_solv": round(run_acc / nrun, 4), "lr": lr_at(step - 1),
                   "elapsed_s": round(time.time() - t_train, 1)}
            if device == "mps": rec["mps_GB"] = round(torch.mps.driver_allocated_memory() / 1e9, 2)
            log.append(rec); print("S1_TRAIN", json.dumps(rec), flush=True); run_loss = run_acc = 0.0; nrun = 0
    train_s = round(time.time() - t_train, 1)
    train_info = {"steps": step, "planned_steps": planned, "epoch_steps": N // a.bs, "examples_seen": step * a.bs, "epochs": round(step * a.bs / N, 3),
                  "stop_reason": stop_reason, "train_s": train_s, "budget_s": round(budget, 1), "log": log, "split": split_info, "lr": a.lr,
                  "bs": a.bs, "warmup": warm}
    print("S1_TRAIN done", json.dumps({k: v for k, v in train_info.items() if k != "log"}), flush=True)

    # ---------------- save, free, reload from disk (evaluate the saved artifact, fp32)
    meta = {"encoding": a.enc, "buckets": list(BUCKET_NAMES), "base": base_info, "train": {k: v for k, v in train_info.items() if k != "log"},
            "data_manifest_sha256": head["data_manifest_sha256"], "temperature_solvable": 1.0, "temperature_dist": 1.0,
            "license_note": "Laya encoder weights + tokenizer: convaiinnovations/laya (Apache-2.0)"}
    tok_dir = os.path.join(V.LAYA_DIR, "tokenizer")
    V.save(model, tok_dir, a.out, meta)
    del model, opt, params, _hooks
    if device == "mps": torch.mps.empty_cache()
    model, tok2, meta = V.load(a.out, device=device)
    ev = evaluate(model, data, rows, device, deadline)
    Ts, Td = ev["temperature"]["solvable"], ev["temperature"]["dist"]
    meta["temperature_solvable"], meta["temperature_dist"] = Ts, Td
    ref_boards = [r["board"] for r in rows["test"][:8]]                 # cross-machine / cross-version parity anchors
    meta["reference_scores"] = {"device": device, "boards": ref_boards,
                                "p_solvable": [x["p_solvable"] for x in V.Scorer(model, tok2, meta, device=device)(ref_boards)]}
    meta_path = os.path.join(a.out, "meta.json")
    with open(meta_path, "w") as f: json.dump(meta, f, indent=1)      # temperatures are part of the artifact (meta not in files_sha256)
    hs1a = h_s1a(ev)
    res = {**head, "base_checkpoint": base_info, "train": train_info, "eval": ev, "H_S1a": hs1a, "artifact": a.out,
           "artifact_meta_sha256": sha_file(meta_path), "artifact_files_sha256": meta["files_sha256"], "wall_s": round(time.time() - T0, 1),
           "total_cap": {"total_minutes": a.total_minutes, "within_cap": time.time() <= deadline, "skipped": ev.get("skipped", [])},
           "evidence_class": ("DRY RUN (plumbing only)" if a.dry_run else "RAN (Mac M4 MPS)")}
    write_json(eval_out, res)
    print("S1_EVAL", json.dumps({"H_S1a": hs1a, "dist_acc": ev["test_dist_after"]["acc"], "latency": ev["latency_" + device],
                                  "T": ev["temperature"]}), "->", eval_out, flush=True)


if __name__ == "__main__":
    main()
