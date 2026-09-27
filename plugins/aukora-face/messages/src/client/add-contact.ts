// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * WHAT A PERSON MAY TYPE INTO THE ADD-CONTACT SHEET, CHECKED BEFORE ANYTHING IS ASKED OF THE HOST.
 *
 * Three fields, three checks, and each one refuses with the HOST'S OWN CODE rather than a new vocabulary:
 * a client that invented `client.bad-npub` would put two names on one condition and the sheet's inline refusal
 * would no longer match what the route says when it refuses the same thing (`add-contact-route.ts`).
 *
 * WHY BECH32 IS DECODED HERE RATHER THAN TRUSTED TO `startsWith('npub1')`. An npub is a bech32 string with a
 * BIP-173 checksum, and its whole purpose is that a TYPO IS DETECTABLE. A prefix test accepts
 * `npub1thisisnotakey`, and the person then waits for a round trip to learn what their own screen could have
 * told them. The polymod below is the reference algorithm, not an approximation of it.
 *
 * THE CASING RULE IS PART OF BECH32, NOT A STYLE CHOICE: mixed case is INVALID, while all-upper and all-lower
 * are both valid, and an npub is canonically lower. So `NPUB1…` is accepted-and-lowered and `Npub1…` is refused.
 */

/** The bech32 character set, in value order. */
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

/** The generators BIP-173's polymod multiplies by. */
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

/** A bech32 string is at most 90 characters; an npub is exactly 63. */
const NPUB_LENGTH = 63

/** The friend's controller key is a raw secp256k1 x-coordinate: 32 bytes, written as lower-case hex. */
const CONTROLLER_LENGTH = 64

/** What a check answers: the canonical value, or the route's code and a sentence for the person. */
export type NpubCheck = { readonly ok: true; readonly npub: string } | { readonly ok: false; readonly reason: string; readonly detail: string }

/** The controller key's answer. */
export type ControllerCheck = { readonly ok: true; readonly controller: string } | { readonly ok: false; readonly reason: string; readonly detail: string }

/** The name's answer. */
export type NameCheck = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly reason: string; readonly detail: string }

/** The whole draft's answer: the body the route expects, or the first refusal. */
export type BodyCheck =
  | { readonly ok: true; readonly body: { readonly npub: string; readonly controller: string; readonly name: string } }
  | { readonly ok: false; readonly reason: string; readonly detail: string }

/** The longest name the sheet will send. The route refuses anything it cannot hold; this is the same ceiling. */
export const MAX_ADD_NAME = 120

/** The refusal codes, which are the ROUTE'S (see the module header). */
export const ADD_REFUSE = Object.freeze({
  NPUB: 'messages:add-npub-invalid',
  CONTROLLER: 'messages:add-controller-invalid',
  NAME: 'messages:add-name-invalid',
})

/**
 * The BIP-173 checksum step.
 * @param values - the 5-bit values to fold, including the checksum.
 * @returns the polymod residue; 1 means a valid bech32 checksum.
 */
function polymod(values: readonly number[]): number {
  let checksum = 1
  for (const value of values) {
    const top = checksum >> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let bit = 0; bit < 5; bit += 1) {
      const generator = GENERATOR[bit] ?? 0
      if (((top >> bit) & 1) === 1) checksum ^= generator
    }
  }
  return checksum
}

/**
 * The values a checksum is computed over: the human-readable part, a separator, then the data.
 * @param hrp - the human-readable part.
 * @returns the expanded values.
 */
function expand(hrp: string): number[] {
  const high = []
  const low = []
  for (const character of hrp) {
    const code = character.charCodeAt(0)
    high.push(code >> 5)
    low.push(code & 31)
  }
  return [...high, 0, ...low]
}

/**
 * Check one npub.
 *
 * EVERY FAILURE IS THE SAME CODE, deliberately: which character was wrong is not a thing to explain to a
 * person, and a finer refusal vocabulary would leak the checksum's structure for no benefit.
 * @param value - what was typed.
 * @returns the canonical lower-case npub, or the refusal code.
 */
export function checkNpub(value: unknown): NpubCheck {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw.length === 0) return { ok: false, reason: ADD_REFUSE.NPUB, detail: 'no npub was given' }
  // MIXED CASE IS INVALID BECH32; all-upper is valid and is lowered, exactly as the encoding says.
  const lower = raw.toLowerCase()
  if (raw !== lower && raw !== raw.toUpperCase()) {
    return { ok: false, reason: ADD_REFUSE.NPUB, detail: 'mixed case is not a valid bech32 string' }
  }
  if (lower.length !== NPUB_LENGTH) {
    return { ok: false, reason: ADD_REFUSE.NPUB, detail: `an npub is ${String(NPUB_LENGTH)} characters; this is ${String(lower.length)}` }
  }
  const separator = lower.lastIndexOf('1')
  const hrp = lower.slice(0, separator)
  const data = lower.slice(separator + 1)
  if (separator < 1 || data.length < 6) {
    return { ok: false, reason: ADD_REFUSE.NPUB, detail: 'the string has no readable part before its data' }
  }
  if (hrp !== 'npub') {
    return { ok: false, reason: ADD_REFUSE.NPUB, detail: `this is a bech32 string for "${hrp}", not an npub` }
  }
  const values = []
  for (const character of data) {
    const index = CHARSET.indexOf(character)
    if (index === -1) return { ok: false, reason: ADD_REFUSE.NPUB, detail: `"${character}" is not a bech32 character` }
    values.push(index)
  }
  if (polymod([...expand(hrp), ...values]) !== 1) {
    return { ok: false, reason: ADD_REFUSE.NPUB, detail: 'the checksum does not match, so a character is wrong' }
  }
  return { ok: true, npub: lower }
}

/**
 * Check the friend's controller key: the raw public key the contact record is written against.
 * @param value - what was typed.
 * @returns the canonical lower-case key, or the refusal code.
 */
export function checkController(value: unknown): ControllerCheck {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw.length === 0) return { ok: false, reason: ADD_REFUSE.CONTROLLER, detail: 'no controller key was given' }
  // UPPER CASE IS REFUSED RATHER THAN LOWERED: this is a key a person copies from somewhere, and silently
  // accepting a case the source did not use hides a transcription that went through a phone keyboard.
  if (!/^[0-9a-f]{64}$/u.test(raw)) {
    return {
      ok: false,
      reason: ADD_REFUSE.CONTROLLER,
      detail: raw.length === CONTROLLER_LENGTH ? 'the key is 64 characters but not lower-case hex' : `a controller key is ${String(CONTROLLER_LENGTH)} lower-case hex characters; this is ${String(raw.length)}`,
    }
  }
  return { ok: true, controller: raw }
}

/**
 * Check the name.
 * @param value - what was typed.
 * @returns the trimmed name, or the refusal code.
 */
export function checkName(value: unknown): NameCheck {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw.length === 0) return { ok: false, reason: ADD_REFUSE.NAME, detail: 'a contact needs a name to be shown under' }
  if (raw.length > MAX_ADD_NAME) {
    return { ok: false, reason: ADD_REFUSE.NAME, detail: `a name may be up to ${String(MAX_ADD_NAME)} characters` }
  }
  return { ok: true, name: raw }
}

/**
 * Check all three fields at once.
 * @param draft - the three fields, as typed.
 * @returns the body the route expects, or the FIRST refusal in field order.
 */
export function checkAddContact(draft: {
  readonly name?: unknown
  readonly npub?: unknown
  readonly controller?: unknown
}): BodyCheck {
  const name = checkName(draft?.name)
  if (name.ok !== true) return name
  const npub = checkNpub(draft?.npub)
  if (npub.ok !== true) return npub
  const controller = checkController(draft?.controller)
  if (controller.ok !== true) return controller
  return { ok: true, body: { npub: npub.npub, controller: controller.controller, name: name.name } }
}
