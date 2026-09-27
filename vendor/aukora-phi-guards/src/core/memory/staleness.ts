// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * THE STALENESS LAW — how old is too old, decided without a clock.
 *
 * ══ PROVENANCE ══
 *
 * VENDORED SUBTRACTIVELY from `@aukora/kernel` src/staleness.ts @ ab37835 (blob
 * d57468a95efc21eea936af001b97206ee33670fe8f07ff8d38b3335be50e9924), function bodies verbatim. The
 * donor's `@aukora/memory` carried this as a bare re-export of the kernel package; φ has ZERO runtime
 * dependencies, so the law crosses and the package does not.
 *
 * "Subtractively" is the operative word. The kernel module imports `parseCanonicalIsoUtcMs` from its
 * `authority.ts` — a 700-line file about root keys, suites and revocation, none of which φ needs or
 * should carry. Only that one parser crossed, with the two civil-date helpers it stands on. Nothing
 * else from `authority.ts` is here, and nothing else should arrive later by accident.
 *
 * ══ NO AMBIENT CLOCK, AND THAT IS THE WHOLE DESIGN ══
 *
 * `nowMs` is supplied by the caller and there is no `Date.now()` anywhere in this file. A staleness
 * verdict that read the clock itself could not be reproduced by a skeptic, could not be tested
 * without freezing time, and would give two different answers to the same question a second apart.
 * The same inputs give the same verdict on any machine, forever — which is the only version of
 * "this proposal is stale" that can appear in a receipt.
 *
 * Dates are parsed and formatted by hand rather than through the platform's date object for the same
 * reason: `new Date(s)` accepts a dozen non-canonical spellings and silently normalises them, and a
 * parser that accepts more than it should is a comparison that means less than it claims.
 *
 * ══ AND IT GRANTS NOTHING ══
 *
 * Staleness is evidence about an artifact, never permission to act on one. `stalenessGrantsAuthority`
 * is constant `false` by construction, like every other predicate in this organ.
 */

export const DEFAULT_DRAFT_HORIZON_MS = 72 * 3_600_000;
export const EXPIRING_SOON_WINDOW_MS = 12 * 3_600_000;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** civil date → days-since-epoch (Howard Hinnant's algorithm). Pure. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yearOfEra = y - era * 400;
  const monthPrime = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.floor((153 * monthPrime + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** days-since-epoch → civil date (the inverse of `daysFromCivil`). Pure. */
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

/**
 * Strict canonical ISO-8601 UTC → milliseconds, or null.
 *
 * Exactly `YYYY-MM-DDTHH:MM:SS.mmmZ` and nothing else. No offsets, no missing millis, no `Z`-less
 * spellings, no platform date parser. Anything it cannot read is `null`, which the verdict below
 * treats as unknown age and therefore as STALE — an unreadable timestamp must never read as fresh.
 */
export function parseCanonicalIsoUtcMs(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(value);
  if (!match) return null;
  const [, ys, mos, ds, hs, mis, ss, mss] = match;
  const year = Number(ys), month = Number(mos), day = Number(ds);
  const hour = Number(hs), minute = Number(mis), second = Number(ss), millis = Number(mss);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const result = (((daysFromCivil(year, month, day) * 24 + hour) * 60 + minute) * 60 + second) * 1000 + millis;
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

/** Canonical UTC millisecond → ISO-8601 string, with no platform date object. Strict inverse of the parser. */
export function canonicalIsoFromMs(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('staleness_time_out_of_range');
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
  if (createdMs === null) throw new Error('staleness_created_at_invalid');
  if (!Number.isSafeInteger(horizonMs) || horizonMs <= 0) throw new Error('staleness_horizon_invalid');
  return canonicalIsoFromMs(createdMs + horizonMs);
}

export interface StalenessVerdict {
  readonly state: 'fresh' | 'stale';
  readonly flagged: boolean;
  readonly ageMs: number | null;
  readonly ageLabel: string;
  readonly expiresBy: string | null;
  readonly horizon: 'stamped' | 'default-draft-72h' | 'unknown-age';
  readonly expiringSoon: boolean;
}

function ageLabelOf(ageMs: number): string {
  const minutes = Math.max(0, Math.round(ageMs / 60_000));
  if (minutes < 60) return `${minutes}m old`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)}h old`;
  return `${Math.round(minutes / (60 * 24))}d old`;
}

/**
 * Deterministic staleness verdict.
 *
 * UNKNOWN AGE IS FLAGGED STALE, and that default is the whole safety property: an artifact carrying
 * neither a readable `createdAt` nor a readable `expiresBy` is exactly the artifact whose age an
 * attacker would prefer nobody asked about. A stamped expiry wins over the default horizon, because
 * an explicit statement outranks a policy guess. `nowMs` is caller-supplied.
 */
export function stalenessVerdict(
  artifact: { readonly createdAt?: unknown; readonly expiresBy?: unknown } | null,
  nowMs: number,
  defaults: { readonly horizonMs?: number } = {},
): StalenessVerdict {
  const createdMs = typeof artifact?.createdAt === 'string' ? parseCanonicalIsoUtcMs(artifact.createdAt) : null;
  const stampedMs = typeof artifact?.expiresBy === 'string' ? parseCanonicalIsoUtcMs(artifact.expiresBy) : null;

  if (createdMs === null && stampedMs === null) {
    return { state: 'stale', flagged: true, ageMs: null, ageLabel: 'age unknown', expiresBy: null, horizon: 'unknown-age', expiringSoon: false };
  }

  const horizonMs = defaults.horizonMs ?? DEFAULT_DRAFT_HORIZON_MS;
  const boundaryMs = stampedMs !== null ? stampedMs : (createdMs as number) + horizonMs;
  const horizon: StalenessVerdict['horizon'] = stampedMs !== null ? 'stamped' : 'default-draft-72h';
  const ageMs = createdMs !== null ? Math.max(0, nowMs - createdMs) : null;
  const stale = nowMs >= boundaryMs;

  return {
    state: stale ? 'stale' : 'fresh',
    flagged: stale || ageMs === null,
    ageMs,
    ageLabel: ageMs === null ? 'age unknown' : ageLabelOf(ageMs),
    expiresBy: canonicalIsoFromMs(boundaryMs),
    horizon,
    expiringSoon: !stale && boundaryMs - nowMs <= EXPIRING_SOON_WINDOW_MS,
  };
}

export type ChallengeStalenessDecision =
  | { readonly allow: true; readonly revived: boolean; readonly verdict: StalenessVerdict }
  | { readonly allow: false; readonly reason: 'proposal_stale'; readonly verdict: StalenessVerdict };

/**
 * Gate a signing challenge on staleness. A flagged artifact may proceed ONLY with an explicit owner
 * revive gesture in the same governed action; otherwise it is refused. A fresh artifact passes.
 */
export function challengeStalenessGate(verdict: StalenessVerdict, reviveRequested: boolean): ChallengeStalenessDecision {
  if (!verdict.flagged) return { allow: true, revived: false, verdict };
  if (reviveRequested) return { allow: true, revived: true, verdict };
  return { allow: false, reason: 'proposal_stale', verdict };
}

/** The staleness law grants no authority — constant, by construction. */
export function stalenessGrantsAuthority(): false {
  return false;
}
