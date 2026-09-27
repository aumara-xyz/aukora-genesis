/**
 * The exact content-addressed object-body bytes, shared by operation
 * construction and memoryPut's object write without creating an
 * operation/effect import cycle.
 *
 * @module @aukora/broker/effect-body
 */
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { isExactMemoryPutArgs, KEY_SHAPE } from './memory-put-args.mjs'

/**
 * Produce the canonical JSON object and terminal newline stored as the object body.
 * @param {{key: string, value: unknown}} args - the supplied effect arguments.
 * @returns {string} the complete UTF-8 object-body text hashed, reviewed, and written.
 * @throws {TypeError} when the argument alphabet or key grammar is invalid.
 */
export function effectBody(args) {
  if (!isExactMemoryPutArgs(args)) throw new TypeError('effectBody: arguments-not-exact')
  if (!KEY_SHAPE.test(args.key)) throw new TypeError('effectBody: key-not-a-name')
  return `${canonicalJSON({ key: args.key, value: args.value })}\n`
}
