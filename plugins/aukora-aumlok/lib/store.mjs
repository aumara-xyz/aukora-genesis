/**
 * Read-only access to a Deep-format local AUMLOK controller.
 *
 * WHAT THIS IS. A reader for the on-disk record Deep writes at
 * `<directory>/local-control.json` (`aukora:local-aumlok-control:v1`), reduced to
 * the PUBLIC half. It exists so the host and KIRA can identify a subject from the
 * same file the real controller uses, instead of a second store this lane would
 * have to keep in step.
 *
 * WHAT THIS DELIBERATELY IS NOT. There is no create, no write, no rotation and no
 * key generation in this module. Provisioning a controller is a custody act; this
 * lane may not perform one, so the only way a controller comes into existence is
 * Deep's own writer. The court builds disposable identities with
 * `scripts/aumlok/make-disposable-identity.mjs`, which is labelled test-only and
 * refuses a destination that is not a fresh private directory.
 *
 * WHAT {@link loadLocalAumlokPublicControl} NEVER RETURNS. The record's
 * `ed25519PrivateKeyPem` and `mlDsa65SecretKeyHex` fields are required to be
 * present (the field set is closed, so their absence is a different record shape,
 * not a smaller one) and are never decoded, never validated for correspondence
 * with the public keys, and never copied into anything that function returns.
 *
 * ONE NAMED EXCEPTION, AND WHY IT IS HERE RATHER THAN SOMEWHERE ELSE.
 * {@link readLocalAumlokFullRecord} returns the private half, for exactly one
 * purpose: `lib/identity-correspondence.mjs` proves that the stored secret halves
 * correspond to the public keys the record registers. That is custody work, and it
 * is measured — a correspondence check reads private key material, which is itself
 * a same-uid custody act, not isolation. The alternative was a second copy of this
 * module's filesystem and POSIX checks living beside it, which is how two readers
 * of one custody class drift apart. So there is exactly ONE custody read in this
 * file, both entry points go through it, and only one of them hands the private
 * fields onward.
 *
 * THE POSIX CHECKS ARE THE CUSTODY CLASS. `same-uid-posix-mode-only` is a claim
 * about what was measured, so it is measured: the directory must be a real
 * directory, not a symlink, owned by this euid, mode 0700; the record must be a
 * regular file, not a symlink, owned by this euid, mode 0600, with link count 1
 * and a bounded size. ACLs are NOT measured, and the reader shares the UID with
 * every other process of this user, so this is a mode check and not isolation.
 *
 * @module @aukora/dsh-plugin-aumlok/store
 */
import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { canonicalJSON } from './canonical.mjs'
import { parseIdentityControlState } from './control.mjs'
import { LOCAL_AUMLOK_CUSTODY_CLASS, projectPublicControl } from './projection.mjs'
import { readAukoraId, readClosedDataRecord, readDigest } from './validation.mjs'
import {
  RootCustodyError,
  isRecordV3,
  projectRecordV3Control,
} from './record-v3.mjs'

/** On-disk domain of a Deep local-development controller. */
export const LOCAL_AUMLOK_CONTROL_DOMAIN = 'aukora:local-aumlok-control:v1'
/** Versioned amendment policy retained beside the immutable genesis commitment. */
export const LOCAL_AUMLOK_AMENDMENT_POLICY_DOMAIN = 'aukora:local-aumlok-amendment-policy:v1'
/** The only amendment policy this lane understands. */
export const LOCAL_AUMLOK_AMENDMENT_POLICY = Object.freeze({
  domain: LOCAL_AUMLOK_AMENDMENT_POLICY_DOMAIN,
  rootControl: 'active-hybrid-root-dual-signature',
  recovery: 'disabled',
})
/** Fixed filename inside one caller-selected private directory. */
export const LOCAL_AUMLOK_CONTROL_FILENAME = 'local-control.json'

/** Named local-controller refusals, unchanged from Deep so a code means one thing. */
export const LOCAL_AUMLOK_CONTROL_REFUSE = Object.freeze({
  /**
   * A v2 record was asked for its private half. v2 holds wraps, not a seed, and opening them is
   * `owner-record.mjs`'s job — with the phrase and a factor secret, which this reader does not take.
   */
  NO_PRIVATE_HALF: 'aumlok-local:no-private-half-in-v2',
  DIRECTORY_MALFORMED: 'aumlok-local:directory-malformed',
  ENTRY_MALFORMED: 'aumlok-local:entry-malformed',
  EXPECTATION_MALFORMED: 'aumlok-local:expectation-malformed',
  /**
   * A caller supplied a machine key that is not 64 hex. The key is a PUBLIC value the caller already
   * holds — the shell reads it from `machine-seed-v3.json` — so a malformed one is a caller error and
   * is named as one rather than blamed on the record.
   */
  MACHINE_KEY_MALFORMED: 'aumlok-local:machine-key-malformed',
  IDENTITY_CHANGED: 'aumlok-local:identity-changed',
  POSIX_REQUIRED: 'aumlok-local:posix-required',
  /**
   * THERE IS NOTHING HERE TO READ — which is not the same fact as something being wrong here.
   *
   * An empty or unset directory, and a private directory holding no record at all, mean nobody has
   * bound yet: the next step is the ceremony, not an investigation. Both used to arrive as
   * `directory-malformed` or `entry-malformed`, so the owner of a directory nobody had bound was told
   * to look for damage. The face names this code `controller-absent` and shows UNBOUND (U1,
   * 2026-09-23); it is emitted HERE and nowhere else, and this constant was declared and unused until
   * this round — which is why the face's mapping had nothing to map.
   */
  UNAVAILABLE: 'aumlok-local:unavailable',
})

const RECORD_FIELDS = Object.freeze([
  'domain',
  'custodyClass',
  'amendmentPolicy',
  'genesis',
  'activeControl',
  'ed25519PrivateKeyPem',
  'mlDsa65SecretKeyHex',
])
const AMENDMENT_POLICY_FIELDS = Object.freeze(['domain', 'rootControl', 'recovery'])
const GENESIS_FIELDS = Object.freeze(['domain', 'genesisNonce', 'initialRootKeySetId', 'amendmentRuleDigest'])
const EXPECTATION_FIELDS = Object.freeze(['subject', 'activeControlDigest'])
const AMENDMENT_RULE_DIGEST_DOMAIN = 'aukora:local-aumlok-amendment-rule-digest:v1'
const MAX_RECORD_BYTES = 32 * 1024

/** Error carrying one stable local-controller refusal code. */
export class LocalAumlokControlError extends Error {
  /**
   * @param {string} code - one {@link LOCAL_AUMLOK_CONTROL_REFUSE} value, or a named `aumlok:` refusal.
   * @param {unknown} [cause] - underlying filesystem or validation failure.
   * @param {string} [detail] - the sentence a caller reads, when the code alone is not the answer.
   */
  constructor(code, cause, detail) {
    // `message` IS THE CODE ALONE UNLESS A DETAIL IS GIVEN, which is what every existing throw site
    // passes and therefore what no existing caller's output changes. `detail` exists for ONE case: a
    // refusal from a layer below this one that already carries its own `aumlok:` name AND an
    // explanation a person needs — the multi-machine one, whose whole point is that it names the tool
    // that can answer. Flattening that into a bare code would keep the name and lose the answer.
    super(detail === undefined ? code : `${code}: ${detail}`, cause === undefined ? undefined : { cause })
    this.name = 'LocalAumlokControlError'
    this.code = code
  }
}

/** Refuse with one named local-controller code. */
function fail(code, cause) {
  throw new LocalAumlokControlError(code, cause)
}

/** Require a POSIX euid, because the custody class names a POSIX measurement. */
function requirePosixOwner() {
  if (typeof process.geteuid !== 'function') fail(LOCAL_AUMLOK_CONTROL_REFUSE.POSIX_REQUIRED)
  return process.geteuid()
}

/**
 * Derive the immutable identity-genesis commitment for one supported policy.
 *
 * The genesis record commits to this digest. Re-deriving it from the policy on
 * disk is what ties the stored policy to the stored genesis: a record whose policy
 * was edited no longer reproduces its own commitment.
 * @param {unknown} policyInput - closed versioned amendment policy.
 * @returns {string} lowercase SHA-256 commitment.
 */
export function localAumlokAmendmentRuleDigest(policyInput) {
  const policy = parseAmendmentPolicy(policyInput)
  return createHash('sha256')
    .update(AMENDMENT_RULE_DIGEST_DOMAIN)
    .update('\0')
    .update(canonicalJSON(policy))
    .digest('hex')
}

/** Validate the versioned amendment policy against the only supported one. */
function parseAmendmentPolicy(value) {
  const fields = readClosedDataRecord(value, AMENDMENT_POLICY_FIELDS, 'local AUMLOK amendment policy')
  if (fields.domain !== LOCAL_AUMLOK_AMENDMENT_POLICY.domain
    || fields.rootControl !== LOCAL_AUMLOK_AMENDMENT_POLICY.rootControl
    || fields.recovery !== LOCAL_AUMLOK_AMENDMENT_POLICY.recovery) {
    throw new TypeError('local AUMLOK amendment policy: unsupported policy')
  }
  return LOCAL_AUMLOK_AMENDMENT_POLICY
}

/** Validate an optional subject/control pin. */
function parseExpectation(value) {
  if (value === undefined) return undefined
  try {
    const fields = readClosedDataRecord(value, EXPECTATION_FIELDS, 'local AUMLOK expectation')
    return Object.freeze({
      subject: readAukoraId(fields.subject, 'local AUMLOK expectation.subject'),
      activeControlDigest: readDigest(fields.activeControlDigest, 'local AUMLOK expectation.activeControlDigest'),
    })
  } catch (error) {
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.EXPECTATION_MALFORMED, error)
  }
}

/** Validate and open one private controller directory. */
function ensurePrivateDirectory(input) {
  // NOTHING NAMED IS NOT SOMETHING MALFORMED. An empty or unset path is a mount with no directory to
  // read — nobody has bound here — and it is reported as that absence. A path that NAMES something
  // which is not a private directory (absent, a file, a symlink, another uid, a mode that is not
  // 0700) is still malformed, below, by name.
  if (typeof input !== 'string' || input.length === 0) {
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.UNAVAILABLE)
  }
  const directory = resolve(input)
  const euid = requirePosixOwner()
  try {
    const state = lstatSync(directory)
    if (!state.isDirectory()
      || state.isSymbolicLink()
      || state.uid !== euid
      || (state.mode & 0o777) !== 0o700) {
      fail(LOCAL_AUMLOK_CONTROL_REFUSE.DIRECTORY_MALFORMED)
    }
  } catch (error) {
    if (error instanceof LocalAumlokControlError) throw error
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.DIRECTORY_MALFORMED, error)
  }
  return directory
}

/** Assert one private regular-file state. */
function assertPrivateRecordState(state, euid) {
  if (!state.isFile()
    || state.uid !== BigInt(euid)
    || (state.mode & 0o777n) !== 0o600n
    || state.nlink !== 1n
    || state.size <= 0n
    || state.size > BigInt(MAX_RECORD_BYTES)) {
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED)
  }
}

/** Compare two bigint stat records field by field. */
function sameRecordState(first, second) {
  return first.dev === second.dev
    && first.ino === second.ino
    && first.uid === second.uid
    && first.mode === second.mode
    && first.nlink === second.nlink
    && first.size === second.size
    && first.mtimeNs === second.mtimeNs
    && first.ctimeNs === second.ctimeNs
}

/** Read at most MAX_RECORD_BYTES + 1 and refuse anything longer. */
function readBoundedRecord(descriptor) {
  const chunks = []
  let byteLength = 0
  while (true) {
    const remaining = MAX_RECORD_BYTES + 1 - byteLength
    const chunk = Buffer.allocUnsafe(Math.min(4096, remaining))
    const count = readSync(descriptor, chunk, 0, chunk.length, null)
    if (count === 0) break
    byteLength += count
    if (byteLength > MAX_RECORD_BYTES) fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED)
    chunks.push(chunk.subarray(0, count))
  }
  return Buffer.concat(chunks, byteLength).toString('utf8')
}

/**
 * Parse one Deep-format local controller record down to its public half.
 *
 * Returns `{genesis, activeControl, custodyClass}` — the exact input
 * {@link projectPublicControl} takes — and nothing else. The private fields are
 * checked for presence and type only.
 * @param {unknown} value - candidate parsed record.
 * @returns {Readonly<{genesis: unknown, activeControl: unknown, custodyClass: string}>} public half.
 */
export function parseLocalAumlokPublicHalf(value) {
  const fields = readClosedDataRecord(value, RECORD_FIELDS, 'local AUMLOK control')
  if (fields.domain !== LOCAL_AUMLOK_CONTROL_DOMAIN) {
    throw new TypeError(`local AUMLOK control.domain: must be ${LOCAL_AUMLOK_CONTROL_DOMAIN}`)
  }
  if (fields.custodyClass !== LOCAL_AUMLOK_CUSTODY_CLASS) {
    throw new TypeError(`local AUMLOK control.custodyClass: must be ${LOCAL_AUMLOK_CUSTODY_CLASS}`)
  }
  if (typeof fields.ed25519PrivateKeyPem !== 'string' || typeof fields.mlDsa65SecretKeyHex !== 'string') {
    throw new TypeError('local AUMLOK control: private fields must be present as strings')
  }
  // Present-and-typed only. Neither value is read, decoded, compared or returned.
  const amendmentPolicy = parseAmendmentPolicy(fields.amendmentPolicy)
  return Object.freeze({
    genesis: fields.genesis,
    activeControl: fields.activeControl,
    custodyClass: LOCAL_AUMLOK_CUSTODY_CLASS,
    amendmentRuleDigest: localAumlokAmendmentRuleDigest(amendmentPolicy),
  })
}

/** Return the fixed controller file inside a validated private directory. */
export function localAumlokControlPath(directoryInput) {
  return join(resolve(directoryInput), LOCAL_AUMLOK_CONTROL_FILENAME)
}

/**
 * Read one controller record's exact bytes under the custody class this module measures.
 *
 * The ONE filesystem read in this module. `loadLocalAumlokPublicControl` and
 * `readLocalAumlokFullRecord` both go through it, so the POSIX measurement that
 * backs `same-uid-posix-mode-only` exists once and cannot drift between them.
 * @param {string} directoryInput - private controller directory.
 * @returns {{path: string, parsed: unknown}} the record path and its parsed value.
 */
function readLocalAumlokRecordRaw(directoryInput) {
  const directory = ensurePrivateDirectory(directoryInput)
  const path = localAumlokControlPath(directory)
  const euid = requirePosixOwner()
  let descriptor
  let raw
  try {
    const before = lstatSync(path, { bigint: true })
    assertPrivateRecordState(before, euid)
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(descriptor, { bigint: true })
    assertPrivateRecordState(opened, euid)
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED)
    }
    raw = readBoundedRecord(descriptor)
    const after = fstatSync(descriptor, { bigint: true })
    assertPrivateRecordState(after, euid)
    if (!sameRecordState(opened, after)) fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED)
  } catch (error) {
    if (error instanceof LocalAumlokControlError) throw error
    // NO RECORD IS NOT A BROKEN RECORD. A private directory that holds no `local-control.json` is a
    // directory nobody has bound in — the live shape of this machine's own controller directory before
    // Peter's first bind — and it is reported as that absence. Everything else that goes wrong while
    // reading a record that IS there stays `entry-malformed`, by name.
    if (/** @type {{code?: unknown} | undefined} */ (error)?.code === 'ENOENT') {
      fail(LOCAL_AUMLOK_CONTROL_REFUSE.UNAVAILABLE, error)
    }
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED, error)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  if (!raw.endsWith('\n') || raw.slice(0, -1).includes('\n')) {
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED, error)
  }
  return { path, parsed }
}

/**
 * Parse one record and project its public half, performing every check that ties
 * the head to its immutable genesis.
 * @param {unknown} parsed - one parsed controller record.
 * @param {string|null} [machinePublicKeyHex] - which machine this read is from, when the caller knows.
 * @returns {Readonly<Record<string, unknown>>} the public projection.
 */
function projectParsedRecord(parsed, machinePublicKeyHex = null) {
  try {
    // THE DISPATCH IS ON THE RECORD'S OWN DOMAIN, not on which fields happen to be present. A v1
    // record and a v2 record are two NAMED formats, and guessing between them by shape would mean a
    // v1 record missing one field is silently read as a v2 one, or the reverse. The domain is the
    // record's own statement about which reader it wants, so it is asked.
    //
    // v2 (plan §2) holds a full-strength public root and two WRAPS and no private half at all, so it
    // projects through its own reader rather than through `parseLocalAumlokPublicHalf`, which
    // requires the two private fields a v2 record deliberately does not have.
    //
    // A v3 RECORD PROJECTS AS A CONTROL, AND THAT IS THE FIX THIS READER NEEDS (MEASURED).
    // `recordProjection` is the RECORD's view — the published keys, the binding moment, the genesis —
    // and it carries neither `activeControlDigest` nor `approvalKeyDid`. Handing it back from a
    // function whose callers pin a subject and a control digest is what refused every v3 controller
    // `aumlok-local:expectation-malformed` BEFORE the signer socket was dialled:
    // `approveOperation` builds its pin off the projection it loads, the digest field is not there,
    // and `parseExpectation` refuses the pin. `projectRecordV3Control` is the other projection, the
    // one the admission machinery reads, and the key it names comes from the RECORD — see the note
    // where `keptMachinePublicKeyHex` used to be, for why this public path no longer opens a seed.
    if (isRecordV3(parsed)) {
      return projectRecordV3Control({ record: parsed, machinePublicKeyHex })
    }
    const publicHalf = parseLocalAumlokPublicHalf(parsed)
    // The genesis record commits to a digest of the amendment policy. Re-deriving
    // that digest from the policy stored beside it is what ties the two together:
    // a record whose policy was edited no longer reproduces its own commitment,
    // and D4 requires the succession policy be fixed at genesis rather than
    // renegotiated in place.
    const genesisFields = readClosedDataRecord(
      publicHalf.genesis,
      GENESIS_FIELDS,
      'local AUMLOK control.genesis',
    )
    if (genesisFields.amendmentRuleDigest !== publicHalf.amendmentRuleDigest) {
      throw new TypeError('local AUMLOK control: amendment policy commitment mismatch')
    }
    return projectPublicControl({
      genesis: publicHalf.genesis,
      activeControl: publicHalf.activeControl,
      custodyClass: publicHalf.custodyClass,
    })
  } catch (error) {
    if (error instanceof LocalAumlokControlError) throw error
    // A NAMED REFUSAL FROM THE v3 READER TRAVELS BY ITS OWN NAME. `projectRecordV3Control` refuses a
    // record that lists several machines with `aumlok:record-names-no-machine` and a message naming the
    // reader that CAN answer — and this catch used to replace both with `entry-malformed`, telling a
    // caller his record is broken when the truth is that this READER cannot name his machine. MEASURED
    // on a two-machine record before this branch existed: `PUBLIC_PATH refused | aumlok-local:entry-malformed`
    // with no sentence at all. `entry-malformed` remains the answer for a value that is genuinely
    // malformed, which is every other failure that reaches here.
    if (error instanceof RootCustodyError) {
      const named = /^(aumlok:[a-z0-9-]+):\s*([\s\S]+)$/u.exec(String(error.message))
      if (named !== null) throw new LocalAumlokControlError(named[1], error, named[2])
    }
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED, error)
  }
}

/** Validate an optional subject/control pin. */
function assertExpectationHolds(projection, expectation) {
  if (expectation !== undefined
    && (projection.subject !== expectation.subject
      || projection.activeControlDigest !== expectation.activeControlDigest)) {
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.IDENTITY_CHANGED)
  }
}

/**
 * THE SEED READER THAT USED TO STAND HERE IS DELETED, AND ITS DELETION IS THE FIX (Peter, 2026-09-24).
 *
 * `keptMachinePublicKeyHex` opened `machine-seed-v3.json` — a 0600 PRIVATE file holding the machine
 * seed — inside `loadLocalAumlokPublicControl`, whose whole contract is that it answers with the PUBLIC
 * half and that consumers need nothing else. A public read that opens a private file is the wrong shape
 * for an adapter whose claim is that the public half suffices, and it made a public projection FAIL on
 * a machine whose seed file was corrupt: the read was attempted whenever the file existed, so a
 * malformed seed turned a readable record into `entry-malformed`.
 *
 * WHAT REPLACES IT IS THE RECORD ITSELF. `projectRecordV3Control` takes the machine key from
 * `publicRoot.machines[]` when the caller passes none and the record lists exactly one — which is what
 * the ceremony writes and what a stranger with the public record can therefore reproduce. The
 * consequence is stated rather than hidden: a record listing MORE THAN ONE machine is refused
 * `aumlok:record-names-no-machine` on this public path, because which of them is "this" laptop is a
 * fact the record does not carry. That refusal is correct — naming one of several would be a guess
 * about which key signs — and the private reader that does know is the signer's, not this one.
 *
 * MEASURED (tests/aukora-v3-control-record.test.mjs, the two seed arms): a malformed seed file beside a
 * good record no longer affects the public read, and a seed holding a DIFFERENT key no longer changes
 * the `approvalKeyDid` a projection names. Before this deletion both arms were red.
 */

/**
 * Read and authenticate one existing local development controller's public half.
 *
 * WHAT IT ANSWERS WITH, AND WHY THE v3 SHAPE CHANGED. For a v1 control record this is
 * `projectPublicControl` — the seven-field projection `projection.mjs` defines. For a v3 record it is
 * now `projectRecordV3Control`, WHICH IS THE SAME SEVEN FIELDS, because a caller that pins a subject
 * and a control digest and admits what it read cannot do either against a record view that carries
 * neither. See `projectParsedRecord` for the measurement.
 * THE THIRD PARAMETER IS HOW A SECOND DEVICE WORKS, AND IT IS THE CALLER'S FACT TO SUPPLY. A record
 * listing several machines does not say which one is THIS laptop, so this reader cannot pick. A caller
 * that DOES know passes `machinePublicKeyHex` — the AUKORA shell reads it from `machine-seed-v3.json`
 * with `readKeptMachineSeed` — and the projection then names that machine. When no key is passed and the
 * record lists exactly one, that one answers; when none is passed and the record lists several or none,
 * the v3 reader refuses `aumlok:record-names-no-machine` by name.
 *
 * THIS READER STILL OPENS NO SEED FILE. The key arrives as a value, which is what keeps the public path
 * public: the file that holds the seed is opened by the process that already holds the private half, and
 * never here. A key that is not 64 hex is refused `aumlok-local:machine-key-malformed`, so a caller
 * cannot hand over a value this reader would have to interpret.
 * @param {string} directoryInput - private controller directory.
 * @param {unknown} [expectationInput] - optional exact subject and active-control pin.
 * @param {unknown} [machineInput] - 64 hex naming this machine, or null when the caller does not know.
 * @returns {Readonly<{projection: Readonly<Record<string, unknown>>, path: string, custodyClass: string}>} public projection and its source.
 */
export function loadLocalAumlokPublicControl(directoryInput, expectationInput, machineInput) {
  const expectation = parseExpectation(expectationInput)
  let machinePublicKeyHex = null
  if (machineInput !== undefined && machineInput !== null) {
    if (typeof machineInput !== 'string' || !/^[0-9a-f]{64}$/u.test(machineInput)) {
      fail(LOCAL_AUMLOK_CONTROL_REFUSE.MACHINE_KEY_MALFORMED, new TypeError(
        'a machine public key must be 64 lowercase hex, exactly as the record publishes it'))
    }
    machinePublicKeyHex = machineInput
  }
  const { path, parsed } = readLocalAumlokRecordRaw(directoryInput)
  const projection = projectParsedRecord(parsed, machinePublicKeyHex)
  assertExpectationHolds(projection, expectation)
  return Object.freeze({ projection, path, custodyClass: LOCAL_AUMLOK_CUSTODY_CLASS })
}

/**
 * Read one controller record INCLUDING its private half, for a correspondence check.
 *
 * The only function in this module that returns private material, and it is named so that a
 * reader can see that it is: `readLocalAumlokFullRecord` says what it does. It performs exactly
 * the checks {@link loadLocalAumlokPublicControl} performs — same directory mode, same record
 * mode, owner, link count, size bound, same genesis↔policy commitment, same projection — and adds
 * nothing that would relax them. What it does NOT do is establish that the returned private
 * fields correspond to the registered public keys: it only carries them. That proof belongs to
 * `lib/identity-correspondence.mjs`, which signs and verifies with them, and the ceiling
 * `SAME_UID_POSIX_MODE_ONLY` continues to say that reading these bytes is a same-uid act.
 * @param {string} directoryInput - private controller directory.
 * @param {unknown} [expectationInput] - optional exact subject and active-control pin.
 * @returns {Readonly<{path: string, projection: Readonly<Record<string, unknown>>, publicKeys: Readonly<{ed25519: string, mlDsa65: string}>, ed25519PrivateKeyPem: string, mlDsa65SecretKeyHex: string}>} projection, the registered public halves, and the private half.
 */
export function readLocalAumlokFullRecord(directoryInput, expectationInput) {
  const expectation = parseExpectation(expectationInput)
  const { path, parsed } = readLocalAumlokRecordRaw(directoryInput)
  // A V2 RECORD HAS NO PRIVATE HALF, AND THIS READER SAYS SO RATHER THAN RETURNING NOTHING. It holds
  // two WRAPS; the seeds come out of them only through `owner-record.mjs`'s two doors, with the
  // phrase and a factor secret. Returning `undefined` for the two fields below would hand a caller a
  // record that looks readable and a key that is not there — and a reader that cannot tell "no
  // private half" from "the private half is empty" is a reader that reports a wrong answer quietly.
  if (isRecordV3(parsed)) {
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.NO_PRIVATE_HALF)
  }
  const projection = projectParsedRecord(parsed)
  assertExpectationHolds(projection, expectation)
  const fields = readClosedDataRecord(parsed, RECORD_FIELDS, 'local AUMLOK control')
  // The registered public halves, taken from the SAME head `projectParsedRecord` just validated
  // and re-validated here through the exported parser, so this reader cannot disagree with the
  // projection about which keys the record registers.
  const head = parseIdentityControlState(/** @type {Record<string, unknown>} */ (fields.activeControl))
  // The private halves were checked for presence and type in `parseLocalAumlokPublicHalf`, which
  // `projectParsedRecord` ran. They are returned here and are NOT inspected, decoded or compared.
  return Object.freeze({
    path,
    projection,
    publicKeys: head.publicKeys,
    ed25519PrivateKeyPem: /** @type {string} */ (fields.ed25519PrivateKeyPem),
    mlDsa65SecretKeyHex: /** @type {string} */ (fields.mlDsa65SecretKeyHex),
  })
}
