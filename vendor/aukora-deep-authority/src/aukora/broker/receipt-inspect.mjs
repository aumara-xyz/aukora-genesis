/**
 * Read-only inspection of one already-settled receipt.
 *
 * The viewer needs READ permission, not a signing key. This module opens the
 * broker's own state, resolves one receipt by a validated digest, reports the
 * settlement the chain recorded, and — when the side export exists — grades it
 * with the SAME verifier the portable package ships. It implements no second
 * verifier and mints nothing.
 *
 * WHAT IT NEVER DOES. It does not write. It does not append to the chain, create a
 * receipt, retry a settlement, or re-sign anything. An absent export is reported
 * as absent; it is never backfilled, because minting a document now would date it
 * now and turn a missing historical artifact into a fabricated one.
 *
 * THREE OUTCOMES THAT MUST NOT BE CONFLATED, because collapsing any two of them
 * is how a viewer lies to its reader:
 *
 *   1. SETTLEMENT — what the chain says happened. Read from the Aura entry, which
 *      is appended before the caller hears about a settlement, so a recorded
 *      entry is the executor's own statement that it settled.
 *   2. VERIFICATION — whether the document's signatures and digests check out
 *      under the trust inputs supplied. A document can be structurally valid,
 *      correctly signed, and still NON-CONFORMING because its approval evidence
 *      is absent.
 *   3. APPROVAL ATTRIBUTION — who the evidence shows approved. Today that is
 *      nobody: every real export is `unattributed`, and an issuer-root signature
 *      is not owner-held approval.
 *
 * A NON-CONFORMING verdict therefore says nothing about whether the operation
 * settled. An operation can settle, be recorded, and have no owner approval
 * evidence at all — which is the ordinary state today, not a failure.
 *
 * @module @aukora/broker/receipt-inspect
 */
import { createHash, createPublicKey } from 'node:crypto'
import { existsSync, lstatSync, openSync, readFileSync, closeSync, constants } from 'node:fs'
import { join } from 'node:path'
import { readVerifiedChain } from '../aura/record.mjs'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { verifyReceiptV3 } from '../receipt-v3/verify.mjs'

/** Named outcomes. A caller distinguishes these; none implies another. */
export const INSPECT_REFUSE = Object.freeze({
  /** The identifier is not a well-formed receipt digest. */
  IDENTIFIER_MALFORMED: 'inspect:identifier-malformed',
  /** The identifier is well formed but no entry names it. NOT "no effect occurred". */
  NOT_FOUND: 'inspect:receipt-not-found',
  /** The chain itself could not be read or does not verify. */
  CHAIN_UNAVAILABLE: 'inspect:chain-unavailable',
  /** A v1 receipt is recorded but its file is absent. */
  EVIDENCE_UNAVAILABLE: 'inspect:evidence-unavailable',
  /** The file is present but could not be read: permissions, a directory, a link. */
  EVIDENCE_UNREADABLE: 'inspect:evidence-unreadable',
  /** The v3 export is present but could not be read, as distinct from absent. */
  EXPORT_UNREADABLE: 'inspect:export-unreadable',
  /** The stored v1 receipt does not match the digest the entry names. */
  EVIDENCE_MISMATCH: 'inspect:evidence-mismatch',
})

/** The v1 receipt's frozen field order; its digest is taken over exactly these plus the signature. */
const SETTLEMENT_V1_KEYS = Object.freeze([
  'requestDigest', 'definitionId', 'nonce', 'sequence', 'path', 'bytes', 'contentSha256', 'inode',
  'mtimeNs', 'confinement', 'signature',
])

/**
 * The digest `writeReceipt` names a stored receipt by: sha256 over canonicalJSON
 * of an ORDERED OBJECT of the frozen names. This is deliberately NOT the pair
 * array the signature preimage uses; the two are different byte strings over
 * almost the same names, and using one where the other belongs is silent.
 *
 * @param {Record<string, unknown>} receipt - the stored receipt.
 * @returns {string} lowercase hex digest.
 */
function receiptDigestOf(receipt) {
  const ordered = {}
  for (const field of SETTLEMENT_V1_KEYS) ordered[field] = receipt?.[field] ?? null
  return createHash('sha256').update(canonicalJSON(ordered), 'utf8').digest('hex')
}

const HEX_SHA256 = /^[0-9a-f]{64}$/
const RECEIPT_DIRECTORY = 'receipts'
const RECEIPT_V3_DIRECTORY = 'receipts-v3'

/**
 * Read one file as UTF-8, reporting WHY it could not be read.
 *
 * Returning a bare null conflated three different facts — absent, present but
 * unreadable, and present but not a plain file — so a caller could not tell a
 * missing export from a broken one. Each is now a distinct status.
 *
 * @param {string} path - the file.
 * @returns {{status: 'ok'|'absent'|'unreadable', text: string}} the read outcome.
 */
function readTextFile(path) {
  let state
  try {
    state = lstatSync(path)
  } catch (error) {
    return { status: error?.code === 'ENOENT' ? 'absent' : 'unreadable', text: '' }
  }
  if (!state.isFile() || state.isSymbolicLink()) return { status: 'unreadable', text: '' }
  let descriptor
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    return { status: 'ok', text: readFileSync(descriptor, 'utf8') }
  } catch {
    return { status: 'unreadable', text: '' }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/**
 * Report the trust inputs actually available for grading one document.
 *
 * A public key embedded in a document is NOT trusted merely because it is there:
 * the document would then be choosing its own anchor. Each role is reported
 * separately, and a role with no key is reported as `unavailable` rather than
 * quietly omitted.
 *
 * @param {{executorPublicKeys: string[], issuerPublicKeys: string[], ownerPublicKeys: string[]}} anchors - caller-supplied anchors.
 * @returns {Array<{role: string, status: string, keyIds: string[]}>} one row per role.
 */
export function describeTrustInputs(anchors) {
  const rows = []
  for (const role of ['executor', 'issuer', 'owner']) {
    const keys = anchors?.[`${role}PublicKeys`] ?? []
    const usable = keys.filter((key) => typeof key === 'string' && key.length > 0)
    rows.push({
      role,
      status: usable.length === 0 ? 'unavailable' : 'supplied',
      // Key ids are not secrets and are the only way a reader can tell which
      // anchor was used. The key material itself is never echoed.
      keyIds: usable.map((key) => keyIdOf(key)).filter((id) => id !== null),
    })
  }
  return rows
}

/** sha256 over one key's SPKI DER bytes, or null when the PEM does not parse. */
function keyIdOf(pem) {
  try {
    return createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex')
  } catch {
    return null
  }
}

/**
 * Inspect one settled receipt, read-only, and never write anything.
 *
 * @param {object} params
 * @param {string} params.stateDir - the broker's own state directory.
 * @param {string} params.receiptSha256 - the identifier: a 64-hex receipt digest as the Aura entry records it.
 * @param {{executorPublicKeys?: string[], issuerPublicKeys?: string[], ownerPublicKeys?: string[]}} [params.anchors] - trust inputs the CALLER holds.
 * @param {boolean} [params.includeArtifact] - include the ORIGINAL v3 document bytes, for the explicit save action. Off by default: the bytes contain operation arguments and paths, so they cross the wire only when a caller asks for them for a stated purpose.
 * @returns {{
 *   ok: boolean,
 *   refusal?: string,
 *   settlement?: {state: string, sequence: number, operation: string, key: string | null, chainHash: string},
 *   evidence?: {v1Available: boolean, v3Available: boolean},
 *   verification?: {verdict: string, reasons: string[], ceilings: string[], approvalClass: string | null},
 *   trustInputs?: Array<{role: string, status: string, keyIds: string[]}>,
 *   limitations: string[],
 * }} the inspection result. A refusal is a named outcome, never an exception.
 */
export function inspectReceipt({ stateDir, receiptSha256, anchors = {}, includeArtifact = false }) {
  const limitations = [
    'SAME_UID_HOST',
    'SAME_UID_WITNESS',
    'HOST_CLOCK_TRUSTED_FOR_EXPIRY',
    'effect.observedDigest is a signed observation taken at settlement, not a fresh inspection of object bytes',
    'a receipt does not establish present-day file integrity, freshness, physical attendance or key custody',
  ]
  if (typeof stateDir !== 'string' || stateDir.length === 0) {
    return { ok: false, refusal: INSPECT_REFUSE.IDENTIFIER_MALFORMED, limitations }
  }
  // The identifier is validated BEFORE it is ever used to build a path, so a
  // crafted value cannot reach the filesystem.
  if (typeof receiptSha256 !== 'string' || !HEX_SHA256.test(receiptSha256)) {
    return { ok: false, refusal: INSPECT_REFUSE.IDENTIFIER_MALFORMED, limitations }
  }

  // A STORE WITH NO CHAIN YET IS NOT A BROKEN SERVICE. `readVerifiedChain`
  // reports `truncated` for an absent file, which here means "nothing has settled
  // in this store", not "the chain failed to verify". Treating the two the same
  // makes a fresh store look like an outage. Only an actual read or verification
  // failure is a service problem; a missing chain is an empty, valid chain.
  const chainFile = join(stateDir, 'aura.jsonl')
  const chainExists = existsSync(chainFile)
  const chain = readVerifiedChain(chainFile)
  if (chain.ok !== true) {
    // An absent file is the empty case; anything else is a genuine failure.
    if (!(!chainExists && chain.reason === 'record:truncated')) {
      return { ok: false, refusal: INSPECT_REFUSE.CHAIN_UNAVAILABLE, limitations }
    }
  }
  const entry = (chain.entries ?? []).find((candidate) => candidate.receiptSha256 === receiptSha256)
  if (entry === undefined) {
    // ABSENCE IS NOT EVIDENCE OF ABSENCE. The chain is authoritative only for what
    // IT recorded; a receipt from another store, a pruned file or a different
    // chain all land here, so the wording must not claim no effect ever occurred.
    return { ok: false, refusal: INSPECT_REFUSE.NOT_FOUND, limitations }
  }

  const v1Path = join(stateDir, RECEIPT_DIRECTORY, `${receiptSha256}.json`)
  const v1Read = readTextFile(v1Path)
  const v3Read = readTextFile(join(stateDir, RECEIPT_V3_DIRECTORY, `${receiptSha256}.v3.json`))
  // A recorded entry whose receipt file is MISSING is a different outcome from an
  // unknown identifier — something settled and its evidence is gone — and both are
  // different again from a file that is present but UNREADABLE. Collapsing those
  // three into one "unavailable" tells a reader nothing about what to do next.
  if (v1Read.status === 'unreadable') {
    return { ok: false, refusal: INSPECT_REFUSE.EVIDENCE_UNREADABLE, limitations }
  }
  if (v1Read.status === 'absent') {
    return { ok: false, refusal: INSPECT_REFUSE.EVIDENCE_UNAVAILABLE, limitations }
  }
  // THE STORED BYTES MUST BE THE RECEIPT THE ENTRY NAMES. A file present at the
  // right path with different contents would otherwise be graded as if it were
  // the recorded receipt. The digest is recomputed over the receipt's own frozen
  // field order, exactly as `writeReceipt` computed the filename.
  try {
    if (receiptDigestOf(JSON.parse(v1Read.text)) !== receiptSha256) {
      return { ok: false, refusal: INSPECT_REFUSE.EVIDENCE_MISMATCH, limitations }
    }
  } catch {
    return { ok: false, refusal: INSPECT_REFUSE.EVIDENCE_UNAVAILABLE, limitations }
  }

  const settlement = {
    state: typeof entry.verdict === 'string' ? entry.verdict : 'recorded',
    sequence: Number.isSafeInteger(entry.sequence) ? entry.sequence : null,
    operation: typeof entry.toolName === 'string' ? entry.toolName : (typeof entry.key === 'string' ? 'memory.put' : null),
    key: typeof entry.key === 'string' ? entry.key : null,
    chainHash: typeof entry.hash === 'string' ? entry.hash : null,
  }
  const trustInputs = describeTrustInputs(anchors)
  // The export's own read outcome is reported, so a caller can tell "no export
  // was ever written" from "an export exists and could not be read".
  const evidence = { v1Available: true, v3Available: v3Read.status === 'ok', v3ReadStatus: v3Read.status }
  if (v3Read.status === 'unreadable') {
    return { ok: true, settlement, evidence, trustInputs, exportRefusal: INSPECT_REFUSE.EXPORT_UNREADABLE, limitations }
  }
  if (v3Read.status === 'absent') {
    // The export is genuinely absent. It is NOT regenerated here: a document
    // minted now would carry now's instant and would misrepresent when the
    // settlement happened.
    return { ok: true, settlement, evidence, trustInputs, limitations }
  }
  const v3Text = v3Read.text

  let document
  try {
    document = JSON.parse(v3Text)
  } catch {
    return {
      ok: true,
      settlement,
      evidence,
      trustInputs,
      verification: { verdict: 'NON-CONFORMING', reasons: ['receipt:malformed'], ceilings: [], approvalClass: null },
      limitations,
    }
  }
  const graded = verifyReceiptV3({
    document,
    executorPublicKeys: anchors.executorPublicKeys ?? [],
    issuerPublicKeys: anchors.issuerPublicKeys ?? anchors.executorPublicKeys ?? [],
    ownerPublicKeys: anchors.ownerPublicKeys ?? [],
  })
  const result = {
    ok: true,
    settlement,
    evidence,
    trustInputs,
    verification: {
      verdict: graded.verdict,
      reasons: [...graded.reasons],
      ceilings: [...graded.ceilings],
      approvalClass: graded.approvalClass ?? null,
      canExportVerbatim: graded.verdict === 'NON-CONFORMING' || graded.verdict === 'CONFORMING',
    },
    limitations,
  }
  if (includeArtifact) {
    // THE ORIGINAL BYTES, UNCHANGED. Not re-serialized, not redacted, not
    // re-signed: a byte-for-byte copy of the file, so a saved artifact is the
    // same document the verdict above was computed over. The digest is returned
    // alongside so a caller can prove a saved file is this artifact.
    result.artifact = {
      mediaType: 'application/json',
      bytes: v3Text,
      sha256: createHash('sha256').update(v3Text, 'utf8').digest('hex'),
      // Bound to the requested receipt: the filename is derived from the same
      // validated digest the chain entry names, so a returned artifact cannot
      // belong to a different settlement.
      receiptSha256,
      // Named so a client can refuse to present a verbatim export as redacted.
      publication: typeof document.publication === 'string' ? document.publication : null,
    }
  }
  return result
}
