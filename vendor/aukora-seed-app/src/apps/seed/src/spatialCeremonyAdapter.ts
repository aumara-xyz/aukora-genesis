// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Read-only LIVE ceremony/event adapter for the Spatial shell (R34).
 *
 * The donor Spatial organs are read-only DOM views over JSON snapshots ("every panel renders what already exists;
 * nothing mutates"). This adapter is the governed-pipeline side of that contract for the NEW monorepo: the pipeline
 * PUSHES display-safe ceremony views and AURA geometry as they happen; the shell face can only READ bounded JSON
 * snapshots and incremental events. Hard separations:
 *   - AUMLOK authority and AURA geometry stay SEPARATE surfaces: `ceremonies` carries receipt-backed verdicts
 *     (already display-projected — fingerprints and prefixes only), `geometry` carries the receipt-backed evolution
 *     AURA may render. Nothing here computes, combines, or exposes an apply predicate — `feedsApply` is a hard false;
 *   - the shell face (`shellFace`) exposes ONLY reads; the push face never returns store handles to the caller;
 *   - every snapshot is fence-audited (`assertViewSafe`) before it leaves — a leaking snapshot is refused, not served.
 *
 * Pure/in-memory. A serve layer (the shell lane) may wrap `shellFace` in HTTP endpoints without importing any
 * authority code — this module never signs, never verifies, never applies.
 */
import { assertViewSafe, type CeremonyView } from './ceremonyView.js';
import type { AuraGeometry, GeometryLog } from './geometry.js';
import { readOnlyView, type ReadOnlyEventStream } from './eventStream.js';

export const ADAPTER_LIMITS = Object.freeze({
  MAX_CEREMONIES: 256,
  MAX_SNAPSHOT_CEREMONIES: 32,
  MAX_SNAPSHOT_GEOMETRY: 64,
} as const);

export interface CeremonyEventRecord {
  readonly seq: number;
  readonly view: CeremonyView;
}

export interface SpatialCeremonySnapshot {
  readonly schema: 'aukora-spatial-ceremony-snapshot-v1';
  readonly enabled: true;
  /** AUMLOK side — receipt-backed ceremony verdicts, display-projected (fingerprints + prefixes only). */
  readonly ceremonies: readonly CeremonyEventRecord[];
  /** AURA side — receipt-backed geometric evolution the shell may render. Never an apply input. */
  readonly geometry: readonly AuraGeometry[];
  readonly totals: { readonly ceremonies: number; readonly geometryFrames: number };
  readonly classification: 'DISPLAY_ONLY';
  readonly feedsApply: false;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

/** The strictly read-only face handed to the Spatial shell — no push, no store handle, no apply surface. */
export interface SpatialShellFace {
  readonly schema: 'aukora-spatial-shell-face-v1';
  snapshot(): SpatialCeremonySnapshot | null;
  /** Ceremony events with seq > `afterSeq` — lets the shell poll incrementally. */
  eventsSince(afterSeq: number): readonly CeremonyEventRecord[];
  readonly geometry: ReadOnlyEventStream<AuraGeometry>;
  readonly feedsApply: false;
  readonly grantsAuthority: false;
}

export class SpatialCeremonyAdapter {
  private readonly ceremonies: CeremonyEventRecord[] = [];
  private seq = 0;

  constructor(private readonly geometryLog: GeometryLog) {}

  /**
   * Pipeline-side push: record a ceremony view as a live event. The view must already be display-projected
   * (`toCeremonyView`) AND must pass the fence — a leaking view is refused (false) and never enters the stream.
   */
  push(view: CeremonyView): boolean {
    if (view.grantsAuthority !== false || view.classification !== 'DISPLAY_ONLY') return false;
    if (!assertViewSafe(view).safe) return false;
    this.seq += 1;
    this.ceremonies.push({ seq: this.seq, view });
    if (this.ceremonies.length > ADAPTER_LIMITS.MAX_CEREMONIES) this.ceremonies.shift();
    return true;
  }

  /** Bounded, fence-audited snapshot. Returns null rather than serving a snapshot that fails the fence. */
  snapshot(): SpatialCeremonySnapshot | null {
    const geometry = this.geometryLog.all();
    const snap: SpatialCeremonySnapshot = {
      schema: 'aukora-spatial-ceremony-snapshot-v1',
      enabled: true,
      ceremonies: this.ceremonies.slice(-ADAPTER_LIMITS.MAX_SNAPSHOT_CEREMONIES),
      geometry: geometry.slice(-ADAPTER_LIMITS.MAX_SNAPSHOT_GEOMETRY),
      totals: { ceremonies: this.ceremonies.length, geometryFrames: geometry.length },
      classification: 'DISPLAY_ONLY',
      feedsApply: false,
      advisoryOnly: true,
      grantsAuthority: false,
    };
    return assertViewSafe(snap).safe ? snap : null;
  }

  eventsSince(afterSeq: number): readonly CeremonyEventRecord[] {
    const from = Number.isSafeInteger(afterSeq) ? afterSeq : 0;
    return this.ceremonies.filter((e) => e.seq > from);
  }

  /** Build the read-only shell face. It closes over reads only — pushing stays with the pipeline. */
  shellFace(): SpatialShellFace {
    return {
      schema: 'aukora-spatial-shell-face-v1',
      snapshot: () => this.snapshot(),
      eventsSince: (afterSeq: number) => this.eventsSince(afterSeq),
      geometry: readOnlyView<AuraGeometry>(() => this.geometryLog.all()),
      feedsApply: false,
      grantsAuthority: false,
    };
  }
}

/** HARD: the adapter renders evolution; it never influences an apply predicate. Constant, by construction. */
export function adapterFeedsApply(): false {
  return false;
}
