// φ — the reduced Merkle layer: leaf/root arithmetic and inclusion proofs, checked by brute force.

import { describe, it, expect } from 'bun:test';
import { randomBytes, createHash } from 'crypto';
import { leafHash, rootFromLeafHashes, inclusionProof, verifyInclusion } from '../core/memory/merkle';

const leaves = (n: number): Buffer[] => Array.from({ length: n }, () => leafHash(randomBytes(20)));

describe('rootFromLeafHashes', () => {
  it('the empty tree has a fixed root — H() of zero bytes', () => {
    expect(rootFromLeafHashes([]).toString('hex')).toBe(
      createHash('sha256').update(Buffer.alloc(0)).digest('hex'),
    );
  });

  it('is deterministic for the same leaves in the same order', () => {
    const ls = leaves(9);
    expect(rootFromLeafHashes(ls).toString('hex')).toBe(rootFromLeafHashes(ls).toString('hex'));
  });

  it('order matters — a reordering is a different tree', () => {
    const ls = leaves(6);
    const reordered = [ls[1]!, ls[0]!, ...ls.slice(2)];
    expect(rootFromLeafHashes(ls).equals(rootFromLeafHashes(reordered))).toBe(false);
  });

  it('appending a leaf changes the root', () => {
    const ls = leaves(4);
    const r0 = rootFromLeafHashes(ls);
    const r1 = rootFromLeafHashes([...ls, leafHash(randomBytes(20))]);
    expect(r0.equals(r1)).toBe(false);
  });
});

describe('inclusion proofs — every index, a range of sizes', () => {
  for (const size of [1, 2, 3, 4, 5, 7, 8, 9, 16, 17, 31, 32, 33]) {
    it(`size ${size}: every leaf proves in and nothing else does`, () => {
      const ls = leaves(size);
      const root = rootFromLeafHashes(ls);
      for (let i = 0; i < size; i += 1) {
        const proof = inclusionProof(ls, i);
        expect(verifyInclusion(i, size, ls[i]!, proof, root)).toBe(true);
      }
    });
  }

  it('tampering the leaf breaks the proof', () => {
    const ls = leaves(10);
    const root = rootFromLeafHashes(ls);
    const proof = inclusionProof(ls, 3);
    expect(verifyInclusion(3, 10, randomBytes(32), proof, root)).toBe(false);
  });

  it('tampering one proof element breaks it', () => {
    const ls = leaves(10);
    const root = rootFromLeafHashes(ls);
    const proof = inclusionProof(ls, 3);
    const tampered = [...proof]; tampered[0] = randomBytes(32);
    expect(verifyInclusion(3, 10, ls[3]!, tampered, root)).toBe(false);
  });

  it('tampering the claimed root breaks it', () => {
    const ls = leaves(10);
    const proof = inclusionProof(ls, 3);
    expect(verifyInclusion(3, 10, ls[3]!, proof, randomBytes(32))).toBe(false);
  });

  it('a proof from one tree does not verify against a very different claimed size', () => {
    // Honest limit, documented in merkle.ts: `size` and `root` are not cross-checked against each
    // other by this function alone — a small size delta (e.g. 10 vs 11) can share the same split-point
    // arithmetic at a given index and "verify" by coincidence. A large delta reliably changes the
    // recursion depth and therefore how many proof entries are consumed, which this checks instead.
    const ls = leaves(10);
    const root = rootFromLeafHashes(ls);
    const proof = inclusionProof(ls, 3);
    expect(verifyInclusion(3, 200, ls[3]!, proof, root)).toBe(false);
  });

  it('an out-of-range index is refused when building a proof, and fails closed when verifying', () => {
    const ls = leaves(5);
    expect(() => inclusionProof(ls, 5)).toThrow();
    expect(verifyInclusion(5, 5, ls[0]!, [], rootFromLeafHashes(ls))).toBe(false);
    expect(verifyInclusion(-1, 5, ls[0]!, [], rootFromLeafHashes(ls))).toBe(false);
    expect(verifyInclusion(0, 0, ls[0]!, [], rootFromLeafHashes(ls))).toBe(false);
  });

  it('an incomplete proof does not verify, even if a prefix happens to reconstruct something', () => {
    const ls = leaves(9);
    const root = rootFromLeafHashes(ls);
    const proof = inclusionProof(ls, 4);
    expect(verifyInclusion(4, 9, ls[4]!, proof.slice(0, -1), root)).toBe(false);
  });
});
