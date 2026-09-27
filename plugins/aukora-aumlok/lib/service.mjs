/**
 * The Cordis plugin half: one service, `ctx.aumlokControl`.
 *
 * WHY THIS FILE IMPORTS NOTHING. A plugin mounted from a composition row is
 * loaded by absolute path, and a plugin under `plugins/` resolves bare specifiers
 * from its own directory chain. In the pinned release, `@deepseek-ai/cordis`
 * resolves only inside a workspace package — each `packages/**` directory carries
 * its own `node_modules/@deepseek-ai/cordis` symlink into `vendor/cordis` — so a
 * static `import { Service } from '@deepseek-ai/cordis'` here would fail to
 * resolve at load time. Measured, not assumed: see the mount note in
 * `scripts/aumlok/PROVENANCE.md`.
 *
 * The `Service` base class is a convenience over `ctx.provide(name, value, check)`
 * (Cordis `vendor/cordis/lib/index.js`: `Service`'s constructor calls
 * `ctx.reflect.provide`, and `provide` is mixed into `Context`). So this module
 * uses that mechanism directly, imports nothing, and fails loudly if the host
 * context does not expose it rather than silently mounting nothing.
 *
 * WHAT THE SERVICE IS. The adapter surface and nothing more. Every method is the
 * corresponding pure function from `index.mjs`; the service adds no state, no
 * caching and no authority. `refresh()` re-reads the configured controller
 * directory, because check-at-use must re-read rather than trust a value captured
 * at launch — an absent, replaced, revoked or differently controlled identity must
 * not inherit a launch-pinned expectation.
 *
 * CEILINGS ARE NOT OPTIONAL ON THE SERVICE EITHER. `ceilings()` is on the surface,
 * so a consumer cannot present the identity facts without being one call away from
 * the limits that qualify them.
 *
 * @module @aukora/dsh-plugin-aumlok/service
 */
import { verifyAndApplyRootControlPromotion } from './control.mjs'
import { ceilingLines } from './ceilings.mjs'
import { verifyDelegationAttenuation } from './delegation.mjs'
import {
  admitPublicControl,
  projectPublicControl,
  publicControlDigest,
} from './projection.mjs'
import { loadLocalAumlokPublicControl } from './store.mjs'

/** Loader-visible plugin name. */
export const name = 'aukora-aumlok'

/** The service name registered on the context. */
export const SERVICE_NAME = 'aumlokControl'

/** This plugin depends on no other service; it reads a directory it is given. */
export const inject = Object.freeze([])

/** The only configuration fields a mount may carry. */
export const SERVICE_CONFIG_FIELDS = Object.freeze(['directory', 'expectation', 'capabilities'])

/**
 * Stable refusals the mounted service itself produces, so a missing setting is a NAME
 * rather than only a sentence. The rest of this lane already refuses by name —
 * `aumlok:control-unbound`, `aumlok:ed25519-point-validator-unavailable` — and a mount
 * that answers a missing `directory` with prose would be the one place a caller had to
 * parse English to tell "not configured" from "configured and wrong".
 */
export const AUMLOK_SERVICE_REFUSE = Object.freeze({
  UNBOUND: 'aumlok:adapter-unbound',
  NO_REGISTRY: 'aumlok:host-registry-unavailable',
})

/** A mount or service failure carrying one stable refusal code. */
export class AumlokServiceError extends TypeError {
  /**
   * @param {string} code - one {@link AUMLOK_SERVICE_REFUSE} value.
   * @param {string} detail - the observed defect.
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'AumlokServiceError'
    this.code = code
  }
}

/**
 * Build the adapter service value.
 * @param {unknown} [config] - controller directory, optional pin, optional cryptographic capabilities.
 * @returns {Readonly<Record<string, unknown>>} frozen adapter surface.
 */
export function createAumlokControlService(config = {}) {
  const { directory, expectation, capabilities } = readServiceConfig(config)
  return Object.freeze({
    /** The configured controller directory, or undefined when the mount is unbound. */
    directory,
    /**
     * Re-read the configured controller and project its public control.
     * @returns {Readonly<Record<string, unknown>>} the public projection.
     */
    refresh() {
      if (directory === undefined) {
        throw new AumlokServiceError(
          AUMLOK_SERVICE_REFUSE.UNBOUND,
          'no controller directory is configured; a mount binds an identity with config.directory',
        )
      }
      return loadLocalAumlokPublicControl(directory, expectation).projection
    },
    /** Project one caller-supplied control pair. */
    project: (control, options) => projectPublicControl(control, options ?? { capabilities }),
    /** Read and project one controller directory. */
    load: (path, pin) => loadLocalAumlokPublicControl(path, pin).projection,
    /** Admit one projection against a pinned expectation and the claiming key. */
    admit: facts => admitPublicControl(facts),
    /** Digest one projection so a consumer can pin what it admitted. */
    digest: projection => publicControlDigest(projection),
    /** Verify one hybrid root-control promotion against its predecessor. */
    verifyPromotion: (current, promotion) => verifyAndApplyRootControlPromotion(current, promotion, capabilities),
    /** Verify one child delegation claim is a strict attenuation of its parent. */
    verifyAttenuation: (parent, child, expected) => verifyDelegationAttenuation(parent, child, expected),
    /** The limits that qualify every value above. */
    ceilings: options => ceilingLines(options),
  })
}

/**
 * Cordis plugin entry: register the adapter as `ctx.aumlokControl`.
 *
 * RETURNS NOTHING, DELIBERATELY. `ctx.provide()` returns a disposer, but Cordis's plugin
 * runner ignores a plugin function's return value (`Fiber._runner.execute` in `vendor/cordis`
 * returns `callback(this.ctx, this.config)` and the fiber's own disposer comes from
 * `ctx.fiber.effect`). `provide` is already fiber-scoped, so returning its disposer would add
 * a second, unread lifetime mechanism whose only effect would be to mislead a reader into
 * thinking a plugin-level dispose exists. The arm asserts the `undefined` on purpose.
 *
 * @param {{provide?: (name: string, value: unknown, check?: unknown) => unknown}} ctx - host context.
 * @param {unknown} config - mount configuration.
 * @returns {undefined} nothing; the registration lives and dies with this fiber.
 */
export function apply(ctx, config) {
  if (typeof ctx?.provide !== 'function') {
    throw new AumlokServiceError(
      AUMLOK_SERVICE_REFUSE.NO_REGISTRY,
      'the host context exposes no ctx.provide(); refusing to mount an adapter nothing can reach',
    )
  }
  ctx.provide(SERVICE_NAME, createAumlokControlService(config ?? {}))
  return undefined
}

/**
 * Read the mount configuration, refusing an unknown field.
 *
 * A subset of the three known fields is fine; anything else is a typo or a
 * smuggled setting, and mounting with a setting nothing reads is how a mount
 * silently runs at a ceiling nobody chose.
 * @param {unknown} config - candidate configuration.
 * @returns {{directory: string | undefined, expectation: unknown, capabilities: unknown}} validated settings.
 */
function readServiceConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('aukora-aumlok config: must be a plain record')
  }
  const unknown = Object.keys(config).filter(key => !SERVICE_CONFIG_FIELDS.includes(key))
  if (unknown.length > 0) {
    throw new TypeError(`aukora-aumlok config: unknown field(s) ${unknown.join(', ')}`)
  }
  const directory = /** @type {Record<string, unknown>} */ (config).directory
  if (directory !== undefined && (typeof directory !== 'string' || directory.length === 0)) {
    throw new TypeError('aukora-aumlok config.directory: must be a non-empty string path when present')
  }
  return {
    directory: /** @type {string | undefined} */ (directory),
    expectation: /** @type {Record<string, unknown>} */ (config).expectation,
    capabilities: /** @type {Record<string, unknown>} */ (config).capabilities,
  }
}
