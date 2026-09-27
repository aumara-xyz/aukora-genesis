/**
 * AUKORA SEATBELT: the harness's `sandbox` provider, with AUKORA's denies appended to every profile it builds.
 *
 * ── WHERE IT SITS ────────────────────────────────────────────────────────────────────────────────────────────────
 * Every confining process consumer in the harness wraps its argv through ONE service, `ctx.sandbox.confine()`:
 *   bash       vendor/dsh packages/shell/bash-sandbox/src/index.ts:189   (foreground :101, background :130)
 *   terminal   packages/terminal/terminal-bash/src/index.ts:108
 *   run_code   packages/ptc-runtime/ptc-runtime-node/src/index.ts:224
 *   web shell  packages/api/terminal-controller/src/index.ts:328
 * The stock provider (`sandbox` row, `@deepseek-ai/dsh-sandbox-local`) builds a Seatbelt profile that is fixed in code
 * (packages/sandbox/sandbox-local/src/profiles.ts:51-58) and has no config for extra rules. So this plugin REPLACES
 * that row: it mounts the stock provider class as a subclass whose `confine()` calls the stock one and appends
 * `profile.mjs`'s forms to the profile. Runner choice, probing, denial dialect ("operation not permitted") and
 * runner-failure rules stay the stock provider's own. `overlays/seatbelt.patch.yml` disables `sandbox` and inserts this
 * row; exactly one of the two may be enabled, because `ctx.provide` refuses a second `sandbox`.
 *
 * ── WHAT IT DOES NOT GOVERN (stated here because a reviewer will ask) ─────────────────────────────────────────────
 *   - A call in `danger-full-access` mode (a session set to it, or an approved escalation) is never confined: the
 *     consumers skip `confine()` entirely (bash-sandbox :92 and :129, terminal-bash :102, ptc-runtime-node :224,
 *     terminal-controller :325).
 *   - Network, except connect() to the signer socket. Signals and process inspection of other same-uid processes.
 *     Mach/XPC services: the Keychain through securityd, launchd (`launchctl`), LaunchServices (`open`), AppleEvents.
 *     Anything another unconfined process does on the agent's behalf, including the AUKORA backend's own HTTP API.
 *   - Key bytes under another name outside the denied directories (a backup, a hard link made before the sandbox).
 *   - The harness host process itself and plugins: only commands spawned through `ctx.sandbox` are confined.
 *   - Any platform but macOS: a non-Seatbelt wrap is refused (fail closed), not passed through.
 *
 * @module @aukora/dsh-plugin-seatbelt
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { aukoraDenyForms, protectedPaths, withAukoraDenies } from './profile.mjs'

export const name = 'aukora-seatbelt'

/** Where this module sits: `<root>/plugins/aukora-seatbelt/lib/index.mjs`, root being a release or the repository. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** The stock provider, in a release (`<release>/packages/…`) and in a repository checkout (`vendor/dsh/packages/…`). */
const PROVIDER_CANDIDATES = Object.freeze([
  join(ROOT, 'packages', 'sandbox', 'sandbox-local', 'lib', 'index.js'),
  join(ROOT, 'vendor', 'dsh', 'packages', 'sandbox', 'sandbox-local', 'lib', 'index.js'),
])

export const CONFIG_FIELDS = Object.freeze(['supportRoot', 'dshHome', 'home', 'providerModule', 'providerConfig'])

/**
 * Validate the row's config. Refuses by name rather than guessing a location.
 * @param {Record<string, unknown>} config - the row's config.
 * @returns {Readonly<{roots: object, providerModule: string, providerConfig: object}>} settings.
 */
export function readSettings(config = {}) {
  for (const key of Object.keys(config)) {
    if (!CONFIG_FIELDS.includes(key)) throw refused(`unknown config field ${JSON.stringify(key)}`)
  }
  const home = config.home ?? homedir()
  const supportRoot = config.supportRoot ?? join(home, 'Library', 'Application Support', 'AUKORA')
  const dshHome = config.dshHome ?? join(supportRoot, 'state', 'home')
  for (const [key, value] of Object.entries({ home, supportRoot, dshHome })) {
    if (typeof value !== 'string' || !isAbsolute(value)) throw refused(`${key} must be an absolute path`)
  }
  const providerModule = config.providerModule ?? PROVIDER_CANDIDATES.find(path => existsSync(path))
  if (typeof providerModule !== 'string' || !isAbsolute(providerModule) || !existsSync(providerModule)) {
    throw refused(`the stock sandbox provider was not found (${config.providerModule ?? PROVIDER_CANDIDATES.join(', ')})`)
  }
  return Object.freeze({
    roots: Object.freeze({ home, supportRoot, dshHome }),
    providerModule,
    providerConfig: config.providerConfig ?? {},
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
    async confine(argv, policy, signal) {
      // Canonicalised per call, so a protected directory created (or re-pointed) after boot is matched as it now is.
      return withAukoraDenies(await super.confine(argv, policy, signal), aukoraDenyForms(paths))
    }
  }
}

/**
 * Mount: load the stock provider and plug the subclass, which registers `sandbox` exactly as the stock row would.
 * @param {object} ctx - the plugin context.
 * @param {Record<string, unknown>} config - the row's config.
 */
export async function apply(ctx, config) {
  const settings = readSettings(config ?? {})
  const loaded = await import(pathToFileURL(settings.providerModule).href)
  const Provider = loaded.LocalSandboxProvider ?? loaded.default
  if (typeof Provider !== 'function') throw refused(`${settings.providerModule} exports no provider class`)
  await ctx.plugin(aukoraSeatbeltProvider(Provider, settings.roots), settings.providerConfig)
  let logger
  try { logger = ctx.logger } catch { logger = undefined }
  logger?.info?.(`aukora-seatbelt: every confined command carries the AUKORA denies (support ${settings.roots.supportRoot})`)
}

function refused(message) {
  const error = new Error(`aukora-seatbelt: ${message}`)
  error.code = 'aukora-seatbelt:config'
  return error
}
