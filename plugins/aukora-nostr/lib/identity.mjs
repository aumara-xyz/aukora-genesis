/**
 * A NOSTR IDENTITY, AND THE BINDING THAT SAYS WHICH AUKORA SUBJECT OWNS IT.
 *
 * Two curves, two jobs, and they must not be confused:
 *
 *   secp256k1 / BIP-340   the NOSTR key. It signs events, it is what a relay checks, and its public
 *                         half is the `npub` a friend adds. Vendored and pinned — Node produces DER
 *                         ECDSA for `scheme:'schnorr'` and does not say so (see the pin court).
 *   ed25519               the AUMLOK key. It signs the BINDING, which is the statement "this npub
 *                         belongs to subject X". It is the identity this project already trusts, and
 *                         the Nostr key is the thing being vouched for — never the other way round.
 *
 * WHY A BINDING AT ALL. An npub is a bare public key with no name attached. Anyone can publish one and
 * claim it is theirs. The binding is what makes "the npub I am talking to is the owner's node" a checkable
 * claim instead of an assumption: the receiving side verifies that the AUMLOK key of the subject it
 * expects has signed over THIS npub.
 *
 * TWO ANCHORS, TWO QUESTIONS, AND THEY ARE NOT THE SAME QUESTION.
 *   `verifyBinding(document, {controllerDir})`      reads the controller record ON THIS MACHINE and
 *                                                   answers "did OUR controller issue this?".
 *   `verifyBindingWithKey(document, {controllerKeyHex})` checks against a controller PUBLIC KEY given
 *                                                   directly, and answers "did the key we were told to
 *                                                   expect sign this?".
 * A friend's binding resolved through the first one returns a signature failure under our own key,
 * because our key is genuinely not its signer. That is not a forgery; it is the wrong question.
 * The structural rules and the signature check are ONE implementation (`evaluateBinding`) used by
 * both, so the two cannot drift into disagreeing about what a binding is.
 *
 * WHAT IT IS NOT. A binding is not authorization and it is not attendance. It says a key signed a
 * statement about another key. It carries no grant, it authorizes no action, and a TEST-labelled
 * binding signed by a disposable controller is exactly that — the ceiling travels on the document.
 *
 * @module @aukora/dsh-plugin-nostr/identity
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign, verify as edVerify, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { schnorr } from './vendor/noble-curves/curves/secp256k1.js'

/** The binding document's domain. The signed safetyVersion negotiates the comparison protocol. */
export const NOSTR_BINDING_DOMAIN = 'aukora:nostr-identity-binding:v1'
export const NOSTR_SAFETY_VERSION = 2

/** Named refusals. Every one is a stable code, never prose a caller has to parse. */
export const NOSTR_REFUSE = Object.freeze({
  MALFORMED: 'nostr:binding-malformed',
  DOMAIN: 'nostr:binding-domain-unknown',
  SIGNATURE: 'nostr:binding-signature-invalid',
  NOSTR_KEY_MISMATCH: 'nostr:binding-npub-mismatch',
  SUBJECT_MISMATCH: 'nostr:binding-subject-mismatch',
  CONTROLLER_UNREADABLE: 'nostr:controller-unreadable',
  KEY_UNREADABLE: 'nostr:key-unreadable',
  // THE RULED STATEMENT'S TWO SHAPE REFUSALS. Both legacy and current statements have closed key sets: a ruled key
  // that is absent and a key outside the ruling are different facts with different names, so an
  // operator is told which one they have rather than "invalid statement".
  STATEMENT_KEY_MISSING: 'nostr:binding-statement-key-missing',
  STATEMENT_KEY_UNKNOWN: 'nostr:binding-statement-key-unknown',
})

/**
 * THE RULED STATEMENT'S KEY SET. Legacy identity statements have five fields; current statements
 * also sign safetyVersion so comparison support cannot be asserted in unsigned contact metadata.
 *
 * This is not a local convention: it is the statement the Aumlok signer's `sign-nostr-binding`
 * operation builds (`apps/aukora-desktop/aumlok-signer.mjs`, `nostrBindingStatement`), and the signer
 * is the only thing in this product that can sign a binding without opening a seed file. A verifier
 * that accepted a wider set would accept statements the signer never produces and cannot vouch for;
 * one that accepted a narrower set would refuse every binding the signer issues.
 *
 *   subject         the AUKORA subject the npub belongs to
 *   npub            the bech32 form of the Nostr key
 *   nostrPubkeyHex  DERIVED by decoding the npub — never trusted as a separate claim
 *   handle          the NIP-05 local part
 *   createdAt       canonical seconds-precision UTC
 *   safetyVersion   the comparison protocol supported by this identity (absent on legacy bindings)
 */
const LEGACY_NOSTR_STATEMENT_KEYS = Object.freeze(['createdAt', 'handle', 'nostrPubkeyHex', 'npub', 'subject'])
export const NOSTR_STATEMENT_KEYS = Object.freeze([...LEGACY_NOSTR_STATEMENT_KEYS, 'safetyVersion'].sort())

/**
 * THE DOCUMENT-LEVEL FIELD THAT NAMES THE BINDING'S SIGNER — `did:key:<64 hex of the ed25519 key>`.
 *
 * WHY IT IS NOT INSIDE THE SIGNED STATEMENT, AND WHY IT IS STILL TRUSTWORTHY.
 *
 * B5 ruled the statement down to the five keys above, and `approvalKeyDid` — which used to ride
 * inside it — is not one of them. The signer key is not lost by that ruling; it moves HERE, one level
 * up on the document, as an ORDINARY ENUMERABLE OWN PROPERTY.
 *
 * THE ENUMERABILITY IS THE POINT AND IT WAS MEASURED. A draft kept this field as a NON-ENUMERABLE own
 * property so that the in-memory document still answered `document.statement.approvalKeyDid`. That is
 * a defect, not a tidy compromise: `JSON.stringify` does not serialise non-enumerable properties and
 * the wire IS JSON, so every binding crossing the wire arrived with the signer key missing,
 * `signerKeyOf` answered null, and `contact.mjs`'s FOREIGN branch — the classification that tells
 * "somebody else's key signed this npub" from "nobody signed this" — could not fire at all. The
 * in-memory arms stayed green while the real path degraded. A field that must survive the wire must
 * be a field the wire carries.
 *
 * WHY A NAME OUTSIDE THE SIGNED BYTES IS NOT A HOLE. The name is not believed, it is CHECKED:
 * {@link verifyBindingUnderItsSigner} verifies the document's signature UNDER THIS NAMED KEY, so a
 * document that names a key it cannot sign for fails that check. The field is a ROUTE to a
 * classification, not an anchor — Ed25519 has no public-key recovery, so a signature alone cannot be
 * asked which key made it, and without a name there is no way to ask "did whoever this document names
 * actually sign it?" at all. The name is trustworthy exactly to the extent that the signature
 * verifies under it, which is the only thing `signerKeyOf`'s callers use it for.
 */
export const SIGNER_KEY_DID_FIELD = 'approvalKeyDid'

/** The ceilings this module reports on every verdict, asserted and refusing alike. */
export const NOSTR_CEILINGS = Object.freeze([
  'A BINDING IS NOT AUTHORIZATION: it says an Aumlok key signed a statement about an npub. It grants nothing, permits nothing and is not an attendance claim.',
  'TEST-LABELLED UNTIL ENROL: a binding signed by a disposable controller is signed by a TEST key, and the document says so on its face.',
  'NO_SUCCESSION: rotation and revocation of the Aumlok control are not consulted here, so a binding does not stop being valid when the control that signed it changes.',
  'SAME_UID: the Nostr secret key sits in the state directory under a mode check, which is not custody.',
])

const HEX64 = /^[0-9a-f]{64}$/
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

/** Reject hidden/line controls in every JSON field, including unsigned metadata and field names. */
export function assertContactFields(value, depth = 0) {
  const bad = () => { throw Object.assign(new Error('contact fields must not contain control, bidi override/isolate or line-separator characters'), { code: NOSTR_REFUSE.MALFORMED }) }
  if (depth > 32) bad()
  if (typeof value === 'string') {
    if (/[\p{Cc}\u202a-\u202e\u2066-\u2069\p{Zl}\p{Zp}]/u.test(value)) bad()
  } else if (value !== null && typeof value === 'object') {
    for (const [key, field] of Object.entries(value)) {
      assertContactFields(key, depth + 1)
      assertContactFields(field, depth + 1)
    }
  }
}

// ── the controller record, in the generations it has on disk ────────────────────────────────────────
/**
 * A refusal that did not come from the binding document: the RECORD could not be resolved, or its
 * private half could not be used. Shaped like {@link evaluateBinding}'s refusals so the entry points
 * hand one vocabulary to a caller, and distinguished from a verdict by carrying no `verdict` field.
 * @typedef {Readonly<{code: string, detail: string, ceilings: readonly string[]}>} ControllerRefusal
 */

/** {@link ControllerRefusal}, so the thrown and returned forms cannot drift apart. */
const controllerRefusal = (code, detail) => Object.freeze({ code, detail, ceilings: NOSTR_CEILINGS })

/** A {@link ControllerRefusal} as the Error `createBinding` throws, so a caller routes on `.code`. */
const controllerError = refusal => Object.assign(new Error(refusal.detail), { code: refusal.code })

/**
 * WHY THIS EXISTS. The controller record that signs a binding changed shape in generation 3, and every
 * reader of "the controller's signer key" has to answer for BOTH shapes or the readers drift apart:
 *
 *   v2 — ONE file (`local-control.json`) carrying the private key and the public half together, with
 *        the signer at `activeControl.publicKeys.ed25519`.
 *   v3 — the same filename carrying the PUBLIC record only (`publicRoot`, `version: 3`), with the
 *        private halves in separate seed files beside it. The signer is a machine key at
 *        `publicRoot.machines[].ed25519`.
 *
 * ONLY THE PUBLIC SIGNER IS RESOLVED HERE. This function does not open, name or touch `machine-seed-v3.json`
 * or `root-seed-v3.json`: the custody design keeps the private half out of the record, and a reader of
 * a public record must not become a second route to the seed. `publicRoot.ed25519` — the root key — is
 * deliberately NOT a fallback: it is not the signer the v3 record nominates on a machine, and widening
 * the anchor to any key in the record would make the check more permissive than the design.
 *
 * FAIL CLOSED. A v3 record whose `machines` is missing, empty, or whose entries carry no 64-hex
 * `ed25519` resolves to NOTHING and says WHICH of those it was — never to the v2 fields if they happen
 * to be present, and never to a crash. A record that is neither generation refuses in the words the v2
 * reader always used, so existing callers see no change.
 *
 * @param {string} controllerDir - the directory holding `local-control.json`.
 * @returns {Readonly<{rawHex: string, control: unknown}>|ControllerRefusal} the signer key, or why not.
 */
function resolveControllerRecord(controllerDir) {
  const recordPath = join(controllerDir, 'local-control.json')
  if (!existsSync(recordPath)) {
    return controllerRefusal(NOSTR_REFUSE.CONTROLLER_UNREADABLE, `no controller record at ${recordPath}`)
  }
  const control = JSON.parse(readFileSync(recordPath, 'utf8'))
  const record = control !== null && typeof control === 'object' ? control : {}
  // The generation is decided by what the v3 record carries, never by the absence of v2 fields.
  if (record.version === 3 || (record.publicRoot !== null && typeof record.publicRoot === 'object')) {
    const machines = record.publicRoot?.machines
    if (!Array.isArray(machines)) {
      return controllerRefusal(NOSTR_REFUSE.CONTROLLER_UNREADABLE,
        'the v3 controller record carries no publicRoot.machines list, so it names no signer key')
    }
    if (machines.length === 0) {
      return controllerRefusal(NOSTR_REFUSE.CONTROLLER_UNREADABLE,
        'the v3 controller record carries an EMPTY publicRoot.machines list, so it names no machine signer key')
    }
    // One malformed entry refuses the whole record: a machine list this reader cannot read in full is
    // not a machine list to pick a key out of, and skipping past it would silently re-anchor the check.
    const keys = machines.map(m => (m !== null && typeof m === 'object' ? m.ed25519 : undefined))
    if (keys.some(k => typeof k !== 'string' || !HEX64.test(k))) {
      return controllerRefusal(NOSTR_REFUSE.CONTROLLER_UNREADABLE,
        'the v3 controller record lists a machine with no usable ed25519 key: every publicRoot.machines entry must carry 64 lowercase hex characters')
    }
    return { rawHex: keys[0], control: record }
  }
  const rawHex = record.activeControl?.publicKeys?.ed25519
  if (!HEX64.test(rawHex ?? '')) {
    return controllerRefusal(NOSTR_REFUSE.CONTROLLER_UNREADABLE, 'the controller names no usable ed25519 key')
  }
  return { rawHex, control: record }
}

/** The raw 32 ed25519 public bytes of a private key, as 64 hex — the raw half of its SPKI DER. */
const rawPublicOf = privateKey => createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')

// ── bech32 (BIP-173) ────────────────────────────────────────────────────────────────────────────────
// Hand-rolled because the alternative is a second vendored dependency for forty lines of checksum.
// It is an ENCODING, not a primitive: no secret is protected by it, and the pin court covers the curve.
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const polymod = values => {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const top = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i]
  }
  return chk >>> 0
}
const hrpExpand = hrp => [...hrp].map(c => c.charCodeAt(0) >> 5).concat([0], [...hrp].map(c => c.charCodeAt(0) & 31))
const convertBits = (data, from, to, pad) => {
  let acc = 0, bits = 0; const out = []
  for (const value of data) {
    acc = (acc << from) | value; bits += from
    while (bits >= to) { bits -= to; out.push((acc >> bits) & ((1 << to) - 1)) }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & ((1 << to) - 1))
  return out
}

/**
 * Encode a 32-byte x-only public key as an `npub`.
 * @param {string} xonlyHex - 64 lowercase hex characters.
 * @returns {string} the bech32 `npub1…` form.
 */
export function npubEncode(xonlyHex) {
  if (!HEX64.test(xonlyHex)) throw Object.assign(new Error('npub needs 32 bytes of x-only hex'), { code: NOSTR_REFUSE.MALFORMED })
  const data = convertBits([...Buffer.from(xonlyHex, 'hex')], 8, 5, true)
  const values = [...hrpExpand('npub'), ...data, 0, 0, 0, 0, 0, 0]
  const mod = polymod(values) ^ 1
  const checksum = [0, 1, 2, 3, 4, 5].map(i => (mod >> (5 * (5 - i))) & 31)
  return 'npub1' + [...data, ...checksum].map(v => CHARSET[v]).join('')
}

/**
 * Decode an `npub` back to its 32-byte x-only hex. Refuses a bad checksum rather than returning bytes.
 * @param {string} npub - the bech32 form.
 * @returns {string} 64 lowercase hex characters.
 */
export function npubDecode(npub) {
  const bad = () => Object.assign(new Error(`not a valid npub: ${String(npub).slice(0, 20)}`), { code: NOSTR_REFUSE.MALFORMED })
  if (typeof npub !== 'string' || npub.length !== 63 || !npub.startsWith('npub1')) throw bad()
  const data = [...npub.slice(5)].map(c => CHARSET.indexOf(c))
  if (data.some(v => v === -1)) throw bad()
  if (polymod([...hrpExpand('npub'), ...data]) !== 1) throw bad()
  const bytes = Buffer.from(convertBits(data.slice(0, -6), 5, 8, false))
  if (bytes.length !== 32) throw bad()
  if (npubEncode(bytes.toString('hex')) !== npub) throw bad()
  return bytes.toString('hex')
}

// ── the Nostr keypair ──────────────────────────────────────────────────────────────────────────────

/**
 * Read this node's Nostr keypair from the state directory, creating it once if absent.
 *
 * The secret is stored 0600 inside the state directory, the same custody class the rest of this
 * project uses for local keys — a mode check, NOT custody, and the verdict says so.
 * @param {string} stateDir - the app state directory this node owns.
 * @returns {Readonly<{secretKeyHex: string, xonlyHex: string, npub: string, created: boolean}>} the identity.
 */
export function loadOrCreateNostrKey(stateDir, { create = true } = {}) {
  if (create !== true && create !== false) throw Object.assign(new Error('invalid Nostr key creation option'), { code: NOSTR_REFUSE.KEY_UNREADABLE })
  const dir = join(stateDir, 'nostr')
  const file = join(dir, 'identity.json')
  const readExisting = (attempts = 1) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'))
        if (!HEX64.test(parsed?.secretKeyHex ?? '')) throw new Error('unusable key')
        const xonlyHex = Buffer.from(schnorr.getPublicKey(Buffer.from(parsed.secretKeyHex, 'hex'))).toString('hex')
        return Object.freeze({ secretKeyHex: parsed.secretKeyHex, xonlyHex, npub: npubEncode(xonlyHex), created: false })
      } catch {
        // Another process may have exclusively created the file but not finished its write.
        if (attempt + 1 < attempts) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
      }
    }
    // JSON parser messages can quote the secret-bearing file; never include them in a refusal.
    throw Object.assign(new Error(`the Nostr identity at ${file} is unreadable; retry after its writer finishes`), { code: NOSTR_REFUSE.KEY_UNREADABLE })
  }
  if (!create || existsSync(file)) return readExisting(6)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try { chmodSync(dir, 0o700) } catch { /* a mode we cannot set is reported by the courts, not hidden */ }
  const secretKeyHex = randomBytes(32).toString('hex')
  const xonlyHex = Buffer.from(schnorr.getPublicKey(Buffer.from(secretKeyHex, 'hex'))).toString('hex')
  try {
    writeFileSync(file, `${JSON.stringify({ domain: 'aukora:nostr-identity:v1', secretKeyHex, xonlyHex, npub: npubEncode(xonlyHex) }, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  } catch (cause) {
    if (cause?.code === 'EEXIST') return readExisting(6)
    throw Object.assign(new Error(`the Nostr identity at ${file} could not be created (${cause?.code || 'write failed'})`), { code: NOSTR_REFUSE.KEY_UNREADABLE })
  }
  return Object.freeze({ secretKeyHex, xonlyHex, npub: npubEncode(xonlyHex), created: true })
}

// ── the binding ────────────────────────────────────────────────────────────────────────────────────

/** The `did:key` method prefix, and the one shape this module reads a signer key out of. */
export const DID_KEY_PREFIX = 'did:key:'

/**
 * The NIP-05 local part a statement names.
 *
 * WHERE IT COMES FROM, IN ORDER: the caller's own `handle` when it named one, then the controller
 * record's `publicRoot.handle` (the v3 record carries the handle the identity enrolled under, and a
 * binding issued by that identity should name the same one), then `TEST`.
 *
 * WHY `TEST` IS THE FLOOR RATHER THAN A THROW. A disposable v2 controller record carries no handle at
 * all, and every binding this project can produce before enrolment comes from exactly such a record.
 * The statement must still carry a `handle` — the ruled key set requires the key to be present — and a
 * binding whose record names no handle is a TEST binding, so it says so. The value is not a claim
 * about a NIP-05 name: nothing here resolves it.
 * @param {unknown} requested - the caller's handle, if it named one.
 * @param {unknown} control - the controller record `resolveControllerRecord` returned.
 * @returns {string} the NIP-05 local part to sign.
 */
function resolveHandle(requested, control) {
  if (typeof requested === 'string' && requested.length > 0) return requested
  const enrolled = control?.publicRoot?.handle
  if (typeof enrolled === 'string' && enrolled.length > 0) return enrolled
  return 'TEST'
}

/**
 * The exact bytes an Aumlok key signs for a binding: the domain, then the statement, canonically.
 * Sorted keys and no whitespace, so two encoders that agree on the fields agree on the bytes.
 * @param {Readonly<Record<string, unknown>>} statement - the binding's claim fields.
 * @returns {Buffer} the signing preimage.
 */
export function bindingPreimage(statement) {
  assertContactFields(statement)
  const ordered = {}
  for (const key of Object.keys(statement).sort()) ordered[key] = statement[key]
  return Buffer.from(`${NOSTR_BINDING_DOMAIN}\n${JSON.stringify(ordered)}`, 'utf8')
}

/**
 * Build and sign the statement "this npub belongs to subject X" with the AUMLOK controller's key.
 *
 * The Nostr key is the SUBJECT of the statement; the Aumlok key is its SIGNER. Swapping those two is
 * the mistake this function's shape exists to prevent.
 *
 * New statements bind the safety protocol version alongside the identity ({@link NOSTR_STATEMENT_KEYS}). The signer key
 * and the label are NOT signed — they ride on the DOCUMENT, as enumerable own properties, which is
 * what makes them survive `JSON.stringify` on the wire (see {@link SIGNER_KEY_DID_FIELD}). A signer
 * name inside the signed bytes would make the classification in `contact.mjs` unreachable, because a
 * document could then never both verify and name a different key.
 *
 * SIGNING IS v2 ONLY. The signer key is resolved through {@link resolveControllerRecord}, so a record
 * that is unreadable, or that names no signer, refuses with `NOSTR_REFUSE.CONTROLLER_UNREADABLE` and a
 * record whose private half is missing (a v3 public record) or does not match its own public signer
 * refuses with `NOSTR_REFUSE.KEY_UNREADABLE`. It never signs against a v3 record: that key's private
 * half lives in a seed file this module does not read, and the signer that does hold it is
 * `apps/aukora-desktop/aumlok-signer.mjs`.
 * @param {Readonly<{controllerDir: string, subject: string, nostr: {xonlyHex: string, npub: string}, handle?: string, label?: string, createdAt: string}>} input - what is being bound.
 * @returns {Readonly<Record<string, unknown>>} the signed binding document.
 */
export function createBinding(input) {
  assertContactFields({ subject: input.subject, nostr: input.nostr, handle: input.handle, label: input.label, createdAt: input.createdAt })
  const resolved = resolveControllerRecord(input.controllerDir)
  // SIGNING IS A v2-ONLY PATH, AND THAT IS DELIBERATE. A v3 controller keeps its private half in a
  // seed file this module does not open, so there is nothing here to sign with — and the binding that
  // a v3 machine key WOULD sign is a custody decision, not a fallback. So this refuses by name rather
  // than exporting the seed, and it does so BEFORE the public half is resolved: the answer a caller
  // needs is "this record cannot be signed with", which is true whether or not its signer resolves.
  const privateKeyPem = (resolved.control ?? {}).ed25519PrivateKeyPem
  if (typeof privateKeyPem !== 'string' || privateKeyPem.length === 0) {
    throw controllerError(controllerRefusal(NOSTR_REFUSE.CONTROLLER_UNREADABLE,
      'the controller record holds no usable ed25519PrivateKeyPem, so this module cannot sign with it: a v3 public record keeps its private half in a seed file this reader does not open'))
  }
  if (resolved.rawHex === undefined) throw controllerError(resolved)
  let privateKey
  try { privateKey = createPrivateKey(privateKeyPem) } catch (cause) {
    throw controllerError(controllerRefusal(NOSTR_REFUSE.KEY_UNREADABLE,
      `the controller's ed25519PrivateKeyPem is unusable: ${cause?.message ?? cause}`))
  }
  // AND THE TWO HALVES MUST BE THE SAME KEY. In a v2 record they always are. In a record that also
  // carries v3 fields they need not be, and signing with a PEM that is not the signer the binding will
  // NAME produces a document that can never verify — a fault to refuse loudly, not to hand back.
  if (rawPublicOf(privateKey) !== resolved.rawHex) {
    throw controllerError(controllerRefusal(NOSTR_REFUSE.KEY_UNREADABLE,
      'the controller record\'s ed25519PrivateKeyPem is not the key its public record names, so a binding signed here would name a signer that never signed it'))
  }
  const statement = {
    subject: input.subject,
    npub: input.nostr.npub,
    nostrPubkeyHex: input.nostr.xonlyHex,
    handle: resolveHandle(input.handle, resolved.control),
    createdAt: input.createdAt,
    safetyVersion: NOSTR_SAFETY_VERSION,
  }
  const signature = edSign(null, bindingPreimage(statement), privateKey).toString('hex')
  return Object.freeze({
    domain: NOSTR_BINDING_DOMAIN,
    statement: Object.freeze(statement),
    signature,
    // THE SIGNER IS RESOLVED, NOT READ STRAIGHT OUT OF THE RECORD, so the name a v3 machine key would
    // give a binding is the same key `verifyBinding` resolves out of that same record. ENUMERABLE, at
    // the document level, so it is on the wire.
    [SIGNER_KEY_DID_FIELD]: `${DID_KEY_PREFIX}${resolved.rawHex}`,
    // THE LABEL IS NOT SIGNED EITHER, and that is stated rather than implied: the signer has no label
    // parameter, and a document whose label were signed would need a second signature to change it.
    // The rule a reader needs is in `contact.mjs`: TEST unless the document says otherwise, because
    // TEST is the honest default for a claim this project cannot yet make about a person.
    label: typeof input.label === 'string' && input.label.length > 0 ? input.label : 'TEST',
    ceilings: NOSTR_CEILINGS,
  })
}

/**
 * THE SHARED VERIFICATION CORE — one implementation of the structural rules, the SIGNATURE check and
 * the RULED KEY SET, for BOTH verifiers below.
 *
 * This exists because there are now two trust anchors and there must not be two rulebooks. A binding
 * has to be the same document whether it is checked against a controller RECORD on this machine or
 * against a controller PUBLIC KEY handed over out of band, and the two entry points below must not be
 * able to drift apart: a rule added to one and forgotten in the other is a bound that one caller
 * accepts and another rejects for reasons neither can see.
 *
 * THE ORDER IS THE CONTRACT, AND IT IS MEASURED: SIGNATURE FIRST, THEN THE KEY SET.
 *   · A statement EDITED AFTER SIGNING must report `nostr:binding-signature-invalid`. If the key-set
 *     rule ran first, an edit that added or removed a key would be reported as a shape refusal and the
 *     fact that actually failed — the signature — would never be reached. An operator told "unknown
 *     key" would go looking for an encoder disagreement when the document had been tampered with.
 *   · A statement that is GENUINELY SIGNED but of the wrong shape must report the key-set name, which
 *     is the only way the ruled shape is enforced at all: a malformed statement that is refused for its
 *     signature would look defended while the shape rule was never exercised.
 * The arms in `tests/aukora-nostr-binding.test.mjs` sign each malformed statement before presenting it,
 * so both halves of that order are measured rather than assumed.
 *
 * It does NOT do the subject routing check. That comparison is about the receiver, not about the
 * document, and it stays in the entry points where the receiver's expectation is known.
 *
 * @param {unknown} document - the binding to check.
 * @param {string} rawHex - the controller ed25519 PUBLIC key, 64 lowercase hex characters.
 * @returns {Readonly<Record<string, unknown>>} `{structural, preimage, verified, refused}`.
 */
function evaluateBinding(document, rawHex) {
  /** The refusal shared by every entry point, so a caller routes on one vocabulary. */
  const refuse = (code, detail) => Object.freeze({ verdict: 'refused', code, detail, ceilings: NOSTR_CEILINGS })
  try { assertContactFields(document) } catch {
    return { refused: refuse(NOSTR_REFUSE.MALFORMED, 'binding fields contain control, bidi override/isolate or line separator characters') }
  }
  // A key this function cannot even build is a key that cannot verify anything, and that is the
  // signature fact rather than a malformed document: the document may be perfect. Reporting it any
  // other way would tell a caller to look at the binding when the anchor is what is unusable.
  const keyOf = () => {
    const der = Buffer.alloc(44)
    der.write('302a300506032b6570032100', 0, 'hex')
    der.write(rawHex, 12, 'hex')
    return createPublicKey({ key: der, format: 'der', type: 'spki' })
  }
  if (document === null || typeof document !== 'object') {
    return { refused: refuse(NOSTR_REFUSE.MALFORMED, 'no binding document was presented') }
  }
  const { domain, statement, signature } = document
  if (domain !== NOSTR_BINDING_DOMAIN) {
    return { refused: refuse(NOSTR_REFUSE.DOMAIN, `the document's domain is ${JSON.stringify(domain)}`) }
  }
  if (statement === null || typeof statement !== 'object' || typeof signature !== 'string') {
    return { refused: refuse(NOSTR_REFUSE.MALFORMED, 'the binding carries no statement or no signature') }
  }
  if (!HEX64.test(statement.nostrPubkeyHex ?? '')) {
    return { refused: refuse(NOSTR_REFUSE.MALFORMED, 'nostrPubkeyHex is not 32 bytes of hex') }
  }
  if (typeof statement.npub !== 'string' || typeof statement.subject !== 'string' || !statement.subject) {
    return { refused: refuse(NOSTR_REFUSE.MALFORMED, 'the statement is missing npub or subject') }
  }
  if (!CREATED_AT.test(statement.createdAt ?? '')) {
    return { refused: refuse(NOSTR_REFUSE.MALFORMED, 'createdAt must be canonical seconds-precision UTC') }
  }
  // A signature that is not 64 bytes of hex is not a signature. Reported BEFORE any key is built, so
  // the reason is the same whatever anchor is being used.
  if (!/^([0-9a-f]{2}){64}$/i.test(signature)) {
    return { refused: refuse(NOSTR_REFUSE.SIGNATURE, 'the binding carries no 64-byte hex signature') }
  }

  // ── 1. THE SIGNATURE, BEFORE ANY SHAPE RULE THAT COULD MASK IT. ─────────────────────────────────
  const preimage = bindingPreimage(statement)
  let verified = false
  try { verified = edVerify(null, preimage, keyOf(), Buffer.from(signature, 'hex')) } catch { verified = false }
  if (!verified) {
    return { structural: null, preimage, verified: false }
  }

  // ── 2. AND ONLY NOW THE RULED KEY SET. ──────────────────────────────────────────────────────────
  const present = Object.keys(statement)
  // Legacy bindings remain useful identity evidence, but cannot negotiate a current safety comparison.
  // Future positive versions authenticate as identity statements; the comparison layer rejects mismatches.
  const keys = Object.hasOwn(statement, 'safetyVersion') ? NOSTR_STATEMENT_KEYS : LEGACY_NOSTR_STATEMENT_KEYS
  const missing = keys.filter(key => !present.includes(key))
  if (missing.length > 0) {
    return { refused: refuse(NOSTR_REFUSE.STATEMENT_KEY_MISSING,
      `the statement is missing the ruled ${missing.length === 1 ? 'key' : 'keys'} ${missing.join(', ')}: a binding statement is exactly {${keys.join(', ')}}`) }
  }
  const unknown = present.filter(key => !keys.includes(key))
  if (unknown.length > 0) {
    return { refused: refuse(NOSTR_REFUSE.STATEMENT_KEY_UNKNOWN,
      `the statement carries ${unknown.length === 1 ? 'a key' : 'keys'} outside the ruled set: ${unknown.join(', ')} — this verifier reads exactly {${keys.join(', ')}}, so a document with anything else is not a binding statement`) }
  }
  if (Object.hasOwn(statement, 'safetyVersion')
    && (!Number.isSafeInteger(statement.safetyVersion) || statement.safetyVersion < 1)) {
    return { refused: refuse(NOSTR_REFUSE.MALFORMED, 'safetyVersion must be a positive safe integer') }
  }
  if (typeof statement.handle !== 'string' || !statement.handle) {
    return { refused: refuse(NOSTR_REFUSE.MALFORMED, 'handle must be a non-empty string') }
  }

  // ── 3. THE NPUB MUST BE THE KEY. A binding whose npub does not encode its own nostrPubkeyHex is two
  //      claims stapled together, and a reader who trusts the friendly npub would be trusting the
  //      wrong one. `nostrPubkeyHex` is DERIVED here, never taken as a second claim.
  let decoded
  try { decoded = npubDecode(statement.npub) } catch (cause) {
    return { refused: refuse(NOSTR_REFUSE.MALFORMED, String(cause?.message ?? cause)) }
  }
  if (decoded !== statement.nostrPubkeyHex) {
    return { refused: refuse(NOSTR_REFUSE.NOSTR_KEY_MISMATCH,
      `the npub decodes to ${decoded} and the statement names ${statement.nostrPubkeyHex}`) }
  }
  return { structural: null, preimage, verified }
}

/**
 * The verdict for a binding whose signature DID verify under the anchor it was presented against.
 *
 * THE LABEL IS READ FROM THE DOCUMENT, NOT FROM THE SIGNED STATEMENT, because B5 removed it from the
 * statement. It is deliberately NOT a signed field and `contact.mjs` treats an absent label as `TEST`:
 * the label is a note about which key signed, and the key that signed is already proven by the
 * signature. A caller needing an unforgeable label would be asking the signature to say something it
 * does not cover, which is why the reader's rule is the conservative one.
 * @param {Readonly<Record<string, unknown>>} document - the binding document.
 * @param {Readonly<Record<string, unknown>>} preimage - the bytes that were signed.
 * @returns {Readonly<Record<string, unknown>>} the verdict.
 */
const verifiedVerdict = (document, preimage) => Object.freeze({
  verdict: 'verified',
  subject: document.statement.subject,
  npub: document.statement.npub,
  nostrPubkeyHex: document.statement.nostrPubkeyHex,
  handle: document.statement.handle,
  safetyVersion: document.statement.safetyVersion ?? null,
  label: typeof document.label === 'string' ? document.label : undefined,
  bindingDigest: createHash('sha256').update(preimage).digest('hex'),
  ceilings: NOSTR_CEILINGS,
})

/**
 * The ed25519 key a binding NAMES AS ITS OWN SIGNER — the hex inside the DOCUMENT-LEVEL
 * `approvalKeyDid` ({@link SIGNER_KEY_DID_FIELD}).
 *
 * This is an EXTRACTION, not a trust decision: the string is chosen by whoever built the document, so
 * a value from here must never be used as a trust anchor by itself. It is what lets a caller say
 * WHICH controller signed something, which is the difference between "someone else's key signed this
 * for the npub" and "nobody signed this at all".
 *
 * IT READS THE DOCUMENT, NOT THE STATEMENT, AND THAT IS B5's CORRECTION. The statement is the ruled
 * five keys and carries no signer; a reader pointed at `statement.approvalKeyDid` answers null for
 * every binding this product now produces, and the FOREIGN classification in `contact.mjs` — the one
 * that names the substituted signer — silently stops being reachable.
 * @param {unknown} document - the binding.
 * @returns {string|null} 64 lowercase hex characters, or null when there is no usable `did:key:`.
 */
export function signerKeyOf(document) {
  const did = document?.[SIGNER_KEY_DID_FIELD]
  if (typeof did !== 'string' || !did.startsWith(DID_KEY_PREFIX)) return null
  const hex = did.slice(DID_KEY_PREFIX.length)
  return HEX64.test(hex) ? hex : null
}

/**
 * Check a binding against the key it NAMES AS ITS OWN SIGNER.
 *
 * FOR CLASSIFICATION ONLY — never a trust decision. It answers "is this document internally
 * consistent: did whoever it names actually sign it?", which is what distinguishes a re-pointed or
 * substituted signer from a forged document. Both are refusals; they are different refusals.
 * @param {unknown} document - the binding.
 * @returns {Readonly<Record<string, unknown>>} the same verdict vocabulary, from the same rules.
 */
export function verifyBindingUnderItsSigner(document) {
  const refuse = (code, detail) => Object.freeze({ verdict: 'refused', code, detail, ceilings: NOSTR_CEILINGS })
  const signerKeyHex = signerKeyOf(document)
  if (signerKeyHex === null) {
    return refuse(NOSTR_REFUSE.MALFORMED, `the document names no usable did:key signer in its ${SIGNER_KEY_DID_FIELD} field, so there is no key to check it against`)
  }
  const check = evaluateBinding(document, signerKeyHex)
  if (check.refused !== undefined) return check.refused
  if (!check.verified) {
    return refuse(NOSTR_REFUSE.SIGNATURE, `the binding does not verify under ${signerKeyHex}, the signer its own document names`)
  }
  return verifiedVerdict(document, check.preimage)
}

/**
 * Verify a binding against a controller PUBLIC KEY given directly as hex.
 *
 * THIS IS THE PEER VERIFIER. When the anchor is a friend's Aumlok key — the 64 hex characters
 * exchanged out of band and recorded on a contact — there is no controller record of theirs on this
 * machine to read, and `verifyBinding` below would either find nothing or, worse, check the binding
 * against OUR key and answer "did I issue this?" to a question that was "is this my friend's npub?".
 * Answers in the same vocabulary as `verifyBinding`, down to the same `NOSTR_REFUSE` codes.
 *
 * @param {unknown} document - the binding to check.
 * @param {Readonly<{controllerKeyHex: string, expectSubject?: string}>} expectation - the peer's controller key, and optionally the subject this receiver expects.
 * @returns {Readonly<Record<string, unknown>>} the verdict.
 */
export function verifyBindingWithKey(document, expectation) {
  const refuse = (code, detail) => Object.freeze({ verdict: 'refused', code, detail, ceilings: NOSTR_CEILINGS })
  try { assertContactFields(expectation) } catch { return refuse(NOSTR_REFUSE.MALFORMED, 'invalid binding expectation') }
  const rawHex = expectation?.controllerKeyHex
  if (typeof rawHex !== 'string' || !HEX64.test(rawHex)) {
    return refuse(NOSTR_REFUSE.CONTROLLER_UNREADABLE, 'the expected controller key is not 64 hex characters')
  }
  const check = evaluateBinding(document, rawHex)
  if (check.refused !== undefined) return check.refused
  if (!check.verified) {
    return refuse(NOSTR_REFUSE.SIGNATURE, 'the binding does not verify under the controller key this receiver was given')
  }
  const statement = document.statement
  // AUTHENTICATE BEFORE YOU ROUTE, in this verifier too: a forgery reports as a signature failure and
  // `subject-mismatch` stays reserved for a binding that IS authentic and is simply not for us.
  if (expectation?.expectSubject !== undefined && statement.subject !== expectation.expectSubject) {
    return refuse(NOSTR_REFUSE.SUBJECT_MISMATCH,
      `the binding is authentic but names subject ${statement.subject}, and this receiver expects ${expectation.expectSubject}`)
  }
  return verifiedVerdict(document, check.preimage)
}

/**
 * Verify a binding against a controller RECORD on this machine — the key of a controller this node
 * holds, which answers "did this node's controller issue this binding?".
 *
 * Use {@link verifyBindingWithKey} for a peer's binding: this one consults the LOCAL record, so
 * pointed at a friend's binding it reports a signature failure under our own key.
 * @param {unknown} document - the binding to check.
 * @param {Readonly<{controllerDir: string, expectSubject?: string}>} expectation - who the receiver believes it is talking to. With no `expectSubject`, the receiver asserts nothing about the subject and the routing check is not applied.
 * @returns {Readonly<Record<string, unknown>>} the verdict.
 */
export function verifyBinding(document, expectation) {
  const refuse = (code, detail) => Object.freeze({ verdict: 'refused', code, detail, ceilings: NOSTR_CEILINGS })
  try { assertContactFields(expectation) } catch { return refuse(NOSTR_REFUSE.MALFORMED, 'invalid binding expectation') }
  // THE SAME RESOLUTION createBinding USES, so a binding is checked against exactly the key the
  // record nominates whichever generation wrote it. Verification needs only the PUBLIC half, which
  // is precisely the half a v3 record keeps — so v3 verifies even though this module cannot sign v3.
  const resolved = resolveControllerRecord(expectation.controllerDir)
  if (resolved.rawHex === undefined) return refuse(resolved.code, resolved.detail)
  const rawHex = resolved.rawHex
  const check = evaluateBinding(document, rawHex)
  if (check.refused !== undefined) return check.refused
  if (!check.verified) {
    return refuse(NOSTR_REFUSE.SIGNATURE, 'the binding does not verify under the controller key this receiver trusts')
  }
  const statement = document.statement
  // ── AND ONLY NOW, THE ROUTING CHECK. ──────────────────────────────────────────────────────────
  // AUTHENTICATE BEFORE YOU ROUTE. This comparison used to run BEFORE the signature, so a FORGED
  // binding was reported as `subject-mismatch` — a routing fact — while the actual failure was that
  // nobody had signed it. Ordering it after means a forgery always reports as a signature failure,
  // and `subject-mismatch` is reserved for a binding that IS authentic and is simply not for us.
  // MEASURED by the court's tamper arm, which expected a signature code and got the mismatch.
  // An ABSENT `expectSubject` asserts nothing, so there is nothing to route on: `undefined` is not a
  // subject, and comparing against it would turn "nobody asked" into `subject-mismatch`.
  if (expectation.expectSubject !== undefined && statement.subject !== expectation.expectSubject) {
    return refuse(NOSTR_REFUSE.SUBJECT_MISMATCH,
      `the binding is authentic but names subject ${statement.subject}, and this receiver expects ${expectation.expectSubject}`)
  }
  return verifiedVerdict(document, check.preimage)
}
