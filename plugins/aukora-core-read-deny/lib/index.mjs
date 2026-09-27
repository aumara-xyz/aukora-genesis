/**
 * THE PLUGIN ENTRY: mounting the guard as the `fs` provider.
 *
 * **THIS PLUGIN DOES NOT WRAP A RUNNING `fs` — IT REPLACES THE ROW THAT PROVIDES IT.** MEASURED: the
 * harness's own wrapper says so — *"loading it INSTEAD OF `dsh-fs-local`, together with a
 * `ctx.sandboxPolicy`, is the whole swap — the model-facing tools are untouched"* — and `ctx.provide`
 * throws on a second registration of a name, so a plugin that tried to re-provide `fs` alongside
 * `fs-sandbox` would refuse to mount. **The composition row is therefore part of this plugin, not a
 * wrapper around it: mount this INSTEAD OF `@deepseek-ai/dsh-fs-sandbox`.**
 *
 * @module @aukora/dsh-plugin-core-read-deny
 */

import { createRequire } from 'node:module'

import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

import { guardReads } from './guard.mjs'
import { presetOfFromContext } from './preset.mjs'

/** The service name this plugin provides, which is the whole point of the swap. */
export const SERVICE_NAME = 'fs'

/**
 * The plugin name the Loader reports. A function plugin named-exports its namespace and has no default
 * export, per the harness's own package rules.
 */
export const name = 'aukora-core-read-deny'

// ── **THE TWO SERVICES ARE DECLARED, AND THE OLD COMMENT HERE WAS WRONG IN A WAY THAT BROKE A BOOT** ──────
//
// It said: *"NOTHING IS DECLARED HERE. The provider class is handed in as configuration rather than injected:
// this plugin IS the provider, so it has nothing to inject."* **THAT CONFLATES PROVIDING WITH CONSUMING.**
// This plugin provides `fs` — and it also **READS TWO SERVICES** (`agents` and `sessionProjections`, see
// `REQUIRED_READER_SERVICES`) to answer *who is reading*, which is the whole of its purpose.
//
// **MEASURED, AND THIS IS THE MORNING-CUTOVER BLOCKER:** `apply` throws
// `aukora-core-read-deny:no-reader-services` when either service is not yet available, and with an empty
// `inject` **NOTHING MAKES CORDIS WAIT FOR THEM.** So a composition that mounts this row before those services
// register gets a refusal instead of a guard — and because this row **replaces `fs-sandbox` in place**, `fs`
// is then provided by nobody, which leaves every plugin that injects `fs` **pending**.
//
// **`inject` IS THE MECHANISM THAT MAKES THE ORDER NOT MATTER.** The other row in this repository's own
// composition patch says it exactly: `inject: [goals, agents]`, *"so it waits for both rather than running
// half-mounted"* (`aukora-composition.patch.yml:17`). This plugin wanted the same thing and asked for nothing.
//
// **AND IT DOES NOT MOVE THE PLUGIN OFF THE HOST PLANE.** `mount.ts`'s rule — that a service whose consumers
// inject it belongs on the host plane — is about WHERE the provider is mounted; `inject` is about WHEN its
// `apply` runs. This row stays exactly where the composition puts it.
//
// **THE FAILURE MODE IF THE SERVICES NEVER ARRIVE IS BETTER, NOT WORSE:** an injected service that is absent
// leaves this plugin **reported as pending** — visible, by name, with the name of what it is waiting for —
// rather than a refusal that reads like a fault in the guard itself. *A plugin waiting for a service is a
// composition that has not finished; a plugin refusing to mount is a composition that is broken*, and those
// two deserve different words.
// **DECLARED ABOVE `inject`, WHICH READS IT.** My first version put this constant below and `inject` at the
// top, which is a temporal-dead-zone `ReferenceError` at module load — *a constant used by a declaration
// that runs earlier is a constant that does not exist yet*, and the ordering is the whole point of this
// file. One list, read by both the declaration and the check, so they cannot drift.
export const REQUIRED_READER_SERVICES = Object.freeze(['agents', 'sessionProjections'])

/**
 * **THE SERVICES A WRAPPED PROVIDER MAY REQUIRE — AND `sandboxPolicy` IS THE ONE THAT BLOCKED THE RELEASE.**
 *
 * AURA's `de98f632`, candidate `aukora-release-A-1fbd1a1377d9`. After `fd8e32f68` the crash became a NAMED
 * refusal: *`cannot get property "sandboxPolicy" without inject`*, because **`SandboxedFileSystem` declares
 * `static inject = ["sandboxPolicy"]` and reads `ctx.sandboxPolicy.defaultMode` in its constructor**, and this
 * guard declared only the two services IT reads.
 *
 * **THE PROVIDER'S REQUIREMENTS ARE NOT THE GUARD'S REQUIREMENTS, AND THE GUARD MUST CARRY BOTH.** *A wrapper
 * that satisfies its own needs and passes a context it has not prepared is a wrapper that moves the failure one
 * frame deeper* — which is exactly what happened: the first fix made the config resolvable, and the constructor
 * then failed on a service nobody had declared.
 *
 * ── **DERIVED, NOT HAND-COPIED — AND THE DERIVATION IS ENFORCED AT THE MOUNT** ────────────────────────────
 *
 * `PROVIDER_REQUIRED_SERVICES` below is the union of the `static inject` declarations of the providers this guard
 * is written to wrap, and **IT IS NOT TRUSTED ON ITS OWN.** `assertProviderServicesDeclared` resolves the provider
 * class at mount, reads ITS OWN `static inject`, and **REFUSES BY NAME IF THIS LIST DOES NOT COVER IT.**
 *
 * **THAT CHECK IS THE PART THAT MAKES THE NEXT ONE NOT RECUR.** A hand-copied list drifts the moment upstream adds
 * a service, and the drift shows up as a TypeError in a constructor — *which is the failure this file has now
 * produced twice.* With the check, an upstream addition is a named refusal at the mount, before any construction.
 *
 * **AND IT IS A SUPERSET RATHER THAN A COMPUTED LIST, DELIBERATELY.** `inject` is a STATIC module export, read by
 * the loader before any config exists, so it CANNOT be computed from the row's `providerModule`. *A declaration
 * that had to be computed would be a declaration that could not be made* — and a plugin that declares a service
 * nothing provides goes PENDING, which is the same outage by a different route. So the list is the union, and the
 * mount verifies it rather than assuming it.
 */
export const PROVIDER_REQUIRED_SERVICES = Object.freeze([
  // `fs-sandbox`: `static inject = ["sandboxPolicy"]`, read as `ctx.sandboxPolicy.defaultMode` in its constructor.
  'sandboxPolicy',
])

/**
 * **THE UNION THE LOADER READS**: what this guard reads itself, plus what the providers it wraps require.
 *
 * A superset is safe AND necessary here: every service in it is provided by the composition this guard is mounted
 * into (`sandboxPolicy` is read by `terminal-controller`, `workspace-files`, `ui-deliverables`, `core/tools`,
 * `ptc-runtime-python` and `tool-cordis` in the same release), so declaring it costs nothing and omitting it
 * stops the constructor.
 */
export const inject = Object.freeze([...REQUIRED_READER_SERVICES, ...PROVIDER_REQUIRED_SERVICES])

/** Refusals this plugin raises at mount, so a failed mount says which one it met. */
export const CORE_DENY_MOUNT_REFUSE = Object.freeze({
  /** The provider class requires a service this guard does not declare. */
  PROVIDER_SERVICE_UNDECLARED: 'aukora-core-read-deny:provider-service-undeclared',
  /** The host context exposes no `provide`, so a mounted guard could not be reached. */
  NO_REGISTRY: 'aukora-core-read-deny:no-registry',
  /** No provider class was configured, so there is nothing to guard. */
  NO_PROVIDER: 'aukora-core-read-deny:no-provider',
  /** The context cannot say who is reading, so every protected read would be refused for its whole life. */
  NO_READER_SERVICES: 'aukora-core-read-deny:no-reader-services',
})

/**
 * The services the reader lookup cannot work without.
 *
 * **A MOUNT THAT CANNOT SAY WHO IS READING IS A MOUNT THAT REFUSES EVERY PROTECTED READ FOR THE LIFE OF
 * THE PROCESS.** The guard fails closed on that at read time, which is the right answer AT THE WRONG
 * MOMENT: the operator learns it from a read failure in the middle of a settlement rather than from the
 * composition that was wrong. **A fault in the composition should be refused by the composition.**
 *
 * Both are `ctx.get` lookups rather than `inject`, and that is deliberate: this plugin IS the `fs` provider,
 * so it takes no injected service, and a lookup that runs once at mount cannot be satisfied by an empty
 * placeholder the way a per-read one could.
 */

/** The configuration fields this plugin reads. */
// **`providerModule` IS A CONVENIENCE, NOT THE THING THAT MADE THE ROW POSSIBLE — AND MY FIRST COMMIT SAID
// OTHERWISE, SO THE CORRECTION IS HERE.**
//
// I claimed *"YAML cannot carry a class, so there was no row anyone could write"*. **THAT IS FALSE.**
// `scripts/materialize-aukora-release.py:397-399` ALREADY emits this row, and it carries the class with a
// `!!js` tag:
//
//     - id: fs-sandbox
//       name: ./plugins/aukora-core-read-deny/lib/index.mjs
//       config:
//         providerClass: !!js (await import('@deepseek-ai/dsh-fs-sandbox')).SandboxedFileSystem
//
// **THE LOADER SUPPORTS `!!js`, AND USES IT THROUGHOUT THAT FILE** (`:417`, `:427`, `:955` for the
// subscription-hands environment and Kira's state path). **So the composition format CAN express a class, the
// row CAN be written, and `providerModule` was never the blocker.**
//
// **THE EIGHT `~/aukora-release-*` TREES SIMPLY PREDATE THIS CODE** — the row and the plugin's copy-list
// entry are newer than any materialization on this machine. **The gate is therefore uncrossed because no
// fresh release has been built, not because the row is inexpressible**, and a plain specifier remains a
// useful alternative for a deployment that would rather not use an executable YAML tag.
export const CONFIG_FIELDS = Object.freeze([
  'providerClass', 'providerModule', 'providerConfig', 'resolveForCheck',
])

/**
 * Mount the read deny as the filesystem provider.
 *
 * @param {object} ctx - the host context.
 * @param {object} config - the mount configuration.
 * @param {Function} config.providerClass - the provider to extend; the composition passes
 *   `@deepseek-ai/dsh-fs-sandbox`'s `SandboxedFileSystem`, so the write fencing is kept and only reads
 *   are added.
 * @param {object} [config.providerConfig] - passed through to the provider unchanged.
 * @returns {void}
 */
export function apply(ctx, config) {
  if (typeof ctx?.provide !== 'function') {
    throw mountRefused(CORE_DENY_MOUNT_REFUSE.NO_REGISTRY,
      'the host context exposes no ctx.provide(); refusing to mount a guard nothing can reach')
  }
  // ══ **THIS PLUGIN PROVIDES `fs` EXACTLY ONCE PER CONTEXT, AND A SECOND APPLY IS A NO-OP (aumlok-132)** ══
  //
  // A2's boot (`/tmp/au31-run.log`, release `aukora-release-A2-a37c5675fbc6`) died with
  // **`service "fs" has been registered at <aukora-core-read-deny>`** thrown from the `ctx.provide` below, through
  // `vendor/cordis/lib/index.js:800-812`. `provide` is a FIBER EFFECT that throws when the name is already in the
  // store, and the store held a registration **from a fiber of this same name**.
  //
  // **THE GUARD MUST REPLACE THE STOCK PROVIDER, NEVER ADD A SECOND — AND THAT RULE HAS TO HOLD EVEN WHEN THE
  // GUARD ITSELF IS APPLIED TWICE.** Cordis re-runs `apply` when a fiber re-activates, and this plugin began
  // declaring `inject` in `c76e9f34b` and had `sandboxPolicy` added to it by `aumlok-129` — *so the very fix that
  // made the provider constructible is also what made the guard wait for services and re-activate.* A mount whose
  // second application throws is a mount that works only as long as nothing upstream makes it run again.
  //
  // **THE SECOND APPLICATION RE-USES THE FIRST REGISTRATION RATHER THAN REPLACING IT.** Re-providing would be
  // wrong twice over: the first registration is still live, and `ctx.provide` cannot take it back without the
  // disposer. The registration on this context is the guard, the guard is built from the same settings, and
  // *a second identical guard over the same provider is the same guard.*
  if (ctx[CORE_DENY_APPLIED] === true) return undefined
  const settings = readConfig(config)
  assertReaderServices(ctx)
  ctx.provide(SERVICE_NAME, createGuardedProvider(ctx, settings))
  Object.defineProperty(ctx, CORE_DENY_APPLIED, { value: true, enumerable: false, configurable: true })
  return undefined
}

/**
 * The marker a context carries once this guard has provided `fs` on it.
 *
 * **A SYMBOL, AND NOT A PROPERTY NAME A COMPOSITION COULD SET.** A plain `ctx.__readDenyApplied = true` would be a
 * flag any other plugin could write, and a guard that can be switched off by naming a property is not a guard. The
 * marker is per-module and unguessable from outside.
 */
const CORE_DENY_APPLIED = Symbol.for('aukora.core-read-deny.applied')

/**
 * Refuse a mount whose context cannot say who is reading.
 *
 * **IT ASKS FOR THE SERVICE, NOT FOR A SHAPE.** A context that carries `agents` but whose
 * `currentInitiator` is not a function is a different fault and is left to the reader lookup, which fails
 * closed per read — **this refusal is about a service that is not there at all**, which is a composition
 * error and can be seen once, at mount, instead of on every read.
 *
 * @param {object} ctx - the host context.
 * @returns {void}
 */
export function assertReaderServices(ctx) {
  const missing = REQUIRED_READER_SERVICES.filter(name => ctx.get(name) === undefined)
  if (missing.length > 0) {
    throw mountRefused(CORE_DENY_MOUNT_REFUSE.NO_READER_SERVICES,
      `the context cannot say who is reading (${missing.join(', ')} absent), so this guard would refuse `
      + 'every protected read for the life of the process. Refusing the MOUNT rather than every read: a '
      + 'fault in the composition should be refused by the composition')
  }
}

/**
 * Build the guarded provider.
 *
 * **IT EXTENDS THE PROVIDER IT REPLACES, SO THE WRITE FENCING AND EVERY NON-READ METHOD COME FROM THE
 * CLASS THE COMPOSITION WOULD OTHERWISE HAVE MOUNTED.** A wrapper around a live service is not available
 * here — `provide` refuses a second registration of one name — so the guard is installed by SUBCLASSING,
 * which is also what the harness does for its own sandbox.
 *
 * **THE PROVIDER'S CONSTRUCTOR IS CALLED FIRST AND THE GUARD IS LAID OVER THE FINISHED INSTANCE**,
 * because `LocalFileSystem`'s reads are prototype methods and a guard built over the prototype would be
 * shadowed by the instance's own binding. `guardReads` copies the surface it is given, so it is given a
 * finished object.
 *
 * @param {object} ctx - the host context, for the reader lookup.
 * @param {{providerClass: Function, providerConfig: object|undefined}} settings - validated configuration.
 * @returns {object} the guarded provider instance.
 */
export function createGuardedProvider(ctx, settings) {
  // **BEFORE ANY CONSTRUCTION.** The provider's own requirements are checked against what this module declared,
  // so a missing service is a named refusal here rather than a TypeError inside the provider.
  assertProviderServicesDeclared(settings.providerClass)
  const presetOf = presetOfFromContext(ctx)
  const Base = settings.providerClass
  // **THE MOUNT SUPPLIES THE RESOLVER, BECAUSE A GUARD WITHOUT ONE IS NOW REFUSED (CODEX SWEEP, FINDING 3).**
  // MEASURED: `index.mjs` passed only `presetOf`, so the guard fell back to `String(target)` and checked the
  // name a caller wrote while the provider opened whatever that name pointed at. **Mounting is the one place
  // that knows how this deployment resolves, so it is the one place that can answer.**
  const resolveForCheck = settings.resolveForCheck ?? realResolver
  return new (class extends Base {
    constructor() {
      super(ctx, settings.providerConfig)
      return guardReads(this, { presetOf, resolveForCheck })
    }
  })()
}

/**
 * The path this deployment would actually open, for the guard to check.
 *
 * **`realpathSync`, BECAUSE `resolve` IS LEXICAL AND DOES NOT FOLLOW A LINK.** The policy's contract says the
 * target must be symlink-resolved — *"a symlink whose link text is innocent and whose referent is
 * `kira-memory/keys` is a read of the keys"* — and only `realpath` settles that against the filesystem.
 *
 * **AND IT FALLS BACK TO `resolve` ONLY WHEN THE PATH DOES NOT RESOLVE AT ALL**, which means it does not
 * exist; the provider's own open then produces its own error, which is a better diagnostic than this
 * function inventing one. **The fallback is not a weaker check: a path that does not resolve cannot be a
 * protected file, because there is no file.**
 *
 * @param {unknown} target - the caller's target.
 * @returns {string} the path to check, and the path the provider will be handed.
 */
export function realResolver(target) {
  // ── A CALLER PASSES A `FsTarget`, NOT A PATH (MEASURED — AND THIS FUNCTION ASSUMED OTHERWISE) ────
  //
  // **`String(target)` ON AN `FsTarget` IS `"[object Object]"`.** MEASURED: the vendor's read methods are
  // declared `readText(target: FsTarget, signal?: AbortSignal)` (`fs/src/index.ts:189`), and a real target is
  // `{ targetKey: '/private/tmp/…/innocent.txt', displayPath: '/tmp/…/innocent.txt' }` — **so every check this
  // guard performed was against `<cwd>/[object Object]`, and the provider was handed the same nonsense.**
  //
  // **`targetKey` IS THE SYMLINK-RESOLVED PATH, WHICH IS EXACTLY WHAT THIS FUNCTION EXISTS TO PRODUCE** — the
  // provider already resolved it, and it is the key the provider will open. **So using it makes the checked
  // path and the opened path the SAME string rather than two computations that ought to agree**, which is
  // Codex sweep finding 3's requirement rather than a departure from it.
  if (target !== null && typeof target === 'object' && typeof target.targetKey === 'string') {
    return target.targetKey
  }
  const asWritten = String(target)
  try {
    return realpathSync(asWritten)
  } catch {
    // The file is absent or a loop; `resolve` gives the provider something to fail on by itself.
    return resolve(asWritten)
  }
}

/**
 * Read the mount configuration, refusing an unknown field.
 *
 * @param {unknown} config - candidate configuration.
 * @returns {{providerClass: Function, providerConfig: object|undefined}} validated settings.
 */
function readConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('aukora-core-read-deny config: must be a plain record')
  }
  const unknown = Object.keys(config).filter(key => !CONFIG_FIELDS.includes(key))
  if (unknown.length > 0) {
    throw new TypeError(`aukora-core-read-deny config: unknown field(s) ${unknown.join(', ')}`)
  }
  // **EXACTLY ONE PROVIDER SOURCE, AND SAYING WHICH IS THE WHOLE OF THIS CHECK.** Two sources would make the
  // mounted guard depend on which one the code happened to read; none is the `no-provider` refusal below.
  const hasClass = config.providerClass !== undefined
  const hasModule = config.providerModule !== undefined
  if (hasClass && hasModule) {
    throw mountRefused(CORE_DENY_MOUNT_REFUSE.NO_PROVIDER,
      'both providerClass and providerModule were configured, so which provider this guard extends would '
      + 'depend on the order this function reads them. Pass exactly one')
  }
  if (hasModule) {
    if (typeof config.providerModule !== 'string' || config.providerModule === '') {
      throw mountRefused(CORE_DENY_MOUNT_REFUSE.NO_PROVIDER,
        `providerModule must be a non-empty module specifier, and it was ${JSON.stringify(config.providerModule)}`)
    }
    const providerClass = resolveProviderModule(config.providerModule)
    // **THE BLOCKER, FIXED AT THE SOURCE:** the row carries a module and no config, and this is the line that
    // used to hand the constructor `undefined`.
    return { providerClass, providerConfig: resolveProviderConfig(providerClass, config.providerConfig) }
  }
  if (typeof config.providerClass !== 'function') {
    // **A GUARD OVER NOTHING IS NOT A GUARD.** Mounting with no provider would produce an `fs` service
    // that cannot read at all — which reads as the deny working, and is the failure this refuses.
    throw mountRefused(CORE_DENY_MOUNT_REFUSE.NO_PROVIDER,
      'no providerClass was configured; mount this INSTEAD OF dsh-fs-sandbox and pass its '
      + 'SandboxedFileSystem here, or name it with providerModule so a composition patch can carry it')
  }
  return {
    providerClass: config.providerClass,
    providerConfig: resolveProviderConfig(config.providerClass, config.providerConfig),
  }
}

/**
 * Import the provider class a composition named, SYNCHRONOUSLY.
 *
 * **SYNCHRONOUS ON PURPOSE: `apply` IS SYNCHRONOUS TODAY AND EVERY CALLER TREATS IT SO.** Making the mount
 * async to accommodate a string would change the contract for every existing caller — including the courts,
 * which call `apply` in `assert.throws` — so the module is required rather than imported, and a specifier
 * that does not resolve fails at the mount, loudly, which is where a missing module belongs. **This is the
 * same failure the composition-mounting skill records: a row whose module the release does not have.**
 *
 * @param {string} specifier - the module to require, resolved from this package.
 * @returns {Function} the provider class it exports.
 * @throws {Error} `aukora-core-read-deny:no-provider` when the module has no usable class.
 */
export function resolveProviderModule(specifier) {
  const require = createRequire(import.meta.url)
  let loaded
  try {
    loaded = require(specifier)
  } catch (cause) {
    throw mountRefused(CORE_DENY_MOUNT_REFUSE.NO_PROVIDER,
      `providerModule ${JSON.stringify(specifier)} could not be loaded: ${String(cause?.code ?? cause)}. `
      + 'A row whose module the release does not have is the failure this names at the mount rather than at '
      + 'the first read')
  }
  // **A MODULE MAY EXPORT THE CLASS ITSELF OR CARRY IT ON `default`**, which is how a package that also
  // exports helpers presents it. Anything else is refused rather than guessed at.
  const candidate = typeof loaded === 'function' ? loaded : loaded?.default
  if (typeof candidate !== 'function') {
    throw mountRefused(CORE_DENY_MOUNT_REFUSE.NO_PROVIDER,
      `providerModule ${JSON.stringify(specifier)} did not export a provider class (it was `
      + `${typeof loaded})`)
  }
  return candidate
}

/**
 * **RESOLVE THE PROVIDER'S CONFIG THROUGH THE PROVIDER'S OWN SCHEMA.**
 *
 * AURA's `aura-95` and report `eb0c8b35`, and this is the morning release's blocker. The composition row inserts
 * this guard with `{providerModule: …}` and **NO `providerConfig`**, so `readConfig` returned
 * `providerConfig: undefined` and `super(ctx, undefined)` reached `fs-local/lib/index.js:739`, where
 * `Number.isSafeInteger(resolved.diffBasisMaxBytes)` is false when the field is `undefined` — **IT THROWS**, `fs`
 * is never provided, `ptc-runtime`, `workspace-files` and `ui-deliverables` stay pending, `dsh` reports
 * *"5 entries did not activate"*, and `/app/aumalive.js` 404s.
 *
 * **AND `fs-local` SAYS THE FIX IN ITS OWN COMMENT** (`:728`): *"Validated config (schemastery applied the
 * defaults before construction)."* **THE CONSTRUCTOR EXPECTS A CONFIG THAT HAS ALREADY BEEN THROUGH THE SCHEMA**,
 * and this guard was the one caller that could hand it a raw `undefined`. So we run it through the schema here.
 *
 * **WHY THE SCHEMA AND NOT AN EMPTY OBJECT.** `{}` resolved through the schema yields the upstream defaults
 * (`diffBasisMaxBytes: 10485760`, `cwd: process.cwd()`), because the schema declares them with `.default(...)`.
 * **PASSING `{}` DIRECTLY WOULD BE A DIFFERENT THING: the limits would still be missing, and a guard that
 * silently disabled the diff-basis cap while appearing to work is worse than one that refuses.** *An empty object
 * is not a default; a schema applied to an empty object is.*
 *
 * **AND WHEN THERE IS NO SCHEMA AND NO CONFIG, IT REFUSES.** A provider class that publishes no `Config` and a
 * row that supplies none leaves the defaults unknowable, and *guessing them is how the guard comes to run with
 * limits nobody chose.*
 *
 * @param {Function} providerClass - the class resolved from `providerClass` or `providerModule`.
 * @param {object|undefined} supplied - `providerConfig` as the row gave it.
 * @returns {object} the config to hand the constructor.
 * @throws {Error} `aukora-core-read-deny:no-provider` when the defaults cannot be established.
 */
/**
 * **THE PROVIDER'S OWN `inject`, READ FROM THE CLASS AND CHECKED AGAINST WHAT THIS GUARD DECLARED.**
 *
 * This is the arm that stops the release's blocker from recurring in a new shape: **if a provider the guard wraps
 * requires a service this module does not declare, the mount REFUSES BY NAME.** Without it, the next upstream
 * addition is a `TypeError` inside a constructor — the failure this file has now produced twice.
 *
 * **AND IT REFUSES BEFORE ANY CONSTRUCTION**, because a provider built against a context that cannot serve it is a
 * provider that has already done half its work.
 *
 * @param {Function} providerClass - the class resolved from the row.
 * @throws {Error} `aukora-core-read-deny:provider-service-undeclared`
 */
export function assertProviderServicesDeclared(providerClass) {
  const required = providerClass?.inject
  if (required === undefined) return Object.freeze([])
  // **A PROVIDER'S `inject` IS A MAP OR AN ARRAY, AND BOTH ARE READ AS NAMES.** Cordis's own fiber records it as a
  // map; a class literal writes an array. Accepting only one would make this check silently vacuous for the other,
  // *and a check that is vacuous for half its inputs is a check that reports the wrong thing on the day it fires.*
  const names = Array.isArray(required)
    ? required.map(entry => String(entry))
    : Object.keys(required ?? {}).map(entry => String(entry))
  const undeclared = names.filter(service => !inject.includes(service))
  if (undeclared.length > 0) {
    throw mountRefused(CORE_DENY_MOUNT_REFUSE.PROVIDER_SERVICE_UNDECLARED,
      `${providerClass.name || 'the provider class'} requires ${undeclared.join(', ')}, and this guard declares `
      + `only ${inject.join(', ')}. A wrapper that passes a context it has not prepared moves the failure one `
      + 'frame deeper — *which is exactly how sandboxPolicy blocked the morning release* — so this refuses here '
      + 'rather than in the provider\'s constructor. Add the service to PROVIDER_REQUIRED_SERVICES, which is the '
      + 'union of the providers this guard wraps')
  }
  return Object.freeze(names)
}

export function resolveProviderConfig(providerClass, supplied) {
  const schema = providerClass.Config ?? providerClass.configSchema ?? providerClass.ConfigSchema
  if (schema === undefined) {
    if (supplied === undefined) {
      throw mountRefused(CORE_DENY_MOUNT_REFUSE.NO_PROVIDER,
        `${providerClass.name || 'the provider class'} publishes no Config schema and the row supplied no `
        + 'providerConfig, so the provider\'s defaults are unknowable. Refusing rather than constructing with a '
        + 'config nobody chose\' — an empty object here is how a limit goes missing in silence')
    }
    return supplied
  }
  if (typeof schema !== 'function') {
    throw mountRefused(CORE_DENY_MOUNT_REFUSE.NO_PROVIDER,
      `${providerClass.name || 'the provider class'} publishes a Config that is not callable (${typeof schema}), `
      + 'so its defaults cannot be applied')
  }
  let resolved
  try {
    // **SCHEMASTERY SCHEMAS ARE CALLABLE AND APPLY THEIR DECLARED DEFAULTS** — measured against the real
    // `fs-local` class, whose `Config({})` returns `{cwd, diffBasisMaxBytes: 10485760}`. This is why the guard
    // needs no schemastery import of its own: *the provider publishes the schema, so the provider is the thing
    // that knows its own defaults.*
    resolved = schema(supplied ?? {})
  } catch (cause) {
    throw mountRefused(CORE_DENY_MOUNT_REFUSE.NO_PROVIDER,
      `${providerClass.name || 'the provider class'}'s Config schema refused the supplied config: `
      + `${String(cause?.message ?? cause)}`)
  }
  if (resolved === null || typeof resolved !== 'object') {
    throw mountRefused(CORE_DENY_MOUNT_REFUSE.NO_PROVIDER,
      `${providerClass.name || 'the provider class'}'s Config schema resolved to ${typeof resolved} rather than a `
      + 'record, so there is nothing to construct with')
  }
  return resolved
}

/**
 * Build a mount refusal.
 *
 * @param {string} code - one of {@link CORE_DENY_MOUNT_REFUSE}.
 * @param {string} message - what went wrong.
 * @returns {Error} the refusal.
 */
function mountRefused(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
