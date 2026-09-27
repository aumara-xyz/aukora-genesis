// φ — THE READ SIDE OF MEMORY: recall, scope, staleness, containment, the envelope.
//
// ══ WHAT THIS COMPLETES ══
//
// φ already owned the WRITE half of memory — durable write, seal, tombstone, shred, prove
// (`core/memory/**`, `docs/MEMORY-PORT.md`). What it had no law for was READING: which memories may
// be recalled, by whom, whether a recalled memory is still fresh, and what a memory is allowed to
// be. A store you can write to and seal but cannot govern the reading of is half an organ.
//
// ══ MERGED, NOT TRANSPLANTED ══
//
// The donor package is `@aukora/memory` — pure, no I/O, no clock, no randomness. φ already has the
// durability half, so only the read law crossed. Its one dependency was `@aukora/kernel`, and φ has
// ZERO runtime dependencies and keeps them: `canonicalHash` is re-derived against φ's own
// `domainHash`, and the staleness law is vendored subtractively. See `docs/MEMORY-PORT.md` §7 for
// per-file provenance — donor commit, blob sha256, VERBATIM or ADAPTED.
//
// ══ THE PROPERTY THIS SUITE EXISTS FOR ══
//
// Every function here is PURE. No clock, no randomness, no I/O, no mutation of its inputs. That is
// what makes a memory law auditable: the same records and the same query give the same answer on
// any machine, forever, and a reader can check it by hand. Several tests below assert exactly that
// rather than trusting the header.

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';

import {
  MEMORY_SCHEMA, buildMemoryRecord, deriveRecordId, validateMemoryRecord,
  memoryCommitment, tombstoneCommitment, memoryGrantsAuthority,
} from '../core/memory/envelope';
import { recall, recallScoped, liveMemoryCount } from '../core/memory/recall';
import { classifyScope, scopeCensus, hasScope } from '../core/memory/scope';
import { qualifyMemoryIngest, UNTRUSTED_PROVENANCE, ingestGateGrantsAuthority } from '../core/memory/ingestGate';
import { classifyEvidence, evidenceGrantsAuthority } from '../core/memory/containment';
import { stalenessVerdict, stampExpiresBy, challengeStalenessGate, stalenessGrantsAuthority } from '../core/memory/staleness';

const AT = '2026-08-01T00:00:00.000Z';
const rec = (content: string, over: Record<string, unknown> = {}) =>
  buildMemoryRecord({ content, createdAt: AT, ...over } as Parameters<typeof buildMemoryRecord>[0]);

// ─────────────────────────────────────────────────────────────────────────────
describe('the envelope is content-addressed, and the id is the integrity check', () => {
  it('the same content always yields the same id', () => {
    expect(deriveRecordId('hello')).toBe(deriveRecordId('hello'));
    expect(deriveRecordId('hello')).not.toBe(deriveRecordId('hello '));
    expect(deriveRecordId('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a record whose content was edited no longer validates', () => {
    const r = rec('the original content');
    expect(validateMemoryRecord(r)).not.toBeNull();
    // The id is `hash(content)`, so editing content without re-deriving the id is detectable with
    // no signature and no chain — the cheapest possible tamper-evidence.
    expect(validateMemoryRecord({ ...r, content: 'tampered' })).toBeNull();
  });

  it('refuses a record that claims authority, however well-formed', () => {
    const r = rec('x');
    expect(validateMemoryRecord({ ...r, advisoryOnly: false })).toBeNull();
    expect(validateMemoryRecord({ ...r, grantsAuthority: true })).toBeNull();
    expect(memoryGrantsAuthority()).toBe(false);
  });

  it('is exact-key closed — an extra field is a different object, not a decorated one', () => {
    const r = rec('x');
    expect(validateMemoryRecord({ ...r, extra: 1 })).toBeNull();
  });

  it('the commitment carries the id and never the plaintext', () => {
    // The whole reason a chain can commit to a memory AND the memory can later be forgotten: the
    // chain holds `sha256({content})`, never the content, so removing the plaintext breaks no link.
    const r = rec('a secret sentence');
    const c = memoryCommitment(r);
    expect(JSON.stringify(c)).not.toContain('a secret sentence');
    expect(c.recordId).toBe(r.recordId);
    expect(JSON.stringify(tombstoneCommitment({ recordId: r.recordId, at: AT }))).not.toContain('secret');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('recall is deterministic, and forgetting is enforced at read time', () => {
  const records = [rec('alpha beta'), rec('beta gamma'), rec('gamma delta')];

  it('gives the same answer regardless of input order', () => {
    const a = recall(records, { text: 'beta' }).map((h) => h.recordId);
    const b = recall([...records].reverse(), { text: 'beta' }).map((h) => h.recordId);
    expect(a).toEqual(b);
    expect(a.length).toBe(2);
  });

  it('a forgotten record is invisible, and its content is never returned', () => {
    const gone = records[0]!.recordId;
    const hits = recall(records, { text: 'beta' }, new Set([gone]));
    expect(hits.map((h) => h.recordId)).not.toContain(gone);
    expect(JSON.stringify(hits)).not.toContain('alpha');
    expect(liveMemoryCount(records, new Set([gone]))).toBe(2);
  });

  it('the default hit shape carries no scope field — the stable contract is untouched', () => {
    // Scope is an OPT-IN contract. If it leaked into the default hit, every existing caller and any
    // hash over a serialized hit would change underneath them.
    const [hit] = recall(records, { text: 'alpha' });
    expect(Object.keys(hit!).sort()).toEqual(['content', 'createdAt', 'kind', 'recordId', 'score']);
  });

  it('does not mutate the records it is given', () => {
    const before = JSON.stringify(records);
    recall(records, { text: 'beta' });
    recallScoped(records, { text: 'beta', preferScopes: ['identity'] });
    expect(JSON.stringify(records)).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('scope tells an empty shelf apart from a bad query', () => {
  it('a test file that merely mentions identity is still a test', () => {
    // The re-pollution hole, inverted: structure beats vocabulary, or a test quoting the identity
    // words would refill the shelf with the exact noise the scope notion exists to remove.
    const t = rec("describe('who am I', () => {})", { provenance: 'test/identity.test.ts' });
    expect(classifyScope(t)).toBe('test');
  });

  it('genuine identity content under a non-test provenance surfaces as identity', () => {
    expect(classifyScope(rec('my name is Auma', { provenance: 'docs/self.md' }))).toBe('identity');
  });

  it('an absent shelf reports absent rather than empty-because-you-asked-wrong', () => {
    const onlyTests = [rec("it('x', () => {})", { provenance: 'test/a.test.ts' })];
    expect(hasScope(onlyTests, 'identity')).toBe(false);
    expect(scopeCensus(onlyTests).test).toBe(1);
    expect(scopeCensus(onlyTests).identity).toBe(0);
  });

  it('a forgotten identity atom is gone, not merely unfindable', () => {
    const id = rec('my name is Auma', { provenance: 'docs/self.md' });
    expect(hasScope([id], 'identity')).toBe(true);
    expect(hasScope([id], 'identity', new Set([id.recordId]))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the ingest gate refuses a forged owner claim', () => {
  it('owner-only without a capability is refused, content-free', () => {
    const q = qualifyMemoryIngest({ consent: 'owner-only', capabilityValid: false });
    expect(q.decision).toBe('refuse');
  });

  it('private and shared are admitted but their provenance is quarantined', () => {
    const q = qualifyMemoryIngest({ consent: 'private', capabilityValid: false });
    expect(q).toEqual({ decision: 'quarantine', consent: 'private', provenance: UNTRUSTED_PROVENANCE });
  });

  it('an unknown consent falls back to the broadest scope, not the tightest', () => {
    // Fail-closed means fail-toward-less-trust. Defaulting an unreadable claim to `owner-only`
    // would let a malformed payload buy the strongest scope there is.
    const q = qualifyMemoryIngest({ consent: 'nonsense', capabilityValid: false });
    expect(q).toMatchObject({ decision: 'quarantine', consent: 'shared' });
    expect(ingestGateGrantsAuthority()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('containment and staleness never grant authority', () => {
  it('unreadable or unbounded evidence is quarantined, not trusted', () => {
    const good = { hasAuditSummary: true, codebookKnown: true, finite: true, withinBounds: true };
    expect(classifyEvidence(good).disposition).toBe('readable_advisory');
    expect(classifyEvidence({ ...good, finite: false }).disposition).toBe('quarantine');
    expect(classifyEvidence({ ...good, codebookKnown: false }).disposition).toBe('quarantine');
    expect(evidenceGrantsAuthority()).toBe(false);
  });

  it('an artifact of unknown age is flagged stale rather than assumed fresh', () => {
    const v = stalenessVerdict({}, Date.parse(AT));
    expect(v.state).toBe('stale');
    expect(v.flagged).toBe(true);
    expect(v.horizon).toBe('unknown-age');
  });

  it('a stamped expiry wins over the default horizon, and gating needs an explicit revive', () => {
    const expires = stampExpiresBy(AT, 1000);
    const v = stalenessVerdict({ createdAt: AT, expiresBy: expires }, Date.parse(AT) + 5000);
    expect(v.state).toBe('stale');
    expect(v.horizon).toBe('stamped');
    expect(challengeStalenessGate(v, false).allow).toBe(false);
    expect(challengeStalenessGate(v, true).allow).toBe(true);
    expect(stalenessGrantsAuthority()).toBe(false);
  });

  it('uses no ambient clock — the same inputs give the same verdict', () => {
    const a = stalenessVerdict({ createdAt: AT }, 1_800_000_000_000);
    const b = stalenessVerdict({ createdAt: AT }, 1_800_000_000_000);
    expect(a).toEqual(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the merge kept φ\'s properties, not just the donor\'s behaviour', () => {
  const DIR = path.resolve(import.meta.dir, '..', 'core', 'memory');
  const MERGED = ['envelope.ts', 'recall.ts', 'scope.ts', 'ingestGate.ts', 'containment.ts', 'staleness.ts'];

  it('no merged file imports a runtime dependency', () => {
    // φ has ZERO runtime dependencies and that property is worth more than any single function. The
    // donor's `canonicalHash` reaches `@noble/hashes`; it is re-derived here instead.
    const offenders: string[] = [];
    for (const f of MERGED) {
      const src = readFileSync(path.join(DIR, f), 'utf8');
      for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
        const spec = m[1]!;
        if (!spec.startsWith('.') && !['crypto', 'fs', 'path', 'os'].includes(spec)) offenders.push(`${f} -> ${spec}`);
      }
    }
    expect(offenders, `merged memory files must not depend on a package: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the record id is domain-separated, which the donor\'s hash was not', () => {
    // φ's `domainHash` tags every hash ROLE, so a value built to collide as one role cannot also
    // collide as another. A bare `sha256({content})` has no such tag. Asserted by showing the id is
    // NOT the untagged hash of the same shape.
    const { domainHash } = require('../core/memory/hash') as typeof import('../core/memory/hash');
    expect(deriveRecordId('x')).toBe(domainHash('aukora-memory-record-v1', { content: 'x' }));
    expect(deriveRecordId('x')).not.toBe(domainHash('', { content: 'x' }));
  });

  it('every merged file carries its provenance in docs/MEMORY-PORT.md', () => {
    // A port whose lineage is not written down is a fork. Each file must be named in the port doc.
    const doc = readFileSync(path.resolve(import.meta.dir, '..', 'docs', 'MEMORY-PORT.md'), 'utf8');
    for (const f of MERGED) expect(doc, `${f} is not accounted for in MEMORY-PORT.md`).toContain(f);
    expect(readdirSync(DIR).filter((f) => MERGED.includes(f)).length).toBe(MERGED.length);
  });
});
