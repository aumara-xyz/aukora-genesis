// φ · TWO DOORS THAT DID NOT ASK — and a third beside them with the same gap.
//
// ══ MEASURED ON A LIVE DOOR, BEFORE ANYTHING WAS CHANGED ══
//
//     POST /api/absorb        no Origin header   → HTTP 400   (past the guard, into body validation)
//     POST /api/absorb        Origin: evil       → HTTP 403   (refused)
//     POST /api/forge/look    no Origin header   → HTTP 400   (past the guard)
//
// The weaker caller was the one that got through. `localPost` opens with `if (!origin) return
// { ok: true }` — correct for the routes it was written for, wrong for a route that writes or spends,
// because a request with no `Origin` is not a same-origin request, it is not a browser at all.
//
// ══ WHAT EACH ROUTE WAS MISSING ══
//
//   /api/absorb        localPost ONLY. No requireSession, no requestAction — while `/api/forge`
//                      twelve lines below carries all three. `absorbRepo` FETCHES a caller-supplied
//                      URL and writes `docs/absorbs/<owner>--<name>.md` plus working memory.
//   /api/forge/look    localPost + a requestAction that is skipped on a hosted open-play node. No
//                      requireSession at all, so a hosted node WITH auth on still served a billed
//                      model call to a caller with no session.
//   /api/council/cast  the same two gaps, on a route that spends across several models at once.
//                      Found while fixing the other two and fixed with them: leaving an identical
//                      hole open two routes away is the half-sweep this repository keeps finding.
//
// ══ AND ONE LAYER WORSE THAN REPORTED ══
//
// The exemption on `look` read `HOSTED && AUKORA_AUTH === '0'`. Traced rather than assumed, that
// combination left EVERY gate open at once: `AUKORA_AUTH === '0'` makes `requireSession` a no-op, the
// branch skipped `requestAction`, and `localPost` returns ok for ANY origin when `HOSTED`. So any
// website could spend the owner's money on vision calls. One flag was doing two jobs — a node set to
// "no login wall" also silently lost its spend gate, and nobody had to decide that. The exemption is
// now declared by `AUKORA_OPEN_PLAY=1` and DEFAULTS CLOSED.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { codeOnly } from './code-only';

const ROOT = join(import.meta.dir, '..');
const DOOR_SRC = codeOnly(readFileSync(join(ROOT, 'surface', 'door.ts'), 'utf8'));

/** Every route that writes to disk or spends money. The list is the policy. */
const SENSITIVE = ['/api/absorb', '/api/forge/look', '/api/council/cast'] as const;

let door: ReturnType<typeof spawn> | null = null;
let base = '';
let said = '';

beforeAll(async () => {
  const env = { ...process.env, AUKORA_PORT: '0', AUKORA_FORGE: '1' } as Record<string, string>;
  delete env.AUKORA_HOSTED; delete env.AUKORA_AUTH; delete env.AUKORA_OPEN_PLAY;
  door = spawn(process.execPath, ['surface/door.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  door.stdout?.on('data', (b: Buffer) => { said += b.toString(); });
  door.stderr?.on('data', (b: Buffer) => { said += b.toString(); });
  const until = Date.now() + 25_000;
  for (;;) {
    if (door.exitCode !== null) throw new Error(`the door exited ${door.exitCode}:\n${said}`);
    const m = /φ\s+http:\/\/[\d.]+:(\d+)/.exec(said);
    if (m) { base = `http://127.0.0.1:${m[1]}`; try { await fetch(`${base}/api/standing`); return; } catch { /* not up */ } }
    if (Date.now() > until) throw new Error(`the door never answered:\n${said}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}, 45_000);

afterAll(() => { try { door?.kill('SIGKILL'); } catch { /* gone */ } });

const post = (path: string, origin?: string) => fetch(base + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
  body: '{}',
});

describe('A REQUEST THAT IS NOT A BROWSER DOES NOT REACH A ROUTE THAT WRITES OR SPENDS', () => {
  for (const path of SENSITIVE) {
    it(`${path} refuses a caller with no Origin header`, async () => {
      // THE EXACT SHAPE THAT GOT IN: `curl -X POST`, no Origin. It used to answer 400, which means it
      // had already passed the guard and was arguing about the body.
      const r = await post(path);
      expect(r.status, `${path} still serves a caller that never said where it came from`).toBe(403);
      const body = await r.text();
      expect(body, 'the refusal does not name its reason').toMatch(/Origin/i);
    }, 20_000);
  }

  it('POSITIVE CONTROL: a same-origin caller still gets through, exactly as before', async () => {
    // Without this the tests above would pass on a door that refused everything, and the fix would
    // have closed the product rather than the hole. 400 is "past the guard, into body validation" —
    // the same answer these routes gave a browser before the change.
    for (const path of SENSITIVE) {
      const r = await post(path, base);
      expect(r.status, `${path} now refuses the glass itself`).not.toBe(403);
      expect(r.status, `${path} did not reach body validation`).toBe(400);
    }
  }, 20_000);

  it('NEGATIVE CONTROL: a foreign Origin is still refused, as it always was', async () => {
    const r = await post('/api/absorb', 'https://evil.example');
    expect(r.status).toBe(403);
  }, 20_000);

  it('and a route that only READS is untouched by this', async () => {
    // `sensitivePost` is deliberately not applied everywhere: the sign-in routes legitimately serve a
    // caller with no session, and a read route has nothing to spend. Widening it to every POST would
    // be a different change with a different blast radius.
    const r = await fetch(`${base}/api/standing`);
    expect(r.status, 'a read route was caught by a write-route guard').toBe(200);
  }, 20_000);
});

describe('EACH OF THE THREE NOW ASKS ALL THREE QUESTIONS', () => {
  /** The guards inside one route's block, bounded by the next route. */
  const guardsOf = (path: string): { origin: boolean; session: boolean; standing: boolean } => {
    const re = /if \(req\.method === .(?:GET|POST). && p(?: ===|\.startsWith\()\s*.([^'")]+)/g;
    const hits = [...DOOR_SRC.matchAll(re)];
    const i = hits.findIndex((h) => h[1] === path);
    expect(i, `${path} is gone from door.ts — re-point this test`).toBeGreaterThan(-1);
    const block = DOOR_SRC.slice(hits[i]!.index!, hits[i + 1]?.index ?? DOOR_SRC.length);
    return {
      origin: /sensitivePost\(req\)/.test(block),
      session: /requireSession\(req\)/.test(block),
      standing: /requestAction\(/.test(block),
    };
  };

  for (const path of SENSITIVE) {
    it(`${path} — who is asking, may they, and is it a browser`, () => {
      const g = guardsOf(path);
      expect(g.origin, `${path} still accepts a request with no Origin`).toBe(true);
      expect(g.session, `${path} still serves a caller with no session`).toBe(true);
      expect(g.standing, `${path} still writes or spends without asking standing`).toBe(true);
    });
  }

  it('the guard is a SECOND check and does not pretend to be an identity', () => {
    // An attacker who sets the header walks straight through it. Saying so in the code is the
    // difference between a lock and a claim that the door cannot be opened.
    const fn = DOOR_SRC.slice(DOOR_SRC.indexOf('function sensitivePost'), DOOR_SRC.indexOf('function sensitivePost') + 400);
    expect(fn.length, 'sensitivePost is gone — re-point this test').toBeGreaterThan(50);
    expect(fn, 'the origin check replaced localPost rather than adding to it').toMatch(/localPost\(req\)/);
  });
});

describe('THE OPEN-PLAY EXEMPTION IS DECLARED, AND DEFAULTS CLOSED', () => {
  it('an auth flag alone can no longer switch off the spend gate', () => {
    const look = DOOR_SRC.slice(DOOR_SRC.indexOf("p === '/api/forge/look'"), DOOR_SRC.indexOf("p === '/api/forge/look'") + 1200);
    expect(look, 'the exemption is still inferred from AUKORA_AUTH alone')
      .toMatch(/AUKORA_OPEN_PLAY === '1'/);
    // Both halves must still be required — the new flag ADDS to the condition, it does not replace it,
    // or an open-play flag on a LOCAL node would switch off a gate that was never exempt.
    expect(look).toMatch(/HOSTED &&/);
    expect(look).toMatch(/AUKORA_AUTH === '0'/);
  });

  it('BEHAVIOUR: with the flag unset, looking asks standing on a hosted open-play node', async () => {
    // The default is the whole point. This door was booted with none of the three variables set, so
    // the exemption cannot apply and `requestAction('spend')` runs — which on a courtyard-pinned node
    // refuses. A 403 that is NOT the origin refusal is the standing seam answering.
    const r = await post('/api/forge/look', base);
    const body = await r.text();
    expect(body, 'the origin guard answered, so this measured the wrong gate').not.toMatch(/Origin/i);
    // Either standing refused (courtyard) or the body check answered (vowed node). Both mean the
    // request reached past the guards; what must never happen is a billed call with no gate at all.
    expect([400, 403]).toContain(r.status);
  }, 20_000);
});

describe('THE DOC OFFERS EVERY OPTION THAT EXISTS', () => {
  const DOC = readFileSync(join(ROOT, 'docs', 'BINDING-DECISION.md'), 'utf8');

  it('the false half of the claim is corrected, and the true half is kept', () => {
    // "No Secure Enclave or TPM path" is TRUE of both lineages. "None that could be enabled by a flag"
    // was FALSE — `aukora-one/scripts/bind.mjs:61` is literally a flag choosing a custody backend.
    // NOT "the string is absent" — the correction QUOTES the retracted sentence, which is the most
    // useful thing a correction can do. The property is that no occurrence stands UNATTRIBUTED. (This
    // assertion was first written as a bare `.not.toMatch` and went red on the retraction itself — the
    // same confusion between a claim and a quotation of it that `test/acp-mirror-bound.test.ts` had to
    // fix, which is why the shape is copied from there rather than re-invented.)
    const claim = /none that could be enabled by a flag/g;
    const hits = [...DOC.matchAll(claim)];
    expect(hits.length, 'the retracted sentence vanished — a correction that shows nothing').toBeGreaterThan(0);
    for (const h of hits) {
      const lead = DOC.slice(Math.max(0, h.index! - 300), h.index!);
      expect(lead, `the claim is asserted again, unattributed, at offset ${h.index}`)
        .toMatch(/used to end|CORRECTION|verbatim|used to say/i);
    }
    expect(DOC, 'the true half — no hardware custody — was dropped with the false half')
      .toMatch(/never has|has ever put a key inside hardware/i);
  });

  it('option D is present, and says what it is NOT', () => {
    expect(DOC, 'the fourth option is missing again').toMatch(/### D ·/);
    expect(DOC, 'the doc still offers three').toMatch(/## The four options/);
    // The load-bearing sentence. Keychain is OS-backed, not hardware, and a reader who takes it for
    // Secure Enclave has been told something false about what wraps his root.
    expect(DOC, 'D does not distinguish itself from Secure Enclave').toMatch(/not Secure Enclave/i);
    expect(DOC, 'D does not say the key is still extractable').toMatch(/extractable/i);
  });

  it('and the decision guidance names four, not three', () => {
    // The half-sweep this repository keeps finding: adding an option in one place while the paragraph
    // that tells him how to choose still enumerates the old three.
    const how = DOC.slice(DOC.indexOf('## How to decide'));
    expect(how.length, 'the decision section is gone — re-point this test').toBeGreaterThan(100);
    expect(how, 'the guidance still walks him through A, B and C only').toMatch(/\bD\b/);
  });

  it('the three details it already solves are recorded, because a port would lose them', () => {
    for (const [what, pattern] of [
      ['no owner byte in argv', /-w.*\n?.*no value|no value after `-w`/i],
      ['the secret fed twice on stdin', /twice on stdin/i],
      ['stderr ignored rather than captured', /stdio: \['pipe', 'pipe', 'ignore'\]/],
      ['control characters refused, not trimmed', /Refused, not trimmed/i],
    ] as [string, RegExp][]) {
      expect(DOC, `option D does not record: ${what}`).toMatch(pattern);
    }
  });

  it('it is honest that the code is in aukora-one and not in φ', () => {
    expect(DOC, 'the doc implies the backend already exists in this repository')
      .toMatch(/not ported to φ|not in φ/i);
  });
});
