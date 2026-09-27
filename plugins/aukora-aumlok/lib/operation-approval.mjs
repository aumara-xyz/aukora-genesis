/**
 * The AUMLOK approval path, as one named interface another lane can call.
 *
 * THE PROBLEM THIS EXISTS FOR. D2's approval machinery was reachable only from inside the test
 * court: `createOwnerApprovalSession` is a library object, the challenge ledger lives in that
 * object's memory, and a receipt is minted by calling four functions in the right order. A second
 * lane that wants to gate a real operation on a real approval had no NAME to call, and no artifact
 * to hand around. So this module is that name:
 *
 *   approveOperation({…})  → an approval ARTIFACT: one `aukora:approval-receipt:v1` record.
 *   settleOperation({…})   → a verdict on one artifact presented against one operation.
 *
 * THE OPERATION DIGEST, DEFINED EXACTLY, because a digest convention nobody can re-derive is a
 * convention nobody can check. The digest an approval is over is
 *
 *     operationDigest = sha256( utf8("aukora:operation-content:v1") ‖ 0x00 ‖ contentBytes )
 *
 * and nothing else. {@link operationDigestOf} computes it, {@link OPERATION_CONTENT_DOMAIN} names
 * it, and a consumer that has the content can re-derive the digest itself rather than trusting a
 * caller's claim about it. There is exactly ONE accepted convention here: a second, "also accept
 * sha256(content)" branch is the fail-open superset this lane refuses everywhere else, and it would
 * make two different byte strings share a digest.
 *
 * THE ARTIFACT IS THE RECEIPT, AND NOTHING ELSE. No envelope, no wrapper, no duplicate digest
 * field. That is deliberate: a wrapper would give two places for the operation digest to live, and
 * a consumer would have to know which one is authoritative. The artifact this interface produces
 * is byte-for-byte what `scripts/aumlok/verify-approval` already verifies from an empty directory
 * with nothing but the receipt and the registered public key — so an outside party can check an
 * artifact produced here without this lane, this checkout or these functions.
 *
 * REFUSALS ARE NAMED FACTS, NOT EXCEPTIONS. Both entry points RETURN a verdict; neither throws on
 * an operational failure. A caller rendering an application must be able to show "the signer is not
 * listening" without an exception unwinding its render path. The names are: *
 *   aumlok:approval-boolean-is-not-consent   a caller offered a boolean instead of an approval
 *   aumlok:approval-unavailable              the identity is not the one that was pinned
 *   aumlok:approval-expired                  the window closed before the approval was used
 *   aumlok:approval-replayed                 this exact approval has already been settled once
 *   aumlok:approval-key-mismatch             the approval names a key this identity does not register
 *   aumlok:approval-operation-mismatch       the operation is not the one the approval covers
 *   aumlok:approval-signature-invalid        the signature does not verify under the registered key
 *   aumlok:settlement-no-approval            no approval was presented at all
 *   aumlok:approval-malformed                an input is not a record of the shape it claims
 *   aumlok:settlement-state-malformed        the disposable settlement state is not usable
 *   aumlok:channel-*                         the signer socket was absent, slow or off-protocol
 *   aumlok:approval-refused                  the signer answered, and said no
 *   aumlok:unbound / aumlok:no-seed          the signer answered that this machine is not ready to
 *                                            sign, which is NOT a refusal by the owner: binding the
 *                                            machine (or restoring the seed it kept) is the fix, and
 *                                            a caller that shows "the owner declined" here is lying.
 *                                            The two names are defined in `signer-refusal.mjs`
 *
 * WHY THE REQUEST IS BUILT HERE RATHER THAN BY `createOwnerApprovalSession`. The receipt has to name
 * the exact bytes that were signed, and those bytes derive from the request. A patched-together
 * session would have to return a request it built internally, or this module would have to
 * RECONSTRUCT one from the verdict — and a reconstructed request that is wrong by one field mints a
 * receipt whose signature silently does not verify. So the request is built here, from the admitted
 * projection, and the signer's response is verified against THAT request by
 * {@link verifyResponse}, which re-derives the bytes with the same exported primitives the session
 * uses. One object, built once, verified and recorded: there is nothing to reconstruct and so
 * nothing to get wrong.
 *
 * NO BOOLEAN IS AN APPROVAL. There is no `confirm` option and no code path where a `true` produces
 * an artifact. A caller that supplies one is refused BY NAME
 * ({@link APPROVAL_PATH_REFUSE.BOOLEAN_NOT_CONSENT}) whether or not a signer is listening, because
 * a boolean is a value a program can set and an approval is a signature a key must produce. The
 * refusal is deliberate rather than merely absent: `confirm: true` is what an unreviewed change
 * looks like when it is trying to pass for consent, and this lane would rather name it than ignore
 * it.
 *
 * WHAT AN OPEN GATE DOES NOT SAY. `SETTLEMENT_GATE: OPEN` means: one signature verified, under the
 * registered key, over the exact bytes that name this operation digest, inside the window, for the
 * pinned identity, and the challenge was consumed exactly once. It does NOT mean a person attended
 * (the approver is a named, labelled procedure and `ATTENDANCE` stays `reported-not-proven`), that
 * the device is trusted, that the identity is bound, or that anything in the world changed. This
 * module performs no operation and holds no key: it decides whether a caller may proceed, and it
 * writes the record of that decision into disposable state.
 *
 * @module @aukora/dsh-plugin-aumlok/operation-approval
 */
import { createHash, randomBytes } from 'node:crypto'
import { closeSync, lstatSync, mkdirSync, openSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { nodeCryptoVerifierCapabilities } from './control.mjs'
import { ed25519PublicKeyFromDidKey } from './did-key.mjs'
import {
  APPROVAL_REFUSE,
  APPROVAL_RESPONSE_DOMAIN,
  approvalSigningBytes,
  createApprovalRequest,
  parseApprovalResponse,
} from './owner-approval.mjs'
import { DEFAULT_APPROVAL_CLASS, KEY_CLASSES, createApprovalReceipt, parseApprovalReceipt } from './approval-receipt.mjs'
import { admitPublicControl } from './projection.mjs'
import { controlFieldsOfRecordV3Projection } from './record-v3.mjs'
import { loadLocalAumlokPublicControl } from './store.mjs'
import { readDigest, readNonNegativeInteger } from './validation.mjs'
import { SIGNER_REFUSE, isNotReadyRefusal } from './signer-refusal.mjs'
import { DEFAULT_SIGNER_TIMEOUT_MS, MAX_APPROVAL_LINE_BYTES, exchangeLine } from './signer-channel.mjs'

/** Domain of the bytes an operation digest is taken over. Part of the digest definition. */
export const OPERATION_CONTENT_DOMAIN = 'aukora:operation-content:v1'

/** Domain of one settlement record — the replay ledger's own entry shape. */
export const SETTLEMENT_RECORD_DOMAIN = 'aukora:aumlok-settlement-record:v1'

/** The one key class this lane can stand behind: the signer holds a software key file. */
export const APPROVAL_KEY_CLASS = 'B'

/** The weakest honest approval class, and the default, because defaulting up is how a claim leaks. */
export const APPROVAL_CLASS_DEFAULT = DEFAULT_APPROVAL_CLASS

/** Directory inside the disposable settlement state that holds the replay markers. */
export const SPENT_CHALLENGE_DIRECTORY = 'spent-challenge'

/**
 * The names this interface refuses by. Facts that already had a name in {@link APPROVAL_REFUSE}
 * keep it — two names for one fact is how a caller's `if` stops matching reality.
 */
export const APPROVAL_PATH_REFUSE = Object.freeze({
  BOOLEAN_NOT_CONSENT: 'aumlok:approval-boolean-is-not-consent',
  IDENTITY_UNBOUND: APPROVAL_REFUSE.UNAVAILABLE,
  EXPIRED: APPROVAL_REFUSE.EXPIRED,
  REPLAYED: APPROVAL_REFUSE.REPLAYED,
  KEY_MISMATCH: 'aumlok:approval-key-mismatch',
  OPERATION_MISMATCH: 'aumlok:approval-operation-mismatch',
  SIGNATURE_INVALID: APPROVAL_REFUSE.SIGNATURE_INVALID,
  SIGNER_REFUSED: APPROVAL_REFUSE.REFUSED,
  CHALLENGE_MISMATCH: APPROVAL_REFUSE.CHALLENGE_MISMATCH,
  CHANNEL_UNAVAILABLE: APPROVAL_REFUSE.CHANNEL_UNAVAILABLE,
  CHANNEL_TIMEOUT: APPROVAL_REFUSE.CHANNEL_TIMEOUT,
  CHANNEL_PROTOCOL: APPROVAL_REFUSE.CHANNEL_PROTOCOL,
  /**
   * The two not-ready names, passed through AS THEMSELVES rather than collapsed into
   * `SIGNER_REFUSED`: an unbound machine is not an owner declining. The values are
   * `signer-refusal.mjs`'s own, imported so a caller can compare against a name this module exports
   * without reaching into another module for the same string.
   */
  UNBOUND: SIGNER_REFUSE.UNBOUND,
  NO_SEED: SIGNER_REFUSE.NO_SEED,
  MALFORMED: APPROVAL_REFUSE.MALFORMED,
  NO_APPROVAL: 'aumlok:settlement-no-approval',
  STATE: 'aumlok:settlement-state-malformed',
  KEY_CLASS_UNMEASURED: 'aumlok:approval-key-class-unmeasured',
  /**
   * An operation whose content does not fit the protocol line, so no description of it can be shown.
   *
   * ITS OWN NAME because the fix is neither "your record is malformed" nor "the owner declined": the
   * operation is too large to put in front of a person on this wire, and an operator can act on that —
   * by shrinking the operation or by growing the protocol — while neither of the other two names would
   * tell them so.
   */
  OPERATION_TOO_LARGE: 'aumlok:approval-operation-too-large',
})

/**
 * The exact bytes an operation digest covers.
 *
 * Byte-exact and re-derivable by anyone holding the content: the domain string, one NUL, then the
 * content itself. No length prefix and no canonicalization — the content is bytes, and this
 * function is the only place the convention is spelled.
 * @param {Buffer|Uint8Array|string} content - the operation's exact content.
 * @returns {string} lowercase SHA-256 hex over `domain ‖ 0x00 ‖ content`.
 */
export function operationDigestOf(content) {
  const bytes = typeof content === 'string'
    ? Buffer.from(content, 'utf8')
    : (Buffer.isBuffer(content) ? content : Buffer.from(content ?? []))
  return createHash('sha256')
    .update(OPERATION_CONTENT_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(bytes)
    .digest('hex')
}

/**
 * THE WITNESS: what is displayed is what is digested, or nothing is signed.
 *
 * WHY THIS EXISTS — AND WHAT WAS ACTUALLY MISSING, stated precisely because the first version of this
 * comment over-claimed. The adapter ALREADY recomputed the digest and refused `OPERATION_MISMATCH` when
 * it did not cover the content; that check was never absent. What was absent was the DISPLAY: the
 * attended command printed the content's byte COUNT and the digest ALGORITHM, never the content. So the
 * person answering the dialog saw `OPERATION_CONTENT_BYTES: 1297` and a hash, and the settlement of
 * 2026-09-21 08:39 was authorized that way: **an approval over a digest its owner could not read.**
 * The binding was real; the witness was absent. This function supplies the display and re-derives the
 * digest from the very text it hands back — and checking here as well is not redundant, because it
 * refuses BEFORE the signer is contacted, so a mismatch never reaches a person.
 *
 * This returns the content to DISPLAY and the digest RECOMPUTED FROM THAT EXACT TEXT, and refuses when
 * they disagree. The caller prints the text; nothing here prints, opens a dialog or touches a socket, so
 * the witness is testable without a terminal and cannot accidentally carry authority.
 *
 * THE UNFORGEABLE PROPERTY, AND NOTHING MORE: **what is displayed is what is digested.** That is a claim
 * about this function's own two operations — it hashes the same string it returns for display — and NOT
 * about the world. What remains unwitnessed, and must be printed beside any use:
 *
 *   1. THE FILE COULD HAVE BEEN SWAPPED BEFORE IT WAS READ. These are the bytes the caller read; whether
 *      they are the bytes the SETTLEMENT will run is a different question no signing-side check answers.
 *   2. SAME-UID PROCESSES CAN REWRITE THE CALLER. Editing the command removes the recomputation. The
 *      witness binds the OPERATOR'S act, not the host's integrity — `SAME_UID` is a printed ceiling.
 *   3. THE SIGNER NEVER SEES THE CONTENT. It signs the seven-field request, so `attendance` stays
 *      `reported-not-proven`: the artifact records that a dialog was answered, never who answered it.
 * @param {Buffer|Uint8Array|string} content - the operation's exact content, as read from disk.
 * @param {string} expectedDigest - the digest the approval would bind.
 * @returns {Readonly<{ok: true, displayed: string, digest: string}> | Readonly<{ok: false, reason: string, detail: string}>}
 */
export function witnessOperationContent(content, expectedDigest) {
  // THE SAME CONVERSION `operationDigestOf` MAKES, so the displayed text is the digested bytes and not a
  // second encoding that could drift from them. A buffer that is not valid UTF-8 would decode lossily and
  // display something the digest does not cover — refused rather than shown, because a witness that shows
  // an approximation is worse than no witness.
  const bytes = typeof content === 'string'
    ? Buffer.from(content, 'utf8')
    : (Buffer.isBuffer(content) ? content : Buffer.from(content ?? []))
  const displayed = bytes.toString('utf8')
  if (!Buffer.from(displayed, 'utf8').equals(bytes)) {
    return refuse('aumlok:witness-content-not-displayable',
      `the operation content is ${String(bytes.length)} byte(s) that do not survive a UTF-8 round trip, so `
      + 'no faithful rendering of it can be shown. Refusing rather than displaying an approximation the '
      + 'digest would not cover.')
  }
  const digest = operationDigestOf(bytes)
  const expected = String(expectedDigest ?? '')
  if (digest !== expected) {
    // THE LANE'S OWN NAME FOR THIS CONDITION, not a second one. The adapter already refuses
    // `OPERATION_MISMATCH` when the digest does not cover the content (below, on the approve path);
    // inventing `aumlok:witness-digest-mismatch` for the same fact would give one condition two names
    // and let a caller handle one and miss the other. Checking it HERE as well is deliberate: this runs
    // BEFORE the signer is contacted, so a mismatch is refused before anything is asked of a person.
    return refuse(APPROVAL_PATH_REFUSE.OPERATION_MISMATCH,
      `the bytes to be displayed hash to ${digest}, but the approval would sign ${expected}. `
      + 'What you see is what you sign, or nothing is signed.')
  }
  // ── AN UNSPOOFABLE RENDERING, because a witness showing the WRONG GLYPHS witnesses nothing ──────
  // MEASURED 2026-09-21, and this was still open: this function handed the terminal the RAW bytes, so an
  // operation body carrying `ESC [ 8m` could conceal text and `U+202E` could reverse the line. The digest
  // was correct and the display was a lie — the exact gap the witness exists to close, reintroduced BY
  // the witness. A hostile author writes the body; the owner reads the screen; those two must not differ.
  //
  // Escaping does not weaken the property. The claim is still "what is displayed is what is digested":
  // the rendering is now a TOTAL, INJECTIVE function of the digested bytes, so it cannot show one thing
  // while covering another. Newline and tab survive because they carry the body's shape and cannot
  // misrepresent it; everything a terminal would INTERPRET, and every invisible formatting character, is
  // made visible as ASCII.
  const { text: safe, escaped, invisible, backslashes, readableInvisible } = escapeForDisplay(displayed)
  return Object.freeze({ ok: true, displayed: safe, digest, escaped, invisible, backslashes, readableInvisible })
}

/**
 * Render text so a terminal shows exactly what the bytes say.
 *
 * Kept beside the witness rather than imported, because it is part of the same claim: the digest covers
 * bytes and the reader sees glyphs, and this is the only function allowed to decide what those glyphs are.
 *
 *   * **C0 and C1 controls, DEL, and anything that would EMBED an escape** become `\xNN` / `\u{NNNN}`.
 *     The escape character itself is the important one: `ESC [ 8m` conceals, `ESC ] 0 ; … BEL` rewrites a
 *     window title, and both are ordinary bytes in a JSON body.
 *   * **INVISIBLE FORMATTING** becomes `<U+NNNN>` — the bidi overrides and isolates that reverse or hide
 *     the order of a line, the zero-width characters that break a comparison a reader performs by eye, and
 *     the Unicode tag block, which encodes a whole hidden ASCII message.
 *   * **NEWLINE and TAB are preserved.** They are ordinary whitespace, they give the body its shape, and
 *     nothing about them lets a body say something other than what it contains.
 * @param {string} text - decoded content.
 * @returns {{text: string, escaped: number, invisible: number}} the safe rendering and what it caught.
 */
export function escapeForDisplay(text) {
  // ONE NOTATION, AND THE BACKSLASH ITSELF IS ESCAPED. Both are required for the rendering to be a
  // REVERSIBLE ENCODING rather than a decoration, and the first version of this function had neither:
  //
  //   * it emitted `\x1b` for a real ESC and also passed the literal four characters `\x1b` through
  //     unchanged, so `a<ESC>[8mb` and the text `a\x1b[8mb` RENDERED IDENTICALLY;
  //   * it emitted `<U+202E>` for a real override and also passed that literal text through, with the
  //     same collision.
  //
  // MEASURED by an adversarial probe, 2026-09-21. Two different bodies, one rendering — and the court that
  // was meant to catch it compared two bodies differing in many other places, so it could never fail.
  //
  // Escaping `\` as `\\` and using `\u{...}` for EVERY escaped code point removes the ambiguity: no
  // literal text can produce the escape syntax, so `decode(render(x)) === x` for every x. The decoder is
  // `decodeForDisplay` below, kept here so the notation and its inverse cannot drift apart unnoticed.
  // COUNTED SEPARATELY, because they are different facts and one note reporting the same number twice
  // reads as a bug — MEASURED LIVE 2026-09-21, where a body with five escapes printed "5 control byte(s)
  // and 5 invisible formatting character(s)". The first version returned `escaped` for both.
  let controls = 0
  let invisibles = 0
  let readableInvisible = 0
  let out = ''
  for (const character of text) {
    const point = character.codePointAt(0)
    if (character === '\n' || character === '\t') { out += character; continue }
    const isControl = point <= 0x1f || (point >= 0x7f && point <= 0x9f)
    const isInvisible = isInvisibleFormatting(character)
    if (isControl || isInvisible || character === '\\') {
      out += `\\u{${point.toString(16).toUpperCase()}}`
      if (isControl) controls += 1
      else if (isInvisible) invisibles += 1
      continue
    }
    // READABLE BUT INVISIBLE, AND THEREFORE COUNTED. The joiners and direction marks are shown VERBATIM
    // because they are ordinary orthography — but a body containing one renders IDENTICALLY to a reader as
    // the same body without it, so UNSHOWN and UNCOUNTED together would let a reader compare two screens
    // and see no difference. MEASURED 2026-09-21: `{"key":"al<U+200D>ice"}` reported escaped=0 invisible=0
    // and looked exactly like `{"key":"alice"}`. The count is the only thing that distinguishes them.
    if (isReadableInvisible(character)) readableInvisible += 1
    out += character
  }
  // A backslash is escape-notational, not invisible formatting, so it is counted in neither. The total is
  // what a reader wants for "how much of this body is not literal text".
  const backslashes = (text.match(/\\/g) ?? []).length
  return { text: out, escaped: controls, invisible: invisibles, backslashes, readableInvisible }
}

/**
 * The inverse of {@link escapeForDisplay}: recover the bytes a rendering came from.
 *
 * EXPORTED SO THE PROPERTY CAN BE TESTED RATHER THAN ASSERTED. `decode(render(x)) === x` is what makes the
 * display readable back, and it is only meaningful if the decoder is written against the NOTATION — a
 * court that called the encoder's inverse would be checking that a function agrees with itself.
 * @param {string} text - a rendering produced by {@link escapeForDisplay}.
 * @returns {string} the original text.
 */
export function decodeForDisplay(text) {
  let out = ''
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character !== '\\') { out += character; index += 1; continue }
    if (text[index + 1] !== 'u' || text[index + 2] !== '{') {
      // A backslash that begins no escape is UNREPRESENTABLE by this encoder, so reaching one means the
      // rendering was produced by something else.
      throw new TypeError(`decodeForDisplay: ambiguous backslash at ${String(index)}`)
    }
    const close = text.indexOf('}', index + 3)
    if (close === -1) throw new TypeError(`decodeForDisplay: unterminated escape at ${String(index)}`)
    const point = Number.parseInt(text.slice(index + 3, close), 16)
    if (!Number.isInteger(point)) throw new TypeError(`decodeForDisplay: bad code point at ${String(index)}`)
    out += String.fromCodePoint(point)
    index = close + 1
  }
  return out
}

/**
 * Would a terminal or a reader treat this character as INVISIBLE FORMATTING?
 *
 * Deliberately NOT "every default-ignorable": the joiners (U+200C, U+200D) and the left-to-right and
 * right-to-left MARKS (U+200E, U+200F) are ordinary marks in Arabic, Hebrew, Persian and the Indic
 * scripts. A witness that escaped them would render ordinary multilingual text unreadable, which is a
 * different way of failing the reader. These four are named as readable on purpose:
 *   * U+200C ZWNJ and U+200D ZWJ — orthographically required in Persian, Hindi, Malayalam and emoji
 *     sequences;
 *   * U+200E LRM and U+200F RLM — directionality marks that appear in ordinary mixed-direction text.
 * What remains here is what hides or reorders WITHOUT being ordinary text: overrides, embeddings,
 * isolates, the zero-width spaces and the word joiner, the BOM, the interlinear annotations, and the
 * Unicode tag block (which encodes a whole hidden ASCII message).
 * @param {string} character @returns {boolean}
 */
function isReadableInvisible(character) {
  const point = character.codePointAt(0)
  return point === 0x200c || point === 0x200d || point === 0x200e || point === 0x200f
}

function isInvisibleFormatting(character) {
  const point = character.codePointAt(0)
  if (point === 0x200c || point === 0x200d || point === 0x200e || point === 0x200f) return false
  return (
    (point >= 0x200b && point <= 0x200f)
    || (point >= 0x202a && point <= 0x202e)
    || (point >= 0x2060 && point <= 0x2064)
    || (point >= 0x2066 && point <= 0x206f)
    || point === 0xfeff
    || (point >= 0xfff9 && point <= 0xfffb)
    || (point >= 0xe0000 && point <= 0xe007f)
  )
}

/** One named refusal verdict. */
function refuse(reason, detail) {
  return Object.freeze({ ok: false, reason, detail })
}

/** One error's message, never a bare `undefined`. */
function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Load the public half of one controller and admit it against a pin.
 *
 * THE PIN IS REQUIRED, and that is the "unbound" refusal. An approval that is not bound to a
 * pinned subject and control digest is an approval of *something* by *someone*, and a caller that
 * did not pin an identity has no way to tell a rotated identity from the one it meant. So a missing
 * pin is refused, not defaulted to "whatever the record says now".
 * @param {object} facts - the directory and the pin.
 * @param {string} facts.directory - private controller directory.
 * @param {unknown} facts.expectation - `{subject, activeControlDigest}`.
 * @returns {Readonly<{ok: true, projection: Readonly<Record<string, unknown>>, path: string} | {ok: false, reason: string, detail: string}>} verdict.
 */
function loadPinnedProjection({ directory, expectation, machinePublicKeyHex = null }) {
  let loaded
  try {
    // THE CALLER'S MACHINE KEY RIDES THROUGH TO THE LOADER, because a record listing several machines
    // does not say which one is this laptop and the loader refuses rather than guess. It is OPTIONAL
    // and defaults to null, so every existing caller keeps the single-machine fallback it had.
    loaded = loadLocalAumlokPublicControl(directory, expectation, machinePublicKeyHex)
  } catch (cause) {
    const code = /** @type {{code?: string}} */ (cause)?.code
    if (code === 'aumlok-local:identity-changed') {
      return refuse(
        APPROVAL_PATH_REFUSE.IDENTITY_UNBOUND,
        `the controller at ${String(directory)} is not the pinned identity (aumlok-local:identity-changed): `
        + `the pin names ${String(/** @type {Record<string, unknown>} */ (expectation)?.subject)} at control `
        + `digest ${String(/** @type {Record<string, unknown>} */ (expectation)?.activeControlDigest)}, and `
        + 'the record no longer derives them',
      )
    }
    // THE LOADER'S OWN CODE IS THE REASON, AND IT USED TO BE THROWN AWAY HERE. Every failure that was
    // not `identity-changed` came back as `aumlok:approval-malformed` with the real code buried in the
    // detail — so a caller that passed a malformed machine key, or one the record does not list, was
    // told its APPROVAL was malformed. Both are codes a caller can act on and neither is about the
    // approval. Fable named this as the flattening disease one layer up, and it is the same shape as the
    // `entry-malformed` sweep in `store.mjs`: a specific, named refusal replaced by a generic one at the
    // boundary. `identity-changed` keeps its own mapping above because there the SENTENCE is worth more
    // than the code; everything else travels by name, and only a failure with NO code at all is still
    // `malformed`, because then there is no name to keep.
    const message = messageOf(cause)
    const named = typeof code === 'string' && code.length > 0 ? code : APPROVAL_PATH_REFUSE.MALFORMED
    // The loader's message is `<code>: <detail>` when it has one, so the code is stripped rather than
    // printed twice — MEASURED before this: a two-machine record reached a caller as
    // `aumlok:record-names-no-machine: aumlok:record-names-no-machine: this record lists 2 machine(s)…`.
    const detail = message === named
      ? ''
      : (message.startsWith(`${named}: `) ? message.slice(named.length + 2) : message)
    return refuse(named, detail)
  }
  // THE PROJECTION IS NARROWED TO THE SEVEN CONTROL FIELDS BEFORE IT IS ADMITTED, AND THIS IS THE WHOLE
  // FIX FOR THE v3 REFUSAL. The loader's answer carries the RECORD facts too — `boundAt` and `handle`,
  // which the screen reads — and `admitPublicControl` refuses an extra field by name, so handing it the
  // whole read would refuse a projection that is perfectly good. `controlFieldsOfRecordV3Projection` is
  // the organ's own narrowing and it FAILS CLOSED: a read missing a control field is refused here by
  // name rather than admitted against a hole.
  let projection
  try {
    projection = controlFieldsOfRecordV3Projection(loaded.projection)
  } catch (cause) {
    return refuse(APPROVAL_PATH_REFUSE.MALFORMED, messageOf(cause))
  }
  const admitted = admitPublicControl({ projection, expected: expectation })
  if (!admitted.ok) {
    return refuse(
      APPROVAL_PATH_REFUSE.IDENTITY_UNBOUND,
      `the identity is not admitted against the pin: ${admitted.reason} — ${admitted.detail}`,
    )
  }
  return Object.freeze({ ok: true, projection, path: loaded.path })
}

/**
 * Ask a signer for one approval over one exact operation, and mint the artifact.
 *
 * The order is the design, and each step is where the corresponding refusal comes from:
 *
 *   0. a boolean confirmation is refused before anything else is looked at;
 *   1. the caller's digest must be the digest OF the content it handed over — otherwise the
 *      approval would cover a digest no content in this call produces;
 *   2. the identity must be pinned and admitted;
 *   3. the window must still be open;
 *   4. a fresh 32-byte challenge is drawn and the request built from the ADMITTED projection, so a
 *      signer cannot be asked to approve an identity the broker did not verify;
 *   5. the response is handed to the shipped verifier, which checks the challenge, the window
 *      again (the round trip takes time), the signature under the REGISTERED key, and consumes the
 *      challenge once;
 *   6. only then is the receipt minted, over the request the broker itself built.
 *
 * This function never throws for an operational failure and it holds no key: the private half stays
 * in the signer process, which is the whole point of D2's split.
 * @param {object} options - what to approve, against which identity, through which signer.
 * @param {string} [options.machinePublicKeyHex] - 64 hex naming the machine THIS caller is, for a v3
 *   record that lists several. The shell reads it from `machine-seed-v3.json`; a caller that omits it
 *   gets the single-machine fallback and the v3 reader's named refusal for anything else.
 * @param {string} options.directory - private controller directory of the pinned identity.
 * @param {unknown} options.expectation - `{subject, activeControlDigest}` pin.
 * @param {Buffer|Uint8Array|string} options.content - the operation's exact content.
 * @param {unknown} options.operationDigest - the caller's claimed digest over that content.
 * @param {string} options.socketPath - the signer's local Unix socket.
 * @param {string} [options.keyClass] - defaults to `B`; `A` has no measurement here and is refused.
 * @param {string} [options.approvalClass] - defaults to `delegated`; `human-ceremony` is unmintable here.
 * @param {unknown} [options.expiresAt] - unix seconds; the approval window's end.
 * @param {number} [options.timeoutMs] - per-request wait for the signer.
 * @param {() => number} [options.now] - unix seconds; injectable so the window is testable.
 * @param {boolean} [options.booleanConfirmation] - any boolean the caller offered as an approval.
 * @returns {Promise<Readonly<Record<string, unknown>>>} verdict, never an exception.
 */
export async function approveOperation({
  machinePublicKeyHex,
  directory,
  expectation,
  content,
  operationDigest,
  socketPath,
  keyClass = APPROVAL_KEY_CLASS,
  approvalClass = APPROVAL_CLASS_DEFAULT,
  expiresAt,
  timeoutMs = DEFAULT_SIGNER_TIMEOUT_MS,
  now = () => Math.floor(Date.now() / 1000),
  booleanConfirmation = false,
} = /** @type {never} */ ({})) {
  if (booleanConfirmation === true) {
    return refuse(
      APPROVAL_PATH_REFUSE.BOOLEAN_NOT_CONSENT,
      'a boolean was supplied as the approval. A program can set a boolean; only a key can produce '
      + 'a signature, so no value of this option ever yields an artifact — remove it and present an '
      + 'approval, or expect this refusal',
    )
  }
  if (keyClass !== APPROVAL_KEY_CLASS) {
    return refuse(
      APPROVAL_PATH_REFUSE.KEY_CLASS_UNMEASURED,
      `key class ${String(keyClass)} is not mintable here: ${Object.keys(KEY_CLASSES).join('/')} name `
      + `platform custody classes, and no such measurement exists in this lane (D3). The signer holds `
      + `a software key file, which is class ${APPROVAL_KEY_CLASS} (${KEY_CLASSES[APPROVAL_KEY_CLASS]})`,
    )
  }
  let claimed
  let window
  try {
    claimed = readDigest(operationDigest, 'operation approval.operationDigest')
    window = readNonNegativeInteger(expiresAt, 'operation approval.expiresAt')
  } catch (cause) {
    return refuse(APPROVAL_PATH_REFUSE.MALFORMED, messageOf(cause))
  }
  if (content === undefined || content === null) {
    return refuse(
      APPROVAL_PATH_REFUSE.MALFORMED,
      'the exact operation content is required as well as its digest: an approval over a digest '
      + 'nobody can re-derive binds nothing',
    )
  }
  const derived = operationDigestOf(content)
  if (derived !== claimed) {
    return refuse(
      APPROVAL_PATH_REFUSE.OPERATION_MISMATCH,
      `the supplied digest covers no content in this call: sha256(${OPERATION_CONTENT_DOMAIN} ‖ 0x00 ‖ `
      + `content) is ${derived}, and the caller supplied ${claimed}`,
    )
  }
  const pinned = loadPinnedProjection({ directory, expectation, machinePublicKeyHex })
  if (!pinned.ok) return pinned
  const issuedAt = now()
  if (window <= issuedAt) {
    return refuse(
      APPROVAL_PATH_REFUSE.EXPIRED,
      `expiresAt ${String(window)} is not in the future (it is ${String(issuedAt)}); an approval is `
      + 'never minted already expired',
    )
  }
  const request = createApprovalRequest({
    subject: pinned.projection.subject,
    activeControlDigest: pinned.projection.activeControlDigest,
    operationDigest: derived,
    challenge: randomBytes(32).toString('hex'),
    issuedAt,
    expiresAt: window,
  })
  // Z2 — THE OPERATION'S OWN BYTES RIDE WITH THE REQUEST, SO THE PERSON CAN BE SHOWN WHAT THEY ARE
  // APPROVING.
  //
  // `operationContent` IS NOT ONE OF THE SEVEN SIGNED FIELDS AND MUST NEVER BECOME ONE. The request
  // above is built first, and this is added to the LINE rather than to the record: `createApprovalRequest`
  // refuses an extra field by name, and `approvalSigningBytes` re-derives the preimage from the seven
  // fields — so the digest stays the only thing signed and the signer signs exactly what it signed
  // before. What the signer does with these bytes is recompute `sha256` over them and refuse, BY NAME,
  // when they do not hash to `derived`: content that is not the operation is never described to anyone.
  //
  // A CONTENT THAT WILL NOT FIT THE LINE IS REFUSED RATHER THAN TRUNCATED. Both ends cap a protocol
  // line at 64 KiB; a request whose content could not arrive whole would put a description on screen
  // that the digest does not cover, which is worse than no description.
  const encodedContent = Buffer.from(content).toString('base64')
  const line = `${JSON.stringify({ ...request, operationContent: encodedContent })}\n`
  if (Buffer.byteLength(line, 'utf8') > MAX_APPROVAL_LINE_BYTES) {
    return refuse(
      APPROVAL_PATH_REFUSE.OPERATION_TOO_LARGE,
      `this operation's content is ${String(Buffer.byteLength(Buffer.from(content), 'utf8'))} byte(s), which `
      + `does not fit the ${String(MAX_APPROVAL_LINE_BYTES)}-byte protocol line, so no description of it can `
      + 'reach the person being asked. Refusing rather than shortening what would be shown against a digest '
      + 'that covers the whole of it.',
    )
  }
  const exchange = await exchangeLine({ socketPath, line, timeoutMs })
  if (!exchange.ok) return refuse(exchange.reason, exchange.detail)
  let response
  try {
    response = JSON.parse(exchange.text)
  } catch (cause) {
    return refuse(
      APPROVAL_PATH_REFUSE.CHANNEL_PROTOCOL,
      `the signer's reply is not JSON: ${messageOf(cause)}`,
    )
  }
  const verdict = verifyResponse({ projection: pinned.projection, request, response, now })
  if (!verdict.ok) return verdict
  try {
    const receipt = createApprovalReceipt({
      approval: verdict.approval,
      projection: pinned.projection,
      keyClass,
      approvalClass,
      request,
    })
    return Object.freeze({
      ok: true,
      receipt,
      request,
      projection: pinned.projection,
      controllerPath: pinned.path,
    })
  } catch (cause) {
    return refuse(APPROVAL_PATH_REFUSE.MALFORMED, messageOf(cause))
  }
}

/**
 * Verify one signer response over the request the broker itself built.
 *
 * The ONE signature verification in this module. The producing path calls it with the request and
 * the response it just exchanged; the consuming path calls it with a request rebuilt from an
 * artifact's own fields and the response that artifact carries. Neither hands it bytes to trust:
 * the signing bytes are always re-derived from the request, which is what makes "verified" mean
 * "verified against the bytes this side named" rather than "verified against whatever came back".
 * @param {object} facts - the admitted projection, the exact request, the response, and the clock.
 * @returns {Readonly<Record<string, unknown>>} a verdict.
 */
function verifyResponse({ projection, request, response, now }) {
  let parsed
  try {
    parsed = parseApprovalResponse(response)
  } catch (cause) {
    return refuse(APPROVAL_PATH_REFUSE.CHANNEL_PROTOCOL, messageOf(cause))
  }
  if (parsed.kind === 'refused') {
    // A LOCKED SESSION IS NOT A DECISION, AND THIS IS WHERE THE SHIPPED COMMAND GOT IT WRONG.
    // MEASURED 2026-09-22 against a served, locked socket: `signer-channel.mjs` — the broker the
    // library court drives — passed `aumlok:locked` through by name, while THIS function, which is
    // what `scripts/aumlok/approve-operation` actually runs, collapsed it into
    // `aumlok:approval-refused`, "the signer refused with aumlok:locked". So the lane's own court was
    // green about a property the command did not have, and the person reading the terminal was told
    // their owner had declined an operation nobody had shown them. Both readers now ask
    // `isNotReadyRefusal`, defined once beside the names in `signer-refusal.mjs`.
    if (isNotReadyRefusal(parsed.refusal)) {
      return refuse(parsed.refusal, `the signer is not ready: ${parsed.refusal} — binding this machine will fix it`)
    }
    return refuse(APPROVAL_PATH_REFUSE.SIGNER_REFUSED, `the signer refused with ${parsed.refusal}`)
  }
  if (parsed.challenge !== request.challenge) {
    return refuse(
      APPROVAL_PATH_REFUSE.CHALLENGE_MISMATCH,
      `the response names challenge ${parsed.challenge}, not the one that was sent`,
    )
  }
  const at = now()
  if (at >= request.expiresAt) {
    return refuse(
      APPROVAL_PATH_REFUSE.EXPIRED,
      `the approval window closed at ${String(request.expiresAt)} and it is now ${String(at)}`,
    )
  }
  let registeredHex
  try {
    registeredHex = ed25519PublicKeyFromDidKey(projection?.approvalKeyDid)
  } catch (cause) {
    return refuse(
      APPROVAL_PATH_REFUSE.IDENTITY_UNBOUND,
      `the projection names no usable approval key: ${messageOf(cause)}`,
    )
  }
  const verifyEd25519 = nodeCryptoVerifierCapabilities().verifyEd25519
  if (!verifyEd25519(registeredHex, approvalSigningBytes(request), parsed.signature)) {
    return refuse(
      APPROVAL_PATH_REFUSE.SIGNATURE_INVALID,
      `the signature does not verify under the registered key ${String(projection?.approvalKeyDid)}`,
    )
  }
  return Object.freeze({
    ok: true,
    approval: Object.freeze({
      ok: true,
      subject: request.subject,
      activeControlDigest: request.activeControlDigest,
      approvalKeyDid: projection.approvalKeyDid,
      operationDigest: request.operationDigest,
      challenge: request.challenge,
      signature: parsed.signature,
      verifiedAt: at,
    }),
  })
}

/**
 * Open the disposable settlement state: the directory that remembers which challenges were spent.
 *
 * The replay decision is an EXCLUSIVE CREATE of one file per challenge, which is atomic on a local
 * filesystem: two processes racing the same approval cannot both win, because one of them gets
 * `EEXIST`. That is a real property and it is also a bounded one — atomicity under NFS, across
 * hosts, or against a process that rewrites the directory is NOT measured, and the state directory
 * is disposable test state, not custody.
 * @param {string} directory - an existing private (0700, this-euid) directory.
 * @returns {Readonly<{ok: true, directory: string, spentDirectory: string}>} the opened state.
 */
export function openSettlementState(directory) {
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : undefined
  if (euid === undefined || typeof directory !== 'string' || directory.length === 0) {
    return refuse(APPROVAL_PATH_REFUSE.STATE, 'no POSIX euid, or no state directory')
  }
  let state
  try {
    state = lstatSync(directory)
  } catch (cause) {
    return refuse(APPROVAL_PATH_REFUSE.STATE, `${String(directory)} is not readable: ${messageOf(cause)}`)
  }
  if (!state.isDirectory() || state.isSymbolicLink() || state.uid !== euid || (state.mode & 0o777) !== 0o700) {
    return refuse(
      APPROVAL_PATH_REFUSE.STATE,
      `${String(directory)} must be a real directory owned by this euid with mode 0700`,
    )
  }
  const spentDirectory = join(directory, SPENT_CHALLENGE_DIRECTORY)
  try {
    mkdirSync(spentDirectory, { recursive: true, mode: 0o700 })
    const spent = lstatSync(spentDirectory)
    if (!spent.isDirectory() || spent.isSymbolicLink() || spent.uid !== euid || (spent.mode & 0o777) !== 0o700) {
      return refuse(APPROVAL_PATH_REFUSE.STATE, `${spentDirectory} is not a private directory`)
    }
  } catch (cause) {
    return refuse(APPROVAL_PATH_REFUSE.STATE, `cannot open ${spentDirectory}: ${messageOf(cause)}`)
  }
  return Object.freeze({ ok: true, directory, spentDirectory })
}

/**
 * Decide whether one approval artifact permits one operation, and consume it exactly once.
 *
 * THE ORDER IS THE DESIGN, as it is on the verify path: every rule that can be decided without
 * touching the signature is decided first, so a forged identifier is refused for being forged
 * rather than for failing a signature it never should have been asked to produce. And the replay
 * marker is written LAST, after the signature verified — a decision with a stated cost: an
 * attacker holding a copy of the artifact could otherwise burn a legitimate approval by presenting
 * a forged one first. The marker is an exclusive create, so the cost of that choice is one retry,
 * and the alternative's cost is a denial of service on a valid approval.
 *
 * NO APPROVAL IS NOT A PASS. An artifact is required. A BOUND identity, with keys that
 * correspond perfectly and a control digest that matches its pin, settles NOTHING here — the
 * absence of an approval is {@link APPROVAL_PATH_REFUSE.NO_APPROVAL}, by name.
 * @param {object} options - the artifact, the operation, the pinned identity and the state.
 * @param {string} [options.machinePublicKeyHex] - 64 hex naming the machine THIS caller is, for a v3
 *   record that lists several. The shell reads it from `machine-seed-v3.json`; a caller that omits it
 *   gets the single-machine fallback and the v3 reader's named refusal for anything else.
 * @param {string} options.directory - private controller directory of the pinned identity.
 * @param {unknown} options.expectation - `{subject, activeControlDigest}` pin.
 * @param {unknown} options.artifact - the parsed approval artifact, or undefined for none.
 * @param {Buffer|Uint8Array|string} options.content - the operation's exact content, as presented.
 * @param {string} options.stateDirectory - disposable settlement state directory.
 * @param {() => number} [options.now] - unix seconds; injectable so expiry is testable.
 * @returns {Readonly<Record<string, unknown>>} verdict, never an exception.
 */
export function settleOperation({
  machinePublicKeyHex,
  directory,
  expectation,
  artifact,
  content,
  stateDirectory,
  now = () => Math.floor(Date.now() / 1000),
} = /** @type {never} */ ({})) {
  const results = []
  const record = (item, state, detail) => results.push(Object.freeze({ item, state, detail }))
  // Every denial records the question that refused, with state REFUSED, so a caller sees WHICH
  // rule said no rather than only that something did. A refusal that prints nothing about itself is
  // a refusal nobody can act on.
  const denied = (item, reason, detail) => {
    record(item, 'REFUSED', detail)
    return Object.freeze({ ok: false, reason, detail, results: Object.freeze([...results]) })
  }

  if (artifact === undefined || artifact === null) {
    return denied(
      'approval',
      APPROVAL_PATH_REFUSE.NO_APPROVAL,
      'no approval artifact was presented. This identity being BOUND, and its keys '
      + 'corresponding, settles nothing: an approval is a separate act by a separate key, and its '
      + 'absence is not a pass',
    )
  }
  let receipt
  try {
    receipt = parseApprovalReceipt(artifact)
  } catch (cause) {
    return denied('parse', APPROVAL_PATH_REFUSE.MALFORMED, messageOf(cause))
  }
  record('parse', 'VERIFIED', `a closed ${receipt.domain} record with ${String(receipt.ceilings.length)} ceilings`)

  const pinned = loadPinnedProjection({ directory, expectation, machinePublicKeyHex })
  if (!pinned.ok) return denied('identity', pinned.reason, pinned.detail)
  record(
    'identity',
    'VERIFIED',
    `the controller is the pinned identity ${pinned.projection.subject} at control digest `
    + `${pinned.projection.activeControlDigest}`,
  )
  if (receipt.subject !== pinned.projection.subject
    || receipt.activeControlDigest !== pinned.projection.activeControlDigest) {
    return denied(
      'binding',
      APPROVAL_PATH_REFUSE.IDENTITY_UNBOUND,
      `the approval names ${receipt.subject} at ${receipt.activeControlDigest}; the pinned identity is `
      + `${pinned.projection.subject} at ${pinned.projection.activeControlDigest}`,
    )
  }
  record('binding', 'VERIFIED', 'the approval names this identity and this control head')

  const at = now()
  if (at >= receipt.expiresAt) {
    return denied(
      'window',
      APPROVAL_PATH_REFUSE.EXPIRED,
      `the approval window closed at ${String(receipt.expiresAt)} and it is now ${String(at)}`,
    )
  }
  record('window', 'VERIFIED', `expiresAt ${String(receipt.expiresAt)} is after ${String(at)}`)

  // KEY: both sides are DECODED to raw key bytes and compared, never string-matched. A DID that
  // merely equals the registered one as text would pass a string comparison while naming a key
  // this lane never derived.
  let registeredHex
  let namedHex
  try {
    registeredHex = ed25519PublicKeyFromDidKey(pinned.projection.approvalKeyDid)
  } catch (cause) {
    return denied('key', APPROVAL_PATH_REFUSE.IDENTITY_UNBOUND, `the identity registers no usable key: ${messageOf(cause)}`)
  }
  try {
    namedHex = ed25519PublicKeyFromDidKey(receipt.approvalKeyDid)
  } catch (cause) {
    return denied('key', APPROVAL_PATH_REFUSE.KEY_MISMATCH, `the approval names no usable key: ${messageOf(cause)}`)
  }
  if (namedHex !== registeredHex) {
    return denied(
      'key',
      APPROVAL_PATH_REFUSE.KEY_MISMATCH,
      `the approval names the key ${receipt.approvalKeyDid}, which decodes to ${namedHex}; the pinned `
      + `identity registers ${String(pinned.projection.approvalKeyDid)}, which decodes to ${registeredHex}`,
    )
  }
  record('key', 'VERIFIED', `the approval names the key this identity registers (${registeredHex})`)

  const derived = operationDigestOf(content)
  if (derived !== receipt.operationDigest) {
    return denied(
      'operation',
      APPROVAL_PATH_REFUSE.OPERATION_MISMATCH,
      `the operation presented derives ${derived}; the approval covers ${receipt.operationDigest}. `
      + `The digest is sha256(${OPERATION_CONTENT_DOMAIN} ‖ 0x00 ‖ content)`,
    )
  }
  record('operation', 'VERIFIED', `the operation presented derives the digest the approval covers (${derived})`)

  let request
  try {
    request = createApprovalRequest({
      subject: receipt.subject,
      activeControlDigest: receipt.activeControlDigest,
      operationDigest: receipt.operationDigest,
      challenge: receipt.challenge,
      issuedAt: receipt.issuedAt,
      expiresAt: receipt.expiresAt,
    })
  } catch (cause) {
    return denied('digest', APPROVAL_PATH_REFUSE.MALFORMED, messageOf(cause))
  }
  const verified = verifyResponse({
    projection: pinned.projection,
    request,
    // An approval receipt carries an approval response's payload by construction — the challenge the
    // signer answered and the signature it returned — so the receipt is read back AS that response
    // rather than verified by a second copy of the same check. ONE signature verification exists in
    // this module, and both the producing and the consuming path go through it.
    response: {
      domain: APPROVAL_RESPONSE_DOMAIN,
      challenge: receipt.challenge,
      signature: receipt.signature,
    },
    now,
  })
  if (!verified.ok) {
    // The window can only be the refusal here if it closed between the check above and this one, so
    // the item that refused is named accordingly rather than always as `signature`.
    const item = verified.reason === APPROVAL_PATH_REFUSE.EXPIRED ? 'window' : 'signature'
    return denied(item, verified.reason, verified.detail)
  }
  record('signature', 'VERIFIED',
    `Ed25519 over the bytes the artifact's own fields derive, under the key this identity registers`)

  const state = openSettlementState(stateDirectory)
  if (!state.ok) return denied('replay', state.reason, state.detail)
  const settlement = Object.freeze({
    domain: SETTLEMENT_RECORD_DOMAIN,
    gate: 'OPEN',
    subject: receipt.subject,
    activeControlDigest: receipt.activeControlDigest,
    operationDigest: receipt.operationDigest,
    challenge: receipt.challenge,
    approvalKeyDid: receipt.approvalKeyDid,
    approvalClass: receipt.approvalClass,
    keyClass: receipt.keyClass,
    expiresAt: receipt.expiresAt,
    settledAt: at,
    operationContentBytes: Buffer.byteLength(
      typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content ?? []),
    ),
    attendance: 'reported-not-proven',
    identityBound: false,
    ceiling: 'this record says a gate opened; nothing in the world was performed, and no person is '
      + 'claimed to have attended',
  })
  const markerPath = join(state.spentDirectory, receipt.challenge)
  let descriptor
  try {
    // The replay decision, and the only atomic act in this function.
    descriptor = openSync(markerPath, 'wx', 0o600)
    writeFileSync(descriptor, `${JSON.stringify(settlement)}\n`, 'utf8')
    closeSync(descriptor)
    descriptor = undefined
  } catch (cause) {
    if (descriptor !== undefined) closeSync(descriptor)
    if (/** @type {{code?: string}} */ (cause)?.code === 'EEXIST') {
      return denied(
        'replay',
        APPROVAL_PATH_REFUSE.REPLAYED,
        `challenge ${receipt.challenge} has already been consumed; the marker ${markerPath} exists`,
      )
    }
    return denied('replay', APPROVAL_PATH_REFUSE.STATE, `cannot consume ${markerPath}: ${messageOf(cause)}`)
  }
  record('replay', 'VERIFIED', `challenge ${receipt.challenge} consumed exactly once at ${markerPath}`)
  return Object.freeze({ ok: true, settlement, markerPath, results: Object.freeze([...results]) })
}

/**
 * Read one approval artifact from disk as a closed record.
 *
 * Throws nothing: a caller that has a path and wants a verdict gets one. The file is parsed and
 * then checked by {@link parseApprovalReceipt}, so an artifact with an extra field is refused here
 * rather than at settlement.
 * @param {string} path - the artifact file.
 * @param {(path: string) => string} readFile - reader, injected so a court can supply bytes.
 * @returns {Readonly<Record<string, unknown>>} verdict.
 */
export function readApprovalArtifact(path, readFile) {
  let raw
  try {
    raw = readFile(path)
  } catch (cause) {
    return refuse(APPROVAL_PATH_REFUSE.MALFORMED, `cannot read ${String(path)}: ${messageOf(cause)}`)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    return refuse(APPROVAL_PATH_REFUSE.MALFORMED, `${String(path)} is not JSON: ${messageOf(cause)}`)
  }
  try {
    return Object.freeze({ ok: true, artifact: parseApprovalReceipt(parsed) })
  } catch (cause) {
    return refuse(APPROVAL_PATH_REFUSE.MALFORMED, messageOf(cause))
  }
}
