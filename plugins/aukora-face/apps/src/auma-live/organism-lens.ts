// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * THE ORGANISM LENS — what Auma Live is allowed to know about the organism she lives in, and the shape it
 * arrives in.
 *
 * The reading is Aura's, not a second implementation: `readOrganism` and `renderOrganism` come from
 * `plugins/aukora-organism/lib/organism.mjs`, carried into `vendor/organism/` because a face cannot import
 * out of its own package tree at build time, and PINNED BY CONTENT — a court compares the vendored bytes
 * with Aura's file, so a change there turns the copy red instead of letting it drift.
 *
 * THREE RULES LIVE HERE, and each is an arm in `tests/aukora-auma-live-organism-lens.test.mjs`:
 *
 *   1. CAP THE RENDER, NEVER THE READ. The whole status is read and rendered; only the text handed to the
 *      model is capped. Capping the READ would make the cap indistinguishable from a source that failed —
 *      the report would say a lane was unreadable when it was merely long.
 *   2. THE CEILINGS AND THE UNREAD SOURCES SURVIVE TRUNCATION. They are the lines that say what this reader
 *      cannot see. Dropping them turns a bounded report into a confident one, which is the failure mode that
 *      matters: a model that does not know it is missing a source will speak as though it has them all.
 *   3. NO SECRET REACHES THE TEXT. The reader redacts paths and authenticated URLs; this scrubs again at the
 *      injection boundary, by SHAPE, because the boundary is the last place a token can be caught before it
 *      is spoken — and a spoken turn is not recoverable.
 *
 * `dshHome` IS ALWAYS PASSED, NEVER ASSUMED: the reader has no default, and a lens that reached for
 * `homedir()` would read whichever home the process happened to have.
 */
import { lensExec } from './lens-exec.ts'
import { readOrganism, renderOrganism } from '../vendor/organism.ts'

/**
 * One command's result, as the reader's executor contract returns it.
 *
 * DECLARED HERE RATHER THAN IMPORTED: the reader is vendored JavaScript with `@ts-nocheck`, so its own
 * types are `any`. These are the shapes this lens relies on, stated at the boundary where it relies on them.
 */
export interface OrganismExecResult {
  stdout: string
  error: string | null
  /** The child's exit status, or null when it did not exit normally. See `lens-exec.ts`. */
  status?: number | null
}

/** How much of the render one presence turn may carry. */
export const ORGANISM_LENS_MAX_CHARS = 1500

/**
 * Shapes that are withheld wherever they appear.
 *
 * TWO LISTS, ONCE. The reader's own redaction handles local paths and URLs with a query secret; these are
 * the shapes it does not know about, plus the two it does, applied again because being second is the point
 * of an injection boundary.
 */
const SECRET_SHAPES: readonly (readonly [RegExp, string])[] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, '[withheld: private key]'],
  [/\b(?:sk|pk|ghp|gho|ghs|xox[baprs])-[A-Za-z0-9_-]{12,}/gu, '[withheld: token]'],
  [/\bdsh-auth-[A-Za-z0-9_=+/-]{6,}/gu, '[withheld: cookie]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gu, '[withheld: bearer token]'],
  [/\b(?:AUKORA_[A-Z_]*SEED|seed|mnemonic)\b["']?\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{16,}/giu, '[withheld: seed]'],
  [/https?:\/\/\S*[?&](?:token|key|secret|auth)=\S*/giu, '[withheld: authenticated url]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/gu, '[withheld: jwt]'],
]

/**
 * Replace every secret-shaped run with a marker naming what was withheld.
 * @param text - the text about to be spoken.
 * @returns the text with secrets replaced, or the input unchanged when it is not a string.
 */
export function scrubSecrets(text: string): string {
  let out = text
  for (const [pattern, replacement] of SECRET_SHAPES) out = out.replace(pattern, replacement)
  return out
}

/**
 * The injected lens text: read everything, render it, cap the RENDER, then scrub.
 * @param options - the roots, the clock, the executor and the cap.
 * @returns the text one presence turn may carry.
 */
export async function organismLensText(options: {
  dshHome: string
  repo: string
  now?: () => number
  exec?: OrganismExec
  maxChars?: number
  /**
   * WHAT THE LANES CONCLUDED, ALREADY ASSEMBLED — OR ABSENT, WHICH IS A NAMED STATE AND NOT AN ERROR.
   *
   * It arrives as DATA because this face cannot import the module that assembles it (the reader is carried into
   * `vendor/` and may import nothing, and Kira's own digest functions live outside this package tree). The
   * caller resolves the `organism.memory` service and passes the frozen view; when that service is not mounted,
   * `null` travels and every lane keeps `summary: null` — a reader that shows nothing is honest, one that
   * invents a summary is not.
   */
  memory?: unknown
  /**
   * THE LANE'S OWN SESSION EVENTS, SUPPLIED BY THE HOST'S SESSION STORE.
   *
   * It travels the same route as `memory` and for the same reason: `readOrganism` reads FILES, and no projection
   * file carries an approval — so the one fact that says a lane is **blocked on Peter** comes from the events.
   * `readOrganism` gained the parameter and this seam did not, so the type check refused the bundle; and the
   * courts could not have caught it, because they call `readOrganism` directly and never cross here.
   */
  eventsOf?: (sessionId: string) => readonly unknown[]
}): Promise<string> {
  const render = await readOrganismRender(options)
  const capped = capOrganismRender(render, options.maxChars ?? ORGANISM_LENS_MAX_CHARS)
  return scrubSecrets(capped)
}

/**
 * The full render of a full read — NEVER truncated here.
 *
 * The cap belongs to the turn, not to the instrument: this function is the instrument's answer, and the
 * caller decides how much of it fits.
 * @param options - the roots, the clock, the executor and the assembled memory view.
 * @returns Aura's own render of everything she could read.
 */
export async function readOrganismRender(options: {
  dshHome: string
  repo: string
  now?: () => number
  exec?: OrganismExec
  memory?: unknown
  /**
   * THE LANE'S OWN SESSION EVENTS, SUPPLIED BY THE HOST'S SESSION STORE.
   *
   * It travels the same route as `memory` and for the same reason: `readOrganism` reads FILES, and no projection
   * file carries an approval — so the one fact that says a lane is **blocked on Peter** comes from the events.
   * `readOrganism` gained the parameter and this seam did not, so the type check refused the bundle; and the
   * courts could not have caught it, because they call `readOrganism` directly and never cross here.
   */
  eventsOf?: (sessionId: string) => readonly unknown[]
}): Promise<string> {
  const { dshHome } = options
  if (typeof dshHome !== 'string' || dshHome === '') {
    throw new Error('organism-lens: dshHome is required and is never assumed; pass the home this app was configured with')
  }
  if (typeof options.repo !== 'string' || options.repo === '') {
    throw new Error('organism-lens: repo is required; the reports and the git tip are read from it')
  }
  const exec = options.exec ?? organismExec
  const { eventsOf } = options
  // AWAITED: `readOrganism` now awaits its two command readers rather than blocking on them.
  return String(renderOrganism(await readOrganism({
    dshHome, repo: options.repo, now: options.now, exec, memory: options.memory ?? null,
    ...(eventsOf === undefined ? {} : { eventsOf }),
  })))
}

/**
 * Cap the render, keeping the header, the unread sources and the ceilings whole.
 *
 * WHAT IS DROPPED AND WHAT IS NOT: the tail from `SOURCES NOT READ` or `CEILING:` onward is kept entire —
 * it is the part that says what this report cannot see — and the lines above it are added until the budget
 * runs out, so a lane that survives is a lane in the order Aura wrote it. When the protected tail alone is
 * larger than the cap, the tail wins and the result is longer than the cap: the cap governs what may be
 * dropped, and those lines are what may not be.
 * @param render - the full render.
 * @param maxChars - the budget for the injected text.
 * @returns the capped render.
 */
export function capOrganismRender(render: string, maxChars: number = ORGANISM_LENS_MAX_CHARS): string {
  if (render.length <= maxChars) return render
  const lines = render.split('\n')
  const header = lines[0] ?? ''
  const rest = lines.slice(1)
  const tailStart = rest.findIndex(line => /^\s*(SOURCES NOT READ|CEILING:)/u.test(line))
  const body = tailStart === -1 ? rest : rest.slice(0, tailStart)
  const tail = tailStart === -1 ? [] : rest.slice(tailStart)
  // THE BUDGET IS COMPUTED AGAINST A WORST-CASE NOTICE, because the notice is added after the lines are
  // chosen and its own length depends on how many were dropped — a circularity that made the first version
  // of this function return 1529 characters for a 1500-character cap. The digits of `body.length` are the
  // largest the count can be, so budgeting for those is budgeting for the worst case.
  const worstNotice = noticeFor(maxChars, body.length)
  const budget = maxChars - header.length - worstNotice.length - tail.join('\n').length - 3
  const kept: string[] = []
  let used = 0
  for (const line of body) {
    if (used + line.length + 1 > budget) break
    kept.push(line)
    used += line.length + 1
  }
  // **THE LANE NAMES MAKE THE NOTICE LONGER, WHICH IS THE CIRCULARITY THIS FUNCTION ALREADY DOCUMENTS — SO IT IS
  // RESOLVED BY SHRINKING RATHER THAN BY BUDGETING FOR A WORST CASE THAT CANNOT BE BOUNDED.** Naming the dropped
  // lanes adds as many characters as there are lanes with long names, and a worst-case estimate would have to
  // assume the longest label in the body. Instead the total is measured and lines are given back until it fits,
  // which terminates because every iteration removes at least one line.
  const assembled = (): string => {
    const droppedLines = body.slice(kept.length)
    const names: string[] = []
    for (const line of droppedLines) {
      const label = /^[\s*\-•]*([A-Za-z][A-Za-z0-9-]{1,20})/u.exec(line)?.[1]
      if (label !== undefined && !kept.join('\n').includes(label) && !names.includes(label)) names.push(label)
    }
    const dropped = body.length - kept.length
    const notice = dropped === 0 ? []
      : [noticeFor(maxChars, dropped) + (names.length === 0 ? '' : ` Lanes no longer named here: ${names.join(', ')}.`)]
    return [header, ...kept, ...notice, ...tail].join('\n')
  }
  let rendered = assembled()
  while (rendered.length > maxChars && kept.length > 0) {
    kept.pop()
    rendered = assembled()
  }
  return rendered
  // **THE BLOCK THAT FOLLOWED HERE WAS UNREACHABLE, AND THE BUILD WAS THE ONLY THING THAT SAID SO.**
  // A round-19 refactor replaced it with `assembled()` above and left the original in place AFTER the new
  // `return rendered` — so it never ran, and `tsc` type-checked it anyway. **Dead code is not free: it keeps
  // compiling, it keeps failing, and it reads as the live implementation to anyone opening the file.**
}

/**
 * The one line that says the render was shortened.
 * @param maxChars - the cap it was shortened to.
 * @param dropped - how many lines were dropped.
 * @returns the notice.
 */
function noticeFor(maxChars: number, dropped: number): string {
  return `  … (truncated at ${String(maxChars)} characters; ${String(dropped)} line(s) dropped, ceilings and unread sources kept whole)`
}

/** The executor the reader runs git and gh through. */
export type OrganismExec = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
) => Promise<OrganismExecResult>

/**
 * Run one command with argv and no shell, the way the reader expects.
 *
 * NO SHELL: `gh run list --json …` and `git log …` are argv arrays, so nothing in a branch name or a path
 * can become a command. A failure is RETURNED rather than thrown, because the reader reports it by name and
 * a thrown error here would lose the name.
 * @param command - the program.
 * @param args - its arguments.
 * @param options - working directory and timeout.
 * @returns stdout and an error string, exactly as the reader's executor contract says.
 */
export function organismExec(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<OrganismExecResult> {
  // **THIS FUNCTION USED TO BE `spawnSync`, AND THAT WAS THE DEFECT.** Every lens read — `git log`, `git status`,
  // `gh run list` — blocked the ONE process hosting all seven lanes and every voice stream for the duration of a
  // subprocess, three of them with a ten-second ceiling and one with none. It now delegates to the shared
  // asynchronous executor, so the loop is never held; `lens-exec.ts` carries the reasoning and the timeout.
  return lensExec(command, args, options)
}
