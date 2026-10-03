"""Phone-a-friend: ask a frontier model (OpenRouter) for a HINT, never a full solution.
The student must still produce its own plan; only student plans that the verifier accepts are ever trained on.
Every call is logged (state, hint, tokens, cost) -> escalation dataset."""
import json, os, re, time, urllib.request
KEY = open(os.path.expanduser("~/aukora-nebius-run/.openrouter_key")).read().strip() if os.path.exists(os.path.expanduser("~/aukora-nebius-run/.openrouter_key")) else os.environ.get("OPENROUTER_API_KEY")
MODEL = "z-ai/glm-5.3"
HINT_PROMPT = ("You are a Sokoban coach. A student attempted this 8x8 puzzle and failed.\n"
               "Puzzle:\n{board}\n\nStudent's last answer: {attempt}\nVerifier: {verdict}\n\n"
               "Give ONE short strategic hint (max 40 words) about what to do first or what to avoid. "
               "Do NOT give a move sequence, coordinates-by-coordinates path, or more than 3 consecutive moves.")
def hint(board, attempt, verdict, log_path):
    body = json.dumps({"model": MODEL, "messages": [{"role": "user", "content": HINT_PROMPT.format(board=board, attempt=attempt[-300:], verdict=verdict)}],
                       "max_tokens": 12000, "reasoning": {"effort": "low"}}).encode()
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=body,
                                 headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    t = time.time(); r = json.load(urllib.request.urlopen(req, timeout=300))
    text = r["choices"][0]["message"]["content"] or ""
    leaked = bool(re.search(r"[UDLR]{4,}", text))           # hint leak guard: long move strings are redacted
    if leaked: text = re.sub(r"[UDLR]{4,}", "[redacted]", text)
    rec = {"utc": time.strftime("%FT%TZ", time.gmtime()), "model": MODEL, "board": board, "verdict": verdict,
           "hint": text, "leak_redacted": leaked, "usage": r.get("usage"), "s": round(time.time() - t, 1)}
    with open(log_path, "a") as f: f.write(json.dumps(rec) + "\n")
    return text
