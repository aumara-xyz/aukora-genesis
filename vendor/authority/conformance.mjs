#!/usr/bin/env node
/**
 * The one check for the vendored kernel.
 *
 *   node vendor/authority/conformance.mjs
 *
 * Genesis-authored runner. It does two things:
 *   1. PINS. Every file PROVENANCE.json names (the verbatim upstream bytes, the emitted lib/ and lib-test/, and the
 *      noble files the kernel imports), every file of the pinned @noble packages deps/PROVENANCE.json names, and every
 *      deps/node_modules/@noble/* link (it must resolve to its pinned package directory, so the packages' own bare
 *      @noble imports cannot fall through to some other node_modules) must hold, and the two vector files must hash
 *      to what upstream's own conformance/manifest.json records. On any mismatch nothing is run.
 *   2. CASES. The six upstream test files (lib-test/, emitted from test/) are run against lib/ through
 *      vitest-shim.mjs: the frozen reducer vector, the RFC 6962 roots, the frozen mandatory-hybrid authority result,
 *      the one-signature downgrade mutations, the encoding goldens, the evidence and staleness cases.
 *
 * Exit 0 only when every pin holds and all 37 cases pass.
 */
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registered } from './vitest-shim.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const DEPS = join(HERE, 'deps')
const EXPECTED_CASES = 37
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const provenance = JSON.parse(readFileSync(join(HERE, 'PROVENANCE.json'), 'utf8'))
const depsProvenance = JSON.parse(readFileSync(join(DEPS, 'PROVENANCE.json'), 'utf8'))

const pins = [
  ...provenance.upstream.map((entry) => [join(HERE, entry.path), entry.sha256, entry.path]),
  ...provenance.generated.map((entry) => [join(HERE, entry.path), entry.sha256, entry.path]),
  ...provenance.dependencies.map((entry) => [join(ROOT, entry.resolvesTo), entry.sha256, entry.resolvesTo]),
  ...depsProvenance.files.map((entry) => [join(DEPS, entry.path), entry.sha256, `deps/${entry.path}`]),
  ...JSON.parse(readFileSync(join(HERE, 'conformance', 'manifest.json'), 'utf8')).vectors
    .map((vector) => [join(HERE, vector.path), vector.sha256, `${vector.path} (upstream manifest)`]),
]
let broken = 0
for (const [path, expected, label] of pins) {
  let actual
  try { actual = sha256(path) } catch { actual = 'missing' }
  if (actual !== expected) { broken += 1; process.stdout.write(`PIN MISMATCH ${label}: expected ${expected}, found ${actual}\n`) }
}
const real = (path) => { try { return realpathSync(path) } catch { return 'missing' } }
for (const link of depsProvenance.resolutionLinks) {
  const expected = real(join(DEPS, link.path, '..', link.target))
  const actual = real(join(DEPS, link.path))
  pins.push(link)
  if (actual === 'missing' || actual !== expected) { broken += 1; process.stdout.write(`LINK MISMATCH deps/${link.path}: expected ${expected}, found ${actual}\n`) }
}
if (broken > 0) {
  process.stdout.write(`KERNEL CONFORMANCE: NOT RUN — ${String(broken)} of ${String(pins.length)} pins do not hold\n`)
  process.exit(1)
}
process.stdout.write(`pins: ${String(pins.length)}/${String(pins.length)} hold (source aumara-xyz/aukora@${provenance.source.commit.slice(0, 7)} ${provenance.source.path})\n`)

let total = 0
let passed = 0
for (const file of provenance.conformance.testFiles) {
  registered.length = 0
  await import(pathToFileURL(join(HERE, file)).href)
  const cases = [...registered]
  for (const { name, body } of cases) {
    total += 1
    try {
      await body()
      passed += 1
      process.stdout.write(`PASS ${file.replace(/^lib-test\//u, '')} › ${name}\n`)
    } catch (error) {
      process.stdout.write(`FAIL ${file.replace(/^lib-test\//u, '')} › ${name}\n     ${String(error?.message ?? error).split('\n')[0]}\n`)
    }
  }
}
const countNote = total === EXPECTED_CASES ? '' : ` — expected ${String(EXPECTED_CASES)} cases, found ${String(total)}`
process.stdout.write(`KERNEL CONFORMANCE: ${String(passed)}/${String(total)} passed${countNote}\n`)
process.exit(passed === total && total === EXPECTED_CASES ? 0 : 1)
