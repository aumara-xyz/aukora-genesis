/**
 * THE FACTS ONLY THE HOST CAN KNOW, ASSEMBLED FOR THE ONE REQUEST THE PANEL ALREADY MAKES.
 *
 * `/api/auma-live/minds` is what the page asks for at mount, and AUMA's auma-36 already rides the home session
 * on it — "one request, no new route to register". Two more facts live only inside this face's own process: the
 * spend gate is an INSTANCE created in `index.ts` (nothing else can read its day), and the CORE session id is
 * this plugin's config. So they ride the same response rather than a second route.
 *
 * **AN UNDETERMINED FACT IS REPORTED AS UNDETERMINED, NEVER AS ZERO.** `{ known: false }` carries no value at
 * all — no `exists`, no `spentTodayUsd` — because a payload that says `spentTodayUsd: 0` when the gate could not
 * be read is a payload that lies in the direction of good news, and the strip downstream cannot tell the
 * difference after the fact.
 *
 * PURE, AND SEPARATE FROM THE HANDLER ON PURPOSE: `auma-live/http.ts` imports credentials, sessions and the
 * presence engine, so no keyless court can load it. This module imports nothing, so the payload's rules are
 * measured instead of described.
 *
 * @module status-facts
 */

/** The CORE fact: boolean when the host could determine it, `known: false` when it could not. */
export type CoreFact = { readonly known: true; readonly exists: boolean } | { readonly known: false }

/** Today's spend, against the cap: numbers when the gate could be read, `known: false` when it could not. */
export type SpendFact =
  | {
      readonly known: true
      readonly spentTodayUsd: number
      readonly capUsd: number
      readonly day: string
      /**
       * **HOW THIS FIGURE WAS DERIVED, NAMED RATHER THAN IMPLIED.** `reserved-worst-case` means it is the sum of the
       * estimates reserved BEFORE each call — an upper bound, not a bill.
       */
      readonly basis: 'reserved-worst-case'
      /** **WHETHER ANYTHING RECONCILES IT TO ACTUAL USAGE. It does not, and this says so.** */
      readonly settles: false
    }
  | { readonly known: false }

/** One lane's approval log, as the strip needs it to answer "is this lane waiting on Peter?". */
export interface WaitingLane {
  /** The lane's name, as its thread title carries it. */
  readonly lane: string
  /** The thread to open when the badge is clicked. */
  readonly sessionId: string
  /** `approval/asked` and `approval/decided`, in log order, with the id the log pairs them by. */
  readonly events: readonly { readonly kind: 'asked' | 'answered'; readonly id: string; readonly at: number | null }[]
}

/** One session as this mapping needs it: an id, a label a person reads, and its events. */
export interface WaitingSessionInput {
  readonly id: string
  readonly title?: string | undefined
  /** The session's events, or `null` when they could not be read — a session whose log is unreadable is SKIPPED. */
  readonly events?: readonly { readonly type?: unknown; readonly data?: unknown; readonly time?: unknown }[] | null | undefined
}

/**
 * The lanes to send: one entry per READ session, in the order given, capped.
 *
 * **A SESSION WITH NO APPROVALS IS SENT WITH AN EMPTY LIST, AND A SESSION WHOSE LOG COULD NOT BE READ IS SKIPPED.**
 * That difference is the entire point of the field: an empty list means "read, nothing open", and an ABSENT lane
 * means "not read", which the panel renders as unknown. Sending every lane with an empty list would make a failure
 * look like calm; sending none would make calm look like a failure.
 *
 * The pairing is the log's own rule, quoted from the organism reader that already depends on it: an approval is open
 * when its `data.id` was ASKED and never DECIDED. The mapping does not pair anything itself — it carries both kinds
 * and their ids, and the client's courted module decides — because a coupling decided in two places is a coupling
 * that will disagree in one of them.
 *
 * @param sessions - the sessions to consider, newest first or in any order.
 * @param options - a cap on how many lanes to send, so a long history cannot turn a status read into a scan.
 * @returns the lanes, each with its approval events in log order.
 */
export function waitingLanesOfSessions(
  sessions: readonly WaitingSessionInput[] | null | undefined,
  options: { readonly cap?: number } = {},
): readonly WaitingLane[] | null {
  if (!Array.isArray(sessions)) return null
  const cap = typeof options.cap === 'number' && options.cap > 0 ? options.cap : 24
  const lanes: WaitingLane[] = []
  for (const session of sessions) {
    if (lanes.length >= cap) break
    if (session === null || typeof session !== 'object') continue
    if (typeof session.id !== 'string' || session.id === '') continue
    // UNREADABLE IS SKIPPED, NOT EMPTIED. `events` null/undefined or not an array means nobody knows.
    if (!Array.isArray(session.events)) continue
    const events: WaitingLane['events'][number][] = []
    for (const event of session.events) {
      if (event === null || typeof event !== 'object') continue
      const type = event.type
      const kind = type === 'approval/asked' ? 'asked' : type === 'approval/decided' ? 'answered' : null
      if (kind === null) continue
      const data = (event.data ?? {}) as { id?: unknown }
      // The id is what the log pairs by, so an approval without one cannot be carried: inventing an id would let an
      // outcome close an ask it never answered, and dropping it would hide a lane that is genuinely stopped.
      if (typeof data.id !== 'string' || data.id === '') continue
      events.push({ kind, id: data.id, at: typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : null })
    }
    const title = typeof session.title === 'string' && session.title.trim() !== '' ? session.title.trim() : session.id
    lanes.push({ lane: title, sessionId: session.id, events })
  }
  return lanes
}

/** What the minds route sends, as far as this module decides it. */
export interface MindsPayload {
  readonly minds: readonly string[]
  readonly labels?: Readonly<Record<string, string>>
  readonly homeSession?: string
  readonly core: CoreFact
  readonly spend: SpendFact
  /**
   * WHO IS WAITING ON PETER, one entry per lane whose approvals were READ.
   *
   * **A LANE ABSENT FROM THIS LIST IS "UNKNOWN", NOT "NONE"** — and that is the whole reason the field is optional
   * and carries no default. A host that could not read a lane's log leaves the lane out, and the strip then says so;
   * a host that read the log and found nothing open sends the lane with an empty `events` array, which is a
   * KNOWN "none". The two must not be spelled the same way, because "nobody is waiting on you" and "I could not
   * find out" send a person to different places.
   */
  readonly waiting?: readonly WaitingLane[]
}

/**
 * The payload for `/api/auma-live/minds`.
 *
 * @param input - the offered hand keys, their labels, the configured home, and what the host could determine.
 * @returns the JSON body's fields, with undetermined facts carrying no value.
 */
/**
 * The CORE fact: a boolean the host determined, or `known: false` with NO value.
 * @param coreExists - what `index.ts` answered, or null when it could not answer.
 * @returns the fact.
 */
function coreFactOf(coreExists: boolean | null | undefined): CoreFact {
  return typeof coreExists === 'boolean' ? { known: true, exists: coreExists } : { known: false }
}

/**
 * Today's spend against the cap: the gate's own three numbers, or `known: false` with NO number.
 * @param spend - what the spend gate reported, or null when it could not be read.
 * @returns the fact.
 */
function spendFactOf(spend: { spentTodayUsd?: number | undefined; capUsd?: number | undefined; day?: string | undefined } | null | undefined): SpendFact {
  if (spend === null || spend === undefined) return { known: false }
  if (!Number.isFinite(Number(spend.spentTodayUsd)) || !Number.isFinite(Number(spend.capUsd))) return { known: false }
  if (typeof spend.day !== 'string' || spend.day === '') return { known: false }
  // **WHAT THIS NUMBER IS, SAID ON EVERY RESPONSE.** `spentTodayUsd` is the sum of the WORST-CASE ESTIMATES the gate
  // reserved before each call — **not what was billed.** No settlement to actual usage happens anywhere, so the
  // figure is an upper bound that only ever over-states, and by an amount nobody has measured.
  //
  // **A NUMBER WITH AN UNSTATED BASIS GETS READ AS THE OBVIOUS THING.** An operator seeing `$12.40 of $50` concludes
  // twelve dollars were spent; **what is true is that no more than that could have been.** The two readings differ in
  // the direction that makes someone stop worrying too early — and this is the field a person checks when deciding
  // whether to keep going.
  //
  // **THE CEILING IS PRINTED RATHER THAN REMOVED.** Settling against billed usage needs a per-turn record and a
  // provider-side reconciliation, neither of which exists; **the honest change is to say what the number is**, in the
  // same shape as `PERSUASION_UNMEASURED`.
  return {
    known: true,
    spentTodayUsd: Number(spend.spentTodayUsd),
    capUsd: Number(spend.capUsd),
    day: spend.day,
    basis: 'reserved-worst-case',
    settles: false,
  }
}

export function mindsPayloadOf(input: {
  minds: readonly string[]
  labels?: Readonly<Record<string, string>> | undefined
  homeSession?: string | undefined
  coreExists?: boolean | null | undefined
  spend?: { spentTodayUsd?: number | undefined; capUsd?: number | undefined; day?: string | undefined } | null | undefined
  waiting?: readonly WaitingLane[] | null | undefined
}): MindsPayload {
  const core = coreFactOf(input.coreExists)
  const spend = spendFactOf(input.spend)
  const home = typeof input.homeSession === 'string' && input.homeSession !== '' ? input.homeSession : undefined
  const waiting = Array.isArray(input.waiting)
    ? input.waiting
      .filter(lane => lane !== null && typeof lane === 'object'
        && typeof lane.lane === 'string' && lane.lane.trim() !== ''
        && typeof lane.sessionId === 'string' && lane.sessionId !== ''
        && Array.isArray(lane.events))
      .map(lane => ({
        lane: lane.lane.trim(),
        sessionId: lane.sessionId,
        // A malformed event is DROPPED rather than repaired: an event this module cannot read is not evidence that
        // nothing is open, and inventing a kind or a time is how a badge ends up lying in either direction.
        events: lane.events.filter((raw: unknown) => {
          // **THE PARAMETER IS ANNOTATED BECAUSE `lane.events` IS `any[]`.** Under `noImplicitAny` an untyped
          // callback over an `any` array is an error, and the widening is deliberate: the row arrives from a
          // projection read, so this module cannot trust its element type and must narrow it itself.
          //
          // **THIS FIX WAS REVERTED ONCE AND THIS IS WHY IT IS WRITTEN INTO THE WORKING COPY TOO.** It was first
          // applied INDEX-ONLY so a paused lane's uncommitted work was not written to — correct at the time, and
          // then their next commit, made from a working copy that still held the old line, silently restored it.
          // **`git apply --cached` protects their work only until they commit it.**
          if (raw === null || typeof raw !== 'object') return false
          const event = raw as { kind?: unknown; id?: unknown; at?: unknown }
          return (event.kind === 'asked' || event.kind === 'answered')
            && typeof event.id === 'string' && event.id !== ''
            && (event.at === null || (typeof event.at === 'number' && Number.isFinite(event.at)))
        }),
      }))
    : null
  return {
    minds: [...input.minds],
    ...(input.labels === undefined ? {} : { labels: input.labels }),
    ...(home === undefined ? {} : { homeSession: home }),
    core,
    spend,
    // ABSENT, NEVER EMPTY, when the host could not read the lanes: an empty array would say "no lane is waiting".
    ...(waiting === null ? {} : { waiting }),
  }
}

/**
 * A FACT THE HOST COULD NOT DETERMINE, WHICH IS NEVER A VALUE.
 *
 * `{ known: false }` carries nothing — no `exists`, no `resolvable`, no `session` — because a payload that answers
 * `false` where it could not look is a payload that lies in the direction of good news, and a reader downstream
 * cannot tell the difference after the fact. Every field below that can fail to resolve uses this shape.
 */
export type UnknownFact = { readonly known: false }

/** Whether a hand is resolvable from this host. */
export type HandFact = { readonly known: true; readonly resolvable: boolean } | UnknownFact

/** The home thread and whether it is live. */
export type HomeFact =
  | { readonly known: true; readonly session: string; readonly live: boolean }
  | UnknownFact

/** One lane, as her next turn would carry it. */
export interface LaneStatusFact {
  readonly lane: string
  readonly title: string
  readonly running: boolean
  /** THE FIRST LINE ONLY, redacted. Null when the lane has no goal — never the string "[object Object]". */
  readonly goal: string | null
  /** The oldest unanswered approval, if the lane is blocked on the owner. */
  readonly waitingOnOwner?: { readonly summary: string; readonly ageMs: number | null }
}

/**
 * The last wake decision, if one was made.
 *
 * **`untrusted` AND `sent` ARE STRUCTURAL, NOT MEASURED, AND THAT IS WHY THEY ARE SAFE TO STATE.** A wake is
 * started by a LANE'S OWN WORDS rather than by the owner, so it is tainted by construction; and the wake path can
 * only QUEUE a draft, so it cannot have sent anything. Checklist item 5 checks both, and a route built to serve
 * item 5 that omitted them made the item fail against a perfectly healthy app — which is how this was found.
 */
export interface WakeStatusFact {
  readonly wake: boolean
  readonly refused: string | null
  readonly untrusted: true
  readonly sent: false
  /**
   * **WHEN THE LAST WAKE DECISION WAS TAKEN, AND WHICH LANE CAUSED IT.**
   *
   * `wake` alone says a decision happened; it does not say whether it happened a second ago or last night, and a
   * reader cannot tell a wake that is working from one that has not fired since the process started. **A time is
   * what makes `wake: true` mean something now rather than at some point.**
   */
  readonly at: number | null
  /** The lane whose completion caused the decision, or null when none has been taken. */
  readonly lane: string | null
  /**
   * **WHERE THE WAKE WAS QUEUED, WHICH IS HER HOME SESSION AND NOT CORE'S.**
   *
   * Printed because the two are easy to confuse and the difference is the whole point: CORE drafts, and **she reads
   * her home**. A wake that reached only CORE would show `wake: true` here and still never arrive where Peter is.
   */
  readonly target: string | null
  /**
   * **WHETHER THE QUEUE ACTUALLY ACCEPTED IT.** `wake: true` means the decision was to wake; this says whether the
   * prompt landed. **A refusal and a failure look identical without it**, and a wake that silently failed is the
   * one an operator most needs to see.
   */
  readonly delivered: boolean
}

/** What `/api/auma-live/status` sends, as far as this module decides it. */
export interface StatusPayload {
  readonly home: HomeFact
  readonly lanes: readonly LaneStatusFact[]
  readonly core: CoreFact
  readonly hands: Readonly<Record<string, HandFact>>
  readonly spend: SpendFact
  readonly wake: WakeStatusFact | null
  /**
   * **WHAT THIS PAYLOAD DOES NOT ESTABLISH, NAMED ON EVERY RESPONSE.**
   *
   * A ceiling that is not printed is a ceiling a reader has to remember. These travel with the facts rather than
   * living in a document beside them, because the reader of this payload is deciding what she can be trusted with.
   */
  readonly ceilings: readonly string[]
}

/** The secret shapes that must never reach a status payload, matched as whole tokens. */
// TYPED AS TUPLES, because an inferred `(RegExp | string)[][]` makes `line.replace(pattern, …)` unresolvable.
const SECRETS: ReadonlyArray<readonly [RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, '[redacted:key]'],
  [/\b(?:sk|pk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/gu, '[redacted:token]'],
  [/\b(?:token|secret|password|passwd|api[-_]?key|cookie|bearer)\b\s*[:=]\s*\S+/giu, '[redacted:secret]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/gu, '[redacted:jwt]'],
]

/**
 * THE FIRST LINE OF A PIECE OF TEXT, REDACTED, OR NULL.
 *
 * **THIS MODULE OWNS THE SAFETY OF WHAT IT EMITS RATHER THAN TRUSTING ITS CALLER.** `status-facts.ts` imports
 * nothing — deliberately, so a keyless court can load it — which means it cannot reuse the lens's redactor, so it
 * carries its own. A route that returned a goal verbatim would put whatever a lane wrote into the status strip, and
 * a goal is written by a model from a lane's own context.
 *
 * @param text - the raw text, of unknown type.
 * @returns the first line, redacted and bounded, or null when there is nothing to say.
 */
export function safeFirstLine(text: unknown): string | null {
  if (typeof text !== 'string') return null
  let line = text.split('\n')[0] ?? ''
  for (const [pattern, replacement] of SECRETS) line = line.replace(pattern, replacement)
  line = line.replace(/\s+/gu, ' ').trim()
  if (line === '' || line === '[object Object]') return null
  return line.length > 160 ? `${line.slice(0, 159)}…` : line
}

/** A boolean the host could determine, or the unknown fact. */
function booleanFact(value: unknown): { readonly known: true; readonly resolvable: boolean } | UnknownFact {
  return typeof value === 'boolean' ? { known: true, resolvable: value } : { known: false }
}

/**
 * The status payload: what her next turn would carry, from facts the host already holds.
 *
 * **EVERY UNKNOWN IS RETURNED AS UNKNOWN.** A lane whose title is missing is DROPPED rather than shown blank; a
 * hand the host cannot resolve is `{known: false}` rather than `false`; a home that was never configured is unknown
 * rather than an empty string. The court drives each of those with a raw unknown and requires the unknown back.
 *
 * @param input - the raw facts, each of which may be absent.
 * @returns the payload, with no secrets and no message text.
 */
export function statusPayloadOf(input: {
  homeSession?: unknown
  homeLive?: unknown
  lanes?: unknown
  coreExists?: boolean | null | undefined
  hands?: Readonly<Record<string, unknown>> | undefined
  spend?: { spentTodayUsd?: number | undefined; capUsd?: number | undefined; day?: string | undefined } | null | undefined
  // **THE INPUT SIDE HAS TO DECLARE THEM TOO.** The passthrough below reads `at`, `lane`, `target` and `delivered`
  // and this type listed only `wake` and `refused` — so the payload could never carry what the interface promised,
  // and `tsc` refused the build. **A field added to the OUTPUT interface is half a field until the INPUT admits it
  // exists**, which is the same lesson as the passthrough itself, one layer further out.
  wake?: {
    wake?: unknown
    refused?: unknown
    at?: unknown
    lane?: unknown
    target?: unknown
    delivered?: unknown
  } | null | undefined
}): StatusPayload {
  // ── THE LANES. A row without a name or a title is NOT a lane and is dropped, not blanked. ──────────────
  const lanes: LaneStatusFact[] = []
  for (const raw of Array.isArray(input.lanes) ? input.lanes : []) {
    const row = raw as { lane?: unknown; title?: unknown; running?: unknown; goal?: unknown; waitingOnOwner?: unknown } | null
    if (row === null || typeof row !== 'object') continue
    const lane = typeof row.lane === 'string' && row.lane !== '' ? row.lane : null
    const title = typeof row.title === 'string' && row.title !== '' ? row.title : null
    if (lane === null || title === null) continue
    const waiting = row.waitingOnOwner as { summary?: unknown; at?: unknown } | undefined
    const summary = safeFirstLine(waiting?.summary)
    lanes.push({
      lane,
      title,
      running: row.running === true,
      goal: safeFirstLine(row.goal),
      ...(summary === null ? {} : {
        waitingOnOwner: {
          summary,
          ageMs: typeof waiting?.at === 'number' ? Math.max(0, Date.now() - waiting.at) : null,
        },
      }),
    })
  }
  // ── THE HOME. ─────────────────────────────────────────────────────────────────────────────────────────
  const session = typeof input.homeSession === 'string' && input.homeSession !== '' ? input.homeSession : null
  const home: HomeFact = session === null
    ? { known: false }
    : { known: true, session, live: input.homeLive === true }
  // ── THE HANDS. A hand named but not resolvable is a DIFFERENT fact from one never named. ──────────────
  const hands: Record<string, HandFact> = {}
  for (const [name, value] of Object.entries(input.hands ?? {})) hands[name] = booleanFact(value)
  // ── THE WAKE. Absent is null; present but unnamed is a refusal with no name, not a wake. ──────────────
  const wake = input.wake === null || input.wake === undefined
    ? null
    : {
      wake: input.wake.wake === true,
      refused: typeof input.wake.refused === 'string' ? input.wake.refused : null,
      untrusted: true as const,
      sent: false as const,
      // **PASSED THROUGH RATHER THAN RE-DERIVED, WHICH IS WHERE THEY WOULD HAVE BEEN LOST.** The builder
      // reconstructs this fact field by field, so a new field on the interface reaches the ROUTE only if it is
      // named here — and a dropped field is invisible: the payload simply does not mention it, and a reader cannot
      // tell "not applicable" from "not wired".
      at: typeof input.wake.at === 'number' && Number.isFinite(input.wake.at) ? input.wake.at : null,
      lane: typeof input.wake.lane === 'string' && input.wake.lane !== '' ? input.wake.lane : null,
      target: typeof input.wake.target === 'string' && input.wake.target !== '' ? input.wake.target : null,
      delivered: input.wake.delivered === true,
    }
  // **PERSUASION_UNMEASURED: THE PERSONA WORDING STAYS, AND THIS IS THE DISCLOSURE INSTEAD OF A REWRITE.** Peter's
  // decision is that the persona text remains as written. **Nothing in this system measures whether a sentence
  // persuades** — there is no court for it, no corpus, and no rate — so a reader who meets the wording through this
  // payload is told here that its effect is unmeasured rather than being left to infer that it was checked and
  // passed. **The ceiling is on EVERY response**, because a disclosure that appears only when someone asks is not a
  // disclosure.
  const ceilings = ['PERSUASION_UNMEASURED'] as const
  return { home, lanes, core: coreFactOf(input.coreExists), hands, spend: spendFactOf(input.spend), wake, ceilings }
}
