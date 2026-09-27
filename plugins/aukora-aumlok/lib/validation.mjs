/**
 * Strict data readers for AUKORA identity artifacts.
 *
 * PORTED FROM Deep `aukora/identity/validation.mjs` at
 * `c417f7c5752bf14b8e927986cd995f2e086f4189`. The port is deliberate and
 * byte-for-byte in behaviour: these readers are what make a record *closed*, and
 * a re-typed clone of a closure check is a place where an extra field silently
 * becomes an authority field. `scripts/aumlok/PROVENANCE.md` records the port,
 * the pin and what was left behind.
 *
 * WHAT CLOSED MEANS HERE. A record must be a plain object with `Object.prototype`
 * whose own keys are EXACTLY the named fields, each an enumerable data property.
 * That refuses: extra fields, missing fields, accessor properties, symbol keys,
 * Proxies, class instances, and arrays where a record is expected. A caller
 * cannot smuggle `{...valid, admin: true}` past a reader.
 *
 * @module @aukora/dsh-plugin-aumlok/validation
 */
import { types } from 'node:util'

const LOWER_HEX_256 = /^[0-9a-f]{64}$/u
const AUKORA_ID = /^aukora:1:[0-9a-f]{64}$/u
const EXACT_ATOM = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u

/**
 * Read an object whose own enumerable data properties are exactly the named fields.
 * @param {unknown} value - candidate record.
 * @param {readonly string[]} fields - exact field inventory.
 * @param {string} label - diagnostic subject.
 * @returns {Record<string, unknown>} detached field values.
 */
export function readClosedDataRecord(value, fields, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)) {
    throw new TypeError(`${label}: must be a plain data record`)
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label}: must have Object.prototype`)
  }
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some(key => typeof key !== 'string')) {
    throw new TypeError(`${label}: symbol fields are forbidden`)
  }
  const actual = /** @type {string[]} */ (ownKeys).toSorted()
  const expected = [...fields].toSorted()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label}: fields must be exactly [${expected.join(', ')}]`)
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  /** @type {Record<string, unknown>} */
  const result = {}
  for (const field of fields) {
    const descriptor = descriptors[field]
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(`${label}.${field}: must be an enumerable data property`)
    }
    result[field] = descriptor.value
  }
  return result
}

/**
 * Read one lowercase SHA-256 value.
 * @param {unknown} value - candidate digest.
 * @param {string} label - diagnostic subject.
 * @returns {string} validated digest.
 */
export function readDigest(value, label) {
  if (typeof value !== 'string' || !LOWER_HEX_256.test(value)) {
    throw new TypeError(`${label}: must be 64 lowercase hexadecimal characters`)
  }
  return value
}

/**
 * Read one stable AUKORA identity identifier.
 * @param {unknown} value - candidate identifier.
 * @param {string} label - diagnostic subject.
 * @returns {string} validated identifier.
 */
export function readAukoraId(value, label) {
  if (typeof value !== 'string' || !AUKORA_ID.test(value)) {
    throw new TypeError(`${label}: must use the aukora:1:<sha256> form`)
  }
  return value
}

/**
 * Read one non-negative safe integer.
 * @param {unknown} value - candidate integer.
 * @param {string} label - diagnostic subject.
 * @returns {number} validated integer.
 */
export function readNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 0 || Object.is(value, -0)) {
    throw new TypeError(`${label}: must be a non-negative safe integer`)
  }
  return /** @type {number} */ (value)
}

/**
 * Read one bounded printable ASCII atom without glob metacharacters.
 * @param {unknown} value - candidate atom.
 * @param {string} label - diagnostic subject.
 * @param {number} maximumBytes - UTF-8 byte ceiling.
 * @returns {string} validated atom.
 */
export function readExactAtom(value, label, maximumBytes) {
  if (typeof value !== 'string' || !EXACT_ATOM.test(value)) {
    throw new TypeError(`${label}: must use only letters, digits, dot, underscore, colon, slash, and hyphen`)
  }
  if (Buffer.byteLength(value, 'utf8') > maximumBytes) {
    throw new TypeError(`${label}: exceeds ${String(maximumBytes)} bytes`)
  }
  return value
}

/**
 * Read a dense array of unique exact atoms.
 * @param {unknown} value - candidate array.
 * @param {string} label - diagnostic subject.
 * @param {number} maximumItems - item-count ceiling.
 * @param {number} maximumBytes - per-item byte ceiling.
 * @param {boolean} requireSorted - whether input order must already be canonical.
 * @returns {readonly string[]} frozen canonical array.
 */
export function readExactAtomSet(value, label, maximumItems, maximumBytes, requireSorted) {
  const items = readDenseArray(value, label, maximumItems, (item, itemLabel) =>
    readExactAtom(item, itemLabel, maximumBytes))
  const sorted = items.toSorted()
  if (new Set(sorted).size !== sorted.length) throw new TypeError(`${label}: duplicate items are forbidden`)
  if (requireSorted && items.some((item, index) => item !== sorted[index])) {
    throw new TypeError(`${label}: items must be lexicographically sorted`)
  }
  return Object.freeze(sorted)
}

/**
 * Read a dense array of unique lowercase SHA-256 values.
 * @param {unknown} value - candidate array.
 * @param {string} label - diagnostic subject.
 * @param {boolean} requireSorted - whether input order must already be canonical.
 * @returns {readonly string[]} frozen canonical array.
 */
export function readDigestSet(value, label, requireSorted) {
  const items = readDenseArray(value, label, 64, readDigest)
  const sorted = items.toSorted()
  if (new Set(sorted).size !== sorted.length) throw new TypeError(`${label}: duplicate items are forbidden`)
  if (requireSorted && items.some((item, index) => item !== sorted[index])) {
    throw new TypeError(`${label}: items must be lexicographically sorted`)
  }
  return Object.freeze(sorted)
}

/**
 * Read one dense, plain array of at most `maximumItems` items, each read by `readItem`.
 * @param {unknown} value - candidate array.
 * @param {string} label - diagnostic subject.
 * @param {number} maximumItems - item-count ceiling.
 * @param {(item: unknown, label: string) => string} readItem - per-item reader.
 * @returns {string[]} detached item values in input order.
 */
function readDenseArray(value, label, maximumItems, readItem) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label}: must be an array`)
  }
  if (value.length > maximumItems) {
    throw new TypeError(`${label}: must contain at most ${String(maximumItems)} items`)
  }
  const keys = Reflect.ownKeys(value)
  const expectedKeys = [...Array.from({ length: value.length }, (_, index) => String(index)), 'length']
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new TypeError(`${label}: must be dense and carry no extra properties`)
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)]
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(`${label}[${String(index)}]: must be an enumerable data property`)
    }
    return readItem(descriptor.value, `${label}[${String(index)}]`)
  })
}
