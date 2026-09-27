#!/usr/bin/env node
/**
 * Regenerate the runnable ESM of the vendored @aukora/evidence from its verbatim upstream sources, and
 * rewrite PROVENANCE.json from the bytes on disk.
 *
 *   node vendor/aukora-evidence/transpile.mjs [--typescript <path to typescript/lib/typescript.js>]
 *
 * Genesis-authored, after vendor/aukora-kernel/transpile.mjs. `src/*.ts` and `test/*.ts` (verbatim from
 * aumara-xyz/aukora packages/evidence at def297f, each taken with `git show def297f:<path>`) are type-stripped
 * with the TypeScript compiler Genesis already carries in vendor/dsh, using `transpileModule` and the upstream
 * packages/evidence/tsconfig.json options that affect emit. Type stripping only: no logic is rewritten.
 *
 * The one change to emitted bytes is IMPORT SPECIFIERS, because Node ESM needs a file name and upstream writes
 * extensionless relative imports (bundler resolution):
 *   - `./<name>` becomes `./<name>.js` when lib/<name>.js is one of the emitted files;
 *   - in the upstream tests only, `vitest` resolves to ../vitest-shim.mjs and `../src/<name>` to `../lib/<name>.js`.
 * Each rewrite is recorded per file in PROVENANCE.json. Anything else that is not `node:` is refused. The package
 * imports nothing outside itself except `node:crypto`, so there is no dependency closure to carry.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const flag = process.argv.indexOf('--typescript')
const tsPath = flag === -1 ? join(ROOT, 'vendor', 'dsh', 'node_modules', 'typescript', 'lib', 'typescript.js') : resolve(process.argv[flag + 1])
const ts = createRequire(import.meta.url)(tsPath)

const COMMIT = 'def297fc146bf3c448df4d0f4e78358d65345436'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const gitBlob = (bytes) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex')
const rel = (path) => relative(HERE, path).split('\\').join('/')

// The upstream packages/evidence/tsconfig.json options that change emitted JavaScript. That tsconfig does NOT set
// verbatimModuleSyntax, and the sources import interfaces with plain `import { … }` (index.ts, validate.ts), so
// those imports must be erased as TypeScript itself erases them, not kept as runtime imports of names that do not
// exist. `strict`, `lib`, `types`, `noEmit`, `skipLibCheck` and `moduleResolution` only affect type checking.
const COMPILER_OPTIONS = { target: 'ES2022', module: 'ESNext', verbatimModuleSyntax: false, esModuleInterop: true }

const srcFiles = readdirSync(join(HERE, 'src')).filter((name) => name.endsWith('.ts')).sort()
const testFiles = readdirSync(join(HERE, 'test')).filter((name) => /\.test\.ts$/u.test(name)).sort()
const libOutputs = new Set(srcFiles.map((name) => name.replace(/\.ts$/u, '')))

/** Rewrite every static and dynamic import/export specifier in emitted JavaScript; refuse anything unmapped. */
function rewriteSpecifiers(code, outPath, isTest) {
  const ast = ts.createSourceFile(outPath, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  const edits = []
  function rewrite(literal) {
    const spec = literal.text
    let to
    if (spec.startsWith('node:')) return
    if (isTest && spec === 'vitest') to = '../vitest-shim.mjs'
    else if (isTest && spec.startsWith('../src/') && libOutputs.has(spec.slice('../src/'.length))) to = `../lib/${spec.slice('../src/'.length)}.js`
    else if (!isTest && spec.startsWith('./') && libOutputs.has(spec.slice(2))) to = `${spec}.js`
    else throw new Error(`${rel(outPath)}: unmapped specifier ${spec}`)
    const start = literal.getStart(ast)
    const from = code.slice(start, literal.end)
    const quote = from[0]
    edits.push({ start, end: literal.end, from, to: `${quote}${to}${quote}` })
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) rewrite(node.moduleSpecifier)
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) throw new Error(`${rel(outPath)}: nonliteral dynamic import`)
      rewrite(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  let out = code
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.to + out.slice(edit.end)
  return { out, rewrites: edits.map(({ from, to }) => ({ from, to })) }
}

function emit(inPath, outPath, isTest) {
  const result = ts.transpileModule(readFileSync(inPath, 'utf8'), {
    fileName: inPath,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: false, esModuleInterop: true },
  })
  if (result.diagnostics.length > 0) {
    throw new Error(`${rel(inPath)}: ${result.diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`)
  }
  const { out, rewrites } = rewriteSpecifiers(result.outputText, outPath, isTest)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, out)
  const bytes = Buffer.from(out, 'utf8')
  return { path: rel(outPath), from: rel(inPath), transpiled: true, sha256: sha256(bytes), bytes: bytes.length, specifierRewrites: rewrites }
}

const verbatim = (path, upstreamPath) => {
  const bytes = readFileSync(join(HERE, path))
  return { path, upstreamPath, gitBlob: gitBlob(bytes), sha256: sha256(bytes), bytes: bytes.length }
}

const upstream = [
  verbatim('LICENSE', 'LICENSE'),
  verbatim('NOTICE', 'NOTICE'),
  ...srcFiles.map((name) => verbatim(`src/${name}`, `packages/evidence/src/${name}`)),
  ...testFiles.map((name) => verbatim(`test/${name}`, `packages/evidence/test/${name}`)),
]
const generated = [
  ...srcFiles.map((name) => emit(join(HERE, 'src', name), join(HERE, 'lib', name.replace(/\.ts$/u, '.js')), false)),
  ...testFiles.map((name) => emit(join(HERE, 'test', name), join(HERE, 'lib-test', name.replace(/\.ts$/u, '.js')), true)),
]

const provenance = {
  domain: 'aukora:evidence-pin:v1',
  package: { name: '@aukora/evidence', version: '0.1.0', license: 'AGPL-3.0-or-later', licenseFile: 'LICENSE' },
  source: {
    repository: 'github.com/aumara-xyz/aukora',
    commit: COMMIT,
    path: 'packages/evidence',
    taken: 'git show def297f:<path>, one file at a time, from the local read-only clone ~/aukora-great-merge/clones/aukora; no network',
    license: 'packages/evidence carries no LICENSE or NOTICE of its own at def297f (its package.json `files` names them, the tree '
      + 'does not); LICENSE and NOTICE are the repository root files at the same commit. LICENSE is the same blob as '
      + 'vendor/aukora-kernel/LICENSE.',
    alsoAt: 'vendor/aukora-seed-app/src/packages/evidence carries 7 of these 10 src files (the index.ts closure) and none of '
      + 'the tests, as part of the seed-app closure. Same upstream commit, same blobs.',
  },
  upstream,
  transpile: {
    command: 'node vendor/aukora-evidence/transpile.mjs --typescript <Genesis vendor/dsh>/node_modules/typescript/lib/typescript.js',
    compiler: `typescript ${ts.version} (ts.transpileModule; type stripping only)`,
    compilerOptions: COMPILER_OPTIONS,
    rule: 'emitted bytes are exactly the compiler output except import specifiers, each listed under specifierRewrites',
  },
  generated,
  dependencies: [{ specifier: 'node:crypto', use: 'createHash (sha256) in digest.ts, swarmRunEvidenceV1.ts, agreEvidenceAdapterV1.ts' }],
  dependencyNote: 'The package imports only node:crypto and its own files. No @noble package, no curve, no new crypto implementation.',
  genesisAuthored: ['package.json', 'transpile.mjs', 'vitest-shim.mjs', 'conformance.mjs', 'PROVENANCE.json'],
  notVendored: ['package.json (upstream)', 'tsconfig.json', 'vitest.config.ts'],
  conformance: {
    command: 'node vendor/aukora-evidence/conformance.mjs',
    expectedCases: 178,
    upstreamMeasurement: 'bun 1.3.14, `bun test ./test` in a scratch copy of packages/evidence at def297f (git archive): 178 pass / 0 fail, 585 expect() calls (2026-09-27)',
    testFiles: generated.filter((file) => file.path.startsWith('lib-test/')).map((file) => file.path),
  },
}
writeFileSync(join(HERE, 'PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`)
process.stdout.write(`typescript ${ts.version}: ${String(generated.length)} files emitted, ${String(generated.reduce((n, f) => n + f.specifierRewrites.length, 0))} specifier rewrites\n`)
