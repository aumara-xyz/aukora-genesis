/**
 * courts/harness/guest-import-purity — pin the governed guest's static AUKORA imports.
 *
 * The court follows only runtime static imports and re-exports from the two
 * governed-memory entry modules. Type-only and dynamic imports are recorded
 * separately and never followed. This establishes source-graph separation;
 * it does not confine the Node guest from importing ambient modules itself.
 *
 * The mutation arm rewires the proposal client's pure effect-definition import
 * to the filesystem-capable effect implementation and removes the product
 * route's WebAssembly proposal call. Detection requires both graph changes to
 * become reachable while every unrelated row retains its ordinary verdict.
 *
 *   node courts/harness/guest-import-purity/run.mjs
 *   node courts/harness/guest-import-purity/run.mjs --mutate
 */
import {
  appendFileSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { definitionDigest, MEMORY_PUT_DEFINITION } from '../../../aukora/broker/effect-definition.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const PACKAGE_SOURCE_RELATIVE = 'packages/governed/memory-put/src'
const AUKORA_RELATIVE = 'aukora'
const ROOT_PATHS = [
  `${PACKAGE_SOURCE_RELATIVE}/index.ts`,
  `${PACKAGE_SOURCE_RELATIVE}/proposal-client.ts`,
]
const EXPECTED_PACKAGE_NODES = [
  `${PACKAGE_SOURCE_RELATIVE}/bridge.ts`,
  `${PACKAGE_SOURCE_RELATIVE}/index.ts`,
  `${PACKAGE_SOURCE_RELATIVE}/proposal-client.ts`,
  `${PACKAGE_SOURCE_RELATIVE}/wasm-proposal.ts`,
]
const EXPECTED_AUKORA_NODES = [
  'aukora/broker/compute-job-args.mjs',
  'aukora/broker/effect-body.mjs',
  'aukora/broker/effect-definition.mjs',
  'aukora/broker/memory-put-args.mjs',
  'aukora/broker/operation.mjs',
  'aukora/broker/public-outcome.mjs',
  'aukora/broker/review.mjs',
  'aukora/broker/workspace-patch-args.mjs',
  'aukora/guest/wasm-proposal-cell.mjs',
  'aukora/kernel-seed/canonical-json.mjs',
  'aukora/kira/recall.mjs',
  'aukora/kira/stage.mjs',
]
const EXPECTED_TYPE_EDGES = [
  `${PACKAGE_SOURCE_RELATIVE}/bridge.ts|./index.ts|${PACKAGE_SOURCE_RELATIVE}/index.ts`,
  `${PACKAGE_SOURCE_RELATIVE}/bridge.ts|@deepseek-ai/cordis|external`,
  `${PACKAGE_SOURCE_RELATIVE}/bridge.ts|@deepseek-ai/dsh-user-approval|external`,
  `${PACKAGE_SOURCE_RELATIVE}/index.ts|./proposal-client.ts|${PACKAGE_SOURCE_RELATIVE}/proposal-client.ts`,
  `${PACKAGE_SOURCE_RELATIVE}/index.ts|@aukora/core/kira/recall.mjs|aukora/kira/recall.mjs`,
  `${PACKAGE_SOURCE_RELATIVE}/index.ts|@aukora/core/kira/stage.mjs|aukora/kira/stage.mjs`,
  `${PACKAGE_SOURCE_RELATIVE}/index.ts|@deepseek-ai/dsh-agent|external`,
  `${PACKAGE_SOURCE_RELATIVE}/proposal-client.ts|@aukora/core/broker/workspace-patch-args.mjs|aukora/broker/workspace-patch-args.mjs`,
]
const EXPECTED_PACKAGE_BUILTINS = [
  `${PACKAGE_SOURCE_RELATIVE}/bridge.ts|node:net`,
  `${PACKAGE_SOURCE_RELATIVE}/index.ts|node:net`,
  `${PACKAGE_SOURCE_RELATIVE}/index.ts|node:string_decoder`,
  `${PACKAGE_SOURCE_RELATIVE}/proposal-client.ts|node:net`,
  `${PACKAGE_SOURCE_RELATIVE}/proposal-client.ts|node:string_decoder`,
]
const EXPECTED_PACKAGE_EXTERNALS = [
  `${PACKAGE_SOURCE_RELATIVE}/bridge.ts|node:net`,
  `${PACKAGE_SOURCE_RELATIVE}/index.ts|@deepseek-ai/cordis`,
  `${PACKAGE_SOURCE_RELATIVE}/index.ts|@deepseek-ai/dsh-llm`,
  `${PACKAGE_SOURCE_RELATIVE}/index.ts|@deepseek-ai/dsh-tools`,
  `${PACKAGE_SOURCE_RELATIVE}/index.ts|node:net`,
  `${PACKAGE_SOURCE_RELATIVE}/index.ts|node:string_decoder`,
  `${PACKAGE_SOURCE_RELATIVE}/proposal-client.ts|node:net`,
  `${PACKAGE_SOURCE_RELATIVE}/proposal-client.ts|node:string_decoder`,
]
const EXPECTED_AUKORA_BUILTINS = [
  'aukora/broker/effect-definition.mjs|node:crypto',
  'aukora/broker/operation.mjs|node:crypto',
  'aukora/guest/wasm-proposal-cell.mjs|node:crypto',
  'aukora/guest/wasm-proposal-cell.mjs|node:util',
  'aukora/kira/recall.mjs|node:crypto',
  'aukora/kira/recall.mjs|node:util',
  'aukora/kira/stage.mjs|node:crypto',
  'aukora/kira/stage.mjs|node:util',
]
const EXPECTED_AUKORA_EXTERNALS = EXPECTED_AUKORA_BUILTINS
const EXPECTED_DEFINITION_DIGEST = '2afe11cd84b96a7a00b07ce628c741c8e7b4c244d49d8f8e9b8653baa7f69a9b'
const FORBIDDEN_BUILTINS = [
  'node:child_process',
  'node:dgram',
  'node:fs',
  'node:http',
  'node:https',
  'node:tls',
]
const EXPECTED_ROWS = [
  'G1.roots', 'G2.aukora', 'G3.types', 'G4.dynamic', 'G5.builtins', 'G6.forbidden-builtins', 'G7.definition',
]
const EXPECTED_MUTATION_BREACHES = [
  'G1.roots', 'G2.aukora', 'G4.dynamic', 'G5.builtins', 'G6.forbidden-builtins',
]

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--mutate')) {
  console.error('usage: node courts/harness/guest-import-purity/run.mjs [--mutate]')
  process.exit(2)
}
const MUTATE = args[0] === '--mutate'
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0
const sorted = (values) => [...values].sort(compareText)
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const canonicalBuiltin = (specifier) => isBuiltin(specifier)
  ? specifier.startsWith('node:') ? specifier : `node:${specifier}`
  : null

/** Whether an import declaration causes its module to load at runtime. */
function importCarriesRuntimeValue(declaration) {
  const clause = declaration.importClause
  if (clause === undefined) return true
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword || clause.isTypeOnly === true) return false
  const bindings = clause.namedBindings
  return clause.name !== undefined
    || bindings === undefined
    || ts.isNamespaceImport(bindings)
    || bindings.elements.length === 0
    || bindings.elements.some((element) => !element.isTypeOnly)
}

/** Whether a re-export declaration causes its module to load at runtime. */
function exportCarriesRuntimeValue(declaration) {
  if (declaration.isTypeOnly) return false
  const clause = declaration.exportClause
  if (clause === undefined || ts.isNamespaceExport(clause)) return true
  return clause.elements.length === 0 || clause.elements.some((element) => !element.isTypeOnly)
}

/** Return true when target is a member of root without crossing an ancestor. */
function isWithin(root, target) {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

/** Return path faults when any measured source component is a symbolic link. */
function sourcePathFaults(root, target) {
  const path = relative(root, target)
  if (!isWithin(root, target)) return [`source leaves measured root: ${target}`]
  const components = path === '' ? [] : path.split(sep)
  const candidates = [root]
  let cursor = root
  for (const component of components) {
    cursor = join(cursor, component)
    candidates.push(cursor)
  }
  const faults = []
  for (const candidate of candidates) {
    try {
      if (lstatSync(candidate).isSymbolicLink()) faults.push(`symbolic-link source component: ${candidate}`)
    } catch (error) {
      faults.push(`unreadable source component: ${candidate} (${String(error?.code ?? error)})`)
    }
  }
  return faults
}

/** Walk one repository layout and return its classified import graph. */
function importGraph(layout) {
  const packageSource = resolve(layout.root, PACKAGE_SOURCE_RELATIVE)
  const aukora = resolve(layout.root, AUKORA_RELATIVE)
  const roots = ROOT_PATHS.map((path) => resolve(layout.root, path))
  const pending = [...roots]
  const visited = new Set()
  const nodes = []
  const runtimeEdges = []
  const typeEdges = []
  const dynamicEdges = []
  const faults = []

  const identity = (absolute) => {
    if (isWithin(packageSource, absolute)) {
      return {
        kind: 'package',
        path: `${PACKAGE_SOURCE_RELATIVE}/${relative(packageSource, absolute).split(sep).join('/')}`,
      }
    }
    if (isWithin(aukora, absolute)) {
      return { kind: 'aukora', path: `aukora/${relative(aukora, absolute).split(sep).join('/')}` }
    }
    return null
  }

  const resolveReference = (from, specifier) => {
    if (specifier.includes('?') || specifier.includes('#') || specifier.includes('\\')) {
      faults.push(`${from.path}: unsupported qualified module specifier ${JSON.stringify(specifier)}`)
      return { external: true }
    }
    if (specifier.startsWith('/') || specifier.startsWith('file:')) {
      faults.push(`${from.path}: absolute module specifier is outside the measured roots: ${JSON.stringify(specifier)}`)
      return { external: true }
    }
    let target
    if (specifier.startsWith('@aukora/core/')) {
      target = resolve(aukora, specifier.slice('@aukora/core/'.length))
    } else if (specifier.startsWith('.')) {
      target = resolve(dirname(from.absolute), specifier)
    } else {
      return { external: true }
    }
    const targetIdentity = identity(target)
    if (targetIdentity === null) {
      faults.push(`${from.path}: local module leaves the measured roots: ${JSON.stringify(specifier)}`)
      return { external: true }
    }
    const expectedExtension = targetIdentity.kind === 'package' ? '.ts' : '.mjs'
    if (extname(target) !== expectedExtension) {
      faults.push(`${from.path}: local module has unsupported extension: ${JSON.stringify(specifier)}`)
      return { external: true }
    }
    try {
      if (!lstatSync(target).isFile()) faults.push(`${targetIdentity.path}: source is not a regular file`)
    } catch {
      faults.push(`${targetIdentity.path}: source is unreadable`)
    }
    return { external: false, absolute: target, ...targetIdentity }
  }

  const addEdge = (collection, from, specifier) => {
    const target = resolveReference(from, specifier)
    collection.push({
      from: from.path,
      fromKind: from.kind,
      specifier,
      to: target.external ? null : target.path,
      toKind: target.external ? null : target.kind,
    })
    return target
  }

  while (pending.length > 0) {
    pending.sort((left, right) => compareText(identity(left)?.path ?? left, identity(right)?.path ?? right))
    const absolute = pending.shift()
    if (visited.has(absolute)) continue
    visited.add(absolute)
    const moduleIdentity = identity(absolute)
    if (moduleIdentity === null) {
      faults.push(`runtime traversal left the measured roots: ${absolute}`)
      continue
    }
    for (const fault of sourcePathFaults(layout.root, absolute)) faults.push(`${moduleIdentity.path}: ${fault}`)
    let sourceText
    try {
      sourceText = readFileSync(absolute, 'utf8')
      if (!lstatSync(absolute).isFile()) throw new Error('source is not a regular file')
    } catch (error) {
      faults.push(`${moduleIdentity.path}: ${String(error?.message ?? error)}`)
      continue
    }
    nodes.push(moduleIdentity)
    const scriptKind = moduleIdentity.kind === 'package' ? ts.ScriptKind.TS : ts.ScriptKind.JS
    const source = ts.createSourceFile(moduleIdentity.path, sourceText, ts.ScriptTarget.Latest, true, scriptKind)
    for (const diagnostic of source.parseDiagnostics ?? []) {
      faults.push(`${moduleIdentity.path}: parse diagnostic ${String(diagnostic.code)}`)
    }
    const from = { absolute, ...moduleIdentity }

    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) {
        if (!ts.isStringLiteralLike(statement.moduleSpecifier)) {
          faults.push(`${moduleIdentity.path}: import specifier is not a string literal`)
          continue
        }
        const collection = importCarriesRuntimeValue(statement) ? runtimeEdges : typeEdges
        const target = addEdge(collection, from, statement.moduleSpecifier.text)
        if (collection === runtimeEdges && !target.external) pending.push(target.absolute)
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
        if (!ts.isStringLiteralLike(statement.moduleSpecifier)) {
          faults.push(`${moduleIdentity.path}: export specifier is not a string literal`)
          continue
        }
        const collection = exportCarriesRuntimeValue(statement) ? runtimeEdges : typeEdges
        const target = addEdge(collection, from, statement.moduleSpecifier.text)
        if (collection === runtimeEdges && !target.external) pending.push(target.absolute)
      } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)) {
        const specifier = statement.moduleReference.expression
        if (specifier === undefined || !ts.isStringLiteralLike(specifier)) {
          faults.push(`${moduleIdentity.path}: import-equals specifier is not a string literal`)
          continue
        }
        const collection = statement.isTypeOnly ? typeEdges : runtimeEdges
        const target = addEdge(collection, from, specifier.text)
        if (collection === runtimeEdges && !target.external) pending.push(target.absolute)
      }
    }

    const visit = (node) => {
      if (moduleIdentity.kind === 'aukora'
        && ts.isIdentifier(node)
        && ['Function', 'eval', 'process'].includes(node.text)) {
        faults.push(`${moduleIdentity.path}: ambient evaluator identifier ${JSON.stringify(node.text)}`)
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = node.arguments[0]
        if (specifier === undefined || !ts.isStringLiteralLike(specifier)) {
          faults.push(`${moduleIdentity.path}: dynamic import specifier is not a string literal`)
        } else {
          addEdge(dynamicEdges, from, specifier.text)
        }
      } else if (ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'require') {
        faults.push(`${moduleIdentity.path}: CommonJS require is outside the ESM import inventory`)
      } else if (ts.isCallExpression(node)
        && ((ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === 'getBuiltinModule')
          || (ts.isElementAccessExpression(node.expression)
            && ts.isStringLiteralLike(node.expression.argumentExpression)
            && node.expression.argumentExpression.text === 'getBuiltinModule'))) {
        const specifier = node.arguments[0]
        if (specifier === undefined || !ts.isStringLiteralLike(specifier)) {
          faults.push(`${moduleIdentity.path}: getBuiltinModule specifier is not a string literal`)
        } else {
          addEdge(dynamicEdges, from, specifier.text)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }

  const edgeOrder = (left, right) => compareText(left.from, right.from)
    || compareText(left.specifier, right.specifier)
    || compareText(left.to ?? '', right.to ?? '')
  nodes.sort((left, right) => compareText(left.path, right.path))
  runtimeEdges.sort(edgeOrder)
  typeEdges.sort(edgeOrder)
  dynamicEdges.sort(edgeOrder)
  faults.sort(compareText)
  return {
    roots: roots.map((absolute) => identity(absolute)?.path ?? absolute).sort(compareText),
    nodes,
    runtimeEdges,
    typeEdges,
    dynamicEdges,
    faults,
  }
}

/** Grade the exact static import inventory. */
function grade(graph) {
  const packageNodes = graph.nodes.filter((node) => node.kind === 'package').map((node) => node.path)
  const aukoraNodes = graph.nodes.filter((node) => node.kind === 'aukora').map((node) => node.path)
  const typeEdges = graph.typeEdges.map((edge) => `${edge.from}|${edge.specifier}|${edge.to ?? 'external'}`)
  const dynamicAukora = graph.dynamicEdges
    .filter((edge) => edge.toKind === 'aukora' || edge.specifier.startsWith('@aukora/core/'))
    .map((edge) => `${edge.from}|${edge.specifier}|${edge.to ?? 'external'}`)
  const packageBuiltins = graph.runtimeEdges
    .filter((edge) => edge.fromKind === 'package' && canonicalBuiltin(edge.specifier) !== null)
    .map((edge) => `${edge.from}|${canonicalBuiltin(edge.specifier)}`)
  const aukoraBuiltins = graph.runtimeEdges
    .filter((edge) => edge.fromKind === 'aukora' && canonicalBuiltin(edge.specifier) !== null)
    .map((edge) => `${edge.from}|${canonicalBuiltin(edge.specifier)}`)
  const packageExternals = graph.runtimeEdges
    .filter((edge) => edge.fromKind === 'package' && edge.to === null)
    .map((edge) => `${edge.from}|${edge.specifier}`)
  const aukoraExternals = graph.runtimeEdges
    .filter((edge) => edge.fromKind === 'aukora' && edge.to === null)
    .map((edge) => `${edge.from}|${edge.specifier}`)
  const forbidden = [...graph.runtimeEdges, ...graph.dynamicEdges]
    .filter((edge) => {
      const builtin = canonicalBuiltin(edge.specifier)
      return builtin !== null
        && FORBIDDEN_BUILTINS.some((name) => builtin === name || builtin.startsWith(`${name}/`))
    })
    .map((edge) => `${edge.from}|${edge.specifier}`)
  const definitionBefore = definitionDigest()
  let definitionMutationRefused = false
  try {
    MEMORY_PUT_DEFINITION.parameters.push('rider')
  } catch (error) {
    definitionMutationRefused = error instanceof TypeError
  }
  const definitionAfter = definitionDigest()
  const rows = [
    {
      n: 'G1.roots',
      breach: !same(graph.roots, ROOT_PATHS) || !same(packageNodes, EXPECTED_PACKAGE_NODES) || graph.faults.length > 0,
      detail: `roots=${graph.roots.length}/2 packageNodes=${packageNodes.length}/4 faults=${graph.faults.length}`,
    },
    {
      n: 'G2.aukora',
      breach: !same(aukoraNodes, EXPECTED_AUKORA_NODES),
      detail: `nodes=[${aukoraNodes.join(' ')}]`,
    },
    {
      n: 'G3.types',
      breach: !same(typeEdges, EXPECTED_TYPE_EDGES),
      detail: `typeEdges=${typeEdges.length}/${EXPECTED_TYPE_EDGES.length}`,
    },
    {
      n: 'G4.dynamic',
      breach: graph.dynamicEdges.length !== 0,
      detail: `dynamic=${graph.dynamicEdges.length} dynamicAukora=[${dynamicAukora.join(' ')}]`,
    },
    {
      n: 'G5.builtins',
      breach: !same(packageBuiltins, EXPECTED_PACKAGE_BUILTINS)
        || !same(packageExternals, EXPECTED_PACKAGE_EXTERNALS)
        || !same(aukoraBuiltins, EXPECTED_AUKORA_BUILTINS)
        || !same(aukoraExternals, EXPECTED_AUKORA_EXTERNALS),
      detail: `packageBuiltins=${packageBuiltins.length}/${EXPECTED_PACKAGE_BUILTINS.length}`
        + ` packageExternals=${packageExternals.length}/${EXPECTED_PACKAGE_EXTERNALS.length}`
        + ` aukoraBuiltins=${aukoraBuiltins.length}/${EXPECTED_AUKORA_BUILTINS.length}`
        + ` aukoraExternals=${aukoraExternals.length}/${EXPECTED_AUKORA_EXTERNALS.length}`,
    },
    {
      n: 'G6.forbidden-builtins',
      breach: forbidden.length !== 0,
      detail: `forbidden=[${forbidden.join(' ')}]`,
    },
    {
      n: 'G7.definition',
      breach: !Object.isFrozen(MEMORY_PUT_DEFINITION)
        || !Object.isFrozen(MEMORY_PUT_DEFINITION.parameters)
        || !definitionMutationRefused
        || definitionBefore !== EXPECTED_DEFINITION_DIGEST
        || definitionAfter !== EXPECTED_DEFINITION_DIGEST
        || !same(MEMORY_PUT_DEFINITION.parameters, ['key', 'value']),
      detail: `outerFrozen=${Object.isFrozen(MEMORY_PUT_DEFINITION)}`
        + ` parametersFrozen=${Object.isFrozen(MEMORY_PUT_DEFINITION.parameters)}`
        + ` mutationRefused=${definitionMutationRefused}`
        + ` digestStable=${definitionBefore === definitionAfter}`,
    },
  ]
  return rows
}

function printRows(rows) {
  console.log('\n  courts/harness/guest-import-purity — governed guest static import separation\n')
  for (const result of rows) {
    console.log(`  ${result.n}  ${result.breach ? '*** BREACH ***' : 'held'}  ${result.detail}`)
  }
}

const normalGraph = importGraph({ root: ROOT })
const normalRows = grade(normalGraph)
const normalHeld = normalRows.length === EXPECTED_ROWS.length
  && EXPECTED_ROWS.every((name) => normalRows.some((result) => result.n === name))
  && normalRows.every((result) => !result.breach)

if (!MUTATE) {
  printRows(normalRows)
  console.log('\n  observationClass: STATIC-IMPORT-SEPARATION / NODE-GUEST-UNCONFINED\n')
  process.exit(normalHeld ? 0 : 1)
}

const temporary = mkdtempSync(join(tmpdir(), 'aukora-guest-import-mutation-'))
let applied = false
let bareFsApplied = false
let builtinModuleApplied = false
let ancestorSymlinkApplied = false
let cellBypassApplied = false
let mutantGraph
try {
  const copiedPackageParent = resolve(temporary, 'packages/governed/memory-put')
  mkdirSync(copiedPackageParent, { recursive: true })
  cpSync(resolve(ROOT, PACKAGE_SOURCE_RELATIVE), resolve(copiedPackageParent, 'src'), { recursive: true })
  cpSync(resolve(ROOT, AUKORA_RELATIVE), resolve(temporary, AUKORA_RELATIVE), { recursive: true })
  const proposal = resolve(temporary, `${PACKAGE_SOURCE_RELATIVE}/proposal-client.ts`)
  const original = readFileSync(proposal, 'utf8')
  const pure = '@aukora/core/broker/effect-definition.mjs'
  const ambient = '@aukora/core/broker/effect.mjs'
  const changed = original.replace(pure, ambient)
  applied = original.split(pure).length === 2 && changed !== original && !changed.includes(pure)
  if (applied) writeFileSync(proposal, changed)
  const product = resolve(temporary, `${PACKAGE_SOURCE_RELATIVE}/index.ts`)
  const productOriginal = readFileSync(product, 'utf8')
  const cellImport = "import { proposeMemoryPutThroughCell } from './wasm-proposal.ts'\n"
  const cellCall = 'const detachedArgs = proposeMemoryPutThroughCell(args, pendingEntry.args)'
  const bypassed = productOriginal
    .replace(cellImport, '')
    .replace(cellCall, 'const detachedArgs = args')
  cellBypassApplied = productOriginal.split(cellImport).length === 2
    && productOriginal.split(cellCall).length === 2
    && bypassed !== productOriginal
    && !bypassed.includes('proposeMemoryPutThroughCell')
  if (cellBypassApplied) writeFileSync(product, bypassed)
  const effect = resolve(temporary, `${AUKORA_RELATIVE}/broker/effect.mjs`)
  const effectOriginal = readFileSync(effect, 'utf8')
  const effectChanged = effectOriginal.replace("from 'node:fs'", "from 'fs'")
  bareFsApplied = effectOriginal.split("from 'node:fs'").length === 2 && effectChanged !== effectOriginal
  if (bareFsApplied) writeFileSync(effect, effectChanged)
  const canonical = resolve(temporary, `${AUKORA_RELATIVE}/kernel-seed/canonical-json.mjs`)
  appendFileSync(canonical, "\nprocess.getBuiltinModule('fs')\n")
  builtinModuleApplied = readFileSync(canonical, 'utf8').endsWith("\nprocess.getBuiltinModule('fs')\n")
  const governed = resolve(temporary, 'packages/governed')
  const escapedGoverned = resolve(temporary, 'escaped-governed')
  cpSync(governed, escapedGoverned, { recursive: true })
  rmSync(governed, { recursive: true })
  symlinkSync(escapedGoverned, governed, 'dir')
  ancestorSymlinkApplied = lstatSync(governed).isSymbolicLink()
  mutantGraph = importGraph({ root: temporary })
} finally {
  rmSync(temporary, { recursive: true, force: true })
}

const mutantRows = grade(mutantGraph)
const mutantBreaches = sorted(mutantRows.filter((result) => result.breach).map((result) => result.n))
const expectedBreaches = sorted(EXPECTED_MUTATION_BREACHES)
const effectReached = mutantGraph.nodes.some((node) => node.path === 'aukora/broker/effect.mjs')
const cellReachedNormally = normalGraph.nodes.some((node) => node.path === 'aukora/guest/wasm-proposal-cell.mjs')
const cellReachedAfterBypass = mutantGraph.nodes.some((node) => node.path === 'aukora/guest/wasm-proposal-cell.mjs')
const fsReached = mutantGraph.runtimeEdges.some((edge) => canonicalBuiltin(edge.specifier) === 'node:fs')
  || mutantGraph.dynamicEdges.some((edge) => canonicalBuiltin(edge.specifier) === 'node:fs')
const matched = same(mutantBreaches, expectedBreaches)
const detected = applied && bareFsApplied && builtinModuleApplied && ancestorSymlinkApplied
  && cellBypassApplied && normalHeld && effectReached && fsReached
  && cellReachedNormally && !cellReachedAfterBypass && matched
printRows(mutantRows)
console.log(`\n  MUTATION definition import rewire and cell bypass  applied=${applied} effectReached=${effectReached}`
  + ` bareFsApplied=${bareFsApplied} builtinModuleApplied=${builtinModuleApplied}`
  + ` ancestorSymlinkApplied=${ancestorSymlinkApplied} cellBypassApplied=${cellBypassApplied}`
  + ` cellReachedNormally=${cellReachedNormally} cellReachedAfterBypass=${cellReachedAfterBypass}`
  + ` fsReached=${fsReached} normalHeld=${normalHeld}`
  + ` expectedBreaches=[${expectedBreaches.join(' ')}] matched=${matched}  ${detected ? 'DETECTED' : 'NOT DETECTED'}\n`)
process.exit(detected ? 0 : 1)
