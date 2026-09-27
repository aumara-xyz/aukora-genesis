// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara
// Package entry barrel for @aukora/council. Kept OUT of src/ so the canonical sources under
// src/ stay a pure two-module set (the "glyph is consumed only by the council" invariant holds).
// This barrel adds no logic; it re-exports the public surface of the two canonical primitives.
export * from './src/aukoraFuCouncil';
export * from './src/aukoraFuGlyph';
// R60 (Sam 3, directive item 2): unpinned floor-relative disagreement/reason overlay. Lives outside
// src/ so the pinned canonical set stays a pure two-module set; repairs the unreachable `> 0.5` reason
// branch without editing the donor-pinned council/glyph sources (donor-first proposal recorded inside).
export * from './fuDisagreement';
