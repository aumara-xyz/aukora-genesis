/**
 * One zero-WASI WebAssembly cell with one pinned `memory.put` proposal callback.
 *
 * The pinned module imports exactly one synchronous function:
 * `aukora.propose_memory_put`. It has no filesystem, network, clock, random,
 * process, environment, or WASI import. The module forwards four linear-memory
 * spans; the host writes and decodes them into an inert canonical JSON string.
 * The callback does not issue a grant or perform an effect. The default v4
 * product route validates and detaches these bytes before broker deposit.
 *
 * The inventory pins which callback the module can invoke; it cannot guarantee
 * that a changed callback remains inert. The Node embedder and the complete
 * harness remain outside the measured result.
 *
 * @module @aukora/guest/wasm-proposal-cell
 */
import { createHash } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { KEY_SHAPE, isExactMemoryPutArgs } from '../broker/memory-put-args.mjs'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'

const MODULE_BASE64 = 'AGFzbQEAAAABCQFgBH9/f38BfwIdAQZhdWtvcmEScHJvcG9zZV9tZW1vcnlfcHV0AAADAgEABQQBAQEBBxcCBm1lbW9yeQIACm1lbW9yeV9wdXQAAQoOAQwAIAAgASACIAMQAAs='
const MODULE_BYTES = Buffer.from(MODULE_BASE64, 'base64')
const EXPECTED_IMPORTS = Object.freeze([{
  module: 'aukora',
  name: 'propose_memory_put',
  kind: 'function',
}])
const EXPECTED_EXPORTS = Object.freeze([
  { name: 'memory', kind: 'memory' },
  { name: 'memory_put', kind: 'function' },
])
const MEMORY_BYTES = 64 * 1024
const utf8 = new TextDecoder('utf-8', { fatal: true })

/** SHA-256 of the pinned module compiled from `wasm/memory-put-proposal.wat`. */
export const MEMORY_PUT_PROPOSAL_WASM_SHA256 = '34ce6cab618b626243e876befb49ccf8a6780dc836e757484886b34ae977a438'

/**
 * Run one exact `memory.put` argument object through the proposal-only cell.
 *
 * @param {{key: string, value: unknown}} args - exact proposed arguments.
 * @returns {{toolName: 'memory.put', argumentsJson: string, moduleSha256: string}} inert proposal bytes and module identity.
 */
export function proposeMemoryPutInWasm(args) {
  if (!isExactMemoryPutArgs(args)) throw new TypeError('wasm-cell: arguments-not-exact')
  if (!KEY_SHAPE.test(args.key)) throw new TypeError('wasm-cell: key-not-a-name')

  const keyBytes = Buffer.from(args.key, 'utf8')
  const valueJson = canonicalJSON(args.value)
  const valueBytes = Buffer.from(valueJson, 'utf8')
  if (keyBytes.length + valueBytes.length > MEMORY_BYTES) {
    throw new RangeError('wasm-cell: proposal-too-large')
  }

  const module = compilePinnedModule()
  let proposal = null
  let memory = null
  const imports = {
    aukora: {
      propose_memory_put(keyOffset, keyLength, valueOffset, valueLength) {
        if (proposal !== null) throw new Error('wasm-cell: proposal-already-emitted')
        const key = decodeMemory(memory, keyOffset, keyLength, 'key')
        const encodedValue = decodeMemory(memory, valueOffset, valueLength, 'value')
        let value
        try {
          value = JSON.parse(encodedValue)
        } catch {
          throw new Error('wasm-cell: value-json-invalid')
        }
        if (canonicalJSON(value) !== encodedValue) {
          throw new Error('wasm-cell: value-json-not-canonical')
        }
        if (!KEY_SHAPE.test(key)) throw new Error('wasm-cell: key-not-a-name')
        proposal = Object.freeze({
          toolName: 'memory.put',
          argumentsJson: canonicalJSON({ key, value }),
          moduleSha256: MEMORY_PUT_PROPOSAL_WASM_SHA256,
        })
        return 1
      },
    },
  }
  const instance = new WebAssembly.Instance(module, imports)
  memory = instance.exports.memory
  if (!(memory instanceof WebAssembly.Memory) || memory.buffer.byteLength !== MEMORY_BYTES) {
    throw new Error('wasm-cell: memory-export-invalid')
  }
  const bytes = new Uint8Array(memory.buffer)
  bytes.set(keyBytes, 0)
  bytes.set(valueBytes, keyBytes.length)
  const result = instance.exports.memory_put(0, keyBytes.length, keyBytes.length, valueBytes.length)
  if (result !== 1 || proposal === null) throw new Error('wasm-cell: proposal-not-emitted')
  return proposal
}

/** Compile the pinned module and enforce its complete import/export inventory. */
function compilePinnedModule() {
  const digest = createHash('sha256').update(MODULE_BYTES).digest('hex')
  if (digest !== MEMORY_PUT_PROPOSAL_WASM_SHA256) throw new Error('wasm-cell: module-digest-mismatch')
  const module = new WebAssembly.Module(MODULE_BYTES)
  if (JSON.stringify(WebAssembly.Module.imports(module)) !== JSON.stringify(EXPECTED_IMPORTS)) {
    throw new Error('wasm-cell: import-inventory-mismatch')
  }
  if (JSON.stringify(WebAssembly.Module.exports(module)) !== JSON.stringify(EXPECTED_EXPORTS)) {
    throw new Error('wasm-cell: export-inventory-mismatch')
  }
  return module
}

/** Decode one bounds-checked UTF-8 span from the cell's linear memory. */
function decodeMemory(memory, offset, length, label) {
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('wasm-cell: memory-not-ready')
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw new Error(`wasm-cell: ${label}-range-invalid`)
  }
  if (offset + length > memory.buffer.byteLength) throw new Error(`wasm-cell: ${label}-range-invalid`)
  try {
    return utf8.decode(new Uint8Array(memory.buffer, offset, length))
  } catch {
    throw new Error(`wasm-cell: ${label}-utf8-invalid`)
  }
}
