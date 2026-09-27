/**
 * Snapshot installed Noble package bytes for the frozen authority's declared
 * external imports. This measures supplied imports and package.json runtime
 * dependencies, not loaded code, undeclared imports, or future file integrity.
 * Package-manager links may resolve a package root; links inside it refuse.
 */
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'

const ALLOWED = new Set(['@noble/curves', '@noble/post-quantum', '@noble/hashes', '@noble/ciphers'])
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const refuse = reason => new Error(`launchd-authority-dependencies:${reason}`)
const identityFields = ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs']
const same = (left, right) => identityFields.every(field => left[field] === right[field])

/** Read a stable regular file through a descriptor that refuses a link leaf. */
function readRegular(path) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = fstatSync(descriptor, { bigint: true })
    if (!before.isFile() || before.size > 8n * 1024n * 1024n || realpathSync(path) !== path) throw refuse('file-not-exact')
    const bytes = readFileSync(descriptor)
    if (!same(before, fstatSync(descriptor, { bigint: true })) || !same(before, lstatSync(path, { bigint: true }))
      || BigInt(bytes.length) !== before.size) throw refuse('file-changed')
    return bytes
  } finally { closeSync(descriptor) }
}

function packageName(specifier) {
  if (typeof specifier !== 'string' || !/^@noble\/[a-z-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(specifier)
    || specifier.split('/').some(segment => segment === '.' || segment === '..')) throw refuse('import-not-allowed')
  const name = specifier.split('/').slice(0, 2).join('/')
  if (!ALLOWED.has(name)) throw refuse('package-not-allowed')
  return name
}

function installedRoot(specifier, consumerPath) {
  const name = packageName(specifier)
  if (typeof consumerPath !== 'string' || !isAbsolute(consumerPath)) throw refuse('consumer-not-absolute')
  let resolved
  try { resolved = createRequire(realpathSync(consumerPath)).resolve(specifier) }
  catch { throw refuse('dependency-unresolvable') }
  let directory = dirname(realpathSync(resolved))
  for (;;) {
    const path = join(directory, 'package.json')
    let exists = true
    try { lstatSync(path) } catch (error) { if (error?.code === 'ENOENT') exists = false; else throw error }
    if (exists) {
      const bytes = readRegular(path)
      const manifest = JSON.parse(bytes.toString('utf8'))
      if (manifest?.name !== name || typeof manifest.version !== 'string' || manifest.version === '') throw refuse('package-identity-mismatch')
      return { directory, manifest, manifestDigest: digest(bytes) }
    }
    const parent = dirname(directory)
    if (parent === directory) throw refuse('package-manifest-missing')
    directory = parent
  }
}

/**
 * Capture complete regular-file packages from the actual consuming modules.
 * Runtime dependencies, optional dependencies and peer dependencies must all
 * resolve within the four-package allowlist. Nested node_modules refuse;
 * nothing is silently omitted. Distinct installed copies must match in every
 * file and version. Limits are 4096 files, 8 MiB per file and 64 MiB total.
 * @param {readonly {specifier: string, consumerPath: string}[]} imports non-builtin graph edges with absolute actual consumer paths
 * @returns {Array<{path: string, bytes: Buffer, sha256: string}>} sorted detached-install files, including licenses and metadata
 */
export function snapshotAuthorityDependencies(imports) {
  const packages = new Map()
  const roots = new Set()
  let totalBytes = 0
  let totalFiles = 0
  const visit = (specifier, consumerPath) => {
    const { directory, manifest, manifestDigest } = installedRoot(specifier, consumerPath)
    if (roots.has(directory)) return
    roots.add(directory)
    if (roots.size > 32) throw refuse('package-count-exceeded')
    const files = []
    const walk = (path, prefix) => {
      const before = lstatSync(path, { bigint: true })
      if (!before.isDirectory() || realpathSync(path) !== path) throw refuse('directory-not-exact')
      for (const name of readdirSync(path).sort()) {
        if (name === 'node_modules') throw refuse('nested-node-modules')
        const absolute = join(path, name)
        const relative = `${prefix}/${name}`
        const entry = lstatSync(absolute)
        if (entry.isDirectory()) walk(absolute, relative)
        else if (entry.isFile()) {
          const bytes = readRegular(absolute)
          totalBytes += bytes.length
          totalFiles++
          if (totalBytes > 64 * 1024 * 1024 || totalFiles > 4096) throw refuse('snapshot-limit-exceeded')
          files.push({ path: relative, bytes, sha256: digest(bytes) })
        } else throw refuse('package-entry-not-regular')
      }
      if (!same(before, lstatSync(path, { bigint: true }))) throw refuse('directory-changed')
    }
    walk(directory, `node_modules/${manifest.name}`)
    files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    if (files.find(file => file.path === `node_modules/${manifest.name}/package.json`)?.sha256 !== manifestDigest) throw refuse('manifest-changed')
    const identity = JSON.stringify([manifest.version, files.map(file => [file.path, file.sha256])])
    const previous = packages.get(manifest.name)
    if (previous && previous.identity !== identity) throw refuse('conflicting-package-copies')
    packages.set(manifest.name, { identity, files })
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      const dependencies = manifest[field]
      if (dependencies === undefined) continue
      if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) throw refuse('dependencies-invalid')
      for (const [name, range] of Object.entries(dependencies)) {
        if (typeof range !== 'string' || range === '' || packageName(name) !== name) throw refuse('dependencies-invalid')
        visit(name, join(directory, 'package.json'))
      }
    }
  }
  for (const { specifier, consumerPath } of imports) visit(specifier, consumerPath)
  return [...packages.values()].flatMap(value => value.files)
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
}
