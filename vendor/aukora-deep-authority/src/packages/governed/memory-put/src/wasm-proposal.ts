/**
 * Validate and detach the proposal emitted by the pinned WebAssembly cell.
 *
 * The cell has no authority. This module treats its output as untrusted wire
 * data, requires the complete closed proposal fields, and returns only a fresh
 * parsed argument snapshot for the broker proposal client.
 */
import {
  MEMORY_PUT_PROPOSAL_WASM_SHA256,
  proposeMemoryPutInWasm,
} from '@aukora/core/guest/wasm-proposal-cell.mjs'
import { canonicalJSON } from '@aukora/core/kernel-seed/canonical-json.mjs'
import { MEMORY_PUT } from '@aukora/core/broker/effect-definition.mjs'
import { isExactMemoryPutArgs, KEY_SHAPE } from '@aukora/core/broker/memory-put-args.mjs'

type MemoryPutArgs = { key: string; value: unknown }

const PROPOSAL_FIELDS = ['argumentsJson', 'moduleSha256', 'toolName'] as const

/** Snapshot exactly the three enumerable data fields emitted by the cell. */
function exactCellProposal(input: unknown): {
  argumentsJson: string
  moduleSha256: string
  toolName: string
} | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  try {
    const prototype = Reflect.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) return null
    const ownKeys = Reflect.ownKeys(input)
    if (ownKeys.length !== PROPOSAL_FIELDS.length
      || PROPOSAL_FIELDS.some(field => !ownKeys.includes(field))) return null
    const values: Record<(typeof PROPOSAL_FIELDS)[number], unknown> = {
      argumentsJson: undefined,
      moduleSha256: undefined,
      toolName: undefined,
    }
    for (const field of PROPOSAL_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(input, field)
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null
      values[field] = descriptor.value
    }
    if (typeof values.argumentsJson !== 'string'
      || typeof values.moduleSha256 !== 'string'
      || typeof values.toolName !== 'string') return null
    return {
      argumentsJson: values.argumentsJson,
      moduleSha256: values.moduleSha256,
      toolName: values.toolName,
    }
  } catch {
    return null
  }
}

/**
 * Consume one untrusted cell proposal and return its detached exact arguments.
 *
 * @param proposal - proposal object emitted by the host callback.
 * @param executingArgs - exact JSON-domain arguments bound to the current tool execution.
 * @param reviewedArgs - exact JSON-domain arguments retained from pre-execute review binding.
 * @returns a fresh parsed snapshot containing only `key` and `value`.
 * @throws When the cell output or either argument binding is malformed, noncanonical, or mismatched.
 */
export function consumeMemoryPutCellProposal(
  proposal: unknown,
  executingArgs: MemoryPutArgs,
  reviewedArgs: MemoryPutArgs,
): MemoryPutArgs {
  const fields = exactCellProposal(proposal)
  if (fields === null) throw new Error('wasm-cell: proposal-fields-not-exact')
  if (fields.toolName !== MEMORY_PUT) throw new Error('wasm-cell: tool-name-mismatch')
  if (fields.moduleSha256 !== MEMORY_PUT_PROPOSAL_WASM_SHA256) {
    throw new Error('wasm-cell: module-digest-mismatch')
  }

  let detached: unknown
  try {
    detached = JSON.parse(fields.argumentsJson)
  } catch {
    throw new Error('wasm-cell: arguments-json-invalid')
  }
  if (!isExactMemoryPutArgs(detached)) throw new Error('wasm-cell: arguments-not-exact')
  if (!KEY_SHAPE.test(detached.key)) throw new Error('wasm-cell: key-not-a-name')
  if (canonicalJSON(detached) !== fields.argumentsJson) {
    throw new Error('wasm-cell: arguments-json-not-canonical')
  }

  const executingJson = canonicalJSON(executingArgs)
  const reviewedJson = canonicalJSON(reviewedArgs)
  if (fields.argumentsJson !== executingJson || fields.argumentsJson !== reviewedJson) {
    throw new Error('wasm-cell: arguments-binding-mismatch')
  }
  return detached
}

/**
 * Run the pinned cell and detach the proposal bytes it emits.
 *
 * @param executingArgs - exact JSON-domain arguments bound to the current tool execution.
 * @param reviewedArgs - exact JSON-domain arguments retained from pre-execute review binding.
 * @returns a fresh parsed snapshot containing only `key` and `value`.
 * @throws When the pinned cell or its detached proposal fails validation.
 */
export function proposeMemoryPutThroughCell(
  executingArgs: MemoryPutArgs,
  reviewedArgs: MemoryPutArgs,
): MemoryPutArgs {
  return consumeMemoryPutCellProposal(
    proposeMemoryPutInWasm(executingArgs),
    executingArgs,
    reviewedArgs,
  )
}
