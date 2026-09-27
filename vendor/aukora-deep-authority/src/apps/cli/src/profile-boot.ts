/**
 * Shared profile boot for every `dsh` surface: resolve the profile, stack its
 * patch layers (bundle layers in `dsh.profile.bundles` order, the profile's
 * own `cordis.patch.yml`, `--patch` overlays, the telemetry switch), mount the
 * tree over the profile's empty root config, keep ordinary profile patch
 * layers live, and wire fail-loud plus bounded shutdown. A parent-governed
 * profile preflights and declines amendment machinery before boot.
 *
 * App flags are not the launcher's business: the invocation's inner arguments
 * are provided to the tree through `ctx.cmdlineArgs`, where any injected app
 * plugin may read the same immutable snapshot.
 * @module @deepseek-ai/dsh/profile-boot
 */

import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { isJsExpr, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  installFailLoud,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  watchUserPatches,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Shipped agent-preset root: beside this app's own config, in both source and built layouts. */
const SHIPPED_PRESET_ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'

const NAME = 'dsh'

/** Canonical Cordis HMR package a parent-governed profile may not configure. */
const HMR_PLUGIN_NAME = '@deepseek-ai/cordis-plugin-hmr'

/** First-class Include specifiers that could load an uninspected child tree. */
const INCLUDE_PLUGIN_NAMES = new Set([
  'cordis:include',
  '@deepseek-ai/cordis-plugin-include',
])

/** Entry specifiers whose `config` is a nested Loader entry list. */
const GROUP_PLUGIN_NAMES = new Set([
  'cordis:group',
  '@deepseek-ai/cordis-plugin-group',
])

/** One known amendment package and the tree-carrier role it implements. */
interface GovernedPluginPackage {
  /** Package name used by the installed Harness. */
  name: string
  /** Role whose configured instance the preflight needs to recognize. */
  kind: 'hmr' | 'include' | 'group'
}

/** Configured package identities that a parent-governed profile needs to inspect. */
const GOVERNED_PLUGIN_PACKAGES: readonly GovernedPluginPackage[] = [
  { name: HMR_PLUGIN_NAME, kind: 'hmr' },
  { name: '@deepseek-ai/cordis-plugin-include', kind: 'include' },
  { name: '@deepseek-ai/cordis-plugin-group', kind: 'group' },
]

/**
 * The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied
 * over every profile's own layer. Resolved per call, not at module load:
 * `$DSH_HOME` may be set by the test or launcher after import.
 * @returns the absolute patch-file path.
 */
export function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/** Absolute path of this dsh installation's package.json (both anchors: src/ and lib/ sit one level under apps/cli). */
export const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/**
 * Return every canonical root that the profile's Node resolver can select for
 * one installed package. A profile-local installation wins over the shared
 * profile fallback, so both locations must participate in preflight.
 */
function installedPackageRoots(packageName: string, profileDir: string): readonly string[] {
  const requireFromProfile = createRequire(join(profileDir, 'package.json'))
  const searchPaths = requireFromProfile.resolve.paths(packageName) ?? []
  const roots = new Set<string>()
  for (const searchPath of searchPaths) {
    const manifest = join(searchPath, packageName, 'package.json')
    if (existsSync(manifest)) roots.add(realpathSync(dirname(manifest)))
  }
  return [...roots]
}

/** True when `candidate` is the package root or one of its canonical descendants. */
function isWithinPackage(candidate: string, root: string): boolean {
  const relation = relative(root, candidate)
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

/**
 * Resolve an entry's direct module identity without importing or evaluating it.
 * @param name - configured Loader module specifier.
 * @param profileDir - directory Node uses as the profile's module-resolution anchor.
 * @returns the canonical module file, or `undefined` when the specifier cannot resolve.
 */
function resolvedEntryModule(name: string, profileDir: string): string | undefined {
  try {
    const resolved = name.startsWith('file:')
      ? fileURLToPath(name)
      : name.startsWith('.')
        ? resolve(profileDir, name)
        : createRequire(join(profileDir, 'package.json')).resolve(name)
    return realpathSync(resolved)
  } catch {
    return undefined
  }
}

/**
 * Classify the direct package identity behind a configured entry.
 *
 * Direct package subpaths are recognized before resolution so a governed
 * profile refuses the same package whether its built artifact is present or
 * not. Canonical resolution additionally catches file and symlink spellings
 * that point directly into one of the installed package roots.
 * @param name - configured Loader module specifier.
 * @param profileDir - directory Node uses as the profile's module-resolution anchor.
 * @returns the known role, or `undefined` for another plugin.
 */
function governedPluginKind(
  name: string,
  profileDir: string,
): GovernedPluginPackage['kind'] | undefined {
  if (INCLUDE_PLUGIN_NAMES.has(name)) return 'include'
  if (GROUP_PLUGIN_NAMES.has(name)) return 'group'
  for (const candidate of GOVERNED_PLUGIN_PACKAGES) {
    if (name === candidate.name || name.startsWith(`${candidate.name}/`)) return candidate.kind
  }
  const resolved = resolvedEntryModule(name, profileDir)
  if (resolved === undefined) return undefined
  for (const candidate of GOVERNED_PLUGIN_PACKAGES) {
    if (installedPackageRoots(candidate.name, profileDir).some(root => isWithinPackage(resolved, root))) {
      return candidate.kind
    }
  }
  return undefined
}

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Root config filename inside a profile directory. */
export const PROFILE_ROOT_FILENAME = 'cordis.yml'

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake. A composition without the telemetry row
 * exports nothing, so the switch is then trivially satisfied and no patch is
 * generated — custom profiles need not mount telemetry to run with the
 * switch set.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/**
 * Load a resolved profile for `name`: heal the shared module fallback, then
 * (re)write the empty root config on writable launches. The whole
 * composition is patch layers, and the vendored Loader's tree write-back (a
 * plugin self-disposing persists the current tree) can bake composed rows
 * into this file — which would duplicate every bundle insert on the next
 * boot. The file exists on disk only because the Loader needs a real include
 * root to anchor `baseUrl` at the profile directory (the config dump anchors
 * on the same file, so both compose over the identical base).
 * @param name - the profile name.
 * @param userLayer - `false` skips parsing `cordis.patch.yml` (the default dump).
 * @param preparation - Read-only launches require pre-staged dependencies,
 * manifest and exact empty root; they never initialize or repair files.
 * @returns the loaded profile.
 */
export function prepareProfile(
  name: string, userLayer = true, preparation: 'writable' | 'read-only' = 'writable',
): Profile {
  const readOnly = preparation === 'read-only'
  if (!readOnly) healProfilesModuleFallback(INSTALL_ANCHOR)
  const profile = loadProfile(NAME, name, INSTALL_ANCHOR, undefined, { userLayer, readOnly })
  const root = join(profile.dir, PROFILE_ROOT_FILENAME)
  if (readOnly) requirePreparedRoot(root)
  else writeFileSync(root, PROFILE_ROOT_CONFIG)
  return profile
}

/** Validate the retained empty root without repairing or following its leaf. */
function requirePreparedRoot(path: string): void {
  let descriptor: number | undefined
  try {
    if (constants.O_NOFOLLOW === undefined) throw new Error('O_NOFOLLOW unavailable')
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const state = fstatSync(descriptor)
    if (!state.isFile() || state.size !== Buffer.byteLength(PROFILE_ROOT_CONFIG)
      || readFileSync(descriptor, 'utf8') !== PROFILE_ROOT_CONFIG) {
      throw new Error('expected the pre-staged empty profile root')
    }
  } catch (cause) {
    throw new Error(`profile-boot:prepared-root-invalid (${path})`, { cause })
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** One profile's patch layers, final entries, and pre-flag row index. */
interface ComposedProfile {
  profile: Profile
  /** Bundle layers concatenated — the part below the user layers on a live reload. */
  bundlePatches: PatchOptions[]
  /** The home-level user layer (`$DSH_HOME/cordis.patch.yml`), applied after the profile's own. */
  homePatches: PatchOptions[]
  /** Layers above the user layers on a live reload: `--patch` overlays and the telemetry switch. */
  overlays: PatchOptions[]
  /** Effective entries after launcher-owned overlays. */
  entries: readonly EntryOptions[]
  /**
   * id → row of the composed tree (bundles + user layers + overlays), for the
   * launcher's own row checks.
   */
  rows: ReadonlyMap<string, EntryOptions>
}

/** The full patch stack of one composed profile, in application order. */
function allPatches(composed: ComposedProfile): PatchOptions[] {
  return [
    ...composed.bundlePatches,
    ...composed.profile.patches,
    ...composed.homePatches,
    ...composed.overlays,
  ]
}

/**
 * Load `name` and compose its effective patch stack: bundle layers in
 * `dsh.profile.bundles` order (the base bundle gates the shell stacks by
 * platform on its own rows), the profile's user layer, the home-level user
 * layer (`$DSH_HOME/cordis.patch.yml` — machine-local preferences that apply
 * to every profile, so it outranks the per-profile layer), `--patch` overlays,
 * then the telemetry switch.
 * @param name - the profile name.
 * @param patchFiles - `--patch` overlay paths, in argv order.
 * @param systemPresetRoot - The launcher-selected preset directory.
 * @param preparation - Whether boot may initialize or repair profile files.
 * @returns the profile, its patch layers, final entries, and the composed row index.
 */
function composeProfile(
  name: string,
  patchFiles: readonly string[],
  systemPresetRoot = SHIPPED_PRESET_ROOT,
  preparation: 'writable' | 'read-only' = 'writable',
): ComposedProfile {
  const profile = prepareProfile(name, true, preparation)
  const homePatches = loadOptionalPatches(NAME, homePatchPath()) ?? []
  const overlays = patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file)))
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches, overlays])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const composedOverlays = [...overlays]
  // The SHIPPED root is the part of the roster only this app can resolve: it
  // sits beside this app's own config, in both the source and built layouts.
  // The writable root the roster appends is `dsh-agent-presets`' own, so a
  // launcher that never reaches this patch still finds a person's presets.
  if (rows.has('agent-presets')) {
    composedOverlays.push({
      id: 'agent-presets',
      config: {
        ...(rows.get('agent-presets')?.config ?? {}) as Record<string, unknown>,
        roots: [{ path: systemPresetRoot, trust: 'system' }],
      },
    })
  }
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) composedOverlays.push(telemetryPatch)
  const entries = composeEntries([bundlePatches, profile.patches, homePatches, composedOverlays])
  return { profile, bundlePatches, homePatches, overlays: composedOverlays, entries, rows }
}

/** A configured entry that makes a parent-governed preflight incomplete. */
interface GovernedCompositionViolation {
  entry: EntryOptions
  reason: 'configured-group-provider' | 'configured-hmr' | 'configured-include' | 'configured-import-alias' | 'configured-module-adornment'
}

/** True when Loader URL parsing can reinterpret a configured module spelling. */
function hasNoncanonicalModuleSyntax(name: string): boolean {
  if (name.includes('%') || name.includes('?') || name.includes('#')) return true
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/**
 * True when a value's own tree still carries a Loader executable-expression
 * leaf, at any depth. Objects and arrays are walked the same way — every own
 * value, every element — so a JsExpr node anywhere in that tree, including one
 * sitting inside a disabled row's config, is reported.
 * @param value - Any composed-entry field: a config object, an array, or a
 *   scalar such as `disabled`.
 * @returns Whether `value`'s tree contains a JsExpr node.
 */
function containsExecutableConfig(value: unknown): boolean {
  if (isJsExpr(value)) return true
  if (Array.isArray(value)) return value.some(containsExecutableConfig)
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(containsExecutableConfig)
  }
  return false
}

/**
 * Find the first entry whose `disabled` field or config still carries an
 * unevaluated Loader expression.
 *
 * An array-valued config is walked twice, and both walks are load-bearing.
 * A group row's config is its child entry list, so the recursion attributes a
 * hit to the child that owns it rather than to the enclosing group. An array
 * that is not an entry list — a plain array of config values — is reached only
 * by the whole-config walk that follows, so neither shape can pass unread.
 *
 * The Loader's own evaluation-time refusal ({@link refuseExecutableConfig} in
 * `dsh-app-boot`) only fires when something actually reads a JsExpr node.
 * Disabled rows are never read, so a JsExpr sitting inside a disabled row's
 * config would never trip that guard; this scan inspects disabled rows too,
 * which is why it exists as a companion static preflight rather than relying
 * on the evaluation-time trap alone.
 * @param entries - Composed Loader entries.
 * @returns The first entry carrying a surviving expression, or `undefined`.
 */
function findExecutableConfigEntry(entries: readonly EntryOptions[]): EntryOptions | undefined {
  for (const entry of entries) {
    if (containsExecutableConfig(entry.disabled)) return entry
    if (Array.isArray(entry.config)) {
      const nested = findExecutableConfigEntry(entry.config as EntryOptions[])
      if (nested !== undefined) return nested
    }
    if (containsExecutableConfig(entry.config)) return entry
  }
  return undefined
}

/**
 * Find amendment machinery or an uninspected child tree in effective entries.
 * @param entries - Composed Loader entries.
 * @returns The first refusal, or `undefined` when the inspected tree is closed.
 */
function findGovernedCompositionViolation(
  entries: readonly EntryOptions[],
  profileDir: string,
): GovernedCompositionViolation | undefined {
  for (const entry of entries) {
    // A literal boolean disables an ordinary entry before Loader imports it.
    // Loader keeps a group entry enabled regardless of that field, so groups
    // still require provider-identity and child-tree inspection below.
    if (entry.disabled === true && entry.group !== true) continue
    // Declined compositions do not admit Node package-import aliases.
    if (entry.name.startsWith('#')) return { entry, reason: 'configured-import-alias' }
    // Loader URL parsing can normalize encodings, controls, search,
    // or fragments to a different module than the synchronous identity probe.
    // A parent-governed composition refuses that disagreement.
    if (hasNoncanonicalModuleSyntax(entry.name)) {
      return { entry, reason: 'configured-module-adornment' }
    }
    const kind = governedPluginKind(entry.name, profileDir)
    if (entry.group === true && kind !== 'group') {
      return { entry, reason: 'configured-group-provider' }
    }
    if (kind === 'hmr') return { entry, reason: 'configured-hmr' }
    if (kind === 'include') return { entry, reason: 'configured-include' }
    if ((entry.group !== true && kind !== 'group') || !Array.isArray(entry.config)) continue
    const nested = findGovernedCompositionViolation(entry.config as EntryOptions[], profileDir)
    if (nested !== undefined) return nested
  }
  return undefined
}

/** Options for {@link runProfile}. */
export interface RunProfileOptions {
  /** This run's frozen environment snapshot, provided before any entry mounts. */
  environment: LaunchEnvironmentSnapshot
  /** The profile name to boot. */
  profile: string
  /** `--patch` overlay paths, in argv order. */
  patchFiles: readonly string[]
  /** The invocation's inner arguments, handed to the tree through `ctx.cmdlineArgs`. */
  args: readonly string[]
  /** Parent-staged system preset root; ordinary launches use the shipped root. */
  systemPresetRoot?: string
  /**
   * Read-only consumes pre-staged files without dependency repair, template
   * initialization, manifest normalization or root writes. Requires declined
   * HMR. This mode does not itself establish file ownership or OS confinement.
   */
  profilePreparation?: 'writable' | 'read-only'
  /**
   * Parent-supplied amendment disposition. A declined profile refuses
   * configured HMR and Include entries before boot, then creates neither
   * fallback HMR nor live user-patch watchers.
   */
  hmrDisposition?: 'enabled' | 'declined-at-launch'
}

/**
 * Re-throw a watcher-setup failure unless a shutdown already owns the tree:
 * a signal aborted this invocation, or an app requested exit (`ctx.appExit`
 * from a fast one-shot) and the root's disposal rejected the in-flight setup
 * await. Either way the failure describes a tree that is exiting as asked,
 * not a broken watch.
 * @param ctx - the booted root context.
 * @param signal - this invocation's signal-shutdown fact.
 * @param error - the setup failure.
 */
function suppressShutdownError(ctx: Context, signal: AbortSignal, error: unknown): void {
  if (signal.aborted) return
  if (ctx.fiber.state !== FiberState.ACTIVE || ctx.get('loader') === undefined) return
  throw error
}

/**
 * Boot one profile invocation end to end and leave process lifetime to the
 * mounted plugins (or to a one-shot runner the composition mounts).
 * @param options - environment snapshot, profile name, overlays, and the booted app's own arguments.
 * @returns the settled root context and the shutdown controller.
 */
export async function runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  if (options.profilePreparation === 'read-only' && options.hmrDisposition !== 'declined-at-launch') {
    throw new Error('profile-boot:read-only-requires-declined-hmr')
  }
  const composed = composeProfile(options.profile, options.patchFiles, options.systemPresetRoot, options.profilePreparation)
  if (options.hmrDisposition === 'declined-at-launch') {
    const violation = findGovernedCompositionViolation(composed.entries, composed.profile.dir)
    if (violation !== undefined) {
      throw new Error(
        `profile-boot:governed-composition-refuses-${violation.reason} (entry ${JSON.stringify(violation.entry.id)})`,
      )
    }
    const executable = findExecutableConfigEntry(composed.entries)
    if (executable !== undefined) {
      throw new Error(
        `profile-boot:governed-composition-refuses-executable-config (entry ${JSON.stringify(executable.id)})`,
      )
    }
    process.stderr.write('profile-boot: HMR declined at launch for governed composition\n')
  }
  const app: { current?: Context } = {}
  const shutdown = createProcessShutdown(async () => { await app.current?.fiber.dispose() })
  const signalShutdown = new AbortController()
  const interrupt = (code: number): void => {
    signalShutdown.abort()
    shutdown.interrupt(code)
  }
  // Signals own teardown throughout the startup window, not only after boot()
  // settles: an inserted provider can publish before sibling rows finish mounting.
  // SIGTERM is a supervisor's ordinary stop request and exits 0 on every
  // surface — the launcher does not know whether the app considered its work
  // complete; SIGINT is a user interrupt and reports 130.
  process.on('SIGTERM', () => { interrupt(0) })
  process.on('SIGINT', () => { interrupt(130) })
  installFailLoud(NAME, process, async () => {
    await app.current?.fiber.dispose()
  })

  const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
  // Recomposition for the live user layers: bundle layers below, overlays
  // above, so a user edit can never displace them. Parsed app arguments are
  // not in here at all — they live in app-provided services that survive a
  // recomposition. BOTH
  // user files are re-read per generation (the HMR watcher hands us only the
  // changed file's patches, which one of the reads duplicates — fresh reads
  // keep the two watchers from stitching in each other's stale copy).
  // Fresh clones per generation: the include pushes `insert` rows into the
  // mounted tree BY REFERENCE and later id-targeted patches mutate those
  // objects in place. Reusing one parsed patch object across applications
  // would bake a user override into the bundle's in-memory insert row, so
  // removing the override could never revert the row to the bundle default.
  const composeLive = (): PatchOptions[] => structuredClone([
    ...composed.bundlePatches,
    ...loadOptionalPatches(NAME, composed.profile.patchPath) ?? [],
    ...loadOptionalPatches(NAME, homePatchPath()) ?? [],
    ...composed.overlays,
  ])
  // Cloned for the same insert-aliasing reason as composeLive: the boot
  // application must not mutate the objects later reloads recompose from.
  const ctx = await boot(NAME, rootConfig, structuredClone(allPatches(composed)), (hostCtx) => {
    app.current = hostCtx
    // Before any config-tree entry mounts, so plugins resolve all launch-time
    // environment values from the same immutable provenance snapshot.
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
    // The command line and bounded exit request are launcher facts available
    // to every app plugin that injects the argument snapshot.
    provideCmdline(hostCtx, {
      args: options.args,
      exit: code => void shutdown.shutdown(code),
    })
  })
  app.current = ctx
  // A surface can dispose the whole tree while boot or this post-boot watcher
  // setup is still in flight — a signal, or a fast one-shot's appExit. Loader
  // presence and fiber state own liveness; the initial check skips a tree
  // that already exited, and the catch below re-checks for an exit that
  // landed mid-setup. Ordinary profiles watch: a one-shot surface exits
  // through its bounded shutdown, which disposes the watchers before the
  // loop drains. A parent-governed profile has already preflighted and
  // declined both configured and fallback amendment machinery.
  if (!signalShutdown.signal.aborted
    && ctx.fiber.state === FiberState.ACTIVE
    && ctx.get('loader') !== undefined
    && options.hmrDisposition !== 'declined-at-launch') {
    try {
      // Config-only HMR for the live profile patch layer: the web bundle
      // disables the shared module-reload `hmr` row (its reload lifecycle is
      // untested), so when the composition leaves no HMR service, mount a
      // watch-only instance with no module roots — cordis.patch.yml edits stay
      // live on every long-lived surface. A silent skip would break the
      // documented hot-reload contract. HMR injects the timer service, which a
      // bare custom profile may not mount either.
      if (ctx.get('hmr') === undefined) {
        if (ctx.get('timer') === undefined) {
          await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
        }
        await ctx.loader.create({ name: HMR_PLUGIN_NAME, config: { root: [] } })
      }
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: composed.profile.patchPath,
        compose: composeLive,
      })
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: homePatchPath(),
        compose: composeLive,
      })
    } catch (error) {
      suppressShutdownError(ctx, signalShutdown.signal, error)
    }
  }
  return { ctx, shutdown }
}
