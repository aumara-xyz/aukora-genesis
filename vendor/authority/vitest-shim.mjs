/**
 * The `describe` / `it` / `expect` surface the upstream kernel tests import from "vitest", and nothing more.
 *
 * Genesis-authored (Genesis has no vitest). It covers exactly the matchers the six upstream test files use:
 * toBe, toEqual, toMatchObject, toThrow, toMatch, and `.not`. Each is at least as strict as vitest's:
 * toEqual is node:util isDeepStrictEqual (prototypes included), toMatchObject checks own keys only.
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

function matchesObject(actual, expected) {
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected)
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((entry, i) => matchesObject(actual[i], entry))
  }
  if (actual === null || typeof actual !== 'object') return false
  return Object.keys(expected).every((key) => Object.hasOwn(actual, key) && matchesObject(actual[key], expected[key]))
}

const show = (value) => inspect(value, { depth: 4, breakLength: Infinity, maxStringLength: 120 })

export function expect(actual, message) {
  const build = (negated) => {
    const check = (pass, what) => {
      if (pass === negated) {
        throw new Error(`${message === undefined ? '' : `${message}: `}expected ${show(actual)} ${negated ? 'not ' : ''}${what}`)
      }
    }
    return {
      toBe: (expected) => check(Object.is(actual, expected), `to be ${show(expected)}`),
      toEqual: (expected) => check(isDeepStrictEqual(actual, expected), `to equal ${show(expected)}`),
      toMatchObject: (expected) => check(matchesObject(actual, expected), `to match object ${show(expected)}`),
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
