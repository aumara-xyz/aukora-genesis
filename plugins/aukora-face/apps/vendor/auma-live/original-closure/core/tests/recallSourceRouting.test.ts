// R5b step 4 — the recall-source router, post-cutover law:
//   - the DEFAULT source is the governed CONVEX brain; no env, no flag, no exception;
//   - the archived Kira JSON brain serves ONLY under the exact owner-set env value
//     'kira-json-legacy' (the migration hatch), and is labeled legacy when it does;
//   - a governed refusal serves the turn with NO memory (hits: []) and records the refusal —
//     the legacy file is NEVER read as a silent fallback;
//   - the next governed success clears the recorded refusal; the router never invents hits and
//     never grants authority.
// Hermetic: both sources are injected; no backend, no brain file, no env leakage between tests.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { recallSourceFlag, recallSourceStatus, fuzzyRecallHits, recallSourceGrantsAuthority, governedValueExcerpt } from '../../spatial/recallSource';

const savedEnv = process.env.AUKORA_RECALL_SOURCE;
beforeEach(() => { delete process.env.AUKORA_RECALL_SOURCE; });
afterEach(() => {
  if (savedEnv === undefined) delete process.env.AUKORA_RECALL_SOURCE;
  else process.env.AUKORA_RECALL_SOURCE = savedEnv;
});

const legacyHits = [{ citation: 'kira:atom_1', supportQuote: 'from the archived json brain' }];
const convexHits = [{ citation: 'convex:mem:aumara.root:turn.x', supportQuote: 'from the governed brain' }];

describe('recallSourceFlag — convex is the default, the hatch is exact-match only', () => {
  it("defaults to convex; ONLY the exact value 'kira-json-legacy' opens the hatch", () => {
    expect(recallSourceFlag({})).toBe('convex');
    expect(recallSourceFlag({ AUKORA_RECALL_SOURCE: 'kira-json-legacy' })).toBe('kira-json-legacy');
    expect(recallSourceFlag({ AUKORA_RECALL_SOURCE: 'kira-json' })).toBe('convex'); // the old name no longer serves
    expect(recallSourceFlag({ AUKORA_RECALL_SOURCE: 'KIRA-JSON-LEGACY' })).toBe('convex'); // no fuzzy matching
    expect(recallSourceFlag({ AUKORA_RECALL_SOURCE: 'convex' })).toBe('convex');
    expect(recallSourceFlag({ AUKORA_RECALL_SOURCE: '' })).toBe('convex');
  });

  it('the live process default (no env set) is convex', () => {
    expect(recallSourceFlag()).toBe('convex');
  });
});

describe('fuzzyRecallHits — routing, honest empty on refusal, labeled legacy hatch', () => {
  it('default: serves the governed brain and NEVER touches the legacy file', async () => {
    let legacyCalled = false;
    const r = await fuzzyRecallHits('anything', 3, {
      convexImpl: async () => convexHits,
      kiraLegacyImpl: async () => { legacyCalled = true; return legacyHits; },
    });
    expect(r).toMatchObject({ source: 'convex', refused: null });
    expect(r.hits).toEqual(convexHits);
    expect(legacyCalled).toBe(false);
    expect(recallSourceStatus().lastConvexRefusal).toBeNull();
  });

  it('a governed refusal serves EMPTY — recorded, loud, and the legacy file is NOT consulted', async () => {
    let legacyCalled = false;
    const r = await fuzzyRecallHits('anything', 3, {
      convexImpl: async () => { throw new Error('no_active_root_key'); },
      kiraLegacyImpl: async () => { legacyCalled = true; return legacyHits; },
    });
    expect(r.source).toBe('convex');
    expect(r.hits).toEqual([]); // an honest empty recall beats a stale shadow brain
    expect(r.refused).toContain('no_active_root_key');
    expect(legacyCalled).toBe(false);
    expect(recallSourceStatus().lastConvexRefusal?.error).toContain('no_active_root_key');
  });

  it('the next governed success clears the recorded refusal (the card never shows stale alarm)', async () => {
    await fuzzyRecallHits('q', 3, { convexImpl: async () => { throw new Error('down'); } });
    expect(recallSourceStatus().lastConvexRefusal).not.toBeNull();
    await fuzzyRecallHits('q', 3, { convexImpl: async () => convexHits });
    expect(recallSourceStatus().lastConvexRefusal).toBeNull();
  });

  it('the hatch: exact owner-set env serves the archived brain, labeled legacy, convex untouched', async () => {
    let convexCalled = false;
    const r = await fuzzyRecallHits('anything', 3, {
      flag: 'kira-json-legacy',
      kiraLegacyImpl: async () => legacyHits,
      convexImpl: async () => { convexCalled = true; return convexHits; },
    });
    expect(r).toMatchObject({ source: 'kira-json-legacy', refused: null });
    expect(r.hits).toEqual(legacyHits);
    expect(convexCalled).toBe(false);
  });

  it('a hatch failure (no brain file) propagates — the lanes catch and speak without memory', async () => {
    await expect(
      fuzzyRecallHits('q', 3, { flag: 'kira-json-legacy', kiraLegacyImpl: async () => { throw new Error('no brain file on this node'); } }),
    ).rejects.toThrow('no brain file');
  });

  it('the router grants nothing', () => {
    expect(recallSourceGrantsAuthority()).toBe(false);
  });
});

describe('governedValueExcerpt — human text out of typed envelopes, raw value otherwise', () => {
  it('surfaces atom.text from an M4 migration envelope', () => {
    const envelope = JSON.stringify({ schema: 'x', atom: { id: 'atom_1', text: 'the remembered sentence' } });
    expect(governedValueExcerpt(envelope)).toBe('the remembered sentence');
  });

  it('returns the raw value for non-JSON and for JSON without atom.text', () => {
    expect(governedValueExcerpt('plain stored text')).toBe('plain stored text');
    expect(governedValueExcerpt('{"turn":"summary-v1","ownerTextDigest":"d"}')).toBe('{"turn":"summary-v1","ownerTextDigest":"d"}');
    expect(governedValueExcerpt(JSON.stringify({ atom: { text: '' } }))).toBe(JSON.stringify({ atom: { text: '' } }));
  });
});
