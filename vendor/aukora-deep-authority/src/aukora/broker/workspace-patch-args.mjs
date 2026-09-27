/**
 * The closed argument grammar and UTF-8 body for one workspace.patch operation.
 * @module @aukora/broker/workspace-patch-args
 */

/** Maximum bytes in either the proposed content or an existing target file. */
export const MAX_WORKSPACE_PATCH_BYTES = 262_144

/** Operator-defined workspace names do not contain filesystem syntax. */
export const WORKSPACE_NAME_SHAPE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

const fields = ['workspace', 'path', 'beforeSha256', 'content']
const sha256 = /^[a-f0-9]{64}$/
const component = /^[a-zA-Z0-9._-]{1,128}$/
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

/**
 * Capture exact enumerable data properties without invoking argument getters.
 * @param {unknown} input - arguments received from a caller.
 * @returns {{workspace:string,path:string,beforeSha256:string|null,content:string}|null} validated values or null.
 */
export function captureWorkspacePatchArgs(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  try {
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) return null
    const descriptors = Object.getOwnPropertyDescriptors(input)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.length !== fields.length || fields.some(field => !keys.includes(field))) return null
    if (fields.some(field => !descriptors[field].enumerable || !Object.hasOwn(descriptors[field], 'value'))) return null
    const workspace = descriptors.workspace.value
    const path = descriptors.path.value
    const beforeSha256 = descriptors.beforeSha256.value
    const content = descriptors.content.value
    if (typeof workspace !== 'string' || !WORKSPACE_NAME_SHAPE.test(workspace)) return null
    if (typeof path !== 'string' || path.length > 1024) return null
    if (path.split('/').some(part => !component.test(part)
      || part === '.' || part === '..' || part.toLowerCase() === '.git'
      || part.endsWith('.') || reserved.test(part))) return null
    if (Buffer.byteLength(`workspace:file:${workspace}:${path}`, 'utf8') > 256) return null
    if (beforeSha256 !== null && (typeof beforeSha256 !== 'string' || !sha256.test(beforeSha256))) return null
    if (typeof content !== 'string' || content.length > MAX_WORKSPACE_PATCH_BYTES) return null
    const bytes = Buffer.from(content, 'utf8')
    if (bytes.length > MAX_WORKSPACE_PATCH_BYTES || bytes.toString('utf8') !== content) return null
    return { workspace, path, beforeSha256, content }
  } catch {
    return null
  }
}

/**
 * Test the complete workspace.patch argument alphabet, path grammar, and byte limit.
 * @param {unknown} input - arguments received from a caller.
 * @returns {input is {workspace:string,path:string,beforeSha256:string|null,content:string}} whether all fields are accepted.
 */
export function isExactWorkspacePatchArgs(input) {
  return captureWorkspacePatchArgs(input) !== null
}

/**
 * Return precisely the text whose UTF-8 bytes are reviewed and published.
 * @param {{workspace:string,path:string,beforeSha256:string|null,content:string}} args - exact arguments.
 * @returns {string} the file body, with no normalization or appended newline.
 * @throws {TypeError} when any argument violates the closed grammar.
 */
export function workspacePatchBody(args) {
  const captured = captureWorkspacePatchArgs(args)
  if (captured === null) throw new TypeError('workspace.patch:arguments-not-exact')
  return captured.content
}
