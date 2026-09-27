/**
 * The public identity/control projection — the whole of what this adapter exports.
 *
 * THE QUESTION THIS ANSWER ANSWERS. KIRA's memory records carry a `subject`
 * string; the host needs to render which identity it is talking to; the broker
 * needs to decide whether a persisted control head still matches what a launch
 * pinned. All three need the same four facts and none of them needs the private
 * half of the controller. This module is the seam: one function in (a genesis
 * record, an active control head, a declared custody class), one frozen record
 * out, and the record contains exactly the fields listed in
 * {@link PUBLIC_CONTROL_FIELDS} and nothing else.
 *
 * WHAT IS DELIBERATELY KEPT DISTINCT, because collapsing any two of them is how an
 * identity claim silently becomes an authority claim:
 *
 *   subject            `aukora:1:<sha256>` over the IMMUTABLE genesis. Derived
 *                      from genesis in this module, never from the head, and then
 *                      asserted equal to the head's own claim. A root-key
 *                      rotation cannot move it — that is the property "key
 *                      rotation must not silently change the Kira subject"
 *                      depends on, and it is structural here, not a convention.
 *   epoch              which control head is active. Increments on rotation.
 *   activeControlDigest  the digest of that exact head. Changes on rotation AND
 *                      on revocation.
 *   revoked            terminal state of the active head, carried as its own
 *                      boolean. A revoked subject still HAS a subject; what it
 *                      does not have is an admission.
 *   approvalKeyDid     `did:key` of the Ed25519 approval key registered in the
 *                      active head. Changes on rotation.
 *   custodyClass       the declared custody ceiling, which travels with the
 *                      projection so a consumer cannot read it without also being
 *                      able to read the limit.
 *
 * WHY admission IS SEPARATE FROM projection. {@link projectPublicControl} is a
 * derivation: it says these bytes name this identity. {@link admitPublicControl}
 * is the check-at-use: it compares a projection against a launch-pinned
 * expectation and against the key that claims to act, and refuses by name. Nothing
 * in either function returns authority — admission's success value is the identity
 * facts again, because "the identity is still the one that was pinned" is a
 * statement about continuity, not a permission.
 *
 * @module @aukora/dsh-plugin-aumlok/projection
 */
import { createHash } from 'node:crypto'
import { canonicalJSON } from './canonical.mjs'
import { identityControlDigest, parseIdentityControlState } from './control.mjs'
import { didKeyFromEd25519PublicKey, didKeyFromPublicKeyPem, ed25519PublicKeyFromDidKey } from './did-key.mjs'
import { aukoraIdFromGenesis, parseIdentityGenesis } from './genesis.mjs'
import { readAukoraId, readClosedDataRecord, readDigest, readNonNegativeInteger } from './validation.mjs'

/** Domain of one serialized public projection. */
export const PUBLIC_CONTROL_DOMAIN = 'aukora:aumlok-public-control:v1'

/**
 * The exact fields a consumer receives, in this order. The court asserts that a
 * produced projection's own keys are exactly this list.
 */
export const PUBLIC_CONTROL_FIELDS = Object.freeze([
  'domain',
  'subject',
  'epoch',
  'activeControlDigest',
  'revoked',
  'approvalKeyDid',
  'custodyClass',
])

/**
 * Deep's custody class string, carried verbatim so a Deep-format record and this
 * projection agree on the word. The class names what was checked: POSIX owner,
 * mode and link count on the same UID. It does not name isolation.
 */
export const LOCAL_AUMLOK_CUSTODY_CLASS = 'same-uid-posix-mode-only'

/** Stable refusal codes for projection and admission. */
export const AUMLOK_PROJECT_REFUSE = Object.freeze({
  MALFORMED: 'aumlok:control-malformed',
  GENESIS_SUBJECT_MISMATCH: 'aumlok:genesis-subject-mismatch',
  GENESIS_KEY_SET_MISMATCH: 'aumlok:genesis-key-set-mismatch',
  CUSTODY_CLASS_UNRECOGNIZED: 'aumlok:custody-class-unrecognized',
})

/** Stable refusal codes for check-at-use admission. Mirrors Deep's admission vocabulary. */
export const AUMLOK_ADMIT_REFUSE = Object.freeze({
  UNBOUND: 'aumlok:control-unbound',
  MALFORMED: 'aumlok:control-malformed',
  EXPECTATION_MALFORMED: 'aumlok:expectation-malformed',
  SUBJECT_MISMATCH: 'aumlok:control-subject-mismatch',
  DIGEST_MISMATCH: 'aumlok:control-digest-mismatch',
  EPOCH_MISMATCH: 'aumlok:control-epoch-mismatch',
  REVOKED: 'aumlok:control-revoked',
  SIGNER_MISMATCH: 'aumlok:control-signer-mismatch',
})

/** A control pair that cannot be projected, carrying one stable refusal code. */
export class AumlokProjectionError extends Error {
  /**
   * @param {string} code - one {@link AUMLOK_PROJECT_REFUSE} value.
   * @param {string} detail - the observed defect.
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'AumlokProjectionError'
    this.code = code
  }
}

/**
 * Project one control pair into the public fields a consumer needs.
 *
 * Input is the PUBLIC half of a controller only. The private half — Deep's
 * `ed25519PrivateKeyPem` and `mlDsa65SecretKeyHex` — is never read here, never
 * copied, and cannot appear in the result: the result is built field by field from
 * validated values, so there is no spread of the input and no place for an extra
 * field to travel.
 *
 * @param {unknown} control - `{genesis, activeControl, custodyClass}`.
 * @param {{capabilities?: import('./control.mjs').AumlokVerifierCapabilities}} [options] - optional point validator.
 * @returns {Readonly<Record<string, unknown>>} frozen projection of exactly {@link PUBLIC_CONTROL_FIELDS}.
 */
export function projectPublicControl(control, options = {}) {
  const fields = readControlPair(control)
  const genesis = fields.genesis
  const activeControl = parseIdentityControlStateSafe(fields.activeControl, options.capabilities)
  const subject = aukoraIdFromGenesis(genesis)
  if (activeControl.subject !== subject) {
    throw new AumlokProjectionError(
      AUMLOK_PROJECT_REFUSE.GENESIS_SUBJECT_MISMATCH,
      `the active control head names ${activeControl.subject}; its genesis derives ${subject}`,
    )
  }
  if (activeControl.epoch === 0 && activeControl.rootKeySetId !== genesis.initialRootKeySetId) {
    throw new AumlokProjectionError(
      AUMLOK_PROJECT_REFUSE.GENESIS_KEY_SET_MISMATCH,
      'the epoch-zero control head does not use the key set the genesis committed to',
    )
  }
  if (fields.custodyClass !== LOCAL_AUMLOK_CUSTODY_CLASS) {
    throw new AumlokProjectionError(
      AUMLOK_PROJECT_REFUSE.CUSTODY_CLASS_UNRECOGNIZED,
      `custodyClass must equal ${LOCAL_AUMLOK_CUSTODY_CLASS}`,
    )
  }
  return Object.freeze({
    domain: PUBLIC_CONTROL_DOMAIN,
    // Derived from genesis, asserted equal to the head's claim above. A rotation
    // changes the head and cannot change this line.
    subject,
    epoch: activeControl.epoch,
    activeControlDigest: identityControlDigest(activeControl, options.capabilities),
    revoked: activeControl.revoked,
    approvalKeyDid: didKeyFromEd25519PublicKey(activeControl.publicKeys.ed25519),
    custodyClass: fields.custodyClass,
  })
}

/**
 * Parse one serialized projection back into its exact fields.
 * @param {unknown} input - candidate projection.
 * @returns {Readonly<Record<string, unknown>>} detached frozen projection.
 */
export function parsePublicControl(input) {
  // The closure violation is normalized into this module's own error type, so a
  // caller sees one refusal vocabulary for every way a projection can be wrong.
  // `admitPublicControl` depends on that: it must report `aumlok:control-malformed`
  // for an extra field exactly as it does for a bad digest.
  let fields
  try {
    fields = readClosedDataRecord(input, PUBLIC_CONTROL_FIELDS, 'aumlok public control')
  } catch (cause) {
    throw new AumlokProjectionError(
      AUMLOK_PROJECT_REFUSE.MALFORMED,
      cause instanceof Error ? cause.message : String(cause),
    )
  }
  if (fields.domain !== PUBLIC_CONTROL_DOMAIN) {
    throw new AumlokProjectionError(
      AUMLOK_PROJECT_REFUSE.MALFORMED,
      `domain must equal ${PUBLIC_CONTROL_DOMAIN}`,
    )
  }
  if (typeof fields.revoked !== 'boolean') {
    throw new AumlokProjectionError(AUMLOK_PROJECT_REFUSE.MALFORMED, 'revoked must be a boolean')
  }
  let subject
  let activeControlDigest
  let epoch
  let approvalKeyDid
  try {
    subject = readAukoraId(fields.subject, 'aumlok public control.subject')
    activeControlDigest = readDigest(fields.activeControlDigest, 'aumlok public control.activeControlDigest')
    epoch = readNonNegativeInteger(fields.epoch, 'aumlok public control.epoch')
    // Round-tripping the DID through its key proves the field names a real key
    // rather than a string that merely starts with `did:key:`.
    approvalKeyDid = didKeyFromEd25519PublicKey(ed25519PublicKeyFromDidKey(fields.approvalKeyDid))
  } catch (cause) {
    throw new AumlokProjectionError(
      AUMLOK_PROJECT_REFUSE.MALFORMED,
      cause instanceof Error ? cause.message : String(cause),
    )
  }
  if (fields.custodyClass !== LOCAL_AUMLOK_CUSTODY_CLASS) {
    throw new AumlokProjectionError(
      AUMLOK_PROJECT_REFUSE.CUSTODY_CLASS_UNRECOGNIZED,
      `custodyClass must equal ${LOCAL_AUMLOK_CUSTODY_CLASS}`,
    )
  }
  return Object.freeze({
    domain: PUBLIC_CONTROL_DOMAIN,
    subject,
    epoch,
    activeControlDigest,
    revoked: fields.revoked,
    approvalKeyDid,
    custodyClass: fields.custodyClass,
  })
}

/**
 * Admit one projection at the point of use against a pinned expectation.
 *
 * Mirrors Deep `aukora/identity/broker-state.mjs` `admitIdentityControl`: re-read
 * the facts at every check so an absent, replaced, revoked or differently
 * controlled identity cannot inherit a launch-pinned delegation. The one addition
 * is D1's rule — the DID is re-derived from the key whose signature is being
 * relied on, so an owner field that merely MATCHES a string is not enough.
 *
 * Never throws: a refusal is an expected outcome here, so it is a returned verdict
 * with a stable name.
 *
 * @param {object} facts - the projection, the pinned expectation, and the claiming key.
 * @param {unknown} facts.projection - result of {@link projectPublicControl}, or null when unavailable.
 * @param {unknown} facts.expected - `{subject, activeControlDigest, epoch?}` pinned earlier.
 * @param {unknown} [facts.signerPublicKeyPem] - PEM of the Ed25519 key claiming to act.
 * @returns {Readonly<{ok: true, subject: string, epoch: number, activeControlDigest: string, approvalKeyDid: string} | {ok: false, reason: string, detail: string}>} verdict.
 */
export function admitPublicControl({ projection, expected, signerPublicKeyPem }) {
  if (projection === null || projection === undefined) {
    return refuse(AUMLOK_ADMIT_REFUSE.UNBOUND, 'no active AUKORA public control projection is available')
  }
  let current
  try {
    current = parsePublicControl(projection)
  } catch (cause) {
    return refuse(AUMLOK_ADMIT_REFUSE.MALFORMED, cause instanceof Error ? cause.message : String(cause))
  }
  let pinned
  try {
    // The expectation is closed too: `epoch` is either absent or present, and a
    // caller cannot smuggle an extra field in beside the two that are compared.
    const settled = expected !== null && typeof expected === 'object' && Object.hasOwn(expected, 'epoch')
    const fields = readClosedDataRecord(
      expected,
      settled ? ['subject', 'activeControlDigest', 'epoch'] : ['subject', 'activeControlDigest'],
      'aumlok expectation',
    )
    pinned = {
      subject: readAukoraId(fields.subject, 'aumlok expectation.subject'),
      activeControlDigest: readDigest(fields.activeControlDigest, 'aumlok expectation.activeControlDigest'),
      epoch: settled ? readNonNegativeInteger(fields.epoch, 'aumlok expectation.epoch') : undefined,
    }
  } catch (cause) {
    return refuse(
      AUMLOK_ADMIT_REFUSE.EXPECTATION_MALFORMED,
      cause instanceof Error ? cause.message : String(cause),
    )
  }
  if (current.subject !== pinned.subject) {
    return refuse(AUMLOK_ADMIT_REFUSE.SUBJECT_MISMATCH, `the active projection names ${current.subject}`)
  }
  if (current.activeControlDigest !== pinned.activeControlDigest) {
    return refuse(
      AUMLOK_ADMIT_REFUSE.DIGEST_MISMATCH,
      `the active control digest is ${current.activeControlDigest}`,
    )
  }
  if (pinned.epoch !== undefined && current.epoch !== pinned.epoch) {
    return refuse(AUMLOK_ADMIT_REFUSE.EPOCH_MISMATCH, `the active control epoch is ${String(current.epoch)}`)
  }
  if (current.revoked) {
    return refuse(AUMLOK_ADMIT_REFUSE.REVOKED, 'the active control head is terminally revoked')
  }
  if (signerPublicKeyPem !== undefined) {
    let signerDid
    try {
      signerDid = didKeyFromPublicKeyPem(signerPublicKeyPem)
    } catch (cause) {
      return refuse(
        AUMLOK_ADMIT_REFUSE.SIGNER_MISMATCH,
        `the claiming key is not a usable Ed25519 public key: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
    if (signerDid !== current.approvalKeyDid) {
      return refuse(
        AUMLOK_ADMIT_REFUSE.SIGNER_MISMATCH,
        `the claiming key derives ${signerDid}, not the registered ${current.approvalKeyDid}`,
      )
    }
  }
  return Object.freeze({
    ok: true,
    subject: current.subject,
    epoch: current.epoch,
    activeControlDigest: current.activeControlDigest,
    approvalKeyDid: current.approvalKeyDid,
  })
}

/**
 * Digest one projection, so a consumer can pin what it admitted.
 * @param {unknown} input - candidate projection.
 * @returns {string} lowercase SHA-256 over the canonical projection.
 */
export function publicControlDigest(input) {
  return createHash('sha256')
    .update('aukora:aumlok-public-control-digest:v1', 'utf8')
    .update('\0', 'utf8')
    .update(canonicalJSON(parsePublicControl(input)), 'utf8')
    .digest('hex')
}

/** One named admission refusal. */
function refuse(reason, detail) {
  return Object.freeze({ ok: false, reason, detail })
}

/** Read the control pair, requiring exactly the three public inputs. */
function readControlPair(control) {
  let fields
  try {
    fields = readClosedDataRecord(control, ['genesis', 'activeControl', 'custodyClass'], 'aumlok control')
  } catch (cause) {
    throw new AumlokProjectionError(
      AUMLOK_PROJECT_REFUSE.MALFORMED,
      cause instanceof Error ? cause.message : String(cause),
    )
  }
  try {
    return Object.freeze({
      genesis: parseIdentityGenesis(fields.genesis),
      activeControl: fields.activeControl,
      custodyClass: fields.custodyClass,
    })
  } catch (cause) {
    throw new AumlokProjectionError(
      AUMLOK_PROJECT_REFUSE.MALFORMED,
      cause instanceof Error ? cause.message : String(cause),
    )
  }
}

/** Parse one control head, reporting a malformed head as a projection refusal. */
function parseIdentityControlStateSafe(input, capabilities) {
  try {
    return parseIdentityControlState(input, capabilities)
  } catch (cause) {
    throw new AumlokProjectionError(
      AUMLOK_PROJECT_REFUSE.MALFORMED,
      cause instanceof Error ? cause.message : String(cause),
    )
  }
}
