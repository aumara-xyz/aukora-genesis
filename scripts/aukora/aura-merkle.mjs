// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
// Port of vendor/authority/src/merkle.ts's RFC 6962 fold and SUBPROOF, using node:crypto.
import { createHash } from 'node:crypto'

const sha = (bytes) => createHash('sha256').update(bytes).digest()
const leaf = (bytes) => sha(Buffer.concat([Buffer.from([0]), bytes]))
const node = (left, right) => sha(Buffer.concat([Buffer.from([1]), left, right]))
const split = (n) => { let k = 1; while (k * 2 < n) k *= 2; return k }
const fold = (hashes) => {
  if (!hashes.length) return sha(Buffer.alloc(0))
  if (hashes.length === 1) return hashes[0]
  const k = split(hashes.length)
  return node(fold(hashes.slice(0, k)), fold(hashes.slice(k)))
}

/** Raw leaf bytes in; lowercase hex digest out. No size-binding wrapper. */
export const root = (leaves) => fold(leaves.map(leaf)).toString('hex')

/** RFC 6962 §2.1.2, in the verifier's hex proof order. */
export function consistencyProof(leaves, m, n = leaves.length) {
  if (!Number.isSafeInteger(m) || !Number.isSafeInteger(n) || m < 0 || m > n || n > leaves.length) {
    throw new RangeError('invalid_tree_sizes')
  }
  if (m === 0 || m === n) return []
  const subproof = (hashes, size, complete) => {
    if (size === hashes.length) return complete ? [] : [fold(hashes)]
    const k = split(hashes.length)
    return size <= k
      ? [...subproof(hashes.slice(0, k), size, complete), fold(hashes.slice(k))]
      : [...subproof(hashes.slice(k), size - k, false), fold(hashes.slice(0, k))]
  }
  return subproof(leaves.slice(0, n).map(leaf), m, true).map((hash) => hash.toString('hex'))
}
