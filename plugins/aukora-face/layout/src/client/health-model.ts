/**
 * ORGANISM HEALTH — what the panel says, and the ring that keeps it from growing forever.
 *
 * Peter lost disk to 45 GB of leaked test copies and lost the app to a backend heap leak that OOMs at about 4 GB after
 * about 2.3 hours, and found out only when things broke. This panel exists so that the next time, he finds out from a
 * screen rather than from a failure.
 *
 * **THREE RULES, AND EACH IS A COURT.**
 *
 *  1. **EVERY NUMBER SAYS WHERE IT CAME FROM.** A fact is either known, with the source named, or unknown **with the
 *     reason** — never a zero standing in for "nobody asked". This lane has found an empty state pretending to be a
 *     zero five times; a health panel is where that habit would be most expensive, because the whole point is to be
 *     believed when things are fine.
 *  2. **THE RING IS BOUNDED BY CONSTRUCTION.** `pushSample` returns a NEW array of at most `HEALTH_RING_SIZE` samples.
 *     Growth is not managed here, it is impossible: the only function that adds a sample also drops the oldest. A court
 *     pushes ten times the ring and requires the length to be exactly the ring.
 *  3. **THE RESTART RECOMMENDATION IS NOT MINE.** ALPHA's watchdog owns the threshold and the decision
 *     (`apps/aukora-desktop/footprint-watch.mjs`: `FOOTPRINT_LIMIT_BYTES` at 3.4 GB, `restartDecision` with its two
 *     absolute rules — never mid-approval, never unquiet). This module says only how CLOSE the footprint is, and names
 *     the fraction as its own judgement; whether to restart is theirs, and the panel will not recommend it while an
 *     approval is open.
 *
 * @module health-model
 */


/** The surface's name, in one place: the menu opens it, the shell registers it, a court can name it without a literal. */
export const HEALTH_SURFACE = 'health'

/** Where a number came from, in words a person can check. **A fact without this is not allowed to be known.** */
export type HealthFact<T> =
  | { readonly known: true; readonly value: T; readonly from: string }
  | { readonly known: false; readonly why: string }


/** Bytes in plain words: one decimal for gigabytes, whole numbers below, and never a bare number of bytes. */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${String(bytes)} B`
}

/**
 * A rate in plain words, with its sign — **and null when there is no rate to give.**
 *
 * "not enough history yet" is a different statement from "+0 MB/min", and the difference is the whole reason this panel
 * can be believed: a flat line drawn from one reading claims a stability nobody has observed.
 */
export function formatRate(bytesPerMinute: number | null | undefined, _t: (key: never) => string): string | null {
  if (typeof bytesPerMinute !== 'number' || !Number.isFinite(bytesPerMinute)) return null
  const magnitude = formatBytes(Math.abs(bytesPerMinute))
  if (magnitude === null) return null
  const sign = bytesPerMinute > 0 ? '+' : bytesPerMinute < 0 ? '-' : '±'
  return `${sign}${magnitude}/min`
}

/** One sample of the organism, taken by the host on its own interval. */
export interface HealthSample {
  /** When it was taken, as an ISO instant. */
  readonly at: string
  /** Free space on the volume the state lives on, in bytes. */
  readonly freeDiskBytes: number | null
  /** AUKORA's own scratch under the temp directory, in bytes. */
  readonly scratchBytes: number | null
  /** The backend's footprint, from the same reader the watchdog uses. Null when it could not be read. */
  readonly footprintBytes: number | null
  /** The machine's memory pressure level, as `kern.memorystatus_level` reports it. */
  readonly pressureLevel: number | null
  /** Lanes running, and how many of them are waiting on the owner. */
  readonly lanesRunning: number | null
  readonly lanesWaiting: number | null
  /** The last CI result for the pushed branch, when something knows it. */
  readonly ci: string | null
}

/** Disk below this is worth a warning. **The goal's number, not a preference of mine.** */
export const DISK_WARN_BYTES = 20 * 1024 ** 3

/** How close to ALPHA's limit counts as "nearing" it. **MY JUDGEMENT, and named as mine** — the limit itself is theirs. */
export const NEAR_LIMIT_FRACTION = 0.8

/** Where the watchdog's limit lives, quoted so a reader can check it rather than trust this file. */
export const FOOTPRINT_LIMIT_SOURCE = 'apps/aukora-desktop/footprint-watch.mjs FOOTPRINT_LIMIT_BYTES'

/**
 * The shortest window a rate may be computed over.
 *
 * **MY JUDGEMENT, AND THE REASON IT EXISTS**: the panel samples every 30 to 60 seconds, and a rate taken across two
 * adjacent samples is dominated by whichever reading was noisy — 4 GB to 5 GB in one second is "60 GB/min", which is a
 * number that would frighten somebody about nothing. Five minutes is the shortest window in which a backend's growth is
 * a trend rather than a jitter.
 */
export const MIN_TREND_MINUTES = 5

/** Bytes per minute over the samples given, or null when there are too few to say. **Null is not zero.** */
export function growthRateOf(samples: readonly HealthSample[], field: 'footprintBytes' | 'scratchBytes' = 'footprintBytes'): number | null {
  const points = samples
    .map(sample => ({ at: Date.parse(sample.at), value: sample[field] }))
    .filter((point): point is { at: number; value: number } => Number.isFinite(point.at) && typeof point.value === 'number')
  if (points.length < 2) return null
  const first = points[0]
  const last = points[points.length - 1]
  // **THE GUARD ABOVE ALREADY PROVES BOTH EXIST; THIS STATES IT WHERE THE COMPILER CAN SEE IT.** `points.length < 2`
  // returned a line earlier, so neither can be undefined here — **but `noUncheckedIndexedAccess` types every indexed
  // read as possibly-undefined, and it cannot see that a length check on one line establishes the next.** The
  // alternative, a non-null assertion, would assert the same thing **without leaving a branch for the case where the
  // assumption is wrong** — and this file's own comment two lines down records a court catching exactly that kind of
  // disagreement between a promise and the code beside it.
  if (first === undefined || last === undefined) return null
  const minutes = (last.at - first.at) / 60000
  // **A RATE NEEDS TIME TO HAVE PASSED — AND THE COMMENT ABOVE USED TO PROMISE THIS WHILE THE CODE ONLY REJECTED ZERO.**
  // My first version tested `minutes > 0`, so two samples a second apart produced "60 GB/min" while the sentence beside
  // it said such pairs give a wild number and are refused. The court caught the disagreement by driving exactly that
  // pair. Prose outrunning measurement, in a file whose job is to measure, is the class this lane keeps meeting — so the
  // rule the sentence promised is now the rule the code enforces.
  if (!(minutes >= MIN_TREND_MINUTES)) return null
  return (last.value - first.value) / minutes
}

/** How close the footprint is to the watchdog's limit. `over` is where THEIR decision starts, not mine. */
export function proximityOf(footprintBytes: number | null, limitBytes: number): 'unknown' | 'below' | 'near' | 'over' {
  if (typeof footprintBytes !== 'number' || !Number.isFinite(footprintBytes) || footprintBytes <= 0) return 'unknown'
  if (footprintBytes >= limitBytes) return 'over'
  return footprintBytes >= limitBytes * NEAR_LIMIT_FRACTION ? 'near' : 'below'
}

/** The trend of one series, in words, with the number it came from. */
export interface Trend {
  readonly perMinute: number | null
  readonly from: string
}

/** The whole panel, as the view renders it. */
export interface HealthView {
  readonly disk: HealthFact<{ readonly freeBytes: number; readonly warn: boolean }>
  readonly scratch: HealthFact<{ readonly bytes: number }>
  readonly footprint: HealthFact<{ readonly bytes: number; readonly proximity: 'below' | 'near' | 'over' }>
  readonly pressure: HealthFact<{ readonly level: number }>
  readonly lanes: HealthFact<{ readonly running: number; readonly waiting: number }>
  readonly ci: HealthFact<{ readonly result: string }>
  readonly footprintTrend: Trend
  readonly scratchTrend: Trend
  /** True only when the watchdog's own limit has been passed — and never while an approval is open. */
  readonly restartRecommended: boolean
}

/** The sources, named once, so a fact's `from` cannot drift from where it was actually read. */
export const HEALTH_SOURCES = {
  disk: 'statfs on the state volume',
  scratch: 'AUKORA-owned prefixes under the temp directory',
  footprint: FOOTPRINT_LIMIT_SOURCE,
  pressure: 'sysctl kern.memorystatus_level',
  lanes: 'the Auma status route (/api/auma-live/status)',
  ci: 'the last CI result for the pushed branch',
} as const

/**
 * The panel, from the newest sample and the ring behind it.
 *
 * @param ring - the samples, oldest first. The newest is the current reading.
 * @param limitBytes - the watchdog's limit, passed in rather than assumed, so this module cannot silently disagree.
 * @param approvalOpen - whether a person is being asked to approve right now. **A restart is never recommended then.**
 */
export function healthOf(ring: readonly HealthSample[], limitBytes: number, approvalOpen = false): HealthView {
  const newest = ring.length > 0 ? ring[ring.length - 1] : null
  const unknown = (why: string): { readonly known: false; readonly why: string } => ({ known: false, why })
  // **"A NUMBER IS THERE" IS THE TEST, NOT "IT IS NOT NULL".** A field that arrives as `undefined` — a sample from an
  // older shape, a reader that forgot a key — would have passed a null check and rendered as known-and-empty, which is
  // the exact class this lane keeps finding. `has()` is the only way a fact below becomes known.
  const has = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)
  return {
    disk: !has(newest?.freeDiskBytes)
      ? unknown('the state volume was not read')
      : { known: true, value: { freeBytes: newest!.freeDiskBytes as number, warn: (newest!.freeDiskBytes as number) < DISK_WARN_BYTES }, from: HEALTH_SOURCES.disk },
    scratch: !has(newest?.scratchBytes)
      ? unknown('AUKORA’s scratch was not measured')
      : { known: true, value: { bytes: newest!.scratchBytes as number }, from: HEALTH_SOURCES.scratch },
    footprint: !has(newest?.footprintBytes)
      ? unknown('the footprint reader gave nothing')
      : {
          known: true,
          value: { bytes: newest!.footprintBytes as number, proximity: proximityOf(newest!.footprintBytes as number, limitBytes) as 'below' | 'near' | 'over' },
          from: HEALTH_SOURCES.footprint,
        },
    pressure: !has(newest?.pressureLevel)
      ? unknown('the kernel was not asked')
      : { known: true, value: { level: newest!.pressureLevel as number }, from: HEALTH_SOURCES.pressure },
    lanes: !has(newest?.lanesRunning)
      ? unknown('the status route did not answer')
      : {
          known: true,
          value: { running: newest!.lanesRunning as number, waiting: has(newest!.lanesWaiting) ? (newest!.lanesWaiting as number) : 0 },
          from: HEALTH_SOURCES.lanes,
        },
    // **`undefined` FELL THROUGH THIS GUARD AND REACHED `newest.ci`.** The test was
    // `newest?.ci === null || newest === null` — **for `undefined` the first is `undefined === null` (false) and the
    // second is `undefined === null` (false), so the else branch ran and read a property of nothing.** The compiler
    // caught it as `TS18048: 'newest' is possibly 'undefined'`; **at runtime it would have been a crash in the health
    // panel, which is the panel Peter opens when something is already wrong.**
    //
    // **THREE CASES, NAMED SEPARATELY, BECAUSE `null` AND `undefined` ARRIVED FROM DIFFERENT PLACES**: no sample at
    // all, and a sample whose CI answer was explicitly null. Both mean the same thing to the reader — **nothing has
    // been read** — and both must say so rather than reaching for a field.
    ci: newest === undefined || newest === null || newest.ci === null
      ? unknown('no CI result has been read')
      : { known: true, value: { result: newest.ci }, from: HEALTH_SOURCES.ci },
    footprintTrend: { perMinute: growthRateOf(ring, 'footprintBytes'), from: HEALTH_SOURCES.footprint },
    scratchTrend: { perMinute: growthRateOf(ring, 'scratchBytes'), from: HEALTH_SOURCES.scratch },
    // **THE ONE PLACE THAT WOULD BE TEMPTING TO OVERREACH.** The limit is ALPHA's, the decision is ALPHA's, and their
    // second absolute rule is never to restart mid-approval — so this is false whenever an approval is open, whatever
    // the number says. A panel that recommends the one thing the watchdog refuses is worse than no panel.
    restartRecommended: !approvalOpen && proximityOf(newest?.footprintBytes ?? null, limitBytes) === 'over',
  }
}
