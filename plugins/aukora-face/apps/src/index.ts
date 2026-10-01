/**
 * Stock-app plugin, node half. It serves the repository-owned application
 * trees at their original same-origin paths; the client half contributes the
 * launchers and isolated center surfaces.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage } from 'node:http'
import { createHash } from 'node:crypto'

/**
 * The trust surface a plugin-owned route consults before serving. Typed locally, as
 * the harness's own open-in-app plugin does, because the connection package is
 * browser-side and its types are not importable from a host entry.
 */
interface RouteGate {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}
import type {} from '@deepseek-ai/dsh-session-persistence'
import { createEmbeddedAssetHandlers } from './embedded-assets.ts'
import { AumaLiveHttp } from './auma-live/http.ts'
import { checkHomeSessionConfig, CONTROLLER_UNMOUNTED, type HomeResume } from './auma-live/home-session.ts'
import { CrossLaneMemory } from './auma-live/cross-lane.ts'
import { isGitWorkTree, RepoLens } from './auma-live/repo-lens.ts'
import { readClaimsPacket } from './auma-live/claims-packet.ts'
import { lensCache } from './auma-live/lens-cache.ts'
import { readRecordedModelRequest } from './auma-live/model-request-store.ts'
import { appendReplyManifest, replyIdOf } from './auma-live/reply-manifest.ts'
// **THE OWNER'S CONTROL PHRASES, CHECKED ON THE OWNER'S OWN WORDS.** auma-53 item (2): the module existed, was
// courted, and had no caller — so "off the record" changed nothing about whether a turn was remembered.
import { memoryControlIn, suppressesCapture } from './auma-live/memory-control.ts'
import { checkSpokenMemory } from './auma-live/memory-speech.ts'

/**
 * **THE EVENT IS DECLARED, BECAUSE `ctx.emit` IS TYPED AND WILL NOT TAKE AN UNDECLARED NAME.**
 *
 * The build answered this rather than a guess: *"TS2769: No overload matches this call"* at the `ctx.emit` below. **A
 * face cannot invent an event at the call site — the name has to exist in the events interface first**, which is the
 * harness's own rule for typed events and the reason `ctx.on('session/event', …)` compiles here while a new name does
 * not.
 *
 * **BOTH SPELLINGS KIRA CONSUMES ARE DECLARED.** Its `AUMA_TURN_EVENTS` is
 * `['auma/turn-finished', 'auma.turnFinished']`, and its own comment says why it answers to two: *"the name is AUMA's
 * to choose and a consumer that only answers to one spelling is a consumer that silently captures nothing the day
 * someone picks the other."* **This face emits the first; the second is declared so a listener registered for it is
 * typed rather than an error**, and so the choice stays reversible without touching a consumer.
 *
 * **THE PAYLOAD IS WRITTEN OUT HERE RATHER THAN IMPORTED FROM KIRA.** A face that imported its consumer's type would
 * make KIRA's module part of this face's build, and **the two halves are deliberately separate: this side knows what
 * happened to a turn, KIRA knows what a memory is.**
 */
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One completed Auma Live turn, offered to whoever keeps memory.
     *
     * @param payload - the session, the owner's words, her reply, and the canonical record with its position.
     * @mode emit
     */
    'auma/turn-finished'(payload: {
      readonly sessionId: string
      readonly ownerText: string
      readonly text: string
      readonly seq: number
      readonly turn: number
      readonly at: string
      readonly line: string
      /**
       * **WHAT THE OWNER SAID ABOUT MEMORY IN THIS TURN, IF ANYTHING — THE PHRASE AND ITS INTENT.**
       *
       * `forget that` and `remember that` do NOT suppress the turn: they are instructions ABOUT memory rather than
       * refusals of it, **and swallowing them here would leave "forget that" with nothing to act on.** So the turn is
       * emitted with the intent attached, **and the consumer decides what to do with it.**
       *
       * **THE FACE SUPPLIES; KIRA DECIDES.** This is the phrase as `memoryControlIn` read it from the owner's own
       * words, with `matched` carrying the exact words so a reply can quote him rather than paraphrase. **The face does
       * not route a forget, because routing one means writing a record and that is KIRA's store rather than this
       * plugin's.**
       *
       * `null` when the owner said nothing about memory — **an explicit null rather than an absent field**, so a
       * consumer can tell "no control phrase" from "an older producer that did not send one".
       */
      readonly control: { readonly intent: string; readonly matched: string } | null
      /**
       * **WHICH MEMORIES WERE IN FRONT OF HER, AT WHICH TIER — CARRIED, NOT RE-DERIVED.**
       *
       * `checkSpokenMemory` refuses a reply citing a handle she was never shown, and `voiceForgetDecision` refuses to
       * forget a note that was not in front of him in this turn. **Both were fully written, courted, and had nothing to
       * read** — *because the handles were produced by nothing and then dropped at the lens's call site.*
       *
       * **AND A CONSUMER THAT DOES NOT KNOW THIS FIELD STILL WORKS**, because the contract's required fields are
       * unchanged and this one is additive. *KIRA's `readAumaTurn` validates six fields and ignores the rest.*
       */
      readonly memoryInjected: readonly { readonly handle: string; readonly tier: 'remembered' | 'signed'; readonly id?: string }[]
      /**
       * **WHAT THE REPLY SAID ABOUT HER OWN MEMORY, CHECKED AGAINST WHAT SHE WAS ACTUALLY SHOWN.**
       *
       * `checkSpokenMemory` refuses a reply that cites a handle she was never given — **and the one sentence this system
       * may never say is "verified", because a signature says the OWNER signed and not that the memory is true.**
       *
       * **THE FINDINGS ARE CARRIED RATHER THAN ACTED ON, AND THAT IS A REAL LIMIT RATHER THAN A DESIGN CHOICE:** by the
       * time this event is emitted the reply has already been spoken, *so there is nothing left to withhold.* **What this
       * buys is that the check RUNS and its findings are OBSERVABLE** — *before tonight it had no caller at all, which
       * meant a fabricated handle and a truthful citation were indistinguishable to every instrument in the system.*
       */
      readonly spokenMemory: readonly { readonly kind: string; readonly handle?: string }[]
    }): void
    /**
     * The same event under Fable's original spelling, so a listener registered for either name type-checks.
     *
     * @param payload - identical to `auma/turn-finished`.
     * @mode emit
     */
    'auma.turnFinished'(payload: {
      readonly sessionId: string
      readonly ownerText: string
      readonly text: string
      readonly seq: number
      readonly turn: number
      readonly at: string
      readonly line: string
      /**
       * **WHAT THE OWNER SAID ABOUT MEMORY IN THIS TURN, IF ANYTHING — THE PHRASE AND ITS INTENT.**
       *
       * `forget that` and `remember that` do NOT suppress the turn: they are instructions ABOUT memory rather than
       * refusals of it, **and swallowing them here would leave "forget that" with nothing to act on.** So the turn is
       * emitted with the intent attached, **and the consumer decides what to do with it.**
       *
       * **THE FACE SUPPLIES; KIRA DECIDES.** This is the phrase as `memoryControlIn` read it from the owner's own
       * words, with `matched` carrying the exact words so a reply can quote him rather than paraphrase. **The face does
       * not route a forget, because routing one means writing a record and that is KIRA's store rather than this
       * plugin's.**
       *
       * `null` when the owner said nothing about memory — **an explicit null rather than an absent field**, so a
       * consumer can tell "no control phrase" from "an older producer that did not send one".
       */
      readonly control: { readonly intent: string; readonly matched: string } | null
      /**
       * **WHICH MEMORIES WERE IN FRONT OF HER, AT WHICH TIER — CARRIED, NOT RE-DERIVED.**
       *
       * `checkSpokenMemory` refuses a reply citing a handle she was never shown, and `voiceForgetDecision` refuses to
       * forget a note that was not in front of him in this turn. **Both were fully written, courted, and had nothing to
       * read** — *because the handles were produced by nothing and then dropped at the lens's call site.*
       *
       * **AND A CONSUMER THAT DOES NOT KNOW THIS FIELD STILL WORKS**, because the contract's required fields are
       * unchanged and this one is additive. *KIRA's `readAumaTurn` validates six fields and ignores the rest.*
       */
      readonly memoryInjected: readonly { readonly handle: string; readonly tier: 'remembered' | 'signed'; readonly id?: string }[]
      /**
       * **WHAT THE REPLY SAID ABOUT HER OWN MEMORY, CHECKED AGAINST WHAT SHE WAS ACTUALLY SHOWN.**
       *
       * `checkSpokenMemory` refuses a reply that cites a handle she was never given — **and the one sentence this system
       * may never say is "verified", because a signature says the OWNER signed and not that the memory is true.**
       *
       * **THE FINDINGS ARE CARRIED RATHER THAN ACTED ON, AND THAT IS A REAL LIMIT RATHER THAN A DESIGN CHOICE:** by the
       * time this event is emitted the reply has already been spoken, *so there is nothing left to withhold.* **What this
       * buys is that the check RUNS and its findings are OBSERVABLE** — *before tonight it had no caller at all, which
       * meant a fabricated handle and a truthful citation were indistinguishable to every instrument in the system.*
       */
      readonly spokenMemory: readonly { readonly kind: string; readonly handle?: string }[]
    }): void
  }
}
import { createSpendGate, DEFAULT_DAILY_CAP_USD, utcDay } from './auma-live/spend-gate.ts'
import { CoreLens } from './auma-live/core-lens.ts'
import { isFreshWake, wakeBlock, wakeDecision, wakeKeyOf } from './auma-live/lane-wake.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { KiraLens } from './auma-live/kira-lens.ts'
import { organismLensText } from './auma-live/organism-lens.ts'
import { organismStateLens } from './auma-live/organism-state-lens.ts'
import { organismDisclosureDependencies } from './auma-live/organism-disclosure.ts'
import { readOwnerPolicy, readOwnerPolicyText } from './auma-live/disclosure.ts'
import { setOwnerName } from './auma-live/presence.ts'
// **THE READERS, NOT THE RENDER.** The status route needs the projection rows and the approval rule; it does NOT
// need `readOrganism`, which would run `git log`, `git status` and `gh run list` on every status poll.
import { readLanes, unansweredApprovalOf } from './vendor/organism.ts'
import { accessSync, constants as fsConstants, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { RecallLens } from './auma-live/recall-lens.ts'
import { WebLens } from './auma-live/web-lens.ts'
import { WeightsControl } from './auma-live/weights-control.ts'
import { VoiceSidecarSupervisor, VoiceWebSocketProxy, voiceLogger } from './auma-live/voice.ts'

export type * from './auma-live/types.ts'
export type * from './auma-canvas/types.ts'

/** Stable Cordis plugin name. */
export const name = 'client-ui-stock-apps'

/** Services required by static mounts, the credential-backed presence lane, and the sidecar spawn. */
export const inject = ['webServer', 'connection', 'credentials', 'sessions', 'subprocess']

/** Host settings for the local Auma Live organs. */
export interface Config {
  /** Private room JSONL path, expanded on the host. */
  roomLogPath: string
  /** The configured CORE session; empty means no conductor and a named refusal. */
  coreSessionId: string
  /** Her home thread; empty means the no-session refusal is the only remaining one. */
  homeSession: string
  /** CORE tasks allowed per turn. */
  coreTasksPerTurn: number
  /** CORE tasks allowed per UTC day. */
  coreDailyCap: number
  /** Credential reference resolved for each OpenRouter presence turn. */
  apiKeyEnv: string
  /** Maximum accepted presence JSON request bytes. */
  maxRequestBodyBytes: number
  /** Private loopback port used by the repository-owned Python voice sidecar. */
  voicePort: number
  /** Register the local voice WebSocket bridge and sidecar supervisor. */
  voiceEnabled: boolean
  /** Launch the sidecar automatically after its local setup has been installed. */
  voiceAutoStart: boolean
  /** Installed .venv and models directory, resolved from the host cwd; empty uses package-local assets. */
  voiceRuntimeDirectory: string
  /** Repository root the presence lens may read, resolved from the host working directory; empty disables the lens. */
  repoLensRoot: string
  /** Explicit consent for presence provider requests, including prompts, identity and history. Default false. */
  providerSendConsent: boolean
  /** What Auma calls the owner; only letters, marks, space, dot, apostrophe and hyphen, at most 40 characters. */
  ownerName: string
  /** The DSH home the organism reader reads; empty disables the organism block. */
  organismDshHome: string
  /** The repository the organism reader reports on; empty falls back to `repoLensRoot`. */
  organismRepo: string
  /** Byte cap for one lens file read. */
  repoLensFileBytes: number
  /** Model-directed lens lookups allowed per spoken turn; 0 disables the lens. */
  repoLensLookups: number
  /** Model-directed internet searches allowed per spoken turn; 0 disables web sight. */
  webLensLookups: number
  /** Sources rendered into one web answer. */
  webLensResults: number
  /** Deadline for one spoken-turn search. */
  webLensTimeoutMs: number
  /** Character cap for one rendered web answer. */
  webLensAnswerChars: number
  /** Model-directed conversation lookups allowed per spoken turn; 0 disables recall. */
  recallLookups: number
  /** Newest sessions inspected per conversation lookup. */
  recallMaxCandidates: number
  /** Prior sessions searched, newest first, to carry spoken memory into a fresh conversation; 0 keeps memory within one session. */
  spokenMemoryReach: number
  /** Ordered mind keys the selector offers; empty offers every constructed mind. An unknown key fails load. */
  offeredMinds: string[]
  /** Selector button text for the private mind; empty shows its key. */
  /** Daily provider spend ceiling in US dollars, per UTC day. Peter sets this; 25 until he does. */
  dailyCapUsd: number
  /** Selector button text for the private mind; empty shows its key. */
  privateMindLabel: string
  /** Render the private mind's turns with the chat template's reasoning channel off. */
  privateMindDisableTemplateThinking: boolean
  /** Absolute path to the owner's weights-control script; empty leaves the voice unable to change itself. */
  weightsControlScript: string
  /** Weight verbs the voice may perform per spoken turn; 0 disables the arm. */
  weightsControlVerbs: number
  /** Deadline for one weight verb. */
  weightsControlTimeoutMs: number
  /** What the private mind's weights are and where they physically run; empty leaves the lane saying only the address. */
  privateMindRunsOn: string
  /**
   * Mind key the private endpoint occupies. A key that matches a bundled mind
   * replaces it; any other key adds a mind beside them. It defaults beside
   * them because a private endpoint's latency is the owner's to discover, not
   * something the bundled three should inherit.
   */
  privateMindKey: string
  /** Model id for the privately reached voice mind; empty leaves the bundled mind in place. */
  privateMindModel: string
  /** Chat-completions endpoint for that mind, typically a loopback tunnel to the owner's own hardware. */
  privateMindEndpoint: string
  /** Credential reference for that mind; empty dispatches without a bearer. */
  privateMindApiKeyEnv: string
  /**
   * Text appended to the latest owner turn for that mind. Qwen3 chat templates
   * read `/no_think` as "answer directly"; without it the model spends its
   * whole token budget in hidden reasoning and streams no speakable content.
   */
  privateMindTurnSuffix: string
  /** Generated-token cap for that mind. */
  privateMindMaxTokens: number
  /** Send Ollama's `think: false` for that mind. */
  privateMindDisableThinking: boolean
}

export const Config: z<Config> = z.object({
  roomLogPath: z.string().default('~/aukora-live/room.log'),
  apiKeyEnv: z.string().role('credential-ref').default('OPENROUTER_API_KEY'),
  maxRequestBodyBytes: z.natural().min(1).default(16 * 1024),
  voicePort: z.natural().min(1).max(65_535).default(7_512),
  voiceEnabled: z.boolean().default(true),
  voiceAutoStart: z.boolean().default(true),
  voiceRuntimeDirectory: z.string().default(''),
  repoLensRoot: z.string().default('.'),
  providerSendConsent: z.boolean().default(false).description('Owner consent for Auma Live provider prompts and conversation history. Enable explicitly in the existing aukora-face-apps composition config; false disables sending. The release disclosure policy still checks every data class and continuation.'),
  // setOwnerName validates the value; an invalid name uses the neutral default without disabling the apps plugin.
  ownerName: z.string().default(''),
  /**
   * The DSH home Aura's organism reader reads, and the repository it reports on. EMPTY DISABLES THE LENS:
   * the reader takes `dshHome` as an argument and this app never assumes one, so a deployment that does not
   * set this simply has no organism block rather than a block about somebody else's home.
   */
  organismDshHome: z.string().default(''),
  organismRepo: z.string().default(''),
  repoLensFileBytes: z.natural().min(1).default(24_576),
  repoLensLookups: z.natural().default(3),
  webLensLookups: z.natural().default(0),
  webLensResults: z.natural().min(1).default(4),
  webLensTimeoutMs: z.natural().min(1).default(9_000),
  webLensAnswerChars: z.natural().min(1).default(1_400),
  recallLookups: z.natural().default(3),
  recallMaxCandidates: z.natural().min(1).default(20),
  spokenMemoryReach: z.natural().default(12),
  offeredMinds: z.array(z.string()).default([]),
  dailyCapUsd: z.number().min(0.01).default(DEFAULT_DAILY_CAP_USD),
  /**
   * The CORE session — a DeepSeek conductor that runs the core preset and calls the subscription hands.
   *
   * **EMPTY MEANS NO CONDUCTOR, AND THAT IS A NAMED REFUSAL RATHER THAN A SILENT NO.** A `[core]` tag with this
   * unset is refused as `core-not-configured` and says so aloud; a person who wrote the tag must be able to tell
   * "not wired up" from "she ignored me".
   */
  coreSessionId: z.string().default(''),
  /**
   * **HER HOME SESSION — THE THREAD SHE ANSWERS THROUGH WHEN NOTHING IS SELECTED, OR THE SELECTED ONE IS NOT OPEN.**
   *
   * The page learns it at mount; the host resumes it on demand when it is not live. A value that cannot be a
   * session id fails load by name; one that names no session is refused by name at presence time. Empty means
   * there is no home, and "no home session is configured" is then a true sentence.
   */
  homeSession: z.string().default(''),
  /**
   * CORE tasks allowed per turn. Peter's direction: at most one.
   *
   * **THE CEILING IS `.max(1)`, NOT JUST A DEFAULT.** Codex r1 finding 5: a default is advice a config file can
   * overrule, so "at most one handoff per turn" was really "at most one unless someone writes a larger number".
   * A ceiling that any deployment can raise is not a ceiling — it is a starting point — and the bound Peter set is
   * about how much work reaches the conductor from ONE spoken turn, which is a property of the design rather than
   * of a deployment. Raising it is now a code change with a visible diff instead of a config edit.
   */
  coreTasksPerTurn: z.natural().max(1).default(1),
  /** CORE tasks allowed per UTC day. Peter's direction: twenty. */
  coreDailyCap: z.natural().default(20),
  privateMindLabel: z.string().default(''),
  privateMindDisableTemplateThinking: z.boolean().default(false),
  weightsControlScript: z.string().default(''),
  weightsControlVerbs: z.natural().default(2),
  weightsControlTimeoutMs: z.natural().min(1).default(20_000),
  privateMindRunsOn: z.string().default(''),
  privateMindKey: z.string().default('yours'),
  privateMindModel: z.string()
    .default('hf.co/mradermacher/Huihui-Qwen3.8-27B-abliterated-GGUF:Q4_K_M'),
  privateMindEndpoint: z.string().default('http://127.0.0.1:11434/v1/chat/completions'),
  privateMindApiKeyEnv: z.string().role('credential-ref').default(''),
  privateMindTurnSuffix: z.string().default(' /no_think'),
  privateMindMaxTokens: z.natural().min(1).default(2_048),
  privateMindDisableThinking: z.boolean().default(true),
})

/**
 * THE LANES' MEMORY, OR `null` — and never a throw.
 *
 * `organism.memory` is provided by the board plugin, which is where Kira's own digest functions are importable.
 * A face cannot import them, so this resolves the service and passes the frozen view through as data.
 *
 * RESOLVED PER CALL, NOT CAPTURED AT MOUNT: the service may be provided after this face loads, and one held
 * from boot would keep answering from whatever existed then. A MISSING SERVICE IS `null`, NOT AN EMPTY VIEW —
 * `null` travels into the reader, every lane keeps `summary: null`, and nothing is invented to fill the gap. A
 * faulting read is also `null`: the lens still renders the lanes, the git tip, CI and the ceilings, because a
 * memory fault must never become a blind turn.
 * @param ctx - the host context the service is resolved through.
 * @returns the assembled view, or null when there is nothing to hand over.
 */
async function readOrganismMemory(ctx: Context): Promise<unknown> {
  const service = ctx.get('organism.memory') as { read?: () => Promise<unknown> } | undefined
  if (service === undefined || typeof service.read !== 'function') return null
  try {
    return await service.read()
  } catch {
    return null
  }
}

/**
 * RESUME ONE SESSION THROUGH THE HOST'S OWN PATH — the session controller's `resolveAgent`, which is
 * `ApiSessionAgentController.resolve` (`vendor/dsh/packages/api/session-controller/src/agent.ts`): live agent if
 * there is one, otherwise a deduplicated resume from persistence, exactly what a client opening the thread gets.
 *
 * RESOLVED PER CALL: the controller may mount after this face, and one captured at boot could be a disposed one.
 * `home-session.ts` is the only caller, and it only ever passes the configured home.
 * @param ctx - the host context the controller is resolved through.
 * @param sessionId - the configured home.
 * @returns the live session, or the controller's own error (its code kept, so not-found is named).
 */
async function resumeThroughController(ctx: Context, sessionId: SessionId): Promise<HomeResume> {
  const controller = ctx.get('sessionController') as {
    resolveAgent?: (id: SessionId) => Promise<
      | { readonly agent: { readonly session: Session } }
      | { readonly error: { readonly code?: string; readonly message: string } }
    >
  } | undefined
  if (controller === undefined || typeof controller.resolveAgent !== 'function') {
    // Coded, so the page says the home cannot be opened here rather than "say that again in a moment".
    return { error: 'the session controller is not mounted', code: CONTROLLER_UNMOUNTED }
  }
  const found = await controller.resolveAgent(sessionId)
  if ('error' in found) {
    return { error: found.error.message, ...(found.error.code === undefined ? {} : { code: found.error.code }) }
  }
  return { session: found.agent.session }
}

/**
 * Register complete app trees, the same-origin presence route, and the local
 * voice bridge on the shell's own HTTP carrier.
 * @param ctx - Host context carrying webserver and credential services.
 * @param config - Schema-resolved local runtime settings.
 * @returns Completion after the guarded static server is loaded and the routes are registered.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  setOwnerName(config.ownerName)
  const { serveStatic } = await import('@deepseek-ai/dsh-host-frontend-static')
  const { existsSync } = await import('node:fs')
  const path = await import('node:path')
  const assetHandlers = createEmbeddedAssetHandlers(serveStatic)
  // A home that cannot be a session id fails load HERE, by name, rather than refusing every turn later.
  const homeSession = checkHomeSessionConfig(config.homeSession)
  // **NO HOME IS SAID AT LOAD, BY NAME**, not first discovered when Peter speaks. The face still loads (the voice and
  // every selected live thread work), but a turn with nothing selected, or through a thread that is not open, is
  // refused until a home is configured.
  if (homeSession === '') {
    ctx.logger.warn('ui-stock-apps: no homeSession is configured for Auma Live, so a turn with nothing selected, or '
      + 'through a thread that is not open, is refused. Set homeSession under aukora-face-apps in auma-live.patch.yml '
      + 'to the session she answers through.')
    // **AND THE SECOND CONSEQUENCE IS NAMED, BECAUSE IT IS OTHERWISE INVISIBLE.** Recall is scoped to the owner's own
    // session — **so with no home, EVERY session is "other" and recall is off in all of them.** That is the
    // refuse-closed direction and it is the right default, **but a feature that quietly stops working is
    // indistinguishable from one that was never configured** — and this warning is the only place a deployment can
    // learn the difference. **The store is his; the session it may be quoted into is the one he names.**
    // **`config.recallLookups`, NOT THE `recall` LENS — WHICH IS DEFINED EIGHTY LINES BELOW THIS.** Reading it here
    // would be a temporal-dead-zone ReferenceError at load, and this goal has already been bitten by TDZ once; the
    // config value is the same fact and is in scope.
    if (config.recallLookups > 0) {
      ctx.logger.warn('ui-stock-apps: recall is CONFIGURED but no homeSession is set, so recall is OFF in every '
        + 'session — a turn that is not the owner\'s own session may not quote his memories. Set homeSession to turn '
        + 'it on.')
    }
  }
  const crossLane = new CrossLaneMemory()
  // **WHEN SHE LAST WOKE WITHOUT BEING ASKED.** A lane finishing is not a reason to start a conductor per lane per
  // turn: four lanes finishing inside a minute are ONE look, and this is what makes that true.
  let lastWakeAt = 0
  /** The last wake decision, so the status route can report it rather than recomputing one. */
  // **THE DECISION CARRIES WHERE IT WENT, NOT ONLY WHETHER IT WAS TAKEN.** `wake: true` says the decision was to
  // wake; `target` and `delivered` say whether the prompt reached her HOME session, **and a wake that reached only
  // CORE would otherwise look identical to one that arrived.**
  let lastWakeDecision: {
    wake: boolean
    refused: string | null
    at: number | null
    lane: string | null
    target: string | null
    delivered: boolean
  } | null = null

  /**
   * Whether a hand's command is on PATH.
   *
   * **A PATH SCAN, NOT A SPAWN.** `which codex` would start a process on a status read, and a status route that
   * spawns is not read-only in the sense that matters. An unreadable PATH entry is skipped: a directory this
   * process may not list is not evidence that the binary is absent, and reporting `false` for it would be a guess.
   *
   * @param name - the command name.
   * @returns true when an executable of that name is found, false otherwise.
   */
  const handResolvable = (name: string): boolean | null => {
    // **THE COMMENT SAID ONE THING AND THE CODE DID ANOTHER, WHICH CODEX CAUGHT.** The catch below was annotated
    // "an unreadable entry is not evidence of absence" — and then the function returned `false`, which asserts
    // absence. `existsSync` swallows EACCES and answers false, so the distinction was invisible; `statSync` throws
    // it, and that is what lets this report UNKNOWN instead of a guess.
    let unreadable = false
    for (const dir of (process.env.PATH ?? '').split(':')) {
      if (dir === '') continue
      const candidate = path.join(dir, name)
      try { statSync(candidate) } catch (error) {
        const code = (error as { code?: string }).code
        // ONLY A PERMISSION FAILURE IS UNKNOWN. ENOENT is the ordinary "not in this directory" and must not make
        // the whole answer unknown, or every hand would be unresolvable on any machine with a stale PATH entry.
        if (code === 'EACCES' || code === 'EPERM') unreadable = true
        continue
      }
      try { accessSync(candidate, fsConstants.X_OK); return true } catch { /* present but not executable */ }
    }
    return unreadable ? null : false
  }
  // **AND WHETHER ONE IS ALREADY RUNNING, WHICH IS THE PLAN'S CEILING.** `wakeDecision` implements `already-waking`
  // and the wiring left it undefined — so the term was always false and a night of lanes finishing would start a
  // conductor every quiet window with no bound on how many ran at once. A rule implemented and never supplied is a
  // rule that does not exist.
  let coreBusy = false
  // **A FRESH UUID IS NOT DEDUP** (Codex review, item 3). `requestId: randomUUID()` made every wake a NEW request, so
  // **the same lane finish could be delivered twice and wake her twice** — two spends against the cap the wake exists
  // to respect, and two prompts in her home for one event. The key below is derived from the EVENT, so a re-delivery
  // of the same finish is the same wake.
  //
  // **`event.time` IS THE EVENT IDENTITY THIS SYSTEM EXPOSES.** `observeSessionEvent` already takes it as the note's
  // `at`, and a lane cannot emit two events of one type in the same millisecond. **If a true `seq` ever reaches this
  // handler, it belongs here instead** — the shape of the guard does not change, only the string it is built from.
  let lastWakeKey = ''
  // The presence lens fails loud on a missing root instead of silently
  // serving a repo-blind voice under a config that promised sight.
  let repoLens: RepoLens | undefined
  if (config.repoLensRoot.length > 0 && config.repoLensLookups > 0) {
    const root = path.resolve(config.repoLensRoot)
    if (!existsSync(root)) throw new Error(`ui-stock-apps: repoLensRoot does not exist: ${root}`)
    // **A ROOT THAT IS NOT A GIT WORK TREE MEANS NO REPO LENS, AND THE LOG SAYS SO.** The default root is `.`, the backend's cwd,
    // which on a fresh install is `<stateRoot>/workspace`: an empty non-git directory. `git ls-files` fails there, and a lens
    // built on it failed every spoken turn. The lens is a read of what git tracks; without git there is nothing to read.
    if (await isGitWorkTree(root)) {
      repoLens = new RepoLens({ root, maxFileBytes: config.repoLensFileBytes })
    } else {
      ctx.logger.warn(`ui-stock-apps: repoLensRoot ${root} is not inside a git work tree, so the Auma Live repo lens is OFF (no repository block, no repo lookups). Point repoLensRoot at a git checkout to turn it on.`)
    }
  }
  // Only release bytes govern disclosure. Missing/invalid policy fails closed; consent stays independently off by default.
  const policyText = () => readOwnerPolicyText({
    release: path.join(import.meta.dirname, '..', 'disclosure-policy.json'),
  })
  const policyAtStartup = policyText()
  if (policyAtStartup.text === undefined) {
    ctx.logger.warn(`ui-stock-apps: the Auma Live disclosure policy could not be read (${policyAtStartup.problem ?? 'no candidate'}), so NOTHING is authorised to leave this machine and every turn will be refused by name.`)
  } else {
    ctx.logger.info(`ui-stock-apps: Auma Live disclosure policy is read from ${policyAtStartup.source} on every turn.`)
  }
  // THE LENS THE CLAIMS PACKET READS THROUGH, held as a const: `repoLens` is narrowable here and not inside
  // the closure that runs on every spoken turn.
  const lensForClaims = repoLens
  // The web seam may be absent on a Host that mounts no provider, so the lens
  // resolves it per lookup and answers honestly when it is missing.
  const webLens = config.webLensLookups === 0
    ? undefined
    : new WebLens({
      resolve: () => ctx.get('web'),
      maxResults: config.webLensResults,
      timeoutMs: config.webLensTimeoutMs,
      maxAnswerChars: config.webLensAnswerChars,
    })
  // The voice may look backward at earlier conversations, read-only, through
  // the same durable backend the coding lead reads. Absent that backend the
  // lane says lookup is unavailable rather than pretending to remember.
  const recall = config.recallLookups === 0
    ? undefined
    : new RecallLens({
      resolve: () => ctx.get('sessionPersistence'),
      maxCandidates: config.recallMaxCandidates,
      maxSnippets: 3,
      snippetChars: 480,
      maxAnswerChars: 1_400,
    })
  // The voice may act on exactly one thing: the weights serving it. The lane
  // loads on a Host that configures no script, and then it cannot.
  // **SELF_MODIFY_WITHOUT_APPROVAL: A CONFIGURED WEIGHTS SCRIPT IS A CEILING, NOT A FEATURE LINE.** She may act on
  // exactly one thing beyond speech — the weights serving her — and **nothing in this path asks Peter first.** The
  // lane simply loads on a Host that configures no script and then it cannot. That is a real boundary and it was
  // nowhere in the log, so a Host that HAD configured one looked identical to a Host that had not. **A limit that
  // does not print did not happen**, and this is the limit that says she can change what she is.
  if (config.weightsControlScript.length > 0) {
    ctx.logger.warn('SELF_MODIFY_WITHOUT_APPROVAL: a weights-control script is configured, so she can change the '
      + 'weights that serve her — and no approval stands in front of that. A Host that configures none cannot.')
  }
  const weights = config.weightsControlScript.length === 0 || config.weightsControlVerbs === 0
    ? undefined
    : new WeightsControl({
      resolve: () => ctx.get('subprocess'),
      script: config.weightsControlScript,
      cwd: path.resolve('.'),
      timeoutMs: config.weightsControlTimeoutMs,
      maxAnswerChars: 600,
    })
  // **ONE CONDUCTOR INSTANCE, BOUND BEFORE BOTH USERS NEED IT.** The HTTP layer dispatches `[core]` tags through
  // it and the wake listener starts night-time drafts through it — and they must be the SAME object, because the
  // daily cap and the per-turn count live on the instance. Two instances would each hold half the ceiling.
  const coreLens = new CoreLens(config.coreSessionId)
  // **THE GATE IS BUILT ONCE, HERE, AND SHARED FOR THE LIFE OF THE PROCESS** — a per-turn gate would reset the
  // day's spend on every turn and enforce nothing. `config.dailyCapUsd` is Peter's ceiling; the price table is the
  // module's, because a price is a fact about a provider rather than a preference. It is a named binding rather
  // than an inline field because the panel's status strip reports the SAME instance's day: a second gate would
  // show a different spend than the one actually being enforced.
  /**
   * **THE DAY'S BALANCE SURVIVES A RESTART.** Codex r1 finding 3: the counter lived only in the gate's closure, so
   * every restart — and a cutover is one — began the day at zero, and the true daily total could exceed the
   * ceiling by whatever was spent before each restart.
   *
   * THE LEDGER LIVES IN HER OWN STORE, under the DSH home she is already configured with, beside nothing else and
   * readable by nothing else. `readFileSync`/`writeFileSync` rather than a service: this is one small object for
   * one UTC day, and a ledger that cannot be written must not take a turn down with it — the gate catches a
   * throwing store and holds the ceiling for this process from its in-memory value.
   */
  /**
   * The user's state directory, or NULL when none is configured.
   *
   * **`path.resolve('')` IS THE WORKING DIRECTORY, AND THAT WAS A PRIVACY DEFECT RATHER THAN A STYLE ONE.** An empty
   * or unset `organismDshHome` resolved to `process.cwd()` — so **conversation content and the spend ledger were
   * written to `<cwd>/auma-live/`, which is the repository during development and the release tree in a cut.** Peter's
   * rule is that private conversations stay in the user's state directory, and **a missing setting must mean NO
   * STORE, never "wherever this process happens to be standing".**
   *
   * **IT RETURNS NULL RATHER THAN THROWING**, because a Host with no configured home is a supported configuration —
   * her requests are simply not persisted, which is the honest failure. Refusing to boot would turn a missing
   * setting into an outage.
   */
  const stateHomeOf = (raw: string): string | null => {
    const trimmed = raw.trim()
    if (trimmed === '') return null
    return path.resolve(trimmed)
  }
  const stateHome = stateHomeOf(config.organismDshHome)
  // **NULL, NOT A PATH.** The ledger's writer treats a missing path as "do not persist" rather than "persist here".
  const spendLedgerPath = stateHome === null ? null : path.join(stateHome, 'auma-live', 'spend.json')
  const spendGate = createSpendGate({
    capUsd: config.dailyCapUsd,
    store: {
      // **NO HOME MEANS NO STORE, AND BOTH HALVES SAY SO.** `load` returns null and `save` does nothing — the
      // alternative, resolving to the working directory, wrote the day's spend into the repository. **The ceiling is
      // then per-process rather than per-day, which is the honest failure and is disclosed by `PRICES_*`/the
      // NOT CLAIMED rows rather than hidden by writing somewhere that looks like it worked.**
      load: () => {
        if (spendLedgerPath === null) return null
        try { return JSON.parse(readFileSync(spendLedgerPath, 'utf8')) as { day?: unknown; spentUsd?: unknown } } catch { return null }
      },
      save: (balance) => {
        if (spendLedgerPath === null) return
        mkdirSync(path.dirname(spendLedgerPath), { recursive: true })
        writeFileSync(spendLedgerPath, `${JSON.stringify(balance)}\n`)
      },
    },
  })

  const liveHttp = new AumaLiveHttp({
    providerSendConsent: config.providerSendConsent,
    credentials: ctx.credentials,
    apiKeyEnv: config.apiKeyEnv,
    maxRequestBodyBytes: config.maxRequestBodyBytes,
    crossLane,
    sessions: ctx.sessions,
    // **HER REQUESTS GO IN HER OWN FILE, AND THIS IS THE HOME IT LIVES UNDER.** The same `organismDshHome` the
    // organism lens reads is the DSH home she stores under, so there is one configured home and not two that can
    // drift. Empty means no store: her requests are then not persisted, which is the honest failure — the
    // alternative that existed before was to append them to a LANE's session log, and that is what made the
    // thread unloadable after every restart.
    // **OMITTED, NOT RESOLVED, WHEN NO HOME IS CONFIGURED.** The consumer reads `modelRequestHome ?? ''` and treats
    // an absent value as no store — so the honest expression is to leave it out. Passing `path.resolve('')` here
    // wrote her requests into the working directory while this very comment claimed "empty means no store".
    ...(stateHome === null ? {} : { modelRequestHome: stateHome }),
    ...(homeSession === '' ? {} : { homeSession }),
    // **HER HOME IS RESUMED ON DEMAND, THROUGH THE HOST'S OWN PATH.** Without this a home not opened since boot
    // answered 409 on every fresh start. Only the configured home is ever passed here (`home-session.ts`).
    resumeSession: (sessionId: SessionId) => resumeThroughController(ctx, sessionId),
    // **THE CONDUCTOR, BOUND TO A CONFIGURED ID AND NOTHING ELSE.** `coreLens` holds the ID from config; the
    // session controller is the host's, and `coreEvents` reads CORE's OWN session so its latest report is what
    // CORE actually said rather than a copy this app keeps.
    coreLens,
    coreSessionConfigured: config.coreSessionId.length > 0,
    coreTasksPerTurn: config.coreTasksPerTurn,
    coreDailyCap: config.coreDailyCap,
    ...(ctx.get('sessionController') === undefined
      ? {}
      : { sessionController: ctx.get('sessionController') as { prompt: (r: unknown, s: AbortSignal) => Promise<unknown> } }),
    coreEvents: () => ctx.sessions.get(config.coreSessionId as SessionId)?.snapshotEvents() ?? [],
    /**
     * **THE LINK KIRA HAS BEEN WAITING FOR SINCE kira-122.**
     *
     * Auma Live answers through a direct provider call, so the harness never fires an agent turn event — **Fable's
     * key finding: her conversations reached the ring, the cross-lane notes and her own request file, and never
     * reached memory.** KIRA built the consumer; nothing emitted.
     *
     * The engine carries the exact append receipt from this turn. Rechecking that physical line binds capture and
     * the reply manifest to its own request, including when another request in the same session finishes first.
     * A missing or changed binding emits nothing; the newest session line is never a substitute.
     */
    turnFinished: (turn) => {
      // **THE OWNER'S OWN WORDS DECIDE WHETHER THIS TURN IS OFFERED AT ALL, AND THEY ARE CHECKED BEFORE THE STORE IS
      // EVEN READ.** `memoryControlIn` takes the owner's turn — which is what `turn.ownerText` is — and the phrases are
      // meant to work *in the same breath* as the thing they govern: "off the record" said now covers this turn, not
      // the next one. **Placing the check here rather than in the engine is what makes that true without threading a
      // value across the whole turn** — the engine already hands over the owner's exact words.
      //
      // **THREE INTENTS SUPPRESS AND TWO DO NOT.** `off-record`, `stop-remembering` and `someone-here` mean this turn
      // must not be captured: the first two are the owner saying so, and the third is somebody else in the room.
      // **`remember` and `forget` still emit** — they are instructions ABOUT memory rather than refusals of it, and
      // KIRA's pipeline is where a marked turn or a forget request is acted on. **A control that swallowed the turn
      // would leave "forget that" with nothing to act on.**
      // **THE DECISION IS A PURE FUNCTION IN `memory-control.ts` SO A COURT CAN DRIVE IT.** Inline, the only way to
      // test which intents suppress was to read this file — and the module had no caller AND no provable decision.
      if (suppressesCapture(memoryControlIn(turn.ownerText))) return
      if (stateHome === null) return
      const record = readRecordedModelRequest({ dshHome: stateHome, sessionId: turn.sessionId, receipt: turn.record })
      if (record === undefined) return
      // **THE CONSUMER REFUSES `at` UNLESS IT IS SECONDS-PRECISION UTC WITH A `Z`.** `toISOString` gives
      // milliseconds, and `spokenAt` is the instant the LINE carries, so the two agree by construction.
      const at = new Date(record.spokenAt).toISOString().replace(/\.\d{3}Z$/u, 'Z')
      ctx.emit('auma/turn-finished', {
        sessionId: turn.sessionId,
        ownerText: turn.ownerText,
        text: turn.text,
        seq: record.turn,
        turn: record.turn,
        at,
        line: record.line,
        // **THE OWNER'S OWN CONTROL PHRASE, CARRIED RATHER THAN ACTED ON.** The suppression check above RETURNED for
        // the three intents that must not capture; **`remember` and `forget` reach here deliberately** — they are
        // instructions about memory, and the consumer is where they mean something. **Re-reading the words here rather
        // than threading a value from the check keeps one reader of the owner's text.**
        control: memoryControlIn(turn.ownerText),
        // **THE THIRD THING THE ENGINE COLLECTED AND NOBODY READ.** *`lensAnswers` says what the turn attended to; this
        // says which of her own memories she was shown, and at what standing.* **Without it the spoken contract has no
        // subject: `checkSpokenMemory` would return a clean turn for every reply ever spoken, because an empty handle
        // list refuses nothing and an absent one is indistinguishable from a turn that recalled nothing.**
        memoryInjected: turn.memoryInjected,
        // **THE CHECK THAT HAD NO CALLER, RUN WHERE THE REPLY AND THE HANDLES ARE BOTH IN HAND.** *It cannot withhold a
        // reply that has already been spoken — but it can notice, and until tonight it could not even do that.*
        spokenMemory: checkSpokenMemory(turn.text, turn.memoryInjected),
      })
      // **THE PER-REPLY MANIFEST, WRITTEN BESIDE THE EVENT AND FROM THE SAME TWO SOURCES.**
      //
      // **ONE TURN, ONE IDENTITY.** `replyIdOf(sessionId, record.turn)` is the SAME key the event above carries and
      // KIRA dedupes on — `turn` is the model-request line's own position, **a property of the file rather than of any
      // process, so it survives a restart and means the same thing to a verifier reading the store a week later.**
      // AK-UI, on why the id must be produced here rather than guessed by the link: *"a link that guesses would
      // attribute one reply's prompt to another."*
      //
      // **THE ATTENTION COMES FROM `turn.lensAnswers`, WHICH THE ENGINE NOW CARRIES OUT.** Every entry has the frame it
      // was shown under, and — where a lens answered rather than the engine refusing — a digest taken by the component
      // that held the bytes. **A VERIFIER CAN THEREFORE CHECK THAT WHAT THE VIEW SHOWS IS WHAT WAS ACTUALLY HELD**,
      // which is the difference between evidence and a description of it.
      const items = turn.lensAnswers
        // **AN ARM THAT DID NOT ANSWER CARRIES NO DIGEST AND IS NOT AN ITEM.** The inline refusals the engine writes
        // are sentences about nothing being available; listing them as attention would show her having read something
        // when the record says she did not. **Dropping them is a claim, and it is the true one.**
        .filter(answer => answer.result.sha256 !== undefined)
        .map(answer => ({
          id: answer.result.request,
          sha256: answer.result.sha256 ?? '',
          source: answer.frame,
          // **OUTSIDE WORDS ARE THE ONES THAT CAME FROM OUTSIDE.** A recall answer is her own settled memory; a
          // repository read, a web read and a weights change are all things that arrived from beyond this turn.
          outsideWords: answer.frame !== 'RECALL',
        }))
      appendReplyManifest({
        dshHome: stateHome,
        manifest: {
          replyId: replyIdOf(turn.sessionId, record.turn),
          at,
          // **AN EMPTY LIST IS THE TRUTH WHEN NOTHING WAS READ**, and the view renders it as such rather than as a
          // gap — which is why the group is present and empty rather than absent.
          groups: [{ block: 'attention', items }],
          ...(turn.lensAnswers.length === 0 ? {} : {}),
        },
      })
    },
    reportRecordFailure: (error) => {
      ctx.logger.warn(`Auma Live model dispatch blocked because its session record failed: ${String(error)}`)
    },
    ...(repoLens === undefined ? {} : { repoLens, repoLensLookups: config.repoLensLookups }),
    // WHAT AUKORA IS, FROM ITS OWN PACKET. The reviewer packet, the claims page and the printed ceilings are
    // read through the SAME read-only lens, so the packet inherits its rules — tracked files only,
    // secret-shaped names withheld by name, paths contained — instead of growing a second way to read this
    // repository. `lensForClaims` is a const because the narrowing of `repoLens` does not survive into a
    // closure, and this closure runs on every spoken turn.
    ...(lensForClaims === undefined ? {} : {
      // **ONE READ PER WINDOW, SHARED BY EVERY TURN INSIDE IT.** `readClaimsPacket` walks this repository
      // through the lens, and the status of a repository is not a per-turn fact.
      claimsPacket: lensCache(
        () => readClaimsPacket({ read: (path: string) => lensForClaims.answer(path) })
          .then(packet => packet.text),
      ).get,
    }),
    // Policy reaches the engine even without an organism home. Both optional lenses consult it before
    // reading state/memory or returning cached text; the engine still admits every declared disclosure.
    ...organismDisclosureDependencies({
      disclosurePolicy: () => readOwnerPolicy(policyText().text),
      disclosureRecipient: process.env.AUKORA_DISCLOSURE_RECIPIENT ?? 'openrouter.ai',
      ...(config.organismDshHome.length === 0 ? {} : {
        // The state document stays uncached so its staleness verdict uses the current age.
        // Failed authorised reads still return the lens's explicit INDETERMINATE text.
        organismStateLens: async () => stateHome === null
          ? 'INDETERMINATE — no state home is configured on this Host, so the organism document was not looked for.'
          : (await organismStateLens({ stateDir: stateHome })).lines.join('\n'),
        // Share the expensive organism read across concurrent turns, with the policy gate outside the cache.
        organismLens: lensCache(
          async () => organismLensText({
            dshHome: path.resolve(config.organismDshHome),
            repo: path.resolve(config.organismRepo.length > 0 ? config.organismRepo : config.repoLensRoot),
            // Resolve memory and session events when the authorised read runs, never at mount.
            memory: await readOrganismMemory(ctx),
            eventsOf: (sessionId) => ctx.sessions.get(sessionId as SessionId)?.snapshotEvents() ?? [],
          }),
        ).get,
      }),
    }),
    ...(webLens === undefined ? {} : { webLens, webLensLookups: config.webLensLookups }),
    // **THE HOME SESSION IS PASSED SO RECALL CAN BE SCOPED TO IT.** `recallLookups` bounded how MANY lookups a turn
    // could make but not WHOSE turn it was — so a lane's session, or anything else reaching this route, could pull
    // the owner's settled memories into its prompt. **The store is his; the session it is quoted into need not be.**
    // An empty home means every session is "other" and recall stays off, which is the refuse-closed direction.
    ...(recall === undefined ? {} : { recall, recallLookups: config.recallLookups }),
    homeSession,
    ...(weights === undefined ? {} : { weights, weightsVerbs: config.weightsControlVerbs }),
    // Resolved per restore: the durable backend may load after this plugin.
    resolveSessionPersistence: () => ctx.get('sessionPersistence'),
    // **THE TWO FACTS THE STATUS STRIP CANNOT GET ANYWHERE ELSE.** `coreSessionId` is this plugin's own config and
    // the spend gate is an instance created in this function, so no other plugin can answer for either. Both are
    // reads: whether a session exists, and the gate's own numbers for the UTC day it tracks.
    // **UNCONFIGURED IS FALSE; CONFIGURED-BUT-NOT-LOADED IS UNKNOWN.** Codex r1 finding 4: this used to answer
    // `false` for both, so a COLD CORE — one named in the config but not yet in the session store — was reported
    // as not existing. Those are different facts and the payload has a shape for the second: `null` travels and
    // `coreFactOf` turns it into `{ known: false }`, which carries no `exists` at all.
    coreExists: () => (config.coreSessionId.length === 0
      ? false
      : (ctx.sessions.get(config.coreSessionId as SessionId) !== undefined ? true : null)),
    spendToday: () => ({
      spentTodayUsd: spendGate.spentToday(),
      capUsd: spendGate.capUsd(),
      day: utcDay(Date.now()),
    }),
    /**
     * WHAT HER NEXT TURN WOULD CARRY, FROM FACTS THIS PROCESS ALREADY HOLDS.
     *
     * **`readLanes`, NOT `readOrganism`.** The lens renders the same lanes, but it also runs `git log`, `git status`
     * and `gh run list` — three subprocesses per call — and a status strip polls. The projection rows are plain
     * file reads and the approvals are the session store's own events, so this is cheap enough to ask repeatedly
     * and cannot start a process at all.
     *
     * A fact that cannot be read IS NOT FILLED IN: `readLanes` reports its own missing source, a session with no
     * events yields no approval, and every field the payload cannot determine travels as `known: false`.
     */
    statusFacts: () => {
      // `memory` HAS NO DEFAULT in `readLanes`, so it is REQUIRED — passing only `dshHome` was a type error,
      // and the lanes' summaries are the memory view's business, not this route's.
      const read = readLanes({ dshHome: path.resolve(config.organismDshHome), memory: null })
      const sessionLive = config.homeSession === ''
        ? null
        : ctx.sessions.get(config.homeSession as SessionId) !== undefined
      return {
        homeSession: config.homeSession,
        homeLive: sessionLive,
        lanes: read.lanes.map(lane => {
          const events = ctx.sessions.get(lane.sessionId as SessionId)?.snapshotEvents() ?? []
          const open = unansweredApprovalOf(events)
          return {
            lane: lane.lane, title: lane.title, running: lane.running, goal: lane.goal,
            ...(open === null ? {} : { waitingOnOwner: { summary: open.summary, at: open.at } }),
          }
        }),
        // RESOLVED BY A PATH SCAN, NOT BY RUNNING THEM: asking `which codex` would start a process on a status
        // read, and a status route that spawns is not read-only in the sense that matters.
        hands: {
          codex: handResolvable('codex'),
          claude: handResolvable('claude'),
        },
        wake: lastWakeDecision,
      }
    },
    spokenMemoryReach: config.spokenMemoryReach,
    // THE GATE ITSELF IS BUILT ABOVE, ONCE PER PROCESS — see the note where the binding is made.
    spendGate,
    // **A RESOLVER, NOT A SERVICE, AND THAT IS THE WHOLE POINT.** `ctx.get` is consulted on EVERY lookup, so a
    // memory re-mounted after this face started is seen on the next call; capturing the service here would leave
    // the lens answering confidently from a service object that had since been replaced.
    // **TWO RESOLVERS, EACH CONSULTED ON EVERY LOOKUP.** The first is her memory; the second is the CHAIN that
    // says whether a record still sits where it claims to. Neither is captured: a citation answered from a
    // service held since mount would report the verdict of the first lookup forever, and nothing about it would
    // look wrong. `ctx.get` returns undefined when nothing provides `aura.cite`, and that is a NAMED refusal
    // rather than an absent citation — a record with nothing to check must not read as verified.
    kiraLens: new KiraLens(
      () => ctx.get('kira.recall'),
      () => ctx.get('aura.cite') as { cite?: (recordId: string) => Promise<unknown> } | undefined,
      sessionId => ctx.sessions.get(sessionId as SessionId),
    ),
    ...(config.offeredMinds.length === 0 ? {} : { offeredMinds: config.offeredMinds }),
    ...(config.privateMindLabel.length === 0
      ? {}
      : { mindLabels: { [config.privateMindKey]: config.privateMindLabel } }),
    ...(config.privateMindModel.length === 0
      ? {}
      : {
        extraMinds: {
          [config.privateMindKey]: {
            model: config.privateMindModel,
            endpoint: config.privateMindEndpoint,
            ...(config.privateMindApiKeyEnv.length === 0
              ? {}
              : { apiKeyEnv: config.privateMindApiKeyEnv }),
            ...(config.privateMindTurnSuffix.length === 0
              ? {}
              : { turnSuffix: config.privateMindTurnSuffix }),
            maxTokens: config.privateMindMaxTokens,
            ...(config.privateMindDisableThinking ? { disableThinking: true } : {}),
            ...(config.privateMindDisableTemplateThinking ? { disableTemplateThinking: true } : {}),
            ...(config.privateMindRunsOn.length === 0 ? {} : { runsOn: config.privateMindRunsOn }),
          },
        },
      }),
  })
  const routes = [
    { kind: 'prefix', path: '/app', handler: assetHandlers.serveStockAppFile },
    { kind: 'exact', path: '/assets/aumara-icon-96.png', handler: assetHandlers.serveAukoraIcon },
    // The same bytes under the path the shell's own components ask for. Deep shipped
    // this file in its web app's public root; this composition runs the harness's web
    // app, which has no such file, so the mark 404s in the brand row and in every
    // thread row unless the plugin that owns the bytes serves that path too.
    { kind: 'exact', path: '/branding/aumara-icon-96.png', handler: assetHandlers.serveAukoraIcon },
    { kind: 'exact', path: '/stock-apps/auma-lingwa.html', handler: assetHandlers.serveLingwaEntry },
    { kind: 'exact', path: '/stock-apps/auma-live.html', handler: assetHandlers.serveAumaLiveEntry },
    { kind: 'prefix', path: '/stock-apps/zeta-harp', handler: assetHandlers.serveZetaHarpFile },
    { kind: 'prefix', path: '/stock-apps/dakini-code', handler: assetHandlers.serveDakiniCodeFile },
    { kind: 'prefix', path: '/stock-apps/human-graph', handler: assetHandlers.serveHumanGraphFile },
    { kind: 'exact', path: '/api/auma-live/chat/recent', handler: liveHttp.recentChat.bind(liveHttp) },
    // THE FIELD'S OWN REPORT. Without a route the renderer's `field-degraded` posts went nowhere, so a
    // degradation left no record behind — and a limit that does not print did not happen.
    { kind: 'exact', path: '/api/auma-live/field-degraded', handler: liveHttp.fieldDegraded.bind(liveHttp) },
    { kind: 'exact', path: '/api/auma-live/minds', handler: liveHttp.availableMinds.bind(liveHttp) },
    // WHAT HER NEXT TURN WOULD CARRY. Read-only and behind the same door as `minds`, for the status strip and the
    // acceptance runner — which previously had no way to check the lens or the wake at all.
    { kind: 'exact', path: '/api/auma-live/status', handler: liveHttp.aumaLiveStatus.bind(liveHttp) },
    { kind: 'exact', path: '/api/auma-live/presence/stream', handler: liveHttp.presence.bind(liveHttp) },
  ] as const
  // EVERY ROUTE GATES ITSELF, BECAUSE NOTHING ELSE WILL. The harness applies the launch
  // token check per route through `connection.requestRejection`; a route that skips it
  // is open to any process on this machine. Before this, every path in the table above
  // was — including /api/auma-live/chat/recent, which serves transcript text. The
  // app bundles and the icon ride the same gate: they load inside the authenticated
  // page, so the cookie is already on every one of those requests.
  const gate = (): RouteGate => Reflect.get(ctx, 'connection') as RouteGate
  const gated = (route: (typeof routes)[number]): WebRoute => ({
    kind: route.kind,
    path: route.path,
    handler: (req, res) => {
      const rejection = gate().requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.setHeader('cache-control', 'no-store')
        res.end()
        return
      }
      return route.handler(req, res)
    },
  })
  routes.forEach((route) => {
    ctx.effect(() => ctx.webServer.register(gated(route)), `ui-stock-apps: ${route.path}`)
  })
  if (config.voiceEnabled) {
    const voiceProxy = new VoiceWebSocketProxy(config.voicePort)
    const voiceSupervisor = new VoiceSidecarSupervisor({
      port: config.voicePort,
      autoStart: config.voiceAutoStart,
      runtimeDirectory: config.voiceRuntimeDirectory.length === 0 ? '' : path.resolve(config.voiceRuntimeDirectory),
      // THE VOICE LINES GO TO server.log AS WELL AS TO THE PLUGIN LOGGER. `<state>/logs/server.log` is the
      // launcher's redirect of this child's stdout, so a line a person needs to read — "browser voice
      // fallback active" — has to be printed, not only logged. Before this it was a sentence nothing wrote.
    }, { subprocess: ctx.subprocess, logger: voiceLogger(ctx.logger) })
    ctx.effect(() => ctx.webServer.registerUpgrade({
      path: '/stock-apps/auma-live/voice',
      // The upgrade carries the browser's cookies too, and a socket that proxies audio
      // to the local sidecar is not something an unauthenticated process may open.
      handler: (req, socket, head) => {
        const rejection = gate().requestRejection(req)
        if (rejection !== undefined) {
          socket.write(`HTTP/1.1 ${rejection} ${rejection === 401 ? 'Unauthorized' : 'Forbidden'}\r\nconnection: close\r\n\r\n`)
          socket.destroy()
          return
        }
        voiceProxy.handle(req, socket, head)
      },
    }), 'ui-stock-apps: Auma Live voice WebSocket')
    ctx.effect(() => () => voiceProxy.close(), 'ui-stock-apps: Auma Live voice proxy')
    ctx.effect(() => {
      voiceSupervisor.start()
      return () => voiceSupervisor.stop()
    }, 'ui-stock-apps: Auma Live voice sidecar')
  }
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    // **ONLY A LANE'S OWN FINISH MAY WAKE HER, AND THAT HAD TO BE SAID OUT LOUD.** This listener saw EVERY session's
    // events, so CORE's own `turn/end` was indistinguishable from a lane finishing — **the wake woke itself**, and
    // each wake is a spend against the same cap the wake exists to respect. A session that `readLanes` does not
    // return is not a lane; CORE's session and her HOME session are named and excluded even if they ever appear
    // there, because a wake queued into the session that is doing the waking is a loop, not a notification.
    // **`coreBusy` CLEARS WHEN CORE FINISHES, NOT WHEN THE PROMPT IS ACCEPTED.** The dispatch's `finally` fires as
    // soon as `prompt()` resolves — which is when the task was QUEUED, not when CORE stopped working — so a second
    // wake could fire while CORE was still mid-turn and spend a slot against a cap that was still in use.
    //
    // **AND THE `finally` STAYS.** It is the backstop for a dispatch that fails before CORE ever starts, and a flag
    // left set by a failed dispatch closes the door on every later wake — **the ceiling becoming a permanent
    // silence, which is the failure mode that looks exactly like nothing having finished.** Clearing on `turn/end`
    // is earlier and truer; the `finally` is what guarantees it always clears at all.
    if (config.coreSessionId !== '' && session.id === config.coreSessionId && event.type === 'turn/end') {
      coreBusy = false
    }
    const laneIds = new Set(
      readLanes({ dshHome: path.resolve(config.organismDshHome), memory: null }).lanes.map(entry => entry.sessionId),
    )
    if (!laneIds.has(session.id) || session.id === config.coreSessionId || session.id === config.homeSession) return
    const wakeNote = crossLane.observeSessionEvent(session.id, event)
    // **A LANE FINISHING IS THE ONLY THING THAT WAKES HER WITHOUT PETER.** `observeSessionEvent` records a note she
    // reads at her NEXT turn — which, at 3 a.m., is when he next speaks, hours later, and the stack of verified
    // cards the plan promises never forms. The wake asks CORE to look and draft; **it never sends**, because the
    // reason for the wake is a lane's own words and a wake is therefore always tainted.
    if (wakeNote?.kind === 'finished') {
      const decision = wakeDecision({
        note: wakeNote, now: Date.now(), lastWakeAt: lastWakeAt,
        coreConfigured: config.coreSessionId.length > 0,
        coreUsedToday: coreLens.usedToday,
        coreDailyCap: config.coreDailyCap,
        coreBusy,
      })
      lastWakeDecision = {
        wake: decision.wake === true,
        refused: typeof decision.refused === 'string' ? decision.refused : null,
        at: Date.now(),
        lane: wakeNote.lane,
        // **THE TARGET IS RECORDED EVEN WHEN NOTHING IS QUEUED**, so a reader can see that the wake had nowhere to
        // go rather than inferring it from an absent field.
        target: config.homeSession === '' ? null : config.homeSession,
        delivered: false,
      }
      // **THE SAME FINISH DOES NOT WAKE HER TWICE.** Checked before anything is dispatched, because the guard has to
      // cover the spend as well as the prompt.
      const wakeKey = wakeKeyOf(String(session.id), event.type, event.time)
      const fresh = isFreshWake(wakeKey, lastWakeKey)
      if (decision.wake && !fresh) {
        lastWakeDecision.wake = false
        lastWakeDecision.refused = 'already-woken-for-this-event'
      }
      if (decision.wake && fresh) {
        lastWakeAt = Date.now()
        lastWakeKey = wakeKey
        coreBusy = true
        // **THE WAKE GOES INTO HER HOME SESSION, WHICH IS THE SESSION SHE IS ACTUALLY IN.** The dispatch below
        // asks CORE to look and draft — and CORE is a conductor, not the place Peter is reading. **A wake that only
        // reaches CORE puts the result somewhere she is not**, so the lane's completion is also queued as a prompt
        // into `homeSession`, where the next turn she takes will carry it.
        //
        // **THE CONTROLLER IS RESOLVED PER CALL, NOT CAPTURED.** It was read inside the same expression that used
        // it, so a wake that fired during a reload could hold a dead reference; reading it here means each wake
        // asks the context for the live service.
        // **THE SIGNATURE TAKES A SIGNAL, AND THIS CAST SAID IT DID NOT.** The other cast in this file (`:503`)
        // declares `prompt: (r: unknown, s: AbortSignal) => Promise<unknown>` — **two parameters** — and upstream
        // calls `signal.throwIfAborted()` on it **synchronously**, so a one-argument call throws before the prompt is
        // ever queued. **The throw landed in a `.catch` that swallows everything, so the observable behaviour was a
        // lane finishing and nothing happening** — which is the failure mode that looks exactly like no wake being
        // due.
        const controller = ctx.get('sessionController') as {
          prompt?: (input: { requestId: string; sessionId: string; mode: string; content: unknown[] }, signal: AbortSignal) => Promise<unknown>
        } | undefined
        if (config.homeSession === '' || controller?.prompt === undefined) {
          // **NOTHING WAS QUEUED, SO NO CORE TURN WILL START AND NO `turn/end` WILL COME.** Clearing here is what
          // keeps a refusal from becoming a permanent silence.
          coreBusy = false
        }
        if (config.homeSession !== '' && controller?.prompt !== undefined) {
          void controller.prompt({
            // **THE REQUEST ID IS DERIVED FROM THE EVENT, NOT FRESH.** A `randomUUID()` here meant a re-delivery of
            // the same finish produced a DIFFERENT request, so **anything downstream that dedupes by request id saw
            // two wake requests for one event** — the guard above is this file's, and this makes the identity travel
            // with the request rather than being invented at the point of sending.
            //
            // **DERIVED RATHER THAN PASSED RAW**, so the id keeps whatever shape the controller expects while still
            // being a function of the event: the same finish yields the same id, byte for byte.
            requestId: `wake-${createHash('sha256').update(wakeKey).digest('hex').slice(0, 32)}`,
            sessionId: config.homeSession,
            mode: 'queue',
            // **THE MACHINE FRAME IS APPLIED HERE.** `wakeBlock` existed and had NO CALLER anywhere in the tree
            // (cohesion row 10), so the wake carried the bare task text with nothing saying who was speaking.
            // The frame is what marks this as machine speech about a lane's finish rather than an instruction from
            // the owner, and the nonce is the SAME event identity the request id derives from, so one finish
            // yields one frame.
            content: [{ type: 'text', text: `${wakeBlock(decision, wakeNote.lane, wakeKey)}\n${decision.task}` }],
          }, AbortSignal.timeout(30_000))
            // **`delivered` IS THE FACT THAT SEPARATES A REFUSAL FROM A FAILURE.** Without it, a queue that threw
            // and a decision not to wake both read as `wake: true, delivered: false` — and the failed one is what an
            // operator most needs to see.
            .then(() => { if (lastWakeDecision !== null) lastWakeDecision.delivered = true })
            .catch(() => {
              // **A FAILED DISPATCH TOO.** The prompt threw, so no turn started and the `turn/end` will never come.
              coreBusy = false
            })
        }
        // **THE CORE DISPATCH IS GONE, AND THAT IS THE POINT** (Codex review, item 2). Both HOME and CORE were
        // receiving a prompt for one lane finish: **the wake went to her home AND asked CORE to look, so one event
        // produced two turns in two sessions** — and the CORE turn is the one that could spend, speak, or act on a
        // note that is tainted by construction, because the reason for the wake is a lane's own words.
        //
        // **HOME-ONLY WAKING IS THE DESIGN.** The prompt above queues the lane's completion into `homeSession`, which
        // is the session she is actually in; **CORE is a conductor, not a place Peter reads, and a wake that reaches
        // it puts nothing where he is.** Removing the dispatch removes the second turn, the second spend, and the
        // second session that could act.
        //
        // **AND `coreBusy` NOW CLEARS ON THE HONEST EVENTS RATHER THAN ON SETTLEMENT** (item 1). The unconditional
        // `finally` fired when the prompt was QUEUED, not when CORE stopped working — **so a second wake could fire
        // while CORE was mid-turn and spend a slot against a cap still in use.** With no dispatch here, the flag is
        // set for the duration of the CORE turn and cleared by the matching `turn/end` above; a dispatch that was
        // REFUSED or FAILED never started a turn, so it clears the flag itself rather than leaving the door shut —
        // **a flag left set closes every later wake, and that silence looks exactly like nothing having finished.**
      }
    }
  }, { global: true })
}
