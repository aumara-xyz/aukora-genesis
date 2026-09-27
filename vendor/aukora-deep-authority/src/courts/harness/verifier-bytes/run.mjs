/**
 * courts/harness/verifier-bytes — freeze the production issuer/broker authority graph.
 *
 * The normal arm compares the exact source-byte graph with its frozen digest
 * and checks the expected node and edge closure. Mutation mode changes a real
 * dependency file, then rewires the production broker import to a new soft
 * verifier inside a temporary copy. Both changes must move the graph digest.
 *
 * This is builder-owned, self-reported evidence. A writer able to change the
 * graph reader, frozen value, and court can create a coherent false result.
 *
 *   node courts/harness/verifier-bytes/run.mjs
 *   node courts/harness/verifier-bytes/run.mjs --mutate
 */
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const AUKORA_DIRECTORY = join(HERE, '../../../aukora')
const HOST_DIRECTORY = join(AUKORA_DIRECTORY, 'host-dsh/src')
const verifierModule = await import(pathToFileURL(join(HOST_DIRECTORY, 'verifier-bytes.mjs')).href)
const {
  FROZEN_VERIFIER_SHA256,
  VERIFIER_GRAPH_FORMAT,
  computeVerifierDigest,
  verifierGraph,
} = verifierModule

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--mutate')) {
  console.error('usage: node courts/harness/verifier-bytes/run.mjs [--mutate]')
  process.exit(2)
}
const MUTATE = args[0] === '--mutate'

const EXPECTED_ROWS = [
  'V1.live',
  'V2.format',
  'V2.roots',
  'V2.nodes',
  'V2.local-edges',
  'V2.external-edges',
  'V2.bytes',
  'V2.recompute',
]
const EXPECTED_GRAPH_KEYS = ['externalEdges', 'format', 'localEdges', 'nodes', 'roots']
const EXPECTED_NODE_PATHS = [
  'activation/broker-state.mjs',
  'activation/statement.mjs',
  'activation/web-upgrade-record.mjs',
  'approval/artifact.mjs',
  'approval/occurrence.mjs',
  'approval/render.mjs',
  'aura/authority-evidence.mjs',
  'aura/record.mjs',
  'broker/broker.mjs',
  'broker/compute-job-args.mjs',
  'broker/confinement.mjs',
  'broker/effect-body.mjs',
  'broker/effect-definition.mjs',
  'broker/effect.mjs',
  'broker/kira-recall.mjs',
  'broker/memory-entries.mjs',
  'broker/memory-put-args.mjs',
  'broker/operation.mjs',
  'broker/receipt.mjs',
  'broker/review.mjs',
  'broker/subject-authority.mjs',
  'broker/workspace-patch-args.mjs',
  'broker/workspace-patch.mjs',
  'host-dsh/src/grant-v5.mjs',
  'host-dsh/src/grant.mjs',
  'host-dsh/src/nonce-book.mjs',
  'identity/broker-state.mjs',
  'identity/control.mjs',
  'identity/delegation.mjs',
  'identity/genesis.mjs',
  'identity/validation.mjs',
  'issuer/approval-carrier.mjs',
  'issuer/issuer.mjs',
  'issuer/mint.mjs',
  'kernel-seed/canonical-json.mjs',
  'kira/recall.mjs',
  'kira/stage.mjs',
  'receipt-v3/export.mjs',
]
const EXPECTED_LOCAL_EDGE_COUNT = 117
const EXPECTED_EXTERNAL_EDGE_COUNT = 68
const EXPECTED_PACKAGE_SPECIFIERS = [
  '@noble/curves/ed25519.js',
  '@noble/curves/ed25519.js',
  '@noble/post-quantum/ml-dsa.js',
  '@noble/post-quantum/ml-dsa.js',
]
const EXPECTED_PACKAGE_SPECIFIER_SET = new Set(EXPECTED_PACKAGE_SPECIFIERS)
const digest = (graph) => createHash('sha256').update(JSON.stringify(graph), 'utf8').digest('hex')
const rowsAreExact = (rows) => {
  const names = rows.map((row) => row.n)
  return names.length === EXPECTED_ROWS.length
    && new Set(names).size === names.length
    && EXPECTED_ROWS.every((name) => names.includes(name))
}

const graph = verifierGraph()
const liveDigest = computeVerifierDigest()
const rows = []
rows.push({
  n: 'V1.live',
  ok: liveDigest === FROZEN_VERIFIER_SHA256,
  d: `live=${liveDigest.slice(0, 16)} frozen=${FROZEN_VERIFIER_SHA256.slice(0, 16)}`,
})

const graphKeys = Object.keys(graph).sort()
rows.push({
  n: 'V2.format',
  ok: graph.format === VERIFIER_GRAPH_FORMAT
    && JSON.stringify(graphKeys) === JSON.stringify(EXPECTED_GRAPH_KEYS),
  d: `format=${graph.format} keys=${graphKeys.length}`,
})
rows.push({
  n: 'V2.roots',
  ok: JSON.stringify(graph.roots) === JSON.stringify(['broker/broker.mjs', 'issuer/issuer.mjs']),
  d: `roots=${graph.roots.join(',')}`,
})

const nodePaths = graph.nodes.map((node) => node.path)
rows.push({
  n: 'V2.nodes',
  ok: JSON.stringify(nodePaths) === JSON.stringify(EXPECTED_NODE_PATHS),
  d: `nodes=${nodePaths.length}`,
})

const nodeSet = new Set(nodePaths)
const localEdgesHeld = graph.localEdges.length === EXPECTED_LOCAL_EDGE_COUNT
  && graph.localEdges.every((edge) => edge.specifier.startsWith('.')
    && nodeSet.has(edge.from)
    && nodeSet.has(edge.to)
    && Number.isSafeInteger(edge.ordinal)
    && (edge.kind === 'import' || edge.kind === 'export'))
rows.push({
  n: 'V2.local-edges',
  ok: localEdgesHeld,
  d: `localEdges=${graph.localEdges.length}`,
})

const packageSpecifiers = graph.externalEdges
  .filter((edge) => !edge.specifier.startsWith('node:'))
  .map((edge) => edge.specifier)
  .sort()
const externalEdgesHeld = graph.externalEdges.length === EXPECTED_EXTERNAL_EDGE_COUNT
  && JSON.stringify(packageSpecifiers) === JSON.stringify(EXPECTED_PACKAGE_SPECIFIERS)
  && graph.externalEdges.every((edge) => (edge.specifier.startsWith('node:')
      || EXPECTED_PACKAGE_SPECIFIER_SET.has(edge.specifier))
    && nodeSet.has(edge.from)
    && Number.isSafeInteger(edge.ordinal)
    && edge.kind === 'import')
rows.push({
  n: 'V2.external-edges',
  ok: externalEdgesHeld,
  d: `externalEdges=${graph.externalEdges.length}`,
})

const exactBytesHeld = graph.nodes.every((node) => {
  const bytes = Buffer.from(node.sourceBase64, 'base64')
  return bytes.length > 0
    && bytes.length === node.byteLength
    && bytes.toString('base64') === node.sourceBase64
    && createHash('sha256').update(bytes).digest('hex') === node.sha256
})
rows.push({ n: 'V2.bytes', ok: exactBytesHeld, d: `exactSources=${graph.nodes.length}` })

const independentlyComputed = digest(graph)
rows.push({
  n: 'V2.recompute',
  ok: independentlyComputed === liveDigest,
  d: `court=${independentlyComputed.slice(0, 16)} product=${liveDigest.slice(0, 16)}`,
})

console.log('\n  courts/harness/verifier-bytes — frozen issuer/broker authority source graph\n  ' + '-'.repeat(72))
for (const row of rows) {
  console.log(`  ${row.n}  ${row.ok ? 'held' : '*** BREACH ***'}  ${row.d}`)
}

const mutationVerdict = ({
  ordinaryRows,
  sourceMutationsApplied,
  sourceMutationsMoved,
  importRewireApplied,
  importRewireDigest,
  importRewireGraphHeld,
}) => rowsAreExact(ordinaryRows)
  && ordinaryRows.every((row) => row.ok)
  && sourceMutationsApplied === EXPECTED_NODE_PATHS.length
  && sourceMutationsMoved === EXPECTED_NODE_PATHS.length
  && importRewireApplied
  && importRewireDigest !== null
  && importRewireDigest !== liveDigest
  && importRewireGraphHeld

if (MUTATE) {
  const temporary = mkdtempSync(join(tmpdir(), 'aukora-verifier-graph-mutation-'))
  let sourceMutationsApplied = 0
  let sourceMutationsMoved = 0
  let importRewireApplied = false
  let importRewireDigest = null
  let importRewireGraphHeld = false
  try {
    const copiedAukora = join(temporary, 'aukora')
    const copiedHost = join(copiedAukora, 'host-dsh/src')
    const copiedBroker = join(copiedAukora, 'broker/broker.mjs')
    cpSync(AUKORA_DIRECTORY, copiedAukora, { recursive: true })
    const copiedVerifier = await import(pathToFileURL(join(copiedHost, 'verifier-bytes.mjs')).href)

    for (const path of EXPECTED_NODE_PATHS) {
      const copiedSource = join(copiedAukora, path)
      const originalBytes = readFileSync(copiedSource)
      const changedBytes = Buffer.concat([originalBytes, Buffer.from('\n', 'utf8')])
      writeFileSync(copiedSource, changedBytes)
      sourceMutationsApplied += 1
      if (copiedVerifier.computeVerifierDigest() !== liveDigest) sourceMutationsMoved += 1
      writeFileSync(copiedSource, originalBytes)
    }

    const originalBroker = readFileSync(copiedBroker, 'utf8')
    const hardImport = "../host-dsh/src/grant.mjs"
    const softImport = "../host-dsh/src/soft-grant.mjs"
    const changedBroker = originalBroker.replace(hardImport, softImport)
    importRewireApplied = originalBroker.split(hardImport).length === 2
      && changedBroker !== originalBroker
      && !changedBroker.includes(hardImport)
    if (importRewireApplied) {
      writeFileSync(join(copiedHost, 'soft-grant.mjs'), "export * from './grant.mjs'\n")
      writeFileSync(copiedBroker, changedBroker)
      const rewiredGraph = copiedVerifier.verifierGraph()
      importRewireDigest = digest(rewiredGraph)
      importRewireGraphHeld = rewiredGraph.nodes.some((node) => node.path === 'host-dsh/src/soft-grant.mjs')
        && rewiredGraph.localEdges.some((edge) => edge.from === 'broker/broker.mjs'
          && edge.specifier === softImport
          && edge.to === 'host-dsh/src/soft-grant.mjs')
        && rewiredGraph.localEdges.some((edge) => edge.from === 'host-dsh/src/soft-grant.mjs'
          && edge.specifier === './grant.mjs'
          && edge.to === 'host-dsh/src/grant.mjs')
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }

  const sabotagedRows = rows.map((row) => row.n === 'V1.live' ? { ...row, ok: false } : row)
  const mutation = {
    sourceMutationsApplied,
    sourceMutationsMoved,
    importRewireApplied,
    importRewireDigest,
    importRewireGraphHeld,
  }
  const sabotageRejected = !mutationVerdict({ ordinaryRows: sabotagedRows, ...mutation })
  const detected = mutationVerdict({ ordinaryRows: rows, ...mutation }) && sabotageRejected
  console.log(`\n  MUTATION sourceBytesApplied=${sourceMutationsApplied}/${EXPECTED_NODE_PATHS.length}`
    + ` sourceBytesMoved=${sourceMutationsMoved}/${EXPECTED_NODE_PATHS.length}`
    + ` importRewireApplied=${importRewireApplied}`
    + ` importRewireMoved=${importRewireDigest !== null && importRewireDigest !== liveDigest}`
    + ` importRewireGraphHeld=${importRewireGraphHeld}`
    + ` sabotagedLiveRejected=${sabotageRejected}`
    + ` detected=${detected}  ${detected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  process.exit(detected ? 0 : 1)
}

console.log(`\n  rowsComplete=${rowsAreExact(rows)} expected=${EXPECTED_ROWS.length} observed=${rows.length}`)
console.log('  observationClass: SELF-REPORTED\n')
process.exit(!rowsAreExact(rows) || rows.some((row) => !row.ok) ? 1 : 0)
