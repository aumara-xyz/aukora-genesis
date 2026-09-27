/**
 * Canonical JSON encoding shared by authority preimages.
 *
 * The encoder is isolated from receipt persistence so proposal code can hash
 * exact values without loading filesystem-capable record code.
 *
 * @module @aukora/kernel-seed/canonical-json
 */
const NON_JSON_TYPES = new Set(['undefined', 'function', 'symbol', 'bigint'])

/**
 * Encode one JSON-compatible value with lexicographically sorted object keys.
 * @param {unknown} value - value to encode.
 * @returns {string} deterministic compact JSON.
 */
export function canonicalJSON(value) {
  if (value === undefined || NON_JSON_TYPES.has(typeof value)) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${Array.from(value).map(item => NON_JSON_TYPES.has(typeof item) ? 'null' : canonicalJSON(item)).join(',')}]`
  }
  const record = /** @type {Record<string, unknown>} */ (value)
  const keys = Object.keys(record).filter(key => !NON_JSON_TYPES.has(typeof record[key])).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`).join(',')}}`
}
