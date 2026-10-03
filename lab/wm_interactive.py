"""INTERACTIVE Sokoban (box, vLLM): the simulator is the model's external working memory.

One multi-turn chat per (board, sample) episode. Every assistant turn runs with thinking ON (max 4096 new tokens) and must
end with one JSON {"moves": "<1-8 of UDLR>"} or {"moves": "RESET"}. The harness applies the moves with sokoban.step from
the CURRENT state, stops at the first blocked move (ILLEGAL@i, i 0-indexed within that reply) keeping the legal prefix,
and replies with: what it applied, a one-line Delta (player/box displacements; the ARC-3/ULHF "what changed" line), the
new rendered board, moves so far, boxes on goals, budget/turns/resets left.
Episode ends: solved | 3 consecutive unparseable turns | 64 applied moves in total | 12 turns | context limit.
RESET restores the start board (max 2 per episode, counts as a turn; a 3rd RESET is refused and still costs the turn).

Parsing (preregistered in wm_PREREG.md): lenient, same family as posthoc_lenient: the LAST "moves":"..." value after
</think> whose value matches [UDLR]+|RESET (any length; it is clipped, never rejected). A move string longer than 8 is
clipped to its first 8 moves (recorded); the 64-move budget clip applies after that.
strict_format (whole post-think text is exactly one JSON object with a 1-8 move string) is recorded but not used to score.
Moves stop being applied the moment both boxes are on goals (solved), so the scored path is exactly the solving prefix;
it is re-verified with sokoban.verify on the original board. (wm_analyze applies the same any-prefix rule to the
single-shot plans as a secondary, so the arms can also be compared under one scoring rule.)

Bounded context: messages = [user: rules+board+protocol (+ the observations of turns older than the last 3, appended)]
then, for the last 3 turns, (assistant: that turn's final JSON only, user: harness observation). Thinking text of earlier
turns is never sent again. Prompt length is measured with the tokenizer each round (max_model_len 20480).

Batching: all live episodes' turn-k requests go to ONE llm.generate call per round (per-request SamplingParams with a
fixed per-(episode,turn) seed: SEED + 1000*episode + turn).

Flags (wm_PREREG.md section 2):
  --commit-on-truncate  PART OF THE PRIMARY INTERACTIVE ARM. A turn that hit 4096 tokens without closing thinking is
                        continued in the same engine from prompt + text + '\\n</think>\\n\\n{"moves": "' greedy (16 tokens,
                        stop at '"'): a forced move commit (the harness's per-turn deadline).
  --notes               EXPLORATORY (WMMAX arm): the JSON may carry "note" (<=300 chars); the harness echoes the latest
                        note every turn (model-authored persistent working memory, since thinking is dropped between turns).
  --resume              continue an interrupted run from OUT/wm_interactive_<TAG>.turns.jsonl (see below).
Usage: python wm_interactive.py MODEL_DIR TAG OUT SETFILE N_SAMPLES [--commit-on-truncate] [--notes] [--resume]
       python wm_interactive.py --preflight SETFILE OUT TAG [--notes]      (CPU only; real tokenizer + template)
Receipts (never overwritten): OUT/wm_interactive_<TAG>.json (scores + per-turn transcripts: final JSON + harness reply +
token counts) and OUT/wm_interactive_<TAG>.raw.json (full per-turn generated text + token-checkpoint char offsets).
Durable mid-run receipt: OUT/wm_interactive_<TAG>.turns.jsonl, append-only and fsynced after every round: one "head"
line, then per applied turn {episode, id, sample, turn, seed, text, commit_text, finish, ntok, ptok, ckpt_chars, rec},
then one "round" line. apply_turn is a pure function of these fields, so --resume rebuilds every episode exactly
(asserting each replayed turn record equals the stored one) and continues with the next round, same seed rule.
OUT/wm_interactive_<TAG>.partial.json is rewritten after every round (progress + summaries of finished episodes), is
rewritten with stage "incomplete" + the error if the run dies, and is removed after the final receipts are written."""
import collections, json, os, re, sys, time

from sokoban import parse, step, verify
from prompts import RULES
from wm_common import (render, load_set, ckpt_chars, sha_file, write_json, append_jsonl, read_jsonl, run_versions,
                       prereg_sha)

SEED = 20261009
TURN_TOKENS, MAX_TURNS, MOVE_BUDGET, MAX_PER_TURN, MAX_RESETS, MAX_CONSEC_UNPARSE = 4096, 12, 64, 8, 2, 3
KEEP_ASSISTANT = 3
MAX_MODEL_LEN, MIN_ROOM = 20480, 512
SAMPLING = {"temperature": 0.6, "top_p": 0.95, "top_k": 20}
COMMIT_SUFFIX, COMMIT_TOKENS = '\n</think>\n\n{"moves": "', 16
COMMIT_RESERVE = 32                     # room kept for the re-tokenized COMMIT_SUFFIX in the commit request
NOTE_MAX = 300
ECHO_MAX = 64                           # a longer move string is echoed (and kept in history) as its first 64 moves
MOVE_RE = re.compile(r'"moves"\s*:\s*"([UDLR]+|RESET)"')
STRICT_RE = re.compile(r"^(?:[UDLR]{1,8}|RESET)$")
NO_JSON_ASSISTANT = "(no valid move JSON in this reply)"
HERE = os.path.dirname(os.path.abspath(__file__))
CODE = ("wm_interactive.py", "wm_common.py", "sokoban.py", "prompts.py", "v5_common.py")
END_ORDER = ("solved", "unparseable_x3", "move_budget", "turn_limit", "context_limit")


class Cfg:
    def __init__(self, commit=False, notes=False, max_model_len=MAX_MODEL_LEN, turn_tokens=TURN_TOKENS):
        self.commit, self.notes, self.max_model_len, self.turn_tokens = commit, notes, max_model_len, turn_tokens

    def as_dict(self):
        return {"commit_on_truncate": self.commit, "notes": self.notes, "max_model_len": self.max_model_len,
                "turn_tokens": self.turn_tokens, "max_turns": MAX_TURNS, "move_budget": MOVE_BUDGET, "max_per_turn": MAX_PER_TURN,
                "max_resets": MAX_RESETS, "max_consec_unparseable": MAX_CONSEC_UNPARSE, "keep_assistant": KEEP_ASSISTANT,
                "sampling": {**SAMPLING, "seed_rule": f"{SEED} + 1000*episode + turn"}, "thinking": True,
                "move_regex": MOVE_RE.pattern, "echo_max": ECHO_MAX, "note_max": NOTE_MAX if self.notes else None,
                "commit": {"suffix": COMMIT_SUFFIX, "max_tokens": COMMIT_TOKENS, "temperature": 0.0, "stop": '"',
                           "room_reserve": COMMIT_RESERVE} if self.commit else None}


def initial_prompt(board, notes=False):
    p = (RULES + "\nPuzzle (8 lines):\n" + board + "\n\n"
         "This is an INTERACTIVE session with a game engine. You do not have to solve the whole puzzle in one reply.\n"
         'In each reply, think briefly, then end with exactly one JSON object {"moves": "<1 to 8 characters of U/D/L/R>"}.\n'
         "The engine applies your moves from the CURRENT position and stops at the first blocked move (reported as ILLEGAL@i, "
         "where i is the 0-indexed position within that reply). It then shows you what changed, the new board, how many moves "
         "you have made and how many boxes are on goals. Coordinates are (row, column), 0-indexed from the top-left corner.\n"
         'Instead of moves you may reply {"moves": "RESET"} to restore the starting board (at most 2 resets; a reset uses a reply).\n'
         "Limits: 12 replies and 64 applied moves in total. Your thinking is cut off after about 4000 tokens per reply, so plan "
         "only the next few moves and let the engine show you the result. Your earlier thinking is not shown to you again; "
         "only your moves and the engine's replies are.\n")
    if notes:
        p += ('You may add a short "note" field (at most 300 characters) to your JSON, for example {"moves": "RRU", "note": "plan: '
              'push the left box up first"}. The engine shows your latest note back to you every turn.\n')
    return p


def json_objects(s):
    """Every JSON object that decodes starting at some '{' in s (raw_decode, so braces inside strings are fine)."""
    dec, objs, i = json.JSONDecoder(), [], s.find("{")
    while i >= 0:
        try:
            o, _ = dec.raw_decode(s, i)
            if isinstance(o, dict): objs.append(o)
        except ValueError:
            pass
        i = s.find("{", i + 1)
    return objs


def parse_reply(text, notes=False):
    closed = "</think>" in text
    r = {"think_closed": closed, "kind": "none", "value": None, "note": None, "note_unreadable": False,
         "strict_format": False, "reason": None}
    if not closed:
        r["reason"] = "your thinking reached the per-reply token limit before you gave a move JSON"; return r
    final = text.split("</think>")[-1]
    ms = MOVE_RE.findall(final)
    if not ms:
        r["reason"] = 'no {"moves": "..."} object with a U/D/L/R string (or RESET) after your thinking'; return r
    v = ms[-1]
    r.update(kind="reset" if v == "RESET" else "moves", value=v)
    if notes:
        hit = None
        for d in reversed(json_objects(final)):
            if d.get("moves") == v:
                hit = d; break
        if hit is not None and isinstance(hit.get("note"), str) and hit["note"].strip():
            r["note"] = hit["note"].strip()[:NOTE_MAX]
        elif '"note"' in final and (hit is None or "note" in hit):
            r["note_unreadable"] = True        # a note was written but its JSON object did not decode (or was not a string)
    try:
        d = json.loads(final.strip())
        allowed = {"moves", "note"} if notes else {"moves"}
        r["strict_format"] = (isinstance(d, dict) and "moves" in d and set(d) <= allowed and isinstance(d["moves"], str)
                              and bool(STRICT_RE.match(d["moves"])) and (set(d) == {"moves"} or isinstance(d.get("note"), str)))
    except ValueError:
        pass
    return r


def parse_commit(ctext):
    m = re.match(r"(RESET|[UDLR]+)", ctext or "")
    return m.group(1) if m else None


def fmt(p):
    return f"({p[0]},{p[1]})"


class Episode:
    def __init__(self, case, sample, idx, cfg):
        self.case, self.sample, self.idx, self.cfg = case, sample, idx, cfg
        self.walls, self.goals, self.boxes0, self.player0 = parse(case["board"])
        self.boxes, self.player = self.boxes0, self.player0
        self.path, self.total_moves, self.turns = "", 0, 0
        self.resets = self.reset_refused = self.illegal = self.unparseable = self.consec_unparse = 0
        self.clipped = self.budget_clipped = self.committed = 0
        self.done, self.end_reason, self.solved, self.verified = False, None, False, None
        self.hist, self.note = [], None
        self.turn_log, self.raw_turns = [], []
        self.gen_tokens = self.prompt_tokens = 0
        self.gen_tokens_at_solve = None
        self.initial = initial_prompt(case["board"], cfg.notes)

    def seed(self):
        return SEED + 1000 * self.idx + self.turns + 1

    def messages(self):
        k = len(self.hist); cut = max(0, k - KEEP_ASSISTANT)
        head = self.initial
        if cut:
            head += "\n\nEngine replies to your earlier turns:\n\n" + "\n\n".join(obs for _, obs in self.hist[:cut])
        msgs = [{"role": "user", "content": head}]
        for a, obs in self.hist[cut:]:
            msgs += [{"role": "assistant", "content": a}, {"role": "user", "content": obs}]
        return msgs

    def on_goal(self):
        return len(self.boxes & self.goals)

    def status(self):
        s = (f"Moves so far: {len(self.path)}{' (since your last RESET)' if self.resets else ''} | boxes on goals: {self.on_goal()}/2 | "
             f"move budget used: {self.total_moves}/{MOVE_BUDGET} | replies left: {MAX_TURNS - self.turns} | resets left: {MAX_RESETS - self.resets}")
        if self.cfg.notes and self.note:
            s += f'\nYour latest note: "{self.note}"'
        return s

    def finish(self, reason):
        self.done, self.end_reason = True, reason

    def apply_turn(self, text, finish, ntok, ptok, commit_text=None, commit_ntok=0, ckpts=None, commit_ptok=0):
        self.turns += 1; k = self.turns
        self.gen_tokens += ntok + commit_ntok; self.prompt_tokens += ptok + commit_ptok
        pr = parse_reply(text, self.cfg.notes); committed = False
        if pr["kind"] == "none" and commit_text is not None:
            v = parse_commit(commit_text)
            if v is not None:
                pr.update(kind="reset" if v == "RESET" else "moves", value=v, reason=None); committed = True; self.committed += 1
        if self.cfg.notes and pr["note"]:
            self.note = pr["note"]
        rec = {"turn": k, "finish": finish, "gen_tokens": ntok, "prompt_tokens": ptok, "think_closed": pr["think_closed"],
               "kind": pr["kind"], "strict_format": pr["strict_format"], "committed": committed, "commit_tokens": commit_ntok,
               "commit_prompt_tokens": commit_ptok, "requested": pr["value"], "requested_len": len(pr["value"] or ""), "applied": "", "illegal_at": None, "clipped": False,
               "budget_clipped": False, "solved_after": False, "note": pr["note"] if self.cfg.notes else None,
               "note_unreadable": bool(self.cfg.notes and pr["note_unreadable"])}
        head = f"[Turn {k}/{MAX_TURNS}] "
        if pr["kind"] == "none":
            if not pr["think_closed"] and finish != "length":
                pr["reason"] = "your reply ended before your thinking was closed with </think>"
            self.unparseable += 1; self.consec_unparse += 1
            assistant = NO_JSON_ASSISTANT
            body = (f"No valid move JSON found: {pr['reason']}. The board is unchanged "
                    f"({self.consec_unparse} of {MAX_CONSEC_UNPARSE} allowed consecutive replies without a move JSON).\n")
        elif pr["kind"] == "reset":
            self.consec_unparse = 0
            assistant = json.dumps({"moves": "RESET", **({"note": pr["note"]} if self.cfg.notes and pr["note"] else {})})
            if self.resets < MAX_RESETS:
                self.resets += 1; self.boxes, self.player, self.path = self.boxes0, self.player0, ""
                body = f'You sent {{"moves": "RESET"}}. RESET done ({self.resets} of {MAX_RESETS} resets used): the board is back at the start.\n'
                rec["applied"] = "RESET"
            else:
                self.reset_refused += 1
                body = f'You sent {{"moves": "RESET"}}. RESET refused: both resets were already used. The board is unchanged.\n'
        else:
            self.consec_unparse = 0
            req = pr["value"]; v = req
            shown = req if len(req) <= ECHO_MAX else req[:ECHO_MAX]         # bounded echo/history; the clip below is unchanged
            rec.update(requested=shown, requested_len=len(req))
            assistant = json.dumps({"moves": shown, **({"note": pr["note"]} if self.cfg.notes and pr["note"] else {})})
            body = (f'You sent {{"moves": "{shown}"}}. ' if len(req) <= ECHO_MAX else
                    f'You sent {{"moves": "{shown}..."}} ({len(req)} moves; only the first {ECHO_MAX} are shown). ')
            if len(v) > MAX_PER_TURN:
                v = v[:MAX_PER_TURN]; self.clipped += 1; rec["clipped"] = True
                body += f"Only the first {MAX_PER_TURN} moves were used (at most {MAX_PER_TURN} per reply). "
            left = MOVE_BUDGET - self.total_moves
            if len(v) > left:
                v = v[:left]; self.budget_clipped += 1; rec["budget_clipped"] = True
                body += f"Only {left} moves were left in the {MOVE_BUDGET}-move budget. "
            p0 = self.player; origin = {b: b for b in self.boxes}; applied = ""; illegal_at = None
            for i, m in enumerate(v):
                res = step(self.walls, self.boxes, self.player, m)
                if res is None:
                    illegal_at = i; break
                nb = frozenset(res[0])
                if nb != self.boxes:
                    (src,) = self.boxes - nb; (dst,) = nb - self.boxes; origin[dst] = origin.pop(src)
                self.boxes, self.player = nb, res[1]; applied += m
                if self.boxes == self.goals:
                    self.solved = True; break
            self.total_moves += len(applied); self.path += applied
            rec.update(applied=applied, illegal_at=illegal_at)
            body += f'Applied {len(applied)} of {len(v)}: "{applied}".'
            if illegal_at is not None:
                self.illegal += 1
                body += f" ILLEGAL@{illegal_at}: move {illegal_at} ('{v[illegal_at]}') is blocked, so it and the moves after it were not applied."
            if self.solved and len(applied) < len(v):
                body += " (The remaining moves were not needed.)"
            moved = [f"box {fmt(o)}->{fmt(d)}" for d, o in sorted(origin.items(), key=lambda kv: kv[1]) if o != d]
            delta = ([f"player {fmt(p0)}->{fmt(self.player)}"] if self.player != p0 else []) + moved
            body += "\nChange: " + ("; ".join(delta) if delta else "none") + ".\n"
        if rec["note_unreadable"]:
            body += "Your note could not be read (its JSON object did not decode, or the note was not a string), so your previous note is kept.\n"
        if self.solved:
            self.verified = verify(self.case["board"], self.path) == "OK"
            assert self.verified, ("simulator/verify disagreement", self.case["id"], self.path)
            self.gen_tokens_at_solve = self.gen_tokens; rec["solved_after"] = True
            body += "All boxes are on goals: SOLVED.\n"
        obs = head + body + "Current board:\n" + render(self.walls, self.goals, self.boxes, self.player) + "\n" + self.status()
        if self.solved: self.finish("solved")
        elif self.consec_unparse >= MAX_CONSEC_UNPARSE: self.finish("unparseable_x3")
        elif self.total_moves >= MOVE_BUDGET: self.finish("move_budget")
        elif self.turns >= MAX_TURNS: self.finish("turn_limit")
        if not self.done:
            obs += '\nReply with your next 1-8 moves as {"moves": "..."}, or {"moves": "RESET"}.'
        rec["reply"] = obs
        self.hist.append((assistant, obs)); self.turn_log.append(rec)
        self.raw_turns.append({"turn": k, "finish": finish, "text": text, "commit_text": commit_text, "ckpt_chars": ckpts})

    def summary(self):
        return {"id": self.case["id"], "band": self.case.get("band"), "oracle_len": self.case.get("oracle_len"), "sample": self.sample,
                "episode": self.idx, "solved": self.solved, "verified": self.verified, "end_reason": self.end_reason,
                "turns": self.turns, "total_moves": self.total_moves, "path": self.path, "path_len": len(self.path),
                "illegal": self.illegal, "unparseable": self.unparseable, "resets": self.resets, "reset_refused": self.reset_refused,
                "clipped": self.clipped, "budget_clipped": self.budget_clipped, "committed_turns": self.committed,
                "gen_tokens": self.gen_tokens, "prompt_tokens": self.prompt_tokens, "gen_tokens_at_solve": self.gen_tokens_at_solve,
                "solved_within_16k": bool(self.solved and self.gen_tokens_at_solve <= 16384), "turns_log": self.turn_log}


def _log(*a):
    print(*a, flush=True)


def enc_len(tok, text):
    return len(tok(text, add_special_tokens=False)["input_ids"])


def chat(tok, msgs):
    return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=True)


def new_episodes(cases, n_samples, cfg):
    return [Episode(c, s, ci * n_samples + s, cfg) for ci, c in enumerate(cases) for s in range(n_samples)]


def run_episodes(llm, tok, cases, n_samples, make_sp, cfg, log=_log, on_round=None, eps=None, rounds=None):
    """make_sp(seed, max_tokens, greedy=False, stop=None) -> sampling params. llm.generate(prompts, params_list) -> outputs
    with .outputs[0].{text, token_ids, finish_reason}. Returns (episodes, rounds).
    eps / rounds may be passed in (a replayed state for --resume, or lists the caller keeps for crash reporting); they are
    mutated in place. on_round(eps, rounds, turn_rows, events) runs after every round has been applied: turn_rows hold
    every field apply_turn consumed (the durable replay log), events hold context_limit endings."""
    eps = new_episodes(cases, n_samples, cfg) if eps is None else eps
    rounds = [] if rounds is None else rounds
    suffix_len = None
    while True:
        active = [e for e in eps if not e.done]
        if not active: break
        t = time.time(); live, prompts, sps, events = [], [], [], []
        for e in active:
            p = chat(tok, e.messages()); plen = enc_len(tok, p)
            room = cfg.max_model_len - plen - ((COMMIT_TOKENS + COMMIT_RESERVE) if cfg.commit else 0)
            if room < MIN_ROOM:
                e.finish("context_limit"); events.append({"event": "context_limit", "episode": e.idx, "turns": e.turns, "prompt_tokens": plen})
                continue
            live.append((e, p, plen, e.seed())); prompts.append(p); sps.append(make_sp(e.seed(), min(cfg.turn_tokens, room)))
        if not live:
            if on_round and events: on_round(eps, rounds, [], events)
            continue
        outs = llm.generate(prompts, sps)
        assert len(outs) == len(live)
        commits, skipped = {}, 0
        if cfg.commit:
            jobs = []
            for i, o in enumerate(outs):
                if o.outputs[0].finish_reason == "length" and "</think>" not in o.outputs[0].text:
                    cp = prompts[i] + o.outputs[0].text + COMMIT_SUFFIX; cplen = enc_len(tok, cp)
                    if cplen + COMMIT_TOKENS <= cfg.max_model_len: jobs.append((i, cp, cplen))
                    else: skipped += 1         # cannot happen with the preflight bound; never crash the round on it
            if jobs:
                co = llm.generate([j[1] for j in jobs], [make_sp(live[i][3], COMMIT_TOKENS, greedy=True, stop=['"']) for i, _, _ in jobs])
                assert len(co) == len(jobs)
                commits = {i: (c.outputs[0].text, len(c.outputs[0].token_ids), cplen) for (i, _, cplen), c in zip(jobs, co)}
        rows = []
        for i, ((e, p, plen, seed), o) in enumerate(zip(live, outs)):
            s = o.outputs[0]; ct, cn, cp = commits.get(i, (None, 0, 0)); ck = ckpt_chars(tok, s.token_ids)
            e.apply_turn(s.text, s.finish_reason, len(s.token_ids), plen, ct, cn, ck, cp)
            rows.append({"event": "turn", "episode": e.idx, "id": e.case["id"], "sample": e.sample, "turn": e.turns, "seed": seed,
                         "text": s.text, "finish": s.finish_reason, "ntok": len(s.token_ids), "ptok": plen, "commit_text": ct,
                         "commit_ntok": cn, "commit_ptok": cp, "ckpt_chars": ck, "rec": e.turn_log[-1]})
        recs = [r["rec"] for r in rows]
        r = {"round": len(rounds) + 1, "requests": len(live), "commits": len(commits), "commit_skipped_no_room": skipped,
             "gen_s": round(time.time() - t, 1), "gen_tokens": sum(len(o.outputs[0].token_ids) for o in outs),
             "max_prompt_tokens": max(x[2] for x in live), "truncated": sum(x["finish"] == "length" for x in recs),
             "think_closed": sum(x["think_closed"] for x in recs), "no_move_json": sum(x["kind"] == "none" for x in recs),
             "illegal": sum(x["illegal_at"] is not None for x in recs),
             "done_after": sum(e.done for e in eps), "solved_after": sum(e.solved for e in eps)}
        rounds.append(r)
        log("WM_ROUND", json.dumps(r))
        if r["round"] == 3:
            tl = [x for e in eps for x in e.turn_log]
            log("WM_EARLY", json.dumps({"turns": len(tl), "truncated_rate": round(sum(x["finish"] == "length" for x in tl) / max(1, len(tl)), 3),
                                        "think_closed_rate": round(sum(x["think_closed"] for x in tl) / max(1, len(tl)), 3),
                                        "committed": sum(x["committed"] for x in tl), "no_move_json": sum(x["kind"] == "none" for x in tl),
                                        "end_reasons": dict(collections.Counter(e.end_reason for e in eps if e.done))}))
        if on_round: on_round(eps, rounds, rows, events)
    return eps, rounds


def replay(eps, rows):
    """Rebuild episode state from turns.jsonl rows (--resume). Each replayed turn record must equal the stored one."""
    by, n = {e.idx: e for e in eps}, 0
    for r in rows:
        ev = r.get("event")
        if ev == "turn":
            e = by[r["episode"]]
            assert (not e.done and r["turn"] == e.turns + 1 and r["seed"] == e.seed() and r["id"] == e.case["id"]
                    and r["sample"] == e.sample), ("replay order/seed mismatch", r["episode"], r["turn"])
            e.apply_turn(r["text"], r["finish"], r["ntok"], r["ptok"], r["commit_text"], r["commit_ntok"], r["ckpt_chars"], r["commit_ptok"])
            assert e.turn_log[-1] == r["rec"], ("replayed turn record differs from the stored one", r["episode"], r["turn"])
            n += 1
        elif ev == "context_limit":
            by[r["episode"]].finish("context_limit")
    return n


def totals(eps, cases, n_samples):
    per_board = collections.OrderedDict((c["id"], 0) for c in cases)
    for e in eps: per_board[e.case["id"]] += int(e.solved)
    tl = [t for e in eps for t in e.turn_log]
    gen = sum(e.gen_tokens for e in eps)
    bands = sorted({c.get("band") for c in cases if c.get("band")})
    return {"episodes": len(eps), "solved": sum(e.solved for e in eps), "boards_any_solved": sum(v > 0 for v in per_board.values()),
            "solved_within_16k": sum(e.solved and e.gen_tokens_at_solve <= 16384 for e in eps),
            "end_reasons": dict(collections.Counter(e.end_reason for e in eps)),
            "turns": sum(e.turns for e in eps), "illegal": sum(e.illegal for e in eps), "unparseable": sum(e.unparseable for e in eps),
            "resets": sum(e.resets for e in eps), "reset_refused": sum(e.reset_refused for e in eps), "clipped": sum(e.clipped for e in eps),
            "committed_turns": sum(e.committed for e in eps), "strict_format_turns": sum(t["strict_format"] for t in tl),
            "no_move_json_turns": sum(t["kind"] == "none" for t in tl), "note_unreadable_turns": sum(bool(t.get("note_unreadable")) for t in tl),
            "budget_clipped": sum(e.budget_clipped for e in eps),
            "truncated_turns": sum(t["finish"] == "length" for t in tl), "think_closed_turns": sum(t["think_closed"] for t in tl),
            "gen_tokens": gen, "prompt_tokens": sum(e.prompt_tokens for e in eps),
            "solves_per_1M_gen_tokens": round(1e6 * sum(e.solved for e in eps) / gen, 3) if gen else None,
            "per_band": {b: {"solved": sum(e.solved for e in eps if e.case.get("band") == b),
                             "episodes": sum(e.case.get("band") == b for e in eps)} for b in bands},
            "per_board_solved": per_board, "n_samples": n_samples}


def code_sha():
    return {f: sha_file(os.path.join(HERE, f)) for f in CODE}


def receipt_paths(out, tag):
    """(final, raw, partial, turns.jsonl). final/raw/turns.jsonl are never overwritten; partial is a progress file."""
    b = os.path.join(out, f"wm_interactive_{tag}")
    return b + ".json", b + ".raw.json", b + ".partial.json", b + ".turns.jsonl"


def split_args(argv):
    return [a for a in argv if not a.startswith("--")], {a for a in argv if a.startswith("--")}


def preflight(setfile, out, tag, notes=False, tok=None, require_think=True):
    """CPU only. Set guard, receipts absent, worst-case prompt (11 earlier turns, longest observations, longest note, a
    >64-move request) fits with the turn + commit budget, and the multi-turn generation tail is one string that opens
    thinking (the v7 box preflight logged "<|im_start|>assistant\\n<think>\\n" for the Ornith template)."""
    raw, cases = load_set(setfile)
    fp, rp, _, jp = receipt_paths(out, tag)
    for p in (fp, rp, jp): assert not os.path.exists(p), f"{p} exists; refusing to overwrite"
    if tok is None:
        from v5_common import load_tok
        tok = load_tok()
    cfg = Cfg(notes=notes); worst = 0; tails = set()
    for c in cases:
        e = Episode(c, 0, 0, cfg)
        for k in range(MAX_TURNS - 1):                    # worst case: 11 earlier turns, longest observations
            e.apply_turn('x\n</think>\n\n{"moves": "' + "U" * 8 + "R" * 120 + '", "note": "' + "n" * NOTE_MAX + '"}', "stop", 0, 0)
            if e.done: break
        e.done = False
        p = chat(tok, e.messages()); worst = max(worst, enc_len(tok, p)); tails.add(p[p.rindex("<|im_start|>assistant"):] if "<|im_start|>assistant" in p else p[-40:])
    assert worst + TURN_TOKENS + COMMIT_TOKENS + COMMIT_RESERVE <= MAX_MODEL_LEN, worst
    assert len(tails) == 1 and "</think>" not in next(iter(tails)), tails
    tail = next(iter(tails))
    if require_think:
        assert tail.rstrip().endswith("<think>"), f"generation tail does not open thinking: {tail!r}"
    print("WM_PREFLIGHT_OK interactive set", os.path.basename(setfile), "sha256", sha_file(setfile), "cases", len(cases),
          "worst_prompt_tokens", worst, "gen_tail", json.dumps(tail), "opens_think", tail.rstrip().endswith("<think>"),
          "code", json.dumps(code_sha()), flush=True)
    return worst


def main(argv=None, llm_factory=None, tok=None, sp_factory=None, log=_log):
    args, flags = split_args(sys.argv[1:] if argv is None else argv)
    if "--preflight" in flags:
        return preflight(args[0], args[1], args[2], notes="--notes" in flags, tok=tok)
    mdl, tag, out, setfile, n = args[0], args[1], args[2], args[3], int(args[4])
    unknown = flags - {"--commit-on-truncate", "--notes", "--resume"}
    assert not unknown, f"unknown flags {unknown}"
    cfg = Cfg(commit="--commit-on-truncate" in flags, notes="--notes" in flags)
    resume = "--resume" in flags
    final_path, raw_path, part_path, jl_path = receipt_paths(out, tag)
    for p in (final_path, raw_path): assert not os.path.exists(p), f"{p} exists; refusing to overwrite"
    if resume:
        assert os.path.exists(jl_path), f"--resume: {jl_path} missing"
    else:
        assert not os.path.exists(jl_path), f"{jl_path} exists; refusing to overwrite (use --resume to continue it)"
    raw, cases = load_set(setfile)
    T0 = time.time(); versions = {}
    if llm_factory is None:
        from vllm import LLM, SamplingParams
        from v5_common import load_tok, MODEL
        versions = run_versions()
        tok = load_tok()
        llm = LLM(model=mdl, tokenizer=MODEL, dtype="bfloat16", max_model_len=MAX_MODEL_LEN, gpu_memory_utilization=0.90, seed=SEED,
                  enable_prefix_caching=True)

        def sp_factory(seed, max_tokens, greedy=False, stop=None):
            if greedy:
                return SamplingParams(temperature=0.0, max_tokens=max_tokens, seed=seed, stop=stop)
            return SamplingParams(**SAMPLING, max_tokens=max_tokens, seed=seed, stop=stop)
    else:
        llm = llm_factory()
    head = {"tag": tag, "model": mdl, "set": os.path.basename(setfile), "set_sha256": sha_file(setfile), "n_samples": n,
            "versions": versions, "code_sha256": code_sha(), "config": cfg.as_dict(), "prereg_sha256": prereg_sha(),
            "evidence_class": "EXPLORATORY"}
    eps, rounds = new_episodes(cases, n, cfg), []
    if resume:
        rows, cut = read_jsonl(jl_path)
        assert rows and rows[0].get("event") == "head", "turns.jsonl has no head line"
        h0 = rows[0]["head"]
        for k in ("tag", "model", "set", "set_sha256", "n_samples", "code_sha256", "config", "prereg_sha256"):
            assert h0.get(k) == head[k], f"--resume: {k} differs from the interrupted run"
        n_rep = replay(eps, rows[1:])
        rounds += [r["round_info"] for r in rows if r.get("event") == "round"]
        ev = {"event": "resume", "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "replayed_turns": n_rep,
              "rounds_done": len(rounds), "cut_bytes": cut, "episodes_done": sum(e.done for e in eps), "versions": versions}
        head["resumes"] = [r for r in rows if r.get("event") == "resume"] + [ev]
        append_jsonl(jl_path, [ev])
        log("WM_RESUME", json.dumps(ev))
    else:
        append_jsonl(jl_path, [{"event": "head", "head": head}])

    def on_round(eps_, rounds_, turn_rows, events):
        append_jsonl(jl_path, turn_rows + events + ([{"event": "round", "round_info": rounds_[-1]}] if turn_rows else []))
        write_json(part_path, {**head, "stage": "partial", "rounds": rounds_, "totals": totals(eps_, cases, n),
                               "finished_episodes": [e.summary() for e in eps_ if e.done]})

    try:
        run_episodes(llm, tok, cases, n, sp_factory, cfg, log=log, on_round=on_round, eps=eps, rounds=rounds)
    except BaseException as ex:
        try:
            write_json(part_path, {**head, "stage": "incomplete", "error": f"{type(ex).__name__}: {ex}"[:2000], "rounds_done": len(rounds),
                                   "rounds": rounds, "totals": totals(eps, cases, n), "turns_jsonl": os.path.basename(jl_path),
                                   "finished_episodes": [e.summary() for e in eps if e.done]})
        except Exception as ex2:
            log("WM_WARN could not write the incomplete receipt:", type(ex2).__name__)
        log("WM_INTERACTIVE_INCOMPLETE", tag, "rounds_done", len(rounds), "error", f"{type(ex).__name__}: {ex}"[:300])
        raise
    tt = totals(eps, cases, n)
    write_json(raw_path, {**head, "stage": "raw", "episodes": [{"id": e.case["id"], "sample": e.sample, "episode": e.idx,
                                                                 "turns": e.raw_turns} for e in eps]})
    write_json(final_path, {**head, "stage": "final", "rounds": rounds, "totals": tt, "wall_s": round(time.time() - T0, 1),
                            "episodes": [e.summary() for e in eps]})
    if os.path.exists(part_path): os.remove(part_path)
    log("WM_INTERACTIVE_DONE", tag, "solved", tt["solved"], "of", tt["episodes"], "boards_any", tt["boards_any_solved"],
        "within16k", tt["solved_within_16k"], "end", json.dumps(tt["end_reasons"]), "gen_tokens", tt["gen_tokens"])
    return final_path


if __name__ == "__main__":
    main()
