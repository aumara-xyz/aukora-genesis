// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Append-only effect-event LOG + destroy-and-rebuild proof (overnight brick 6).
 *
 * The log is the PROTECTED EVENT STREAM: an append-only sequence of validated effect events. The canonical
 * projection (one row per effectId, see effectEvent.ts) is a DERIVED cache over that stream. This module proves
 * the HARD ACCEPTANCE criterion: destroy the projection, rebuild it purely from the event stream, and obtain the
 * IDENTICAL state and root — on any backend, in any replay order.
 *
 * Because the projection is a pure function of the event SET (content-addressed id + payload hash), a rebuild
 * from a re-ordered or partially-redelivered stream converges to the same root. A crash between appends therefore
 * loses only UNAPPENDED events — never a settled projection, and never silently: a conflicting replay quarantines.
 *
 * Authority stays OUTSIDE: the log only ever admits `validateEffectEvent`-passing rows, so no signature, key, or
 * authority-shaped material can enter the stream.
 */
import {
  type EffectEventV1, type EffectProjection,
  validateEffectEvent, projectEffectEvents, effectProjectionRoot,
} from './effectEvent.js';

export type AppendResult = 'accepted' | 'refused';

export class EffectEventLog {
  /** The protected event stream — append-only; validated rows only. */
  private readonly entries: EffectEventV1[] = [];
  private refusedCount = 0;

  /** Append one delivery. A malformed/authority/secret row is REFUSED (never enters the stream), counted. */
  append(delivery: unknown): AppendResult {
    const e = validateEffectEvent(delivery);
    if (e === null) { this.refusedCount += 1; return 'refused'; }
    this.entries.push(e);
    return 'accepted';
  }

  /** Append many; returns how many entered the stream vs were refused in THIS call. */
  appendAll(deliveries: readonly unknown[]): { readonly appended: number; readonly refused: number } {
    let appended = 0;
    for (const d of deliveries) if (this.append(d) === 'accepted') appended += 1;
    return { appended, refused: deliveries.length - appended };
  }

  get length(): number { return this.entries.length; }
  get refused(): number { return this.refusedCount; }

  /** A COPY of the protected event stream — mutating it cannot corrupt the log (append-only integrity). */
  stream(): readonly EffectEventV1[] { return this.entries.slice(); }

  /** The DERIVED canonical projection (recomputed from the stream every call — no hidden mutable cache). */
  projection(): EffectProjection { return projectEffectEvents(this.entries); }

  /** Stable root over the canonical projection — equal iff the projected SET is equal. */
  root(): string { return effectProjectionRoot(this.projection()); }
}

/**
 * Destroy a projection and rebuild it PURELY from the protected event stream. Returns the rebuilt projection +
 * root. This is the executable form of "destroy the Convex projection, rebuild from the trusted event stream,
 * obtain identical state/root" — the caller compares the returned root to the pre-destroy root.
 */
export function rebuildFromStream(stream: readonly unknown[]): { readonly projection: EffectProjection; readonly root: string } {
  const projection = projectEffectEvents(stream);
  return { projection, root: effectProjectionRoot(projection) };
}
