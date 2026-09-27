// φ — the memory event log: genesis, insert, correct, tombstone, and the closure a tombstone must cover.
//
// This suite exercises `core/memory/eventLog.ts` directly, with fabricated `ContentRef`s (no real
// crypto) — the log never looks at plaintext, so a fixture digest is exactly as valid a test subject as
// a real sealed one. `test/memory-filevault.test.ts` and `test/memory-ledger.test.ts` cover the real
// AES-256-GCM path end to end.

import { describe, it, expect } from 'bun:test';
import { randomBytes } from 'crypto';
import {
  openLog, appendEvent, verifyChain, tombstoneClosure, isKnownAndLive, computeMemoryLogRoot,
  MemoryLogError, type CommittedEvent, type ContentRef, type MemoryDraft,
} from '../core/memory/eventLog';

const at = () => new Date().toISOString();
const nonce = () => randomBytes(32).toString('hex');
const fixtureContent = (): ContentRef => ({
  ciphertextDigest: randomBytes(32).toString('hex'),
  keyRef: `vault:${randomBytes(16).toString('hex')}`,
  byteLength: 64,
});

function genesis(): CommittedEvent[] {
  return [openLog({ logId: 'test-log', at: at(), leafNonce: nonce() })];
}

function insert(events: CommittedEvent[], content = fixtureContent()): CommittedEvent[] {
  const committed = appendEvent(events, {
    kind: 'insert', content, consentScope: 'conversation-turn', at: at(),
  } as MemoryDraft, nonce());
  return [...events, committed];
}

describe('opening the log', () => {
  it('genesis must come first — nothing appends before it', () => {
    expect(() => appendEvent([], { kind: 'insert', content: fixtureContent(), consentScope: 'x', at: at() } as MemoryDraft, nonce()))
      .toThrow(MemoryLogError);
  });

  it('a leaf nonce that is not 64 hex characters is refused', () => {
    expect(() => openLog({ logId: 'x', at: at(), leafNonce: 'not-hex' })).toThrow(MemoryLogError);
  });
});

describe('insert', () => {
  it('mints an occurrenceId — the draft carries none', () => {
    const events = insert(genesis());
    const e = events[1]!.event as { occurrenceId?: string };
    expect(typeof e.occurrenceId).toBe('string');
    expect(e.occurrenceId).toMatch(/^[0-9a-f]{64}$/);
    expect(isKnownAndLive(events, e.occurrenceId!)).toBe(true);
  });

  it('two memories may never share a keyRef — round-10\'s defect, refused rather than merely discouraged', () => {
    const shared = fixtureContent();
    let events = insert(genesis(), shared);
    expect(() => appendEvent(events, {
      kind: 'insert', content: shared, consentScope: 'x', at: at(),
    } as MemoryDraft, nonce())).toThrow(MemoryLogError);
  });
});

describe('correct', () => {
  it('may only supersede a live, known id', () => {
    const events = genesis();
    expect(() => appendEvent(events, {
      kind: 'correct', supersedes: randomBytes(32).toString('hex'), content: fixtureContent(),
      consentScope: 'x', at: at(),
    } as MemoryDraft, nonce())).toThrow(MemoryLogError);
  });

  it('cannot supersede an id that is already forgotten', () => {
    let events = insert(genesis());
    const id = (events[1]!.event as { occurrenceId: string }).occurrenceId;
    events = [...events, appendEvent(events, {
      kind: 'tombstone', target: id, erased: [], at: at(),
    } as MemoryDraft, nonce())];
    expect(() => appendEvent(events, {
      kind: 'correct', supersedes: id, content: fixtureContent(), consentScope: 'x', at: at(),
    } as MemoryDraft, nonce())).toThrow(MemoryLogError);
  });
});

describe('tombstoneClosure — what a tombstone must cover', () => {
  it('a memory with no corrections closes over nothing', () => {
    const events = insert(genesis());
    const id = (events[1]!.event as { occurrenceId: string }).occurrenceId;
    expect(tombstoneClosure(events, id)).toEqual([]);
  });

  it('forgetting the original also names its correction — a fixed-point walk, not one hop', () => {
    let events = insert(genesis());
    const original = (events[1]!.event as { occurrenceId: string }).occurrenceId;
    const c1 = appendEvent(events, {
      kind: 'correct', supersedes: original, content: fixtureContent(), consentScope: 'x', at: at(),
    } as MemoryDraft, nonce());
    events = [...events, c1];
    const c1Id = (c1.event as { occurrenceId: string }).occurrenceId;
    const c2 = appendEvent(events, {
      kind: 'correct', supersedes: c1Id, content: fixtureContent(), consentScope: 'x', at: at(),
    } as MemoryDraft, nonce());
    events = [...events, c2];
    const c2Id = (c2.event as { occurrenceId: string }).occurrenceId;

    const closure = tombstoneClosure(events, original);
    expect(closure.sort()).toEqual([c1Id, c2Id].sort());
  });

  it('a tombstone that omits part of its own closure is refused', () => {
    let events = insert(genesis());
    const original = (events[1]!.event as { occurrenceId: string }).occurrenceId;
    const c1 = appendEvent(events, {
      kind: 'correct', supersedes: original, content: fixtureContent(), consentScope: 'x', at: at(),
    } as MemoryDraft, nonce());
    events = [...events, c1];
    expect(() => appendEvent(events, {
      kind: 'tombstone', target: original, erased: [], at: at(),
    } as MemoryDraft, nonce())).toThrow(MemoryLogError);
  });

  it('a target already forgotten cannot be tombstoned twice', () => {
    let events = insert(genesis());
    const id = (events[1]!.event as { occurrenceId: string }).occurrenceId;
    events = [...events, appendEvent(events, {
      kind: 'tombstone', target: id, erased: [], at: at(),
    } as MemoryDraft, nonce())];
    expect(() => appendEvent(events, {
      kind: 'tombstone', target: id, erased: [], at: at(),
    } as MemoryDraft, nonce())).toThrow(MemoryLogError);
    expect(isKnownAndLive(events, id)).toBe(false);
  });
});

describe('verifyChain', () => {
  it('a freshly built chain verifies clean', () => {
    let events = insert(genesis());
    const id = (events[1]!.event as { occurrenceId: string }).occurrenceId;
    events = [...events, appendEvent(events, { kind: 'tombstone', target: id, erased: [], at: at() } as MemoryDraft, nonce())];
    expect(verifyChain(events)).toEqual({ ok: true });
  });

  it('an edited event body is caught — the hash no longer matches', () => {
    const events = insert(genesis());
    const tampered = events.map((c, i) => (i === 1
      ? { ...c, event: { ...(c.event as object), consentScope: 'exfiltrated' } as typeof c.event }
      : c));
    const v = verifyChain(tampered);
    expect(v.ok).toBe(false);
    if (!v.ok) { expect(v.brokenAt).toBe(1); expect(v.reasonClass).toBe('event-hash-mismatch'); }
  });

  it('a forged head is caught even when the event body is untouched', () => {
    const events = insert(genesis());
    const tampered = events.map((c, i) => (i === 1 ? { ...c, head: randomBytes(32).toString('hex') } : c));
    const v = verifyChain(tampered);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasonClass).toBe('head-mismatch');
  });

  it('a spliced-out entry is caught by the sequence check', () => {
    let events = insert(genesis());
    events = insert(events);
    const spliced = [events[0]!, events[2]!].map((c, i) => ({ ...c, seq: i }));
    const v = verifyChain(spliced);
    expect(v.ok).toBe(false);
  });
});

describe('computeMemoryLogRoot', () => {
  it('is deterministic and changes when the log grows', () => {
    const events = genesis();
    const r0 = computeMemoryLogRoot(events);
    expect(computeMemoryLogRoot(events)).toBe(r0);
    const grown = insert(events);
    expect(computeMemoryLogRoot(grown)).not.toBe(r0);
  });
});
