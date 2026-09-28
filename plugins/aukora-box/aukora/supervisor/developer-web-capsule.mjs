/** Closed, owner-selected Capsule configuration for the existing Web parent. */
import { accessSync, closeSync, constants, fstatSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

/** Configuration-file discriminator; it grants neither approval nor a destination. */
export const WEB_CAPSULE_DOMAIN = 'aukora:web-capsule:v1'
const MAX_BYTES = 64 * 1024
const invalid = () => { throw new Error('aukora:web:capsule-config-invalid') }
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const integer = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max

/**
 * Validate a deployment selection without creating keys, files, processes or approval.
 * @param {unknown} input - JSON value read by the operator-side parent.
 * @returns {Readonly<{worker: object, protectedChecks: readonly object[]}>} immutable literal selection.
 */
export function parseWebCapsuleConfig(input) {
  if (!exact(input, ['domain', 'worker', 'protectedChecks']) || input.domain !== WEB_CAPSULE_DOMAIN) invalid()
  const w = input.worker
  const fields = ['kind', 'executable', 'maxOutputBytes', 'maxSpillBytes', 'disposeGraceMs']
  if (w && Object.hasOwn(w, 'defaultModel')) fields.push('defaultModel')
  if (!exact(w, fields) || !['opencode', 'crush'].includes(w.kind)
    || typeof w.executable !== 'string' || !isAbsolute(w.executable) || /[\u0000-\u001f\u007f]/u.test(w.executable)
    || !integer(w.maxOutputBytes, 1024 * 1024) || !integer(w.maxSpillBytes, 16 * 1024 * 1024)
    || !integer(w.disposeGraceMs, 60_000) || w.maxSpillBytes < w.maxOutputBytes
    || (Object.hasOwn(w, 'defaultModel') && (typeof w.defaultModel !== 'string' || !w.defaultModel.trim()))) invalid()
  // An OpenCode worker always dispatches through the isolated runtime, which composes the
  // CLI's whole configuration from one provider/model and refuses without it, and the Capsule
  // never supplies one per request. CapsuleService refuses the same combination, but only once
  // the plugin tree loads; deciding it here names the operator's own file as the fault.
  if (w.kind === 'opencode' && !/^[a-zA-Z0-9_-]+\/\S+$/u.test(String(w.defaultModel ?? ''))) invalid()
  if (!Array.isArray(input.protectedChecks) || input.protectedChecks.length < 1 || input.protectedChecks.length > 16) invalid()
  const ids = new Set()
  const checks = input.protectedChecks.map(c => {
    if (!exact(c, ['id', 'program', 'timeoutMs']) || typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/u.test(c.id)
      || c.id === 'operator-check-required' || ids.has(c.id) || typeof c.program !== 'string'
      || !c.program.trim() || Buffer.byteLength(c.program) > 8192 || !integer(c.timeoutMs, 60_000)) invalid()
    ids.add(c.id)
    return Object.freeze({ id: c.id, program: c.program, timeoutMs: c.timeoutMs })
  })
  return Object.freeze({ worker: Object.freeze({ ...w }), protectedChecks: Object.freeze(checks) })
}

/**
 * Read a bounded private JSON file; executable selection is explicit and resolved before launch.
 * @param {string} path - operator-supplied config path, not guest input.
 * @returns {ReturnType<typeof parseWebCapsuleConfig>} immutable Capsule selection.
 */
export function readWebCapsuleConfig(path) {
  let fd
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const st = fstatSync(fd)
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.geteuid?.() || (st.mode & 0o077) !== 0 || st.size > MAX_BYTES) invalid()
    const bytes = readFileSync(fd)
    if (bytes.length > MAX_BYTES) invalid()
    const selected = parseWebCapsuleConfig(JSON.parse(bytes.toString('utf8')))
    const executable = realpathSync(selected.worker.executable)
    if (!statSync(executable).isFile()) invalid()
    accessSync(executable, constants.X_OK)
    return Object.freeze({ ...selected, worker: Object.freeze({ ...selected.worker, executable }) })
  } catch (error) {
    throw new Error('aukora:web:capsule-config-invalid', { cause: error })
  } finally { if (fd !== undefined) closeSync(fd) }
}
