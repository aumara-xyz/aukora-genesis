// core/state-root.ts — specs/0026: AUKORA_STATE_ROOT, the owner-controlled state home,
// separated from AUKORA_EFFECT_ROOT (the live repo or a forge candidate).
//
// The effect root is the tree the model works in — judged, receipted, disposable. The STATE
// root is what must survive it: the canonical ledger, the turn/effect journal, frontier pins,
// anchors, the v2 vault, the key registry, the TCB manifest, the legacy-v1 freeze manifest.
// It defaults to ~/.aukora/membrane/state/projects/<fingerprint>/ where the fingerprint is a
// digest of the effect root's real path — never inside the governed tree. Tests and sandboxes
// set AUKORA_STATE_ROOT explicitly, which is what keeps verification hermetic (brick G).
//
// ── THE ADDRESSING PROBLEM (measured 2026-08-08 against main @ 0148d8e) ──────
// The three lines above state that the effect root is DISPOSABLE and the state root is
// what SURVIVES it. stateRoot() then keys the survivor on a digest of the disposable
// thing's path. So when an effect root is deleted, its state root is not lost — it
// becomes UNADDRESSABLE, because the only input to its name is a path that no longer
// exists. Measured consequence: 4,837 roots, 283 MB, of which 4,825 name a path that is
// gone; 4,786 carry a journal; 15,168 effect rows sit inside them, 4,038 still at
// RUNNING. Nothing can look any of it up.
//
// Two mechanisms produce them. hooks/law.ts opens a Journal at stateRoot(ROOT) and the
// Journal constructor mkdirSync's unconditionally with no marker (4,782 unattributed
// roots). And scripts/boundary-verify.ts:1518 spawns a child with cwd set to a tmpdir
// sandbox and no AUKORA_STATE_ROOT, so the child mints a durable home under homedir()
// and the sandbox is then deleted — the gate leaks one root per run.
//
// What is missing is not a reaper. It is ENTITLEMENT: stateRoot() will mint durable
// state for any path on earth, with no notion of whether that path is entitled to it.
// classifyEffectRoot() below introduces that notion; projectStateRoot() proposes the
// keying that follows from it (a candidate worktree resolves to its PARENT repo's
// root, because a candidate of R is still about R). Both are ADDITIVE. stateRoot()'s
// behaviour is deliberately unchanged: re-homing a live ledger is an owner's decision.
import { homedir } from 'node:os';
import { realpathSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** The effect root: the tree whose writes are judged. Crush sets CRUSH_PROJECT_DIR; hand-run
 *  scripts fall back to the cwd. */
export function effectRoot(): string {
  return process.env.AUKORA_EFFECT_ROOT || process.env.CRUSH_PROJECT_DIR || process.cwd();
}

/** The state root for a given effect root. Owner-controlled, outside the repo by default. */
export function stateRoot(root?: string): string {
  if (process.env.AUKORA_STATE_ROOT) return process.env.AUKORA_STATE_ROOT;
  const effect = root || effectRoot();
  let real = effect;
  try { real = realpathSync(effect); } catch { /* the root may not exist yet — lexical is fine */ }
  const fp = sha256hex(real).slice(0, 16);
  return join(homedir(), '.aukora', 'membrane', 'state', 'projects', fp);
}

// ── ENTITLEMENT ─────────────────────────────────────────────────────────────
// The distinction the codebase does not currently have. A forge candidate and a
// throwaway gate sandbox are today indistinguishable to stateRoot(): both are "a path",
// both get durable state. They are not the same thing and should not share a policy.
//
//   governed  — inside a git worktree. Its GOVERNING KEY is the repo's common git dir,
//               which is IDENTICAL for the main worktree and every candidate worktree
//               of that repo (measured: repo, scratch worktree and a live candidate all
//               resolve to 3be87bd5135cbef7). A candidate of R is about R.
//   ephemeral — no repo above it. A tmpdir sandbox. Evidence produced here is about the
//               GATE, not about the world, and it should be REQUIRED to declare a
//               throwaway root rather than silently minting a durable one.
//
// NOTE ON COST: this shells out to git, so it is called on root CREATION and by the
// census — never from stateRoot(), which is on the law's hot path for every judged
// effect. Do not move it there.
export type EffectRootKind = 'governed' | 'ephemeral';
export interface EffectRootClass {
  kind: EffectRootKind;
  /** absolute realpath of the effect root as classified */
  path: string;
  /** for `governed`: the repo's common git dir; the identity a candidate shares with its parent */
  governingDir?: string;
  /** for `governed`: sha256(dirname(governingDir))[0:16] — the proposed state-root key */
  governingKey?: string;
}

export function classifyEffectRoot(root?: string): EffectRootClass {
  const effect = root || effectRoot();
  let real = effect;
  try { real = realpathSync(effect); } catch { /* lexical is fine */ }
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: real, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (common) {
      // The repo the worktree belongs to — the governed SUBJECT, shared by every candidate.
      let top = join(common, '..');
      try { top = realpathSync(top); } catch { /* keep lexical */ }
      return { kind: 'governed', path: real, governingDir: common, governingKey: sha256hex(top).slice(0, 16) };
    }
  } catch { /* not a repo — ephemeral */ }
  return { kind: 'ephemeral', path: real };
}

/** PROPOSED keying: state belongs to the governed project, not to the writing location, so a
 *  candidate worktree resolves to the SAME root as the repo it is a candidate of — which is
 *  what makes "one chain" true rather than aspirational.
 *
 *  OPT-IN and OFF BY DEFAULT (AUKORA_STATE_ROOT_BY_PROJECT=1). Switching it on re-homes the
 *  live ledger, which is an owner's act, not a coder's. An ephemeral root has no governing
 *  subject and falls back to the current behaviour, so nothing silently changes. */
export function projectStateRoot(root?: string): string {
  if (process.env.AUKORA_STATE_ROOT) return process.env.AUKORA_STATE_ROOT;
  const c = classifyEffectRoot(root);
  if (c.kind !== 'governed' || !c.governingKey) return stateRoot(root);
  return join(homedir(), '.aukora', 'membrane', 'state', 'projects', c.governingKey);
}

/** The marker written beside a state root so it can say what it serves. */
export const STATE_ROOT_MARKER = 'project';
export interface StateRootMarker {
  schema: 'aukora-state-root-marker-v1';
  effectRoot: string; kind: EffectRootKind;
  governingDir?: string; governingKey?: string;
  createdAt: string;
}

/** Ensure the state root exists and names the effect root it serves (debugging, never trust).
 *
 *  The v0 marker was one bare line and was written only by callers that happened to call
 *  ensureStateRoot — 4,782 of 4,786 measured roots had no marker at all and are therefore
 *  unattributable forever. The marker is now structured and records the classification, so a
 *  future orphan can at least say what produced it. Still `wx`: an existing marker is never
 *  rewritten, and a v0 one-line marker is left exactly as found. */
export function ensureStateRoot(root?: string): string {
  const s = stateRoot(root);
  mkdirSync(s, { recursive: true, mode: 0o700 });
  writeStateRootMarker(s, root);
  return s;
}

/** Write the marker if absent. Separated so Journal can attribute the roots it mints. */
export function writeStateRootMarker(stateRootDir: string, root?: string): void {
  const marker = join(stateRootDir, STATE_ROOT_MARKER);
  if (existsSync(marker)) return;                       // never rewrite — v0 markers stay as found
  let body: string;
  try {
    const c = classifyEffectRoot(root);
    const m: StateRootMarker = {
      schema: 'aukora-state-root-marker-v1',
      effectRoot: c.path, kind: c.kind,
      governingDir: c.governingDir, governingKey: c.governingKey,
      createdAt: new Date().toISOString(),
    };
    body = JSON.stringify(m) + '\n';
  } catch {
    body = (root || effectRoot()) + '\n';               // classification failed; the bare path still attributes it
  }
  try { writeFileSync(marker, body, { mode: 0o600, flag: 'wx' }); }
  catch { /* raced or unwritable — the caller's operations will say which */ }
}

// ── THE AUDITABLE PRIMITIVE ─────────────────────────────────────────────────
/** Census of the state-root home. Opens no database and reads no journal: it counts
 *  directories, reads markers, and tests whether the effect root each one names still
 *  exists. This is what a gate asserts on — a run that leaves behind a root whose tree is
 *  already gone raises `orphaned`, and the proof goes red. */
export interface StateRootCensus {
  home: string;
  total: number;
  /** markers present (attributable) */
  attributed: number;
  /** no marker at all — cannot ever be attributed */
  unattributed: number;
  /** marker names an effect root that no longer exists */
  orphaned: number;
  /** marker names an effect root that still exists */
  live: number;
  /** every root directory name, sorted — the set a gate diffs across a run */
  roots: string[];
}

export function stateRootCensus(home?: string): StateRootCensus {
  const dir = home || join(homedir(), '.aukora', 'membrane', 'state', 'projects');
  const out: StateRootCensus = { home: dir, total: 0, attributed: 0, unattributed: 0, orphaned: 0, live: 0, roots: [] };
  let names: string[];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names.sort()) {
    let isDir = false;
    try { isDir = statSync(join(dir, n)).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    out.total++; out.roots.push(n);
    const marker = join(dir, n, STATE_ROOT_MARKER);
    if (!existsSync(marker)) { out.unattributed++; continue; }
    out.attributed++;
    let named = '';
    try {
      const raw = readFileSync(marker, 'utf8').trim();
      named = raw.startsWith('{') ? String((JSON.parse(raw) as StateRootMarker).effectRoot || '') : raw.split('\n')[0];
    } catch { /* unreadable marker counts as attributed but unresolvable */ }
    if (named && existsSync(named)) out.live++; else out.orphaned++;
  }
  return out;
}

/** fsync a directory so a rename/write inside it is durable (the ledger's durability boundary). */
export function fsyncDir(path: string): void {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
