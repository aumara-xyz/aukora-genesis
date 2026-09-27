/**
 * THE MACHINE SIGNER: what this machine holds, and how it ANSWERS.
 *
 * WHY THIS MODULE EXISTS. The root is cold — it is derived inside a ceremony and kept by nobody — so
 * routine approvals cannot be signed by it without the seven words being typed for every operation,
 * which is the ceremony the plan exists to avoid. What this machine keeps instead is the MACHINE KEY:
 * an HKDF of the root seed at this machine's index, which `bind` and `refreshBindingV3` write beside
 * the record. This module is the one place that reads that kept key back and answers with it.
 *
 * THE SIGNER ANSWERS BY NAME. An approval whose answer is `true` is a value a program can produce; an
 * approval whose answer is silence is a timeout a caller has to interpret. So the answer here is a
 * RECORD that names the key which signed: its class (`machine`, never `root`), its index, its raw
 * public key, and its `did:key`, beside the subject, the epoch and the signature. `readSignerAnswer`
 * is the reader for that record, and a bare boolean, `undefined`, or an object with no name in it is
 * refused by name rather than read as anything at all.
 *
 * THE ANSWER IS NOT THE RECORD'S OWN OPINION OF ITSELF. The signature is produced by
 * `root-class-v3.mjs` `signOperation` over exactly the bytes `verifyRootClassAct` re-derives, so a
 * caller can hand the answer to that verifier and get `class: 'machine'` back. Nothing here decides
 * that an approval SHOULD happen — there is no policy, no window and no reviewer in this module; it
 * signs one act for one identity at one epoch, and the caller decides whether to ask.
 *
 * A KEY THAT IS NOT THE RECORD'S MACHINE IS REFUSED, BY NAME. After a refresh the record lists the
 * NEW epoch's machine key; the previous one is not carried, so a signer still holding it is refused
 * as not listed rather than allowed to sign against an identity that no longer recognises it.
 *
 * THE KEY IS READ FROM THE 0600 FILE, AND THE SAME-UID CEILING APPLIES. A file this user can read is
 * a file anything running as this user can read; the separation this buys is architectural — the
 * approval is one auditable function over one key — and it is not a uid boundary.
 *
 * @module @aukora/dsh-plugin-aumlok/machine-signer-v3
 */
import { didKeyFromEd25519PublicKey } from './did-key.mjs'
import { recordProjection } from './record-v3.mjs'
import { readKeptMachineSeed } from './record-v3.mjs'
import { AUMLOK_MACHINE_KDF } from './machine-key-v3.mjs'
import { rootClassSigningBytes, signOperation, verifyRootClassAct } from './root-class-v3.mjs'
import { printPresenceCeiling } from './ceilings.mjs'

/** Domain of one named signer answer. Pinned as a literal, so a change is visible in a diff. */
export const MACHINE_ANSWER_DOMAIN = 'aukora:aumlok-machine-answer:v3'

/** The one act this module answers. An approval, and never a root-class act. */
export const MACHINE_ANSWER_ACT = 'approve-operation'

/** The class every answer from this module names. There is no other class here, on purpose. */
export const MACHINE_ANSWER_CLASS = 'machine'

/** Refusals this module produces by name. Stable strings; a caller renders them, never parses prose. */
export const MACHINE_ANSWER_REFUSE = Object.freeze({
  /** Nothing was kept on this machine, so there is no key here to answer with. */
  NO_MACHINE_KEY: 'aumlok:machine-signer-no-key',
  /** An answer was offered that does not name the key that made it: a boolean, silence, or no name. */
  NOT_NAMED: 'aumlok:signer-answer-not-named',
  /** The signer's key is not a machine the record lists, so the identity does not recognise it. */
  NOT_LISTED_BY_THE_RECORD: 'aumlok:machine-signer-not-listed-by-the-record',
  /** The record is not a v3 record and names no machines. */
  RECORD_MALFORMED: 'aumlok:machine-answer-record-malformed',
  /** The epoch asked about is not an epoch. */
  EPOCH_MALFORMED: 'aumlok:machine-answer-epoch-malformed',
})

const DIGEST = /^[0-9a-f]{64}$/u
const SEED_HEX = /^[0-9a-f]{64}$/u
const SUBJECT = /^aukora:1:[0-9a-f]{64}$/u

/** The machines one record lists, as public key hex, ready to compare against a signer. */
function listedMachines(record) {
  const machines = record?.publicRoot?.machines
  if (!Array.isArray(machines)) return []
  return machines.map(entry => entry?.ed25519).filter(key => typeof key === 'string')
}

/**
 * Read the machine key this machine kept, and refuse anything that is not one of the record's own.
 *
 * IT READS THE FILE BESIDE THE RECORD, NEVER THE WORDS. There is no phrase parameter anywhere in this
 * module, by construction rather than by care: a signer that could be handed the words would be a
 * signer that could be handed them by a caller who had them, and the whole point of keeping a machine
 * key is that the day-to-day path never holds the root.
 * @param {{directory: string, record?: object}} input - the bound directory and, when the caller has
 *   it, the record the signer must be a machine of.
 * @returns {Readonly<{ok: true, signer: object}> | Readonly<{ok: false, reason: string}>} the signer
 *   or a named refusal, never an exception for a missing file.
 */
export function openMachineSignerV3({ directory, record } = /** @type {never} */ ({})) {
  // **A SIGNING PATH MUST SAY WHAT A SIGNATURE PROVES (AUMLOK-115, SECURITY).** This opens the machine signer
  // from a 0600 file — `custodian: 'file'` is hard-coded below, which is the DEFAULT and needs no person.
  printPresenceCeiling()

  if (typeof directory !== 'string' || directory.length === 0) {
    return Object.freeze({ ok: false, reason: MACHINE_ANSWER_REFUSE.NO_MACHINE_KEY })
  }
  let kept
  try {
    kept = readKeptMachineSeed({ directory, custodian: 'file' })
  } catch {
    return Object.freeze({ ok: false, reason: MACHINE_ANSWER_REFUSE.NO_MACHINE_KEY })
  }
  if (typeof kept?.ed25519SeedHex !== 'string' || !SEED_HEX.test(kept.ed25519SeedHex)
    || typeof kept?.ed25519PublicKeyHex !== 'string' || !DIGEST.test(kept.ed25519PublicKeyHex)) {
    return Object.freeze({ ok: false, reason: MACHINE_ANSWER_REFUSE.NO_MACHINE_KEY })
  }
  if (record !== undefined && isRecordLike(record)
    && !listedMachines(record).includes(kept.ed25519PublicKeyHex)) {
    return Object.freeze({ ok: false, reason: MACHINE_ANSWER_REFUSE.NOT_LISTED_BY_THE_RECORD })
  }
  return Object.freeze({
    ok: true,
    signer: Object.freeze({
      machineIndex: typeof kept.machineIndex === 'number' ? kept.machineIndex : 0,
      ed25519SeedHex: kept.ed25519SeedHex,
      ed25519PublicKeyHex: kept.ed25519PublicKeyHex,
      ed25519DidKey: didKeyFromEd25519PublicKey(kept.ed25519PublicKeyHex),
      kdf: AUMLOK_MACHINE_KDF,
      // THE SIGNER SAYS, IN ITS OWN RECORD, THAT IT DID NOT USE THE WORDS. A caller reading a signer
      // it did not create can then see the claim rather than infer it from the absence of a parameter.
      phraseUsed: false,
    }),
  })
}

/** A value shaped like a v3 record: enough to read `publicRoot.machines`, and no more. */
function isRecordLike(value) {
  return typeof value === 'object' && value !== null && typeof value.publicRoot === 'object'
    && value.publicRoot !== null
}

/**
 * Answer one approval with the machine key, NAMING the key that answered.
 *
 * THE SUBJECT AND THE EPOCH COME FROM THE RECORD, not from the caller, so an answer cannot be about an
 * identity the record does not serve. The epoch may be named explicitly — a caller settling an older
 * record asks about that record's epoch — and anything that is not a non-negative integer is refused.
 * @param {{signer: object, record: object, epoch?: number}} input - the signer from
 *   {@link openMachineSignerV3}, the record it answers for, and optionally the epoch.
 * @returns {Readonly<object>} a named answer, or a named refusal with `answered: false`.
 */
export function answerApprovalV3({ signer, record, epoch } = /** @type {never} */ ({})) {
  const refuse = reason => Object.freeze({ answered: false, reason })
  if (!isRecordLike(record) || typeof record.publicRoot.rootId !== 'string') {
    return refuse(MACHINE_ANSWER_REFUSE.RECORD_MALFORMED)
  }
  if (typeof signer?.ed25519SeedHex !== 'string' || !SEED_HEX.test(signer.ed25519SeedHex)
    || typeof signer?.ed25519PublicKeyHex !== 'string' || !DIGEST.test(signer.ed25519PublicKeyHex)) {
    return refuse(MACHINE_ANSWER_REFUSE.NO_MACHINE_KEY)
  }
  if (!listedMachines(record).includes(signer.ed25519PublicKeyHex)) {
    return refuse(MACHINE_ANSWER_REFUSE.NOT_LISTED_BY_THE_RECORD)
  }
  const answerEpoch = epoch === undefined ? record.publicRoot.epoch : epoch
  if (typeof answerEpoch !== 'number' || !Number.isSafeInteger(answerEpoch) || answerEpoch < 0) {
    return refuse(MACHINE_ANSWER_REFUSE.EPOCH_MALFORMED)
  }
  let subject
  try {
    subject = recordProjection(record).subject
  } catch {
    return refuse(MACHINE_ANSWER_REFUSE.RECORD_MALFORMED)
  }
  if (typeof subject !== 'string' || !SUBJECT.test(subject)) return refuse(MACHINE_ANSWER_REFUSE.RECORD_MALFORMED)
  const signed = signOperation({
    operation: MACHINE_ANSWER_ACT, subject, epoch: answerEpoch, machine: signer, signer: 'machine',
  })
  return Object.freeze({
    domain: MACHINE_ANSWER_DOMAIN,
    answered: true,
    act: MACHINE_ANSWER_ACT,
    subject,
    epoch: answerEpoch,
    by: Object.freeze({
      class: MACHINE_ANSWER_CLASS,
      machineIndex: typeof signer.machineIndex === 'number' ? signer.machineIndex : 0,
      keyId: typeof signer.ed25519DidKey === 'string'
        ? signer.ed25519DidKey
        : didKeyFromEd25519PublicKey(signer.ed25519PublicKeyHex),
      ed25519: signer.ed25519PublicKeyHex,
    }),
    signature: signed.signature,
  })
}

/**
 * Read one signer answer, and refuse anything that does not name the key that made it.
 *
 * A BOOLEAN IS NOT AN ANSWER. Neither is `undefined`, nor an object carrying a signature with no name
 * beside it: all three leave a caller unable to say WHICH key acted, and "every receipt names which key
 * acted" is the plan's own requirement. The refusal is named so a caller can print why.
 * @param {unknown} value - the candidate answer.
 * @returns {Readonly<{ok: true, by: object, subject: string, epoch: number, signature: string}> |
 *   Readonly<{ok: false, reason: string}>} the named answer, or `NOT_NAMED`.
 */
export function readSignerAnswer(value) {
  const refuse = reason => Object.freeze({ ok: false, reason })
  if (typeof value !== 'object' || value === null || value.answered !== true) {
    return refuse(MACHINE_ANSWER_REFUSE.NOT_NAMED)
  }
  const by = value.by
  if (typeof by !== 'object' || by === null || by.class !== MACHINE_ANSWER_CLASS
    || typeof by.ed25519 !== 'string' || !DIGEST.test(by.ed25519)
    || typeof by.keyId !== 'string' || by.keyId.length === 0
    || typeof by.machineIndex !== 'number' || !Number.isSafeInteger(by.machineIndex)
    || typeof value.signature !== 'string' || value.signature.length === 0) {
    return refuse(MACHINE_ANSWER_REFUSE.NOT_NAMED)
  }
  return Object.freeze({
    ok: true,
    by: Object.freeze({ ...by }),
    subject: value.subject,
    epoch: value.epoch,
    signature: value.signature,
  })
}

/**
 * Verify a named answer against the record it claims to answer for.
 *
 * THE CONVENIENCE THAT KEEPS THE TWO HALVES TOGETHER: `readSignerAnswer` says the answer names a key,
 * and this says the signature is that key's over this identity and epoch. A caller that only did the
 * first would be reading a name it never checked.
 * @param {{answer: unknown, record: object}} input - the answer and the record.
 * @returns {Readonly<{ok: boolean, reason?: string, class?: string, by?: object}>} the verdict.
 */
export function verifySignerAnswer({ answer, record } = /** @type {never} */ ({})) {
  const read = readSignerAnswer(answer)
  if (read.ok !== true) return read
  const subject = (() => {
    try {
      return recordProjection(record).subject
    } catch {
      return null
    }
  })()
  if (subject === null || read.subject !== subject) {
    return Object.freeze({ ok: false, reason: MACHINE_ANSWER_REFUSE.RECORD_MALFORMED })
  }
  const verdict = verifyRootClassAct({
    act: MACHINE_ANSWER_ACT, subject: read.subject, epoch: read.epoch, signature: read.signature,
    signerKeyHex: read.by.ed25519, record, machines: record?.publicRoot?.machines ?? [],
  })
  if (verdict.ok !== true) return Object.freeze({ ok: false, reason: verdict.reason })
  return Object.freeze({ ok: true, class: verdict.class, by: read.by })
}

/**
 * The exact bytes an answer's signature covers, exposed so a caller can re-derive them.
 * @param {{subject: string, epoch: number}} input - the identity and epoch the answer names.
 * @returns {Buffer} the canonical bytes.
 */
export function machineAnswerSigningBytes({ subject, epoch } = /** @type {never} */ ({})) {
  return rootClassSigningBytes({ act: MACHINE_ANSWER_ACT, subject, epoch })
}
