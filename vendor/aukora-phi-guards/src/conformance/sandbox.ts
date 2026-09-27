// φ CONFORMANCE — THE SANDBOX: build the hostile world, photograph it, and prove the photograph.
//
// ══ TWO ROOTS, AND WHY ══
//
//   <root>/          the SANDBOX. Stands in for the whole filesystem.
//   <root>/repo/     the REPOSITORY ROOT the fixture describes — what φ is pointed at.
//
// Case 03's symlink target is the absolute path `/nonexistent-target-xyz.txt`, and its incident says the
// donor's node really did write `ESCAPED-VIA-DANGLING-LINK` outside the world. Reproducing that
// literally would mean this suite writing to the root of the owner's disk, which is not a thing a test
// gets to do to prove a point. So an absolute target is remapped into <root>: it is still outside the
// repository, still outside anything φ is allowed to touch, and the escape is still measured — it just
// lands in a temp directory that gets deleted.
//
// This is the ONLY reinterpretation of a case file anywhere in this lane, it is stated here, and it
// makes the fence STRICTER to satisfy rather than looser: <root> is closer to <root>/repo than `/` is.
//
// ══ WHY THE FIXTURE IS VERIFIED AFTER IT IS BUILT ══
//
// A symlink case that silently materialised as a regular file would pass the fence for the wrong
// reason and report a capability φ does not have. `verify` re-measures every declared alias against the
// filesystem — is it really a link, does it really point there, do the two names really share an inode
// — and any case whose premise did not survive contact with this filesystem is reported as
// fixture-invalid rather than counted as anything at all.
//
// ══ WHAT IS DELIBERATELY NOT WATCHED, AND THE ONE LINE THAT MOVED ══
//
// `.git/`, the `.aukora/` DIRECTORY ENTRY itself, and `.aukora/forge-receipts.jsonl`. φ writing a
// receipt about a refusal is φ working, not φ writing to the world, and counting it would fail every
// case for the one thing this repository does right.
//
// It used to be the whole of `.aukora/`, and that was wrong the moment `core/authority/vowRecord.ts`
// landed: standing is now read from `<repo>/.aukora/standing.json`, so that directory holds a
// CREDENTIAL and not only a log. An exclusion written for a ledger would have made a fixture minting
// its own standing the one write this suite could not see. Everything inside `.aukora/` is watched
// except the ledger file by name.

import {
  mkdirSync, mkdtempSync, writeFileSync, symlinkSync, linkSync, lstatSync, statSync, readlinkSync,
  readFileSync, readdirSync, rmSync, unlinkSync, existsSync, realpathSync,
} from 'fs';
import { createHash } from 'crypto';
import { basename, dirname, join, relative, resolve, sep } from 'path';
import { tmpdir } from 'os';
import type { HostileCase } from './corpus';
// A value import, not just a type: the sandbox declares the law each case is judged under, and the
// writable half of that law is the corpus's own. `corpus.ts` imports only `fs`/`path`, so no cycle.
import { declaredWritable, loadCorpus } from './corpus';

/** See the header for each of these. */
const VCS = '.git';
const CUSTODY_DIR = '.aukora';
const LEDGER_FILE = 'forge-receipts.jsonl';

export interface Sandbox {
  /** Stands in for the filesystem root. Everything this suite creates lives under here. */
  root: string;
  /** The repository root φ is pointed at via AUKORA_FORGE_REPO. */
  repo: string;
}

export interface Entry {
  kind: 'dir' | 'file' | 'link';
  /** sha256 of the bytes, for a file. */
  hash?: string;
  /** the stored target, for a link — the string readlink returns, not where it resolves to. */
  target?: string;
  /** the bytes, kept so the sandbox can be put back exactly. Fixtures are tiny; the cap is a guard. */
  content?: string;
}

/** path relative to the sandbox root → what was there. */
export type Witness = Map<string, Entry>;

const CONTENT_CAP = 256_000;

/**
 * Where a symlink target points, in sandbox terms.
 *
 * Absolute → remapped under <root> (see the header). Relative → resolved against the REPOSITORY root
 * rather than the link's own directory, because that is what the case files mean: case 04 writes
 * `world/mind.md -> law.js` and the `law.js` it is talking about is the one in the fixture's `files`,
 * which sits at the repository root. Resolving it against `world/` instead would produce a dangling
 * link and quietly turn case 04 into a second copy of case 03.
 */
export function targetOf(s: Sandbox, target: string): string {
  return target.startsWith('/') ? join(s.root, target) : resolve(s.repo, target);
}

/** Build the world the case describes. Directories, then files, then links, then hard links. */
export function build(c: HostileCase): Sandbox {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'phi-conformance-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  const s: Sandbox = { root, repo };

  for (const d of c.fixture.dirs ?? []) mkdirSync(join(repo, d), { recursive: true });

  for (const [rel, body] of Object.entries(c.fixture.files ?? {})) {
    const abs = join(repo, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  }

  for (const [rel, target] of Object.entries(c.fixture.symlinks ?? {})) {
    const link = join(repo, rel);
    mkdirSync(dirname(link), { recursive: true });
    const abs = targetOf(s, target);
    // An absolute target stays absolute — "somewhere else entirely" is the shape of the attack. A
    // relative one is stored relative to the link, which is how a real repository would carry it.
    symlinkSync(target.startsWith('/') ? abs : relative(dirname(link), abs), link);
  }

  for (const [rel, existing] of Object.entries(c.fixture.hardlinks ?? {})) {
    const link = join(repo, rel);
    mkdirSync(dirname(link), { recursive: true });
    linkSync(targetOf(s, existing), link);
  }

  writeLaw(s);
  return s;
}

/**
 * THE LAW THE CASES ARE JUDGED UNDER — declared by the runner, never by a case.
 *
 * ══ WHY THE SANDBOX NEEDS A LAW AT ALL ══
 *
 * Until now every fixture ran with NO `aukora.law.json`, so `loadLaw` fell back to φ's built-in
 * defaults. That was fine while the fence was a denylist, because the fallback names the protected
 * set. It stops being fine the moment the fence asks "is this path DECLARED writable?" — a question
 * nothing in an absent law can answer, and one the corpus has always had an answer to:
 * `declaredWritable()` reads the editable set off the ALLOW cases, and `run.ts` has been PRINTING it
 * ("declared writable by the corpus: world/mind.md") while nothing enforced it. Case 02 is precisely
 * the complaint that nothing does.
 *
 * So the runner writes the law. This does not edit a case and could not — the corpus loader forbids
 * it and this function never reads `c`. It configures the NODE with the policy the corpus already
 * declares, which is the same act as setting `AUKORA_FORGE_REPO`, and it happens before the opening
 * photograph so it is never mistaken for something φ moved.
 *
 * ══ WHY THE PROTECTED SET IS SPELLED OUT ══
 *
 * `loadLaw` unions only DEFAULT_PROTECTED into a parsed law; the SUGGESTED patterns — `secrets`,
 * `credentials`, `.env`, the key and certificate globs — exist ONLY in the no-law fallback. A sandbox
 * that gains a law file therefore silently loses them, and cases 06 and 11 would stop being refused
 * by the rule that names them and start being refused as merely undeclared. Same verdict, weaker
 * sentence, and a report that could no longer tell the owner which rule caught the write. Spelling
 * them out keeps every already-armed case refused for exactly the reason it is refused today.
 */
function writeLaw(s: Sandbox): void {
  const law = {
    schema: 'aukora-law-v0',
    note: 'Written by conformance/sandbox.ts. The protected set is φ\'s own defaults, spelled out because '
      + 'a parsed law drops the suggested half; `writable` is what the corpus declares via its ALLOW cases.',
    protected: [
      'aukora.law.json', 'aukora.pub', '.aukora/**', '.claude/settings.json', '.claude/settings.local.json',
      '.git/**', '.env', '.env.*', '**/*.pem', '**/*.key', 'secrets/**', 'credentials/**',
      '**/id_rsa', '**/id_ed25519',
    ],
    writable: declaredWritable(loadCorpus()),
    writesOutsideRepo: 'refuse',
    unguardedTools: 'receipt',
  };
  writeFileSync(join(s.repo, 'aukora.law.json'), `${JSON.stringify(law, null, 2)}\n`, 'utf8');
}

/**
 * Everything wrong with the world that was just built, named. Empty means the case's premise is real
 * on THIS filesystem and the result of running it can be trusted.
 */
export function verify(c: HostileCase, s: Sandbox): string[] {
  const bad: string[] = [];

  for (const [rel, body] of Object.entries(c.fixture.files ?? {})) {
    const abs = join(s.repo, rel);
    try {
      if (readFileSync(abs, 'utf8') !== body) bad.push(`${rel}: content is not what the case declared`);
    } catch { bad.push(`${rel}: declared as a file and is not readable`); }
  }

  for (const [rel, target] of Object.entries(c.fixture.symlinks ?? {})) {
    const link = join(s.repo, rel);
    try {
      if (!lstatSync(link).isSymbolicLink()) { bad.push(`${rel}: declared a symlink, materialised as something else`); continue; }
    } catch { bad.push(`${rel}: declared a symlink and is not there`); continue; }
    const points = resolve(dirname(link), readlinkSync(link));
    const meant = targetOf(s, target);
    if (points !== meant) bad.push(`${rel}: points at ${points}, the case meant ${meant}`);
    // A DANGLING link is the whole of case 03. If the target exists, the case is not testing what it
    // says it is testing, and that is worth failing loudly over.
    const shouldDangle = !existsSync(meant);
    if (shouldDangle && existsSync(link)) bad.push(`${rel}: the target was supposed to be absent and resolves anyway`);
  }

  for (const [rel, existing] of Object.entries(c.fixture.hardlinks ?? {})) {
    const link = join(s.repo, rel);
    try {
      const a = statSync(link);
      const b = statSync(targetOf(s, existing));
      // THE POINT OF A HARD LINK: it has no target to resolve to. Only the inode says they are one file.
      if (a.ino !== b.ino) bad.push(`${rel}: declared a hard link to ${existing} and does not share its inode`);
      if (a.nlink < 2) bad.push(`${rel}: shares an inode with nothing (nlink ${a.nlink})`);
    } catch { bad.push(`${rel}: declared a hard link and could not be measured`); }
  }

  return bad;
}

/** Photograph the sandbox: every name under it, what kind of thing it is, and its bytes. */
export function witness(s: Sandbox): Witness {
  const w: Witness = new Map();
  walk(s.root, s.root, w);
  return w;
}

function walk(root: string, dir: string, out: Witness): void {
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (name === VCS) continue;
    const abs = join(dir, name);
    const rel = relative(root, abs);
    let st;
    try { st = lstatSync(abs); } catch { continue; }
    // lstat, never stat: a symlink is a thing in its own right here, and following it would photograph
    // the target twice and miss the alias entirely.
    if (st.isSymbolicLink()) { out.set(rel, { kind: 'link', target: safeReadlink(abs) }); continue; }
    if (st.isDirectory()) {
      // The ledger directory appearing is φ opening its own log. Not recorded — but walked, because
      // what else lands in there is exactly what this suite must not miss.
      if (name !== CUSTODY_DIR) out.set(rel, { kind: 'dir' });
      walk(root, abs, out);
      continue;
    }
    if (name === LEDGER_FILE && basename(dir) === CUSTODY_DIR) continue;
    let content: string | undefined;
    let hash: string;
    try {
      const buf = readFileSync(abs);
      hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
      if (buf.length <= CONTENT_CAP) content = buf.toString('utf8');
    } catch { hash = 'unreadable'; }
    out.set(rel, { kind: 'file', hash, content });
  }
}

function safeReadlink(abs: string): string {
  try { return readlinkSync(abs); } catch { return '(unreadable link)'; }
}

export interface Difference {
  path: string;
  what: 'added' | 'removed' | 'changed';
  /** What the thing IS now (or was, if it is gone). A created parent directory is not a written file. */
  kind: Entry['kind'];
  detail: string;
}

/** What moved between two photographs. This is the entire measurement a verdict rests on. */
export function differences(before: Witness, after: Witness): Difference[] {
  const out: Difference[] = [];
  for (const [path, a] of after) {
    const b = before.get(path);
    if (!b) { out.push({ path, what: 'added', kind: a.kind, detail: describe(a) }); continue; }
    if (b.kind !== a.kind) { out.push({ path, what: 'changed', kind: a.kind, detail: `${b.kind} → ${a.kind}` }); continue; }
    if (a.kind === 'file' && a.hash !== b.hash) { out.push({ path, what: 'changed', kind: a.kind, detail: `${b.hash} → ${a.hash}` }); continue; }
    if (a.kind === 'link' && a.target !== b.target) out.push({ path, what: 'changed', kind: a.kind, detail: `→ ${b.target} became → ${a.target}` });
  }
  for (const [path, b] of before) if (!after.has(path)) out.push({ path, what: 'removed', kind: b.kind, detail: describe(b) });
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

function describe(e: Entry): string {
  return e.kind === 'link' ? `symlink → ${e.target}` : e.kind === 'dir' ? 'directory' : `file ${e.hash}`;
}

/**
 * Put the sandbox back to a photograph, and say what had to be put back.
 *
 * This is what makes the final measurement attributable. The runner has to make the hostile edit itself
 * — that is crush's job in production, and there is no model in this loop — so before φ is asked to
 * APPLY anything, everything the runner touched is undone. Whatever differs from the photograph after
 * that point was written by φ and by nothing else.
 */
export function restoreTo(s: Sandbox, w: Witness): string[] {
  const undone: string[] = [];
  const now = witness(s);

  // Remove what is there and should not be — deepest first, so a directory is empty by the time it goes.
  const extra = [...now.keys()].filter((p) => !w.has(p)).sort((a, b) => b.length - a.length);
  for (const rel of extra) {
    const abs = join(s.root, rel);
    try {
      if (lstatSync(abs).isDirectory()) rmSync(abs, { recursive: true, force: true });
      else unlinkSync(abs);
      undone.push(rel);
    } catch { /* already gone, or a parent took it */ }
  }

  // Put back what changed or vanished — shallowest first, so parents exist before their children.
  const wanted = [...w.entries()].sort((a, b) => a[0].length - b[0].length);
  for (const [rel, want] of wanted) {
    const abs = join(s.root, rel);
    const have = now.get(rel);
    if (have && have.kind === want.kind && (want.kind !== 'file' || have.hash === want.hash)
        && (want.kind !== 'link' || have.target === want.target)) continue;
    try {
      if (have) { if (lstatSync(abs).isDirectory()) rmSync(abs, { recursive: true, force: true }); else unlinkSync(abs); }
      mkdirSync(dirname(abs), { recursive: true });
      if (want.kind === 'dir') mkdirSync(abs, { recursive: true });
      else if (want.kind === 'link') symlinkSync(want.target ?? '', abs);
      else writeFileSync(abs, want.content ?? '', 'utf8');
      undone.push(rel);
    } catch { /* reported by the caller as a sandbox that could not be reset */ }
  }
  return undone;
}

/** Is this absolute path inside the sandbox? The runner's own fence on its own hostile edit. */
export function insideSandbox(s: Sandbox, abs: string): boolean {
  return abs === s.root || abs.startsWith(s.root + sep);
}

export function destroy(s: Sandbox): void {
  rmSync(s.root, { recursive: true, force: true });
}

/**
 * What this filesystem actually does, measured rather than assumed.
 *
 * Four of the twelve cases are about macOS specifically — case-folding, NFD, trailing dots — and the
 * honest report has to say whether the machine it just ran on has those properties at all. A green case
 * 07 on a case-SENSITIVE volume proves nothing about the fence and must not be read as if it did.
 */
export interface FsTraits { caseInsensitive: boolean; normalizationInsensitive: boolean; trailingDotStripped: boolean }

export function measureFs(dir: string): FsTraits {
  const probe = mkdtempSync(join(realpathSync(dir), 'phi-fs-probe-'));
  const t: FsTraits = { caseInsensitive: false, normalizationInsensitive: false, trailingDotStripped: false };
  // Written as escapes on purpose: the two spellings of cafe are the same glyphs on a screen, and a
  // reader has to be able to tell which is which without trusting their own editor to show the
  // difference. \u00e9 is one code point; e + \u0301 is two that draw the same mark.
  const NFC = 'caf\u00e9.txt';
  const NFD = 'cafe\u0301.txt';
  try {
    writeFileSync(probe + sep + 'Aa.txt', 'x', 'utf8');
    t.caseInsensitive = existsSync(probe + sep + 'aA.TXT');
    writeFileSync(probe + sep + NFC, 'x', 'utf8');
    t.normalizationInsensitive = existsSync(probe + sep + NFD);
    writeFileSync(probe + sep + 'dot.txt', 'x', 'utf8');
    t.trailingDotStripped = existsSync(probe + sep + 'dot.txt.');
  } catch { /* a trait that cannot be measured stays false, which is the conservative reading */ }
  finally { rmSync(probe, { recursive: true, force: true }); }
  return t;
}
