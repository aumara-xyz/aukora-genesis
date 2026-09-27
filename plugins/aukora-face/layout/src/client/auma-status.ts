/**
 * THE STRIP'S FACTS — five questions about what Auma Live can do right now, each either answered or UNKNOWN.
 *
 * **THE RULE THAT SHAPES THIS WHOLE MODULE: AN UNKNOWN IS NEVER A GREEN.** A strip that renders a failed lookup
 * as `0 lanes` or `$0.00 spent` tells a person she is idle and broke when the truth is that nobody asked. So
 * every fact here is `{ known: true, text }` or `{ known: false, text: 'unknown' }`, and the frame renders the
 * two differently — a known value in the label's own colour, an unknown in the muted one, with the word spelled
 * out rather than left blank.
 *
 * WHERE EACH ANSWER COMES FROM:
 *   · thread     the live session store, with the HOME session the host names taking precedence over the lane
 *                word in a title — the authority is the host's, not a guess (`auma-thread.ts` decides it).
 *   · lanes      the live session store (counted by the frame, `lanesRunningOf`).
 *   · core       the CORE fact on the minds response: whether this Host's conductor session exists.
 *   · hands      the mind keys the same response offers: what this Host would actually accept.
 *   · spend      today's spend and the cap, from the spend gate through the same response.
 * The last three arrive in ONE request that the panel already makes at mount (`/api/auma-live/minds`), so the
 * strip costs no new route and no write of any kind.
 *
 * PURE, SO IT CAN BE MEASURED: a React file cannot be imported by a court, and the "unknown is not green" rule
 * is exactly the kind of rule that reads as satisfied while a lookup silently returns zero.
 *
 * @module auma-status
 */
import { aumaThreadOf } from './auma-thread.ts'

/** The surface id the Auma Live panel registers under. */
export const AUMA_LIVE_SURFACE = 'auma-live'

/**
 * The route these facts arrive on: AUMA's read-only `/api/auma-live/status`.
 *
 * **ONE SOURCE, ONE IMPLEMENTATION.** This strip used to assemble its facts itself — the spend gate and the CORE
 * id off the minds answer, the lane count off the session store — which made two implementations of the same
 * question. AUMA's route answers all of it, so the strip reads that route and the assembly goes away wherever the
 * route covers it; a fact the route does not carry is `unknown`, never a value this file guessed.
 *
 * **THE PAYLOAD'S FIELD NAMES ARE PROVISIONAL UNTIL HER COMMIT LANDS.** The route answers, per the order: the home
 * session and its liveness, the lanes with those waiting on Peter, whether the CORE session exists, the hands that
 * resolve, today's spend against the cap, and the last wake decision — each unknown-able. The two names already
 * fixed by her own acceptance court (`spentTodayUsd`, `capUsd`) are used here; the rest are marked so the swap is
 * a rename rather than a rewrite. The court drives a FIXTURE of this shape meanwhile.
 */
export const AUMA_STATUS_PATH = '/api/auma-live/status'

/**
 * The minds route, which carries the per-lane approval log the waiting badge is computed from.
 *
 * TWO ROUTES, TWO QUESTIONS, AND BOTH ARE NEEDED: the status route answers what she can do right now (her
 * thread, the lanes running, CORE, the hands, the spend, the last wake), and this one carries the lanes'
 * approval events, which is the only thing that can say WHO IS STOPPED AND FOR HOW LONG. A strip that inferred
 * a waiting lane from a running count would go quiet exactly when it matters.
 */
export const AUMA_MINDS_PATH = '/api/auma-live/minds'

/** The one word an unanswered fact is rendered with. Spelled out, because a blank reads as a broken strip. */
export const UNKNOWN_TEXT = 'unknown'

/** One answered-or-unknown fact. */
export interface StatusFact {
  readonly known: boolean
  readonly text: string
}

/** Everything the strip shows. */
export interface AumaStatus {
  readonly thread: StatusFact
  readonly lanes: StatusFact
  /** How many lanes are BLOCKED ON PETER — the fact AUMA's route adds, and the one a person acts on. */
  readonly waiting: StatusFact
  readonly core: StatusFact
  readonly hands: StatusFact
  readonly spend: StatusFact
  /** The last wake decision the route reports — what she decided the last time she woke. */
  readonly wake: StatusFact
  /** True when any fact is unknown, so the frame can mark the whole strip rather than each line. */
  readonly anyUnknown: boolean
}

/** A value that may be absent: absent is unknown, present is known. NEVER a default in its place. */
function factOf(value: string | null): StatusFact {
  return value === null ? { known: false, text: UNKNOWN_TEXT } : { known: true, text: value }
}

/** The answer body, as much of it as this module reads. Provisional names are marked. */
interface StatusAnswer {
  /** The home session id. */
  readonly homeSession?: unknown
  /** Whether that home session is live (the route's "home session and liveness"). */
  readonly homeLive?: unknown
  /** `{ running?: number, waitingOnOwner?: number }` — lanes running, and those blocked on Peter. */
  readonly lanes?: unknown
  /** `{ known: true, exists: boolean }` or `{ known: false }` — never a value on the unknown arm. */
  readonly core?: unknown
  /** The hand keys that RESOLVE, as strings. */
  readonly hands?: unknown
  /** `{ known: true, spentTodayUsd, capUsd, day }` or `{ known: false }`. */
  readonly spend?: unknown
  /** `{ decision?: string, at?: string }` or null — the last wake decision. */
  readonly lastWake?: unknown
}

/**
 * Build the strip's five facts.
 *
 * @param input - the live selection, the lane count the frame measured, and the route's answer (or null when it
 *   could not be read — a failed fetch is an unknown, never a zero).
 * @returns the facts, each marked known or unknown.
 */
export function aumaStatusOf(input: {
  sessionId?: string | null | undefined
  title?: string | null | undefined
  homeSessionId?: string | null | undefined
  lanesRunning?: number | null | undefined
  answer?: StatusAnswer | null | undefined
}): AumaStatus {
  const answer = input.answer ?? null
  const thread = aumaThreadOf({
    sessionId: input.sessionId ?? null,
    title: input.title ?? null,
    homeSessionId: typeof answer?.homeSession === 'string' ? answer.homeSession : (input.homeSessionId ?? null),
  })
  const threadFact: StatusFact = thread.kind === 'none'
    ? { known: false, text: UNKNOWN_TEXT }
    : { known: true, text: thread.kind === 'home' ? 'her home thread' : thread.text }

  // THE ROUTE'S LANE FACTS WIN, AND THE FRAME'S OWN COUNT IS ONLY A FALLBACK FOR A ROUTE THAT IS SILENT.
  // The fallback exists because the route is being built in another lane right now and the panel must not go dark
  // meanwhile; it is never used to contradict a route that answered, and it goes when the route lands.
  const lanesAnswer = answer?.lanes as { running?: unknown; waitingOnOwner?: unknown } | null | undefined
  const routeRunning = lanesAnswer !== null && lanesAnswer !== undefined && Number.isFinite(Number(lanesAnswer.running))
    ? String(Number(lanesAnswer.running))
    : null
  const lanes = routeRunning
    ?? (typeof input.lanesRunning === 'number' && Number.isFinite(input.lanesRunning) ? String(input.lanesRunning) : null)
  // WAITING ON PETER: KNOWN ZERO IS A FACT, AN ABSENT FIELD IS NOT. `0 waiting on Peter` is the good news a person
  // wants and is rendered as known; a route that did not answer leaves it unknown rather than inventing the zero.
  const waitingCount = lanesAnswer !== null && lanesAnswer !== undefined
    && Number.isFinite(Number(lanesAnswer.waitingOnOwner)) ? Number(lanesAnswer.waitingOnOwner) : null
  const waitingFact = waitingCount === null
    ? null
    : waitingCount === 0 ? 'none waiting on Peter' : `${String(waitingCount)} waiting on Peter`

  // THE LAST WAKE DECISION. Reported by the route as `{ decision, at }`; the decision is what a person reads, and
  // an absent or empty one is unknown rather than the word "none" — she may simply not have woken yet.
  const wakeAnswer = answer?.lastWake as { decision?: unknown; at?: unknown } | null | undefined
  const wakeFact = wakeAnswer !== null && wakeAnswer !== undefined && typeof wakeAnswer.decision === 'string'
    && wakeAnswer.decision.trim() !== ''
    ? `last wake: ${wakeAnswer.decision.trim()}`
    : null

  // THE ANSWER'S FIELDS ARE `unknown` UNTIL THEY ARE CHECKED, and the check is the point: a payload that says
  // `known: false` has no `exists` at all, and reading one off it would be the guess this module forbids.
  const coreAnswer = answer?.core as { known?: unknown; exists?: unknown } | null | undefined
  const coreKnown = coreAnswer !== null && coreAnswer !== undefined && coreAnswer.known === true
    && typeof coreAnswer.exists === 'boolean'
  const coreFact = coreKnown
    ? coreAnswer?.exists === true ? 'CORE session present' : 'CORE session absent'
    : null

  // THE HANDS THAT RESOLVE, from the route's own field. The old `minds` array was this face's own assembly and is
  // deliberately not read here: a second source for the same question is what the order asks this strip to drop.
  const hands = answer?.hands
  const handsFact = Array.isArray(hands)
    ? `${String(hands.length)} hand${hands.length === 1 ? '' : 's'} resolvable`
    : null

  const spendAnswer = answer?.spend as { known?: unknown; spentTodayUsd?: unknown; capUsd?: unknown } | null | undefined
  const spendKnown = spendAnswer !== null && spendAnswer !== undefined && spendAnswer.known === true
    && Number.isFinite(Number(spendAnswer.spentTodayUsd))
    && Number.isFinite(Number(spendAnswer.capUsd))
  const spent = spendKnown ? Number(spendAnswer?.spentTodayUsd) : 0
  const cap = spendKnown ? Number(spendAnswer?.capUsd) : 0
  const spend = spendKnown ? `$${spent.toFixed(2)} of $${cap.toFixed(2)} today` : null

  const status: AumaStatus = {
    thread: threadFact,
    lanes: factOf(lanes),
    waiting: factOf(waitingFact),
    core: factOf(coreFact),
    hands: factOf(handsFact),
    spend: factOf(spend),
    wake: factOf(wakeFact),
    anyUnknown: false,
  }
  return Object.freeze({
    ...status,
    // EVERY FACT IS COVERED HERE. A new fact added above without being added here would let the strip render an
    // unknown in the "known" colour, which is the one failure this strip exists to make impossible — so the court
    // asserts that this list and `AumaStatus`' members agree.
    anyUnknown: !status.thread.known || !status.lanes.known || !status.waiting.known || !status.core.known
      || !status.hands.known || !status.spend.known || !status.wake.known,
  })
}

/** The lane words a conversation carries in its title — the same vocabulary the board and organism reader use. */
export const LANE_WORDS = /^(AUMA|AURA|AK-UI|AUMLOK|BETA|KIRA|ALPHA)\b/u

/** How recently a lane's thread must have moved to count as running. */
export const LANE_RUNNING_WINDOW_MS = 10 * 60 * 1000

/**
 * HOW MANY LANES ARE RUNNING, from the live session store.
 *
 * A LANE IS A NAMED CONVERSATION THAT HAS MOVED RECENTLY: the title names a lane, the session is not blank, and
 * its `updatedAt` is inside the window. **A COUNT THAT WOULD BE A GUESS IS `null` INSTEAD**: a session whose
 * `updatedAt` is not a number leaves the count unknown, because the one thing worse than an unknown lane count is
 * a confident one — `SessionSummary.updatedAt` is required today, so that branch is a guard rather than a path.
 * @param sessions - the sessions store's list state, or anything else when the store is absent.
 * @param now - the clock, injectable so the window is measured rather than assumed.
 * @returns the count, or null when it cannot be counted.
 */
export function lanesRunningOf(
  sessions: { ids?: readonly string[] | undefined; byId?: Record<string, { displayTitle?: string | undefined; blank?: boolean | undefined; updatedAt?: number | undefined }> | undefined } | null | undefined,
  now: () => number = () => Date.now(),
): number | null {
  if (sessions === null || sessions === undefined || typeof sessions !== 'object') return null
  const ids = Array.isArray(sessions.ids) ? sessions.ids : null
  const byId = sessions.byId
  if (ids === null || byId === null || typeof byId !== 'object') return null
  const cutoff = now() - LANE_RUNNING_WINDOW_MS
  let running = 0
  for (const id of ids) {
    const summary = byId[id]
    if (summary === undefined || summary === null) continue
    if (typeof summary.updatedAt !== 'number' || !Number.isFinite(summary.updatedAt)) return null
    if (summary.blank === true) continue
    const title = typeof summary.displayTitle === 'string' ? summary.displayTitle.trim() : ''
    if (title === '' || !LANE_WORDS.test(title)) continue
    if (summary.updatedAt < cutoff) continue
    running += 1
  }
  return running
}
