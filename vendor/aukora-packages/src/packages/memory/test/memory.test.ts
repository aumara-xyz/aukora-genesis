// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
import { describe, it, expect } from 'vitest';
import {
  buildMemoryRecord, validateMemoryRecord, deriveRecordId, memoryGrantsAuthority,
  recall, liveMemoryCount, advisoryContainmentGrantsAuthority,
} from '../index.js';

const AT = '2026-07-16T00:00:00.000Z';

describe('@aukora/memory — KIRA envelope + recall (pure)', () => {
  it('memory grants no authority', () => {
    expect(memoryGrantsAuthority()).toBe(false);
    expect(advisoryContainmentGrantsAuthority()).toBe(false);
  });

  it('records are content-addressed and deterministic', () => {
    const a = buildMemoryRecord({ content: 'the organism remembers', createdAt: AT });
    const b = buildMemoryRecord({ content: 'the organism remembers', createdAt: AT });
    expect(a.recordId).toBe(b.recordId);
    expect(a.recordId).toBe(deriveRecordId('the organism remembers'));
    expect(a.advisoryOnly).toBe(true);
    expect(a.grantsAuthority).toBe(false);
  });

  it('validateMemoryRecord is drop-not-fail, exact-key closed, content-integrity bound', () => {
    const r = buildMemoryRecord({ content: 'hello', createdAt: AT });
    expect(validateMemoryRecord(r)).not.toBeNull();
    expect(validateMemoryRecord({ ...r, grantsAuthority: true })).toBeNull();      // authority claim refused
    expect(validateMemoryRecord({ ...r, extra: 1 })).toBeNull();                    // extra key refused
    expect(validateMemoryRecord({ ...r, content: 'tampered' })).toBeNull();         // id no longer matches content
    expect(validateMemoryRecord(null)).toBeNull();
  });

  it('recall is deterministic and honors governed forgetting', () => {
    const recs = [
      buildMemoryRecord({ content: 'alpha event about memory', createdAt: '2026-07-16T00:00:01.000Z' }),
      buildMemoryRecord({ content: 'beta event about memory', createdAt: '2026-07-16T00:00:02.000Z' }),
      buildMemoryRecord({ content: 'gamma unrelated', createdAt: '2026-07-16T00:00:03.000Z' }),
    ];
    const hits = recall(recs, { text: 'memory' });
    expect(hits.map((h) => h.content)).toEqual(['alpha event about memory', 'beta event about memory']);
    // forget alpha -> invisible, content never returned
    const forgotten = new Set([recs[0].recordId]);
    const after = recall(recs, { text: 'memory' }, forgotten);
    expect(after.map((h) => h.content)).toEqual(['beta event about memory']);
    expect(liveMemoryCount(recs)).toBe(3);
    expect(liveMemoryCount(recs, forgotten)).toBe(2);
  });
});
