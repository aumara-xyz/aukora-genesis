/**
 * THE ADAPTER: A QUESTION AND A STORE BECOME THE FRAME SHE RECEIVES. (Design §4.1 and §4.2, joined.)
 *
 * `memory-frame.mjs` knows the filters, the budgets, the handles, the escaping and the citation words;
 * `retrieval.mjs` (kira-119) knows the ranking. Neither knows the other, which is why both are courthable — and this is
 * the one place they meet, so a reader can see the whole path from a question to the bytes she is given.
 *
 * THE ORDER IS THE DESIGN'S, AND IT MATTERS: FILTER first (a note that does not belong in recall is not ranked at all),
 * then SCORE and RANK (the question decides what is most relevant), then ASSIGN HANDLES (in the order they will be
 * spoken), then FRAME (within the budgets). Ranking before filtering would spend the ranking on notes that cannot be
 * injected, and assigning handles before ranking would hand out `m1` to a note that never appears.
 *
 * A NOTE THAT CANNOT BE VERIFIED IS COUNTED, NOT DROPPED SILENTLY (§4.2's "1 memory unreadable"). The caller passes a
 * verification answer per note; a note whose hash does not check out is left out of the frame and reported in the count,
 * because a store that quietly loses a note and a store that has none look identical from the outside.
 *
 * NOTHING HERE READS ANYTHING. The notes, their BM25 scores, their verification answers and the session's handle map all
 * arrive as arguments.
 *
 * @module @aukora/dsh-plugin-kira/memory-frame-adapter
 */
import { assignHandles, citationFor, frameOf, recallFilter, scoreOf } from './memory-frame.mjs'
import { usageCounts } from './memory-housekeeping.mjs'
import { compileIndex, rankRecords } from './retrieval.mjs'

/** A named refusal: an adapter with no ranker would order the frame by whatever the store happened to return. */
export class KiraFrameError extends Error {
  /**
   * @param {string} code - stable machine-readable refusal code suffix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`kira.frame: ${message}`)
    this.name = 'KiraFrameError'
    this.code = `kira.frame:${code}`
  }
}

/**
 * Build the frame for one turn.
 *
 * @param {{question: string, notes: ReadonlyArray<Record<string, unknown>>, rank: (question: string, notes: ReadonlyArray<Record<string, unknown>>) => ReadonlyArray<{id: string, bm25: number}>, now: string, nonce: string, attachedProjects?: ReadonlyArray<string>, currentTurn?: number, existingHandles?: Map<string, string>, verification?: Readonly<Record<string, {ok: boolean, answer?: string}>>, core?: ReadonlyArray<Record<string, unknown>>}} input
 * @returns {{frame: ReturnType<typeof frameOf>, handles: ReadonlyArray<[string, string]>, considered: number, excluded: ReadonlyArray<{id: string, why: string}>, unreadable: number, citations: ReadonlyArray<Record<string, unknown>>}}
 */
/**
 * THE RANKER THE FRAME ASKS FOR — and, until now, nobody supplied.
 *
 * **MEASURED against real captured notes on 2026-09-26:** `buildRecallFrame` refuses to build without a `rank`, with the
 * right words — *"recall needs a ranker for the question; without one the frame would be ordered by whatever the store
 * returned"* — and the only ranker in the tree is `rankRecords(index, records, query)` in `retrieval.mjs`, whose shape is
 * not the frame's. The frame's docstring says the ranker is "kira-119's, in production", so the shim was assumed to exist
 * somewhere; it did not. The same class of gap as a router with no mount: the capability was there and the caller had
 * nothing to pass.
 *
 * The mapping is small and exact: notes → `{recordId, text}` for the index (VERIFIED against `compileIndex`'s own docstring
 * rather than assumed) and the rows back out as `{id, bm25}`, which is what the frame reads.
 *
 * @returns {(question: string, notes: ReadonlyArray<Record<string, unknown>>) => Array<{id: string, bm25: number}>}
 */
export function makeRecallRanker() {
  return (question, notes) => {
    const records = (Array.isArray(notes) ? notes : []).map(note => ({
      recordId: String(note?.id ?? ''),
      text: String(note?.statement ?? note?.text ?? ''),
    }))
    if (records.length === 0) return []
    return rankRecords(compileIndex(records), records, String(question ?? '')).map(row => ({ id: row.recordId, bm25: row.score }))
  }
}

/**
 * THE RANKER THE RECALL SERVICE ASKS FOR — `(records, question) -> the same records, ordered`.
 *
 * **FABLE'S ITEM (4).** `createKiraRecallService` calls `rank(answer.records, asked)` and then slices what it gets back, so
 * its ranker must return RECORDS — while the frame's ranker returns `{id, bm25}` scores for the frame to use. Two shapes, two
 * names, because one function that guessed which was wanted would be wrong half the time in a way nobody could see.
 *
 * It is built on the same lexical method as `makeRecallRanker` (`compileIndex` + `rankRecords`), so the order a question
 * produces is the same order wherever it is asked, and the text it indexes is read from whichever field a record carries —
 * `text` on a retrieval record, `statement` on a §3.6 note.
 *
 * @returns {(records: ReadonlyArray<Record<string, unknown>>, question: string) => ReadonlyArray<Record<string, unknown>>}
 */
export function makeRecordRanker() {
  return (records, question) => {
    const given = Array.isArray(records) ? records : []
    if (given.length === 0) return given
    const indexed = given.map(record => ({
      recordId: String(record?.recordId ?? record?.id ?? ''),
      text: String(record?.text ?? record?.statement ?? ''),
    }))
    const byId = new Map(given.map(record => [String(record?.recordId ?? record?.id ?? ''), record]))
    return rankRecords(compileIndex(indexed), indexed, String(question ?? '')).map(row => byId.get(row.recordId))
  }
}

export function buildRecallFrame(input) {
  const {
    question, notes = [], rank, now, nonce, attachedProjects = [], currentTurn,
    existingHandles = new Map(), verification = {}, core = [],
    // *** `states` IS THE DERIVED MAP OF §2.2's MOVES, AND IT ARRIVES ALREADY BUILT. *** `noteStates` in `memory-forget.mjs` replays the chain (`supersede`, `hide`,
    // `expire`, `archive`, and `restore`/`unhide` putting a note back). This layer does not read the chain itself — it is pure, and picking up a store here would make
    // it untestable and would put a file read inside the frame. A caller without one passes nothing and gets exactly the old behaviour.
    states,
  } = input ?? {}
  if (typeof rank !== 'function') {
    throw new KiraFrameError('ranker-missing', 'recall needs a ranker for the question; without one the frame would be ordered by whatever the store returned')
  }
  if (typeof nonce !== 'string' || nonce === '') {
    throw new KiraFrameError('nonce-missing', 'a frame carries a nonce so injected text cannot imitate one')
  }

  // 1. FILTER — before any ranking is spent.
  const eligible = []
  const excluded = []
  for (const note of notes) {
    const verdict = recallFilter(note, { now, attachedProjects, currentTurn, states })
    if (verdict.ok === true) eligible.push(note)
    else excluded.push({ id: String(note?.id ?? ''), why: verdict.why })
  }

  // 2. RANK — the question decides, through the injected ranker (kira-119's, in production).
  //
  // *** THE MULTIPLIER'S INPUT COMES FROM §5.1's DERIVED LAYER, NOT FROM A FIELD NOTHING WRITES. *** Until 2026-09-26 this line read
  // `note.recalls`, and no code in this tree has ever set that field — so every note scored with a multiplier of exactly 1.0, and §4's soft
  // bias (*"between 0.5 and 1.5 … a soft bias and never filters"*) could not move anything. The layer is rebuilt HERE, from the notes in
  // hand, by the SAME RULE the nightly job computes and records (`usageCounts`: an identical normalized statement counts as "seen again"),
  // so the consumer and the job cannot disagree — the job's derived record is the audit trail, and this is the rebuild §4 says these layers
  // allow (*"Derived layers can be rebuilt and sit outside the hashed bytes"*). Counted over ALL the notes in hand, not only the eligible
  // ones: a twin that the filter excluded is still evidence that the statement was seen again.
  const usage = new Map(usageCounts(notes).map(one => [one.id, one.seenAgain]))
  const scores = new Map(rank(question, eligible).map(one => [String(one.id), Number(one.bm25)]))
  const ranked = eligible
    .map(note => ({ note, score: scoreOf({ bm25: scores.get(String(note.id)) ?? 0, tier: String(note.tier), recalls: usage.get(String(note.id)) ?? 0 }) }))
    .sort((a, b) => b.score - a.score)

  // 3. VERIFY — a note whose own hash does not check out is COUNTED, never silently dropped.
  const checked = []
  let unreadable = 0
  for (const one of ranked) {
    const answer = verification[String(one.note.id)]
    if (answer !== undefined && answer.ok !== true) { unreadable += 1; excluded.push({ id: String(one.note.id), why: `unreadable:${String(answer.answer ?? 'checks-failed')}` }); continue }
    checked.push(one)
  }

  // 4. HANDLES — assigned in the order they will be spoken, per session, never reused, core first.
  const coreNotes = core.map(note => note)
  const handleMap = assignHandles([...coreNotes, ...checked.map(one => one.note)], existingHandles)
  const corePairs = coreNotes.map(note => ({ note, handle: String(handleMap.get(String(note.id))) }))
  const relevantPairs = checked.slice(0, 6).map(one => ({ note: one.note, handle: String(handleMap.get(String(one.note.id))) }))

  // 5. FRAME — within the budgets, with the unreadable count stated.
  const frame = frameOf({ core: corePairs, relevant: relevantPairs, unreadable, nonce })

  // THE CITATIONS FOR THE SOURCES CHIP: exactly the handles that went into the request bytes (§4.3).
  const citations = [...corePairs, ...relevantPairs].map(({ note, handle }) => ({
    handle, id: note.id, tier: note.tier, ...citationFor(note, { auraCite: () => verification[String(note.id)]?.ok === true, objectHashIntact: verification[String(note.id)]?.ok === true }),
  }))

  return {
    frame,
    handles: Object.freeze([...handleMap.entries()]),
    considered: notes.length,
    excluded: Object.freeze(excluded),
    unreadable,
    citations: Object.freeze(citations),
  }
}
