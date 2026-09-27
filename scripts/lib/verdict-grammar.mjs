/**
 * THE VERDICT GRAMMAR, SHARED BY ONE COMMAND — and compared, line by line, with the older sibling that states the
 * same grammar in prose: aukora-37's `verifier/cold_verify_all.py`. SIBLINGS MUST AGREE (Guardian rule 5), so the
 * numbers and the words below are not this file's invention; where genesis and aukora-37 differed, this file follows
 * aukora-37, except for one case where aukora-37 is measurably wrong (see CLAIMS and the note to Peter).
 *
 *     CLEAN       exit 0   every GATING layer VALID, and every layer evaluated
 *     ERROR       exit 1   operational: the command cannot do its job at all (bad invocation, unreadable workflow)
 *     RED         exit 2   any layer REFUSED — and every refused layer is NAMED
 *     INCOMPLETE  exit 3   any layer NOT_CHECKED or UNDETERMINED, or any layer not evaluated at all
 *
 * WHY ERROR IS 1 AND NOT 2: aukora-37 measured this — its argparse usage error exits 2, which is the code its own
 * grammar assigns to RED, so "you typed the command wrong" and "the evidence was refused" are the same number to a
 * reader of `$?`. An operational failure must not borrow a verdict's code.
 *
 * WHY REFUSE RATHER THAN ACCUSE: aukora-37 separates `_LayerRefusal` ("evidence invalid/mismatched") from
 * `_LayerUndetermined` ("the layer cannot decide"), and reports a missing anchor as NOT_CHECKED rather than skipping
 * it. Genesis followed neither, so a missing prerequisite — a tool that is not installed, a harness that was never
 * built, a machine that refused for memory — read as an accusation against the subject. `classifyFailure` is that
 * distinction, in one place, so both layers and any future layer answer it the same way.
 *
 * WHY A SUBSET IS NEVER A PASS: aukora-37's own rule is that "one green layer NEVER erases an unchecked layer". A
 * reviewer may run one layer — that is useful — but the headline for a subset is INCOMPLETE and names the layers that
 * were not evaluated, because `$?` is read by CI and by scripts that never see the prose.
 */

/** The six statuses a layer can report, and the four verdicts they produce. */
export const STATUS = Object.freeze({
  VALID: 'VALID',
  REFUSED: 'REFUSED',
  NOT_CHECKED: 'NOT_CHECKED',
  UNDETERMINED: 'UNDETERMINED',
  /** Never gates: it is printed so a reader can see what the run does NOT establish. */
  REPORTED: 'REPORTED',
})

export const VERDICT_EXIT = Object.freeze({ CLEAN: 0, ERROR: 1, RED: 2, INCOMPLETE: 3 })

/** The sixth layer: always printed, never gates. Its lines are what a CLEAN headline does NOT mean. */
export const CLAIMS_LAYER = 'CLAIMS-NOT-ESTABLISHED'
export const CLAIM_LINES = Object.freeze([
  'CLEAN means the named layers passed at this pin — never safe-in-the-wild',
  'a NOT_CHECKED / UNDETERMINED layer is never erased by a green headline',
  'KEYLESS ONLY — the build, the release cut, the parity boot and every privileged path are NOT exercised here',
  'COURTS ARE NOT PROOF OF THE WORLD — a court goes red when its protection is removed; green means the protection is present in THIS tree, not that any behaviour was observed',
  'WORKING_TREE — the reading is this checkout at this commit; an uncommitted file changes what a court measures',
  'MACHINE_NOT_REPAIRED — the heavy-run wrapper refuses below its memory floor; nothing here makes the host healthy',
  'PRODUCER_INDEPENDENCE_NOT_ESTABLISHED — the layers run this tree\'s own courts and its own exporter; no independent implementation is consulted',
  'LATESTNESS: unchecked — nothing here knows whether a newer commit exists',
  'SAME_UID_HOST / KERNEL_TRUSTED',
  'CLAIMS-LEDGER — until docs/CLAIMS-LEDGER.md lands, the claims layer is NOT_CHECKED and the headline is INCOMPLETE by construction',
])

/**
 * Failures that are an INABILITY TO DECIDE rather than invalid evidence. Every entry is a signature this tree has
 * actually produced: a tool that is not installed (`command not found`), a prerequisite that is absent (`ENOENT`,
 * `harness-missing`, an unbuilt `vendor/dsh`), the machine guard refusing, or a step killed outright. A signal or a
 * missing tool says nothing about the subject, so it must never be reported as the subject refusing.
 */
const UNDETERMINED_SIGNATURES = Object.freeze([
  /command not found/u,
  /ENOENT/u,
  /no such file or directory/u,
  /MACHINE SAFETY REFUSED/u,
  /memory-below-floor/u,
  /memory-floor-unreadable/u,
  /harness-missing/u,
  /harness-lock-missing/u,
  /not built/u,
  /is absent/u,
  /Permission denied/u,
  /EACCES/u,
  /uv_os_get_passwd/u,
  /cannot find module/iu,
  // *** THE REHEARSAL'S OWN SENTINEL: A `needs.*` VALUE IT COULD NOT SYNTHESISE, BECAUSE THAT JOB IS NOT
  // REHEARSED LOCALLY. *** `rehearse-all.sh` BUILDS A REAL RESULT FOR EVERY JOB IT RAN; A JOB IT DID NOT RUN
  // KEEPS `<rehearsal: ... UNRECORDED>`, WHICH IS NEITHER `success` NOR `failure` AND IS DESIGNED SO A JUDGE
  // CANNOT ACCIDENTALLY AGREE WITH A DEPENDENCY THAT NEVER RAN. THE AGGREGATOR THEN REFUSES -- CORRECTLY.
  // WHAT WAS WRONG WAS THE CLASSIFICATION: ITS REFUSAL WAS REPORTED AS A **CODE** RED FOR THE COMMIT, WHICH
  // IT NEVER WAS. THE `changes` JOB IS NOT REHEARSED LOCALLY, SO THIS LINE CAN NEVER BE SATISFIED HERE.
  // *** AND IT CANNOT WEAKEN THE GATE: `headline()` FILTERS `UNDETERMINED` INTO THE **GATING** SET AND RETURNS
  // `INCOMPLETE` WITH ITS OWN NON-ZERO EXIT. ONLY "NOTHING GATES" REACHES `CLEAN`. THIS MOVES ONE LINE FROM THE
  // RED BUCKET TO THE INCOMPLETE BUCKET, AND NEITHER ONE IS CLEAN. ***
  /UNRECORDED/u,
])

/**
 * @param {{status?: number|null, signal?: string|null, output?: string}} step
 * @returns {'REFUSED'|'UNDETERMINED'}
 */
export function classifyFailure(step) {
  if (step?.signal !== undefined && step.signal !== null) return STATUS.UNDETERMINED
  const status = step?.status ?? 1
  if (status === 126 || status === 127) return STATUS.UNDETERMINED
  const output = String(step?.output ?? '')
  if (UNDETERMINED_SIGNATURES.some(pattern => pattern.test(output))) return STATUS.UNDETERMINED
  return STATUS.REFUSED
}

/**
 * The headline. A function of the layers and nothing else — no layer can be quietly dropped, because the layers that
 * were NOT evaluated are part of the input.
 *
 * @param {{results: {name: string, verdict: string, detail?: string}[], all: string[], evaluated: string[]}} input
 * @returns {{verdict: 'CLEAN'|'RED'|'INCOMPLETE', exit: number, line: string}}
 */
export function headline({ results, all, evaluated }) {
  const gating = results.filter(one => one.verdict !== STATUS.REPORTED)
  const refused = gating.filter(one => one.verdict === STATUS.REFUSED)
  if (refused.length > 0) {
    const named = refused.map(one => `${one.name} REFUSED${one.detail === undefined ? '' : `: ${one.detail}`}`).join('; ')
    return { verdict: 'RED', exit: VERDICT_EXIT.RED, line: `VERDICT: RED (${named})` }
  }
  const unchecked = gating.filter(one => one.verdict === STATUS.NOT_CHECKED || one.verdict === STATUS.UNDETERMINED)
  const subset = evaluated.length < all.length
  if (unchecked.length > 0 || subset) {
    const parts = unchecked.map(one => `${one.name} ${one.verdict}${one.detail === undefined ? '' : `: ${one.detail}`}`)
    if (subset) {
      const skipped = all.filter(name => !evaluated.includes(name))
      parts.push(`not evaluated: ${skipped.join(', ')}`)
    }
    return { verdict: 'INCOMPLETE', exit: VERDICT_EXIT.INCOMPLETE, line: `VERDICT: INCOMPLETE (${parts.join('; ')})` }
  }
  return { verdict: 'CLEAN', exit: VERDICT_EXIT.CLEAN, line: `VERDICT: CLEAN (${all.join(', ')})` }
}

/** The sixth layer's own reported row: always printed, and structurally unable to gate. */
export function claimsRow() {
  return { name: CLAIMS_LAYER, verdict: STATUS.REPORTED, detail: 'always printed; never gates the headline' }
}

/** Printed on EVERY exit path, including a bad invocation — see the note to Peter about aukora-37's argparse gap. */
export function claimLines() {
  return [`${CLAIMS_LAYER}: ${STATUS.REPORTED} — always printed; never gates the headline`,
    ...CLAIM_LINES.map(line => `  ${line}`)]
}
