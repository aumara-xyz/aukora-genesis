export { definitionDigest, MEMORY_PUT, MEMORY_PUT_DEFINITION } from './effect-definition.mjs'

/** A later observation of the named content-addressed object. */
export declare function observe(path: string): {
  status: 'observed'
  bytes: number
  contentSha256: string
  inode: number
  mtimeNs: string
} | { status: 'absent' } | { status: 'unobservable' }

/** Perform the write; the broker API does not overwrite a valid content-addressed object. */
export declare function memoryPut(
  stateDir: string,
  args: { key: string; value: unknown },
): {
  path: string
  bytes: number
  contentSha256: string
  inode: number
  mtimeNs: string
}

/** Rebuild the derived key projection after verifying Aura and the bidirectional object inventory. */
export declare function rebuildIndex(
  stateDir: string,
): { ok: true; projections: number } | { ok: false; reason: string }
