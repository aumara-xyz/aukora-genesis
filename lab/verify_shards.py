"""Hash received shards against publisher-declared LFS sha256 from the HF API (pinned revision)."""
import hashlib, json, os, sys, urllib.request
d, rev = sys.argv[1], "10fbf86fed7ecee4a061f8b499a618f46001cac1"
api = json.load(urllib.request.urlopen(f"https://huggingface.co/api/models/ornith-ai/Ornith-1.5-35B-A3B/tree/{rev}"))
bad = 0
for f in api:
    if f.get("lfs") and f["path"].endswith(".safetensors"):
        h = hashlib.sha256()
        with open(os.path.join(d, f["path"]), "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 24), b""): h.update(chunk)
        ok = h.hexdigest() == f["lfs"]["oid"]; bad += not ok
        print(f["path"], "OK" if ok else "MISMATCH", flush=True)
print("SHARDS_BAD", bad); sys.exit(1 if bad else 0)
