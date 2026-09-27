// φ — WHAT REPOSITORY IS THIS, said in a way that survives being moved, renamed, or deleted.
//
// ══ WHY THIS EXISTS ══
//
// The chain used to live at `<repo>/.aukora/chain.jsonl` — inside the very tree it governs. That was
// found by accident: reconciling the probe repository against Grok's own session stream reported twelve
// "coverage gaps" which turned out to be earlier runs whose repository had been `rm -rf`'d between
// experiments. The chain died with the repo. Grok's record, kept in the user's home directory,
// survived and remembered everything.
//
// The attack that follows is the cheapest one against this entire system: **you need not forge a chain
// when you can remove one.** An empty chain and an innocent history are indistinguishable, and the
// agent under governance can usually delete the repository it is working in.
//
// So the chain moves to `~/.aukora/chains/<identity>.jsonl`, outside every repository.
//
// ══ WHY NOT KEY IT BY PATH ══
//
// A path is a name, not an identity. `~/work/phi` and `~/AUKORA/phi-lead` can be the same repository;
// two different repositories can occupy the same path a week apart. Keying by path means a rename
// silently starts a fresh chain — which is the deletion attack again, wearing a mv.
//
// Identity is `origin URL + the first commit's SHA`, hashed. The first commit is immutable for the
// life of the project and identical in every clone; the origin distinguishes forks that share early
// history. Neither changes when the working tree moves.
//
// ══ THE HONEST FALLBACK ══
//
// A directory that is not a git repository has no such identity, and inventing one from its path would
// reintroduce exactly the problem above. Those keep an in-repo chain, and `chainHome()` says so. It is
// a real limitation, stated rather than papered over: an ungoverned scratch directory gets a deletable
// record, and a real project does not.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const git = (repoRoot, args) => {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
    }).trim();
  } catch { return ''; }
};

/**
 * The identity, computed from git and then CACHED IN THE REPO.
 *
 * The cache is a performance decision, not a trust one: the guard runs as a fresh short-lived process
 * on every single tool call, and two `git` subprocesses per call is real latency on the hot path
 * (measured: ~40ms of guard budget against Grok's 5s timeout, and a slow guard is an open guard).
 *
 * Losing the cache costs one recomputation. It is deliberately NOT authoritative — whenever git
 * answers, the identity is re-derived from origin + root commit and the cache is OVERWRITTEN without
 * ever being read, so a tampered cache cannot redirect the chain
 * to a file of the attacker's choosing.
 */
export function repoIdentity(repoRoot) {
  const origin = git(repoRoot, ['config', '--get', 'remote.origin.url']);
  const first = git(repoRoot, ['rev-list', '--max-parents=0', 'HEAD']).split('\n').pop() ?? '';

  if (!first) {
    // No git, no commits, or git unavailable. Say so rather than guessing.
    const cached = readCache(repoRoot);
    return cached ?? { id: null, source: 'none', origin: '', first: '' };
  }

  // The separator is the ESCAPE `\u0000`, never a literal NUL byte. A literal one makes this file
  // BINARY to grep, which then reports nothing and exits 0 in silence — so every repo-wide source
  // sweep skips the file without saying it did. Measured in `core/forge/ledger.ts`, which carried the
  // same separator and was invisible to the audits hunting a real bug inside it. The hashed bytes are
  // identical, so every existing repoId is unchanged.
  const id = createHash('sha256').update(`${origin}\u0000${first}`).digest('hex').slice(0, 32);
  const ident = { id, source: origin ? 'origin+root-commit' : 'root-commit', origin, first };
  writeCache(repoRoot, ident);
  return ident;
}

function cachePath(repoRoot) { return join(repoRoot, '.aukora', 'identity.json'); }

function readCache(repoRoot) {
  try {
    const c = JSON.parse(readFileSync(cachePath(repoRoot), 'utf8'));
    return typeof c?.id === 'string' && c.id ? c : null;
  } catch { return null; }
}

function writeCache(repoRoot, ident) {
  try {
    mkdirSync(dirname(cachePath(repoRoot)), { recursive: true });
    writeFileSync(cachePath(repoRoot), JSON.stringify(ident), 'utf8');
  } catch { /* a cache that cannot be written is a slower guard, not a broken one */ }
}

/** Where chains live when they live outside a repository. */
export function chainsDir(home = homedir()) { return join(home, '.aukora', 'chains'); }

/**
 * The chain's home for this repository, and WHY it is there — the caller shows the reason to the owner
 * rather than silently doing something surprising with their record.
 *
 * `AUKORA_CHAIN_HOME` overrides everything, so tests can point somewhere disposable without reaching
 * into the real home directory.
 */
export function chainHome(repoRoot, { home = homedir(), env = process.env, carry = true } = {}) {
  // THE CARRY LIVES HERE, in the one funnel every consumer already passes through.
  //
  // It was in `append` first, which meant only the WRITE path migrated: `verify`, `log` and the
  // checkpoint emitter each read the new, empty location while a full legacy chain sat in the tree.
  // Found by using the tool — emitting a checkpoint for this repository reported `count: 0` next to a
  // 24-entry file. A record that reads as empty is the §10 failure with nobody attacking it.
  //
  // Then it moved to `chainPath` in chain.mjs, which fixed that path and missed `checkpoint.ts`,
  // because that script resolves through `chainHome` directly. Two misses in a row is the signal that
  // the carry does not belong at call sites at all.
  if (carry) ensureCarried(repoRoot, home, env);

  const override = env.AUKORA_CHAIN_HOME;
  if (override) {
    return { file: join(override, `${repoIdentity(repoRoot).id ?? 'unidentified'}.jsonl`), why: 'AUKORA_CHAIN_HOME', outside: true };
  }
  const ident = repoIdentity(repoRoot);
  if (!ident.id) {
    return {
      file: join(repoRoot, '.aukora', 'chain.jsonl'),
      why: 'not a git repository — no identity that survives a rename, so the chain stays in the tree',
      outside: false,
    };
  }
  return { file: join(chainsDir(home), `${ident.id}.jsonl`), why: ident.source, outside: true };
}

/** Once per repository per process. `chainHome` funnels here; call sites do not. */
const carried = new Set();
function ensureCarried(repoRoot, home, env) {
  if (carried.has(repoRoot)) return;
  carried.add(repoRoot);
  try { migrateIfNeeded(repoRoot, home, env); } catch { /* a chain that cannot be carried still appends */ }
}

/**
 * Carry an existing in-repo chain to its new home, once.
 *
 * Copy rather than move, and never overwrite: two chains for one repository is a merge nobody can
 * perform — a hash chain has one predecessor per entry, so interleaving them produces a file where
 * every entry after the join fails its own `prev`. If a home chain already exists, the in-repo file is
 * left alone for a human to look at.
 */
export function migrateIfNeeded(repoRoot, home = homedir(), env = process.env) {
  // `carry: false` — resolving the destination must not recurse back into the carry that called us.
  const dest = chainHome(repoRoot, { home, env, carry: false });
  if (!dest.outside) return { migrated: false, why: 'chain stays in the tree' };
  const legacy = join(repoRoot, '.aukora', 'chain.jsonl');
  if (!existsSync(legacy)) return { migrated: false, why: 'nothing to carry' };
  if (existsSync(dest.file)) return { migrated: false, why: 'a chain already lives at the destination — left both in place' };
  try {
    mkdirSync(dirname(dest.file), { recursive: true });
    writeFileSync(dest.file, readFileSync(legacy, 'utf8'));
    return { migrated: true, from: legacy, to: dest.file };
  } catch (e) {
    return { migrated: false, why: `could not carry the chain: ${e?.message ?? 'unknown'}` };
  }
}
