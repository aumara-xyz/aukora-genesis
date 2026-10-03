import json,sys,glob,warnings;warnings.filterwarnings("ignore")
sys.path.insert(0,"/workspace/laya-screen/src/notebooks")
from huggingface_hub import snapshot_download
from transformers import AutoTokenizer
import importlib.util
spec=importlib.util.spec_from_file_location("ft","/workspace/laya-screen/src/notebooks/laya_finetune_typed_decisions_mps.py");ft=importlib.util.module_from_spec(spec);spec.loader.exec_module(ft)
md=snapshot_download("convaiinnovations/laya",cache_dir="/workspace/laya-screen/hf/hub",allow_patterns=["rl_agent_config.json","tokenizer/*"])
from laya.agent import _fix_tokenizer_config
cfg=json.load(open(md+"/rl_agent_config.json"));tok=AutoTokenizer.from_pretrained(md+"/tokenizer")
cfg.update({"max_len":1024,"head_max_len":256})
ok=bad=0;maxlen=0
for f in ["train.jsonl","dev.jsonl","test.jsonl"]:
    for line in open(f):
        r=json.loads(line);st=json.loads(r["state"]);qs=json.loads(r["questions"]);g=json.loads(r["gold"])
        for q,qd in qs.items():
            it=ft.build_training_item(tok,cfg,st,qd,g[q])
            if it is None: bad+=1
            else: ok+=1; maxlen=max(maxlen,len(it["ids"]))
print("items ok",ok,"skipped",bad,"max seq tokens",maxlen)
