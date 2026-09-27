// THE CASTER'S LAW — conformance pins (formerly the Reader's Protocol pins;
// the three law documents were recombined into one at the architect's word,
// 2026-07-18, and the pins followed the text to its new home).
// The codes are abided by construction: these tests assert the law document's
// load-bearing strings, so a drifted copy breaks loudly, and they cross-check
// the reference draw the law names. Assertions run against whitespace-
// collapsed text so a reflowed line never masquerades as a drifted law.
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drawThree } from '../../spatial/app/luminara-canon.js';

const RAW = readFileSync(
  fileURLToPath(new URL('../../docs/LUMINARA_CASTERS_LAW.md', import.meta.url)), 'utf8');
const DOC = RAW.replace(/\s+/g, ' ');

describe("THE CASTER'S LAW (the codes, pinned)", () => {
  test('the standing and the three refusals', () => {
    expect(DOC).toContain('beside the querent, never above');
    expect(DOC).toContain('NO OPERATION.');
    expect(DOC).toContain('NO PREDICTION.');
    expect(DOC).toContain('NO AUTHORITY.');
    expect(DOC).toContain('Crisis outranks canon.');
  });
  test('the cast law: randomisation always, the three properties, the forbidden moves', () => {
    expect(DOC).toContain('A cast is obtained by randomisation, always. There is no other technique.');
    expect(DOC).toContain('You never choose the cards.');
    expect(DOC).toContain('UNSTEERABLE');
    expect(DOC).toContain('COMMITTED');
    expect(DOC).toContain('WITNESSABLE');
    expect(DOC).toContain('uniform over 27, without replacement, three cards');
    expect(DOC).toContain('One cast, one reading.');
    expect(DOC).toContain('a composed spread is never presented as drawn');
    expect(DOC).toContain('composition, not chance');
    expect(DOC).toContain('Decline the cast, offer the vessel.');
  });
  test('the commitment rite: numbers and source declared before meaning', () => {
    expect(DOC).toContain('declare the three numbers and the');
    expect(DOC).toContain('source of the randomness');
    expect(DOC).toContain('after it, no redraw exists');
  });
  test('the reading grammar: positions, silences, bearing, agency', () => {
    expect(DOC).toContain('root');
    expect(DOC).toContain('present');
    expect(DOC).toContain('becoming');
    expect(DOC).toContain('descent at the fourth seat');
    expect(DOC).toContain('a bearing, never a promise');
    expect(DOC).toContain('end in agency');
    expect(DOC).toContain('the last word is theirs');
  });
  test('the portable seed block and the harmonic test', () => {
    expect(DOC).toContain('luminara_reader:');
    expect(DOC).toContain('technique: randomisation, always');
    expect(DOC).toContain('model-improvised numbers');
    expect(DOC).toContain('chance unsteered, grammar unforced, querent unruled');
    expect(DOC).toContain('Declining is conformance.');
  });
  test('the reference draw the law names: deterministic, uniform, without replacement', () => {
    expect(DOC).toContain('drawThree');
    const a = drawThree('protocol-pin');
    const b = drawThree('protocol-pin');
    expect(a).toEqual(b);                       // replayable from the seed
    expect(new Set(a).size).toBe(3);            // without replacement
    for (const n of a) { expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(27); }
    expect(drawThree('protocol-pin-2')).not.toEqual(a); // the seed matters
  });
});
