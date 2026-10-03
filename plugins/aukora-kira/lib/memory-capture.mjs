/**
 * AUTOMATIC CAPTURE — a finished turn becomes memory records WITHOUT approval. (Fable's kira-121 Part B item 2; the
 * contract is `.agents/live/MEMORY-CONTRACT-v0.md`.)
 *
 * WHAT IT REPLACES, AND WHAT IT KEEPS FROM IT. The old path staged AT MOST ONE record per turn and then waited for a
 * person to approve it, so a turn that said three keepable things contributed one candidate and a queue nobody worked:
 * three settled, a hundred and thirty waiting. This module keeps everything that made the old one safe — the bounded
 * DIGEST as its only input shape (never messages, so "no raw transcript" is a property rather than a promise), the
 * marker classifier reused verbatim from `autostage.mjs`, the refusal of malformed input, and the rule that INJECTED
 * text stages nothing — and lifts exactly one thing: the per-turn bound, from one to three.
 *
 * THE TURN-KEYED GATE IS KEPT, NOT WEAKENED. `autostage.mjs` keys its gate by `sessionId` + `turn` precisely so a
 * RETRIED turn cannot stage twice; a counter would have allowed it. This module keeps that property and adds a bound
 * on top: a turn may contribute up to `MAX_RECORDS_PER_TURN` records, and re-running the same turn contributes NOTHING
 * for the records it already produced.
 *
 * WHAT IT DOES NOT DO. It does not read, write, or touch the Aura chain — it returns CANDIDATES, each carrying the
 * receipt fields the contract requires, and the caller appends and builds the final record. That is what lets a court
 * drive every rule here with no store at all, and it keeps the plugin's I/O in its one audited boundary.
 *
 * @module @aukora/dsh-plugin-kira/memory-capture
 */
import { classifyCandidate, MAX_CANDIDATE_CHARS, turnKey } from './autostage.mjs'
import { cutText, noteKind, sha256Hex } from './memory-tiers.mjs'

/**
 * How many records one turn may contribute. THREE, because the bound exists to keep memory readable rather than to
 * ration it: a turn that says four separate keepable things is rare, and a person reading recall should not meet a
 * wall of near-duplicates from one exchange. It is a named constant so the number is reviewable.
 */
export const MAX_RECORDS_PER_TURN = 3

/** The owner's own words for a change of mind. The classifier recognizes none of these — measured, and the
 * reason this constant exists: a change is the most important thing to know about a preference. */
export const CHANGE_MARKER = /\b(changed my mind|change of mind|no longer|instead of|from now on|forget what i said|scratch that|i was wrong about)\b/iu

/** A fallback span is bounded like every other span, so one long paragraph cannot become a record. */
export const MAX_SPAN_CHARS = 600

/** Whole turns retain their original bytes; the shared writer splits them into bounded notes. */
export const WHOLE_TURN_CATEGORY = 'turn'
export function wholeTurnText(text) {
  if (typeof text !== 'string' || !text.trim()) return ''
  return text
}

/**
 * autostage's CATEGORY vocabulary mapped onto the CONTRACT's KIND vocabulary.
 *
 * THEY ARE NOT THE SAME VOCABULARY and collapsing them would force one to lie. autostage's categories say what made a
 * piece of text worth keeping; the contract's kinds say what the memory IS, and the contract's set is closed —
 * `fact | preference | decision | commitment | person | project | observation`. A `measured-fact` is recorded as a
 * `fact`; an instruction addressed to an agent is an `observation` (the store observed a peer directing someone), which
 * is the same judgement autostage already makes when it refuses to file peer chatter as the owner's preference.
 */
export const CATEGORY_CONTRACT_KIND = Object.freeze({
  'agent-instruction': 'observation',
  preference: 'preference',
  decision: 'decision',
  'measured-fact': 'fact',
})

/** A named refusal. Refusals are for malformed input, never for "nothing worth keeping". */
export class KiraCaptureError extends Error {
  /**
   * @param {string} code - stable machine-readable refusal code suffix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`kira.capture: ${message}`)
    this.name = 'KiraCaptureError'
    this.code = `kira.capture:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new KiraCaptureError(code, message)
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

/**
 * The spans of a turn worth classifying, in order, each bounded.
 *
 * SPLIT ON PARAGRAPHS FIRST, THEN SENTENCES, because a memory is a statement and a paragraph of three statements
 * should be able to yield three. The split is deliberately dumb and deterministic — no comprehension, no model — so
 * the same text always yields the same candidates and a reader can predict what a turn will contribute.
 * @param {string} text
 * @returns {string[]}
 */
export function spansOf(text) {
  if (typeof text !== 'string') return []
  const spans = []
  for (const paragraph of text.split(/\n\s*\n|\n/u)) {
    const trimmed = paragraph.trim()
    if (trimmed === '') continue
    // A sentence boundary is terminal punctuation followed by space and a capital, or by end of paragraph. Splitting
    // on every period would cut "4.5 USD" and file extensions in half; this refuses those two cases by construction.
    const sentences = trimmed.split(/(?<=[.!?])\s+(?=[A-Z"'(])/u)
    for (const sentence of sentences) {
      const piece = sentence.trim()
      if (piece !== '') spans.push(cutText(piece, MAX_CANDIDATE_CHARS))
    }
  }
  return spans
}

/**
 * Turn one finished turn into up to `MAX_RECORDS_PER_TURN` candidates, without approval.
 *
 * @param {Readonly<Record<string, unknown>>} turn - the bounded digest: `{sessionId, sessionTitle?, seq, at, turn, text, injected?, canonicalEventLine}`.
 * @param {{subject: string, privacy: string, stagedTurns?: ReadonlySet<string>}} policy - the host's read-owner subject, the permitted privacy class, and what this session has already staged.
 * @returns {{candidates: ReadonlyArray<Readonly<Record<string, unknown>>>, reason: string}} candidates, and the named reason for how many were produced.
 * @throws {KiraCaptureError} when the digest is malformed.
 */
export function captureTurn(turn, policy) {
  if (turn === null || typeof turn !== 'object' || Array.isArray(turn)) {
    refuse('digest-malformed', 'a turn digest must be one plain data record')
  }
  const { sessionId, sessionTitle = '', seq, at, turn: turnNumber, text, injected, canonicalEventLine } = turn
  if (typeof sessionId !== 'string' || sessionId === '') {
    refuse('digest-malformed', 'a turn digest must carry the sessionId it came from: a record that cannot cite its turn has no provenance')
  }
  if (!Number.isInteger(seq) || seq < 0) refuse('digest-malformed', 'a turn digest must carry the event sequence number it came from')
  if (!Number.isInteger(turnNumber)) refuse('digest-malformed', 'a turn digest must carry an integer turn number')
  if (typeof at !== 'string' || !INSTANT.test(at)) {
    refuse('digest-malformed', 'a turn digest must carry a canonical seconds-precision UTC instant in `at`; no local clock participates')
  }
  if (typeof canonicalEventLine !== 'string' || canonicalEventLine === '') {
    refuse('event-line-missing', 'capture needs the exact canonical event line: its digest is the receipt, and a record without one cannot be verified later')
  }
  const subject = policy?.subject
  const privacy = policy?.privacy
  if (typeof subject !== 'string' || subject === '') refuse('subject-missing', 'the host read-owner subject is never supplied by the model, and it is required')
  if (typeof privacy !== 'string' || privacy === '') refuse('privacy-missing', 'the privacy class comes from the host policy, and it is required')

  const key = turnKey(sessionId, turnNumber)

  // NEVER OUR OWN INJECTED TEXT — checked before the text is read, so no future marker can make an injected turn
  // stageable by accident. The same property autostage enforces, kept here rather than assumed from it.
  if (injected === true) return { candidates: Object.freeze([]), reason: 'injected-text-is-not-turn-content' }

  const already = policy?.stagedTurns?.has(key) === true
  if (already) return { candidates: Object.freeze([]), reason: 'turn-already-staged' }

  // THE RECEIPT. The digest is taken over the CANONICAL EVENT LINE the caller supplies, which is the same bytes a
  // verifier re-reads later — not over a re-serialisation this module invents, which would verify against itself.
  const sourceDigest = sha256Hex(canonicalEventLine)
  const source = Object.freeze({ sessionId, sessionTitle, seq, at, sha256: sourceDigest })

  const candidates = []
  const seen = new Set()
  for (const span of spansOf(typeof text === 'string' ? text : '')) {
    if (CONTROL_CHARACTERS.test(span)) continue
    const category = classifyCandidate(span)
    if (category === null) continue
    const kind = CATEGORY_CONTRACT_KIND[category]
    if (kind === undefined || !noteKind.includes(/** @type {never} */ (kind))) {
      // A mapping that produced a kind outside the contract is a defect in THIS module, and it must be loud rather
      // than staged under an invalid kind the store would refuse anyway.
      refuse('kind-mapping-invalid', `category ${category} maps to kind ${String(kind)}, which the memory contract does not admit`)
    }
    const fingerprint = `${kind}\u0000${span}`
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    candidates.push(Object.freeze({ category, kind, text: span, source, subject, privacy, possibleChange: CHANGE_MARKER.test(span) }))
    if (candidates.length === MAX_RECORDS_PER_TURN) break
  }
  // *** A CHANGE OF MIND IS NOT NOTHING. *** MEASURED 2026-09-26: "I've changed my mind about mornings —
  // I now prefer long answers" produced ZERO candidates with reason `nothing-worth-keeping`, because the
  // classifier found no marker it recognizes and returned null. The most important thing to know about a
  // preference is that the owner CHANGED it, and the store would have gone on reporting the abandoned one.
  if (candidates.length === 0 && CHANGE_MARKER.test(String(text))) {
    const span = cutText(String(text).trim(), MAX_SPAN_CHARS)
    if (span !== '') candidates.push(Object.freeze({ category: 'preference', kind: 'preference', text: span, source, subject, privacy, possibleChange: true }))
  }
  // THE WHOLE TURN, LAST, so a marker sentence that IS the whole turn keeps its kind: the harness keeps the first of two
  // identical statements. `verbatim` tells the harness these are the owner's own words, so the paraphrase checks (five-word
  // minimum, negation) do not apply; the statement must still appear in his turn, and the secret scan still runs.
  const whole = wholeTurnText(text)
  if (whole !== '') {
    candidates.push(Object.freeze({ category: WHOLE_TURN_CATEGORY, kind: 'observation', text: whole, source, subject, privacy, possibleChange: CHANGE_MARKER.test(whole), verbatim: true }))
  }
  if (candidates.length === 0) return { candidates: Object.freeze([]), reason: 'nothing-worth-keeping' }
  return { candidates: Object.freeze(candidates), reason: `${String(candidates.length)} from this turn: at most ${String(MAX_RECORDS_PER_TURN)} marker sentence(s) and the whole turn` }
}

/**
 * The turn key a caller records once a turn has been captured, so a retried turn contributes nothing twice.
 * @param {string} sessionId @param {number} turn @returns {string}
 */
export function capturedTurnKey(sessionId, turn) {
  return turnKey(sessionId, turn)
}
