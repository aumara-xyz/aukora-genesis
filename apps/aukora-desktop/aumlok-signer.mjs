// The shell's signer: it serves the approval socket the backend already talks to.
//
// WHY THE SHELL AND NOT A `--key-file`. In v3 a BOUND machine keeps the MACHINE KEY
// (`machine-seed-v3.json` in this state root, or the macOS Keychain for this user), and the ROOT is
// kept nowhere: it is re-derived from the handle and the seven words when a root-class act needs it.
// So a shell on a machine that has already been bound can sign APPROVALS without asking for the words
// again, and it still cannot re-key the identity, revoke anything or perform any other root-class act
// — which is the whole point of keeping a machine key rather than the root. A machine that has never
// been bound holds no machine key, which is a different fact from a refused approval and is reported
// as one rather than as a decline.
//
// WHAT CONSENT IS HERE. It is PER OPERATION, not per session: `ask` puts ONE operation in front of a
// person over its exact digest and returns ONE BIT. There is no session to open and no timer to run
// down, so a shell that cannot ask a person refuses the operation rather than signing it.
//
// WHAT THIS MODULE CANNOT DO YET, MEASURED RATHER THAN ASSUMED. MEASURED 2026-09-23 at this tip: the
// two organ functions this file used to call — the v2 session factory and the v2 socket server — are
// exported by NO module under `plugins/aukora-aumlok/lib/` any more; the nuke removed them. The v3
// replacements exist (`readKeptMachineSeed` in `record-v3.mjs`, `createOwnerSigner` in
// `owner-signer.mjs`) and they are a DIFFERENT SHAPE rather than a rename: the machine key is read
// rather than a phrase typed, the signer is built from an Ed25519 key rather than an opened wrap, and
// the local socket server the shell needs is written in `scripts/aumlok/signer.mjs` for the TERMINAL
// route rather than exported by the organ for this one.
//
// THE REQUIREMENT WAS THE ROOT'S READER AND IS NOW THE MACHINE'S, WHICH IS THE CUSTODY FIX SHOWING UP
// IN THE SHELL (Y1, 2026-09-23). This list named `readKeptRootSeed` — a function that already had no
// caller anywhere in the tree, reading a file the design forbids — so the shell was declaring a
// dependency on root material to serve APPROVALS, which are machine-class. It now names the machine
// seed's reader, which is the key a signed approval is actually made with. That makes this list
// honest AND testable: the organ exports what the list names, so `missingSignerOrgan` reports the one
// thing genuinely absent (the socket server), not a function nobody was calling.
//
// SO IT REFUSES BY NAME INSTEAD OF FINISHING A SENTENCE IT CANNOT HONESTLY FINISH. This module
// previously called the removed functions directly, which meant `startShellSigner` threw
// `library.<name> is not a function` at launch — a message that reads like a bug in the shell. It now
// checks for the v3 surface it needs and reports `aumlok:signer-organ-not-v3` with the reason, so the
// gap is visible in the log and in the state reply. REWIRING IT IS A SEPARATE PIECE that needs the
// organ's socket protocol, and it is REPORTED rather than guessed at: writing a second socket server
// here, untested against the wire, would be a new signing path rather than a repair of this one.
//
// THE SOCKET PATH IS RESOLVED HERE, ONCE, AND THE BACKEND CHILD IS TOLD IT. This used to be the
// operator's: nothing in this repository exported `AUKORA_SIGNER_SOCKET`, so with no export the shell
// served nothing and the backend dialled a path someone had typed on a command line. The two agreed
// only by OMISSION, and the failure it produces is the worst kind — `aumlok:channel-unavailable`,
// "nothing is listening", about a shell that is listening somewhere else. This shell now picks the
// path under its OWN state root, `main.mjs` hands that exact string to the backend child through the
// child's ENVIRONMENT, and an exported `AUKORA_SIGNER_SOCKET` still overrides both.
//
// AND A REFUSAL HERE DOES NOT TAKE THE WINDOW DOWN. The caller logs it and the app stays up: a shell
// that cannot sign is a shell with a closed signing channel, not a shell that cannot start.
import { readJsonStrictBytes } from '../../plugins/aukora-kira/lib/strict-read.mjs'
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign as nodeSign } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { canonicalJSONSafeInteger } from '../../plugins/aukora-kira/lib/record.mjs'
// **THE PROPOSAL'S OWN MODULE.** The display below renders a record this module BUILT, so the two cannot
// disagree about what a valid record is: a shape this module would refuse is a shape this display refuses too.
import { buildRepoAdvance, REPO_ADVANCE_KIND } from '../../plugins/aukora-aumlok/lib/repo-advance.mjs'
import { buildReleaseActivate, RELEASE_ACTIVATE_KIND } from '../../plugins/aukora-aumlok/lib/release-activate.mjs'

/** The environment variable both sides read. One name, so they cannot disagree. */
export const SIGNER_SOCKET_ENV = 'AUKORA_SIGNER_SOCKET'

/** The socket this shell binds when nobody has exported one, relative to its own state root. */
export const DEFAULT_SIGNER_SOCKET_NAME = 'aumlok-signer.sock'

/** The name of the file every signer decision is appended to, under the shell's `state/logs`. */
export const SIGNER_DECISION_LOG_NAME = 'aukora-signer.log'
/** **THE APPROVAL EVENT LOG, A SIBLING OF THE DECISION LOG AND NOT A REPLACEMENT FOR IT.** */
const APPROVAL_EVENT_LOG_NAME = 'aukora-approval-events.log'

/** The `source=` field every line carries, so a reader knows which process wrote it. */
export const SIGNER_LOG_SOURCE = 'aukora-shell-signer'

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
 * THE THIRD OPERATION: `confirm-nostr-sas` — the owner's signature over the six digits a person compared.
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

/** Beta's domain string, distinct from the binding's deliberately. */
export const SAS_CONFIRMATION_DOMAIN = 'aukora:nostr-sas-confirmation:v1'

/** Beta's ruled key set, in his order. A field added here changes the preimage and is a migration. */
export const SAS_CONFIRMATION_KEYS = Object.freeze([
  'subject', 'npub', 'controllerKeyHex', 'sasDigits', 'confirmedAt',
])

/** How long a person has to answer about a comparison, in seconds, from the request's `confirmedAt`. */
export const SAS_CONFIRMATION_WINDOW_SECONDS = 300

/**
 * The bytes one `confirm-nostr-sas` request is signed over — `confirmation.mjs:69-72`, to the byte.
 * @param {Readonly<Record<string, unknown>>} statement - the five ruled fields.
 * @returns {string} the preimage.
 */
export function sasConfirmationPreimage(statement) {
  const lines = SAS_CONFIRMATION_KEYS.map(key => `${key}=${String(statement?.[key] ?? '')}`)
  // NO TRAILING NEWLINE, matching the module: `${DOMAIN}\n${lines.join('\n')}`.
  return `${SAS_CONFIRMATION_DOMAIN}\n${lines.join('\n')}`
}

/**
 * The binding document's domain, and the exact bytes it is signed over.
 *
 * IT IS THE PRODUCT'S OWN DOMAIN AND THE PRODUCT'S OWN PREIMAGE RULE, spelled out here rather than
 * imported, because `plugins/aukora-nostr/**` is not part of this shell's build: the shell carries no
 * copy of that plugin and imports nothing from it. The rule is one line — the domain, a newline, and
 * the statement with its keys sorted and no whitespace — and it is NOT left to drift: the court
 * assembles the same document and verifies it with `verifyBinding`, so an encoder that disagrees with
 * the product's own is a red court rather than a binding nobody can check.
 */
export const NOSTR_BINDING_DOMAIN = 'aukora:nostr-identity-binding:v1'

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
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u
const HEX64 = /^[0-9a-f]{64}$/u

// ── bech32 (BIP-173), the twenty lines an npub needs ───────────────────────────────────────────
// AN ENCODING, NOT A CURVE. Nothing here computes a point or holds a secret; it turns the `npub1…`
// string into the 32 bytes it encodes, which is what the signed statement must name. The alternative
// — importing the Nostr plugin's decoder — is not available to this file: that plugin is not in this
// shell's build, and a shell that imported it would ship a dependency on a face.
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

/** One bech32 checksum step. */
function bech32Polymod(values) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let checksum = 1
  for (const value of values) {
    const top = checksum >> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let index = 0; index < 5; index += 1) if ((top >> index) & 1) checksum ^= generators[index]
  }
  return checksum >>> 0
}

/** The expanded human-readable part, for the checksum. */
const bech32HrpExpand = hrp => [...hrp].map(c => c.charCodeAt(0) >> 5)
  .concat([0], [...hrp].map(c => c.charCodeAt(0) & 31))

/**
 * Decode one npub into the 32 bytes it encodes.
 *
 * REFUSES EVERYTHING IT CANNOT READ, and the caller turns that into a name. A wrong checksum, a wrong
 * prefix, a mixed case or a length that is not 32 bytes are all "this is not an npub", and signing a
 * statement built from half-understood bytes would be a binding about a key nobody named.
 * @param {unknown} npub - the bech32 string.
 * @returns {string|null} 64 lowercase hex characters, or null when this is not an npub.
 */
export function decodeNpub(npub) {
  if (typeof npub !== 'string' || npub.length < 8 || npub.length > 128) return null
  // MIXED CASE IS INVALID BECH32, and it is checked before lowercasing so it is not silently accepted.
  if (npub !== npub.toLowerCase() && npub !== npub.toUpperCase()) return null
  const text = npub.toLowerCase()
  const separator = text.lastIndexOf('1')
  if (separator < 1 || separator + 7 > text.length) return null
  const hrp = text.slice(0, separator)
  if (hrp !== 'npub') return null
  const data = []
  for (const character of text.slice(separator + 1)) {
    const value = BECH32_CHARSET.indexOf(character)
    if (value === -1) return null
    data.push(value)
  }
  if (bech32Polymod(bech32HrpExpand(hrp).concat(data)) !== 1) return null
  // Drop the six checksum characters, then read the 5-bit groups back into bytes.
  let accumulator = 0
  let bits = 0
  const bytes = []
  for (const value of data.slice(0, -6)) {
    accumulator = (accumulator << 5) | value
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >> bits) & 0xff)
    }
  }
  // NO PADDING IS ACCEPTED: an npub whose payload is not exactly 32 bytes is not a key.
  if (bits >= 5 || ((accumulator << (8 - bits)) & 0xff) !== 0) return null
  if (bytes.length !== 32) return null
  return Buffer.from(bytes).toString('hex')
}

/**
 * The statement one `sign-nostr-binding` request asserts, and the bytes the machine key signs.
 *
 * WHAT IS DERIVED RATHER THAN TAKEN. `nostrPubkeyHex` is DECODED OUT OF THE NPUB, so the statement can
 * never be the two-claims-stapled-together shape the product's verifier refuses — the friendly npub and
 * the hex key are one fact here by construction. `createdAt` is the request's own `issuedAt`, because
 * the binding's creation instant IS the instant the operation was issued; a second field carrying the
 * same fact would be a second thing to disagree about.
 * @param {{npub: string, subject: string, handle: string, issuedAt: string}} input - the four fields.
 * @returns {Readonly<Record<string, string>>} the statement.
 */
export function nostrBindingStatement(input) {
  const nostrPubkeyHex = decodeNpub(input.npub)
  if (nostrPubkeyHex === null) throw new TypeError('npub: not a decodable npub')
  return Object.freeze({
    subject: input.subject,
    npub: input.npub,
    nostrPubkeyHex,
    handle: input.handle,
    createdAt: input.issuedAt,
  })
}

/**
 * The exact bytes signed for a binding: the domain, a newline, and the statement canonically.
 *
 * THE KEYS ARE SORTED AND NOTHING IS PRETTIED, so two encoders that agree on the fields agree on the
 * bytes. This is the product's own rule, restated where the signing happens.
 * @param {Readonly<Record<string, string>>} statement - the binding's claim fields.
 * @returns {Buffer} the signing preimage.
 */
export function nostrBindingPreimage(statement) {
  const ordered = {}
  for (const key of Object.keys(statement).sort()) ordered[key] = statement[key]
  return Buffer.from(`${NOSTR_BINDING_DOMAIN}\n${JSON.stringify(ordered)}`, 'utf8')
}


/**
 * The longest single protocol line this server accepts, in BYTES.
 *
 * The broker's `exchangeLine` refuses a reply longer than its own 64 KiB ceiling, and a request over
 * that ceiling could not have come from it. Kept as the same number rather than imported, because
 * importing the broker's module into the signer would make one process hold both halves of the wire.
 */
export const MAX_SIGNER_LINE_BYTES = 64 * 1024

/**
 * How long a connection that has said NOTHING may stay open.
 *
 * NOT THE APPROVAL WINDOW. The window is the request's own `expiresAt`, and `createOwnerSigner`
 * refuses an expired request by name. This is only a backstop against a peer that connects and goes
 * silent, and it is generous because the person on the other end of a legitimate request may take a
 * minute to read it.
 */
export const SIGNER_CONNECTION_IDLE_MS = 300_000

/**
 * The PKCS#8 DER prefix for an Ed25519 private key, which is `seed` and nothing else.
 *
 * `302e020100300506032b657004220420` is the DER for `SEQUENCE { INTEGER 0, SEQUENCE { OID 1.3.101.112 },
 * OCTET STRING { OCTET STRING <32 bytes> } }` — the standard encoding of a raw Ed25519 seed, and the
 * only way to turn the 32 bytes this laptop kept into a `KeyObject` without a second crypto library.
 */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

/**
 * Build an Ed25519 private `KeyObject` from the 32 raw bytes this machine kept.
 * @param {unknown} seedHex - 64 lowercase hex characters.
 * @returns {import('node:crypto').KeyObject} the private key.
 */
function ed25519KeyFromSeed(seedHex) {
  if (typeof seedHex !== 'string' || !/^[0-9a-f]{64}$/u.test(seedHex)) {
    throw new TypeError('the kept machine seed must be 64 lowercase hexadecimal characters')
  }
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  })
}

/**
 * The raw 32-byte Ed25519 public key inside one private key, as lowercase hex.
 *
 * THE ORGAN'S OWN `rawEd25519PublicKeyHex` IS PREFERRED WHERE IT IS LOADED, and this is the fallback
 * for a library that carries the signer without it. Both derive the key from the private key: the
 * point of deriving rather than reading `kept.ed25519PublicKeyHex` is that the pair becomes a fact
 * instead of two claims in one file.
 * @param {import('node:crypto').KeyObject} privateKey - an Ed25519 private key.
 * @returns {string} 64 lowercase hex characters.
 */
function rawPublicKeyHexOf(privateKey) {
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' })
  if (typeof jwk.x !== 'string') throw new TypeError('the derived public key has no JWK x coordinate')
  return Buffer.from(jwk.x, 'base64url').toString('hex')
}

/**
 * SHA-256 of some bytes, as lowercase hex. The digest that goes in front of a person.
 * @param {Buffer} buffer - the bytes.
 * @returns {string} 64 lowercase hex characters.
 */
function sha256Hex(buffer) {
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

/** How much of a rendered description is shown. Past this the line is SHORTENED AND SAYS SO. */
export const WITNESS_DISPLAY_LIMIT = 1800

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

/**
 * The challenge a refusal may echo, or null when the request carries none that can be echoed.
 *
 * ECHOING IS CHECKED RATHER THAN HOPED FOR. `createRefusedApprovalResponse` reads the challenge with
 * the organ's `readDigest` and THROWS on anything that is not 64 lowercase hex — and this is called
 * from a socket `data` handler, where a throw is an uncaught exception in the shell's own process
 * rather than a refusal on the wire. A request with no readable challenge still gets its refusal; it
 * simply gets one that names no request, which is the honest thing to send.
 * @param {unknown} value - the request's own `challenge` field.
 * @returns {string|null} the digest to echo, or null.
 */
function readableChallenge(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value) ? value : null
}

/**
 * Wait for a decision, but never past the window the request itself carries.
 *
 * THE BOUND IS THE REQUEST'S OWN EXPIRY, NOT A NEW KNOB, and the same shape `owner-signer.mjs` uses:
 * the clock is POLLED rather than a duration computed from it, because a duration computed from a
 * clock that moves measures nothing. The timer is NOT `unref()`ed — an unref'd timer does not keep the
 * event loop alive, so a signer waiting with nothing else to do would let the process exit mid-decision
 * instead of answering — and it is cleared the moment the decision settles.
 * @param {Promise<unknown>} pending - the reviewer's answer, which may take a person's worth of time.
 * @param {number} expiresAt - unix seconds after which the request is over.
 * @returns {Promise<unknown>} the decision, or `{expired: true}` when the window closed first.
 */
function withinWindow(pending, expiresAt) {
  return new Promise(settle => {
    let done = false
    const finish = value => { if (!done) { done = true; clearInterval(poll); settle(value) } }
    const poll = setInterval(() => { if (Math.floor(Date.now() / 1000) >= expiresAt) finish({ expired: true }) }, 25)
    Promise.resolve(pending).then(finish, error => finish({ thrown: error }))
  })
}

/**
 * The v3 organ functions this shell needs before it can serve a signing channel at all.
 *
 * THE MACHINE KEY'S READER, NOT THE ROOT SEED'S (Y1, 2026-09-23). An approval is machine-class: it is
 * signed by the key this laptop holds, and the root is re-derived from handle + words when a
 * root-class act needs it. So the reader this list requires is the one that reads what is actually on
 * the laptop.
 *
 * IT NAMES WHAT THE SIGNER ACTUALLY CALLS, WHICH IS WHY IT IS LONGER THAN TWO NAMES. `approve` on the
 * signer is the organ's own decision-and-sign step, and it is built out of the request parser, the
 * refusal constructor and the signature constructor beside it. Requiring only `createOwnerSigner`
 * would let a library that carried the factory but not the codec through this check, and the failure
 * would then arrive as a `TypeError` from inside a socket handler — the exact shape of message this
 * list exists to replace with a name.
 *
 * THE LIST WAS MEASURED RATHER THAN GUESSED, AND THE FIRST DRAFT OF IT WAS WRONG. It named the six
 * functions below and stopped there; run against the real loader it reported `createOwnerSigner`, then
 * — after `owner-signer.mjs` was added — `parseApprovalRequest`, because that one lives in
 * `owner-approval.mjs`, and A RELATIVE IMPORT DOES NOT PUT A NAME ON A LIBRARY. `owner-signer.mjs`
 * importing it is enough for `createOwnerSigner` to WORK; it is not enough for this shell to CALL it.
 * The entries below are therefore written as the PATH the library is read at, so the refusal names
 * where the name has to come from rather than only what it is called.
 */
export const SIGNER_ORGAN_REQUIREMENTS = Object.freeze([
  'readKeptMachineSeed',
  'createOwnerSigner',
  'library.parseApprovalRequest',
  'library.approvalSigningBytes',
  'library.createRefusedApprovalResponse',
  'library.createSignedApprovalResponse',
])

/**
 * Read one dotted path out of the loaded library.
 * @param {object} library - the organ library from {@link loadOrganLibrary}.
 * @param {string} path - `name` or `library.name`.
 * @returns {unknown} the value, or undefined.
 */
function organValueAt(library, path) {
  if (path.startsWith('library.')) return library?.library?.[path.slice('library.'.length)]
  return library?.[path]
}

/**
 * Where this shell should serve the approval socket.
 * @param {{env?: Record<string, string|undefined>, stateRoot?: string}} input - the environment and a state root.
 * @returns {{socketPath: string, source: string} | null} the path, or null when there is no state root to put it in.
 */
export function resolveSignerSocketPath({ env, stateRoot } = {}) {
  const configured = env?.[SIGNER_SOCKET_ENV]
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return { socketPath: resolve(configured.trim()), source: SIGNER_SOCKET_ENV }
  }
  // THE DEFAULT IS UNDER THIS SHELL'S OWN STATE ROOT, and it is only usable if there IS one. With no
  // state root there is nowhere honest to put a socket — an invented `/tmp` path would be a second
  // place for the two sides to disagree — so this still answers null and the shell says so.
  if (typeof stateRoot !== 'string' || stateRoot.trim().length === 0) return null
  return { socketPath: join(resolve(stateRoot.trim()), DEFAULT_SIGNER_SOCKET_NAME), source: 'userData-default' }
}

/**
 * The directory the decision log belongs in.
 *
 * THE LOG LIVES BESIDE THE SOCKET UNLESS SOMEBODY SAYS OTHERWISE, because the two facts a reader
 * needs together are "which path was this shell told to serve" and "what did it decide about it".
 * `logDir` is an input rather than a constant so a court can write to a scratch directory and never
 * touch the person's `~/Library/Application Support/AUKORA`.
 * @param {{logDir?: unknown, socketPath?: unknown}} input - an explicit directory, or the socket path.
 * @returns {string|null} the directory, or null when there is nowhere derivable to write.
 */
export function resolveSignerLogDir({ logDir, socketPath } = {}) {
  if (typeof logDir === 'string' && logDir.trim().length > 0) return resolve(logDir.trim())
  if (typeof socketPath === 'string' && socketPath.trim().length > 0) {
    return join(dirname(resolve(socketPath.trim())), 'logs')
  }
  return null
}

/**
 * Append one signer decision to the log, and NEVER throw into the startup path.
 *
 * WHY THIS EXISTS AT ALL (Peter's requirement, 2026-09-23). The shell's signer refused to serve for
 * hours and the only record of it was a line on a console nobody was reading. A decision that is not
 * written down is a decision that has to be rediscovered, so every verdict below goes through
 * {@link decide} and lands here — serving or not, with the reason, the socket path, and the name that
 * was missing when one was.
 *
 * THE WRITE IS BEST-EFFORT ON PURPOSE. This runs inside the launch path of the application window: a
 * read-only home directory, a full disk or a permissions problem must cost a log line, never the
 * window. Every failure is swallowed, and the caller still gets its verdict.
 * @param {string|null} directory - where to write, or null to skip.
 * @param {Readonly<Record<string, unknown>>} decision - the verdict being returned.
 * @returns {string|null} the line that was written, or null when nothing was.
 */
/**
 * **ONE LINE PER APPROVAL, SO A REAL CLICK LEAVES EVIDENCE (AUMLOK, LIVE-TEST PREP).**
 *
 * The decision log above records VERDICTS — whether the signer served and why not. It says nothing about an
 * approval, so before this a real click in the real app produced no record of WHAT was decided, over WHICH
 * digest, or how long the person had to look. **Tonight's live test needs exactly that, and reconstructing it
 * afterwards from an app log is not evidence.**
 *
 * ── WHAT IS WRITTEN, AND WHAT IS DELIBERATELY NOT ──────────────────────────────────────────────────────────
 *
 *   at               the decision's own instant, ISO
 *   operationDigest  the digest the signature covers
 *   displayedDigest  **a digest of the EXACT TEXT THE PERSON WAS SHOWN** — not of the operation. When these two
 *                    differ the window signed something other than it displayed, and only a digest of the
 *                    displayed words can show that.
 *   wordsOk          whether the window's words-check accepted the description
 *   truncated        whether the displayed text was SHORTENED (the digest still covers every character)
 *   decision         approve / refuse / closed
 *   dwellMs          shown -> decided, so a decision with no time to read is visible as one
 *
 * **NO KEY MATERIAL AND NO NOTE TEXT — DIGESTS ONLY.** The seed, the signature and the operation's own words
 * never enter this file. *An evidence log that quotes the content becomes a second copy of the thing the
 * approval existed to guard*, and this one is meant to be readable by anyone auditing a click.
 *
 * 0600 under the signer's own log directory. A failure to write is REPORTED, never thrown: a decision that has
 * already been made must not be lost because its record could not be written.
 * @param {string|null} directory - the signer's log directory, or null when there is none.
 * @param {Record<string, unknown>} event - the fields above; unknown keys are ignored.
 * @returns {string|null} the line written, or null when it could not be.
 */
export function appendApprovalEvent(directory, event) {
  if (directory === null || directory === undefined) return null
  // ── **THE SHAPE IS AK-UI'S, BECAUSE ITS APPROVALS VIEW IS ALREADY BUILDING AGAINST IT** ────────────────────
  //
  // `.agents/live/NOTE-TO-AUMLOK-approval-history-shape.md` names the exact object, and it is **JSON, not the
  // `key=value` text my first version wrote** — a different spelling of the same facts, which is precisely the
  // near-agreement that note asks to avoid. Two renderers reading two formats is a bug waiting for the second
  // reader, so this writes THEIR shape. **ONE JSON OBJECT PER LINE**, so a reader can tail it and a partial write
  // costs one row rather than the file.
  //
  //   at               when it was asked, ISO
  //   kind             the operation's kind — what the row NAMES
  //   subject          the subject in plain words — what the row SHOWS
  //   operationDigest  `sha256:…`, the digest the signature covers, NEVER rendered
  //   displayedDigest  `sha256:…`, of the EXACT TEXT SHOWN, never rendered
  //   wordsCheck       match | mismatch | unchecked
  //   spoken           yes | no | null — **THE TRUNCATION FLAG, SPELLED AS THEY SPELL IT**
  //   decision         approved | declined | pending
  //   dwellMs          shown -> decided
  //   verify           {state, at} | {state: 'unverified'}
  //
  // **NO KEY MATERIAL AND NO NOTE TEXT — DIGESTS ONLY.** `subject` is a SHORT LABEL DERIVED FROM THE BOUND BYTES
  // (the same derivation the witness uses, so it cannot be a channel a caller writes into), never the content.
  // *An evidence log that quotes the content becomes a second copy of the thing the approval existed to guard.*
  //
  // 0600 under the signer's own log directory, beside `aukora-signer.log` rather than replacing it: that one
  // records whether the signer SERVED, this records what a person DECIDED.
  const withPrefix = value => (typeof value === 'string' && value.length > 0 && !value.startsWith('sha256:')
    ? `sha256:${value}`
    : value)
  const row = {
    at: event?.at ?? new Date().toISOString(),
    kind: event?.kind ?? null,
    subject: event?.subject ?? null,
    operationDigest: withPrefix(event?.operationDigest ?? null),
    displayedDigest: withPrefix(event?.displayedDigest ?? null),
    wordsCheck: event?.wordsCheck ?? 'unchecked',
    spoken: event?.spoken ?? null,
    decision: event?.decision ?? 'pending',
    dwellMs: Number.isSafeInteger(event?.dwellMs) && event.dwellMs >= 0 ? event.dwellMs : null,
    // **THE BADGE ONLY FILLS FROM A REAL VERIFY.** AK-UI's own rule, and the honest default is `unverified`: a
    // settled effect nobody has proved is not a verified one, and this log must not imply otherwise.
    verify: event?.verify ?? { state: 'unverified' },
  }
  const line = `${JSON.stringify(row)}\n`
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    appendFileSync(join(directory, APPROVAL_EVENT_LOG_NAME), line, { mode: 0o600, flag: 'a' })
    return line
  } catch {
    // **A RECORD THAT COULD NOT BE WRITTEN IS NOT A DECISION THAT DID NOT HAPPEN.** The caller says so out loud;
    // returning null here is what makes the difference visible rather than silent.
    return null
  }
}

/**
 * Append one signer decision to the log, and NEVER throw into the startup path.
 *
 * WHY THIS EXISTS AT ALL (Peter's requirement, 2026-09-23). The shell's signer refused to serve for
 * hours and the only record of it was a line on a console nobody was reading. A decision that is not
 * written down is a decision that has to be rediscovered, so every verdict below goes through
 * {@link decide} and lands here — serving or not, with the reason, the socket path, and the name that
 * was missing when one was.
 *
 * THE WRITE IS BEST-EFFORT ON PURPOSE. This runs inside the launch path of the application window: a
 * read-only home directory, a full disk or a permissions problem must cost a log line, never the
 * window. Every failure is swallowed, and the caller still gets its verdict.
 * @param {string|null} directory - where to write, or null to skip.
 * @param {Readonly<Record<string, unknown>>} decision - the verdict being returned.
 * @returns {string|null} the line that was written, or null when nothing was.
 */

export function writeSignerDecision(directory, decision) {
  if (directory === null) return null
  const parts = [`at=${new Date().toISOString()}`, `source=${SIGNER_LOG_SOURCE}`]
  for (const key of ['serving', 'reason', 'socketPath', 'missing']) {
    const value = decision?.[key]
    // SKIPPED RATHER THAN PRINTED AS `undefined`: a field the verdict does not carry is not a fact
    // about this decision, and a log full of `undefined` is a log nobody can grep.
    if (value === undefined || value === null) continue
    parts.push(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
  }
  const line = `${parts.join(' ')}\n`
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    appendFileSync(join(directory, SIGNER_DECISION_LOG_NAME), line, { mode: 0o600 })
    return line
  } catch {
    return null
  }
}

/**
 * Build one verdict, write it down, and hand it back.
 *
 * ONE PLACE DECIDES AND ONE PLACE WRITES. Every return in {@link startShellSigner} goes through here,
 * so "the decision was logged" is a property of the function rather than a thing each branch has to
 * remember — which is how the socket ended up absent with nothing written down the first time.
 * @param {{logDir: string|null, say: Function, verdict: Record<string, unknown>}} input - where to write, the console logger, the verdict.
 * @returns {Readonly<Record<string, unknown>>} the frozen verdict.
 */
function decide({ logDir, say, verdict }) {
  const frozen = Object.freeze({ ...verdict })
  writeSignerDecision(logDir, frozen)
  return frozen
}

/**
 * Whisper the part of the organ this shell still needs, so the gap is a NAME rather than a TypeError.
 * @param {object} library - the loaded organ library.
 * @returns {string|null} the first missing function, or null when the v3 surface is present.
 */
export function missingSignerOrgan(library) {
  if (library === null || library === undefined) return SIGNER_ORGAN_REQUIREMENTS[0]
  for (const path of SIGNER_ORGAN_REQUIREMENTS) {
    if (typeof organValueAt(library, path) !== 'function') return path
  }
  return null
}

/**
 * Start the shell's signer and hand back a disposer.
 *
 * THE LIBRARY IS PASSED IN, so this module can be exercised without Electron and so the shell always
 * signs with the bytes of the release it is serving rather than with a copy of its own.
 *
 * THE SERVER (layer 2, 2026-09-23). Refusing by name was right and serving nothing was the whole
 * defect: the backend is handed `AUKORA_SIGNER_SOCKET` and dials it, so a shell that does not bind
 * that path can never raise an approval. What this now does, in order, is the same order the terminal
 * signer (`scripts/aumlok/sign.mjs`'s route) uses, because it is the same wire:
 *
 *   1. refuse early, by name, when there is no bound controller, no socket path, or no organ;
 *   2. read the machine key this laptop kept (`readKeptMachineSeed`) and BUILD the private key from
 *      it. The root is never read, never needed and never held — an approval is machine-class;
 *   3. refuse `aumlok:machine-signer-not-listed-by-the-record` when the record's own
 *      `publicRoot.machines` does not list this key. A signature made by a machine the identity does
 *      not recognise would be refused by the broker anyway, and refusing here names which of the two
 *      facts is wrong;
 *   4. build the signer with the ORGAN'S OWN `createOwnerSigner`, whose review step is
 *      {@link reviewFromAsk} over the approval window. There is no second decision procedure here and
 *      no default approver;
 *   5. bind the unix socket owner-only, record its device and inode, and answer each connection with
 *      one newline-terminated response record;
 *   6. hand back a `stop` that removes the leaf ONLY when the path still resolves to the exact socket
 *      this process created.
 *
 * WHAT IT DOES NOT DO. It does not verify its own signature (that is the broker's job, and doing it
 * here would be the signer checking itself), it does not decide anything (the window answers, and
 * `ask` is that window), and it does not serve a second protocol: the request it parses and the
 * response it writes are `owner-approval.mjs`'s, the same module the broker reads.
 * @param {object} input - the organ library, the controller directory, the socket, the asker and a logger.
 * @returns {Promise<Readonly<Record<string, unknown>>>} `{serving, socketPath, reason, socket, stop}`.
 */
export async function startShellSigner(input) {
  const { library, directory, socketPath, log, ask, logDir: requestedLogDir } = input
  const say = typeof log === 'function' ? log : () => {}
  const logDir = resolveSignerLogDir({ logDir: requestedLogDir, socketPath })

  if (directory === null || directory === undefined) {
    // A shell with no bound controller is a shell with nothing to sign for. It says so and stays up.
    return decide({
      logDir,
      say,
      verdict: { serving: false, reason: 'aumlok:adapter-unbound', socketPath: null },
    })
  }
  if (socketPath === null || socketPath === undefined) {
    return decide({
      logDir,
      say,
      verdict: { serving: false, reason: 'aumlok:signer-socket-unconfigured', socketPath: null },
    })
  }
  const absent = missingSignerOrgan(library)
  if (absent !== null) {
    // NAMED, AND NOT DRESSED UP AS A DECLINE. Nothing was asked of a person here; the shell is missing
    // the organ it would sign with, and the string below is the measurement rather than a guess.
    const reason = 'aumlok:signer-organ-not-v3'
    say(`aukora-desktop: aumlok signer: not serving: ${reason}: the release's organ exports no ${absent}(), so this `
      + 'shell has no v3 signing path to serve. Approvals refuse by name; nothing is signed.')
    return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null, missing: absent } })
  }

  // THE DIRECTORY HAS TO EXIST BEFORE A SOCKET CAN BE BOUND INTO IT. Under the default this path
  // lives in this shell's own state root, and on a fresh userData nobody has made that directory yet.
  // MEASURED, 2026-09-22: without this the very first bind failed `EACCES` and the shell reported
  // "not serving" — the same silence the default path exists to end, arrived at from the other side.
  try {
    mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 })
  } catch (error) {
    const detail = String(error?.code ?? error?.message ?? error)
    say(`aukora-desktop: aumlok signer: not serving: the socket's directory could not be made: ${detail}`)
    return decide({
      logDir,
      say,
      verdict: { serving: false, reason: 'aumlok:signer-socket-unusable', socketPath: null, detail },
    })
  }

  // ── the machine key, read rather than asked for ────────────────────────────────────────────────
  // A BOUND MACHINE KEEPS THIS KEY, AND THAT IS WHY A SHELL CAN SIGN AT ALL. A machine that has never
  // been bound holds none — a different fact from a refused approval, and reported as one.
  let kept
  try {
    kept = library.readKeptMachineSeed({ directory, custodian: 'file' })
  } catch {
    const reason = 'aumlok:no-seed'
    say(`aukora-desktop: aumlok signer: not serving: ${reason}: no machine key is kept in ${directory}, so `
      + 'this laptop has nothing to sign an approval with. Binding this machine writes one; until then '
      + 'nothing is signed.')
    return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null } })
  }

  // THE MACHINE'S OWN KEY, DERIVED FROM THE SEED RATHER THAN TRUSTED FROM THE FILE. The file names both
  // the seed and a public key; deriving the second from the first is what makes the pair a fact instead
  // of two claims that happen to sit in one JSON document.
  let privateKey
  try {
    privateKey = ed25519KeyFromSeed(kept.ed25519SeedHex)
  } catch (error) {
    const reason = 'aumlok:no-seed'
    say(`aukora-desktop: aumlok signer: not serving: ${reason}: the kept machine seed is not a usable `
      + `Ed25519 seed: ${String(error?.message ?? error)}`)
    return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null } })
  }
  const machinePublicKeyHex = library.rawEd25519PublicKeyHex?.(privateKey)
    ?? rawPublicKeyHexOf(privateKey)
  if (typeof kept.ed25519PublicKeyHex === 'string' && kept.ed25519PublicKeyHex !== machinePublicKeyHex) {
    // THE FILE CONTRADICTS ITSELF. Signing would produce bytes the record's own machine list cannot
    // explain, so it is refused before a socket exists rather than after a person has been asked.
    const reason = 'aumlok:machine-signer-not-listed-by-the-record'
    say(`aukora-desktop: aumlok signer: not serving: ${reason}: ${directory} keeps a seed that derives `
      + `${machinePublicKeyHex}, and the same file names ${kept.ed25519PublicKeyHex}. Nothing is signed.`)
    return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null } })
  }

  // THE RECORD HAS TO LIST THIS MACHINE. `publicRoot.machines[].ed25519` is the record's own statement
  // about which machines it recognizes, and a signer whose key is absent from it is a signer whose
  // signature the identity never agreed to.
  let listed = null
  try {
    // **THE RECORD IS SCANNED BEFORE IT IS PARSED (AUMLOK-92 ITEM 4).** `JSON.parse` keeps the LAST duplicate
    // key silently, and this document's whole job is to say which keys this identity recognises — **so a
    // repeated `ed25519` means two readers disagree while both report success, and the one that decides is
    // whichever parsed last.** A duplicate key is not a document with two values; it is a document that means
    // two things, and this signer must not decide to sign on one of them.
    const { value: record } = readJsonStrictBytes(join(directory, 'local-control.json'),
      { label: 'local-control.json' })
    const machines = record?.publicRoot?.machines
    listed = Array.isArray(machines) ? machines.map(entry => entry?.ed25519).filter(k => typeof k === 'string') : []
  } catch {
    listed = null
  }
  if (listed === null || !listed.includes(machinePublicKeyHex)) {
    const reason = 'aumlok:machine-signer-not-listed-by-the-record'
    say(`aukora-desktop: aumlok signer: not serving: ${reason}: the record in ${directory} does not list the `
      + `key this machine holds (${machinePublicKeyHex}), so an approval signed with it is one the identity `
      + 'does not recognize. Nothing is signed.')
    return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null } })
  }

  // ── the signer, built by the organ, driven by the approval window ──────────────────────────────
  const review = reviewFromAsk(library, ask, { logDir })
  const encodeResponse = organValueAt(library, 'library.serializeApprovalResponse')
  let signer
  try {
    signer = library.createOwnerSigner({
      privateKey,
      registeredPublicKeyHex: machinePublicKeyHex,
      review,
    })
  } catch (error) {
    const reason = 'aumlok:signer-organ-not-v3'
    say(`aukora-desktop: aumlok signer: not serving: ${reason}: the organ's signer would not build: `
      + `${String(error?.message ?? error)}`)
    return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null } })
  }
  if (typeof encodeResponse !== 'function') {
    // THE SERIALIZER IS THE WIRE. Without it there is no honest way to answer, and guessing at the
    // record's own encoding is how a second protocol gets invented beside the first.
    const reason = 'aumlok:signer-organ-not-v3'
    say(`aukora-desktop: aumlok signer: not serving: ${reason}: the wire library carries no `
      + 'serializeApprovalResponse(), so this shell cannot write a response record. Nothing is signed.')
    return decide({
      logDir,
      say,
      verdict: { serving: false, reason, socketPath: null, missing: 'library.serializeApprovalResponse' },
    })
  }

  // ── THE SECOND OPERATION, ON THE SAME WINDOW AND THE SAME KEY (Y7) ──────────────────────────────
  const refuseNames = organValueAt(library, 'library.SIGNER_REFUSE') ?? {}
  const MALFORMED = refuseNames.REQUEST_MALFORMED ?? 'signer:request-malformed'
  const EXPIRED = refuseNames.REQUEST_EXPIRED ?? 'signer:request-expired'
  const DECLINED = refuseNames.DECLINED ?? 'signer:declined'
  const ASK_UNAVAILABLE = refuseNames.ASK_UNAVAILABLE ?? 'signer:ask-unavailable'
  // THE REPLAY GUARD THIS OPERATION WAS MISSING, NAMED BY THE ORGAN RATHER THAN BY A NEW WORD HERE.
  // `createOwnerSigner` refuses a repeat with `SIGNER_REFUSE.CHALLENGE_ALREADY_SEEN`; taking the same
  // constant means a caller sees ONE vocabulary for one fact, whichever path refused it.
  const ALREADY_SEEN = refuseNames.CHALLENGE_ALREADY_SEEN ?? 'signer:challenge-already-seen'
  /**
   * The challenges THIS SIGNER has already signed a binding for, and nothing else.
   *
   * IN MEMORY, PER SIGNER, EXACTLY AS `createOwnerSigner` KEEPS ITS `seen` SET — a signer that
   * persisted it would be a signer that could be made to refuse forever by anyone who could write to
   * the file, and the fact being remembered is about this process's own answers.
   */
  const seenBindingChallenges = new Set()
  /** The challenges this signer has already signed a SAS CONFIRMATION for, and nothing else. In memory,
   *  per signer, exactly as `seenBindingChallenges` is, and for the same reason. */
  const seenSasChallenges = new Set()
  const encodeRefusal = organValueAt(library, 'library.createRefusedApprovalResponse')
  // THE WIRE LIBRARY IS A NAMED SUB-LIBRARY, NOT A FLATTENED ONE, so the signature constructor is
  // reached through `library.library` — the same path `SIGNER_ORGAN_REQUIREMENTS` names. MEASURED:
  // calling the flattened `library.createSignedApprovalResponse` threw `is not a function` at the
  // moment a person had already said yes, and the socket handler turned that into a malformed-request
  // refusal — a signature lost behind a message about the caller's own record.
  const encodeSigned = organValueAt(library, 'library.createSignedApprovalResponse')

  /**
   * Re-read the record's own machine list and answer whether THIS machine is still on it.
   *
   * THE ANCHOR IS RE-READ AT THE MOMENT OF SIGNING, NOT REMEMBERED FROM STARTUP. The record can be
   * replaced while this signer runs — a re-bind, a rotation, a restore — and a signer that kept the
   * answer it read at launch would keep signing for an identity that has stopped recognising it.
   * @returns {boolean} true when `publicRoot.machines[]` still lists the key this signer holds.
   */
  const stillListedByTheRecord = () => {
    try {
      // **AND THE SAME SCAN ON EVERY SIGNATURE (AUMLOK-92 ITEM 4).** This is the second reader of one
      // document, and **one strict read without the other is one of two implementations of the protection**:
      // the launch check decides whether to start, and this one decides whether to keep signing.
      const { value: record } = readJsonStrictBytes(join(directory, 'local-control.json'),
        { label: 'local-control.json' })
      const machines = record?.publicRoot?.machines
      if (!Array.isArray(machines)) return false
      return machines.some(entry => entry?.ed25519 === machinePublicKeyHex)
    } catch {
      // AN UNREADABLE RECORD IS NOT A LISTING. Signing on a record this function could not read would
      // be signing on the memory of a record rather than on the record.
      return false
    }
  }

  /**
   * Answer one `sign-nostr-binding` request: refuse by name, or sign the binding with the machine key.
   *
   * THE ONE BIT IS THE SAME ONE BIT. The request put in front of the person is built here and handed to
   * the SAME `review` every approval goes through, so the window, the question and the answer are the
   * product's single approval path rather than a second one built for bindings. What the person is
   * shown is the digest of the exact bytes that will be signed, so "approve" is about the binding.
   *
   * WHAT COMES BACK IS A SIGNATURE AND NOTHING ELSE. The reply is the organ's own response record, so
   * it carries the challenge that binds the answer and the 128-hex signature — never the key, never the
   * seed, never the record, and never the statement, which the caller can rebuild from its own request.
   * @param {Readonly<Record<string, unknown>>} request - the parsed wire request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} a signed or refused response record.
   */
  const answerNostrBinding = async request => {
    /** Refuse with a name, echoing the request's own challenge when there is one to echo. */
    const refuse = (refusal, challenge = null) => {
      if (typeof encodeRefusal !== 'function') {
        // WITHOUT THE ORGAN'S SERIALIZER THERE IS NO HONEST ANSWER, and there is no route here that
        // would not be a second codec. `startShellSigner` refuses to serve without it, so this is a
        // belt-and-braces branch rather than a reachable state.
        return { domain: 'aukora:owner-approval-response:v1', challenge: null, refusal: MALFORMED }
      }
      return encodeRefusal({ challenge, refusal })
    }

    const { npub, subject, handle, issuedAt, challenge: callerChallenge } = request
    if (typeof subject !== 'string' || subject.length === 0 || subject.length > 256) return refuse(MALFORMED)
    if (typeof handle !== 'string' || handle.length === 0 || handle.length > 128) return refuse(MALFORMED)
    if (typeof issuedAt !== 'string' || !CANONICAL_INSTANT.test(issuedAt)) return refuse(MALFORMED)
    if (typeof npub !== 'string') return refuse(MALFORMED)

    // THE CALLER'S CHALLENGE, ADOPTED. `reissue-binding` mints a 64-hex one-use value, sends it as
    // `request.challenge` (plugins/aukora-nostr/bin/reissue-binding.mjs:334) and REFUSES a reply that
    // does not carry it back (:355): a reply carrying a different challenge answers a different
    // question. The refusal path above already echoed it; the SUCCESS path minted its own instead,
    // which is the asymmetry this fixes. Validated exactly as `npub` and `issuedAt` are, and refused
    // with the same name, so an ill-formed challenge is MALFORMED rather than silently replaced.
    if (callerChallenge !== undefined && !/^([0-9a-f]{2}){32}$/u.test(String(callerChallenge))) {
      return refuse(MALFORMED)
    }
    let statement
    try {
      statement = nostrBindingStatement({ npub, subject, handle, issuedAt })
    } catch {
      return refuse(MALFORMED)
    }
    const issuedAtMs = Date.parse(issuedAt)
    if (!Number.isFinite(issuedAtMs)) return refuse(MALFORMED)
    const issuedAtSeconds = Math.floor(issuedAtMs / 1000)
    const expiresAt = issuedAtSeconds + NOSTR_BINDING_WINDOW_SECONDS
    const now = Math.floor(Date.now() / 1000)
    if (now >= expiresAt) return refuse(EXPIRED)

    // THE RECORD HAS TO LIST THIS MACHINE, asked again here rather than assumed from startup.
    if (!stillListedByTheRecord()) return refuse(NOSTR_SIGNER_REFUSE.MACHINE_NOT_LISTED)

    const preimage = nostrBindingPreimage(statement)
    // THE CHALLENGE IS THE CALLER'S WHEN THE CALLER SENT ONE, AND THIS SIGNER'S OWN ONLY WHEN IT DID NOT.
    // This comment used to say the opposite — "THE CHALLENGE IS THIS SIGNER'S OWN, because the only thing
    // that comes back is a signature" — and that sentence was the bug written down: the success path
    // minted a fresh value while the refusal path above echoed the caller's, so a caller that sent one
    // got its own back on a refusal and a stranger's on a signature. `reissue-binding` sends one and
    // refuses anything else (:355), which is how the two halves came apart. Adopted when present, minted
    // only when absent, so the page path that sends no challenge keeps working.
    const challenge = typeof callerChallenge === 'string' ? callerChallenge : randomBytes(32).toString('hex')

    // A CHALLENGE THIS SIGNER HAS ALREADY SIGNED IS REFUSED, AND THIS IS THE CHECK `precheck` MAKES FOR
    // EVERY OTHER OPERATION. `answerNostrBinding` calls `review()` directly rather than going through
    // `createOwnerSigner`, so `precheck` — parse, expiry, REPLAY, reviewer — never ran for it, and the
    // only things between a captured line and a second signature were the 300-second window and a
    // person clicking again. It is checked HERE, before the window opens, so a replay never reaches a
    // human at all: asking somebody to approve a question this signer has already answered is asking
    // them to authorise a duplicate.
    //
    // MEASURED, before this line existed (tests/aukora-sign-nostr-binding.test.mjs, section G): the
    // identical line sent twice came back signed twice with a BYTE-IDENTICAL signature —
    // `474a0cd1e3a2c473…` both times, because Ed25519 over one preimage is deterministic — so nothing
    // downstream could tell the replay from the original.
    if (typeof callerChallenge === 'string' && seenBindingChallenges.has(callerChallenge)) {
      return refuse(ALREADY_SEEN, challenge)
    }
    const asking = Object.freeze({
      challenge,
      subject,
      // WHAT THE PERSON SEES IS WHAT IS SIGNED: the digest of the binding preimage itself, not a
      // digest of a summary of it.
      operationDigest: sha256Hex(preimage),
      issuedAt: issuedAtSeconds,
      expiresAt,
    })
    let decision
    try {
      // THE PERSON IS SHOWN THE BINDING'S OWN BYTES. The preimage is what is signed, so it is what the
      // description is derived from — the statement text, escaped exactly as bound. Nothing here is
      // described by a caller: this signer wrote the statement itself, one step above.
      decision = await withinWindow(review({ request: asking, operationContent: preimage }), expiresAt)
    } catch {
      // A REVIEWER THAT THREW COULD NOT ASK, which is not the owner declining.
      return refuse(ASK_UNAVAILABLE, challenge)
    }
    if (decision?.expired === true) return refuse(EXPIRED, challenge)
    if (decision?.approve !== true) {
      const named = decision?.refusal === ASK_UNAVAILABLE ? ASK_UNAVAILABLE : DECLINED
      return refuse(named, challenge)
    }
    // THE CLOCK IS READ AGAIN: an awaited answer took time, and a window that closed while the person
    // was deciding must not produce a signature for a request that has already ended.
    if (Math.floor(Date.now() / 1000) >= expiresAt) return refuse(EXPIRED, challenge)
    // AND SO IS THE RECORD, FOR THE SAME REASON AND AT THE SAME MOMENT (class 1).
    //
    // THE CHECK ABOVE THE WINDOW IS NOT THE CHECK THAT MATTERS. `stillListedByTheRecord()` ran before
    // `review()` was awaited, and what it awaited is a PERSON: `NOSTR_BINDING_WINDOW_SECONDS` is 300
    // seconds of somebody reading a question. A re-bind, a rotation or a restore can take this machine
    // out of `publicRoot.machines` anywhere in that wait, and the read that decided "this identity
    // recognises this key" is then 300 seconds stale by the time the key is used. MEASURED by the arm
    // in `tests/aukora-sign-nostr-binding.test.mjs` before this line existed: the record was swapped
    // while the window was open, the person clicked Approve, and a signature came back anyway.
    //
    // NOTHING DOWNSTREAM CATCHES IT. The binding's statement is `{subject, npub, nostrPubkeyHex,
    // handle, createdAt}` — no control digest, no machine key — so this listing is the ONLY thing that
    // ties the signature to an identity that still recognises this machine. Which is also why the
    // re-read belongs HERE, at the moment of signing, and not only where the request arrives: that is
    // what `stillListedByTheRecord`'s own comment promises, and a promise kept on one side of an await
    // is not kept.
    if (!stillListedByTheRecord()) return refuse(NOSTR_SIGNER_REFUSE.MACHINE_NOT_LISTED, challenge)
    const signature = nodeSign(null, preimage, privateKey).toString('hex')
    if (typeof encodeSigned !== 'function') return refuse(MALFORMED, challenge)
    // MARKED SEEN ONLY WHEN A SIGNATURE ACTUALLY GOES OUT, which is the rule `owner-signer.mjs` follows:
    // `seen.add` sits at :137, inside `sign`, after the decision — not in `precheck`. A request that was
    // DECLINED, that expired, or that named a machine the record no longer lists produced nothing to
    // replay, so it must not burn the caller's one-use value. This line sits after every refusal above
    // it for exactly that reason, and it is the last thing before the signature is encoded.
    if (typeof callerChallenge === 'string') seenBindingChallenges.add(callerChallenge)
    return encodeSigned({ challenge, signature })
  }

  /**
   * Answer one `confirm-nostr-sas` request: refuse by name, or sign the confirmation with the MACHINE key.
   *
   * THE SAME ONE BIT, THE SAME WINDOW, THE SAME KEY AS EVERY OTHER OWNER APPROVAL. The request put in front
   * of the person is built here and handed to the SAME `review` the approvals and the binding go through.
   * What the person is shown is derived by the signer from the preimage's own bytes, so the digits on the
   * sheet are the digits that get signed.
   *
   * WHY THE MACHINE KEY AND NOT THE ROOT: `record-v3.mjs:349-360` settles it — "the approval key of a v3
   * identity is one of its MACHINES, and never `publicRoot.ed25519`". Y1 deleted the root seed, so there is
   * no root-class key on a laptop to sign a day-to-day approval with, and `root-class-v3.mjs` keeps
   * root-class acts separate. A SAS confirmation is a day-to-day owner approval.
   * @param {Readonly<Record<string, unknown>>} request - the parsed wire request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} a signed or refused response record.
   */
  const answerConfirmNostrSas = async request => {
    /** Refuse with a name, echoing the request's own challenge when there is one to echo. */
    const refuse = (refusal, challenge = null) => {
      if (typeof encodeRefusal !== 'function') {
        return { domain: 'aukora:owner-approval-response:v1', challenge: null, refusal: MALFORMED }
      }
      return encodeRefusal({ challenge, refusal })
    }

    const { subject, npub, controllerKeyHex, sasDigits, confirmedAt, challenge: callerChallenge } = request
    if (typeof subject !== 'string' || subject.length === 0 || subject.length > 256) return refuse(MALFORMED)
    // AN NPUB IS `npub1` AND FIFTY-EIGHT BECH32 CHARACTERS, checked as a shape before anything is signed
    // about it. This is narrower than the binding's `typeof npub === 'string'` on purpose: a confirmation
    // names a CONTACT, and a contact whose npub is not an npub is not one a person can compare with.
    if (typeof npub !== 'string' || !/^npub1[02-9ac-hj-np-z]{58}$/u.test(npub)) return refuse(MALFORMED)
    if (typeof controllerKeyHex !== 'string' || !HEX64.test(controllerKeyHex)) return refuse(MALFORMED)
    // THE SIX DIGITS, AND EXACTLY SIX OF THEM. A sheet showing "42891" while the signature covers "42891"
    // is a confirmation of a comparison nobody made.
    if (typeof sasDigits !== 'string' || !/^[0-9]{6}$/u.test(sasDigits)) return refuse(MALFORMED)
    if (typeof confirmedAt !== 'string' || !CANONICAL_INSTANT.test(confirmedAt)) return refuse(MALFORMED)
    if (callerChallenge !== undefined && !/^([0-9a-f]{2}){32}$/u.test(String(callerChallenge))) {
      return refuse(MALFORMED)
    }
    const confirmedAtMs = Date.parse(confirmedAt)
    if (!Number.isFinite(confirmedAtMs)) return refuse(MALFORMED)
    const confirmedAtSeconds = Math.floor(confirmedAtMs / 1000)
    const expiresAt = confirmedAtSeconds + SAS_CONFIRMATION_WINDOW_SECONDS
    if (Math.floor(Date.now() / 1000) >= expiresAt) return refuse(EXPIRED)

    // THE RECORD HAS TO LIST THIS MACHINE, asked again here rather than assumed from startup — and asked
    // again after the window, below, for the reason the binding's own comment gives at length.
    if (!stillListedByTheRecord()) return refuse(NOSTR_SIGNER_REFUSE.MACHINE_NOT_LISTED)

    const statement = { subject, npub, controllerKeyHex, sasDigits, confirmedAt }
    const preimage = Buffer.from(sasConfirmationPreimage(statement), 'utf8')
    const challenge = typeof callerChallenge === 'string' ? callerChallenge : randomBytes(32).toString('hex')

    // A CHALLENGE THIS SIGNER HAS ALREADY SIGNED IS REFUSED BEFORE THE WINDOW OPENS, so a replay never
    // reaches a person at all: asking somebody to approve a question this signer has already answered is
    // asking them to authorise a duplicate.
    if (typeof callerChallenge === 'string' && seenSasChallenges.has(callerChallenge)) {
      return refuse(ALREADY_SEEN, challenge)
    }
    const asking = Object.freeze({
      challenge,
      subject,
      // WHAT THE PERSON SEES IS WHAT IS SIGNED: the digest of the confirmation preimage itself.
      operationDigest: sha256Hex(preimage),
      issuedAt: confirmedAtSeconds,
      expiresAt,
    })
    let decision
    try {
      // THE PERSON IS SHOWN THE CONFIRMATION'S OWN BYTES, which carry the npub and the six digits. Nothing
      // here is described by a caller: this signer wrote the statement itself, one step above. THE
      // CONTACT'S NAME IS NOT ON THIS SHEET AND CANNOT BE — it is not in Beta's preimage, and a name the
      // caller supplied would be a caller-controlled string on an approval sheet, which is the one thing
      // this window never shows. The name belongs beside the sheet, in the screen that knows the contact.
      decision = await withinWindow(review({ request: asking, operationContent: preimage }), expiresAt)
    } catch {
      return refuse(ASK_UNAVAILABLE, challenge)
    }
    if (decision?.expired === true) return refuse(EXPIRED, challenge)
    if (decision?.approve !== true) {
      const named = decision?.refusal === ASK_UNAVAILABLE ? ASK_UNAVAILABLE : DECLINED
      return refuse(named, challenge)
    }
    // THE CLOCK AND THE RECORD ARE READ AGAIN: an awaited answer took time, and a person is 300 seconds of
    // somebody deciding.
    if (Math.floor(Date.now() / 1000) >= expiresAt) return refuse(EXPIRED, challenge)
    if (!stillListedByTheRecord()) return refuse(NOSTR_SIGNER_REFUSE.MACHINE_NOT_LISTED, challenge)
    const signature = nodeSign(null, preimage, privateKey).toString('hex')
    if (typeof encodeSigned !== 'function') return refuse(MALFORMED, challenge)
    // MARKED SEEN ONLY WHEN A SIGNATURE ACTUALLY GOES OUT: a request that was declined, that expired, or
    // that named a machine the record no longer lists produced nothing to replay.
    if (typeof callerChallenge === 'string') seenSasChallenges.add(callerChallenge)
    return encodeSigned({ challenge, signature })
  }

  // ── the socket ─────────────────────────────────────────────────────────────────────────────────
  // A PATH IS SHARED STATE. Two consequences, both measured by the arms in
  // `tests/aukora-shell-signer.test.mjs`: `EADDRINUSE` on a unix socket arrives as an ASYNC `error`
  // event rather than as a throw, and Node's `server.close()` unlinks the leaf UNCONDITIONALLY. So
  // ownership is recorded from the bind itself — device and inode — and both `stop()` and the error
  // path remove the leaf only while the path still resolves to that exact object.
  let bound = false
  let socketIdentity = null
  /** True when the path still resolves to the exact socket object this process created. */
  const ownsLeafNow = () => {
    if (!bound || socketIdentity === null) return false
    try {
      const state = lstatSync(socketPath, { bigint: true })
      return state.isSocket() && state.dev === socketIdentity.dev && state.ino === socketIdentity.ino
    } catch {
      return false
    }
  }
  /** Remove the socket leaf only if this process created it and it is still that same object. */
  const removeOwnSocket = () => {
    if (!ownsLeafNow()) return
    try {
      unlinkSync(socketPath)
    } catch {
      /* already gone, or unreadable: either way it is not ours to remove */
    }
  }

  // THE ONE LINE WRITTEN TO THE WIRE IS THE ORGAN'S OWN SERIALIZER, taken from the wire library the
  // loader built. A hand-rolled `JSON.stringify` here would be a second encoding of the same record,
  // which is how two ends of one protocol start disagreeing about what a response is.
  const reply = (socket, response) => {
    try {
      socket.end(encodeResponse(response))
    } catch {
      socket.destroy()
    }
  }

  const server = createServer(socket => {
    let received = ''
    let answered = false
    const answer = response => {
      if (answered) return
      answered = true
      reply(socket, response)
    }
    // NOT A SHORT TIMER: the wait here is a PERSON answering a window, and the bound that matters is
    // already in the request — `createOwnerSigner` refuses an expired one by name. This is only a
    // backstop against a peer that connects and says nothing.
    socket.setTimeout(SIGNER_CONNECTION_IDLE_MS)
    socket.on('data', chunk => {
      received += chunk.toString('utf8')
      if (Buffer.byteLength(received, 'utf8') > MAX_SIGNER_LINE_BYTES) {
        // Over-long input is ANSWERED with a refusal rather than dropped: a caller that sent something
        // wrong should get a reason, not a hang.
        answer(signer.approve(null))
        return
      }
      const newline = received.indexOf('\n')
      if (newline === -1) return
      let request
      try {
        request = JSON.parse(received.slice(0, newline))
      } catch {
        request = null
      }
      // THE SIGNER PRESENTS THE OPERATION BEFORE IT DECIDES, exactly as the terminal signer does, so
      // the request about to be signed is on the record whether the answer is a signature or a
      // refusal. It carries no secret: the subject, the control digest, the operation digest, the
      // challenge and the window.
      // WHICH OPERATION, DECIDED BY ITS OWN NAME AND BY NOTHING ELSE. A request that names an operation
      // is not an approval request and is never parsed as one; a request that names none is the
      // approval wire this server has always spoken, so the existing protocol is untouched.
      const operationName = request !== null && typeof request === 'object'
        && typeof request.operation === 'string' ? request.operation : null
      if (operationName === NOSTR_BINDING_OPERATION) {
        say(`aukora-desktop: aumlok signer: asked to sign a Nostr binding for ${String(request.subject)} `
          + `(handle ${String(request.handle)})`)
      } else if (operationName === CONFIRM_NOSTR_SAS_OPERATION) {
        // THE LOG NEVER CARRIES THE DIGITS. A SAS is only worth anything while it is not written down, and
        // a signer that logged the six digits would be publishing the comparison it exists to protect.
        say(`aukora-desktop: aumlok signer: asked to confirm a Nostr SAS for ${String(request.subject)} `
          + `(npub ${String(request.npub)})`)
      } else if (operationName !== null) {
        say(`aukora-desktop: aumlok signer: asked for the unknown operation ${operationName}; refusing by name`)
      } else if (request !== null && typeof request === 'object') {
        say(`aukora-desktop: aumlok signer: asked to sign operation ${String(request.operationDigest)} `
          + `for ${String(request.subject)} (challenge ${String(request.challenge)})`)
      }
      // Z2 — THE CONTENT IS TAKEN OFF THE WIRE AND PROVED AGAINST THE DIGEST BEFORE ANYBODY IS ASKED.
      // `readOperationContent` recomputes `sha256` over the bytes the caller sent and compares it to the
      // `operationDigest` the SIGNED request carries; content that does not hash to it is refused by
      // name and no description of it is derived at all. What reaches the window is then a function of
      // the BOUND bytes and of nothing else — a caller's own summary is refused by the bridge before a
      // window exists (`aumlok-bridge.mjs`, `admitApprovalQuestion`).
      const content = operationName === null && request !== null && typeof request === 'object'
        ? readOperationContent(request)
        : { ok: false, reason: OPERATION_CONTENT_ABSENT }
      // THE SEVEN SIGNED FIELDS AND NOTHING ELSE ARE HANDED TO THE ORGAN. `operationContent` is a field
      // ON THE LINE, not a field of the record: `parseApprovalRequest` is a closed-record reader and
      // refuses an eighth field by name, and `approvalSigningBytes` re-derives the preimage from the
      // seven — so the content is lifted off here and the record the organ sees is byte-identical to
      // one that never carried it. The digest stays the only thing signed.
      const signedRecord = operationName === null && request !== null && typeof request === 'object'
        ? Object.fromEntries(Object.entries(request).filter(([field]) => field !== 'operationContent'))
        : request
      // A CALLER THAT SENT CONTENT AND GOT IT WRONG IS REFUSED BY NAME, NOT SHOWN A WINDOW.
      //
      // Z2's court is exactly this: "a caller-supplied summary that differs from the bound bytes is
      // refused, never displayed." Content that does not hash to the signed digest IS such a summary —
      // the bytes a caller offers as the operation — and the refusal happens here, before the reviewer
      // is called and therefore before any window exists. It is NOT answered by asking a person about
      // an operation nobody can describe.
      //
      // ABSENT IS A CEILING; PRESENT-AND-UNUSABLE IS A FAULT (`aukora-fail-open-pin`). A line carrying
      // no `operationContent` at all is the older wire this server has always spoken, and it still
      // reaches the window on its digest. A line that CARRIES the field and carries something this side
      // cannot read is a caller that tried to be described and failed — and the guard here used to ask
      // `typeof request?.operationContent === 'string'`, so a number, an object or an array FELL THROUGH
      // IT: `readOperationContent` had already computed `signer:operation-content-malformed`, the type
      // guard discarded that answer, and the request went on to the approval path with no description
      // and a live Approve button. It is the same shape as the expiry renderer that demanded a string
      // from an integer wire: a condition that can never be satisfied by the value it is guarding.
      // The one check decides, by its OWN sentinel for absence, and the refusal carries the challenge
      // when there is one to carry so the answer is still attributable to its question.
      const contentRefusal = content.ok === true || content.reason === OPERATION_CONTENT_ABSENT
        ? null
        : Promise.resolve(encodeRefusal({
          challenge: readableChallenge(request?.challenge),
          refusal: content.reason,
        }))
      if (contentRefusal !== null) {
        say(`aukora-desktop: aumlok signer: refusing ${content.reason}: the content offered for operation `
          + `digest ${String(request.operationDigest)} is not the bytes this side can read and describe`)
      }
      // ASYNC, BECAUSE THE ANSWER COMES FROM A WINDOW. `approve` is the synchronous path and refuses
      // a reviewer that has to ask a person (`signer:ask-requires-await`) — which is the right refusal
      // for a caller that cannot wait, and the wrong one for this server.
      const answering = contentRefusal !== null
        ? contentRefusal
        : operationName === NOSTR_BINDING_OPERATION
        ? answerNostrBinding(request)
        : operationName === CONFIRM_NOSTR_SAS_OPERATION
        ? answerConfirmNostrSas(request)
        : operationName !== null
          // AN OPERATION THIS SIGNER DOES NOT HAVE IS REFUSED BY NAME. It is NOT handed to the approval
          // path, which would answer `signer:request-malformed` and tell the caller its record was
          // broken when the truth is that this signer has no such operation.
          ? Promise.resolve(encodeRefusal({ challenge: null, refusal: NOSTR_SIGNER_REFUSE.OPERATION_UNKNOWN }))
          : Promise.resolve(signer.approveAsync(
            signedRecord,
            content.ok === true ? { operationContent: content.content } : {},
          ))
      Promise.resolve(answering).then(answer, error => {
        // AN ANSWER THAT THREW IS NOT A REQUEST THAT WAS MALFORMED, and reporting it as one would send
        // a caller to look at its own record while the fault is here. The cause is named on the log
        // line, and the caller still gets a refusal rather than a hang.
        say(`aukora-desktop: aumlok signer: answering the request threw: ${String(error?.stack ?? error)}`)
        answer(signer.approve(null))
      })
    })
    socket.on('timeout', () => socket.destroy())
    socket.on('error', () => socket.destroy())
  })
  // ── **A SOCKET FILE IS NOT A SIGNER: PROBE IT BEFORE BELIEVING IT (AUMLOK-115, LIVE-TEST PREP)** ──────
  //
  // MEASURED (Fable, 2026-09-26): **THE SIGNER HAD NOT SERVED SINCE 2026-09-24T10:24Z.** Every app start logged
  // `serving=false reason=aumlok:signer-socket-held`, because `listen` fails `EADDRINUSE` on a socket FILE that
  // still exists — and the old check treated ANY pre-existing path as a running signer. `lsof` showed no holder:
  // a stale file, and the approval window path was dead for two days while the log said a signer held it.
  //
  // **THE FILE'S EXISTENCE WAS NEVER THE QUESTION; WHETHER ANYONE IS LISTENING IS.** A connect answers it:
  // `ECONNREFUSED` on a unix socket means the file is there and nothing is bound to it.
  //
  // **THE PROBE RUNS FIRST, BEFORE THE BIND**, so there is exactly one listen path and one success path — no
  // second copy of the ownership and chmod sequence, which is the code that must not be duplicated.
  //
  // **AND IT FAILS CLOSED ON ANYTHING ELSE.** A timeout, an `EACCES`, an unexpected code: none of them are
  // evidence that the socket is dead, so none of them license an unlink. *A probe that reads "I could not tell"
  // as "it is stale" is a probe that deletes a live signer's socket* — the very failure the old comment was
  // written to prevent, and the reason the answer is three-valued rather than a boolean.
  const socketIsLive = path => new Promise(resolve => {
    const probe = connect(path)
    let settled = false
    const finish = verdict => {
      if (settled) return
      settled = true
      probe.destroy()
      resolve(verdict)
    }
    probe.on('connect', () => finish('live'))
    // **THE TWO CODES THAT MEAN STALE, BY NAME.** `ECONNREFUSED` is a socket file with no listener; `ENOENT` is
    // no file at all (it went away between the check and the probe). Everything else is UNKNOWN.
    probe.on('error', error => {
      const errorCode = String(error?.code ?? '')
      finish(errorCode === 'ECONNREFUSED' || errorCode === 'ENOENT' ? 'stale' : 'unknown')
    })
    probe.setTimeout(2_000, () => finish('unknown'))
  })

  let staleRemoved = false
  if (existsSync(socketPath)) {
    const state = await socketIsLive(socketPath)
    if (state === 'stale') {
      // **THE FILE IS THERE AND NOBODY IS LISTENING: IT IS OURS TO REMOVE.** This is the case the old check
      // could not see, and it is the one that matters — a leftover from a killed signer is not a signer.
      say(`aukora-desktop: aumlok signer: STALE SOCKET at ${socketPath} — a connect probe got ECONNREFUSED, so `
        + 'nothing is listening. Removing it and serving.')
      try {
        unlinkSync(socketPath)
        staleRemoved = true
      } catch (error) {
        const reason = 'aumlok:signer-socket-unusable'
        say(`aukora-desktop: aumlok signer: not serving: ${reason}: the stale socket could not be removed: `
          + `${String(error?.message ?? error)}`)
        try {
          server.close()
        } catch {
          /* nothing was listening */
        }
        return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null, detail: 'stale-unremovable' } })
      }
    } else if (state === 'live') {
      // A REAL SIGNER IS HOLDING IT. Refused by name, exactly as before, and now on evidence rather than on the
      // file's mere existence.
      const reason = 'aumlok:signer-socket-held'
      say(`aukora-desktop: aumlok signer: not serving: ${reason}: a connect probe REACHED a listener on `
        + `${socketPath}, so a real signer holds it and it is left alone.`)
      return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null, detail: 'live-holder' } })
    } else {
      // COULD NOT TELL. **UNKNOWN IS NOT STALE.** The socket is left exactly as found and the refusal says which
      // fact was missing, rather than deleting a path on a guess.
      const reason = 'aumlok:signer-socket-unusable'
      say(`aukora-desktop: aumlok signer: not serving: ${reason}: ${socketPath} exists and the connect probe `
        + 'could not determine whether anything is listening, so the socket is left alone rather than deleted '
        + 'on a guess.')
      return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null, detail: 'probe-unknown' } })
    }
  }

  // Bind failure arrives HERE, not as a throw: an unix-socket `EADDRINUSE` is an async `error` event.
  const boundFailure = new Promise(resolve => server.once('error', resolve))
  const listening = new Promise(resolve => server.listen(socketPath, resolve))
  const outcome = await Promise.race([
    listening.then(() => ({ ok: true })),
    boundFailure.then(error => ({ ok: false, error })),
  ])
  if (!outcome.ok) {
    const code = String(outcome.error?.code ?? 'error')
    // A PATH THIS PROCESS DID NOT CREATE IS LEFT EXACTLY AS FOUND. An unconditional unlink here is how
    // a second launch deletes a running signer's socket — leaving that process holding its listening
    // fd with no name for any broker to reach, which presents as `channel-unavailable` forever.
    // **AND THE PROBE ABOVE IS WHY THIS BRANCH IS NOW RARE:** it is reached only when the path appeared
    // between the probe and the bind, or when the probe said `live`/`unknown` and the bind then disagreed.
    const reason = existsSync(socketPath) ? 'aumlok:signer-socket-held' : 'aumlok:signer-socket-unusable'
    say(`aukora-desktop: aumlok signer: not serving: ${reason}: ${socketPath} could not be bound `
      + `(${code}: ${String(outcome.error?.message ?? '')}).`
      + (existsSync(socketPath) ? ' A socket is already there and this process did not create it, so it is left alone.' : ''))
    try {
      server.close()
    } catch {
      /* nothing was listening */
    }
    return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null, detail: code } })
  }
  if (staleRemoved) say(`aukora-desktop: aumlok signer: serving on ${socketPath} (a stale socket was replaced).`)

  // OWNERSHIP FROM THE BIND, THEN THE MODE MADE EXPLICIT, THEN BOTH ASSERTED — all before the verdict,
  // because a signer that announces itself must not be announcing a channel wider than the key it
  // guards. A unix socket is `0777 & ~umask`, so under a group-shared umask the request channel would
  // be reachable by every process in that group: anyone who can connect can ask this key to sign an
  // arbitrary operation digest, which is the part an attacker actually needs.
  const previousUmask = process.umask(0o177)
  try {
    const created = lstatSync(socketPath, { bigint: true })
    if (!created.isSocket()) throw new Error(`${socketPath} is not a socket after bind`)
    socketIdentity = { dev: created.dev, ino: created.ino }
    bound = true
    chmodSync(socketPath, 0o600)
    const settled = lstatSync(socketPath, { bigint: true })
    const mode = settled.mode & 0o777n
    if (mode !== 0o600n) throw new Error(`${socketPath} is mode 0${mode.toString(8)} after chmod`)
  } catch (error) {
    process.umask(previousUmask)
    const detail = String(error?.message ?? error)
    say(`aukora-desktop: aumlok signer: not serving: the socket could not be secured: ${detail}`)
    removeOwnSocket()
    try {
      server.close()
    } catch {
      /* nothing was listening */
    }
    return decide({
      logDir,
      say,
      verdict: { serving: false, reason: 'aumlok:signer-socket-unusable', socketPath: null, detail },
    })
  }
  process.umask(previousUmask)

  say(`aukora-desktop: aumlok signer: serving: ${socketPath}`)
  // THE DISPOSER IS THE ONLY WAY THE SOCKET GOES AWAY, and `main.mjs` calls it from `will-quit`. It
  // does not close over a reference it does not check: `ownsLeafNow()` is read per call, because a
  // path can be replaced while this process runs and a cached answer would delete somebody else's leaf.
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    await new Promise(resolve => {
      try {
        server.close(() => resolve())
      } catch {
        resolve()
      }
    })
    // ORDER MATTERS: `server.close()` unlinks the leaf itself, so the guarded unlink runs after it and
    // is a no-op on the leaf this process created — and on a leaf that is NOT ours, `close()` is never
    // the thing that removes it because `ownsLeafNow()` was false and we would have unlinked nothing.
    removeOwnSocket()
    // THE SOCKET DID NOT EXIST BEFORE THIS CALL, SO THE DECISION THAT IT NO LONGER DOES IS NOT A NEW
    // DECISION — but a reader looking for "why is nothing listening" needs the last line to say so.
    writeSignerDecision(logDir, Object.freeze({ serving: false, reason: 'aumlok:signer-stopped', socketPath }))
  }
  return decide({
    logDir,
    say,
    verdict: { serving: true, reason: null, socketPath, socket: 'aumlok:signer-serving', stop },
  })
}

/**
 * The reviewer, built from whatever the shell can put in front of a person.
 *
 * THE MAPPING IS THE WHOLE POINT AND IT LIVES IN ONE PLACE. `ask` answers with two facts that the
 * SIGNER must keep apart on the wire: "a person looked at this and said no" and "nobody could be
 * asked". So `unavailable` becomes `ask-unavailable` and everything else that is not an explicit yes
 * becomes `declined`. An approval is `approve === true` and nothing else — a truthy value, a missing
 * field or a string is a refusal, because the failure this path exists to prevent is an approval
 * nobody gave.
 *
 * WITH NO `ask` THE ANSWER IS ALWAYS NO. A shell that cannot ask a person is a shell that cannot
 * approve an operation, which is the honest state, never a default yes.
 *
 * THE REFUSAL NAMES COME FROM THE WIRE LIBRARY, AND THE FALLBACK IS STILL A CLOSED VOCABULARY. The
 * names a reviewer may choose from live in `owner-approval.mjs`, which the loader exposes as
 * `library.library`; a library that carries them nowhere yields the two literal names, not
 * `undefined`, so a refusal on the wire is always a name a broker can read.
 * @param {Readonly<Record<string, unknown>>} library - the loaded organ library.
 * @param {Function} [ask] - `(request) => Promise<{approve: boolean, unavailable?: boolean}>`.
 * @returns {(facts: {request: unknown, operationContent?: Buffer}) => Promise<{approve: boolean, refusal?: string}>} the reviewer.
 */
export function reviewFromAsk(library, ask, options = {}) {
  // **THE EVENT LOG NEEDS A DIRECTORY, AND THIS FUNCTION IS WHERE THE DECISION IS SEEN.** MEASURED, AND IT WAS
  // MY OWN BUG: the first version referred to a `logDir` that belongs to `startShellSigner`, so it threw a
  // ReferenceError; the `catch` below then called `say`, which is ALSO not in scope here, and **threw a SECOND
  // time** — so a working approval came back as `signer:ask-unavailable`. *A catch that throws is worse than no
  // catch: it converts one failure into a different, more confusing one.*
  //
  // Every reference from here on is either a parameter or a module-level import.
  const logDir = options.logDir ?? null
  const refusals = library?.library?.SIGNER_REFUSE ?? library?.SIGNER_REFUSE ?? {
    DECLINED: 'signer:declined',
    ASK_UNAVAILABLE: 'signer:ask-unavailable',
  }
  return async ({ request, operationContent }) => {
    if (typeof ask !== 'function') return { approve: false, refusal: refusals.DECLINED }
    // WHAT THE WINDOW IS TOLD ABOUT THE OPERATION IS DERIVED HERE, FROM THE OPERATION'S OWN BYTES —
    // the same bytes `readOperationContent` has already proved hash to the signed digest. The request
    // itself carries no description, so nothing a caller wrote can reach the screen: the line handed to
    // the window is a function of the bound bytes alone.
    const witness = operationContent === undefined || operationContent === null
      ? null
      : approvalWitnessFor(Buffer.isBuffer(operationContent) ? operationContent : Buffer.from(operationContent))
    let answer
    try {
      answer = await ask(witness === null ? request : { ...request, operationWitness: witness })
    } catch {
      // AN `ask` THAT THREW COULD NOT ASK. That is not the owner declining, and the signer has a name
      // for it — this is the only place the two facts could be conflated.
      return { approve: false, refusal: refusals.ASK_UNAVAILABLE }
    }
    // ── **AND THE CLICK IS WRITTEN DOWN, DIGESTS ONLY (AUMLOK, LIVE-TEST PREP)** ────────────────────────────
    //
    // The decision log records whether the signer SERVED; this records what a person DECIDED, over which digest,
    // against the digest of the exact text they were shown, and how long they had to read it. **It is written
    // here because this is the only place that sees the answer AND the witness together** — the page knows the
    // dwell, the signer knows the bound bytes, and neither alone can state the pair.
    //
    // `displayedDigest` IS THE POINT: it is a digest of the words the window showed, so a window that signed
    // something other than it displayed is visible as a MISMATCH between the two digests rather than as two
    // files nobody compared.
    // **A RECORD MUST NEVER BREAK THE DECISION IT RECORDS.** MEASURED: the first version let a throw from here
    // escape into the reply handler, which turned a perfectly good approval into `signer:ask-unavailable` —
    // *the evidence log destroyed the thing it existed to witness.* The failure is SAID OUT LOUD instead, so a
    // missing event is never mistaken for an approval that did not happen.
    try {
      appendApprovalEvent(logDir, {
        at: new Date().toISOString(),
        // **AK-UI'S SPELLINGS, NOT MINE.** Its Approvals view builds against `kind`, `subject`, `wordsCheck`,
        // `spoken` and `decision: approved|declined|pending`; a second spelling of the same facts is the
        // near-agreement that note exists to prevent.
        kind: typeof witness?.kind === 'string' ? witness.kind : null,
        // **A SHORT LABEL DERIVED FROM THE BOUND BYTES**, which is what the row SHOWS. It is a function of the
        // content rather than the content, so the log stays digests-only and no caller can write into it.
        subject: typeof witness?.subject === 'string' ? witness.subject.slice(0, 120) : null,
        operationDigest: typeof request?.operationDigest === 'string' ? request.operationDigest : null,
        displayedDigest: witness === null ? null : approvalWordsDigest(witness.words),
        wordsCheck: answer?.wordsOk === undefined
          ? 'unchecked'
          : (answer.wordsOk === true ? 'match' : 'mismatch'),
        // **`spoken` IS THE TRUNCATION FLAG, SPELLED AS AK-UI SPELLS IT** — whether the displayed text was
        // SHORTENED, which the digest still covers.
        spoken: witness === null ? null : (witness.truncated === true ? 'yes' : 'no'),
        decision: answer?.approve === true ? 'approved' : (answer?.closed === true ? 'pending' : 'declined'),
        dwellMs: Number.isSafeInteger(answer?.dwellMs) && answer.dwellMs >= 0 ? answer.dwellMs : null,
      })
    } catch (error) {
      // **NOT `say`.** It is not in scope in this function, and calling it here is what turned a logging failure
      // into a refusal. `process.stderr.write` is available wherever node is.
      process.stderr.write('aukora-desktop: aumlok signer: THE APPROVAL EVENT COULD NOT BE RECORDED: '
        + `${String(error?.message ?? error)} — the decision itself is unaffected.\n`)
    }
    if (answer?.approve === true) return { approve: true }
    return {
      approve: false,
      refusal: answer?.unavailable === true ? refusals.ASK_UNAVAILABLE : refusals.DECLINED,
    }
  }
}
