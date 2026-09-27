#!/usr/bin/env node
/**
 * Regenerate the runnable ESM of the vendored @aukora/memory (aumara-xyz/aukora packages/memory @ def297f) from its
 * verbatim upstream sources, and record what was generated in PROVENANCE.json.
 *
 *   node vendor/aukora-packages/transpile.mjs [--typescript <path to typescript/lib/typescript.js>]
 *
 * Genesis-authored, modelled on vendor/aukora-kernel/transpile.mjs and vendor/aukora-seed-app/transpile.mjs. Genesis
 * runs Node ESM, not TypeScript, so `src/packages/memory/index.ts` and `src/packages/memory/src/*.ts` are type-stripped
 * with `ts.transpileModule` under the emit-affecting options of the package's own tsconfig.json (target ES2022, module
 * ESNext, esModuleInterop). Type stripping only: no logic is rewritten, and the verbatim `src/` is never touched.
 *
 * The one change to emitted bytes is IMPORT SPECIFIERS, because this tree has no install step:
 *   - `@aukora/kernel/canonical` and `@aukora/kernel/staleness` resolve to the vendored kernel's own generated
 *     `vendor/aukora-kernel/lib/{canonical,staleness}.js` (the same aumara-xyz/aukora commit, def297f).
 * Each rewrite is recorded per file in PROVENANCE.json under `generated[].specifierRewrites`. Any bare specifier left
 * over is refused, and the verbatim sources are checked against their existing pins before anything is emitted.
 *
 * Only packages/memory is generated. packages/council and apps/brain stay source-only (nothing in Genesis calls them).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const flag = process.argv.indexOf('--typescript')
const tsPath = flag === -1 ? join(ROOT, 'vendor', 'dsh', 'node_modules', 'typescript', 'lib', 'typescript.js') : resolve(process.argv[flag + 1])
const ts = createRequire(import.meta.url)(tsPath)

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const rel = (path) => relative(HERE, path).split('\\').join('/')
const provenancePath = join(HERE, 'PROVENANCE.json')
const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'))

// The emit-affecting options of src/packages/memory/tsconfig.json. `strict`, `lib`, `types`, `noEmit`, `skipLibCheck`
// and `moduleResolution` only affect type checking, which transpileModule does not do.
const COMPILER_OPTIONS = { target: 'ES2022', module: 'ESNext', esModuleInterop: true }

// Refuse to regenerate from originals whose bytes no longer match the import manifest.
for (const file of provenance.files) {
  const bytes = readFileSync(join(HERE, file.path))
  if (sha256(bytes) !== file.sha256 || bytes.length !== file.bytes) throw new Error(`upstream bytes changed: ${file.path}`)
}

const PACKAGE = join(HERE, 'src', 'packages', 'memory')
const KERNEL = {
  '@aukora/kernel/canonical': join(ROOT, 'vendor', 'authority', 'lib', 'canonical.js'),
  '@aukora/kernel/staleness': join(ROOT, 'vendor', 'authority', 'lib', 'staleness.js'),
}
const sources = [join(PACKAGE, 'index.ts'), ...readdirSync(join(PACKAGE, 'src')).filter((name) => name.endsWith('.ts')).sort().map((name) => join(PACKAGE, 'src', name))]
const pinned = new Set(provenance.files.map((file) => resolve(HERE, file.path)))
for (const path of sources) if (!pinned.has(path)) throw new Error(`unmeasured upstream file: ${rel(path)}`)
const outFor = (path) => join(HERE, 'lib', relative(join(HERE, 'src'), path).replace(/\.ts$/u, '.js'))
const outputs = new Set(sources.map(outFor))

/** Rewrite every module specifier in emitted JS (static, re-export and dynamic); refuse an unmapped bare one. */
function rewriteSpecifiers(code, outPath) {
  const ast = ts.createSourceFile(outPath, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  const edits = []
  function rewrite(literal) {
    const specifier = literal.text
    let target
    if (Object.hasOwn(KERNEL, specifier)) {
      target = relative(dirname(outPath), KERNEL[specifier]).split('\\').join('/')
      if (!target.startsWith('.')) target = `./${target}`
    } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
      if (!outputs.has(resolve(dirname(outPath), specifier))) throw new Error(`${rel(outPath)}: unresolved relative import ${specifier}`)
      return
    } else if (specifier.startsWith('node:')) {
      return
    } else {
      throw new Error(`${rel(outPath)}: unmapped bare specifier ${specifier}`)
    }
    const start = literal.getStart(ast)
    const from = code.slice(start, literal.end)
    edits.push({ start, end: literal.end, from, to: `${from[0]}${target}${from[0]}` })
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) rewrite(node.moduleSpecifier)
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      throw new Error(`${rel(outPath)}: a dynamic import needs an explicit mapping`)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  let out = code
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.to + out.slice(edit.end)
  return { out, rewrites: edits.map(({ from, to }) => ({ from, to })) }
}

const generated = sources.map((path) => {
  const outPath = outFor(path)
  const result = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, esModuleInterop: true },
  })
  if (result.diagnostics.length > 0) {
    throw new Error(`${rel(path)}: ${result.diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`)
  }
  const { out, rewrites } = rewriteSpecifiers(result.outputText, outPath)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, out)
  const bytes = Buffer.from(out, 'utf8')
  return { path: rel(outPath), from: rel(path), transpiled: true, sha256: sha256(bytes), bytes: bytes.length, specifierRewrites: rewrites }
})
for (const target of Object.values(KERNEL)) if (!existsSync(target)) throw new Error(`missing vendored kernel module: ${relative(ROOT, target)}`)

provenance.transpile = {
  command: 'node vendor/aukora-packages/transpile.mjs --typescript <Genesis vendor/dsh>/node_modules/typescript/lib/typescript.js',
  compiler: `typescript ${ts.version} (ts.transpileModule; type stripping only)`,
  compilerOptions: COMPILER_OPTIONS,
  scope: 'src/packages/memory/index.ts and src/packages/memory/src/*.ts only; council, apps/brain and the upstream tests are not generated',
  layout: 'lib/<upstream path under src/>, .ts changed to .js',
  rule: 'emitted bytes are exactly the compiler output except import specifiers, each listed under generated[].specifierRewrites; original src bytes are checked against their existing pins before emit',
  kernel: 'the @aukora/kernel specifiers resolve to vendor/aukora-kernel/lib (aumara-xyz/aukora@def297f packages/kernel, pinned by vendor/aukora-kernel/PROVENANCE.json)',
}
provenance.generated = generated
provenance.generatedDependencies = Object.entries(KERNEL).map(([specifier, path]) => ({
  specifier, resolvesTo: relative(ROOT, path).split('\\').join('/'), sha256: sha256(readFileSync(path)),
}))
provenance.genesisAuthored = ['package.json', 'transpile.mjs'].filter((path) => existsSync(join(HERE, path))).map((path) => {
  const bytes = readFileSync(join(HERE, path))
  return { path, sha256: sha256(bytes), bytes: bytes.length }
})
writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`)
process.stdout.write(`typescript ${ts.version}: ${String(generated.length)} files emitted, ${String(generated.reduce((n, f) => n + f.specifierRewrites.length, 0))} specifier rewrites; ${String(provenance.files.length)} original file pins verified\n`)
