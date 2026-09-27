// SHE WAS BUILT TO SEE AND THE WIRE WAS NEVER CONNECTED.
//
// ══ THE MEASUREMENT THIS FILE EXISTS FOR ══
//
// Three call sites in the surface POST to `/api/forge/look` — `surface/app/sight.js` twice and
// `surface/app/surface-chat.js` once. `surface/door.ts` had no such route. Every one of those calls
// fell through to the generic `POST /api/forge` handler, which demands an `instruction`, so every
// attempt to look answered:
//
//     POST /api/forge/look  →  HTTP 400  {"ok":false,"error":"an instruction is required"}
//
// `core/forge/crush.ts` has exported `look(dataUrl, goal, mode)` the whole time. The eye existed, the
// server-side vision call existed, and nothing joined them — while she told the owner she could look at
// his screen. That is the fourth documented false narration in this repository, and the eye is the
// easiest place in it to make a fifth.
//
// ══ WHAT IS ASSERTED HERE, AND WHY IN THREE DIFFERENT WAYS ══
//
//   · THE LIVE DOOR, spawned, asked over a socket. A route that exists in source and not in the running
//     process is exactly the defect above, and only a running process can disprove it. The child is
//     given a scratch HOME and no key, so a look reaches the vision call and stops there — no network,
//     no spend, and the failure path is the one being tested anyway.
//   · THE REAL FORGE ROUND, with a fake engine, to read what the hand was actually told. The one rail
//     this feature could break is the oldest one in the repository: his words reach the engine unedited.
//   · THE BROWSER MODULES, imported into the runner. `sight.js` no longer touches `window` at import,
//     so its decisions — which instrument this turn needs, and what she says when the eye is blind —
//     are ordinary functions a test can call rather than strings to grep for.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { spawn, type ChildProcess, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, realpathSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

import { LOOK_IMAGE_MAX } from '../core/forge/crush';
import { asksToSee, asksAboutAppearance, isAppearanceTurn, sayWhy, blindNote, look } from '../surface/app/sight.js';

const ROOT = new URL('..', import.meta.url).pathname;

/** The smallest thing that satisfies crush.look's own shape check. Not a picture of anything. */
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ── WHICH INSTRUMENT THIS TURN NEEDS ───────────────────────────────────────────────────────────────

describe('the turn decides whether she looks, not a setting', () => {
  it('an instruction about how something LOOKS attaches the eye', () => {
    for (const t of [
      'the spacing is wrong',
      'this is broken',
      'make it nicer',
      'it looks wrong',
      'the buttons are not aligned',
      'the composer padding is too tight',
      'that colour is too dark',
      'the header text is cut off',
      'tidy up the layout of the left lane',
      'the panels overlap',
    ]) expect(isAppearanceTurn(t), t).toBe(true);
  });

  it('an ordinary instruction does NOT — a vision call is the owner\'s money', () => {
    for (const t of [
      'add a test for the receipts ledger',
      'rename that file',
      'make the timeout longer',
      'fix the typo in the readme',
      'what does the door do',
      'commit this',
      'run the tests',
      'read core/forge/review.ts and tell me what capture does',
    ]) expect(isAppearanceTurn(t), t).toBe(false);
  });

  it('asking to SEE still attaches it, exactly as it did before', () => {
    // `asksToSee` was already here and is not replaced — the appearance test is added ALONGSIDE it.
    expect(asksToSee('can you see the screen I am on right now')).toBe(true);
    expect(isAppearanceTurn('what is on the screen')).toBe(true);
    expect(asksAboutAppearance('what is on the screen')).toBe(false);
  });
});

// ── SAYING SO WHEN THE EYE IS BLIND ────────────────────────────────────────────────────────────────

describe('a blind eye says so in plain words', () => {
  it('every refusal the door can return has a sentence a person can read', () => {
    for (const code of ['look_no_key', 'forge_not_armed', 'look_image_too_large', 'look_not_an_image',
      'look_empty', 'look_http_429', 'look_failed: connect ECONNREFUSED', 'refused-no-standing']) {
      const said = sayWhy(code);
      expect(said.length, code).toBeGreaterThan(12);
      // The code itself is not an explanation. `look_no_key` on screen is the same failure as no message.
      expect(said, code).not.toBe(code);
    }
  });

  it('an unrecognised code is still reported rather than swallowed', () => {
    expect(sayWhy('look_something_new').length).toBeGreaterThan(12);
    expect(sayWhy('').length).toBeGreaterThan(12);
  });

  it('the note she says never comes back empty, whatever it is handed', () => {
    for (const r of ['', undefined, null, 'the page could not draw itself']) {
      const note = blindNote(r as string);
      expect(note.length).toBeGreaterThan(30);
      // It must say she did NOT see, not merely that something went wrong.
      expect(/could not (look|see)/i.test(note), String(r)).toBe(true);
    }
  });
});

// ── A CAPTURE FAILURE IS REPORTED, NOT SWALLOWED ───────────────────────────────────────────────────

/**
 * The smallest DOM that lets `readSurface` and `captureElement` run for real.
 *
 * Zero-sized on purpose: that is the state `captureElement` refuses from — "the page reports no size at
 * all" — so this exercises the genuine failure path rather than a mock of it.
 */
function stubDom(): void {
  const rect = () => ({ left: 0, top: 0, width: 0, height: 0 });
  const body = {
    tagName: 'BODY', id: '', className: '', children: [], childNodes: [], disabled: false,
    getBoundingClientRect: rect, getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    cloneNode: () => body,
  };
  Object.assign(globalThis, {
    window: { innerWidth: 0, innerHeight: 0, location: { origin: 'http://127.0.0.1:7400' } },
    document: { title: 'φ', body, querySelector: () => null },
    getComputedStyle: () => ({
      display: 'block', visibility: 'visible', opacity: '1',
      backgroundColor: '#0b0d18', getPropertyValue: () => '',
    }),
  });
}
function unstubDom(): void {
  for (const k of ['window', 'document', 'getComputedStyle']) Reflect.deleteProperty(globalThis, k);
}

describe('she does not claim to have looked when she did not', () => {
  beforeEach(stubDom);
  afterEach(unstubDom);

  it('a capture that fails comes back marked blind, with the reason', async () => {
    // An appearance turn, so the pixels are genuinely wanted — and the page cannot draw itself.
    const out = await look('the spacing is wrong');
    expect(out.structural).toBe(true);            // it fell back to the tree, which is fine
    expect(out.blind, 'a fallback with no `blind` is exactly the silent lie this file exists for')
      .toBeTruthy();
    expect(String(out.blind)).toMatch(/no size at all|could not/i);
    // …and the source line must not read as though a picture was taken.
    expect(String(out.source)).not.toMatch(/looked at/);
  });

  it('an ordinary read is NOT marked blind — the tree is the right answer, not a failure', async () => {
    const out = await look('what is on this screen', { forcePixels: false });
    expect(out.structural).toBe(true);
    expect(out.blind).toBeUndefined();
  });
});

// ── THE OWNER'S WORDS, AFTER THE EYE HAS SPOKEN ────────────────────────────────────────────────────

describe('the eye is context for the hand, never a rewrite of the instruction', () => {
  let repo = '';
  let prevRepo: string | undefined;
  let prevForge: string | undefined;

  beforeEach(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-sight-')));
    execFileSync('git', ['-C', repo, 'init', '-q']);
    writeFileSync(join(repo, 'tracked.txt'), 'original\n');
    execFileSync('git', ['-C', repo, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'first'], { stdio: 'ignore' });
    prevRepo = process.env.AUKORA_FORGE_REPO; prevForge = process.env.AUKORA_FORGE;
    process.env.AUKORA_FORGE_REPO = repo;
    process.env.AUKORA_FORGE = '1';
  });
  afterEach(() => {
    if (prevRepo === undefined) delete process.env.AUKORA_FORGE_REPO; else process.env.AUKORA_FORGE_REPO = prevRepo;
    if (prevForge === undefined) delete process.env.AUKORA_FORGE; else process.env.AUKORA_FORGE = prevForge;
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* gone */ }
  });

  async function freshForge() {
    return import(`../core/forge/crush.ts?t=${Math.random()}`) as Promise<typeof import('../core/forge/crush')>;
  }

  const ASK = 'the composer padding is too tight — take it down a notch';
  const SAW = 'I can see the composer sitting flush against the left edge with no gap at all.';

  it('THE INSTRUCTION IS BYTE-IDENTICAL WITH AND WITHOUT THE EYE', async () => {
    // The defect this project removed twice: a model that paraphrases his sentence on the way to the
    // hand. A vision model in the path is the third opportunity, and it must not take it.
    const seen: string[] = [];
    const engine = async (task: string) => { seen.push(task); return { code: 0, out: 'ok' }; };

    const { forge } = await freshForge();
    await forge(ASK, { engine });
    await forge(ASK, { engine, sight: SAW });

    expect(seen.length).toBe(2);
    expect(seen[0]).toBe(ASK);
    expect(seen[1]).toBe(seen[0]);
  });

  it('what the eye saw reaches the hand — in the BRIEF, which is not the instruction', async () => {
    let brief = '';
    let task = '';
    const { forge } = await freshForge();
    await forge(ASK, {
      sight: SAW,
      engine: async (t, ctx) => { task = t; brief = ctx.brief ?? ''; return { code: 0, out: 'ok' }; },
    });
    expect(task).toBe(ASK);
    expect(brief).toContain(SAW);
    // Fenced and named as an observation. A description of a screen can contain any words at all,
    // including words shaped like orders — the same reasoning as the prior-rounds fence in repair.ts.
    expect(brief).toMatch(/not an instruction/i);
  });

  it('a round with no eye carries nothing the eye would have added', async () => {
    // THE PROPERTY, RE-ANCHORED — not relaxed. This asserted `brief === FORGE_CONTEXT`, byte for byte.
    // That was a PROXY for "no eye contributed anything", and it broke in 8cb6e83 when the build brief
    // gained a "MAKE A CHANGE. Build mode is ON." preamble — a change about Build mode with nothing to
    // do with sight. The proxy failed while the property it stood for held perfectly.
    //
    // Byte-equality with the whole brief made this suite a tripwire on every future edit to
    // `BRIEF_FOR`, which is not its business. What IS its business is the seam: with no eye, nothing
    // the eye produces may appear, and the standing context must still be there in full.
    let brief = '';
    const { forge, FORGE_CONTEXT } = await freshForge();
    await forge(ASK, { engine: async (_t, ctx) => { brief = ctx.brief ?? ''; return { code: 0, out: 'ok' }; } });
    expect(brief).toContain(FORGE_CONTEXT);
    expect(brief).not.toContain(SAW);
    // The fence itself — `sightBlock` writes it, and it is the one string that exists only when an eye
    // spoke. Its absence is the assertion.
    expect(brief).not.toMatch(/not an instruction/i);
  });
});

// ── THE LIVE DOOR ──────────────────────────────────────────────────────────────────────────────────

let armed: ChildProcess | null = null;
let courtyard: ChildProcess | null = null;
let armedBase = '';
let courtyardBase = '';
let scratch = '';
let armedSaid = '';

// PORT DISCOVERY, NOT A GUESS — the same fix and the same reason as test/engines.test.ts, which this
// file's random range (34000–41999) exactly duplicated. This file spawns TWO doors per run on top of
// that, so it doubled its own exposure to the collision as well as its exposure to every other file
// drawing from the same range while bun's default test concurrency runs several `beforeAll`s at once.
// `AUKORA_PORT=0` asks the OS for a free port instead; `surface/door.ts` hands the number it actually
// bound back over stdout (`server.port`), which is what this loop scans for before it ever calls fetch.
async function startDoor(extra: NodeJS.ProcessEnv): Promise<{ child: ChildProcess; base: string; said: () => string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  env.AUKORA_PORT = '0';
  // CONTAINMENT, the same shape test/engines.test.ts uses: PATH holds only the Bun that starts the
  // child, and the forge's idea of "the repository" is an empty scratch directory.
  env.PATH = dirname(process.execPath);
  env.AUKORA_FORGE_REPO = scratch;
  // NO KEY, DELIBERATELY. `surface/key.ts` reads the environment and then $HOME, so a scratch HOME with
  // the variable removed is a node that cannot spend anything. A test that could reach OpenRouter would
  // be a test that bills the owner every time the suite runs.
  delete env.OPENROUTER_API_KEY;
  env.HOME = scratch;
  // ── THE EYE MUST NOT REACH A REAL GPU FROM A TEST ──────────────────────────────────────────────
  //
  // MEASURED, the moment AUMA became the first eye: this suite went red because the door child
  // SUCCEEDED. The developer machine had an SSH tunnel up to a live 32B vision model, `look()` asked
  // it first, and it answered — so a test asserting `look_no_key` got a real critique instead.
  //
  // That is not the test being wrong. That is the test correctly detecting that it had stopped being
  // hermetic: its result had come to depend on whether a rented box in another country was awake.
  //
  // Port 1 needs root to bind, so nothing is ever listening there. The eye's first stop is therefore
  // an authoritative `missing`, the chain falls through to the local weights (absent in `scratch`) and
  // then to the billed remote path (no key), and the assertion below measures the thing it was written
  // to measure. It also makes the FALLTHROUGH itself a tested property rather than a hoped-for one.
  env.AUKORA_AUMA_URL = 'http://127.0.0.1:1/v1';

  let said = '';
  let base = '';
  const child = spawn(process.execPath, ['surface/door.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (b: Buffer) => { said += b.toString(); });
  child.stderr?.on('data', (b: Buffer) => { said += b.toString(); });

  const until = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the door exited ${child.exitCode}:\n${said}`);
    if (!base) {
      const heard = /φ\s+http:\/\/127\.0\.0\.1:(\d+)/.exec(said);
      if (heard) base = `http://127.0.0.1:${heard[1]}`;
    }
    if (base) {
      try {
        const r = await fetch(`${base}/api/models`);
        if (r.ok) { await r.text(); return { child, base, said: () => said }; }
      } catch { /* not listening yet */ }
    }
    if (Date.now() > until) throw new Error(`the door never answered on its ephemeral port:\n${said}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}

// ORIGIN, BECAUSE THIS HARNESS STANDS IN FOR THE GLASS. `/api/forge/look` writes nothing but SPENDS,
// and it now refuses a caller that sends no `Origin` header: a request with none is not a same-origin
// request, it is not a browser at all — and `curl -X POST` was reaching it. The Fetch standard sends
// this on every non-GET request, so a real composer always carries it and a fixture that omits it is
// testing a curl. Same reasoning as `test/ceremony-door.test.ts`, whose harness sets `host` because
// the door fences every POST to its own origin.
const post = (base: string, path: string, body: unknown) => fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body),
});

beforeAll(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-sight-door-')));
  const a = await startDoor({ AUKORA_FORGE: '1', AUKORA_COURTYARD: undefined as unknown as string });
  armed = a.child; armedBase = a.base; armedSaid = '';
  a.child.stdout?.on('data', (b: Buffer) => { armedSaid += b.toString(); });
  a.child.stderr?.on('data', (b: Buffer) => { armedSaid += b.toString(); });
  const c = await startDoor({ AUKORA_COURTYARD: '1', AUKORA_FORGE: undefined as unknown as string });
  courtyard = c.child; courtyardBase = c.base;
}, 40_000);

afterAll(() => {
  try { armed?.kill('SIGKILL'); } catch { /* gone */ }
  try { courtyard?.kill('SIGKILL'); } catch { /* gone */ }
  try { if (scratch) rmSync(scratch, { recursive: true, force: true }); } catch { /* gone */ }
});

describe('POST /api/forge/look exists on the running door', () => {
  it('IS NOT THE GENERIC FORGE HANDLER — the whole defect was falling through to it', async () => {
    const res = await post(armedBase, '/api/forge/look', { image: TINY_PNG, goal: 'what is on this screen', mode: 'describe' });
    const body = await res.json() as Record<string, unknown>;
    // The measured symptom: 400 "an instruction is required", from `/api/forge`, for every look ever made.
    expect(body.error).not.toBe('an instruction is required');
    expect(res.status).not.toBe(400);
    // The honest end of the road is the EYE reporting its own state, rather than a route that does not
    // exist. WHICH state has now moved twice — `look_no_key` → `look_remote_refused` when the privacy
    // gate landed ahead of the billed path, and `look_remote_refused` → `look_frame_invalid` when the
    // frame started being inspected before inference. Both moves were correct and both turned this red,
    // because it was pinned to a SET OF SPELLINGS. So it is pinned to the property instead: every code
    // the eye owns is namespaced `look_`, and a router answering cannot produce one.
    expect(body.ok).toBe(false);
    expect(String(body.error),
      `the door answered ${JSON.stringify(body.error)}, which is not one of the eye's own codes — `
      + 'that is a router answering, which is the defect this test exists for').toMatch(/^look_[a-z_]+$/);
  });

  it('…and a 1x1 frame stops at the FRAME, before anything is asked about it', async () => {
    // The tighter half, added because the fixture above changed meaning under us. `TINY_PNG` is 1x1 —
    // there is nothing in it to look at, so the eye must now say so from the bytes alone rather than
    // travelling any further down the road. Measured on the wire through the real door, which is the
    // only place the ordering of inspect-then-infer can be observed rather than read.
    const res = await post(armedBase, '/api/forge/look', { image: TINY_PNG, goal: 'what is on this screen' });
    const body = await res.json() as Record<string, unknown>;
    expect(body.error, 'a frame with no subject must not reach a key check, a gate, or a model')
      .toBe('look_frame_invalid');
    expect(body.status, 'and it is VACUOUS — neither sight nor blindness').toBe('VACUOUS');
    const prov = body.provenance as Record<string, unknown> | undefined;
    expect(prov?.source, 'nothing was consulted, so no eye may be named').toBeNull();
    expect(prov?.subject).toBe('invalid');
  });

  it('refuses without standing, and the refusal is the named class', async () => {
    const res = await post(courtyardBase, '/api/forge/look', { image: TINY_PNG, goal: 'anything' });
    expect(res.status).toBe(403);
    const body = await res.json() as Record<string, unknown>;
    expect(body.class).toBe('refused-no-standing');
    expect(body.standing).toBe('courtyard');
  });

  it('the standing check runs BEFORE the body is read — a body that is not JSON is still a 403', async () => {
    // The one rule this door enforces in one place: a caller without standing must not be able to learn
    // about the route by varying what it sends.
    const res = await fetch(courtyardBase + '/api/forge/look', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: courtyardBase }, body: 'not json at all{{{',
    });
    expect(res.status).toBe(403);
    expect((await res.json() as Record<string, unknown>).class).toBe('refused-no-standing');
  });

  it('the route asks for standing before it reads the body, in the source as well as on the wire', () => {
    const src = readFileSync(join(ROOT, 'surface/door.ts'), 'utf8');
    const at = src.indexOf("p === '/api/forge/look'");
    expect(at, 'the route is not on the door at all').toBeGreaterThan(-1);
    const block = src.slice(at, at + 3_000);
    const standingAt = block.indexOf('requestAction(');
    const bodyAt = block.indexOf('req.json()');
    expect(standingAt).toBeGreaterThan(-1);
    expect(bodyAt).toBeGreaterThan(-1);
    expect(standingAt, 'the body was read before standing was asked for').toBeLessThan(bodyAt);
  });

  it('the look route is reached before the generic /api/forge handler', () => {
    const src = readFileSync(join(ROOT, 'surface/door.ts'), 'utf8');
    // `/api/forge/look` startsWith `/api/forge`, so an ordering mistake silently restores the 400.
    expect(src.indexOf("p === '/api/forge/look'")).toBeLessThan(src.indexOf("p.startsWith('/api/forge')"));
  });
});

describe('the picture is bounded, and never becomes a record', () => {
  it('an oversized image is REFUSED, not truncated', async () => {
    // Truncation would be worse than refusal: half a data URL decodes to nothing, and the model would
    // then answer confidently about an image that does not exist.
    const huge = 'data:image/png;base64,' + 'A'.repeat(LOOK_IMAGE_MAX + 1_000);
    const res = await post(armedBase, '/api/forge/look', { image: huge, goal: 'describe this' });
    expect(res.status).toBe(413);
    const raw = await res.text();
    expect(raw).toContain('look_image_too_large');
    // The refusal must not carry the thing it refused.
    expect(raw.length).toBeLessThan(2_000);
    expect(raw).not.toContain('AAAAAAAAAA');
  });

  it('the image never reaches the console, and never reaches a receipt', async () => {
    const marker = TINY_PNG.slice(-24);
    await post(armedBase, '/api/forge/look', { image: TINY_PNG, goal: 'what is on this screen', mode: 'describe' });
    await new Promise((r) => setTimeout(r, 200));
    expect(armedSaid).not.toContain('data:image');
    expect(armedSaid).not.toContain(marker);

    const receipts = await (await fetch(armedBase + '/api/forge/receipts')).text();
    expect(receipts).not.toContain('data:image');
    expect(receipts).not.toContain(marker);
    // A receipt carries a decision, never content. Looking is not even a decision — it writes nothing.
    expect(receipts).not.toContain('look');
  });

  it('something that is not an image is refused by shape, not sent to a vision model', async () => {
    const res = await post(armedBase, '/api/forge/look', { image: 'https://example.com/screen.png', goal: 'x' });
    expect(res.status).toBe(400);
    expect((await res.json() as Record<string, unknown>).error).toBe('look_not_an_image');
  });
});

// ── THE SURFACE ATTACHES IT ────────────────────────────────────────────────────────────────────────
//
// Structural, in the style of test/composer-routing.test.ts and for its stated reason: a browser test
// would prove today's build, and what matters is that the wiring cannot be quietly undone.

describe('the composer attaches the eye on an appearance turn', () => {
  const SRC = readFileSync(join(ROOT, 'surface/app/surface-chat.js'), 'utf8');

  it('uses sight.js rather than a second capture of its own', () => {
    expect(SRC).toMatch(/from '\.\/sight\.js'/);
    expect(SRC).toMatch(/captureElement/);
    // The canvas-only `captureSurface` was a second implementation that returned null on this surface —
    // the Unfolding ground is DOM, not canvas — so her eye was blind here even on the refine loop.
    expect(SRC).not.toMatch(/function captureSurface\(/);
  });

  it('THE EYE IS BOUNDED — it runs every turn now, so it may never hang the round', () => {
    // BEHAVIOUR CHANGE, a2e181f ("silent screen every turn"). This asserted `isAppearanceTurn(` was
    // called, and the policy it guarded — a vision call is the owner's money, so spend it only when
    // his sentence is about how something LOOKS — has been retired on purpose. The eye now runs before
    // every round, structure plus a silent screenshot, and `isAppearanceTurn` is imported and unused.
    //
    // The cost of that decision is real and is stated rather than hidden: every turn now spends a
    // vision call, including "rename that file". What the decision also did was make a NEW property
    // load-bearing, and it was measured the hard way — from the source, verbatim:
    //
    //   "this function runs unconditionally before EVERY chat/build round now … and neither
    //    captureElement nor the /api/forge/look fetch had a timeout … the composer showed the owner's
    //    own message and then nothing, forever, no error, no network request for the round at all."
    //
    // A per-turn eye with no deadline is a per-turn way to lose the composer. That is what this test
    // watches now: both slow paths are raced against a timeout, and the round survives a blind eye.
    const eye = /async function eyeFor\([\s\S]*?\n  \}\n/.exec(SRC)?.[0] ?? '';
    expect(eye).not.toBe('');
    expect(eye).toMatch(/withTimeout\(/);

    // ══ THE PROPERTY, NOT THE ADJACENCY ══
    //
    // This pinned `withTimeout(` immediately followed by `captureElement(`, and went red the day the
    // capture became a choice between two sources — the app's own surface, or the screen the owner
    // shared — with the deadline unchanged and still wrapping both. The property that matters is that
    // NO slow call sits outside a deadline; which token follows the paren is formatting.
    //
    // So: find every `withTimeout( … )` span, and require every slow call to be inside one.
    const spans: [number, number][] = [];
    for (const m of eye.matchAll(/withTimeout\(/g)) {
      let i = m.index + m[0].length - 1;
      let depth = 0;
      for (; i < eye.length; i += 1) {
        if (eye[i] === '(') depth += 1;
        else if (eye[i] === ')') { depth -= 1; if (depth === 0) break; }
      }
      spans.push([m.index, i]);
    }
    expect(spans.length, 'no withTimeout spans — re-point this test').toBeGreaterThanOrEqual(2);
    const inside = (at: number) => spans.some(([a, b]) => at > a && at < b);
    for (const slow of ['captureElement(', 'captureScreen(', 'fetch(']) {
      for (const m of eye.matchAll(new RegExp(slow.replace('(', '\\('), 'g'))) {
        expect(inside(m.index), `${slow} at offset ${m.index} is outside every deadline — a per-turn `
          + 'eye with no deadline is a per-turn way to lose the composer').toBe(true);
      }
    }
    // A timeout must RESOLVE, not reject — a rejection here is an unhandled rejection in a
    // `.finally()`-only chain, which is precisely how the last hang stayed invisible.
    expect(eye).toMatch(/Promise\.race\(\[[\s\S]*?setTimeout\(\(\) => resolve\(/);
  });

  it('what the eye saw travels as `saw`, beside the instruction and not inside it', () => {
    // THE FIELDS, NOT THEIR FORMATTING. This pinned `JSON.stringify({ instruction,` — the brace and
    // the first key on one line — and went red the day the POST body was broken across lines, with
    // nothing about the wire changed. An assertion a reformat can break is one people learn to ignore.
    const body = /\/api\/forge\/stream[\s\S]{0,1200}?JSON\.stringify\(\{([\s\S]*?)\}\),/.exec(SRC)?.[1] ?? '';
    expect(body).not.toBe('');
    // `saw` rides BESIDE the instruction as its own key…
    expect(body).toMatch(/(^|\s)saw,/);
    // …and the instruction on the wire is still his sentence, unjoined to it.
    expect(body).toMatch(/(^|\s)instruction,/);
    expect(body).not.toMatch(/instruction:.*saw/);
  });

  it('a blind eye is SAID in the turn, not swallowed into a silent DOM read', () => {
    expect(SRC).toMatch(/blindNote\(/);
  });
});
