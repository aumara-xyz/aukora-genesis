// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R42 candidate — scope-aware recall (the #62 "empty shelf" fix), with a NEGATIVE FALSIFIER that proves the fix
 * never fabricates identity when the corpus is absent. Synthetic identity fixtures only (identity semantics).
 *
 * Donor-comparative anchor: `core/src/kiraBrain.ts@fa113e8a` — atoms carried a `scope`, `isTestFile` was
 * `/(^|\/)tests?\//` + `\.(test|spec)\.[tj]sx?$`, and the #62 census was `tests:70, evidence:5, architecture:1,
 * identity:0`. `classifyScope` mirrors that heuristic; `scopeCensus`/`hasScope` restore the diagnostic.
 */
import { describe, it, expect } from 'vitest';
import { buildMemoryRecord, classifyScope, scopeCensus, hasScope, recall, recallScoped } from '../index.js';

const AT = (s: number) => `2026-07-16T00:00:${String(s).padStart(2, '0')}.000Z`;
const mk = (content: string, provenance: string, s: number) => buildMemoryRecord({ content, createdAt: AT(s), provenance });

describe('classifyScope — donor-comparative vectors', () => {
  it('labels test / identity / architecture / evidence / doc / code / general deterministically', () => {
    expect(classifyScope(mk('describe("x", () => { it("y", () => expect(1).toBe(1)); })', 'self-map', 1))).toBe('test');
    expect(classifyScope(mk('anything', 'file apps/brain/test/foo.test.ts', 2))).toBe('test'); // donor isTestFile path
    expect(classifyScope(mk('the maternal anchor and the five values heal', 'identity-corpus', 3))).toBe('identity');
    expect(classifyScope(mk('who am I? my name is Auma', 'reflection', 4))).toBe('identity');
    expect(classifyScope(mk('the architecture boundaries and safety law', 'docs', 5))).toBe('architecture');
    expect(classifyScope(mk('a receipt chainHash and merkle proof', 'receipt', 6))).toBe('evidence');
    expect(classifyScope(mk('see the README documentation', 'docs', 7))).toBe('doc');
    expect(classifyScope(mk('export function foo() { import { bar } from "x"; }', 'self-map', 8))).toBe('code');
    expect(classifyScope(mk('the weather is nice today', 'observation', 9))).toBe('general');
  });

  it('CYCLE-2 falsifier: structural test path/body BEATS identity words (donor-authoritative; closes re-pollution)', () => {
    // a TEST file that merely quotes identity vocabulary must NOT masquerade as an identity atom
    expect(classifyScope(mk('maternal anchor lives here', 'file apps/x/tests/identity.test.ts', 1))).toBe('test');
    expect(classifyScope(mk('it("who am I", () => expect(x).toBe(y))', 'self-map', 2))).toBe('test');
    // genuine identity content under a NON-test provenance still surfaces as identity
    expect(classifyScope(mk('who am I — maternal anchor', 'identity-corpus', 3))).toBe('identity');
  });
});

// A brain shaped like the donor's: mostly test scope, plus (optionally) one identity atom sharing the query term.
const testHeavy = (withIdentity: boolean) => {
  const recs = Array.from({ length: 10 }, (_, i) => mk(`describe("suite ${i}") anchor test`, `file apps/brain/test/s${i}.test.ts`, i + 1));
  if (withIdentity) recs.push(mk('my maternal anchor: the five values heal', 'identity-corpus', 20));
  return recs;
};

describe('scope census + hasScope — the honest "is the shelf empty?" signal (#62)', () => {
  it('reproduces the donor census shape: test-heavy, identity 0 when absent', () => {
    const census = scopeCensus(testHeavy(false));
    expect(census.test).toBe(10);
    expect(census.identity).toBe(0);           // EMPTY shelf — identity corpus absent
    expect(hasScope(testHeavy(false), 'identity')).toBe(false);
    expect(hasScope(testHeavy(true), 'identity')).toBe(true);
  });
});

describe('scope-aware recall — the fix, with the corpus-absent NEGATIVE FALSIFIER', () => {
  it('plain recall floods with test scope; scope-aware recall surfaces identity #1', () => {
    const recs = testHeavy(true);
    const plain = recallScoped(recs, { text: 'anchor' });
    expect(plain[0].scope).toBe('test');                       // #62 flood reproduced: test outranks identity
    const scoped = recallScoped(recs, { text: 'anchor', preferScopes: ['identity'] });
    expect(scoped[0].scope).toBe('identity');                  // FIX: identity floats to #1
    const excluded = recallScoped(recs, { text: 'anchor', excludeScopes: ['test', 'code'] });
    expect(excluded.every((h) => h.scope !== 'test')).toBe(true); // flood suppressed entirely
    expect(excluded[0].scope).toBe('identity');
  });

  it('NEGATIVE FALSIFIER: an absent identity shelf returns [] — the fix never fabricates identity', () => {
    const recs = testHeavy(false); // NO identity atom
    const scoped = recallScoped(recs, { text: 'anchor', scopes: ['identity'] });
    expect(scoped).toEqual([]);                                 // corpus absent, not "least-bad noise"
    // and the consumer can tell absent (this) from a query miss on a present shelf
    expect(hasScope(recs, 'identity')).toBe(false);
    expect(hasScope(testHeavy(true), 'identity')).toBe(true);
  });

  it('content-free forgetting stays distinct from absent: a forgotten identity atom is GONE, not noise', () => {
    const recs = testHeavy(true);
    const identityId = recs[recs.length - 1].recordId;
    const forgotten = new Set([identityId]);
    expect(recallScoped(recs, { text: 'anchor', scopes: ['identity'] }, forgotten)).toEqual([]); // gone
    expect(hasScope(recs, 'identity', forgotten)).toBe(false);  // census excludes the forgotten atom
    expect(scopeCensus(recs, forgotten).identity).toBe(0);
  });

  it('default recall (no scope options) is unchanged — byte-for-byte pre-#62 ordering', () => {
    const recs = [mk('alpha about memory', 'x', 1), mk('beta about memory', 'y', 2)];
    expect(recall(recs, { text: 'memory' }).map((h) => h.content)).toEqual(['alpha about memory', 'beta about memory']);
  });
});

describe('WAVE 3 — default recall serialization is byte-for-byte unchanged (opt-in scope, no shape drift)', () => {
  // A fixed record so the serialized hit is fully determined (no clock/randomness). Default kind = 'observation'.
  const fixed = buildMemoryRecord({ content: 'the anchor holds', createdAt: AT(1), provenance: 'x' });

  it('default RecallHit has EXACTLY the pre-#62 keys, order and JSON — no scope field', () => {
    const hit = recall([fixed], { text: 'anchor' })[0];
    // exact key set AND order — a receipt/hash over the serialized hit is therefore unchanged
    expect(Object.keys(hit)).toEqual(['recordId', 'createdAt', 'kind', 'content', 'score']);
    expect(Object.prototype.hasOwnProperty.call(hit, 'scope')).toBe(false);
    // frozen serialization: exact bytes old callers/receipts see
    expect(JSON.stringify(hit)).toBe(
      `{"recordId":${JSON.stringify(fixed.recordId)},"createdAt":"${AT(1)}","kind":"observation","content":"the anchor holds","score":1}`,
    );
    expect(JSON.stringify(hit)).not.toContain('scope');
  });

  it('opt-in recallScoped ADDS scope as the last key — additive, never mutating the base five', () => {
    const hit = recallScoped([fixed], { text: 'anchor' })[0];
    expect(Object.keys(hit)).toEqual(['recordId', 'createdAt', 'kind', 'content', 'score', 'scope']);
    // the first five keys + their values are identical to the default hit (scope is purely additive)
    const base = recall([fixed], { text: 'anchor' })[0];
    const { scope, ...withoutScope } = hit;
    void scope;
    expect(withoutScope).toEqual(base);
    expect(JSON.stringify(withoutScope)).toBe(JSON.stringify(base));
  });

  it('scope options passed to the DEFAULT recall are ignored and never leak scope into the shape', () => {
    // even if a caller mistakenly spreads scope selectors onto a default recall call, the shape is unchanged.
    const hit = recall([fixed], { text: 'anchor', ...( { scopes: ['identity'], preferScopes: ['identity'] } as object) })[0];
    expect(Object.keys(hit)).toEqual(['recordId', 'createdAt', 'kind', 'content', 'score']);
    expect(Object.prototype.hasOwnProperty.call(hit, 'scope')).toBe(false);
  });
});
