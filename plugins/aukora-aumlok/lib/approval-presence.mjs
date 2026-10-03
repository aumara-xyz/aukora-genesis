/**
 * OPTIONAL TOUCH ID PRESENCE ON AN APPROVAL: what it is, where it lives, and how it is checked.
 *
 * After Approve in the AUKORA popup, the desktop may ask this Mac's Secure Enclave key (Touch ID) to sign
 * sha256(approvalSigningBytes(request)). The result is EVIDENCE BESIDE an approval, never part of it:
 *   - the approval is the Ed25519 owner signature, exactly as before; nothing here can refuse, delay past
 *     its window, or replace it, and every function below returns a reason instead of throwing;
 *   - a receipt never carries presence. Evidence is a sidecar file named by the hash of the signed bytes,
 *     so every closed-record reader of receipts is unchanged;
 *   - the trust anchor is a P-256 public key on this Mac, enrolled once by `aukora-touchid create`. A
 *     durable marker OUTSIDE the key directory records that an enrollment happened, so a deleted key reads
 *     `key-missing`, never `never-enrolled`.
 *
 * NOT ENFORCED: everything here lives in files this macOS user can write. A same-UID process can replace
 * the key, the marker and the sidecars, or ask the helper to sign. P-256 verification proves a key on this
 * Mac signed after a biometric check; it is not hardware attestation and names no person.
 */
import { createHash, createPublicKey, verify } from 'node:crypto'
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

/** The outcomes a reader may see, in one vocabulary everywhere they are reported. */
export const PRESENCE_REASONS = Object.freeze(['never-enrolled', 'key-missing', 'invalid', 'no-evidence', 'verified'])

export function presenceSupportRoot() {
  return process.env.AUKORA_SUPPORT_ROOT ?? join(homedir(), 'Library/Application Support/AUKORA')
}
export const presencePublicPath = (root = presenceSupportRoot()) => join(root, 'state/home/aumlok-presence/presence-public.pem')
export const presenceWrappedPath = (root = presenceSupportRoot()) => join(root, 'state/home/aumlok-presence/enclave-key.data')
export const presenceEnrollmentPath = (root = presenceSupportRoot()) => join(root, 'state/home/aura-presence/enrollment.json')
export function presenceSidecarPath(signingBytes, root = presenceSupportRoot()) {
  return join(root, 'state/home/aumlok-presence/approvals', `${createHash('sha256').update(signingBytes).digest('hex')}.json`)
}

const fail = reason => { throw Object.assign(new Error(reason), { code: reason }) }
function exists(path) {
  try { lstatSync(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

const MAX_FILE_BYTES = 4096
/** Owner-only regular file, no symlink, bounded read. */
function readSafeFile(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES || (stat.mode & 0o022) !== 0
      || (process.getuid && stat.uid !== process.getuid())) fail('presence:file-unsafe')
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null)
      if (count === 0) break
      length += count
    }
    if (length > MAX_FILE_BYTES) fail('presence:file-too-large')
    return bytes.subarray(0, length).toString('utf8')
  } finally { closeSync(fd) }
}

/** The exact evidence shape `{algorithm: 'p256-sha256', signature: <canonical DER hex>}`, nothing else. */
export function parsePresence(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.getPrototypeOf(input) !== Object.prototype) fail('presence:malformed')
  const keys = Object.keys(input).sort()
  if (keys.join(',') !== 'algorithm,signature') fail('presence:malformed')
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(input, key)
    if (!field || !('value' in field)) fail('presence:malformed')
  }
  const { algorithm, signature } = input
  if (algorithm !== 'p256-sha256' || typeof signature !== 'string' || !/^(?:[0-9a-f]{2}){8,72}$/u.test(signature)) fail('presence:malformed')
  // Canonical short-form DER: SEQUENCE(INTEGER r, INTEGER s), each positive, minimal and at most 256 bits.
  const der = Buffer.from(signature, 'hex')
  if (der[0] !== 0x30 || der[1] !== der.length - 2) fail('presence:malformed')
  let offset = 2
  for (let n = 0; n < 2; n++) {
    if (der[offset++] !== 2) fail('presence:malformed')
    const length = der[offset++]
    const integer = der.subarray(offset, offset + length)
    if (length < 1 || length > 33 || integer.length !== length || (integer[0] & 0x80)
      || (length > 1 && integer[0] === 0 && !(integer[1] & 0x80))
      || (length === 33 && integer[0] !== 0) || integer.every(byte => byte === 0)) fail('presence:malformed')
    offset += length
  }
  if (offset !== der.length) fail('presence:malformed')
  return Object.freeze({ algorithm, signature })
}

const keyDigest = key => createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex')

/**
 * What this Mac's enrollment is, read only. Never throws.
 * @returns {{enrolled: boolean, reason: 'never-enrolled'|'key-missing'|'invalid'|'enrolled', key: import('node:crypto').KeyObject|null}}
 */
export function presenceEnrollment({ publicPath, supportRoot = presenceSupportRoot() } = {}) {
  let enrolled = false
  try {
    const path = publicPath ?? presencePublicPath(supportRoot)
    const recorded = publicPath === undefined && exists(presenceEnrollmentPath(supportRoot))
    enrolled = publicPath !== undefined || recorded || exists(presenceWrappedPath(supportRoot))
    if (!exists(path)) return { enrolled, reason: enrolled ? 'key-missing' : 'never-enrolled', key: null }
    enrolled = true
    const pem = readSafeFile(path)
    if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?(?![\s\S])/u.test(pem)) fail('invalid')
    const key = createPublicKey(pem)
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') fail('invalid')
    if (recorded) {
      // The marker names the key that was enrolled. A different key in its place is a replacement, not a renewal.
      const record = JSON.parse(readSafeFile(presenceEnrollmentPath(supportRoot)))
      if (record?.kind !== 'aukora:presence-enrollment:v1' || record.publicKeyDigest !== keyDigest(key)
        || Object.keys(record).sort().join(',') !== 'kind,publicKeyDigest') fail('invalid')
    }
    return { enrolled, reason: 'enrolled', key }
  } catch { return { enrolled, reason: 'invalid', key: null } }
}

/**
 * The desktop's one write to the enrollment marker: record a healthy enrollment that has no marker yet
 * (an enrollment made before the marker existed). O_EXCL keeps an existing marker. Explicit root only.
 */
export function recordPresenceEnrollment({ supportRoot } = {}) {
  if (typeof supportRoot !== 'string' || !isAbsolute(supportRoot)) fail('presence:explicit-root-required')
  const enrollment = presenceEnrollment({ supportRoot })
  const path = presenceEnrollmentPath(supportRoot)
  if (enrollment.key === null || exists(path)) return enrollment
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const info = lstatSync(directory)
  if (!info.isDirectory() || (info.mode & 0o022) !== 0 || (process.getuid && info.uid !== process.getuid())) fail('presence:history-unsafe')
  let fd
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    writeFileSync(fd, `${JSON.stringify({ kind: 'aukora:presence-enrollment:v1', publicKeyDigest: keyDigest(enrollment.key) })}\n`)
    fsyncSync(fd)
  } catch (error) { if (error.code !== 'EEXIST') throw error } finally { if (fd !== undefined) closeSync(fd) }
  return presenceEnrollment({ supportRoot })
}

/**
 * Keep verified evidence beside the approval, named by the hash of the signed bytes. Best effort: returns
 * false rather than throwing, and only ever writes evidence that verifies under the enrolled key.
 */
export function storeApprovalPresence(presence, signingBytes, { supportRoot } = {}) {
  let fd
  try {
    if (typeof supportRoot !== 'string' || !isAbsolute(supportRoot)
      || !verifyApprovalPresence(presence, signingBytes, { supportRoot }).proven) return false
    const path = presenceSidecarPath(signingBytes, supportRoot)
    const directory = dirname(path)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    for (const folder of [dirname(directory), directory]) {
      const stat = lstatSync(folder)
      if (!stat.isDirectory() || (stat.mode & 0o022) !== 0 || (process.getuid && stat.uid !== process.getuid())) return false
    }
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    writeFileSync(fd, `${JSON.stringify(parsePresence(presence))}\n`)
    return true
  } catch { return false } finally { if (fd !== undefined) { try { closeSync(fd) } catch { /* evidence only */ } } }
}

/**
 * Check presence evidence for one approval. NEVER THROWS AND NEVER REFUSES: the result is a reason from
 * PRESENCE_REASONS, and `proven` is true only for `verified`. With `presence` undefined the saved sidecar is
 * read, unless `allowSidecar: false` (a live ceremony checks only its own fresh result).
 */
export function verifyApprovalPresence(presence, signingBytes, given) {
  const options = given !== null && typeof given === 'object' ? given : {}
  const enrollment = presenceEnrollment(options)
  const result = { enrolled: enrollment.enrolled, proven: false,
    reason: enrollment.key === null ? enrollment.reason : 'no-evidence' }
  if (enrollment.key === null) return result
  if (presence === undefined && options.allowSidecar === false) return result
  try {
    let evidence = presence
    if (evidence === undefined) {
      const path = presenceSidecarPath(signingBytes, options.supportRoot ?? presenceSupportRoot())
      if (!exists(path)) return result
      evidence = JSON.parse(readSafeFile(path))
    }
    const parsed = parsePresence(evidence)
    // CryptoKit's signature(for: Digest) signs SHA256(signingBytes) directly, so this is ECDSA/SHA-256 over the bytes.
    if (!verify('sha256', signingBytes, { key: enrollment.key, dsaEncoding: 'der' }, Buffer.from(parsed.signature, 'hex'))) {
      return { ...result, reason: 'invalid' }
    }
    return { ...result, proven: true, reason: 'verified' }
  } catch { return { ...result, reason: 'invalid' } }
}
