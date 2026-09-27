// φ — THE EPISTEMIC ENVELOPE, AND WHY FORGETTING HAS TO CASCADE
//
// ══ THE STATUS THAT CANNOT COLLAPSE ══
//
// Every artifact — an observation, an embedding, a summary, an index entry, a reconstructed geometry,
// a rendered view, a claim, an adapter — carries what it IS with respect to the world:
//
//     observed · reconstructed · inferred · simulated · generated
//
// The rule that makes the label worth anything: **it can only ever get weaker.** Saving an imagined
// viewpoint must never make it observed. A summary of a guess is a guess. A view rendered from a
// reconstruction is at best a reconstruction, and if a model filled in the gaps it is generated —
// forever, in every descendant, with no path back to "observed".
//
// Without that, the strongest word in the vocabulary is available to anything that writes a file.
//
// ══ AND THE HARDER HALF: ERASURE MUST CASCADE ══
//
// `docs/MEMORY-PORT.md` §2 already warns about exactly this. If a photograph is forgotten, the
// geometry reconstructed from it, the views rendered from that geometry, the embeddings, the
// summaries, the clusters and any adapter trained on it must die with it. Otherwise "provable
// erasure" is false the first time anything derives from anything — the plaintext is gone and a live,
// queryable descendant of it is still sitting there answering questions.
//
// ══ WHAT THIS IS NOT, AND §2 IS THE REASON ══
//
// `MEMORY-PORT.md` §2 says that when a derivative-producing feature arrives, the donor's LEASE
// mechanism must come back with it "in full, not reinvented smaller". This is not that, and it does
// not pretend to be. The lease solves a different problem: making a lineage claim TRUE, by gating
// reads so an unregistered derivative is provably unreadable. This solves what happens ONCE a lineage
// is declared.
//
// So the honest claim is **cascading erasure over DECLARED lineage**, and it is exactly as good as
// the producer's honesty. A producer that reads A and declares it derived from B still leaves a live
// descendant of A. That hole is the lease's, it is still open, and this suite says so out loud rather
// than letting "provable erasure" travel unqualified.

import { describe, it, expect } from 'bun:test';

import {
  STATUS_ORDER, weakestStatus, sealEnvelope, deriveEnvelope,
  derivativeClosure, cascadeForget, auditErasure,
} from '../core/memory/epistemic';

const at = '2026-08-02T00:00:00.000Z';
const base = { consent: 'private' as const, provenance: 'the owner\'s camera', at };

/** A photograph: the only kind of thing that gets to be `observed`. */
const photo = () => sealEnvelope({ ...base, artifactId: 'photo-1', status: 'observed', uncertainty: 0.01 });

describe('the status vocabulary is ordered, and the order is the rule', () => {
  it('runs from observed to generated', () => {
    expect(STATUS_ORDER).toEqual(['observed', 'reconstructed', 'inferred', 'simulated', 'generated']);
  });

  it('the weakest of a set wins', () => {
    expect(weakestStatus(['observed', 'observed'])).toBe('observed');
    expect(weakestStatus(['observed', 'inferred'])).toBe('inferred');
    expect(weakestStatus(['reconstructed', 'generated', 'inferred'])).toBe('generated');
    expect(weakestStatus([])).toBe('observed');
  });
});

describe('OBSERVED is not something you can claim about a derivative', () => {
  it('an observation has no sources — that is what makes it one', () => {
    expect(photo().ok).toBe(true);
    const bad = sealEnvelope({ ...base, artifactId: 'x', status: 'observed', uncertainty: 0.01, sourceIds: ['photo-1'] });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/observed/i);
  });

  it('SAVING AN IMAGINED VIEWPOINT DOES NOT MAKE IT OBSERVED', () => {
    // The sentence the whole envelope exists for. A view rendered from a reconstruction, with a model
    // filling in what the camera never saw, is `generated` — and no amount of saving, re-saving or
    // re-labelling walks it back up the vocabulary.
    const p = photo().envelope!;
    const geometry = deriveEnvelope({
      ...base, artifactId: 'geom-1', from: [p], claimed: 'reconstructed', uncertainty: 0.2,
    }).envelope!;
    const imagined = deriveEnvelope({
      ...base, artifactId: 'view-1', from: [geometry], claimed: 'observed', uncertainty: 0.4,
      modelDigest: 'sha256:beef',
    });
    expect(imagined.ok).toBe(true);
    expect(imagined.envelope!.status).not.toBe('observed');
    expect(imagined.envelope!.status).toBe('reconstructed');
  });

  it('a claim can only WEAKEN a derivative, never strengthen it', () => {
    const p = photo().envelope!;
    const guess = deriveEnvelope({ ...base, artifactId: 'g', from: [p], claimed: 'inferred', uncertainty: 0.5, modelDigest: 'sha256:aa' }).envelope!;
    expect(guess.status).toBe('inferred');

    // Derived from a guess, claiming to be a reconstruction: refused down to the source's status.
    const laundered = deriveEnvelope({ ...base, artifactId: 'l', from: [guess], claimed: 'reconstructed', uncertainty: 0.5, modelDigest: 'sha256:bb' }).envelope!;
    expect(laundered.status).toBe('inferred');

    // And claiming something weaker is honoured — you may always admit to less.
    const admitted = deriveEnvelope({ ...base, artifactId: 'm', from: [guess], claimed: 'generated', uncertainty: 0.9, modelDigest: 'sha256:cc' }).envelope!;
    expect(admitted.status).toBe('generated');
  });

  it('the weakest source sets the ceiling, not the first one', () => {
    const p = photo().envelope!;
    const g = deriveEnvelope({ ...base, artifactId: 'g', from: [p], claimed: 'generated', uncertainty: 0.9, modelDigest: 'sha256:d' }).envelope!;
    const merged = deriveEnvelope({ ...base, artifactId: 'sum', from: [p, g], claimed: 'reconstructed', uncertainty: 0.5, modelDigest: 'sha256:e' }).envelope!;
    expect(merged.status).toBe('generated');
    expect([...merged.sourceIds].sort()).toEqual(['g', 'photo-1']);
  });
});

describe('a model that filled something in has to say which model', () => {
  it('inferred, simulated and generated all require a model digest', () => {
    for (const status of ['inferred', 'simulated', 'generated'] as const) {
      const r = sealEnvelope({ ...base, artifactId: 'x', status, uncertainty: 0.5 });
      expect(r.ok, `${status} without a digest must be refused`).toBe(false);
      expect(r.reason).toMatch(/model digest/i);
    }
  });

  it('observed must NOT carry one — a camera is not a model', () => {
    const r = sealEnvelope({ ...base, artifactId: 'x', status: 'observed', uncertainty: 0.01, modelDigest: 'sha256:aa' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/model digest/i);
  });

  it('anything not observed must state an uncertainty', () => {
    const r = sealEnvelope({ ...base, artifactId: 'x', status: 'reconstructed', uncertainty: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/uncertainty/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// THE CASCADE
// ═════════════════════════════════════════════════════════════════════════════
/** photo → geometry → view → embedding, plus a summary off the geometry. */
function world() {
  const p = photo().envelope!;
  const geom = deriveEnvelope({ ...base, artifactId: 'geom', from: [p], claimed: 'reconstructed', uncertainty: 0.2 }).envelope!;
  const view = deriveEnvelope({ ...base, artifactId: 'view', from: [geom], claimed: 'generated', uncertainty: 0.6, modelDigest: 'sha256:v' }).envelope!;
  const embed = deriveEnvelope({ ...base, artifactId: 'embed', from: [view], claimed: 'generated', uncertainty: 0.6, modelDigest: 'sha256:e' }).envelope!;
  const summary = deriveEnvelope({ ...base, artifactId: 'summary', from: [geom], claimed: 'inferred', uncertainty: 0.4, modelDigest: 'sha256:s' }).envelope!;
  const unrelated = sealEnvelope({ ...base, artifactId: 'other-photo', status: 'observed', uncertainty: 0.01 }).envelope!;
  return [p, geom, view, embed, summary, unrelated];
}

describe('forgetting the photograph kills everything downstream of it', () => {
  it('the closure is transitive, not one hop', () => {
    const closure = derivativeClosure(world(), ['photo-1']);
    expect([...closure].sort()).toEqual(['embed', 'geom', 'photo-1', 'summary', 'view']);
  });

  it('and the unrelated observation survives untouched', () => {
    const { forgotten, surviving } = cascadeForget(world(), ['photo-1']);
    expect(surviving.map((e) => e.artifactId)).toEqual(['other-photo']);
    expect(forgotten.has('other-photo')).toBe(false);
  });

  it('forgetting a DERIVATIVE does not kill its source — the cascade runs one way', () => {
    // Deleting a rendered view must not delete the photograph it came from. A cascade that ran both
    // directions would make one careless deletion destroy the archive.
    const { forgotten } = cascadeForget(world(), ['view']);
    expect([...forgotten].sort()).toEqual(['embed', 'view']);
    expect(forgotten.has('photo-1')).toBe(false);
    expect(forgotten.has('geom')).toBe(false);
  });

  it('a diamond dies once, not twice', () => {
    const p = photo().envelope!;
    const a = deriveEnvelope({ ...base, artifactId: 'a', from: [p], claimed: 'reconstructed', uncertainty: 0.2 }).envelope!;
    const b = deriveEnvelope({ ...base, artifactId: 'b', from: [p], claimed: 'reconstructed', uncertainty: 0.2 }).envelope!;
    const j = deriveEnvelope({ ...base, artifactId: 'j', from: [a, b], claimed: 'inferred', uncertainty: 0.4, modelDigest: 'sha256:j' }).envelope!;
    const closure = derivativeClosure([p, a, b, j], ['photo-1']);
    expect([...closure].sort()).toEqual(['a', 'b', 'j', 'photo-1']);
  });

  it('a lineage cycle terminates rather than hanging', () => {
    // Cycles should be impossible if ids are content-addressed, but a store that HANGS on malformed
    // input is a store an attacker can stop by writing one bad record.
    const cyc = [
      { artifactId: 'x', sourceIds: ['y'] } as never,
      { artifactId: 'y', sourceIds: ['x'] } as never,
    ];
    expect([...derivativeClosure(cyc, ['x'])].sort()).toEqual(['x', 'y']);
  });
});

describe('the erasure audit is what makes the claim checkable', () => {
  it('after a cascade, no survivor references anything forgotten', () => {
    const { forgotten, surviving } = cascadeForget(world(), ['photo-1']);
    const audit = auditErasure(surviving, forgotten);
    expect(audit.ok).toBe(true);
    expect(audit.dangling).toEqual([]);
  });

  it('AND IT CATCHES A HALF-DONE DELETION — the whole point of auditing', () => {
    // The failure mode: someone deletes the photograph and its geometry by hand and leaves the view.
    // Integrity is intact, the file is gone, and a live descendant still answers questions about it.
    const all = world();
    const surviving = all.filter((e) => !['photo-1', 'geom'].includes(e.artifactId));
    const audit = auditErasure(surviving, new Set(['photo-1', 'geom']));
    expect(audit.ok).toBe(false);
    expect(audit.dangling.map((d) => d.artifactId).sort()).toEqual(['summary', 'view']);
    expect(audit.dangling[0]!.references).toContain('geom');
  });
});

describe('THE BOUNDARY — declared lineage is not leased lineage', () => {
  it('the module says so itself, because the difference is the whole risk', () => {
    // `docs/MEMORY-PORT.md` §2: when a derivative-producing feature arrives, the lease mechanism must
    // come back "in full, not reinvented smaller". This is the half that acts on a declaration; the
    // half that makes a declaration TRUE is still absent. A producer that reads A and declares it
    // derived from B still leaves a live descendant of A, and nothing here can tell.
    const { readFileSync } = require('fs') as typeof import('fs');
    const src = readFileSync(new URL('../core/memory/epistemic.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/declared lineage/i);
    expect(src).toMatch(/lease/i);
    expect(src).toMatch(/MEMORY-PORT/);
    // And it must not overclaim in its own words.
    expect(/\bprovable erasure\b(?![^.]*not)/i.test(src.replace(/\s+/g, ' ')), 'must not claim provable erasure unqualified').toBe(false);
  });
});
