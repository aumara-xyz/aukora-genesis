# The worktree fence — a preregistered widening, and its null result

**Status: REFUSED. Nothing shipped.** The three preregistered controls all held; the kill condition
fired anyway, on the legitimate case rather than the forged one.

Measured at `bc47270`, macOS, git 2.50.1. Reproduce with:

```bash
bun test test/witness-worktree-fence.test.mjs
```

That suite passes against unmodified code. It is the measurement; this file is the argument.

---

## 0 · What was proposed, and what it cost to leave alone

`core/witness/paths.mjs` resolves a path, compares it to the governed root, and calls anything that
lands outside `law:outside-repo`. A legitimate `git worktree` sibling of the governed repository is
outside by that test, so the law refuses writes there.

Measured cost, three separate hits in one day:

- it refused this lane's own test write mid-PR #93, until the session was re-pointed at the worktree;
- Lane 1 abandoned worktrees entirely in #92 rather than fight it;
- it refuses the lead's memory directory.

**The proposed rule:** a worktree of the governed repo IS the governed repo — same gitdir.

Widening a fence is the dangerous direction, so this was preregistered rather than argued.

---

## 1 · Preregistration

Declared before any measurement.

**CONTROLS** — each must stay REFUSED, or the widening is unsafe at any price:

| | control | must be |
|---|---|---|
| A | a directory dressed like a worktree — a hand-written `.git` file naming the governed repo | REFUSED |
| B | a worktree of a **different** repository, placed adjacent to the governed one | REFUSED |
| C | a symlink from inside the governed repo into a **foreign** worktree | REFUSED |

**KILL CONDITION** — one sentence, declared in advance:

> If any directory outside the governed root can enter the admitted set through an action the guard
> does not refuse, or if any admitted path can reach `judge()` with an empty key set, the measurement
> is void and the widening does not ship regardless of how many controls passed.

**NULLS** — reported here at the same volume as any pass, per T-WWR. There is no summary line in this
document that says "3 of 3 controls held" without the sentence that follows it.

---

## 2 · The controls held. All three.

This is the honest and slightly awkward result: **forgery is impossible**, and if the question had
been "can a fake worktree get in?", the widening would have shipped.

**Control A — inert.** A hand-written `.git` file naming `<gov>/.git/worktrees/fake` is not a
repository: `git -C fake rev-parse --git-common-dir` exits 128, and `git -C gov worktree list` does
not claim it. Registration requires writing `<gov>/.git/worktrees/<name>/gitdir`, and `.git/**` is in
`DEFAULT_PROTECTED` in `core/witness/law.mjs` — unioned into every parsed law and not removable by
editing `aukora.law.json`. So no fenced write can forge a registration.

**Control B — refused, and git can tell them apart.** The legitimate worktree's `--git-common-dir`
resolves to the governed repo's git dir; the foreign worktree's does not. This is the one part of the
proposal that was sound.

**Control C — refused, and legible.** `realpathish` resolves the link out; `outside` stays true, and
the receipt carries `aliased: true` with `resolved` naming the real destination. The escape is
recorded, not merely blocked.

---

## 3 · And the kill condition fired

The controls asked *"can a **fake** worktree get in?"* The question that decides the change is
**"who controls the set of real ones?"**

The answer is: the party being fenced.

`.claude/settings.json` fences `Write|Edit|MultiEdit|NotebookEdit`. `Bash` is in
`KNOWN_NON_WRITE_TOOLS` in `core/witness/guard.mjs`, and the law's `unguardedTools: 'receipt'`
records it rather than refusing it. So `git worktree add /anywhere` costs an agent one unrefused
command, and under the widening that directory becomes a writable region of the governed repository —
with no attacker in the story, no forgery, and not one control violated.

This is not hypothetical. `git worktree list` on this repository today returns ten entries, **two of
which are agent scratch directories** under `/private/tmp` that no owner ever declared governed.

> **The null, stated plainly.** The widening does not ship. Three forgery controls passed and the
> change is still refused, because the predicate it would install is not a property of the repository —
> it is a mutable list the fenced party appends to. No detection algorithm fixes this, because the
> algorithm would be *correct*: those directories genuinely are worktrees of this repo. Correct
> detection of a mutable fact is still a fence whose boundary the agent draws.

### Two further nulls, each independently sufficient

**A naive widening fails open, catastrophically.** Flipping `outside` to `false` is not enough.
`analyse()` returns early for an outside path *before* it adds any fold-key, so `keys` comes back
empty and `judge(rules, [])` matches no rule at all. Measured from a lane worktree under a simulated
naive widening: `../gov/.git/config`, `../gov/aukora.law.json`, `../gov/.env` and
`../gov/.aukora/witness.jsonl` all came back **ALLOWED, `keys=[]`, no rule matched** — the governed
checkout's entire self-protection set, writable by the fenced Write tool, including the registration
file that decides the fence's own boundary. Pinned as `KILL 2` in the suite.

**`repoRoot` is not pinned to a repository.** `guard.mjs` takes the caller's `cwd` verbatim; there is
no `rev-parse --show-toplevel` anywhere in `core/`. Asking git "what are your worktrees?" from an
arbitrary directory answers about the nearest enclosing repo, not the governed one.

---

## 4 · It would also have moved the conformance floor

A hard requirement on any fence change: the twelve conformance verdicts must not move.

Cases **01-dotdot-traversal** and **03-dangling-symlink** are the only two whose entire verdict is
`law:outside-repo`. Neither has a rule to fall back on — both carry `keys=[]`. Under a widened fence
both **flip REFUSE → ALLOW** whenever the sandbox lands inside a registered worktree; reproduced by
pointing `TMPDIR` into one.

On this machine today `os.tmpdir()` is outside every worktree, so nothing flips right now. **That is
the problem, not the reassurance:** a corpus whose verdicts depend on an environment variable has
stopped being a standard φ is measured against.

Because the answer is NO-GO, the guarantee is total and trivial: **zero lines of `core/` changed, so
zero of the twelve verdicts changed.** The floor stays 7 and GATE-0 stays open.

---

## 5 · What would have to be true for a future attempt

Not a plan — a bound on anyone who returns to this.

1. The admitted set must be an **owner-declared list in the signed law** (e.g. `worktreeRoots: [...]`,
   covered by `checkLawAuthority`), never `git worktree list`. That moves the boundary back to the
   owner, which is the only party the fence is not fencing.
2. Each declared root verified by the **three-way handshake** git itself omits:
   `<R>/.git/worktrees/<n>/gitdir` names `<P>/.git`, **and** `<P>/.git` resolves back to that same
   admin dir, **and** `commondir` resolves to `<R>/.git` — all after `realpath`.
3. Resolved **once per process**, not inside the per-path map, or every judged path spawns git.
4. Fold-keys **re-derived against the matched root and unioned** with the lexical keys, or finding 2
   above lands unchanged.

That is a signed-law schema change, not a fence tweak. It is a different proposal, and it is not
this lane's to make.

---

## 6 · Separately noted, not addressed here

Surfaced by this investigation, neither caused nor fixed by it. Logged so no future PR reads as
having closed them:

- **The conformance sandbox does not assert it is outside any git repository** before the sweep. One
  `rev-parse --show-toplevel` per run would remove the `TMPDIR` dependency in §4 permanently. This is
  the one piece of the worktree investigation worth landing, and it is offered rather than taken.
- A **foreign repository checked out inside** the governed tree is judged `ok:allowed` today — it is
  really inside the root and no rule names it.
- `.git/**` compiles anchored at the root, so `nested/.git` and `submodule/.git` are writable while
  `.git/config` is not.
