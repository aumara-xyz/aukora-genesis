// aukora · core/witness/paths.mjs — resolution, not names
//
// A fence over a namespace that has aliases is incomplete by construction.
// `resolve()` and `relative()` are purely lexical: they normalise `..`, which
// is why `law/../../etc/passwd` is caught, but they never touch the filesystem,
// so an ALIAS to a protected object is invisible to them.
//
// So every path is judged in two forms and refused if EITHER is protected:
//
//   lexical  — `..` collapsed, resolved against the repo root, no filesystem
//   real     — symlinks resolved, including symlinked PARENT directories
//
// Both, not one. `realpath` does not defeat every alias, and a symlink to a protected file resolves
// away from its innocent name, so the real form is the only one that sees it — while the lexical form
// is what catches `..` traversal. Neither check subsumes the other.
//
// This used to say the lexical form was load-bearing for HARD links. It is not, and the sentence read
// as reassurance: a hard link has no target at all, so BOTH forms return the innocent name and neither
// sees it. That case is caught separately — `linkState()` counts the links and `guard.mjs` refuses on
// `isMultiplyLinked` — which is a different mechanism, not a stronger version of this one.
//
// ── ON MATCHING KEYS ──
//
// macOS is the target and macOS lies to you about paths in three ways:
//
//   · APFS is case-INSENSITIVE by default, so `Law/x` and `law/x` are one file
//   · APFS stores names decomposed (NFD), so a `café` typed NFC in the law file
//     does not string-equal the `café` that comes back from the filesystem
//   · trailing dots and spaces are preserved here and stripped elsewhere
//
// Each of those is a way for two names to mean one file. The match key folds
// all three — lowercase, NFC, trailing dot/space stripped per segment — so the
// two names collapse to one key before any comparison happens.
//
// Folding over-matches on a case-SENSITIVE filesystem: a genuinely distinct
// `LAW/` would be refused by a `law/**` rule. That is the safe direction and it
// is deliberate. Over-refusal is a support ticket; under-refusal is the product
// being false.

import { lstatSync, readlinkSync, realpathSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** How deep we will walk looking for an existing ancestor before giving up. */
const MAX_ANCESTOR_WALK = 128;

/**
 * The real path, with symlinks resolved, for a path that may not exist yet.
 *
 * A file being written usually does not exist, so `realpathSync` on the target
 * throws. Walk up to the deepest ancestor that DOES exist, resolve that, and
 * re-append the remainder — which is what catches a symlinked parent directory,
 * the case a leaf-only check misses entirely.
 *
 * Never throws. A fence that throws is a fence that fails open.
 */
export function realpathish(abs) {
  let dir = abs;
  const tail = [];
  for (let i = 0; i < MAX_ANCESTOR_WALK; i += 1) {
    // ── lstat, NEVER existsSync ────────────────────────────────────────────
    //
    // `existsSync` FOLLOWS the link, so a DANGLING symlink answers false and this
    // walker stepped straight past the alias: it treated the link as a name that
    // did not exist yet, walked up to its parent, re-appended the leaf, and handed
    // back the innocent LEXICAL path. Measured, conformance case 03:
    //
    //   world/mind.md -> /somewhere-outside-the-repo   (target absent)
    //   realpathish   -> <repo>/world/mind.md
    //   analyse       -> outside:false  aliased:FALSE  resolved:'world/mind.md'
    //
    // Worse than a missed refusal. `aliased` is the field that puts
    // `path: innocent.txt / resolved: secrets/key.txt` in the receipt, so with it
    // false the escape is invisible in the record too — the audit trail agrees
    // with the attacker.
    //
    // The header of this file promises the resolved form is "the only one that
    // sees" a symlink to a protected object. That promise held only while the
    // target existed, which is precisely the condition an attacker chooses.
    let st = null;
    try { st = lstatSync(dir); } catch { st = null; }
    if (st) {
      if (st.isSymbolicLink()) {
        // `realpathSync` throws on a dangling link, so resolve this ONE hop by hand
        // and re-enter — the target may itself be a link, or may not exist at all.
        // No `tail` push: the link IS the thing at this position, not a parent of it.
        let target;
        try { target = readlinkSync(dir); } catch { return abs; }
        dir = isAbsolute(target) ? target : resolve(dirname(dir), target);
        continue;
      }
      try {
        const real = realpathSync(dir);
        return tail.length ? resolve(real, ...tail) : real;
      } catch { return abs; }
    }
    const parent = dirname(dir);
    if (parent === dir) return abs;
    tail.unshift(dir.slice(parent.length + 1));
    dir = parent;
  }
  // MAX_ANCESTOR_WALK also bounds symlink HOPS now, so a link loop (a -> b -> a)
  // exhausts it and lands here rather than spinning. Returning `abs` is the same
  // unresolved answer this function has always given, and the loop is refused a
  // second time regardless: `linkState` opens O_NOFOLLOW and gets ELOOP, and the
  // write itself would too. Named because "the fence returned the lexical path"
  // is a fail-open shape and should never be inferred from silence.
  return abs;
}

/**
 * Fold one path segment to its matching form.
 *
 * Lowercase and NFC for the reasons in the header. Trailing dots and spaces are
 * stripped because `protected.txt.` and `protected.txt ` are distinct files on
 * APFS but read as the same name to a human writing a rule — and the attacker
 * is not the one who has to be convinced.
 */
function foldSegment(segment) {
  return segment
    .normalize('NFC')
    .toLowerCase()
    .replace(/[. ]+$/u, '');
}

/**
 * Fold a whole `/`-joined relative path.
 *
 * ── FOLD FIRST, THEN DROP EMPTIES ──
 *
 * The order here is load-bearing and was wrong. Filtering before folding let a
 * segment made only of dots or spaces — `...`, `. `, ` `, all legal directory
 * names on APFS — survive the `s !== '.'` filter and then fold to the empty
 * string, leaving `//` in the key:
 *
 *     src/.../aws.pem   →   src//aws.pem
 *
 * `**` compiles to `(?:[^/]+/)*`, and `[^/]+` cannot match an empty segment, so
 * `**\/*.pem` stopped matching and the write was ALLOWED. The same trick
 * defeated `**\/*.key` and `**\/id_ed25519` — every suggested rule that names a
 * file rather than a directory prefix.
 *
 * Found by Kimi K3 reviewing this file; reproduced before it was believed.
 * See EVIDENCE.md §E4.
 */
export function foldPath(rel) {
  return rel
    .split('/')
    .map(foldSegment)
    .filter((s) => s.length > 0 && s !== '.')
    .join('/');
}

/**
 * How many names does this inode answer to?
 *
 * ══ THE ONE ALIAS RESOLUTION CANNOT SEE ══
 *
 * A symlink has a target, so `realpath` resolves it and the fence sees the real
 * object. A HARD link has no target — it is a second directory entry for one
 * inode, peer to the first. Both the lexical form and the resolved form return
 * the innocent name, and every string comparison in this file agrees the write
 * is fine. Measured:
 *
 *   ln law/protected.txt notes/innocent.txt
 *   echo OVERWRITTEN > notes/innocent.txt     → law/protected.txt is overwritten
 *
 * The header of this file used to say the lexical form was "load-bearing" for
 * hard links. It is load-bearing for `..` traversal. For this it does nothing,
 * and the sentence read as reassurance.
 *
 * ══ WHY THE INODE, AND WHY ONLY SOMETIMES ══
 *
 * We cannot enumerate an inode's other names without walking the filesystem, so
 * we do not try to learn WHETHER the other name is protected. `st_nlink > 1`
 * says the bytes are reachable under a name we did not judge, and a name this
 * gate cannot reason about is a name it does not allow. That over-refuses a
 * legitimate multiply-linked file — the safe direction, and stated rather than
 * hidden.
 *
 * `O_NOFOLLOW` rather than `stat`: it fails `ELOOP` on a symlink at the
 * syscall, so the symlink case is decided by the kernel instead of by an
 * `existsSync` guess, and the descriptor we `fstat` is the object we opened
 * rather than whatever the name meant a moment later.
 *
 * DIRECTORIES ARE EXEMPT AND MUST BE. Every directory has `nlink >= 2` — its
 * own entry plus `.` — and a directory with subdirectories has more. Checking
 * `nlink` without excluding them refuses every write beneath every nested
 * directory, which is not a fence, it is an outage.
 *
 * This NARROWS the alias door. It does not shut it: the check needs a leaf that
 * already exists, so a `Write` creating a new path is still judged on name
 * alone, and the TOCTOU window is untouched — the harness opens the path again,
 * separately, after this process has exited.
 */
export function linkState(abs) {
  let fd;
  try {
    // O_NONBLOCK IS NOT OPTIONAL. Opening a FIFO for reading BLOCKS until a
    // writer appears, and `openSync` blocks the event loop, so a named pipe
    // anywhere a path resolves to hangs the guard forever — measured: a 3s
    // watchdog never fired because the timer could not run. The harness would
    // eventually time out and `|| exit 2` would refuse, so it fails closed, but
    // every such call stalls for the full timeout first.
    //
    // O_NONBLOCK returns immediately for a FIFO with no writer. The `isFile`
    // check below still rejects it — this flag is about the open, not the
    // verdict. Found by gpt-5.6-sol in council.
    fd = openSync(abs, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    const code = err?.code ?? 'unknown';
    // ENOENT: nothing there yet — a new file cannot be a hard link to anything.
    // ELOOP:  a symlink whose resolution already ran above.
    // EACCES/EPERM/others: unreadable, so unknowable; recorded, not guessed at.
    return { checked: false, nlink: null, reason: code };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { checked: false, nlink: null, reason: 'not-a-regular-file' };
    return { checked: true, nlink: st.nlink, reason: null };
  } catch (err) {
    return { checked: false, nlink: null, reason: err?.code ?? 'fstat-failed' };
  } finally {
    try { closeSync(fd); } catch { /* the descriptor is going away regardless */ }
  }
}

/** True when the object exists, is a regular file, and answers to another name. */
export function isMultiplyLinked(links) {
  return !!(links && links.checked && typeof links.nlink === 'number' && links.nlink > 1);
}

/**
 * Everything the law needs to judge one raw path from one tool call.
 *
 * `ok: false` is a refusal reason, never a silent pass. A path we cannot
 * confidently reason about is a path we do not allow.
 *
 * @returns {{ok: true, links: {checked: boolean, nlink: number|null, reason: string|null},
 *              display: string, resolved: string, aliased: boolean, outside: boolean,
 *              isRoot: boolean, keys: string[], realAbs: string}
 *          | {ok: false, reason: string}}
 */
export function analyse(repoRoot, raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'the path is not a string' };
  if (raw.length === 0) return { ok: false, reason: 'the path is empty' };
  if (raw.includes('\0')) return { ok: false, reason: 'the path contains a NUL byte' };

  let root;
  try {
    root = realpathish(resolve(repoRoot));
  } catch {
    return { ok: false, reason: 'the repository root could not be resolved' };
  }

  let lexical;
  try {
    lexical = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
  } catch {
    return { ok: false, reason: `the path could not be resolved: ${raw}` };
  }
  const real = realpathish(lexical);

  // Judge both forms. A path is outside the repo if EITHER form is outside —
  // a symlink inside the tree pointing out of it is still an escape.
  const keys = new Set();
  let outside = false;
  let isRoot = false;
  const rels = {};

  for (const [name, abs] of [['lexical', lexical], ['real', real]]) {
    const rel = relative(root, abs).split(sep).join('/');
    if (rel === '' || rel === '.') {
      // ── THE ROOT NEEDS A FLAG, NOT AN EMPTY KEY ──────────────────────────
      //
      // This said "treat as protected" and added `''` to the key set. Nothing
      // treats it as protected: `compilePattern` wraps every rule as
      // `^(?:body)(?:/.*)?$`, and no rule in any law has an empty body, so `''`
      // matches NOTHING and `judge()` returns `protected: false`. The comment
      // asserted a property the code did not carry — for as long as the comment
      // has been there.
      //
      // Conformance case 10 "passes" today, which is how it stayed hidden: the
      // kernel returns EISDIR before phi is consulted, and the report says so in
      // as many words — "before φ: the filesystem refused the edit: EISDIR". A
      // fence whose only argument is the operating system has not made one.
      //
      // A flag, because this is a fact about the path and not a rule anyone
      // wrote. It cannot be expressed as a pattern and should not be smuggled in
      // as one.
      isRoot = true;
      keys.add('');
      rels[name] = '.';
      continue;
    }
    if (rel.startsWith('../') || rel === '..' || isAbsolute(rel)) {
      outside = true;
      rels[name] = abs;   // the absolute path IS the finding for an escape
      continue;
    }
    rels[name] = rel;
    keys.add(foldPath(rel));
  }

  return {
    ok: true,
    // How many names the bytes answer to. Checked on the RESOLVED object,
    // because that is what a write actually lands on.
    links: linkState(real),
    // What the law judges, and what a reader sees first.
    display: rels.lexical,
    // Where it actually landed. When these two differ, the receipt shows the
    // alias: `path: innocent.txt` next to `resolved: secrets/key.txt` is the
    // symlink attempt, legible without any tooling.
    resolved: rels.real,
    aliased: rels.lexical !== rels.real,
    outside,
    /** The path IS the repository root. Not a file, and never writable as one. */
    isRoot,
    keys: [...keys],
    realAbs: real,
  };
}
