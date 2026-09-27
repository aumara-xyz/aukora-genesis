// aukora · core/witness/guard.mjs — the gate
//
// Reads one tool call on stdin, decides, records, exits. Short-lived, single
// question, no state carried between invocations. There is no daemon, no lock,
// and no shared mutable head — and if this file ever seems to need one, the
// design has gone wrong and the answer is to stop rather than to add it.
//
// ══ NO RECEIPT, NO WRITE ══
//
// The ordering here is the whole integrity claim, and it is easy to get backwards.
//
// An ALLOW is only emitted AFTER its receipt is durably appended. If the append
// fails — disk full, permissions, an unwritable chain directory — the tool call
// is REFUSED, not allowed-and-unlogged. A gate that lets bytes reach disk with
// no record of having done so is not producing an audit trail; it is producing
// one with holes exactly where something went wrong, which is worse than none,
// because it reads as complete.
//
// A REFUSAL exits 2 whether or not its receipt landed. Refusing is safe under
// every failure mode, so nothing stands between the decision and it.
//
// ══ TWO ENTRIES, DIFFERENT FAILURE DIRECTIONS ══
//
// FENCE     matcher = the FENCED_TOOLS names below, invoked `… || exit 2`.
//           Fail-CLOSED. If it breaks, writes stop. Reads, Bash and the
//           conversation keep working, so a broken fence degrades the session
//           instead of killing it.
//
// WITNESS   no matcher, which both runtimes read as everything. Invoked plain: the `witness` verb
//           exits 0 unconditionally, so no shell suffix is needed. Fail-OPEN, blocks nothing, ever.
//           Records an `unguarded` receipt for every call the fence did not
//           judge — Bash included — so the chain shows its own edges rather
//           than implying it covered everything.
//
// The witness is where an honest record of the gap lives. It is not a second
// fence and must never become one.
//
// ══ THE LAW IS CHECKED BEFORE IT IS CONSULTED ══
//
// `runFence` asks `checkLawAuthority` whether the law file still matches the
// signature the owner put on it, and refuses everything if it does not — before
// `decide()` ever sees a rule. Order is the point: a law whose authorship
// cannot be established is not a law to be obeyed strictly or loosely, it is
// not a law. Consulting it first and validating it afterwards would mean the
// fence had already answered the question using bytes it does not trust.
//
// This closes the hole the fence could not: it refuses `Write` to
// `aukora.law.json`, but nothing stopped `bash -c 'sed -i …'` from widening the
// law and the guard from cheerfully obeying the new one on the next call. Now
// that edit stops every write until the owner re-signs with their phrase.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { analyse, isMultiplyLinked, realpathish } from './paths.mjs';
import { loadLaw, judge, judgeWritable, LAW_FILE } from './law.mjs';
import { append } from './chain.mjs';
import { loadSigner, readPub } from './aumlok.mjs';
import { checkLawAuthority, maybeCheckpoint, AUTHORITY_REASON } from './authority.mjs';

export const REFUSE = 2;
export const ALLOW = 0;

/**
 * The tools that write a file, enumerated from the live harness rather than from memory.
 *
 * ══ THE CLAIM THAT USED TO BE HERE WAS FALSE ══
 *
 * This comment said "this list and the matcher `init` writes are asserted equal by a test". No such
 * test existed, and the two had drifted: the installed matcher carried four names while this list
 * carried nine. The five extras were in the worst possible state, because the witness lane returns
 * early for anything in FENCED_TOOLS on the grounds that the fence already recorded it — so a name
 * here that the matcher does not carry is judged by NOBODY and recorded by NOBODY. Measured: those
 * five produced zero chain lines on a Claude-only install.
 *
 * The test now exists — `test/witness-governing-root.test.mjs` reads `.claude/settings.json` and
 * asserts every name below is matched by an installed matcher. A comment claiming a test is worth
 * nothing; the test is worth something, and the comment now points at it.
 */
// Tools the fence itself judges. The witness skips these because the fence already recorded them —
// so a name missing here is double-recorded, and a name wrongly here is recorded by nobody.
// Grok's spellings sit alongside Claude Code's; both runtimes' write tools must appear.
export const FENCED_TOOLS = Object.freeze([
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  // Grok Build. `search_replace` is its documented target for Edit/Write/MultiEdit; `write` is what a
  // live session was actually observed sending; the rest are its Cursor-compatibility aliases.
  // Measured, not guessed — a name missing here is recorded twice, once by each lane.
  'search_replace', 'write', 'create_file', 'edit_file', 'str_replace',
]);

/** A closed vocabulary. `log` renders these; nothing else appears — `view` was never built. */
export const REASON = Object.freeze({
  PROTECTED: 'law:protected-path',
  OUTSIDE: 'law:outside-repo',
  SIBLING: 'law:sibling-refused',
  UNRESOLVABLE: 'guard:unresolvable-path',
  MULTIPLY_LINKED: 'guard:multiply-linked',
  /**
   * The path resolved to the repository root itself. `analyse` has always called
   * this "protected" in a comment and never made it so — the empty key it emitted
   * matches no compiled rule. Adding to a closed vocabulary is a real decision, and
   * the alternative was worse: reusing PROTECTED would name a `rule` no one wrote,
   * in a file the owner could edit to remove it.
   */
  REPO_ROOT: 'law:repository-root',
  /**
   * Deny-by-default: the path is inside the repository, no rule protects it, and no rule DECLARES it.
   * In force only when a law carries a `writable` list — see `judgeWritable` in law.mjs. Its own
   * class rather than PROTECTED because the two are opposite statements: PROTECTED names a rule the
   * owner wrote and can edit, this one names the absence of one.
   */
  UNDECLARED: 'law:undeclared-path',
  NO_PATH: 'guard:no-path',
  NO_RECEIPT: 'guard:receipt-failed',
  ALLOWED: 'ok:allowed',
  NOT_A_FILE_TOOL: 'unguarded:not-a-file-tool',
  UNKNOWN_TOOL: 'unguarded:unknown-tool',
  /** Routed to the fence, but declared no path to judge — an MCP tool that touches no file, usually. */
  NO_PATH_TO_JUDGE: 'unguarded:no-path-to-judge',
  /** A session began or ended. Not a tool call — see `runSession`. */
  SESSION_OPEN: 'session:open',
  SESSION_CLOSE: 'session:close',
  // Spread rather than restated. The strings are defined next to the checks
  // that emit them in authority.mjs; two lists of the same vocabulary is how
  // `log` eventually comes to render a class nothing produces any more.
  ...AUTHORITY_REASON,
});

/** Not a security boundary — only the difference between two receipt classes. */
export const KNOWN_NON_WRITE_TOOLS = Object.freeze([
  'Bash', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite',
  'BashOutput', 'KillShell', 'NotebookRead', 'ListMcpResources', 'ReadMcpResource',
  'TaskCreate', 'TaskUpdate', 'TaskList', 'SlashCommand', 'ExitPlanMode',
  // Grok Build's spellings for the same capabilities.
  //
  // `run_terminal_command` is the one that matters, and it is named here rather than left to fall
  // through to `unknown-tool` because it is NOT drift — it is the known, permanent edge of what a
  // hook can see. Grok's own documentation states it: "Bash commands are not inspected for file
  // writes — plan mode blocks the edit tools, not shell redirection." Every runtime in this class has
  // the same edge, because deciding what a shell string will touch is undecidable in general: `eval`,
  // `$(…)` and base64 all defeat it. So the system records the call and says it could not inspect it.
  // Claiming otherwise would be the exact overclaim this repository exists to refuse.
  'run_terminal_command', 'read_file', 'list_dir', 'spawn_subagent', 'use_tool',
  // Observed in live Grok sessions rather than read off a table. `unknown-tool` is the LOUDER class on
  // purpose — it means harness drift, a tool nobody classified — so leaving genuinely known read tools
  // to fall through would cry wolf until the class stopped meaning anything.
  'grep', 'web_search', 'web_fetch', 'get_command_or_subagent_output',
]);

/**
 * Every path shape the write tools use, so a renamed field cannot slip past.
 * `notebook_path` is NotebookEdit's; the rest are defensive breadth, and breadth
 * costs nothing here because an unrecognised extra path is judged, not trusted.
 */
export function extractPaths(toolInput) {
  const out = [];
  if (!toolInput || typeof toolInput !== 'object') return out;
  for (const key of ['file_path', 'notebook_path', 'path', 'filePath', 'target']) {
    if (typeof toolInput[key] === 'string' && toolInput[key].length > 0) out.push(toolInput[key]);
  }
  if (Array.isArray(toolInput.edits)) {
    for (const e of toolInput.edits) {
      if (typeof e?.file_path === 'string' && e.file_path.length > 0) out.push(e.file_path);
    }
  }
  return [...new Set(out)];
}

/**
 * WHICH REPOSITORY GOVERNS THIS PATH — walked up from the path, not read off the caller.
 *
 * ══ THE HOLE THIS CLOSES, AND IT NEEDED NO EXPLOIT ══
 *
 * The root came from `payload.cwd`. Open an editor on the folder ABOVE the repo and the fence was
 * void — not defeated, ASKED A DIFFERENT QUESTION. Measured, exit codes and all:
 *
 *     write attempt              cwd = repo    cwd = PARENT
 *     LAW.md                     refused       ALLOWED
 *     aukora.law.json            refused       ALLOWED
 *     .claude/settings.json      refused       ALLOWED
 *     .git/config                refused       ALLOWED
 *
 * Three reasonable things lined up. The parent has no `aukora.pub`, so `checkLawAuthority` reads
 * `unbound` and passes — the one exception that lets unadopted repositories work at all. The parent
 * has no law, so the fallback applies. And every compiled rule anchors at the root, so the pattern
 * `LAW.md` does not match the key `repo/LAW.md`. The self-protection set was intact the whole time
 * and simply describing a different directory.
 *
 * It voided the constitution's own self-protection commit completely: every test for it runs with
 * `cwd: repo`, and no case in the corpus varied cwd. A class of test and a class of code agreed with
 * each other about the wrong thing.
 *
 * ══ WHY THE PATH IS THE RIGHT ANCHOR ══
 *
 * "Which law governs this file?" is a question about the file. The caller's directory is a fact about
 * a shell, and a fence whose scope a shell can change is a fence whose scope the fenced party can
 * change. Walking up from the path for `.git` or a law file asks the only question that has a stable
 * answer.
 *
 * `.git` is matched as a FILE as well as a directory, deliberately: that is what a git worktree has,
 * and a worktree is governed by the law in its own checkout. The worktree-fence null stands — a
 * worktree is still not part of the repository it was cut from, and this does not make it one.
 */
export function governingRoot(startPath) {
  let dir = realpathish(startPath);
  // A path that does not exist yet is judged by where it WOULD live; realpathish already walks up to
  // the deepest existing ancestor, so this loop begins somewhere real.
  try { if (!statSync(dir).isDirectory()) dir = dirname(dir); } catch { dir = dirname(dir); }

  for (let i = 0; i < 64; i += 1) {          // bounded: a symlinked cycle must not hang the fence
    if (existsSync(join(dir, LAW_FILE)) || existsSync(join(dir, '.git'))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;             // reached the filesystem root, governed by nothing
    dir = up;
  }
  return null;
}

/**
 * The decision. No I/O, so the entire policy is testable without a filesystem,
 * a keyring, or a harness.
 */
export function decide({ repoRoot, toolName, toolInput, law, rules, writableRules }) {
  const paths = extractPaths(toolInput);

  if (paths.length === 0) {
    // ── FAIL CLOSED ONLY WHERE WE KNOW A FILE WAS MEANT ────────────────────
    //
    // For a tool we KNOW writes files, a payload with no readable path is exactly when to refuse: the
    // call means to write something and the gate cannot see what.
    //
    // For anything else routed here it is the wrong answer, and MCP is why. Grok surfaces MCP calls
    // under qualified `server__tool` names, so broadening the matcher to catch `filesystem__write_file`
    // also catches `linear__save_issue` — which touches no file and has no path to find. Refusing it
    // would break real work in the name of a file that was never involved, and a guard that refuses
    // ordinary work gets uninstalled.
    //
    // So an unclassifiable call is ALLOWED and RECORDED. That is the witness lane's bargain, applied
    // at the fence: prevention where a call declares its target, an unbroken record everywhere else.
    if (FENCED_TOOLS.includes(toolName)) {
      return [{
        verdict: 'refused', reasonClass: REASON.NO_PATH, rule: null,
        path: '', resolved: '',
        message: `a ${toolName} with no recognisable path — refusing rather than guessing which field held it`,
      }];
    }
    return [{
      verdict: 'unguarded', reasonClass: REASON.NO_PATH_TO_JUDGE, rule: null,
      path: '', resolved: '',
      message: `a ${toolName} declared no path this gate can read — recorded, not judged`,
    }];
  }

  // ── TWO ROOTS, AND ANY REFUSAL WINS ────────────────────────────────────────
  //
  // The governing root is discovered from each path. That closes the parent-cwd void, but discovery
  // ALONE would loosen the fence in exactly one case: caller inside repository A, path inside
  // repository B. Today that is a clean `law:outside-repo` refusal; judged against B's own law it
  // might well be permitted, and B is not the repository this session is governed by.
  //
  // So both answers are computed and any refusal wins. That is provably non-widening — the caller's
  // answer is still asked, and can still refuse — while the discovered answer adds the refusals the
  // caller's directory was blind to. The discovered reason is preferred when both refuse, because it
  // names the law that actually governs the file rather than a boundary the file merely crossed.
  return paths.map((raw) => {
    // RESOLVED AGAINST THE CALLER FIRST, and this was a real defect in the first draft of this fix.
    // A tool may declare a RELATIVE path, and a relative path handed to `governingRoot` resolves
    // against `process.cwd()` — the directory of whatever process happens to be running, which in a
    // test run is the actual repository. The fence then discovered a root nobody was writing to and
    // sent the receipt there. Caught by `test/witness-chain.test.mjs` reading back zero receipts from
    // a fixture that had just been written to twice.
    const discovered = governingRoot(resolve(repoRoot, raw));
    const sameRoot = !discovered || discovered === realpathish(resolve(repoRoot));

    // Each root is judged under ITS OWN law. Handing the caller's root a law loaded from somewhere
    // else would answer a third question belonging to neither — the preloaded pair is used only when
    // the two roots are the same directory, which is every ordinary call and costs nothing.
    const [byCaller] = judgePaths(repoRoot, [raw], sameRoot ? { law, rules, writableRules } : {});
    if (sameRoot) return byCaller;

    const [byOwner] = judgePaths(discovered, [raw]);
    if (byOwner && byOwner.verdict === 'refused') return byOwner;
    return byCaller;
  });
}

/**
 * Judge a list of raw paths against this repository's law. THE one entry point.
 *
 * ══ WHY THIS IS EXPORTED, AND WHY THAT IS THE WHOLE FIX ══
 *
 * Until now the only way to ask "may this path be written?" was `decide()`, which wants a
 * whole tool-call envelope — a `toolName`, a `toolInput` shaped like a hook payload, a
 * pre-loaded `law` and `rules`. Every caller that did not have one of those hand-composed
 * `loadLaw` + `analyse` + `judge` + `isMultiplyLinked` itself, in the right order, and
 * there were three such call sites with three separate copies:
 *
 *   core/witness/guard.mjs   the hook           — composed correctly
 *   core/forge/crush.ts:532  post-hoc, an engine round — composed correctly, inline,
 *                            behind two @ts-expect-errors, with a comment saying a typed
 *                            surface "belongs beside it in core/witness/"
 *   core/forge/review.ts     capture -> apply   — DID NOT COMPOSE IT AT ALL
 *
 * The third is the path the conformance suite drives, and its only path predicate is
 * `abs.startsWith(repoRoot() + sep)`. The armed suite reporting 3 of 12 is not nine
 * separate alias bugs in `paths.mjs`; it is one missing call, in the one write path that
 * never had a judge to call. A fence re-implemented per call site is a fence that will be
 * forgotten at one of them — and it was.
 *
 * So: one function, no envelope, no ordering for a caller to get wrong. The ordering IS
 * the security property (root, then outside, then law, then aliases — each comment below
 * says why it sits where it does), and it now lives in exactly one place.
 *
 * ══ WHAT THIS DOES NOT DO ══
 *
 * It answers the DENYLIST question — "does a rule protect this path?" — because that is
 * the law this repository has. `conformance/cases/02-undeclared-path.json` asks a
 * different one: "is this path declared editable?", deny-by-default. BOTH are implemented here now,
 * and this comment said the second one existed nowhere in phi long after it was built in this very
 * function: `judge` answers the denylist, and `judgeWritable` answers deny-by-default whenever the law
 * declares a `writable` set. `writableRules === null` means not in force, which is what leaves the
 * fence unchanged for every repository that has not adopted it.
 * The allow-list was built, and the twelve cases are green. Measured, not predicted, but by two
 * different things and they should not be conflated: `test/witness-corpus-verdicts.test.ts` runs the
 * twelve fixtures through this function, and `test/witness-allowlist.test.mjs` pins the polarity case
 * by case. The ARMED number — 12 of 12 — comes from `conformance/run.ts` via
 * `scripts/conformance-gate.ts`, which is a different lane and a different claim.
 *
 * @param {string} repoRoot
 * @param {string[]} paths raw, as a tool declared them
 * @param {{law?: object, rules?: object[], writableRules?: object[]|null}} [preloaded] pass ALL THREE
 *   when the caller already has them. The reload guard below is `if (!law || !rules)`, so a bag
 *   carrying law and rules but omitting `writableRules` does not trigger a re-read — it silently
 *   leaves deny-by-default switched off. `decide()` passes all three; anything new must too.
 *   Pass them when the caller already
 *        holds them (the hook does); otherwise the law is read here.
 */
export function judgePaths(repoRoot, paths, preloaded = {}) {
  let { law, rules, writableRules } = preloaded;
  if (!law || !rules) ({ law, rules, writableRules } = loadLaw(repoRoot));

  return paths.map((raw) => {
    const a = analyse(repoRoot, raw);
    if (!a.ok) {
      return {
        verdict: 'refused', reasonClass: REASON.UNRESOLVABLE, rule: null,
        path: String(raw), resolved: '',
        message: `${a.reason} — a path this gate cannot reason about is a path it does not allow`,
      };
    }
    const common = { path: String(raw), resolved: a.resolved };
    // Before the law, because no rule can express it and the OS is not a fence.
    // Case 10 was green on EISDIR alone — the kernel refusing a write to a
    // directory — which proves nothing about phi and stops being true the moment
    // the root is reached under a name that is not a directory.
    if (a.isRoot) {
      return {
        ...common, verdict: 'refused', reasonClass: REASON.REPO_ROOT, rule: null,
        message: `${raw} resolves to the repository root itself, which is not a file and is never `
          + 'writable as one. No rule declares this because no rule can — it is the boundary the '
          + 'rules are written inside.',
      };
    }
    if (a.outside) {
      if (law.writesOutsideRepo === 'refuse') {
        return {
          ...common, verdict: 'refused', reasonClass: REASON.OUTSIDE, rule: null,
          message: `${a.resolved} is outside this repository — the law is repo-scoped, so a write that leaves the repo has left what the law describes`,
        };
      }
      return { ...common, verdict: 'allowed', reasonClass: REASON.ALLOWED, rule: null, message: null };
    }
    const v = judge(rules, a.keys);
    if (v.protected) {
      const via = a.aliased ? ` (declared as ${raw}, resolves to ${a.resolved})` : '';
      return {
        ...common, verdict: 'refused', reasonClass: REASON.PROTECTED, rule: v.rule,
        message: `${a.resolved} is protected by the rule "${v.rule}" in aukora.law.json${via}`,
      };
    }

    // Only now. A second directory entry for the same inode is a name we did
    // not judge — but if the LAW already refused this path, that is the more
    // actionable message and it names a rule the owner can actually edit.
    // Checking links first masked the law's own verdict on any protected file
    // that happened to be linked; both refuse, so the ordering costs nothing
    // but clarity.
    //
    // The law cannot see this case at all: both the lexical and the resolved
    // form return the innocent name, so `judge` says allowed and the bytes land
    // on the other inode.
    if (isMultiplyLinked(a.links)) {
      return {
        ...common, verdict: 'refused', reasonClass: REASON.MULTIPLY_LINKED, rule: null,
        message: `${a.resolved} is one of ${a.links.nlink} names for the same file — the other names were `
          + 'not judged, and a name this gate cannot reason about is a name it does not allow. '
          + 'Break the link (cp the file, rm the extra entry) if this is intended.',
      };
    }
    // THE ALLOW-LIST, ASKED LAST — and the ordering is why every other refusal keeps its own sentence.
    //
    // Deny-by-default would refuse the repository root, an escape, a protected file and a hard link
    // too, all of them as merely "undeclared" — because none of those paths is on a writable list
    // either. The owner would lose the difference between "this is a second name for a protected
    // inode" and "you did not list this file", which is the difference between a fence explaining
    // itself and a fence saying no. So root, outside, protected and multiply-linked each answer
    // first, and this catches only what none of them recognised.
    //
    // `writableRules` is null on every law that has not declared a set, and on every law that could
    // not be read — so this block is skipped entirely and the fence is exactly what it was before
    // deny-by-default existed. That is what makes the polarity shippable to repositories that have
    // not adopted it yet.
    if (writableRules) {
      const w = judgeWritable(writableRules, a.keys);
      if (!w.declared) {
        // Name the spelling that was undeclared, not the one the tool asked for. On the alias cases
        // those differ, and the resolved one is the useful half of the sentence.
        const via = w.key && w.key !== a.resolved && String(raw) !== w.key
          ? ` — it resolves to ${w.key}, which no rule declares` : '';
        return {
          ...common, verdict: 'refused', reasonClass: REASON.UNDECLARED, rule: null,
          message: `${a.resolved} is not declared writable in aukora.law.json${via}. This repository `
            + 'declares what may be written; a path it does not name is refused rather than assumed safe.',
        };
      }
    }
    return { ...common, verdict: 'allowed', reasonClass: REASON.ALLOWED, rule: null, message: null };
  });
}

function say(text) {
  try { process.stderr.write(`${text}\n`); } catch { /* stderr gone; the exit code still carries the verdict */ }
}

/**
 * ONE GUARD, EVERY RUNTIME — and one place that knows what an envelope looks like.
 *
 * Claude Code sends `tool_name`/`tool_input`; Grok Build sends the same envelope in camelCase
 * (`toolName`/`toolInput`). This is the vendor-neutrality claim in a dozen lines: a third runtime with
 * a third spelling is added here and nothing else in the system changes.
 *
 * ══ WHY THIS IS A FUNCTION AND NOT TWO COPIES ══
 *
 * It WAS two copies. The fence learned camelCase and the witness did not, so under Grok the fence
 * refused correctly while `runWitness` read `''`, returned early, and recorded NOTHING — with its
 * failure swallowed by a deliberate catch. The chain went silent about exactly the calls the witness
 * exists to make visible, and the defect was invisible because the lane still exited 0.
 *
 * Duplicated envelope parsing was the root cause, so the fix is to make duplication impossible rather
 * than to fix the copy. Both lanes read here or they do not read at all.
 */
export function readEnvelope(payload) {
  const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name
    : typeof payload?.toolName === 'string' ? payload.toolName : '';
  return {
    toolName,
    toolInput: payload?.tool_input ?? payload?.toolInput,
    repoRoot: typeof payload?.cwd === 'string' && payload.cwd.length > 0 ? payload.cwd : process.cwd(),
    session: typeof payload?.session_id === 'string' ? payload.session_id
      : typeof payload?.sessionId === 'string' ? payload.sessionId : '',
    // Which intelligence acted. Grok sends no agent field, but it does send `hookEventName` — so the
    // ledger can still name the hand rather than recording an anonymous write.
    agent: payload?.agent_type ?? payload?.agent_id ?? payload?.agentType
      ?? (payload?.hookEventName ? 'grok-build' : null),
    // `permissionMode` is a Grok common field on every event: default | auto | plan | bypassPermissions.
    mode: typeof payload?.permissionMode === 'string' ? payload.permissionMode
      : typeof payload?.permission_mode === 'string' ? payload.permission_mode : null,
  };
}

/**
 * The fence. Returns an exit code rather than calling `process.exit`, so tests can run it in-process
 * and assert on the chain it wrote.
 *
 * (This block sat above `readEnvelope` until an audit noticed it: code was inserted beneath it and the
 * docstring stayed put, so the fence's description had been documenting the envelope parser.)
 */
export function runFence(payload, { now = () => new Date().toISOString() } = {}) {
  // Note what happens when neither spelling is present: the gate refuses. A guard that cannot tell
  // what it is being asked about must never wave it through.
  const { toolName, repoRoot: callerRoot, toolInput, session, agent, mode } = readEnvelope(payload);

  // ── THE RECORD FOLLOWS THE GOVERNED REPOSITORY, NOT THE SHELL ─────────────
  //
  // The second half of the parent-cwd finding, and the half that outlives it: the chain was keyed to
  // the caller's directory too. A parent directory is not a git repository, so it has no identity
  // that survives a rename, so `chainHome` correctly keeps such a chain IN-TREE — at
  // `<parent>/.aukora/chain.jsonl`. The writes were recorded. Into a file `aukora verify` inside the
  // repository never reads. Refused writes and a forked record, both from one variable.
  //
  // So authority, law and chain are all asked of the repository that actually contains the path. When
  // no path is readable, or the path is governed by nothing, the caller's directory is still the only
  // answer available and is used unchanged.
  // Resolved against the caller before discovery — a relative tool path would otherwise be resolved
  // against `process.cwd()` and route this call's whole record into an unrelated repository.
  const firstPath = extractPaths(toolInput)[0];
  const governed = governingRoot(firstPath ? resolve(callerRoot, firstPath) : callerRoot);
  const repoRoot = governed ?? callerRoot;

  if (!toolName) {
    say('AUKORA REFUSED: the gate could not read which tool was being called');
    return REFUSE;
  }

  const signer = loadSigner(repoRoot);
  const sign = signer ? signer.sign : null;

  // ── IS THIS LAW THE OWNER'S LAW? ─────────────────────────────────────────
  //
  // Asked first, answered before any rule is read. Everything that is not a
  // verified law refuses, except an unbound repository — see
  // `checkLawAuthority`, where that one exception is argued and locked.
  const authority = checkLawAuthority(repoRoot);
  if (!authority.ok) {
    // Recorded with an empty path on purpose. No path was judged: the call was
    // refused before the law was consulted, and naming a file here would imply
    // the guard had an opinion about one.
    try {
      append(repoRoot, {
        ts: now(), tool: toolName, path: '', resolved: '',
        verdict: 'refused', reasonClass: authority.reasonClass, rule: null, session, agent, mode,
      }, sign);
    } catch { /* the refusal stands whether or not its receipt landed */ }

    say(`AUKORA REFUSED: ${authority.reason}`);
    // `law-unreadable` sets `expected` and CANNOT set `actual` — the file could not be
    // read, so there is no hash of it. Gating on both meant that branch printed neither,
    // and the operator lost the one value that lets them check a restored file against
    // what was signed. Not a false claim; a refusal that withheld its own evidence.
    if (authority.expected && authority.actual) {
      say(`  signed   ${authority.expected}`);
      say(`  on disk  ${authority.actual}`);
    } else if (authority.expected) {
      say(`  signed   ${authority.expected}`);
      say('  on disk  — unreadable, so there is nothing to compare it against');
    }
    say(authority.hint);
    say('Refusing every write until the law is one the owner signed. A fence that');
    say('obeys an unsigned law is obeying whoever edited it last.');
    return REFUSE;
  }

  // `writableRules` was missing from this destructure, and that was the whole of F4: `decide` passes
  // its `preloaded` straight to `judgePaths`, so the allow-list block saw `undefined`, read it as
  // "no allow-list in force", and skipped deny-by-default for EVERY hook-mediated write. The armed
  // 12 of 12 was true of `review.ts` capture -> apply and not of the fence a session actually meets.
  // Two lanes, one law, and only one of them was reading all of it.
  const { law, rules, writableRules } = loadLaw(repoRoot);
  // `callerRoot` on purpose: `decide` judges against BOTH roots and takes any refusal, so the
  // caller's own boundary is still enforced. Handing it `repoRoot` here would collapse the two
  // answers into one and lose the cross-repository refusal.
  const decisions = decide({ repoRoot: callerRoot, toolName, toolInput, law, rules, writableRules });
  const offender = decisions.find((d) => d.verdict === 'refused') ?? null;

  // One receipt per path. A tool call is atomic: if any path is refused, NONE of
  // them is written, so the innocent siblings are recorded as refused too — with
  // their own class, so the log never implies they were the problem.
  let receiptFailure = null;
  for (const d of decisions) {
    const isOffender = d === offender;
    try {
      append(repoRoot, {
        ts: now(),
        tool: toolName,
        path: d.path,
        resolved: d.resolved,
        // `unguarded` must survive to the receipt. Folding it into `allowed` would let a call the gate
        // could not judge read, forever after, as one it judged and permitted — the exact difference
        // the whole chain exists to preserve.
        verdict: offender ? 'refused' : (d.verdict === 'unguarded' ? 'unguarded' : 'allowed'),
        reasonClass: offender ? (isOffender ? d.reasonClass : REASON.SIBLING) : d.reasonClass,
        rule: isOffender ? d.rule : null,
        session,
        agent,
        mode,
      }, sign);
    } catch (err) {
      receiptFailure = err?.message ?? 'unknown';
    }
  }

  if (offender) {
    say(`AUKORA REFUSED: ${offender.message}`);
    // The follow-up must match the reason. This line used to read "Declared
    // off-limits in aukora.law.json" for EVERY refusal — including ones the law
    // never mentioned, like a path outside the repo or an inode with a second
    // name. Telling someone to widen a law that did not refuse them sends them
    // to edit the wrong file.
    if (offender.reasonClass === REASON.PROTECTED) {
      say('Declared off-limits in aukora.law.json. Ask the owner to widen the law if this is intended.');
    } else if (offender.reasonClass === REASON.MULTIPLY_LINKED) {
      say('Not a law refusal — the law never saw the other name. Widening it would not help.');
    }
    return REFUSE;
  }

  // ── NO RECEIPT, NO WRITE ──
  if (receiptFailure !== null) {
    say(`AUKORA REFUSED: the law permits this write but its receipt could not be appended (${receiptFailure}).`);
    say('Refusing rather than letting bytes reach disk with no record that they did.');
    return REFUSE;
  }

  // ── the periodic anchor ───────────────────────────────────────────────────
  //
  // Last, after the verdict, and structurally unable to change it. An hour's
  // staleness is the trigger, so this is a no-op on all but one call an hour,
  // and on that call it is one small append. It cannot refuse and cannot throw
  // — `maybeCheckpoint` swallows everything — because an attestation the owner
  // failed to write is a worse record, not a blocked tool call.
  if (signer) {
    const pub = readPub(repoRoot);
    if (pub.ok) maybeCheckpoint(repoRoot, { pubFile: pub.pubFile, signer, now });
  }

  return ALLOW;
}

/**
 * The witness. Returns ALLOW under every circumstance, including its own failure. That is why it needs
 * no `|| true` in the hook command — the verb itself cannot exit non-zero — and why nothing here is
 * allowed to grow a refusal path.
 */
export function runWitness(payload, { now = () => new Date().toISOString() } = {}) {
  try {
    const { toolName, repoRoot, session, agent, mode } = readEnvelope(payload);
    if (!toolName) return ALLOW;
    if (FENCED_TOOLS.includes(toolName)) return ALLOW;   // the fence already recorded it

    const { law } = loadLaw(repoRoot);
    if (law.unguardedTools === 'ignore') return ALLOW;

    // A tool name we have never heard of might be a write tool the fence's
    // matcher does not route. The witness cannot block it — it never blocks —
    // but the chain records it under a class that `log` and `verify` call out,
    // so harness drift surfaces as a visible gap instead of a silent one.
    const known = KNOWN_NON_WRITE_TOOLS.includes(toolName);
    const signer = loadSigner(repoRoot);

    append(repoRoot, {
      ts: now(), tool: toolName, path: '', resolved: '',
      verdict: 'unguarded',
      reasonClass: known ? REASON.NOT_A_FILE_TOOL : REASON.UNKNOWN_TOOL,
      rule: null, session, agent, mode,
    }, signer ? signer.sign : null);
  } catch {
    // Deliberately swallowed. The witness losing a record must never cost the
    // owner a tool call.
  }
  return ALLOW;
}

/**
 * A SESSION BOUNDARY. Not a tool call, and the most useful receipt in the file.
 *
 * ══ WHY ══
 *
 * A missing witness and an innocent session look identical. If a runtime session produced no receipts,
 * there is no way to tell whether the agent did nothing or whether the guard was never installed,
 * never fired, or was removed for the duration — and LIMITS §10's whole argument is that the vendor's
 * own session store outlives ours, so an auditor can SEE that a session existed while our record is
 * silent about it.
 *
 * A `session:open` receipt converts absence of evidence into evidence of absence. A vendor session
 * directory with no matching `session:open` in the chain is **provably ungoverned** — not ambiguous,
 * not "probably fine", provably. That is a different sentence from anything else this system can say.
 *
 * ══ WHAT IT IS NOT ══
 *
 * It does not prove the guard stayed installed for the whole session; it proves it was there at the
 * boundary. It does not narrow LIMITS §8 by a millimetre — an action taken without declaring a tool
 * call is still absent. And coverage remains exactly §3: a runtime nobody installed this into emits
 * nothing, including no session receipts.
 *
 * Never blocks, never throws, like the witness lane. A session boundary that failed to record must not
 * cost the owner their session.
 */
export function runSession(payload, { now = () => new Date().toISOString() } = {}) {
  try {
    const { toolName, repoRoot, session, agent, mode } = readEnvelope(payload);
    const event = String(payload?.hookEventName ?? payload?.hook_event_name ?? toolName ?? '');
    // Only the two boundaries. Anything else routed here is a wiring mistake and is not invented into
    // a receipt — a record that guesses what it was told is worse than one that says nothing.
    const closing = /end|stop/iu.test(event);
    const opening = /start|begin/iu.test(event);
    if (!closing && !opening) return ALLOW;

    const signer = loadSigner(repoRoot);
    append(repoRoot, {
      ts: now(), tool: event, path: '', resolved: '',
      verdict: 'unguarded',
      reasonClass: closing ? REASON.SESSION_CLOSE : REASON.SESSION_OPEN,
      rule: null, session, agent, mode,
    }, signer ? signer.sign : null);
  } catch {
    // Deliberately swallowed, for the same reason the witness lane swallows.
  }
  return ALLOW;
}

/** Read the payload. A payload we cannot parse is not a payload we can obey. */
export function readPayload(fd = 0) {
  try {
    const raw = readFileSync(fd, 'utf8');
    if (!raw || raw.trim().length === 0) return { ok: false, reason: 'empty stdin' };
    return { ok: true, payload: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, reason: err?.message ?? 'unreadable stdin' };
  }
}
