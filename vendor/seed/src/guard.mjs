// aukora · src/guard.mjs — the gate
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
// FENCE     matcher `Write|Edit|MultiEdit|NotebookEdit`, invoked `… || exit 2`.
//           Fail-CLOSED. If it breaks, writes stop. Reads, Bash and the
//           conversation keep working, so a broken fence degrades the session
//           instead of killing it.
//
// WITNESS   matcher `*`, invoked `… || true`. Fail-OPEN, blocks nothing, ever.
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

import { readFileSync, statSync, realpathSync, lstatSync, readlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyse, isMultiplyLinked, isLinkStateUnknowable } from './paths.mjs';
import { loadLaw, judge } from './law.mjs';
import { append } from './chain.mjs';
import { loadSigner, readPub } from './aumlok.mjs';
import { checkLawAuthority, maybeCheckpoint, AUTHORITY_REASON } from './authority.mjs';

export const REFUSE = 2;
export const ALLOW = 0;

/**
 * The tools that write a file, enumerated from the live harness rather than
 * from memory. This list and the matcher `init` writes are asserted equal by a
 * test — two lists drifting apart is exactly how a fence quietly stops covering
 * the thing it was added for.
 */
export const FENCED_TOOLS = Object.freeze(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** A closed vocabulary. `log` and `view` render these; nothing else appears. */
export const REASON = Object.freeze({
  PROTECTED: 'law:protected-path',
  OUTSIDE: 'law:outside-repo',
  SIBLING: 'law:sibling-refused',
  UNRESOLVABLE: 'guard:unresolvable-path',
  MULTIPLY_LINKED: 'guard:multiply-linked',
  REPO_ROOT: 'guard:repo-root',
  SELF: 'guard:guard-own-code',
  NO_PATH: 'guard:no-path',
  NO_RECEIPT: 'guard:receipt-failed',
  ALLOWED: 'ok:allowed',
  NOT_A_FILE_TOOL: 'unguarded:not-a-file-tool',
  UNKNOWN_TOOL: 'unguarded:unknown-tool',
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
 * The decision. No I/O, so the entire policy is testable without a filesystem,
 * a keyring, or a harness.
 */
export function decide({ repoRoot, toolName, toolInput, law, rules }) {
  const paths = extractPaths(toolInput);

  if (paths.length === 0) {
    return [{
      verdict: 'refused', reasonClass: REASON.NO_PATH, rule: null,
      path: '', resolved: '',
      message: `a ${toolName} with no recognisable path — refusing rather than guessing which field held it`,
    }];
  }

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

    // The repository root is not a writable file. `analyse` folds it to the
    // empty key, and the empty key matches no glob, so a `Write` with
    // `file_path: "."` fell through every rule and was ALLOWED. Documented as
    // an open hole in README §known-broken and caught by the shared
    // conformance suite's `repo-root` case.
    if (a.keys.includes('')) {
      return {
        ...common, verdict: 'refused', reasonClass: REASON.REPO_ROOT, rule: null,
        message: 'the repository root is not a file — a write to "." is not a write this gate can reason about',
      };
    }
    // ── THE GUARD'S OWN CODE, BEFORE THE LAW IS CONSULTED ──────────────────
    //
    // Ordered here on purpose. Every check after this one is performed BY the
    // code this check protects — so if the bytes of `judge`, `analyse` or
    // `verifyChain` are in play, no later verdict means anything. It also sits
    // above the outside-repo branch because that branch can ALLOW (when a law
    // sets `writesOutsideRepo` to anything but 'refuse'), and this must not be
    // reachable through a permission someone widened.
    //
    // Not driven by the law, and deliberately not overridable by it: a law that
    // could unprotect the enforcer is a law that can turn the enforcer off.
    // `a.realAbs`, never `a.resolved`. For an inside-repo path `resolved` is a
    // REPO-RELATIVE key, and handing that to a resolver made it relative to the
    // guard process's own cwd — so `src/index.js` in any temp repo resolved
    // into Aukora's own `src/` and every innocent write refused. Caught by ten
    // existing tests within a minute of the change, which is the only reason
    // this comment is here and not a bug report. `realAbs` is absolute and has
    // already followed symlinks, so an alias pointing at the guard is judged by
    // where it LANDS.
    if (isGuardOwnCode(a.realAbs)) {
      return {
        ...common, verdict: 'refused', reasonClass: REASON.SELF, rule: null,
        message: `${a.resolved} is Aukora's own code — the fence does not permit edits to itself. `
          + 'Locking aukora.law.json while leaving this writable would protect the rules and not '
          + 'the thing that reads them. Change it outside the agent\'s file tools.',
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
    // "We could not look" is not "there is nothing to see."
    if (isLinkStateUnknowable(a.links)) {
      return {
        ...common, verdict: 'refused', reasonClass: REASON.MULTIPLY_LINKED, rule: null,
        message: `${a.resolved} could not be opened to count its names (${a.links.reason}) — `
          + 'a file this gate cannot inspect is a file it does not allow',
      };
    }
    if (isMultiplyLinked(a.links)) {
      return {
        ...common, verdict: 'refused', reasonClass: REASON.MULTIPLY_LINKED, rule: null,
        message: `${a.resolved} is one of ${a.links.nlink} names for the same file — the other names were `
          + 'not judged, and a name this gate cannot reason about is a name it does not allow. '
          + 'Break the link (cp the file, rm the extra entry) if this is intended.',
      };
    }
    return { ...common, verdict: 'allowed', reasonClass: REASON.ALLOWED, rule: null, message: null };
  });
}

function say(text) {
  try { process.stderr.write(`${text}\n`); } catch { /* stderr gone; the exit code still carries the verdict */ }
}

/**
 * Where this guard's own code lives on disk, resolved at load time.
 *
 * ══ WHY A PATTERN WOULD NOT DO ══
 *
 * `DEFAULT_PROTECTED` locks `aukora.law.json` and `.claude/settings.json`
 * because — in `src/law.mjs`'s own words — "a fence an agent can edit is a
 * suggestion. The agent must not be able to widen its own permissions or unhook
 * the guard through its own file tools."
 *
 * It locked the CONFIGURATION and left the CODE THAT READS IT writable. Once
 * `aukora` is installed as a dependency, that code sits inside the governed
 * repository. Measured, on a repo whose `aukora init` had just succeeded:
 *
 *     aukora.law.json                        refused   (correct)
 *     .claude/settings.json                  refused   (correct)
 *     node_modules/aukora/src/guard.mjs      ALLOWED
 *     node_modules/aukora/src/law.mjs        ALLOWED
 *     node_modules/aukora/src/verify.mjs     ALLOWED
 *     node_modules/aukora/bin/aukora.mjs     ALLOWED
 *
 * An agent cannot widen the law, and does not need to: it can rewrite the file
 * that enforces it, or the one that verifies the receipts afterwards.
 *
 * A glob like `node_modules/aukora/**` would be the obvious patch and it is the
 * wrong one — it judges a NAME. Installs land in `node_modules/.pnpm/...`, in
 * hoisted roots, under scoped names, behind symlinks, or wherever a bundler
 * puts them. This module knows where it actually is, so the check is against
 * that, resolved. Same discipline as every other path check here: judge what a
 * name resolves to, never the name.
 *
 * Global installs resolve outside the repository and are already refused by
 * `writesOutsideRepo`.
 */
const SELF_ROOT = (() => {
  try { return realpathSync(dirname(dirname(fileURLToPath(import.meta.url)))); } catch { return null; }
})();

/**
 * Resolve a path to its nearest EXISTING ancestor, symlinks followed.
 *
 * The target may not exist yet — creating a new module beside the guard is as
 * good as editing one, so a create is exactly the case that matters. Returns
 * null when nothing above it exists either.
 */
function realAncestor(path) {
  let p = path;
  for (;;) {
    try { return realpathSync(p); } catch { /* not on disk yet */ }
    const parent = dirname(p);
    if (parent === p) return null;
    p = parent;
  }
}

/**
 * Where a write actually LANDS, as a file path.
 *
 * Distinct from `realAncestor`, and the distinction cost a test: `governingRoot`
 * takes a FILE and starts at its `dirname`, so handing it a realpathed
 * *directory* skips that directory's own law and begins the search one level too
 * high. A repository's own `aukora.law.json` stopped governing its own files.
 *
 * So: if the leaf exists, follow it — a leaf symlink is exactly the alias this
 * is for. If it does not, resolve the containing directory (which may itself be
 * a symlink) and keep the intended basename.
 */
function realTarget(abs) {
  try { return realpathSync(abs); } catch { /* the leaf is missing, or dangling */ }

  // ── A DANGLING SYMLINK STILL NAMES WHERE THE WRITE LANDS ────────────────
  //
  // `realpath` refuses a link whose target does not exist yet, so the first
  // version quietly fell back to the LEXICAL path — and a link pointing at a
  // not-yet-created file in another repository chose the wrong law again, which
  // is the exact bug this function was written to close. Found by its own test,
  // which had built precisely that fixture without either of us intending it.
  //
  // Creating through such a link is not exotic: it is what an ordinary `Write`
  // to a new filename does when the name happens to be a link.
  try {
    if (lstatSync(abs).isSymbolicLink()) {
      const target = resolve(dirname(abs), readlinkSync(abs));
      const d = realAncestor(dirname(target));
      return d === null ? target : join(d, basename(target));
    }
  } catch { /* not a link, or unreadable — fall through */ }

  const dir = realAncestor(dirname(abs));
  return dir === null ? abs : join(dir, basename(abs));
}

/**
 * Case-folded, because macOS does not fold for us and the filesystem does.
 *
 * MEASURED on APFS, and this is not theoretical — it was live in this file:
 *
 *     realpathSync('/…/aukora-seed/src')   ->  /…/aukora-seed/src
 *     realpathSync('/…/AUKORA-SEED/src')   ->  /…/AUKORA-SEED/src
 *
 * `realpath` returns each spelling unchanged. Both name the SAME directory on a
 * case-insensitive volume, so an exact string comparison recognised only
 * whichever spelling this module happened to be loaded through — and
 * `isGuardOwnCode` returned FALSE for the guard's own ordinary lowercase path.
 * The self-protection did not protect itself when addressed by its usual name.
 *
 * Folding can only ADD refusals, which is the safe direction, and it is the
 * same choice the Ring 0 fence makes deliberately for the same reason.
 */
const fold = (s) => s.toLowerCase();

/** Does this resolved path live inside the guard's own installation? */
export function isGuardOwnCode(resolvedPath) {
  if (!SELF_ROOT || typeof resolvedPath !== 'string' || resolvedPath.length === 0) return false;
  let p = resolvedPath;
  p = realAncestor(p);
  if (p === null) return false;
  const a = fold(p);
  const b = fold(SELF_ROOT);
  return a === b || a.startsWith(`${b}/`);
}

/**
 * The nearest `aukora.law.json` at or above a file — the law that actually
 * governs it. Returns null when no law sits anywhere above it.
 *
 * ══ WHY THIS EXISTS ══
 *
 * `runFence` took its repository root from `payload.cwd`, a value the caller
 * supplies. Everything downstream hangs off it: which law is loaded, which key
 * `checkLawAuthority` checks, which `.aukora/` the receipts are appended to, and
 * what counts as "outside this repository".
 *
 * Narrowing that value is harmless — a subdirectory root makes the outside-check
 * STRICTER. Widening it dissolves the law completely. Measured, on a repo that
 * had just been `aukora init`-ed:
 *
 *   cwd = the repo        write repo/aukora.law.json        refused (correct)
 *   cwd = its PARENT      write repo/aukora.law.json        ALLOWED, silently
 *                         write repo/aukora.pub             ALLOWED, silently
 *                         write repo/.aukora/chain.jsonl    ALLOWED, silently
 *                         write repo/.claude/settings.json  ALLOWED, silently
 *
 * The parent has no `aukora.pub`, so `checkLawAuthority` returns `unbound` — the
 * single state that does not refuse, and correctly so, because a repository that
 * has not adopted Aukora yet must still be workable. But the parent also has no
 * law, so nothing is protected, and every governed repository underneath it is
 * now inside a root with no rules. The receipt chain follows the caller too: a
 * fresh `.aukora/` appears in the attacker-named directory while the real chain
 * records nothing.
 *
 * That is this project's recurring defect class exactly. `checkLawAuthority` is
 * correct for the root it is given; `judge` is correct for the rules it is given.
 * Nothing checked that the root being asked about was the root that GOVERNS the
 * file being written. A guard proven where it is defined, never where it is used.
 *
 * It is not only an adversary's move. A user who runs their agent from a
 * monorepo root, or from `~`, silently ungoverns every Aukora repo beneath it —
 * and the tool reports success the whole way.
 *
 * ══ THE RULE NOW ══
 *
 * The law that governs a write is the nearest one at or above the FILE. The
 * caller's cwd may resolve a relative path — it may not choose the constitution.
 * This can only add refusals: a file that was governed stays governed no matter
 * where the caller stands, and a file with no law above it is unaffected.
 */
export function governingRoot(resolvedPath) {
  let dir = dirname(resolvedPath);
  for (;;) {
    try {
      if (statSync(join(dir, 'aukora.law.json')).isFile()) return dir;
    } catch { /* no law here; keep walking up */ }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Which root should judge this call — derived from the paths, not the caller.
 *
 * Returns `{ root }` when one law governs everything in the call, or
 * `{ split: [...] }` when the paths answer to different laws. A single tool call
 * is atomic: if its paths belong to two constitutions there is no single verdict
 * to give, and inventing one would mean silently applying the more permissive.
 */
export function rootForCall(declaredRoot, toolInput) {
  const raws = extractPaths(toolInput);
  if (raws.length === 0) return { root: declaredRoot };

  const roots = new Set();
  for (const raw of raws) {
    let abs;
    try { abs = resolve(declaredRoot, String(raw)); } catch { return { root: declaredRoot }; }

    // ── CHOOSE THE LAW WHERE THE WRITE LANDS, NOT WHERE IT IS SPELLED ──────
    //
    // The first version handed `governingRoot` the LEXICAL path. Enforcement
    // downstream uses `analyse`, which realpaths — so a leaf that is a symlink
    // into another repository selected its authority under one law and was
    // judged under another. Choosing the constitution from a name while
    // enforcing it against a target is the same error as trusting the caller's
    // cwd, one level down: this whole function exists because the constitution
    // must not be selectable, and a symlink selects it.
    //
    // Both roots are considered. The write must satisfy the law over where it
    // LANDS, and if the spelling answers to a different law, the call is a
    // split and refuses rather than picking one — the same rule already applied
    // to a call naming two repositories, for the same reason.
    const landing = realTarget(abs);
    // No law above the file: nothing governs it, so the declared root stands and
    // the ordinary outside-the-repo check does its job.
    roots.add(governingRoot(landing) ?? declaredRoot);
    if (landing !== abs) roots.add(governingRoot(abs) ?? declaredRoot);
  }
  if (roots.size === 1) return { root: [...roots][0] };
  return { split: [...roots] };
}

/**
 * The fence. Returns an exit code rather than calling `process.exit`, so tests
 * can run it in-process and assert on the chain it wrote.
 */
export function runFence(payload, { now = () => new Date().toISOString() } = {}) {
  const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name : '';
  const declaredRoot = typeof payload?.cwd === 'string' && payload.cwd.length > 0 ? payload.cwd : process.cwd();
  const session = typeof payload?.session_id === 'string' ? payload.session_id : '';
  const agent = payload?.agent_type ?? payload?.agent_id ?? null;

  if (!toolName) {
    say('AUKORA REFUSED: the gate could not read which tool was being called');
    return REFUSE;
  }

  // ── WHICH CONSTITUTION APPLIES IS NOT THE CALLER'S TO CHOOSE ──
  //
  // Derived from the paths before anything is loaded, because every control
  // below — the authority check, the law, the rules, the receipt destination —
  // is scoped to this value. See `governingRoot` for the measured bypass this
  // closes: a caller naming a parent directory got no law at all.
  const scope = rootForCall(declaredRoot, payload?.tool_input);
  if (scope.split) {
    say('AUKORA REFUSED: this call touches files governed by different aukora.law.json files '
      + `(${scope.split.length} of them). A tool call is atomic and there is no single law to `
      + 'apply, so it refuses rather than picking one — which would mean picking the looser.');
    return REFUSE;
  }
  const repoRoot = scope.root;

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
        verdict: 'refused', reasonClass: authority.reasonClass, rule: null, session, agent,
      }, sign);
    } catch { /* the refusal stands whether or not its receipt landed */ }

    say(`AUKORA REFUSED: ${authority.reason}`);
    if (authority.expected && authority.actual) {
      say(`  signed   ${authority.expected}`);
      say(`  on disk  ${authority.actual}`);
    }
    say(authority.hint);
    say('Refusing every write until the law is one the owner signed. A fence that');
    say('obeys an unsigned law is obeying whoever edited it last.');
    return REFUSE;
  }

  const { law, rules } = loadLaw(repoRoot);
  const decisions = decide({ repoRoot, toolName, toolInput: payload?.tool_input, law, rules });
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
        verdict: offender ? 'refused' : 'allowed',
        reasonClass: offender ? (isOffender ? d.reasonClass : REASON.SIBLING) : d.reasonClass,
        rule: isOffender ? d.rule : null,
        session,
        agent,
      }, sign);
    } catch (err) {
      receiptFailure = err?.message ?? 'unknown';
    }
  }

  // ── the periodic anchor, on BOTH paths ────────────────────────────────────
  //
  // This used to sit at the very end, after every refusal had already returned.
  // So a repository whose history is entirely refusals never wrote a checkpoint
  // at all — and `verifyChain` now treats a bound repo with receipts and no
  // attestation as a finding, which would have refused such a repository
  // forever. Codex round 3 named exactly this: the first checkpoint must be
  // written "including refusal-only batches."
  //
  // It is still structurally unable to change the verdict: it runs after the
  // decision is made and after the receipts are durable, it cannot refuse, and
  // `maybeCheckpoint` swallows everything — an attestation the owner failed to
  // write is a worse record, not a blocked tool call. An hour's staleness is
  // the trigger, so on all but one call an hour this is a no-op.
  if (signer) {
    const pubForAnchor = readPub(repoRoot);
    if (pubForAnchor.ok) maybeCheckpoint(repoRoot, { pubFile: pubForAnchor.pubFile, signer, now });
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

  return ALLOW;
}

/**
 * The witness. Returns ALLOW under every circumstance, including its own
 * failure — which is why it is invoked with `|| true`, and why nothing here is
 * allowed to grow a refusal path.
 */
export function runWitness(payload, { now = () => new Date().toISOString() } = {}) {
  try {
    const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name : '';
    if (!toolName) return ALLOW;
    if (FENCED_TOOLS.includes(toolName)) return ALLOW;   // the fence already recorded it

    // Still the caller's cwd, deliberately and with a limit stated. `runFence`
    // now derives its root from the path being written (see `rootForCall`),
    // because there the root selects a CONSTITUTION. Here there is no path to
    // derive from — the witness records tools like Bash that carry none — so
    // there is nothing better to use.
    //
    // The residue: a caller naming the wrong cwd misfiles the witness receipt
    // into another directory's chain. That is a record-integrity gap, not an
    // authorization one — the witness returns ALLOW under every circumstance and
    // has no refusal to bypass. Written down rather than papered over, because a
    // chain with a hole in it should not be discovered by whoever needs it.
    const repoRoot = typeof payload?.cwd === 'string' && payload.cwd.length > 0 ? payload.cwd : process.cwd();
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
      rule: null,
      session: typeof payload?.session_id === 'string' ? payload.session_id : '',
      agent: payload?.agent_type ?? payload?.agent_id ?? null,
    }, signer ? signer.sign : null);
  } catch {
    // Deliberately swallowed. The witness losing a record must never cost the
    // owner a tool call.
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
