// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * **"WHERE ARE WE?" — THE ORGANISM'S STATE, QUOTED RATHER THAN INTERPRETED.**
 *
 * Peter should be able to ask and get the truth without reading seven lanes. **This module is the reading half: it takes
 * the bytes of ALPHA's `organism-state.json` — written by `scripts/aukora/organism-state.mjs` — and returns LINES.** *It
 * fetches nothing, decides nothing, and offers nothing to press.*
 *
 * **A SECOND LENS, NOT A REPLACEMENT FOR `organism-lens.ts`.** *That one carries Aura's reading of the SESSION tree,
 * vendored and pinned by content; this one reads the organism document ALPHA writes.* **They answer different questions and
 * neither may be presented as the other.**
 *
 * ## The one rule everything here follows
 *
 * **IT NEVER INFERS "GREEN" FROM ABSENCE.** *The document's own producer states the principle — "Every field is data;
 * anything unmeasured is null and named in `unknown`" — and this module holds to it in both directions:*
 *
 * - **a field that is `null` is printed as `UNKNOWN`, naming what was not measured** — *never as an absence of problems;*
 * - **a file that is missing, stale or unparseable produces `INDETERMINATE`**, *which is a verdict about the READING and
 *   not about the organism.* **"No reds" and "nobody looked" are the same shape of sentence and opposite facts.**
 *
 * ## What it is not allowed to do
 *
 * **NO ACTIONS. NO BUTTONS. NO LINKS THAT DO ANYTHING.** *Not because they are hard, but because this is a lens: the moment
 * it can act, "where are we?" becomes "what should I press?", and the answer stops describing the organism and starts
 * being an opinion about it.* **Every export here returns `string` or `readonly string[]`** — *a caller cannot accidentally
 * receive something clickable, and there is no shape in this module that can carry a handler.*
 *
 * **AND IT DOES NOT JUDGE HEALTH.** *It reports the frontier sha, the reds with their owners, each lane's goal and commit,
 * whether the running release carries the fixes, the rules with their expiry, and the decisions waiting on Peter.* **If a
 * lane is stuck, this says it is stuck; it does not say whether that is bad.**
 */

/** How old the document may be before the reading is called stale. */
export const ORGANISM_STALE_AFTER_MS = 30 * 60 * 1000

/** What the READING is worth, which is a different question from what the organism is doing. */
export type OrganismVerdict =
  /** Present, parseable, recent — **and only then may anything in it be quoted as current.** */
  | 'ok'
  /** Present and parseable, but older than {@link ORGANISM_STALE_AFTER_MS}. **Named with its age.** */
  | 'stale'
  /** Missing, unparseable, or not this schema. **Nothing about the organism may be concluded from it.** */
  | 'indeterminate'

/** The reading, and the lines to show. `lines` is never empty — see {@link readOrganismState}. */
export interface OrganismStateReading {
  readonly verdict: OrganismVerdict
  readonly why: string
  readonly lines: readonly string[]
}

/**
 * Read the document. **THE ONLY FUNCTION THAT DECIDES HOW MUCH THE READING IS WORTH.**
 *
 * @param raw - the file's bytes, or `undefined` when there is no file.
 * @param nowMs - the current instant, **passed in rather than read, so a court can age a document without waiting.**
 * @returns the verdict and the lines. *`lines` is NEVER empty* — **an empty lens reads as "nothing to report", which is
 *          exactly the inference this module exists to refuse.**
 */
export function readOrganismState(raw: string | undefined, nowMs: number): OrganismStateReading {
  if (raw === undefined || raw.trim() === '') {
    return {
      verdict: 'indeterminate',
      why: 'the organism state file is not there',
      lines: ['INDETERMINATE — the organism state file is not there, so nothing about it is known here.'],
    }
  }

  let document: unknown
  try {
    document = JSON.parse(raw)
  } catch (error: unknown) {
    return {
      verdict: 'indeterminate',
      why: 'the organism state file could not be parsed',
      // **THE PARSE ERROR IS QUOTED, NOT SUMMARISED.** *"unparseable" tells him nothing he can act on; the parser's own
      // message usually names the byte.*
      lines: [
        'INDETERMINATE — the organism state file could not be parsed, so nothing about it is known here.',
        `  ${String((error as { message?: unknown })?.message ?? error).slice(0, 200)}`,
      ],
    }
  }

  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return {
      verdict: 'indeterminate',
      why: 'the organism state file is not a document',
      lines: ['INDETERMINATE — the organism state file is not a JSON object, so nothing about it is known here.'],
    }
  }

  const state = document as Record<string, unknown>
  if (state.schema !== 'aukora.organism-state/1') {
    // **A DOCUMENT WE DO NOT RECOGNISE IS NOT AN OLD DOCUMENT.** *Reading its fields by name would be guessing at a shape,
    // and a guess here prints organism facts that nothing produced.*
    return {
      verdict: 'indeterminate',
      why: 'the file is not an aukora.organism-state/1 document',
      lines: [
        `INDETERMINATE — the file says schema ${JSON.stringify(state.schema)}, which this lens does not read.`,
      ],
    }
  }

  const generatedMs = typeof state.generatedAt === 'string' ? Date.parse(state.generatedAt) : Number.NaN
  if (!Number.isFinite(generatedMs)) {
    return {
      verdict: 'indeterminate',
      why: 'the document carries no readable instant',
      lines: ['INDETERMINATE — the organism state file carries no readable `generatedAt`, so its age cannot be told.'],
    }
  }

  const ageMs = nowMs - generatedMs
  const lines = renderOrganismState(state, ageMs)

  // **STALE IS A VERDICT ABOUT THE READING, AND THE LINES ARE STILL SHOWN.** *Refusing to print them would be worse: he
  // asked where things are, and an old answer LABELLED OLD is more use than no answer.* **What changes is the first line,
  // and that nothing below it may be quoted as current.**
  if (ageMs > ORGANISM_STALE_AFTER_MS) {
    return {
      verdict: 'stale',
      why: `the document is ${describeAge(ageMs)} old`,
      // **THE AGE IS NAMED, AND SO IS THE THRESHOLD IT EXCEEDED.** *"stale" without an age is a mood; with an age it is a
      // measurement he can weigh.*
      lines: [
        `STALE — this was written ${describeAge(ageMs)} ago, older than the ${String(ORGANISM_STALE_AFTER_MS / 60_000)}-minute limit, so none of it is current.`,
        ...lines,
      ],
    }
  }

  return { verdict: 'ok', why: `written ${describeAge(ageMs)} ago`, lines }
}

/**
 * The body of the lens. **EVERY VALUE IS QUOTED FROM THE DOCUMENT OR PRINTED AS `UNKNOWN`.**
 *
 * @param state - a parsed `aukora.organism-state/1` document.
 * @param ageMs - how old it is, already established by the caller.
 */
export function renderOrganismState(state: Readonly<Record<string, unknown>>, ageMs: number): readonly string[] {
  const lines: string[] = []

  // ── THE GREEN FRONTIER ────────────────────────────────────────────────────────────────────────────────────────
  // **THE MOST DANGEROUS FIELD TO DEFAULT IN THE WHOLE DOCUMENT.** *`null` means the frontier was NOT READ* — **not that
  // everything is green** — *and printing "green" for an unmeasured frontier is precisely the inference the objective
  // forbids. The line says which of the two it is.*
  const frontier = state.greenFrontierSha
  lines.push(typeof frontier === 'string' && frontier !== ''
    ? `green frontier: ${frontier.slice(0, 12)}`
    : 'green frontier: UNKNOWN — the frontier was not read, which is not the same as it being clean.')

  // ── THE REDS, WITH OWNERS ─────────────────────────────────────────────────────────────────────────────────────
  const reds = Array.isArray(state.reds) ? state.reds : []
  if (reds.length === 0) {
    // **"NO REDS" IS SAYABLE ONLY BECAUSE THE DOCUMENT WAS READ, PARSED, RECENT AND CARRIES THIS SCHEMA** — *the four
    // conditions the caller established before reaching here.* **Without them the same sentence would be the forbidden
    // inference.** *So the line says where the count came from.*
    lines.push('reds: none reported in this reading')
  } else {
    lines.push(`reds: ${String(reds.length)}`)
    for (const entry of reds.slice(0, 40)) {
      if (entry === null || typeof entry !== 'object') continue
      const red = entry as Record<string, unknown>
      const step = typeof red.step === 'number' || typeof red.step === 'string' ? String(red.step) : '?'
      const court = typeof red.court === 'string' ? red.court : 'unnamed court'
      // **`unassigned` IS THE PRODUCER'S OWN WORD FOR AN OWNERLESS RED AND IS KEPT.** *Rewriting it as "unknown" would
      // lose the fact that the owner registry WAS consulted and had no entry.*
      const owner = typeof red.owner === 'string' && red.owner !== '' ? red.owner : 'unassigned'
      lines.push(`  step ${step} · ${court} · owner ${owner}`)
    }
    if (reds.length > 40) lines.push(`  … and ${String(reds.length - 40)} more`)
  }

  // ── THE LANES ────────────────────────────────────────────────────────────────────────────────────────────────
  const lanes = Array.isArray(state.lanes) ? state.lanes : []
  if (lanes.length === 0) {
    // **AN EMPTY LANE LIST IS A READING, NOT A FACT ABOUT THE LANES.** *The producer DEFAULTS it to `[]` and fills it only
    // when given one, so "no lanes" here means nobody supplied them — which is a claim about the document.*
    lines.push('lanes: NOT REPORTED — the document carries no lane list, so this is not a claim that no lane is running.')
  } else {
    lines.push(`lanes: ${String(lanes.length)}`)
    for (const entry of lanes) {
      if (entry === null || typeof entry !== 'object') continue
      const lane = entry as Record<string, unknown>
      const name = typeof lane.name === 'string' ? lane.name : 'unnamed'
      const goal = typeof lane.goalId === 'string' && lane.goalId !== '' ? lane.goalId : 'no goal'
      const phase = typeof lane.phase === 'string' && lane.phase !== '' ? lane.phase : 'phase unknown'
      const commit = typeof lane.lastCommit === 'string' && lane.lastCommit !== ''
        ? lane.lastCommit.slice(0, 9)
        : 'no commit'
      lines.push(`  ${name}: ${goal} · ${phase} · ${commit}`)
    }
  }

  // ── THE RUNNING RELEASE, AND WHETHER IT CARRIES THE FIXES ────────────────────────────────────────────────────
  const release = state.release
  if (release === null || release === undefined) {
    lines.push('running release: NOT REPORTED — no release was named when this was written.')
  } else if (typeof release === 'object' && !Array.isArray(release)) {
    const r = release as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : 'unnamed'
    const sha = typeof r.sha === 'string' && r.sha !== '' ? r.sha.slice(0, 12) : 'sha UNKNOWN'
    lines.push(`running release: ${id} (${sha})`)
    // **THREE STATES, THREE SENTENCES.** *`fixesPresent` is `true`, `false` or `null`, and `null` means the check could not
    // be made* — *so it says that, rather than borrowing either of the other two.*
    if (r.fixesPresent === true) lines.push('  fixes present: YES')
    else if (r.fixesPresent === false) {
      // **SAID PLAINLY, PER THE OBJECTIVE** — *he must not have to infer it from a missing tick.*
      lines.push('  fixes present: NO — the running release does NOT carry the fixes.')
      if (typeof r.reason === 'string' && r.reason !== '') lines.push(`  because: ${r.reason}`)
    } else lines.push('  fixes present: UNKNOWN — the check was not made.')
  } else {
    lines.push('running release: UNKNOWN — the field is not the shape this lens reads.')
  }

  // ── THE STANDING RULES, WITH THEIR EXPIRY ────────────────────────────────────────────────────────────────────
  const rules = Array.isArray(state.rules) ? state.rules : []
  if (rules.length === 0) lines.push('standing rules: none in this reading')
  else {
    lines.push(`standing rules: ${String(rules.length)}`)
    for (const entry of rules) {
      if (entry === null || typeof entry !== 'object') continue
      const rule = entry as Record<string, unknown>
      const id = typeof rule.id === 'string' ? rule.id : '?'
      const text = typeof rule.rule === 'string' ? rule.rule : '(no text)'
      const expires = typeof rule.expires === 'string' && rule.expires !== '' ? rule.expires : 'no expiry'
      // **`expired` IS THE PRODUCER'S OWN TRI-STATE AND IS KEPT AS ONE.** *`null` is "could not be decided", which is not
      // `false`, and collapsing them would let an undecidable rule read as a live one.*
      const mark = rule.expired === true ? ' EXPIRED' : rule.expired === null ? ' expiry UNDECIDED' : ''
      lines.push(`  ${id}${mark}: ${text} (${expires})`)
    }
  }

  // ── THE DECISIONS WAITING ON THE OWNER ───────────────────────────────────────────────────────────────────────
  const decisions = Array.isArray(state.decisions) ? state.decisions : []
  if (decisions.length === 0) {
    // **IT SAYS WHERE THIS SILENCE COMES FROM, BECAUSE THE OBJECTIVE NAMES A SOURCE THAT HAS NOT LANDED YET.** *AK-UI's
    // akui-23 approvals queue joins this list when it lands; until then the list is empty because nothing fills it* —
    // **which is a different fact from "the owner has nothing to decide", and the line says so.**
    lines.push('waiting on the owner: none in this reading — the approvals queue is not yet part of this document.')
  } else {
    lines.push(`waiting on the owner: ${String(decisions.length)}`)
    for (const entry of decisions) {
      if (entry === null || typeof entry !== 'object') continue
      const decision = entry as Record<string, unknown>
      const what = typeof decision.what === 'string' ? decision.what : '(unnamed)'
      const owner = typeof decision.owner === 'string' ? decision.owner : 'owner'
      lines.push(`  ${owner}: ${what}`)
    }
  }

  // ── WHAT THE PRODUCER ITSELF COULD NOT MEASURE ───────────────────────────────────────────────────────────────
  // **THE DOCUMENT NAMES ITS OWN BLANKS, AND THIS LENS PRINTS THEM LAST AND WITHOUT INTERPRETATION.** *It is the producer
  // saying "I could not read this" — the same discipline, one layer down, and the lines a reader most needs when deciding
  // how much of the rest to believe.*
  const unknown = Array.isArray(state.unknown) ? state.unknown : []
  if (unknown.length > 0) {
    lines.push(`not measured by the producer: ${String(unknown.length)}`)
    for (const entry of unknown) {
      if (entry === null || typeof entry !== 'object') continue
      const gap = entry as Record<string, unknown>
      const field = typeof gap.field === 'string' ? gap.field : '?'
      const reason = typeof gap.reason === 'string' ? gap.reason : 'no reason given'
      lines.push(`  ${field}: ${reason}`)
    }
  }

  lines.push(`as of ${describeAge(ageMs)} ago`)
  return lines
}

/**
 * **AN AGE IN WORDS A PERSON READS RATHER THAN PARSES.** *Milliseconds are a number a machine compares; "4 minutes" is what
 * he needs in order to decide whether to trust the rest.*
 *
 * @param ms - a duration, normally non-negative.
 */
export function describeAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'an unknown time'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'less than a minute'
  if (minutes === 1) return '1 minute'
  if (minutes < 60) return `${String(minutes)} minutes`
  const hours = Math.floor(minutes / 60)
  if (hours === 1) return '1 hour'
  if (hours < 24) return `${String(hours)} hours`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day' : `${String(days)} days`
}

/**
 * **THE READER END — the file, then the lines. `readOrganismState` takes BYTES and this is what produces them.**
 *
 * *It is separate from the reading on purpose:* **the parser is testable without a filesystem and the file read is one
 * call**, *which is the same split `organism-lens.ts` makes between `readOrganism` and `organismLensText`.*
 *
 * **AND A READ THAT FAILS IS NOT AN ABSENT FILE.** *`ENOENT` means the state has never been written; `EACCES` and `EIO`
 * mean it may be there and unreadable* — **and the two produce different sentences, because "nobody has looked" and "I
 * cannot look" are different facts about the organism.** *Both are INDETERMINATE; only one of them is the producer's
 * silence.*
 *
 * @param options.stateDir - the directory holding `organism-state.json`, **supplied rather than guessed** — *the
 *   producer's own path is `<state>/organism-state.json` and `<state>` is the caller's to know.*
 * @param options.now - the current instant, **injected so a court can age a document without waiting.**
 * @param options.readFile - injected for the same reason, and so a court can drive `EACCES` without one.
 * @returns the same shape `readOrganismState` returns. *Never throws:* **a lens that raises is a lens that says nothing.**
 */
export async function organismStateLens(options: {
  stateDir: string
  now?: () => number
  readFile?: (path: string) => Promise<string>
}): Promise<OrganismStateReading> {
  const nowMs = options.now?.() ?? Date.now()
  const read = options.readFile ?? (async (path: string) => {
    const { readFile } = await import('node:fs/promises')
    return await readFile(path, 'utf8')
  })
  const path = `${options.stateDir.replace(/\/+$/u, '')}/organism-state.json`

  let raw: string
  try {
    raw = await read(path)
  } catch (error: unknown) {
    const code = (error as { code?: unknown })?.code
    // **`ENOENT` IS THE PRODUCER HAVING WRITTEN NOTHING YET; ANYTHING ELSE IS A FILE THAT MAY EXIST AND CANNOT BE READ.**
    // *Collapsing them would report an unreadable document as a missing one — and a missing one reads as "no organism
    // state exists", which is a claim about the world rather than about the read.*
    const why = code === 'ENOENT'
      ? 'no organism state file has been written'
      : `the organism state file could not be read (${String(code ?? 'no code')})`
    return {
      verdict: 'indeterminate',
      why,
      lines: [`INDETERMINATE — ${why}, so nothing about the organism is known here.`],
    }
  }

  return readOrganismState(raw, nowMs)
}
