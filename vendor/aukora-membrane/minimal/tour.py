#!/usr/bin/env python3
"""
tour.py — the whole idea in about sixty seconds, and every claim in it is a command you can run.

    python3 minimal/tour.py

WHAT YOU STILL HAVE TO TRUST, because "nothing taken on trust" would be false and it was the first
line of this file until a reviewer read it cold: SHA-256, the Python that executes this, and your
own eyes reading the source. Everything above those three is checkable here. That is a smaller
claim than the one this file used to make, and it is the true one.

WRITTEN BY THE PARTY WHOSE RECORD IT VERIFIES. This is a teaching file with an interest, authored
by the project it teaches. Read it the way you would read any interested party's demonstration —
which is why every beat is a command you can re-run, and why the omissions are listed at the end.

NOT A SECOND IMPLEMENTATION. Every verdict below is produced by running the real verifier as a
separate process against the real published bytes. This file computes no hashes, folds no proofs
and decides no verdicts — it prints the command it ran and the answer it got back. If a line here
disagreed with the artifact, the artifact would win, because the artifact is what ran.

AND IT COMPUTES NO NUMBER IT PRESENTS. The scoreboard's counts are READ from a published field that
a gate checks, not derived here. That rule exists because this file broke it: it computed "honest"
from a raw label and printed 0 of 3, while the published, gate-checked field said 7 — understating
its own strongest true claim by more than double, in the direction that flattered nobody but was
wrong all the same. A teaching artifact that computes its own denominator has chosen which true
number to show, and that is where persuasion hides.
"""
import subprocess, sys, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
VERIFY = os.path.join(HERE, "verify.py")
DEMO = os.path.join(REPO, "docs", "heads", "demo")

W = 78
def rule(ch="─"): print("  " + ch * W)
def wrap(text, indent="  "):
    line = ""
    for word in text.split():
        if len(line) + len(word) + 1 > W:
            print(indent + line); line = word
        else:
            line = (line + " " + word).strip()
    if line: print(indent + line)

def run_case(name):
    """Run the REAL verifier as a cold subprocess. Return (verdict, reason, extra, cmd)."""
    ret = os.path.join(DEMO, name, "retained.json")
    pres = os.path.join(DEMO, name, "presented.json")
    cmd = f"python3 minimal/verify.py docs/heads/demo/{name}/retained.json docs/heads/demo/{name}/presented.json"
    out = subprocess.run([sys.executable, VERIFY, ret, pres],
                         capture_output=True, text=True, cwd=REPO).stdout
    v = r = x = ""
    for line in out.split("\n"):
        if line.startswith("VERDICT:"): v = line.split(":", 1)[1].strip()
        elif line.startswith("REASON"): r = line.split(":", 1)[1].strip()
        elif line.startswith("LIMIT"): x = line.split(":", 1)[1].strip()
    return v, r, x, cmd

def act(n, title, name, lesson):
    print()
    rule("═")
    print(f"  ACT {n}.  {title}")
    rule("═")
    v, r, x, cmd = run_case(name)
    print(f"  $ {cmd}")
    print()
    print(f"      VERDICT   {v}")
    print(f"      REASON    {r}")
    if x: print(f"      LIMIT     {x}")
    print()
    wrap(lesson)
    return v

def size_of(name, which):
    try:
        with open(os.path.join(DEMO, name, which + ".json")) as f:
            return json.load(f).get("treeSize")
    except Exception:
        return None

print()
rule("═")
print("  AUKORA — the whole idea, run rather than described")
rule("═")
print()
wrap("You keep a log. Someone shows you a longer version of it later and says nothing was "
     "changed, only added. How do you check that without trusting them?")
print()
wrap("You keep ONE LINE: how many entries you saw, and a fingerprint of them. Later they hand "
     "you that same line for today, plus a small proof. Arithmetic does the rest. If they "
     "quietly rewrote anything in the part you already saw, the numbers stop meeting.")
print()
wrap("Everything below is the real program, run on real published files. The command is shown "
     "each time. Run any of them yourself.")

act(1, "AN HONEST LOG THAT GREW", "append-only",
    "The log grew from one size to a larger one and nothing earlier was touched. The proof "
    "connects and lands exactly on the fingerprint that was kept. This is the only thing "
    "APPEND_ONLY means — and it is NOT a statement that the entries are true, that the events "
    "happened, or that this is the only log they keep.")

act(2, "THE SAME HONEST LOG — BUT THE PROOF WAS DAMAGED IN TRANSIT", "damaged-proof",
    "One piece of the proof was corrupted on the way over. Nothing was rewritten. The program says "
    "I CANNOT TELL. A broken envelope is not a crime, and calling it one would convict someone "
    "whose only mistake was a bad connection. Getting this wrong once is how a verifier becomes a "
    "weapon. This file used to claim here that most other systems get it wrong — a comparison no "
    "command in this file can run, and therefore the one sentence in it you would have had to take "
    "on faith. It is gone. If you have another verifier to hand, feed it this same pair yourself: "
    "that comparison is yours to run, not ours to assert.")

v3 = act(3, "THE TWO RECORDS CONFLICT", "rewrite-2047",
    "TWO VOICES HERE, AND KEEPING THEM APART IS THE LESSON. As the author of this fixture WE can "
    "tell you how it was built: an entry inside the retained range was replaced, and a proof was "
    "constructed over the edited tree. THE PROGRAM KNOWS NONE OF THAT. What it establishes is "
    "narrower and it is the whole verdict: the proof folds correctly to the log being shown, and "
    "lands on a fingerprint that is not the one you kept. THE PRESENTED OBSERVATION CONFLICTS "
    "WITH THE RETAINED OBSERVATION. Nothing about who, nothing about when, nothing about intent. "
    "This act was titled 'AN ACTUAL FORGERY' and then 'AN ENTRY WAS REWRITTEN', and both were "
    "the instrument borrowing the fixture author's knowledge — an event asserted by a verdict "
    "that cannot see events.")

v4 = act(4, "THE SAME REWRITE, ONE ENTRY LATER", "rewrite-2048",
    "Same rewrite. Same method. The only difference is that the size you had kept is 2048 instead "
    "of 2047 — and 2048 is a power of two. At those sizes the mathematics genuinely cannot "
    "separate 'they rewrote it' from 'the proof is broken', because your own fingerprint is used "
    "as the starting point of the calculation. So the program refuses to accuse, and says exactly "
    "why. This is not a bug and it is not a limitation we chose. It is a property of the "
    "mathematics, and the program declares it out loud rather than guessing.")

print()
rule("═")
print("  THE SCOREBOARD — counted, not claimed")
rule("═")
print()

honest, accused, rows = 0, 0, []
try:
    with open(os.path.join(DEMO, "cases.json")) as f:
        raw = json.load(f)
    cases = raw if isinstance(raw, list) else next(v for v in raw.values() if isinstance(v, list))
except Exception:
    cases = []

missing = []
for c in cases:
    name = c.get("name")
    # A MISSING CASE MUST BE LOUD. It used to `continue`, so a deleted fixture shrank the
    # denominator silently and the scoreboard still read as complete — the same shape as the
    # no-argument exit that printed nothing at all.
    if not name or not os.path.isdir(os.path.join(DEMO, name)):
        missing.append(name or "<unnamed>"); continue
    v, r, _, _ = run_case(name)
    # READ, NEVER DERIVE. `isHonestLog` is published in cases.json and checked by
    # scripts/head-emit.ts --check, which asserts every published boolean against the rule the
    # contract states. This file used to compute honesty from the raw `integrity` label and got 3
    # where the published field says 7 — the four it dropped are the transport-damaged and
    # malformed cases, which is exactly where a verifier is most likely to convict an innocent log.
    # The front door was understating its own strongest true claim by more than double.
    is_honest = c.get("isHonestLog") is True
    if is_honest:
        honest += 1
        if v == "OBSERVATION_CONFLICT": accused += 1
    rows.append((name, v, is_honest))

if missing:
    print(f"      !! {len(missing)} published case(s) have no directory: {', '.join(missing)}")
    print("         The scoreboard below is INCOMPLETE. This is a defect, not a result.")
    print()

for name, v, is_honest in rows:
    tag = "honest" if is_honest else "      "
    note = ""
    if is_honest and v != "APPEND_ONLY":
        note = "  <- honest, and REFUSED anyway. see below"
    print(f"      {name:<26} {tag}   {v}{note}")

print()
print(f"      published cases run          {len(rows)}")
print(f"      of those, HONEST logs        {honest}")
print(f"      honest logs it ACCUSED       {accused}")
print()
if accused == 0 and honest > 0:
    wrap("Zero. That number is the point of the whole thing, and it is the number almost nobody "
         "publishes. Every detector reports how much it catches. Ask one how often it accuses "
         "someone innocent — that column is usually missing, and a detector that answers 'guilty' "
         "to everything scores perfectly on the column they do show you.")
else:
    wrap(f"{accused} honest log(s) accused. That is a defect, not a feature — see NOT-READY.md.")

# THE TWO OBJECTIONS A SKEPTIC RAISES HERE, ANSWERED BEFORE THEY ASK. A scoreboard that shows only
# its good side is the thing this whole project refuses, so the thin denominator and the odd row
# are named here rather than left for someone to find.
refused_honest = [n for n, v, h in rows if h and v != "APPEND_ONLY"]
if refused_honest:
    print()
    wrap(f"AND {len(refused_honest)} OF THOSE {honest} HONEST LOGS WERE REFUSED RATHER THAN PASSED "
         f"— {', '.join(refused_honest)}. Read that carefully, because it is the shape of the whole "
         "thing. Not one of them was ACCUSED. Every one was declined, for a stated reason: a proof "
         "damaged in transit, a fingerprint truncated in a copy-paste, an entry count written `1e3` "
         "instead of `1000` — which spell the same number but which two languages read differently, "
         "so the same file could mean two things to two readers.")
    print()
    wrap("REFUSING A VALID-LOOKING FILE IS A REAL COST and it is paid on purpose. The alternative "
         "in each case was to guess — and a verifier that guesses is a verifier that eventually "
         "guesses against someone. Five refusals and zero accusations is not the program being "
         "weak. It is the only shape in which being wrong stays survivable.")
print()
wrap(f"AND THE DENOMINATOR HERE IS SMALL — {honest} honest cases is not a statistic, it is a "
     "demonstration. The real count runs elsewhere in this repo: scripts/consistency-differential.ts "
     "puts 97 honest vectors through every implementation and requires zero accusations from each. "
     "This tour shows you the shape; that gate shows you the size. Neither is the outside oracle, "
     "and the outside oracle is the one that matters most — bottom of this page.")

print()
rule("═")
print("  WHAT THIS DOES NOT PROVE")
rule("═")
print()
wrap("· It does not say any entry is true. Someone can keep a perfect, unaltered log of lies.")
wrap("· It does not say the events happened, or that any code ran.")
wrap("· It does not say who anyone is.")
wrap("· It does not say they keep only ONE log. Two separate logs, each internally consistent, "
     "shown to two different people, would pass this check twice.")
print()
wrap("Those limits are in minimal/CLAIM.md, and what is not finished is in NOT-READY.md. Both "
     "are meant to be read before the code, not after.")
# THE SELECTION MUST BE VISIBLE IN THE SAME UNIT AS THE CLAIM.
# The omissions section below defends this selection only to a reader who reads it — and a skimmer
# is not that reader. The scoreboard is the skim unit: it is the one block every reader sees. So it
# renders the coverage as a SHAPE. Four lit cells in a field of nineteen is felt without a sentence.
# Same law as the figure: a partial state must never render as whole.
CLASSES_TOTAL, CLASSES_SHOWN = 19, 4
print()
wrap(f"AND THIS MINUTE SHOWED YOU {CLASSES_SHOWN} OF {CLASSES_TOTAL} BEHAVIOURS THIS PROGRAM HAS. "
     "The lit cells are what four acts reached; the dim ones are real and live in gates you would "
     "have to go looking for. A demonstration is a selection, and this is the shape of ours.")
print()
print("      " + "  ".join("█" if i < CLASSES_SHOWN else "·" for i in range(CLASSES_TOTAL)))
print(f"      {CLASSES_SHOWN} shown{' ' * 24}{CLASSES_TOTAL - CLASSES_SHOWN} not shown")

print()
rule("═")
print("  WHAT YOU DID NOT SEE IN THIS MINUTE")
rule("═")
print()
wrap("Four acts is a SELECTION, and a selection made by the party being examined. Perfect truth "
     "can mislead by arrangement alone, so here is what this minute left out and where each lives. "
     "Every path below resolves; a gate fails if one stops resolving.")
print()
for path, what in [
    ("scripts/consistency-differential.ts", "97 honest vectors through every implementation, zero accusations required from each"),
    ("scripts/peer-class-corpus-verify.ts", "19 declared behaviour classes; this tour reaches 4 of them"),
    ("scripts/fixtures/external-oracle/SUMMARY.md", "98 cases NOT authored here — and what they do not reach"),
    ("minimal/replicas/rust-verifier", "a third implementation, different language, built from the spec"),
    ("LAW.md", "the failure classes this project has found in itself, with commit hashes"),
    ("NOT-READY.md", "what is unfinished, with a command for each"),
]:
    # AN EXPLICIT MARKER, NOT A WHITESPACE SHAPE. The gate that checks these paths first matched
    # by line indentation and swept up scoreboard rows — VERDICT and a case name read as paths.
    # A machine-readable prefix costs one word and removes the guessing.
    mark = "NOT-SHOWN" if os.path.exists(os.path.join(REPO, path)) else "MISSING!!"
    print(f"    {mark}  {path:<44} {what}")
print()
rule("═")
print("  NOW DO ONE YOURSELF — watching is not running")
rule("═")
print()
wrap("You have watched these commands run. You have not run them, and that difference is the whole "
     "subject of this project: observing a check is not performing one. So perform one.")
print()
print("      cp -r docs/heads/demo/append-only /tmp/mine")
print("      # open /tmp/mine/presented.json and change ONE character inside \"root\"")
print("      python3 minimal/verify.py /tmp/mine/retained.json /tmp/mine/presented.json")
print()
wrap("It will stop saying APPEND_ONLY. What it says instead — and whether that answer accuses you "
     "or merely declines — is the thing worth thirty seconds of your own hands.")
print()
rule("═")
print("  KEEP GOING")
rule("═")
print()
print("      python3 minimal/verify.py --selftest      # no files needed at all")
print("      cat minimal/CLAIM.md                      # what it refuses to claim")
print("      cat NOT-READY.md                          # what is not finished")
print("      cat scripts/fixtures/external-oracle/SUMMARY.md")
print()
wrap("That last one is the only test here we did not write. 98 cases from Google's Certificate "
     "Transparency lineage, by people who have never seen this project. Read its limits too: it "
     "reaches 12 of 19 behaviour classes, and ZERO of the two that can produce an accusation.")
print()
