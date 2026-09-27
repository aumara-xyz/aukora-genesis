/**
 * Canonical JSON for the closed records this lane hashes.
 *
 * WHY THIS FILE EXISTS. Every identifier below — the subject, the control-head
 * digest, the key-set identifier, the delegation digest — is a SHA-256 over
 * canonical JSON bytes. If two implementations serialize the same record
 * differently, they compute different identifiers for the same identity, and a
 * consumer that pins one of them cannot check the other. Deep already has an
 * encoder; this lane needs the same bytes without importing Deep (the standalone
 * closure rule forbids a sibling checkout).
 *
 * MEASURED COMPATIBILITY, NOT AN ASSERTION. For every value this module accepts,
 * the bytes are identical to Deep `aukora/kernel-seed/canonical-json.mjs` at
 * `c417f7c5752bf14b8e927986cd995f2e086f4189`, and
 * `tests/aukora-aumlok.test.mjs` measures that against vectors Deep itself
 * produced at that pin (see `scripts/aumlok/PROVENANCE.md`).
 *
 * THE ONE DELIBERATE DIFFERENCE. Deep maps `undefined`, functions, symbols and
 * bigints to `null` (at the top level and inside arrays) and drops object
 * properties holding them, so a field that no longer has a value is silently
 * re-signed as `null`. This encoder REFUSES those values instead. The refusal is
 * narrower than Deep on inputs this lane never produces: every record reaching
 * this module is already a closed, validated record of strings, safe integers,
 * booleans, nulls and arrays, so no accepted record can reach a refusal. A
 * refusal here means a caller bypassed validation, which is exactly when a
 * signature over silently-rewritten bytes would be worst.
 *
 * Numeric policy: safe integers only, and `-0` is refused. Deep's own
 * `readNonNegativeInteger` refuses `-0` too, so no accepted record contains one;
 * `JSON.stringify(-0)` would otherwise emit `0` and change the signed bytes.
 *
 * @module @aukora/dsh-plugin-aumlok/canonical
 */
import { createHash } from 'node:crypto'

/** A value with no canonical form in this lane. */
export class CanonicalJSONError extends TypeError {}

/**
 * Encode one closed data value as canonical JSON: compact, no insignificant
 * whitespace, object keys sorted by UTF-16 code unit.
 * @param {unknown} value - closed record, array, or JSON primitive.
 * @returns {string} canonical encoding.
 */
export function canonicalJSON(value) {
  return encode(value, '$')
}

function encode(value, path) {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        throw new CanonicalJSONError(
          `${path}: only safe integers have a portable canonical form (received ${String(value)})`,
        )
      }
      return String(value)
    case 'string':
      // JSON.stringify's string escaping is the RFC 8785 §3.2.2.2 escaping: the two
      // mandatory escapes, the five control short forms, \uXXXX for the remaining
      // controls, and well-formed escaping of lone surrogates.
      return JSON.stringify(value)
    case 'object':
      break
    default:
      throw new CanonicalJSONError(`${path}: ${typeof value} has no canonical form`)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => encode(item, `${path}[${String(index)}]`)).join(',')}]`
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new CanonicalJSONError(`${path}: only plain data records have a canonical form`)
  }
  // `.sort()` with no comparator is UTF-16 code-unit order — the order RFC 8785
  // §3.2.3 requires and the order Deep's encoder uses. It is deliberately not
  // UTF-8 byte order: above U+FFFF the two disagree, and the vectors in
  // tests/aukora-aumlok.test.mjs pin the case where they do.
  const keys = Object.keys(value).sort()
  return `{${keys
    .map(key => `${JSON.stringify(key)}:${encode(value[key], `${path}.${key}`)}`)
    .join(',')}}`
}

/**
 * Hash one domain-separated canonical value: `sha256(domain + NUL + canonicalJSON(value))`.
 *
 * The NUL separator is what keeps `("ab", "c")` and `("a", "bc")` from hashing to
 * the same bytes, and the domain keeps two different record kinds from colliding.
 * @param {string} domain - domain separation string.
 * @param {unknown} value - value to encode.
 * @returns {string} lowercase SHA-256 hex.
 */
export function digestCanonical(domain, value) {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(canonicalJSON(value), 'utf8')
    .digest('hex')
}
