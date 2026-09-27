/** Package-owned invariant companion for `@deepseek-ai/dsh-aukora-memory`. @module @deepseek-ai/dsh-aukora-memory/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-aukora-memory'
/** Cordis companion plugin name. */
export const name = 'aukora-memory-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']
/**
 * No runtime invariant: the governed effect's integrity is enforced by the
 * broker process re-verifying every signed request at effect time, not by a
 * replayable session event, and a grant never appears in the session log.
 */
const install: InvariantInstaller = () => {}
/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
