"""S1 value net (torch): Laya encoder (ModernBERT-large, loaded with NATIVE transformers classes only) + 2 heads:
solvable (2-way) and distance bucket (5-way, trained on solvable states only). Mean-pooled.
SECURITY: nothing from the Laya HF cache is imported or executed. Only encoder/config.json (as a ModernBertConfig),
tokenizer/tokenizer.json (PreTrainedTokenizerFast) and the 'encoder.*' tensors of model.safetensors are read.
The checkpoint's own heads (act_head/head/scorer/type_emb/temperature) are ignored.
Saved format (s1_laya/): encoder_config.json (verbatim Laya encoder config), encoder.safetensors (ModernBertModel keys;
frozen tensors fp16 = exact Laya values, fine-tuned tensors fp32), head.safetensors (fp32), tokenizer/ (copied tokenizer.json + tokenizer_config.json), meta.json (temperatures,
encoding, buckets, shas)."""
import json, os, shutil, sys, time

import torch
import torch.nn as nn

from s1_common import ENCODERS, BUCKET_MID, CELLS_LEN, CELL_ALIGNED, sha_file

LAYA_REPO = os.path.expanduser("~/.cache/huggingface/hub/models--convaiinnovations--laya")
LAYA_REV = "1c5edc17a7acd8701df6fc341c0d179f1c62c982"
LAYA_DIR = os.environ.get("S1_LAYA_DIR", os.path.join(LAYA_REPO, "snapshots", LAYA_REV))
FALLBACK_REPO = os.path.expanduser("~/.cache/huggingface/hub/models--answerdotai--ModernBERT-base")


def _no_remote_code(cfg_path):
    d = json.load(open(cfg_path))
    assert "auto_map" not in d, f"{cfg_path} declares auto_map (remote code); refusing"
    return d


def _assert_no_cache_modules(root):
    root = os.path.realpath(os.path.expanduser("~/.cache/huggingface"))
    bad = [n for n, m in list(sys.modules.items()) if getattr(m, "__file__", None) and os.path.realpath(m.__file__).startswith(root)]
    assert not bad, f"modules imported from the HF cache: {bad}"


def _config(cfg_path):
    from transformers import ModernBertConfig
    d = _no_remote_code(cfg_path)
    assert d.get("model_type") == "modernbert", d.get("model_type")
    cfg = ModernBertConfig.from_json_file(cfg_path)
    rp = d.get("rope_parameters") or {}
    if rp:                                   # transformers-5 style -> 4.x attribute names (values identical to 4.x defaults)
        cfg.global_rope_theta = float(rp["full_attention"]["rope_theta"])
        cfg.local_rope_theta = float(rp["sliding_attention"]["rope_theta"])
    lt = d.get("layer_types")
    if lt:
        assert all((t == "full_attention") == (i % cfg.global_attn_every_n_layers == 0) for i, t in enumerate(lt)), "layer_types mismatch"
    cfg.reference_compile = False
    return cfg, d


def load_tokenizer(tok_dir):
    from transformers import PreTrainedTokenizerFast
    _no_remote_code(os.path.join(tok_dir, "tokenizer_config.json"))
    return PreTrainedTokenizerFast.from_pretrained(tok_dir, trust_remote_code=False)


def _build(cfg, dtype):
    """Native ModernBertModel with SDPA attention (never flash-attn / remote code), parameters created in `dtype`."""
    from transformers import ModernBertModel
    try:
        return ModernBertModel._from_config(cfg, attn_implementation="sdpa", torch_dtype=dtype)
    except TypeError:                                          # transformers 5.x renamed torch_dtype -> dtype
        return ModernBertModel._from_config(cfg, attn_implementation="sdpa", dtype=dtype)


def _load_into(module, tensors):
    """Copy tensors into existing parameters/buffers one at a time (dtype-converted; low peak RAM). Strict key check."""
    own = dict(module.state_dict())
    missing = sorted(set(own) - set(tensors)); unexpected = sorted(set(tensors) - set(own))
    assert not missing and not unexpected, f"state mismatch: missing={missing[:8]} unexpected={unexpected[:8]}"
    with torch.no_grad():
        for k, t in tensors.items():
            assert own[k].shape == t.shape, (k, own[k].shape, t.shape)
            own[k].copy_(t.to(own[k].dtype))


def load_laya_encoder(dtype=torch.float32):
    """-> (encoder ModernBertModel on CPU in `dtype`, tokenizer, info). Raises if the checkpoint cannot be loaded natively."""
    from safetensors import safe_open
    cfg_path = os.path.join(LAYA_DIR, "encoder", "config.json")
    cfg, raw = _config(cfg_path)
    enc = _build(cfg, dtype)
    n = 0
    with safe_open(os.path.join(LAYA_DIR, "model.safetensors"), "pt") as f:
        keys = [k for k in f.keys() if k.startswith("encoder.")]
        own = dict(enc.state_dict())
        assert sorted(k[len("encoder."):] for k in keys) == sorted(own), "Laya encoder.* keys != ModernBertModel keys"
        with torch.no_grad():
            for k in keys:
                t = f.get_tensor(k); d = own[k[len("encoder."):]]
                assert d.shape == t.shape, (k, d.shape, t.shape)
                d.copy_(t.to(d.dtype)); n += 1
    tok = load_tokenizer(os.path.join(LAYA_DIR, "tokenizer"))
    _assert_no_cache_modules(LAYA_DIR)
    info = {"source": "convaiinnovations/laya@" + LAYA_REV, "config_architectures": raw.get("architectures"), "model_type": raw.get("model_type"),
            "hidden_size": cfg.hidden_size, "num_hidden_layers": cfg.num_hidden_layers, "loaded_as": "transformers.ModernBertModel (native, sdpa)",
            "attn_implementation": enc.config._attn_implementation, "encoder_tensors": n, "params": sum(p.numel() for p in enc.parameters()),
            "config_sha256": sha_file(cfg_path), "tokenizer_sha256": sha_file(os.path.join(LAYA_DIR, "tokenizer", "tokenizer.json")),
            "ignored_checkpoint_parts": "act_head.*, head.*, scorer.*, type_emb.*, temperature (Laya decision heads)"}
    return enc, tok, info


def _cast_hook(dtype):
    def hook(module, args, kwargs):
        cast = lambda x: x.to(dtype) if torch.is_tensor(x) and x.is_floating_point() else x
        return tuple(cast(a) for a in args), {k: cast(v) for k, v in kwargs.items()}
    return hook


def mixed_precision_split(model, n_train_layers, frozen_dtype=torch.float16):
    """Freeze embeddings + bottom layers (kept in frozen_dtype, no autograd graph), train the top n layers + final_norm
    + heads in fp32. Pre-hooks cast the hidden state and masks to fp32 at every trainable layer."""
    enc = model.encoder
    L = len(enc.layers); first = L - n_train_layers
    for p in model.parameters(): p.requires_grad = False
    enc.embeddings.to(frozen_dtype)
    for i, layer in enumerate(enc.layers):
        if i < first: layer.to(frozen_dtype)
        else:
            layer.to(torch.float32)
            for p in layer.parameters(): p.requires_grad = True
    enc.final_norm.to(torch.float32)
    for p in enc.final_norm.parameters(): p.requires_grad = True
    for m in (model.solv, model.dist):
        m.to(torch.float32)
        for p in m.parameters(): p.requires_grad = True
    # every fp32 layer gets the hook: the encoder loop passes the same (frozen-dtype) masks to all layers
    h = [enc.layers[i].register_forward_pre_hook(_cast_hook(torch.float32), with_kwargs=True) for i in range(first, L)]
    return {"trainable_layers": list(range(first, L)), "frozen_dtype": str(frozen_dtype),
            "trainable_params": sum(p.numel() for p in model.parameters() if p.requires_grad)}, h


class ValueNet(nn.Module):
    def __init__(self, encoder, n_buckets=5, dropout=0.1):
        super().__init__()
        self.encoder = encoder
        h = encoder.config.hidden_size
        self.drop = nn.Dropout(dropout)
        self.solv = nn.Linear(h, 2)
        self.dist = nn.Linear(h, n_buckets)

    def forward(self, input_ids, attention_mask):
        hs = self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        m = attention_mask.unsqueeze(-1).to(hs.dtype)
        pooled = (hs * m).sum(1) / m.sum(1).clamp(min=1.0)
        pooled = self.drop(pooled)
        return self.solv(pooled), self.dist(pooled)

    def head_state(self):
        return {k: v for k, v in self.state_dict().items() if not k.startswith("encoder.")}


def tokenize(tok, boards, enc="cells"):
    texts = [ENCODERS[enc](b) for b in boards]
    t = tok(texts, return_tensors="pt", padding=True)
    if enc in CELL_ALIGNED:
        assert t["input_ids"].shape[1] == CELLS_LEN and bool(t["attention_mask"].all()), "cells encoding must be exactly one token per tile"
    return t["input_ids"], t["attention_mask"]


def save(model, tok_src_dir, out_dir, meta):
    from safetensors.torch import save_file
    os.makedirs(out_dir, exist_ok=True)
    # frozen tensors keep their (fp16) dtype = exact Laya values; trained tensors stay fp32
    enc_sd = {k: v.detach().to("cpu").contiguous() for k, v in model.encoder.state_dict().items()}
    save_file(enc_sd, os.path.join(out_dir, "encoder.safetensors"))
    save_file({k: v.detach().to("cpu", torch.float32).contiguous() for k, v in model.head_state().items()}, os.path.join(out_dir, "head.safetensors"))
    shutil.copyfile(os.path.join(LAYA_DIR, "encoder", "config.json"), os.path.join(out_dir, "encoder_config.json"))
    os.makedirs(os.path.join(out_dir, "tokenizer"), exist_ok=True)
    for f in ("tokenizer.json", "tokenizer_config.json"):
        shutil.copyfile(os.path.join(tok_src_dir, f), os.path.join(out_dir, "tokenizer", f))
    meta = dict(meta)
    meta["files_sha256"] = {f: sha_file(os.path.join(out_dir, f)) for f in ("encoder.safetensors", "head.safetensors", "encoder_config.json",
                                                                           "tokenizer/tokenizer.json")}
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    return meta


def load(out_dir, device="cpu", verify_sha=True):
    """Reload a saved value net with native transformers classes (works on Mac 4.53 and box 5.x; strict key check)."""
    from safetensors.torch import load_file
    meta = json.load(open(os.path.join(out_dir, "meta.json")))
    if verify_sha:
        for f, h in meta.get("files_sha256", {}).items():
            assert sha_file(os.path.join(out_dir, f)) == h, f"sha mismatch {f}"
    cfg, _ = _config(os.path.join(out_dir, "encoder_config.json"))
    enc = _build(cfg, torch.float32)
    _load_into(enc, load_file(os.path.join(out_dir, "encoder.safetensors")))
    model = ValueNet(enc, n_buckets=len(BUCKET_MID))
    hm, hu = model.load_state_dict(load_file(os.path.join(out_dir, "head.safetensors")), strict=False)
    assert not hu and all(k.startswith("encoder.") for k in hm), (hm, hu)
    tok = load_tokenizer(os.path.join(out_dir, "tokenizer"))
    return model.to(device).eval(), tok, meta


class Scorer:
    """boards -> [{'p_solvable', 'bucket_probs', 'exp_dist'}] with temperature scaling. Value net only (no oracle)."""

    def __init__(self, model, tok, meta, device="cpu", dtype=None):
        self.model, self.tok, self.meta, self.device = model, tok, meta, device
        self.enc = meta.get("encoding", "cells")
        self.t_solv = float(meta.get("temperature_solvable", 1.0)); self.t_dist = float(meta.get("temperature_dist", 1.0))
        self.dtype = dtype
        if dtype is not None: self.model.to(dtype)
        self.calls, self.states = 0, 0
        self.pad_to = 4 if str(device).startswith("mps") else 1

    @torch.no_grad()
    def __call__(self, boards):
        if not boards: return []
        n = len(boards)
        if self.pad_to > 1 and n % self.pad_to:                    # fixed batch shapes (MPS kernel cache); padding discarded
            boards = list(boards) + [boards[0]] * (self.pad_to - n % self.pad_to)
        ids, am = tokenize(self.tok, boards, self.enc)
        ls, ld = self.model(ids.to(self.device), am.to(self.device))
        ps = torch.softmax(ls[:n].float() / self.t_solv, -1)[:, 1].cpu().tolist()
        pd = torch.softmax(ld[:n].float() / self.t_dist, -1).cpu()
        mid = torch.tensor(BUCKET_MID)
        ed = (pd * mid).sum(-1).tolist()
        self.calls += 1; self.states += n
        return [{"p_solvable": p, "bucket_probs": [round(x, 4) for x in b], "exp_dist": e} for p, b, e in zip(ps, pd.tolist(), ed)]


def random_head_scorer(device="cpu", seed=0, dtype=torch.float32):
    """Plumbing/latency check: real Laya encoder + UNTRAINED (random) heads, temperature 1."""
    torch.manual_seed(seed)
    enc, tok, info = load_laya_encoder(dtype=dtype)
    model = ValueNet(enc).to(dtype).to(device).eval()
    return Scorer(model, tok, {"encoding": "cells", "untrained_head": True, "base": info}, device=device), info


def pick_device(pref=None):
    if pref: return pref
    if torch.backends.mps.is_available(): return "mps"
    if torch.cuda.is_available(): return "cuda"
    return "cpu"
