/**
 * THE CAPTURE CONSUMER — a finished turn becomes notes, without approval, at the moment it is finished.
 *
 * **THE KEY FINDING THIS ANSWERS (Fable, 2026-09-26):** Auma Live's conversations never reach KIRA today —
 * `presence.ts:1144` calls the provider directly and autostage listens only for LANE turns (`autostage-hook.mjs:188`).
 * AUMA provides the finished-turn hook; KIRA consumes it. This is the consuming half: given the digest of a finished
 * turn, it runs the whole engine — extraction, the deterministic harness, the tier, the receipt, the journal entry and
 * the Aura append — and returns the effects as DATA for the caller to write.
 *
 * WHY IT RETURNS EFFECTS RATHER THAN WRITING THEM. The plugin's file writes belong to one audited boundary
 * (`strict-read.mjs`, ruling A), so a module that wrote notes itself would be a second door onto the store. Returning
 * `{notes, journalLines, auraAppends}` also means a court drives the ENTIRE path — from a turn's text to the bytes that
 * would be stored — with no filesystem at all, which is the only way to be sure the path is right before it is live.
 *
 * THE ORDER IS THE ENGINE'S, AND EACH STEP CAN REFUSE THE TURN:
 *  1. the turn must be a well-formed digest (sessionId, seq, at, and THE EXACT CANONICAL EVENT LINE — the digest of a
 *     reconstruction verifies against itself, which AUMA's own note names as the trap);
 *  2. `captureTurn` extracts up to three candidates, refusing injected text and already-staged turns;
 *  3. THE HARNESS REVIEWS EACH CANDIDATE — the four-condition quote check included — because a model's statement about
 *     what the owner said is a proposal, and the owner's own words are the evidence;
 *  4. each survivor becomes a §3.6 note with `grantsAuthority: false`, a receipt over the turn, and an Aura append;
 *  5. each becomes a journal entry, so the store can always say what arrived and when.
 *
 * @module @aukora/dsh-plugin-kira/memory-capture-hook
 */
import { captureTurn, capturedTurnKey, wholeTurnText } from './memory-capture.mjs'
import { CONTROLS, ownerControlIn } from './memory-forget.mjs'
import { applyHarness, normalize } from './memory-harness.mjs'
import { compileIndex, rankRecords } from './retrieval.mjs'
import { GENESIS_PREV, entryHashOf, nextEntry } from './memory-journal.mjs'
import { buildRememberedNote, cutText, sha256Hex } from './memory-tiers.mjs'

/** How the design's categories meet the contract's kinds, for a turn captured without a model's categories. */
/**
 * HOW MANY NOTES ONE TURN MAY REMEMBER — the contract's "small bound": *a turn is a turn, not a corpus*.
 *
 * IT LIVES HERE BESIDE `consumeTurn` BECAUSE BOTH HOOKS CAP BY IT. Measured 2026-09-26: the remembered hook capped at 8 and the auma
 * hook did not cap AT ALL, so one contract had two behaviours and a live presence turn could write unbounded notes. The truncation was
 * also SILENT — the same defect as a secret filter that drops without saying so, one function away.
 */
export const MAX_NOTES_PER_TURN = 8

/**
 * THE BOUND, APPLIED AND REPORTED — pure, so a court can drive it with more notes than the extractor will ever yield in a fixture.
 *
 * The truncation is reported BY COUNT AND NEVER BY TEXT, for the same reason the secret-drop report is: this log is exactly where a
 * quoted statement would travel. A silent truncation is indistinguishable from a turn that produced nothing.
 *
 * @param {ReadonlyArray<unknown>} notes @param {{cap?: number, logger?: {warn?: Function}}} [options]
 */
export function boundedNotes(notes, options = {}) {
  const cap = Number.isInteger(options.cap) ? options.cap : MAX_NOTES_PER_TURN
  const list = Array.isArray(notes) ? notes : []
  if (list.length > cap) {
    options.logger?.warn?.(`aukora-kira: a turn produced more notes than one turn may remember: kept ${String(cap)} of ${String(list.length)}; the rest were NOT stored (the text is deliberately not logged)`)
  }
  return list.slice(0, cap)
}

/**
 * THE DESIGN'S TEN CATEGORIES, AND THE RECORD KIND EACH ONE PROMOTES TO — §3.2's table, read from the design rather than from a summary.
 *
 * *** THIS MAP HELD FOUR NAMES FROM A DIFFERENT FEATURE (round 168, MEASURED). *** It was `{preference, decision, measured-fact, agent-instruction}` — `autostage.mjs`'s vocabulary for its
 * own purpose — so of §3.2's ten categories, TWO were present. The rest fell through `?? 'observation'` at the call site: `fact`, `commitment`, `project`, `correction` and `instruction`
 * were STORED WITH THE WRONG KIND, and `decision` mapped to the string `decision`, which is not in `record.mjs`'s closed `recordKind` list, so `stageKiraMemoryRecord` refused it by name and
 * a decision turn could not be captured AT ALL. The retention policy was already written in the design's vocabulary (`correction-kept` keys on `correction`, `done-commitments` on
 * `commitment`), so neither rule could ever match a stored note.
 *
 * §3.2's own table: fact→claim, preference→preference, decision→claim, commitment→plan, person→observation, project→summary, event→observation, correction→claim,
 * instruction→preference, feeling→observation. `instruction` is *"kept as a note, NOT in effect, never auto-injected"* — the kind is what keeps it out of use, not a separate field.
 */
export const CATEGORY_TO_KIND = Object.freeze({
  fact: 'claim',
  preference: 'preference',
  decision: 'claim',
  commitment: 'plan',
  person: 'observation',
  project: 'summary',
  event: 'observation',
  correction: 'claim',
  instruction: 'preference',
  feeling: 'observation',
  // THE WHOLE OWNER TURN (`memory-capture.mjs` WHOLE_TURN_CATEGORY): what he said, filed as an observation. No retention rule
  // names `observation`, so housekeeping never expires one.
  turn: 'observation',
})

/** A named refusal: a turn that cannot be consumed is reported, never silently skipped. */
export class KiraCaptureHookError extends Error {
  /**
   * @param {string} code - stable machine-readable refusal code suffix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`kira.capture-hook: ${message}`)
    this.name = 'KiraCaptureHookError'
    this.code = `kira.capture-hook:${code}`
  }
}

/**
 * Consume one finished turn.
 *
 * @param {{sessionId: string, sessionTitle?: string, seq: number, at: string, turn: number, text: string, injected?: boolean, canonicalEventLine: string, logPath?: string}} turn
 * @param {{subject: string, privacy: string, stagedTurns?: ReadonlySet<string>, forbidden?: ReadonlyArray<string>, secretPatterns?: ReadonlyArray<RegExp>, auraIndex?: number, journalPrevious?: Readonly<Record<string, unknown>>|null, observedAt: string, attributedTo?: string, confidence?: number, validFrom?: string, extraction?: ReadonlyArray<Record<string, unknown>>}} policy
 * @returns {{notes: ReadonlyArray<Record<string, unknown>>, journalLines: ReadonlyArray<string>, auraAppends: ReadonlyArray<{index: number, entryHash: string, digest: string}>, stagedTurns: string, reason: string, dropped: ReadonlyArray<Record<string, unknown>>}}
 */
/**
 * §3.5's INPUT LIST: THE TOP 10 RELATED NOTES, LABELLED `"0"`…`"9"`.
 *
 * The design's extraction contract supplies the extractor with *"the top 10 related notes found by BM25, with their ids replaced by `0`…`9`"*, and
 * the extractor answers with `relation.n` — an INDEX into that list. `applyHarness` reads `relation.n` and looks up `known[String(n)]` for exactly
 * that reason, so the map this returns is KEYED BY LABEL and carryies the fields the harness's rules 4-6 read (`tier`, `kept`, `recalls`) plus the
 * note's own id and statement, which are what a caller needs to write a record whose links point at notes rather than at labels.
 *
 * THE RANKER IS THE REAL ONE (`compileIndex` + `rankRecords`, the same pair the recall frame uses), not a second implementation of BM25 that could
 * drift from the one the owner's recall actually runs on.
 *
 * `recalls` COMES FROM §5.1's USAGE LAYER WHEN THE CALLER HAS ONE, and that is the point of the parameter rather than a convenience: §4's rule is
 * that a Kept or often-recalled note is never silently replaced, and the count has to arrive from somewhere. Passing the layer in is what makes that
 * rule fire on real usage instead of on the dead `recalls` field.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} notes @param {string} question
 * @param {{cap?: number, usage?: Record<string, number>}} [options]
 * @returns {Readonly<Record<string, {id: string, statement: string, tier: string, kept: boolean, recalls: number}>>}
 */
export function relatedFor(notes, question, options = {}) {
  const cap = Number.isInteger(options.cap) ? options.cap : 10
  const rows = (Array.isArray(notes) ? notes : [])
    .filter(one => one !== null && typeof one === 'object' && String(one.id ?? '') !== '')
    .map(one => ({ recordId: String(one.id), text: String(one.statement ?? ''), note: one }))
  if (rows.length === 0) return Object.freeze({})
  const ranked = rankRecords(compileIndex(rows), rows, String(question ?? ''))
  // `rankRecords` ANSWERS WITH `{recordId, score}` ROWS, NOT WITH THE OBJECTS IT WAS GIVEN — my first version read `row.note` and crashed on the
  // first arm that called it. The note is looked up again by the id the ranker returned, which is the only field it promises.
  const byId = new Map(rows.map(row => [row.recordId, row.note]))
  const known = {}
  for (const [label, row] of ranked.slice(0, cap).entries()) {
    const note = byId.get(row.recordId) ?? {}
    known[String(label)] = Object.freeze({
      id: row.recordId,
      statement: String(note.statement ?? ''),
      tier: String(note.tier ?? 'remembered'),
      kept: note.kept === true,
      recalls: Number(options.usage?.[row.recordId] ?? note.recalls ?? 0),
    })
  }
  return Object.freeze(known)
}

/**
 * §3.5's CHEAP DEDUPE: *"An identical normalized statement counts as 'seen again' (a usage entry). So does `same(n)`."*
 *
 * Both halves matter and they are the same half here: a candidate that restates a note the caller supplied is not a new note, it is evidence the
 * owner said the same thing again — which is where §4's usage multiplier gets its input, and therefore where §5.1's step 4 gets it too. The
 * comparison uses THE HARNESS'S OWN `normalize`, imported rather than reimplemented, because two normalizations that disagree by one character
 * would silently stop recognising a restatement and start storing duplicates.
 *
 * @param {string} statement @param {Readonly<Record<string, {statement?: string}>>|null} related
 * @returns {{op: 'same', n: number}|null}
 */
export function sameRelation(statement, related) {
  if (related === null || typeof related !== 'object') return null
  const wanted = normalize(String(statement ?? ''))
  if (wanted === '') return null
  for (const [label, entry] of Object.entries(related)) {
    if (!/^\d+$/u.test(label)) continue
    if (normalize(String(entry?.statement ?? '')) === wanted) return Object.freeze({ op: 'same', n: Number(label) })
  }
  return null
}

export function consumeTurn(turn, policy) {
  const { subject, privacy, stagedTurns = new Set(), forbidden = [], secretPatterns, auraIndex = 0, journalPrevious = null, observedAt, known, related = null } = policy ?? {}
  if (policy?.sourceKind !== undefined && policy.sourceKind !== 'auma-live/model-request') {
    throw new KiraCaptureHookError('source-kind-unsupported', 'capture source kind is not supported')
  }
  // *** A MISSING FILTER IS NOT A CLEAN TURN. *** Fable measured at HEAD that BOTH capture hooks called this without `secretPatterns`,
  // and the old default of `[]` meant the secret filter could never fire: the remembered tier has needed no approval since 0b71ca6db, so a
  // key pasted into a sentence ("from now on use key sk-…") would have been stored verbatim. Same "not configured reads as clean" class
  // that `compaction-export.mjs` already refuses, refused the same way — BY NAME, at the boundary, before any note is built.
  if (!Array.isArray(secretPatterns) || secretPatterns.length === 0) {
    throw new KiraCaptureHookError('secret-filter-unconfigured', 'consumeTurn refuses without secret patterns: an empty filter would silently keep every credential the owner ever pastes. Pass SECRET_PATTERNS from compaction-export.mjs.')
  }
  if (!Array.isArray(forbidden)) {
    throw new KiraCaptureHookError('forbidden-list-unconfigured', 'consumeTurn needs the forbidden list as an array: an empty array is a real answer, a missing one is a configuration fault')
  }
  const staged = new Set(stagedTurns)
  const key = capturedTurnKey(String(turn?.sessionId ?? ''), Number(turn?.turn ?? -1))
  if (staged.has(key)) return { notes: [], journalLines: [], auraAppends: [], stagedTurns: key, reason: 'turn-already-staged', dropped: [] }

  // *** THE OWNER'S OFF SWITCHES ARE CHECKED BEFORE ANYTHING ELSE. *** §6.1: "Pause — no capture and no recall"; "Off
  // the record — this session is not written to the request store at all"; "Someone's here — no capture and no personal
  // recall until turned off". A capture path that read a paused turn would break the plainest promise this engine makes,
  // and it would break it SILENTLY — the notes would simply exist. So a control that stops capture is checked FIRST,
  // before the turn is read for candidates at all, and the reason names the control.
  const controls = policy?.controls ?? {}
  const stopped = Object.entries(CONTROLS).find(([name, effect]) => controls[name] === true && effect.stopsCapture === true)
  if (stopped !== undefined) {
    return { notes: [], journalLines: [], auraAppends: [], stagedTurns: key, reason: `control-stops-capture:${stopped[0]}`, dropped: [] }
  }
  if (policy?.offTheRecord === true) {
    // A session that is off the record is not written to the request store at all, so there is no event line to cite and
    // no receipt is possible. Reporting nothing is the only honest answer; inventing a source would be worse than empty.
    return { notes: [], journalLines: [], auraAppends: [], stagedTurns: key, reason: 'off-the-record-is-not-written-at-all', dropped: [] }
  }
  // *** AND THE OWNER'S OWN WORDS IN THIS TURN, READ HERE, NOT ONLY BY THE FACE (2026-09-27). *** Every owner turn is remembered
  // now, so "off the record", "stop remembering" and "someone's here" must stop capture on EVERY path — the text chat never went
  // through the face that reads them for Auma Live. Checked before any candidate is built, like the controls above.
  const said = policy?.attributedTo === 'agent' ? null : ownerControlIn(String(turn?.text ?? ''))
  if (said !== null && CONTROLS[said]?.stopsCapture === true) {
    return { notes: [], journalLines: [], auraAppends: [], stagedTurns: key, reason: `owner-said-${said}`, dropped: [] }
  }

  // *** THE LINE THE RECEIPT COVERS MUST BE THE LINE THE STORE HOLDS. *** AUMA's own note names the trap: "the digest of a
  // reconstruction verifies against itself". `captureTurn` already refuses a MISSING line, but nothing could tell a
  // reconstruction from the real thing — and the failure would surface much later, as a MISSING answer on a note the owner
  // believed was tracked. This is the one place that can close it cheaply: the caller MAY supply `readEvent`, and when it
  // does, the event is re-read and the bytes must MATCH. A mismatch is refused by name rather than stored.
  //
  // It is OPTIONAL because the design keeps capture cheap and the hook's caller already holds the event it just wrote; the
  // refusal is for the case where it does not, and the migration and the tests supply it. What is NOT optional is the
  // name: a caller that skips the check is skipping a check it can see.
  if (typeof policy?.readEvent === 'function') {
    const stored = policy.readEvent({ sessionId: String(turn?.sessionId ?? ''), seq: Number(turn?.seq) })
    if (stored !== null && stored !== undefined && String(stored) !== String(turn?.canonicalEventLine)) {
      throw new KiraCaptureHookError('event-line-does-not-match-the-store', `the line handed to this capture is NOT the line the store holds for ${String(turn?.sessionId)} seq ${String(turn?.seq)}: a receipt over it would verify against itself and answer MISSING later`)
    }
  }

  // *** THE EXTRACTOR IS INJECTABLE, AND THAT SEAM IS WHAT MAKES THE NEXT LINE TESTABLE. *** §3.5 specifies the extractor's OUTPUT as
  // `{"relation":{"op":"add"}}` or `{"op":"same"|"update"|"contradicts","n":0..9}` — an index into the top-10 related notes the caller supplies
  // with their ids replaced by "0"…"9", which is why `applyHarness` reads `relation.n` and looks up `known[String(n)]`. The deterministic
  // extractor in this tree cannot produce a relation (it has no model and no related list), so the harness's §3.5 rules 4-6 are unreachable
  // from it — and an arm for the passthrough would need a candidate this tree never builds. The default is unchanged (`captureTurn`), and the
  // court supplies its own to drive a relation-bearing candidate through the real path.
  const extract = typeof policy?.extract === 'function' ? policy.extract : captureTurn
  let extracted = extract(turn, { subject, privacy, stagedTurns: staged })
  const agentFinding = policy?.attributedTo === 'agent'
  if (agentFinding) {
    const sourceEvent = JSON.parse(String(turn.canonicalEventLine))
    const message = sourceEvent?.data?.message
    const text = Array.isArray(message?.content) ? message.content.filter(part => part?.type === 'text').map(part => part.text).join('\n') : ''
    if (sourceEvent?.type !== 'assistant/message' || message?.role !== 'assistant' || message?.source?.kind === 'plugin'
      || sourceEvent.data?.interrupted === true || sourceEvent.data?.turn !== turn.turn || sourceEvent.seq !== turn.seq
      || text !== turn.text || typeof policy.scope !== 'string') {
      throw new KiraCaptureHookError('agent-source-invalid', 'agent findings require their exact assistant event and host scope')
    }
    // Preserve qualifications and negations verbatim. Never turn an agent report into an owner's preference.
    const statement = wholeTurnText(text)
    extracted = { candidates: statement === ''
      ? [] : [{ category: 'project', text: statement, verbatim: true }], reason: 'agent-finding' }
  }
  // *** §3.3 RULE 2: AN EXPLICIT "remember that…" STORES THE VERBATIM OWNER SPAN AT ONCE, WITH NO MODEL CALL — AND IT BELONGS HERE, IN THE LAYER THAT WRITES. ***
  // Design §3.3: *"'Remember that…' stores the verbatim owner span at once, with no model call, and returns the real result to Auma (2.3)."* §2.2's → Remembered row
  // calls it *"an explicit 'remember' marker in the owner's text AS RECEIVED"*.
  //
  // WHY THIS LINE IS IN THIS FILE AND NOT IN THE HOOK, MEASURED IN ROUND 95: the notes written to the store come from `reviewed.accepted` below — THIS list — and not
  // from anything a caller bounds. A forced candidate added by the hook was bounded, logged and dropped on the floor, which is why three rounds ended at "got 0 note(s)".
  // `policy.explicitRemember` has existed as a flag on line 220 since before tonight and NOTHING EVER SET IT; the hook sets it now, and the marker produces a candidate
  // here, where a candidate can become a note.
  //
  // THE EARLY RETURN BELOW IS WHY THIS IS NEEDED AT ALL: a plain declarative like "Remember that the spare key lives under the blue pot." extracts NOTHING
  // (`nothing-worth-keeping`), so without this candidate the owner's explicit request stores nothing. The extractor is untouched — the marker changes the BAR, not the
  // machinery, and there is no model call anywhere on this path.
  const markerSpan = policy?.explicitRemember === true
    ? String(turn.text ?? '').replace(/^.*?\bremember (?:that|this)\b/iu, '').trim().replace(/[.!?]+$/u, '').trim()
    : ''
  // A NEW ARRAY, NEVER A PUSH: this module freezes what it returns, and round 93's arm caught a push into a frozen array by going red instead of passing silently.
  const markerAlready = markerSpan !== '' && extracted.candidates.some(one => {
    const text = String(one?.text ?? '').trim()
    return text !== '' && (markerSpan.includes(text) || text.includes(markerSpan))
  })
  const candidates = markerSpan !== '' && !markerAlready
    ? [...extracted.candidates, { category: 'fact', text: markerSpan, possibleChange: false }]
    : extracted.candidates
  if (candidates.length === 0) {
    return { notes: [], journalLines: [], auraAppends: [], stagedTurns: key, reason: extracted.reason, dropped: [] }
  }

  // THE HARNESS REVIEWS THE CANDIDATES before anything is stored. The turn's own text is the evidence, and the quote
  // check runs against it — an item whose quote is not in what the owner said is dropped here, with its rule named.
  const ownerTurn = { turn: Number(turn.turn), channel: agentFinding ? 'agent' : policy?.attributedTo === 'owner-voice' ? 'owner-voice' : 'owner', text: String(turn.text ?? '') }
  const reviewed = applyHarness({
    items: candidates.map(candidate => {
      // §3.5's relation, PASSED THROUGH UNTOUCHED WHEN AN EXTRACTOR SUPPLIES ONE — AND FILLED IN FOR THE ONE CASE THIS TREE CAN DECIDE ALONE. An
      // extractor's own relation wins, because only an extractor can say `update` or `contradicts`; but a candidate that merely RESTATES a note the
      // caller supplied is `same(n)` by §3.5's cheap dedupe, and that is decidable here by comparing normalized statements. `n` IS NOT A NOTE ID
      // AND IS NOT RESOLVED HERE — it is the INDEX into the labelled list the caller built ("0"…"9"), and the harness looks it up in `known` by
      // that same label. Both halves of §4's usage source meet at this line: the statement match and the `same(n)` the design names beside it.
      const relation = candidate.relation ?? sameRelation(candidate.text, related)
      return {
        category: candidate.category, statement: candidate.text, possibleChange: candidate.possibleChange === true,
        quote: { turn: Number(turn.turn), text: cutText(candidate.text, 200) }, explicit: policy?.explicitRemember === true,
        // THE WHOLE-TURN CANDIDATE IS THE OWNER'S OWN WORDS (`memory-capture.mjs`), so the harness checks it as verbatim.
        verbatim: candidate.verbatim === true, attributedTo: agentFinding ? 'agent' : 'owner',
        ...(relation === null ? {} : { relation }),
      }
    }),
    // *** `known` COMES FROM THE CALLER, IT WAS HARDCODED `{}`, AND IT IS KEYED BY LABEL RATHER THAN BY NOTE ID. *** This module is pure by
    // design ("a module that wrote notes itself would be a second door onto the store"), so it cannot read the store to find out what the store
    // holds. An item whose op names a target is DROPPED by name when the target is not in `known` — correct behaviour that, with an empty map,
    // made §4's "a Kept or often-recalled note is never silently replaced" unreachable, since the threshold reads `prior.recalls` and there was
    // never a prior. §3.5 says the caller supplies the top 10 related notes "with their ids replaced by `0`…`9`", so the keys are those labels and
    // the entries carry what the rules read (`tier`, `kept`, `recalls`) — with `recalls` filled from §5.1's usage layer, not from the note's own
    // field, which nothing writes.
    //
    // *** AND MY FIRST READING OF THIS WAS WRONG, WHICH IS WHY IT IS CORRECTED RATHER THAN DELETED. *** I wrote here that the missing piece was
    // "target resolution by statement". §3.5 resolves by INDEX INTO A LABELLED LIST, not by matching text, and the harness already implements
    // that lookup — so there was no design question to answer, only a dropped field. What is genuinely still missing is upstream of this line:
    // THE DETERMINISTIC EXTRACTOR IN THIS TREE CANNOT PRODUCE A RELATION, because it has no model and no related list, so no live turn reaches
    // these branches yet. The passthrough above is what makes a relation-bearing extractor work the day one exists, and the court drives one
    // through this seam to prove it.
    turns: [ownerTurn], observationDate: String(policy?.validFrom ?? observedAt).slice(0, 10), known: known ?? {},
  }, { forbidden, forbiddenDigests: policy?.forbiddenDigests, secretPatterns })

  const notes = []
  const journalLines = []
  const auraAppends = []
  let previous = journalPrevious
  for (const [index, item] of reviewed.accepted.entries()) {
    const kind = CATEGORY_TO_KIND[String(item.category)] ?? 'observation'
    const statement = (item.category === 'turn' || agentFinding) ? String(turn.text) : String(item.statement)
    const objectDigest = sha256Hex(statement)
    const auraEntryHash = sha256Hex(`${String(turn.sessionId)}\u0000${String(turn.seq)}\u0000${objectDigest}`)
    auraAppends.push({ index: auraIndex + index, entryHash: auraEntryHash, digest: objectDigest })
    const note = buildRememberedNote({
      category: kind, statement, attributedTo: String(policy?.attributedTo ?? 'owner'),
      evidence: [{ log: String(policy?.logPath ?? `auma-live/${String(turn.sessionId)}.jsonl`), turn: Number(turn.turn), turnDigest: sha256Hex(String(turn.canonicalEventLine)), quote: String(item.quote.text) }],
      validFrom: String(item.validFrom ?? observedAt).slice(0, 10), observedAt,
      // THE SAME TURN THE EVIDENCE CAME FROM, in the shape a verifier re-reads: sessionId, seq, at and the digest of the
      // EXACT canonical event line.
      source: { sessionId: String(turn.sessionId), sessionTitle: String(turn.sessionTitle ?? ''), seq: Number(turn.seq), at: String(turn.at), sha256: sha256Hex(String(turn.canonicalEventLine)),
        ...(policy?.sourceKind ? { kind: policy.sourceKind } : {}) },
      possibleChange: item.possibleChange === true,
      // *** THE HARNESS'S LINKS WERE COMPUTED AND THEN THROWN AWAY. *** `applyHarness` builds `supersedes` / `possible-change` / `conflicts-with`
      // from §3.5 rules 4-6, `buildRememberedNote` accepts a `links` array, and this call passed neither — so even a candidate that carried a
      // relation would have been stored with `links: []`, and §3.6's record shape would be missing the one field that says a note replaces
      // another. The LABELS the harness uses are the caller's ("0"…"9"); turning them into note ids is the caller's job when it settles, which is
      // why they are passed through as they are rather than guessed at here.
      links: Array.isArray(item.links) ? item.links : [],
      confidence: Number(policy?.confidence ?? 0.8), sensitivity: 'none', privacy: String(privacy), subject: String(subject),
      scope: policy?.scope ?? 'owner', origin: { by: agentFinding ? 'kira-agent-finding/v1' : 'kira-capture-hook/v1' }, salt: sha256Hex(`${key}\u0000${String(index)}\u0000${objectDigest}`).slice(0, 64),
    })
    // The note ignores the aura field of the OTHER shape, so the chain is referenced in its own right:
    // *** THE CONTRACT'S THREE FIELD NAMES, ADDED BESIDE THE DOC'S RATHER THAN INSTEAD OF THEM. ***
    // `.agents/live/MEMORY-CONTRACT-v0.md` — the document AK-UI and AUMA are coding against — calls these `kind`, `text`
    // and `createdAt`; the design doc and my note call them `category`, `statement` and `observedAt`. Both are true of the
    // same note, so the note carries both: a client reading the contract finds what it was promised, and nothing that
    // already reads the other names breaks. `source` and `aura` already matched the contract exactly, which is why only
    // these three needed adding.
    const withContractNames = { ...note, kind: String(note.category ?? kind), text: String(note.statement ?? ''), createdAt: String(note.observedAt ?? observedAt) }
    const withAura = Object.freeze({ ...withContractNames, aura: Object.freeze({ index: auraIndex + index, entryHash: auraEntryHash }) })
    notes.push(withAura)
    const entry = nextEntry({ previous, op: 'add', id: String(withAura.id), objectDigest, actor: 'kira-capture-hook/v1', at: observedAt, reason: `captured from ${String(turn.sessionId)} turn ${String(turn.turn)}` })
    journalLines.push(JSON.stringify(entry))
    previous = entry
  }
  staged.add(key)
  return {
    notes: Object.freeze(notes),
    journalLines: Object.freeze(journalLines),
    auraAppends: Object.freeze(auraAppends),
    stagedTurns: key,
    reason: notes.length === 0 ? 'nothing-survived-the-harness' : `${String(notes.length)} note(s) captured without approval`,
    dropped: reviewed.dropped,
  }
}

/**
 * The journal head a caller needs before consuming a turn, so the entries chain onto what is already stored.
 * @param {ReadonlyArray<string|Readonly<Record<string, unknown>>>} existingLines
 * @returns {Readonly<Record<string, unknown>>|null}
 */
export function journalHeadOf(existingLines) {
  const last = existingLines.filter(one => String(one).trim() !== '').at(-1)
  if (last === undefined) return null
  const entry = typeof last === 'string' ? JSON.parse(last) : last
  if (entryHashOf(entry) !== entry.hash) {
    throw new KiraCaptureHookError('journal-head-tampered', 'the last journal entry does not hash to what it claims, so a new entry must not chain onto it')
  }
  return entry
}

/** The genesis previous-hash, re-exported so a first-ever capture chains onto the same sixty-four zeros as everything else. */
export const FIRST_PREV = GENESIS_PREV
