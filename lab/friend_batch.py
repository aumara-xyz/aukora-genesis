"""Mac-side: coach hints for failed tasks (key never leaves the Mac). Usage: friend_batch.py v6_A.json hints.json"""
import json, sys, concurrent.futures as cf
import friend
A = json.load(open(sys.argv[1]))
def one(f):
    try: return f["id"], friend.hint(f["board"], f["attempt"], f["verdict"], "/Users/peterviviani/aukora-nebius-run/friend-calls.jsonl")
    except Exception as e: return f["id"], None
with cf.ThreadPoolExecutor(8) as ex: res = dict(ex.map(one, A["failed"]))
json.dump(res, open(sys.argv[2], "w"), indent=1)
print("hints", sum(v is not None for v in res.values()), "of", len(res))
