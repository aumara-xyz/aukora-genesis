/**
 * Receipt v3 — export around evidence the broker already signed.
 *
 * The v1 settlement receipt is the authority and stays byte-identical: this
 * module reads it, never rewrites it, and never relabels it. What v3 adds is a
 * document a stranger can check with no repository: the v1 receipt embedded
 * verbatim through its own digest and Aura entry, the grant as issued, the Aura
 * entry as appended, and a NEW signed head statement binding the head this
 * append produced. Nothing already signed is re-signed.
 *
 * WHAT THIS MODULE CANNOT DO, MEASURED 2026-09-15. Three of the inputs the spec
 * names do not exist at settlement in this tree:
 *
 *   1. THE APPROVAL SIGNATURE. `handleApproveArtifact` returns
 *      `{ ok, digest, signature }` (`aukora/issuer/issuer.mjs:783`) and the only
 *      caller of the `approve-artifact` operation anywhere in the repository is a
 *      test (`packages/governed/memory-put/tests/issuer-approval-artifact.spec.ts`).
 *      No product path calls it, so no signed approval reaches a real settlement.
 *      An export built from what a real settlement has is class C at best, and
 *      keyClass C refuses as `human-ceremony` — the CORRECT outcome, not a bug
 *      to route around.
 *   2. A PERSISTED APPROVAL ARTIFACT. The broker re-derives the artifact in
 *      memory and records only its digest (`broker.mjs:1389`, `:1498`, `:1622`);
 *      nothing under `stateDir` holds the artifact.
 *   3. A CHALLENGE IN THE GRANT. A v4 authorization payload is exactly domain,
 *      tool, digest, nonce, exp, definitionId, operationDigest and receiptKeyId.
 *
 * So this step builds the export AROUND WHAT EXISTS and refuses the rest by
 * name. `approval.class` is DERIVED from the evidence presented and never
 * asserted by a caller, and a caller cannot pass one in.
 *
 * @module @aukora/receipt-v3/export
 */
import { createHash, createPublicKey, randomBytes, sign as edSign } from 'node:crypto'
import {
  closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, openSync,
  unlinkSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { readVerifiedChain } from '../aura/record.mjs'
import { RECEIPT_FIELDS } from '../broker/receipt.mjs'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'

/** The v3 evidence kind. */
export const RECEIPT_V3_KIND = 'aukora-receipt/v3'

/** The v3 fixture kind. A fixture is never evidence, and its class says so. */
export const RECEIPT_V3_FIXTURE_KIND = 'aukora-receipt/v3-fixture'

/** The v3 domain. */
export const RECEIPT_V3_DOMAIN = 'aukora:receipt:v3'

/** The head statement domain. */
export const HEAD_STATEMENT_DOMAIN = 'aukora:aura-head:v1'

/** The approval artifact domain, as `aukora/approval/artifact.mjs` defines it. */
export const APPROVAL_ARTIFACT_DOMAIN = 'aukora:approval-artifact:v1'

/** The separator between the approval signed-message domain and its digest. */
export const APPROVAL_SIGNED_DOMAIN = 'aukora:approval-artifact:v1:signed'

/**
 * Directory under `stateDir` holding exported v3 documents.
 *
 * Deliberately NOT `receipts`. `verifyReceiptDirectory` in
 * `aukora/broker/receipt.mjs` treats `receipts/` as a directory whose every
 * regular entry is a canonical v1 receipt named `<sha256>.json` with mode 0600,
 * and refuses `receipt:entry-malformed` for anything else. Writing v3 documents
 * beside their v1 receipts therefore poisoned the next settlement: measured
 * against a real broker, the FIRST settlement wrote `<sha>.json` plus
 * `<sha>.v3.json`, and the SECOND returned
 * `INDETERMINATE — broker:aura-preflight (receipt:entry-malformed)`.
 *
 * A separate directory keeps each invariant checkable on its own terms.
 */
export const RECEIPT_V3_DIRECTORY = 'receipts-v3'

/**
 * The value a time or source carries when the evidence does not contain it.
 *
 * An explicit sentinel rather than a plausible-looking number. A reader can see
 * that an instant is unavailable; a reader cannot see that a repeated export
 * instant was never the settlement time.
 */
export const TIMES_UNAVAILABLE = 'unavailable'

/**
 * The closed vocabulary of instant provenances. A `times` entry that is a number
 * must name one of these in `timesSources`; the verifier enforces the pairing.
 */
export const TIME_SOURCES = Object.freeze([
  'grant-expiry-seconds',
  'approval-recorded',
  'aura-entry-measured',
  'export-instant',
  // Synthetic instants are a named source so a reader can see them, never a
  // silent substitute for evidence that does not exist.
  'fixture-coherent',
])

/** The four instants a v3 document names. */
export const RECEIPT_V3_TIME_FIELDS = Object.freeze(['issuedAt', 'approvedAt', 'settledAt', 'expiresAt'])

/**
 * Fields covered by the document signature, in the order the preimage uses.
 * Declared here rather than imported from the verifier because the verifier
 * must stay out of the authority graph: this module is inside it.
 */
export const RECEIPT_V3_SIGNED_FIELDS = Object.freeze([
  'kind', 'domain', 'nonce', 'operation', 'resource', 'definitionId', 'settlement', 'action',
  'authorization', 'approval', 'delegation', 'publication', 'effect', 'times', 'timesSources',
  'aura', 'head', 'ceilings', 'issuerKeyId',
])

/** Named refusals from the export path. */
export const EXPORT_REFUSE = Object.freeze({
  MALFORMED: 'export:malformed',
  CHAIN_UNAVAILABLE: 'export:chain-unavailable',
  ENTRY_ABSENT: 'export:aura-entry-absent',
  ACTION_DIGEST_MISMATCH: 'export:action-digest-mismatch',
  APPROVAL_INCOMPLETE: 'export:approval-incomplete',
  KEY_CLASS_UNKNOWN: 'export:key-class-unknown',
  ALREADY_EXISTS: 'export:already-exists',
  UNAVAILABLE: 'export:unavailable',
})

const HEX_SHA256 = /^[0-9a-f]{64}$/

/**
 * The nonce alphabet and length, identical to `SAFE_NONCE` in
 * `aukora/broker/receipt.mjs`: `[a-zA-Z0-9_-]{1,128}`.
 *
 * It is deliberately NOT a 32-hex rule. `newNonce()` is 12 random bytes rendered
 * hex, so a real settlement nonce is 24 characters. A stricter rule here refused
 * EVERY live export with `export:malformed — entry nonce`, which no court saw
 * because the fixtures minted 32-character nonces. Measured against a real
 * broker: settleGrantRequest returned `receiptV3Refusal: "export:malformed —
 * entry nonce"` and wrote no `.v3.json` at all.
 */
const SAFE_NONCE = /^[a-zA-Z0-9_-]{1,128}$/

/** sha256 over UTF-8 text. */
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

/** Stable identity of one Ed25519 public key: sha256 over its canonical SPKI DER bytes. */
export function keyIdForPublicKey(publicKey) {
  const key = publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey)
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex')
}

/**
 * The v1 settlement receipt's own canonical digest, exactly as `writeReceipt`
 * computes it: sha256 over `canonicalJSON` of the receipt's fields in
 * {@link RECEIPT_FIELDS} order plus its signature. This is the filename the
 * receipt is stored under and the value the Aura entry records, so it is the
 * join between the two and the reason the v1 receipt can be embedded without
 * being re-encoded.
 *
 * @param {Record<string, unknown>} receipt - a v1 receipt.
 * @returns {string} lowercase hex digest.
 */
export function receiptV1Sha256(receipt) {
  const ordered = {}
  for (const field of [...RECEIPT_FIELDS, 'signature']) ordered[field] = receipt[field] ?? null
  return sha256(canonicalJSON(ordered))
}

/**
 * The class a settlement's own evidence supports.
 *
 * DERIVED, never asserted: no caller can hand this function a class, so a
 * document cannot claim a ceremony its evidence does not show.
 *
 * @param {{signature: string, keyClass: string} | null} approval - a signed approval, or null.
 * @param {{signed: boolean} | null} delegation - a delegation claim, or null.
 * @returns {{class: string, keyClass: string | null, ceilings: string[]}} the derived class and its ceilings.
 * @throws {TypeError} when a key custody class is absent or is class C.
 */
export function deriveApprovalClass(approval, delegation) {
  if (approval !== null && approval !== undefined && typeof approval.signature === 'string') {
    const keyClass = typeof approval.keyClass === 'string' ? approval.keyClass : null
    if (keyClass === null) throw new TypeError(EXPORT_REFUSE.KEY_CLASS_UNKNOWN)
    // A class C key is operator-custodied: readable by the same uid that runs
    // the executor. It can never be graded human-ceremony, and the export says
    // so now rather than emitting a document the verifier refuses later for a
    // reason the exporter could have named.
    if (keyClass === 'C') {
      throw new TypeError(`${EXPORT_REFUSE.APPROVAL_INCOMPLETE} — keyClass C is operator-custodied and is never human-ceremony`)
    }
    const ceilings = []
    if (keyClass === 'B') ceilings.push('OWNER_KEY_SAME_UID')
    ceilings.push('SIGNER_DEVICE_TRUSTED')
    return { class: 'human-ceremony', keyClass, ceilings }
  }
  if (delegation !== null && delegation !== undefined) {
    // Deep has no signed delegation today: `aukora/identity/delegation.mjs`
    // claims are unsigned. The field carries `signed: false` and the ceiling
    // says so rather than implying a signature exists.
    return {
      class: 'delegated',
      keyClass: null,
      ceilings: delegation.signed === true ? [] : ['DELEGATION_UNSIGNED'],
    }
  }
  // NO APPROVAL SIGNATURE IS NOT A FIXTURE.
  //
  // An earlier version returned `scripted` here, which asserted that the
  // settlement came from a fixture path. A real settlement with no owner
  // signature is not scripted: its approval evidence is MISSING, and a reader
  // must be able to tell those apart. `unattributed` is the honest class, and it
  // is deliberately not one an evidence-kind document may carry, so the document
  // refuses `receipt:class-kind-mismatch` rather than being relabelled to pass.
  return { class: 'unattributed', keyClass: null, ceilings: ['APPROVAL_EVIDENCE_ABSENT'] }
}

/** The preimage an executor signs to state a chain head. */
export function headStatementPreimage({ seq, hash, at, keyId }) {
  return Buffer.from(`${HEAD_STATEMENT_DOMAIN}\n${canonicalJSON({ seq, hash, at, keyId })}`, 'utf8')
}

/** The bytes a v3 document signature covers. */
export function receiptV3Preimage(document) {
  const core = {}
  for (const field of RECEIPT_V3_SIGNED_FIELDS) core[field] = document[field]
  return Buffer.from(`${RECEIPT_V3_DOMAIN}\n${canonicalJSON(core)}`, 'utf8')
}

/** Sign one assembled document over its core. */
export function signReceiptV3(document, executorPrivateKey) {
  document.signature = edSign(null, receiptV3Preimage(document), executorPrivateKey).toString('base64')
  return document
}

/** The eleven artifact fields, in the order the artifact digest uses. */
const APPROVAL_ARTIFACT_FIELDS = Object.freeze([
  'version', 'operationArguments', 'operationCanonicalBytes', 'operationDigest', 'semanticProjection',
  'definitionId', 'activationDigest', 'occurrenceId', 'expiry', 'rendererId', 'oneUse',
])

/**
 * The approval artifact digest, exactly as `aukora/approval/artifact.mjs`
 * derives it. This module is INSIDE the authority graph and is allowed to
 * recompute it; the verifier is not and reproduces it inline.
 *
 * @param {Record<string, unknown>} artifact - the artifact's eleven fields.
 * @returns {string} lowercase hex digest.
 */
export function approvalArtifactDigest(artifact) {
  const ordered = {
    version: artifact.version,
    operationArguments: { ...artifact.operationArguments },
    operationCanonicalBytes: artifact.operationCanonicalBytes,
    operationDigest: artifact.operationDigest,
    semanticProjection: [...artifact.semanticProjection],
    definitionId: artifact.definitionId,
    activationDigest: artifact.activationDigest,
    occurrenceId: artifact.occurrenceId,
    expiry: artifact.expiry,
    rendererId: artifact.rendererId,
    oneUse: artifact.oneUse,
  }
  for (const field of APPROVAL_ARTIFACT_FIELDS) {
    if (ordered[field] === undefined) throw new TypeError(`${EXPORT_REFUSE.APPROVAL_INCOMPLETE} — artifact.${field}`)
  }
  return sha256(`${APPROVAL_ARTIFACT_DOMAIN} ${canonicalJSON(ordered)}`)
}

/**
 * Build one v3 document from evidence that already exists for a settlement.
 *
 * @param {object} params
 * @param {string} params.stateDir - broker-owned state directory.
 * @param {Record<string, unknown>} params.receipt - the v1 settlement receipt, as minted.
 * @param {string} params.operation - the registered effect name.
 * @param {string} params.resource - the resource string.
 * @param {string} params.approvedCanonical - the exact canonical bytes the human approved.
 * @param {string} params.actionDigest - the digest the grant bound; must equal sha256(approvedCanonical).
 * @param {Record<string, unknown> | null} [params.authorization] - the issued grant, or null when none was retained.
 * @param {Record<string, unknown> | null} [params.approvalArtifact] - the approval artifact, or null.
 * @param {string | null} [params.approvalSignature] - the owner signature over the artifact digest, or null.
 * @param {object | null} [params.delegation] - a delegation claim, or null.
 * @param {import('node:crypto').KeyObject} params.executorPrivateKey - the receipt-signing key the broker already holds.
 * @param {number} params.at - the millisecond the head statement and observation are made.
 * @returns {Record<string, unknown>} the signed v3 document.
 * @throws {TypeError} a named {@link EXPORT_REFUSE} refusal.
 */
export function buildReceiptV3({
  stateDir,
  receipt,
  operation,
  resource,
  approvedCanonical,
  actionDigest,
  authorization = null,
  approvalArtifact = null,
  approvalSignature = null,
  delegation = null,
  origin = 'settlement',
  executorPrivateKey,
  at,
}) {
  if (typeof stateDir !== 'string' || stateDir.length === 0) throw new TypeError(EXPORT_REFUSE.MALFORMED)
  if (origin !== 'settlement' && origin !== 'fixture') {
    throw new TypeError(`${EXPORT_REFUSE.MALFORMED} — origin must be settlement or fixture`)
  }
  if (receipt === null || typeof receipt !== 'object') throw new TypeError(EXPORT_REFUSE.MALFORMED)
  if (executorPrivateKey?.type !== 'private' || executorPrivateKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError(`${EXPORT_REFUSE.MALFORMED} — executorPrivateKey must be an Ed25519 private key`)
  }
  if (!Number.isSafeInteger(at)) throw new TypeError(`${EXPORT_REFUSE.MALFORMED} — at must be an integer millisecond`)
  if (typeof operation !== 'string' || operation.length === 0) throw new TypeError(EXPORT_REFUSE.MALFORMED)
  if (typeof approvedCanonical !== 'string' || approvedCanonical.length === 0) {
    throw new TypeError(`${EXPORT_REFUSE.MALFORMED} — approvedCanonical must be the exact approved bytes`)
  }
  // The document claims `action.canonical` IS what was approved. Recompute
  // rather than repeat: a digest copied from a caller while the bytes came from
  // somewhere else would make the pair a claim about the caller, not the bytes.
  const recomputed = sha256(approvedCanonical)
  if (recomputed !== actionDigest) {
    throw new TypeError(`${EXPORT_REFUSE.ACTION_DIGEST_MISMATCH} — sha256(approvedCanonical)=${recomputed} actionDigest=${String(actionDigest)}`)
  }

  const receiptSha256 = receiptV1Sha256(receipt)

  // The Aura entry is the one naming THIS receipt digest. Nothing is inferred
  // from position: matching by digest is the only join that survives a
  // differently ordered log.
  const verified = readVerifiedChain(join(stateDir, 'aura.jsonl'))
  if (verified.ok !== true) throw new TypeError(`${EXPORT_REFUSE.CHAIN_UNAVAILABLE} — ${verified.reason}`)
  const entry = verified.entries.find((candidate) => candidate.receiptSha256 === receiptSha256)
  if (entry === undefined) throw new TypeError(EXPORT_REFUSE.ENTRY_ABSENT)
  const { hash: entryHashValue, prev: entryPrev, ...entryFields } = entry
  if (typeof entryHashValue !== 'string' || !HEX_SHA256.test(entryHashValue)) {
    throw new TypeError(`${EXPORT_REFUSE.ENTRY_ABSENT} — the entry carries no hash`)
  }
  if (typeof entryPrev !== 'string' || entryPrev.length === 0) {
    throw new TypeError(`${EXPORT_REFUSE.ENTRY_ABSENT} — the entry carries no predecessor`)
  }
  const seq = entryFields.sequence
  if (!Number.isSafeInteger(seq) || seq < 1) throw new TypeError(`${EXPORT_REFUSE.MALFORMED} — entry sequence`)
  const nonce = entryFields.nonce
  if (typeof nonce !== 'string' || !SAFE_NONCE.test(nonce)) throw new TypeError(`${EXPORT_REFUSE.MALFORMED} — entry nonce`)
  const definitionId = entryFields.definitionId
  if (typeof definitionId !== 'string' || !HEX_SHA256.test(definitionId)) {
    throw new TypeError(`${EXPORT_REFUSE.MALFORMED} — entry definitionId`)
  }

  const keyId = keyIdForPublicKey(executorPrivateKey)
  // The export instant: when THIS document was assembled and signed. It is the
  // only instant a real export can source from its own act, and it is never
  // presented as the settlement or approval time.
  const exportInstant = at
  const head = { seq, hash: entryHashValue, at: exportInstant, keyId, signature: '' }
  head.signature = edSign(null, headStatementPreimage(head), executorPrivateKey).toString('base64')

  const derived = deriveApprovalClass(
    approvalSignature === null || approvalArtifact === null
      ? null
      : { signature: approvalSignature, keyClass: approvalArtifact.keyClass ?? null },
    delegation,
  )

  const approvalBlock = derived.class === 'human-ceremony'
    ? {
      class: derived.class,
      at,
      challenge: approvalArtifact.challenge ?? null,
      signerKeyId: approvalArtifact.signerKeyId ?? null,
      keyClass: derived.keyClass,
      ceremony: approvalArtifact.ceremony ?? 'reported',
      artifactDigest: approvalArtifactDigest(approvalArtifact),
      signature: approvalSignature,
      renderer: approvalArtifact.renderer ?? null,
    }
    : { class: derived.class, at }

  const document = {
    kind: origin === 'fixture' ? RECEIPT_V3_FIXTURE_KIND : RECEIPT_V3_KIND,
    domain: RECEIPT_V3_DOMAIN,
    nonce,
    operation,
    resource,
    definitionId,
    // The v1 receipt VERBATIM, as minted, INCLUDING its own signature. Its
    // signature covers these fields in RECEIPT_FIELDS order, so a recipient can
    // recompute receiptV1Sha256 from this object and find the value the Aura
    // entry already records. Re-encoding it or dropping the signature would break
    // that binding, which is why publication is `verbatim` and
    // LOCAL_METADATA_DISCLOSED is unconditional.
    settlement: Object.fromEntries(
      [...RECEIPT_FIELDS, 'signature'].map((field) => [field, receipt[field]]),
    ),
    action: { canonical: approvedCanonical, digest: actionDigest },
    authorization,
    approval: approvalBlock,
    delegation: derived.class === 'delegated' ? delegation : null,
    publication: 'verbatim',
    effect: {
      // THE OBSERVED BYTES ARE THE V1 RECEIPT'S OWN POST-DISPATCH OBSERVATION,
      // copied from the receipt so the two records cannot disagree. COPYING THAT
      // DIGEST IS NOT A FRESH OBSERVATION OF OBJECT BYTES, and `observedAt` says
      // which act this is: the instant the export read the receipt, not a
      // re-inspection of the effect. A fresh inspection is a different act that
      // this export does not perform and does not claim.
      observedDigest: receipt.contentSha256,
      observedAt: exportInstant,
    },
    times: origin === 'fixture' ? {
      // A FIXTURE MAY CARRY COHERENT SYNTHETIC TIMES, because a fixture is
      // explicitly not evidence and its `kind` says so. Exercising the ordered
      // path is the fixture's job; the honesty rule is about what a document
      // CLAIMS, and every real instant below is marked unavailable instead.
      issuedAt: at - 3000,
      approvedAt: approvalBlock.at,
      settledAt: at,
      expiresAt: Number.isSafeInteger(authorization?.payload?.exp)
        ? authorization.payload.exp * 1000
        : TIMES_UNAVAILABLE,
    } : {
      // EACH INSTANT IS EITHER EVIDENCE OR EXPLICITLY UNAVAILABLE.
      //
      // Measured against a real settlement: the v1 receipt carries no settlement
      // clock (`mtimeNs` is the object's file mtime, a filesystem fact, not the
      // instant the settlement was recorded), the v4 authorization payload
      // carries no issuance instant, and the Aura entry carries no measured time
      // at all (`confinementField()` has no `measuredAt`). So three of these four
      // instants have NO SOURCE in the evidence.
      //
      // An earlier version invented them by repeating the export instant and
      // presenting it as the settlement and approval time, which states a
      // historical fact the evidence does not support. Unavailable is the honest
      // value, and `timesSources` makes every instant's provenance
      // machine-checkable rather than implied by a comment.
      issuedAt: TIMES_UNAVAILABLE,
      approvedAt: TIMES_UNAVAILABLE,
      settledAt: TIMES_UNAVAILABLE,
      expiresAt: Number.isSafeInteger(authorization?.payload?.exp)
        ? authorization.payload.exp * 1000
        : TIMES_UNAVAILABLE,
    },
    timesSources: origin === 'fixture' ? {
      issuedAt: 'fixture-coherent',
      approvedAt: 'approval-recorded',
      settledAt: 'aura-entry-measured',
      expiresAt: Number.isSafeInteger(authorization?.payload?.exp)
        ? 'grant-expiry-seconds'
        : TIMES_UNAVAILABLE,
    } : {
      issuedAt: TIMES_UNAVAILABLE,
      approvedAt: TIMES_UNAVAILABLE,
      settledAt: TIMES_UNAVAILABLE,
      expiresAt: Number.isSafeInteger(authorization?.payload?.exp)
        ? 'grant-expiry-seconds'
        : TIMES_UNAVAILABLE,
    },
    aura: { seq, prev: entryPrev, hash: entryHashValue, entry: entryFields },
    head,
    // Named limits, never omitted. LOCAL_METADATA_DISCLOSED is unconditional
    // because publication is verbatim: the embedded receipt's signature covers
    // path, inode, mtimeNs and the confinement record, so this document
    // publishes local machine metadata and there is no redacted-and-verified
    // middle in v3.
    ceilings: [
      'SAME_UID_HOST',
      'SAME_UID_WITNESS',
      'KERNEL_TRUSTED',
      'LOCAL_METADATA_DISCLOSED',
      ...derived.ceilings,
    ],
    issuerKeyId: keyId,
    signature: '',
  }
  return signReceiptV3(document, executorPrivateKey)
}

/**
 * Write one v3 document beside its v1 receipt, mode 0444.
 *
 * The original receipt is never opened for write and never moved: this creates a
 * new file named for the v1 receipt's digest with a `.v3.json` suffix, published
 * by hard link so an existing export is never overwritten.
 *
 * @param {object} params
 * @param {string} params.stateDir - broker-owned state directory.
 * @param {Record<string, unknown>} params.document - a signed v3 document.
 * @returns {{ path: string, receiptV3Sha256: string }} the written path and its digest.
 * @throws {TypeError} a named {@link EXPORT_REFUSE} refusal.
 */
export function writeReceiptV3({ stateDir, document }) {
  const canonical = canonicalJSON(document)
  const receiptV3Sha256 = sha256(canonical)
  const directory = join(stateDir, RECEIPT_V3_DIRECTORY)
  // Create-if-absent, then validate the result. v3 documents live in their OWN
  // directory: `receipts/` belongs to `verifyReceiptDirectory`, which requires
  // every regular entry there to be a canonical v1 receipt named `<sha256>.json`
  // with mode 0600 and refuses `receipt:entry-malformed` otherwise. A `.v3.json`
  // beside its v1 receipt made the NEXT settlement fail at the Aura preflight
  // with INDETERMINATE. Two directories keep two invariants.
  try {
    mkdirSync(directory, { mode: 0o700 })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw new TypeError(`${EXPORT_REFUSE.UNAVAILABLE} — ${directory}`)
  }
  let state
  try {
    state = lstatSync(directory)
  } catch {
    throw new TypeError(`${EXPORT_REFUSE.UNAVAILABLE} — ${directory}`)
  }
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : state.uid
  if (!state.isDirectory() || state.isSymbolicLink() || state.uid !== euid || (state.mode & 0o777) !== 0o700) {
    throw new TypeError(`${EXPORT_REFUSE.UNAVAILABLE} — receipts directory is not broker-owned`)
  }
  // Named for the V1 receipt's digest, recomputed from the embedded receipt so
  // the filename and the v1 receipt it sits beside are one statement.
  const receiptSha256 = receiptV1Sha256(document.settlement)
  const path = join(directory, `${receiptSha256}.v3.json`)
  const stagingPath = join(directory, `.tmp-v3-${process.pid}-${randomBytes(8).toString('hex')}`)
  let descriptor
  let staged = false
  try {
    descriptor = openSync(stagingPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o444)
    staged = true
    writeFileSync(descriptor, `${canonical}\n`, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    linkSync(stagingPath, path)
    unlinkSync(stagingPath)
    staged = false
  } catch (error) {
    if (staged) {
      try {
        unlinkSync(stagingPath)
      } catch {
        // Discard staging cleanup when the file was already linked or removed.
      }
    }
    if (error?.code === 'EEXIST') throw new TypeError(EXPORT_REFUSE.ALREADY_EXISTS)
    if (String(error?.message ?? error).startsWith('export:')) throw error
    throw new TypeError(`${EXPORT_REFUSE.UNAVAILABLE} — ${String(error?.message ?? error)}`)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  return { path, receiptV3Sha256 }
}
