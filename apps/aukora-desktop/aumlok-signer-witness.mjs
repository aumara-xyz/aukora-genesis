// What the shell's signer signs and shows, moved whole from aumlok-signer.mjs (2026-09-27) so that no file of the signer
// passes the self-change loop's 64 KiB limit (MAX_PATCH_BYTES, vendor/aukora-seed-app). No line was rewritten; three
// declarations gained `export` (CANONICAL_INSTANT, HEX64, sha256Hex) because the signer uses them. aumlok-signer.mjs
// re-exports every name it exported before; where a comment below says "this file", "this module" or "here", it means
// the signer. WITNESS_DISPLAY_LIMIT stays in aumlok-signer.mjs, whose text scripts/aukora/become.mjs reads it from, and
// is imported back from there: it is read only when a witness is built, never while either module loads.
import { createHash } from 'node:crypto'
import { canonicalJSONSafeInteger } from '../../plugins/aukora-kira/lib/record.mjs'
// **THE PROPOSAL'S OWN MODULE.** The display below renders a record this module BUILT, so the two cannot
// disagree about what a valid record is: a shape this module would refuse is a shape this display refuses too.
import { buildRepoAdvance, REPO_ADVANCE_KIND } from '../../plugins/aukora-aumlok/lib/repo-advance.mjs'
import { buildReleaseActivate, RELEASE_ACTIVATE_KIND } from '../../plugins/aukora-aumlok/lib/release-activate.mjs'
import { WITNESS_DISPLAY_LIMIT } from './aumlok-signer.mjs'
import { decodeNpub, NOSTR_SAFETY_VERSION, assertWitnessFields } from '../../plugins/aukora-owner-daemon/lib/airlock-witness.mjs'
export { SAS_CONFIRMATION_DOMAIN, SAS_CONFIRMATION_KEYS, sasConfirmationPreimage, NOSTR_BINDING_DOMAIN,
  decodeNpub, nostrBindingPreimage, NOSTR_SAFETY_VERSION, assertWitnessFields } from '../../plugins/aukora-owner-daemon/lib/airlock-witness.mjs'

// ── THE SECOND OPERATION: `sign-nostr-binding` (Y7) ────────────────────────────────────────────
//
// WHY THE SIGNER SIGNS THE BINDING AND NOT AN ORGAN. A Nostr binding says "this npub belongs to this
// subject", and the statement is worth exactly as much as the key behind it. The machine key is the
// key this laptop holds and the key the public record nominates in `publicRoot.machines[]`, so the
// signer that already serves approvals is the only thing in this product that can sign one without
// anybody opening a seed file. NO ORGAN READS A SEED: the derivation stays here, in the code that
// signs, and what crosses the socket is a signature.
//
// THE WINDOW IS THE SAME WINDOW. This operation goes through the SAME `review` object, built by the
// same `reviewFromAsk` from the same `ask`, that every approval goes through. There is no second
// window, no second question and no second one-bit answer — a person who is asked about a binding is
// asked by the one thing in this product that can ask, and answers with the same single bit.

/** The operation's own name on the wire. This is the name BETA wires its call site to. */
export const NOSTR_BINDING_OPERATION = 'sign-nostr-binding'

/**
 * THE THIRD OPERATION: `confirm-nostr-sas` — the owner's signature over the safety digits a person compared.
 *
 * `plugins/aukora-nostr/lib/confirmation.mjs` makes VERIFIED reachable through exactly one thing: a
 * confirmation the OWNER signed over the values a person read aloud. That module says outright that it
 * holds no signing primitive for a real identity and that "the live document comes from the signer, over a
 * window Peter approves, and that operation is Aumlok's to add". This is that operation.
 *
 * THE PREIMAGE IS BETA'S AND IS RE-DERIVED HERE RATHER THAN IMPORTED, BECAUSE THE SHELL DOES NOT DEPEND ON
 * A FACE. The same reasoning the bech32 block below gives: importing the Nostr plugin would make this
 * shell's build depend on a plugin that is not in it. So the rule is written here a second time, EXACTLY —
 * one line per field, fixed order, no trailing newline — and `tests/aukora-confirm-nostr-sas.test.mjs`
 * courts the copy against `confirmationPreimage()` itself, so the two spellings cannot drift apart in
 * silence. A shell and an organ that disagree about the bytes produce two preimages for one meaning.
 */
export const CONFIRM_NOSTR_SAS_OPERATION = 'confirm-nostr-sas'

/** How long a person has to answer about a comparison, in seconds, from the request's `confirmedAt`. */
export const SAS_CONFIRMATION_WINDOW_SECONDS = 300

/**
 * How long a person has to answer about a binding, in seconds, measured from the request's `issuedAt`.
 *
 * THE SAME BOUND AS THE APPROVAL DIALOG, DELIBERATELY. The shipped window waits up to 300_000 ms for a
 * person, and a signer that gave up sooner would make the attended path unable to succeed and then
 * blame the channel — the exact defect `DEFAULT_SIGNER_TIMEOUT_MS = 310000` exists to prevent.
 */
export const NOSTR_BINDING_WINDOW_SECONDS = 300

/**
 * The names the SHELL adds to the signer's refusal vocabulary for this operation.
 *
 * THE ORGAN'S OWN NAMES ARE USED WHERE THEY ALREADY FIT — `signer:declined` for a person who said no,
 * `signer:ask-unavailable` when nobody could be asked, `signer:request-malformed` for a record that is
 * not the request it claims to be, `signer:request-expired` for a closed window. These two are the
 * facts the organ has no name for, because they are about the SHELL's dispatch and the record the
 * shell reads: an operation this signer does not have, and a record that no longer lists this machine.
 */
export const NOSTR_SIGNER_REFUSE = Object.freeze({
  OPERATION_UNKNOWN: 'aumlok:signer-operation-unknown',
  /** The same name the startup path uses, so one fact has one name wherever it is met. */
  MACHINE_NOT_LISTED: 'aumlok:machine-signer-not-listed-by-the-record',
})

/** The shape of one canonical instant, matching the record's own `createdAt` rule. */
export const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u
export const HEX64 = /^[0-9a-f]{64}$/u

/**
 * The statement one `sign-nostr-binding` request asserts, and the bytes the machine key signs.
 *
 * WHAT IS DERIVED RATHER THAN TAKEN. `nostrPubkeyHex` is DECODED OUT OF THE NPUB, so the statement can
 * never be the two-claims-stapled-together shape the product's verifier refuses — the friendly npub and
 * the hex key are one fact here by construction. `createdAt` is the request's own `issuedAt`, because
 * the binding's creation instant IS the instant the operation was issued; a second field carrying the
 * same fact would be a second thing to disagree about.
 * @param {{npub: string, subject: string, handle: string, issuedAt: string, safetyVersion: number}} input - the binding request fields.
 * @returns {Readonly<Record<string, string|number>>} the statement.
 */
export function nostrBindingStatement(input) {
  assertWitnessFields(input)
  if (input.safetyVersion !== NOSTR_SAFETY_VERSION) throw new TypeError('unsupported safety protocol')
  const nostrPubkeyHex = decodeNpub(input.npub)
  if (nostrPubkeyHex === null) throw new TypeError('npub: not a decodable npub')
  return Object.freeze({
    subject: input.subject,
    npub: input.npub,
    nostrPubkeyHex,
    handle: input.handle,
    createdAt: input.issuedAt,
    safetyVersion: NOSTR_SAFETY_VERSION,
  })
}

/**
 * SHA-256 of some bytes, as lowercase hex. The digest that goes in front of a person.
 * @param {Buffer} buffer - the bytes.
 * @returns {string} 64 lowercase hex characters.
 */
export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

// ══ Z2 — WHAT IS BEING APPROVED, DERIVED FROM THE BYTES THE DIGEST COVERS ═════════════════════════
//
// Peter's first real approval, 2026-09-23 21:29: "the window shows a digest, not meaning". This is
// where the meaning comes from, and the rule that makes it honest is one sentence:
//
//     THE WORDS ARE A FUNCTION OF THE OPERATION'S OWN BYTES, AND OF NOTHING ELSE.
//
// The requesting side may send the operation's content — the exact string the digest was taken over —
// and NOTHING ELSE. It may not send a summary, a label, or a kind: a summary is text a caller chose,
// and text a caller chose can describe an operation other than the one being signed. So there is no
// field here for one — and `aumlok-bridge.mjs`'s `admitApprovalQuestion` REFUSES a request that
// carries one, by name, before a window exists.
//
// WHAT THE OPERATION KIND IS AND WHERE IT COMES FROM. It is not asserted by the caller; it is READ OUT
// OF THE CONTENT'S OWN SHAPE. A KIRA `memory.put` content is `canonicalJSON({key, value})` plus the
// record format's own terminating newline (`memoryEffectBody`), whose `key` is `kira:<64 hex>` — so a
// content that has that shape IS one, and the line says `memory.put` and prints the staged record's own
// fields. Anything else is described by its own text, named `operation` rather than guessed at.

/** The largest operation content this signer will render, in bytes. */
export const MAX_WITNESS_CONTENT_BYTES = 48 * 1024

/**
 * THE ONE REASON THAT MEANS "NO CONTENT WAS OFFERED AT ALL", NAMED ONCE.
 *
 * It is a CEILING rather than a fault, and the difference decides whether the request may still open a
 * window: a line that carries no `operationContent` is the older wire this server has always spoken,
 * while a line that CARRIES the field and carries something unreadable is a caller that tried to be
 * described and failed. The server used to tell those two apart with `typeof operationContent ===
 * 'string'` — a second test, and a wrong one: a number, an object or an array fell through it and the
 * request went on to the approval path with NO description and a live Approve button.
 *
 * DEFINED HERE AND READ IN BOTH PLACES (`readOperationContent` decides it, the socket's gate acts on
 * it), because two copies of a sentinel string are two chances for a reader to disagree about which
 * ones are ceilings.
 */
export const OPERATION_CONTENT_ABSENT = 'signer:operation-content-absent'


/** Domain of the digest that binds a words line to the derivation that produced it. */
export const APPROVAL_WORDS_DOMAIN = 'aukora:approval-words:v1'

/**
 * THE DOMAIN THE OPERATION DIGEST IS TAKEN OVER.
 *
 * THE FIRST VERSION OF THIS FILE GOT THIS WRONG AND THE COURT CAUGHT IT: it compared the content to the
 * request's `operationDigest` with a plain `sha256(content)`, while the digest the request actually
 * carries is `sha256("aukora:operation-content:v1" ‖ 0x00 ‖ content)` — the rule `operation-approval.mjs`
 * computes and every receipt is verified against. A plain-SHA-256 check would have refused EVERY
 * well-formed operation and displayed nothing, which is the defect this work exists to remove, one
 * layer up. The domain is restated here rather than imported because this module must run from the
 * shell's own bundle; `tests/aukora-approval-window-meaning.test.mjs` drives the real broker against
 * this signer, so the two conventions cannot drift apart unnoticed.
 */
export const OPERATION_CONTENT_DOMAIN = 'aukora:operation-content:v1'

/**
 * The operation digest of some content: `sha256(domain ‖ 0x00 ‖ bytes)`.
 * @param {Buffer} content - the operation's exact bytes.
 * @returns {string} 64 lowercase hex characters.
 */
export function operationDigestOfContent(content) {
  return sha256Hex(Buffer.concat([Buffer.from(`${OPERATION_CONTENT_DOMAIN}\0`, 'utf8'), content]))
}

/**
 * The digest a words line is bound by: `sha256(domain NUL words)`.
 *
 * THE SAME RULE THE PAGE RE-CHECKS. `aumlok-approval.html` computes this over the line it is about to
 * display and shows nothing when it does not match, so a line that is not the shell's own derivation
 * of the bytes is refused in the window rather than displayed and hoped about.
 * @param {string} words - the rendered line.
 * @returns {string} 64 lowercase hex characters.
 */
export function approvalWordsDigest(words) {
  return sha256Hex(Buffer.from(`${APPROVAL_WORDS_DOMAIN}\0${String(words)}`, 'utf8'))
}

/**
 * One string, escaped so a reader sees exactly what the bytes say.
 *
 * THE SAME NOTATION `operation-approval.mjs`'s `escapeForDisplay` uses, and for the same measured
 * reason: a body carrying `ESC [ 8m` conceals text and `U+202E` reverses a line, and a witness that can
 * show one thing while the digest covers another is not a witness. Newline and tab survive because they
 * carry the text's shape; every control byte, every invisible formatting character and the backslash
 * itself become `\u{...}`, so no literal text can produce the escape syntax and the rendering is
 * reversible.
 * @param {string} text - decoded content.
 * @returns {string} the safe rendering.
 */
function escapeWitnessText(text, options = {}) {
  // ── **AN ESCAPE THAT IS ALREADY THERE MUST NOT BE ESCAPED AGAIN (AUMLOK-115, CODEX r1)** ────────────────
  //
  // MEASURED, AND IT WAS MY OWN BUG FROM AN HOUR EARLIER: the memory path renders CANONICAL JSON, and canonical
  // JSON spells a control as the six characters `\u001b`. Escaping that text turned the BACKSLASH into
  // `\u{5C}`, so the screen showed `\u{5C}u001b` — **the protection rendered the very character it was
  // protecting against as gibberish, and the description stopped being a verbatim substring of the bytes it
  // describes**, which is the contract the witness exists to keep.
  //
  // `preserveJsonEscapes` is set by the callers whose text is a JSON rendering: a backslash that begins a VALID
  // JSON escape is left alone, and everything else is treated exactly as before. **So a raw bidi override is
  // still caught — canonical JSON does not escape those — and a control that JSON already escaped is not
  // mangled.** *The bug was not the escaping; it was escaping twice.*
  const preserve = options.preserveJsonEscapes === true
  const characters = [...text]
  let out = ''
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]
    const point = character.codePointAt(0)
    if (character === '\n' || character === '\t') { out += character; continue }
    if (preserve && character === '\\') {
      const next = characters[index + 1] ?? ''
      if ('"\\/bfnrtu'.includes(next)) {
        // **THE ESCAPED CHARACTER IS CONSUMED WITH ITS BACKSLASH, AND THAT IS THE WHOLE BUG.** MEASURED: the
        // first version emitted the backslash and moved on ONE character, so in `\\` (a JSON-escaped
        // backslash) the SECOND backslash was examined next — and with `m` after it, `\m` is not a valid JSON
        // escape, so it was escaped again as `\u{5C}`. **A two-character escape is read as two characters or as
        // none; reading it as one is how `C:\\notes\\memo.md` became `C:\\notes\\u{5C}memo.md`.**
        out += character + next
        index += 1
        continue
      }
    }
    const isControl = point <= 0x1f || (point >= 0x7f && point <= 0x9f)
    if (isControl || isInvisibleWitnessFormatting(character) || character === '\\') {
      out += `\\u{${point.toString(16).toUpperCase()}}`
      continue
    }
    out += character
  }
  return out
}

/**
 * Would a reader be unable to see this character?
 *
 * The joiners and the direction MARKS are NOT included: they are ordinary orthography in Persian,
 * Hindi, Malayalam, Arabic and Hebrew, and escaping them would make the description unreadable exactly
 * where a person most needs to read it. What is included is what hides or reorders without being text.
 * @param {string} character - one code point, as a string.
 * @returns {boolean} true when the character is invisible formatting.
 */
function isInvisibleWitnessFormatting(character) {
  const point = character.codePointAt(0)
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

/**
 * The canonical form of one JSON value, in RFC 8785's key order.
 *
 * THIS IS HOW THE CONTENT IS PROVED CANONICAL BEFORE ANY PART OF IT IS DISPLAYED. A KIRA content is
 * `canonicalJSON({key, value})`, so re-encoding the parsed value and comparing it to the bytes is a
 * check that the two agree — and only then is the parsed value rendered field by field. An operation
 * whose bytes are NOT canonical is refused rather than described, because a description built from a
 * re-encoding is a second rendering that could differ from what the digest covers.
 * @param {unknown} value - parsed JSON value.
 * @returns {string} canonical JSON text.
 */
function canonicalText(value) {
  // KIRA'S ENCODER, NOT A SECOND COPY OF THE SAME RULE (cohesion plan row 28).
  //
  // MEASURED AT HEAD: this was the signer's OWN canonical encoder - a fourth implementation of a rule this tree
  // already states three times. It agreed with Kira's safe-integer encoder BY INSPECTION, which is exactly the
  // kind of agreement that stops holding silently. Two encoders for one identity is one identity with two
  // possible values, and the whole point of canonical bytes is that there is one.
  //
  // canonicalJSONSafeInteger is the Kira rule this shape needs - safe integers only, a decimal REFUSED and never
  // rounded, because rounding would give one value two canonical forms and make the digest depend on which one a
  // producer happened to pick.
  return canonicalJSONSafeInteger(value)
}

/** THE NAMED REFUSAL FOR CONTENT THAT CANNOT BE CANONICAL - the signer's own code for it. */
export const KIRA_CONTENT_NOT_CANONICAL = 'signer:kira-content-not-canonical'


/**
 * THE STAGED TEXT, TAKEN OUT OF THE BOUND BYTES THEMSELVES — AND ONLY THE ONE THE RECORD STAGES.
 *
 * This is the clause Z2 states exactly — "for a memory, its text as staged, ESCAPED EXACTLY AS BOUND" —
 * and the only way to satisfy it is to not re-encode anything. So this function does not parse and
 * re-serialize: it finds the `"note"` member inside the content's own JSON text and returns THE
 * SUBSTRING OF THE BOUND BYTES from its opening quote to its closing quote. `\u001b` in the bytes is
 * `\u001b` on the screen, `\\` in the bytes is `\\` on the screen, and a reader comparing the line to the
 * file sees the same characters. A re-escaping renderer would be a SECOND rendering of the same
 * operation, and a second rendering is a place the two can disagree.
 *
 * ── **THE FIRST `"note"` ANYWHERE IS NOT THE RECORD'S NOTE (AUMLOK-113)** ─────────────────────────────────
 *
 * MEASURED BY THE REVIEWER, AND REPRODUCED: this used to be `/"note"\s*:\s*"…"/u` — **the first `"note"`
 * member ANYWHERE in the canonical bytes** — and canonical members are SORTED, so in a record whose
 * content reads
 *
 *     {"context":{"note":"I prefer green tea"},"kind":"push","note":"grant push-to-main"}
 *
 * **`"context"` SORTS BEFORE `"note"`, SO THE WINDOW SHOWED "I prefer green tea" WHILE THE KEY SIGNED A
 * RECORD THAT GRANTS PUSH-TO-MAIN.** A person approved one sentence and the signature covered another,
 * which is the single failure an approval window exists to make impossible.
 *
 * **SO THE ONLY MEMBER THIS RETURNS IS THE TOP-LEVEL `content.note`** — the record's own prose
 * projection, the one `kira-test-store.mjs` names when it says "content.note when it is a string".
 *
 * **AND WHEN THE BYTES HOLD MORE THAN ONE `"note"`, NOTHING IS PICKED AT ALL.** Choosing between two
 * candidates is precisely the operation that produced the defect: whichever rule is used, **the window
 * would be showing a sentence the reader has no way to know was SELECTED rather than STATED.** The
 * caller falls back to the WHOLE VALUE, so every candidate is on screen and the person can see the
 * question is ambiguous rather than being handed a tidy answer to it.
 *
 * @param {string} text - the content's exact text.
 * @param {unknown} parsed - the parsed record, whose `value.content` holds the staged note.
 * @returns {string | null} the staged text exactly as it appears in the bytes, or null when there is none
 *   or more than one candidate.
 */
function stagedTextAsBound(text, parsed) {
  const content = parsed?.value?.content
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return null
  if (typeof content.note !== 'string') return null
  // MORE THAN ONE CANDIDATE MEANS THE QUESTION IS AMBIGUOUS, AND AN AMBIGUOUS QUESTION IS ANSWERED BY
  // SHOWING ALL OF IT RATHER THAN BY PICKING ONE.
  const candidates = text.match(/"note"\s*:/gu)
  if (candidates === null || candidates.length !== 1) return null
  const found = /"note"\s*:\s*"((?:[^"\\]|\\.)*)"/u.exec(text)
  return found === null ? null : found[1]
}

/** The shape of a `memory.put` key, and the shape of the value that accompanies it. */
const KIRA_RECORD_KEY = /^kira:[0-9a-f]{64}$/u

/**
 * DERIVE the plain-words description of one operation, from the exact bytes its digest covers.
 *
 * @param {Buffer} content - the operation's exact content bytes.
 * @returns {Readonly<{kind: string, words: string}>} the operation kind and the line to display.
 */
/**
 * THE SEVEN THINGS THE WINDOW SHOWS, EACH ONE A VALUE FROM THE RECORD'S OWN BYTES OR AN EXPLICIT ABSENCE.
 *
 * **THE RULE THIS SERVES IS THE ONE ABOVE: the words are a function of the operation's own bytes and of nothing
 * else.** A labelled card is stronger than a paragraph only if every label obeys the same rule, so each value here
 * is read out of the record the digest covers — `from`, `to`, `commitCount`, `repo`, `tree`, `gateChanges` — and a
 * label the record does not answer says so **in the record's own voice** rather than being filled with something
 * plausible. *An absence a person can see is worth more than a sentence somebody wrote.*
 *
 * **`WHO` AND `UNTIL` ARE NOT HERE ON PURPOSE**: they belong to the request, not to the record — the identity the
 * window is bound to and the window's own expiry — so the bridge supplies them beside `challenge` and `expiresAt`,
 * where they are already read. Seven labels, two sources, and neither source is prose.
 */
export const APPROVAL_FIELD_ORDER = Object.freeze(['WHAT', 'WHERE', 'WHO', 'LIMIT', 'COST', 'UNTIL', 'IRREVERSIBLE'])

/** The one sentence a label gets when the record does not answer it. Named once so no reader has to guess. */
export const APPROVAL_FIELD_NOT_STATED = 'not stated by this record'

/** A short prefix of a hash, refusing to print anything that is not a non-empty string. */
function shortHash(value) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 7) : null
}

/**
 * The record's own answer to five of the seven labels.
 * @param {string} kind - the kind read out of the content's shape.
 * @param {unknown} record - the parsed record, or null when the content is not a record this build knows.
 * @returns {Readonly<Record<string, string>>} the five record-side labels.
 */
export function approvalFieldsOf(kind, record) {
  const notStated = APPROVAL_FIELD_NOT_STATED
  // ── A KIRA MEMORY RECORD: `{key, value}` where `key` is `kira:<64 hex>` and `value` carries the fields that make
  // it an ACT. **EVERY VALUE BELOW NAMES THE FIELD IT CAME FROM** (`privacy: …`, `subject: …`) so the card shows
  // provenance rather than an interpretation: a reader can check each line against the record above it. The record
  // states no cost and no reversibility, and the card says exactly that instead of filling the space.
  if (kind === 'memory.put' && record !== null && typeof record === 'object') {
    const value = (record.value !== null && typeof record.value === 'object') ? record.value : null
    const key = typeof record.key === 'string' && record.key.length > 0 ? record.key : null
    const recordKind = value !== null && typeof value.kind === 'string' && value.kind !== '' ? value.kind : null
    const subject = value !== null && typeof value.subject === 'string' && value.subject !== '' ? value.subject : null
    const privacy = value !== null && typeof value.privacy === 'string' && value.privacy !== '' ? value.privacy : null
    return Object.freeze({
      WHAT: recordKind === null ? 'a KIRA memory record' : `a KIRA ${recordKind} record`
        + (key === null ? '' : ` staged as ${key.slice(0, 14)}…`),
      WHERE: subject === null ? notStated : `store: ${subject}`,
      LIMIT: privacy === null ? notStated : `privacy: ${privacy}`,
      COST: notStated,
      IRREVERSIBLE: notStated,
    })
  }
  if (kind === 'repo.advance' && record !== null && typeof record === 'object') {
    const from = shortHash(record.from)
    const to = shortHash(record.to)
    const count = Number.isSafeInteger(record.commitCount) ? String(record.commitCount) : null
    const repo = typeof record.repo === 'string' && record.repo !== '' ? record.repo : null
    const tree = shortHash(record.tree)
    const gates = Array.isArray(record.gateChanges)
      ? (record.gateChanges.length === 0 ? 'none' : record.gateChanges.join(', '))
      : null
    return Object.freeze({
      WHAT: from !== null && to !== null && count !== null
        ? `Move main from ${from} to ${to}: ${count} commits`
        : notStated,
      WHERE: repo !== null ? `repo ${repo}${tree === null ? '' : ` · tree ${tree}`}` : notStated,
      LIMIT: gates === null ? notStated : `checks changed: ${gates}`,
      COST: notStated,
      IRREVERSIBLE: notStated,
    })
  }
  // **ANY OTHER KIND SAYS WHAT IT IS AND SAYS IT DOES NOT KNOW THE REST.** The kind is read out of the content's
  // shape, so naming it is reading; guessing its cost would not be.
  return Object.freeze({ WHAT: kind, WHERE: notStated, LIMIT: notStated, COST: notStated, IRREVERSIBLE: notStated })
}

export function deriveApprovalWitness(content) {
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    // BYTES THAT DO NOT SURVIVE A UTF-8 ROUND TRIP HAVE NO FAITHFUL RENDERING, so none is offered: the
    // digest is still shown, and the line says what it can honestly say about the bytes.
    return Object.freeze({
      kind: 'operation',
      words: 'an operation whose content is not text: '
        + `${String(content.length)} byte(s), sha256 ${sha256Hex(content)}`,
    })
  }
  // A KIRA memory.put, DETECTED FROM THE CONTENT'S OWN SHAPE. `memoryEffectBody` is
  // `canonicalJSON({key, value})` plus one newline, and `key` is `kira:<64 hex>` — so the test is the
  // content's own structure, never a label the requesting side supplied.
  let parsed = null
  if (text.endsWith('\n')) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    && Object.keys(parsed).length === 2 && typeof parsed.key === 'string' && KIRA_RECORD_KEY.test(parsed.key)
    && typeof parsed.value === 'object' && parsed.value !== null && !Array.isArray(parsed.value)) {
    // CANONICAL OR NOTHING. The bytes must BE the canonical encoding of what they parse to, or the
    // rendering below would be a second encoding of the same operation — the thing Z2 forbids.
    // A DECIMAL IN A KIRA RECORD IS REFUSED BY NAME, NOT THROWN (cohesion plan row 28).
    //
    // MEASURED AT HEAD: canonicalText threw a raw TypeError on a decimal, and that throw escaped this `if`
    // entirely - so content carrying 1.5 took the signer down with an uncaught exception rather than being
    // refused. A refusal a caller can read is worth more than a stack trace it cannot, and this is the one shape
    // whose bytes the person is being asked to approve.
    let isCanonical = false
    try {
      isCanonical = `${canonicalText(parsed)}\n` === text
    } catch (error) {
      // THE PRODUCER'S BUG, SAID IN THE SIGNER'S VOCABULARY. Kira's own code is carried through, so a reader can
      // tell a decimal from an unsupported type from anything else the encoder refuses.
      const detail = String(error?.code ?? error?.name ?? 'unknown')
      return Object.freeze({ ok: false, reason: `${KIRA_CONTENT_NOT_CANONICAL}:${detail}` })
    }
    if (isCanonical) {
      const staged = stagedTextAsBound(text, parsed)
      // ── **EVERY FIELD THAT DECIDES WHAT THIS RECORD DOES IS PRINTED, WHATEVER IT STAGES (AUMLOK-113)** ──
      //
      // MEASURED: the window showed the staged text and NOTHING ELSE — no `kind`, no `privacy`, no
      // `subject`, no `links`. **So a record granting push-to-main was approved on the strength of one
      // sentence, with the fields that make it an ACT rather than a remark off screen entirely.** A
      // reviewer reading a sentence cannot tell a preference from an authority, and the difference
      // between those two is the whole of what an approval decides.
      //
      // **THEY ARE PRINTED FROM THE RECORD'S OWN CANONICAL BYTES**, `JSON.stringify` of the value the
      // digest covers, so this line cannot describe a different record than the one being signed.
      // ── **EVERY FIELD GOES THROUGH THE ESCAPER, NOT ONLY THE FALLBACK (AUMLOK-115, CODEX r1)** ─────────────
      //
      // MEASURED: the generic branch below escaped its text and THIS ONE DID NOT, so the Unicode and
      // control-character protection existed for every operation EXCEPT a memory record — the kind this lane
      // exists for. Canonical JSON does not escape bidi formatting characters, so `\u202e` in a `subject` or a
      // `note` reached the screen as a live override and reordered the line a person reads. **A description
      // that can be reordered is a description of a different operation.**
      //
      // **AND `JSON.stringify` IS NOT THE ESCAPER.** It escapes the C0 controls and stops: it passes bidi
      // overrides, the invisible operators and the zero-width characters straight through, which is precisely
      // the set `isInvisibleWitnessFormatting` names. So the values are stringified for SHAPE and then escaped
      // for READING, in that order, and the reader-facing sentence is the escaped one.
      const esc = value => escapeWitnessText(JSON.stringify(value ?? null), { preserveJsonEscapes: true })
      const identity = [
        `kind: ${esc(parsed.value.kind)}`,
        `privacy: ${esc(parsed.value.privacy)}`,
        `subject: ${esc(parsed.value.subject)}`,
        `links: ${esc(parsed.value.links)}`,
      ].join('\n')
      // ── **THE NOTE IS NOT THE CONTENT (AUMLOK-115, CODEX r1)** ─────────────────────────────────────────────
      //
      // MEASURED: when extraction succeeded this branch showed **only the `note`** and omitted every sibling
      // content field — so a record whose `content` held a note AND other fields was described by its note
      // alone, and the four metadata lines above do not make that a complete rendering. *The note is a field of
      // the content, not a summary of it.*
      //
      // **SO THE WHOLE CONTENT IS RENDERED**, canonically, and the note is THEN shown as the staged text the
      // digest was computed over. Both, not either: the note is still what a reader compares against, and the
      // siblings are no longer hidden behind it.
      const wholeContent = escapeWitnessText(JSON.stringify(parsed.value.content, null, 2), { preserveJsonEscapes: true })
      return Object.freeze({
        kind: 'memory.put',
        // THE SAME BYTES THE LINE ABOVE IS BUILT FROM, read field by field rather than summarised.
        fields: approvalFieldsOf('memory.put', parsed),
        // THE KIND, THE RECORD'S OWN IDENTIFIER, THE WHOLE CONTENT, AND THE STAGED TEXT EXACTLY AS BOUND.
        // Nothing here is re-encoded: every value is the record's own bytes, escaped for reading only.
        words: `memory.put — a KIRA memory record is staged as ${parsed.key}\n`
          + `${identity}\n`
          + (staged === null
            ? `its content, exactly as bound:\n${escapeWitnessText(text, { preserveJsonEscapes: true })}`
            : `its whole content, exactly as bound (every field, not only the note):\n${wholeContent}\n`
              + `its staged text, exactly as bound:\n${escapeWitnessText(staged, { preserveJsonEscapes: true })}`),
      })
    }
  }
  // ══ **THE PROPOSAL THAT MOVES MAIN (plan section 5 row 2; section 2 step 8)** ═════════════════════════════
  //
  // The record is detected FROM ITS OWN SHAPE — a canonical JSON object whose `kind` is the record's own
  // constant — and never from a label the requesting side supplied, which is the rule this function already
  // follows for `memory.put`.
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    && parsed.kind === REPO_ADVANCE_KIND) {
    // **RE-VALIDATED THROUGH THE MODULE THAT BUILT IT, SO THE DISPLAY CANNOT OUTRUN THE RECORD.**
    // `buildRepoAdvance` refuses an extra field, a bad sha, `from == to`, too many headlines and an unsafe
    // headline. A witness that rendered a record the builder would refuse would be a SECOND opinion about what
    // is valid, and *two opinions about validity is one opinion too many.*
    let record = null
    try {
      record = buildRepoAdvance(parsed)
    } catch (error) {
      return Object.freeze({ ok: false, reason: `repo-advance: ${String(error?.code ?? error?.message ?? 'refused')}` })
    }
    // **AND THE BYTES MUST BE THE CANONICAL ENCODING OF WHAT THEY PARSE TO**, the same rule as `memory.put`:
    // otherwise this rendering would be a second encoding of one proposal, and the digest covers only one.
    if (`${canonicalText(record)}\n` !== text) {
      return Object.freeze({ ok: false, reason: 'repo-advance:bytes-are-not-the-canonical-encoding' })
    }
    // ── **THE GATE CHANGES COME FIRST, AND THAT IS THE WHOLE REASON THIS LINE HAS AN ORDER** ────────────
    //
    // Plan section 5 row 5: *"Show gate changes first."* A reader scanning "Move main from a to b: 3 commits"
    // learns that SOMETHING is proposed; a reader told first that **the verifier, the pinned key, the court
    // policy or the waivers changed** learns whether the NEXT advance will be checked as strictly as this one.
    // *An advance that carries a loosening silently is an advance that can loosen its own successor*, so the
    // loosening is the first thing on the line.
    //
    // **EVERY PATH IS NAMED, NOT COUNTED.** The arm for this is *"a gateChanges list the display omits"*, and a
    // count would satisfy a careless reading while hiding which file moved — *"2 files changed" is a fact about
    // the list, not about the gate.* The record's own validation already bounds the list, so printing all of it
    // cannot be made unbounded by a producer.
    const moved = record.gateChanges.length === 0
      ? 'none'
      : record.gateChanges.join(', ')
    const headlineLines = record.headlines.length === 0
      ? '  (no headline subjects)'
      : record.headlines.map(subject => `  ${subject}`).join('\n')
    return Object.freeze({
      kind: 'repo.advance',
      fields: approvalFieldsOf('repo.advance', record),
      // **LEADING WITH `checks changed`, THEN THE MOVE, THEN THE SUBJECTS.** Each block is derived from the
      // record's own validated fields, so nothing here is a re-encoding of a value the digest does not cover.
      words: `checks changed: ${moved}\n`
        + `Move main from ${record.from.slice(0, 7)} to ${record.to.slice(0, 7)}: `
        + `${String(record.commitCount)} commits; checks changed: ${moved}\n`
        + `its subjects, exactly as bound:\n${headlineLines}\n`
        + `repo ${record.repo} · tree ${record.tree.slice(0, 7)} · courts run ${record.courtsRunId}`,
    })
  }
  // ══ **THE RELEASE SWITCH (plan section 5 row 9; section 2 step 14)** ═══════════════════════════════════
  //
  // Switching the live app to a release changes what Peter opens in the morning, and it is the one action with no
  // record of why. This is the record's display: **ONE SENTENCE, AND EVERY VALUE IN IT COMES FROM THE RECORD.**
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    && parsed.kind === RELEASE_ACTIVATE_KIND) {
    let record = null
    try {
      record = buildReleaseActivate(parsed)
    } catch (error) {
      return Object.freeze({ ok: false, reason: `release-activate: ${String(error?.code ?? error?.message ?? 'refused')}` })
    }
    // **THE BYTES MUST BE THE CANONICAL ENCODING OF WHAT THEY PARSE TO**, the same rule the other kinds follow:
    // otherwise this rendering would be a second encoding of one record, and the digest covers only one.
    if (`${canonicalText(record)}\n` !== text) {
      return Object.freeze({ ok: false, reason: 'release-activate:bytes-are-not-the-canonical-encoding' })
    }
    // ── **"green" IS NOT DECORATION, AND IT IS NOT A CLAIM THIS DISPLAY MAKES ON ITS OWN** ───────────────
    //
    // The word appears in the line Fable specified, and it stands for a property the RECORD was required to have
    // before it could be built: its `cutFrom` is at or behind `refs/aukora/green`. **IT IS THE FRONTIER CHECK,
    // STATED IN THE SENTENCE THE OWNER READS** — so a person approving a switch is told the commit has been
    // through the courts, which is the fact that decides whether the switch is safe. *A display that omitted it
    // would leave the owner to remember the check; a display that asserted it without the check having been made
    // would be worse than omitting it.* The check lives in `assertAtOrBehindFrontier`, and the caller that builds
    // a record for a switch is the caller that must have run it.
    return Object.freeze({
      kind: 'release.activate',
      // **THE LINE FABLE SPECIFIED, BUILT FROM THE RECORD'S OWN FIELDS AND NOTHING ELSE.**
      words: `Switch the live app to release ${record.releaseId} `
        + `(cut from ${record.cutFrom.slice(0, 7)}, green): ${record.compositionSha.slice(0, 8)}\n`
        + `its prepare receipt, exactly as bound: ${record.prepareReceiptDigest}`,
    })
  }
  return Object.freeze({ kind: 'operation', words: `operation — its content, exactly as bound:\n${escapeWitnessText(text)}` })
}

/**
 * The witness of one operation: the words, their digest, and how much of the text they show.
 *
 * THE TRUNCATION TRAP, HANDLED WHERE IT CAN BE SEEN. A long staged text is SHORTENED at
 * {@link WITNESS_DISPLAY_LIMIT}, the screen is told that it was shortened and by how much, and the
 * bound text is untouched — the digest above the line still covers every character of it. A middle
 * silently dropped would change what the operation appears to say, which is a description of a
 * different operation.
 * @param {Buffer} content - the operation's exact content bytes.
 * @returns {Readonly<Record<string, unknown>>} `{kind, words, wordsDigest, truncated, omittedChars}`.
 */
export function approvalWitnessFor(content) {
  const derived = deriveApprovalWitness(content)
  const truncated = derived.words.length > WITNESS_DISPLAY_LIMIT
  const omitted = truncated ? derived.words.length - WITNESS_DISPLAY_LIMIT : 0
  const words = truncated
    ? `${derived.words.slice(0, WITNESS_DISPLAY_LIMIT)}\n… (${String(omitted)} more character(s) of this description are not shown; the digest covers them)`
    : derived.words
  return Object.freeze({
    kind: derived.kind,
    // THE LABELLED CARD TRAVELS WITH THE WORDS, derived from the same bytes by the same call.
    fields: typeof derived.fields === 'object' && derived.fields !== null
      ? derived.fields
      : approvalFieldsOf(derived.kind, null),
    words,
    wordsDigest: approvalWordsDigest(words),
    truncated,
    omittedChars: omitted,
  })
}

/**
 * Take the operation content off one wire request and prove it is the content the digest covers.
 *
 * THE ONE CHECK THAT MAKES THE DESCRIPTION HONEST. The requesting side sends the bytes; whether those
 * bytes are the operation is decided HERE, by recomputing the digest over them and comparing it to the
 * `operationDigest` the SIGNED request carries. Content that does not hash to the signed digest is
 * refused by name, and nothing is displayed: a caller whose description differs from the bound bytes is
 * refused, never shown.
 * @param {Readonly<Record<string, unknown>>} request - the parsed wire request.
 * @returns {Readonly<{ok: true, content: Buffer} | {ok: false, reason: string}>} the verified content, or a named refusal.
 */
export function readOperationContent(request) {
  const encoded = request?.operationContent
  if (encoded === undefined || encoded === null) {
    // NO CONTENT, NO DESCRIPTION. The window still shows the identity, the digest and the window; what
    // it does not do is invent a line about an operation nobody can read.
    return Object.freeze({ ok: false, reason: OPERATION_CONTENT_ABSENT })
  }
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
    return Object.freeze({ ok: false, reason: 'signer:operation-content-malformed' })
  }
  let content
  try {
    content = Buffer.from(encoded, 'base64')
  } catch {
    return Object.freeze({ ok: false, reason: 'signer:operation-content-malformed' })
  }
  if (content.length === 0 || content.length > MAX_WITNESS_CONTENT_BYTES) {
    return Object.freeze({ ok: false, reason: 'signer:operation-content-malformed' })
  }
  if (operationDigestOfContent(content) !== request?.operationDigest) {
    // THE CALLER'S CONTENT IS NOT THE CONTENT THE DIGEST COVERS. This is Z2's court, in the only place
    // it can be decided on this side of the window.
    return Object.freeze({ ok: false, reason: 'signer:operation-content-mismatch' })
  }
  return Object.freeze({ ok: true, content })
}
