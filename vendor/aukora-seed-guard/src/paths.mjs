// aukora · src/paths.mjs — resolution, not names
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
// Both, not one. `realpath` does not defeat every alias — a HARD link resolves
// to the name you hand it, so the lexical form stays load-bearing; and a
// symlink to a protected file resolves away from its innocent name, so the real
// form is the only one that sees it. Neither check subsumes the other.
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

import { existsSync, realpathSync, lstatSync, readlinkSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** How deep we will walk looking for an existing ancestor before giving up. */
const MAX_ANCESTOR_WALK = 128;

/** Open failures that prove there is no inode, as opposed to hiding one. */
const CANNOT_EXIST = new Set(['ENOENT', 'ENAMETOOLONG', 'ENOTDIR']);

/** How many dangling-symlink hops to follow before giving up. Cycles exist. */
const MAX_SYMLINK_HOPS = 16;

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
export function realpathish(abs, hops = 0, state = null) {
  let dir = abs;
  const tail = [];
  for (let i = 0; i < MAX_ANCESTOR_WALK; i += 1) {
    // ── A DANGLING SYMLINK IS AN ENTRY, AND `existsSync` SAYS IT IS NOT ──
    //
    // `existsSync` FOLLOWS the link, so a symlink whose target does not exist
    // yet reports false. The walk then stepped straight past the leaf, resolved
    // the parent, re-appended the leaf's NAME, and handed back an innocent
    // in-repo path — while the harness's own open(O_CREAT) would follow the
    // link and create the file wherever it pointed. Measured:
    //
    //   ln -s /nonexistent-target-xyz.txt world/mind.md
    //   analyse('world/mind.md') → resolved 'world/mind.md', outside=false
    //
    // `lstat` does not follow, so the entry is seen. Found by the shared
    // conformance suite (`dangling-symlink`) on its first run here.
    let entry = false;
    try { lstatSync(dir); entry = true; } catch { entry = false; }
    if (entry) {
      try {
        const real = realpathSync(dir);
        return tail.length ? resolve(real, ...tail) : real;
      } catch {
        // `realpathSync` throws on a dangling link. Resolve the one hop by
        // hand and continue from the target — which may itself dangle, hence
        // the budget. Without it, a symlink cycle spins here forever.
        let hopped = null;
        try {
          const st = lstatSync(dir);
          if (st.isSymbolicLink() && hops < MAX_SYMLINK_HOPS) {
            hopped = resolve(dirname(dir), readlinkSync(dir));
          }
        } catch { hopped = null; }
        // ── GIVING UP MUST NOT LOOK LIKE AN ANSWER ──
        //
        // This returned `abs` — the ORIGINAL LEXICAL PATH — when the hop budget
        // ran out, and `analyse` then judged that innocent in-repo name as if it
        // were the resolution. Measured, with a 20-link dangling chain ending
        // outside the repository:
        //
        //   10 dangling hops → resolved /nonexistent-escape-target.txt, outside  → exit 2
        //   20 dangling hops → resolved d17.txt,                    NOT outside → exit 0
        //
        // The harness then follows all twenty links and writes outside the repo.
        // Fail-OPEN, introduced by the dangling-symlink fix itself, and found by
        // gpt-5.6-sol and kimi-k3 independently in the same council round.
        //
        // `state.exhausted` lets the caller refuse instead of trusting a name
        // this function never actually resolved.
        if (hopped === null) {
          if (state) state.exhausted = true;
          return abs;
        }
        const target = realpathish(hopped, hops + 1, state);
        return tail.length ? resolve(target, ...tail) : target;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return abs;
    // `basename`, not `dir.slice(parent.length + 1)`. That arithmetic assumed
    // the parent never ends in a separator — but the filesystem root does, so
    // for any path directly under `/` it sliced off a real character:
    //
    //   realpathish('/nonexistent-target-xyz.txt') → '/onexistent-target-xyz.txt'
    //
    // Pre-existing, and unreachable until the dangling-symlink fix above sent a
    // root-level path through this walk. The VERDICT was unaffected (both spell
    // "outside the repository"), but the path went into the receipt — and a
    // record that misnames what it refused is the one defect this project
    // cannot afford.
    tail.unshift(basename(dir));
    dir = parent;
  }
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
    // Two different failures wear the same shape here, and conflating them is
    // how this check got its own bug:
    //
    //   CANNOT EXIST   ENOENT, ENAMETOOLONG, ENOTDIR — there is no inode, so
    //                  there is nothing to be a second name for. Benign.
    //   CANNOT LOOK    EACCES, EPERM, ELOOP, anything else — an inode may well
    //                  be there and we were unable to count its names.
    //
    // A write-only file (mode 0200) fails EACCES on an O_RDONLY open, so a
    // multiply-linked file the agent cannot read walked straight through a
    // check whose whole job is to notice multiply-linked files. `checked:false`
    // was read downstream as "not a hard link" when it means "we do not know",
    // and those are opposite answers. Found by gpt-5.6-sol in council.
    //
    // ENAMETOOLONG is in the benign set on purpose: a 4000-character filename
    // cannot name an inode on any filesystem here, so refusing it as
    // un-inspectable would refuse a path that provably has no second name.
    //
    // Everything else means we could not look. A write-only file (mode 0200)
    // fails EACCES on an O_RDONLY open — so a multiply-linked file the agent
    // cannot read walked straight through a check whose whole job is to notice
    // multiply-linked files. `checked:false` was being read downstream as "not
    // a hard link" when it means "we do not know", and those are opposite
    // answers. Found by gpt-5.6-sol in council.
    return { checked: false, nlink: null, reason: code, unknowable: !CANNOT_EXIST.has(code) };
  }
  try {
    const st = fstatSync(fd);
    // A directory or a FIFO has no hard-link question to answer. This is a real
    // determination, not a failure to make one, so it is NOT `unknowable`.
    if (!st.isFile()) return { checked: false, nlink: null, reason: 'not-a-regular-file', unknowable: false };
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

/** We tried to count the names and could not. Not the same as "only one". */
export function isLinkStateUnknowable(links) {
  return !!(links && links.unknowable);
}

/**
 * Everything the law needs to judge one raw path from one tool call.
 *
 * `ok: false` is a refusal reason, never a silent pass. A path we cannot
 * confidently reason about is a path we do not allow.
 *
 * @returns {{ok: true, display: string, outside: boolean, keys: string[], real: string}
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
  const resolution = { exhausted: false };
  const real = realpathish(lexical, 0, resolution);
  if (resolution.exhausted) {
    return { ok: false, reason: `the symlink chain at ${raw} could not be resolved within the hop budget` };
  }

  // Judge both forms. A path is outside the repo if EITHER form is outside —
  // a symlink inside the tree pointing out of it is still an escape.
  const keys = new Set();
  let outside = false;
  const rels = {};

  for (const [name, abs] of [['lexical', lexical], ['real', real]]) {
    const rel = relative(root, abs).split(sep).join('/');
    if (rel === '' || rel === '.') {
      // The repository root itself. Not writable as a file; treat as protected.
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
    keys: [...keys],
    realAbs: real,
  };
}
