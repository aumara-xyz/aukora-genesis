/**
 * AUTO-STAGING — what one turn is worth keeping, decided from a DIGEST and not from the transcript.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE. The judgement in auto-staging is not "how do I read the session
 * log" — it is "what may be turned into a durable record, and what must never be". That judgement is
 * cheap to get wrong in a way nobody notices, so it lives here with no filesystem, no clock, no session
 * service and no harness, and a court can drive every rule directly.
 *
 * WHAT IT IS GIVEN, AND WHY THAT IS THE WHOLE SAFETY ARGUMENT. It receives a DIGEST: a handful of
 * bounded, already-derived fields about one finished turn. It is never given the messages, and it has
 * no parameter through which a message could arrive. So "never stage the raw transcript" is not a rule
 * this module promises to follow — it is a property of its input shape, which is why the shape is a
 * closed object rather than an open one.
 *
 * NEVER OUR OWN INJECTED TEXT. Kira injects recalled records into a fresh context, and the board
 * injects other sessions' status. If either were treated as turn content, the next turn would stage a
 * record of a record, and the store would fill with its own echo. A digest marks such content
 * `injected`, and an injected digest stages NOTHING — no exception, no "unless it looks interesting".
 *
 * AT MOST ONE. One turn produces one candidate or none. A turn that produced three records would make
 * review a chore, and a chore is not reviewed; the queue exists so that a person can decide in seconds,
 * and that only holds while the queue stays short.
 *
 * THE CLASSIFIER IS MARKERS, NOT COMPREHENSION, and that ceiling is stated rather than hidden. These
 * are regular expressions over a bounded string. They will miss a preference phrased unusually and they
 * will occasionally match a sentence that merely mentions one. Their value is that they are
 * DETERMINISTIC, reviewable, and refuse rather than guess: a digest that matches no marker stages
 * nothing, and a person still has `kira_stage` for anything this misses.
 *
 * @module @aukora/dsh-plugin-kira/autostage
 */
import {
  recordKind,
  stageKiraMemoryRecord,
} from './record.mjs'
import { ownerControlIn } from './memory-forget.mjs'

/** The three things a turn can be worth keeping for. Closed: a fourth needs a new format version. */
export const AUTO_STAGE_CATEGORIES = Object.freeze(['agent-instruction', 'preference', 'decision', 'measured-fact'])

/**
 * Which record kind each category becomes.
 *
 * THE CATEGORY AND THE RECORD KIND ARE NOT THE SAME VOCABULARY, and collapsing them would force one of
 * the two to lie. The record contract's kinds are about what a record IS (`observation`, `claim`,
 * `plan`, `preference`); this module's categories are about what made it worth keeping. A committed
 * choice about what will be done is a `plan`; a thing measured is an `observation`; a stated preference
 * is a `preference`. The category travels verbatim in the record's content, so the distinction survives
 * into the store instead of being lost at the mapping.
 */
export const CATEGORY_RECORD_KIND = Object.freeze({
  // AN INSTRUCTION FROM ONE AGENT TO ANOTHER IS NOT A NEW KIND OF THING TO REMEMBER, and it is not
  // mapped to `preference`: what a record IS here is an observation — the store observed that a peer
  // directed someone to do something. The LABEL the reviewer needs is the category, which travels
  // verbatim in the record and on the review row; the kind stays inside the record contract's closed
  // set rather than widening it for a distinction about PROVENANCE.
  'agent-instruction': 'observation',
  preference: 'preference',
  decision: 'plan',
  'measured-fact': 'observation',
})

/**
 * THE CEILING EACH CATEGORY CARRIES, because one shared sentence cannot be true of all of them.
 *
 * MEASURED 2026-09-24 on a real queue entry (`kira:8f2cac9b…`): a lane's instruction to another agent —
 * "From now on, run courts on the committed tree before reporting green" — was staged as a PREFERENCE,
 * so a reviewer looking for what Peter wants would have read a peer directive as the owner's wish. That
 * is how agent chatter becomes memory: not by being staged (staging it is right — it is real turn
 * content a person should see) but by being staged under a label that flatters it.
 */
export const CATEGORY_CEILINGS = Object.freeze({
  'agent-instruction': 'instruction-shaped text ADDRESSED to an agent or a lane, staged because of its '
    + 'shape; this classifier cannot tell an owner\'s directive from a peer\'s, so it is NOT recorded as a '
    + 'statement of Peter\'s preference, it is not adopted by anyone, and it grants no authority by itself '
    + '— a person decides what it means',
  preference: 'chosen by a marker classifier over one bounded turn digest, not by comprehension; Remembered and UNREVIEWED (`REMEMBERED_IS_UNREVIEWED`) — memory, and no person has checked it',
  decision: 'chosen by a marker classifier over one bounded turn digest, not by comprehension; Remembered and UNREVIEWED (`REMEMBERED_IS_UNREVIEWED`) — memory, and no person has checked it',
  'measured-fact': 'chosen by a marker classifier over one bounded turn digest, not by comprehension; Remembered and UNREVIEWED (`REMEMBERED_IS_UNREVIEWED`) — memory, and no person has checked it',
})

/** Recorded in every auto-staged record, so a reader can tell how it was chosen and by what. */
export const AUTOSTAGE_ORIGIN = 'kira-autostage/v1'

/** The classifier's own identity, so a later version can be told apart from this one. */
export const AUTOSTAGE_CLASSIFIER = 'markers/v1'

/** Most characters of the turn's own text one record may carry. */
export const MAX_CANDIDATE_CHARS = 400

/**
 * The markers, in PRECEDENCE ORDER.
 *
 * Order is load-bearing. "From now on always run the court first, and we measured that it catches it"
 * is one sentence matching several rows; the FIRST row that matches wins, so the classification is a
 * deterministic function of the text rather than of object iteration order.
 */
export const CATEGORY_MARKERS = Object.freeze([
  // FIRST, because a directive and a preference share vocabulary: the real entry that produced this
  // category said "From now on, run courts on the committed tree", which matches the preference marker
  // below and was staged as Peter's wish. What distinguishes an INSTRUCTION is that it is ADDRESSED to
  // somebody — a second person, or a verb in the imperative — so these markers require that shape.
  ['agent-instruction', [
    // THE SIGNAL IS THE ADDRESSEE, NOT THE MOOD. A first attempt also matched any sentence opening with a
    // directive verb, and TWO EXISTING COURTS caught it immediately: `kira-autostage`'s control "run the
    // court again" and `kira-autostage-wire`'s three-turn fixture both began staging text that must stage
    // nothing. A sentence that merely starts with a verb is not addressed to anybody; these markers
    // require a second person, which is what "instruction-shaped text ADDRESSED to an agent" means.
    /\byour (?:[0-9a-f]{7,40}|court|courts|arm|arms|survivors|turn|task|lane|fix|change|commit|report|branch|worktree|fence)\b/iu,
    /\byou (?:must|should|need to|have to|can|could|will|may|are to)\b/iu,
    // `from now on` bound to a directive rather than to a first-person wish — the exact shape that was
    // staged as a preference on 2026-09-24.
    /\bfrom now on,?\s+(?:run|use|report|write|check|name|never|always|do|don'?t)\b/iu,
  ]],
  ['preference', [
    /\bi (?:would )?prefer\b/iu,
    /\bplease (?:always|never)\b/iu,
    /\bfrom now on\b/iu,
    /\bi (?:always|never) want\b/iu,
  ]],
  ['decision', [
    /\bwe (?:have )?decided\b/iu,
    /\bthe decision is\b/iu,
    /\b(?:let'?s|we(?:'| a)re) go(?:ing)? with\b/iu,
    /\bwe (?:will|won'?t) (?:ship|use|adopt|drop)\b/iu,
  ]],
  ['measured-fact', [
    /\bmeasured\b/iu,
    /\bthe measurement\b/iu,
    /\bcounting .*? gives\b/iu,
  ]],
])

/**
 * The digest fields this module reads. Anything else on the object is ignored, and nothing here can
 * carry a message array.
 */
export const DIGEST_FIELDS = Object.freeze(['sessionId', 'turn', 'ask', 'injected', 'at'])

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

/** A named auto-staging refusal. Refusals are for malformed input, never for "nothing to keep". */
export class KiraAutoStageError extends Error {
  /** Stable machine-readable refusal code, e.g. `kira.autostage:digest-malformed`. */
  code

  /**
   * @param {string} code - stable refusal code suffix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`kira.autostage: ${message}`)
    this.name = 'KiraAutoStageError'
    this.code = `kira.autostage:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new KiraAutoStageError(code, message)
}

/**
 * Classify one bounded string into at most one category.
 * @param {string} text - the turn's own bounded text.
 * @returns {string|null} the category, or null when nothing matched.
 */
export function classifyCandidate(text) {
  for (const [category, patterns] of CATEGORY_MARKERS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return category
    }
  }
  return null
}

/**
 * The one record a turn is worth keeping, or nothing.
 *
 * MALFORMED IS A FAULT; UNREMARKABLE IS AN ANSWER. A digest missing `sessionId`, `turn` or a canonical
 * `at` is refused, because a record that cannot cite its turn is a record with no provenance and
 * silently staging one would manufacture it. A well-formed digest whose text matches no marker returns
 * `null` — that is the common case and it is not an error.
 *
 * @param {Readonly<Record<string, unknown>>} digest - the bounded turn digest.
 * @param {string} subject - the host read-owner subject; the model never supplies it.
 * @param {string} privacy - the privacy class the host policy permits.
 * @returns {{category: string, recordId: string, record: Readonly<Record<string, unknown>>, memoryPut: Readonly<{key: string, value: unknown}>, reason: 'staged'} | {category: null, reason: string}} the staged candidate, or the named reason nothing was staged.
 * @throws {KiraAutoStageError} when the digest is malformed.
 */
export function autoStageCandidate(digest, subject, privacy) {
  if (digest === null || typeof digest !== 'object' || Array.isArray(digest)) {
    refuse('digest-malformed', 'a turn digest must be one plain data record')
  }
  if (typeof digest.sessionId !== 'string' || digest.sessionId === '') {
    refuse('digest-malformed', 'a turn digest must carry the sessionId it came from: a record that cannot cite its turn has no provenance')
  }
  if (!Number.isInteger(digest.turn)) {
    refuse('digest-malformed', 'a turn digest must carry an integer turn number')
  }
  if (typeof digest.at !== 'string' || !INSTANT.test(digest.at)) {
    refuse('digest-malformed', 'a turn digest must carry a canonical seconds-precision UTC instant in `at`; no local clock participates')
  }

  // NEVER OUR OWN INJECTED TEXT. Checked before the text is even looked at, so no future marker can
  // make an injected digest stageable by accident.
  if (digest.injected === true) {
    return { category: null, reason: 'injected-text-is-not-turn-content' }
  }

  const ask = typeof digest.ask === 'string' ? digest.ask.trim() : ''
  if (ask === '') return { category: null, reason: 'nothing-said' }
  // THE OWNER'S OFF SWITCHES STOP THE QUEUE COPY TOO (2026-09-27). "Off the record, I prefer …" matched a marker and was
  // queued: his words on disk, waiting for approval, in the turn he said should not be kept. Same phrases as the capture.
  const said = ownerControlIn(ask)
  if (said !== null) return { category: null, reason: `owner-said-${said}` }
  if (CONTROL_CHARACTERS.test(ask)) return { category: null, reason: 'text-not-a-single-line' }

  const category = classifyCandidate(ask.slice(0, MAX_CANDIDATE_CHARS))
  if (category === null) return { category: null, reason: 'nothing-worth-keeping' }

  const kind = CATEGORY_RECORD_KIND[category]
  if (!recordKind.includes(/** @type {never} */ (kind))) {
    // A mapping that produced a kind outside the closed set is a defect in THIS module, and it must be
    // loud rather than silently staged under an invalid kind the record contract would refuse anyway.
    refuse('kind-mapping-invalid', `category ${category} maps to record kind ${kind}, which the record contract does not admit`)
  }

  const staged = stageKiraMemoryRecord({
    subject,
    kind,
    source: [],
    links: [],
    privacy,
    createdAt: digest.at,
    content: {
      category,
      note: ask.slice(0, MAX_CANDIDATE_CHARS),
      // THE TURN IS THE PROVENANCE. The record contract's `source` names other RECORDS, which this is
      // not derived from, so citing the turn it came from belongs in the content where a reader will
      // meet it — and `source` stays empty rather than being filled with something that only looks
      // like a source.
      turn: { sessionId: digest.sessionId, turn: digest.turn },
      origin: AUTOSTAGE_ORIGIN,
      classifier: AUTOSTAGE_CLASSIFIER,
      ceiling: CATEGORY_CEILINGS[category] ?? CATEGORY_CEILINGS.preference,
    },
  })
  return { category, recordId: staged.recordId, record: staged.record, memoryPut: staged.memoryPut, reason: 'staged' }
}

/**
 * Whether one turn's staged candidate may be enqueued, given how many this session already staged.
 *
 * AT MOST ONE PER TURN is enforced here rather than trusted, and it is keyed by the TURN rather than by
 * a counter: a counter would let a retried turn stage twice, and a turn is the unit a person reviews.
 *
 * @param {ReadonlySet<string>} stagedTurns - keys of the form `sessionId\u0000turn`.
 * @param {string} sessionId - the session the candidate came from.
 * @param {number} turn - the turn number.
 * @returns {boolean} whether this turn may still stage.
 */
export function mayStageForTurn(stagedTurns, sessionId, turn) {
  return !stagedTurns.has(`${sessionId}\u0000${String(turn)}`)
}

/** The key `mayStageForTurn` uses, exported so a caller cannot invent a different one. */
export function turnKey(sessionId, turn) {
  return `${sessionId}\u0000${String(turn)}`
}
