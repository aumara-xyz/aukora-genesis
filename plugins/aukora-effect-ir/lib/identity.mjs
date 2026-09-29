/**
 * see = sign = execute. Three digests, one value, or refuse.
 *
 * Equality is not an ALLOW. A typed effect whose digests match is still not
 * permission to run. This module does not call the kernel and does not sign.
 *
 * @module @aukora/effect-ir/identity
 */
const HEX = /^[0-9a-f]{64}$/u

/**
 * @param {unknown} see digest of the typed record
 * @param {unknown} sign digest the record claims was signed
 * @param {unknown} execute digest the kernel request would carry as payloadHash
 */
export function seeSignExecute(see, sign, execute) {
  if (typeof see !== 'string' || !HEX.test(see)) {
    return Object.freeze({ ok: false, code: 'see-sign-execute:see', see: null, sign: null, execute: null })
  }
  const shownSign = typeof sign === 'string' ? sign : null
  const shownExecute = typeof execute === 'string' ? execute : null
  if (sign !== see || execute !== see) {
    return Object.freeze({ ok: false, code: 'see-sign-execute:diverge', see, sign: shownSign, execute: shownExecute })
  }
  return Object.freeze({ ok: true, code: 'see-sign-execute:equal', see, sign, execute, allows: false })
}
