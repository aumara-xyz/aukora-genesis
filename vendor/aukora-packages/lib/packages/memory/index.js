// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * @aukora/memory — KIRA memory law (pure, portable).
 *
 * The constitutional contracts for the organism's memory: a consent-scoped, content-addressed, advisory-only
 * memory envelope; deterministic recall with governed forgetting at read time; the staleness law; and the
 * advisory-containment predicates. No I/O, no clock, no randomness, no authority. The reactive Convex-backed
 * store that persists and grows these records lives in apps/brain (an adapter), never in this package.
 */
export * from './src/envelope.js';
export * from './src/ingestGate.js';
export * from './src/recall.js';
export * from './src/scope.js';
export * from './src/staleness.js';
export * from './src/containment.js';
