#!/usr/bin/env node
/**
 * Regenerate the runnable ESM of the vendored @aukora/kernel from its verbatim upstream sources, and
 * rewrite PROVENANCE.json from the bytes on disk.
 *
 *   node vendor/authority/transpile.mjs [--typescript <path to typescript/lib/typescript.js>]
 *
 * Genesis-authored. Genesis runs Node ESM, not TypeScript, so `src/*.ts` and `test/*.ts` (verbatim from
 * aumara-xyz/aukora packages/kernel at def297f) are type-stripped with the TypeScript compiler Genesis already
 * carries in vendor/dsh (default path below), using `transpileModule` and the upstream tsconfig.json
 * compilerOptions that affect emit. Type stripping only: no logic is rewritten.
 *
 * The one change to emitted bytes is IMPORT SPECIFIERS, because this tree has no install step:
 *   - `@noble/*` resolves to the exact packages upstream pins (@noble/curves 2.2.0, @noble/hashes 2.2.0,
 *     @noble/post-quantum 0.6.1), carried byte for byte from their integrity-checked npm tarballs in deps/
 *     (deps/PROVENANCE.json pins every file);
 *   - in the upstream tests only, `vitest` resolves to ./vitest-shim.mjs and `../src/*.js` to `../lib/*.js`.
 * Each rewrite is recorded per file in PROVENANCE.json. Any bare specifier left over is refused.
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

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const gitBlob = (bytes) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex')
const rel = (path) => relative(HERE, path).split('\\').join('/')

// The upstream tsconfig.json options that change emitted JavaScript. `strict`, `lib`, `noEmit`, `skipLibCheck` and
// `moduleResolution` only affect type checking, which transpileModule does not do.
const COMPILER_OPTIONS = { target: 'ES2022', module: 'ESNext', verbatimModuleSyntax: true }

// Each specifier goes to the file the pinned package's own `exports` map names for it.
const DEPS = 'vendor/authority/deps/@noble'
const NOBLE = {
  '@noble/hashes/sha2.js': { to: `${DEPS}/hashes@2.2.0/sha2.js`, upstreamPin: '@noble/hashes@2.2.0', vendored: '@noble/hashes@2.2.0' },
  '@noble/hashes/utils.js': { to: `${DEPS}/hashes@2.2.0/utils.js`, upstreamPin: '@noble/hashes@2.2.0', vendored: '@noble/hashes@2.2.0' },
  '@noble/curves/ed25519.js': { to: `${DEPS}/curves@2.2.0/ed25519.js`, upstreamPin: '@noble/curves@2.2.0', vendored: '@noble/curves@2.2.0' },
  '@noble/post-quantum/ml-dsa.js': { to: `${DEPS}/post-quantum@0.6.1/ml-dsa.js`, upstreamPin: '@noble/post-quantum@0.6.1', vendored: '@noble/post-quantum@0.6.1' },
}
const TEST_ONLY = { vitest: '../vitest-shim.mjs', '../src/index.js': '../lib/index.js', '../src/staleness.js': '../lib/staleness.js' }

/** Rewrite the specifier of every static import/export in `code`; refuse a bare specifier that is not mapped. */
function rewriteSpecifiers(code, outPath, isTest) {
  const rewrites = []
  const out = code.replace(/^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)(["'])([^"']+)\2/gmu, (whole, head, quote, spec) => {
    let to
    if (Object.hasOwn(NOBLE, spec)) to = relative(dirname(outPath), join(ROOT, NOBLE[spec].to)).split('\\').join('/')
    else if (isTest && Object.hasOwn(TEST_ONLY, spec)) to = TEST_ONLY[spec]
    else if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('node:')) return whole
    else throw new Error(`${rel(outPath)}: unmapped bare specifier ${spec}`)
    rewrites.push({ from: `${quote}${spec}${quote}`, to: `${quote}${to}${quote}` })
    return `${head}${quote}${to}${quote}`
  })
  return { out, rewrites }
}

function emit(inPath, outPath, isTest) {
  const source = readFileSync(inPath)
  let code = source.toString('utf8')
  let transpiled = false
  if (inPath.endsWith('.ts')) {
    const result = ts.transpileModule(code, {
      fileName: inPath,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
    })
    if (result.diagnostics.length > 0) {
      throw new Error(`${rel(inPath)}: ${result.diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`)
    }
    code = result.outputText
    transpiled = true
  }
  const { out, rewrites } = rewriteSpecifiers(code, outPath, isTest)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, out)
  const bytes = Buffer.from(out, 'utf8')
  return { path: rel(outPath), from: rel(inPath), transpiled, sha256: sha256(bytes), bytes: bytes.length, specifierRewrites: rewrites }
}

const verbatim = (path, upstreamPath) => {
  const bytes = readFileSync(join(HERE, path))
  return { path, upstreamPath, gitBlob: gitBlob(bytes), sha256: sha256(bytes), bytes: bytes.length }
}

const srcFiles = readdirSync(join(HERE, 'src')).filter((name) => name.endsWith('.ts')).sort()
const testFiles = readdirSync(join(HERE, 'test')).filter((name) => /\.test\.(ts|js)$/u.test(name)).sort()

const upstream = [
  verbatim('LICENSE', 'packages/kernel/LICENSE'),
  verbatim('NOTICE', 'packages/kernel/NOTICE'),
  ...['conformance/hybrid-v1.json', 'conformance/manifest.json', 'conformance/v1.json'].map((p) => verbatim(p, `packages/kernel/${p}`)),
  ...srcFiles.map((name) => verbatim(`src/${name}`, `packages/kernel/src/${name}`)),
  ...testFiles.map((name) => verbatim(`test/${name}`, `packages/kernel/test/${name}`)),
]
const generated = [
  ...srcFiles.map((name) => emit(join(HERE, 'src', name), join(HERE, 'lib', name.replace(/\.ts$/u, '.js')), false)),
  ...testFiles.map((name) => emit(join(HERE, 'test', name), join(HERE, 'lib-test', name.replace(/\.ts$/u, '.js')), true)),
]
const dependencies = Object.entries(NOBLE).map(([specifier, entry]) => {
  const bytes = readFileSync(join(ROOT, entry.to))
  return { specifier, resolvesTo: entry.to, sha256: sha256(bytes), upstreamPin: entry.upstreamPin, vendored: entry.vendored }
})
const depsProvenance = JSON.parse(readFileSync(join(HERE, 'deps', 'PROVENANCE.json'), 'utf8'))

const provenance = {
  domain: 'aukora:kernel-pin:v1',
  package: { name: '@aukora/kernel', version: '0.1.0', license: 'AGPL-3.0-or-later', licenseFile: 'LICENSE' },
  source: {
    repository: 'github.com/aumara-xyz/aukora',
    commit: 'def297fc146bf3c448df4d0f4e78358d65345436',
    path: 'packages/kernel',
    taken: 'git archive def297f packages/kernel from the local read-only clone ~/aukora; no network',
    alsoAt: {
      repository: 'github.com/aumara-xyz/aukora-kernel',
      commit: 'b441edc4d17de778d30ae955f46408edae39bffe',
      sameBytes: false,
      difference: 'b441edc is OLDER: it lacks src/staleness.ts, test/authorityEncoding.test.ts, test/staleness.test.ts and test/stalenessBarrelExport.test.ts, and its src/canonical.ts, src/index.ts, package.json and conformance/manifest.json differ. The 37-case suite is the def297f one.',
    },
  },
  upstream,
  transpile: {
    command: 'node vendor/authority/transpile.mjs --typescript <Genesis vendor/dsh>/node_modules/typescript/lib/typescript.js',
    compiler: `typescript ${ts.version} (ts.transpileModule; type stripping only)`,
    compilerOptions: COMPILER_OPTIONS,
    rule: 'emitted bytes are exactly the compiler output except import specifiers, each listed under specifierRewrites',
    crossCheck: 'MEASURED 2026-09-27: with the @noble specifier rewrites undone, all ten lib/*.js equal byte-for-byte the dist/*.js that upstream\'s own `tsc -p tsconfig.build.json` left in ~/aukora/packages/kernel (sourceMappingURL line removed).',
  },
  generated,
  dependencies,
  dependencyClosure: {
    provenance: 'deps/PROVENANCE.json',
    packages: depsProvenance.packages.map((pkg) => ({ name: pkg.name, version: pkg.version, dir: `deps/${pkg.dir}`, integrity: pkg.lockfile.integrity })),
    files: depsProvenance.files.length,
    bytes: depsProvenance.files.reduce((n, file) => n + file.bytes, 0),
  },
  dependencyNote: 'The kernel pins @noble/curves 2.2.0, @noble/hashes 2.2.0 and @noble/post-quantum 0.6.1 (packages/kernel/package.json and package-lock.json at def297f). Those exact packages, plus @noble/ciphers 2.2.0 that post-quantum 0.6.1 declares, are carried whole and unmodified in deps/<name>@<version>/ from tarballs whose sha512 equals the lockfile integrity; lib/ and lib-test/ import them there, and deps/node_modules/@noble/* are links so the packages\' own bare @noble imports resolve to the same pinned copies. conformance.mjs pins every file and every link. The plugins/aukora-aumlok noble copies (curves/hashes 2.4.0) are no longer on the kernel\'s path.',
  genesisAuthored: ['package.json', 'transpile.mjs', 'vitest-shim.mjs', 'conformance.mjs', 'PROVENANCE.json', 'deps/PROVENANCE.json', 'deps/README.md', 'deps/.gitignore', 'deps/node_modules/@noble/{ciphers,curves,hashes,post-quantum} (links)'],
  notVendored: ['README.md', 'PROVENANCE.md', 'SBOM.cdx.json', 'package.json (upstream)', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.ts', 'examples/observe.mjs'],
  conformance: {
    command: 'node vendor/authority/conformance.mjs',
    expectedCases: 37,
    upstreamMeasurement: 'bun test ./test in a scratch copy of packages/kernel at def297f: 37 pass / 0 fail, 115 expects (~/aukora-great-merge/OLD-TECH-INVENTORY-20260927.md row 3)',
    testFiles: generated.filter((file) => file.path.startsWith('lib-test/')).map((file) => file.path),
  },
}
writeFileSync(join(HERE, 'PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`)
process.stdout.write(`typescript ${ts.version}: ${String(generated.length)} files emitted, ${String(generated.reduce((n, f) => n + f.specifierRewrites.length, 0))} specifier rewrites\n`)
