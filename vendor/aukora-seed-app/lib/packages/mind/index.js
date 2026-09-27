// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * @aukora/mind — the pure reasoning loop (observe → hypothesize → act → verify).
 *
 * A model-in-the-loop reasoning organ for any observe-act environment: the
 * governor rules, frame rendering (grid + regions + diff), tolerant single-action
 * reply parsing with bounded plans, a parity-safe turn window, one unified
 * rigid-move law shared by diff rendering and plan verification, deterministic
 * plan rollout over an injected simulator, and advisory trace payloads. No I/O,
 * no clock, no randomness, no authority — the caller supplies every port.
 *
 * Distinct from the seed's mind DOOR: this is the pure reasoning-loop package;
 * the governed HTTP surface of the recursion seed lives in apps/seed.
 *
 * Re-authored from the ARC-AGI-3 reasoning engine, aukora-symbiote branch
 * fable/arc3-reasoning-engine-20260710 @ e5768a2f.
 */
export * from './src/ports.js';
export * from './src/governor.js';
export * from './src/plan.js';
export * from './src/grid.js';
export * from './src/reply.js';
export * from './src/window.js';
export * from './src/rollout.js';
export * from './src/trace.js';
