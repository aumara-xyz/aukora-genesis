/**
 * The `describe` / `it` / `expect` surface the upstream evidence tests import from "vitest", and nothing more.
 *
 * Genesis-authored (Genesis has no vitest), after vendor/aukora-kernel/vitest-shim.mjs. It covers exactly the
 * matchers the six upstream test files use: toBe, toEqual, toContain, toHaveLength, toMatch, toThrow, toBeNull,
 * toBeGreaterThan, toBeLessThan, toBeLessThanOrEqual, and `.not`. Each is at least as strict as vitest's:
 * toEqual is node:util isDeepStrictEqual (prototypes included), toContain on an array is `===` membership.
 * `describe` and `it` only REGISTER; conformance.mjs runs what was registered.
 */
import { isDeepStrictEqual, inspect } from 'node:util'

/** Tests registered by the file currently being imported. conformance.mjs drains this after each import. */
export const registered = []
const scope = []

export function describe(name, body) {
  scope.push(name)
  try { body() } finally { scope.pop() }
}

export function it(name, body) {
  registered.push({ name: [...scope, name].join(' › '), body })
}
export const test = it

const show = (value) => inspect(value, { depth: 4, breakLength: Infinity, maxStringLength: 120 })
const isNumber = (value) => typeof value === 'number' || typeof value === 'bigint'

export function expect(actual, message) {
  const build = (negated) => {
    const check = (pass, what) => {
      if (pass === negated) {
        throw new Error(`${message === undefined ? '' : `${message}: `}expected ${show(actual)} ${negated ? 'not ' : ''}${what}`)
      }
    }
    const compare = (expected, pass, what) => {
      if (!isNumber(actual) || !isNumber(expected)) throw new Error(`${what} needs numbers, got ${show(actual)} and ${show(expected)}`)
      check(pass, `${what} ${show(expected)}`)
    }
    return {
      toBe: (expected) => check(Object.is(actual, expected), `to be ${show(expected)}`),
      toEqual: (expected) => check(isDeepStrictEqual(actual, expected), `to equal ${show(expected)}`),
      toBeNull: () => check(actual === null, 'to be null'),
      toBeGreaterThan: (expected) => compare(expected, actual > expected, 'to be greater than'),
      toBeLessThan: (expected) => compare(expected, actual < expected, 'to be less than'),
      toBeLessThanOrEqual: (expected) => compare(expected, actual <= expected, 'to be less than or equal to'),
      toHaveLength: (expected) => check(actual !== null && actual !== undefined && actual.length === expected, `to have length ${show(expected)}`),
      toContain: (expected) => {
        if (typeof actual === 'string') return check(typeof expected === 'string' && actual.includes(expected), `to contain ${show(expected)}`)
        if (actual === null || actual === undefined || typeof actual[Symbol.iterator] !== 'function') throw new Error(`toContain needs a string or an iterable, got ${show(actual)}`)
        return check([...actual].some((item) => item === expected), `to contain ${show(expected)}`)
      },
      toMatch: (pattern) => check(typeof actual === 'string'
        && (pattern instanceof RegExp ? pattern.test(actual) : actual.includes(pattern)), `to match ${show(pattern)}`),
      toThrow: (expected) => {
        if (typeof actual !== 'function') throw new Error('toThrow needs a function')
        let threw = false
        let text = ''
        try { actual() } catch (error) { threw = true; text = String(error?.message ?? error) }
        const pass = threw && (expected === undefined
          || (expected instanceof RegExp ? expected.test(text) : text.includes(String(expected))))
        check(pass, `to throw ${expected === undefined ? '' : show(expected)}${threw ? ` (threw ${show(text)})` : ' (did not throw)'}`)
      },
    }
  }
  return Object.assign(build(false), { not: build(true) })
}
