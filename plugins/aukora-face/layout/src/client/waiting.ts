/**
 * WHO IS WAITING ON PETER, PER LANE — the fact AK-UI itself needed and nobody showed him.
 *
 * THE DEFECT THIS EXISTS FOR. AK-UI sat sixteen hours on four unanswered escalation approvals. They were never
 * refused and never granted; the work simply stopped, and nothing in the thread list said so. A lane that is
 * WAITING looks idle from the outside, which is the one state a person must never have to guess at.
 *
 * **UNKNOWN IS NEVER "NONE".** A lane whose question cannot be answered — no events were read, the source did not
 * answer, the approval carries no timestamp — renders as `unknown`, never as a reassuring blank. The distinction is
 * the whole point: "nobody is waiting on you" and "I could not find out" lead a person to different actions, and a
 * strip that conflates them sends him back to sleep. This is the same rule `auma-status.ts` applies to her facts.
 *
 * PURE, AND SOURCE-AGNOSTIC ON PURPOSE. It reads a list of approval EVENTS and nothing else, so it can be driven
 * by the session's own ask/outcome log — which the Host's `approval` service writes for every pair, and which is
 * readable today — and by AUMA's `/api/auma-live/status` lane facts the moment her commit lands. No clock, no
 * store, no fetch: `now` is injected, so an age is measured rather than assumed.
 *
 * @module waiting
 */

/** The word an undeterminable lane renders as. Spelled out, because a blank reads as "nobody needs you". */
export const WAITING_UNKNOWN = 'unknown'

/** The word a lane with nothing outstanding renders as. This is a FACT, not a default. */
export const WAITING_NONE = 'none'

/** One approval event as the session log carries it: an ask, or the outcome that closes it. */
export interface ApprovalEvent {
  /** `asked` opens a wait; `answered` closes the wait with the same `id`. */
  readonly kind: 'asked' | 'answered'
  /** The approval's identity, so an outcome can be matched to its ask. */
  readonly id?: string | null
  /** Milliseconds since the epoch. An ask without one leaves the AGE unknown while the wait stays known. */
  readonly at?: number | null
  /** The lane this approval belongs to, when the log names one. */
  readonly lane?: string | null
}

/** What the thread list shows for one lane. */
export interface WaitingFact {
  /** True when the events were read and the answer is known — waiting or not. False means unknown. */
  readonly known: boolean
  /** The rendered text: `waiting 16h`, `waiting`, `none`, or `unknown`. */
  readonly text: string
  /** How long the OLDEST open approval has been open, or null when it is waiting but the age is not known. */
  readonly oldestMs: number | null
  /** The id of that oldest open approval, so a click can open the thread at it. */
  readonly approvalId: string | null
}

/** Hours, minutes, days — the coarsest unit that still says something useful. */
export function waitingAgeText(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'less than a minute'
  if (minutes < 60) return `${String(minutes)}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${String(hours)}h`
  return `${String(Math.floor(hours / 24))}d`
}

/**
 * The waiting fact for one lane.
 *
 * @param input - the lane to answer for, the approval events (or null when they could not be read), and the clock.
 * @returns the fact, with `known: false` when the question itself could not be answered.
 */
export function waitingOf(input: {
  readonly lane?: string | null | undefined
  readonly events?: readonly ApprovalEvent[] | null | undefined
  readonly now?: number | null | undefined
}): WaitingFact {
  const unknown: WaitingFact = { known: false, text: WAITING_UNKNOWN, oldestMs: null, approvalId: null }
  // NO EVENTS IS NOT "NO APPROVALS". A source that did not answer leaves the lane unknown.
  if (input.events === null || input.events === undefined) return unknown
  // **NO FALLBACK CLOCK.** This read `Date.now()` when a caller passed none, which made an age depend on when the
  // function happened to run — the one thing a court cannot pin down. A caller that passes no clock gets no age
  // (`oldestMs: null`), and every caller here passes one: the frame renders with `Date.now()` and the courts with a
  // fixed instant.
  const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : null
  const lane = typeof input.lane === 'string' && input.lane !== '' ? input.lane : null

  // **A LIST THAT NAMES NO LANE IS ALREADY THAT LANE'S LIST — MEASURED ON THE SEAM.** The host sends each lane its
  // own approval log, so its events carry no `lane` field; a caller that hands one lane's events to this function
  // means those events, not none of them. Filtering unconditionally made a lane with three approvals read as `none`,
  // which is the exact lie this module exists to prevent — caught by the court that drives both halves together
  // rather than by either half's own court.
  const named = input.events.some(event => typeof event.lane === 'string' && event.lane !== '')
  const mine = lane === null || !named ? [...input.events] : input.events.filter(event => event.lane === lane)
  // A LANE THE LOG NEVER MENTIONS IS A LANE WITH NOTHING OPEN — but only because the log WAS read: an empty list is
  // a known answer here, which is exactly why the null case above had to be distinguished from it.
  // **BY ID, AND BY ORDER ONLY WHEN A SOURCE OMITS THE ID — AND IDS ARE PRESENT IN THE REAL LOG.** Corrected after
  // measurement: this file first claimed the durable log's `approval/asked` and `approval/decided` events carry no
  // shared identifier, and that is WRONG. `apps/src/vendor/organism.ts` reads the same log and states the rule the
  // log itself uses — "an approval is open when its `data.id` was ASKED and never DECIDED" — and it reads the id
  // off the event, so the id is there. The order fallback stays for a source that genuinely omits one (a summary, a
  // route that names only counts), and the id path is what the live sessions take.
  const closed = new Set(mine.filter(event => event.kind === 'answered' && typeof event.id === 'string').map(event => String(event.id)))
  const open = []
  const pendingUnidentified = []
  for (const event of mine) {
    if (event.kind === 'asked') {
      if (typeof event.id === 'string' && closed.has(event.id)) continue
      open.push(event)
      if (typeof event.id !== 'string') pendingUnidentified.push(event)
      continue
    }
    // An outcome with an id closes that ask; without one it closes the oldest ask that has no id of its own.
    if (typeof event.id === 'string') {
      const index = open.findIndex(ask => ask.id === event.id)
      if (index !== -1) open.splice(index, 1)
      continue
    }
    const oldest = pendingUnidentified.shift()
    if (oldest !== undefined) {
      const index = open.indexOf(oldest)
      if (index !== -1) open.splice(index, 1)
    }
  }
  if (open.length === 0) return { known: true, text: WAITING_NONE, oldestMs: null, approvalId: null }

  // THE OLDEST OPEN APPROVAL IS THE ONE THAT MATTERS: it is the one that has been costing the most time.
  const stamped = open.filter(event => typeof event.at === 'number' && Number.isFinite(event.at))
  const oldest = stamped.length === 0
    ? null
    : stamped.reduce((best, event) => (Number(event.at) < Number(best.at) ? event : best))
  // **AN UNKNOWN CLOCK LEAVES THE AGE UNKNOWN, WHICH IS THE CASE THIS FUNCTION ALREADY HAS A NAME FOR.** `now` is
  // `number | null` — an ask without a timestamp is a supported state, not an error — and subtracting a null from a
  // timestamp is the arithmetic this line used to do silently. **`oldestMs: null` already renders as `waiting` with no
  // age**, which is the honest answer when the clock is not known: the wait is real and its duration is not.
  const oldestMs = oldest === null || now === null ? null : Math.max(0, now - Number(oldest.at))
  const approvalId = oldest !== null && typeof oldest.id === 'string' && oldest.id !== '' ? oldest.id : null
  return {
    known: true,
    text: oldestMs === null ? 'waiting' : `waiting ${waitingAgeText(oldestMs)}`,
    oldestMs,
    approvalId,
  }
}

/**
 * The waiting fact for every lane in a list, keyed by lane name.
 *
 * @param lanes - the lane names to answer for.
 * @param events - the approval events, or null when they could not be read (every lane is then unknown).
 * @param now - the clock.
 * @returns one fact per lane, in the order the lanes were given.
 */
export function waitingByLane(
  lanes: readonly string[],
  events: readonly ApprovalEvent[] | null | undefined,
  now?: number,
): Readonly<Record<string, WaitingFact>> {
  const out: Record<string, WaitingFact> = {}
  for (const lane of lanes) out[lane] = waitingOf({ lane, events, now: now ?? null })
  return Object.freeze(out)
}
