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

  return { selected, wastedReserved, droppedGoverned, droppedAmbient }
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
