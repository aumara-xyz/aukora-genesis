/** SHA-256 of the pinned proposal-only WebAssembly module. */
export const MEMORY_PUT_PROPOSAL_WASM_SHA256: string

/** Run one exact `memory.put` argument object through the proposal-only cell. */
export function proposeMemoryPutInWasm(args: {
  key: string
  value: unknown
}): {
  toolName: 'memory.put'
  argumentsJson: string
  moduleSha256: string
}
