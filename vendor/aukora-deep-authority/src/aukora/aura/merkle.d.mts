/** Hash raw leaf data in the RFC 6962 leaf domain. */
export function leafHash(data: Buffer): Buffer

/** Hash two child roots in the RFC 6962 node domain. */
export function nodeHash(left: Buffer, right: Buffer): Buffer

/** Bind one RFC 6962 structural root to its exact tree size. */
export function commitmentFromStructuralRoot(size: number, structuralRoot: Buffer): Buffer

/** Compute Aura's size-bound v2 root commitment. */
export function rootFromHashes(hashes: Buffer[]): Buffer

/** Compute the uncommitted RFC 6962 root used by consistency proofs. */
export function structuralRootFromHashes(hashes: Buffer[]): Buffer

/** Produce an RFC 6962 consistency proof from a retained prefix. */
export function consistencyProof(hashes: Buffer[], retainedSize: number): Buffer[]

/** Produce an inclusion path for one leaf position. */
export function inclusionProof(hashes: Buffer[], index: number): Array<{ hash: Buffer }>

/** Verify raw leaf data against Aura's size-bound root commitment. */
export function verifyInclusion(params: {
  root: Buffer
  leafData: Buffer
  index: number
  size: number
  proof: Array<{ hash: Buffer }>
}): boolean
