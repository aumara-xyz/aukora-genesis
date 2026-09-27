/**
 * Portable Aura checkpoints and append-only consistency presentations.
 *
 * A checkpoint commits to the verified Aura entry hashes in record order.
 * It carries both the raw RFC 6962 Merkle Tree Hash used by an independent
 * consistency verifier and Aura's size-bound v2 commitment used by the local
 * inclusion verifier. The checkpoint authorizes nothing and does not prove it
 * is the latest view. Retention outside the broker state directory is what
 * makes a later conflicting presentation observable.
 *
 * `streamNamespace` is an unverified label for a retained stream. This module
 * does not sign checkpoints, and Aura entries currently retain only a receipt
 * digest, not the receipt signature or its key id. Consumers must retain the
 * label and checkpoint out of band; neither value authenticates the stream.
 *
 * @module @aukora/aura/checkpoint
 */
import { readVerifiedChain } from './record.mjs'
import {
  consistencyProof,
  leafHash,
  rootFromHashes,
  structuralRootFromHashes,
} from './merkle.mjs'

/** Closed checkpoint wire domain. */
export const CHECKPOINT_DOMAIN = 'aukora:aura-checkpoint:v1'

const DIGEST_RE = /^[0-9a-f]{64}$/

/**
 * Export one checkpoint from a verified Aura record.
 *
 * @param {object} params
 * @param {string} params.file - Aura JSONL record path.
 * @param {string} params.streamNamespace - unverified retained-stream namespace.
 * @returns {{domain: string, treeSize: number, root: string, commitment: string, streamNamespace: string}}
 */
export function checkpointFromRecord({ file, streamNamespace }) {
  const { entries } = requireNonEmptyVerifiedRecord(file)
  return checkpointFromEntries(entries, streamNamespace)
}

/**
 * Export a presented checkpoint and its proof from a retained prefix.
 *
 * @param {object} params
 * @param {string} params.file - Aura JSONL record path.
 * @param {number} params.retainedSize - exact leaf count of the retained checkpoint.
 * @param {string} params.streamNamespace - unverified retained-stream namespace.
 * @returns {{domain: string, treeSize: number, root: string, commitment: string, streamNamespace: string, proofFromPrevious: Array<string>}}
 */
export function consistencyPresentationFromRecord({ file, retainedSize, streamNamespace }) {
  const { entries } = requireNonEmptyVerifiedRecord(file)
  const hashes = entryLeafHashes(entries)
  const checkpoint = checkpointFromHashes(hashes, streamNamespace)
  return {
    ...checkpoint,
    proofFromPrevious: consistencyProof(hashes, retainedSize).map((hash) => hash.toString('hex')),
  }
}

/** Build the closed checkpoint object from verified entry objects. */
function checkpointFromEntries(entries, streamNamespace) {
  return checkpointFromHashes(entryLeafHashes(entries), streamNamespace)
}

/** Build the closed checkpoint object from Aura leaf hashes. */
function checkpointFromHashes(hashes, streamNamespace) {
  requireStreamNamespace(streamNamespace)
  if (hashes.length === 0) throw new Error('aura-checkpoint: empty record')
  return {
    domain: CHECKPOINT_DOMAIN,
    treeSize: hashes.length,
    root: structuralRootFromHashes(hashes).toString('hex'),
    commitment: rootFromHashes(hashes).toString('hex'),
    streamNamespace,
  }
}

/** Read and verify one non-empty Aura record. */
function requireNonEmptyVerifiedRecord(file) {
  if (typeof file !== 'string' || file.length === 0) {
    throw new TypeError('aura-checkpoint: file must be a non-empty string')
  }
  const verified = readVerifiedChain(file)
  if (!verified.ok) throw new Error(verified.reason)
  if (verified.entries.length === 0) throw new Error('aura-checkpoint: empty record')
  return verified
}

/** Preserve the established Aura Merkle leaf definition: H(0x00 || entry.hash bytes). */
function entryLeafHashes(entries) {
  return entries.map((entry, index) => {
    if (typeof entry?.hash !== 'string' || !DIGEST_RE.test(entry.hash)) {
      throw new Error(`aura-checkpoint: invalid entry hash at index ${index}`)
    }
    return leafHash(Buffer.from(entry.hash, 'hex'))
  })
}

/** Validate the retained stream namespace. */
function requireStreamNamespace(streamNamespace) {
  if (typeof streamNamespace !== 'string' || !DIGEST_RE.test(streamNamespace)) {
    throw new TypeError('aura-checkpoint: streamNamespace must be 64 lowercase hex characters')
  }
}
