/**
 * Frozen digest of the issuer and broker authority source graph.
 *
 * The graph starts at `issuer/issuer.mjs` and `broker/broker.mjs`. Every
 * reachable relative static import or re-export contributes its exact source
 * bytes and an explicit edge to the digest. Repointing an import therefore
 * changes the root bytes and graph topology, even when the newly selected
 * module exports functions with the same names or source text. The issuer root
 * includes the human-review renderer whose displayed operation must agree with
 * the signed grant.
 *
 * Node built-in implementations and values received from the operating system
 * remain outside this digest. The graph also excludes modules reached only by
 * dynamic import. A process that can rewrite this module, the frozen value,
 * and its court can still forge a coherent result.
 *
 * @module @aukora/host-dsh/verifier-bytes
 */
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const AUKORA_DIRECTORY = resolve(MODULE_DIRECTORY, '../..')
const BROKER_ENTRY = resolve(AUKORA_DIRECTORY, 'broker/broker.mjs')
const ISSUER_ENTRY = resolve(AUKORA_DIRECTORY, 'issuer/issuer.mjs')
const AUTHORITY_ENTRIES = Object.freeze([BROKER_ENTRY, ISSUER_ENTRY])

/** The serialization format for the frozen source graph. */
export const VERIFIER_GRAPH_FORMAT = 'aukora:authority-static-source-graph:v2'

/**
 * The frozen digest of `verifierGraph()`.
 *
 * Replace this marker only after every concurrent edit under `aukora/` has
 * settled. Recompute with:
 *
 * `node --input-type=module -e "import('./aukora/host-dsh/src/verifier-bytes.mjs').then(m => console.log(m.computeVerifierDigest()))"`
 */
export const FROZEN_VERIFIER_SHA256 = '947dd68a0a030c5a405624c5d137b6efa3ace329b10327c04612778eb40117a1'

const isIdentifierStart = (character) => typeof character === 'string' && /[A-Za-z_$]/.test(character)
const isIdentifierPart = (character) => typeof character === 'string' && /[A-Za-z0-9_$]/.test(character)

/** Tokenize enough JavaScript to identify static import and re-export specifiers. */
function moduleTokens(source, file) {
  const tokens = []
  let index = 0
  while (index < source.length) {
    const character = source[index]
    if (/\s/.test(character)) {
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
      if (end < 0) throw new Error(`verifier-bytes:unterminated-comment:${file}`)
      index = end + 2
      continue
    }
    if (character === '"' || character === "'") {
      const quote = character
      const start = index
      index += 1
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\n' || source[index] === '\r') {
          throw new Error(`verifier-bytes:unterminated-string:${file}`)
        }
        if (source[index] === '\\') index += 1
        index += 1
      }
      if (index >= source.length) throw new Error(`verifier-bytes:unterminated-string:${file}`)
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
      if (index >= source.length) throw new Error(`verifier-bytes:unterminated-template:${file}`)
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
    if (specifier.includes('\\')) throw new Error(`verifier-bytes:escaped-specifier:${file}`)
    return { kind, ordinal, specifier }
  })
}

/** Resolve one relative ESM edge and refuse paths outside the Aukora tree. */
function resolveLocalEdge(fromAbsolute, specifier) {
  if (specifier.includes('?') || specifier.includes('#')) {
    throw new Error(`verifier-bytes:qualified-local-specifier:${specifier}`)
  }
  const target = resolve(dirname(fromAbsolute), specifier)
  const inside = relative(AUKORA_DIRECTORY, target)
  if (inside === '..' || inside.startsWith(`..${sep}`) || resolve(AUKORA_DIRECTORY, inside) !== target) {
    throw new Error(`verifier-bytes:local-edge-outside-aukora:${specifier}`)
  }
  if (extname(target) !== '.mjs') throw new Error(`verifier-bytes:unsupported-local-module:${specifier}`)
  return target
}

/** Read one regular source file through a no-follow descriptor. */
function readSource(absolute) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) throw new Error('verifier-bytes:no-nofollow-support')
  const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const state = fstatSync(descriptor)
    if (!state.isFile() || realpathSync(absolute) !== absolute) {
      throw new Error(`verifier-bytes:source-not-regular:${absolute}`)
    }
    return readFileSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

const graphPath = (absolute) => relative(AUKORA_DIRECTORY, absolute).split(sep).join('/')
const graphDigest = (graph) => createHash('sha256').update(JSON.stringify(graph), 'utf8').digest('hex')
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0

/**
 * Read the exact local static ESM graph rooted at the production issuer and broker.
 *
 * @returns {{format: string, roots: string[], nodes: Array<object>, localEdges: Array<object>, externalEdges: Array<object>}}
 *   canonical graph data sorted by repository-relative path.
 */
export function verifierGraph() {
  const pending = [...AUTHORITY_ENTRIES]
  const visited = new Set()
  const nodes = []
  const localEdges = []
  const externalEdges = []

  while (pending.length > 0) {
    pending.sort((left, right) => compareText(graphPath(left), graphPath(right)))
    const absolute = pending.shift()
    if (visited.has(absolute)) continue
    visited.add(absolute)

    const bytes = readSource(absolute)
    const source = bytes.toString('utf8')
    const path = graphPath(absolute)
    nodes.push({
      path,
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sourceBase64: bytes.toString('base64'),
    })

    for (const edge of staticSpecifiers(source, path)) {
      if (edge.specifier.startsWith('./') || edge.specifier.startsWith('../')) {
        const target = resolveLocalEdge(absolute, edge.specifier)
        localEdges.push({ from: path, ...edge, to: graphPath(target) })
        if (!visited.has(target)) pending.push(target)
      } else {
        externalEdges.push({ from: path, ...edge })
      }
    }
  }

  nodes.sort((left, right) => compareText(left.path, right.path))
  const edgeOrder = (left, right) => compareText(left.from, right.from)
    || left.ordinal - right.ordinal
    || compareText(left.specifier, right.specifier)
  localEdges.sort(edgeOrder)
  externalEdges.sort(edgeOrder)

  for (const node of nodes) {
    if (readSource(resolve(AUKORA_DIRECTORY, node.path)).toString('base64') !== node.sourceBase64) {
      throw new Error(`verifier-bytes:source-changed-during-read:${node.path}`)
    }
  }

  return {
    format: VERIFIER_GRAPH_FORMAT,
    roots: AUTHORITY_ENTRIES.map(graphPath).sort(compareText),
    nodes,
    localEdges,
    externalEdges,
  }
}

/**
 * Compute the sha256 digest of the issuer and broker's exact local static source graph.
 *
 * @returns {string} Lowercase sha256 hex.
 */
export function computeVerifierDigest() {
  return graphDigest(verifierGraph())
}
