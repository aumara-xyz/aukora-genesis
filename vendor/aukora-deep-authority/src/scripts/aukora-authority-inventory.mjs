/**
 * Deterministic authority source inventory and exclusion boundary report.
 *
 * This module enumerates the static source closure of the broker and issuer authority
 * components directly from a pinned Git revision using {@link pinnedAuthorityGraph} and
 * captures declared external dependencies from installed host packages using
 * {@link snapshotAuthorityDependencies}. It reports the resolved Git revision and tree,
 * the static source graph digest, per-file digests and byte counts derived from Git blobs,
 * working-tree clean/dirty status, and explicitly excluded trust components (Node.js runtime,
 * operating system kernel, platform sandboxing, physical hardware, host credentials, and
 * ambient environment).
 *
 * This inventory measures static source and declared package dependencies only. It makes
 * no claim of a complete Trusted Computing Base (TCB), no security rating or score, and
 * no attestation of runtime execution or host immunity.
 *
 * @module
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export {
  computeVerifierDigest,
  FROZEN_VERIFIER_SHA256,
  VERIFIER_GRAPH_FORMAT,
  verifierGraph,
} from '../aukora/host-dsh/src/verifier-bytes.mjs'

import {
  FROZEN_VERIFIER_SHA256,
  VERIFIER_GRAPH_FORMAT,
} from '../aukora/host-dsh/src/verifier-bytes.mjs'
import { canonicalJSON } from '../aukora/kernel-seed/canonical-json.mjs'
import { snapshotAuthorityDependencies } from './launchd-authority-dependencies.mjs'
import {
  assertPinnedRepository,
  pinnedGitEnv,
  readPinnedBlob,
  readPinnedBlobs,
  REPO_DIR,
  resolvePinnedRevision,
  SEAT_FILES_REFUSE,
  SeatFilesError,
} from './launchd-operator-seat-files.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Manifest domain for an authority source inventory report. */
export const INVENTORY_DOMAIN = 'aukora:authority-source-inventory:v1'

/** Authority entrypoints relative to aukora/ directory. */
const AUTHORITY_ROOTS = Object.freeze(['broker/broker.mjs', 'issuer/issuer.mjs'])

/** Refusal reasons, kept machine-readable in the installer and verifier style. */
export const INVENTORY_REFUSE = Object.freeze({
  REPOSITORY_UNEXPECTED: 'authority-inventory:repository-unexpected',
  REVISION_INVALID: 'authority-inventory:revision-invalid',
  REVISION_UNRESOLVED: 'authority-inventory:revision-unresolved',
  REVISION_MISMATCHED: 'authority-inventory:revision-mismatched',
  WORKING_TREE_DIRTY: 'authority-inventory:working-tree-dirty',
  SOURCE_MISSING: 'authority-inventory:source-missing',
  SOURCE_UNREADABLE: 'authority-inventory:source-unreadable',
  SOURCE_NOT_REGULAR: 'authority-inventory:source-not-regular',
  SOURCE_CHANGED: 'authority-inventory:source-changed',
  DEPENDENCY_UNRESOLVABLE: 'authority-inventory:dependency-unresolvable',
  GRAPH_INCOMPLETE: 'authority-inventory:graph-incomplete',
  GRAPH_DIGEST_MISMATCH: 'authority-inventory:graph-digest-mismatch',
})

/** One inventory refusal carrying a stable reason alongside its message. */
export class AuthorityInventoryError extends Error {
  /**
   * @param {string} reason - one `INVENTORY_REFUSE` value.
   * @param {string} detail - operator-readable detail; never raw secret bytes.
   * @param {ErrorOptions} [options] - optional error options like cause.
   */
  constructor(reason, detail, options = undefined) {
    super(`${reason}: ${detail}`, options)
    this.name = 'AuthorityInventoryError'
    this.reason = reason
  }
}

/**
 * Explicitly excluded trust components outside the authority static source inventory.
 *
 * Documenting what is excluded is a security requirement: enumerating code bytes does
 * not attest the compiler, interpreter, operating system, or host environment.
 */
export const EXCLUDED_TRUST_COMPONENTS = Object.freeze([
  Object.freeze({
    category: 'runtime',
    title: 'Node.js Execution Runtime',
    components: Object.freeze(['node binary executable', 'V8 JavaScript engine', 'platform dynamic linker', 'C/C++ runtime (libc/libsystem)']),
    boundaryRationale: 'The inventory measures static source and package bytes, not the host interpreter, JIT engine, or native runtime libraries.',
  }),
  Object.freeze({
    category: 'operatingSystem',
    title: 'Operating System & Kernel',
    components: Object.freeze(['Darwin / Linux kernel', 'system call layer', 'process scheduler', 'virtual memory manager', 'storage drivers']),
    boundaryRationale: 'Kernel integrity, page tables, filesystem caching, and memory protection are assumed but not witnessed by this inventory.',
  }),
  Object.freeze({
    category: 'sandboxing',
    title: 'Platform Confinement & Isolation',
    components: Object.freeze(['macOS Seatbelt (sandbox-exec)', 'Linux namespaces & bubblewrap (bwrap)', 'Landlock LSM', 'POSIX mode bits']),
    boundaryRationale: 'Subprocess and guest capability deprivation relies on OS isolation mechanisms that exist outside the evaluated source tree.',
  }),
  Object.freeze({
    category: 'hardware',
    title: 'Physical Machine & Hardware',
    components: Object.freeze(['Host CPU instruction execution', 'physical RAM integrity', 'Secure Enclave / TPM', 'device firmware']),
    boundaryRationale: 'Hardware-level side channels, speculative execution vulnerabilities, and memory faults are outside the static authority boundary.',
  }),
  Object.freeze({
    category: 'credentials',
    title: 'Cryptographic Roots & Ambient Authority',
    components: Object.freeze(['Host root private keys', 'disk-resident signing secrets', 'file access control lists (ACLs)', 'user/group directory services']),
    boundaryRationale: 'Possession and protection of private keys is a host custody responsibility; the inventory covers algorithms and code, not provisioned secrets.',
  }),
  Object.freeze({
    category: 'network',
    title: 'Network & Remote Endpoints',
    components: Object.freeze(['Physical network interfaces', 'TCP/IP protocol stack', 'DNS resolution', 'TLS termination', 'remote model provider endpoints']),
    boundaryRationale: 'Transport security and remote model inference occur across external network boundaries not attested by static authority source.',
  }),
  Object.freeze({
    category: 'ambientEnvironment',
    title: 'Process Environment & Entropy',
    components: Object.freeze(['process.env variables', 'inherited file descriptors', 'effective UID/GID configuration', 'system real-time clock', 'kernel entropy pool (/dev/urandom)']),
    boundaryRationale: 'Execution environment values and entropy sources are supplied by the invoking process context, not bound inside the static graph.',
  }),
  Object.freeze({
    category: 'toolchain',
    title: 'Development & Build Toolchain',
    components: Object.freeze(['Git version control binary', 'pnpm package manager', 'TypeScript compiler (tsc)', 'bundler (tsdown) and test runners (vitest)']),
    boundaryRationale: 'Developer tools produce and stage artifacts but are not runtime members of the authority graph.',
  }),
  Object.freeze({
    category: 'dynamicModules',
    title: 'Dynamic & Out-of-Graph Modules',
    components: Object.freeze(['Dynamic import() calls with runtime specifiers', 'Cordis plugins mounted dynamically at runtime', 'out-of-tree extensions']),
    boundaryRationale: 'Only statically declared imports and re-exports traceable from broker and issuer entrypoints are captured in the authority graph.',
  }),
])

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

const isIdentifierStart = (character) => typeof character === 'string' && /[A-Za-z_$]/u.test(character)
const isIdentifierPart = (character) => typeof character === 'string' && /[A-Za-z0-9_$]/u.test(character)

/** Tokenize enough JavaScript to identify static import and re-export specifiers. */
function moduleTokens(source, file) {
  const tokens = []
  let index = 0
  while (index < source.length) {
    const character = source[index]
    if (/\s/u.test(character)) {
      index += 1
      continue
    }
    if (character === '/' && source[index + 1] === '/') {
      const newline = source.indexOf('\n', index + 2)
      index = newline < 0 ? source.length : newline + 1
      continue
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      if (end < 0) throw new AuthorityInventoryError(INVENTORY_REFUSE.GRAPH_INCOMPLETE, `unterminated comment in ${file}`)
      index = end + 2
      continue
    }
    if (character === '"' || character === "'") {
      const quote = character
      const start = index
      index += 1
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\n' || source[index] === '\r') {
          throw new AuthorityInventoryError(INVENTORY_REFUSE.GRAPH_INCOMPLETE, `unterminated string in ${file}`)
        }
        if (source[index] === '\\') index += 1
        index += 1
      }
      if (index >= source.length) throw new AuthorityInventoryError(INVENTORY_REFUSE.GRAPH_INCOMPLETE, `unterminated string in ${file}`)
      const raw = source.slice(start + 1, index)
      tokens.push({ kind: 'string', raw, start })
      index += 1
      continue
    }
    if (character === '`') {
      index += 1
      while (index < source.length && source[index] !== '`') {
        if (source[index] === '\\') index += 1
        index += 1
      }
      if (index >= source.length) throw new AuthorityInventoryError(INVENTORY_REFUSE.GRAPH_INCOMPLETE, `unterminated template in ${file}`)
      index += 1
      continue
    }
    if (isIdentifierStart(character)) {
      const start = index
      index += 1
      while (index < source.length && isIdentifierPart(source[index])) index += 1
      tokens.push({ kind: 'word', value: source.slice(start, index), start })
      continue
    }
    tokens.push({ kind: 'punctuation', value: character, start: index })
    index += 1
  }
  return tokens
}

/** Return static import and re-export specifiers in lexical order. */
function staticSpecifiers(source, file) {
  const tokens = moduleTokens(source, file)
  const found = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.kind !== 'word' || (token.value !== 'import' && token.value !== 'export')) continue
    const previous = tokens[index - 1]
    const next = tokens[index + 1]
    if (previous?.value === '.' || next?.value === '(' || next?.value === '.' || next?.value === ':') continue
    if (token.value === 'export' && next?.value !== '*' && next?.value !== '{') continue

    if (token.value === 'import' && next?.kind === 'string') {
      found.push({ kind: 'import', specifier: next.raw, start: token.start })
      continue
    }

    let specifier = null
    for (let cursor = index + 1; cursor < tokens.length; cursor++) {
      const candidate = tokens[cursor]
      if (candidate.value === ';') break
      if (candidate.kind === 'word' && (candidate.value === 'import' || candidate.value === 'export')) break
      if (candidate.kind === 'word' && candidate.value === 'from' && tokens[cursor + 1]?.kind === 'string') {
        specifier = tokens[cursor + 1].raw
        break
      }
    }
    if (specifier !== null) found.push({ kind: token.value, specifier, start: token.start })
  }
  return found.map(({ kind, specifier }, ordinal) => {
    if (specifier.includes('\\')) throw new AuthorityInventoryError(INVENTORY_REFUSE.GRAPH_INCOMPLETE, `escaped specifier in ${file}`)
    return { kind, ordinal, specifier }
  })
}

/** Resolve one relative ESM edge and refuse paths outside the Aukora tree. */
function resolveLocalEdgePosix(fromGraphPath, specifier) {
  if (specifier.includes('?') || specifier.includes('#')) {
    throw new AuthorityInventoryError(INVENTORY_REFUSE.GRAPH_INCOMPLETE, `qualified specifier: ${specifier}`)
  }
  const dir = posix.dirname(fromGraphPath)
  const target = posix.normalize(posix.join(dir, specifier))
  if (target === '..' || target.startsWith('../') || posix.isAbsolute(target)) {
    throw new AuthorityInventoryError(INVENTORY_REFUSE.GRAPH_INCOMPLETE, `local edge leaves aukora: ${specifier}`)
  }
  if (posix.extname(target) !== '.mjs') {
    throw new AuthorityInventoryError(INVENTORY_REFUSE.GRAPH_INCOMPLETE, `unsupported local module extension: ${specifier}`)
  }
  return target
}

/**
 * Resolve the Git tree hash for one resolved commit.
 *
 * @param {string} commit - 40-hex commit hash.
 * @param {string} [repoDir=REPO_DIR] - repository directory.
 * @returns {string} 40-hex tree hash.
 */
export function resolveCommitTree(commit, repoDir = REPO_DIR) {
  try {
    const stdout = execFileSync('git', ['-C', repoDir, 'rev-parse', `${commit}^{tree}`], {
      encoding: 'utf8',
      env: pinnedGitEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const tree = stdout.trim()
    if (!/^[0-9a-f]{40}$/u.test(tree)) {
      throw new Error(`unexpected tree format: ${tree}`)
    }
    return tree
  } catch (error) {
    throw new AuthorityInventoryError(
      INVENTORY_REFUSE.REVISION_UNRESOLVED,
      `cannot resolve Git tree for commit ${commit}: ${String(error?.message ?? error)}`,
      { cause: error },
    )
  }
}

/**
 * Read one regular source file through a no-follow descriptor, verifying stability.
 *
 * @param {string} absolutePath - absolute filesystem path.
 * @param {string} relativePath - repository-relative display path.
 * @returns {Buffer} raw file bytes.
 */
export function readVerifiedSourceFile(absolutePath, relativePath) {
  let descriptor
  try {
    descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new AuthorityInventoryError(INVENTORY_REFUSE.SOURCE_MISSING, `${relativePath} is missing on disk`, { cause: error })
    }
    throw new AuthorityInventoryError(INVENTORY_REFUSE.SOURCE_UNREADABLE, `cannot open ${relativePath}: ${String(error?.message ?? error)}`, { cause: error })
  }
  try {
    const state = fstatSync(descriptor)
    if (!state.isFile() || realpathSync(absolutePath) !== absolutePath) {
      throw new AuthorityInventoryError(INVENTORY_REFUSE.SOURCE_NOT_REGULAR, `${relativePath} is not a regular file without symlinks`)
    }
    const bytes = readFileSync(descriptor)
    if (bytes.length !== state.size) {
      throw new AuthorityInventoryError(INVENTORY_REFUSE.SOURCE_CHANGED, `${relativePath} changed during read`)
    }
    return bytes
  } catch (error) {
    if (error instanceof AuthorityInventoryError) throw error
    throw new AuthorityInventoryError(INVENTORY_REFUSE.SOURCE_UNREADABLE, `cannot read ${relativePath}: ${String(error?.message ?? error)}`, { cause: error })
  } finally {
    closeSync(descriptor)
  }
}

/**
 * Construct the static source graph rooted at broker and issuer directly from Git blobs at one commit.
 *
 * @param {string} commit - resolved 40-hex commit hash.
 * @param {string} [repoDir=REPO_DIR] - repository directory.
 * @returns {{format: string, roots: string[], nodes: Array<object>, localEdges: Array<object>, externalEdges: Array<object>}}
 */
export function pinnedAuthorityGraph(commit, repoDir = REPO_DIR) {
  assertPinnedRepository()
  const roots = [...AUTHORITY_ROOTS]
  const visited = new Set()
  const nodes = []
  const localEdges = []
  const externalEdges = []

  let frontier = [...roots]
  while (frontier.length > 0) {
    frontier.sort(compareText)
    const batchPaths = frontier.map(p => `aukora/${p}`)
    let blobs
    try {
      blobs = readPinnedBlobs(commit, batchPaths)
    } catch (error) {
      if (error instanceof SeatFilesError) {
        if (error.reason === SEAT_FILES_REFUSE.BLOB_UNREADABLE) {
          throw new AuthorityInventoryError(INVENTORY_REFUSE.SOURCE_MISSING, error.message, { cause: error })
        }
        if (error.reason === SEAT_FILES_REFUSE.BLOB_NOT_REGULAR) {
          throw new AuthorityInventoryError(INVENTORY_REFUSE.SOURCE_NOT_REGULAR, error.message, { cause: error })
        }
      }
      throw new AuthorityInventoryError(
        INVENTORY_REFUSE.SOURCE_UNREADABLE,
        `failed to read authority blobs at ${commit}: ${String(error?.message ?? error)}`,
        { cause: error },
      )
    }

    const nextFrontier = []
    for (const graphPath of frontier) {
      if (visited.has(graphPath)) continue
      visited.add(graphPath)
      const repoPath = `aukora/${graphPath}`
      const bytes = blobs.get(repoPath)
      if (!bytes) {
        throw new AuthorityInventoryError(INVENTORY_REFUSE.SOURCE_MISSING, `${repoPath} missing at ${commit}`)
      }
      const source = bytes.toString('utf8')
      nodes.push({
        path: graphPath,
        byteLength: bytes.length,
        sha256: sha256(bytes),
        sourceBase64: bytes.toString('base64'),
      })

      const specifiers = staticSpecifiers(source, graphPath)
      for (const edge of specifiers) {
        if (edge.specifier.startsWith('./') || edge.specifier.startsWith('../')) {
          const target = resolveLocalEdgePosix(graphPath, edge.specifier)
          localEdges.push({ from: graphPath, ...edge, to: target })
          if (!visited.has(target) && !nextFrontier.includes(target)) {
            nextFrontier.push(target)
          }
        } else {
          externalEdges.push({ from: graphPath, ...edge })
        }
      }
    }
    frontier = nextFrontier
  }

  nodes.sort((left, right) => compareText(left.path, right.path))
  const edgeOrder = (left, right) => compareText(left.from, right.from)
    || left.ordinal - right.ordinal
    || compareText(left.specifier, right.specifier)
  localEdges.sort(edgeOrder)
  externalEdges.sort(edgeOrder)

  return {
    format: VERIFIER_GRAPH_FORMAT,
    roots: [...roots].sort(compareText),
    nodes,
    localEdges,
    externalEdges,
  }
}

/**
 * Extract the frozen verifier digest committed at one Git revision.
 *
 * @param {string} commit - resolved 40-hex commit hash.
 * @returns {string} 64-hex SHA-256 digest string.
 */
export function readPinnedFrozenDigest(commit) {
  let bytes
  try {
    bytes = readPinnedBlob(commit, 'aukora/host-dsh/src/verifier-bytes.mjs')
  } catch (error) {
    throw new AuthorityInventoryError(
      INVENTORY_REFUSE.GRAPH_INCOMPLETE,
      `cannot read verifier-bytes.mjs at commit ${commit}: ${String(error?.message ?? error)}`,
      { cause: error },
    )
  }
  const source = bytes.toString('utf8')
  const match = /export\s+const\s+FROZEN_VERIFIER_SHA256\s*=\s*['"](?<sha>[0-9a-f]{64})['"]/u.exec(source)
  if (!match?.groups?.sha) {
    throw new AuthorityInventoryError(
      INVENTORY_REFUSE.GRAPH_INCOMPLETE,
      `cannot extract FROZEN_VERIFIER_SHA256 from verifier-bytes.mjs at commit ${commit}`,
    )
  }
  return match.groups.sha
}

/**
 * Generate a deterministic authority source inventory derived strictly from one Git revision.
 *
 * @param {object} [options] - configuration options.
 * @param {string} [options.revision='HEAD'] - Git revision to pin and derive inventory from.
 * @param {string} [options.repoDir=REPO_DIR] - repository root directory.
 * @param {(commit: string) => object} [options.readGraph] - injectable authority graph reader.
 * @param {(imports: Array<{specifier: string, consumerPath: string}>) => Array<{path: string, bytes: Buffer, sha256: string}>} [options.readDependencies=snapshotAuthorityDependencies] - injectable dependency reader.
 * @param {boolean} [options.refuseDirty=false] - whether to refuse if working tree has uncommitted edits in authority source files.
 * @param {boolean} [options.refuseMismatched=false] - whether to refuse if requested revision differs from checked-out HEAD.
 * @returns {object} canonical inventory data structure.
 */
export function authoritySourceInventory(options = {}) {
  const {
    revision = 'HEAD',
    repoDir = REPO_DIR,
    readGraph = undefined,
    readDependencies = snapshotAuthorityDependencies,
    refuseDirty = false,
    refuseMismatched = false,
  } = options

  assertPinnedRepository()
  let commit
  try {
    commit = resolvePinnedRevision(revision)
  } catch (error) {
    if (error instanceof SeatFilesError) {
      if (error.reason === SEAT_FILES_REFUSE.REVISION_INVALID) {
        throw new AuthorityInventoryError(INVENTORY_REFUSE.REVISION_INVALID, error.message, { cause: error })
      }
      if (error.reason === SEAT_FILES_REFUSE.REVISION_UNRESOLVED) {
        throw new AuthorityInventoryError(INVENTORY_REFUSE.REVISION_UNRESOLVED, error.message, { cause: error })
      }
    }
    throw new AuthorityInventoryError(
      INVENTORY_REFUSE.REVISION_UNRESOLVED,
      String(error?.message ?? error),
      { cause: error },
    )
  }
  const tree = resolveCommitTree(commit, repoDir)

  let graph
  try {
    graph = typeof readGraph === 'function' ? readGraph(commit) : pinnedAuthorityGraph(commit, repoDir)
  } catch (error) {
    if (error instanceof AuthorityInventoryError) throw error
    throw new AuthorityInventoryError(
      INVENTORY_REFUSE.GRAPH_INCOMPLETE,
      `failed to compute authority source graph: ${String(error?.message ?? error)}`,
      { cause: error },
    )
  }

  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes) || !Array.isArray(graph.externalEdges)) {
    throw new AuthorityInventoryError(INVENTORY_REFUSE.GRAPH_INCOMPLETE, 'authority graph returned malformed structure')
  }

  const computedDigest = createHash('sha256').update(JSON.stringify(graph), 'utf8').digest('hex')
  let frozenDigest
  try {
    frozenDigest = readPinnedFrozenDigest(commit)
  } catch {
    frozenDigest = FROZEN_VERIFIER_SHA256
  }
  const matchesFrozen = computedDigest === frozenDigest

  // Selected sources derived strictly from the commit's graph nodes
  const selectedSources = []
  let selectedSourceBytes = 0

  for (const node of graph.nodes) {
    const repoRelativePath = `aukora/${node.path}`
    selectedSources.push({
      path: repoRelativePath,
      byteLength: node.byteLength,
      sha256: node.sha256,
    })
    selectedSourceBytes += node.byteLength
  }
  selectedSources.sort((left, right) => compareText(left.path, right.path))

  // Inspect working tree status without letting disk bytes alter selectedSources
  let checkedOutHead = null
  try {
    checkedOutHead = resolvePinnedRevision('HEAD')
  } catch {
    // HEAD unresolvable
  }

  const isCurrentHead = checkedOutHead === commit
  if (refuseMismatched && !isCurrentHead) {
    throw new AuthorityInventoryError(
      INVENTORY_REFUSE.REVISION_MISMATCHED,
      `requested revision ${commit} does not match checked-out HEAD ${checkedOutHead}`,
    )
  }

  const modifiedFiles = []
  for (const src of selectedSources) {
    const diskPath = resolve(repoDir, src.path)
    try {
      const diskBytes = readVerifiedSourceFile(diskPath, src.path)
      const diskSha = sha256(diskBytes)
      if (diskSha !== src.sha256 || diskBytes.length !== src.byteLength) {
        modifiedFiles.push(src.path)
      }
    } catch (error) {
      if (refuseDirty && error instanceof AuthorityInventoryError && error.reason === INVENTORY_REFUSE.SOURCE_MISSING) {
        throw error
      }
      modifiedFiles.push(src.path)
    }
  }

  if (refuseDirty && modifiedFiles.length > 0) {
    throw new AuthorityInventoryError(
      INVENTORY_REFUSE.WORKING_TREE_DIRTY,
      `working tree has uncommitted modifications in authority files: ${modifiedFiles.join(', ')}`,
    )
  }

  // Group external package dependencies separately from source.
  const nonBuiltinEdges = graph.externalEdges.filter(edge => !edge.specifier.startsWith('node:'))
  const imports = nonBuiltinEdges.map(edge => ({
    specifier: edge.specifier,
    consumerPath: join(repoDir, 'aukora', edge.from),
  }))

  let capturedDependencyFiles = []
  try {
    capturedDependencyFiles = readDependencies(imports)
  } catch (error) {
    throw new AuthorityInventoryError(
      INVENTORY_REFUSE.DEPENDENCY_UNRESOLVABLE,
      `failed to snapshot authority package dependencies: ${String(error?.message ?? error)}`,
      { cause: error },
    )
  }

  const packageMap = new Map()
  let externalDependencyBytes = 0

  for (const file of capturedDependencyFiles) {
    externalDependencyBytes += file.bytes.length
    const match = /^node_modules\/(?<name>@[^/]+\/[^/]+|[^/@][^/]*)\//u.exec(file.path)
    if (!match) continue
    const pkgName = match.groups.name
    let pkg = packageMap.get(pkgName)
    if (!pkg) {
      pkg = {
        name: pkgName,
        version: 'unknown',
        manifestDigest: null,
        fileCount: 0,
        totalByteLength: 0,
        specifiers: new Set(),
        source: 'installed-node-modules-snapshot',
      }
      packageMap.set(pkgName, pkg)
    }
    pkg.fileCount += 1
    pkg.totalByteLength += file.bytes.length

    if (file.path === `node_modules/${pkgName}/package.json`) {
      try {
        const manifest = JSON.parse(file.bytes.toString('utf8'))
        if (typeof manifest.version === 'string') pkg.version = manifest.version
        pkg.manifestDigest = file.sha256
      } catch {
        // Fall back to existing values
      }
    }
  }

  for (const edge of nonBuiltinEdges) {
    for (const [pkgName, pkg] of packageMap) {
      if (edge.specifier === pkgName || edge.specifier.startsWith(`${pkgName}/`)) {
        pkg.specifiers.add(edge.specifier)
      }
    }
  }

  const externalDependencies = [...packageMap.values()]
    .map(pkg => ({
      name: pkg.name,
      version: pkg.version,
      manifestDigest: pkg.manifestDigest,
      fileCount: pkg.fileCount,
      totalByteLength: pkg.totalByteLength,
      specifiers: [...pkg.specifiers].sort(compareText),
      source: 'installed-node-modules-snapshot',
    }))
    .sort((left, right) => compareText(left.name, right.name))

  const installedDependencies = {
    source: 'installed-node-modules-snapshot',
    description: 'Snapshot of installed node_modules bytes on host filesystem; not authenticated Git source.',
    packages: externalDependencies,
  }

  return {
    domain: INVENTORY_DOMAIN,
    revision: commit,
    tree,
    authorityGraph: {
      format: graph.format ?? VERIFIER_GRAPH_FORMAT,
      digest: computedDigest,
      frozenDigest,
      matchesFrozen,
      roots: (graph.roots ?? []).map(r => (r.startsWith('aukora/') ? r : `aukora/${r}`)).sort(compareText),
      nodeCount: graph.nodes.length,
      localEdgeCount: graph.localEdges?.length ?? 0,
      externalEdgeCount: graph.externalEdges?.length ?? 0,
    },
    counts: {
      selectedSourceFiles: selectedSources.length,
      selectedSourceBytes,
      externalPackages: externalDependencies.length,
      externalDependencyFiles: capturedDependencyFiles.length,
      externalDependencyBytes,
    },
    selectedSources,
    externalDependencies,
    installedDependencies,
    workingTreeStatus: {
      checkedOutCommit: checkedOutHead,
      isCurrentHead,
      isClean: modifiedFiles.length === 0,
      modifiedFiles,
    },
    excludedTrustComponents: EXCLUDED_TRUST_COMPONENTS,
    claims: {
      isCompleteTCB: false,
      securityScore: null,
      scope: 'Static source closure of broker and issuer authority modules from pinned Git revision and installed Noble package dependencies snapshot; excludes runtime, OS, hardware, and ambient state.',
      disclaimer: 'This inventory enumerates only the static source graph from the selected Git revision and an installed package snapshot of declared dependencies. It does not authenticate dependencies from Git, does not constitute a complete Trusted Computing Base (TCB) proof, an attestation of runtime execution, a security rating, or a guarantee against ambient host compromise.',
    },
  }
}

/**
 * Format one authority source inventory into operator-readable text.
 *
 * @param {object} inventory - inventory object from {@link authoritySourceInventory}.
 * @returns {string} formatted multi-line human-readable summary.
 */
export function formatInventoryReport(inventory) {
  const lines = [
    'AUKORA Authority Source Inventory',
    '=================================',
    `Domain:         ${inventory.domain}`,
    `Revision:       ${inventory.revision}`,
    `Git Tree:       ${inventory.tree}`,
    `Working Tree:   ${inventory.workingTreeStatus.isClean ? 'CLEAN (matches revision)' : `MODIFIED (${inventory.workingTreeStatus.modifiedFiles.length} file(s) differ on disk)`}`,
    `Checked-out:    ${inventory.workingTreeStatus.checkedOutCommit ?? 'unknown'} (matches revision: ${inventory.workingTreeStatus.isCurrentHead ? 'YES' : 'NO'})`,
    `Graph Format:   ${inventory.authorityGraph.format}`,
    `Graph Digest:   ${inventory.authorityGraph.digest}`,
    `Frozen Digest:  ${inventory.authorityGraph.frozenDigest} (matches: ${inventory.authorityGraph.matchesFrozen ? 'YES' : 'NO'})`,
    `Roots:          ${inventory.authorityGraph.roots.join(', ')}`,
    '',
    `Selected Source Files [pinned Git revision] (${inventory.counts.selectedSourceFiles} files, ${inventory.counts.selectedSourceBytes} bytes):`,
  ]

  for (const src of inventory.selectedSources) {
    lines.push(`  ${src.path} (${src.byteLength} B) [sha256: ${src.sha256.slice(0, 16)}...]`)
  }

  lines.push('')
  lines.push(`External Dependencies [installed-node-modules-snapshot] (${inventory.counts.externalPackages} packages, ${inventory.counts.externalDependencyFiles} files, ${inventory.counts.externalDependencyBytes} bytes):`)
  lines.push('  Note: Captured from installed host node_modules; not authenticated Git source.')
  for (const dep of inventory.externalDependencies) {
    lines.push(`  ${dep.name}@${dep.version} (${dep.fileCount} files, ${dep.totalByteLength} B, specifiers: ${dep.specifiers.join(', ') || 'none'})`)
  }

  lines.push('')
  lines.push(`Excluded Trust Components (${inventory.excludedTrustComponents.length} categories):`)
  for (const comp of inventory.excludedTrustComponents) {
    lines.push(`  [${comp.category}] ${comp.title}: ${comp.boundaryRationale}`)
  }

  lines.push('')
  lines.push('Claims & Scope:')
  lines.push(`  Complete TCB:   ${inventory.claims.isCompleteTCB ? 'YES' : 'NO'}`)
  lines.push(`  Security Score: ${inventory.claims.securityScore === null ? 'NONE (explicitly omitted)' : inventory.claims.securityScore}`)
  lines.push(`  Scope:          ${inventory.claims.scope}`)
  lines.push(`  Disclaimer:     ${inventory.claims.disclaimer}`)

  return lines.join('\n')
}

/** CLI entrypoint. */
async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`usage: node scripts/aukora-authority-inventory.mjs [options]

Options:
  --revision <rev>   Git revision to pin and inspect (default: HEAD)
  --json             Output inventory as canonical JSON
  --check            Verify that authority graph matches frozen verifier digest
  --refuse-dirty     Refuse if working tree has uncommitted edits in authority source
  --refuse-mismatched Refuse if requested revision differs from checked-out HEAD
  --help, -h         Show this help message
`)
    process.exit(0)
  }

  const jsonMode = args.includes('--json')
  const checkMode = args.includes('--check')
  const refuseDirty = args.includes('--refuse-dirty') || args.includes('--require-clean')
  const refuseMismatched = args.includes('--refuse-mismatched')

  let revision = 'HEAD'
  const revIndex = args.indexOf('--revision')
  if (revIndex >= 0 && args[revIndex + 1]) {
    revision = args[revIndex + 1]
  }

  try {
    const inventory = authoritySourceInventory({ revision, refuseDirty, refuseMismatched })

    if (checkMode && !inventory.authorityGraph.matchesFrozen) {
      console.error(`authority-inventory:check-failed: computed graph digest ${inventory.authorityGraph.digest} does not match frozen ${inventory.authorityGraph.frozenDigest}`)
      process.exit(1)
    }

    if (jsonMode) {
      console.log(canonicalJSON(inventory))
    } else {
      console.log(formatInventoryReport(inventory))
    }
    process.exit(0)
  } catch (error) {
    console.error(`\n*** INVENTORY FAILED *** ${String(error?.message ?? error)}`)
    process.exit(1)
  }
}

// Run CLI when invoked directly.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
