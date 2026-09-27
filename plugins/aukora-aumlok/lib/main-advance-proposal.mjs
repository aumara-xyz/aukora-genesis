/**
 * **THE MAIN-ADVANCE PROPOSAL — Peter's click, prepared from the green frontier.**
 *
 * Plan section 5 row 2 and section 2 step 14. `refs/aukora/green` is ALPHA's frontier: the revision every court
 * has passed on. When it is AHEAD of `origin/main`, there is a proposal to make — and until now nothing made it.
 * The record existed, the queue existed, the verifier existed, and **NOBODY ASKED THE QUESTION** *"is there
 * something waiting to go to main, and what exactly would it move?"*
 *
 * ── **NOTHING HERE EXECUTES, AND THAT IS THE WHOLE POINT** ────────────────────────────────────────────────
 *
 * Every git call goes through an injected `run`, and the only thing this module RETURNS is a proposal — a record,
 * a queue item, and the two commands a person can run. **IT HAS NO CODE PATH THAT PUSHES, DISPATCHES, OR UPDATES A
 * REF.** *A proposer that could act is a proposer that acts at three in the morning;* the two steps below are
 * printed for Peter to take, and today they are the only two that work at all.
 *
 * ── **THE TWO STEPS THAT WORK TODAY, WITHOUT ANY SIGNER** ─────────────────────────────────────────────────
 *
 *   1. `git checkout --detach <green-sha>`, then the keyless checks `docs/CLAIMS.md` lists, run by hand. There is
 *      no CI: the workflow that used to run the courts was archived on 2026-09-27 (`ARCHIVE.md`).
 *   2. Once those checks pass on that sha, the **fast-forward** update of `main` that branch protection accepts —
 *      *fast-forward and not force*, because main has no commits the frontier lacks, so nothing is rewritten and
 *      branch protection has nothing to refuse.
 *
 * **NEITHER IS EXECUTED. Both are printed, with the sha filled in, so the click is a paste and not a composition.**
 *
 * ── **THE FOUR FRONTIER STATES, AND ONLY ONE OF THEM PROPOSES** ───────────────────────────────────────────
 *
 *   `ahead`     green has commits main does not  -> EXACTLY ONE proposal
 *   `unchanged` green IS main                    -> nothing to propose, and saying so is the answer
 *   `behind`    main has commits green does not  -> REFUSED BY NAME: *the frontier is not a frontier*
 *   `absent`    the ref does not exist           -> nothing to propose
 */

/** The two refs this module compares. */
export const MAIN_REF = 'refs/heads/main'
export const GREEN_REF = 'refs/aukora/green'

/** Every refusal, by name. */
export const PROPOSAL_REFUSE = Object.freeze({
  FRONTIER_BEHIND: 'proposal:frontier-behind-main',
  FRONTIER_UNREADABLE: 'proposal:frontier-unreadable',
  MAIN_UNREADABLE: 'proposal:main-unreadable',
  GIT_FAILED: 'proposal:git-failed',
})

const refuse = (code, detail) => Object.assign(new Error(detail), { code })

/** Run one git command through the caller's seam, refusing rather than guessing when it fails. */
const gitOut = (run, argv, what) => {
  let result
  try {
    result = run(['git', ...argv])
  } catch (cause) {
    throw refuse(PROPOSAL_REFUSE.GIT_FAILED, `git ${argv.join(' ')} threw while reading ${what}: ${String(cause?.message ?? cause)}`)
  }
  if (result === null || typeof result !== 'object' || result.status !== 0) {
    // **A FAILED GIT CALL IS NOT AN ABSENT REF, AND THE TWO MUST NOT COLLAPSE.** *A read that failed and a ref that
    // is not there produce the same empty string and mean opposite things* — one is "nothing to propose", the other
    // is "nobody knows", and only one of them is safe to report as an answer.
    throw refuse(PROPOSAL_REFUSE.GIT_FAILED,
      `git ${argv.join(' ')} exited ${String(result?.status)} while reading ${what}: ${String(result?.stderr ?? '').trim().slice(0, 120)}`)
  }
  return String(result.stdout ?? '').trim()
}

/**
 * Compare the frontier against main, read-only.
 *
 * @param {{run: Function, mainRef?: string, greenRef?: string}} input
 * @returns {{state: 'ahead'|'unchanged'|'behind'|'absent', main: string|null, green: string|null,
 *            aheadBy: number, behindBy: number}}
 * @throws {Error} `proposal:frontier-behind-main` when main carries commits the frontier lacks.
 */
export function resolveFrontier(input) {
  const run = input.run
  const mainRef = input.mainRef ?? MAIN_REF
  const greenRef = input.greenRef ?? GREEN_REF
  const read = (ref, what, code) => {
    // **A SEAM THAT THROWS IS A READ THAT FAILED, NOT A CRASH TO PROPAGATE.** My first version called `run` bare
    // here, so a spawn that threw escaped as `spawn failed` — *a raw platform error where a named refusal belongs,
    // and the caller cannot tell it from a bug in this module.* `gitOut` already wraps every other call; this one
    // was the exception, and the court found it.
    let result
    try {
      result = run(['git', 'rev-parse', '--verify', '--quiet', ref])
    } catch (cause) {
      throw refuse(code, `reading ${what} (${ref}) threw: ${String(cause?.message ?? cause)}`)
    }
    if (result?.status !== 0) return null
    const sha = String(result.stdout ?? '').trim()
    if (sha === '') throw refuse(code, `${what} (${ref}) resolved to an empty string`)
    return sha
  }
  const main = read(mainRef, 'main', PROPOSAL_REFUSE.MAIN_UNREADABLE)
  if (main === null) {
    throw refuse(PROPOSAL_REFUSE.MAIN_UNREADABLE,
      `${mainRef} does not resolve, so there is no destination to propose moving; refusing rather than `
      + 'proposing a move to a ref nobody can read')
  }
  const green = read(greenRef, 'the frontier', PROPOSAL_REFUSE.FRONTIER_UNREADABLE)
  if (green === null) {
    return Object.freeze({ state: 'absent', main, green: null, aheadBy: 0, behindBy: 0 })
  }
  if (green === main) {
    return Object.freeze({ state: 'unchanged', main, green, aheadBy: 0, behindBy: 0 })
  }
  const count = (range) => {
    const text = gitOut(run, ['rev-list', '--count', range], `the commits in ${range}`)
    const value = Number(text)
    if (!Number.isSafeInteger(value) || value < 0) {
      throw refuse(PROPOSAL_REFUSE.GIT_FAILED, `git rev-list --count ${range} answered ${JSON.stringify(text)}`)
    }
    return value
  }
  const aheadBy = count(`${main}..${green}`)
  const behindBy = count(`${green}..${main}`)
  // **A FRONTIER BEHIND MAIN IS REFUSED, NOT REPORTED AS A NEGATIVE PROPOSAL.** The frontier is the revision the
  // courts passed on; if main has moved past it, then *the thing called green is not the thing main came from*, and
  // proposing an advance from it would propose rewinding main. **THAT IS A QUESTION FOR A PERSON, AND IT IS ASKED
  // BY NAME.**
  if (behindBy > 0) {
    return Object.freeze({ state: 'behind', main, green, aheadBy, behindBy })
  }
  return Object.freeze({ state: 'ahead', main, green, aheadBy, behindBy })
}

/**
 * **WHICH GATE PATHS THIS MOVE ACTUALLY CHANGES, READ FROM THE DIFF.**
 *
 * A gate path is a file whose contents decide what the gate does — the pin, the courts script, the advance program.
 * **A PROPOSAL MUST DECLARE THE ONES IT TOUCHES**, because the verifier refuses a declared-list that does not cover
 * the diff: *a move that silently edits the thing that judges it is the one move the gate exists to refuse.*
 *
 * **AN EMPTY LIST IS A CLAIM, NOT AN ABSENCE.** It says "this moves commits and changes no gate path", and the
 * verifier holds the proposal to it. That is why this computes rather than defaults.
 *
 * @param {Function} run - the git seam.
 * @param {string} from - the commit main is at.
 * @param {string} to - the commit being proposed.
 * @param {ReadonlyArray<string>} [paths] - the gate paths to test against; the caller may supply the pin's own list.
 * @returns {ReadonlyArray<string>} the changed gate paths, sorted.
 */
export function gatePathsChanged(run, from, to, paths) {
  const list = Array.isArray(paths) && paths.length > 0 ? paths : DEFAULT_GATE_PATHS
  let changed = []
  try {
    const out = run(['git', 'diff', '--name-only', `${from}..${to}`])
    if (out?.status === 0) changed = String(out.stdout ?? '').split('\n').map(one => one.trim()).filter(Boolean)
  } catch {
    // **A DIFF THAT CANNOT BE READ CHANGES NOTHING HERE, AND THAT IS DELIBERATE.** This helper only fills in a
    // declaration; the VERIFIER recomputes the diff from `from` and refuses a proposal whose list does not cover
    // it. *A helper that guessed on a failed read would be a second opinion where the verifier is the authority.*
    return Object.freeze([])
  }
  const wanted = new Set(list)
  return Object.freeze(changed.filter(one => wanted.has(one)).sort())
}

/**
 * The gate paths this module assumes when a caller supplies none.
 *
 * **IT IS A FALLBACK, NOT THE AUTHORITY.** The pin at `from` carries its own `gatePaths`, and the verifier reads
 * the list from there — *the list that decides is the list that was trusted.* This copy exists only so a proposal
 * built without a pin still declares something rather than nothing.
 */
// `.github/workflows/b1.yml`, `scripts/aukora-courts.sh` and `tests/GREEN-ONLY.txt` were archived on 2026-09-27
// (ARCHIVE.md). They stay listed so that a change bringing one back is still a gate change.
export const DEFAULT_GATE_PATHS = Object.freeze([
  'AGENTS.md', '.github/workflows/b1.yml', 'docs/owner-pin.json',
  'plugins/aukora-aumlok/lib/repo-advance.mjs', 'plugins/aukora-owner-daemon/lib/consumption-witness.mjs',
  'scripts/aukora-courts.sh', 'scripts/aukora/advance-main.mjs', 'tests/GREEN-ONLY.txt',
])

/** The two commands that work today, with the frontier sha filled in. Printed, never run. */
export function todaysSteps(green) {
  return Object.freeze([
    Object.freeze({
      step: 1,
      what: 'check out the frontier and run the keyless checks docs/CLAIMS.md lists, by hand',
      command: `git checkout --detach ${green}`,
      why: 'there is no CI (the workflow was archived on 2026-09-27), so the checks are run by a person — nothing '
        + 'here runs anything',
    }),
    Object.freeze({
      step: 2,
      what: 'once those checks pass on that sha, fast-forward main',
      // **FAST-FORWARD, NOT FORCE.** The frontier is ahead of main, so main has nothing the frontier lacks and
      // nothing is rewritten; *a force push here would rewrite history that branch protection exists to protect,
      // and it would be refusing to answer a question the fast-forward answers by construction.*
      command: `git push origin ${green}:refs/heads/main`,
      why: 'a fast-forward: main has no commits the frontier lacks, so nothing is rewritten and branch protection '
        + 'has nothing to refuse',
    }),
  ])
}

/**
 * Build the proposal for one frontier, or report that there is none.
 *
 * @param {object} input - `run`, `buildRecord` (the shipped builder), `queue` (a shipped approvals queue),
 *   and the record inputs for `buildRepoAdvance`.
 * @returns {{proposed: boolean, reason?: string, record?: object, line?: string, queueItem?: object,
 *            steps?: ReadonlyArray<object>, frontier?: object}}
 */
export function proposeMainAdvance(input) {
  const frontier = resolveFrontier(input)
  if (frontier.state === 'behind') {
    throw refuse(PROPOSAL_REFUSE.FRONTIER_BEHIND,
      `the frontier ${String(frontier.green).slice(0, 7)} is BEHIND main ${String(frontier.main).slice(0, 7)} by `
      + `${String(frontier.behindBy)} commit(s), so it is not a frontier to advance from — *the thing called green `
      + 'is not the thing main came from*. This is a question for a person, not a proposal')
  }
  if (frontier.state === 'absent') {
    return Object.freeze({
      proposed: false, frontier,
      reason: `${GREEN_REF} does not exist, so there is no frontier to advance from and nothing to propose`,
    })
  }
  if (frontier.state === 'unchanged') {
    return Object.freeze({
      proposed: false, frontier,
      reason: `the frontier IS main (${String(frontier.main).slice(0, 7)}), so there is nothing waiting to advance`,
    })
  }
  const record = input.buildRecord({
    repo: input.repo,
    from: frontier.main,
    to: frontier.green,
    tree: gitOut(input.run, ['rev-parse', `${frontier.green}^{tree}`], 'the frontier tree'),
    commitCount: frontier.aheadBy,
    headlines: gitOut(input.run, ['log', '--format=%s', `${frontier.main}..${frontier.green}`], 'the headlines')
      .split('\n').map(line => line.trim()).filter(Boolean).slice(0, input.maxHeadlines ?? 20),
    // **THE GATE CHANGES ARE COMPUTED FROM THE DIFF, NOT DEFAULTED TO EMPTY (aumlok-136).**
    //
    // This read `input.gateChanges ?? []`, so a caller that did not supply the list proposed **a move that declares
    // it changes no gate path** — and for the first real proposal that is exactly wrong: installing the owner pin
    // IS a change to `docs/owner-pin.json`, which is itself a gate path. *A declaration that defaults to "nothing
    // changed" is a declaration that is false whenever anything did.*
    gateChanges: input.gateChanges ?? gatePathsChanged(input.run, frontier.main, frontier.green, input.gatePaths),
    courtsRunId: input.courtsRunId,
    stampDigest: input.stampDigest,
  })
  // **THE QUEUE ITEM IS CREATED HERE AND NOT BY THE CALLER**, so "one proposal, one queue item" is a property of
  // this module rather than a coincidence of how a script happens to call it.
  const queueItem = input.queue.submit(record, { at: input.at })
  return Object.freeze({
    proposed: true,
    frontier,
    record,
    line: queueItem.line,
    queueItem,
    steps: todaysSteps(frontier.green),
  })
}
