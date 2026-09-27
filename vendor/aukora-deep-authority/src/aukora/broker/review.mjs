/**
 * The shared human-review renderer. The plain-JavaScript issuer and the
 * TypeScript governed package both import this module, so the signing prompt
 * and the untrusted preview present the same operation artifact.
 *
 * @module @aukora/broker/review
 */
import { effectBody, operationDigest } from './operation.mjs'
import { COMPUTE_JOB, MEMORY_PUT, WORKSPACE_PATCH } from './effect-definition.mjs'
import { isExactComputeJobArgs } from './compute-job-args.mjs'
import { isExactWorkspacePatchArgs, workspacePatchBody } from './workspace-patch-args.mjs'

/**
 * Escape one bare review field. Newlines, tabs, NUL, ANSI/C0, C1, backslash,
 * and every non-ASCII code point render explicitly. The result contains only
 * printable ASCII, so source text cannot disappear, reorder text, or add a
 * field to the review artifact.
 * @param {string} text - the raw string to escape.
 * @returns {string} the escaped text; same visible content, explicit controls.
 */
export function escapeForReview(text) {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '\\') { out += '\\\\'; continue }
    if (ch === '\n') { out += '\\n'; continue }
    if (ch === '\r') { out += '\\r'; continue }
    if (ch === '\t') { out += '\\t'; continue }
    if (code < 0x20 || code > 0x7e) {
      out += `\\u{${code.toString(16)}}`
      continue
    }
    out += ch
  }
  return out
}

/**
 * Encode text as a printable-ASCII JSON string literal. JSON's existing
 * syntax and escapes remain unchanged; every raw non-ASCII BMP code point is
 * encoded as `\uXXXX`, and every astral code point as its JSON surrogate pair.
 * `JSON.parse()` recovers the exact string, and UTF-8 encoding that result
 * recovers the exact content-addressed object-body bytes.
 * @param {string} text - the exact UTF-8 text to represent.
 * @returns {string} one safe, reversible JSON string literal.
 */
function quoteReviewUtf8(text) {
  let out = ''
  for (const ch of JSON.stringify(text)) {
    const code = ch.codePointAt(0) ?? 0
    if (code > 0x7e) {
      if (code <= 0xffff) {
        out += `\\u${code.toString(16).padStart(4, '0')}`
      } else {
        const scalar = code - 0x10000
        const high = 0xd800 + (scalar >> 10)
        const low = 0xdc00 + (scalar & 0x3ff)
        out += `\\u${high.toString(16)}\\u${low.toString(16)}`
      }
      continue
    }
    out += ch
  }
  return out
}

/**
 * The exact review artifact as its individual lines: tool, destination, one
 * reversible JSON string literal containing the complete canonical
 * content-addressed object-body bytes, byte count, content digest, definition
 * digest, expiry, one-use, and operation digest. The object-body
 * representation includes its terminal newline and decodes with
 * `JSON.parse()` to the exact text hashed and written at the
 * content-addressed location.
 *
 * Every line is printable ASCII, because `escapeForReview` and
 * `quoteReviewUtf8` escape everything outside that range. Callers that bind a
 * projection to an approval rely on that: a line array carries no separator
 * an operand could forge.
 * @param {import('./operation.mjs').Operation | import('./operation.mjs').WorkspacePatchOperation} operation - the fixed operation to render.
 * @param {{key: string, value: unknown} | import('./workspace-patch-args.mjs').WorkspacePatchArgs} args - the exact arguments the operation was built from.
 * @returns {readonly string[]} the deterministic review lines (never truncated).
 */
export function reviewProjectionLines(operation, args) {
  if (operation.tool === WORKSPACE_PATCH) {
    if (!isExactWorkspacePatchArgs(args)) throw new TypeError('review:arguments-not-exact')
    return Object.freeze([
      `tool: ${operation.tool}`,
      `workspace: ${escapeForReview(args.workspace)}`,
      `path: ${escapeForReview(args.path)}`,
      `beforeSha256: ${args.beforeSha256 === null ? 'null (create only)' : args.beforeSha256}`,
      `contentUtf8: ${quoteReviewUtf8(workspacePatchBody(args))}`,
      `bytes: ${String(operation.bytes)}`,
      `contentSha256: ${operation.contentSha256}`,
      `definitionId: ${operation.definitionId}`,
      `expiry: ${String(operation.exp)}`,
      'oneUse: true',
      `operationDigest: ${operationDigest(operation)}`,
    ])
  }
  if (operation.tool === COMPUTE_JOB) {
    if (!isExactComputeJobArgs(args)) throw new TypeError('review:arguments-not-exact')
    return Object.freeze([
      `tool: ${operation.tool}`,
      `endpoint: ${escapeForReview(args.endpoint)}`,
      `imageSha256: ${args.imageSha256}`,
      `volumeSha256: ${args.volumeSha256}`,
      `decodeSha256: ${args.decodeSha256}`,
      `budgetSha256: ${args.budgetSha256}`,
      `definitionId: ${operation.definitionId}`,
      `expiry: ${String(operation.exp)}`,
      'oneUse: true',
      `operationDigest: ${operationDigest(operation)}`,
    ])
  }
  if (operation.tool !== MEMORY_PUT) throw new TypeError('review:tool-not-registered')
  return Object.freeze([
    `tool: ${operation.tool}`,
    `key: ${escapeForReview(args.key)}`,
    `effectBodyUtf8: ${quoteReviewUtf8(effectBody(args))}`,
    `bytes: ${String(operation.bytes)}`,
    `contentSha256: ${operation.contentSha256}`,
    `definitionId: ${operation.definitionId}`,
    `expiry: ${String(operation.exp)}`,
    'oneUse: true',
    `operationDigest: ${operationDigest(operation)}`,
  ])
}

/**
 * Render the exact review artifact as one multi-line string.
 * @param {import('./operation.mjs').Operation | import('./operation.mjs').WorkspacePatchOperation} operation - the fixed operation to render.
 * @param {{key: string, value: unknown} | import('./workspace-patch-args.mjs').WorkspacePatchArgs} args - the exact arguments the operation was built from.
 * @returns {string} the deterministic multi-line review artifact (never truncated).
 */
export function renderOperation(operation, args) {
  return reviewProjectionLines(operation, args).join('\n')
}
