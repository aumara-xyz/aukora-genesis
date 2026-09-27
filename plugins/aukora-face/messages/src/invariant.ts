/**
 * Package-owned invariant companion for `@aukora/face-messages`.
 * @module @aukora/face-messages/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@aukora/face-messages'

/** Cordis companion plugin name. */
export const name = 'client-ui-messages-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this preview owns no messaging engine,
 * key material, contact state, transport, events, or mutable cross-plugin
 * relationship. Slot conflicts fail loud in the slot core, and component specs
 * assert the disabled-only control inventory.
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
