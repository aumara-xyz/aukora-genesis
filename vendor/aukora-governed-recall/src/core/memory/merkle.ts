// φ — a minimal RFC 6962-shaped Merkle tree over `sha256`. New code, not a port: the donor's tree
// arithmetic lives in `@aukora/kernel/merkle`, a package this repository does not carry (see
// `docs/MEMORY-PORT.md`). This is a small, from-scratch equivalent — leaf/node domain separation and
// an unbalanced-tree split rule, both straight from RFC 6962 §2.1 — using only `node:crypto`.
//
// ══ WHAT THIS BUYS ══
//
// An INCLUSION proof: "this leaf sits at this position in a tree with this root", checkable by anyone
// holding only the leaf, its position, the proof and the root — no access to the rest of the tree.
// `core/memory/erasureCertificate.ts` is the only caller; see that file for the honest limit on what
// this does NOT prove (a Merkle CONSISTENCY proof — "log A is a strict prefix of log B" — is not
// implemented here; that is the "reduced" in "reduced Merkle certificate").
//
// ══ WHY THE SPLIT RULE, NOT PAIRWISE-DUPLICATE PADDING ══
//
// A padded binary tree (duplicate the last leaf until the count is a power of two — the construction
// Bitcoin used before CVE-2012-2459) reshuffles on every append: version N is not a subtree of version
// N+1. RFC 6962's rule — split at the largest power of two strictly less than the size — makes the tree
// over an APPEND-ONLY log stable: the left half of a tree of size N is always the same subtree as the
// left half of any larger tree that starts the same way. That property is what a consistency proof would
// need, and it is why this file uses the RFC's split rule even though this reduction does not implement
// consistency proofs itself — a future one can be added without changing a single root already recorded.

import { createHash } from 'crypto';

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

function sha256(...parts: readonly Uint8Array[]): Buffer {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
}

/** RFC 6962 leaf hash: `H(0x00 ‖ data)`. Domain-separated from a node hash so neither can impersonate the other. */
export function leafHash(data: Uint8Array): Buffer {
  return sha256(LEAF_PREFIX, data);
}

function nodeHash(left: Uint8Array, right: Uint8Array): Buffer {
  return sha256(NODE_PREFIX, left, right);
}

/** Largest power of two strictly less than `n`. `n` must be `>= 2`. */
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function subtreeRoot(leaves: readonly Uint8Array[], start: number, size: number): Buffer {
  if (size === 1) {
    const only = leaves[start];
    if (only === undefined) throw new RangeError('merkle:leaf-out-of-range');
    return Buffer.from(only);
  }
  const k = splitPoint(size);
  return nodeHash(subtreeRoot(leaves, start, k), subtreeRoot(leaves, start + k, size - k));
}

/** RFC 6962's empty-tree root: `H()`, the hash of zero bytes. */
const EMPTY_ROOT = sha256(Buffer.alloc(0));

export function rootFromLeafHashes(leaves: readonly Uint8Array[]): Buffer {
  if (leaves.length === 0) return Buffer.from(EMPTY_ROOT);
  return subtreeRoot(leaves, 0, leaves.length);
}

function auditPath(leaves: readonly Uint8Array[], m: number, start: number, size: number): Buffer[] {
  if (size === 1) return [];
  const k = splitPoint(size);
  if (m < k) return [...auditPath(leaves, m, start, k), subtreeRoot(leaves, start + k, size - k)];
  return [...auditPath(leaves, m - k, start + k, size - k), subtreeRoot(leaves, start, k)];
}

/** Prove that `leaves[index]` sits in a tree over the whole array, leaf-to-root order. */
export function inclusionProof(leaves: readonly Uint8Array[], index: number): Buffer[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
    throw new RangeError('merkle:index-out-of-range');
  }
  return auditPath(leaves, index, 0, leaves.length);
}

/**
 * Check an inclusion proof with NOTHING ELSE — no tree, no sibling leaves. Reconstructs the root by
 * walking the same split rule `auditPath` used to build the proof, and fails closed on any mismatch,
 * any malformed input, or a proof with leftover or missing entries.
 */
/**
 * HONEST LIMIT: `size` and `root` are not cross-checked against each other by this function — it
 * reconstructs a root using `size` alone and compares it to whatever `root` was passed. Two different
 * (size, root) pairs can share the same split-point arithmetic at the positions a given proof touches,
 * so a proof built for one tree can, for some indices, also "verify" against a DIFFERENT claimed size if
 * the caller does not obtain `size` and `root` from the same trusted source. `erasureCertificate.ts`
 * avoids this by minting `size` and `root` together, in one `InclusionEvidence`, at proof-creation time,
 * and by cross-checking that evidence's `root`/`size` against the certificate's own `preErasureRoot`/
 * `preErasureCount` — never accepting them from separate places.
 */
export function verifyInclusion(
  index: number,
  size: number,
  leaf: Uint8Array,
  proof: readonly Uint8Array[],
  root: Uint8Array,
): boolean {
  if (!Number.isInteger(index) || index < 0) return false;
  if (!Number.isInteger(size) || size < 1 || index >= size) return false;

  let cursor = 0;
  const reconstruct = (m: number, sz: number): Buffer => {
    if (sz === 1) return Buffer.from(leaf);
    const k = splitPoint(sz);
    if (m < k) {
      const left = reconstruct(m, k);
      const right = proof[cursor];
      if (right === undefined) throw new RangeError('merkle:proof-too-short');
      cursor += 1;
      return nodeHash(left, right);
    }
    const right = reconstruct(m - k, sz - k);
    const left = proof[cursor];
    if (left === undefined) throw new RangeError('merkle:proof-too-short');
    cursor += 1;
    return nodeHash(left, right);
  };

  try {
    const computed = reconstruct(index, size);
    return cursor === proof.length && computed.equals(Buffer.from(root));
  } catch {
    return false;
  }
}

/** Advisory arithmetic. A Merkle path is evidence, never permission. */
export function merkleGrantsAuthority(): false {
  return false;
}
