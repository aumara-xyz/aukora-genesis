// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Upstream: aumara-xyz/aukora-phi core/memory/staleness.ts
// Commit: a099901ad5a2d623c5343263de6ae5f9994d3159
// SHA-256: vendor/aukora-governed-recall/PROVENANCE.json#/files/17/sha256
// Subtractive JavaScript port: selected function bodies; TypeScript types erased.

export const DEFAULT_DRAFT_HORIZON_MS = 72 * 3_600_000;
export const EXPIRING_SOON_WINDOW_MS = 12 * 3_600_000;

function pad(value, width) {
  return String(value).padStart(width, '0');
}

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function daysFromCivil(year, month, day) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yearOfEra = y - era * 400;
  const monthPrime = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.floor((153 * monthPrime + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(z) {
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

export function parseCanonicalIsoUtcMs(value) {
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

export function canonicalIsoFromMs(ms) {
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

function ageLabelOf(ageMs) {
  const minutes = Math.max(0, Math.round(ageMs / 60_000));
  if (minutes < 60) return `${minutes}m old`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)}h old`;
  return `${Math.round(minutes / (60 * 24))}d old`;
}

export function stalenessVerdict(
  artifact,
  nowMs,
  defaults = {},
) {
  const createdMs = typeof artifact?.createdAt === 'string' ? parseCanonicalIsoUtcMs(artifact.createdAt) : null;
  const stampedMs = typeof artifact?.expiresBy === 'string' ? parseCanonicalIsoUtcMs(artifact.expiresBy) : null;

  if (createdMs === null && stampedMs === null) {
    return { state: 'stale', flagged: true, ageMs: null, ageLabel: 'age unknown', expiresBy: null, horizon: 'unknown-age', expiringSoon: false };
  }

  const horizonMs = defaults.horizonMs ?? DEFAULT_DRAFT_HORIZON_MS;
  const boundaryMs = stampedMs !== null ? stampedMs : (createdMs) + horizonMs;
  const horizon = stampedMs !== null ? 'stamped' : 'default-draft-72h';
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
