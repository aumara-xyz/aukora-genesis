/**
 * Validate and detach the proposal emitted by the pinned proposal cell.
 *
 * This is a JavaScript port of the governed `wasm-proposal.ts` in the upstream
 * authority tree. The original is TypeScript and reaches its siblings through
 * `@aukora/core/...` path aliases, so it cannot be vendored; the checks below
 * are the same checks in the same order. What changed is only the address of
 * its imports: the cell and its two helpers are vendored under `wasm-cell/`.
 *
 * The cell has no authority. This module treats its output as untrusted wire
 * data, requires the complete closed proposal fields, and returns only a fresh
 * parsed argument snapshot.
 *
 * NOTHING HERE COMPILES AT IMPORT TIME. The pinned module is compiled inside
 * the call, on purpose. If it were compiled while this module loaded, a cell
 * whose embedded bytes had been altered would turn into a failed import of the
 * whole plugin and take the read path down with the write path: a caller that
 * only wanted to recall memory would lose recall because a proposal cell it
 * never used failed to build. A tampered cell must refuse one call, not the
 * package.
 *
 * @module @aukora/dsh-plugin-kira/wasm-proposal
 */
import { MEMORY_PUT_PROPOSAL_WASM_SHA256, proposeMemoryPutInWasm } from './wasm-cell/aukora/guest/wasm-proposal-cell.mjs'
import { canonicalJSON } from './wasm-cell/aukora/kernel-seed/canonical-json.mjs'
import { KEY_SHAPE, isExactMemoryPutArgs } from './wasm-cell/aukora/broker/memory-put-args.mjs'

/**
 * The one effect this cell may propose.
 *
 * Restated from the authority tree's effect definitions rather than imported:
 * pulling in a broker to learn one string would make this package depend on the
 * broker's whole closure. A restated constant is a copy, and a copy is only
 * honest when it is *checked* — which is why the cell's own emitted `toolName`
 * is compared against it below and a mismatch is a refusal, not a shrug.
 */
export const MEMORY_PUT = 'memory.put'

/** Linear-memory budget of the pinned cell: `MEMORY_BYTES` in its wrapper. */
export const MEMORY_PUT_PROPOSAL_BUDGET_BYTES = 64 * 1024

/**
 * The exact UTF-8 object-body text for one `memory.put` pair.
 *
 * Restated here, not imported from the record module, so this adapter can be
 * read and tested without the record closure and so the record module is not
 * asked to keep an export alive for a consumer it does not know about. The
 * caller is expected to have computed the same text by its own route; the two
 * are compared byte for byte, so a restatement that drifted would refuse a
 * correct proposal rather than silently accept a different one.
 *
 * @param {{key: string, value: unknown}} args - effect arguments.
 * @returns {string} the UTF-8 body text; one trailing LF, nothing else.
 * @throws {TypeError} when the key grammar is invalid.
 */
export function cellEffectBody(args) {
  if (!KEY_SHAPE.test(args.key)) throw new TypeError('wasm-cell: key-not-a-name')
  return `${canonicalJSON({ key: args.key, value: args.value })}\n`
}

/** The three enumerable data fields the cell may emit, and no others. */
const PROPOSAL_FIELDS = Object.freeze(['argumentsJson', 'moduleSha256', 'toolName'])

/**
 * Snapshot exactly the three enumerable data fields emitted by the cell.
 *
 * Every access is a descriptor read, never a property read, so an accessor or a
 * proxy cannot run code during validation. A null prototype is accepted because
 * `Object.freeze` on an object literal still leaves `Object.prototype` in
 * place; anything else with a prototype is refused as not-cell-shaped.
 *
 * @param {unknown} input - candidate proposal from an untrusted boundary.
 * @returns {{argumentsJson: string, moduleSha256: string, toolName: string} | null} the snapshot, or null when not exact.
 */
function exactCellProposal(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  try {
    const prototype = Reflect.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) return null
    const ownKeys = Reflect.ownKeys(input)
    if (ownKeys.length !== PROPOSAL_FIELDS.length
      || PROPOSAL_FIELDS.some(field => !ownKeys.includes(field))) return null
    /** @type {Record<string, unknown>} */
    const values = { argumentsJson: undefined, moduleSha256: undefined, toolName: undefined }
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
 * @param {unknown} proposal - proposal object emitted by the host callback.
 * @param {{key: string, value: unknown}} executingArgs - exact arguments bound to the current execution.
 * @param {{key: string, value: unknown}} reviewedArgs - exact arguments retained from an independent binding.
 * @returns {{key: string, value: unknown}} a fresh parsed snapshot containing only `key` and `value`.
 * @throws {Error} when the cell output or either argument binding is malformed, noncanonical, or mismatched.
 */
export function consumeMemoryPutCellProposal(proposal, executingArgs, reviewedArgs) {
  const fields = exactCellProposal(proposal)
  if (fields === null) throw new Error('wasm-cell: proposal-fields-not-exact')
  if (fields.toolName !== MEMORY_PUT) throw new Error('wasm-cell: tool-name-mismatch')
  if (fields.moduleSha256 !== MEMORY_PUT_PROPOSAL_WASM_SHA256) {
    throw new Error('wasm-cell: module-digest-mismatch')
  }

  let detached
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
 * @param {{key: string, value: unknown}} executingArgs - exact arguments bound to the current execution.
 * @param {{key: string, value: unknown}} reviewedArgs - exact arguments retained from an independent binding.
 * @returns {{key: string, value: unknown}} a fresh parsed snapshot containing only `key` and `value`.
 * @throws {Error} when the pinned cell or its detached proposal fails validation.
 */
export function proposeMemoryPutThroughCell(executingArgs, reviewedArgs) {
  return consumeMemoryPutCellProposal(
    proposeMemoryPutInWasm(executingArgs),
    executingArgs,
    reviewedArgs,
  )
}

/**
 * Run the pinned cell and prove the result is exactly the staged record.
 *
 * This is the seam the staging tool calls. It adds three checks on top of the
 * port, because staging knows things a general broker deposit does not:
 *
 * 1. the detached arguments must re-encode to the caller's expected body — the
 *    caller computed that body itself, from the staged record, before the cell
 *    was instantiated, so the cell is being asked to reproduce a decision it did
 *    not make;
 * 2. the detached key must be the caller's own record identifier, so a cell
 *    cannot propose a *well-formed* effect over a different key;
 * 3. the detached value must re-verify against the record contract, so a
 *    canonical but altered record is refused here rather than after deposit.
 *
 * Checks 1 and 2 TOGETHER bind the value, and that is worth being exact about.
 * The body is the canonical encoding of the pair, so a matching body means the
 * value is canonically equal to the staged one; the key check then rejects any
 * pair whose key differs. There is deliberately no separate `value` comparison:
 * comparing the value against itself is the check that cannot fail, and adding
 * one would suggest a binding this seam does not actually depend on.
 *
 * `verify` and the expected body are injected rather than imported so this
 * adapter stays independent of the record module, and so a caller cannot
 * accidentally get the checks without supplying the means to perform them.
 *
 * @param {unknown} executingArgs - exact argument object handed to the cell.
 * @param {{key: string, value: unknown}} reviewedArgs - exact arguments retained from an independent binding.
 * @param {{expectedBody: string, expectedKey: string, verify: (value: unknown) => {verified: boolean, record?: unknown}}} expectations - the caller's own independent expectations.
 * @returns {{key: string, value: unknown}} the detached arguments, proven to be exactly the expected effect.
 * @throws {Error} when the cell refuses, or the detached arguments are not exactly the expected effect.
 */
export function proposeMemoryPutProven(executingArgs, reviewedArgs, expectations) {
  const detached = proposeMemoryPutThroughCell(executingArgs, reviewedArgs)

  const expectedBody = expectations.expectedBody
  if (typeof expectedBody !== 'string') throw new Error('wasm-cell: expected-effect-body-not-text')
  // Compared as text: for a given string there is exactly one UTF-8 encoding, so
  // string equality and byte equality are the same relation here, and asserting
  // the bytes separately would be the same check written twice.
  const detachedBody = cellEffectBody(detached)
  if (detachedBody !== expectedBody) throw new Error('wasm-cell: effect-body-mismatch')

  if (detached.key !== expectations.expectedKey) throw new Error('wasm-cell: effect-key-mismatch')

  const verified = expectations.verify(detached.value)
  if (verified === null || typeof verified !== 'object' || verified.verified !== true) {
    throw new Error('wasm-cell: effect-value-unverified')
  }
  if (verified.record === null || typeof verified.record !== 'object'
    || verified.record.recordId !== expectations.expectedKey) {
    throw new Error('wasm-cell: effect-value-unverified')
  }
  return detached
}

/**
 * The quantity the pinned cell's budget actually limits: the key's bytes plus
 * the canonical value's bytes.
 *
 * This is NOT the length of the effect body, and the difference is not one
 * byte. The body is the canonical encoding of the PAIR `{key, value}`, so it
 * repeats the key and adds `{`, `}`, `"key":` and `"value":` around the two —
 * larger than the sum by the key's length plus three. Reporting the body length
 * as though it were the budgeted quantity would print a number that disagrees
 * with the budget beside it, and would move the apparent boundary.
 *
 * @param {{key: string, value: unknown}} args - effect arguments.
 * @returns {number} bytes the cell counts against its linear memory.
 */
export function cellBudgetedBytes(args) {
  return Buffer.byteLength(args.key, 'utf8') + Buffer.byteLength(canonicalJSON(args.value), 'utf8')
}

/**
 * Name the pinned cell's own refusal in the terms the caller needs.
 *
 * The cell refuses a proposal larger than its linear memory with the bare code
 * `proposal-too-large`. Callers that only surface an error message to a model
 * need the number and the budget in the text, so this maps that refusal to a
 * message that carries both. An error that is not the cell's own is returned
 * unchanged: this must not grow into a catch-all that relabels every failure.
 *
 * The number named is the one the cell itself compared, measured by the caller
 * through `cellBudgetedBytes`. The cell's comparison is `>`, not `>=`, so a
 * proposal of exactly 65,536 bytes is accepted and the first refusal sits one
 * byte above it.
 *
 * @param {unknown} error - whatever the cell call threw.
 * @param {number} budgetedBytes - key bytes plus canonical value bytes for the refused proposal.
 * @returns {{code: string, message: string} | null} the named refusal, or null to rethrow unchanged.
 */
export function describeProposalRefusal(error, budgetedBytes) {
  const text = error instanceof Error ? error.message : String(error)
  if (text !== 'wasm-cell: proposal-too-large') return null
  return {
    code: 'proposal-too-large',
    message: `proposal-too-large: key+value is ${budgetedBytes} bytes, the cell holds ${MEMORY_PUT_PROPOSAL_BUDGET_BYTES}; nothing was written`,
  }
}
