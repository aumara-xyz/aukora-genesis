/**
 * Value check for the raw JSON Schema subset the pinned harness enforces on
 * tool output.
 *
 * Source of the rule, not this file: deepseek-harness commit
 * 0d1f50007f9bca3f52b06e1c3074fa14d5fb0720,
 * `packages/core/tools/src/json-schema.ts` `validateJsonSchemaValue`.
 * An undeclared key on a closed object is reported as
 * `"<path>" is not a declared property (additionalProperties: false)`,
 * which is the sentence the installed app prints when it rejects a tool result.
 *
 * This walk is not the harness. `vendor/dsh/` is not required. It covers the
 * subset Kira declares (`type`, `oneOf`, `properties`, `required` as a string
 * array, `additionalProperties`, `items`, `enum`, `const`). A `required` value
 * that is not a string array is ignored here and reported by
 * {@link schemaDialectViolations}; the harness refuses that schema before it
 * validates a value.
 *
 * @module tests/helpers/tool-output-schema
 */

const ANNOTATIONS = new Set(['description', 'title', 'default', 'examples'])
const KEYWORDS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
  ...ANNOTATIONS,
])

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isJsonNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isJsonValue(value) {
  if (value === null) return true
  const kind = typeof value
  if (kind === 'string' || kind === 'boolean') return true
  if (kind === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (isPlainObject(value)) return Object.values(value).every(isJsonValue)
  return false
}

/**
 * @param {Record<string, unknown>} node
 * @param {unknown} value
 * @param {string} path
 * @param {string[]} violations
 */
function walk(node, value, path, violations) {
  if (Array.isArray(node.oneOf)) {
    let matches = 0
    for (const branch of node.oneOf) {
      const inner = []
      walk(/** @type {Record<string, unknown>} */ (branch), value, path, inner)
      if (inner.length === 0) matches += 1
    }
    if (matches !== 1) {
      violations.push(`"${path}" must match exactly one oneOf branch (matched ${matches})`)
    }
    return
  }
  if (!Object.hasOwn(node, 'type')) {
    if (!isJsonValue(value)) violations.push(`"${path}" must be lossless JSON`)
    return
  }
  if (Object.hasOwn(node, 'const') && node.const !== value) {
    violations.push(`"${path}" must be ${JSON.stringify(node.const)}`)
  }
  if (Array.isArray(node.enum) && !node.enum.some(entry => entry === value)) {
    violations.push(`"${path}" must be one of ${node.enum.map(entry => JSON.stringify(entry)).join(', ')}`)
  }
  switch (node.type) {
    case 'object': {
      if (!isPlainObject(value)) {
        violations.push(`"${path}" must be an object`)
        return
      }
      const record = /** @type {Record<string, unknown>} */ (value)
      const properties = /** @type {Record<string, Record<string, unknown>>} */ (node.properties ?? {})
      if (Array.isArray(node.required)) {
        for (const key of node.required) {
          if (!Object.hasOwn(record, key) || record[key] === undefined) {
            violations.push(`missing required property "${path}.${key}"`)
          }
        }
      }
      for (const [key, child] of Object.entries(properties)) {
        if (!Object.hasOwn(record, key) || record[key] === undefined) continue
        walk(child, record[key], `${path}.${key}`, violations)
      }
      if (node.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (!Object.hasOwn(properties, key)) {
            violations.push(`"${path}.${key}" is not a declared property (additionalProperties: false)`)
          }
        }
      }
      return
    }
    case 'array': {
      if (!Array.isArray(value)) {
        violations.push(`"${path}" must be an array`)
        return
      }
      if (node.items !== undefined) {
        value.forEach((item, index) => walk(
          /** @type {Record<string, unknown>} */ (node.items),
          item,
          `${path}[${index}]`,
          violations,
        ))
      }
      return
    }
    case 'string':
      if (typeof value !== 'string') violations.push(`"${path}" must be a string`)
      return
    case 'number':
      if (!isJsonNumber(value)) violations.push(`"${path}" must be a number`)
      return
    case 'integer':
      if (!isJsonNumber(value) || !Number.isInteger(value)) violations.push(`"${path}" must be an integer`)
      return
    case 'boolean':
      if (typeof value !== 'boolean') violations.push(`"${path}" must be a boolean`)
      return
    case 'null':
      if (value !== null) violations.push(`"${path}" must be null`)
      return
    default:
      violations.push(`"${path}" has unsupported type ${JSON.stringify(node.type)}`)
  }
}

/**
 * Validate one value against one tool output schema.
 * @param {Record<string, unknown>} schema - `tool.output.schema`.
 * @param {unknown} value - the object `execute` returned.
 * @param {string} [path] - diagnostic root. The harness uses `value`.
 * @returns {string[]} empty when the value conforms.
 */
export function outputSchemaViolations(schema, value, path = 'value') {
  const violations = []
  walk(schema, value, path, violations)
  return violations
}

/**
 * Closed-object misses only: the failure that drops a whole tool result.
 * @param {Record<string, unknown>} schema
 * @param {unknown} value
 * @returns {string[]}
 */
export function undeclaredProperties(schema, value) {
  return outputSchemaViolations(schema, value).filter(line => line.includes('is not a declared property'))
}

/**
 * @param {unknown} node
 * @param {string} path
 * @param {string[]} violations
 * @param {Set<object>} seen
 */
function walkSchema(node, path, violations, seen) {
  if (!isPlainObject(node)) {
    violations.push(`${path} must be a schema object`)
    return
  }
  const record = /** @type {Record<string, unknown>} */ (node)
  if (seen.has(record)) {
    violations.push(`${path} is circular`)
    return
  }
  seen.add(record)
  for (const key of Object.keys(record)) {
    if (!KEYWORDS.has(key)) {
      violations.push(`${path}.${key} is not a supported keyword`)
    }
  }
  if (Object.hasOwn(record, 'required') && (
    !Array.isArray(record.required) || record.required.some(entry => typeof entry !== 'string')
  )) {
    violations.push(`${path}.required must be an array of strings`)
  }
  if (Object.hasOwn(record, 'additionalProperties') && typeof record.additionalProperties !== 'boolean') {
    violations.push(`${path}.additionalProperties must be a boolean`)
  }
  if (Array.isArray(record.oneOf)) {
    record.oneOf.forEach((branch, index) => walkSchema(branch, `${path}.oneOf[${index}]`, violations, seen))
  }
  if (isPlainObject(record.properties)) {
    for (const [key, child] of Object.entries(record.properties)) {
      walkSchema(child, `${path}.properties.${key}`, violations, seen)
    }
  }
  if (record.items !== undefined) walkSchema(record.items, `${path}.items`, violations, seen)
  seen.delete(record)
}

/**
 * Schema-shape problems the pinned harness rejects before it checks a value.
 * `required: true` on a property is the eye dialect; Kira uses a string array.
 * @param {unknown} schema
 * @param {string} [path]
 * @returns {string[]}
 */
export function schemaDialectViolations(schema, path = 'schema') {
  const violations = []
  walkSchema(schema, path, violations, new Set())
  return violations
}
