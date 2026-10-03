/** Automatic tracked memory. Historical operator config fields remain readable for migration only. */
import { KiraConversation, KiraConversationError } from './conversation.mjs'
import { projectScopeOf, projectRecent, rememberedSnippet, visibleRemembered } from './project-memory.mjs'
import { registerRecallInjection, recallDiagnostics } from './injection.mjs'
import { recallFilter } from './memory-frame.mjs'
import { laneForSession, readReflectFor } from './compaction-export-hook.mjs'
import { sessionIdOfAgent } from './autostage-hook.mjs'
import { registerRememberedCapture } from './memory-remembered-hook.mjs'
import { registerAumaTurnCapture } from './memory-auma-hook.mjs'
import { buildRouteDeps } from './memory-deps.mjs'
import { NOT_LINKED, UNLINKED_SUBJECT, mountKiraRoutes, mountUnlinkedKiraRoutes } from './memory-mount.mjs'
import { makeRecordRanker } from './memory-frame-adapter.mjs'
import { mergedReadOwner } from './memory-recall-owner.mjs'
import {
  recordKind,
  KIRA_RECALL_TOOL,
  KIRA_SETTLEMENT,
  KIRA_SETTLEMENT_AVAILABLE,
  KIRA_SETTLEMENT_UNAVAILABLE,
  KIRA_STAGE_TOOL,
  settlementStatus,
  MEMORY_PUT_KEY_SHAPE,
  KiraStageError,
} from './record.mjs'
import { createMemoryOwner } from './memory-owner.mjs'
import { loadReadOwner, readOwnerPolicy, readOwnerSnapshot } from './read-owner.mjs'
import { provideKiraRecall } from './recall-service.mjs'
// §10.2's ceilings travel with every recall reply, and THIS is the module allowed to name them: `recall-service.mjs` has no imports at all, by design and by court.
import { RECALL_CEILINGS } from './memory-tiers.mjs'
import { provideKiraCite } from './cite-service.mjs'
import { RETRIEVAL_LIMITS, RETRIEVAL_OPTIONS } from './retrieval.mjs'
import { recallRemembered, recallTool } from './tools.mjs'
import { createOpenVikingRecall, openVikingHome, readBridgeConfig, semanticNotes } from './recall-openviking.mjs'
import { createPartialFailureLedger, PARTIAL_FAILURE_SERVICE, reconcileRecallAvailability, rememberedWithLedger } from './partial-failure.mjs'
import { countDrop, governRecords, recallAnnotations } from './recall-filter/filter.mjs'
import { createTrackedMemory, readTrackedMemory } from './tracked-memory.mjs'
import { captureRoom, defaultRoomLog } from './room-capture.mjs'
import { readCaptureEventStreamed } from './session-read.mjs'
import { verifyRecord } from './memory-verify.mjs'

/** Cordis plugin name. */
export const name = 'aukora-kira'

/** This plugin consumes the harness tool registry. */
export const inject = ['tools', 'sessions']

/** The only retrieval implementation this build runs. */
export const IMPLEMENTED_RETRIEVAL = 'lexical'

/** Default bound on simultaneously live retrieval sessions. */
export const DEFAULT_MAX_SESSIONS = 16

/** A named configuration refusal; every refusal carries one stable code. */
export class KiraConfigError extends Error {
  /** Stable machine-readable refusal code, e.g. `kira.config:retrieval-not-implemented`. */
  code

  /**
   * @param {string} code - stable refusal code suffix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`kira.config: ${message}`)
    this.name = 'KiraConfigError'
    this.code = `kira.config:${code}`
  }
}

/**
 * @param {string} code @param {string} message @returns {never}
 */
function refuse(code, message) {
  throw new KiraConfigError(code, message)
}

/**
 * Validate and default the plugin configuration.
 *
 * A composition that names an unimplemented retrieval option fails here rather
 * than degrading silently, and the refusal carries the whole migration
 * inventory so the option cannot be dropped from a migration unnoticed.
 *
 * @param {unknown} config - composition-supplied configuration.
 * @returns {Readonly<{retrieval: string, maxSessions: number, readOwner: Readonly<{module: string, options?: unknown}>}>} normalized config.
 */
export function readConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    refuse('config-not-plain', 'configuration must be one plain data record')
  }
  const record = /** @type {Record<string, unknown>} */ (config)
  for (const key of Object.keys(record)) {
    if (!['retrieval', 'readOwner', 'memoryOwner', 'maxSessions', 'autoStage'].includes(key)) {
      refuse('config-field-unknown', `configuration carries a field outside retrieval, readOwner, memoryOwner, maxSessions, autoStage`)
    }
  }
  if (record.autoStage !== undefined && typeof record.autoStage !== 'boolean') refuse('config-autostage', 'autoStage must be a boolean')
  const retrieval = record.retrieval ?? IMPLEMENTED_RETRIEVAL
  if (typeof retrieval !== 'string' || !RETRIEVAL_OPTIONS.some(option => option.id === retrieval)) {
    refuse(
      'retrieval-unknown',
      `unknown retrieval option ${JSON.stringify(retrieval)}; the migration inventory is `
        + RETRIEVAL_OPTIONS.map(option => `${option.id}=${option.status}`).join(', '),
    )
  }
  if (retrieval !== IMPLEMENTED_RETRIEVAL) {
    refuse(
      'retrieval-not-implemented',
      `retrieval option ${JSON.stringify(retrieval)} is enumerated as `
        + `${RETRIEVAL_OPTIONS.find(option => option.id === retrieval)?.status} and is not deployed by this build; `
        + `the migration inventory is ${RETRIEVAL_OPTIONS.map(option => `${option.id}=${option.status}`).join(', ')}`,
    )
  }
  const maxSessions = record.maxSessions ?? DEFAULT_MAX_SESSIONS
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 1024) {
    refuse('max-sessions-invalid', 'maxSessions must be an integer between 1 and 1024')
  }
  // Exactly one owner source. `readOwner.module` supplies a read surface the
  // composition already trusts; `memoryOwner` makes this plugin construct the
  // admitted memory owner itself, over a state directory. Both at once would be
  // two answers to "whose memory is this", so it is refused rather than ranked.
  const hasModuleOwner = record.readOwner !== undefined
  const hasMemoryOwner = record.memoryOwner !== undefined
  if (hasModuleOwner && hasMemoryOwner) {
    refuse('owner-ambiguous', 'configuration carries both readOwner and memoryOwner; name exactly one')
  }
  if (hasMemoryOwner) {
    const memory = record.memoryOwner
    if (memory === null || typeof memory !== 'object' || Array.isArray(memory)) {
      refuse('memory-owner-invalid', 'memoryOwner must be a plain object')
    }
    const memoryRecord = /** @type {Record<string, unknown>} */ (memory)
    for (const key of Object.keys(memoryRecord)) {
      if (!['stateDir', 'subject', 'policyRevision', 'permittedPrivacy', 'grantFile', 'approvalFile', 'approverDid', 'activeControlDigest', 'queueDir'].includes(key)) {
        refuse('memory-owner-field-unknown',
          'memoryOwner carries a field outside stateDir, subject, policyRevision, permittedPrivacy, grantFile, approvalFile, approverDid, activeControlDigest, queueDir')
      }
    }
    if (typeof memoryRecord.stateDir !== 'string' || memoryRecord.stateDir === '') {
      refuse('memory-owner-invalid', 'memoryOwner.stateDir must be a non-empty path')
    }
    if (typeof memoryRecord.subject !== 'string' || memoryRecord.subject === '') {
      refuse('memory-owner-invalid', 'memoryOwner.subject must be a non-empty string: the owner supplies the subject, never the model')
    }
    // Historical operator fields are accepted for overlay compatibility, never required for memory.
    return Object.freeze({
      retrieval,
      maxSessions,
      memoryOwner: Object.freeze({
        stateDir: memoryRecord.stateDir,
        subject: memoryRecord.subject,
        approvalFile: memoryRecord.approvalFile,
        ...(memoryRecord.queueDir === undefined ? {} : { queueDir: memoryRecord.queueDir }),
        ...(memoryRecord.approverDid === undefined ? {} : { approverDid: memoryRecord.approverDid }),
        ...(memoryRecord.activeControlDigest === undefined ? {} : { activeControlDigest: memoryRecord.activeControlDigest }),
        policyRevision: typeof memoryRecord.policyRevision === 'string' ? memoryRecord.policyRevision : 'policy-1',
        permittedPrivacy: Object.freeze(
          Array.isArray(memoryRecord.permittedPrivacy) && memoryRecord.permittedPrivacy.length > 0
            ? [...memoryRecord.permittedPrivacy]
            : ['local'],
        ),
        ...(typeof memoryRecord.grantFile === 'string' && memoryRecord.grantFile !== ''
          ? { grantFile: memoryRecord.grantFile }
          : {}),
      }),
    })
  }
  const readOwner = record.readOwner
  if (readOwner === null || typeof readOwner !== 'object' || Array.isArray(readOwner)) {
    refuse('read-owner-missing', 'configuration must carry a readOwner or a memoryOwner: Kira holds no store route of its own')
  }
  const ownerRecord = /** @type {Record<string, unknown>} */ (readOwner)
  for (const key of Object.keys(ownerRecord)) {
    if (!['module', 'options'].includes(key)) {
      refuse('read-owner-field-unknown', 'readOwner carries a field outside module, options')
    }
  }
  if (typeof ownerRecord.module !== 'string' || ownerRecord.module === '') {
    refuse('read-owner-module-invalid', 'readOwner.module must be a non-empty module specifier')
  }
  return Object.freeze({
    retrieval,
    maxSessions,
    readOwner: Object.freeze({
      module: ownerRecord.module,
      ...(ownerRecord.options === undefined ? {} : { options: ownerRecord.options }),
    }),
  })
}

/**
 * Register the Kira tools against one injected read owner.
 *
 * @param {Readonly<Record<string, unknown>>} ctx - Cordis context carrying the tool registry.
 * @param {unknown} config - composition-supplied configuration.
 * @returns {Promise<void>} resolves once both tools are registered.
 */
export async function apply(ctx, config) {
  const normalized = readConfig(config)
  // ── NOT LINKED YET: MEMORY STAYS OFF, POLITELY, AND SAYS SO ─────────────────────────────────────
  // A fresh install carries the release's placeholder subject until the desktop's first Aumlok link
  // writes the per-install `kira-deployment-overlay.patch.yml`. Building a memory owner over the
  // placeholder refuses SUBJECT_INVALID and the row "did not activate"; instead nothing is built, no
  // tool is registered, and every memory route answers one named state the Memory view shows.
  if (normalized.memoryOwner !== undefined && normalized.memoryOwner.subject === UNLINKED_SUBJECT) {
    ctx.logger?.warn?.(`aukora-kira: memory is off until an Aumlok phrase is linked (${NOT_LINKED.error})`)
    ctx.inject(['webServer', 'connection'], (web) => {
      const mounted = mountUnlinkedKiraRoutes(web)
      if (mounted.mounted.length > 0) ctx.emit?.('kira.memory-mounted', { routes: mounted.mounted, linked: false })
    })
    return
  }
  // The action gate reads this trusted, per-agent handoff immediately before a consequential tool.
  // It is intentionally not put into model-written tool arguments.
  const partialFailureState = createPartialFailureLedger()
  if (typeof ctx.provide === 'function') ctx.provide(PARTIAL_FAILURE_SERVICE, partialFailureState)

  // Normal memory uses the remembered chain and the deployment's plain data policy.
  // Explicit readOwner modules retain their isolated historical compatibility path.
  const memoryOwner = normalized.memoryOwner
  const owner = memoryOwner === undefined ? await loadReadOwner(normalized.readOwner) : {
    describe: async () => ({ subject: memoryOwner.subject, policyRevision: memoryOwner.policyRevision,
      permittedPrivacy: memoryOwner.permittedPrivacy }),
    read: async () => {
      const live = readTrackedMemory(memoryOwner.stateDir)
      return { availability: live.complete ? (live.notes.length ? 'found' : 'empty') : 'undetermined',
        records: live.notes.filter(note => note.subject === memoryOwner.subject && memoryOwner.permittedPrivacy.includes(note.privacy)) }
    },
  }
  // Fail at mount, not at first call: a read owner that cannot describe its own
  // policy is a configuration fault, and an operator must see it on load. The
  // policy itself is deliberately not retained here — every turn reacquires it,
  // so a stale subject or privacy set can never be served from plugin state.
  readOwnerPolicy(await owner.describe())

  /** The store's readers for recall, or an empty set with a reason when the deployment's store cannot be reached at all. */
  const storeDepsForRecall = () => {
    try {
      return buildRouteDeps({ stateDir: normalized.memoryOwner.stateDir, sessionsRoot: String(normalized.memoryOwner.stateDir).replace(/\/[^/]+$/u, ''), approverDid: normalized.memoryOwner.approverDid, readOwner: owner })
    } catch (error) {
      ctx.logger?.warn?.(`aukora-kira: recall will answer without the remembered store (${String(error?.code ?? error?.message ?? 'unknown')})`)
      return {}
    }
  }

  let memory, memoryConfig
  const memoryFor = () => {
    if (!normalized.memoryOwner) return undefined
    const config = readBridgeConfig(openVikingHome(normalized.memoryOwner.stateDir))
    const key = JSON.stringify(config)
    if (!memory || key !== memoryConfig) {
      memoryConfig = key
      memory = createTrackedMemory({ stateDir: normalized.memoryOwner.stateDir, subject: normalized.memoryOwner.subject, config,
        policyOf: async () => {
          const policy = readOwnerPolicy(await owner.describe())
          return { subject: policy.subject, privacy: policy.permittedPrivacy.includes('local') ? 'local' : null }
        } })
    }
    return memory
  }
  const recallContext = agent => ({ sessionId: sessionIdOfAgent(agent), attachedProjects: [projectScopeOf(agent)].filter(Boolean) })
  // Every Room post joins tracked memory on the same tick, whichever program posted it; a failed pass never blocks the index.
  const roomLog = defaultRoomLog()
  const semanticIndex = () => void Promise.resolve().then(async () => {
    const store = memoryFor()
    if (!store) return
    await captureRoom(store, { stateDir: normalized.memoryOwner.stateDir, room: roomLog })
      .catch(() => ctx.logger?.warn?.('aukora-kira: room capture pending retry'))
    return store.retry()
  }).catch(() => ctx.logger?.warn?.('aukora-kira: memory indexing pending retry'))
  const initialRetry = normalized.memoryOwner ? setImmediate(semanticIndex) : null
  initialRetry?.unref?.()
  const retryTimer = normalized.memoryOwner ? setInterval(semanticIndex, 30_000) : null
  retryTimer?.unref?.()
  ctx.effect(() => () => { if (initialRetry) clearImmediate(initialRetry); if (retryTimer) clearInterval(retryTimer) }, 'aukora-kira: memory index retry')
  const withSemanticForget = deps => ({ ...deps, forgetNote: async args => {
    const answer = await deps.forgetNote(args)
    if (!answer.forgotten) return answer
    const result = await memoryFor().bridge.forget(String(answer.id))
    return { ...answer, openviking: { removed: result.reached === true },
      ...(result.reached ? {} : { notReached: [...(answer.notReached ?? []), { what: 'openviking', because: result.because }] }) }
  } })
  const rememberedFor = async (listNotes, text, agent, preTurn = false, report = { dropped: 0, reasons: {} }, lexical = false) => {
    const store = memoryFor()
    if (!store) return recallRemembered(listNotes, text, 5)
    const result = await store.recall({ question: text, context: recallContext(agent), lexical })
    Object.assign(report, result.memory)
    return result
  }
  const publishRecall = async (answers, agent, report, preTurn = false) => {
    if (!memoryFor()) return answers
    const policy = readOwnerPolicy(await owner.describe())
    const live = memoryFor().read()
    const checked = new Map(governRecords(live.notes, { ...policy, ...recallContext(agent), nowMs: Date.now(),
      forgotten: live.forgotten, states: live.states }, report).map(note => [note.id, note]))
    return answers.map(answer => {
      if (!answer) return answer
      const project = notes => (notes ?? []).flatMap(shown => {
        const note = checked.get(String(shown.id ?? shown.recordId))
        if (!note) return []
        if (preTurn && !recallFilter(note, { now: new Date().toISOString(), states: live.states, ...recallContext(agent) }).ok) return []
        return [{ ...shown, ...recallAnnotations(note) }]
      })
      return { ...answer, snippets: project(answer.snippets), memory: report,
        ...(answer.remembered ? { remembered: { ...answer.remembered, notes: project(answer.remembered.notes) } } : {}) }
    })
  }

  // ── `kira.recall`: THE READ-ONLY DOOR ONTO THE MEMORY ──────────────────────
  // PROVIDED OVER THE READ OWNER, NEVER OVER THE MEMORY OWNER: the read owner already decides the subject,
  // the permitted privacy classes, and whether a damaged store reports `undetermined` instead of `empty`. The
  // service module imports NOTHING, so it has no way to reach a stage or a settle path even by mistake.
  //
  // DEFERRED AND GUARDED, because `owner.describe()` is async and a service that cannot be mounted must cost
  // a warning rather than the whole plugin: a deployment without a read owner still boots.
  void (async () => {
    try {
      const policy = readOwnerPolicy(await owner.describe())
      // *** FABLE'S ITEM (4): PASS `rank`. *** Without it `kira.recall` answered in the owner's own order however the
      // question was asked — the defect kira-119 fixed in the tool and left here, on the service the face actually reads.
      // *** BOTH TIERS, ONE READ: the remembered store AND the deployment's own owner. *** Item (3)'s second half — a
      // recall that read only the settled store would hide every note the capture hook writes, which is all of them.
      if (memoryOwner && typeof ctx.provide === 'function') {
        ctx.provide('kira.recall', Object.freeze({
          describe: () => ({ ...policy, grantsAuthority: false }),
          read: async () => ({ status: 'match', records: memoryFor().read().notes }),
          recall: async (question, session) => {
            // The face may pass a live host Session, never client-authored scopes or owner claims. Identity with
            // the current session store also refuses stale objects after a remount and lookalike metadata.
            const hostSession = typeof session?.id === 'string' && ctx.sessions?.get?.(session.id) === session ? session : undefined
            const result = await memoryFor().recall({ question: typeof question === 'string' ? question : question?.text ?? '',
              context: hostSession ? recallContext({ session: hostSession }) : {} })
            return { ...result, status: result.state === 'found' ? 'match' : result.state, records: result.notes }
          },
          citeRemembered: async (recordId, session) => {
            const unverified = reason => ({ verdict: 'UNVERIFIED', namespace: 'kira.remembered', reason })
            if (typeof recordId !== 'string' || !/^rem:[0-9a-f]{64}$/u.test(recordId)) return unverified('record-id-invalid')
            try {
              const eligible = async () => {
                const currentPolicy = readOwnerPolicy(await owner.describe())
                const hostSession = typeof session?.id === 'string' && ctx.sessions?.get?.(session.id) === session ? session : undefined
                const live = readTrackedMemory(memoryOwner.stateDir)
                const note = governRecords(live.notes, { ...currentPolicy,
                  ...(hostSession ? recallContext({ session: hostSession }) : {}), nowMs: Date.now(),
                  forgotten: live.forgotten, states: live.states }, { dropped: 0, reasons: {} }).find(note => note.id === recordId)
                return { live, note }
              }
              let { live, note } = await eligible()
              if (!note) return unverified('record-unavailable')
              const event = await readCaptureEventStreamed({ stateRoot: String(memoryOwner.stateDir).replace(/\/[^/]+$/u, ''), source: note.source })
              // Reacquire object, policy and host scope after the asynchronous source read.
              ;({ live, note } = await eligible())
              if (!note) return unverified('record-unavailable')
              const index = live.chain.findIndex(entry => entry.id === recordId && ['add', 'remember'].includes(entry.op))
              const entry = live.chain[index]
              if (!Number.isSafeInteger(index) || index < 0 || entry.index !== index || note.aura?.index !== index
                || entry.contentHash !== note.contentHash || !/^[0-9a-f]{64}$/u.test(entry.entryHash)) return unverified('remembered-chain-binding-invalid')
              const checked = verifyRecord(note, () => event?.line, () => entry.entryHash)
              if (checked.source !== 'VERIFIED') return unverified(`source-${checked.source.toLowerCase()}`)
              return { verdict: 'VERIFIED', namespace: 'kira.remembered', recordId, index,
                entryHash: entry.entryHash, contentHash: note.contentHash, sourceSha256: note.source.sha256 }
            } catch { return unverified('remembered-verification-unavailable') }
          },
        }))
        return
      }
      const outcome = provideKiraRecall(ctx, {
        // AND THE STORE DEPS ARE BUILT HERE, IN A GUARD, BECAUSE `buildRouteDeps` REFUSES A MISSING HOME ON PURPOSE
        // (item 2's ladder) — and a recall service that threw would provide NOTHING, silently, because the whole block is
        // inside a guarded async IIFE. A missing home must make recall say `undetermined` with its reason, not vanish.
        owner: mergedReadOwner({ storeDeps: storeDepsForRecall(), owner, logger: ctx.logger }),
        policy,
        logger: ctx.logger,
        rank: makeRecordRanker(),
        // *** §10.2: "Ceilings (printed in service replies, the app's More section and the docs)". *** Injected here for the same reason the ranker is: the service file
        // has no imports at all, so the list has to come from a module that is allowed to name it. This is the caller that makes the constant real — and the comment
        // twenty lines above this one records what happened the LAST time an option was accepted here and dropped.
        ceilings: RECALL_CEILINGS,
      })
      if (outcome.provided !== true) ctx.logger?.warn?.(`kira.recall not provided: ${String(outcome.reason)}`)
    } catch (error) {
      ctx.logger?.warn?.(`kira.recall: ${error?.message ?? 'unknown'}`)
    }
  })()

  // ── `aura.cite`: THE DOOR THAT SAYS WHETHER A CITATION ACTUALLY VERIFIES ────────────────────────
  // MEASURED 2026-09-25 (AUMA): `aura.cite` was ABSENT ON EVERY REAL COMPOSITION. The module shipped —
  // `createCiteService` has been there, with its chain check — and no composition ever provided it, so the
  // three consumers that already ask for it by name got nothing:
  //   · `plugins/aukora-board/lib/index.js`      `resolveCite: () => ctx.reflect.get('aura.cite', false)`
  //   · `plugins/aukora-face/apps/lib/index.js`  `KiraLens(() => ctx.get('kira.recall'), () => ctx.get('aura.cite'))`
  //   · `plugins/aukora-organism/lib/lane-memory.mjs`  reports `CITE_NOT_CHECKED` when the door is missing
  // A missing door is not neutral: a reader that cannot ask whether the chain still verifies will either
  // skip the question or answer it from the store's own claim, and the store's citation is a POINTER.
  //
  // IT NEEDS THE STORE'S stateDir, WHICH THE READ OWNER DOES NOT CARRY — citing walks the store's own
  // `aura.jsonl` — so this door is provided only when the composition named a store, and a composition
  // without one is TOLD SO by name rather than served a door onto a directory nobody named. The subject and
  // the permitted privacy come from the READ OWNER, exactly as they do for `kira.recall`: the read owner
  // decides what may be seen, and this door must not widen that.
  if (normalized.memoryOwner !== undefined) {
    const citeStateDir = normalized.memoryOwner.stateDir
    void (async () => {
      try {
        const policy = readOwnerPolicy(await owner.describe())
        const outcome = provideKiraCite(ctx, {
          stateDir: citeStateDir,
          subject: policy.subject,
          permittedPrivacy: policy.permittedPrivacy,
          createMemoryOwner,
          logger: ctx.logger,
        })
        if (outcome.provided !== true) ctx.logger?.warn?.(`aura.cite not provided: ${String(outcome.reason)}`)
      } catch (error) {
        ctx.logger?.warn?.(`aura.cite: ${error?.message ?? 'unknown'}`)
      }
    })()
  } else {
    ctx.logger?.warn?.('aura.cite not provided: no-store — memoryOwner names no store, so there is no chain '
      + 'to cite from; a composition that wants citations must name one')
  }

  const captureStateDir = typeof normalized.memoryOwner?.stateDir === 'string' ? normalized.memoryOwner.stateDir : null
  if (captureStateDir === null) {
    ctx.logger?.warn?.('aukora-kira: remembered capture NOT registered — this composition names a readOwner and no memoryOwner, so it has no store root to write remembered notes into (refused: no-state-dir). Reading still works through the read owner.')
  } else {
  const capturePolicyOf = async () => {
    const policy = readOwnerPolicy(await owner.describe())
    const permitted = Array.isArray(policy.permittedPrivacy) ? policy.permittedPrivacy : []
    return { subject: policy.subject, privacy: permitted.includes('local') ? 'local' : null }
  }
  registerRememberedCapture(ctx, {
    stateDir: captureStateDir,
    sessionsRoot: String(normalized.memoryOwner.stateDir).replace(/\/[^/]+$/u, ''),
    policyOf: capturePolicyOf,
    memory: memoryFor,
    logger: ctx.logger,
    onRemembered: info => { ctx.logger?.info?.(`aukora-kira: remembered ${String(info.remembered)} note(s) from ${info.sessionId} turn ${String(info.turn)}`); semanticIndex() },
  })
  // ── AUMA LIVE TURNS, BESIDE THE TEXT-CHAT CAPTURE (2026-09-27) ────────────────────────────────────────────────
  // `registerAumaTurnCapture` was built and never registered: the apps face emits `auma/turn-finished` for every heard
  // voice turn, and nothing listened, so no spoken turn ever reached memory. Same store, same policy, same logger.
  // A refusal here (a context that cannot subscribe) costs a warning, never the whole mount.
  try {
    registerAumaTurnCapture(ctx, {
      stateDir: captureStateDir,
      policyOf: capturePolicyOf,
    memory: memoryFor,
      logger: ctx.logger,
      onRemembered: info => { ctx.logger?.info?.(`aukora-kira: remembered ${String(info.remembered)} note(s) from Auma Live ${info.sessionId} turn ${String(info.turn)}`); semanticIndex() },
    })
  } catch (error) {
    ctx.logger?.warn?.(`aukora-kira: Auma Live capture NOT registered (${String(error?.code ?? error?.message ?? 'unknown')})`)
  }
  }


  // ── RECALL REACHES A FRESH CONTEXT WITHOUT BEING ASKED FOR ──────────────────────────────────────
  // Measured 2026-09-21: a child agent inherits the workspace, the organs and memory reach and starts
  // blind on the conversation. Asked to call `kira_recall` it returned the record; asked what it could
  // see it said nothing was visible. Nothing was broken — nothing had told it to ask, and with no
  // `ctx.on` here no configuration could have. This is the subscription that fixes that.
  //
  // IT HOLDS THE READ OWNER AND NOTHING ELSE. `createReadOwner`'s contract is "reads spend nothing …
  // consults no grant, touches no nonce store, and cannot mutate", so an injection path cannot become a
  // write path. It also cannot widen the policy: the owner was built above with the composition's own
  // subject and `permittedPrivacy`, and it refuses a widened subject or an unpermitted class before
  // this module sees anything.
  //
  // A FAILURE HERE MUST NOT BREAK A TURN. `registerRecallInjection` contains every read fault and
  // contributes a named fault snapshot while preserving the delegate's decision kind.
  const recallConversation = memoryOwner ? { turn: async () => ({ availability: 'empty', status: 'empty', snippets: [] }) }
    : new KiraConversation(owner, 'recall-injection', undefined)
  registerRecallInjection(ctx, {
    conversation: recallConversation,
    remembered: memoryOwner === undefined ? undefined : async (text, event) => {
      const scope = projectScopeOf(event?.agent)
      const deps = storeDepsForRecall()
      const reply = await rememberedFor(deps.recallCandidates, text, event?.agent, true)
      const policy = readOwnerPolicy(await owner.describe())
      const live = deps.liveRemembered()
      const notes = visibleRemembered(live.notes, policy, scope)
      const diagnostics = recallDiagnostics(reply)
      const context = { now: new Date().toISOString(), attachedProjects: scope === null ? [] : [scope], states: live.states }
      const byId = new Map(notes.filter(note => {
        const verdict = recallFilter(note, context)
        if (!verdict.ok) diagnostics.diagnostics.push({ reason: verdict.why })
        return verdict.ok
      }).map(note => [note.id, note]))
      for (const reason of ['unreadable', 'unchained']) if (live[reason] > 0) diagnostics.diagnostics.push({ reason, count: live[reason] })
      const unavailable = !['found', 'empty'].includes(reply.state) || live.unreadable > 0 || live.unchained > 0
      const snippets = (reply.notes ?? []).filter(note => byId.has(note.id)).map(note => rememberedSnippet(byId.get(note.id)))
      return { availability: unavailable ? 'undetermined' : snippets.length > 0 ? 'found' : 'empty', ...diagnostics, snippets }
    },
    ...(memoryOwner ? { newest: async () => ({ availability: 'empty', snippets: [] }) } : {}),
    beforePublish: (reply, recent, event) => publishRecall([reply, recent], event?.agent, { dropped: 0, reasons: {} }, true),
    // ── LANE-KEYED INJECTION ───────────────────────────────────────────────────
    // ONE PLUGIN SERVES EVERY LANE, so the lane is resolved PER TURN from the agent's own session. A lane
    // fixed at registration would ask AURA's question inside AUMLOK's session and seed the wrong thread.
    // THE READER IS THE HOOK'S OWN, IMPORTED — `readReflect()` was a name in nobody's scope, so this supplier threw a
    // ReferenceError on every turn and the lane never resolved.
    lane: (event) => laneForSession(readReflectFor(ctx), sessionIdOfAgent(event?.agent)),
    // AND THE SEED IS THE LANE'S OWN LAST SETTLED SUMMARY — a READ, so it is awaited, and empty when the store
    // cannot supply one: a lane with no settled summary yet still gets the fixed cues rather than nothing.
    laneSeed: async (resolved) => {
      if (typeof resolved !== 'string' || resolved === '') return ''
      try {
        if (typeof owner?.read !== 'function') return ''
        const answer = await owner.read()
        const records = Array.isArray(answer?.records) ? answer.records : []
        const mine = records.filter((one) => String(one?.content?.thread?.lane ?? '').toUpperCase() === resolved)
        const newest = mine[mine.length - 1]
        return typeof newest?.content?.summary === 'string' ? newest.content.summary : ''
      } catch { return '' }
    },
    // Clear the previous turn's healthy result before delegating to downstream pre-step listeners.
    onTurnStart: agent => partialFailureState.failure(agent),
    onFailure: (_error, event) => partialFailureState.failure(event?.agent),
    onRecalled: (reply, recent, event) => partialFailureState.record(event?.agent, {
      outer: reply?.partialFailure || (recent?.availability === 'undetermined' && recent.reason !== 'host-project-scope-unavailable') ? 'undetermined' : reply?.availability,
      remembered: 'not-asked',
    }),
  })

  /** @type {Map<string, {conversation: KiraConversation, scope: string, kind: string, agent: object | null}>} */
  const sessions = new Map()
  /** @type {WeakMap<object, number>} */
  const agentIds = new WeakMap()
  let nextAgentId = 1
  /** Monotonic insertion counter; the eviction order, independent of clock or map order. */
  let sequence = 0
  /** @type {Map<string, number>} */
  const order = new Map()

  /** @param {object | undefined} agent @returns {string} */
  const agentKey = (agent) => {
    if (agent === undefined || agent === null || (typeof agent !== 'object' && typeof agent !== 'function')) return 'host'
    const existing = agentIds.get(/** @type {object} */ (agent))
    if (existing !== undefined) return `agent:${existing}`
    const assigned = nextAgentId
    nextAgentId += 1
    agentIds.set(/** @type {object} */ (agent), assigned)
    return `agent:${assigned}`
  }

  /**
   * Resolve the live session for one execution, creating or evicting as needed.
   * @param {Readonly<Record<string, unknown>>} exec - tool execution context.
   * @param {string} kind - optional record-kind narrowing.
   * @returns {KiraConversation} the session for this execution.
   */
  const sessionFor = (exec, kind) => {
    const scope = agentKey(/** @type {object | undefined} */ (exec?.agent))
    const key = `${scope}\u0000${kind}`
    const live = sessions.get(key)
    if (live !== undefined) {
      sequence += 1
      order.set(key, sequence)
      return live.conversation
    }
    while (sessions.size >= normalized.maxSessions) {
      let oldest
      let oldestAt = Number.POSITIVE_INFINITY
      for (const [candidate, at] of order) {
        if (at < oldestAt) { oldestAt = at; oldest = candidate }
      }
      if (oldest === undefined) break
      // Eviction disposes the session rather than parking it: a session that is
      // no longer reachable must not be able to publish a late result.
      sessions.get(oldest)?.conversation.close()
      sessions.delete(oldest)
      order.delete(oldest)
    }
    const conversation = new KiraConversation(owner, scope, kind === '' ? undefined : kind)
    sequence += 1
    order.set(key, sequence)
    sessions.set(key, { conversation, scope, kind, agent: null })
    return conversation
  }

  const registry = /** @type {{register: (definition: unknown) => unknown}} */ (
    /** @type {Record<string, unknown>} */ (ctx)['tools']
  )
  if (registry === undefined || typeof registry.register !== 'function') {
    refuse('tool-registry-missing', 'the injected tools service does not provide register()')
  }

  // Disposal prevents late publication. Cordis unwinds effects in reverse
  // registration order, so the tool registrations (registered below, each tied
  // to this fiber's lifetime by `tools.register`) are removed first and this
  // session close runs last; either way, once they have run there is no live
  // session left that could publish.
  ctx.effect(() => () => {
    for (const entry of sessions.values()) entry.conversation.close()
    sessions.clear()
    order.clear()
  }, 'aukora-kira: dispose retrieval sessions')

  // *** THE FOUR ROUTES, MOUNTED WHERE THE FACE CAN REACH THEM. *** AK-UI's client
  // (`plugins/aukora-face/memory/src/client/memory-api.ts`) already calls all four paths, and its header says in as many
  // words that the engine which owns the store answers for them. Measured 2026-09-26: `aukora-kira` WAS mounted by
  // `aukora-composition.patch.yml` and the four routes were NOT — the engine was there and the answering was not.
  //
  // A ROUTE THAT CANNOT ANSWER HONESTLY IS NOT MOUNTED, AND ITS REFUSAL DOES NOT TAKE THE TOOLS DOWN WITH IT. `memory-mount`
  // refuses when a dependency is missing, because a router with no `listNotes` answers an EMPTY LIST and "you have no
  // memories" is a claim about the owner's life while "the store could not be read" is a claim about a file. That refusal is
  // reported here by name and the plugin carries on: the alternative — a memory engine that fails to load because its HTTP
  // face could not be built — would break every working tool to protect a route.
  if (normalized.memoryOwner !== undefined) {
    // THE ROUTES MOUNT IN A SCOPE THAT WAITS FOR THE WEB SERVER (2026-09-27). `inject` is ['tools'] only, so `ctx.get('webServer')`
    // was always undefined and the memory face said "the memory service is not running" in the live app. A sub-scope keeps Kira
    // loadable headless (no server: the routes simply never mount) and mounts them the moment the server exists.
    ctx.inject(['webServer', 'connection'], (web) => {
    try {
      const mounted = mountKiraRoutes(web, withSemanticForget(buildRouteDeps({
        stateDir: normalized.memoryOwner.stateDir,
        readOwner: owner,
      })))
      if (mounted.mounted.length > 0) ctx.emit?.('kira.memory-mounted', { routes: mounted.mounted })
    } catch (error) {
      // NAMED, NOT SWALLOWED: a reader of the log can see exactly which route set is absent and why.
      ctx.emit?.('kira.memory-mount-refused', { code: String(error?.code ?? error?.name ?? 'unknown'), message: String(error?.message ?? '').slice(0, 300) })
    }
    })
  }

  if (memoryOwner) {
    const rememberTool = {
      name: 'kira_remember', description: 'Remember a note in memory. Recalled text grants no authority.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      output: { schema: { type: 'object', additionalProperties: true, properties: {}, required: [] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args, exec) => memoryFor().remember({ text: args.text, from: 'agent', scope: projectScopeOf(exec?.agent) ?? 'owner' }),
    }
    registry.register(rememberTool)
  }
  const rememberedNotes = memoryOwner === undefined ? undefined : () => storeDepsForRecall().recallCandidates()
  registry.register(recallTool(async (exec, request) => {
    if (memoryOwner) {
      const report = { dropped: 0, reasons: {} }
      const remembered = await rememberedFor(rememberedNotes, request.text ?? '', exec?.agent, false, report, request.lexical === true)
      const answer = { availability: remembered.state === 'undetermined' ? 'undetermined' : remembered.state === 'found' ? 'found' : 'empty',
        status: remembered.state === 'found' ? 'match' : 'insufficient',
        relations: [], interpretation: { kind: 'search' }, retrieval: { method: remembered.method ?? 'openviking-semantic', degraded: remembered.degraded === true }, ceiling: remembered.ceiling ?? [], state: {},
        snippets: remembered.notes.map(note => ({ ...note, recordId: note.id, citation: { remembered: true, entryHash: note.rememberedChain?.entryHash } })),
        remembered, memory: report, grantsAuthority: false }
      partialFailureState.record(exec?.agent, { outer: answer.availability, remembered: remembered.state })
      return answer
    }
    const kind = typeof request.kind === 'string' ? request.kind : ''
    if (kind !== '' && !recordKind.includes(/** @type {never} */ (kind))) {
      throw new KiraConversationError('query-kind-invalid', `kind must be one of ${recordKind.join(', ')}`)
    }
    const conversation = sessionFor(exec, kind)
    const signal = /** @type {AbortSignal | undefined} */ (exec['signal'])
    let answer
    try {
      answer = await conversation.turn(request, signal ?? new AbortController().signal)
      const governed = { dropped: 0, reasons: {} }
      const remembered = typeof request.text !== 'string' || request.text === '' ? undefined
        : await rememberedFor(rememberedNotes, request.text, exec?.agent, false, governed, request.lexical === true)
      ;[answer] = await publishRecall([{ ...answer, ...(remembered === undefined ? {} : { remembered }) }], exec?.agent, governed)
      // PHASE 9: reconcile remembered.state with outer availability — never attach an
      // undetermined ambient picture beside a found governed answer without downgrading.
      const result = typeof request.text !== 'string' || request.text === ''
        ? answer
        : reconcileRecallAvailability(answer, answer.remembered)
      partialFailureState.record(exec?.agent, result?.partialFailure ?? {
        outer: result?.availability,
        remembered: 'not-asked',
      })
      return result
    } catch (error) {
      // A failed recall invalidates the last healthy result before the error reaches the caller.
      partialFailureState.failure(exec?.agent)
      throw error
    }
  }))
}

/** Re-exported so tests and owners share one vocabulary and one refusal class. */
export {
  KIRA_RECALL_TOOL,
  KIRA_SETTLEMENT,
  KIRA_STAGE_TOOL,
  recordKind,
  KiraConversationError,
  KiraStageError,
  MEMORY_PUT_KEY_SHAPE,
  RETRIEVAL_LIMITS,
  RETRIEVAL_OPTIONS,
}
