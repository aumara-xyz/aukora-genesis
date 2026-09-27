// φ · THE LAND ACT — shipping from inside, held to the same standing order as shipping from outside.
//
// ══ WHY THIS EXISTS ══
//
// The owner's aim is to operate this node from inside it. Measured against that, the ship button was
// the gap: `hands.commitAndPush()` ran `git add -A`, committed, and pushed straight to `origin main` —
// no branch, no PR, no gate, and no check that anything arrived. It then reported `pushed: true` on the
// strength of a process exit code.
//
// AGENTS.md requires `scripts/land.sh` for exactly this, and that script's own header records why:
//
//   "Twice in one session I pushed, saw a non-fast-forward rejection scroll past inside a chained
//    command, and opened a PR anyway — which then merged the branch's STALE content while I reported
//    success."
//
// So an agent shipping from the outside is held to gate → types → fresh branch → PR → merge → PROVE.
// An agent shipping from the inside was held to `git push` and a hope. The two are now the same act.
//
// ══ THE VERIFICATION IS STRICTER THAN land.sh's OWN, ON PURPOSE ══
//
// `land.sh` proves a path EXISTS on main: `git cat-file -e origin/main:$f`. That check would have
// PASSED in the very incident the script was written for — the file was on main, with the wrong bytes
// in it. Existence is not arrival.
//
// This compares BLOB IDENTITY: `git hash-object` of the working file against `git rev-parse
// origin/main:<path>`. Same object id or it did not land. Three states, and the middle one is the one
// that has actually bitten this repository:
//
//   landed  — the remote blob is byte-identical to the accepted file (or both sides agree it is gone)
//   stale   — the path is on main with DIFFERENT content: the merge-the-wrong-branch failure
//   absent  — the path is not on main at all: the push never arrived
//
// `landed` is derived ONLY from that comparison. The script's exit code is reported — `scriptExit`,
// `scriptOut` — and is never consulted to decide whether the work shipped, in either direction. A
// script that exits 0 having landed nothing says NOT LANDED; a script that exits 3 after the bytes
// reached main says LANDED, because refusing to see work that is already on the remote is how a round
// gets repeated on top of itself.
//
// ══ WHAT THIS DELIBERATELY DOES NOT DO ══
//
// It does not decide what is worth shipping. `paths` comes from the ledger's accepted rows and nothing
// else — an empty list is a refusal, never a licence to sweep the tree. The tree's other contents are
// reported as `unwitnessed` so the owner can see what is sitting outside the record instead of having
// it silently swept into his next commit.

import { spawn } from 'child_process';
import * as path from 'path';

/** The one process seam. Injected in tests, because the real script pushes to GitHub. */
export type LandRun = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string | undefined> },
) => Promise<{ code: number; out: string }>;

export interface LandVerdict {
  path: string;
  /** `landed` — the remote has these bytes. `stale` — it has different ones. `absent` — it has none. */
  state: 'landed' | 'stale' | 'absent';
  /** Blob id of the working file, or null when the accepted change deleted it. */
  local: string | null;
  /** Blob id on origin/main, or null when the path is not there. */
  remote: string | null;
}

export interface LandResult {
  /** True only when every accepted path is verified present on origin/main with the accepted bytes. */
  ok: boolean;
  /** The same fact, named the way the record panel says it. Never derived from an exit code. */
  landed: boolean;
  paths: string[];
  verified: LandVerdict[];
  /** origin/main after the fetch, short — what the verification was read against. */
  main?: string;
  /** Paths dirty in the tree that no accepted proposal named. Reported, never shipped. */
  unwitnessed: string[];
  error?: string;
  scriptExit?: number;
  scriptOut?: string;
}

const MAX_OUT = 60_000;

const defaultRun: LandRun = (cmd, args, opts = {}) => new Promise((resolve) => {
  const p = spawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  let out = '';
  const cap = (b: Buffer) => { if (out.length < MAX_OUT) out += b.toString(); };
  p.stdout.on('data', cap);
  p.stderr.on('data', cap);
  const timer = opts.timeoutMs
    ? setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* already dead */ } }, opts.timeoutMs)
    : null;
  p.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, out }); });
  p.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ code: -1, out: String(e?.message ?? e) }); });
});

/**
 * Every dirty path in the tree that is not in `accepted`.
 *
 * Porcelain's format is two status characters, a space, then the path — and a rename is `A -> B`, whose
 * NEW name is the one that is actually in the tree. Quoted paths (non-ASCII, spaces) come back with
 * surrounding quotes, which are stripped so the value matches what a caller would pass.
 */
function unaccountedFor(porcelain: string, accepted: Set<string>): string[] {
  const out: string[] = [];
  for (const raw of porcelain.split('\n')) {
    if (raw.length < 4) continue;
    let p = raw.slice(3).trim();
    const arrow = p.indexOf(' -> ');
    if (arrow >= 0) p = p.slice(arrow + 4);
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    if (p && !accepted.has(p)) out.push(p);
  }
  return out;
}

/**
 * Land the accepted paths, then prove it.
 *
 * `subject` is the commit subject. `paths` must be the accepted ones and only those — this function
 * refuses an empty list rather than falling back to the tree, because "there was nothing named, so I
 * took everything" is the sweep the whole act exists to remove.
 */
export async function land(opts: {
  repo: string;
  paths: string[];
  subject: string;
  run?: LandRun;
  /** The script, relative to the repo. Overridable so a test can point at a fixture. */
  script?: string;
  timeoutMs?: number;
}): Promise<LandResult> {
  const run = opts.run ?? defaultRun;
  const repo = opts.repo;
  const git = (args: string[]) => run('git', args, { cwd: repo });

  // Deduplicated and ordered, so the same path named by two accepted proposals is one proof, and the
  // list the owner reads is the list that was passed.
  const paths = [...new Set(opts.paths.filter((p) => typeof p === 'string' && p.trim()))].map((p) => p.trim());

  // `-uall`, not bare porcelain: an untracked DIRECTORY collapses to `surface/`, and "surface/ is
  // unwitnessed" names nothing the owner can accept, delete, or even find. Measured — the fixture with
  // surface/app/user/pulse.js in it reported `surface/`.
  const status = await git(['status', '--porcelain', '-uall']);
  const unwitnessed = unaccountedFor(status.out, new Set(paths));

  if (!paths.length) {
    // NOT "nothing to commit". The tree may be full of work; none of it has been accepted, and that is
    // a different sentence with a different remedy — accept it, or say out loud that it should go.
    const n = unwitnessed.length;
    return {
      ok: false,
      landed: false,
      paths,
      verified: [],
      unwitnessed,
      error: n
        ? `nothing accepted since the last commit — ${n} file(s) are in the tree with no proposal behind them: `
          + unwitnessed.slice(0, 12).join(', ') + (n > 12 ? `, +${n - 12} more` : '')
        : 'nothing accepted since the last commit, and the tree is clean',
    };
  }

  // ── the script, restricted to the accepted paths ──────────────────────────────────────────────
  //
  // Newline-separated rather than space-joined: `surface/app/user/my widget.js` is a legal path and a
  // space-joined list turns it into two.
  const script = opts.script ?? path.join('scripts', 'land.sh');
  const ran = await run('bash', [script, opts.subject, ...paths], {
    cwd: repo,
    timeoutMs: opts.timeoutMs ?? 900_000,
    env: { AUKORA_LAND_PATHS: paths.join('\n') },
  });

  // ── the proof ─────────────────────────────────────────────────────────────────────────────────
  //
  // Fetched fresh. Reading a stale remote-tracking ref would let this confirm an arrival that happened
  // in a previous round and call it this one.
  await git(['fetch', '-q', 'origin', 'main']);
  const head = await git(['rev-parse', '--short', 'origin/main']);

  const verified: LandVerdict[] = [];
  for (const p of paths) {
    // `--path` makes hash-object apply the same filters (CRLF, clean/smudge) git would apply on the
    // way in — without it a file under an `eol` attribute hashes differently here than in the commit,
    // and every landing on such a file would report `stale` forever.
    const localRes = await git(['hash-object', '--path', p, '--', p]);
    const local = localRes.code === 0 ? localRes.out.trim() || null : null;
    const remoteRes = await git(['rev-parse', `origin/main:${p}`]);
    const remote = remoteRes.code === 0 ? remoteRes.out.trim() || null : null;

    // Both gone is a landed deletion. One gone is not.
    const state: LandVerdict['state'] = local === null && remote === null ? 'landed'
      : remote === null ? 'absent'
      : local === remote ? 'landed'
      : 'stale';
    verified.push({ path: p, state, local, remote });
  }

  const bad = verified.filter((v) => v.state !== 'landed');
  const landed = bad.length === 0;

  return {
    ok: landed,
    landed,
    paths,
    verified,
    main: head.out.trim() || undefined,
    unwitnessed,
    scriptExit: ran.code,
    scriptOut: ran.out.slice(-2000),
    error: landed ? undefined
      : 'NOT LANDED — ' + bad.map((v) => `${v.path} is ${v.state} on origin/main`).join('; ')
        + (ran.code !== 0 ? ` (the landing script also exited ${ran.code})` : ' (the landing script reported success)'),
  };
}
