// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";

const HASH_SIZE = 32;
const LEAF_PREFIX = Uint8Array.of(0x00);
const NODE_PREFIX = Uint8Array.of(0x01);

export function leafHash(leaf: Uint8Array): Uint8Array {
  return sha256(concatBytes(LEAF_PREFIX, leaf));
}

export function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(NODE_PREFIX, left, right));
}

export function emptyRootHash(): Uint8Array {
  return sha256(new Uint8Array(0));
}

function splitPoint(length: number): number {
  let point = 1;
  while (point * 2 < length) point *= 2;
  return point;
}

function rootInternal(hashes: Uint8Array[]): Uint8Array {
  if (hashes.length === 0) return emptyRootHash();
  if (hashes.length === 1) return hashes[0];
  const point = splitPoint(hashes.length);
  return nodeHash(rootInternal(hashes.slice(0, point)), rootInternal(hashes.slice(point)));
}

export function rootFromLeafHashes(hashes: Uint8Array[]): Uint8Array {
  if (!Array.isArray(hashes) || !hashes.every((hash) => hash instanceof Uint8Array && hash.length === HASH_SIZE)) {
    throw new Error("merkle_leaf_hash_invalid");
  }
  return rootInternal(hashes).slice();
}

export function merkleRoot(leaves: Uint8Array[]): Uint8Array {
  if (!Array.isArray(leaves) || !leaves.every((leaf) => leaf instanceof Uint8Array)) throw new Error("merkle_leaf_invalid");
  return rootInternal(leaves.map(leafHash)).slice();
}

export function inclusionProof(leafHashes: Uint8Array[], index: number): Uint8Array[] {
  if (!Number.isInteger(index) || index < 0 || index >= leafHashes.length) throw new Error("merkle_index_invalid");
  rootFromLeafHashes(leafHashes);
  const walk = (at: number, hashes: Uint8Array[]): Uint8Array[] => {
    if (hashes.length === 1) return [];
    const point = splitPoint(hashes.length);
    return at < point
      ? [...walk(at, hashes.slice(0, point)), rootInternal(hashes.slice(point))]
      : [...walk(at - point, hashes.slice(point)), rootInternal(hashes.slice(0, point))];
  };
  return walk(index, leafHashes).map((entry) => entry.slice());
}

export function consistencyProof(leafHashes: Uint8Array[], size1: number, size2: number): Uint8Array[] {
  rootFromLeafHashes(leafHashes);
  if (!Number.isInteger(size1) || !Number.isInteger(size2) || size1 < 0 || size2 !== leafHashes.length || size1 > size2) {
    throw new Error("merkle_consistency_args_invalid");
  }
  if (size1 === 0 || size1 === size2) return [];
  const walk = (prefix: number, hashes: Uint8Array[], complete: boolean): Uint8Array[] => {
    if (prefix === hashes.length) return complete ? [] : [rootInternal(hashes)];
    const point = splitPoint(hashes.length);
    return prefix <= point
      ? [...walk(prefix, hashes.slice(0, point), complete), rootInternal(hashes.slice(point))]
      : [...walk(prefix - point, hashes.slice(point), false), rootInternal(hashes.slice(0, point))];
  };
  return walk(size1, leafHashes, true).map((entry) => entry.slice());
}

const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((value, index) => value === b[index]);
const bitLength = (value: bigint): number => { let count = 0; for (let v = value; v > 0n; v >>= 1n) count++; return count; };
const ones = (value: bigint): number => { let count = 0; for (let v = value; v > 0n; v >>= 1n) count += Number(v & 1n); return count; };
const trailingZeros = (value: bigint): number => { let count = 0; for (let v = value; v > 0n && (v & 1n) === 0n; v >>= 1n) count++; return count; };

function proofShape(index: bigint, size: bigint): { inner: number; border: number } {
  const inner = bitLength(index ^ (size - 1n));
  return { inner, border: ones(index >> BigInt(inner)) };
}

function chainInner(seed: Uint8Array, proof: Uint8Array[], index: bigint): Uint8Array {
  return proof.reduce((state, sibling, offset) => ((index >> BigInt(offset)) & 1n) === 0n
    ? nodeHash(state, sibling)
    : nodeHash(sibling, state), seed);
}

function chainInnerRight(seed: Uint8Array, proof: Uint8Array[], index: bigint): Uint8Array {
  return proof.reduce((state, sibling, offset) => ((index >> BigInt(offset)) & 1n) === 1n
    ? nodeHash(sibling, state)
    : state, seed);
}

function chainBorder(seed: Uint8Array, proof: Uint8Array[]): Uint8Array {
  return proof.reduce((state, sibling) => nodeHash(sibling, state), seed);
}

export function verifyInclusion(index: number, size: number, hashedLeaf: Uint8Array, proof: Uint8Array[], root: Uint8Array): boolean {
  try {
    if (!Number.isInteger(index) || !Number.isInteger(size) || index < 0 || size <= index) return false;
    if (hashedLeaf.length !== HASH_SIZE || root.length !== HASH_SIZE || proof.some((entry) => entry.length !== HASH_SIZE)) return false;
    const shape = proofShape(BigInt(index), BigInt(size));
    if (proof.length !== shape.inner + shape.border) return false;
    const inner = chainInner(hashedLeaf, proof.slice(0, shape.inner), BigInt(index));
    return equal(chainBorder(inner, proof.slice(shape.inner)), root);
  } catch {
    return false;
  }
}

export function verifyConsistency(size1: number, size2: number, proof: Uint8Array[], root1: Uint8Array, root2: Uint8Array): boolean {
  try {
    if (!Number.isInteger(size1) || !Number.isInteger(size2) || size1 < 0 || size2 < size1) return false;
    if (root1.length !== HASH_SIZE || root2.length !== HASH_SIZE || proof.some((entry) => entry.length !== HASH_SIZE)) return false;
    if (size1 === size2) return proof.length === 0 && equal(root1, root2);
    if (size1 === 0 || proof.length === 0) return false;
    const firstSize = BigInt(size1), secondSize = BigInt(size2);
    const shape = proofShape(firstSize - 1n, secondSize);
    const shift = trailingZeros(firstSize);
    const innerCount = shape.inner - shift;
    let seed = proof[0];
    let start = 1;
    if (firstSize === 1n << BigInt(shift)) { seed = root1; start = 0; }
    if (proof.length !== start + innerCount + shape.border) return false;
    const rest = proof.slice(start);
    const mask = (firstSize - 1n) >> BigInt(shift);
    const reconstructed1 = chainBorder(chainInnerRight(seed, rest.slice(0, innerCount), mask), rest.slice(innerCount));
    if (!equal(reconstructed1, root1)) return false;
    const reconstructed2 = chainBorder(chainInner(seed, rest.slice(0, innerCount), mask), rest.slice(innerCount));
    return equal(reconstructed2, root2);
  } catch {
    return false;
  }
}

function hex32(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("merkle_hex_invalid");
  return hexToBytes(value);
}

export function receiptLeafHash(chainHashHex: string): Uint8Array {
  return leafHash(hex32(chainHashHex));
}

export function receiptHistoryRootHex(chainHashesHex: string[]): string {
  return bytesToHex(merkleRoot(chainHashesHex.map(hex32)));
}
