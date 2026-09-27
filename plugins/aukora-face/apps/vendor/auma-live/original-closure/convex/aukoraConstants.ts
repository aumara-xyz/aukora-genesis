// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
/**
 * S1a: CYCLE CUT (Brick V1 in docs/LOCAL_CONVEX_BRAIN_FOUNDATION.md). The donor's aumlokManifests imported
 * FRESHNESS_WINDOW_MS from nodeImport.ts, which pulls the entire multi-node import surface
 * (aukoraWitness / aukoraWireRegistry / popResolver-et-al closure) into the vendor set. Multi-node is
 * PARKED (deliberate, disclosed deviation — no node_* MODULE is vendored; the minimal node_* TABLES the
 * resolver queries are vendored empty in schema.ts so the cross-grant code stays faithful).
 * This leaf module holds the one shared constant. Value copied EXACTLY from donor nodeImport.ts:38.
 */

/** B3.5a pull-origin revocation-view freshness window (cross-grant honor gate). */
export const FRESHNESS_WINDOW_MS = 15 * 60_000;
