/**
 * The uid gate: confinement as a measured, signed property, never a boolean
 * somebody set.
 *
 * WHAT PROBLEM THIS SOLVES. Before this module the broker never looked at the
 * directory it treats as its trust anchor. `mkdirSync(stateDir, {recursive:
 * true, mode: 0o700})` does NOT tighten a directory that already exists —
 * measured on darwin 25.1: a pre-existing 0777 state directory stays 0777 and
 * the broker booted and served from it without a word. Every receipt it minted
 * was silently readable as boundary-backed evidence when no boundary existed.
 *
 * THE FIELD IS A DEMOTION MARKER, NOT AN ATTESTATION. Two values are mintable:
 * `state-owned` and `peer-separated`. `unconfined` is a boot refusal, and the
 * only other place it appears is a state directory whose mode was opened while
 * the broker was already running — which refuses the next request rather than
 * settling it.
 *
 * WHAT THE FIELD IS WORTH, IN BOTH DIRECTIONS. Its integrity equals control of
 * the signing key. The field describes only the broker's leaf-directory and
 * challenge observations; it does not establish custody of that key. That
 * self-reference is not symmetric:
 *
 *   - DOWNWARD (`state-owned`) is a precise POSIX leaf observation. No config field, environment
 *     variable, request field, or code path lets an operator make an honest
 *     broker stamp a class LOWER than it measured. It means the state leaf's
 *     uid equalled the broker euid and its group/other mode bits were empty;
 *     it says nothing about socket peer identity, ACLs, or ancestor custody.
 *   - UPWARD (`peer-separated`) records one extra challenge observation and is
 *     credible as authority separation only to a reader who independently
 *     pinned the broker key and authenticated route to a launch whose authority
 *     separation it established independently. To
 *     that reader the field adds no authority — it echoes a fact already held.
 *     Its value is that a MISMATCH IS LOUD: a key pinned to that separated
 *     launch produces a receipt that says
 *     `state-owned`, something regressed and the receipt says so in signed
 *     bytes.
 *   - Against an attacker AT THE BROKER'S OWN UID the field proves nothing and
 *     cannot: that attacker holds the key and mints any class. It also neither
 *     helps nor hinders him, because with that key he already forges arbitrary
 *     receipts and a coherent Aura rewrite.
 *
 * WHAT THIS DOES NOT DO. It does not defend against the broker's own uid: the
 * seal, the class, and the receipt all live inside the directory that uid owns.
 * It does not make an unmount roll back a write. It is not tamperproof
 * hardware — a same-uid debugger attaches to this process. `peer-separated`
 * says only that this broker received EACCES or EPERM at a configured token
 * path and this connection echoed bytes matching a launcher-supplied digest.
 * It does not identify the peer uid, prevent relay, inspect ACLs, prove that
 * the peer is the agent, or prove the agent lacks another channel.
 *
 * THE TENSION, WRITTEN DOWN RATHER THAN LEFT IMPLICIT. Under a genuine uid
 * split the guest CANNOT verify its own receipt: `verifyReceipt` re-observes
 * the object on disk, and the split is precisely what denies the guest that
 * read. The confinement that makes a receipt meaningful is the same
 * confinement that makes it unverifiable by its recipient. The receipt is for
 * a third party, which is what "postcondition evidence, not proof about the
 * world" already concedes.
 *
 * @module @aukora/broker/confinement
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  chmodSync, closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

/**
 * The confinement classes, weakest first. Frozen: these strings appear inside
 * receipt signatures and inside the state-directory seal, so changing one
 * invalidates every artifact that carries it.
 */
export const CONFINEMENT_CLASS = Object.freeze({
  UNCONFINED: 'unconfined',
  STATE_OWNED: 'state-owned',
  PEER_SEPARATED: 'peer-separated',
})

/**
 * Total order over {@link CONFINEMENT_CLASS}. The seal ratchet and the
 * verifier's `require` gate are both comparisons in this order.
 */
export const CLASS_RANK = Object.freeze({
  [CONFINEMENT_CLASS.UNCONFINED]: 0,
  [CONFINEMENT_CLASS.STATE_OWNED]: 1,
  [CONFINEMENT_CLASS.PEER_SEPARATED]: 2,
})

/** Named refusals the confinement gate produces. Each names one measured fact. */
export const CONFINEMENT_REFUSE = Object.freeze({
  ROOT_EUID: 'broker:root-euid',
  STATE_ABSENT: 'broker:state-absent',
  STATE_NOT_OWNED: 'broker:state-not-exclusively-owned',
  STATE_MODE_OPEN: 'broker:state-mode-open',
  BELOW_SEAL: 'broker:confinement-below-seal',
  SEAL_UNREADABLE: 'broker:seal-unreadable',
  SEAL_FOREIGN_DIRECTORY: 'broker:seal-foreign-directory',
  PEER_SEPARATION_DISPROVEN: 'broker:peer-separation-disproven',
  PEER_ECHO_MISMATCH: 'broker:peer-echo-mismatch',
})

/** The high-water seal's filename inside the state directory. */
export const SEAL_FILENAME = 'confinement.seal'

/** Environment name carrying the path of the launch-provisioned peer token. */
export const PEER_TOKEN_PATH_ENV = 'AUKORA_PEER_TOKEN'

/** Environment name carrying the sha256 of the peer token's bytes. */
export const PEER_TOKEN_SHA256_ENV = 'AUKORA_PEER_TOKEN_SHA256'

/** How many random bytes a peer token holds. A launcher plants exactly this many. */
export const PEER_TOKEN_BYTES = 32

/** Closed signed confinement field names. */
const CONFINEMENT_FIELD_KEYS = Object.freeze([
  'class', 'euid', 'stateUid', 'stateMode', 'stateDev', 'stateIno', 'platform', 'sealClass', 'peerProof',
])

/** Closed signed peer-observation field names. */
const PEER_PROOF_KEYS = Object.freeze(['tokenPath', 'brokerReadError', 'peerEchoedAt'])

/**
 * Is this mode closed to every uid but the owner?
 *
 * The single home for the predicate the issuer already applies to the root key
 * file: group and other must hold no bits at all.
 *
 * @param {number} mode - a stat mode word.
 * @returns {boolean} true when group and other are empty.
 */
export function isPrivateMode(mode) {
  return (mode & 0o077) === 0
}

/**
 * Compare two class names in {@link CLASS_RANK} order.
 *
 * @param {string} a - a confinement class name.
 * @param {string} b - a confinement class name.
 * @returns {boolean} true when `a` is at least as strong as `b`.
 * @throws {TypeError} when either name is not a known class.
 */
export function classAtLeast(a, b) {
  const ra = CLASS_RANK[a]
  const rb = CLASS_RANK[b]
  if (ra === undefined) throw new TypeError(`confinement: unknown class ${JSON.stringify(a)}`)
  if (rb === undefined) throw new TypeError(`confinement: unknown class ${JSON.stringify(b)}`)
  return ra >= rb
}

/**
 * Measure the state directory against the effective uid that would serve it.
 *
 * Pure and total: it never throws for a hostile directory and never refuses —
 * it CLASSES. `unconfined` here means the leaf owner or group/other POSIX mode
 * check failed; the measurement does not inspect ACLs or ancestors. The boot
 * gate turns that result into a refusal and a mid-flight settlement turns it
 * into a below-seal refusal.
 *
 * `euid` is an explicit parameter so the root refusal is measurable on a host
 * where the court cannot become root. It is not a configuration path: the only
 * product caller is {@link assertBootConfinement}, which passes
 * `process.geteuid()` literally, and `serve()` exposes no parameter for it.
 *
 * @param {object} params
 * @param {string} params.stateDir - the directory the broker would own.
 * @param {number} params.euid - the effective uid that would serve from it.
 * @returns {{class: string, defect: string | null, euid: number, stateUid: number | null,
 *   stateMode: string | null, stateDev: number | null, stateIno: number | null, platform: string}}
 *   the measured class and, when it is `unconfined`, the named defect that made it so.
 */
export function measureStateDirectory({ stateDir, euid }) {
  const base = { euid, stateUid: null, stateMode: null, stateDev: null, stateIno: null, platform: process.platform }
  if (euid === 0) {
    // A root broker reads every uid's 0600 files, so the peer challenge is
    // meaningless for it and no class it stamps would mean anything.
    return { ...base, class: CONFINEMENT_CLASS.UNCONFINED, defect: CONFINEMENT_REFUSE.ROOT_EUID }
  }
  let stat
  try {
    stat = statSync(stateDir)
  } catch {
    // Nothing else can reach here: the only failure a stat of a path reports
    // in a way this gate acts on is "there is no directory to measure".
    return { ...base, class: CONFINEMENT_CLASS.UNCONFINED, defect: CONFINEMENT_REFUSE.STATE_ABSENT }
  }
  const measured = {
    ...base,
    stateUid: stat.uid,
    stateMode: (stat.mode & 0o7777).toString(8).padStart(4, '0'),
    stateDev: Number(stat.dev),
    stateIno: Number(stat.ino),
  }
  if (stat.uid !== euid) return { ...measured, class: CONFINEMENT_CLASS.UNCONFINED, defect: CONFINEMENT_REFUSE.STATE_NOT_OWNED }
  if (!isPrivateMode(stat.mode)) return { ...measured, class: CONFINEMENT_CLASS.UNCONFINED, defect: CONFINEMENT_REFUSE.STATE_MODE_OPEN }
  return { ...measured, class: CONFINEMENT_CLASS.STATE_OWNED, defect: null }
}

/**
 * Try to read the configured challenge token, and report the broker's own failure.
 *
 * This is the whole reason the class is not a switch. Separation is raised
 * only by a kernel refusal the broker suffered itself: the launcher supplies a
 * token path and the broker must get EACCES or EPERM trying to read it. If the
 * read succeeds, that challenge cannot support a stronger class. The code does
 * not observe the path owner, ACLs, or the socket peer's credentials.
 *
 * Absence or misconfiguration of the token can only LOWER the ceiling, and
 * that is deliberate rather than a silent skip: on a state directory already
 * sealed at `peer-separated` the lowered ceiling is a downgrade, and
 * {@link assertBootConfinement} refuses to boot. A vanished token is loud
 * exactly where it matters and costs a dev laptop nothing.
 *
 * @param {object} params
 * @param {string | undefined} params.tokenPath - path the launcher planted, if any.
 * @param {string | undefined} params.tokenSha256 - sha256 hex of the token's bytes, from the launcher.
 * @returns {{separable: boolean, tokenPath: string | null, brokerReadError: string | null,
 *   expectedSha256: string | null}} `separable` is true only when the broker's own read failed
 *   with a permission error AND a digest to check an echo against is configured.
 * @throws {TypeError} when a token path is configured without its digest, or the digest is not sha256 hex.
 */
export function measurePeerSeparability({ tokenPath, tokenSha256 }) {
  const absent = {
    separable: false,
    tokenPath: tokenPath ?? null,
    brokerReadError: null,
    expectedSha256: tokenSha256 ?? null,
  }
  if (tokenPath === undefined || tokenPath === '') {
    if (tokenSha256 !== undefined && tokenSha256 !== '') {
      throw new TypeError(`confinement: ${PEER_TOKEN_SHA256_ENV} is set without ${PEER_TOKEN_PATH_ENV}`)
    }
    return absent
  }
  // Misconfiguration fails loud at the earliest resolvable point: a launcher
  // that planted a token but no digest cannot ever be answered, and silently
  // demoting would hide the operator's mistake behind a plausible class.
  if (tokenSha256 === undefined || tokenSha256 === '') {
    throw new TypeError(`confinement: ${PEER_TOKEN_PATH_ENV} is set without ${PEER_TOKEN_SHA256_ENV}`)
  }
  if (!/^[0-9a-f]{64}$/.test(tokenSha256)) {
    throw new TypeError(`confinement: ${PEER_TOKEN_SHA256_ENV} is not a sha256 hex digest`)
  }
  try {
    readFileSync(tokenPath)
  } catch (error) {
    const code = String(error?.code ?? '')
    if (code === 'EACCES' || code === 'EPERM') {
      return { separable: true, tokenPath, brokerReadError: code, expectedSha256: tokenSha256 }
    }
    // Any other failure (ENOENT, ENOTDIR, EISDIR) is a token that is not there
    // to be denied, which proves nothing about uids.
    return { ...absent, brokerReadError: code || 'unknown' }
  }
  // The read succeeded, so this path supplies no denial observation. Ceiling:
  // state-owned. No conclusion about the peer uid follows from this read.
  return { ...absent, brokerReadError: null }
}

/**
 * Does this connection echo bytes matching the configured token digest?
 *
 * @param {object} params
 * @param {{separable: boolean, expectedSha256: string | null}} params.peer - a {@link measurePeerSeparability} result.
 * @param {string} params.echoBase64 - the bytes the peer claims to have read, base64.
 * @returns {{ok: true} | {ok: false, reason: string}} named refusal on failure.
 */
export function verifyPeerEcho({ peer, echoBase64 }) {
  if (!peer.separable) return { ok: false, reason: CONFINEMENT_REFUSE.PEER_SEPARATION_DISPROVEN }
  if (typeof echoBase64 !== 'string') return { ok: false, reason: CONFINEMENT_REFUSE.PEER_ECHO_MISMATCH }
  const echoed = createHash('sha256').update(Buffer.from(echoBase64, 'base64')).digest()
  const expected = Buffer.from(peer.expectedSha256, 'hex')
  if (echoed.length !== expected.length || !timingSafeEqual(echoed, expected)) {
    return { ok: false, reason: CONFINEMENT_REFUSE.PEER_ECHO_MISMATCH }
  }
  return { ok: true }
}

/**
 * Read the state directory's high-water seal.
 *
 * @param {string} stateDir - the broker's own directory.
 * @returns {{present: false} | {present: true, seal: Record<string, unknown>}}
 * @throws {Error} named {@link CONFINEMENT_REFUSE.SEAL_UNREADABLE} when the file
 *   exists but does not parse or carries a class outside {@link CONFINEMENT_CLASS}.
 */
export function readSeal(stateDir) {
  const file = join(stateDir, SEAL_FILENAME)
  let state
  try {
    state = lstatSync(file)
  } catch (error) {
    if (error?.code === 'ENOENT') return { present: false }
    throw new Error(CONFINEMENT_REFUSE.SEAL_UNREADABLE)
  }
  if (!state.isFile() || state.isSymbolicLink()) throw new Error(CONFINEMENT_REFUSE.SEAL_UNREADABLE)
  let seal
  try {
    seal = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // Nothing else reaches here: the file exists, so the only failure that
    // matters is bytes that are not the JSON this module wrote.
    throw new Error(CONFINEMENT_REFUSE.SEAL_UNREADABLE)
  }
  if (CLASS_RANK[seal?.class] === undefined) throw new Error(CONFINEMENT_REFUSE.SEAL_UNREADABLE)
  return { present: true, seal }
}

/**
 * Write the seal at the given class through an atomic same-directory rename.
 *
 * The seal is stored 0400 so a stray write cannot lower it by accident;
 * lowering it on purpose needs the broker's own uid, which is the party this
 * design does not defend against and never claimed to. The old entry is never
 * unlinked first: a crash or write failure before rename leaves the previous
 * high-water mark in place. The replacement and directory entry are flushed
 * before this function returns.
 *
 * @param {object} params
 * @param {string} params.stateDir - the broker's own directory.
 * @param {string} params.confinementClass - the class to record as the high-water mark.
 * @param {ReturnType<typeof measureStateDirectory>} params.measurement - the directory as measured now.
 * @returns {Record<string, unknown>} the seal that was written.
 */
export function writeSeal({ stateDir, confinementClass, measurement }) {
  const file = join(stateDir, SEAL_FILENAME)
  const temporary = join(stateDir, `.${SEAL_FILENAME}.${randomBytes(12).toString('hex')}.tmp`)
  const seal = {
    class: confinementClass,
    euid: measurement.euid,
    stateUid: measurement.stateUid,
    stateMode: measurement.stateMode,
    stateDev: measurement.stateDev,
    stateIno: measurement.stateIno,
    platform: measurement.platform,
    sealedAt: new Date().toISOString(),
  }
  let descriptor
  try {
    descriptor = openSync(temporary, 'wx', 0o400)
    writeFileSync(descriptor, `${JSON.stringify(seal)}\n`, 'utf8')
    fsyncSync(descriptor)
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    try {
      rmSync(temporary, { force: true })
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'confinement: seal write and cleanup failed')
    }
    throw error
  }
  closeSync(descriptor)
  descriptor = undefined
  renameSync(temporary, file)
  chmodSync(file, 0o400)
  const directory = openSync(stateDir, 'r')
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
  return seal
}

/**
 * The unconditional boot gate. Both platforms, no branch, no override.
 *
 * Refuses when the broker runs as root, when the state leaf is not owned by the
 * serving uid, when its group/other POSIX mode bits are nonzero, or when its
 * seal records a class this launch cannot reach. It does not inspect ACLs or
 * ancestor directories. A fresh directory is sealed at the
 * class it can serve today — never at the ceiling it could reach, because the
 * seal is a high-water mark of what HAS been served.
 *
 * @param {object} params
 * @param {string} params.stateDir - the directory the broker will own.
 * @param {string | undefined} params.peerTokenPath - path of the launch-provisioned token, if any.
 * @param {string | undefined} params.peerTokenSha256 - sha256 hex of that token's bytes.
 * @returns {{measurement: ReturnType<typeof measureStateDirectory>,
 *   peer: ReturnType<typeof measurePeerSeparability>, ceiling: string, seal: Record<string, unknown>}}
 *   what was measured, the highest class a connection on this launch can reach, and the seal in force.
 * @throws {Error} whose message is one of {@link CONFINEMENT_REFUSE}, carrying `detail`.
 */
export function assertBootConfinement({ stateDir, peerTokenPath, peerTokenSha256 }) {
  const measurement = measureStateDirectory({ stateDir, euid: process.geteuid() })
  if (measurement.class === CONFINEMENT_CLASS.UNCONFINED) {
    const error = new Error(measurement.defect)
    error.detail = describeDefect(stateDir, measurement)
    throw error
  }
  const peer = measurePeerSeparability({ tokenPath: peerTokenPath, tokenSha256: peerTokenSha256 })
  const ceiling = peer.separable ? CONFINEMENT_CLASS.PEER_SEPARATED : measurement.class

  const existing = readSeal(stateDir)
  if (!existing.present) {
    return { measurement, peer, ceiling, seal: writeSeal({ stateDir, confinementClass: measurement.class, measurement }) }
  }
  const seal = existing.seal
  if (seal.stateDev !== measurement.stateDev || seal.stateIno !== measurement.stateIno) {
    // The seal outlived the directory it sealed. A seal is evidence about ONE
    // directory; carrying it into another is how a dev seal would be presented
    // as production provenance.
    const error = new Error(CONFINEMENT_REFUSE.SEAL_FOREIGN_DIRECTORY)
    error.detail = `seal names dev=${seal.stateDev} ino=${seal.stateIno}; this directory is dev=${measurement.stateDev} ino=${measurement.stateIno}`
    throw error
  }
  if (!classAtLeast(ceiling, seal.class)) {
    const error = new Error(CONFINEMENT_REFUSE.BELOW_SEAL)
    error.detail = `this directory has served ${seal.class}; this launch can reach only ${ceiling}`
    throw error
  }
  return { measurement, peer, ceiling, seal }
}

/**
 * Raise the seal before an effect begins at a class above the high-water mark.
 *
 * @param {object} params
 * @param {string} params.stateDir - the broker's own directory.
 * @param {Record<string, unknown>} params.seal - the seal currently in force.
 * @param {string} params.servedClass - the class the admitted effect will use.
 * @param {ReturnType<typeof measureStateDirectory>} params.measurement - the directory as measured now.
 * @returns {Record<string, unknown>} the seal in force after this call.
 */
export function raiseSeal({ stateDir, seal, servedClass, measurement }) {
  if (classAtLeast(seal.class, servedClass)) return seal
  return writeSeal({ stateDir, confinementClass: servedClass, measurement })
}

/**
 * The class one connection is served at, combining what the directory measures
 * now with the challenge observation recorded on this socket.
 *
 * A failed state-leaf mode/owner check voids the stronger class. A matching
 * echo raises the class name only while the directory still measures
 * `state-owned`; peer identity and non-relay remain deployment obligations.
 *
 * @param {ReturnType<typeof measureStateDirectory>} measurement - the directory as measured now.
 * @param {string | null} provenClass - `peer-separated` when this connection answered the challenge.
 * @returns {string} the class this connection's settlements are stamped with.
 */
export function effectiveClass(measurement, provenClass) {
  if (measurement.class === CONFINEMENT_CLASS.UNCONFINED) return CONFINEMENT_CLASS.UNCONFINED
  if (provenClass === CONFINEMENT_CLASS.PEER_SEPARATED) return CONFINEMENT_CLASS.PEER_SEPARATED
  return CONFINEMENT_CLASS.STATE_OWNED
}

/**
 * The confinement object stamped into a receipt and into the record entry.
 *
 * @param {object} params
 * @param {string} params.confinementClass - the class this connection was served at.
 * @param {ReturnType<typeof measureStateDirectory>} params.measurement - the directory as measured at settlement.
 * @param {ReturnType<typeof measurePeerSeparability>} params.peer - the boot-time separability measurement.
 * @param {string} params.sealClass - the high-water class of this state directory.
 * @param {string | null} params.peerEchoedAt - ISO time the peer proved separation, or null.
 * @returns {{class: string, euid: number, stateUid: number | null, stateMode: string | null,
 *   stateDev: number | null, stateIno: number | null, platform: string, sealClass: string,
 *   peerProof: {tokenPath: string, brokerReadError: string, peerEchoedAt: string} | null}}
 *   the closed field containing the broker's local state and challenge observations.
 */
export function confinementField({ confinementClass, measurement, peer, sealClass, peerEchoedAt }) {
  return {
    class: confinementClass,
    euid: measurement.euid,
    stateUid: measurement.stateUid,
    stateMode: measurement.stateMode,
    stateDev: measurement.stateDev,
    stateIno: measurement.stateIno,
    platform: measurement.platform,
    sealClass,
    peerProof: confinementClass === CONFINEMENT_CLASS.PEER_SEPARATED && peerEchoedAt !== null
      ? { tokenPath: peer.tokenPath, brokerReadError: peer.brokerReadError, peerEchoedAt }
      : null,
  }
}

/**
 * Is this value a well-formed confinement field?
 *
 * Used by the verifier, which reads receipts off a wire and may not assume the
 * producer was this module.
 *
 * @param {unknown} value - the candidate field.
 * @returns {boolean} true when it carries a known class and the recorded facts.
 */
export function isConfinementField(value) {
  return snapshotConfinementField(value) !== null
}

/**
 * Snapshot one closed confinement field without invoking accessors.
 *
 * @param {unknown} value - the candidate field from a signed artifact.
 * @returns {ReturnType<typeof confinementField> | null} a plain closed snapshot, or null.
 */
export function snapshotConfinementField(value) {
  const field = snapshotExactDataRecord(value, CONFINEMENT_FIELD_KEYS)
  if (field === null) return null
  if (CLASS_RANK[field.class] === undefined || CLASS_RANK[field.sealClass] === undefined) return null
  if (!Number.isSafeInteger(field.euid) || field.euid < 0) return null
  if (field.stateUid !== null && (!Number.isSafeInteger(field.stateUid) || field.stateUid < 0)) return null
  if (field.stateMode !== null && (typeof field.stateMode !== 'string' || !/^0[0-7]{3}$/.test(field.stateMode))) return null
  if (field.stateDev !== null && (!Number.isSafeInteger(field.stateDev) || field.stateDev < 0)) return null
  if (field.stateIno !== null && (!Number.isSafeInteger(field.stateIno) || field.stateIno < 0)) return null
  if (typeof field.platform !== 'string' || field.platform.length === 0) return null

  const mintable = field.class === CONFINEMENT_CLASS.STATE_OWNED
    || field.class === CONFINEMENT_CLASS.PEER_SEPARATED
  if (mintable) {
    if (field.stateUid !== field.euid
      || field.stateMode === null
      || (Number.parseInt(field.stateMode, 8) & 0o077) !== 0
      || field.stateDev === null
      || field.stateIno === null
      || !classAtLeast(field.class, field.sealClass)) return null
  }

  let peerProof = null
  if (field.peerProof !== null) {
    peerProof = snapshotExactDataRecord(field.peerProof, PEER_PROOF_KEYS)
    if (peerProof === null
      || typeof peerProof.tokenPath !== 'string' || peerProof.tokenPath.length === 0 || peerProof.tokenPath.includes('\0')
      || (peerProof.brokerReadError !== 'EACCES' && peerProof.brokerReadError !== 'EPERM')
      || typeof peerProof.peerEchoedAt !== 'string'
      || !Number.isFinite(Date.parse(peerProof.peerEchoedAt))
      || new Date(peerProof.peerEchoedAt).toISOString() !== peerProof.peerEchoedAt) return null
  }
  if ((field.class === CONFINEMENT_CLASS.PEER_SEPARATED) !== (peerProof !== null)) return null
  return { ...field, peerProof }
}

/** Snapshot one exact plain object containing only enumerable data properties. */
function snapshotExactDataRecord(value, allowedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.length !== allowedKeys.length
      || ownKeys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))) return null
    const snapshot = Object.create(null)
    for (const key of ownKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null
      snapshot[key] = descriptor.value
    }
    return snapshot
  } catch {
    return null
  }
}

/** Human-readable detail for a boot refusal, naming the measured fact. */
function describeDefect(stateDir, measurement) {
  switch (measurement.defect) {
    case CONFINEMENT_REFUSE.ROOT_EUID:
      return 'the broker refuses to run as root: root reads every uid\'s private files, so no class it stamped would mean anything'
    case CONFINEMENT_REFUSE.STATE_ABSENT:
      return `${stateDir} does not exist`
    case CONFINEMENT_REFUSE.STATE_NOT_OWNED:
      return `${stateDir} is owned by uid ${measurement.stateUid}, not by the serving uid ${measurement.euid}`
    case CONFINEMENT_REFUSE.STATE_MODE_OPEN:
      return `${stateDir} is mode ${measurement.stateMode}; group and other must hold no bits (mkdirSync does not tighten an existing directory)`
    default:
      return `${stateDir} measured ${measurement.class}`
  }
}
