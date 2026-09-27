/**
 * **THE PROPOSAL PETER APPROVES WHEN HE MOVES MAIN — the record, and nothing else.**
 *
 * Plan `~/aukora-private/plans/AUKORA-AGENTIC-ENGINEERING-PLAN-2026-09-26.md`, section 2 step 6 and section 5
 * row 2. **THIS FILE IS THE FIRST BRICK OF "YOUR CLICK MOVES MAIN" AND IT IS DELIBERATELY ONLY THE BRICK:** it
 * defines the record and its bytes. **There is no verifier here, no push path and no GitHub call** — those are
 * ALPHA's row 3 and Peter's decisions, and a module that quietly did one of them would be making a decision that
 * is not a builder's to make.
 *
 * ── **WHY A RECORD AT ALL, WHEN THE COMMITS ARE ALREADY THERE** ────────────────────────────────────────────
 *
 * `from…to` on main is a fact git can compute. **What git cannot compute is what ELSE moved with it:** whether
 * the verifier changed, whether the pinned owner key changed, whether the court policy or the waivers changed.
 * Those are the files that decide whether the NEXT advance is checked as strictly as this one — *so an advance
 * that carries them silently is an advance that can loosen its own successor.* `gateChanges` is the field that
 * makes that visible, and the display leads with it for that reason.
 *
 * ── **THE BOUNDARY, WHICH DECIDES HOW THIS IS WRITTEN** ────────────────────────────────────────────────────
 *
 * `tests/aukora-aumlok.test.mjs:706` requires every module in `lib/` to import **only `node:` builtins or its own
 * siblings.** So KIRA's `canonicalJSON` (`plugins/aukora-kira/lib/record.mjs:180`, row 28) **cannot be imported
 * here** — and the goal asks for canonical encoding *through* it. **THE TWO ARE RECONCILED THE WAY THIS TREE
 * ALREADY RECONCILES THEM: the encoder is RESTATED and a PARITY ARM proves the bytes are identical.**
 * `record.mjs` says the same thing about its own copy — *"restated from the pinned shared encoder so this package
 * has no runtime dependency on the authority tree."* A restatement with a parity court is a fact; a restatement
 * without one is a hope.
 */
import { createHash } from 'node:crypto'

/** The record's kind, and it is the FIRST THING IN THE ENCODING rather than a field inside it. */
export const REPO_ADVANCE_KIND = 'aukora:repo-advance:v1'

/** At most this many headline subjects. Past it the proposal is a summary nobody reads. */
export const MAX_HEADLINES = 20

/** A git object name: forty lowercase hex characters. */
const HEX40 = /^[0-9a-f]{40}$/u

/**
 * **THE CLOSED FIELD SET, AND "CLOSED" IS THE POINT.**
 *
 * A record that tolerates an unknown field is a record where a new field can be added by whoever writes the
 * file — including a field that changes what the record MEANS while every existing check still passes. So the
 * set is written down here, and a record carrying anything else is refused **by name** rather than ignored.
 */
export const REPO_ADVANCE_FIELDS = Object.freeze([
  'kind', 'repo', 'from', 'to', 'tree', 'commitCount', 'headlines', 'courtsRunId', 'stampDigest', 'gateChanges',
])

/** The named refusals. Every one of them is a fact a reader can act on. */
export const REPO_ADVANCE_REFUSE = Object.freeze({
  NOT_AN_OBJECT: 'repo-advance:not-an-object',
  EXTRA_FIELD: 'repo-advance:extra-field',
  MISSING_FIELD: 'repo-advance:missing-field',
  BAD_SHA: 'repo-advance:bad-sha',
  SAME_COMMIT: 'repo-advance:from-equals-to',
  TOO_MANY_HEADLINES: 'repo-advance:too-many-headlines',
  HEADLINE_UNSAFE: 'repo-advance:headline-unsafe',
  BAD_COUNT: 'repo-advance:bad-count',
  BAD_GATE_CHANGE: 'repo-advance:bad-gate-change',
})

const refuse = (code, detail) => Object.assign(new Error(detail), { code })

/**
 * **THE CHARACTERS A HEADLINE MAY NOT CARRY, AND WHY THIS IS A REFUSAL RATHER THAN A CLEANUP.**
 *
 * A commit subject is text somebody else wrote — a lane, a contributor, eventually a stranger — and it is
 * rendered in a line a person reads **before deciding to move main.** Three families of character make that
 * rendering lie:
 *
 *   * **BIDI CONTROLS AND MARKS** (U+202A–U+202E, U+2066–U+2069, U+200E, U+200F). These REORDER the text around
 *     them, so a subject can be made to READ as a different sentence than the bytes contain — *the display
 *     would show one thing and the digest would cover another*, which is the whole failure an approval exists to
 *     prevent. **THIS IS THE "DIRECTION-REVERSING CHARACTER" THE PLAN'S ROW 2 NAMES.**
 *   * **CONTROL CHARACTERS AND LINE SEPARATORS** (C0 and C1 ranges, U+2028, U+2029). A newline inside a subject
 *     forges a *second line* in a display that puts one subject per line, so a lane could print what looks like
 *     an extra row of the record.
 *   * **UNASSIGNED AND REPLACEMENT CODEPOINTS** (U+FFFD). Not an attack — **a symptom**: it means the bytes were
 *     already mangled by whatever produced them, and a headline nobody can read is worse than no headline.
 *
 * **A CLEANUP WOULD BE THE WRONG ANSWER.** Stripping the character would make the display disagree with the
 * bytes, which is the defect — so the record is refused and the producer is told which subject is unusable.
 * Only the DISPLAY is protected if the text is only sanitised; **the bytes and the sentence stay tied together
 * only if the bad text never enters.**
 */
const UNSAFE_HEADLINE = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFFFD]/u

/** Describe the first unsafe codepoint in a way a producer can fix. */
const firstUnsafe = (text) => {
  for (const character of text) {
    if (UNSAFE_HEADLINE.test(character)) {
      return `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`
    }
  }
  return null
}

/**
 * Encode one JSON-compatible value with lexicographically sorted object keys.
 *
 * **RESTATED FROM KIRA'S `canonicalJSON` (`plugins/aukora-kira/lib/record.mjs:180`), NOT IMPORTED**, for the
 * boundary reason in this file's header. `tests/aukora-signer-kira-canonical.test.mjs` holds the two side by
 * side and fails if their bytes differ — *so this is one encoder with two addresses, not two encoders.*
 */
export function canonicalJSON(value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${Array.from(value).map(item => (typeof item === 'function' || typeof item === 'symbol' ? 'null' : canonicalJSON(item))).join(',')}]`
  }
  const record = /** @type {Record<string, unknown>} */ (value)
  const keys = Object.keys(record)
    .filter(key => typeof record[key] !== 'function' && typeof record[key] !== 'symbol')
    .sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`).join(',')}}`
}

/** The bytes the owner's approval covers: the canonical encoding, and nothing else. */
export const repoAdvanceBytes = record => canonicalJSON(record)

/** The digest of those bytes. */
export const repoAdvanceDigest = record =>
  createHash('sha256').update(repoAdvanceBytes(record), 'utf8').digest('hex')

/**
 * Build the record, or refuse it by name.
 *
 * @param {{repo: string, from: string, to: string, tree: string, commitCount: number,
 *          headlines: string[], courtsRunId: string, stampDigest: string, gateChanges: string[]}} input
 * @returns {Readonly<object>} the record, encoded canonically.
 */
export function buildRepoAdvance(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw refuse(REPO_ADVANCE_REFUSE.NOT_AN_OBJECT, 'a repo-advance proposal is an object')
  }
  const record = { kind: REPO_ADVANCE_KIND, ...input }
  // ── **THE CLOSED SET, CHECKED BEFORE ANYTHING IS READ OUT OF IT** ────────────────────────────────────────
  //
  // The extra field is refused FIRST, so a record carrying `note: "trust me"` is reported as what it is rather
  // than being quietly carried through a builder that only reads the fields it knows.
  const extra = Object.keys(record).filter(key => !REPO_ADVANCE_FIELDS.includes(key))
  if (extra.length > 0) {
    throw refuse(REPO_ADVANCE_REFUSE.EXTRA_FIELD,
      `this record carries ${extra.length} field(s) the format does not have: ${extra.join(', ')} — a field the `
      + 'format does not name is a field no check will read')
  }
  const missing = REPO_ADVANCE_FIELDS.filter(key => !(key in record))
  if (missing.length > 0) {
    throw refuse(REPO_ADVANCE_REFUSE.MISSING_FIELD,
      `this record is missing ${missing.length} field(s): ${missing.join(', ')}`)
  }

  for (const which of ['from', 'to', 'tree']) {
    if (typeof record[which] !== 'string' || !HEX40.test(record[which])) {
      throw refuse(REPO_ADVANCE_REFUSE.BAD_SHA,
        `${which} is ${JSON.stringify(record[which])} and a git object name is forty lowercase hex characters`)
    }
  }
  // **A RECORD THAT MOVES NOTHING IS NOT A PROPOSAL.** `from == to` renders as "move main from abc1234 to
  // abc1234", which reads as a completed action and authorises nothing — *so it would be approved as a no-op and
  // occupy a click.* The `tree` is deliberately NOT compared: two different commits can carry the same tree, and
  // a revert is exactly that, so refusing equal trees would refuse a legitimate proposal.
  if (record.from === record.to) {
    throw refuse(REPO_ADVANCE_REFUSE.SAME_COMMIT,
      `from and to are both ${record.from.slice(0, 7)}, so this proposal moves nothing — a no-op that reads as `
      + 'an action and would occupy the owner\'s click')
  }
  if (!Number.isSafeInteger(record.commitCount) || record.commitCount < 1) {
    throw refuse(REPO_ADVANCE_REFUSE.BAD_COUNT,
      `commitCount is ${JSON.stringify(record.commitCount)} and a proposal moves at least one commit`)
  }
  if (!Array.isArray(record.headlines)) {
    throw refuse(REPO_ADVANCE_REFUSE.TOO_MANY_HEADLINES, 'headlines is not a list')
  }
  if (record.headlines.length > MAX_HEADLINES) {
    throw refuse(REPO_ADVANCE_REFUSE.TOO_MANY_HEADLINES,
      `${String(record.headlines.length)} headline(s) against a maximum of ${String(MAX_HEADLINES)} — past this `
      + 'the proposal stops being a summary somebody reads and becomes a document somebody scrolls')
  }
  for (const [index, headline] of record.headlines.entries()) {
    if (typeof headline !== 'string') {
      throw refuse(REPO_ADVANCE_REFUSE.HEADLINE_UNSAFE, `headline ${String(index)} is not a string`)
    }
    const bad = firstUnsafe(headline)
    if (bad !== null) {
      throw refuse(REPO_ADVANCE_REFUSE.HEADLINE_UNSAFE,
        `headline ${String(index)} carries ${bad}, which reorders or breaks the line it is shown on — the display `
        + 'would read differently from the bytes the signature covers, and that difference is what an approval '
        + 'exists to rule out')
    }
  }
  if (!Array.isArray(record.gateChanges)) {
    throw refuse(REPO_ADVANCE_REFUSE.BAD_GATE_CHANGE, 'gateChanges is not a list of paths')
  }
  for (const [index, path] of record.gateChanges.entries()) {
    if (typeof path !== 'string' || path === '' || path.includes('\n') || path.startsWith('/') || path.includes('..')) {
      throw refuse(REPO_ADVANCE_REFUSE.BAD_GATE_CHANGE,
        `gateChanges[${String(index)}] is ${JSON.stringify(path)} — a gate change is a repository-relative path`)
    }
  }
  // SORTED AND DEDUPLICATED, so two records describing the same change carry the same bytes whatever order the
  // comparison walked in. **AN ORDER THAT DEPENDS ON HOW THE DIFF WAS READ IS AN ORDER THE DIGEST CANNOT COVER.**
  const gateChanges = Object.freeze([...new Set(record.gateChanges)].sort())
  return Object.freeze({ ...record, gateChanges })
}
