/**
 * AUKORA ACTION GATE: every tool call by every agent session, JUDGED, RECEIPTED, and — for authority actions —
 * ESCALATED to the owner's approval route.
 *
 * ── WHERE IT SITS, AND WHY THIS SEAM ─────────────────────────────────────────────────────────────────────────────
 * It registers ONE global monotonic guard with the harness's own tool runtime, `ctx.tools.guard()`
 * (vendor/dsh packages/core/tools/src/index.ts:1116; built lib/index.js:2919 — "Register a monotonic guard after the
 * extensible `tools/pre-execute` waterfall ... A plain-context guard applies globally"). The registry evaluates it for
 * every call in `prepareExecution` (src :1496; lib :3236 — `decision.kind === 'allow' ? this.guardReason(exec) :
 * decision.reason`), global layer first (src :1125-1127), after the whole pre-execute waterfall (src :1482) and any
 * approval `ask`, and BEFORE `tools/execute` and the tool body. A guard can deny and can never force-allow
 * (`ToolGuard`, src :705-713), so no listener order can resurrect a call this gate refuses. PTC sub-calls (`run_code`
 * dispatching native tools) are executions of the same registry and pass the same guard.
 *
 * Because it PROVIDES NO SERVICE, it cannot collide with `fs-sandbox` the way `aukora-core-read-deny`'s `fs` swap did
 * ("service fs has been registered"). It carries that plugin's CORE rows (policy.mjs `CORE_ROWS`), so the overlay
 * that mounts it (overlays/action-gate.patch.yml) disables the swap and restores `fs-sandbox`, superseding
 * held-read-deny.patch.yml.
 *
 * ── WHO JUDGES A PATH ────────────────────────────────────────────────────────────────────────────────────────────
 * aukora-seed's guard at 9fca7a0, vendored byte for byte in vendor/seed/ (PROVENANCE.json). policy.mjs is
 * a thin adapter: it picks the law and root, and the seed classifies paths. kernel.mjs calls the carried
 * vendor/authority's `decide` with that classification; its status is the gate's verdict.
 *
 * ── THE ONE TOOL IT REGISTERS ─────────────────────────────────────────────────────────────────────────────────────
 * With `worktreesRoot` set it also registers `aukora_self_change` (self-change-tool.mjs), the host-side route by which a
 * contained agent proposes its own code; bash that runs self-change.mjs itself is refused (routes.mjs).
 *
 * ── WHAT A DECISION PRODUCES ─────────────────────────────────────────────────────────────────────────────────────
 * One Aura entry per decision (receipts.mjs), appended and fsync'ed BEFORE an allow is returned. If the receipt cannot
 * be written the call is REFUSED (`receipt:failed`): an allowed call with no record is the one outcome this gate
 * does not produce. A refusal stands whether or not its receipt landed.
 *
 * ── WHAT IT DOES NOT GOVERN (the ceilings, stated here because a reviewer will ask) ─────────────────────────────
 *   - What a process does once started. A shell or `run_code` string is read as TEXT (shell.mjs), with literal write
 *     targets checked only for modeled commands and direct Python/Node calls. Variables, command substitution and
 *     computed paths stay unseen. Script files, aliases, hooks, heredoc bodies, interpreter string escapes and
 *     recursively copied directory contents are not inspected. Relative paths in a terminal with an unknown cwd
 *     stay unseen. The agent still runs as the owner's OS user with the owner's credentials; this is an in-process
 *     gate, not isolation.
 *   - Unknown tools are classified by name: write/edit/create/delete/move/put/save/patch/append/replace names make recognized path
 *     arguments writes; other names make them reads. Unrecognized argument shapes or concealed side effects remain
 *     unseen. Git config overrides are checked only when named in the command; stored config and environment are
 *     not evaluated to resolve a push destination.
 *   - Tool calls in other processes: the subscription hands (claude-code, codex) run their own tools; a separate
 *     harness process mounts its own runtime.
 *   - Harness code that reads or writes without a tool call (plugins, the host itself).
 *   - Network the call text does not name (a redirect, a library's own endpoint, DNS).
 *   - Writes are fenced by ROOT (workspace, repository, configured roots) and by protected patterns, not by a per-file
 *     allow-list: the vendored seed guard fails the shared conformance case `undeclared-path` (11/12 at 9fca7a0).
 *   - The seed guard's `analyse` opens the path it judges (O_RDONLY|O_NOFOLLOW|O_NONBLOCK, then fstat) to count hard
 *     links. It reads no bytes, but the open happens before the verdict, key material included.
 *   - The argument digest is plain sha256: a low-entropy argument can be confirmed by guessing.
 *   - One writer per receipt log is assumed; two processes appending the same log would fork the chain (detectably).
 *
 * @module @aukora/dsh-plugin-action-gate
 */
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_NETWORK_ALLOW, createPolicy } from './policy.mjs'
import { decideCall } from './kernel.mjs'
import { argsDigest, createReceiptLog } from './receipts.mjs'
import { createSelfChangeTool } from './self-change-tool.mjs'

export const name = 'aukora-action-gate'

/** The one service this gate needs: the tool runtime it guards. It provides nothing. */
export const inject = ['tools']

/** The release this module was loaded from: `<release>/plugins/aukora-action-gate/lib/index.mjs`. */
export const LOADED_FROM_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export const CONFIG_FIELDS = Object.freeze([
  'auraDir', 'supportRoot', 'dshHome', 'home', 'repoRoots', 'releaseRoots', 'extraWritableRoots', 'networkAllow',
  'allowLoopback', 'mainBranch', 'defaultWorkspace', 'rotateBytes', 'allowTools', 'worktreesRoot',
])

/**
 * Validate the row's config into settings. Refuses by name rather than guessing a location.
 * @param {unknown} config - the row's config.
 * @returns {Readonly<Record<string, unknown>>} settings.
 */
export function readSettings(config = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) throw refused('config must be a plain record')
  const unknown = Object.keys(config).filter(key => !CONFIG_FIELDS.includes(key))
  if (unknown.length > 0) throw refused(`unknown config field(s) ${unknown.join(', ')}`)
  const abs = (value, field) => {
    if (typeof value !== 'string' || !isAbsolute(value)) throw refused(`${field} must be an absolute path`)
    return resolve(value)
  }
  const list = (value, field) => {
    if (value === undefined) return []
    const items = Array.isArray(value) ? value : [value]
    return items.map((item, i) => abs(item, `${field}[${String(i)}]`))
  }
  if (config.auraDir === undefined) {
    throw refused('config.auraDir is required: every decision is receipted there, and a gate with no receipt log would '
      + 'refuse every call. The overlay sets it to dshHomePath(\'aura-actions\')')
  }
  const home = config.home === undefined ? homedir() : abs(config.home, 'home')
  // The support root is the harness home's grandparent in this deployment (`<support>/state/home`), so a row that
  // names only `dshHome` still anchors the live configuration and sockets where they are.
  const derived = typeof config.dshHome === 'string' && /\/state\/home\/?$/u.test(config.dshHome)
    ? resolve(config.dshHome, '..', '..') : undefined
  const supportRoot = config.supportRoot === undefined
    ? resolve(derived ?? process.env.AUKORA_SUPPORT_ROOT ?? join(home, 'Library', 'Application Support', 'AUKORA'))
    : abs(config.supportRoot, 'supportRoot')
  const networkAllow = config.networkAllow === undefined ? [...DEFAULT_NETWORK_ALLOW] : config.networkAllow
  if (!Array.isArray(networkAllow) || networkAllow.some(h => typeof h !== 'string' || h === '')) throw refused('networkAllow must be a list of host names')
  // THE APPROVED-TOOL LIST (#26): exact names, and a trailing `*` for a family. Omitted means the policy's own
  // baseline; declared means exactly what it says, so a deployment can narrow it without touching code.
  const allowTools = config.allowTools === undefined
    ? []
    : (Array.isArray(config.allowTools) ? config.allowTools : [config.allowTools])
  if (config.worktreesRoot !== undefined && list(config.repoRoots, 'repoRoots').length === 0) {
    throw refused('worktreesRoot needs repoRoots: the first is the checkout whose self-change.mjs the tool runs')
  }
  if (allowTools.some(name => typeof name !== 'string' || name === '')) {
    throw refused('allowTools must be a list of non-empty tool names, each optionally ending in * for a family')
  }
  return Object.freeze({
    auraDir: abs(config.auraDir, 'auraDir'),
    home,
    supportRoot,
    dshHome: config.dshHome === undefined ? join(supportRoot, 'state', 'home') : abs(config.dshHome, 'dshHome'),
    repoRoots: list(config.repoRoots, 'repoRoots'),
    releaseRoots: config.releaseRoots === undefined ? [LOADED_FROM_ROOT] : list(config.releaseRoots, 'releaseRoots'),
    extraWritableRoots: list(config.extraWritableRoots, 'extraWritableRoots'),
    networkAllow: Object.freeze([...networkAllow]),
    allowLoopback: config.allowLoopback !== false,
    mainBranch: typeof config.mainBranch === 'string' && config.mainBranch !== '' ? config.mainBranch : 'main',
    defaultWorkspace: config.defaultWorkspace === undefined ? process.cwd() : abs(config.defaultWorkspace, 'defaultWorkspace'),
    rotateBytes: Number.isSafeInteger(config.rotateBytes) && config.rotateBytes > 0 ? config.rotateBytes : undefined,
    allowTools: Object.freeze([...allowTools]),
    // Set: this plugin also registers the trusted `aukora_self_change` tool, proposing from worktrees under it.
    worktreesRoot: config.worktreesRoot === undefined ? undefined : abs(config.worktreesRoot, 'worktreesRoot'),
  })
}

/**
 * The CORE-preset lookup the carried rows need, read from the session's own projection. Only asked when a CORE row
 * matched; anything but a clean string answer reads as unknown, which those rows refuse.
 * @param {object} ctx - the plugin context.
 * @param {object|undefined} agent - the calling agent.
 * @returns {string|null|{reader: string}} the preset, null for none, or the unknown marker.
 */
export function presetOf(ctx, agent) {
  if (agent === undefined) return null
  try {
    const projections = ctx.get('sessionProjections')
    const values = projections?.snapshot?.(agent.session, ['agentPreset'])?.values
    if (values === null || typeof values !== 'object' || !Object.hasOwn(values, 'agentPreset')) return { reader: 'unknown' }
    const value = values.agentPreset
    if (value === null || value === undefined) return null
    return typeof value === 'string' ? value : { reader: 'unknown' }
  } catch {
    return { reader: 'unknown' }
  }
}

/**
 * Build the guard function: judge, receipt, and return the refusal text (or undefined to leave the call allowed).
 * Exported so the check can drive the exact function the plugin registers.
 * @param {{settings: object, lookupPreset?: (agent: object|undefined) => unknown, partialFailureOf?: (agent: object|undefined, exec?: object) => unknown, logger?: object}} options
 * @returns {(exec: object) => string|undefined}
 */
export function createGuard({ settings, lookupPreset = () => null, partialFailureOf = () => undefined, logger, definitionOf = null }) {
  const policy = createPolicy(settings, { definitionOf, partialFailureOf: call => partialFailureOf(call?.agent, call) })
  const receipts = createReceiptLog({ auraDir: settings.auraDir, ...settings.rotateBytes === undefined ? {} : { rotateBytes: settings.rotateBytes } })
  return function actionGate(exec) {
    const agent = exec?.agent
    let verdict
    let digest
    try {
      digest = argsDigest(exec?.arguments)
      const classified = policy.classify({
        tool: exec?.name,
        args: exec?.arguments,
        agent,
        workspace: typeof agent?.session?.header?.cwd === 'string' ? agent.session.header.cwd : undefined,
        presetOf: () => lookupPreset(agent),
      })
      verdict = decideCall(classified, digest)
    } catch (error) {
      verdict = { decision: 'deny', rule: 'gate:policy-fault', kernelCode: error?.code ?? 'gate:policy-fault', message: `AUKORA action gate refused this call [gate:policy-fault]: the policy failed (${String(error?.message ?? error)}), and a call the gate could not judge is not allowed` }
    }
    try {
      receipts.append({
        op: 'tool.decision',
        by: 'aukora-action-gate/v1',
        at: new Date().toISOString(),
        session: typeof agent?.id === 'string' ? agent.id : null,
        callId: typeof exec?.callId === 'string' ? exec.callId : null,
        nested: exec?.parent !== undefined,
        tool: String(exec?.name),
        argsDigest: digest ?? argsDigest(exec?.arguments),
        decision: verdict.decision,
        rule: verdict.rule,
        kernelCode: verdict.kernelCode,
      })
    } catch (error) {
      logger?.warn?.(`aukora-action-gate: receipt not written (${String(error?.message ?? error)})`)
      if (verdict.decision === 'allow') {
        return 'AUKORA action gate refused this call [receipt:failed]: its receipt could not be written to the Aura log, and '
          + 'no call is allowed without one'
      }
    }
    return verdict.decision === 'deny' ? verdict.message : undefined
  }
}

/**
 * Mount: register the guard globally on the tool runtime. The disposer `tools.guard()` returns is an effect of this
 * plugin's fiber, so a re-application replaces the guard instead of stacking or colliding.
 * @param {object} ctx - the plugin context.
 * @param {object} config - the row's config.
 */
export function apply(ctx, config) {
  const settings = readSettings(config ?? {})
  let logger
  try { logger = ctx.logger } catch { logger = undefined }
  // The harness runtime is the only place a tool's REGISTERED definition lives, so the pin is taken from it:
  // `ctx.tools.get(name, agent)`. A package that re-registers an approved name after startup hands back a different
  // object, and the policy refuses that call.
  const definitionOf = (name, agent) => {
    try { return ctx.tools.get(name, agent) } catch { return undefined }
  }
  // Kira owns the verified recall result. Resolve the service lazily because plugin row order is not a
  // trust boundary; a missing service is intentionally handled as an unverified memory picture.
  const partialFailureOf = agent => {
    try {
      const ledger = ctx.get('kira.partialFailure')
      return ledger?.forAgent?.(agent)
    } catch { return undefined }
  }
  const guard = createGuard({ settings, lookupPreset: agent => presetOf(ctx, agent), partialFailureOf, logger, definitionOf })
  ctx.tools.guard(guard)
  logger?.info?.(`aukora-action-gate: guarding every tool call; receipts in ${settings.auraDir}`)
  if (settings.worktreesRoot !== undefined) {
    ctx.tools.register(createSelfChangeTool({ repo: settings.repoRoots[0], worktreesRoot: settings.worktreesRoot, supportRoot: settings.supportRoot }))
  }
}

function refused(message) {
  const error = new Error(`aukora-action-gate: ${message}`)
  error.code = 'aukora-action-gate:config'
  return error
}
