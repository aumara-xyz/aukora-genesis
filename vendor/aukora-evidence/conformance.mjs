#!/usr/bin/env node
/**
 * The one check for the vendored evidence package.
 *
 *   node vendor/aukora-evidence/conformance.mjs
 *
 * Genesis-authored runner, after vendor/aukora-kernel/conformance.mjs. It does two things:
 *   1. PINS. Every file PROVENANCE.json names (the verbatim upstream bytes and the emitted lib/ and lib-test/) must
 *      hash to its pin. On any mismatch nothing is run.
 *   2. CASES. The six upstream test files (lib-test/, emitted from test/) are run against lib/ through
 *      vitest-shim.mjs: the EvidencePack schema, canonical JSON, digest and secret catalogue (evidencePackV1), the
 *      provider-token shapes (r56), swarm-run evidence (r57), the AGRE adapter (r58), the seal boundary (r59) and
 *      the snapshot boundary (r60).
 *
 * Exit 0 only when every pin holds and all 178 cases pass.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registered } from './vitest-shim.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const provenance = JSON.parse(readFileSync(join(HERE, 'PROVENANCE.json'), 'utf8'))
const EXPECTED_CASES = provenance.conformance.expectedCases

const pins = [
  ...provenance.upstream.map((entry) => [join(HERE, entry.path), entry.sha256, entry.path]),
  ...provenance.generated.map((entry) => [join(HERE, entry.path), entry.sha256, entry.path]),
]
let broken = 0
for (const [path, expected, label] of pins) {
  let actual
  try { actual = sha256(path) } catch { actual = 'missing' }
  if (actual !== expected) { broken += 1; process.stdout.write(`PIN MISMATCH ${label}: expected ${expected}, found ${actual}\n`) }
}
if (broken > 0) {
  process.stdout.write(`EVIDENCE CONFORMANCE: NOT RUN — ${String(broken)} of ${String(pins.length)} pins do not hold\n`)
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
process.stdout.write(`EVIDENCE CONFORMANCE: ${String(passed)}/${String(total)} passed${countNote}\n`)
process.exit(passed === total && total === EXPECTED_CASES ? 0 : 1)
