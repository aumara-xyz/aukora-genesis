/**
 * Package-owned invariant companion for `@aukora/face-settings`.
 * @module @aukora/face-settings/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@aukora/face-settings'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-general-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: slot conflicts fail loud in the slot core,
 * the settings seam owns onboarding validation, and the session-projection
 * registry owns each Aura fold's event-order relationship. The local document
 * action and client-only Aura aggregation have no authoritative mutable
 * relationship for this companion to assert.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
