/**
 * Package-owned invariant companion for `@aukora/face-documents`.
 * @module @aukora/face-documents/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@aukora/face-documents'

/** Cordis companion plugin name. */
export const name = 'client-ui-documents-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this app owns no document store, no key material and no mutable
 * cross-plugin relationship. It owns ONE read-only relationship — two loopback routes
 * that open files under a fixed root with the read-only flag and never write — and a
 * runtime invariant restating the reader's own boundary checks would be a second copy of
 * them, checked by the same author. The boundary is measured by
 * `tests/aukora-documents.test.mjs` against a disposable fixture root, where each refusal
 * has an arm that goes red when it is broken. Slot conflicts fail loud in the slot core.
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
