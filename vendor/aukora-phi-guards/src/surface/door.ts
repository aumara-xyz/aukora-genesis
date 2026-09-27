// φ — THE DOOR. Everything the surface can reach, and nothing else.
//
// The donor's door was ~1,400 lines across sixteen imports and served a voice sidecar, a fusion
// council, a memory brain and several organs φ does not have. This is the same shape with only the
// routes φ needs, so the whole surface area of the system is one file a person can read in a sitting.
// That readability IS a security property: nobody audits what they cannot hold in their head.
//
// ══ THE ONE RULE, ENFORCED IN ONE PLACE ══
//
// Every route that changes anything asks `requestAction` FIRST — before the body is even read, so a
// caller without standing cannot learn about the door by varying what it sends. Read routes ask too:
// a stranger's node has no business enumerating the owner's repository.

import { requestAction, standingReport } from '../core/authority/standing';
import * as voice from '../core/forge/voice';
import { presenceStream, resetPresence, MINDS, DEFAULT_MIND, modelFor, providerFor, providerForModel, crushModelFor } from './presence';
import { keyStatus, keyReport } from './key';
import { grokAuthStatus, grokDefaultModel } from './grokAuth';
import {
  authRequired, sessionFromRequest, createMagicLink, consumeMagicToken,
  destroySession, setSessionCookie, clearSessionCookie, requestIsSecure,
} from './auth';
import { join, extname, normalize } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'; import { MAX_REVIEWABLE_CHARS } from '../core/forge/renderDiff';

// `let`, not `const`: `AUKORA_PORT=0` asks Bun.serve to bind an OS-assigned ephemeral port (used by the
// live-door test suites so two doors spawned around the same moment can never collide on a guessed
// number — see test/engines.test.ts, test/sight.test.ts, test/repair.test.ts). The value below is only
// the REQUESTED port; both `ORIGINS` and the startup log are re-derived from `server.port`, the port
// Bun actually bound, once `Bun.serve` returns. Printing the requested `0` instead would tell a test
// harness reading this door's stdout to connect to a port nothing is listening on.
let PORT = Number(process.env.AUKORA_PORT ?? 7400);
/** Loopback by default. `AUKORA_HOST=0.0.0.0` for hosted / Build preview. */
const HOST = process.env.AUKORA_HOST ?? '127.0.0.1';
/** Behind a trusted reverse proxy — relaxes same-origin POST fence. See docs/HOSTED.md. */
const HOSTED = process.env.AUKORA_HOSTED === '1';
const APP = new URL('./app/', import.meta.url).pathname;
/**
 * This repository, for the routes that need to name it rather than serve out of it.
 *
 * `AUKORA_FORGE_REPO` first, matching `core/forge/review.ts` and `core/forge/crush.ts` exactly — a test
 * that points those two at a scratch tree and this one at the real repository would have the council
 * convene against the developer's actual checkout while the forge worked somewhere else.
 */
const ROOT = process.env.AUKORA_FORGE_REPO ?? new URL('../', import.meta.url).pathname;
let ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

/**
 * ONE FORGE ROUND AT A TIME, on this process.
 *
 * The browser already refuses a second send in the same tab (`startForge` / `forging`). That flag is
 * per-tab memory — a second tab, a reload that races the still-running first round, or a bare curl
 * never sees it. MEASURED in `docs/EXPECTATIONS.md` #3: two concurrent rounds clear the same
 * module-global pre-run snapshot and can destroy uncommitted work with no receipt of what was lost.
 *
 * The lock is process-local on purpose. φ is one door on one machine; a second process is a different
 * threat (LIMITS §8) and is not solved by a boolean here. Check-and-set is synchronous — no `await`
 * between the read and the write — so two handlers cannot both pass in the same turn of the event loop.
 */
let forgeRoundLive = false;

/** Named refusal when a second write-round arrives while one is still on the tree. */
function roundInFlight(): Response {
  return json({
    ok: false,
    error: 'round_in_flight',
    class: 'round_in_flight',
    reason: 'a forge round is already live; two at once would edit the same working tree',
  }, 409);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * A browser POST must come from this app.
 *
 * Not authentication — it is a same-origin gesture fence, and calling it anything stronger would be
 * the kind of overclaim this repository exists to avoid. `curl` has no Origin and is allowed through
 * deliberately: the owner's own terminal is not the threat model, another page in his browser is.
 */
/** Wire-safe proposal: full before/after stays in-memory for apply; the glass only needs the card. */
function slimProposal(p: {
  id: string; at: number; files?: { path: string; before: string | null; after: string }[];
  patch: string; changed: string[]; diffstat: string; digest: string; proposalHash: string; tests: unknown; ms: unknown;
}) {
  return {
    id: p.id,
    at: p.at,
    changed: p.changed,
    diffstat: p.diffstat,
    digest: p.digest, proposalHash: p.proposalHash,   // byte binding — core/forge/proposalHash.ts
    tests: p.tests,
    ms: p.ms,
    // Cap so SSE never freezes the browser on a full-file rewrite — `MAX_REVIEWABLE_CHARS` (renderDiff.ts) is what capture() already refuses a proposal past, so this can never cut a LIVE one; see that constant's own doc.
    patch: String(p.patch || '').slice(0, MAX_REVIEWABLE_CHARS),
    files: (p.files || []).map((f) => ({
      path: f.path,
      before: null as string | null,
      after: '',
    })),
  };
}

function requireSession(req: Request): { ok: true; email: string } | { ok: false; response: Response } {
  if (!authRequired()) return { ok: true, email: 'local' };
  const s = sessionFromRequest(req);
  if (!s) {
    return {
      ok: false,
      response: json({ ok: false, error: 'sign_in_required', reason: 'Sign in with your email to use this node.' }, 401),
    };
  }
  return { ok: true, email: s.email };
}

function localPost(req: Request): { ok: true } | { ok: false; why: string } {
  const origin = req.headers.get('origin');
  if (!origin) return { ok: true };
  if (HOSTED) return { ok: true };
  if (ORIGINS.has(origin)) return { ok: true };
  try {
    const o = new URL(origin);
    const host = req.headers.get('host');
    if (host && o.host === host) return { ok: true };
  } catch { /* malformed origin → refuse */ }
  return { ok: false, why: `origin ${origin}` };
}

/**
 * The same check for a route that WRITES OR SPENDS, minus `localPost`'s `if (!origin) return ok`.
 *
 * Measured before the change: `POST /api/absorb` with NO Origin answered 400 (past the guard) while a
 * foreign Origin answered 403 — the weaker caller was the one getting through. A second check, never
 * an identity; that is what `requireSession` and `requestAction` are for.
 * Full measurement and controls: `test/door-write-guards.test.ts`.
 */
function sensitivePost(req: Request): { ok: true } | { ok: false; why: string } {
  if (!req.headers.get('origin')) {
    return { ok: false, why: 'no Origin header — this route is reached from the glass, not from a script' };
  }
  return localPost(req);
}

/**
 * The instruction the engine actually receives, once the rounds before it are folded in.
 *
 * ONE FUNCTION FOR BOTH FORGE ROUTES, for the reason `pickEngine` already exists: the two routes had
 * drifted into two copies of the same guess once, and a third caller would have made three. `prior` is
 * OPTIONAL on both — a body without it composes to exactly the string that was sent, so every existing
 * caller and every test that posts a bare `{ instruction }` is untouched.
 *
 * Where the door still holds a proposal it prefers its own copy of that diff over the browser's echo of
 * it. It cannot always: `review.apply` moves a proposal out of the undecided store, and "that's wrong"
 * usually arrives right after an accept — which is exactly when the lookup misses. So this is a
 * correction where one is available, never a guarantee, and it is not dressed as one.
 */
async function repairBrief(instruction: string, prior: unknown): Promise<string> {
  const { readPrior, withHeldDiffs, composeBrief } = await import('./repair');
  const rounds = readPrior(prior);
  if (!rounds.length) return instruction;
  const review = await import('../core/forge/review');
  return composeBrief(instruction, withHeldDiffs(rounds, (id) => review.getProposal(id)));
}

/**
 * The turn kind the surface reported — VALIDATED, never believed.
 *
 * `lane` has been on the wire since composer-routing landed and the door read it nowhere, so
 * `BRIEF_FOR` — written and exported for exactly this — was called by nothing and every round, question
 * or not, was framed as "make the smallest change that actually works". That is the 139-second markdown
 * dump its own header records. Anything unrecognised is `build`, which is what the door did before.
 */
function laneOf(v: unknown): 'build' | 'chat' | 'unsure' {
  return v === 'chat' || v === 'unsure' ? v : 'build';
}

/**
 * The conversation so far, as real chat turns for the voice lane.
 *
 * USED TO READ THE BROWSER'S `prior`. That is gone on purpose: a reload or a door restart emptied it,
 * and the surface never even put `said` on the wire for chat rounds, so she arrived cold every time.
 * The durable store under `.aukora/conversation.jsonl` is the only source now — see
 * `surface/conversation.ts`. The forge still uses the browser's `prior` for REPAIR briefs (diffs and
 * outcomes); that is a different rail and is untouched here.
 */
async function priorForVoice(): Promise<voice.VoiceTurn[]> {
  const { priorForVoice: load } = await import('./conversation');
  return load();
}

/**
 * What the eye reported, on its way to the hand.
 *
 * Clipped here as well as in `BRIEF_FOR`, for the same reason `priorForWire` clips in the browser: this
 * rides in a POST body on every appearance round, and the real ceiling lives where the brief is built.
 * Shape-checked rather than trusted — it arrives from the browser exactly as `instruction` does.
 */
function sawFrom(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, 4_000) : undefined;
}

/** Sight + working memory for the hand/voice this turn. */
async function sightWithMemory(v: unknown): Promise<string | undefined> {
  let s = sawFrom(v) || '';
  try {
    const mind = await import('./mind/memory');
    const mem = await mind.mindBlock(typeof v === 'string' ? v : '');
    if (mem) s = (s ? s + '\n\n' : '') + mem;
  } catch {
    try {
      const { memoryBlock } = await import('./working-memory');
      const mem = await memoryBlock();
      if (mem) s = (s ? s + '\n\n' : '') + mem;
    } catch { /* */ }
  }
  return s ? s.slice(0, 8_000) : undefined;
}

function serveStatic(pathname: string): Response {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/app\//, '').replace(/^\//, '');
  // `normalize` then a prefix check: a served path is still a way out of the directory.
  const abs = join(APP, normalize(rel));
  if (!abs.startsWith(APP) || !existsSync(abs)) return new Response('not found', { status: 404 });
  return new Response(readFileSync(abs), {
    headers: { 'content-type': TYPES[extname(abs)] ?? 'application/octet-stream', 'cache-control': 'no-store' },
  });
}

// ══ THE COMBINATION THAT MUST NOT BOOT ══
//
// Three settings, each defensible alone:
//
//   AUKORA_AUTH=0     documented in docs/HOSTED.md as "local dev only", and genuinely useful there.
//   AUKORA_HOST=…     a non-loopback bind is how a node sits behind a reverse proxy.
//   AUKORA_HOSTED=1   relaxes an origin fence that a proxy makes meaningless anyway.
//
// Together they are an unauthenticated, write-capable node listening on every interface. The failure
// mode of three reasonable settings is that NOBODY EVER DECIDED TO BE UNSAFE — so nobody reviews it,
// and the comment in the doc that says "local dev only" is three files away from the shell script
// that set it. A door that refuses to start is the only version of that warning which cannot be
// skimmed past.
//
// Deliberately checked here rather than in `scripts/start.ts`: the supervisor is not the only way this
// process is launched — the test suites spawn `surface/door.ts` directly, and so does anyone
// debugging. A guard that only lives in the launcher protects the launcher.
//
// The refusal is loud, names the exact variable to change, and exits non-zero so a supervisor or a CI
// runner sees a failure rather than a healthy-looking process.
if (HOSTED && process.env.AUKORA_AUTH === '0' && HOST !== '127.0.0.1' && HOST !== 'localhost') {
  console.error('');
  console.error('  ✗ REFUSING TO START — unauthenticated on a public bind.');
  console.error('');
  console.error(`      AUKORA_HOSTED=1  AUKORA_AUTH=0  AUKORA_HOST=${HOST}`);
  console.error('');
  console.error('    Each of those is fine alone. Together they serve a write-capable node to anyone');
  console.error('    who can reach this machine, with no sign-in.');
  console.error('');
  console.error('    Change ONE of them:');
  console.error('      · drop AUKORA_AUTH=0            — let the magic-link gate do its job (preferred)');
  console.error('      · AUKORA_HOST=127.0.0.1         — keep it on loopback');
  console.error('      · drop AUKORA_HOSTED=1          — if there is no proxy in front of this');
  console.error('');
  process.exit(78);   // EX_CONFIG — the configuration is wrong, not the code.
}

// Typed the same way test/supervisor.test.ts already types a `Bun.serve` result: the ambient bun-types
// return type does not carry `.port` under this tsconfig, and the field is what makes AUKORA_PORT=0
// (an OS-assigned ephemeral port) reportable at all.
const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 240,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    // ── magic link auth ────────────────────────────────────────────────────────────────────────
    if (req.method === 'GET' && p === '/api/auth/me') {
      const s = sessionFromRequest(req);
      return json({
        ok: true,
        authRequired: authRequired(),
        signedIn: !!s,
        email: s?.email ?? null,
      });
    }
    if (req.method === 'POST' && p === '/api/auth/magic') {
      const guard = localPost(req);
      if (!guard.ok) return json({ error: `refused: ${guard.why}` }, 403);
      let email = '';
      try {
        const b = await req.json() as Record<string, unknown>;
        if (typeof b.email === 'string') email = b.email;
      } catch { return json({ error: 'body must be JSON { email }' }, 400); }
      const minted = createMagicLink(email);
      if (!minted.ok) return json({ ok: false, error: minted.error }, 400);
      // ══ THE TOKEN DOES NOT TRAVEL BACK DOWN THIS RESPONSE ══
      //
      // A magic link works because the token travels a channel only the real owner reads — an inbox.
      // Returning it in the HTTP response deletes that property completely: two curls with any address
      // at all yields a live session. MEASURED: `POST {email:"attacker@evil.com"}` returned a usable
      // token, and `POST /api/auth/consume` turned it into a session.
      //
      // The reason it was here is real and sympathetic. With no mail pipe configured, showing the
      // token in-page is the only way to sign in at all, and docs/HOSTED.md says so plainly. But that
      // is a DEMO affordance, and a demo affordance has to be asked for rather than inherited —
      // because the deployment that most needs the gate is precisely the one nobody configured.
      //
      // `surface/app/gate.js:112` already branches on a missing token and renders `error`, so with
      // this off the sign-in page says something true instead of breaking.
      const demoToken = process.env.AUKORA_DEMO_TOKEN === '1';
      return json({
        ok: true,
        email: minted.email,
        expiresAt: minted.expiresAt,
        // RELATIVE path only — never http://127.0.0.1 (browser cannot open the sandbox).
        // Both fields are withheld together: `path` carried `?token=…`, so closing one and leaving
        // the other would be theatre.
        ...(demoToken
          ? {
            token: minted.token,
            path: `/api/auth/verify?token=${minted.token}`,
            note: 'Open the node with Continue — the token is consumed on this page.',
          }
          : {
            error: 'No mail is configured on this node, so the sign-in link cannot be delivered. '
              + 'Set AUKORA_DEMO_TOKEN=1 to show it in-page instead — do that only on a node you '
              + 'would let a stranger sign in to.',
          }),
      });
    }
    if (req.method === 'POST' && p === '/api/auth/consume') {
      const guard = localPost(req);
      if (!guard.ok) return json({ error: `refused: ${guard.why}` }, 403);
      let token = '';
      try {
        const b = await req.json() as Record<string, unknown>;
        if (typeof b.token === 'string') token = b.token;
      } catch { return json({ error: 'body must be JSON { token }' }, 400); }
      const result = consumeMagicToken(token);
      if (!result.ok) return json({ ok: false, error: result.error }, 400);
      const secure = requestIsSecure(req);
      return new Response(JSON.stringify({
        ok: true,
        email: result.session.email,
        sessionId: result.session.id,
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': setSessionCookie(result.session.id, { secure }),
          'cache-control': 'no-store',
        },
      });
    }
    if (req.method === 'GET' && p === '/api/auth/verify') {
      const token = url.searchParams.get('token') ?? '';
      const result = consumeMagicToken(token);
      if (!result.ok) {
        return new Response(
          `<!doctype html><meta charset="utf-8"><title>φ</title>
          <body style="font-family:system-ui;background:#0b0d18;color:#e8eaf4;display:grid;place-items:center;min-height:100vh;margin:0">
          <div style="max-width:28rem;padding:2rem;text-align:center">
          <p style="opacity:.7;font-size:.8rem;letter-spacing:.12em;text-transform:uppercase">Aukora φ</p>
          <h1 style="font-weight:500;font-size:1.25rem;margin:1rem 0">Link did not work</h1>
          <p style="opacity:.75;line-height:1.5">${result.error}</p>
          <p style="margin-top:1.5rem"><a href="/" style="color:#c8d0ff">Back</a></p>
          </div></body>`,
          { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      const secure = requestIsSecure(req);
      return new Response(null, {
        status: 302,
        headers: {
          location: '/',
          'set-cookie': setSessionCookie(result.session.id, { secure }),
          'cache-control': 'no-store',
        },
      });
    }
    if (req.method === 'POST' && p === '/api/auth/logout') {
      const s = sessionFromRequest(req);
      if (s) destroySession(s.id);
      const secure = requestIsSecure(req);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': clearSessionCookie({ secure }),
          'cache-control': 'no-store',
        },
      });
    }

    if (req.method === 'GET' && p === '/api/mind') {
      // ══ THIS RETURNED THE OWNER'S MEMORY TO ANYONE, FOR AN ARBITRARY QUERY ══
      //
      // No session, no local guard. `mindBlock(q)` is his profile, his arc and his facts; `retrieve(q,
      // 16)` searches his episodes with a string the caller chooses. On a hosted node that is the whole
      // memory, to a stranger, from anywhere.
      //
      // Same class as `/api/forge/receipts` and `/api/hands/*`, both gated in earlier rounds after the
      // same measurement. It survived because each route was judged alone when it was written and
      // nothing ever asked the question of all of them at once — which is what
      // `test/hosted-read-gate.test.ts` does now, by name, so a new route is red until classified.
      const who = requireSession(req);
      if (!who.ok) return who.response;
      const mind = await import('./mind/memory');
      const q = url.searchParams.get('q') || '';
      const block = await mind.mindBlock(q);
      const hits = q ? await mind.retrieve(q, 16) : [];
      return json({ ok: true, shape: 'everos-md-mvp', block, hits });
    }

    if (req.method === 'GET' && p === '/api/powers') {
      return json({
        ok: true,
        glass: 'Aukora membrane over Grok Build — lab singularity mode',
        talk: true,
        liveSwap: ['style.css', 'composer/send/placeholder'],
        // `/api/mind` is SESSION-GATED now (#140) and this list is served to strangers — `/api/powers`
        // is deliberately open. Naming a route here without saying it needs a session made this copy a
        // map to a door that answers 401, which is a small lie in the one place a stranger reads.
        memory: ['everos-md: .aukora/memory/*', 'conversation.jsonl', 'working-memory.json', 'docs/absorbs/*',
          'GET /api/mind (signed in only)'],
        absorb: {
          enabled: true,
          how: 'paste github URL or absorb: owner/repo',
          writes: 'docs/absorbs/*.md + working memory (law paths protected)',
        },
        build: {
          // LAW.md §1: "not a setting that can be left on." This read `!== '0'`, so an ABSENT
          // variable — the state of every machine nobody configured — meant apply-without-a-click.
          autoApply: HOSTED && process.env.AUKORA_AUTO_ACCEPT === '1',
          undo: true,
          deterministic: [
            'placeholder text',
            'page title',
            'background color',
            'theme accents (green/blue/purple/gold/teal/pink/red)',
            'composer taller/shorter',
            'welcome message',
            'create docs/*.md notes',
            'create surface/app/user widgets',
            'freeform css: rules',
          ],
          surgical: 'any surface/app + surface/*.ts + docs (max 28 files)',
          functional: 'user widgets with state, localStorage, events, forms, mini-apps',
        },
        hands: ['read', 'find', 'status', 'diff', 'test', 'typecheck', 'commit', 'push', 'restart', 'absorb', 'scaffold'],
        examples: [
          'make the theme teal',
          'get rid of that corner line',
          'https://github.com/StarTrail-org/PixelRAG',
          'absorb: aumara-xyz/aukora-one',
          'build: port a small idea from the absorb note into surface/app/user/',
          'what can you do here?',
        ],
        law: 'aukora.law.json — intelligence proposes; protected paths refuse',
      });
    }

    if (req.method === 'GET' && p === '/api/standing') {
      const s = sessionFromRequest(req);
      return json({
        ...standingReport(),
        key: await keyReport(),
        grok: grokAuthStatus(),
        hosted: HOSTED,
        authRequired: authRequired(),
        signedIn: !!s,
        email: s?.email ?? null,
        listen: { host: HOST, port: PORT },
        // Product copy: this is the app. Local sovereign nodes use AUMLOK; we do not label that here.
        product: 'aukora-phi',
      });
    }
    // ── WHAT IS IN THE WIDGET DIRECTORY ────────────────────────────────────────────────────────
    //
    // THE DIRECTORY IS THE REGISTRATION. `serveStatic` already serves `surface/app/**` at `/app/**`
    // with no allowlist, so a widget dropped into `surface/app/user/` is live the instant its bytes
    // reach disk. What was missing was a way for the glass to KNOW it is there: nothing scanned that
    // directory, so `pulse.js` existed and mounted nowhere, and anything the owner built by talking
    // vanished on reload.
    //
    // `surface/app/aura/apps.js` gives the reason a list costs something — "a registry the shell imports
    // makes adding an app a change to a file another lane owns" — while itself keeping one, a frozen
    // APPS array that threadsShell.js imports. It accepted that cost for the menu. A directory listing
    // does not have to, which is the only claim being made here.
    //
    // Names only, plus size and mtime for the arrange panel. No contents: the module is fetched by the
    // browser through the ordinary static route, which is where the traversal fence already lives.
    if (req.method === 'GET' && p === '/api/user/widgets') {
      // The names of the owner's own widget files. Small, and still his — and the dock that reads this
      // now boots AFTER `ensureSession` (#128), so nothing legitimate reaches here without a session.
      const who = requireSession(req);
      if (!who.ok) return who.response;
      try {
        const dir = join(APP, 'user');
        if (!existsSync(dir)) return json({ widgets: [] });
        const widgets = readdirSync(dir)
          // Exactly the shape `dock-manifest.js` will accept — a name that is not `.js`, or that has a
          // separator in it, can never become `/app/user/<name>` and so is not offered as one.
          .filter((n) => /^[^/\\]+\.js$/.test(n) && !n.startsWith('.'))
          .map((name) => {
            const st = statSync(join(dir, name));
            return { name, bytes: st.size, mtime: st.mtimeMs };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        return json({ widgets });
      } catch (e) {
        // A directory that will not list is not an empty directory, and answering `[]` would tell the
        // glass every widget had been deleted. Same discipline as the aura verdict fields.
        return json({ error: `the widget directory could not be read: ${String((e as Error)?.message ?? e)}` }, 500);
      }
    }

    // ── WHAT IS IN THE APP DIRECTORY ───────────────────────────────────────────────────────────
    //
    // The same claim as the block above, for the other directory, and it closes the same gap. `APPS`
    // in `surface/app/aura/apps.js` was a frozen array while `serveStatic` carries no allowlist, so a
    // page built during a round was LIVE at its URL and INVISIBLE in the menu — "registration is the
    // file existing" was true of the door and false of the glass, and it failed for exactly the person
    // it matters to: someone who has just built something and cannot find it.
    //
    // AURA shipped the honest interim — `scripts/apps-manifest.ts` wrote the list down and a gate
    // failed when the file and the list disagreed — and handed over the spec for the end state, which
    // is this endpoint. With it the directory IS the registration on both sides, so the generator and
    // its generated `apps.manifest.json` are deleted rather than left as a second source that has to
    // be re-run by hand and can silently go stale.
    //
    // NAMES ONLY, exactly as above: the page itself is fetched by the browser through the ordinary
    // static route, which is where the traversal fence already lives. And the glass keeps precedence —
    // a curated `APPS` entry wins over anything discovered here, because `note` says what a thing is
    // AND WHAT IT IS NOT (the observatory's "NOT EVIDENCE FOR RH") and no filename can carry that.
    if (req.method === 'GET' && p === '/api/app/pages') {
      const who = requireSession(req);
      if (!who.ok) return who.response;
      try {
        const dir = join(APP, 'aura');
        if (!existsSync(dir)) return json({ pages: [] });
        const pages = readdirSync(dir)
          // A name that is not `.html`, or that carries a separator, can never become
          // `/app/aura/<name>` and so is never offered as one.
          .filter((n) => /^[^/\\]+\.html$/.test(n) && !n.startsWith('.'))
          .map((name) => {
            const st = statSync(join(dir, name));
            return { name, path: `/app/aura/${name}`, bytes: st.size, mtime: st.mtimeMs };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        return json({ pages });
      } catch (e) {
        // A directory that will not list is not an empty directory. Answering `[]` would tell the glass
        // every page had been deleted — the same failure the record panel had when an unreadable ledger
        // rendered as "nothing has ever happened on this node".
        return json({ error: `the app directory could not be read: ${String((e as Error)?.message ?? e)}` }, 500);
      }
    }

    if (req.method === 'GET' && p === '/api/models') {
      const minds: Record<string, { id: string; label: string }> = {};
      for (const k of Object.keys(MINDS)) minds[k] = { id: MINDS[k]!.id, label: MINDS[k]!.label };
      return json({ minds, default: DEFAULT_MIND });
    }

    // ── her voice ──────────────────────────────────────────────────────────────────────────────
    if (req.method === 'POST' && p === '/api/presence/stream') {
      const guard = localPost(req);
      if (!guard.ok) return json({ error: `refused: ${guard.why}` }, 403);
      const who = requireSession(req);
      if (!who.ok) return who.response;
      let text = ''; let model = modelFor(); let provider = providerFor();
      try {
        const b = await req.json() as Record<string, unknown>;
        if (typeof b.text === 'string') text = b.text.slice(0, 6000);
        if (b.reset === true) resetPresence();
        if (typeof b.mind === 'string' && MINDS[b.mind]) { model = modelFor(b.mind); provider = providerFor(b.mind); }
        else if (typeof b.model === 'string') { model = b.model; provider = providerForModel(b.model); }
      } catch { return json({ error: 'body must be JSON { text }' }, 400); }
      if (!text.trim()) return json({ error: 'text required' }, 400);
      const stream = await presenceStream(text, model, req.signal, provider);
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' },
      });
    }

    // ── the forge, WATCHED ──────────────────────────────────────────────────────────────────────
    //
    // The same round as `/api/forge`, streamed. It exists because the owner's complaint was exact and
    // correct: he typed, waited on a spinner, and the surface NARRATED work — "opening the status of
    // the branch" — that it could not do. This sends what is actually happening, and distinguishes two
    // kinds of thing on purpose:
    //
    //   `log`     the engine's own chatter. An account of itself. Not evidence.
    //   `verdict` the witness chain, tailed live. What the guard recorded BEFORE letting a tool run,
    //             written by a hook the engine does not control. This is the record.
    //
    // A refusal reaching the screen mid-round is the product: the law holding, watched, in real time.
    if (req.method === 'POST' && p === '/api/forge/stream') {
      const guard = localPost(req);
      if (!guard.ok) return json({ error: `refused: ${guard.why}` }, 403);
      const who = requireSession(req);
      if (!who.ok) return who.response;
      const stand = requestAction('write', 'the forge');
      if (!stand.ok) return json({ ok: false, error: stand.class, class: stand.class, standing: stand.standing, reason: stand.reason }, 403);

      let b: Record<string, unknown> = {};
      try { b = await req.json() as Record<string, unknown>; } catch { /* handled below */ }
      const instruction = typeof b.instruction === 'string' ? b.instruction : '';
      if (!instruction.trim()) return json({ ok: false, error: 'an instruction is required' }, 400);

      // WHICH HAND, decided before a single byte of stream is opened, so a refusal is a plain 400 the
      // surface can read rather than a failure event inside a stream it has to parse to discover.
      const engines = await import('../core/forge/engines');
      const pick = await engines.pickEngine(typeof b.engine === 'string' ? b.engine : undefined);
      if (!pick.ok) return json(engines.engineRefusal(pick), 400);

      // ONE ROUND ON THE TREE. Taken only after the cheap refusals above, so an empty instruction or a
      // missing engine never occupies the slot. Check-and-set is synchronous: the next await is inside
      // the held region, so a second POST that arrives mid-brief is refused rather than queued into a race.
      if (forgeRoundLive) return roundInFlight();
      forgeRoundLive = true;
      let held = true;
      const releaseRound = () => { if (held) { held = false; forgeRoundLive = false; } };

      try {
        // …and only then is there any point composing a brief. The refusals above are cheaper and answer
        // the same request, so nothing is built for a round that is not going to run.
        const brief = await repairBrief(instruction, b.prior);

        const enc = new TextEncoder();
        // ROUNDS THE BROWSER ABANDONED USED TO KEEP RUNNING. Nothing listened for the reader going away,
        // so closing a tab or navigating mid-round left the engine's child process alive — and the next
        // round then contended with it. Measured on this machine: three orphaned `grok agent` processes
        // turned an 8-second answer into a minute of nothing. From the owner's side that reads as "it got
        // slower the more I used it", which is the worst kind of bug because using it more makes it worse.
        const roundAbort = new AbortController();
        let streamStarted = false;
        const stream = new ReadableStream<Uint8Array>({
          async start(c) {
            streamStarted = true;
            const send = (o: unknown) => { try { c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`)); } catch { /* client left */ } };
            let stopWatching: (() => void) | null = null;
            let heartbeat: ReturnType<typeof setInterval> | null = null;
            try {
              const crush = await import('../core/forge/crush');
              const review = await import('../core/forge/review');
              const { watchChain } = await import('../core/forge/watchChain');
              const { chainHome } = await import('../core/witness/identity.mjs');

              send({ t: 'begin', engine: pick.id });
              stopWatching = watchChain(chainHome(process.cwd()).file, (v) => send({ t: 'verdict', ...v }));

              // ── A QUIET ROUND MUST NOT LOOK LIKE A DEAD ONE ────────────────────────────────────
              //
              // Two numbers in this repository disagreed and nothing reconciled them: `idleTimeout: 240`
              // above closes a connection after four minutes with no bytes on it, and
              // `FORGE_TIMEOUT_MS = 360_000` in core/forge/crush.ts lets a round run for six. A round
              // between those two is not slow, it is UNREPORTABLE — the engine works on, finishes, and
              // the answer has nowhere to go because the socket the surface was reading closed underneath
              // it. What the owner sees is the surface saying the door did not answer about a round the
              // door is still running.
              //
              // Frames are not guaranteed in that gap either: crush streams its own chatter, but the
              // grok lane emits nothing between tool calls, and the chain watcher only speaks when a
              // verdict is written. So the door says something on its own account every five seconds.
              //
              // It carries elapsed ms because a clock the SERVER owns is the honest one — a browser tab
              // that was backgrounded stops counting, and the number it would show is its own, not the
              // round's.
              const began = Date.now();
              heartbeat = setInterval(() => send({ t: 'alive', ms: Date.now() - began }), 5_000);

              // ── THE ROUTER: A QUESTION GOES TO THE MIND THAT HAS A SELF TO ANSWER FROM ──────────
              //
              // MEASURED. He typed "are you there love?" with the nebius pill selected and a code model
              // replied that it was "observing the Aukora φ repository structure and ready to assist
              // with any questions or tasks regarding the Bun + TypeScript codebase" — then, asked what
              // it was running, claimed to be "the φ model", read a provider config off disk, and said
              // the whole thing three times.
              //
              // Nothing was broken. That is Qwen3-Coder being what it is. `lane.js` had always decided
              // what the hand is TOLD and never WHICH HAND, which is the difference between a switch and
              // a router — so the surface could say `nebius` and he could still be talking to a compiler.
              //
              // `chat` AND `unsure` come here; only a real instruction verb reaches the hand. This
              // paragraph said the opposite for one commit — it was written when `voiceLane` refused
              // `unsure`, survived the commit that changed that, and a code model reading the two
              // together correctly reported the contradiction. See `core/forge/voice.ts` for the
              // measurement that flipped it. If she is not reachable this falls through to the
              // ordinary round below, and he gets the hand's answer rather than an error about a
              // tunnel.
              // ══ THE ONE ROUTING CHANGE: WITH BUILD MODE ON, A QUESTION REACHES THE HAND ══
              //
              // MEASURED on live main, Build mode ON: "grep the code that makes you and tell me what
              // you find" → chat → the voice → no tools. So did "read core/forge/voice.ts and tell me
              // about your tools". She answered from nothing, about a repository sitting on the disk
              // beside her.
              //
              // Every piece of the other path already existed. `BRIEF_FOR('chat')` says "The owner is
              // ASKING A QUESTION… Read whatever you need to read to be accurate — but do NOT modify,
              // create or delete any file." The round forwards `laneOf(b.lane)`. crush accepts it. The
              // SURFACE EVEN SENDS IT — this line intercepted it one layer earlier, so the chat brief
              // that has been in crush.ts all along had never once been used.
              //
              // BUILD MODE IS STILL THE GATE and this does not widen it. Off, a question goes to the
              // voice exactly as before (#92's law). On, the owner has already armed the hand — and
              // the hand is the only thing here that can read a file. Note it is `approve`, the same
              // bit the auto-accept decision reads below, so the two can never disagree about what
              // Build mode was.
              const buildModeOn = !!(b as { approve?: boolean }).approve;
              if (voice.voiceLane(laneOf(b.lane)) && !buildModeOn) {
                // Capability questions: answer from powers, never from memory "Applied" residue.
                if (/\bwhat can you (?:change|do|edit|build|fix)\b/i.test(instruction)
                  || /\bwhat(?:'s| is) (?:possible|changeable)\b/i.test(instruction)
                  || /\bpowers\b/i.test(instruction) && /\?\s*$/.test(instruction.trim())) {
                  const powers =
                    'On this glass I can change live UI under `surface/app/*` when you give a concrete ask:\n'
                    + '· theme / accents (green, blue, purple, gold, teal…)\n'
                    + '· background, borders, glows, composer, send button, placeholder, title, welcome\n'
                    + '· freeform `css: …` rules; small widgets in `surface/app/user/`\n'
                    + '· absorb a GitHub URL (`absorb: owner/repo`) into docs/absorbs\n'
                    + '· surgical edits to the surface files with undo\n\n'
                    + 'I cannot rewrite law/keys/authority paths. Talk stays talk; say e.g. '
                    + '"make the theme teal" or "make the send arrow outline-only" and the builder hand runs.\n'
                    + 'Sight structure is free; pixel vision needs a model key (structure still works).';
                  try {
                    const { recordExchange } = await import('./conversation');
                    await recordExchange(instruction, powers, 'powers');
                  } catch { /* */ }
                  clearInterval(heartbeat); heartbeat = null;
                  stopWatching(); stopWatching = null;
                  send({ t: 'nothing', note: 'answered', said: powers, engine: 'powers', ms: 0 });
                  c.close(); return;
                }
                // Hosted / Grok Build: try Grok voice first (silent). Local AUMA GPU second.
                const prior = await priorForVoice();
                let ctx = '';
                try {
                  const mind = await import('./mind/memory');
                  ctx = await mind.mindBlock(instruction);
                } catch {
                  try {
                    const wm = await import('./working-memory');
                    ctx = await wm.memoryBlock();
                  } catch { /* */ }
                }
                const saw = typeof (b as { saw?: unknown }).saw === 'string' ? String((b as { saw: string }).saw).trim() : '';
                if (saw) ctx = (ctx ? ctx + '\n\n' : '') + '[screen now]\n' + saw.slice(0, 5000);
                // ══ HER OWN GPU FIRST, THE VENDOR SECOND ══
                //
                // This asked Grok first and fell back to AUMA. Reversed, on the owner's explicit
                // decision to stop making a vendor the default mind. The ordering is not cosmetic:
                // AUMA runs on hardware he rents directly, so no vendor sees the prompt or the
                // repository, and she is the only one of the two QLoRA'd on this project's own canon
                // — a question about AUKORA reaches a model that has actually read it.
                //
                // Grok stays as the fallback rather than being deleted, because AUMA lives behind an
                // SSH tunnel to a box that is stopped whenever it is not paid for. A silent, working
                // second mind is what keeps "the box is off" from meaning "the surface is dead" — the
                // same fallthrough rule the eye already uses.
                // ══ SHE IS TOLD WHAT THIS NODE IS, BECAUSE THE NODE ALREADY KNOWS ══
                //
                // Asked what was powering her, she answered "I don't know what model or harness is
                // powering me" — and she was right to, because both prompts told her to. The node knew
                // the answer the whole time: the engine registry knows the builder and its version
                // string, `core/aura/state.ts` knows whether anything has signed for this node and how
                // many receipts are behind it, and the standing seam knows who is at the glass. None of
                // it reached her. See core/forge/selfKnowledge.ts for the full account.
                //
                // READ PER MIND, not once. The first line of the block is which voice is answering, and
                // that is only known after the fallthrough — the difference between "no vendor sees
                // this conversation" and "that vendor sees this turn" is the one fact in here the owner
                // most needs to be true. Both reads are bounded and the second is served from the
                // per-process probe cache, so the fallback path pays for the chain read and nothing else.
                // ══ WHAT HE PICKED, AND WHAT ACTUALLY REPLIES ══
                //
                // `chose` is a fact about the REQUEST: the pill's mind key, resolved through the same
                // MINDS table `/api/presence/stream` routes on, so the label and the id come from one
                // place rather than two. It is read here and used for nothing but the reading — this
                // path still diverts to AUMA and then Grok regardless, and re-routing it is a decision
                // about which model answers the owner rather than a reporting fix.
                //
                // `answered` is resolved PER MIND at the call site below, because which model replied
                // is not known until one of them does.
                const chose = (() => {
                  const key = typeof b.mind === 'string' ? b.mind : null;
                  if (key && MINDS[key]) return { key, label: MINDS[key]!.label, model: MINDS[key]!.id };
                  // A bare model id is a legitimate choice too; it is its own label.
                  if (typeof b.model === 'string' && b.model.trim()) {
                    return { key: b.model, label: b.model, model: b.model };
                  }
                  return undefined;
                })();
                const withSelf = async (mind: 'auma' | 'grok') => {
                  // `buildModeOn` rather than a literal `false`: it is false on every path that reaches
                  // here today — the fence at the top of this handler is what makes that so — and
                  // reading the bit instead of asserting it keeps the block right on the day something
                  // routes a voice turn with the switch on, rather than confidently wrong.
                  //
                  // The responder is named from where the request is ACTUALLY routed — `AUMA_MODEL` is
                  // the id that box is served under, `grokDefaultModel()` is what the Grok call sends —
                  // never from the pill, which is the guess the whole block exists to remove.
                  const answered = mind === 'auma'
                    ? { model: voice.AUMA_MODEL, route: "the owner's own GPU over a private tunnel" }
                    : mind === 'grok'
                      ? { model: grokDefaultModel(), route: 'the Grok session on this host — a vendor sees this turn' }
                      // THE PILL, HONOURED. `chose` is guaranteed here: this branch is only reached from
                      // the `picked` path below, which requires it.
                      : { model: chose!.model, route: `${chose!.label} over OpenRouter — a vendor sees this turn` };
                  const self = await voice.selfKnowledge(mind, buildModeOn, { chose, answered });
                  return [ctx, self].filter(Boolean).join('\n\n') || undefined;
                };
                // ══ SHE STIRS ══
                //
                // One number, measured here and handed over. `stir` takes `(at: number, length:
                // number)` — passing `instruction` itself does not compile, which is the whole design:
                // the breath channel cannot leak what was said because it never receives it. See
                // surface/cadence.ts, and Lane 3's figure, whose breath triad rests at zero so no
                // sequence of messages can leave a permanent mark.
                try {
                  const { stir } = await import('./cadence');
                  stir(Date.now(), instruction.length);
                } catch { /* breath is decoration; it may never fail a turn */ }
                // ══ THE PILL DECIDES, AND ONLY THEN THE LADDER ══════════════════════════════════
                //
                // This was `askAuma` then `askGrokVoice` unconditionally, while `chose` was read three
                // lines above "for nothing but the reading" — so the one control labelled with a model
                // name changed nothing about which model answered, and every typed turn comes through
                // here (the presence path, which does honour the pill, is unreachable from the box he
                // types in). ONE SELECTOR, ONE MEANING: if he picked a mind, that mind answers.
                //
                // THE LADDER SURVIVES BENEATH IT, and that is not hedging. AUMA is behind a tunnel to a
                // box that is stopped when unpaid and a vendor mind can be out of credit; a pill that
                // killed the surface when a choice could not be served would be worse than no pill.
                // What changed is the ORDER OF AUTHORITY, not the existence of a fallback.
                const picked = chose && chose.key !== 'auma' && chose.key !== 'grok'
                  ? MINDS[chose.key] ?? null
                  : null;
                let spoken: Awaited<ReturnType<typeof voice.askAuma>> | null = null;
                let mind = 'auma';
                if (picked) {
                  spoken = await voice.askVendorVoice(
                    picked.id, picked.provider, instruction, prior, fetch, await withSelf(chose!.key as never),
                  );
                  mind = chose!.key;
                }
                if (!spoken || !('ok' in spoken)) {
                  spoken = await voice.askAuma(instruction, prior, fetch, await withSelf('auma'));
                  mind = 'auma';
                }
                if (!('ok' in spoken)) {
                  spoken = await voice.askGrokVoice(instruction, prior, fetch, await withSelf('grok'));
                  mind = 'grok';
                }
                if ('ok' in spoken) {
                  try {
                    const { recordExchange } = await import('./conversation');
                    await recordExchange(instruction, spoken.said, mind);
                  } catch { /* answer still reaches him */ }
                  clearInterval(heartbeat); heartbeat = null;
                  stopWatching(); stopWatching = null;
                  // `truncated` rides along. She hit the ceiling and stopped mid-thought; without this
                  // the glass shows a sentence that ends and no reason it ended, which reads as her
                  // having finished. `?? false` is deliberate rather than spreading the optional: the
                  // frame always carries the field, so an older surface sees `false` instead of
                  // `undefined` and cannot mistake absence for a shape it does not know.
                  send({
                    t: 'nothing', note: 'answered', said: spoken.said, engine: mind, ms: spoken.ms,
                    truncated: (spoken as { truncated?: boolean }).truncated ?? false,
                  });
                  c.close(); return;
                }
                // Both minds down — fall through to the forge engine without a log of why.
              }

              // Resolved BEFORE the round so the owner is told what will run it, not what ran it.
              // `pick.id` gates it: only crush honours `-m` (nebius pins its own model on purpose, and
              // claude / grok / fable ignore the field entirely), so offering a model choice on those
              // would be a control that does nothing — the defect this whole round is about.
              const crushModel = pick.id === 'crush'
                ? crushModelFor(typeof b.mind === 'string' ? b.mind : undefined)
                : { model: null, why: `${pick.id} does not take a model from the glass` };
              if (crushModel.model) send({ t: 'log', line: `model: ${crushModel.model}` });
              else if (typeof b.mind === 'string' && b.mind) send({ t: 'log', line: `model: engine default — ${crushModel.why}` });

              const out = await crush.forge(brief, {
                // A ROUND THE OWNER WALKED AWAY FROM MUST DIE WITH HIM. The controller was built and
                // aborted and never handed over, so an abandoned round kept a coding agent alive and the
                // next round contended with it — measured, three orphans turning an 8s answer into a
                // minute of nothing.
                signal: roundAbort.signal,
                engine: pick.engine, onEvent: (e) => send(e),
                lane: laneOf(b.lane), sight: await sightWithMemory(b.saw),
                // THE MODEL CHOICE REACHES CRUSH. `crushEngine` has appended `-m <model>` since it was
                // written and nothing ever passed one. The spelling matters and is not the obvious one
                // — see `crushModelFor` in ./presence, which carries the measurement. A mind with no
                // crush spelling passes nothing rather than a guess, and says so on the log above.
                ...(crushModel.model ? { model: crushModel.model } : {}),
              });
              clearInterval(heartbeat); heartbeat = null;
              stopWatching(); stopWatching = null;

              if (!out.ok) { send({ t: 'failed', error: out.error }); c.close(); return; }
              const changed = out.changed.map((f) => f.replace(/ \(new\)$/, ''));
              // EVERY SHAPE `capture()` CAN RETURN, READ IN ONE PLACE. This used to be a hand-written
              // ladder here and a second one on the non-stream route below, and the two were never the
              // same length: both knew `unparseable`, both later learned `refused`, and neither ever
              // knew `deletedFile` or `unreviewable` — so a round that deleted a file and a round too
              // large to render both fell through to `slimProposal` and reached the owner as an
              // `ok: true` card with no id, which accept and discard can never resolve. See
              // `readCapture`'s own note in core/forge/review.ts for the measured bodies, and
              // test/forge-capture-shapes.test.ts for the proof at this door.
              const seen = review.readCapture(await review.capture(changed, out.created ?? [], out.diffstat, crush.preRunSnapshot()));
              // A ROUND THAT CHANGED NOTHING STILL SAID SOMETHING. This sent only the note, so a question
              // answered correctly — no files touched — reached the owner as a blank line. For a `chat`
              // turn that is the whole point of the round, and throwing it away is the surface narrating
              // silence over an answer that exists.
              // ══ A CHAT LANE CANNOT WRITE, AND UNTIL NOW THAT WAS A SENTENCE IN A PROMPT ══
              //
              // `lane` reaches exactly ONE place in this repository: `BRIEF_FOR`, which builds a
              // STRING. `review.capture` has never heard of lanes. So "do NOT modify, create or delete
              // any file" was a request to a model, and a model that wrote anyway would have produced
              // a card — with the owner's click the only thing left between it and disk.
              //
              // The click is real and LAW §1 holds either way. But `cannot` is not a word this
              // repository spends on a prompt, so the proposal is DROPPED here. The tree is already
              // safe without this: `capture()` restores unconditionally (review.ts:529, "PUT IT BACK —
              // the line that makes the gate real rather than advisory"), which is why this can be a
              // decision about what to OFFER rather than a second undo path.
              //
              // It closes a gate leak that predates this change, too. With Build mode OFF and the
              // voice unreachable, the documented fallthrough ran an ordinary round and offered a
              // card — measured, watching this file fail. A chat lane now proposes nothing whatever
              // the switch says.
              const chatLane = voice.voiceLane(laneOf(b.lane));
              if (chatLane && seen.kind === 'proposal') {
                const said = out.said || out.log || '';
                try {
                  const { recordExchange } = await import('./conversation');
                  if (said.trim()) await recordExchange(instruction, said, pick.id);
                } catch { /* the answer still goes out */ }
                // `read` rather than `nothing`: the owner asked a question, the hand read the
                // repository to answer it, and it declined to change anything. That is a different
                // event from "the round did nothing", and the surface names it differently.
                // `fromEngine` is the register marker. `said` here is `out.said || out.log` — and
                // crushEngine returns no `said`, so in practice it is the WHOLE TRANSCRIPT. That went
                // into a prose bubble the stylesheet deliberately refuses to clip, which is the
                // 17,668px message. The surface folds it now; without a marker it would have to infer
                // the register from the engine name, and inferring it is what went wrong here first.
                send({
                  t: 'nothing', note: 'read only — a question, answered',
                  said, engine: pick.id, ms: out.ms, fromEngine: true,
                });
                c.close(); return;
              }
              if (seen.kind === 'nothing') {
                const said = out.said || out.log || '';
                if (said.trim() && chatLane) {
                  try {
                    const { recordExchange } = await import('./conversation');
                    await recordExchange(instruction, said, pick.id);
                  } catch { /* answer still goes out */ }
                }
                // The engine is named on a chat lane so the surface can say WHICH mind answered — the
                // voice path has always sent one and this path never did, which is why both arrived
                // looking the same.
                // `fromEngine` HERE TOO. This branch was missed: LIMITS §21 claimed the door marks
                // engine output and "only that folds", and it marked exactly one of the two frames
                // that carry `out.said || out.log`. A chat-lane round that changed nothing still put
                // the whole transcript into the unclippable prose bubble — the same 17,668px message,
                // reached by the other branch. Found by auditing across lanes, not inside one.
                send({
                  t: 'nothing', note: 'nothing changed on disk', said,
                  ...(chatLane ? { engine: pick.id, fromEngine: true } : {}),
                });
                c.close(); return;
              }
              // NOT A PROPOSAL, SO NOT A CARD. Everything that is not `nothing` and not a real proposal
              // is a refusal with no `id`, and `seen.kind` is already the name the surface renders —
              // `unparseable`, `refused-path`, `deleted-file`, `unreviewable`, and the floor,
              // `proposal-without-id`, for a shape review.ts grows after this line was written.
              if (seen.kind !== 'proposal') {
                send({ t: 'failed', error: seen.kind, file: seen.file, detail: seen.detail });
                c.close(); return;
              }
              const proposal = seen.proposal;

              // HOSTED GLASS: signed-in owner builds like talking to the hand — proposal is still
              // receipted, then applied immediately with undo — but ONLY when the operator has
              // explicitly set AUKORA_AUTO_ACCEPT=1. LAW.md §1 is unambiguous that a click is not a
              // preference that can be left on, and an unset variable must therefore read as OFF.
              // Build mode sends approve:true → always show the card. Live/demo can auto-apply.
              const wantApprove = !!(b as { approve?: boolean }).approve;
              const autoAccept = !wantApprove && HOSTED && process.env.AUKORA_AUTO_ACCEPT === '1'
                && (!authRequired() || !!sessionFromRequest(req));
              if (autoAccept) {
                const applied = await review.apply(proposal.id, proposal.proposalHash, 'auto-accept');   // its own hash, checked all the same — labeled 'auto-accept' in the receipt: this is not a click
                if (applied.ok) {
                  try {
                    const mind = await import('./mind/memory');
                    await mind.rememberApply(
                      (proposal.changed || []).map(String),
                      String(out.said || 'applied'),
                    );
                  } catch {
                    try {
                      const wm = await import('./working-memory');
                      await wm.noteApply(
                        (proposal.changed || []).map(String),
                        String(out.said || 'applied'),
                      );
                    } catch { /* memory is best-effort */ }
                  }
                  send({
                    t: 'applied',
                    from: out.from,
                    ms: out.ms,
                    engine: pick.id,
                    proposal: slimProposal(proposal),
                    applied: applied.applied,
                    restart: applied.restart,
                    note: out.said || 'applied',
                  });
                  c.close(); return;
                }
                // Apply failed — fall through so they still see the card and can retry.
                send({ t: 'log', line: `auto-apply held: ${applied.error || 'unknown'} — accept manually` });
              }
              send({ t: 'proposal', from: out.from, ms: out.ms, engine: pick.id, proposal: slimProposal(proposal) });
            } catch (e) {
              send({ t: 'failed', error: (e as Error)?.message ?? 'the round failed' });
            } finally {
              // The lock outlives the client: abort may fire while forge is still draining. Release only
              // here, after the engine work has stopped, so a second POST cannot start mid-teardown.
              releaseRound();
              if (heartbeat) { try { clearInterval(heartbeat); } catch { /* already stopped */ } }
              try { stopWatching?.(); } catch { /* already stopped */ }
              try { c.close(); } catch { /* already closed */ }
            }
          },
          cancel() {
            try { roundAbort.abort(); } catch { /* already gone */ }
            // start() never ran (client left before the first pull) — free the slot. If start() is
            // already in flight, its finally owns the release; do not free early or a second round
            // begins while the first is still on the tree.
            if (!streamStarted) releaseRound();
          },
        });
        // The client hanging up is also a cancel — `cancel()` fires on reader release, and this covers the
        // socket dying under it.
        req.signal?.addEventListener('abort', () => { try { roundAbort.abort(); } catch { /* gone */ } });
        return new Response(stream, {
          headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' },
        });
      } catch (e) {
        releaseRound();
        return json({ ok: false, error: (e as Error)?.message ?? 'the round failed' }, 500);
      }
    }

    // ── THE COUNCIL ─────────────────────────────────────────────────────────────────────────────
    //
    // One question, every seat, in parallel, READ-ONLY. See `core/council/cast.ts` for why this could
    // ship ahead of concurrent WRITE rounds: a council has no diff to conflict and no snapshot to lose,
    // so `docs/EXPECTATIONS.md` #3 — two rounds eating one working tree — does not reach it.
    //
    // `spend` and not `write`, matching the eye below and for the same reason: a council changes nothing
    // on disk and is a billed model call, so spending is the verb the standing seam actually has for it.
    // The council reads a detached worktree pinned to HEAD, never this tree.
    // FOUND WHILE FIXING THE OTHER TWO, and fixed with them: same two gaps, and it spends across
    // several models. An identical hole left two routes away reads as confirmation it was fine.
    if (req.method === 'POST' && p === '/api/council/cast') {
      const guard = sensitivePost(req);
      if (!guard.ok) return json({ error: `refused: ${guard.why}` }, 403);
      const who = requireSession(req);
      if (!who.ok) return who.response;
      const stand = requestAction('spend', 'the council');
      if (!stand.ok) return json({ ok: false, error: stand.class, class: stand.class, standing: stand.standing, reason: stand.reason }, 403);

      let b: Record<string, unknown> = {};
      try { b = await req.json() as Record<string, unknown>; } catch { /* handled below */ }
      const question = typeof b.question === 'string' ? b.question : '';
      if (!question.trim()) return json({ ok: false, error: 'a question is required' }, 400);

      // The key is resolved BEFORE the stream opens, so "no key" is a plain 400 the surface can read
      // rather than a failure frame inside a stream it has to parse to discover. Same shape as the
      // engine pick above, and for the same reason.
      const { resolveWorkingKey } = await import('./key');
      const resolved = await resolveWorkingKey();
      if (!resolved.key) {
        return json({ ok: false, error: 'council: no working OpenRouter key — the council rents foreign models', checked: resolved.checked }, 400);
      }
      // Bound to a const HERE rather than read inside the stream: the narrowing above does not survive
      // into the async closure below, and reaching for `resolved.key!` there would silence the compiler
      // about exactly the thing it is right to ask about.
      const apiKey = resolved.key.key;

      const enc = new TextEncoder();
      const castAbort = new AbortController();
      const stream = new ReadableStream<Uint8Array>({
        async start(c) {
          const send = (o: unknown) => { try { c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`)); } catch { /* client left */ } };
          let heartbeat: ReturnType<typeof setInterval> | null = null;
          try {
            const council = await import('../core/council/cast');
            const began = Date.now();
            // The same five-second heartbeat the forge stream carries, for the same measured reason:
            // `idleTimeout` closes a quiet connection long before a reading model finishes, and a
            // council seat can think for minutes without emitting a line.
            heartbeat = setInterval(() => send({ t: 'alive', ms: Date.now() - began }), 5_000);

            const out = await council.cast({
              question,
              repoRoot: ROOT,
              apiKey,
              // Resolved from this file rather than guessed inside the module, so the hook cannot go
              // missing silently if either file moves.
              hookSource: join(ROOT, 'core', 'council', 'readonly.mjs'),
              tier: b.tier === 'deep' || b.tier === 'all' ? b.tier : 'cheap',
              signal: castAbort.signal,
              onEvent: (e) => send(e),
            });
            clearInterval(heartbeat); heartbeat = null;
            if (!out.ok) send({ t: 'failed', error: out.error });
          } catch (e) {
            send({ t: 'failed', error: (e as Error)?.message ?? 'the council failed' });
          } finally {
            if (heartbeat) { try { clearInterval(heartbeat); } catch { /* already stopped */ } }
            try { c.close(); } catch { /* already closed */ }
          }
        },
        cancel() { try { castAbort.abort(); } catch { /* already gone */ } },
      });
      req.signal?.addEventListener('abort', () => { try { castAbort.abort(); } catch { /* gone */ } });
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' },
      });
    }

    // ── HER EYE ─────────────────────────────────────────────────────────────────────────────────
    //
    // MEASURED, and it is the whole reason this block exists: three call sites in the surface have been
    // POSTing here since sight was built — `surface/app/sight.js` twice and `surface/app/surface-chat.js`
    // once — and this route was not on the door. Every one of them fell through to the generic
    // `/api/forge` handler below, which demands an `instruction`:
    //
    //     POST /api/forge/look  →  HTTP 400  {"error":"an instruction is required"}
    //
    // `core/forge/crush.ts` has exported `look()` the entire time. The eye was built, the vision call
    // was built, and nothing joined them — while she told the owner she could look at his screen. It
    // must sit ABOVE the `startsWith('/api/forge')` block, because that is what swallowed it.
    //
    // ══ THE PICTURE NEVER BECOMES A RECORD ══
    //
    // Not logged, not receipted, not echoed back inside a refusal. A receipt in this repository carries
    // a decision and never content — and a picture of the owner's screen is the most content anything
    // here will ever hold. Looking writes nothing to disk, so there is no decision to receipt either.
    if (req.method === 'POST' && p === '/api/forge/look') {
      const guard = sensitivePost(req);
      if (!guard.ok) return json({ error: `refused: ${guard.why}` }, 403);
      // WHO, BEFORE MAY-THEY. There was no `requireSession` here at all, so a hosted node with auth ON
      // still served a billed call to a caller with no session.
      const who = requireSession(req);
      if (!who.ok) return who.response;
      // FIRST, before the body is read. `spend` and not `write`: looking changes nothing on disk, and it
      // is a billed model call — which is the verb the standing seam actually has for it. The refusal
      // class is the same one every other route returns, so the surface needs no new wording.
      // THE EXEMPTION IS DECLARED, NOT INFERRED. It read `HOSTED && AUKORA_AUTH === '0'` — and that
      // setting also makes `requireSession` a no-op AND makes `localPost` accept any origin, so every
      // gate was open at once and any website could spend on vision calls. `AUKORA_OPEN_PLAY=1` now
      // declares it and DEFAULTS CLOSED. DEPLOYMENT: a hosted open-play node must set it or looking
      // refuses with `refused-no-standing`.
      const eyeReceipt = await import('../core/eye/receipt.mjs');
      if (!(HOSTED && process.env.AUKORA_AUTH === '0' && process.env.AUKORA_OPEN_PLAY === '1')) {
        const stand = requestAction('spend', 'her eye');
        if (!stand.ok) {
          // A refused look is a fact about the record too. `session: 'door'` and never `who.email` —
          // see core/eye/receipt.mjs on why an identity may not enter an append-only chain.
          try {
            const peek = await req.clone().json() as Record<string, unknown>;
            eyeReceipt.receiptForLook(ROOT, {
              dataUrl: typeof peek.image === 'string' ? peek.image : '',
              refused: stand.class, session: 'door', agent: 'aura',
            });
          } catch { /* never take the door down over the record */ }
          return json({ ok: false, error: stand.class, class: stand.class, standing: stand.standing, reason: stand.reason }, 403);
        }
      }

      const crush = await import('../core/forge/crush');
      // Refused on the DECLARED length before a single byte is parsed. A body this large is not a
      // near-miss to be trimmed into shape; it is a request this door will not serve.
      const declared = Number(req.headers.get('content-length') ?? 0);
      if (Number.isFinite(declared) && declared > crush.LOOK_IMAGE_MAX + 8_192) {
        return json({ ok: false, error: 'look_image_too_large', max: crush.LOOK_IMAGE_MAX }, 413);
      }

      let b: Record<string, unknown> = {};
      try { b = await req.json() as Record<string, unknown>; } catch { return json({ ok: false, error: 'body must be JSON { image }' }, 400); }
      const image = typeof b.image === 'string' ? b.image : '';
      if (!image) return json({ ok: false, error: 'look_no_image' }, 400);
      if (image.length > crush.LOOK_IMAGE_MAX) {
        return json({ ok: false, error: 'look_image_too_large', max: crush.LOOK_IMAGE_MAX }, 413);
      }

      const goal = typeof b.goal === 'string' ? b.goal.slice(0, 6_000) : '';
      const mode = b.mode === 'describe' ? 'describe' : 'critique';
      const out = await crush.look(image, goal, mode);

      // THE LOOK ENTERS THE RECORD. Digests and counts only — never the frame, never the critique,
      // never the goal. An off-machine eye gets its own class. See core/eye/receipt.mjs for all of it.
      try {
        eyeReceipt.receiptForLook(ROOT, {
          dataUrl: image,
          eye: out.ok ? out.eye : null,
          mode,
          session: 'door',
          agent: 'aura',
          refused: out.ok ? null : out.error,
        });
      } catch { /* the record may be incomplete; the door stays up. Same rule guard.mjs keeps. */ }
      // A BAD PICTURE AND A BLIND NODE ARE DIFFERENT ANSWERS. The surface shows the owner a sentence
      // either way, but a caller that cannot tell "you sent me something that is not an image" from
      // "this machine has no key" has to guess which of the two to tell him.
      if (out.ok) return json(out);
      const mine = out.error === 'look_not_an_image' || out.error === 'look_image_too_large';
      return json(out, mine ? 400 : 502);
    }

    // ── absorb: point at a GitHub repo (read foreign tree; write docs/absorbs note)
    // ABSORB WRITES, SO IT ASKS WHAT THE FORGE ASKS. It had `localPost` alone: `absorbRepo` fetches a
    // caller-supplied URL and writes `docs/absorbs/*.md` plus working memory.
    if (req.method === 'POST' && p === '/api/absorb') {
      const guard = sensitivePost(req);
      if (!guard.ok) return json({ error: `refused: ${guard.why}` }, 403);
      const who = requireSession(req);
      if (!who.ok) return who.response;
      const stand = requestAction('write', 'absorb');
      if (!stand.ok) return json({ ok: false, error: stand.class, class: stand.class, standing: stand.standing, reason: stand.reason }, 403);
      let b: Record<string, unknown> = {};
      try { b = await req.json() as Record<string, unknown>; } catch { return json({ error: 'body must be JSON { url }' }, 400); }
      const url = String(b.url || b.repo || b.text || '').trim();
      if (!url) return json({ error: 'url or repo required' }, 400);
      const { absorbRepo } = await import('../core/forge/absorb');
      const out = await absorbRepo(url, process.cwd(), { writeNote: true });
      return json(out, out.ok ? 200 : 400);
    }

    // ── the forge: propose → accept → rollback, all receipted ───────────────────────────────────
    if (req.method === 'POST' && p.startsWith('/api/forge')) {
      const guard = localPost(req);
      if (!guard.ok) return json({ error: `refused: ${guard.why}` }, 403);
      const who = requireSession(req);
      if (!who.ok) return who.response;
      const stand = requestAction('write', 'the forge');
      if (!stand.ok) return json({ ok: false, error: stand.class, class: stand.class, standing: stand.standing, reason: stand.reason }, 403);

      const review = await import('../core/forge/review');
      let b: Record<string, unknown> = {};
      try { b = await req.json() as Record<string, unknown>; } catch { /* several verbs take nothing */ }
      const id = typeof b.id === 'string' ? b.id : '';

      // ══ AN ACCEPT IS A WRITE TO THE SAME TREE A LIVE ROUND IS HOLDING ══
      //
      // The round lock below (`forgeRoundLive`, taken at the `/api/forge` and `/api/forge/stream`
      // handlers) is real and proven — a second round gets a clean 409, watched by the test above.
      // These three verbs sat ABOVE it and returned before it was ever consulted, so the lock covered
      // starting work and not committing it.
      //
      // What that costs is not a lost click. A live round has already written to the tree, and
      // `review.capture()` will `restore()` it back. An accept landing in that window either has its
      // bytes reverted by that restore — applied, receipted, and silently undone — or gets swept into
      // the live round's `git diff` and captured into an unrelated proposal, so a change the owner
      // already accepted reappears inside another one, mixed with work he did not ask for. Both end
      // with the ledger and the disk disagreeing, which is the single thing this seam exists to stop.
      //
      // The surface's own `startForge` flag does not cover it: that is per-tab memory, and this is a
      // second tab, a reload racing a live round, or a bare curl.
      //
      // NOT the auto-accept path. That calls `review.apply()` directly, in-process, from inside the
      // round that already owns the lock — it never comes through this route, so it is unaffected.
      if (forgeRoundLive) return roundInFlight();
      if (p === '/api/forge/apply') {
        const out = await review.apply(id, typeof b.approvedHash === 'string' ? b.approvedHash : undefined, 'owner-click');   // names its bytes, when sent — optional; 'owner-click' because a real POST here always is one
        // Server-lane bytes are already loaded in this process. A page reload does not re-import them,
        // so accepting without a restart silently left the old code serving. Exit 75 under the
        // supervisor; the client is told whether the exit was actually scheduled.
        let restarting = false;
        if (out.ok && out.restart) {
          const hands = await import('../core/forge/hands');
          const kicked = await hands.scheduleRestart('accepted a server-lane change');
          restarting = !!kicked.ok;
        }
        return json({ ...out, restarting }, 200);
      }
      if (p === '/api/forge/discard')  return json(await review.discard(id), 200);
      if (p === '/api/forge/rollback') return json(await review.rollback(id), 200);

      // A build. An engine writes it, the gate captures it, the tree goes back, the owner decides.
      //
      // WHICH engine is the only thing that varies, and the round is identical either way — the arming
      // switch, the custody refusal, the pre-run snapshots and the undo accounting are engine-agnostic
      // and tested as such.
      //
      // `anything else is crush` is what this used to do, and it was the wrong kind of forgiving: a
      // typo, or a surface asking for an engine this node cannot run, quietly got a different hand than
      // the one it named and no way to know. An unrecognised id is refused as `engine_unknown`; a known
      // engine that did not answer its own probe is refused as `engine_unavailable`. Silence about which
      // engine ran is the one thing a receipted lane cannot afford.
      const crush = await import('../core/forge/crush');
      const instruction = typeof b.instruction === 'string' ? b.instruction : '';
      if (!instruction.trim()) return json({ ok: false, error: 'an instruction is required' }, 400);
      const engines = await import('../core/forge/engines');
      const pick = await engines.pickEngine(typeof b.engine === 'string' ? b.engine : undefined);
      if (!pick.ok) return json(engines.engineRefusal(pick), 400);

      // ══ THE SAME GATE AS THE STREAM ROUTE — FOUND BY WALKING INTO IT ══
      //
      // MEASURED against a live door while checking something else: `{lane:'chat', approve:false}`
      // POSTed here came back a completed round, `log: "Yes."`, engine spawned against the real tree.
      // #121 fenced the streaming route and left this one open, in the same commit as the comment
      // twenty lines up warning that these two ladders had drifted apart once already.
      //
      // Not the same ANSWER, and the difference is honest rather than tidy: with the switch off the
      // stream route has somewhere to send a question — the voice, over SSE. This route has no voice
      // plumbing, so it says no and says which switch. A refusal is a better shape here than an
      // invented one-shot voice reply nothing asked for.
      const buildModeOn = !!(b as { approve?: boolean }).approve;
      const chatLane = voice.voiceLane(laneOf(b.lane));
      if (chatLane && !buildModeOn) {
        // 422, not 200-with-nothing: the request was understood and deliberately not carried out,
        // which is a different fact from a round that ran and changed nothing.
        return json({
          ok: false,
          error: 'talk-only',
          detail: 'Build mode is off, so this is a question rather than a build, and no engine runs '
            + 'here. Turn Build mode on to send it to the hand that reads, or ask on /api/forge/stream '
            + 'where a question reaches the voice.',
        }, 422);
      }

      // Same lock the stream route holds: a non-stream POST is the same write on the same tree.
      if (forgeRoundLive) return roundInFlight();
      forgeRoundLive = true;
      try {
        const out = await crush.forge(await repairBrief(instruction, b.prior), {
          engine: pick.engine, lane: laneOf(b.lane), sight: await sightWithMemory(b.saw),
        });
        if (!out.ok) return json(out, 502);
        const changed = out.changed.map((f) => f.replace(/ \(new\)$/, ''));
        // THE SAME CLASSIFIER THE STREAMING ROUTE USES, and that is the point rather than tidiness:
        // this route's hand-written ladder and that one's drifted apart once already, and the pair of
        // shapes neither of them ever learned is exactly what reached the owner as a dead card.
        const seen = review.readCapture(await review.capture(changed, out.created ?? [], out.diffstat, crush.preRunSnapshot()));
        // The chat lane's other fence, for the same reason it exists on the stream route: the brief
        // says read-only, and a brief is an instruction rather than a wall. Whatever the engine did,
        // a question does not come back as a card.
        if (chatLane && seen.kind === 'proposal') {
          return json({ ...out, proposal: null, note: 'read only — a question, answered', engine: pick.id });
        }
        if (seen.kind === 'nothing') return json({ ...out, proposal: null, note: 'nothing changed on disk' });
        // 422 rather than 200: the request was understood and deliberately not carried out, which is a
        // different fact from a round that changed nothing — and a refusal returned as `{ ok: true }` is
        // answered by the surface as a proposal with no id, which is the whole defect.
        if (seen.kind !== 'proposal') return json({ ok: false, error: seen.kind, file: seen.file, detail: seen.detail }, 422);
        return json({ ok: true, from: out.from, ms: out.ms, engine: pick.id, proposal: seen.proposal });
      } finally {
        forgeRoundLive = false;
      }
    }

    // Which hands exist, and which of them this machine can actually use. PROBED — the binary is run
    // and only a clean exit counts — because a name on $PATH is not a working engine, the same way a
    // non-empty string was not a working key (surface/key.ts). Open like `/api/models`: it names
    // capabilities, never a path, a key or an identity, and a node that cannot forge saying so is the
    // honest answer rather than a secret.
    if (req.method === 'GET' && p === '/api/forge/engines') {
      // DELIBERATELY NOT GATED, and this was checked rather than assumed. An earlier round considered
      // this exact route and wrote its reason down in test/hosted-seatbelts.test.ts: "a node that
      // cannot forge saying so is the honest answer rather than a secret, and the surface paints the
      // engine pill before anyone has signed in."
      //
      // This lane gated it and the existing suite caught it. The brief asked whether a sibling read
      // route had been MISSED by the same reasoning; the answer for this one is no — it was considered
      // and decided. What that suite holds instead is the thing that actually matters here: the body
      // must never contain a PATH, including on the resolver-fails case, which it boots a door for.
      const { listEngines } = await import('../core/forge/engines');
      // The SAME check the round itself makes, not a second reading of the same variable.
      const { forgeArmedByEnv } = await import('../core/forge/crush');
      return json({ armed: forgeArmedByEnv(), engines: await listEngines() });
    }

    // ── AURA · the mount point, so the face never has to edit this file ─────────────────────────
    //
    // Lane 3 owns `core/aura/**` and `surface/app/aura/**` and nothing else. Without a seam here it
    // would have to reach into the door to serve its state, which is how two lanes end up writing one
    // file — the exact collision that produced a deleted constant and a twice-reverted banner.
    //
    // The contract, so it can be built against before it exists:
    //   · GET only. AURA is a projection of the record; it never accepts a write.
    //   · OPEN, AND SAID PLAINLY — this line used to read "Read-standing, like every other read route
    //     … `requestAction('read', …)` above already applied", and it was false three separate ways.
    //     There is no `'read'` action: `core/authority/standing.ts` is `'write' | 'execute' | 'spend'`
    //     and says "Read … NOT here, by design" directly above it, with standing 0 documented as
    //     allowed to read. `requestAction` is called at five sites, all write/spend/execute, none of
    //     them above this one in any control-flow sense — they are inside handlers that return. And
    //     there was no "every other read route" with read-standing, because none of them had it.
    //     MEASURED on a hosted door with an anonymous curl: 200, as it had been all along.
    //
    //     A comment describing a gate that does not exist is worse than no comment: it is the reason
    //     nobody checked. `test/hosted-seatbelts.test.ts` now asserts what a stranger actually gets
    //     from all three read routes, against a real door, so this paragraph can never drift again
    //     without something going red.
    //   · CONTENT-FREE, AND NOW MEASURED RATHER THAN ASSERTED. Verdict counts, ages, hashes, a mood.
    //     Never file contents, prompts, or command text. AURA is computed FROM receipts — which ARE
    //     now session-gated, a few routes down — and this stays open because a projection is strictly
    //     weaker than the thing projected: an aggregate, not an enumeration. Counts of receipts do not
    //     tell a stranger which files the owner touched or where his secrets live. That asymmetry is
    //     the whole argument for gating one and not the other, and the test fails if AURA ever starts
    //     returning a path or a prompt.
    //   · If `core/aura/state.ts` is absent this stays a 404 and the door does not care — the module
    //     is optional by construction, so a broken or half-built face can never take the node down.
    if (req.method === 'GET' && p === '/api/aura/state') {
      try {
        // THE SPECIFIER IS A VARIABLE, and that is the point rather than an accident. A literal
        // `import('../core/aura/state')` is resolved by the TYPECHECKER, which then reports TS2307
        // "cannot find module" for a module the paragraph above declares OPTIONAL BY CONSTRUCTION —
        // so `bunx tsc` was red on main for a file behaving exactly as designed. A dynamic import
        // whose target may not exist has to be dynamic to the types as well, or the type system is
        // asserting the opposite of what the code says. Runtime resolution is unchanged: Bun
        // resolves this at the call.
        //
        // THE MODULE EXISTS NOW — `core/aura/state.ts`, since `d25b3f1`. This paragraph used to end
        // "AURA's lane cannot make it green by building the module either (its PR adds mood.ts,
        // auraTrace.ts and seven siblings, and no state.ts)", which was true when written and stopped
        // being true two days later. The variable stays, and for a better reason than the one that
        // put it here: the module is optional BY DESIGN, so a node that ships without it must still
        // boot and answer 501. A literal specifier would make the door's honesty about an absent face
        // depend on that face being present at compile time.
        const AURA_STATE = '../core/aura/state';
        const aura = await import(AURA_STATE) as { auraStateForDoor?: () => Promise<unknown> };
        if (typeof aura.auraStateForDoor !== 'function') {
          return json({ ok: false, error: 'aura_not_wired', reason: 'core/aura/state.ts exports no auraStateForDoor()' }, 501);
        }
        // ══ BREATH RIDES BESIDE THE STATE, NEVER INSIDE IT ══
        //
        // A separate key, because they are separate KINDS of claim and the difference is Lane 3's
        // most important rule. `state` is the standing triad's input: a pure function of the ledger
        // head, no clock, so two machines reading one record draw the same figure — that is what
        // makes her an identity rather than a mood ring. `breath` is wall-clock by nature and rests
        // at zero.
        //
        // Folding breath into `state` would put a timestamp inside the thing that must not have one,
        // and the next reader would have no way to see which half was which. Two keys, and the fence
        // is legible from the response alone.
        let breath: { drive: number; pulses: number } | null = null;
        try {
          const c = await import('./cadence');
          breath = { drive: c.breathDrive(Date.now()), pulses: c.cadence().length };
        } catch { /* a face with no breath is still a face */ }
        return json({ ok: true, state: await aura.auraStateForDoor(), breath });
      } catch {
        // Not built yet. Honest 501 rather than a 500 that reads like a crash.
        return json({ ok: false, error: 'aura_absent', reason: 'core/aura/state.ts is not present on this node' }, 501);
      }
    }

    // ── THE LEDGER IS THE OWNER'S WORK HISTORY, and it is not a public document ────────────────────
    //
    // MEASURED against a door booted exactly as `scripts/serve-hosted.sh` boots one — `authRequired:
    // true, signedIn: false` — with a curl carrying no cookie and no bearer. It returned every row:
    //
    //   {"kind":"applied","id":"p_abc123","files":["surface/auth.ts","core/authority/vowRecord.ts"],
    //    "at":"2026-08-01T11:02:31.552Z"}
    //   {"kind":"refused-path","files":["secrets/deploy.pem"],
    //    "reason":"law:protected-path secrets/deploy.pem","at":"2026-08-01T11:05:02.100Z"}
    //
    // `core/forge/review.ts` calls a receipt CONTENT-FREE and it is right: no patch, no instruction.
    // But that bar was written about what a receipt STORES, and this is a question about who may READ
    // one. What a stranger takes from the rows above is which files the owner edits, when he works, to
    // the millisecond — and, from the refusals, a map of exactly where the protected things are. The
    // fence advertising its own valuables is the sharpest edge of it.
    //
    // `requireSession` and not a new standing. `core/authority/standing.ts` is deliberately
    // write-shaped — `'write' | 'execute' | 'spend'`, with "Read … NOT here, by design" written above
    // it, and standing 0 documented as being allowed to read. Inventing a `'read'` action to fix a
    // comment would contradict that file's stated design; asking whether this request is from a
    // signed-in human is the question that was actually missing, exactly as it was for `/api/hands/*`.
    // On a local node `authRequired()` is false and `requireSession` waves everything through, so a
    // sovereign node is completely unaffected.
    if (req.method === 'GET' && p === '/api/forge/receipts') {
      const who = requireSession(req);
      if (!who.ok) return who.response;
      const review = await import('../core/forge/review');
      return json({ receipts: await review.receipts() });
    }

    // ── her hands: read and check are free, acts are proposed ───────────────────────────────────
    if (req.method === 'POST' && p.startsWith('/api/hands/')) {
      // ══ TWO GATES THAT WERE BOTH MISSING, AND WHY NEITHER EXISTING ONE COVERED THIS ══
      //
      // MEASURED against a door booted exactly as `scripts/serve-hosted.sh` boots one (HOSTED=1,
      // FORGE=1): an anonymous POST reached every verb below. `/api/hands/read` returned 200 with
      // repository file content to a request carrying no session at all, and `commit-push` — which
      // RUNS rather than proposing — reaches the owner's real GitHub remote.
      //
      // The two gates already on this route both pass, and both are correct to pass:
      //
      //   localPost(req)     is an ORIGIN fence, and `if (HOSTED) return {ok:true}` is deliberate —
      //                      behind a reverse proxy the origin header is not ours to judge.
      //   requestAction(...) reads STANDING, and AUKORA_FORGE=1 ⇒ `owner`. That is a true statement
      //                      about the OPERATOR who armed this process, and says nothing whatsoever
      //                      about who is on the other end of this particular socket.
      //
      // Neither is a bug. The bug is that nothing asked the third question — *is this request from a
      // signed-in human* — so two correct answers composed into an open door. `requireSession` has
      // existed this whole time and was simply never called here.
      //
      // ARMED-OFF BY DEFAULT, matching the lab's own fix: shell and push are not something a hosted
      // glass should offer merely because someone armed the forge. `AUKORA_HANDS=1` is a second,
      // explicit decision, and its absence is the safe reading.
      if (HOSTED && process.env.AUKORA_HANDS !== '1') {
        return json({
          ok: false,
          error: 'hands_disabled',
          reason: 'Hands (shell/push) are off on this glass. Use the Crush forge and Accept.',
        }, 403);
      }
      // The session gate applies to EVERY verb, including the read-only ones. On a node a stranger
      // can reach, `read` is disclosure of repository contents — it is the verb most likely to be
      // waved through as harmless, and it is the one that leaks.
      const who = requireSession(req);
      if (!who.ok) return who.response;

      const guard = localPost(req);
      if (!guard.ok) return json({ error: `refused: ${guard.why}` }, 403);
      const verb = p.slice('/api/hands/'.length);
      // `commit-push` is the record panel's ship button: the click itself authorizes, so it is a write
      // verb that runs rather than a proposal the owner accepts twice.
      const writes = ['commit', 'push', 'restart', 'act', 'command', 'commit-push'].includes(verb);
      const stand = requestAction(writes ? 'write' : 'execute', 'her hands');
      if (!stand.ok) return json({ ok: false, error: stand.class, class: stand.class, standing: stand.standing, reason: stand.reason }, 403);

      let b: Record<string, unknown> = {};
      try { b = await req.json() as Record<string, unknown>; } catch { /* several verbs take nothing */ }
      const s = (k: string) => (typeof b[k] === 'string' ? b[k] as string : '');
      const hands = await import('../core/forge/hands');

      switch (verb) {
        case 'read':      return json(await hands.readRepoFile(s('path')));
        case 'find':      return json(await hands.searchRepo(s('query')));
        case 'status':    return json(await hands.repoStatus());
        case 'diff':      return json(await hands.repoDiff(s('path') || undefined));
        case 'test':      return json(await hands.runTests(s('scope') || undefined));
        case 'typecheck': return json(await hands.runTypecheck());
        case 'commit':    return json(await hands.proposeCommit(s('message')));
        case 'push':      return json(await hands.proposePush());
        case 'commit-push': return json(await hands.commitAndPush());
        case 'restart':   return json({ ok: true, act: hands.proposeRestart(s('why')) });
        case 'command':   return json(hands.proposeCommand(s('cmd'), Array.isArray(b.args) ? b.args as string[] : [], s('why')));
        case 'act':       return json(await hands.doAct(s('id')));
        default:          return json({ ok: false, error: 'unknown hand' }, 404);
      }
    }

    // ── what the recovery net had to undo, said once ────────────────────────────────────────────
    if (req.method === 'GET' && p === '/api/recovered') {
      // The dead-door note is a crash record from the owner's own process — paths, and whatever the
      // failure was carrying. Not a stranger's to read.
      const who = requireSession(req);
      if (!who.ok) return who.response;
      const dead = await import('../core/forge/deadDoor');
      return json({ note: await dead.takeNote() });
    }

    if (req.method === 'GET') return serveStatic(p);
    return new Response('method not allowed', { status: 405 });
  },
}) as unknown as { port: number };

// The door answered, so stand the dead-door net down: whatever booted, booted.
void (async () => { try { (await import('../core/forge/deadDoor')).disarmWatch(); } catch { /* best effort */ } })();

// The ACTUAL bound port — identical to the requested one unless AUKORA_PORT=0 asked for an ephemeral
// one, in which case this is the only place that number exists until the line below prints it.
PORT = server.port;
ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  `http://0.0.0.0:${PORT}`,
  ...((process.env.AUKORA_PUBLIC_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean)),
]);

const stand = standingReport();
const grok = grokAuthStatus();
const shown = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
console.log(`\n  φ  http://${shown}:${PORT}` + (HOST === '0.0.0.0' ? '  (bound 0.0.0.0)' : ''));
console.log(`     standing: ${stand.standing}${stand.canCreate ? '' : ' — cannot write'}   key: ${keyStatus().present ? keyStatus().from : 'NOT SET'}   grok: ${grok.present ? 'yes' : 'NOT SET'}`);
if (HOSTED) console.log('     hosted:   yes — origin fence relaxed (docs/HOSTED.md)');
console.log('     Intelligence may propose. Only the owner authorizes.\n');
