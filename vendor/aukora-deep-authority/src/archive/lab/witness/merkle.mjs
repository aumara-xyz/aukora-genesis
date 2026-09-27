import { createHash } from 'node:crypto';
import { canonicalJSON } from '../kernel/canonical.mjs';

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

export function leafHash(leaf) {
  return createHash('sha256').update(Buffer.concat([LEAF_PREFIX, Buffer.isBuffer(leaf) ? leaf : Buffer.from(leaf)])).digest();
}

export function nodeHash(left, right) {
  return createHash('sha256').update(Buffer.concat([NODE_PREFIX, left, right])).digest();
}

export function emptyRootHash() {
  return createHash('sha256').update(Buffer.alloc(0)).digest();
}

function splitPoint(length) {
  let k = 1;
  while (k * 2 < length) k *= 2;
  return k;
}

function rootInternal(hashes) {
  if (hashes.length === 0) return emptyRootHash();
  if (hashes.length === 1) return hashes[0];
  const k = splitPoint(hashes.length);
  return nodeHash(rootInternal(hashes.slice(0, k)), rootInternal(hashes.slice(k)));
}

export function merkleRoot(entries) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array of raw entry buffers');
  // Boundary enforcement: hashing happens HERE and only here. Precomputed
  // 32-byte buffers are raw data like anything else - an internal-node hash
  // passed as an entry can never impersonate a leaf position.
  return rootInternal(entries.map(leafHash));
}

/** Fold already-hashed leaves; internal + MerkleWitness use only. */
export function rootFromLeafHashes(hashes) {
  if (!Array.isArray(hashes)) throw new TypeError('hashes must be an array of leaf hashes');
  return rootInternal(hashes);
}

export function inclusionProof(leafHashes, index) {
  if (!Number.isInteger(index) || index < 0 || index >= leafHashes.length) throw new Error('merkle_index_invalid');
  const walk = (at, hashes) => {
    if (hashes.length === 1) return [];
    const k = splitPoint(hashes.length);
    return at < k
      ? [...walk(at, hashes.slice(0, k)), rootInternal(hashes.slice(k))]
      : [...walk(at - k, hashes.slice(k)), rootInternal(hashes.slice(0, k))];
  };
  return walk(index, leafHashes);
}

export function verifyInclusion(index, size, targetEntry, proof, expectedRoot) {
  if (!Number.isInteger(index) || !Number.isInteger(size) || index < 0 || size <= index) return false;
  // The target is a RAW entry; the 0x00 leaf prefix is applied here, so a
  // proof-of-inclusion can never be satisfied by an internal node hash.
  let current = leafHash(targetEntry);
  let fn = index;
  let sn = size - 1;

  for (const sibling of proof) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      current = nodeHash(sibling, current);
      while (fn % 2 === 0 && fn !== 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else {
      current = nodeHash(current, sibling);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  const rootBuf = Buffer.isBuffer(expectedRoot) ? expectedRoot : Buffer.from(expectedRoot, 'hex');
  return current.equals(rootBuf);
}

export function consistencyProof(leafHashes, size1, size2) {
  if (!Number.isInteger(size1) || !Number.isInteger(size2) || size1 < 0 || size2 !== leafHashes.length || size1 > size2) {
    throw new Error('merkle_consistency_args_invalid');
  }
  if (size1 === 0 || size1 === size2) return [];
  const walk = (prefix, hashes, complete) => {
    if (prefix === hashes.length) return complete ? [] : [rootInternal(hashes)];
    const k = splitPoint(hashes.length);
    return prefix <= k
      ? [...walk(prefix, hashes.slice(0, k), complete), rootInternal(hashes.slice(k))]
      : [...walk(prefix - k, hashes.slice(k), false), rootInternal(hashes.slice(0, k))];
  };
  return walk(size1, leafHashes, true);
}

export class MerkleWitness {
  constructor() {
    this.entries = [];
    this.leafHashes = [];
  }

  append(entry) {
    const hash = leafHash(Buffer.from(canonicalJSON(entry), 'utf8'));
    this.entries.push({ entry, hash: hash.toString('hex'), index: this.entries.length });
    this.leafHashes.push(hash);
    return { index: this.entries.length - 1, leafHash: hash.toString('hex'), root: this.getRootHex() };
  }

  getRoot() { return rootFromLeafHashes(this.leafHashes); }
  getRootHex() { return this.getRoot().toString('hex'); }

  getInclusionProof(index) {
    return inclusionProof(this.leafHashes, index);
  }

  getConsistencyProof(size1) {
    return consistencyProof(this.leafHashes, size1, this.leafHashes.length);
  }

  static replaySession(recorded) {
    const witness = new MerkleWitness();
    for (const item of recorded) witness.append(item.entry || item);
    return { valid: true, count: witness.entries.length, root: witness.getRootHex() };
  }
}
