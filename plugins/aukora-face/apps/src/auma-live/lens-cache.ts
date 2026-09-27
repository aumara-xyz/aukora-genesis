/**
 * ONE READ PER WINDOW, SHARED BY EVERYONE WHO ASKS INSIDE IT.
 *
 * THE DEFECT THIS EXISTS FOR. The organism lens runs `git log`, `git status` and `gh run list` through a
 * SYNCHRONOUS spawn — three blocking subprocess calls, each with a ten-second timeout — **on every spoken
 * turn, inside the one backend process that hosts all seven lanes.** So one turn could stall every lane for up
 * to half a minute, and two turns in flight would each pay it in full.
 *
 * TWO RULES, AND BOTH ARE COURTS BELOW:
 *
 *   1. **A RESULT IS REUSED FOR A WINDOW (60 s by default).** The status of a repository is not a per-turn
 *      fact; a turn arriving 200 ms after the last one does not need its own `git log`.
 *   2. **CONCURRENT CALLERS SHARE ONE READ, NOT ONE EACH.** The in-flight promise is handed out, so two turns
 *      that overlap cause ONE exec rather than two. This is the rule a plain "cache the value when it lands"
 *      gets wrong: both callers miss the empty cache, and both spawn.
 *
 * **A FAILURE IS NOT CACHED FOR THE WHOLE WINDOW.** A ten-second `gh` timeout would otherwise freeze "CI
 * unknown" in place for a minute after the network came back, which turns a transient failure into a
 * persistent one. A rejection is remembered only long enough to collapse the callers already waiting on it —
 * the shared promise IS the deduplication — and the next caller after that starts a fresh read.
 *
 * A PLAIN `.js` MODULE SO A COURT CAN IMPORT IT. The lens itself is TypeScript with JSX-free types, but this
 * rule is small enough to live where the tests are, and the point of the rule is that it is MEASURED.
 *
 * @module lens-cache
 */

/** The window a successful read is reused for. */
export const LENS_TTL_MS = 60_000

/**
 * @param {() => Promise<unknown>} read - the expensive read
 * @param {{ttlMs?: number, now?: () => number}} [options] - the window, and a clock (injected by the court)
 * @returns {{get: () => Promise<unknown>, peek: () => {value: unknown, ageMs: number} | null, invalidate: () => void, reads: () => number}}
 */
export function lensCache<T>(
  read: () => Promise<T>,
  options: { ttlMs?: number; now?: () => number } = {},
): { get: () => Promise<T>; peek: () => { value: T; ageMs: number } | null; invalidate: () => void; reads: () => number } {
  const ttlMs = options.ttlMs ?? LENS_TTL_MS
  const now = options.now ?? (() => Date.now())
  let settledAt = 0
  let hasValue = false
  let value: T | undefined
  /** The read currently in flight, shared by everyone who asks before it settles. */
  let inFlight: Promise<T> | null = null
  let readCount = 0

  return {
    /** The value, from the window or from a fresh read. Concurrent callers share the same promise. */
    async get() {
      if (hasValue && now() - settledAt < ttlMs) return value as T
      if (inFlight !== null) return inFlight
      readCount += 1
      inFlight = Promise.resolve()
        .then(read)
        .then(
          (result) => {
            value = result
            hasValue = true
            settledAt = now()
            inFlight = null
            return result
          },
          (error) => {
            // **THE FAILURE IS NOT REMEMBERED PAST THIS PROMISE.** Everyone waiting on it sees the same
            // rejection — that is the deduplication — and the next caller after it starts a fresh read.
            inFlight = null
            hasValue = false
            throw error
          },
        )
      return inFlight
    },

    /** What is held, and how stale it is, without triggering a read. For reporting, never for deciding. */
    peek() {
      return hasValue ? { value: value as T, ageMs: now() - settledAt } : null
    },

    /** Drop the window. The next `get` reads. */
    invalidate() {
      hasValue = false
      value = undefined
      settledAt = 0
    },

    /** How many reads have actually been started. The court asserts this is 1 for two concurrent calls. */
    reads() {
      return readCount
    },
  }
}
