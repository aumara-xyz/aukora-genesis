/**
 * Argument validation for the harness's enforced JSON Schema subset.
 *
 * `@deepseek-ai/dsh-tools` validates a tool's *output* against its declared
 * schema; the runtime explicitly leaves *parameter* validation to the tool
 * ("tools validate their own schema"). This package mounts without importing
 * the harness, so the subset the tool definitions declare — `type`, `oneOf`,
 * `properties`, `required`, `additionalProperties`, `items`, `enum`, `const` —
 * is enforced here. A declared `additionalProperties: false` that nothing
 * enforced would be a promise the tool does not keep.
 *
 * @module @aukora/dsh-plugin-kira/parameters
 */
import { types } from 'node:util'

const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null'])

/** A named parameter refusal; every refusal carries one stable code. */
export class KiraParametersError extends Error {
  /** Stable machine-readable refusal code. */
  code = 'kira.params:invalid'

  /**
   * @param {readonly string[]} violations - one message per offending path.
   */
  constructor(violations) {
    super(`kira.params: invalid arguments: ${violations.join('; ')}`)
    this.name = 'KiraParametersError'
    this.violations = violations
  }
}

/**
 * @param {unknown} value - candidate JSON value.
 * @returns {string} the JSON type name of the value.
 */
function jsonTypeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * @param {unknown} value - candidate value.
 * @param {string} type - declared JSON Schema type.
 * @returns {boolean} whether the value satisfies the type.
 */
function satisfiesType(value, type) {
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'object') return jsonTypeOf(value) === 'object'
  return jsonTypeOf(value) === type
}

/**
 * Validate one value against one node of the enforced subset.
 * @param {Record<string, unknown>} node - schema node.
 * @param {unknown} value - candidate value.
 * @param {string} path - JSON path, for messages.
 * @param {string[]} violations - accumulator.
 */
function visit(node, value, path, violations) {
  if (Array.isArray(node.oneOf)) {
    const matches = node.oneOf.filter(branch => {
      const inner = []
      visit(/** @type {Record<string, unknown>} */ (branch), value, path, inner)
      return inner.length === 0
    })
    if (matches.length !== 1) violations.push(`${path} must match exactly one of the declared alternatives`)
    return
  }
  if (typeof node.type === 'string' && !satisfiesType(value, node.type)) {
    violations.push(`${path} must be a ${node.type}`)
    return
  }
  if (Array.isArray(node.enum) && !node.enum.some(candidate => candidate === value)) {
    violations.push(`${path} must be one of ${node.enum.map(entry => JSON.stringify(entry)).join(', ')}`)
  }
  if ('const' in node && node.const !== value) {
    violations.push(`${path} must be ${JSON.stringify(node.const)}`)
  }
  if (typeof node.type === 'string' && SCALAR_TYPES.has(node.type)) return
  if (node.type === 'array' && node.items !== undefined) {
    if (types.isProxy(value) || !Array.isArray(value)) return
    /** @type {unknown[]} */ (value).forEach((item, index) => visit(
      /** @type {Record<string, unknown>} */ (node.items),
      item,
      `${path}[${index}]`,
      violations,
    ))
    return
  }
  if (node.type !== 'object') return
  if (value === null || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return
  const record = /** @type {Record<string, unknown>} */ (value)
  const properties = /** @type {Record<string, Record<string, unknown>>} */ (node.properties ?? {})
  if (node.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!Object.hasOwn(properties, key)) {
        violations.push(`${path}.${key} is not a declared parameter`)
      }
    }
  }
  for (const [key, property] of Object.entries(properties)) {
    if (record[key] === undefined) continue
    visit(property, record[key], `${path}.${key}`, violations)
  }
  for (const key of /** @type {string[]} */ (node.required ?? [])) {
    if (!Object.hasOwn(record, key)) violations.push(`${path}.${key} is required`)
  }
}

/**
 * Validate one argument object against a declared parameter schema.
 * @param {Record<string, unknown>} parameters - the declared parameter schema.
 * @param {unknown} args - the arguments the runtime accepted and snapshotted.
 * @returns {string[]} one message per violation; empty when the arguments conform.
 */
export function validateParameters(parameters, args) {
  const violations = []
  visit(parameters, args, 'arguments', violations)
  return violations
}

/**
 * Validate one argument object, throwing the named refusal when it does not conform.
 * @param {Record<string, unknown>} parameters - the declared parameter schema.
 * @param {unknown} args - the arguments the runtime accepted and snapshotted.
 * @returns {void} returns when the arguments conform.
 * @throws {KiraParametersError} when any argument violates the declared schema.
 */
export function assertParameters(parameters, args) {
  const violations = validateParameters(parameters, args)
  if (violations.length > 0) throw new KiraParametersError(violations)
}
