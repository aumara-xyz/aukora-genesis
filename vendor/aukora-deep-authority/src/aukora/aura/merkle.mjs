/**
 * The Merkle fold over the record — RFC 6962 style, node:crypto only.
 *
 * The record's entries are leaves; the root folds the whole chain into one
 * commitment a future external anchor can witness. Domain separation is the
 * point (RFC 6962): leaf hashes carry a 0x00 prefix and node hashes a 0x01
 * prefix. The inclusion verifier accepts raw leaf data and applies the leaf
 * prefix itself, so a caller cannot substitute a pre-hashed internal node.
 * Ported from
 * aukora/packages/kernel/src/merkle.ts's split rule; written compact for the
 * record lane.
 *
 * @module @aukora/aura/merkle
 */
import { createHash } from 'node:crypto'

const sha = (data) => createHash('sha256').update(data).digest()
const ROOT_DOMAIN = Buffer.from('aukora:aura-merkle-root:v2\0', 'utf8')

const requireHash = (value, label) => {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    throw new TypeError(`${label} must be a 32-byte Buffer`)
  }
}

/**
 * Bind one RFC 6962 structural root to its exact tree size.
 *
 * @param {number} size - the exact number of leaves.
 * @param {Buffer} structuralRoot - the uncommitted RFC 6962 root.
 * @returns {Buffer} the Aura v2 root commitment.
 */
export function commitmentFromStructuralRoot(size, structuralRoot) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError('commitmentFromStructuralRoot: size must be a non-negative safe integer')
  }
  requireHash(structuralRoot, 'commitmentFromStructuralRoot: structuralRoot')
  const encodedSize = Buffer.alloc(8)
  encodedSize.writeBigUInt64BE(BigInt(size))
  return sha(Buffer.concat([ROOT_DOMAIN, encodedSize, structuralRoot]))
}

/** @param {Buffer} data @returns {Buffer} H(0x00 || data). */
export function leafHash(data) {
  if (!Buffer.isBuffer(data)) throw new TypeError('leafHash: data must be a Buffer')
  return sha(Buffer.concat([Buffer.from([0x00]), data]))
}

/** @param {Buffer} left @param {Buffer} right @returns {Buffer} H(0x01 || left || right). */
export function nodeHash(left, right) {
  requireHash(left, 'nodeHash: left')
  requireHash(right, 'nodeHash: right')
  return sha(Buffer.concat([Buffer.from([0x01]), left, right]))
}

/**
 * The root over a list of entry hashes. Odd levels promote the unpaired last
 * node unchanged to the next level.
 *
 * @param {Array<Buffer>} hashes - leaf hashes, in record order.
 * The returned commitment binds both the structural root and the exact leaf
 * count. A proof therefore cannot authenticate the same structural root under
 * a different tree size.
 *
 * @returns {Buffer} the size-bound root commitment.
 */
export function rootFromHashes(hashes) {
  validateHashes(hashes, 'rootFromHashes')
  const structuralRoot = rangeRoot(hashes, 0, hashes.length)
  return commitmentFromStructuralRoot(hashes.length, structuralRoot)
}

/**
 * Compute the uncommitted RFC 6962 root used by consistency proofs.
 *
 * This root is exported only so an external observer can verify append-only
 * growth. Authority decisions continue to use the size-bound commitment from
 * {@link rootFromHashes}.
 *
 * @param {Array<Buffer>} hashes - leaf hashes, in record order.
 * @returns {Buffer} the RFC 6962 structural root.
 */
export function structuralRootFromHashes(hashes) {
  validateHashes(hashes, 'structuralRootFromHashes')
  return rangeRoot(hashes, 0, hashes.length)
}

/**
 * Produce an RFC 6962 consistency proof from a retained prefix to this tree.
 *
 * @param {Array<Buffer>} hashes - the presented tree's leaf hashes.
 * @param {number} retainedSize - the exact retained prefix size.
 * @returns {Array<Buffer>} proof hashes in RFC 6962 order.
 */
export function consistencyProof(hashes, retainedSize) {
  validateHashes(hashes, 'consistencyProof')
  if (!Number.isSafeInteger(retainedSize) || retainedSize < 1 || retainedSize > hashes.length) {
    throw new RangeError(
      `consistencyProof: retainedSize ${retainedSize} out of range for ${hashes.length} leaves`,
    )
  }
  if (retainedSize === hashes.length) return []
  const proof = []
  appendConsistencySubproof(hashes, 0, retainedSize, hashes.length, true, proof)
  return proof
}

/**
 * An inclusion proof for the leaf at `index` of `size` leaves.
 *
 * @param {Array<Buffer>} hashes - leaf hashes, in record order.
 * @param {number} index - the leaf's position.
 * @returns {Array<{hash: Buffer}>} the proof path. Sibling direction is
 * derived from the trusted index and size rather than encoded in the proof.
 */
export function inclusionProof(hashes, index) {
  if (!Array.isArray(hashes)) throw new TypeError('inclusionProof: hashes must be an array')
  for (const [hashIndex, hash] of hashes.entries()) requireHash(hash, `inclusionProof: hashes[${hashIndex}]`)
  if (!Number.isSafeInteger(index) || index < 0 || index >= hashes.length) {
    throw new RangeError(`inclusionProof: index ${index} out of range for ${hashes.length} leaves`)
  }
  const proof = []
  let level = [...hashes]
  let i = index
  while (level.length > 1) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1
    if (sibling >= 0 && sibling < level.length) {
      proof.push({ hash: level[sibling] })
    } // else: carried up alone this level — nothing to combine with
    const next = []
    let j = 0
    for (; j + 1 < level.length; j += 2) next.push(nodeHash(level[j], level[j + 1]))
    if (j < level.length) next.push(level[j]) // odd-carry promotion
    level = next
    i = Math.floor(i / 2)
  }
  return proof
}

/**
 * Verify raw leaf data against a root through its proof.
 *
 * Position and sibling direction are derived strictly from `index` and `size`
 * at every level. The trusted root also commits to `size`; traversal alone is
 * not accepted as evidence of a claimed tree size.
 *
 * The verifier derives `leafHash(leafData)` itself. It never accepts a
 * caller-supplied leaf hash, which keeps the 0x00/0x01 domains load-bearing.
 *
 * Refuses (returns false) without throwing for any malformed input:
 * non-Buffer root/leaf data, a non-32-byte root or proof hash, extra fields,
 * accessor fields, out-of-range index/size, sparse or executable proof arrays,
 * truncated proofs, extra sibling steps, or prover-supplied step fields.
 *
 * @param {object} params
 * @param {Buffer} params.root - the trusted root.
 * @param {Buffer} params.leafData - the exact leaf bytes claimed present.
 * @param {number} params.index - the leaf's position.
 * @param {number} params.size - the tree size.
 * @param {Array<{hash: Buffer}>} params.proof
 * @returns {boolean}
 */
export function verifyInclusion(params) {
  const statement = snapshotDataObject(params, ['root', 'leafData', 'index', 'size', 'proof'])
  if (statement === null) return false
  const { root, leafData, index, size, proof } = statement
  if (!Buffer.isBuffer(root) || root.length !== 32) return false
  if (!Buffer.isBuffer(leafData)) return false
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(size)) return false
  if (index < 0 || index >= size || size < 1) return false
  const proofSteps = snapshotDataArray(proof)
  if (proofSteps === null) return false

  let current = leafHash(leafData)
  let i = index
  let n = size
  let proofIdx = 0

  while (n > 1) {
    const hasSibling = (i % 2 === 1) || (i + 1 < n)
    if (hasSibling) {
      if (proofIdx >= proofSteps.length) return false
      const step = snapshotDataObject(proofSteps[proofIdx++], ['hash'])
      if (step === null) return false
      if (!Buffer.isBuffer(step.hash) || step.hash.length !== 32) return false

      const derivedSide = (i % 2 === 1) ? 'left' : 'right'
      if (derivedSide === 'left') {
        current = nodeHash(step.hash, current)
      } else {
        current = nodeHash(current, step.hash)
      }
    }
    i = Math.floor(i / 2)
    n = Math.ceil(n / 2)
  }

  if (proofIdx !== proofSteps.length) return false
  return commitmentFromStructuralRoot(size, current).equals(root)
}

/** Validate an ordered list of 32-byte leaf hashes. */
function validateHashes(hashes, caller) {
  if (!Array.isArray(hashes)) throw new TypeError(`${caller}: hashes must be an array`)
  for (const [index, hash] of hashes.entries()) requireHash(hash, `${caller}: hashes[${index}]`)
  if (!Number.isSafeInteger(hashes.length)) throw new RangeError(`${caller}: unsafe tree size`)
}

/** Largest power of two strictly below a positive integer greater than one. */
function splitPoint(size) {
  let point = 1
  while (point * 2 < size) point *= 2
  return point
}

/** RFC 6962 Merkle Tree Hash for one contiguous range. */
function rangeRoot(hashes, start, end) {
  const size = end - start
  if (size === 0) return sha(Buffer.alloc(0))
  if (size === 1) return Buffer.from(hashes[start])
  const split = splitPoint(size)
  return nodeHash(
    rangeRoot(hashes, start, start + split),
    rangeRoot(hashes, start + split, end),
  )
}

/** RFC 6962 SUBPROOF, with `start` locating this subtree in the full tree. */
function appendConsistencySubproof(hashes, start, retainedSize, presentedSize, complete, proof) {
  if (retainedSize === presentedSize) {
    if (!complete) proof.push(rangeRoot(hashes, start, start + presentedSize))
    return
  }
  const split = splitPoint(presentedSize)
  if (retainedSize <= split) {
    appendConsistencySubproof(hashes, start, retainedSize, split, complete, proof)
    proof.push(rangeRoot(hashes, start + split, start + presentedSize))
    return
  }
  appendConsistencySubproof(
    hashes,
    start + split,
    retainedSize - split,
    presentedSize - split,
    false,
    proof,
  )
  proof.push(rangeRoot(hashes, start, start + split))
}

/** Copy one exact plain object's enumerable data fields without invoking code. */
function snapshotDataObject(value, expectedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.length !== expectedKeys.length
      || ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))) return null
    const snapshot = Object.create(null)
    for (const key of ownKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null
      snapshot[key] = descriptor.value
    }
    return snapshot
  } catch {
    return null
  }
}

/** Copy one dense plain array's data elements without invoking accessors. */
function snapshotDataArray(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    const length = lengthDescriptor?.value
    if (!Number.isSafeInteger(length) || length < 0) return null
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.length !== length + 1 || !ownKeys.includes('length')) return null
    const snapshot = []
    for (let index = 0; index < length; index++) {
      const key = String(index)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null
      snapshot.push(descriptor.value)
    }
    return snapshot
  } catch {
    return null
  }
}
