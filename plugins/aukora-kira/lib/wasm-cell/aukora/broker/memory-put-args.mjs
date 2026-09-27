/**
 * The closed argument alphabet and key grammar for memory.put.
 *
 * This module has no imports so every renderer, signer, verifier, and effect
 * can depend on one structural decision without introducing a cycle.
 *
 * @module @aukora/broker/memory-put-args
 */

/** A memory key is a name, never a path. */
export const KEY_SHAPE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/

/**
 * Test whether a value is the complete memory.put argument object.
 *
 * The accepted object is plain, has exactly two own enumerable data
 * properties named `key` and `value`, carries no symbol or non-enumerable
 * riders, and never represents an omitted value as `undefined`.
 *
 * @param {unknown} input - value presented as memory.put arguments.
 * @returns {input is {key: string, value: unknown}} whether the argument alphabet is exact.
 */
export function isExactMemoryPutArgs(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false
  try {
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) return false

    const ownKeys = Reflect.ownKeys(input)
    if (ownKeys.length !== 2 || !ownKeys.includes('key') || !ownKeys.includes('value')) return false

    const key = Object.getOwnPropertyDescriptor(input, 'key')
    const value = Object.getOwnPropertyDescriptor(input, 'value')
    if (key === undefined || value === undefined) return false
    if (!key.enumerable || !value.enumerable) return false
    if (!Object.hasOwn(key, 'value') || !Object.hasOwn(value, 'value')) return false
    return typeof key.value === 'string' && value.value !== undefined
  } catch {
    return false
  }
}
