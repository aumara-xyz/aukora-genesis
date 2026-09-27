/**
 * Package-owned invariant companion for `@aukora/face-aumlok`.
 * @module @aukora/face-aumlok/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@aukora/face-aumlok'

/** Cordis companion plugin name. */
export const name = 'client-ui-aumlok-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the browser projection owns no key
 * material or authority and its exact record is validated before publication.
 * Slot conflicts fail loud in the slot core; focused specs assert the
 * disconnected default and the five-field read-only presentation.
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
