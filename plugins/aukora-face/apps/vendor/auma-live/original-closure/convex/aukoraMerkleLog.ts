// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
/**
 * AUKORA MERKLE LOG (B1.5a) — RFC 6962 / RFC 9162 append-only Merkle math over the receipt chain. Design record:
 * canon/AUKORA_MERKLE_LOG_DESIGN.md. Pattern source: Certificate Transparency (and the rekor pattern) —
 * REIMPLEMENTED, never imported, never a service.
 *
 * This module is PURE MATH WITH NO AUTHORITY. It computes and checks hashes; it never decides whether an effect is
 * allowed, never gates, and is fully recomputable from the receipts alone (drop every derived value, re-derive it —
 * the receipts remain the only source of truth). Glyphs/memory/UI/this layer are witnesses, never authority.
 *
 * Hashing is RFC 6962 EXACT — leafHash = SHA-256(0x00 ‖ leaf), nodeHash = SHA-256(0x01 ‖ L ‖ R),
 * emptyRoot = SHA-256(""). The 0x00/0x01 domain separation is the standard second-preimage defence (an interior
 * node can never be reinterpreted as a leaf). No extra Aukora prefix — RFC-exactness buys interop with every CT
 * verifier and the published security analysis; our leaf INPUTS are already domain-bound (receipt chainHashes).
 *
 * Fail-closed asymmetry mirrors the signing layer: BUILDERS throw on invalid arguments (a broken prover must
 * error); VERIFIERS return false on anything malformed — never an exception. The verifiers are a faithful port of
 * transparency-dev/merkle proof/verify.go (RootFromInclusionProof / RootFromConsistencyProof), corroborated against
 * the CT reference known-answer vectors (tests/vectors/ct-rfc6962-merkle.json).
 *
 * PURE: no Convex, no Node APIs, no WASM, no new dependency. @noble/hashes sha256 only; synchronous; byte-identical
 * across Convex's V8 isolate, the edge-runtime test runner, and extracted TS clients. Index/size arithmetic avoids
 * the 32-bit shift trap entirely: the verifiers use BigInt (exact at any size); the builders use integer
 * multiplication (exact to 2^53 — past JS's array-length ceiling). Builder outputs are defensive copies, never
 * aliases of the caller's leaf buffers.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, concatBytes } from "@noble/hashes/utils.js";

const HASH_SIZE = 32;
const LEAF_PREFIX = Uint8Array.of(0x00);
const NODE_PREFIX = Uint8Array.of(0x01);

// ── RFC 6962 hashing primitives ──
/** leafHash(leaf) = SHA-256(0x00 ‖ leaf). */
export function leafHash(leaf: Uint8Array): Uint8Array {
  return sha256(concatBytes(LEAF_PREFIX, leaf));
}
/** nodeHash(l, r) = SHA-256(0x01 ‖ l ‖ r). */
export function nodeHash(l: Uint8Array, r: Uint8Array): Uint8Array {
  return sha256(concatBytes(NODE_PREFIX, l, r));
}
/** The empty-tree root: SHA-256(""). */
export function emptyRootHash(): Uint8Array {
  return sha256(new Uint8Array(0));
}

// Largest power of two STRICTLY less than n (n >= 2). 2→1, 3→2, 5→4, 8→4. Integer multiplication (NOT `<< 1`, which
// overflows int32 at k=2^30 and would non-terminate) — exact to 2^53, past JS's 2^32-1 array-length ceiling.
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** RFC 6962 §2.1 Merkle Tree Hash over LEAF HASHES. Internal: a single-element subtree returns its element BY
 *  REFERENCE (an alias of the caller's buffer) — only the copying public wrappers below are exported, so no aliased
 *  buffer ever escapes to a caller. Pure; recursive; O(n). */
function rootHashesInternal(hashes: Uint8Array[]): Uint8Array {
  const n = hashes.length;
  if (n === 0) return emptyRootHash();
  if (n === 1) return hashes[0]; // may alias — wrappers copy before returning
  const k = splitPoint(n);
  return nodeHash(rootHashesInternal(hashes.slice(0, k)), rootHashesInternal(hashes.slice(k)));
}

/** Merkle root over an array of LEAF HASHES (already prefixed). Returns a fresh buffer (never an input alias). */
export function rootFromLeafHashes(hashes: Uint8Array[]): Uint8Array {
  return rootHashesInternal(hashes).slice();
}

/** Merkle root over raw leaf INPUTS (each is leaf-hashed first). Returns a fresh buffer. */
export function merkleRoot(leaves: Uint8Array[]): Uint8Array {
  return rootHashesInternal(leaves.map(leafHash)).slice();
}

// ── Proof BUILDERS (throw on invalid args). Operate over leaf hashes; return sibling hashes bottom→top. ──
/** RFC 6962 §2.1.1 inclusion path for leaf `index` in a tree of the given leaf hashes. */
export function inclusionProof(leafHashes: Uint8Array[], index: number): Uint8Array[] {
  const n = leafHashes.length;
  if (!Number.isInteger(index) || index < 0 || index >= n) throw new Error(`aukora_merkle_index_oob:${index}/${n}`);
  const path = (m: number, hs: Uint8Array[]): Uint8Array[] => {
    if (hs.length === 1) return [];
    const k = splitPoint(hs.length);
    return m < k
      ? [...path(m, hs.slice(0, k)), rootHashesInternal(hs.slice(k))]
      : [...path(m - k, hs.slice(k)), rootHashesInternal(hs.slice(0, k))];
  };
  return path(index, leafHashes).map((h) => h.slice()); // copy so no proof element aliases a caller leaf buffer
}

/** RFC 6962 §2.1.2 consistency proof that a tree of size1 leaf hashes is a prefix of the size2 tree. */
export function consistencyProof(leafHashes: Uint8Array[], size1: number, size2: number): Uint8Array[] {
  const n = leafHashes.length;
  if (!Number.isInteger(size1) || !Number.isInteger(size2) || size1 < 0 || size2 !== n || size1 > size2) {
    throw new Error(`aukora_merkle_consistency_args:${size1},${size2}/${n}`);
  }
  if (size1 === 0 || size1 === size2) return [];
  const sub = (m: number, hs: Uint8Array[], b: boolean): Uint8Array[] => {
    if (m === hs.length) return b ? [] : [rootHashesInternal(hs)];
    const k = splitPoint(hs.length);
    return m <= k
      ? [...sub(m, hs.slice(0, k), b), rootHashesInternal(hs.slice(k))]
      : [...sub(m - k, hs.slice(k), false), rootHashesInternal(hs.slice(0, k))];
  };
  return sub(size1, leafHashes.slice(0, size2), true).map((h) => h.slice()); // copy: no element aliases a caller leaf
}

// ── BigInt bit helpers (exact at any size) ──
const len64 = (x: bigint): number => { let n = 0; while (x > 0n) { n++; x >>= 1n; } return n; };
const onesCount = (x: bigint): number => { let n = 0; while (x > 0n) { n += Number(x & 1n); x >>= 1n; } return n; };
// Note: returns 0 for x=0 (Go's bits.TrailingZeros64(0) returns 64). Safe — the only caller, rootFromConsistencyProof,
// rejects size1===0 before reaching this; documented so the deviation from the faithful port is not a latent trap.
const trailingZeros = (x: bigint): number => { if (x === 0n) return 0; let n = 0; while ((x & 1n) === 0n) { n++; x >>= 1n; } return n; };
const isBytes = (x: unknown): x is Uint8Array => x instanceof Uint8Array;
const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

// Faithful ports of transparency-dev/merkle proof/verify.go ──
function decompInclProof(index: bigint, size: bigint): { inner: number; border: number } {
  const inner = len64(index ^ (size - 1n)); // innerProofSize
  const border = onesCount(index >> BigInt(inner));
  return { inner, border };
}
function chainInner(seed: Uint8Array, proof: Uint8Array[], index: bigint): Uint8Array {
  let s = seed;
  for (let i = 0; i < proof.length; i++) {
    s = ((index >> BigInt(i)) & 1n) === 0n ? nodeHash(s, proof[i]) : nodeHash(proof[i], s);
  }
  return s;
}
function chainInnerRight(seed: Uint8Array, proof: Uint8Array[], index: bigint): Uint8Array {
  let s = seed;
  for (let i = 0; i < proof.length; i++) {
    if (((index >> BigInt(i)) & 1n) === 1n) s = nodeHash(proof[i], s);
  }
  return s;
}
function chainBorderRight(seed: Uint8Array, proof: Uint8Array[]): Uint8Array {
  let s = seed;
  for (const h of proof) s = nodeHash(h, s);
  return s;
}

/** Reconstruct the root from an inclusion proof, or null if the arguments are structurally invalid. */
function rootFromInclusionProof(index: bigint, size: bigint, lh: Uint8Array, proof: Uint8Array[]): Uint8Array | null {
  if (index >= size) return null;
  if (lh.length !== HASH_SIZE) return null;
  const { inner, border } = decompInclProof(index, size);
  if (proof.length !== inner + border) return null;
  if (proof.some((p) => p.length !== HASH_SIZE)) return null;
  let res = chainInner(lh, proof.slice(0, inner), index);
  res = chainBorderRight(res, proof.slice(inner));
  return res;
}

/** Reconstruct the size2 root from a consistency proof anchored at root1, or null if structurally invalid. */
function rootFromConsistencyProof(size1: bigint, size2: bigint, proof: Uint8Array[], root1: Uint8Array): Uint8Array | null {
  if (size2 < size1) return null;
  if (size1 === size2) return proof.length > 0 ? null : root1;
  if (size1 === 0n) return null; // consistency from an empty tree is meaningless
  if (proof.length === 0) return null;
  if (root1.length !== HASH_SIZE || proof.some((p) => p.length !== HASH_SIZE)) return null;
  let { inner, border } = decompInclProof(size1 - 1n, size2);
  const shift = trailingZeros(size1);
  inner -= shift;
  let seed = proof[0];
  let start = 1;
  if (size1 === 1n << BigInt(shift)) { seed = root1; start = 0; }
  if (proof.length !== start + inner + border) return null;
  const p = proof.slice(start);
  const mask = (size1 - 1n) >> BigInt(shift);
  let hash1 = chainInnerRight(seed, p.slice(0, inner), mask);
  hash1 = chainBorderRight(hash1, p.slice(inner));
  if (!eq(hash1, root1)) return null; // the proof must reproduce the FIRST root or it is forged
  let hash2 = chainInner(seed, p.slice(0, inner), mask);
  hash2 = chainBorderRight(hash2, p.slice(inner));
  return hash2;
}

/** Verify a leaf's inclusion in a tree committed by `root`. FALSE on any malformed/forged input (never throws). */
export function verifyInclusion(index: number, size: number, lh: Uint8Array, proof: Uint8Array[], root: Uint8Array): boolean {
  try {
    if (!Number.isInteger(index) || !Number.isInteger(size) || index < 0 || size < 0) return false;
    if (!isBytes(lh) || !isBytes(root) || !Array.isArray(proof) || !proof.every(isBytes)) return false; // enforce the byte contract fail-closed
    const res = rootFromInclusionProof(BigInt(index), BigInt(size), lh, proof);
    return res !== null && eq(res, root);
  } catch {
    return false;
  }
}

/** Verify that the tree committed by root1 (size1) is an append-only prefix of root2 (size2). FALSE on any failure. */
export function verifyConsistency(size1: number, size2: number, proof: Uint8Array[], root1: Uint8Array, root2: Uint8Array): boolean {
  try {
    if (!Number.isInteger(size1) || !Number.isInteger(size2) || size1 < 0 || size2 < 0) return false;
    if (!isBytes(root1) || !isBytes(root2) || !Array.isArray(proof) || !proof.every(isBytes)) return false; // enforce the byte contract fail-closed
    const res = rootFromConsistencyProof(BigInt(size1), BigInt(size2), proof, root1);
    return res !== null && eq(res, root2);
  } catch {
    return false;
  }
}

// ── Hex convenience wrappers (the kernel stores hashes as hex; these match that convention) ──
const toBytes = (h: string): Uint8Array => hexToBytes(h);
export function merkleRootHex(leafInputsHex: string[]): string { return bytesToHex(merkleRoot(leafInputsHex.map(toBytes))); }
export function rootFromLeafHashesHex(leafHashesHex: string[]): string { return bytesToHex(rootFromLeafHashes(leafHashesHex.map(toBytes))); }
export function inclusionProofHex(leafHashesHex: string[], index: number): string[] { return inclusionProof(leafHashesHex.map(toBytes), index).map(bytesToHex); }
export function consistencyProofHex(leafHashesHex: string[], s1: number, s2: number): string[] { return consistencyProof(leafHashesHex.map(toBytes), s1, s2).map(bytesToHex); }

// ── THE RECEIPT HISTORY CONVENTION (used by SignedChainHeadV4 / B1.5b) — defined ONCE so call sites cannot pick the
//    wrong primitive (adversarial review B1.5b1, HIGH). A receipt's 32-byte chainHash is the RAW leaf INPUT; RFC 6962
//    leaf-hashes it internally (0x00 prefix). NEVER pass an already-leaf-hashed value to receiptHistoryRootHex — that
//    double-hashes and yields a root no proof can match — and NEVER pass a raw chainHash where a leaf HASH is expected.
/** The leaf hash of a receipt chainHash (hex) — the per-receipt value an inclusion/consistency proof uses. */
export function receiptLeafHash(chainHashHex: string): Uint8Array { return leafHash(toBytes(chainHashHex)); }
/** The append-only history root (hex) over a chain's receipt chainHashes in chain order — the value bound into a V4
 *  head. This is the ONLY correct way to compute the V4 merkle_root; B1.5b2 mints the root via this helper. */
export function receiptHistoryRootHex(chainHashesHex: string[]): string { return merkleRootHex(chainHashesHex); }
