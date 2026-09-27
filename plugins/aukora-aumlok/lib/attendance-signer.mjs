/**
 * THE ATTENDANCE SIGNER — ONE INTERFACE, TWO IMPLEMENTATIONS, AND ONLY ONE OF THEM PROVES ANYTHING.
 *
 * `signAttendance()` is the seam. The Secure Enclave implementation spawns the compiled Swift helper and
 * needs entitlements this Mac does not have; the fixture implementation is a software P-256 key for courts
 * and rigs. **BOTH RETURN THE SAME SHAPE AND ONLY THE `keyType` TELLS THEM APART**, which is why the
 * fixture announces itself in three places: the type it writes (`p256-software-fixture`), the line it
 * prints on construction, and the ceiling `attendance.mjs` returns for it. A fixture attendance must never
 * be readable as SE attendance by a screen, a record, or a reader.
 *
 * THE SE PATH IS WRITTEN AND NOT SHIPPED. Measured 2026-09-24: an ad-hoc-signed helper is refused
 * `errSecMissingEntitlement (-34018)`, and this Mac has no signing identity. When Peter's Team ID exists,
 * the helper is compiled and signed with `keychain-access-groups` and this file needs no change — that is
 * the whole point of putting the seam here now.
 *
 * NO NEW CURVE IMPLEMENTATION (AGENTS.md): the fixture's P-256 keys and signatures are `node:crypto`.
 */
import { spawnSync } from 'node:child_process'
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as nodeSign } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ATTENDANCE_KEY_TYPES, ATTENDANCE_REFUSE, attendanceBlock, attendanceLocalizedReason } from './attendance.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))

/** Where the compiled SE helper lives, and its source beside it. */
export const SE_HELPER_SOURCE = join(HERE, '..', 'bin', 'attendance-se-helper.swift')
export const SE_HELPER_BINARY = join(HERE, '..', 'bin', 'attendance-se-helper')

/** Why the SE path cannot answer here, or null when it might. Never a guess: the binary is looked for. */
export function secureEnclaveUnavailable(binaryPath = SE_HELPER_BINARY) {
  if (!existsSync(binaryPath)) {
    return `${ATTENDANCE_REFUSE.UNAVAILABLE}: no compiled Secure Enclave helper at ${binaryPath}. Build `
      + `and sign it with a keychain-access-groups entitlement (see ${SE_HELPER_SOURCE}); until then an `
      + 'ad-hoc-signed helper is refused errSecMissingEntitlement (-34018), measured 2026-09-24'
  }
  return null
}

/**
 * THE SECURE ENCLAVE SIGNER. Asks the helper to sign one preimage with an enrolled, non-exportable key.
 *
 * IT SIGNS AND NOTHING ELSE. The helper is handed a digest and returns a signature; it never sees the
 * record, never chooses what to sign, and holds no authority. The `localizedReason` travels INTO the OS
 * dialog so the person is told what the enclave is being asked about — see `attendanceLocalizedReason` for
 * exactly how little that narrows.
 *
 * @param {{binaryPath?: string, rawPointHex?: string, spawn?: typeof spawnSync}} [options]
 * @returns {Readonly<{kind: string, keyType: string, rawPointHex: string|null, sign: (input: object) => object}>}
 */
export function createSecureEnclaveAttendanceSigner(options = {}) {
  const binaryPath = options.binaryPath ?? SE_HELPER_BINARY
  const spawn = options.spawn ?? spawnSync
  return Object.freeze({
    kind: 'secure-enclave',
    keyType: ATTENDANCE_KEY_TYPES.SECURE_ENCLAVE,
    rawPointHex: options.rawPointHex ?? null,
    /** @param {{preimage: Buffer, summary: string, digestPrefix: string}} input */
    sign(input) {
      const unavailable = secureEnclaveUnavailable(binaryPath)
      if (unavailable !== null) throw Object.assign(new Error(unavailable), { code: ATTENDANCE_REFUSE.UNAVAILABLE })
      const reason = attendanceLocalizedReason({ summary: input.summary, digestPrefix: input.digestPrefix })
      const result = spawn(binaryPath, ['sign', '--reason', reason], {
        input: input.preimage, encoding: 'utf8', maxBuffer: 1024 * 1024,
      })
      if (result.status !== 0) {
        // THE HELPER'S OWN EXIT CODE DECIDES THE NAME. A person who cancelled is `refused`; a machine with
        // no enclave or no enrolled finger is `unavailable`; anything else is `not-verified`, because a
        // helper that failed in an unknown way produced no trustworthy signature.
        const said = String(result.stderr ?? '')
        const code = /-128|UserCanceled|cancel/iu.test(said) ? ATTENDANCE_REFUSE.REFUSED
          : /-34018|errSecMissingEntitlement|no biometry|not available/iu.test(said) ? ATTENDANCE_REFUSE.UNAVAILABLE
            : ATTENDANCE_REFUSE.NOT_VERIFIED
        throw Object.assign(new Error(`${code}: the Secure Enclave helper failed: ${said.trim().slice(0, 200)}`),
          { code })
      }
      let parsed
      try {
        parsed = JSON.parse(String(result.stdout))
      } catch {
        throw Object.assign(new Error(`${ATTENDANCE_REFUSE.NOT_VERIFIED}: the helper's reply is not JSON`),
          { code: ATTENDANCE_REFUSE.NOT_VERIFIED })
      }
      return attendanceBlock({
        keyType: ATTENDANCE_KEY_TYPES.SECURE_ENCLAVE,
        rawPointHex: parsed.rawPointHex,
        signatureHex: parsed.signatureHex,
      })
    },
  })
}

/**
 * THE SOFTWARE FIXTURE SIGNER — FOR COURTS AND RIGS, AND IT SAYS SO OUT LOUD.
 *
 * It prints on construction, so a run that uses it cannot be mistaken for a run that used the enclave even
 * if nobody reads the record, and it writes `p256-software-fixture` into every block it produces. Its
 * private half is readable by this process, which is exactly what makes it useless as evidence and useful
 * as a test.
 *
 * @param {{label?: string, announce?: (line: string) => void}} [options]
 * @returns {Readonly<{kind: string, keyType: string, rawPointHex: string, privateKey: object, sign: Function}>}
 */
export function createFixtureAttendanceSigner(options = {}) {
  const label = options.label ?? 'attendance-fixture'
  const announce = options.announce ?? (line => { process.stderr.write(`${line}\n`) })
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  // X9.63 UNCOMPRESSED, THE SAME SHAPE THE ENCLAVE RETURNS, so a court exercises the real encoding.
  const rawPointHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65).toString('hex')
  announce(`ATTENDANCE FIXTURE — ${label}: this is a SOFTWARE P-256 key, NOT a Secure Enclave key. `
    + 'It proves nothing about who was present and must never be read as biometric attendance.')
  return Object.freeze({
    kind: 'fixture',
    keyType: ATTENDANCE_KEY_TYPES.SOFTWARE_FIXTURE,
    rawPointHex,
    privateKey,
    /** @param {{preimage: Buffer}} input */
    sign(input) {
      const signature = nodeSign('sha256', input.preimage, { key: privateKey, dsaEncoding: 'der' })
      return attendanceBlock({
        keyType: ATTENDANCE_KEY_TYPES.SOFTWARE_FIXTURE,
        rawPointHex,
        signatureHex: signature.toString('hex'),
      })
    },
  })
}

/**
 * The record's `attendanceKey`, as enrolment would write it.
 *
 * THE TYPE IS TAKEN FROM THE SIGNER AND NEVER FROM A CALLER. A fixture that could enrol itself as
 * `p256-se` would put a software key into a record that a verifier would then describe as biometric
 * attendance — the one failure this whole file is arranged to make impossible.
 *
 * @param {{signer: {keyType: string, rawPointHex: string}, enrolledAt: string, machineIndex?: number}} input
 * @returns {Readonly<Record<string, unknown>>} the attendance key block.
 */
export function attendanceKeyFor({ signer, enrolledAt, machineIndex, witnessedBy }) {
  // AN UNWITNESSED ENROLMENT IS REFUSED, AND THIS IS THE LOAD-BEARING CHECK OF THE WHOLE DESIGN. The
  // ceiling says the trust is in one witnessed moment; an enrolment no owner approval attests would move
  // that trust back onto every signature, which is the weakness the design exists to remove. `witnessedBy`
  // is the digest of the enrolment approval the person answered on the sheet.
  if (typeof witnessedBy !== 'string' || !/^[0-9a-f]{64}$/u.test(witnessedBy)) {
    throw Object.assign(new Error(`${ATTENDANCE_REFUSE.KEY_ABSENT}: an attendance key is enrolled in an `
      + 'owner-witnessed ceremony, so the enrolment must name the approval the person answered '
      + '(`witnessedBy`, 64 hex). An enrolment nobody witnessed puts the trust back on every signature'),
    { code: ATTENDANCE_REFUSE.KEY_ABSENT })
  }
  if (signer?.keyType !== ATTENDANCE_KEY_TYPES.SECURE_ENCLAVE
    && signer?.keyType !== ATTENDANCE_KEY_TYPES.SOFTWARE_FIXTURE) {
    throw Object.assign(new Error(`${ATTENDANCE_REFUSE.NOT_VERIFIED}: a signer that does not name its `
      + 'key type cannot enrol an attendance key'), { code: ATTENDANCE_REFUSE.NOT_VERIFIED })
  }
  if (typeof signer.rawPointHex !== 'string' || !/^04[0-9a-f]{128}$/u.test(signer.rawPointHex)) {
    throw Object.assign(new Error(`${ATTENDANCE_REFUSE.NOT_VERIFIED}: the signer's public point is not a `
      + 'P-256 X9.63 point'), { code: ATTENDANCE_REFUSE.NOT_VERIFIED })
  }
  return Object.freeze({
    keyType: signer.keyType,
    rawPointHex: signer.rawPointHex,
    accessControl: signer.keyType === ATTENDANCE_KEY_TYPES.SECURE_ENCLAVE ? 'biometryCurrentSet' : 'none-fixture',
    enrolledAt,
    // THE WITNESS TRAVELS WITH THE KEY, so a verifier READS the enrolment rather than being told about it.
    witnessedBy,
    ...(machineIndex === undefined ? {} : { machineIndex }),
  })
}

/** The fixture's own SPKI wrapper, for a court that wants to check the encoding independently. */
export function rawPointOfPublicKey(publicKey) {
  return createPublicKey(publicKey).export({ type: 'spki', format: 'der' }).subarray(-65).toString('hex')
}

/** Re-exported so a caller needs one import to sign an approval and say what it may claim. */
export { attendanceBlock, attendanceLocalizedReason, ATTENDANCE_KEY_TYPES, ATTENDANCE_REFUSE }
export { createPrivateKey }
