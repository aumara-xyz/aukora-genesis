/**
 * THE SAS CONFIRMATION — the signed act that makes a contact VERIFIED.
 *
 * WHY THIS EXISTS, IN PETER'S RULE: a stronger claim needs a human signature. Until this module, a
 * contact became VERIFIED because a document carried `label: "VERIFIED"` — and `identity.mjs` says
 * outright that the label is **not signed**. So the word on an unsigned string was doing the work of
 * a person's decision, and anybody could type it.
 *
 * WHAT CHANGES. VERIFIED is now reachable through exactly one thing: a confirmation the OWNER signed
 * over the values a person actually compared. The document binds
 *
 *     {subject, npub, controllerKeyHex, sasDigits, confirmedAt}
 *
 * — the contact's npub, the controller key the contact is anchored to, and all 70 comparison digits.
 * The v2 confirmation domain retires receipts from the former prefix comparison. Nothing else can be varied while the
 * signature still verifies.
 *
 * THE THREE OUTCOMES, AND THEY ARE DIFFERENT FACTS:
 *
 *   no confirmation          the contact keeps whatever its binding earned: TEST for a test identity,
 *                            BOUND for anything else. It is NOT a lesser kind of verified.
 *   a confirmation that VERIFIES over exactly these values   VERIFIED, and only this.
 *   a confirmation that is PRESENT and DOES NOT verify        FOREIGN. A tampered confirmation is not
 *                            a weaker claim, it is a refusal — the same reading the rest of this lane
 *                            takes of a tampered binding.
 *
 * IT SIGNS NOTHING ITSELF. Like `reissue-binding.mjs`, this module holds no signing primitive for the
 * real thing: the owner's controller is v3, its private half lives in a seed file this lane does not
 * open, and the confirmation must therefore come from the shell signer. `confirmationFor` exists so a
 * court and a disposable rig can build the document with a v2 fixture controller; **the live document
 * comes from the signer, over a window Peter approves, and that operation is Aumlok's to add.**
 */
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { assertContactFields, npubDecode, NOSTR_SAFETY_VERSION } from './identity.mjs'
/**
 * THE Aumlok RECORD MODULE, RESOLVED IN EITHER TREE.
 *
 * `../../aukora-aumlok/lib/record-v3.mjs` is right for THIS CHECKOUT, where this lane sits at
 * `plugins/aukora-nostr/lib/`. It is WRONG FOR EVERY MATERIALIZED RELEASE, because a release keeps its
 * lanes FLATTENED — the same file ships at `<release>/aukora-nostr/lib/confirmation.mjs`, one level
 * shallower, judged by `scripts/materialize-aukora-release.py` as "THE DESTINATION IS FIXED BY THAT
 * ARITHMETIC, NOT BY TASTE, AND IT IS NOT `plugins/`". Two levels up from there is the release's
 * PARENT DIRECTORY, outside the release entirely. The materializer copies file CONTENT verbatim and
 * rewrites nothing, so nothing repaired this on the way in and the shipped lane could not load:
 * `tests/organism-demo.test.mjs` step 60 died with
 * `Cannot find module '<release>/aukora-aumlok/lib/record-v3.mjs'`.
 *
 * Both candidate paths are computed from THIS module's own URL and tried; the release is tried first
 * because a release run must stay inside the release. A package specifier is not an option: neither
 * tree resolves `@aukora/dsh-plugin-aumlok` (no `node_modules/@aukora` in either), and `record-v3.mjs`
 * is not among that package's `exports`.
 *
 * IT FAILS CLOSED. This module decides whether a machine is REVOKED and whether a record is v3; a
 * silent fallback to a degraded check would be worse than not loading at all, so an unresolvable
 * import throws BY NAME instead of yielding a module that cannot verify.
 */
async function loadRecordV3() {
  const here = new URL('.', import.meta.url)
  const candidates = [
    new URL('../../aukora-aumlok/lib/record-v3.mjs', here),         // a materialized release: flat
    new URL('../../plugins/aukora-aumlok/lib/record-v3.mjs', here), // this checkout: nested
  ]
  const tried = []
  for (const candidate of candidates) {
    tried.push(candidate.pathname)
    try {
      return await import(candidate.href)
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error(
    `confirmation:aumlok-record-v3-absent: the Aumlok record module is in neither of the two layouts `
    + `this lane ships in, so revocation and v3 checks cannot run: ${tried.join(' , ')}`,
  )
}

const {
  approvalKeyDidOfRecordV3, isRecordV3, projectRecordV3Control, MACHINE_REVOKED_REFUSAL, MACHINE_REVOCATION_MALFORMED_REFUSAL,
} = await loadRecordV3()
import { join } from 'node:path'

/** The domain string this document is signed over. Distinct from the binding's, deliberately. */
export const SAS_CONFIRMATION_DOMAIN = 'aukora:nostr-sas-confirmation:v2'
const PREFIX_CONFIRMATION_DOMAIN = 'aukora:nostr-sas-confirmation:v1'

/**
 * The ruled key set. A closed set, like the binding's: a confirmation carrying a field this does not
 * name is not one this lane issued, and extending it is a migration rather than an edit.
 */
export const SAS_CONFIRMATION_KEYS = Object.freeze([
  'subject',
  'npub',
  'controllerKeyHex',
  'sasDigits',
  'confirmedAt',
  'safetyVersion',
])
const LEGACY_CONFIRMATION_KEYS = SAS_CONFIRMATION_KEYS.filter(key => key !== 'safetyVersion')

/** The signer key field, at the document level and enumerable, exactly as the binding carries it. */
export const SAS_CONFIRMATION_SIGNER_FIELD = 'approvalKeyDid'

/**
 * This node's record names no single machine, or names several, so there is no approver to check
 * against. A REFUSAL rather than a fault: the record is readable and the answer is that this verifier
 * cannot tell which key should have signed.
 */
export const MACHINE_AMBIGUOUS_REFUSAL = 'aukora:machine-ambiguous'

/** The prefix a `did:key:` signer name carries. */
const DID_KEY_PREFIX = 'did:key:'

/**
 * The bytes that are signed.
 *
 * ONE LINE PER FIELD, IN A FIXED ORDER, so the preimage cannot be rearranged into a document that
 * means something else while verifying. A JSON encoding would depend on key order in the object the
 * caller happened to build, which is the kind of difference that produces two preimages for one
 * meaning.
 *
 * @param {Readonly<Record<string, unknown>>} statement - the five ruled fields.
 * @returns {string} the preimage.
 */
export function confirmationPreimage(statement) {
  assertContactFields(statement)
  if (statement?.safetyVersion !== NOSTR_SAFETY_VERSION
    || Object.keys(statement).sort().join(',') !== [...SAS_CONFIRMATION_KEYS].sort().join(',')
    || !/^[0-9]{70}$/u.test(statement.sasDigits)
    || LEGACY_CONFIRMATION_KEYS.some(key => typeof statement?.[key] !== 'string' || !statement[key])) {
    throw new Error('confirmation fields must be non-empty strings')
  }
  const lines = SAS_CONFIRMATION_KEYS.map(key => `${key}=${statement[key]}`)
  return `${SAS_CONFIRMATION_DOMAIN}\n${lines.join('\n')}`
}

/** The 32-byte ed25519 public half of a private key, as lowercase hex. */
function rawPublicOf(privateKey) {
  return createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')
}

/**
 * The owner's controller public key, and the private half when the record carries one.
 *
 * FOR A v3 RECORD THE APPROVER IS THE MACHINE KEY, AND IT IS CHOSEN BY THE SELECTOR — never read out
 * of `publicRoot` here. It used to fall back to `publicRoot.ed25519`, which is the ROOT: the key that
 * vouches for the record, not the key a machine signs with. A confirmation naming the root would be
 * asking the root to have signed something it never signs, and a verifier that accepted it would be
 * accepting the wrong key's signature — which is the whole reason this is repointed rather than
 * reimplemented.
 *
 * THE REVOCATION RULE COMES WITH THE SELECTOR. `approvalKeyDidOfRecordV3` throws
 * `aumlok:machine-revoked` when the machine this record names is in its own `revokedMachines[]`.
 * That refusal is NOT CAUGHT HERE: "this record names nobody" and "this identity retired its machine"
 * are different facts, and swallowing the second into a bare refusal would lose the only detail that
 * tells an operator what to do about it.
 *
 * A v2 record is untouched: it carries its private half, this reads it, and the behaviour is exactly
 * what it was before this change.
 *
 * @param {string} controllerDir - the controller record directory.
 * @param {string|null} bindingSignerHex - an explicit local binding signer to validate for v3.
 * @returns {{publicHex: string, privateKey: object|null}} the halves that are available.
 */
export function ownerController(controllerDir, bindingSignerHex = null) {
  const record = JSON.parse(readFileSync(join(controllerDir, 'local-control.json'), 'utf8'))
  const pem = record?.ed25519PrivateKeyPem
  if (typeof pem === 'string' && pem.length > 0) {
    const privateKey = createPrivateKey(pem)
    return { publicHex: rawPublicOf(privateKey), privateKey }
  }
  // v3: ask the record's own selector, so every approver in this project is chosen in one place.
  if (isRecordV3(record)) {
    if (typeof bindingSignerHex === 'string' && /^[0-9a-f]{64}$/u.test(bindingSignerHex)) {
      projectRecordV3Control({ record, machinePublicKeyHex: bindingSignerHex })
      return { publicHex: bindingSignerHex, privateKey: null }
    }
    // THE SELECTOR DECIDES WHICH MACHINE, AND WHETHER IT MAY APPROVE AT ALL. It throws
    // `aumlok:machine-revoked` for a retired machine and answers `null` when the record names none or
    // several, and BOTH of those rules are the reason this is called rather than re-read here.
    const did = approvalKeyDidOfRecordV3(record)
    if (typeof did !== 'string' || did === '') {
      // A RECORD THIS VERIFIER CANNOT PICK AN APPROVER FOR IS A REFUSAL, NOT A FAULT. It is named
      // so the boundary below can tell it apart from a bug in this file: one is an answer, the other
      // must keep throwing.
      throw new Error(`${MACHINE_AMBIGUOUS_REFUSAL}: ${controllerDir} is a v3 record whose selector names no single machine to approve with`)
    }
    // TWO ENCODINGS OF `did:key:` LIVE IN THIS PROJECT, AND THIS IS WHERE THEY MEET. The selector
    // returns the W3C form — `did:key:z6Mk…`, multibase base58btc — while a confirmation document
    // carries `did:key:<hex>`, which is what `identity.mjs` writes for its bindings. The hex is the
    // same key the selector just chose, and it is read from the machine the selector settled on rather
    // than re-deciding anything: the decision stays in one place, the encoding is translated here.
    const machineHex = record?.publicRoot?.machines?.[0]?.ed25519
    if (typeof machineHex !== 'string' || !/^[0-9a-f]{64}$/u.test(machineHex)) {
      throw new Error(`${controllerDir} is a v3 record whose chosen machine has no usable hex key`)
    }
    return { publicHex: machineHex, privateKey: null }
  }
  const publicHex = record?.activeControl?.publicKeys?.ed25519
  if (typeof publicHex !== 'string' || !/^[0-9a-f]{64}$/u.test(publicHex)) {
    throw new Error(`${controllerDir} names no usable ed25519 key`)
  }
  return { publicHex, privateKey: null }
}

/**
 * Build and sign a confirmation. **FOR COURTS, RIGS AND DISPOSABLE CONTROLLERS ONLY.**
 *
 * It refuses a v3 record rather than reaching for a seed, so it cannot be used to mint a live
 * confirmation for a real identity. The live document comes from the signer.
 *
 * @param {{dir: string}} owner - the owner's controller directory, carrying a v2 private half.
 * @param {{subject: string, npub: string, controllerKeyHex: string, sasDigits: string, at: string}} input - what is being confirmed.
 * @returns {Readonly<Record<string, unknown>>} the signed confirmation document.
 */
export function confirmationFor(owner, input) {
  const { publicHex, privateKey } = ownerController(owner.dir)
  if (privateKey === null) {
    throw new Error('this controller cannot sign here: a v3 record keeps its private half in a seed file, so a live confirmation must come from the signer')
  }
  const statement = Object.freeze({
    subject: input.subject,
    npub: input.npub,
    controllerKeyHex: input.controllerKeyHex,
    sasDigits: input.sasDigits,
    confirmedAt: input.at,
    safetyVersion: NOSTR_SAFETY_VERSION,
  })
  const signature = edSign(null, Buffer.from(confirmationPreimage(statement), 'utf8'), privateKey).toString('hex')
  return Object.freeze({
    domain: SAS_CONFIRMATION_DOMAIN,
    statement,
    signature,
    [SAS_CONFIRMATION_SIGNER_FIELD]: `${DID_KEY_PREFIX}${publicHex}`,
  })
}

/**
 * Verify a confirmation against the values it is supposed to be about.
 *
 * @param {unknown} confirmation - the document, or undefined when none was presented.
 * @param {{npub: string, controllerKeyHex: string|null, sasDigits: string|null, ownerControllerDir: string|undefined}} expectation - what it must say.
 * @returns {{verdict: 'absent'|'verified'|'refused'|'stale', reason?: string}} the outcome, and the
 * refusal's own name when it has one — `aumlok:machine-revoked` is the one that matters.
 */
export function verifySasConfirmation(confirmation, expectation) {
  // THE STRING CONTRACT IS KEPT, because a consumer already depends on it: Aumlok's round-trip court
  // calls this and compares the answer to `'verified'`. Returning an object here broke that arm even
  // though the round trip had started working — the failure was the SHAPE, not the verification — so
  // the name keeps answering the question it always answered.
  return verifySasConfirmationDetailed(confirmation, expectation).verdict
}

/**
 * The same check, answering with the refusal's own name when it has one.
 *
 * The name matters for exactly one case and it is not cosmetic: `aumlok:machine-revoked` says the
 * identity RETIRED the machine, which is a different fact from a signature that does not verify, and
 * only the first tells an operator what to do. A caller that needs to distinguish them calls this;
 * a caller that only routes on the outcome calls the function above.
 *
 * @param {unknown} confirmation - the document, or undefined when none was presented.
 * @param {{npub: string, controllerKeyHex: string|null, sasDigits: string|null, ownerControllerDir: string|undefined}} expectation - what it must say.
 * @returns {{verdict: 'absent'|'verified'|'refused', reason?: string}} the outcome and its name.
 */
export function verifySasConfirmationDetailed(confirmation, expectation) {
  if (confirmation === undefined || confirmation === null) return { verdict: 'absent' }
  try {
    assertContactFields(confirmation)
    assertContactFields(expectation)
  } catch { return { verdict: 'refused' } }
  if (typeof confirmation !== 'object' || Array.isArray(confirmation)) return { verdict: 'refused' }
  const document = /** @type {Record<string, unknown>} */ (confirmation)
  const prefixEra = document.domain === PREFIX_CONFIRMATION_DOMAIN
  if (document.domain !== SAS_CONFIRMATION_DOMAIN && !prefixEra) return { verdict: 'refused' }
  const statement = document.statement
  if (typeof statement !== 'object' || statement === null || Array.isArray(statement)) return { verdict: 'refused' }
  const fields = /** @type {Record<string, unknown>} */ (statement)
  // A CLOSED KEY SET, checked rather than assumed: a document carrying a field this lane does not rule
  // is not one it issued, and the extra field would sit outside the signature's meaning.
  const present = Object.keys(fields).sort()
  const legacy = !Object.hasOwn(fields, 'safetyVersion')
  if (legacy && !prefixEra) return { verdict: 'refused' }
  const keys = legacy ? LEGACY_CONFIRMATION_KEYS : SAS_CONFIRMATION_KEYS
  if (present.join(',') !== [...keys].sort().join(',')) return { verdict: 'refused' }
  for (const key of LEGACY_CONFIRMATION_KEYS) if (typeof fields[key] !== 'string' || fields[key] === '') return { verdict: 'refused' }
  if (!legacy && fields.safetyVersion !== NOSTR_SAFETY_VERSION) return { verdict: 'refused' }
  try { npubDecode(fields.npub) } catch { return { verdict: 'refused' } }
  if (!/^[0-9a-f]{64}$/u.test(fields.controllerKeyHex)
    || !(legacy ? /^(?:[0-9]{6}|[0-9]{25})$/u : /^[0-9]{70}$/u).test(fields.sasDigits)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(fields.confirmedAt)) return { verdict: 'refused' }

  // AND IT MUST BE SIGNED BY THE OWNER. The anchor is THIS machine's controller — the person doing the
  // comparing — never the peer's key, which is the whole difference between "I checked" and "they say".
  if (expectation.ownerControllerDir === undefined) return { verdict: 'refused' }
  let ownerHex
  try {
    ownerHex = ownerController(expectation.ownerControllerDir).publicHex
  } catch (cause) {
    // RETURN, DO NOT THROW. A VERIFIER SITS AT A BOUNDARY, and a throw here does not stay a refusal:
    // it becomes some other error upstream — a Messages row failing to render, or a catch that reads
    // it as `absent`. A record whose machine was retired is a REFUSAL, which is an answer this
    // function is supposed to give, so it gives it and carries the name.
    //
    // IT IS NARROW. Only the two custody refusals are turned into answers — a retired machine, and a
    // revocation list this reader cannot read. ANY OTHER ERROR STILL THROWS, because a bug in this
    // code is not a refusal and must not be dressed as one.
    const message = cause instanceof Error ? cause.message : String(cause)
    if (message.includes(MACHINE_REVOKED_REFUSAL)) return { verdict: 'refused', reason: MACHINE_REVOKED_REFUSAL }
    if (message.includes(MACHINE_REVOCATION_MALFORMED_REFUSAL)) {
      return { verdict: 'refused', reason: MACHINE_REVOCATION_MALFORMED_REFUSAL }
    }
    if (message.includes(MACHINE_AMBIGUOUS_REFUSAL)) {
      return { verdict: 'refused', reason: MACHINE_AMBIGUOUS_REFUSAL }
    }
    throw cause
  }
  const named = typeof document[SAS_CONFIRMATION_SIGNER_FIELD] === 'string'
    ? String(document[SAS_CONFIRMATION_SIGNER_FIELD]).replace(DID_KEY_PREFIX, '')
    : ''
  if (named !== ownerHex) return { verdict: 'refused' }
  let signature
  try { signature = Buffer.from(String(document.signature), 'hex') } catch { return { verdict: 'refused' } }
  if (!/^[0-9a-f]{128}$/u.test(String(document.signature))) return { verdict: 'refused' }
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(ownerHex, 'hex')])
  try {
    const preimage = prefixEra
      ? `${PREFIX_CONFIRMATION_DOMAIN}\n${keys.map(key => `${key}=${fields[key]}`).join('\n')}`
      : confirmationPreimage(fields)
    const ok = edVerify(null, Buffer.from(preimage, 'utf8'), createPublicKey({ key: spki, format: 'der', type: 'spki' }), signature)
    if (!ok) return { verdict: 'refused' }

    // THE DOCUMENT IS GENUINE. ONLY NOW IS IT WORTH ASKING WHAT IT IS ABOUT, because until the
    // signature verified the two questions could not be told apart: the comparison used to run FIRST,
    // so a confirmation over superseded digits was refused before its signature was ever examined, and
    // "somebody forged this" and "this is real and about a key we no longer use" came out the same word.
    //
    // ANOTHER NPUB IS A DIFFERENT PERSON'S COMPARISON and stays a refusal — it is not about this
    // contact at all. THE SAME NPUB WITH A DIFFERENT CONTROLLER KEY OR DIFFERENT DIGITS IS *STALE*: the
    // owner really did confirm something, and the binding has moved since. The row goes back to BOUND,
    // which is what "nobody has confirmed THIS key" means, rather than FOREIGN, which would call a
    // genuine signature a forgery.
    if (expectation.npub === undefined || fields.npub !== expectation.npub) return { verdict: 'refused' }
    if (expectation.subject !== undefined && fields.subject !== expectation.subject) return { verdict: 'stale' }
    // A genuine legacy record may remain on disk, but six digits can never confer VERIFIED.
    if (legacy) return { verdict: 'stale', reason: 'contact:legacy-sas' }
    // Authentic old approvals only enforced two fixed prefixes. They cannot authorize the full-value protocol.
    if (prefixEra) return { verdict: 'stale', reason: 'contact:comparison-upgrade-required' }
    if (expectation.safetyVersion !== NOSTR_SAFETY_VERSION) return { verdict: 'stale', reason: 'contact:safety-version-mismatch' }
    if (expectation.controllerKeyHex === null || fields.controllerKeyHex !== expectation.controllerKeyHex) {
      return { verdict: 'stale' }
    }
    if (expectation.sasDigits === null || fields.sasDigits !== expectation.sasDigits) return { verdict: 'stale' }
    return { verdict: 'verified' }
  } catch { return { verdict: 'refused' } }
}
