// Aukora Spatial — HER HANDS ON THE MACHINE: read, run, ship, restart.
//
// ══ WHY ══
//
// The owner's instruction: "pretend I can never use Claude Code again and only need to use her."
// Measured against that, she could CHANGE the repository and nothing else. She could not read it, so a
// question about her own code was answered from memory. She could not run the tests, so "does this
// work" was a guess. She could not commit or push, so accepted changes sat in a working tree forever.
// And a server-lane change needed the owner to go to a terminal — which is the one thing he said he
// would not have.
//
// ══ THE SHAPE ══
//
// Three tiers, and the tier is decided by EFFECT, not by how dangerous the word sounds:
//
//   READ    — search, read a file, list, git status/diff/log. Changes nothing. No gate beyond standing.
//   RUN     — the test suite, the typechecker. Spends time and CPU, changes no file. No gate.
//   ACT     — commit, push, restart the node. These change the world outside this process, so each one
//             is a PROPOSAL the owner accepts, exactly like an edit. Approve is the gate; it is the
//             only gate; and it is the same gate for everything.
//
// Everything here still sits behind the standing seam (spatial/standing.ts) — a courtyard node cannot
// reach any of it, including the reads, because a stranger's node has no business enumerating the
// owner's repository.
//
// ══ WHAT IS DELIBERATELY NOT HERE ══
//
// An arbitrary shell. She names an INTENT from a closed set and this file composes the command; she
// never supplies a command string. That is the same invariant that makes the forge safe to hand her —
// the model never composes the thing that executes — and it is the reason this file is a list of
// functions rather than one `run(cmd)`.

import { spawn } from 'child_process';
import * as path from 'path';
import { readFile, readdir, stat } from 'fs/promises';

import { land, type LandRun, type LandResult } from './land';

/**
 * The repository root, read LIVE on every call.
 *
 * The donor captured this in a `const` at module load, which meant the value was frozen to whatever
 * the environment said the first time the file was imported — so a test could not point the module at
 * a fresh directory without tearing down the module cache, and that is exactly why its suite reached
 * for `vi.resetModules()`. Reading it per call follows the rule `standing.ts` already states: a seam
 * no test can exercise is a seam nobody can trust.
 */
function repoRoot(): string {
  const bunDir = (import.meta as unknown as { dir?: string }).dir;
  return process.env.AUKORA_FORGE_REPO
    ?? (bunDir ? path.resolve(bunDir, '..', '..')
               : path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'));
}

const MAX_OUT = 60_000;

function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: opts.cwd ?? repoRoot() });
    // ══ THE STREAMS ARE KEPT APART ══
    //
    // Both were appended to one string, so a git error message became the CONTENT of a search result or
    // a diff — and callers returned `ok: true` around it. `out` is what the command produced; `err` is
    // what went wrong. A caller that wants both can join them; a caller that wants neither confused
    // could not previously tell them apart.
    let out = '';
    let err = '';
    const cap = (b: Buffer) => { if (out.length < MAX_OUT) out += b.toString(); };
    const capErr = (b: Buffer) => { if (err.length < MAX_OUT) err += b.toString(); };
    p.stdout.on('data', cap);
    p.stderr.on('data', capErr);
    const t = opts.timeoutMs ? setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* gone */ } }, opts.timeoutMs) : null;
    p.on('close', (code) => { if (t) clearTimeout(t); resolve({ code: code ?? -1, out, err }); });
    p.on('error', (e) => { if (t) clearTimeout(t); resolve({ code: -1, out: '', err: String(e) }); });
  });
}

/** Every path she names is resolved and checked. A read is still a way out of the repository. */
function inside(rel: string): string | null {
  const clean = String(rel ?? '').trim();
  if (!clean || clean.startsWith('/') || clean.includes('..')) return null;
  const abs = path.resolve(repoRoot(), clean);
  return abs.startsWith(repoRoot() + path.sep) ? abs : null;
}

// The keys never leave the machine and she has no reason to read them. Refused before the filesystem
// is touched, so a refusal cannot be distinguished from a miss by timing.
//
// THE FIRST VERSION LEAKED .env. It was written as `(^|/)(\.env|…)/` — a trailing slash — which
// matches `.env/` as a DIRECTORY and never `.env` as a file. The file holding the OpenRouter key was
// readable by name, and it took a test to find it because a regex that is nearly right looks exactly
// like one that is right. Each alternative below now says explicitly whether it ends a path or leads
// into one.
const SECRET = new RegExp([
  '(^|/)\\.env(\\.[^/]*)?$',        // .env, .env.local — the file, not a folder
  '(^|/)\\.aukora-symbiote(/|$)',
  '(^|/)authority(/|$)',
  '(^|/)\\.ssh(/|$)',
  'aumlok',
  'authority-(ed25519|mldsa65)',
  '\\.(key|pem|p12|pfx)$',
  'id_(rsa|ed25519)',
  'secrets?\\.json$',
].join('|'), 'i');

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------

export async function readRepoFile(rel: string): Promise<{ ok: boolean; path?: string; text?: string; error?: string }> {
  const abs = inside(rel);
  if (!abs) return { ok: false, error: 'path_outside_repo' };
  if (SECRET.test(rel)) return { ok: false, error: 'refused: custody material is not readable from here' };
  try {
    const s = await stat(abs);
    if (s.isDirectory()) {
      const names = await readdir(abs);
      return { ok: true, path: rel, text: names.slice(0, 400).join('\n') };
    }
    if (s.size > 400_000) return { ok: false, error: `file_too_large (${Math.round(s.size / 1024)}kb)` };
    return { ok: true, path: rel, text: (await readFile(abs, 'utf8')).slice(0, MAX_OUT) };
  } catch { return { ok: false, error: 'not_found' }; }
}

/** Search the repository. ripgrep if present, git grep otherwise — both respect .gitignore. */
export async function searchRepo(query: string): Promise<{ ok: boolean; hits?: string; error?: string }> {
  const q = String(query ?? '').trim().slice(0, 200);
  if (!q) return { ok: false, error: 'nothing to search for' };
  // -F: her query is a phrase from a conversation, not a regex she wrote. Treating it as a pattern
  // turns a stray bracket into a syntax error she cannot see or fix.
  let r = await run('rg', ['-n', '-F', '--max-count', '4', '--max-columns', '200', '-g', '!node_modules', q], { timeoutMs: 20_000 });
  if (r.code === -1) r = await run('git', ['grep', '-n', '-F', '--', q], { timeoutMs: 20_000 });
  // Same rule as `repoDiff`. grep answers 1 for "no matches", which is not a failure — anything above
  // that is the tool refusing to have looked, and "(no matches)" would be a claim about the repository
  // made from an error message.
  if (r.code > 1) return { ok: false, error: `search exited ${r.code}: ${r.err.trim().slice(0, 400) || 'no detail'}` };
  const lines = r.out.split('\n').filter((l) => l.trim() && !SECRET.test(l)).slice(0, 120);
  return { ok: true, hits: lines.join('\n') || '(no matches)' };
}

export async function repoStatus(): Promise<{ ok: true; branch: string; head: string; dirty: string; log: string }> {
  const [b, h, s, l] = await Promise.all([
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    run('git', ['rev-parse', '--short', 'HEAD']),
    run('git', ['status', '--porcelain']),
    run('git', ['log', '--oneline', '-8']),
  ]);
  return { ok: true, branch: b.out.trim(), head: h.out.trim(), dirty: s.out.trim() || '(clean)', log: l.out.trim() };
}

export async function repoDiff(rel?: string): Promise<{ ok: boolean; diff?: string; error?: string }> {
  const args = ['--no-pager', 'diff'];
  if (rel) { const abs = inside(rel); if (!abs) return { ok: false, error: 'path_outside_repo' }; args.push('--', rel); }
  const r = await run('git', args, { timeoutMs: 20_000 });
  // ══ A FAILED COMMAND IS NOT AN EMPTY DIFF ══
  //
  // This returned `ok: true` whatever the child did. Outside a repository, or with a bad argument,
  // `git diff` exits nonzero and prints nothing to stdout — and that came back as
  // `{ ok: true, diff: '(no uncommitted changes)' }`. An error rendered as a clean tree, in the verb
  // she uses to decide whether there is anything to ship.
  if (r.code !== 0) return { ok: false, error: `git diff exited ${r.code}: ${r.err.trim().slice(0, 400) || 'no detail'}` };
  return { ok: true, diff: r.out.slice(0, MAX_OUT) || '(no uncommitted changes)' };
}

// ---------------------------------------------------------------------------
// RUN — time and CPU, no files
// ---------------------------------------------------------------------------

export async function runTests(scope?: string): Promise<{ ok: boolean; passed: boolean; summary: string; detail: string }> {
  // φ RUNS ITS OWN GATE, not the donor's. This called `bunx vitest` inside `core/` — a path that
  // exists in the repository this was transplanted from and not in this one, so every attempt she made
  // to check her own work returned "the runner produced no result". A tool that silently answers
  // nothing is worse than one that is absent: absent, she says she cannot; silent, she guesses.
  const args = scope ? ['test', scope] : ['run', 'scripts/gate.ts'];
  const r = await run('bun', args, { cwd: repoRoot(), timeoutMs: 420_000 });
  const m = /(\d+)\s+pass/.exec(r.out);
  const f = /(\d+)\s+fail/.exec(r.out);
  const passed = m ? Number(m[1]) : 0;
  const failed = f ? Number(f[1]) : 0;
  const open = /GATE OPEN/.test(r.out);
  return {
    ok: true,
    passed: r.code === 0 && failed === 0,
    summary: m ? `${passed} passing${failed ? `, ${failed} FAILING` : ''}${open ? ' \u00b7 gate open' : ''}`
               : 'the runner produced no result',
    detail: r.out.slice(-3000),
  };
}

export async function runTypecheck(): Promise<{ ok: boolean; passed: boolean; detail: string }> {
  // One tsconfig at the root — phi is one tree, not a workspace tangle.
  const r = await run('bunx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], { cwd: repoRoot(), timeoutMs: 240_000 });
  const noise = /^(Resolving|Resolved|Saved)/;
  const lines = r.out.split('\n').filter((l) => l.trim() && !noise.test(l));
  return { ok: true, passed: r.code === 0 && !lines.length, detail: lines.join('\n').slice(0, 4000) || 'clean' };
}

// ---------------------------------------------------------------------------
// ACT — changes the world outside this process, so each one is proposed
// ---------------------------------------------------------------------------

export interface ActProposal { id: string; kind: 'commit' | 'push' | 'restart' | 'command'; summary: string; detail: string; payload: unknown }

const acts = new Map<string, ActProposal>();

/** See review.ts — the store is module-level, so the reset is declared rather than smuggled. */
export function __resetForTests(): void { acts.clear(); }
const ACT_CAP = 8;

function propose(kind: ActProposal['kind'], summary: string, detail: string, payload: unknown): ActProposal {
  const p: ActProposal = { id: 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6), kind, summary, detail, payload };
  acts.set(p.id, p);
  while (acts.size > ACT_CAP) { const k = [...acts.keys()][0]; if (k === undefined) break; acts.delete(k); }
  return p;
}

/** What a commit WOULD do — the files and the message — without doing it. */
export async function proposeCommit(message: string): Promise<{ ok: boolean; act?: ActProposal; error?: string }> {
  const msg = String(message ?? '').trim().slice(0, 500);
  if (msg.length < 8) return { ok: false, error: 'a commit needs a real message' };
  const s = await run('git', ['status', '--porcelain']);
  const files = s.out.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!files.length) return { ok: false, error: 'nothing to commit — the tree is clean' };
  const stat = await run('git', ['--no-pager', 'diff', '--stat']);
  return { ok: true, act: propose('commit', `commit ${files.length} file(s)`,
    `${msg}\n\n${stat.out.slice(0, 3000)}\n${files.join('\n')}`, { message: msg }) };
}

export async function proposePush(): Promise<{ ok: boolean; act?: ActProposal; error?: string }> {
  const [b, ahead] = await Promise.all([
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    run('git', ['log', '--oneline', '@{u}..HEAD']),
  ]);
  const branch = b.out.trim();
  const commits = ahead.out.split('\n').filter(Boolean);
  if (!commits.length) return { ok: false, error: 'nothing to push — the branch is up to date' };
  return { ok: true, act: propose('push', `push ${commits.length} commit(s) to ${branch}`,
    commits.join('\n'), { branch }) };
}

/**
 * Ship, from the record panel's button — THE LAND ACT.
 *
 * The owner's click on that button IS the authorization — not a proposal he then accepts again. Accept
 * on a forge card never reaches here; this never runs without the ship button.
 *
 * ══ WHAT THIS USED TO BE, AND WHY IT COULD NOT STAY ══
 *
 * `git add -A` → `git commit` → `git push origin main` → `return { pushed: push.code === 0 }`.
 *
 * Three defects, and the third is the one nobody could see from inside:
 *
 *   1 · `git add -A` sweeps the whole tree. MEASURED in the owner's own checkout when this round
 *       opened: four untracked files and one uncommitted edit, none from any accepted proposal. The
 *       ledger was consulted only to WRITE THE MESSAGE — never to decide what was staged, so the
 *       message named the accepted work while the commit carried everything.
 *   2 · No gate, no types, no branch, no PR. AGENTS.md requires `scripts/land.sh` for exactly this,
 *       and `core/forge/crush.ts`'s header already records the cost: a red main that arrived through
 *       φ's own accept button, "the governance app's own accept path is exempt from the discipline it
 *       demands of every agent."
 *   3 · `git push origin main` is a REFSPEC, not HEAD. From any branch that is not `main` — every
 *       worktree, every lane — it pushes the local `main` ref, which does not contain the commit just
 *       made. It exits 0 saying "Everything up-to-date", this returned `pushed: true`, and
 *       `surface/app/record.js` painted "pushed to origin main" over a remote that had nothing.
 *       Reproduced against a real bare remote in test/land-act.test.ts.
 *
 * So the ship button now runs the same act an agent outside runs: gate → types → fresh branch → PR →
 * merge → PROVE, restricted to the accepted paths, and the answer it reports is the blob comparison
 * against origin/main. `landed` is that comparison and nothing else. A round that "succeeded" and did
 * not land says so.
 *
 * `deps.run` exists because the real script pushes to GitHub, and a seam no test can exercise is a
 * seam nobody can trust — the rule `standing.ts` states and `repoRoot()` above already follows.
 */
export async function commitAndPush(deps: { run?: LandRun } = {}): Promise<LandResult & {
  /** origin/main after the landing, short. Named `sha` because that is what the panel has always shown. */
  sha?: string;
  message?: string;
}> {
  const repo = repoRoot();
  const { message, paths } = await acceptedSinceHead();

  const out = await land({
    repo,
    paths,
    subject: `${message}\n\nCo-Authored-By: Auma <auma@aukora.local>`,
    run: deps.run,
  });

  // ══ AND THE ROUND REMEMBERS WHETHER IT LANDED ══
  //
  // The fact she named as missing and could not get anywhere else: "not whether it landed". The land
  // act has just computed it — per path, against origin/main — and this is the only place that answer
  // exists before it is rendered and thrown away.
  //
  // `paths` doubles as the round id here because a landing is not a proposal: it is the act of
  // shipping whatever was accepted, and it may cover several. The most recent proposal is the one the
  // block will be about, which is the one she is iterating on.
  try {
    const mem = await import('../../surface/round-memory');
    const { readRounds } = mem;
    const read = await readRounds();
    const id = read.ok && read.rounds[0] ? read.rounds[0].id : `land_${Date.now().toString(36)}`;
    await mem.noteLanded({
      id,
      landed: out.landed,
      verified: out.verified.map((v) => ({ path: v.path, state: v.state })),
      ...(out.main ? { main: out.main } : {}),
    });
  } catch { /* a landing that cannot be remembered still landed */ }

  return { ...out, sha: out.main, message };
}

/**
 * Subject line + body from accepted proposals since the last commit.
 *
 * The ledger is content-free (files, not instructions), so the message names the files each accept
 * touched. Rolled-back accepts are dropped. With no accepts since HEAD, the dirty paths themselves
 * become the body — something is still committed; the message just has less to work with.
 */
async function acceptedSinceHead(): Promise<{ message: string; paths: string[] }> {
  // Committer date as epoch ms — string-compare on %cI fails across offsets (Z vs +08:00), and that
  // quietly dropped every accept on a machine whose git does not write UTC.
  const headRaw = (await run('git', ['log', '-1', '--format=%ct'])).out.trim();
  const headMs = headRaw ? Number(headRaw) * 1000 : 0;
  let rows: Array<{ kind?: string; id?: string; files?: string[]; at?: string }> = [];
  try {
    const review = await import('./review');
    rows = (await review.receipts(200)) as typeof rows;
  } catch { /* no ledger is not a reason to refuse a commit */ }

  const rolled = new Set(rows.filter((r) => r.kind === 'rolled-back' && r.id).map((r) => r.id as string));
  const accepted = rows.filter((r) => {
    if (r.kind !== 'applied' || !r.id || rolled.has(r.id)) return false;
    if (headMs && r.at) {
      const t = Date.parse(r.at);
      if (Number.isFinite(t) && t <= headMs) return false;
    }
    return true;
  });

  if (accepted.length) {
    const lines = accepted.map((r) => {
      const files = Array.isArray(r.files) ? r.files.filter(Boolean) : [];
      return files.length ? files.join(', ') : '(no files named)';
    });
    const unique = [...new Set(lines)];
    const subject = accepted.length === 1
      ? `surface: accept ${unique[0]!.slice(0, 60)}`
      : `surface: ${accepted.length} accepted proposals`;
    // THE PATHS, not just the sentence. The ledger has always known exactly which files each accept
    // touched; the old shipping path read it to write the commit MESSAGE and then staged the whole
    // tree anyway, so the message named the accepted work while the commit carried whatever else was
    // lying around. Same rows, now load-bearing.
    //
    // ` (new)` is crush's marker for a file the round created — it is a note about the change, not
    // part of the name, and `origin/main:surface/app/x.js (new)` resolves to nothing at all.
    const paths = [...new Set(accepted.flatMap((r) => (Array.isArray(r.files) ? r.files : [])
      .filter((f): f is string => typeof f === 'string' && !!f.trim())
      .map((f) => f.replace(/ \(new\)$/, '').trim())))];
    return { message: `${subject}\n\n${unique.map((l) => `- ${l}`).join('\n')}`.slice(0, 500), paths };
  }

  // NO FALLBACK TO THE DIRTY TREE. It used to return one — "surface: uncommitted work" over whatever
  // `git status` listed — and that is the sweep with a caption. Nothing accepted means nothing to
  // ship; `land()` turns the empty list into a refusal that NAMES what is sitting there unwitnessed,
  // which is the sentence the owner can actually act on.
  return { message: 'surface: nothing accepted since the last commit', paths: [] };
}

/**
 * ANY command, proposed.
 *
 * The closed set above covers what she needs most days, and a closed set is the right default. But the
 * owner's ruling is that nothing may be structurally out of reach: "literally anything that is blocking
 * can be requested by me to fix by her directly." A capability list that cannot grow is a list of the
 * things this app will never be able to do, and he would have to open a terminal to get past it — the
 * one thing he said he would not do.
 *
 * So: she may propose any command, and it runs only on his click. That is the same gate as an edit,
 * and it is the honest place for the gate to be — the danger was never in her naming a command, it was
 * in a command running without him seeing it. He sees the exact argv before anything happens.
 *
 * Still refused outright: anything reaching for custody material. Those keys are not the owner's to
 * hand over by a click, because losing them is not undoable by any button in this app.
 */
// The same set, plus the shapes a command could use to reach it that a path check would not see.
const CUSTODY = new RegExp([
  'aumlok', 'authority-(ed25519|mldsa65)', '\\.aukora-symbiote', 'id_(rsa|ed25519)',
  '\\.ssh', 'keychain', '(^|[\\s/])\\.env(\\.[^\\s/]*)?([\\s]|$)', '\\.(key|pem|p12|pfx)([\\s]|$)',
  '(^|[\\s/])authority(/|[\\s]|$)',
].join('|'), 'i');

export function proposeCommand(cmd: string, args: string[], why: string): { ok: boolean; act?: ActProposal; error?: string } {
  const c = String(cmd ?? '').trim();
  if (!c || /[;&|`$><\n]/.test(c)) return { ok: false, error: 'refused: a command is a program name, not a shell line' };
  const list = (Array.isArray(args) ? args : []).map((a) => String(a)).slice(0, 40);
  const whole = [c, ...list].join(' ');
  if (CUSTODY.test(whole)) return { ok: false, error: 'refused: custody material is never reachable from here, with or without a click' };
  if (whole.length > 800) return { ok: false, error: 'refused: that command is too long to read before approving' };
  return { ok: true, act: propose('command', `run: ${whole.slice(0, 120)}`,
    `${String(why ?? '').slice(0, 300)}\n\n$ ${whole}\n\nRuns in ${repoRoot()}. Nothing happens until you accept.`,
    { cmd: c, args: list }) };
}

export function proposeRestart(why: string): ActProposal {
  return propose('restart', 'restart the node',
    `${String(why ?? 'a server lane changed').slice(0, 200)}\n\nThe app will go down for a few seconds and come back on the same ports. `
    + 'If the new code does not boot, the last working version is restored automatically and it comes back anyway.',
    { why });
}

export function getAct(id: string): ActProposal | undefined { return acts.get(id); }

/** Carry out an act the owner has accepted. Nothing here runs without an id he approved. */
export async function doAct(id: string): Promise<{ ok: boolean; result?: string; error?: string }> {
  const a = acts.get(id);
  if (!a) return { ok: false, error: 'act_unknown_or_expired' };
  acts.delete(id);

  if (a.kind === 'commit') {
    const msg = (a.payload as { message: string }).message;
    const add = await run('git', ['add', '-A']);
    if (add.code !== 0) return { ok: false, error: add.out.slice(-400) };
    // The trailer the house uses on everything she writes, so authorship is never ambiguous later.
    const full = `${msg}\n\nCo-Authored-By: Auma <auma@aukora.local>`;
    const c = await run('git', ['commit', '-q', '-m', full], { timeoutMs: 60_000 });
    if (c.code !== 0) return { ok: false, error: c.out.slice(-600) };
    const h = await run('git', ['rev-parse', '--short', 'HEAD']);
    return { ok: true, result: `committed ${h.out.trim()}` };
  }

  if (a.kind === 'push') {
    const branch = (a.payload as { branch: string }).branch;
    const r = await run('git', ['push', '-q', 'origin', branch], { timeoutMs: 180_000 });
    return r.code === 0 ? { ok: true, result: `pushed to ${branch}` } : { ok: false, error: r.out.slice(-600) };
  }

  if (a.kind === 'command') {
    const { cmd, args } = a.payload as { cmd: string; args: string[] };
    const r = await run(cmd, args, { timeoutMs: 600_000 });
    return { ok: r.code === 0, result: (r.out || '(no output)').slice(-6000), error: r.code === 0 ? undefined : `exit ${r.code}\n${r.out.slice(-3000)}` };
  }

  // RESTART. The door cannot restart itself from inside its own process, so it asks the supervisor
  // that started it to do it — see scripts/start.ts. If nothing is supervising, say so plainly
  // rather than exiting and leaving the owner with a dead app and no terminal.
  if (a.kind === 'restart') {
    return scheduleRestart((a.payload as { why?: string })?.why || 'a server lane changed');
  }

  return { ok: false, error: 'unknown act' };
}

/**
 * Exit 75 so the supervisor brings the door back with fresh code.
 *
 * Shared by the restart act and by apply of a server-lane change: accepting surface/*.ts, anything
 * under core/, or scripts/*.ts without this left the process running the old bytes while the page
 * reloaded and claimed the change was live.
 */
export async function scheduleRestart(why: string): Promise<{ ok: boolean; result?: string; error?: string }> {
  if (!process.env.AUKORA_SUPERVISED) {
    return { ok: false, error: 'this node was not started by the supervisor, so it cannot restart itself — start it with `bun run start`' };
  }
  // ARM THE NET FIRST. A server change that parses but does not boot leaves no door, and with no
  // door there is no her and no way to undo it. Remember the state that was known to work; the
  // supervisor restores it if the new one never answers.
  try {
    const review = await import('./review');
    const files = review.lastAppliedSnapshot();
    if (files?.length) {
      const dead = await import('./deadDoor');
      await dead.armWatch({ at: new Date().toISOString(), why: why || 'a server lane changed', files });
    }
  } catch { /* an unarmed net still restarts; it simply cannot self-heal, and the log says so */ }
  setTimeout(() => process.exit(75), 350);   // 75 = EX_TEMPFAIL: the supervisor's signal to bring it back
  return { ok: true, result: 'restarting — the app will come back on its own in a few seconds' };
}
