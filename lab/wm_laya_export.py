"""INTUITION-LAYER (Laya / small-encoder gate) training-set export (Mac-side, pure python, no GPU).

Two outputs, never pooled:
  DEST.jsonl  (GATE FILE) holds only UNSELECTED samples: every sample of a wm_retrieval run, pass and fail, one model, one
     prompt family, one sampling config. Source: wm_retrieval_<TAG>.raw.json (full text) joined to wm_retrieval_<TAG>.json
     (seed, finish, tokens, ckpt_chars, think_close_char, verdicts) by (case id, sample index); the lenient verdict is
     recomputed from the raw text and must equal the receipt's.
     Primary view 'tok_ckpt': input = board + "\\n\\n" + text[:ckpt_chars[k]] for k in {1024, 2048, 4096, 8192}, the gate's
     token checkpoints (wm_capture_spec.md section 2). Emitted only when the sample reached k tokens (ckpt_chars[k] not
     null), the prefix lies within the saved text, and thinking was still open at k (think_close_char is None or
     > ckpt_chars[k]; spec section 5). The encoder input is then tail-truncated to its window at training time
     (spec section 2: board + the LAST ~6k Laya tokens of the prefix; this file keeps the full prefix).
     Auxiliary view 'char_aux': the older character cuts N in {500, 1500, 4000} (same rule: strictly inside thinking).
     Sufficiency, per checkpoint k and on the tok_ckpt view only: >= 200 examples AND >= 50 distinct boards per class.
  DEST.corpus_pass_only.jsonl holds corpus traces: v5_corpus (model=base) and v6_corpus via=self (model=gen1). They are
     PASS only and SELECTED (selection=shortest_ok_of_4: the shortest verified-OK trace of k=4, <= 12288 tokens). They are
     flagged, never counted toward sufficiency, and must not enter gate training or evaluation: against fail data they
     differ in model, selection, length and board mix, so a gate could separate them without reading the reasoning.
     No token ids are saved for them, so only the char_aux view exists.
Inventory of the other pulled data (each source is reported with the reason it is or is not usable):
  v6_A.json failed[]                     : verdicts + final answer only (no reasoning) -> not usable.
  forced_base.json                       : verdicts + forced continuation text AFTER truncation (not a prefix) -> not usable.
  posthoc_lenient_*.json / probe.json    : verdicts + answer TAIL only -> not usable.
  sampled_*.json / confirm_*.json / v5_attempts.json : counts / verdicts only -> not usable.
  01_P0_eval / 03_attempts               : thinking OFF (no reasoning) -> not usable.
  v7_eval_*.raw.json (if pulled)         : full texts but on holdout_v7 (SEALED) -> EXCLUDED by rule.
  wm_interactive_*.raw.json (if pulled)  : per-TURN texts under the interactive prompt (a different gate) -> not exported here.
Folds: by canonical id (sha prefix mod 5), so a board never appears in two folds.
Usage: python wm_laya_export.py [PULLED_OUT_DIR] [DEST.jsonl]   (default ../pulled/out, lab/wm_laya_export.jsonl)
Also writes DEST.report.json (counts per source / view / label / checkpoint, sufficiency verdict)."""
import collections, glob, json, os, sys

from sokoban import canonical_id, verify
from posthoc_lenient import lenient
from wm_common import LAB, CKPTS, board_from_solve_prompt, sha_bytes, write_json

NS = (500, 1500, 4000)                                 # auxiliary character view
MIN_PER_CLASS, MIN_BOARDS_PER_CLASS = 200, 50          # sufficiency rule per checkpoint k (wm_capture_spec.md section 5)
BASE_SNAPSHOT = "10fbf86fed7ecee4a061f8b499a618f46001cac1"


def fold(cid):
    return int(cid[:8], 16) % 5


def model_label(path):
    return "base" if BASE_SNAPSHOT in (path or "") else os.path.basename(str(path))


def _row(meta, board, label, verdict, view, input_text, **kw):
    cid = canonical_id(board)
    return {**meta, "canonical_id": cid, "fold": fold(cid), "view": view, "input": board + "\n\n" + input_text,
            "label": int(label), "label_name": "pass" if label else "fail", "verdict": verdict, **kw}


def char_examples(meta, board, text, label, verdict):
    reasoning = text.split("</think>")[0]
    return [_row(meta, board, label, verdict, "char_aux", reasoning[:n], n_chars=n, prefix_chars=n)
            for n in NS if len(reasoning) > n]


def tok_examples(meta, board, text, label, verdict, ck, tcc, skipped):
    out = []
    for k in CKPTS:
        c = (ck or {}).get(str(k))
        if c is None: skipped["not_reached"] += 1; continue
        if c > len(text): skipped["ckpt_beyond_text"] += 1; continue
        if tcc is not None and tcc <= c: skipped["thinking_closed_before_k"] += 1; continue
        out.append(_row(meta, board, label, verdict, "tok_ckpt", text[:c], k=k, prefix_chars=c, think_close_char=tcc))
    return out


def export(src_dir, dest, corpus_dir="__same__"):
    corpus_dir = src_dir if corpus_dir == "__same__" else corpus_dir
    gate, corpus, inv, skipped = [], [], collections.OrderedDict(), collections.Counter()

    def note(name, rows, usable, why):
        inv[name] = {"rows": rows, "samples_with_prefix_and_outcome": usable, "why": why}

    # ---- corpus traces: PASS-only, selected, flagged; separate file ----
    if corpus_dir:
        for fname, via, model, src in (("v5_corpus.json", None, "base", "v5_corpus"), ("v6_corpus.json", "self", "gen1", "v6_corpus_self")):
            p = os.path.join(corpus_dir, fname)
            if not os.path.exists(p): continue
            rows = json.load(open(p))["corpus"]; u = 0; skip = collections.Counter()
            for e in rows:
                if via is not None and e.get("via") != via: skip[e.get("via")] += 1; continue
                b = board_from_solve_prompt(e["prompt"])
                meta = {"source": src, "src_id": e["id"], "sample": 0, "model": model, "selection": "shortest_ok_of_4", "finish": "stop"}
                new = char_examples(meta, b, e["target"], True, "OK"); corpus += new; u += bool(new)
            note(fname, len(rows), u, f"CORPUS (pass-only, selected, model={model}) -> {os.path.basename(dest)[:-6]}.corpus_pass_only.jsonl; "
                                      f"excluded from gate training/eval and sufficiency" + (f"; skipped {dict(skip)}" if skip else ""))
    # ---- inventory of unusable pulled data ----
    p = os.path.join(src_dir, "v6_A.json")
    if os.path.exists(p):
        d = json.load(open(p))
        note("v6_A.json:direct", len(d.get("direct", [])), 0, "same traces as v6_corpus via=self (corpus file)")
        note("v6_A.json:failed", len(d.get("failed", [])), 0, "FAIL outcomes but only the final answer text is saved (no reasoning)")
    p = os.path.join(src_dir, "forced_base.json")
    if os.path.exists(p):
        d = json.load(open(p)); n = sum(len(c["samples"]) for c in d["cases"])
        note("forced_base.json", n, 0, "per-sample finish/verdict saved, but forced_text is the continuation AFTER a forced </think> (not a reasoning prefix)")
    for p in sorted(glob.glob(os.path.join(src_dir, "posthoc_lenient_*.json"))):
        d = json.load(open(p)); note(os.path.basename(p), len(d["cases"]), 0, "verdict + final_tail (last 300 chars after </think>) only")
    p = os.path.join(src_dir, "probe.json")
    if os.path.exists(p):
        d = json.load(open(p)); n = sum(len(v["cases"]) for k, v in d.items() if isinstance(v, dict) and "cases" in v)
        note("probe.json", n, 0, "verdict + 400-char TAIL only (and no boards stored)")
    for pat, why in (("sampled_*.json", "per-board counts + token counts only"), ("confirm_*.json", "verdict + token count only"),
                     ("v5_attempts.json", "verdicts + token counts only"), ("01_P0_eval.json", "thinking OFF, answer only"),
                     ("03_attempts.json", "thinking OFF, answer only")):
        for p in sorted(glob.glob(os.path.join(src_dir, pat))):
            d = json.load(open(p))
            n = sum(len(c.get("tokens", [0])) if isinstance(c.get("tokens"), list) else 1 for c in d.get("cases", d.get("attempts", [])))
            note(os.path.basename(p), n, 0, why)
    for p in sorted(glob.glob(os.path.join(src_dir, "v7_eval_*.raw.json"))):
        note(os.path.basename(p), -1, 0, "EXCLUDED: holdout_v7 is sealed (trajectories on sealed boards never enter gate training)")
    for p in sorted(glob.glob(os.path.join(src_dir, "wm_interactive_*.raw.json"))):
        note(os.path.basename(p), -1, 0, "per-turn texts under the interactive prompt: a different (turn-level) gate; not exported here")
    # ---- gate data: unselected wm_retrieval samples, raw text joined to the final receipt ----
    for p in sorted(glob.glob(os.path.join(src_dir, "wm_retrieval_*.raw.json"))):
        fp = p[:-len(".raw.json")] + ".json"
        if not os.path.exists(fp):
            note(os.path.basename(p), -1, 0, "final receipt missing (no ckpt_chars / think_close_char): not exported"); continue
        d, F = json.load(open(p)), json.load(open(fp))
        assert F["stage"] == "final" and [c["id"] for c in F["cases"]] == [c["id"] for c in d["cases"]], f"{fp}: case order differs from raw"
        mdl = model_label(F.get("model")); u = n = 0
        for c, fc in zip(d["cases"], F["cases"]):
            b = board_from_solve_prompt(c["prompt_user"])
            assert len(c["samples"]) == len(fc["samples"])
            for j, (s, fs) in enumerate(zip(c["samples"], fc["samples"])):
                n += 1; pl = lenient(s["text"]); v = verify(b, pl) if pl else "NOPLAN"
                assert v == fs["lenient"], (fp, c["id"], j, v, fs["lenient"])
                meta = {"source": os.path.basename(p), "src_id": c["id"], "sample": j, "seed": fs.get("seed"), "model": mdl,
                        "selection": "unselected", "prompt_mode": F.get("mode"), "finish": fs["finish"], "tokens": fs["tokens"]}
                new = tok_examples(meta, b, s["text"], v == "OK", v, fs.get("ckpt_chars"), fs.get("think_close_char"), skipped)
                new += char_examples(meta, b, s["text"], v == "OK", v)
                gate += new; u += any(x["view"] == "tok_ckpt" for x in new)
        note(os.path.basename(p), n, u, f"GATE: unselected samples, model={mdl}, mode={F.get('mode')}, joined to {os.path.basename(fp)} "
                                        "(holdout128 trajectories; gate evaluation must then use fresh boards)")
    body = "".join(json.dumps(e, sort_keys=True) + "\n" for e in gate)
    with open(dest, "w") as f: f.write(body)
    cdest = (dest[:-len(".jsonl")] if dest.endswith(".jsonl") else dest) + ".corpus_pass_only.jsonl"
    cbody = "".join(json.dumps(e, sort_keys=True) + "\n" for e in corpus)
    with open(cdest, "w") as f: f.write(cbody)
    tok = [e for e in gate if e["view"] == "tok_ckpt"]
    per_k = {}
    for k in CKPTS:
        ek = [e for e in tok if e["k"] == k]
        per_k[k] = {"pass": sum(e["label"] == 1 for e in ek), "fail": sum(e["label"] == 0 for e in ek),
                    "boards_pass": len({e["canonical_id"] for e in ek if e["label"] == 1}),
                    "boards_fail": len({e["canonical_id"] for e in ek if e["label"] == 0})}
    sufficient = {k: (v["pass"] >= MIN_PER_CLASS and v["fail"] >= MIN_PER_CLASS and v["boards_pass"] >= MIN_BOARDS_PER_CLASS
                      and v["boards_fail"] >= MIN_BOARDS_PER_CLASS) for k, v in per_k.items()}
    by = collections.defaultdict(collections.Counter)
    for e in gate + corpus:
        by[e["source"]][f"{e['view']}:{e.get('k', e.get('n_chars'))}:{e['label_name']}"] += 1
    rep = {"dest": os.path.basename(dest), "sha256": sha_bytes(body), "examples": len(gate), "tok_ckpt_examples": len(tok),
           "corpus_pass_only": {"dest": os.path.basename(cdest), "sha256": sha_bytes(cbody), "examples": len(corpus),
                                "use": "NOT for gate training/evaluation; NOT counted toward sufficiency"},
           "inventory": inv, "per_source": {s: dict(sorted(v.items())) for s, v in by.items()}, "skipped_tok_ckpt": dict(skipped),
           "per_k": per_k, "sufficiency_rule": f">= {MIN_PER_CLASS} examples AND >= {MIN_BOARDS_PER_CLASS} distinct boards per class, per checkpoint k (tok_ckpt view, gate file only)",
           "sufficient": sufficient,
           "verdict": "SUFFICIENT" if all(sufficient.values()) else
                      "INSUFFICIENT: " + ("no unselected pass/fail samples with reasoning yet (the gate file needs wm_retrieval receipts)" if not tok
                                          else "too few examples/boards per class at: " + ", ".join(str(k) for k, ok in sufficient.items() if not ok))}
    write_json((dest[:-len(".jsonl")] if dest.endswith(".jsonl") else dest) + ".report.json", rep)
    return rep


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(LAB), "pulled", "out")
    dest = sys.argv[2] if len(sys.argv) > 2 else os.path.join(LAB, "wm_laya_export.jsonl")
    rep = export(src, dest)
    print("WM_LAYA_EXPORT", json.dumps({k: rep[k] for k in ("examples", "tok_ckpt_examples", "per_k", "verdict", "sha256")}),
          "corpus_pass_only", rep["corpus_pass_only"]["examples"], flush=True)
    for k, v in rep["inventory"].items():
        print(f"  {k}: rows={v['rows']} usable={v['samples_with_prefix_and_outcome']} :: {v['why']}")
