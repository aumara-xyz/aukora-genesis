/**
 * THE FIELD'S QUALITY LADDER, AND THE WAY BACK UP IT.
 *
 * THE DEFECT, and it is three defects that compound into one visible symptom — "the aurora falls to the dot grid
 * and never comes back":
 *
 *   ① **THE FIRST-FRAME TEST DROPS TO 2D PERMANENTLY.** If the first frame takes over 400 ms the field goes 2D
 *      and, before this module, nothing ever re-tested it.
 *   ② **THE SLOW-FRAME WATCHDOG ACCUMULATES.** `if (gapMs > 90) { if (++slowFrames >= 6) degrade() }` — and the
 *      else branch only DECREMENTS when a frame is fast. A run of 40–90 ms frames is neither slow enough to
 *      count nor fast enough to clear, so the counter sits at 5 and the SIXTH merely-bad frame degrades the
 *      field. A stall of many mediocre frames is not six bad ones.
 *   ③ **`recover()` CANNOT RUN AFTER A CONTEXT LOSS.** It guards on `renderScale < 1 && gl`, and the
 *      `webglcontextlost` handler sets `gl = null` — so the one path that most needs recovery is the one path
 *      that can never take it, and the field stays 2D for the life of the page.
 *
 * THE RULE THIS REPLACES THEM WITH: **clean time, not counts.** After about five seconds of genuinely fast
 * frames the field RE-TESTS WebGL and climbs back if it holds. A frame slower than `FAST_MS` restarts the
 * clock; a mediocre frame neither counts nor clears anything, because it is evidence of nothing either way.
 * Every rung the ladder takes DOWN posts a `field-degraded` message so `server.log` records it — **a limit that
 * does not print did not happen.**
 *
 * **ONE SECOND AFTER A VISIBILITY CHANGE IS IGNORED.** A backgrounded tab produces gaps that say nothing about
 * the GPU, and counting them would degrade the field every time the owner switched away and back.
 *
 * PLAIN `.js`, NO DOM, NO WebGL CALLS: the ladder is a state machine over (elapsed, frame cost, context state),
 * so a court drives it with a fake clock and a fake GL and measures the transitions instead of the pixels.
 *
 * @module field-quality
 */

/** A frame at or below this is "fast" — it is evidence the GPU can keep up. */
export const FAST_MS = 20
/** A frame above this is "slow" and counts against the field, as it always did. */
export const SLOW_MS = 90
/** Sustained fast frames before the field re-tests WebGL. About five seconds at 60 Hz. */
export const RECOVER_AFTER_MS = 5_000
/** The first frame gets this long before the field starts in 2D rather than waiting on a broken GPU. */
export const FIRST_FRAME_BUDGET_MS = 400
/** Gaps in this window after a visibility change are ignored: a hidden tab says nothing about the GPU. */
export const VISIBILITY_GRACE_MS = 1_000

/**
 * @param {Readonly<{onDegrade?: (event: {reason: string, scale: number}) => void}>} [hooks]
 */
export function createFieldQuality(hooks = {}) {
  /** @type {'webgl'|'2d'} */
  let mode = 'webgl'
  let scale = 1
  /** Milliseconds of UNBROKEN fast frames since the last slow frame or recovery attempt. */
  let cleanMs = 0
  /** Wall-clock until which frames are ignored, set by a visibility change. */
  let ignoreUntil = 0
  let attempts = 0
  let contextLost = false

  const announce = (reason) => {
    // **EVERY DROP PRINTS.** A silent degradation is indistinguishable from a field that was never running.
    hooks.onDegrade?.({ reason, scale: mode === '2d' ? 2 : scale })
  }

  const dropTo2d = (reason) => {
    if (mode === '2d') return false
    mode = '2d'
    scale = 2
    cleanMs = 0
    announce(reason)
    return true
  }

  return {
    get mode() { return mode },
    get scale() { return scale },
    get cleanMs() { return cleanMs },
    get attempts() { return attempts },
    get contextLost() { return contextLost },

    /** ① THE FIRST-FRAME TEST. Over budget drops to 2D — but the ladder can now climb back. */
    firstFrame(elapsedMs) {
      if (elapsedMs > FIRST_FRAME_BUDGET_MS) return dropTo2d('first-frame-over-budget')
      return false
    },

    /** A visibility change. Frames inside the grace window are ignored rather than counted. */
    visibilityChanged(atMs) {
      ignoreUntil = atMs + VISIBILITY_GRACE_MS
      return ignoreUntil
    },

    /** ③ A lost context drops to 2D and is REMEMBERED, so recovery knows what to re-create. */
    contextLost_() {
      contextLost = true
      return dropTo2d('webgl-context-lost')
    },

    /** The context came back on its own. The field still has to earn its way back through clean frames. */
    contextRestored() {
      contextLost = false
      cleanMs = 0
      return { mode, cleanMs }
    },

    /**
     * ONE FRAME. Returns what the caller must do, so the decision lives here and the renderer only obeys.
     *
     * @param {Readonly<{atMs: number, gapMs: number}>} frame
     * @returns {{action: 'none'|'drop-2d'|'retry-webgl'|'ignored', reason?: string}}
     */
    frame({ atMs, gapMs }) {
      if (atMs < ignoreUntil) return { action: 'ignored', reason: 'visibility-grace' }
      if (gapMs > SLOW_MS) {
        // ② A SLOW FRAME RESTARTS THE CLOCK. It does not merely decrement a counter, which is what let a run of
        // mediocre frames accumulate into a degradation.
        cleanMs = 0
        if (mode === 'webgl') return dropTo2d('slow-frames') ? { action: 'drop-2d', reason: 'slow-frames' } : { action: 'none' }
        return { action: 'none' }
      }
      if (gapMs > FAST_MS) {
        // MEDIOCRE: neither evidence of health nor of failure. It clears nothing, which is the accumulation bug.
        return { action: 'none', reason: 'mediocre-frame' }
      }
      cleanMs += gapMs
      if (cleanMs >= RECOVER_AFTER_MS) {
        cleanMs = 0
        attempts += 1
        // ③ THE RETRY IS OFFERED IN 2D AS WELL, which is the case that could never recover before.
        return { action: 'retry-webgl' }
      }
      return { action: 'none' }
    },

    /** The field came back up. Called only after a real WebGL frame has been drawn. */
    recovered() {
      mode = 'webgl'
      scale = 1
      cleanMs = 0
      contextLost = false
      return { mode, scale }
    },
  }
}

/**
 * **THE WATCHDOG AS IT SHIPPED, KEPT HERE SO THE RED ARMS TEST THE REAL THING.**
 *
 * A mutation has to be a BEHAVIOUR, not a boolean inside a test: `harness(broken)` flipping an input proved
 * nothing, because the ladder is robust enough to survive a wrong input and every arm still recovered. This is
 * the algorithm that produced "the aurora falls to the dot grid and never comes back", reproduced faithfully —
 * a slow-frame COUNTER that mediocre frames neither increment nor clear, degradation on the sixth slow frame,
 * and a `recover` that only steps the scale and never re-creates a lost context.
 *
 * It lives beside the fix rather than inside one court's fixture because the vault of the defect belongs to the
 * module that fixed it. It is NOT exported for production use and nothing in the app imports it.
 *
 * @param {{onDegrade?: (event: {reason: string, scale: number}) => void}} [hooks]
 */
export function legacyFieldQuality(hooks = {}, options = {}) {
  // `slowMs` is the threshold this watchdog counted against. The app shipped 90; a red arm lowers it to the
  // FAST_MS boundary so that the band the fix exists for becomes "slow" to the old algorithm — a real,
  // behavioural mutation rather than a flag the test reads back.
  const slowMs = options.slowMs ?? SLOW_MS
  let mode = 'webgl'
  let scale = 1
  let slowFrames = 0
  const drop = (reason) => {
    if (mode === '2d') return false
    mode = '2d'
    scale = 2
    hooks.onDegrade?.({ reason, scale })
    return true
  }
  return {
    get mode() { return mode },
    get scale() { return scale },
    get cleanMs() { return 0 },
    get attempts() { return 0 },
    get contextLost() { return mode === '2d' },
    firstFrame(elapsedMs) { return elapsedMs > FIRST_FRAME_BUDGET_MS ? drop('first-frame-over-budget') : false },
    visibilityChanged(atMs) { return atMs + 1_000 },
    contextLost_() { return drop('webgl-context-lost') },
    contextRestored() { return { mode, cleanMs: 0 } },
    frame({ gapMs }) {
      // THE SHIPPED RULE, IN ITS REAL SHAPE: `slowFrames` is the STATE and the DEGRADATION HAPPENS LATER, in the
      // caller — `if (slowFrames >= 6) degrade()`. Reproducing it as a combined check here hid the defect: a
      // steady run of mediocre frames then trips the counter on its own, and the red arm proved nothing. The bug
      // is that the 40–90 ms band neither increments nor clears, so a counter PRE-LOADED by slow frames is
      // pushed over the threshold by a single frame that is only slightly bad.
      if (gapMs > slowMs) slowFrames += 1
      else if (gapMs < 40) { if (slowFrames > 0) slowFrames -= 1 }
      // THE SHIPPED DEGRADATION, which the app performed on the same tick it read the counter.
      if (slowFrames >= 6 && mode === 'webgl') {
        slowFrames = 0
        return drop('slow-frames') ? { action: 'drop-2d', reason: 'slow-frames' } : { action: 'none' }
      }
      return { action: 'none' }
    },
    /** The old `recover()`: scale only, and it required a live context — so a loss could never climb back. */
    recovered() { return { mode, scale } },
  }
}
