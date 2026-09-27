/**
 * courts/harness/wasm-proposal-cell — one import-pinned guest cell.
 *
 * The pinned module can invoke one host callback. Same-inventory probes exercise
 * the callback's bounds, UTF-8, JSON, and canonicalization checks. A separate
 * probe requesting WASI `fd_write` fails to link when given the production
 * import table, while a positive control proves that widening the table enables
 * the call.
 *
 * This court measures one WebAssembly module. It does not claim that Cordis,
 * the Node embedder, broker, issuer, or the rest of the product is confined.
 *
 *   node courts/harness/wasm-proposal-cell/run.mjs
 *   node courts/harness/wasm-proposal-cell/run.mjs --mutate
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  MEMORY_PUT_PROPOSAL_WASM_SHA256,
  proposeMemoryPutInWasm,
} from '../../../aukora/guest/wasm-proposal-cell.mjs'

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--mutate')) {
  console.error('usage: node courts/harness/wasm-proposal-cell/run.mjs [--mutate]')
  process.exit(2)
}
const MUTATE = args[0] === '--mutate'
const AMBIENT_PROBE_BASE64 = 'AGFzbQEAAAABDQJgBH9/f38Bf2AAAX8CIwEWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MQhmZF93cml0ZQAAAwIBAQcNAQl0cnlfd3JpdGUAAQoOAQwAQQFBAEEAQQAQAAs='
const AMBIENT_PROBE_SHA256 = 'fbdd00cdc2463459a02d09f395639ee9e01f47de82f84d7bce8c3a574a9c5a3f'
const AMBIENT_IMPORT_BASE64 = 'AGFzbQEAAAABCQFgBH9/f38BfwI/AhZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxCGZkX3dyaXRlAAAGYXVrb3JhEnByb3Bvc2VfbWVtb3J5X3B1dAAAAwIBAAUEAQEBAQcXAgZtZW1vcnkCAAptZW1vcnlfcHV0AAIKGQEXAEEBQQBBAEEAEAAaIAAgASACIAMQAQs='
const AMBIENT_IMPORT_SHA256 = '13f993d6a6c392f2d8e7184444216fdb78543ae9804b547587159481c7d43be9'
const PROBES = Object.freeze({
  range: {
    base64: 'AGFzbQEAAAABCQFgBH9/f38BfwIdAQZhdWtvcmEScHJvcG9zZV9tZW1vcnlfcHV0AAADAgEABQQBAQEBBxcCBm1lbW9yeQIACm1lbW9yeV9wdXQAAQoQAQ4AQYCABEEBIAIgAxAACw==',
    sha256: '7baa47a1faf71233146455197542f0c59ec2b12caa568238e22ca86f05b1e26f',
  },
  utf8: {
    base64: 'AGFzbQEAAAABCQFgBH9/f38BfwIdAQZhdWtvcmEScHJvcG9zZV9tZW1vcnlfcHV0AAADAgEABQQBAQEBBxcCBm1lbW9yeQIACm1lbW9yeV9wdXQAAQoPAQ0AIAAgAUGACEEDEAALCwoBAEGACAsDIv8i',
    sha256: '11af1bf829307ee9f99eb9f6bc0639ecf01b5373816aa5bc833b206350da8ef1',
  },
  json: {
    base64: 'AGFzbQEAAAABCQFgBH9/f38BfwIdAQZhdWtvcmEScHJvcG9zZV9tZW1vcnlfcHV0AAADAgEABQQBAQEBBxcCBm1lbW9yeQIACm1lbW9yeV9wdXQAAQoPAQ0AIAAgAUGACEEBEAALCwgBAEGACAsBeA==',
    sha256: 'b0aac63560dd7239978997f9389a71b8bb7e9868ba7567678b7befa571a63edb',
  },
  canonical: {
    base64: 'AGFzbQEAAAABCQFgBH9/f38BfwIdAQZhdWtvcmEScHJvcG9zZV9tZW1vcnlfcHV0AAADAgEABQQBAQEBBxcCBm1lbW9yeQIACm1lbW9yeV9wdXQAAQoPAQ0AIAAgAUGACEEFEAALCwwBAEGACAsFdHJ1ZSA=',
    sha256: '9c65776fc1e6b398f637fb8b5b49f7d388fd228c661c49ad652ecb78221fdf49',
  },
})
const WAT_SOURCE_SHA256 = Object.freeze({
  'ambient-import-mutation.wat': '84b83c345ffa9c4e4b95387bec2903d3fca06399b43e473a0c03c81332ba2faa',
  'ambient-write-probe.wat': 'f22436c88ad9259993a2b168d8e3426a640d2c6391b95b58103f2efe0983cef4',
  'invalid-json-probe.wat': 'e6457e5e90c2aa49f636500528d77db8b81bb280a072a8d424fa71f6ab2946ca',
  'invalid-range-probe.wat': '6349169fd8fca6a9d8dc2a1d5cf7b39dd6974ffcb2662ad7cb785fcfd96af40b',
  'invalid-utf8-probe.wat': '18c39e42bacc0a27eae549cbf07f50308cafb8799634f9388606a40a727c3948',
  'memory-put-proposal.wat': 'd73e8d223973e03d24a48c4ab3b035e9505375b0cc2a29e65a233af20cc807d8',
  'noncanonical-json-probe.wat': '6a0207c3755797174cabe3637a9977bf46d7a2e1ba7ca02835d62aca44a0067d',
})
const AMBIENT_MARKER = Symbol.for('aukora.wasm.mutation.ambient-called')
const ALLOWED_EFFECT_MARKER = Symbol.for('aukora.wasm.mutation.allowed-import-effect')
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CELL_SOURCE = join(ROOT, 'aukora', 'guest', 'wasm-proposal-cell.mjs')
const WAT_ROOT = join(ROOT, 'aukora', 'guest', 'wasm')
const EXPECTED_ROWS = [
  'W0.sources',
  'W1.proposal',
  'W2.determinism',
  'W3.exact',
  'W4.key',
  'W5.size',
  'W6.absent-namespace',
  'W7.absent-import',
  'W8.widening-control',
  'W9.range',
  'W10.utf8',
  'W11.json',
  'W12.canonical',
]
const rows = []

const watSourcesPinned = Object.entries(WAT_SOURCE_SHA256).every(([name, expected]) => {
  const bytes = readFileSync(join(WAT_ROOT, name))
  return createHash('sha256').update(bytes).digest('hex') === expected
})
const probeModulesPinned = Object.values(PROBES).every(({ base64, sha256 }) =>
  createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex') === sha256)
row('W0.sources', 'WAT source bytes and counterfactual modules remain pinned', {
  sources: Object.keys(WAT_SOURCE_SHA256).length,
  watSourcesPinned,
  probeModulesPinned,
}, { sources: 7, watSourcesPinned: true, probeModulesPinned: true })

const first = proposeMemoryPutInWasm({
  key: 'rainbow.bridge',
  value: { nested: true, move: 37 },
})
row('W1.proposal', 'the host returns exact bytes after the cell invokes its import', {
  toolName: first.toolName,
  argumentsJson: first.argumentsJson,
  modulePinned: first.moduleSha256 === MEMORY_PUT_PROPOSAL_WASM_SHA256,
}, {
  toolName: 'memory.put',
  argumentsJson: '{"key":"rainbow.bridge","value":{"move":37,"nested":true}}',
  modulePinned: true,
})

const second = proposeMemoryPutInWasm({
  key: 'rainbow.bridge',
  value: { move: 37, nested: true },
})
row('W2.determinism', 'equivalent objects produce identical proposal bytes', {
  identical: second.argumentsJson === first.argumentsJson,
}, { identical: true })

let exactReason = null
try {
  proposeMemoryPutInWasm({ key: 'valid', value: true, rider: 'hidden' })
} catch (error) {
  exactReason = String(error?.message ?? error)
}
row('W3.exact', 'extra argument riders refuse before instantiation',
  { reason: exactReason }, { reason: 'wasm-cell: arguments-not-exact' })

let keyReason = null
try {
  proposeMemoryPutInWasm({ key: '../ambient', value: true })
} catch (error) {
  keyReason = String(error?.message ?? error)
}
row('W4.key', 'path-like memory keys refuse before instantiation',
  { reason: keyReason }, { reason: 'wasm-cell: key-not-a-name' })

let sizeReason = null
try {
  proposeMemoryPutInWasm({ key: 'large', value: 'x'.repeat(65_536) })
} catch (error) {
  sizeReason = String(error?.message ?? error)
}
row('W5.size', 'a proposal larger than fixed linear memory refuses',
  { reason: sizeReason }, { reason: 'wasm-cell: proposal-too-large' })

const probeBytes = Buffer.from(AMBIENT_PROBE_BASE64, 'base64')
const probeDigest = createHash('sha256').update(probeBytes).digest('hex')
const probe = new WebAssembly.Module(probeBytes)
const probeImports = WebAssembly.Module.imports(probe)
let absentNamespaceRefused = false
let absentNamespaceReason = null
try {
  new WebAssembly.Instance(probe, {
    aukora: { propose_memory_put: () => 1 },
  })
} catch (error) {
  absentNamespaceRefused = error instanceof TypeError
  absentNamespaceReason = error?.constructor?.name ?? null
}
row('W6.absent-namespace', 'an unprovided WASI namespace refuses instantiation', {
  probePinned: probeDigest === AMBIENT_PROBE_SHA256,
  imports: probeImports,
  refused: absentNamespaceRefused,
  reason: absentNamespaceReason,
}, {
  probePinned: true,
  imports: [{ module: 'wasi_snapshot_preview1', name: 'fd_write', kind: 'function' }],
  refused: true,
  reason: 'TypeError',
})

let absentImportRefused = false
let absentImportReason = null
try {
  new WebAssembly.Instance(probe, { wasi_snapshot_preview1: {} })
} catch (error) {
  absentImportRefused = error instanceof WebAssembly.LinkError
  absentImportReason = error?.constructor?.name ?? null
}
row('W7.absent-import', 'an absent function in a known namespace fails to link', {
  refused: absentImportRefused,
  reason: absentImportReason,
}, { refused: true, reason: 'LinkError' })

let widenedCalled = false
const widened = new WebAssembly.Instance(probe, {
  wasi_snapshot_preview1: {
    fd_write() {
      widenedCalled = true
      return 0
    },
  },
})
const widenedResult = widened.exports.try_write()
row('W8.widening-control', 'supplying the missing import enables the same probe', {
  called: widenedCalled,
  result: widenedResult,
}, { called: true, result: 0 })

const invalidRange = await invokeCellCopy(PROBES.range, { key: 'range', value: true })
row('W9.range', 'a same-inventory module cannot read beyond linear memory', {
  sourceApplied: invalidRange.sourceApplied,
  reason: invalidRange.reason,
}, { sourceApplied: true, reason: 'wasm-cell: key-range-invalid' })

const invalidUtf8 = await invokeCellCopy(PROBES.utf8, { key: 'utf8', value: true })
row('W10.utf8', 'a same-inventory module cannot propose invalid UTF-8', {
  sourceApplied: invalidUtf8.sourceApplied,
  reason: invalidUtf8.reason,
}, { sourceApplied: true, reason: 'wasm-cell: value-utf8-invalid' })

const invalidJson = await invokeCellCopy(PROBES.json, { key: 'json', value: true })
row('W11.json', 'a same-inventory module cannot propose invalid JSON', {
  sourceApplied: invalidJson.sourceApplied,
  reason: invalidJson.reason,
}, { sourceApplied: true, reason: 'wasm-cell: value-json-invalid' })

const noncanonicalJson = await invokeCellCopy(PROBES.canonical, { key: 'canonical', value: true })
row('W12.canonical', 'a same-inventory module cannot propose noncanonical JSON', {
  sourceApplied: noncanonicalJson.sourceApplied,
  reason: noncanonicalJson.reason,
}, { sourceApplied: true, reason: 'wasm-cell: value-json-not-canonical' })

console.log('\n  courts/harness/wasm-proposal-cell — import-pinned WebAssembly guest\n  ' + '-'.repeat(72))
for (const result of rows) {
  console.log(`  ${result.n}  ${result.label.padEnd(58)} ${held(result) ? 'held' : '*** BREACH ***'}`
    + `  ${JSON.stringify(result.observed)}`)
}
const rowsHeld = rowsAreExact() && rows.every(held)
if (MUTATE) {
  const inventory = await runImportInventoryMutation()
  const validation = await runHostValidationMutations()
  const allowedEffect = await runAllowedImportEffectMutation()
  const mutationConfirmed = rowsHeld
    && inventory.sourceApplied
    && inventory.controlRefused
    && inventory.widenedModuleAdmitted
    && inventory.ambientCalled
    && validation.sourceApplied
    && validation.rangeDiagnosticLost
    && validation.invalidUtf8Admitted
    && validation.jsonDiagnosticLost
    && validation.noncanonicalAdmitted
    && allowedEffect.sourceApplied
    && allowedEffect.effectReached
  console.log(`\n  MUTATION wasm import and host validation controls  inventoryApplied=${inventory.sourceApplied}`
    + ` controlRefused=${inventory.controlRefused}`
    + ` widenedModuleAdmitted=${inventory.widenedModuleAdmitted}`
    + ` ambientCalled=${inventory.ambientCalled}`
    + ` validationApplied=${validation.sourceApplied}`
    + ` rangeDiagnosticLost=${validation.rangeDiagnosticLost}`
    + ` invalidUtf8Admitted=${validation.invalidUtf8Admitted}`
    + ` jsonDiagnosticLost=${validation.jsonDiagnosticLost}`
    + ` noncanonicalAdmitted=${validation.noncanonicalAdmitted}`
    + ` allowedEffectApplied=${allowedEffect.sourceApplied}`
    + ` allowedEffectReached=${allowedEffect.effectReached}`
    + ` ordinaryRowsHeld=${rowsHeld}`
    + `  ${mutationConfirmed ? 'DETECTED' : 'NOT DETECTED'}\n`)
  process.exitCode = mutationConfirmed ? 0 : 1
} else {
  console.log(`\n  rowsComplete=${rowsAreExact()} expected=${EXPECTED_ROWS.length} observed=${rows.length}`)
  console.log('  observationClass: WASM-IMPORT-INVENTORY-PINNED / ALLOWED-HOST-CALLBACK-AUDITED / NODE-EMBEDDER-UNCONFINED\n')
  process.exitCode = rowsHeld ? 0 : 1
}

/** Prove the production import-inventory refusal is load-bearing. */
async function runImportInventoryMutation() {
  const directory = mkdtempSync(join(tmpdir(), 'aukora-wasm-import-mutation-'))
  try {
    const source = readFileSync(CELL_SOURCE, 'utf8')
    const brokerUrl = pathToFileURL(join(ROOT, 'aukora', 'broker', 'memory-put-args.mjs')).href
    const canonicalUrl = pathToFileURL(join(ROOT, 'aukora', 'kernel-seed', 'canonical-json.mjs')).href
    const importGuard = `  if (JSON.stringify(WebAssembly.Module.imports(module)) !== JSON.stringify(EXPECTED_IMPORTS)) {\n    throw new Error('wasm-cell: import-inventory-mismatch')\n  }`
    const importTableAnchor = `  const imports = {\n    aukora: {`
    const widenedImportTable = `  const imports = {\n    wasi_snapshot_preview1: {\n      fd_write() {\n        globalThis[Symbol.for('aukora.wasm.mutation.ambient-called')] = true\n        return 0\n      },\n    },\n    aukora: {`
    const replacements = [
      [source, "'../broker/memory-put-args.mjs'", `'${brokerUrl}'`],
      [null, "'../kernel-seed/canonical-json.mjs'", `'${canonicalUrl}'`],
      [null, /const MODULE_BASE64 = '[^']+'/u, `const MODULE_BASE64 = '${AMBIENT_IMPORT_BASE64}'`],
      [null, /export const MEMORY_PUT_PROPOSAL_WASM_SHA256 = '[0-9a-f]{64}'/u,
        `export const MEMORY_PUT_PROPOSAL_WASM_SHA256 = '${AMBIENT_IMPORT_SHA256}'`],
      [null, importTableAnchor, widenedImportTable],
    ]
    let controlSource = source
    let sourceApplied = true
    for (const [, needle, replacement] of replacements) {
      const matches = typeof needle === 'string'
        ? controlSource.split(needle).length - 1
        : [...controlSource.matchAll(new RegExp(needle.source, `${needle.flags}g`))].length
      sourceApplied &&= matches === 1
      controlSource = controlSource.replace(needle, replacement)
    }
    sourceApplied &&= controlSource.split(importGuard).length - 1 === 1

    const controlPath = join(directory, 'control-cell.mjs')
    const mutantPath = join(directory, 'mutant-cell.mjs')
    writeFileSync(controlPath, controlSource, 'utf8')
    writeFileSync(mutantPath, controlSource.replace(importGuard, '  void EXPECTED_IMPORTS'), 'utf8')

    delete globalThis[AMBIENT_MARKER]
    let controlRefused = false
    try {
      const control = await import(`${pathToFileURL(controlPath).href}?control`)
      control.proposeMemoryPutInWasm({ key: 'inventory.control', value: true })
    } catch (error) {
      controlRefused = String(error?.message ?? error) === 'wasm-cell: import-inventory-mismatch'
        && globalThis[AMBIENT_MARKER] !== true
    }

    let widenedModuleAdmitted = false
    let ambientCalled = false
    try {
      const mutant = await import(`${pathToFileURL(mutantPath).href}?mutant`)
      const proposal = mutant.proposeMemoryPutInWasm({ key: 'inventory.mutant', value: true })
      widenedModuleAdmitted = proposal.moduleSha256 === AMBIENT_IMPORT_SHA256
        && proposal.argumentsJson === '{"key":"inventory.mutant","value":true}'
      ambientCalled = globalThis[AMBIENT_MARKER] === true
    } catch {
      // Admission must complete before this counterfactual is detected.
    }
    return { sourceApplied, controlRefused, widenedModuleAdmitted, ambientCalled }
  } finally {
    delete globalThis[AMBIENT_MARKER]
    rmSync(directory, { recursive: true, force: true })
  }
}

/** Prove the host checks reject hostile spans from modules with the allowed inventory. */
async function runHostValidationMutations() {
  const range = await invokeCellCopy(PROBES.range, { key: 'range', value: true }, [[
    "  if (offset + length > memory.buffer.byteLength) throw new Error(`wasm-cell: ${label}-range-invalid`)",
    '  void memory.buffer.byteLength',
  ]])
  const utf8Mutation = await invokeCellCopy(PROBES.utf8, { key: 'utf8', value: true }, [[
    "const utf8 = new TextDecoder('utf-8', { fatal: true })",
    "const utf8 = new TextDecoder('utf-8')",
  ]])
  const jsonMutation = await invokeCellCopy(PROBES.json, { key: 'json', value: true }, [[
    "        let value\n        try {\n          value = JSON.parse(encodedValue)\n        } catch {\n          throw new Error('wasm-cell: value-json-invalid')\n        }",
    '        const value = JSON.parse(encodedValue)',
  ]])
  const canonicalMutation = await invokeCellCopy(PROBES.canonical, { key: 'canonical', value: true }, [[
    "        if (canonicalJSON(value) !== encodedValue) {\n          throw new Error('wasm-cell: value-json-not-canonical')\n        }",
    '        void encodedValue',
  ]])
  return {
    sourceApplied: [range, utf8Mutation, jsonMutation, canonicalMutation].every(result => result.sourceApplied),
    rangeDiagnosticLost: range.reason === 'wasm-cell: key-utf8-invalid',
    invalidUtf8Admitted: utf8Mutation.proposal?.argumentsJson === '{"key":"utf8","value":"�"}',
    jsonDiagnosticLost: jsonMutation.errorName === 'SyntaxError'
      && jsonMutation.reason !== 'wasm-cell: value-json-invalid',
    noncanonicalAdmitted: canonicalMutation.proposal?.argumentsJson === '{"key":"canonical","value":true}',
  }
}

/** Demonstrate that import inventory cannot make an effectful allowed callback inert. */
async function runAllowedImportEffectMutation() {
  delete globalThis[ALLOWED_EFFECT_MARKER]
  try {
    const result = await invokeCellCopy(null, { key: 'allowed.effect', value: true }, [[
      '      propose_memory_put(keyOffset, keyLength, valueOffset, valueLength) {',
      "      propose_memory_put(keyOffset, keyLength, valueOffset, valueLength) {\n        globalThis[Symbol.for('aukora.wasm.mutation.allowed-import-effect')] = true",
    ]])
    return {
      sourceApplied: result.sourceApplied,
      effectReached: globalThis[ALLOWED_EFFECT_MARKER] === true
        && result.proposal?.argumentsJson === '{"key":"allowed.effect","value":true}',
    }
  } finally {
    delete globalThis[ALLOWED_EFFECT_MARKER]
  }
}

/** Invoke one temporary cell source copy with optional module and source mutations. */
async function invokeCellCopy(probe, callArgs, sourceMutations = []) {
  const directory = mkdtempSync(join(tmpdir(), 'aukora-wasm-cell-copy-'))
  try {
    const brokerUrl = pathToFileURL(join(ROOT, 'aukora', 'broker', 'memory-put-args.mjs')).href
    const canonicalUrl = pathToFileURL(join(ROOT, 'aukora', 'kernel-seed', 'canonical-json.mjs')).href
    const replacements = [
      ["'../broker/memory-put-args.mjs'", `'${brokerUrl}'`],
      ["'../kernel-seed/canonical-json.mjs'", `'${canonicalUrl}'`],
      ...(probe === null ? [] : [
        [/const MODULE_BASE64 = '[^']+'/u, `const MODULE_BASE64 = '${probe.base64}'`],
        [/export const MEMORY_PUT_PROPOSAL_WASM_SHA256 = '[0-9a-f]{64}'/u,
          `export const MEMORY_PUT_PROPOSAL_WASM_SHA256 = '${probe.sha256}'`],
      ]),
      ...sourceMutations,
    ]
    let source = readFileSync(CELL_SOURCE, 'utf8')
    let sourceApplied = true
    for (const [needle, replacement] of replacements) {
      const replaced = replaceSourceOnce(source, needle, replacement)
      sourceApplied &&= replaced.applied
      source = replaced.source
    }
    const cellPath = join(directory, 'cell.mjs')
    writeFileSync(cellPath, source, 'utf8')
    let proposal = null
    let reason = null
    let errorName = null
    try {
      const cell = await import(pathToFileURL(cellPath).href)
      proposal = cell.proposeMemoryPutInWasm(callArgs)
    } catch (error) {
      reason = String(error?.message ?? error)
      errorName = error?.constructor?.name ?? null
    }
    return { sourceApplied, proposal, reason, errorName }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** Replace one exact source occurrence. */
function replaceSourceOnce(source, needle, replacement) {
  const matches = typeof needle === 'string'
    ? source.split(needle).length - 1
    : [...source.matchAll(new RegExp(needle.source, `${needle.flags}g`))].length
  return {
    applied: matches === 1,
    source: source.replace(needle, replacement),
  }
}

/** Add one result row. */
function row(n, label, observed, expected) {
  rows.push({ n, label, observed, expected })
}

/** Compare one row's deterministic payload. */
function held(result) {
  return JSON.stringify(result.observed) === JSON.stringify(result.expected)
}

/** Require the exact expected row set. */
function rowsAreExact() {
  const names = rows.map((result) => result.n)
  return names.length === EXPECTED_ROWS.length
    && new Set(names).size === names.length
    && EXPECTED_ROWS.every((name) => names.includes(name))
}
