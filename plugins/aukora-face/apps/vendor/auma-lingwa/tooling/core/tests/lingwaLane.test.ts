// Lingwa lane: canon-grounded Auma-language teaching context for the chat door.
// The block is DERIVED from the live canon JSON (retrieval-first, per the canon's
// own authorityOrder), bounded, and fails soft — these tests pin all three.
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { loadLingwaCanon, detectLingwaEngagement, buildLingwaTeachingBlock } from '../../spatial/lingwaLane';

const CANON = join(__dirname, '..', '..', 'spatial', 'app', 'auma', 'canon-v16.json');
const canon = loadLingwaCanon(CANON)!;

describe('lingwaLane: canon loading', () => {
  it('loads and indexes the real canon', () => {
    expect(canon).toBeTruthy();
    expect(canon.version).toMatch(/^canon-v16/);
    expect(canon.byToken.get('salama')?.translation).toContain('hello');
    expect(canon.byToken.has('skirvi')).toBe(false); // repaired in v15.1
    expect(canon.byToken.has('skrivi')).toBe(true);
  });

  it('fails soft on a missing canon path', () => {
    expect(loadLingwaCanon(join(__dirname, 'no-such-canon.json'))).toBeNull();
  });

  it('derives grammar and teacher blocks from canon fields, not hand-written text', () => {
    expect(canon.grammarBlock).toContain('-iva');          // frozen passive
    expect(canon.grammarBlock).toContain('Subject-Verb-Object');
    expect(canon.teacherBlock).toContain('guardian-teacher');
    expect(canon.teacherBlock).toContain('Do not invent canon vocabulary');
  });

  it('collects deprecated-form antibodies from deprecatedForms and the tense freeze', () => {
    expect(canon.deprecatedTokens.get('skirvi')).toContain('skrivi');
    expect(canon.deprecatedTokens.get('deja')).toBeTruthy();   // tense freeze applied in v15.1
    expect(canon.deprecatedTokens.get('agon')).toBeTruthy();
  });
});

describe('lingwaLane: engagement detection (owner text only)', () => {
  it('fires when asked to teach the language', () => {
    expect(detectLingwaEngagement('can you teach me some Auma?', canon)).toBe(true);
    expect(detectLingwaEngagement('what does salama mean in auma?', canon)).toBe(true);
    expect(detectLingwaEngagement('how do you say water in Auma?', canon)).toBe(true);
  });

  it('fires when someone writes Auma at her', () => {
    expect(detectLingwaEngagement('salama! mi voli lero.', canon)).toBe(true);
    expect(detectLingwaEngagement('ka tu esi bona? mi esi hapi.', canon)).toBe(true);
  });

  it('stays quiet on plain English and on "auma" as a mere name', () => {
    expect(detectLingwaEngagement('deploy the convex backend and check the ledger', canon)).toBe(false);
    expect(detectLingwaEngagement('is the auma node still running?', canon)).toBe(false);
    // english-collision tokens never count toward engagement
    expect(detectLingwaEngagement('I went via the ante room, solo, under the luna moth', canon)).toBe(false);
  });
});

describe('lingwaLane: block rendering', () => {
  it('returns empty for disengaged text', () => {
    expect(buildLingwaTeachingBlock('restart the rehearsal queue please', { canonPath: CANON })).toBe('');
  });

  it('injects grammar, stance, and per-message lookups when engaged', () => {
    const block = buildLingwaTeachingBlock('what does salama mean in auma?', { canonPath: CANON });
    expect(block).toContain('AUMA LINGWA');
    expect(block).toContain('guardian-teacher');
    expect(block).toContain('salama = hello / peace');
    expect(block).toContain('outranks anything your weights remember');
  });

  it('resolves english words back into the lexicon', () => {
    const block = buildLingwaTeachingBlock('how do you say water in auma?', { canonPath: CANON });
    expect(block).toContain('akwa');
  });

  it('answers Auma sentences with the tokens actually used', () => {
    const block = buildLingwaTeachingBlock('ka tu komprende: mi voli lero auma?', { canonPath: CANON });
    for (const tok of ['komprende', 'voli', 'lero']) expect(block).toContain(tok + ' = ');
  });

  it('raises antibodies when a deprecated form appears', () => {
    const block = buildLingwaTeachingBlock('is "skirvi" the auma word for write?', { canonPath: CANON });
    expect(block).toContain('DEPRECATED');
    expect(block).toContain('skrivi');
  });

  it('stays within the hard block cap', () => {
    const flood = 'auma teach ' + Array.from(canon.byToken.keys()).slice(0, 400).join(' ');
    const block = buildLingwaTeachingBlock(flood, { canonPath: CANON });
    expect(block.length).toBeLessThanOrEqual(7_000 + 120);
  });

  it('honors the kill-switch', () => {
    process.env.AUKORA_LINGWA_TEACHER = 'off';
    try {
      expect(buildLingwaTeachingBlock('teach me auma words', { canonPath: CANON })).toBe('');
    } finally {
      delete process.env.AUKORA_LINGWA_TEACHER;
    }
  });

  it('fails soft to empty when the canon is missing', () => {
    expect(buildLingwaTeachingBlock('teach me auma words', { canonPath: join(__dirname, 'nope.json') })).toBe('');
  });
});
