/**
 * WHETHER THE TURN NEEDS ANOTHER PASS.
 *
 * After each segment the engine asks: is there anything this pass produced that has to be answered before the turn
 * can end? Repository, web, recall, Kira and weights directives each open one more pass, and a refused weights
 * directive does too — **a refusal is something she is TOLD**, and a refusal that never reaches her is a silent
 * drop.
 *
 * **THIS EXISTS AS A FUNCTION BECAUSE THE TURN LOOP CANNOT BE IMPORTED BY A COURT.** `presence.ts` uses TypeScript
 * parameter properties and node's strip-only mode refuses them, so a rule written inline in that loop is a rule no
 * court can measure. The `[core]` term was missing from exactly such an inline condition, and a segment whose ONLY
 * directive was a CORE task fell out of the loop untouched: **no dispatch, no demotion, no named refusal — the tag
 * simply did nothing.**
 *
 * @module segment-loop
 */

/** What one pass produced, as the loop counts it. */
export interface SegmentWork {
  /** Repository lookups that will be answered. */
  readonly repo: number
  /** Web lookups that will be answered. */
  readonly web: number
  /** Recall lookups that will be answered. */
  readonly recall: number
  /** Kira lookups that will be answered. */
  readonly kira: number
  /** Weight verbs that will be answered. */
  readonly weights: number
  /** A weights directive was refused and must be spoken. */
  readonly weightsRefused: boolean
  /** A `[core "task"]` tag is present, whether it will be honoured, refused or demoted. */
  readonly core: boolean
  /**
   * **A CORE report that has NOT YET been handed to her — and the name is the protection.**
   *
   * It was `coreReport`, documented as "waiting to be handed over", and the caller passed whether a report merely
   * EXISTED. **A report that has already been delivered still exists**, so this stayed true and `segmentContinues`
   * opened a pass, and another, and another: **a standing report is a loop, and the loop never ends.** Renaming it
   * makes the wrong question unwritable — a caller now has to know whether the report is UNDELIVERED, which is the
   * only thing the loop may key on.
   */
  readonly coreReportUndelivered: boolean
}

/**
 * Whether the turn must run another pass.
 *
 * **EVERY TERM IS A THING SHE HAS NOT YET BEEN TOLD.** The rule is not "did the model ask for something" — it is
 * "is there a result or a refusal in hand that has to reach her before the turn ends", and a `[core]` tag is both:
 * it either dispatches (and its outcome is reported) or it is refused by name.
 *
 * @param work - what the pass produced.
 * @returns true when another pass is needed.
 */
export function segmentContinues(work: SegmentWork): boolean {
  return work.repo > 0 || work.web > 0 || work.recall > 0 || work.kira > 0 || work.weights > 0
    || work.weightsRefused || work.core || work.coreReportUndelivered
}
