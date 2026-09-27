/**
 * THE REFRESH AND THE HANDOVER: a new root, one line signed by the old key, and a chain that walks.
 *
 * WHY THIS MODULE EXISTS. `bind` establishes an identity once: `deriveRootFromPhrase` mints a root,
 * `buildGenesisV3` fixes the subject as the epoch-0 root plus a nonce, `buildRecordV3` publishes it.
 * Nothing could mint a SECOND root under the SAME subject, so the plan's refresh — "a new phrase is
 * drawn, shown once, typed back; a new root is minted; the old key signs one handover line so her
 * memory chain continues" — had no implementation at all. Without it the only way to change the words
 * is to become a different person, and the only way to keep the memory is to never change them.
 *
 * THREE THINGS, AND EACH ONE IS A SEPARATE FAILURE IF IT IS MISSING:
 *
 *   1. THE SUBJECT IS CARRIED, NEVER RE-DERIVED. A refresh reads the genesis out of the record it is
 *      refreshing and carries it byte-for-byte. The new root supplies only `rootId` and the keys,
 *      which is what "rootId names only the current keys" means. A refresh that passed its own nonce
 *      would produce a new subject that looks like a successful refresh and silently orphans every
 *      Kira record written under the old one — so a `genesisNonce` argument is REFUSED BY NAME rather
 *      than ignored, and an `expectSubject` that does not match the directory is refused BEFORE
 *      anything is written.
 *
 *   2. THE OLD KEY SIGNS EXACTLY ONE LINE. Not a bundle, not a re-signed chain, not the new key
 *      vouching for itself: one record, signed by the root the OLD record published, whose signed
 *      bytes contain the subject, the epoch, the genesis reference, BOTH root ids and the moment.
 *      That last part is what "binding old to new" means: a signature that covered only the subject
 *      and the epoch would still verify after someone moved `toRootId` to a key of their own, so the
 *      root ids are inside the preimage and `verifyHandoverV3` re-derives it from the parsed record.
 *
 *   3. THE CHAIN WALKS. Each record publishes `succession[]`, one line per refresh. `verifySuccessionV3`
 *      walks it from the root the genesis names (`genesis.initialRootKeySetId`) to the root the record
 *      currently publishes, checking that every link carries the same subject, that the epochs are
 *      consecutive, that the links join, and that every signature verifies under the key it names.
 *      A record whose chain was truncated, re-linked or re-subjected is refused, by name.
 *
 * WHAT A REFRESH DOES TO THE MACHINE KEYS. The new epoch's machine 0 is derived from the new root and
 * kept on this machine, so approvals keep signing without the words being typed again. The PREVIOUS
 * epoch's machine keys are NOT carried into the new record's `machines[]`: they belong to a root this
 * one replaced, and a key that survived a refresh would be a key nobody re-authorised.
 *
 * THE ROOT SEED IS TRANSIENT HERE, AS EVERYWHERE ELSE. `oldRoot` and `newRoot` arrive derived from the
 * two phrases typed during the ceremony and are not stored, returned or logged by this module; what is
 * kept beside the record is the machine key, exactly as `bind` keeps it.
 *
 * @module @aukora/dsh-plugin-aumlok/refresh-v3
 */
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { canonicalJSON } from './canonical.mjs'
import { assertHandle, ed25519FromSeed } from './derive-v3.mjs'
import { subjectFromGenesis } from './genesis-v3.mjs'
import { deriveMachineKeyV3 } from './machine-key-v3.mjs'
import {
  buildRecordV3,
  isRecordV3,
  keepMachineSeed,
  recordProjection,
  writeRecordV3,
} from './record-v3.mjs'
// THE RECORD'S FILENAME COMES FROM ITS READER, not from a second spelling here: `store.mjs` owns the
// name the loader looks for, so a refresh cannot write a file the loader never opens.
import { LOCAL_AUMLOK_CONTROL_FILENAME } from './store.mjs'
import { verifyEd25519 } from './ed25519-verify.mjs'

/** Domain of one handover line. Pinned as a literal, so a change is visible in a diff. */
export const HANDOVER_DOMAIN = 'aukora:aumlok-handover:v3'

/** Domain separation for the handover's signing preimage. Distinct from the root-class act's. */
export const HANDOVER_SIGNING_DOMAIN = 'aukora:aumlok-handover-signature:v3'

/**
 * The exact fields of one handover line, and nothing else. A closed record or it is not a handover.
 *
 * `handle` IS IN THE SIGNED SET AND IS OPTIONAL, WHICH IS NOT A CONTRADICTION. It is signed when the
 * record being handed over carries one, because the handle is HALF THE KEY (`aumlok-kdf-v1`): a chain
 * whose published handle can be edited between epochs is a chain that can tell a person to type the
 * wrong handle on a new machine and derive a different root from the same seven words. It is OPTIONAL
 * because the disposable fixtures derive from a seed rather than a person's handle and publish none —
 * `verifySuccessionV3` holds the two sides CONSISTENT rather than requiring either shape.
 */
export const HANDOVER_FIELDS = Object.freeze([
  'domain', 'subject', 'epoch', 'fromRootId', 'toRootId', 'genesisRef', 'handoverAt',
  'signerKeyHex', 'signature', 'handle',
])

/** Refusals this module produces by name. Stable strings; a caller renders them, never parses prose. */
export const REFRESH_REFUSE = Object.freeze({
  RECORD_MALFORMED: 'aumlok:refresh-record-malformed',
  GENESIS_ABSENT: 'aumlok:refresh-genesis-absent',
  OLD_ROOT_MISMATCH: 'aumlok:refresh-old-root-mismatch',
  NEW_ROOT_MALFORMED: 'aumlok:refresh-new-root-malformed',
  ROOT_DID_NOT_MOVE: 'aumlok:refresh-root-did-not-move',
  NONCE_SUPPLIED: 'aumlok:refresh-genesis-nonce-supplied',
  SUBJECT_MISMATCH: 'aumlok:refresh-subject-mismatch',
  HANDOVER_MALFORMED: 'aumlok:refresh-handover-malformed',
  HANDOVER_SIGNATURE_INVALID: 'aumlok:refresh-handover-signature-invalid',
  HANDOVER_HANDLE_MOVED: 'aumlok:refresh-handle-moved',
  SUCCESSION_BROKEN: 'aumlok:refresh-succession-broken',
  SUCCESSION_SUBJECT_MOVED: 'aumlok:refresh-succession-subject-moved',
})

/** A refresh this module will not perform. */
export class RefreshV3Error extends TypeError {
  /**
   * @param {string} code - one {@link REFRESH_REFUSE} value.
   * @param {string} detail - the observed defect, in a sentence a person can act on.
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'RefreshV3Error'
    this.code = code
  }
}

const DIGEST = /^[0-9a-f]{64}$/u
const REF24 = /^[0-9a-f]{24}$/u
const SUBJECT = /^aukora:1:[0-9a-f]{64}$/u
const SEED_HEX = /^[0-9a-f]{64}$/u
const PUB_HEX = /^[0-9a-f]{64}$/u

/** PKCS#8 DER prefix wrapping a raw 32-byte Ed25519 seed. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
/** SPKI DER prefix wrapping a raw 32-byte Ed25519 public key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/** The subject one record's own genesis hashes to, or a named refusal when it has no genesis. */
function subjectOfRecord(record) {
  const genesis = record?.publicRoot?.genesis
  if (typeof genesis !== 'object' || genesis === null) {
    throw new RefreshV3Error(REFRESH_REFUSE.GENESIS_ABSENT,
      'this record carries no genesis, so it names no subject to carry across a refresh: a record '
      + 'written before the subject became the genesis cannot be refreshed without re-naming the person')
  }
  return subjectFromGenesis({ genesis })
}

/**
 * The exact bytes one handover line signs.
 *
 * BOTH ROOT IDS AND THE GENESIS REFERENCE ARE INSIDE, and that is the whole difference between a
 * handover and a receipt: a signature over `{subject, epoch}` alone would survive someone editing
 * `toRootId` to a key of their own, so the line would bind nothing. `handle` IS INSIDE TOO, WHEN THE
 * LINE CARRIES ONE, for the same reason and a different consequence: the handle salts the KDF, so a
 * signer that vouched for `toRootId` while leaving the handle editable would let a record tell its
 * owner to type a handle that derives a root nobody signed for. ABSENT IS OMITTED RATHER THAN SIGNED
 * AS `undefined`, so a handle-less fixture line signs byte-for-byte what it signed before.
 * Re-derived from the parsed record by the verifier, never accepted as a preimage a caller supplied.
 * @param {{subject: string, epoch: number, fromRootId: string, toRootId: string, genesisRef: string,
 *   handoverAt: string, handle?: string}} line - the handover's signed fields.
 * @returns {Buffer} the canonical bytes.
 */
export function handoverSigningBytes(line) {
  return Buffer.from(`${HANDOVER_SIGNING_DOMAIN}\u0000${canonicalJSON({
    subject: line.subject,
    epoch: line.epoch,
    fromRootId: line.fromRootId,
    toRootId: line.toRootId,
    genesisRef: line.genesisRef,
    handoverAt: line.handoverAt,
    ...(typeof line.handle === 'string' ? { handle: line.handle } : {}),
  })}`, 'utf8')
}

/**
 * Whether one value is a handover line of the closed shape, with no private material in it.
 *
 * `handle`, WHEN PRESENT, IS HELD TO THE DERIVATION CONTRACT'S OWN SHAPE (`assertHandle`), so a line
 * cannot smuggle an out-of-contract name into a chain that signs it: the salt hashes the NORMALISED
 * handle, so a line carrying `" Anchor "` would sign bytes no derivation can reproduce.
 */
function isHandoverShape(line) {
  if (!(typeof line === 'object' && line !== null
    && line.domain === HANDOVER_DOMAIN
    && typeof line.subject === 'string' && SUBJECT.test(line.subject)
    && typeof line.epoch === 'number' && Number.isSafeInteger(line.epoch) && line.epoch > 0
    && typeof line.fromRootId === 'string' && DIGEST.test(line.fromRootId)
    && typeof line.toRootId === 'string' && DIGEST.test(line.toRootId)
    && typeof line.genesisRef === 'string' && REF24.test(line.genesisRef)
    && typeof line.handoverAt === 'string' && line.handoverAt.length > 0
    && typeof line.signerKeyHex === 'string' && PUB_HEX.test(line.signerKeyHex)
    && typeof line.signature === 'string' && line.signature.length > 0)) {
    return false
  }
  if (line.handle === undefined) return true
  try {
    return assertHandle(line.handle) === line.handle
  } catch {
    return false
  }
}

/** Verify one signature over the handover's own bytes, under the key the line names. */
function handoverSignatureHolds(line) {
  try {
    // **THE SAME VERIFIER AS root-class-v3 (row 15).** Two sites deciding the same question two ways is how one
    // organ accepts what another refuses; this one now asks the repository's verifier, which checks the POINT
    // before it asks the library.
    return verifyEd25519({
      publicKeyHex: line.signerKeyHex,
      message: handoverSigningBytes(line),
      signatureHex: line.signature,
    })
  } catch {
    return false
  }
}

/**
 * Build the ONE handover line that carries an identity from its old root to its new one.
 *
 * THE OLD ROOT SIGNS, AND IT IS THE ROOT THE RECORD PUBLISHES. `oldRoot` is the transient derivation
 * of the phrase the person typed to authorise this refresh; the check below is that it really is the
 * key the record names, so a caller holding some other root cannot hand over this identity. A refresh
 * to the SAME root is refused too: it would produce a handover that hands nothing over, and an epoch
 * that moved while the keys did not.
 * @param {{record: object, oldRoot: object, newRoot: object, handoverAt: string}} input - the record
 *   being refreshed, the transient old and new roots, and the moment.
 * @returns {Readonly<object>} the handover line.
 */
export function buildHandoverV3({ record, oldRoot, newRoot, handoverAt } = /** @type {never} */ ({})) {
  if (!isRecordV3(record)) {
    throw new RefreshV3Error(REFRESH_REFUSE.RECORD_MALFORMED,
      'a refresh needs the record it is refreshing: a v3 record with a 64-hex publicRoot.rootId')
  }
  if (typeof oldRoot?.ed25519SeedHex !== 'string' || !SEED_HEX.test(oldRoot.ed25519SeedHex)
    || typeof oldRoot.ed25519PublicKeyHex !== 'string' || !PUB_HEX.test(oldRoot.ed25519PublicKeyHex)) {
    throw new RefreshV3Error(REFRESH_REFUSE.OLD_ROOT_MISMATCH,
      'a handover is signed by the OLD root, so the old root must be the transient derivation of the '
      + 'phrase that was typed, not a reference to a file')
  }
  if (oldRoot.ed25519PublicKeyHex !== record.publicRoot.ed25519) {
    throw new RefreshV3Error(REFRESH_REFUSE.OLD_ROOT_MISMATCH,
      `the root offered as the old one derives ${oldRoot.ed25519PublicKeyHex.slice(0, 16)}…, and the `
      + `record publishes ${String(record.publicRoot.ed25519).slice(0, 16)}…: this is not the key that `
      + 'may hand this identity over')
  }
  if (typeof newRoot?.rootId !== 'string' || !DIGEST.test(newRoot.rootId)) {
    throw new RefreshV3Error(REFRESH_REFUSE.NEW_ROOT_MALFORMED,
      'a refresh needs the NEW root: the derivation of the phrase that was just typed and shown')
  }
  if (newRoot.rootId === record.publicRoot.rootId) {
    throw new RefreshV3Error(REFRESH_REFUSE.ROOT_DID_NOT_MOVE,
      'the new root is the old root, so this refresh would move the epoch and hand nothing over')
  }
  if (typeof handoverAt !== 'string' || handoverAt.length === 0) {
    throw new RefreshV3Error(REFRESH_REFUSE.HANDOVER_MALFORMED,
      'a handover names the moment it was signed; an empty one cannot be ordered against the chain')
  }
  const subject = subjectOfRecord(record)
  // THE HANDLE IS CARRIED, NOT RE-DERIVED, AND IT IS INSIDE THE SIGNED BYTES. `aumlok-kdf-v1` salts
  // the KDF with `NFKC(handle).toLowerCase()`, so the handle is half of the key: a handover signed only
  // over the two root ids would still verify after someone edited the record's published handle, and
  // the person following it on a new machine would type a handle that derives a root nobody signed for.
  const handle = record.publicRoot.handle === undefined ? undefined : assertHandle(record.publicRoot.handle)
  const line = {
    domain: HANDOVER_DOMAIN,
    subject,
    epoch: (typeof record.publicRoot.epoch === 'number' ? record.publicRoot.epoch : 0) + 1,
    fromRootId: record.publicRoot.rootId,
    toRootId: newRoot.rootId,
    genesisRef: record.publicRoot.genesisRef,
    handoverAt,
  }
  const pair = ed25519FromSeed(Buffer.from(oldRoot.ed25519SeedHex, 'hex'))
  // ONE OBJECT SIGNED AND RETURNED, so the bytes that were signed and the line that is published cannot
  // be assembled twice and disagree.
  const signed = { ...line, ...(handle === undefined ? {} : { handle }) }
  return Object.freeze({
    ...signed,
    signerKeyHex: oldRoot.ed25519PublicKeyHex,
    signature: sign(null, handoverSigningBytes(signed), pair.privateKey).toString('hex'),
  })
}

/**
 * Verify one handover line against the record it claims to hand over.
 *
 * THE ORDER OF THE CHECKS IS THE POINT: the signer is compared with the key the record publishes
 * BEFORE the signature is looked at, so a line signed by a machine key, by the new root, or by a
 * stranger is refused for WHAT IT IS rather than for a cryptographic detail a caller would have to
 * interpret. {@link REFRESH_REFUSE.OLD_ROOT_MISMATCH} is that refusal.
 * @param {{handover: unknown, record: unknown}} input - the line and the record it is presented with.
 * @returns {Readonly<{ok: true, fromRootId: string, toRootId: string, subject: string, epoch: number}> |
 *   Readonly<{ok: false, reason: string}>} the verdict, never an exception.
 */
export function verifyHandoverV3({ handover, record } = /** @type {never} */ ({})) {
  const refuse = reason => Object.freeze({ ok: false, reason })
  if (!isRecordV3(record)) return refuse(REFRESH_REFUSE.RECORD_MALFORMED)
  if (!isHandoverShape(handover)) return refuse(REFRESH_REFUSE.HANDOVER_MALFORMED)
  if (handover.signerKeyHex !== record.publicRoot.ed25519) return refuse(REFRESH_REFUSE.OLD_ROOT_MISMATCH)
  if (handover.fromRootId !== record.publicRoot.rootId) return refuse(REFRESH_REFUSE.OLD_ROOT_MISMATCH)
  let subject
  try {
    subject = subjectOfRecord(record)
  } catch {
    return refuse(REFRESH_REFUSE.GENESIS_ABSENT)
  }
  if (handover.subject !== subject) return refuse(REFRESH_REFUSE.SUBJECT_MISMATCH)
  if (handover.genesisRef !== record.publicRoot.genesisRef) return refuse(REFRESH_REFUSE.SUBJECT_MISMATCH)
  const recordEpoch = typeof record.publicRoot.epoch === 'number' ? record.publicRoot.epoch : 0
  if (handover.epoch !== recordEpoch + 1) return refuse(REFRESH_REFUSE.HANDOVER_MALFORMED)
  if (!handoverSignatureHolds(handover)) return refuse(REFRESH_REFUSE.HANDOVER_SIGNATURE_INVALID)
  return Object.freeze({
    ok: true, fromRootId: handover.fromRootId, toRootId: handover.toRootId,
    subject: handover.subject, epoch: handover.epoch,
  })
}

/**
 * Walk a record's succession chain from the root its genesis names to the root it publishes.
 *
 * WHAT A PUBLIC VERIFIER CAN CHECK WITHOUT THE EARLIER RECORDS, AND WHAT IT CANNOT. It can check that
 * every link carries one subject, that the epochs are consecutive, that each link starts where the
 * previous one ended, that the first starts at `genesis.initialRootKeySetId`, that the last ends at the
 * current `rootId`, that no link was signed by the key that is current NOW, and that every signature
 * verifies over the link's own bytes — which include both root ids AND the handle, so a re-linked chain
 * or a re-handled one is refused. It cannot check a link's signer against the record of ITS epoch,
 * because that record is not in hand; a verifier that has it should verify that link with
 * {@link verifyHandoverV3} instead. NOR CAN IT RE-DERIVE A ROOT FROM A HANDLE AND A PHRASE, which is
 * the one thing that would prove a link's `toRootId` really came from the handle it carries: the words
 * are not in the record and never will be. What it CAN do — and now does — is refuse a chain whose
 * published handle is not the SAME at every link, so the one public fact that says which handle to type
 * on a new machine cannot be edited in place, dropped, or introduced halfway along.
 * @param {{record: unknown}} input - the record whose chain to walk.
 * @returns {Readonly<{ok: true, links: number, subject: string, rootId: string}> |
 *   Readonly<{ok: false, reason: string}>} the verdict, never an exception.
 */
export function verifySuccessionV3({ record } = /** @type {never} */ ({})) {
  const refuse = reason => Object.freeze({ ok: false, reason })
  if (!isRecordV3(record)) return refuse(REFRESH_REFUSE.RECORD_MALFORMED)
  const links = record.publicRoot.succession
  const epoch = typeof record.publicRoot.epoch === 'number' ? record.publicRoot.epoch : 0
  if (!Array.isArray(links) || links.length !== epoch) {
    // THE EPOCH IS THE LENGTH OF THE CHAIN, so a truncated chain is refused rather than walked: a
    // record at epoch 2 with no lines is a record that forgot how it got here.
    return refuse(REFRESH_REFUSE.SUCCESSION_BROKEN)
  }
  let subject
  try {
    subject = subjectOfRecord(record)
  } catch {
    return refuse(REFRESH_REFUSE.GENESIS_ABSENT)
  }
  // THE HANDLE IS THE RECORD'S OWN, NORMALISED, OR ABSENT — and the two shapes below are held to it.
  // THE COMPARISON IS THE PUBLISHED FIELD BEFORE ANY LINK IS READ, so a chain that carries a handle
  // while the record publishes none (or the reverse) is refused rather than quietly believed.
  const recordHandle = record.publicRoot.handle === undefined
    ? undefined
    : assertHandle(record.publicRoot.handle)
  if (links.length === 0) {
    return Object.freeze({ ok: true, links: 0, subject, rootId: record.publicRoot.rootId })
  }
  const genesisRoot = record.publicRoot.genesis?.initialRootKeySetId
  if (typeof genesisRoot !== 'string' || !DIGEST.test(genesisRoot)) return refuse(REFRESH_REFUSE.SUCCESSION_BROKEN)
  let expectedFrom = genesisRoot
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index]
    if (!isHandoverShape(link)) return refuse(REFRESH_REFUSE.SUCCESSION_BROKEN)
    if (link.subject !== subject) return refuse(REFRESH_REFUSE.SUCCESSION_SUBJECT_MOVED)
    if (link.genesisRef !== record.publicRoot.genesisRef) return refuse(REFRESH_REFUSE.SUCCESSION_SUBJECT_MOVED)
    // THE HANDLE IS HALF THE KEY, SO IT IS HALF THE CHAIN. Every link must carry the handle the record
    // publishes, exactly — an absent one and a different one are both refusals by name, because either
    // tells the person following this chain on a new machine to salt their words with something the
    // handover never signed. This is also what makes the handle TAMPER-EVIDENT: it is inside
    // `handoverSigningBytes`, so editing a link's handle breaks its signature as well.
    if (link.handle !== recordHandle) return refuse(REFRESH_REFUSE.HANDOVER_HANDLE_MOVED)
    if (link.epoch !== index + 1) return refuse(REFRESH_REFUSE.SUCCESSION_BROKEN)
    if (link.fromRootId !== expectedFrom) return refuse(REFRESH_REFUSE.SUCCESSION_BROKEN)
    if (link.signerKeyHex === record.publicRoot.ed25519) return refuse(REFRESH_REFUSE.SUCCESSION_BROKEN)
    if (!handoverSignatureHolds(link)) return refuse(REFRESH_REFUSE.SUCCESSION_BROKEN)
    expectedFrom = link.toRootId
  }
  if (expectedFrom !== record.publicRoot.rootId) return refuse(REFRESH_REFUSE.SUCCESSION_BROKEN)
  return Object.freeze({ ok: true, links: links.length, subject, rootId: record.publicRoot.rootId })
}

/** The genesis object `buildRecordV3` needs, rebuilt from the record a refresh is carrying it out of. */
function carriedGenesis(record, subject) {
  return Object.freeze({
    genesis: record.publicRoot.genesis,
    genesisNonce: record.publicRoot.genesisNonce,
    genesisRef: record.publicRoot.genesisRef,
    subject,
    carried: true,
  })
}

/** Read the record out of the directory a refresh is about to change. */
function readRecordIn(directory) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(join(directory, LOCAL_AUMLOK_CONTROL_FILENAME), 'utf8'))
  } catch (cause) {
    throw new RefreshV3Error(REFRESH_REFUSE.RECORD_MALFORMED,
      `${join(directory, LOCAL_AUMLOK_CONTROL_FILENAME)} could not be read as a record: `
      + `${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!isRecordV3(parsed)) {
    throw new RefreshV3Error(REFRESH_REFUSE.RECORD_MALFORMED,
      `${join(directory, LOCAL_AUMLOK_CONTROL_FILENAME)} is not a v3 record, so there is no bound `
      + 'identity here to refresh')
  }
  return parsed
}

/**
 * Perform one refresh, in the order that leaves the directory honest at every step.
 *
 * THE SUBJECT IS CHECKED BEFORE ANYTHING IS WRITTEN, and the check is a real one rather than a
 * formality: `expectSubject` is what a caller that has already read the identity pins, and a
 * directory whose subject is not that value is refused with NOTHING written. Without the check a
 * refresh aimed at the wrong directory would replace a record and move an epoch in a place nobody
 * looked; with it, the refusal is the whole of the effect.
 *
 * A CALLER-PASSED NONCE IS REFUSED, NOT IGNORED, because ignoring it would produce a successful-looking
 * refresh under a different subject than the caller believed.
 * @param {{directory: string, oldRoot: object, newRoot: object, refreshedAt: string,
 *   expectSubject?: string, genesisNonce?: string}} input - where to refresh, the two transient roots,
 *   the moment, and the subject the caller believes this directory serves.
 * @returns {Readonly<{record: object, handover: object, projection: object, machine: object,
 *   written: object, kept: object}>} the new record and everything that produced it.
 */
export function refreshBindingV3({ directory, oldRoot, newRoot, refreshedAt, expectSubject,
  genesisNonce } = /** @type {never} */ ({})) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new RefreshV3Error(REFRESH_REFUSE.RECORD_MALFORMED, 'a refresh needs the directory to refresh')
  }
  if (genesisNonce !== undefined) {
    throw new RefreshV3Error(REFRESH_REFUSE.NONCE_SUPPLIED,
      'the genesis nonce belongs to the first binding and is CARRIED, never supplied again: a refresh '
      + 'that invented one would derive a new subject and re-name the person while reporting success')
  }
  const record = readRecordIn(directory)
  const subject = subjectOfRecord(record)
  if (expectSubject !== undefined && expectSubject !== subject) {
    throw new RefreshV3Error(REFRESH_REFUSE.SUBJECT_MISMATCH,
      `this directory serves ${subject}, and the refresh expected ${String(expectSubject)}: refusing `
      + 'before anything is written, because a refresh aimed at the wrong identity is how one person\'s '
      + 'chain is replaced with another\'s')
  }
  if (typeof refreshedAt !== 'string' || refreshedAt.length === 0) {
    throw new RefreshV3Error(REFRESH_REFUSE.HANDOVER_MALFORMED, 'a refresh names the moment it happened')
  }
  const handover = buildHandoverV3({ record, oldRoot, newRoot, handoverAt: refreshedAt })
  // THE HANDLE IS CARRIED, NOT RE-DERIVED, AND NOT RE-CHOSEN. `aumlok-kdf-v1` salts the KDF with it,
  // so it is HALF THE KEY: the plan refreshes the WORDS, never the name, and a record whose published
  // handle silently became absent (the defect this line fixes — before it, `handle` was simply not
  // passed here and one refresh dropped it from the record, from `recordProjection` and from
  // `loadLocalAumlokPublicControl`) or silently became a different one is a record whose owner cannot
  // tell which handle to type on a new machine. It is read from the record's own bytes through the same
  // `assertHandle` the salt uses, so a record carrying an out-of-contract handle is refused here rather
  // than re-published. A `handle` ARGUMENT IS DELIBERATELY NOT ACCEPTED: a caller that could pass one
  // could re-name the identity across a refresh, which is the failure this whole branch is about.
  const carriedHandle = record.publicRoot.handle === undefined
    ? undefined
    : assertHandle(record.publicRoot.handle)
  // THE NEW EPOCH'S MACHINE 0, derived from the new root so this machine keeps signing without the
  // words. The PREVIOUS epoch's machine keys are deliberately not carried: they were authorised by a
  // root this one replaces, and a key that survived a refresh is a key nobody re-authorised.
  const machine = deriveMachineKeyV3({ root: newRoot, machineIndex: 0 })
  const succession = Object.freeze([
    ...(Array.isArray(record.publicRoot.succession) ? record.publicRoot.succession : []),
    handover,
  ])
  const epoch = (typeof record.publicRoot.epoch === 'number' ? record.publicRoot.epoch : 0) + 1

  // THE RETIREMENT IS WRITTEN DOWN, AND THIS IS WHAT `revokedMachines[]` EXISTS FOR.
  //
  // MEASURED BY `scripts/aumlok/rehearse-rotation.mjs` BEFORE THIS LINE EXISTED: after a rotation,
  // `machines[]` held only the new epoch's key and `revokedMachines` was EMPTY. The rotation left no door
  // open — a key absent from `machines[]` is refused as not-listed — but the record could not tell "this
  // laptop was rotated away" from "this key was never registered here", and that made
  // `aumlok:machine-revoked` UNREACHABLE FOR THE ONE EVENT THAT MOST OBVIOUSLY RETIRES A MACHINE. The
  // refusal exists to tell an operator "the identity retired this machine"; after a rotation they got
  // "not listed by the record" instead, which sends them to re-bind rather than to the truth.
  //
  // THE ENTRY IS `{ed25519}` PLUS THE TWO FACTS THAT MAKE IT USEFUL — when it was retired and by which
  // epoch. `{ed25519}` is the shape the selector reads (`revokedMachinesOf`), so the key is what carries
  // the rule; the other two are for a person reading the record afterwards.
  //
  // AND EARLIER RETIREMENTS ARE CARRIED FORWARD. A rotation of a rotation must not forget the first
  // retired key: the list is the identity's MEMORY of what it has retired, so dropping the previous
  // entries would re-open the question this field answers. An entry already present is not duplicated.
  const alreadyRevoked = Array.isArray(record.publicRoot.revokedMachines)
    ? record.publicRoot.revokedMachines
    : []
  const retiredNow = (Array.isArray(record.publicRoot.machines) ? record.publicRoot.machines : [])
    .filter(entry => typeof entry?.ed25519 === 'string' && /^[0-9a-f]{64}$/u.test(entry.ed25519))
    .filter(entry => !alreadyRevoked.some(prior => prior?.ed25519 === entry.ed25519))
    .map(entry => Object.freeze({
      ed25519: entry.ed25519,
      revokedAt: refreshedAt,
      revokedByEpoch: epoch,
    }))
  const revokedMachines = [...alreadyRevoked, ...retiredNow]
  const next = buildRecordV3({
    root: newRoot,
    boundAt: refreshedAt,
    epoch,
    receipt: record.publicRoot.receipt ?? null,
    genesis: carriedGenesis(record, subject),
    machines: [{ index: machine.machineIndex, ed25519: machine.ed25519PublicKeyHex }],
    ...(revokedMachines.length === 0 ? {} : { revokedMachines }),
    succession,
    ...(carriedHandle === undefined ? {} : { handle: carriedHandle }),
  })
  const written = writeRecordV3({ record: next, directory })
  const keptMachine = keepMachineSeed(machine, { directory })
  // THE ROOT IS KEPT NOWHERE (Y1, 2026-09-23): see bind-v3.mjs. A refresh used to write the same
  // forbidden root seed `bind` was writing, which is why the comment that used to sit here said its
  // kept material "MIRRORS `bind`" — it was mirroring a write that should not have existed. What a
  // refresh keeps is the NEW epoch's machine key and nothing else, and a root-class act re-derives the
  // root from the handle and the seven words instead of reading it off the laptop.
  return Object.freeze({
    record: next,
    handover,
    projection: recordProjection(next),
    machine,
    written,
    kept: Object.freeze({ machine: keptMachine.path, rootKept: false }),
  })
}

/** The private key of one root, for the rare caller that must sign outside this module. */
export function rootPrivateKeyOf(root) {
  if (typeof root?.ed25519SeedHex !== 'string' || !SEED_HEX.test(root.ed25519SeedHex)) {
    throw new RefreshV3Error(REFRESH_REFUSE.OLD_ROOT_MISMATCH, 'a root without its seed cannot sign')
  }
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(root.ed25519SeedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  })
}
