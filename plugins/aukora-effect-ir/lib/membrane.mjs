/**
 * Fail-closed reading of a membrane observation record.
 *
 * Not the live membrane. Live observation is scripts/aukora/become.mjs
 * membraneObservation, then membraneRefusal. This module does not import that
 * file, and that file does not import this one. Nothing here is executed.
 *
 * Admitted only when every chain in CHAINS is APPEND_ONLY for a reason
 * observeChain already accepts, or UNDETERMINED solely because the prior
 * observation is missing. Conflict, rotation failure, any other undetermined
 * reason, a missing chain, and any other verdict are refused.
 *
 * @module @aukora/effect-ir/membrane
 */
export const CHAINS = Object.freeze(['code', 'actions', 'memory', 'remembered'])
const APPEND_REASONS = new Set(['identical_trees_match', 'valid_append_only_extension'])

function closedRow(row) {
  return typeof row === 'object' && row !== null && !Array.isArray(row)
}

/**
 * @param {unknown} observation `{ chains }` as membraneObservation returns it. Absence refuses.
 */
export function membraneAdmit(observation) {
  if (typeof observation !== 'object' || observation === null || Array.isArray(observation)) {
    return Object.freeze({ ok: false, code: 'membrane:absent', chain: null })
  }
  const chains = observation.chains
  if (typeof chains !== 'object' || chains === null || Array.isArray(chains)) {
    return Object.freeze({ ok: false, code: 'membrane:absent', chain: null })
  }
  for (const name of CHAINS) {
    const row = chains[name]
    if (!closedRow(row)) return Object.freeze({ ok: false, code: 'membrane:absent', chain: name })
    if (row.rotation?.failure) return Object.freeze({ ok: false, code: 'membrane:rotation', chain: name })
    if (row.verdict === 'OBSERVATION_CONFLICT') return Object.freeze({ ok: false, code: 'membrane:conflict', chain: name })
    if (row.verdict === 'UNDETERMINED') {
      if (row.reason === 'missing_prior_observation') continue
      return Object.freeze({ ok: false, code: 'membrane:undetermined', chain: name })
    }
    if (row.verdict !== 'APPEND_ONLY' || !APPEND_REASONS.has(row.reason)) {
      return Object.freeze({ ok: false, code: 'membrane:unknown', chain: name })
    }
  }
  return Object.freeze({ ok: true, code: 'membrane:admitted' })
}
