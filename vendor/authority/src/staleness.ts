// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Canonical staleness law (pure, portable).
 *
 * The single source of truth for "is this draft/artifact too old to act on?". Consolidated into the kernel so
 * every lane shares ONE law (was duplicated in @aukora/memory, which should re-export this). Donor semantics
 * are preserved exactly:
 *   - expiry means FLAGGED, never hidden;
 *   - UNKNOWN age is flagged stale (fail-closed);
 *   - a stale or unknown-age artifact cannot mint a signing challenge without an explicit owner REVIVE gesture in
 *     the same governed action (`challengeStalenessGate`);
 *   - staleness grants NO authority.
 *
 * Unlike the prior copy, time is parsed with the kernel's STRICT canonical UTC parser (`parseCanonicalIsoUtcMs`)
 * rather than the platform date parser, so the verdict is deterministic across runtimes and a non-canonical
 * timestamp is treated as unknown age (stale) instead of being loosely coerced. No ambient clock: the caller
 * supplies `nowMs`. Pure — no I/O, signing, mutation, or authority grant.
 */
import { parseCanonicalIsoUtcMs } from "./authority.js";

export const DEFAULT_DRAFT_HORIZON_MS = 72 * 3_600_000;
export const EXPIRING_SOON_WINDOW_MS = 12 * 3_600_000;

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** days-since-epoch → civil date (Howard Hinnant's algorithm; the inverse of the kernel's daysFromCivil). Pure. */
function civilFromDays(z: number): { year: number; month: number; day: number } {
  const shifted = z + 719468;
  const era = Math.floor((shifted >= 0 ? shifted : shifted - 146096) / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  const year = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime < 10 ? monthPrime + 3 : monthPrime - 9;
  return { year: month <= 2 ? year + 1 : year, month, day };
}

/** Canonical UTC millisecond → ISO-8601 string, with NO ambient clock (no platform date object). Strict inverse of
 *  `parseCanonicalIsoUtcMs`. Throws on an out-of-range value. */
export function canonicalIsoFromMs(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new Error("staleness_time_out_of_range");
  const totalSeconds = Math.floor(ms / 1000);
  const millis = ms - totalSeconds * 1000;
  const days = Math.floor(totalSeconds / 86400);
  const secondsOfDay = totalSeconds - days * 86400;
  const hour = Math.floor(secondsOfDay / 3600);
  const minute = Math.floor((secondsOfDay % 3600) / 60);
  const second = secondsOfDay % 60;
  const { year, month, day } = civilFromDays(days);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${pad(millis, 3)}Z`;
}

/** Stamp an explicit expiry from a canonical createdAt. Throws on a non-canonical timestamp or a non-positive horizon. */
export function stampExpiresBy(createdAtIso: string, horizonMs: number = DEFAULT_DRAFT_HORIZON_MS): string {
  const createdMs = parseCanonicalIsoUtcMs(createdAtIso);
  if (createdMs === null) throw new Error("staleness_created_at_invalid");
  if (!Number.isSafeInteger(horizonMs) || horizonMs <= 0) throw new Error("staleness_horizon_invalid");
  return canonicalIsoFromMs(createdMs + horizonMs);
}

export interface StalenessVerdict {
  readonly state: "fresh" | "stale";
  readonly flagged: boolean;
  readonly ageMs: number | null;
  readonly ageLabel: string;
  readonly expiresBy: string | null;
  readonly horizon: "stamped" | "default-draft-72h" | "unknown-age";
  readonly expiringSoon: boolean;
}

function ageLabelOf(ageMs: number): string {
  const minutes = Math.max(0, Math.round(ageMs / 60_000));
  if (minutes < 60) return `${minutes}m old`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)}h old`;
  return `${Math.round(minutes / (60 * 24))}d old`;
}

/**
 * Deterministic staleness verdict. Unknown age (neither a canonical createdAt nor a canonical expiresBy) is
 * FLAGGED stale. A stamped expiry wins over the default horizon. `nowMs` is caller-supplied.
 */
export function stalenessVerdict(
  artifact: { readonly createdAt?: unknown; readonly expiresBy?: unknown } | null,
  nowMs: number,
  defaults: { readonly horizonMs?: number } = {},
): StalenessVerdict {
  const createdMs = typeof artifact?.createdAt === "string" ? parseCanonicalIsoUtcMs(artifact.createdAt) : null;
  const stampedMs = typeof artifact?.expiresBy === "string" ? parseCanonicalIsoUtcMs(artifact.expiresBy) : null;

  if (createdMs === null && stampedMs === null) {
    return { state: "stale", flagged: true, ageMs: null, ageLabel: "age unknown", expiresBy: null, horizon: "unknown-age", expiringSoon: false };
  }

  const horizonMs = defaults.horizonMs ?? DEFAULT_DRAFT_HORIZON_MS;
  const boundaryMs = stampedMs !== null ? stampedMs : (createdMs as number) + horizonMs;
  const horizon: StalenessVerdict["horizon"] = stampedMs !== null ? "stamped" : "default-draft-72h";
  const ageMs = createdMs !== null ? Math.max(0, nowMs - createdMs) : null;
  const stale = nowMs >= boundaryMs;

  return {
    state: stale ? "stale" : "fresh",
    flagged: stale || ageMs === null,
    ageMs,
    ageLabel: ageMs === null ? "age unknown" : ageLabelOf(ageMs),
    expiresBy: canonicalIsoFromMs(boundaryMs),
    horizon,
    expiringSoon: !stale && boundaryMs - nowMs <= EXPIRING_SOON_WINDOW_MS,
  };
}

export type ChallengeStalenessDecision =
  | { readonly allow: true; readonly revived: boolean; readonly verdict: StalenessVerdict }
  | { readonly allow: false; readonly reason: "proposal_stale"; readonly verdict: StalenessVerdict };

/**
 * Gate a signing challenge on staleness. A flagged (stale / unknown-age) artifact may proceed ONLY with an explicit
 * owner revive gesture in the same governed action; otherwise it is refused. A fresh artifact passes unconditionally.
 */
export function challengeStalenessGate(verdict: StalenessVerdict, reviveRequested: boolean): ChallengeStalenessDecision {
  if (!verdict.flagged) return { allow: true, revived: false, verdict };
  if (reviveRequested) return { allow: true, revived: true, verdict };
  return { allow: false, reason: "proposal_stale", verdict };
}

/** The staleness law grants no authority — constant, by construction. */
export function stalenessGrantsAuthority(): false {
  return false;
}
