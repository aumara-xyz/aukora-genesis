// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Staleness — ONE LAW, re-exported.
 *
 * The canonical staleness implementation lives in `@aukora/kernel/staleness` (consolidated there in R32 by the
 * recursion lane, commit e929adf; strict canonical UTC parsing, no platform date parser, no ambient clock).
 * This module is a PURE RE-EXPORT so `@aukora/memory` keeps its public surface with NO duplicate
 * implementation — R33 item 1 collapses the former copy to this import. No logic may be added here.
 */
export {
  DEFAULT_DRAFT_HORIZON_MS,
  EXPIRING_SOON_WINDOW_MS,
  canonicalIsoFromMs,
  stampExpiresBy,
  stalenessVerdict,
  challengeStalenessGate,
  stalenessGrantsAuthority,
  type StalenessVerdict,
  type ChallengeStalenessDecision,
} from '@aukora/kernel/staleness';
