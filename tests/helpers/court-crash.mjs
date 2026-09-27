/**
 * **A CRASH GETS ITS OWN EXIT CODE, SO CI CANNOT READ IT AS `NOT_READY` (cohesion plan §3 AUMLOK, row 16).**
 *
 * ── THE FOUR VERDICTS, AND WHY THE FOURTH WAS MISSING ─────────────────────────────────────────────────────
 *
 *     0   the arms ran and all of them passed
 *     1   the arms ran and at least one FAILED
 *     2   NOT RUN — the court could not exercise its subject (no console, no second uid, no scratch base)
 *     3   **CRASHED** — a throw outside the arms, so the totals were never reached
 *
 * **A CRASH USED TO LOOK LIKE `1` OR LIKE `2`, DEPENDING ON THE COURT.** `protocol` rethrew from its
 * `uncaughtException` handler, so node printed the stack and exited **1** — indistinguishable from *an arm failed*,
 * and the CI step reported `the protocol court exited NON-ZERO (exit 1) (green arms)`, which is a sentence that
 * contradicts itself. `ingress` exited **2**, which reads as *could not exercise its subject* when the truth is *it
 * tried and fell over*. **NEITHER IS A VERDICT ON THE ARMS**, and the arms are the only thing a court is for.
 *
 * ── WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────────────────────────────────
 *
 * It reaps — because a court that starts a daemon as another user leaks it if a throw skips the cleanup — then
 * prints the court's name, the stack's first frames and a NAMED CEILING, and exits **3**. **IT DOES NOT RETHROW**:
 * a rethrow hands the verdict back to node, and node's exit code is not part of this project's vocabulary. *A
 * verdict expressed by the runtime is a verdict nobody agreed on.*
 *
 * @param {object} options
 * @param {() => void} [options.reap] cleanup to run before exiting — the same idempotent reaper the signals use.
 * @param {string} options.court the court's name, so the line says WHICH court crashed.
 * @param {number} [options.code] the crash code, overridable for a court with a reason to differ.
 * @returns {(cause: unknown) => void} the handler, for `process.on('uncaughtException', …)`.
 */
export function crashExit({ reap = () => {}, court, code = 3 } = {}) {
  return (cause) => {
    try { reap() } catch { /* the reaper is best-effort on the way out */ }
    const where = cause && typeof cause === 'object' && typeof cause.stack === 'string'
      ? cause.stack.split('\n').slice(0, 5).join('\n    ')
      : String(cause)
    process.stdout.write('\n')
    process.stdout.write(`CRASHED: ${court} threw outside its arms and never reached its totals.\n`)
    process.stdout.write(`    ${where}\n`)
    process.stdout.write('CEILING: a throw outside the arms leaves every total UNREACHED, so the arms that did print\n')
    process.stdout.write('  are not a verdict on this court — and this is NOT exit 1, which means an arm failed, and\n')
    process.stdout.write(`  NOT exit 2, which means the court could not exercise its subject. ${String(code)} means CRASHED.\n`)
    process.exit(code)
  }
}

/** The crash code, exported so the CI step and the courts cannot disagree about which number it is. */
export const CRASH_EXIT_CODE = 3
