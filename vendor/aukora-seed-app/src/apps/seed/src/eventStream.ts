// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Stable read-only event stream contract for the Spatial shell.
 *
 * The shell SUBSCRIBES to evolving AURA geometry/trace frames through a strictly READ-ONLY view — there is no push,
 * apply, authorize, or mutate method on the contract, so display state can never feed an apply decision (one-way by
 * construction). Reads return defensive copies; the underlying log is written only by the governed pipeline.
 *
 * Pure/in-memory. Grants no authority.
 */
import type { AuraGeometry, GeometryLog } from './geometry.js';

export interface ReadOnlyEventStream<T> {
  readonly length: number;
  at(index: number): T | undefined;
  snapshot(): readonly T[];
  /** Frames at index ≥ `fromIndex` — lets the shell pull only what's new. */
  since(fromIndex: number): readonly T[];
}

/** Wrap an append-only source (exposing a read supplier) as a read-only stream. No write surface is exposed. */
export function readOnlyView<T>(supply: () => readonly T[]): ReadOnlyEventStream<T> {
  return {
    get length() { return supply().length; },
    at(index) { return supply()[index]; },
    snapshot() { return supply().slice(); },
    since(fromIndex) { return supply().slice(Math.max(0, fromIndex)); },
  };
}

export interface SpatialStreamContract {
  readonly schema: 'aukora-spatial-stream-v1';
  readonly geometry: ReadOnlyEventStream<AuraGeometry>;
  /** Load-bearing literals: the shell can neither mint authority nor feed an apply from what it displays. */
  readonly grantsAuthority: false;
  readonly feedsApply: false;
}

/** Build the read-only Spatial stream from a geometry log. The shell renders evolution; it never writes back. */
export function spatialStream(geometryLog: GeometryLog): SpatialStreamContract {
  return {
    schema: 'aukora-spatial-stream-v1',
    geometry: readOnlyView<AuraGeometry>(() => geometryLog.all()),
    grantsAuthority: false,
    feedsApply: false,
  };
}

export function spatialStreamGrantsAuthority(): false {
  return false;
}
