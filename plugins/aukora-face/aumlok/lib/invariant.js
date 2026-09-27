//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@aukora/face-aumlok`.
* @module @aukora/face-aumlok/invariant
*/
const PACKAGE_NAME = "@aukora/face-aumlok";
/** Cordis companion plugin name. */
const name = "client-ui-aumlok-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the browser projection owns no key
* material or authority and its exact record is validated before publication.
* Slot conflicts fail loud in the slot core; focused specs assert the
* disconnected default and the five-field read-only presentation.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
