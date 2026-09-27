// aura-core DETOKENIZED pins (AURA lane round 1). The tally writer is frozen:
// award() gates act QUALITY (junk/repeat/burst/clock refused) and fires a
// numberless pulse, but NO legacy tally field ever changes again — preserved,
// not displayed, not incremented. The integrity seal still guards the FROZEN
// legacy data (a devtools edit re-derives it from lesson evidence, loss-only).
// Browser globals are shimmed and restored so nothing leaks into other files.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
const RealDate = Date;
let NOW = 0;
const saved: Record<string, unknown> = {};

let core: any;
const SEAL_KEY = 'aukora-aura-seal-v1';
const hours = (h: number) => { NOW += h * 3600000; };
const msg = (t: string) => core.award('message', { text: t });

beforeAll(async () => {
  saved.localStorage = (globalThis as any).localStorage;
  saved.window = (globalThis as any).window;
  saved.CustomEvent = (globalThis as any).CustomEvent;
  saved.Date = globalThis.Date;
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };
  (globalThis as any).window = { dispatchEvent: () => true };
  (globalThis as any).CustomEvent = class { constructor(public type: string, public opts: unknown) {} };
  (globalThis as any).Date = class extends RealDate {
    constructor(...a: unknown[]) { a.length ? super(...(a as [number])) : super(NOW); }
    static now() { return NOW; }
  };
  // @ts-ignore - browser app module is plain JS; this test exercises it intentionally.
  core = await import('../../spatial/app/aura-core.js');
});
afterAll(() => {
  (globalThis as any).localStorage = saved.localStorage;
  (globalThis as any).window = saved.window;
  (globalThis as any).CustomEvent = saved.CustomEvent;
  (globalThis as any).Date = saved.Date;
});
beforeEach(() => { store.clear(); NOW = new RealDate('2026-07-07T10:00:00').getTime(); });

describe('the frozen writer — award() qualifies acts, never counts them', () => {
  it('a real message QUALIFIES (earned stays 0 forever); repeats and junk do not', () => {
    const before = core.readAura();
    const r1 = msg('hello there my friend, this is a real sentence today');
    expect(r1).toMatchObject({ earned: 0, qualified: true, reason: 'ok' });
    expect(msg('hello there my friend, this is a real sentence today')).toMatchObject({ qualified: false, reason: 'repeat' });
    expect(msg('hi')).toMatchObject({ earned: 0, qualified: false });
    const r3 = core.award('lesson');
    expect(r3).toMatchObject({ earned: 0, qualified: true });
    const after = core.readAura();
    expect(after.aura).toBe(before.aura); // the tally NEVER moves
    expect(after.fromMessages).toBe(before.fromMessages);
    expect(after.fromLessons).toBe(before.fromLessons);
    expect(after.todaySources).toMatchObject({ message: true, lesson: true }); // qualitative day marks still sound
  });

  it('reading gates hold: only a genuine cast qualifies, mashing refused', () => {
    expect(core.award('reading', {})).toMatchObject({ qualified: false, reason: 'not-a-cast' });
    expect(core.award('reading', { source: 'cast' })).toMatchObject({ earned: 0, qualified: true });
    expect(core.award('reading', { source: 'cast' })).toMatchObject({ qualified: false, reason: 'too-fast' });
    expect(core.readAura().fromReadings).toBe(0); // frozen
  });

  it('a rolled-back clock qualifies nothing until time catches up', () => {
    msg('an honest first message so the high-water mark advances now');
    hours(-3);
    expect(msg('a second message from the rolled-back past should fail')).toMatchObject({ qualified: false, reason: 'clock-rollback' });
    hours(4);
    expect(msg('time caught up so a real message qualifies again fine')).toMatchObject({ qualified: true });
  });
});

describe('the integrity seal still guards the FROZEN legacy data', () => {
  function completeLesson(dayKey: string) {
    core.award('lesson');
    const s = core.ensure(core.loadState());
    s.done[dayKey] = true; // the completion evidence the re-derivation replays
    core.saveState(s);
  }

  it('a devtools-edited legacy tally re-derives from lesson evidence (loss-only)', () => {
    completeLesson('d1'); completeLesson('d2');
    const blob = JSON.parse(store.get(core.STATE_KEY)!);
    blob.aura = 999999; // the console cheat
    store.set(core.STATE_KEY, JSON.stringify(blob));
    const after = core.readAura();
    expect(after.aura).toBe(10); // 2 lessons x legacy LESSON_BASE(5) — historical weights preserved
    expect(after.tamperedAt).toBeGreaterThan(0); // surfaced honestly, never hidden
  });

  it('deleting the seal reads as tamper (sealedOnce remembers) and re-derives', () => {
    completeLesson('d1');
    store.delete(SEAL_KEY);
    const after = core.readAura();
    expect(after.tamperedAt).toBeGreaterThan(0);
    expect(after.aura).toBe(5); // 1 lesson x 5, loss-only reconstruction of the frozen record
  });
});

describe('the numberless pulse', () => {
  it("the aura-changed event carries only the act kind — no n, no totals", async () => {
    let detail: any = null;
    (globalThis as any).window = { dispatchEvent: (e: any) => { detail = e.opts?.detail ?? e.detail ?? null; return true; } };
    msg('a qualifying sentence to make the glyph pulse just once here');
    expect(detail).toEqual({ kind: 'message' });
  });
});
