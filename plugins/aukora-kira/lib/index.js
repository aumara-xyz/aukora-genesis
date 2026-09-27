/**
 * AUKORA Kira — a stock DSH host plugin for deterministic memory staging and
 * cited, bounded conversational retrieval.
 *
 * Mount it as a composition row and give it a read owner:
 *
 * ```yaml
 * - id: aukora-kira
 *   name: ./plugins/aukora-kira/lib/index.js
 *   config:
 *     retrieval: lexical
 *     readOwner:
 *       module: ./owners/auma-memory-owner.mjs
 *       options: {}
 * ```
 *
 * The read owner is the only thing that decides whose memory is read and which
 * privacy classes are visible. This plugin holds no subject, no store path, no
 * key, no grant, and no authority route, and it never writes memory: `kira_stage`
 * returns an inert proposal for the admitted memory path to carry.
 *
 * A `memoryOwner` configuration ALSO names two operator documents, and both are
 * mandatory: `grantFile`, this installation's one-use authorization, and
 * `approvalFile`, the owner's signed approval for the exact content. Mounting
 * without either is refused rather than degraded, because a write tool that could
 * load without an approval route is the defect the approval path exists to close.
 *
 * @module @aukora/dsh-plugin-kira
 */
import { KiraConversation, KiraConversationError } from './conversation.mjs'
import { registerRecallInjection } from './injection.mjs'
import { laneForSession, readReflectFor } from './compaction-export-hook.mjs'
import { sessionIdOfAgent } from './autostage-hook.mjs'
import { registerAutoStage } from './autostage-hook.mjs'
import { registerRememberedCapture } from './memory-remembered-hook.mjs'
import { registerAumaTurnCapture } from './memory-auma-hook.mjs'
import { registerCompactionExport } from './compaction-export-hook.mjs'
import { readForbiddenDigests } from './forbidden-digests.mjs'
import { autoStageCandidate } from './autostage.mjs'
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
import { DID_KEY_SHAPE } from './approval.mjs'
import { loadReadOwner, readOwnerPolicy } from './read-owner.mjs'
import { provideKiraRecall } from './recall-service.mjs'
// §10.2's ceilings travel with every recall reply, and THIS is the module allowed to name them: `recall-service.mjs` has no imports at all, by design and by court.
import { RECALL_CEILINGS } from './memory-tiers.mjs'
import { provideKiraCite } from './cite-service.mjs'
import { RETRIEVAL_LIMITS, RETRIEVAL_OPTIONS } from './retrieval.mjs'
import { queueTool, recallTool, settleTool, stageTool } from './tools.mjs'

/** Cordis plugin name. */
export const name = 'aukora-kira'

/** This plugin consumes the harness tool registry. */
export const inject = ['tools']

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
    // AN ADMITTED MEMORY OWNER WITHOUT AN APPROVAL ROUTE IS REFUSED AT MOUNT.
    //
    // This is the configuration form of the defect this increment fixes. Before it, a composition
    // could offer `kira_settle` with a grant file alone, and a grant is minted by whatever runs
    // `bin/kira-grant.mjs` — including the turn that wants the write. Naming a memoryOwner and no
    // approval file is that same shape one level up, and it must not load: a build that cannot
    // obtain an owner approval must not offer a write tool, and must say why rather than degrade.
    if (typeof memoryRecord.approvalFile !== 'string' || memoryRecord.approvalFile === '') {
      refuse('memory-owner-approval-unconfigured',
        'memoryOwner must name approvalFile: settlement requires a verified owner approval for the exact content, '
        + 'and a composition that names no approval route would offer a write nothing can authorize. '
        + 'Produce the file with the approval command (the Aumlok owner approval channel; a labelled stand-in of '
        + 'that shape exists until it lands) and name it here.')
    }
    if (typeof memoryRecord.grantFile !== 'string' || memoryRecord.grantFile === '') {
      refuse('memory-owner-grant-unconfigured',
        'memoryOwner must name grantFile: an operator command mints the one-use grant, and this plugin holds no key '
        + 'and mints nothing. Name the file the operator command writes.')
    }
    // THE PIN, WHEN NAMED. A composition that knows its registered approver key names it here, and an
    // approval signed by any other key is refused by name. It is optional because a disposable store
    // has no registered key; naming a value that is not a `did:key` is refused rather than ignored.
    if (memoryRecord.approverDid !== undefined
      && (typeof memoryRecord.approverDid !== 'string' || !DID_KEY_SHAPE.test(memoryRecord.approverDid))) {
      refuse('memory-owner-approver-invalid',
        'memoryOwner.approverDid must be a did:key identifier (did:key:z…) naming the registered approver key')
    }
    // ── THE CONTROL HEAD, SO A SETTLEMENT CAN BE PINNED RATHER THAN MERELY REPORTED ───────────────
    // This is the plumbing half of "supported, unenforced". The library refuses a stale control head
    // and the tool reports `controlPinned` — but until the composition SUPPLIES a head, every live
    // settlement is unpinned and `controlPinned: false` is the honest answer rather than an enforced
    // one. Accepting the field here is what lets a deployment name the head it serves.
    //
    // OPTIONAL, and malformed is REFUSED rather than ignored — the same discipline as `approverDid`
    // above, and for the same measured reason: a caller who mistyped a pin must get a usage fault, not
    // the weaker check. Shape only; whether the head is CURRENT is decided at settlement against the
    // artifact, never here.
    if (memoryRecord.activeControlDigest !== undefined
      && (typeof memoryRecord.activeControlDigest !== 'string' || !/^[0-9a-f]{64}$/.test(memoryRecord.activeControlDigest))) {
      refuse('memory-owner-control-invalid',
        'memoryOwner.activeControlDigest must be a 64-character lowercase hex sha256 naming the control head this deployment serves')
    }
    // ── THE PENDING REVIEW QUEUE, AND WHY IT IS OPT-IN ────────────────────────────────────────────
    // Naming `queueDir` is what makes `kira_stage` leave a durable entry behind for a person to
    // review. It is opt-in rather than a new default because WITHOUT it staging is inert by contract —
    // "this tool wrote nothing" is a ceiling printed on every un-queued stage result and asserted by
    // courts — and flipping that silently would turn a true sentence into a false one for every
    // composition that never asked for a queue.
    //
    // MALFORMED IS REFUSED, NOT IGNORED — the same discipline as `approverDid` and
    // `activeControlDigest` above, and for the same measured reason: a caller who mistyped a queue path
    // must get a usage fault rather than a build that quietly stages nothing and looks reviewed-clean.
    if (memoryRecord.queueDir !== undefined
      && (typeof memoryRecord.queueDir !== 'string' || memoryRecord.queueDir === '')) {
      refuse('memory-owner-queue-invalid',
        'memoryOwner.queueDir must be a non-empty path when supplied; omit it to leave staging inert with no review queue')
    }
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
  // One owner instance when `memoryOwner` is configured: the same store backs
  // both the governed write and the read path, which is what makes a settled
  // record recallable in the same session.
  const memoryOwner = normalized.memoryOwner === undefined
    ? undefined
    : createMemoryOwner({
        stateDir: normalized.memoryOwner.stateDir,
        // *** FABLE'S ITEM (7): THE FIELDS `readConfig` REQUIRES WERE VALIDATED AND THEN DROPPED HERE. *** `readConfig` refuses a
        // memoryOwner without `grantFile` and `approvalFile`, and the owner was then built with `stateDir` alone — so the owner
        // held no grant and no approval to verify against, and settlement could never have succeeded on a real deployment. A
        // value that is checked in one place and not passed in another is worse than an unchecked one: the refusal says the
        // configuration is complete.
        ...(normalized.memoryOwner.queueDir === undefined ? {} : { queueDir: normalized.memoryOwner.queueDir }),
        ...(normalized.memoryOwner.subject === undefined ? {} : { subject: normalized.memoryOwner.subject }),
        ...(normalized.memoryOwner.grantFile === undefined ? {} : { grantFile: normalized.memoryOwner.grantFile }),
        ...(normalized.memoryOwner.approvalFile === undefined ? {} : { approvalFile: normalized.memoryOwner.approvalFile }),
        ...(normalized.memoryOwner.approverDid === undefined ? {} : { approverDid: normalized.memoryOwner.approverDid }),
        ...(normalized.memoryOwner.activeControlDigest === undefined ? {} : { activeControlDigest: normalized.memoryOwner.activeControlDigest }),
      })
  const owner = memoryOwner === undefined
    ? await loadReadOwner(normalized.readOwner)
    : memoryOwner.createReadOwner({
        subject: normalized.memoryOwner.subject,
        policyRevision: normalized.memoryOwner.policyRevision,
        permittedPrivacy: normalized.memoryOwner.permittedPrivacy,
      })
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

  // ── THE PENDING REVIEW QUEUE, WHEN THE COMPOSITION NAMED ONE ────────────────────────────────────
  // The owner holds the filesystem route; this entry only decides whether the queue exists for this
  // build at all. It is one handle, so staging and listing cannot disagree about where the queue is or
  // what an entry looks like — an enqueue and a listing that read different directories would be the
  // exact split that makes a staged record invisible to the person reviewing it.
  const pendingQueue = memoryOwner === undefined || normalized.memoryOwner.queueDir === undefined
    ? undefined
    : Object.freeze({
        enqueuePending: staged => memoryOwner.enqueuePending(staged),
        // THE DECLINE WRITER, because superseding a lane's older summary must mark it DECLINED rather than
        // delete it. One handle, so a stage and a decline cannot disagree about where the queue is.
        writeDeclined: memoryPut => memoryOwner.writeDeclined(memoryPut),
        list: () => memoryOwner.listPending(),
        read: recordId => memoryOwner.readPending(recordId),
      })

  // ── AUTO-STAGING, AND ONLY WHEN THERE IS SOMEWHERE TO STAGE TO ──────────────────────────────────
  // A candidate with no queue would have nowhere to wait, so the listener is registered only with one:
  // a hook that read every finishing turn's ask in order to throw it away would be pure cost on the
  // hot path of every turn in the app.
  //
  // The subject and privacy come from the READ OWNER, re-read per turn rather than captured here, so
  // the model cannot widen either and a policy change is picked up without a remount. The candidate is
  // built by the pure classifier and handed straight to the queue, whose `enqueuePending` re-verifies
  // the record against its own identifier before a byte is written.
  // ── REMEMBERED CAPTURE, AT THE SAME BOUNDARY AND FOR THE TIER PETER ASKED FOR ────────────
  // **AND IT IS REGISTERED HERE BECAUSE A HOOK THAT IS BUILT, COURTED AND NOT REGISTERED IS THE DEFECT FABLE CAUGHT THREE
  // TIMES TODAY**: a router with no mount, a ranker with nobody to pass it, a recall frame with no caller. The remembered
  // tier is the one that needs no approval, so it must not be the fourth.
  //
  // `sessionsRoot` IS THE HOME, not the store root and not `<home>/sessions`: the boundary looks for
  // `<root>/sessions/<project>/<id>/session.v3.jsonl.zstd` and appends `sessions` itself. The store root is
  // `<home>/kira-memory`, so the home is its parent — the same relationship the deployment's `dshHomePath` sets up.
  // *** A READOWNER-ONLY COMPOSITION HAS NO STORE ROOT, AND THIS CRASHED ON `undefined.stateDir` AT MOUNT. *** Fable's steps 425/526, found
  // on Linux by two courts that mount the plugin: `readOwner` supplies a READ SURFACE and carries no `stateDir` (only `memoryOwner` is
  // built over a state directory — the normalizer refuses both at once), so `normalized.memoryOwner.stateDir` threw
  // `TypeError: Cannot read properties of undefined (reading 'stateDir')` and NO readOwner composition could mount Kira at all.
  //
  // The remembered tier is written by this plugin, so it needs a store root; the host's read surface is not one and this plugin must not
  // guess at one. So the registration is SKIPPED BY NAME — the same shape as the mount's `refused: ['no-web-server']` — rather than
  // crashing or silently pretending to capture. Everything else in the composition still mounts.
  const captureStateDir = typeof normalized.memoryOwner?.stateDir === 'string' ? normalized.memoryOwner.stateDir : null
  if (captureStateDir === null) {
    ctx.logger?.warn?.('aukora-kira: remembered capture NOT registered — this composition names a readOwner and no memoryOwner, so it has no store root to write remembered notes into (refused: no-state-dir). Reading still works through the read owner.')
  } else {
  const capturePolicyOf = async () => {
    const policy = readOwnerPolicy(await owner.describe())
    const permitted = Array.isArray(policy.permittedPrivacy) ? policy.permittedPrivacy : []
    return { subject: policy.subject, privacy: permitted.includes('local') ? 'local' : String(permitted[0] ?? 'local') }
  }
  registerRememberedCapture(ctx, {
    stateDir: captureStateDir,
    sessionsRoot: String(normalized.memoryOwner.stateDir).replace(/\/[^/]+$/u, ''),
    policyOf: capturePolicyOf,
    logger: ctx.logger,
    onRemembered: info => ctx.logger?.info?.(`aukora-kira: remembered ${String(info.remembered)} note(s) from ${info.sessionId} turn ${String(info.turn)}`),
  })
  // ── AUMA LIVE TURNS, BESIDE THE TEXT-CHAT CAPTURE (2026-09-27) ────────────────────────────────────────────────
  // `registerAumaTurnCapture` was built and never registered: the apps face emits `auma/turn-finished` for every heard
  // voice turn, and nothing listened, so no spoken turn ever reached memory. Same store, same policy, same logger.
  // A refusal here (a context that cannot subscribe) costs a warning, never the whole mount.
  try {
    registerAumaTurnCapture(ctx, {
      stateDir: captureStateDir,
      policyOf: capturePolicyOf,
      logger: ctx.logger,
      onRemembered: info => ctx.logger?.info?.(`aukora-kira: remembered ${String(info.remembered)} note(s) from Auma Live ${info.sessionId} turn ${String(info.turn)}`),
    })
  } catch (error) {
    ctx.logger?.warn?.(`aukora-kira: Auma Live capture NOT registered (${String(error?.code ?? error?.message ?? 'unknown')})`)
  }
  }


  // AUTO-STAGE IS OFF UNLESS A DEPLOYMENT ASKS FOR IT (2026-09-27): it staged memories for a signed approval nobody wants, and
  // it decoded the whole session log on every turn, which grew the backend past the 3.4 GB restart line in 40 minutes.
  if (pendingQueue !== undefined && config?.autoStage === true) {
    registerAutoStage(ctx, {
      stageFromDigest: async (digest) => {
        const policy = readOwnerPolicy(await owner.describe())
        const privacy = policy.permittedPrivacy.includes('local') ? 'local' : policy.permittedPrivacy[0]
        const candidate = autoStageCandidate(digest, policy.subject, privacy)
        if (candidate.category === null) return { staged: false, reason: candidate.reason }
        const queued = pendingQueue.enqueuePending({
          recordId: candidate.recordId,
          record: candidate.record,
          memoryPut: candidate.memoryPut,
        })
        return {
          staged: true,
          recordId: candidate.recordId,
          category: candidate.category,
          queueState: queued.state,
        }
      },
      logger: ctx.logger,
    })
    // ── COMPACTION EXPORT, BESIDE IT AND FOR THE SAME REASON ─────────────────
    // A manual compaction is the thread's own account of what it was doing. With a queue to stage to, it
    // becomes ONE inert summary proposal per compaction — and with no queue, this is not registered at all,
    // exactly as auto-staging is not: a listener that read every compaction in order to throw it away would
    // be pure cost on the hot path of every session.
    // ── THE PROHIBITION'S CONFIGURATION, READ FROM THE STORE'S OWN DIRECTORY ──────────────────────
    // FABLE'S BOOT-RISK REVIEW, 2026-09-25. `FORBIDDEN_WINDOW_DIGESTS` ships EMPTY, and after the Codex sweep an
    // empty list makes every candidate refuse as `not-configured` — right by doctrine, because an empty list used
    // to allow everything while reading as enforced. But registering with that shipped list meant the live app
    // would STOP staging Kira summaries the moment this release went live: memory stops growing, silently, in the
    // safe direction. The digests come from `tools/kira/forbidden-window-digests.mjs`, which the person who owns
    // the phrases runs himself.
    //
    // READ PER COMPACTION, NOT ONCE AT MOUNT, so generating them does not require restarting the app: the hook
    // reads this property on every event, so a getter is what makes it live.
    //
    // A MISSING FILE STAYS NOT-CONFIGURED, AND NAMED: `undefined` here, `not-configured` from the module, and the
    // line below says which command changes that.
    const forbiddenStateDir = normalized.memoryOwner.stateDir
    const forbiddenAtMount = readForbiddenDigests(forbiddenStateDir)
    if (forbiddenAtMount.state === 'configured') {
      ctx.logger?.info?.(`kira: forbidden-phrase digests configured — ${String(forbiddenAtMount.digests.length)} window digest(s)`)
    } else {
      ctx.logger?.warn?.(
        `kira: forbidden-phrase digests are ${forbiddenAtMount.state} — EVERY compaction export will refuse `
        + '(not-configured) until they are generated: node tools/kira/forbidden-window-digests.mjs '
        + `--state-dir ${String(forbiddenStateDir)}`
        + (forbiddenAtMount.detail === undefined ? '' : ` [${forbiddenAtMount.detail}]`))
    }
    registerCompactionExport(ctx, {
      queue: pendingQueue,
      readOwnerPolicy: async () => readOwnerPolicy(await owner.describe()),
      logger: ctx.logger,
      get forbiddenWindowDigests() {
        const read = readForbiddenDigests(forbiddenStateDir)
        // ANY STATE THAT IS NOT `configured` YIELDS `undefined`, which the module treats as unconfigured and
        // refuses. A malformed or empty file therefore cannot become "nothing is forbidden".
        return read.state === 'configured' ? read.digests : undefined
      },
    })
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
  // returns the delegate's decision unchanged — an improvement to a session that can break the session
  // is worse than the absence it repairs.
  const recallConversation = new KiraConversation(owner, 'recall-injection', undefined)
  registerRecallInjection(ctx, {
    conversation: recallConversation,
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
      const mounted = mountKiraRoutes(web, buildRouteDeps({
        stateDir: normalized.memoryOwner.stateDir,
        readOwner: owner,
        // THE QUEUE THIS DEPLOYMENT STAGES INTO, so Forget can remove the auto-staged copy of the same words.
        queueDir: memoryOwner.queueDir,
        // THE PINNED APPROVER, so a settled record is labelled "approved with the pinned key" only when its spent approval names it.
        approverDid: normalized.memoryOwner.approverDid,
        // *** THE OWNER READS THE QUEUE AND RETURNS THE EXACT BYTES — it is the module allowed `node:fs`. ***
        pendingReview: () => memoryOwner.pendingWithBytes(),
        // *** AND THE APPROVAL BECOMES A FROZEN PROPOSAL, NEVER A SETTLE. *** *`settleAuthorized` refuses a store that
        // belongs to another uid, so the agent side has no settle path that writes: the owner's click is submitted to the
        // daemon, the owner answers it in person, and `settleAuthorisedProposal` calls Kira's own settle. ONE CHAIN, AND
        // THIS END HOLDS NO AUTHORITY.*
        // *** A SOCKET THAT WAS NEVER NAMED IS A NAMED REFUSAL, NOT A GUESS AT A PATH. ***
        approvePending: async ({ recordId }) => {
          const socketPath = process.env.AUKORA_OWNER_SUBMIT_SOCKET ?? ''
          if (socketPath === '') {
            return { ok: false, code: 'kira.approve:no-owner-socket',
              because: 'no owner daemon socket was named (AUKORA_OWNER_SUBMIT_SOCKET), so the approval cannot be '
                + 'submitted and nothing was proposed' }
          }
          const pending = memoryOwner.readPending(recordId)
          if (pending?.state !== 'pending') {
            return { ok: false, code: 'kira.approve:not-pending', state: pending?.state ?? 'unknown',
              because: `the queued entry ${String(recordId).slice(0, 12)}… is ${String(pending?.state ?? 'unknown')}, `
                + 'and only a pending entry can be proposed' }
          }
          const { submitProposal, settleBytesFor } = await import('../../aukora-owner-daemon/lib/client.mjs').catch(() => ({}))
          if (typeof submitProposal !== 'function') {
            return { ok: false, code: 'kira.approve:no-client',
              because: 'the owner daemon client could not be loaded, so nothing was proposed' }
          }
          try {
            const frozen = await submitProposal({
              socketPath,
              bytes: settleBytesFor({ intent: 'kira.memory.put', words: pending.entry?.record ?? null, operation: 'memory.put' }),
              operation: 'memory.put',
              scope: normalized.memoryOwner.stateDir,
              ledgerId: recordId,
            })
            return { ok: true, recordId, digest: frozen.digest, nonce: frozen.nonce, expiresAt: frozen.expiresAt,
              because: 'the proposal is frozen and waits for the owner; this end cannot settle it' }
          } catch (error) {
            return { ok: false, code: String(error?.code ?? 'kira.approve:submit-failed'),
              because: String(error?.message ?? error).slice(0, 200) }
          }
        },
      }))
      if (mounted.mounted.length > 0) ctx.emit?.('kira.memory-mounted', { routes: mounted.mounted })
    } catch (error) {
      // NAMED, NOT SWALLOWED: a reader of the log can see exactly which route set is absent and why.
      ctx.emit?.('kira.memory-mount-refused', { code: String(error?.code ?? error?.name ?? 'unknown'), message: String(error?.message ?? '').slice(0, 300) })
    }
    })
  }

  registry.register(stageTool(owner, settlementStatus(memoryOwner !== undefined), undefined, pendingQueue))
  if (memoryOwner !== undefined) {
    // BOTH operator documents are read from the files the composition names, at call time: the model
    // can present an owner's authorization and an owner's approval, and can produce neither. The
    // owner reads the files, because it is the one module permitted a filesystem route; this entry
    // only names the paths.
    const grantFile = normalized.memoryOwner.grantFile
    const approvalFile = normalized.memoryOwner.approvalFile
    registry.register(settleTool(
      memoryOwner,
      () => (grantFile === undefined ? null : memoryOwner.readAuthorization(grantFile)),
      () => memoryOwner.readApproval(approvalFile),
      normalized.memoryOwner.subject,
      // ONLY when the composition pinned one: an absent pin is a stated limit, not a default key.
      normalized.memoryOwner.approverDid,
      // AND THE CONTROL HEAD, the same way: absent means the settlement is UNPINNED and says so via
      // `controlPinned: false`, never that a head was checked. Supplying it is what turns the library's
      // stale-head refusal from unreachable into enforced. LABELLED TEST until an owner enrols — the
      // head this deployment can name today comes from a disposable keyClass-B test key.
      normalized.memoryOwner.activeControlDigest,
    ))
  }
  // ONLY WHEN A QUEUE IS CONFIGURED. A build with no queue has nothing to list, and a listing tool
  // that could only ever answer "nothing here" would make an unconfigured build read as a
  // reviewed-clean one — the same reason `kira_settle` is registered only with a memory owner.
  if (pendingQueue !== undefined) registry.register(queueTool(pendingQueue))
  registry.register(recallTool(async (exec, request) => {
    const kind = typeof request.kind === 'string' ? request.kind : ''
    if (kind !== '' && !recordKind.includes(/** @type {never} */ (kind))) {
      throw new KiraConversationError('query-kind-invalid', `kind must be one of ${recordKind.join(', ')}`)
    }
    const conversation = sessionFor(exec, kind)
    const signal = /** @type {AbortSignal | undefined} */ (exec['signal'])
    return conversation.turn(request, signal ?? new AbortController().signal)
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
