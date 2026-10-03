import json, re, hashlib, collections
from sokoban import verify
TEMPLATE_SHA = "182e77dd83bd8e9ca818b240b82e28f243762cd5dda32e6eef327df7b1cd107e"
MODEL = "/mnt/glm-data/aukora-run/hf/hub/models--ornith-ai--Ornith-1.5-35B-A3B/snapshots/10fbf86fed7ecee4a061f8b499a618f46001cac1"
sha = lambda b: hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()

def load_tok(path=MODEL):
    from transformers import AutoTokenizer
    tok = AutoTokenizer.from_pretrained(path)
    t = open(MODEL + "/chat_template.jinja").read(); assert sha(t) == TEMPLATE_SHA
    tok.chat_template = t
    return tok

def strict_plan(text):
    final = text.split("</think>")[-1].strip()
    try:
        d = json.loads(final)
        return d["moves"] if isinstance(d, dict) and set(d) == {"moves"} and isinstance(d["moves"], str) else None
    except Exception:
        return None

def score(board, text):
    p = strict_plan(text)
    return verify(board, p) if p is not None else "FORMAT"

def write(path, obj):
    with open(path, "w") as f: json.dump(obj, f, indent=1, default=dict)
