// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { providerSetupOf, type readOwnerPolicy } from './disclosure.ts'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SessionId, type SessionEvent, type SessionStore } from '@deepseek-ai/dsh-session'
import { presenceEngineDependencies } from './presence-deps.ts'
import type { SpendGate } from './spend-gate.ts'
import type { KiraLens } from './kira-lens.ts'
import type { CoreLens } from './core-lens.ts'
import { replayableTurns } from './machine-frame.ts'
import {
  isLegacyModelRequest, readNewestModelRequest, readRecordedModelRequest, recordOrRefuse, type ModelRequestReceipt, type LegacyEventLike,
} from './model-request-store.ts'
import { replyIdOf } from './reply-manifest.ts'
import { priorTurnsFromLive } from './carry-over.ts'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { CrossLaneMemory } from './cross-lane.ts'
import { resolvePresenceSession, type HomeResume } from './home-session.ts'
import { mindsPayloadOf, statusPayloadOf, waitingLanesOfSessions } from '../status-facts.ts'
import {
  PRESENCE_MINDS,
  PresenceEngine,
  writeTurnFault,
  type PresenceMind,
  type PresenceRequest,
  type PresenceRingMessage,
  type VoiceAuthorization,
} from './presence.ts'
import type { RepoLens } from './repo-lens.ts'
import type { RecallLens } from './recall-lens.ts'
import type { WebLens } from './web-lens.ts'
import type { WeightsControl } from './weights-control.ts'

/** Operations required by the Auma Live HTTP routes. */
export interface AumaLiveHttpDependencies {
  /**
   * How often the stream writes an SSE comment while a segment is held.
   *
   * **INJECTABLE SO THE ARM CAN HOLD BRIEFLY.** The preflight's arm is a stub provider that holds for twenty
   * seconds and must still produce a data event within ten; testing that against the real interval would take ten
   * real seconds on every run. **A timing protection nobody can afford to test is a timing protection nobody
   * tests**, so the interval is a fact the caller supplies and the court passes a short one.
   *
   * **THE DEFAULT IS HALF THE HOLD THE ARM USES.** It is deliberately shorter than any plausible idle timeout and
   * longer than a healthy first token.
   */
  readonly heartbeatIntervalMs?: number | undefined
  /** Target credential provider. */
  credentials: CredentialProvider
  /** Credential reference used by the bundled OpenRouter minds; extra minds retain their own references. */
  apiKeyEnv: string
  /** Maximum accepted JSON body bytes. */
  maxRequestBodyBytes: number
  /** Shared chat/live history. */
  crossLane: CrossLaneMemory
  /** Target session store used to READ prior turns; Auma live never writes an event into it. */
  sessions: SessionStore
  /**
   * The DSH home her OWN store lives under, `<home>/auma-live/<sessionId>.jsonl`.
   *
   * **REQUIRED FOR THE DEFECT TO STAY FIXED.** Her model requests used to be appended to whichever LANE session
   * she was bound to, under a type the harness does not know — and `session-persistence/src/storage-contract.ts:75`
   * refuses to load a log containing one, so **any backend restart made that thread unloadable.** ALPHA, KIRA,
   * AURA, AUMLOK and one other all broke. With no home configured her requests are simply not persisted; what
   * they are never again is written into somebody else's log.
   */
  modelRequestHome?: string
  /** Report a blocked request-recording failure without exposing it to the browser. */
  reportRecordFailure?: (error: unknown) => void
  /** Read-only repository lens for the presence mind; absent disables repo sight. */
  repoLens?: RepoLens
  /** Model-directed lens lookups allowed per spoken turn. */
  repoLensLookups?: number
  /** Additional selectable minds merged over the bundled minds, including their authentication settings. */
  extraMinds?: Readonly<Record<string, PresenceMind>>
  /** Read-only internet lens for the presence mind; absent disables web sight. */
  webLens?: WebLens
  /** Model-directed web searches allowed per spoken turn. */
  webLensLookups?: number
  /**
   * **HER HOME SESSION, AND WHY IT IS CONFIG RATHER THAN A TITLE LOOKUP.**
   *
   * A fresh app start has no persisted selection, and the page used to refuse the turn and tell Peter to go and
   * choose a thread. Resolving a session *by title* would need a host session-list API whose exact semantics I
   * have not verified; `homeSession` in `auma-live.patch.yml` is deterministic and already reaches this face through
   * the deployment's own config channel. The page asks for it on the minds route AT MOUNT (it used to ask only when
   * the gear opened), and `presence` answers through it — resumed on demand — whenever the named session is not
   * live. **Chosen for reliability, which is what the owner asked for.**
   */
  homeSession?: string
  /**
   * WHETHER THIS HOST'S CORE CONDUCTOR SESSION EXISTS, for the panel's status strip. `null` (or absent) means the
   * host could not determine it, and the strip renders that as unknown rather than as an absent conductor.
   */
  coreExists?: (() => boolean | null) | undefined
  /**
   * TODAY'S SPEND AND THE CAP, for the same strip — read from the spend gate that lives in `index.ts`. Absent
   * leaves the fact unknown, never zero.
   */
  spendToday?: (() => { spentTodayUsd: number; capUsd: number; day: string } | null) | undefined
  /**
   * What her next turn would carry, read from facts the host already holds.
   *
   * A THUNK, LIKE `spendToday`, because every one of these facts can change between two requests and a value
   * captured at mount would answer from a stale world. It returns RAW facts — this face does not decide the
   * payload's shape, `status-facts.ts` does, so the rules are measurable without loading this module.
   */
  statusFacts?: (() => {
    homeSession?: unknown
    homeLive?: unknown
    lanes?: unknown
    hands?: Readonly<Record<string, unknown>> | undefined
    // TYPED, NOT `unknown`: `statusPayloadOf` takes a shaped wake, and `unknown` is not assignable to it — which
    // the build refused rather than a cast silencing.
    wake?: { wake?: unknown; refused?: unknown } | null | undefined
  }) | undefined
  /**
   * **THE HOST'S OWN RESUME PATH, FOR THE HOME AND NOTHING ELSE.** `index.ts` supplies the session controller's
   * `resolveAgent` — the same `resolve` a client opening a thread reaches — so a home not opened since boot is
   * resumed on demand instead of answering 409. `home-session.ts` only ever passes it the configured home.
   */
  resumeSession?: (sessionId: SessionId) => Promise<HomeResume>
  /** The conductor, and its limits. Forwarded to the engine; see `presence-deps.ts`. */
  coreLens?: CoreLens
  /**
   * Whether a conductor is CONFIGURED, which is not the same as a lens being supplied.
   *
   * `index.ts` always constructs a `CoreLens`, with an empty session id when the deployment sets no
   * `coreSessionId` — so `coreLens !== undefined` is true where there is no CORE to hand anything to. The honesty
   * rails turn on this, because telling her she can hand work to CORE when there is no CORE is a false sentence
   * about herself, which is the class of sentence the rails exist to prevent.
   */
  coreSessionConfigured?: boolean
  coreTasksPerTurn?: number
  coreDailyCap?: number
  sessionController?: { prompt: (request: unknown, signal: AbortSignal) => Promise<unknown> }
  coreEvents?: () => readonly { readonly type?: unknown; readonly data?: unknown }[]
  /**
   * **DECLARED HERE BECAUSE THE WIRING PASSES IT HERE.** `PresenceDependencies` carries this too, and the object
   * `index.ts` builds is an `AumaLiveHttpDependencies` that `presenceEngineDependencies` forwards on to the engine —
   * **so a field present on the engine's interface and absent from this one is a field the wiring cannot pass**, which
   * is exactly the `TS2353` the build reported: *"Object literal may only specify known properties, and
   * 'turnFinished' does not exist."*
   *
   * **THE SAME SHAPE AS THE OMISSIONS THIS GOAL HAS ALREADY PAID FOR** — a dependency declared at one layer and
   * needed at two, like the four `done` sites and the `FORWARDED` list. See `presence.ts` for what it means.
   */
  turnFinished?: (turn: {
    readonly sessionId: string
    readonly ownerText: string
    readonly text: string
    readonly startedAt: number
    readonly record: ModelRequestReceipt
    /**
     * **EVERY LENS ANSWER THIS TURN RECEIVED, WITH THE FRAME IT WAS SHOWN UNDER AND — WHERE A LENS ANSWERED — A DIGEST
     * OVER ITS TEXT.** The reply manifest is built from this: what she was shown, and the digest that makes the view
     * evidence rather than a description.
     *
     * **THIS IS THE SECOND OF THE TWO `turnFinished` PAYLOAD TYPES.** `presence.ts:373` declares the one the ENGINE
     * calls; this is the one the WIRING implements. **They must agree, and neither the compiler nor a court sees the
     * disagreement until the call site refuses.**
     *
     * **`LensAnswer` IS STRUCTURALLY IDENTICAL IN BOTH FILES RATHER THAN IMPORTED.** `presence.ts` declares it
     * privately; importing it here would be a cycle, and exporting it from `presence.ts` would put a private engine
     * detail into a public contract. **Two small structural types that must agree is a smaller cost than either**, and
     * the compiler enforces the agreement at the assignment in `index.ts`.
     */
    readonly lensAnswers: readonly {
      readonly frame: 'REPO LENS' | 'WEB LENS' | 'RECALL' | 'WEIGHTS'
      readonly result: { readonly request: string; readonly text: string; readonly sha256?: string }
    }[]
    /**
     * **THE THIRD FIELD THIS DECLARATION MUST MIRROR, AND ITS OWN COMMENT ABOVE SAYS WHY:** *"A change to one and not the
     * other refuses at the call site — which is how the mistake was found."* **Structural rather than imported, because
     * importing `presence.ts` here would be a cycle.**
     */
    readonly memoryInjected: readonly { readonly handle: string; readonly tier: 'remembered' | 'signed'; readonly id?: string }[]
  }) => void
  /** Read-only conversation lookup for the presence mind; absent disables recall. */
  recall?: RecallLens
  /** Model-directed conversation lookups allowed per spoken turn. */
  recallLookups?: number
  /** Control over the weights serving this lane; absent leaves the voice unable to change itself. */
  weights?: WeightsControl
  /** Weight verbs allowed per spoken turn. */
  weightsVerbs?: number
  /**
   * Resolve the durable session backend at call time; the presence lane must
   * load on a Host that mounts none. Absent keeps spoken memory within one
   * Session.
   */
  /**
   * **THE TITLE A LANE'S SESSION SHOWS, WHEN ONE CAN BE RESOLVED.**
   *
   * `c5a4ffe75` reads this through `?.` and never declared it, so `apps` failed to compile. **The optional chain is
   * the interface's own statement that a Host may not supply one** — the panel says *unknown* rather than *calm* when
   * it cannot be read, which is the honest direction for a field whose absence is meaningful.
   */
  sessionTitle?: ((sessionId: import('@deepseek-ai/dsh-session/types').SessionId) => string | undefined) | undefined
  resolveSessionPersistence?: () => SessionPersistence | undefined
  /** Prior sessions searched, newest first, to seed a fresh Session's spoken memory. */
  spokenMemoryReach?: number
  /** Ordered mind keys the selector offers; absent offers every constructed mind. */
  offeredMinds?: readonly string[]
  /** Selector button text overrides, keyed by mind. */
  mindLabels?: Readonly<Record<string, string>>
  /**
   * THE ORGANISM LENS, AND THE REASON IT IS DECLARED HERE. `presence.ts` reads it every turn, `index.ts`
   * supplies it, and this interface did not carry it — so the constructor's hand-written spreads dropped it and
   * **Auma had never seen the organism.** A field the caller supplies must be declared, or the type system
   * cannot notice when it is silently discarded.
   */
  organismLens?: () => Promise<string>
  /** **THE SECOND DECLARATION OF THE SAME SEAM** — see `presence.ts`; both must name it or the wiring refuses at the call site. */
  organismStateLens?: () => Promise<string>
  /**
   * **THE DISCLOSURE CHECKPOINT'S INPUTS, FORWARDED TO THE ENGINE.** Declared here and listed in `presence-deps.ts`; before they
   * were, `index.ts` built a policy reader that this class dropped, so the engine saw no policy and refused every turn
   * ("no-policy") even with a valid file on disk.
   */
  disclosurePolicy?: () => ReturnType<typeof readOwnerPolicy>
  /** Only explicit true permits presence provider requests. Absent or false keeps the turn local. */
  providerSendConsent?: boolean
  disclosureRecipient?: string
  onDisclosure?: (disclosure: unknown) => void
  onDisclosureRefused?: (why: string, dataClass: string) => void
  /** The claims packet, read per turn like the organism lens and dropped by the same missing spread. */
  claimsPacket?: () => Promise<string>
  /** The money gate the engine consults before every provider call. */
  spendGate?: SpendGate
  /** Her own memory through Kira's read-only door; the lens resolves the service on every call. */
  kiraLens?: KiraLens
  /** Memory lookups allowed per spoken turn; Peter's direction is at most one. */
  kiraLookups?: number
}

/**
 * Machine-supplied lens frames, which are data rather than anything anyone
 * said. Restoring one as a spoken turn would put repository bytes — or
 * untrusted remote text — into the owner's mouth.
 */
// **THE HAND-WRITTEN GUARD WAS HERE, AND IT HAD DRIFTED FROM THE FRAMES.** It matched `REPO LENS` and
// `RECALL`, and MISSED `SCREEN CONTEXT`, `WORKING FOCUS` and `ATTACHED FILE` — so a page snapshot, a
// working-focus list and the contents of an attached file were replayed as PETER'S OWN WORDS every time a
// conversation was carried. The list and the regex now live in `machine-frame.ts` together, and a court compares
// them against every frame literal in the repository.

/** Auma Live exact-route handlers and their shared presence state. */

/**
 * Read one stored session's events without joining it live.
 * @param persistence - the mounted session store.
 * @param id - the session to read.
 * @returns that session's events in order.
 */
async function coldEvents(
  persistence: SessionPersistence,
  id: SessionId,
): Promise<readonly SessionEvent[]> {
  const handle = await persistence.open(id, 'read')
  try {
    const { events } = await handle.read(0, undefined)
    return events
  } finally {
    await handle.close()
  }
}

export class AumaLiveHttp {
  private readonly voiceSessions = new Map<string, {
    sessionId: string
    expiresAt: number
    active: Set<AbortController>
  }>()
  private readonly engine: PresenceEngine
  private readonly minds: Readonly<Record<string, PresenceMind>>
  private readonly restoreSuffixes: readonly string[]

  /** @param dependencies - Credential, body-limit, and cross-lane operations. */
  constructor(private readonly dependencies: AumaLiveHttpDependencies) {
    const constructed: Readonly<Record<string, PresenceMind>> = {
      ...Object.fromEntries(Object.entries(PRESENCE_MINDS).map(([key, mind]) => [
        key, { ...mind, apiKeyEnv: dependencies.apiKeyEnv },
      ])),
      ...dependencies.extraMinds,
    }
    // Offering is enforced where dispatch decides: the engine's mind table IS
    // the offered subset, so a hidden mind cannot be requested by hand either.
    const offered = dependencies.offeredMinds
    if (offered !== undefined) {
      for (const key of offered) {
        if (!(key in constructed)) throw new Error(`ui-stock-apps: offeredMinds names a mind this Host does not construct: ${key}`)
      }
      this.minds = Object.fromEntries(offered.map(key => [key, constructed[key] as PresenceMind]))
    } else {
      this.minds = constructed
    }
    // Restores strip every constructed mind's transport suffix: a mind hidden
    // today may have recorded suffixed turns while it was offered.
    this.restoreSuffixes = Object.values(constructed)
      .map(mind => mind.turnSuffix)
      .filter((suffix): suffix is string => suffix !== undefined && suffix.length > 0)
    this.engine = new PresenceEngine(dependencies.crossLane, presenceEngineDependencies(dependencies, {
      // **THE TWO THE FIRST VERSION OF THIS SEAM SILENTLY DROPPED.** `resolveApiKey` is how a mind authenticates
      // and `restoreRing` is how a fresh thread receives its prior turns; both used to be written inline here,
      // and replacing the inline spreads with the seam lost them. The type system caught it only AFTER a syntax
      // error elsewhere in this file stopped masking the remaining diagnostics — the two defects hid each other.
      resolveApiKey: async (apiKeyEnv: string) =>
        (await dependencies.credentials.resolve(credentialRef(apiKeyEnv)))?.value,
      restoreRing: (sessionId: SessionId) => this.restoreRing(sessionId),
      minds: this.minds,
      // **THE CLAIM READS THE RESULT, NOT THE CONFIG.** It used to be true whenever a persistence resolver
      // existed and `spokenMemoryReach > 0` — so the prompt promised "a fresh conversation opens holding the
      // spoken turns of the most recent one" on every new thread, INCLUDING the ones where the carry-over
      // failed or found nothing. A sentence about what happened is printed because it happened.
      carriesPriorConversations: () => this.carriedTurns > 0,
      // The seam returns an indexable object; the engine wants its own interface. Every declared field IS
      // forwarded (the court asserts that as a set), so the assertion is about the type system's inability to
      // see through a mapped construction, not about a missing dependency.
    }) as unknown as ConstructorParameters<typeof PresenceEngine>[1])
  }

  /**
   * Serve the recent target-harness typed dialogue used by the browser bridge.
   * @param req - Local browser request.
   * @param res - Response receiving a bounded JSON snapshot.
   */
  /**
   * **A DEGRADATION THE FIELD REPORTS, SO THE RECORD EXISTS.** The renderer drops to 2D, or steps its scale
   * down, and until now nothing outside the browser knew — which is why "the aurora fell to the dot grid" was a
   * report with no record behind it. **A LIMIT THAT DOES NOT PRINT DID NOT HAPPEN.** The handler is deliberately
   * small and always answers 204: a reporting endpoint must never be able to break the field it reports on.
   */
  fieldDegraded(req: IncomingMessage, res: ServerResponse): void {
    if (!isTrustedLocalRequest(req)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    let body = ''
    req.on('data', (chunk: Buffer) => {
      // A cap, because this endpoint is reachable from the page and an unbounded body is a way to grow the
      // process. A report longer than this is not a report.
      if (body.length < 4096) body += chunk.toString('utf8')
    })
    req.on('end', () => {
      try {
        const event = JSON.parse(body) as { reason?: unknown, scale?: unknown, session?: unknown }
        const reason = typeof event.reason === 'string' ? event.reason.slice(0, 120) : 'unspecified'
        const scale = typeof event.scale === 'number' ? event.scale : null
        const session = typeof event.session === 'string' ? event.session.slice(0, 64) : ''
        this.dependencies.reportRecordFailure?.(new Error(
          `auma-live field-degraded: reason=${reason} scale=${String(scale)} session=${session}`,
        ))
      } catch { /* a malformed report is dropped; the field already moved on */ }
      res.writeHead(204)
      res.end()
    })
  }

  recentChat(req: IncomingMessage, res: ServerResponse): void {
    if (!isTrustedLocalRequest(req)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    const sessionId = recentChatSessionId(req)
    if (sessionId === undefined) {
      res.writeHead(400)
      res.end('selected session is required')
      return
    }
    const session = this.dependencies.sessions.get(sessionId)
    if (session === undefined) {
      res.writeHead(409)
      res.end('selected session is not live')
      return
    }
    this.dependencies.crossLane.synchronizeChat(session.id, session.snapshotEvents())
    const body = JSON.stringify({ turns: this.dependencies.crossLane.recentChatTurns(session.id) })
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  /**
   * Rebuild one Session's spoken history from its durable log.
   *
   * Every dispatch records its complete message list, and the ring is carried
   * inside that list, so the newest recorded request holds the conversation as
   * it stood when that turn was sent. Reading it back is exact and needs no
   * second record. The system message and the machine-supplied lens frames are
   * dropped: the first is rebuilt per turn, the second is data rather than
   * anything anyone said. Her reply to the final recorded turn was never sent
   * to a provider, so it is the one thing a restart still loses.
   *
   * A Session whose own log holds no dispatch — a fresh conversation — reads
   * the newest prior session's dispatch from the durable backend instead, so
   * opening a new conversation keeps what the last one heard. A failed durable
   * read degrades to an empty memory, never a failed turn.
   * @param sessionId - Session whose spoken history is wanted.
   * @returns Remembered turns, oldest first; empty when no log holds any.
   */
  /**
   * Carry-over failures, kept rather than discarded. **AN EMPTY ANSWER AND A FAILED READ ARE DIFFERENT FACTS**,
   * and the old `catch {}` collapsed them — which is why "she does not remember" had no diagnosable cause.
   */
  private readonly carryOverErrors: string[] = []
  /** How many turns the LAST carry-over attempt actually brought across. The prompt's claim reads this. */
  private carriedTurns = 0

  private reportCarryOverError(message: string): void {
    this.carryOverErrors.push(message)
    // A backend log line, not a browser one: this is an operator's question, and the owner is not served by
    // seeing his session directory in a chat window.
    console.warn(`auma-live carry-over: ${message}`)
  }

  /** The carry-over failures seen so far, for an operator asking why she does not remember. */
  carryOverFailureReport(): readonly string[] {
    return [...this.carryOverErrors]
  }

  private async restoreRing(sessionId: PresenceRequest['sessionId']): Promise<readonly PresenceRingMessage[]> {
    const session = this.dependencies.sessions.get(sessionId)
    if (session !== undefined) {
      const own = this.newestDispatch(session.snapshotEvents(), sessionId)
      if (own !== undefined) return own.ring
    }
    return await this.ringFromPriorSession(sessionId)
  }

  /**
   * Spoken history held by one event log: the newest recorded dispatch's
   * message list, machine frames and transport suffixes stripped, stamped with
   * that dispatch's recorded time. Dispatch payloads cross the durable file
   * boundary, so a payload another build or a damaged log left malformed is
   * skipped in favor of the next-newest rather than trusted.
   *
   * **HER OWN STORE IS READ FIRST, AND THE LEGACY EVENTS SECOND.** The events are only consulted for threads
   * written before the fix — the ones repaired by hand, whose records are marked ignorable. They are read-only
   * here and are never written again, because writing one is what made a lane thread unloadable.
   *
   * @param events - One Session's contiguous event log.
   * @param sessionId - The session those events belong to, so her store can be consulted first.
   * @returns The newest restorable dispatch, or undefined when none exists.
   */
  private newestDispatch(
    events: readonly SessionEvent[],
    sessionId?: PresenceRequest['sessionId'],
  ): { ring: readonly PresenceRingMessage[]; spokenAt: number } | undefined {
    // ① HER OWN FILE. A request recorded after the fix lives here and nowhere else.
    if (sessionId !== undefined) {
      const stored = readNewestModelRequest({
        dshHome: this.dependencies.modelRequestHome ?? '',
        sessionId,
      })
      if (stored !== undefined) {
        const ring = replayableTurns(stored.messages, this.restoreSuffixes)
        if (ring.length > 0) return { ring, spokenAt: stored.spokenAt }
      }
    }
    // ② THE LEGACY EVENTS, READ-ONLY. `isLegacyModelRequest` requires `ignorable: true` as well as the type:
    // reading an unmarked one would hide the very condition the harness refuses to load.
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      // `events[index]` is `SessionEvent | undefined` under `noUncheckedIndexedAccess`; the guard is what makes
      // the narrow real rather than assumed.
      if (event === undefined || !isLegacyModelRequest(event as unknown as LegacyEventLike)) continue
      const messages: unknown = (event.data as { body?: { messages?: unknown } } | undefined)?.body?.messages
      if (!Array.isArray(messages)) continue
      // A mind's chat-template directive (Qwen3's `/no_think`) is recorded
      // because the log must reproduce the exact request, but it is transport,
      // not something the owner said — restoring it would put it in his mouth.
      const suffixes = this.restoreSuffixes
      // **THE SAME FUNCTION THE COURT DRIVES.** `replayableTurns` holds the frame guard, the system drop and the
      // suffix strip; keeping the decision there means the court measures the code path the Host actually runs
      // rather than a copy of it written out again in a test.
      const ring = replayableTurns(messages, suffixes)
      if (ring.length === 0) continue
      return { ring, spokenAt: event.time }
    }
    return undefined
  }

  /**
   * Record one model request in HER OWN store, and never in a lane's session log.
   *
   * Recording completes durably before dispatch and returns that append's receipt. Failures refuse dispatch.
   *
   * **THE SESSION ID IS PASSED IN, NOT REMEMBERED.** A field holding "the session being served" would be wrong
   * the moment two turns overlap, and this is the one record that must name the right file.
   * @param sessionId - The session this turn belongs to.
   * @param request - The request about to be sent to the model.
   */
  private recordModelRequest(sessionId: PresenceRequest['sessionId'], request: unknown): ModelRequestReceipt {
    const dshHome = this.dependencies.modelRequestHome
    // **IT THROWS, AND THAT IS THE WHOLE POINT.** The engine awaits this before the provider call and treats a
    // rejection as "do not dispatch". Returning early with no home, or catching an append failure, meant the
    // callback ALWAYS resolved — so the engine dispatched every turn believing it had been recorded, and the
    // fail-closed boundary it advertises could not be exercised by its only implementation.
    try {
      return recordOrRefuse({ dshHome: typeof dshHome === 'string' ? dshHome : '', sessionId, request })
    } catch (error: unknown) {
      // Reported AND rethrown: reported so a person has an answer, rethrown so the turn does not reach the wire.
      this.dependencies.reportRecordFailure?.(error)
      throw error
    }
  }

  /**
   * The most recently spoken prior conversation's history, read from the
   * durable backend. The newest-created `spokenMemoryReach` non-subagent
   * candidates are all inspected and the dispatch recorded latest wins, so a
   * fork's seeded copy of an older conversation cannot outrank the
   * conversation it was copied from, and a long-lived session that spoke five
   * minutes ago beats a newer session that never spoke.
   * @param sessionId - The fresh Session, excluded from candidates.
   * @returns Remembered turns, oldest first; empty when nothing is reachable.
   */
  private async ringFromPriorSession(sessionId: PresenceRequest['sessionId']): Promise<readonly PresenceRingMessage[]> {
    const persistence = this.dependencies.resolveSessionPersistence?.()
    const reach = this.dependencies.spokenMemoryReach ?? 0
    // **A REACH OF ZERO MEANS DO NOT REACH, AND IT DID NOT MEAN THAT.** `reach` was read and then used only to bound
    // the DURABLE search — the live store was consulted first and unconditionally, so **a setting of 0 still carried
    // another conversation's turns into this one.** The setting is a privacy control; a control that governs one of
    // two sources is not the control it says it is.
    //
    // **IT RETURNS EMPTY RATHER THAN SKIPPING ONE SOURCE**, because "reach zero" is exactly "remember nothing from
    // another session", and a partial reach is not a smaller version of it — it is the same leak with a shorter
    // list.
    if (reach <= 0) return []
    // ① THE LIVE STORE FIRST. A conversation someone is having NOW is already in memory, costs nothing to
    // read, and cannot fail the way a filesystem read can — and the old path went straight to the durable
    // store, so a fresh thread got zero turns while the one it should have carried sat in this process.
    const live = priorTurnsFromLive<PresenceRingMessage>(
      this.dependencies.sessions.list(),
      sessionId,
      // **THE CANDIDATE'S ID, NOT THE NEW SESSION'S.** This passed `sessionId` — the session being created — so
      // `newestDispatch`'s own-file step read a store that cannot yet exist, and **live-first carry-over could only
      // ever reach the candidate's LEGACY events.** The candidate is the conversation being carried FROM; its id is
      // what its recorded file is filed under.
      // **THE BRAND IS RESTORED HERE BECAUSE THIS IS WHERE ITS PROVENANCE IS KNOWN.** `priorTurnsFromLive` is
      // generic and types the callback's id as `string`, but the value it passes is `String(session.id)` from a LIVE
      // session — **a `SessionId` that the generic signature erased, not a string that needs validating.** The cast
      // records that difference rather than hiding one.
      (events, candidateId) => this.newestDispatch(
        events as readonly SessionEvent[], candidateId as PresenceRequest['sessionId'])?.ring ?? [],
    )
    if (live.error !== null) this.reportCarryOverError(live.error)
    if (live.turns.length > 0) {
      this.carriedTurns = live.turns.length
      return live.turns
    }
    if (persistence === undefined || reach <= 0) return []
    let headers
    try {
      headers = await persistence.list()
    } catch (cause) {
      // **REPORTED RATHER THAN SWALLOWED.** The turn still answers — memory of prior conversations is not
      // worth failing a turn over — but a person asking "why does she not remember" now has an answer
      // somewhere instead of an empty list that means three different things.
      this.reportCarryOverError(`the prior-conversation list could not be read: ${String((cause as Error)?.message ?? cause)}`)
      return []
    }
    // Subagent children carry a seeded copy of their parent's log, which is a
    // machine fork of a conversation, never a conversation someone had.
    const candidates = headers
      .map(snapshot => snapshot.header)
      .filter(header => header.id !== sessionId && header.origin !== 'subagent')
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, reach)
    let best: { ring: readonly PresenceRingMessage[]; spokenAt: number } | undefined
    for (const header of candidates) {
      let events: readonly SessionEvent[]
      try {
        events = await coldEvents(persistence, header.id)
      } catch (cause) {
        // One damaged or vanished session log must not block reaching the next-newest conversation — but it is
        // NAMED, because a log that cannot be read and a conversation that never happened are different facts.
        this.reportCarryOverError(`the log of ${String(header.id)} could not be read: ${String((cause as Error)?.message ?? cause)}`)
        continue
      }
      // **`header.id`, BECAUSE THE STORE IS PER SESSION.** A prior conversation's turns are in ITS own file now,
      // and passing nothing here would silently skip the store for every carried conversation — leaving carry-over
      // reading only the legacy events, which is exactly the state that has no records after the fix.
      const found = this.newestDispatch(events, header.id)
      if (found !== undefined && (best === undefined || found.spokenAt > best.spokenAt)) best = found
    }
    this.carriedTurns = best?.ring.length ?? 0
    return best?.ring ?? []
  }

  /**
   * Serve the mind keys this Host actually offers, so the browser's selector
   * cannot present a mind the Host would reject.
   * @param req - Local browser request.
   * @param res - Response receiving the ordered key list.
   */
  availableMinds(req: IncomingMessage, res: ServerResponse): void {
    if (!isTrustedLocalRequest(req)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    const labels = this.dependencies.mindLabels
    const homeSession = this.dependencies.homeSession ?? ''
    // The home rides the minds response because the page already asks for that at load: one request, no new route
    // to register, and nothing to resolve at turn time. **TWO MORE FACTS RIDE IT FOR THE SAME REASON** — whether
    // the CORE conductor session exists and today's spend against the cap. Both live only in this process (the
    // spend gate is an instance created in `index.ts`, the CORE id is this plugin's config), and the panel's
    // read-only status strip needs them; a fact the host cannot determine is sent as `known: false` and carries no
    // value, because a strip that reads a failed lookup as `$0.00` tells Peter she has spent nothing.
    // **THE HOME IS RESUMED IN THE BACKGROUND WHEN THE PANEL ASKS AFTER HER.**
    //
    // `resolvePresenceSession` resumes her home on demand — **but only when a turn names it.** So a fresh start
    // answers "not live" on the settings panel until someone speaks, and **the one moment a person is asking whether
    // she is up is the moment the panel is open.** This is the route the page already requests at mount, so the
    // resume costs no new route and no new round trip.
    //
    // **THE CLOSE HANDLER IS REGISTERED BEFORE THE RESUME STARTS, AND THAT ORDER IS THE WHOLE PROTECTION.** If the
    // page is closed while the resume is in flight, a handler attached afterwards never fires — **so a resume that
    // failed would fail silently, on a request nobody was left to see.** Registering first means the outcome is
    // reported either way; `answered` is what keeps a failure after the client left from being swallowed by the
    // disconnect rather than by the failure.
    //
    // **AND IT IS NOT AWAITED.** The panel must render now; a resume that takes a second must not hold the strip
    // that says whether she is up. A failure is reported through the same channel every other record failure uses.
    this.resumeHomeInBackground(res, homeSession)
    let setupPolicy: ReturnType<typeof readOwnerPolicy> | undefined
    try { setupPolicy = this.dependencies.disclosurePolicy?.() } catch { /* An unreadable policy authorises nothing. */ }
    const body = JSON.stringify({ ...mindsPayloadOf({
      minds: Object.keys(this.minds),
      labels,
      homeSession,
      coreExists: this.dependencies.coreExists?.() ?? null,
      spend: this.dependencies.spendToday?.() ?? null,
      // **WHO IS WAITING ON PETER RIDES THE SAME RESPONSE, AND IT IS READ FROM THE SESSIONS' OWN LOGS.** The badge
      // exists because AK-UI sat sixteen hours on four unanswered approvals that never reached him: a waiting lane
      // looks idle from outside, so the one fact that matters has to travel with the payload the page already asks
      // for. Each lane carries `approval/asked`/`approval/decided` with the id the log pairs them by; a session
      // whose log cannot be read is SKIPPED rather than sent empty, so the panel says unknown instead of calm.
      waiting: waitingLanesOfSessions(
        this.dependencies.sessions.list().map(session => ({
          id: session.id,
          title: this.dependencies.sessionTitle?.(session.id) ?? session.id,
          events: session.snapshotEvents() as readonly { type?: unknown; data?: unknown; time?: unknown }[],
        })),
        { cap: 24 },
      ),
    }), providerSetup: providerSetupOf(this.dependencies.providerSendConsent, setupPolicy) })
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  /**
   * Serve what her next turn would carry, for the status strip and the acceptance runner.
   *
   * **READ-ONLY, AND BEHIND THE SAME DOOR AS `minds`** — the same `isTrustedLocalRequest` guard and the same
   * method check, because a fact that is safe to show the owner is not therefore safe to show a page that reached
   * this port from elsewhere. Nothing here writes, spawns or resolves a hand: an unresolvable hand is reported as
   * unresolvable rather than looked up on demand, so a status read cannot start a process.
   *
   * @param req - Local browser GET request.
   * @param res - JSON response.
   */
  aumaLiveStatus(req: IncomingMessage, res: ServerResponse): void {
    if (!isTrustedLocalRequest(req)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    const raw = this.dependencies.statusFacts?.() ?? {}
    const body = JSON.stringify(statusPayloadOf({
      ...raw,
      // The two facts this class already holds are filled here rather than asked for again, so the route and the
      // minds response can never disagree about them.
      coreExists: this.dependencies.coreExists?.() ?? null,
      spend: this.dependencies.spendToday?.() ?? null,
    }))
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  /**
   * Serve one abortable OpenRouter presence turn as SSE.
   * @param req - Local browser POST request.
   * @param res - Response kept open for the model stream.
   */
  async presence(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isTrustedLocalRequest(req)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      res.end()
      return
    }
    let input: PresenceRequest
    let body: Record<string, unknown>
    try {
      const parsed: unknown = await readJsonBody(req, this.dependencies.maxRequestBodyBytes)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RequestBodyError('invalid')
      body = parsed as Record<string, unknown>
      if (body['action'] === 'start-voice' || body['action'] === 'stop-voice') {
        await this.voiceSessionAction(body, res)
        return
      }
      input = parsePresenceRequest(body, this.minds)
    } catch (error) {
      const tooLarge = error instanceof RequestBodyError && error.message === 'too-large'
      res.writeHead(tooLarge ? 413 : 400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(tooLarge ? 'request body too large' : 'invalid presence request')
      return
    }
    // Refuse before resuming a session or preparing history; a fresh install needs no live session to show this state.
    const token = typeof body['voiceSessionToken'] === 'string' ? body['voiceSessionToken'] : ''
    const voiceSession = this.voiceSessions.get(token)
    const voiceAuthorized = voiceSession !== undefined && voiceSession.sessionId === input.sessionId
      && voiceSession.expiresAt > Date.now() && this.dependencies.sessions.get(input.sessionId) !== undefined
      && (this.dependencies.disclosureRecipient ?? 'openrouter.ai') === 'openrouter.ai'
    if (!voiceAuthorized) {
      this.dependencies.reportRecordFailure?.(new Error('auma-live turn refused: provider-consent-required'))
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' })
      res.end(`data: ${JSON.stringify({ t: 'done', reason: 'provider-consent-required' })}\n\n`)
      return
    }
    // **LIVE, ELSE HER HOME — RESUMED ON DEMAND.** This was `sessions.get(input.sessionId)` and a 409 for anything
    // not already in memory, so her home answered "not live" on every fresh start. A selected thread that is not
    // live now falls back to the home; the home is resumed through the host's own path; and a missing or unknown
    // home is refused by name. See `home-session.ts`.
    const found = await resolvePresenceSession(input.sessionId, {
      homeSession: this.dependencies.homeSession ?? '',
      live: (id) => this.dependencies.sessions.get(id),
      ...(this.dependencies.resumeSession === undefined ? {} : { resume: this.dependencies.resumeSession }),
    })
    if ('refusal' in found) {
      res.writeHead(found.refusal.status, {
        'content-type': 'text/plain; charset=utf-8',
        'x-auma-live-refusal': found.refusal.code,
      })
      res.end(found.refusal.message)
      return
    }
    const session = found.session
    // THE TURN RUNS AS THE SESSION IT ACTUALLY WENT THROUGH: her home, when the named one was not live.
    const voiceAuthorization: VoiceAuthorization | undefined = voiceAuthorized && voiceSession !== undefined
      ? {
        recipient: 'openrouter.ai', allowed: Object.freeze(['turn-text', 'history'] as const),
        allows: endpoint => {
          if (this.voiceSessions.get(token) !== voiceSession || voiceSession.expiresAt <= Date.now()
              || voiceSession.sessionId !== session.id || this.dependencies.sessions.get(session.id) !== session
              || (this.dependencies.disclosureRecipient ?? 'openrouter.ai') !== 'openrouter.ai') return false
          try {
            const url = new URL(endpoint)
            return url.protocol === 'https:' && url.host === 'openrouter.ai' && url.username === '' && url.password === ''
          } catch { return false }
        },
      }
      : undefined
    const turn: PresenceRequest = { ...input, sessionId: session.id, ...(voiceAuthorization === undefined ? {} : { voiceAuthorization }) }
    this.dependencies.crossLane.synchronizeChat(session.id, session.snapshotEvents())
    const abort = new AbortController()
    if (voiceAuthorized) voiceSession?.active.add(abort)
    res.once('close', () => { abort.abort() })
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      // The page keys its transcript by the session the turn went through, and says so when it fell back.
      'x-auma-live-session': encodeURIComponent(session.id),
      ...(found.fellBackFrom === undefined ? {} : { 'x-auma-live-fallback': encodeURIComponent(found.fellBackFrom) }),
    })
    // **A HELD SEGMENT MUST STILL SAY SOMETHING.** A provider can take many seconds to produce its first token, and
    // until this existed NOTHING was written in that window — so an intermediary (a proxy, a browser, a mobile
    // radio) could decide the connection was dead and close it, **and the symptom is a turn that silently never
    // arrives.** The ping is an SSE COMMENT (`:`), which every client ignores as data and every hop reads as
    // proof of life.
    //
    // **THE INTERVAL IS SHORTER THAN ANY SANE IDLE TIMEOUT AND LONGER THAN A HEALTHY FIRST TOKEN.** Ten seconds is
    // half the twenty-second hold the preflight's arm uses, so a stub that holds at all still produces an event
    // inside it. **It is cleared in the same `finally` that ends the response**, so a heartbeat cannot outlive the
    // stream it is keeping alive — a timer writing to a closed socket is an error loop, not a heartbeat.
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n')
    }, this.dependencies.heartbeatIntervalMs ?? 10_000)
    // `unref` so a heartbeat never holds the process open on its own; the stream is what owns this timer's life.
    heartbeat.unref?.()
    try {
      const receipt = await this.engine.stream(turn, abort.signal, res, async (request) => {
        // **HER OWN FILE, NEVER THE LANE'S LOG.** This line used to be
        // `session.append('auma-live/model-request', request)` followed by a flush into the bound lane's session.
        // That type is not in `KNOWN_SESSION_EVENT_TYPES`, and `append` cannot set `ignorable: true`, so the
        // harness refused to load that thread after ANY restart — the outage this item exists to end. Writing it
        // anywhere else was never the fix; not writing it there is.
        return this.recordModelRequest(turn.sessionId, request)
      })
      // Completion carries this turn's persisted request receipt, even if another request appended meanwhile.
      // Missing or changed bindings emit no manifestation; no session-wide fallback is allowed.
      const home = this.dependencies.modelRequestHome
      if (typeof home === 'string' && home !== '' && !res.writableEnded) {
        const record = readRecordedModelRequest({ dshHome: home, sessionId: turn.sessionId, receipt })
        if (record !== undefined) {
          res.write(`data: ${JSON.stringify({ t: 'manifested', replyId: replyIdOf(turn.sessionId, record.turn) })}\n\n`)
        }
      }
    } catch (error: unknown) {
      // **BACKSTOP FOR A THROW THAT ESCAPES THE ENGINE** (one raised before the engine's own `try`): the stream still gets a
      // spoken, named reason and a `done` frame, and the failure is reported. Never an open stream, never a bare close.
      this.dependencies.reportRecordFailure?.(error)
      await writeTurnFault(res, error)
    } finally {
      clearInterval(heartbeat)
      voiceSession?.active.delete(abort)
      if (!res.writableEnded) res.end()
    }
  }
  /** Explicit Start/Stop Voice commands. Authority is local, bounded, revocable and never persisted. */
  private async voiceSessionAction(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
    const answer = (status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    if (body['action'] === 'stop-voice') {
      const token = typeof body['voiceSessionToken'] === 'string' ? body['voiceSessionToken'] : ''
      const grant = this.voiceSessions.get(token)
      this.voiceSessions.delete(token)
      grant?.active.forEach(controller => { controller.abort() })
      answer(200, { stopped: true })
      return
    }
    if (body['recipient'] !== 'openrouter.ai' || JSON.stringify(body['classes']) !== '["turn-text","history"]'
        || (this.dependencies.disclosureRecipient ?? 'openrouter.ai') !== 'openrouter.ai') {
      answer(400, { refusal: 'voice-scope-mismatch' })
      return
    }
    const policy = this.dependencies.disclosurePolicy?.()
    if (policy?.recipient !== 'openrouter.ai' || !policy.allowed.includes('turn-text') || !policy.allowed.includes('history')) {
      answer(409, { refusal: 'disclosure-refused' })
      return
    }
    const requested = typeof body['sessionId'] === 'string' ? body['sessionId'].trim() : ''
    if (requested.length > 256) { answer(400, { refusal: 'invalid-session' }); return }
    const found = await resolvePresenceSession(requested, {
      homeSession: this.dependencies.homeSession ?? '', live: id => this.dependencies.sessions.get(id),
      ...(this.dependencies.resumeSession === undefined ? {} : { resume: this.dependencies.resumeSession }),
    })
    if ('refusal' in found) { answer(found.refusal.status, { refusal: found.refusal.code }); return }
    // Sweep expired grants and cap abandoned starts; no same-UID/browser-attendance claim is made here.
    for (const [token, grant] of this.voiceSessions) {
      if (grant.expiresAt <= Date.now()) {
        this.voiceSessions.delete(token)
        grant.active.forEach(controller => { controller.abort() })
      }
    }
    if (this.voiceSessions.size >= 128) { answer(429, { refusal: 'voice-session-limit' }); return }
    const token = randomBytes(24).toString('hex')
    const expiresAt = Date.now() + 60 * 60 * 1000
    this.voiceSessions.set(token, { sessionId: found.session.id, expiresAt, active: new Set() })
    answer(200, { voiceSessionToken: token, sessionId: found.session.id, recipient: 'openrouter.ai', classes: ['turn-text', 'history'], expiresAt })
  }

  /**
   * Resume the configured home without making the caller wait, reporting a failure either way.
   *
   * @param res - the response whose close is watched; **the handler goes on before the resume starts.**
   * @param homeSession - the configured home, or `''` when there is none.
   */
  private resumeHomeInBackground(res: ServerResponse, homeSession: string): void {
    if (homeSession === '') return
    const resume = this.dependencies.resumeSession
    if (resume === undefined) return
    // Already live: nothing to do, and asking again would be a second resume of a running session.
    if (this.dependencies.sessions.get(homeSession as SessionId) !== undefined) return
    // **THE HANDLER FIRST.** Everything below this line may take a second; a listener attached after an `await` is a
    // listener that can miss the event it exists for.
    let closed = false
    res.once('close', () => { closed = true })
    void resolvePresenceSession(homeSession, {
      homeSession,
      live: (id) => this.dependencies.sessions.get(id),
      resume,
    }).then(
      () => undefined,
      (error: unknown) => {
        // **A FAILURE IS REPORTED WHETHER OR NOT THE PAGE IS STILL THERE.** The client leaving is not the resume
        // failing, and the two must not be told apart by whether anything was logged.
        if (!closed) this.dependencies.reportRecordFailure?.(error)
      },
    )
  }
}

function recentChatSessionId(req: IncomingMessage): SessionId | undefined {
  const authority = req.headers.host
  if (authority === undefined) return undefined
  const raw = new URL(req.url ?? '/', `http://${authority}`).searchParams.get('session')?.trim() ?? ''
  if (raw.length === 0 || raw.length > 256) return undefined
  return SessionId(raw)
}

/**
 * DNS-rebinding and cross-site guard for the credential-backed local routes.
 * @param req - Incoming HTTP or WebSocket upgrade request.
 * @returns Whether the peer and authority are loopback and Origin is same-authority or absent.
 */
export function isTrustedLocalRequest(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  const authority = req.headers.host
  if (authority === undefined || !isLoopbackAuthority(authority)) return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.host === authority
      && isLoopbackAuthority(parsed.host)
  } catch {
    return false
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  return address === '::1'
    || address.startsWith('127.')
    || address.startsWith('::ffff:127.')
}

function isLoopbackAuthority(authority: string): boolean {
  try {
    const hostname = new URL(`http://${authority}`).hostname.replace(/^\[|\]$/g, '')
    return hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.')
  } catch {
    return false
  }
}

function parsePresenceRequest(
  value: unknown,
  minds: Readonly<Record<string, PresenceMind>>,
): PresenceRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestBodyError('invalid')
  }
  const record = value as Record<string, unknown>
  // AN EMPTY SESSION MEANS "HER HOME": a page that has not yet heard the home names none, and the host — which
  // knows its configuration — answers through the home or refuses by name.
  const rawSessionId = typeof record['sessionId'] === 'string' ? record['sessionId'].trim() : ''
  if (rawSessionId.length > 256) throw new RequestBodyError('invalid')
  const text = typeof record['text'] === 'string' ? record['text'].trim() : ''
  if (text.length === 0 || text.length > 4_000) throw new RequestBodyError('invalid')
  const rawMind = record['mind'] ?? 'balanced'
  if (typeof rawMind !== 'string' || !Object.hasOwn(minds, rawMind)) {
    throw new RequestBodyError('invalid')
  }
  const context = record['context']
  if (context !== undefined && (typeof context !== 'string' || context.length > 4_000)) {
    throw new RequestBodyError('invalid')
  }
  return {
    sessionId: SessionId(rawSessionId),
    text,
    mind: rawMind,
    ...(typeof context === 'string' && context.length > 0 ? { context } : {}),
  }
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    bytes += chunk.length
    if (bytes > maxBytes) throw new RequestBodyError('too-large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new RequestBodyError('invalid')
  }

}

class RequestBodyError extends Error {}
