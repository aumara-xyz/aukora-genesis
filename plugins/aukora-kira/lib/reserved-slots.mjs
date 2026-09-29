/**
 * PHASE 1 — reserved slots for governed / signed records in the injected recall set.
 *
 * Spec (MEMORY-SPEC-v2 §3 Phase 1): put governed records into the same retrieval
 * ceiling as ambient, tagged by tier. Do NOT implement the tier as a score
 * multiplier (governance hazard). Use reserved slots: at most RESERVED of N,
 * and only when independently eligible (clears the same minScore / threshold).
 *
 * Empty reserved slots when no governed record clears eligibility are intentional;
 * count them as wasted-slot metric (cold eval).
 *
 * @module @aukora/dsh-plugin-kira/reserved-slots
 */

/** At most this many injected slots may be occupied by governed/signed records. */
export const GOVERNED_RESERVED_SLOTS = 2

/**
 * Split raw candidates into INDEPENDENTLY ELIGIBLE ambient and governed sets (A4).
 *
 * THE WINDOW IS MEASURED WITHIN A TIER, NEVER FROM THE BEST SCORE OVERALL. Measured from the best
 * score across both tiers, governed reachability depends on how well the question happened to match
 * ambient text: a governed record that cleared the threshold on its own is discarded because an
 * unrelated ambient note scored `window` higher, its reserved slots stay empty, and governed memory
 * is reachable only when it happens to come within `window` of the best ambient match. The
 * precision device is kept — a weak hanger-on relative to its OWN tier's best is still pruned —
 * without letting one tier veto the other's eligibility.
 *
 * @param {Array<{id: string, score: number, tier?: string}>} candidates best-first
 * @param {{threshold?: number, window?: number}} [limits]
 * @returns {{ambient: Array<object>, governed: Array<object>}} each best-first, order preserved
 */
export function eligibleByTier(candidates, { threshold = 0, window = 0 } = {}) {
  const list = (Array.isArray(candidates) ? candidates : []).filter(Boolean)
  const floor = Number.isFinite(Number(threshold)) ? Number(threshold) : 0
  const span = Number.isFinite(Number(window)) ? Math.max(0, Number(window)) : 0
  const above = list.filter(one => Number.isFinite(Number(one.score)) && Number(one.score) >= floor)
  const within = signed => {
    const set = above.filter(one => (one.tier === 'signed') === signed)
    if (set.length === 0) return []
    const best = set.reduce((top, one) => Math.max(top, Number(one.score)), Number.NEGATIVE_INFINITY)
    return set.filter(one => best - Number(one.score) <= span)
  }
  return { ambient: within(false), governed: within(true) }
}

/**
 * The relative precision window: a hit is eligible only within this distance of its OWN tier's
 * best score (see `eligibleByTier`). **NOT YET A MEASURED CHOICE.**
 *
 * WHAT IS MEASURED (2026-09-28, ten notes, Qwen3-Embedding-0.6B): true matches 0.44–0.69 and
 * unrelated text 0.10–0.33, which is what sets `scoreThreshold` at 0.4. That TRUE-MATCH RANGE
 * SPANS 0.25 — more than double this window. So a query whose true matches span more than 0.10 has
 * genuine matches discarded by THIS number rather than by relevance, and the window sits in tension
 * with the threshold it sits behind: 0.4 is the measured boundary of relevance, and everything
 * above it was measured relevant.
 *
 * WHAT IS NOT MEASURED, and would settle it: the per-query WITHIN-TIER score spread on the real
 * corpus. If that spread is usually below 0.10 the window rarely bites and this value is harmless;
 * if it is usually above 0.10 the window is silently discarding true matches and 0.1 is wrong.
 * Until that is measured this is a DEFAULT, not a finding. `windowVerdict` and `windowEffect` exist
 * so the question is computable from real scores instead of arguable.
 */
export const SEMANTIC_WINDOW = 0.1

/**
 * Whether the relative window can change this tier's eligibility at all.
 *
 * `inert` means the threshold alone decided: the window reached down to the floor, or there was
 * fewer than one pair to compare. `exact` means only the tier's single best can survive. `binding`
 * is the only case where this number is doing any work — and so the only case worth measuring a
 * spread for.
 *
 * @param {{best?: number, floor?: number, span?: number, count?: number}} [input]
 * @returns {'no-hits'|'inert'|'exact'|'binding'}
 */
export function windowVerdict({ best, floor, span, count = 2 } = {}) {
  const b = Number(best)
  const f = Number(floor)
  const s = Number.isFinite(Number(span)) ? Math.max(0, Number(span)) : 0
  const n = Number.isFinite(Number(count)) ? Number(count) : 0
  if (!Number.isFinite(b) || !Number.isFinite(f)) return 'no-hits'
  if (n < 2) return 'inert'
  if (b <= f) return 'inert'
  if (s >= b - f) return 'inert'
  if (s <= 0) return 'exact'
  return 'binding'
}

/**
 * What the window DOES to one tier's scores: how many hits clear the threshold, how many the window
 * keeps, and how many it therefore discards.
 *
 * The window never sees a score below `floor` — `eligibleByTier` applies the threshold first — so
 * `dropped` counts only hits that were MEASURED RELEVANT and removed for being relatively weaker
 * than the best. That number is the whole argument, and it is what a real corpus should be measured
 * for.
 *
 * @param {Array<number>} scores
 * @param {{floor?: number, span?: number}} [limits]
 * @returns {{verdict: string, above: number, kept: number, dropped: number, best: number|null}}
 */
export function windowEffect(scores, { floor = 0, span = 0 } = {}) {
  const list = (Array.isArray(scores) ? scores : []).map(Number).filter(Number.isFinite)
  const f = Number.isFinite(Number(floor)) ? Number(floor) : 0
  const s = Number.isFinite(Number(span)) ? Math.max(0, Number(span)) : 0
  const above = list.filter(one => one >= f)
  if (above.length === 0) return { verdict: 'no-hits', above: 0, kept: 0, dropped: 0, best: null }
  const best = Math.max(...above)
  const kept = above.filter(one => best - one <= s).length
  return {
    verdict: windowVerdict({ best, floor: f, span: s, count: above.length }),
    above: above.length,
    kept,
    dropped: above.length - kept,
    best,
  }
}

/**
 * Merge ambient and governed candidates into a capped injection list.
 *
 * @param {object} input
 * @param {Array<{id: string, score: number, tier?: string}>} input.ambient
 *   Independently eligible ambient / remembered hits, best-first.
 * @param {Array<{id: string, score: number, tier?: string}>} input.governed
 *   Independently eligible governed / signed hits, best-first.
 * @param {number} [input.ceiling=3] Total injected slots (MAX_RECALLED_RECORDS).
 * @param {number} [input.reserved=GOVERNED_RESERVED_SLOTS]
 * @returns {{
 *   selected: Array<{id: string, score: number, tier: string, slot: 'governed'|'ambient'}>,
 *   wastedReserved: number,
 *   droppedGoverned: number,
 *   droppedAmbient: number,
 * }}
 */
export function mergeReservedSlots({ ambient, governed, ceiling = 3, reserved = GOVERNED_RESERVED_SLOTS } = {}) {
  const N = Math.max(0, Math.trunc(Number(ceiling) || 0))
  const R = Math.max(0, Math.min(N, Math.trunc(Number(reserved) || 0)))
  const amb = Array.isArray(ambient) ? ambient.filter(Boolean) : []
  const gov = Array.isArray(governed) ? governed.filter(Boolean) : []

  const seen = new Set()
  const selected = []

  const takeGov = Math.min(R, gov.length, N)
  for (let i = 0; i < takeGov; i += 1) {
    const hit = gov[i]
    const id = String(hit.id)
    if (seen.has(id)) continue
    seen.add(id)
    selected.push({ id, score: Number(hit.score), tier: String(hit.tier ?? 'signed'), slot: 'governed' })
  }
  const wastedReserved = Math.max(0, R - selected.length)

  const ambientRoom = Math.max(0, N - selected.length)
  let takenAmb = 0
  for (const hit of amb) {
    if (takenAmb >= ambientRoom) break
    const id = String(hit.id)
    if (seen.has(id)) continue
    seen.add(id)
    selected.push({ id, score: Number(hit.score), tier: String(hit.tier ?? 'remembered'), slot: 'ambient' })
    takenAmb += 1
  }

  // If reserved seats went unused, fill remaining ceiling from ambient (already done via ambientRoom).
  // If governed had more eligible than R, they are dropped — never score-boosted in.
  const droppedGoverned = Math.max(0, gov.filter(h => !seen.has(String(h.id))).length)
  const droppedAmbient = Math.max(0, amb.filter(h => !seen.has(String(h.id))).length)

  return { selected, wastedReserved, droppedGoverned, droppedAmbient,
    // Legacy wastedReserved counts reservations unused BY GOVERNED, even if ambient filled them.
    unusedGoverned: wastedReserved, borrowedByAmbient: Math.min(wastedReserved, Math.max(0, takenAmb - (N - R))),
    unfilledTotal: N - selected.length,
  }
}

/**
 * Refuse a score-multiplier design. Kept as an explicit export so a future
 * "boost governed by α" PR fails a court that imports this guard.
 */
export function refuseTierScoreMultiplier() {
  return Object.freeze({
    allowed: false,
    reason: 'MEMORY-SPEC-v2 Phase 1: tier must not be a score multiplier; use reserved slots ≤2 of N with independent eligibility',
  })
}
