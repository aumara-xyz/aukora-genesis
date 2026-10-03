/**
 * AUKORA SEATBELT: the harness's `sandbox` provider, with AUKORA's denies appended to every profile it builds.
 *
 * ── WHERE IT SITS ────────────────────────────────────────────────────────────────────────────────────────────────
 * The mandatory-agent-confinement source patch makes the covered Bash, PowerShell, terminal, run_code and browser
 * terminal launchers require `aukoraConfinement` and wrap their exact child argv. This service is registered below
 * only after the real AUKORA provider mounts; an absent service refuses child startup even if stock `sandbox` exists.
 * Approved host composition and plugin code are the trust root. A malicious host plugin could replace a service;
 * this boundary does not confine the host or attest its composition.
 * The stock provider (`sandbox` row, `@deepseek-ai/dsh-sandbox-local`) builds a Seatbelt profile that is fixed in code
 * (packages/sandbox/sandbox-local/src/profiles.ts:51-58) and has no config for extra rules. So this plugin REPLACES
 * that row: it mounts the stock provider class as a subclass whose `confine()` calls the stock one and appends
 * `profile.mjs`'s forms to the profile. Runner choice, probing, denial dialect ("operation not permitted") and
 * runner-failure rules stay the stock provider's own. `overlays/seatbelt.patch.yml` disables `sandbox` and inserts this
 * row; exactly one of the two may be enabled, because `ctx.provide` refuses a second `sandbox`.
 *
 * ── WHAT IT DOES NOT GOVERN (stated here because a reviewer will ask) ─────────────────────────────────────────────
 *   - The mandatory-agent-confinement source patch makes process consumers require `aukoraConfinement` before
 *     spawning. It refuses danger-full-access rather than letting session state or environment disable the boundary.
 *     Native Codex/Claude providers remain refused until their SDK launch closures are wired through confinement.
 *   - Network, except connect() to the signer socket. Signals and process inspection of other same-uid processes.
 *     Mach/XPC services: the Keychain through securityd, launchd (`launchctl`), LaunchServices (`open`), AppleEvents.
 *     Anything another unconfined process does on the agent's behalf, including the AUKORA backend's own HTTP API.
 *   - Key bytes under another name outside the denied directories (a backup, a hard link made before the sandbox).
 *   - The harness host process itself, plugins and unrelated subprocess consumers.
 *   - Any platform but macOS: a non-Seatbelt wrap is refused (fail closed), not passed through.
 *   - The in-process `write`/`edit` tools: `fs-sandbox` fences them to the workspace and temp, not ~/aukora-worktrees.
 *
 * @module @aukora/dsh-plugin-seatbelt
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { airlockSocketPaths, aukoraAllowForms, aukoraDenyForms, protectedPaths, withAukoraDenies } from './profile.mjs'

export const name = 'aukora-seatbelt'
export const REQUIRED_SERVICE = 'aukoraConfinement'

/** Where this module sits: `<root>/plugins/aukora-seatbelt/lib/index.mjs`, root being a release or the repository. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** The stock provider, in a release (`<release>/packages/…`) and in a repository checkout (`vendor/dsh/packages/…`). */
const PROVIDER_CANDIDATES = Object.freeze([
  join(ROOT, 'packages', 'sandbox', 'sandbox-local', 'lib', 'index.js'),
  join(ROOT, 'vendor', 'dsh', 'packages', 'sandbox', 'sandbox-local', 'lib', 'index.js'),
])

export const CONFIG_FIELDS = Object.freeze(['supportRoot', 'dshHome', 'home', 'repoRoots', 'worktreesRoot', 'airlockSockets', 'providerModule', 'providerConfig'])

/**
 * Validate the row's config. Refuses by name rather than guessing a location.
 * @param {Record<string, unknown>} config - the row's config.
 * @returns {Readonly<{roots: object, providerModule: string, providerConfig: object}>} settings.
 */
export function readSettings(config = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) throw refused('config must be an object')
  for (const key of Object.keys(config)) {
    if (!CONFIG_FIELDS.includes(key)) throw refused(`unknown config field ${JSON.stringify(key)}`)
  }
  const configured = (key, fallback) => Object.hasOwn(config, key) ? config[key] : fallback
  const home = configured('home', homedir())
  if (typeof home !== 'string' || !isAbsolute(home)) throw refused('home must be an absolute path')
  const supportRoot = configured('supportRoot', join(home, 'Library', 'Application Support', 'AUKORA'))
  if (typeof supportRoot !== 'string' || !isAbsolute(supportRoot)) throw refused('supportRoot must be an absolute path')
  const dshHome = configured('dshHome', join(supportRoot, 'state', 'home'))
  // This deployment's governing checkout and proposal worktrees, unless the row names others.
  const repoRoots = configured('repoRoots', [join(home, 'aukora-genesis')])
  const worktreesRoot = configured('worktreesRoot', join(home, 'aukora-worktrees'))
  // The Airlock sockets: the installed default plus the one the root-owned config names (profile.mjs).
  const airlockSockets = configured('airlockSockets', airlockSocketPaths())
  if (!Array.isArray(repoRoots)) throw refused('repoRoots must be a list of absolute paths')
  if (!Array.isArray(airlockSockets)) throw refused('airlockSockets must be a list of absolute paths')
  for (const [key, value] of [...Object.entries({ home, supportRoot, dshHome, worktreesRoot }), ...repoRoots.map(root => ['repoRoots[]', root]),
    ...airlockSockets.map(path => ['airlockSockets[]', path])]) {
    if (typeof value !== 'string' || !isAbsolute(value)) throw refused(`${key} must be an absolute path`)
  }
  const providerModule = configured('providerModule', PROVIDER_CANDIDATES.find(path => existsSync(path)))
  if (typeof providerModule !== 'string' || !isAbsolute(providerModule) || !existsSync(providerModule)) {
    throw refused(`the stock sandbox provider was not found (${config.providerModule ?? PROVIDER_CANDIDATES.join(', ')})`)
  }
  const providerConfig = configured('providerConfig', {})
  if (providerConfig === null || typeof providerConfig !== 'object' || Array.isArray(providerConfig)) throw refused('providerConfig must be an object')
  return Object.freeze({
    roots: Object.freeze({ home, supportRoot, dshHome, repoRoots: Object.freeze([...repoRoots]), worktreesRoot,
      airlockSockets: Object.freeze([...airlockSockets]) }),
    providerModule,
    providerConfig,
  })
}

/**
 * Subclass the stock provider so that every wrap carries the AUKORA denies.
 * @param {Function} Provider - `@deepseek-ai/dsh-sandbox-local`'s `LocalSandboxProvider`.
 * @param {object} roots - the deployment's roots, for {@link protectedPaths}.
 * @returns {Function} the provider class to mount.
 */
export function aukoraSeatbeltProvider(Provider, roots) {
  const paths = protectedPaths(roots)
  return class AukoraSeatbeltProvider extends Provider {
    constructor(...args) {
      super(...args)
      // The production runner is an OS path, never the child's or the host's ambient PATH.
      if (this.internals) this.internals.seatbeltExec = '/usr/bin/sandbox-exec'
    }
    async confine(argv, policy, signal) {
      signal?.throwIfAborted()
      if (policy === null || typeof policy !== 'object' || Array.isArray(policy)
        || !['read-only', 'workspace-write'].includes(policy.mode)
        || typeof policy.workspaceRoot !== 'string' || !isAbsolute(policy.workspaceRoot)
        || /[\x00-\x1f\x7f]/u.test(policy.workspaceRoot)) {
        throw refused('confinement requires read-only or workspace-write and an absolute workspaceRoot', 'AUKORA_CONFINEMENT_POLICY')
      }
      if (!Array.isArray(argv) || argv.length === 0 || argv.some(word => typeof word !== 'string' || word.includes('\0')) || argv[0] === '') {
        throw refused('confinement requires a nonempty executable argv', 'AUKORA_CONFINEMENT_ARGV')
      }
      // Canonicalised per call, so a protected directory created (or re-pointed) after boot is matched as it now is.
      const wrapped = withAukoraDenies(await super.confine(argv, policy, signal), [...aukoraAllowForms(paths, policy), ...aukoraDenyForms(paths)])
      if (wrapped.enforcement !== 'full' || wrapped.argv[0] !== '/usr/bin/sandbox-exec'
        || wrapped.argv.length !== argv.length + 4 || argv.some((word, index) => wrapped.argv[index + 4] !== word)) {
        throw refused('the backend did not return full native Seatbelt confinement of the exact requested argv', 'AUKORA_CONFINEMENT_BACKEND')
      }
      signal?.throwIfAborted()
      return wrapped
    }
  }
}

/**
 * Mount: load the stock provider and plug the subclass, which registers `sandbox` exactly as the stock row would.
 * @param {object} ctx - the plugin context.
 * @param {Record<string, unknown>} config - the row's config.
 */
export async function apply(ctx, config) {
  const settings = readSettings(config === undefined ? {} : config)
  const loaded = await import(pathToFileURL(settings.providerModule).href)
  const Provider = loaded.LocalSandboxProvider ?? loaded.default
  if (typeof Provider !== 'function') throw refused(`${settings.providerModule} exports no provider class`)
  await ctx.plugin(aukoraSeatbeltProvider(Provider, settings.roots), settings.providerConfig)
  const provider = ctx.get('sandbox')
  if (provider === undefined) throw refused('the confined provider did not register', 'AUKORA_CONFINEMENT_REQUIRED')
  // Only approved host composition may register this service. No env flag, session event or model argument does so.
  ctx.provide(REQUIRED_SERVICE, Object.freeze({ confine: provider.confine.bind(provider) }))
  let logger
  try { logger = ctx.logger } catch { logger = undefined }
  logger?.info?.(`aukora-seatbelt: every confined command carries the AUKORA denies (support ${settings.roots.supportRoot})`)
}

function refused(message, code = 'aukora-seatbelt:config') {
  const error = new Error(`aukora-seatbelt: ${message}`)
  error.code = code
  return error
}
