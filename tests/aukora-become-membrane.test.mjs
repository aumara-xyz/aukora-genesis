#!/usr/bin/env node
// Exercise the real --plan entry point using copied synthetic state, never installed state.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeChain } from '../scripts/aukora/aura-code.mjs'
import { root } from '../scripts/aukora/aura-merkle.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const commit = spawnSync('/usr/bin/git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
const scratch = mkdtempSync(join(tmpdir(), 'become-membrane-'))
const seed = join(scratch, 'seed')
const retainedRel = 'state/home/become/membrane-retained.json'
const chainRel = 'state/home/aura-code/aura.jsonl'
const json = (file, value) => writeFileSync(file, `${JSON.stringify(value)}\n`)
try {
  const release = join(scratch, 'fixture-release')
  mkdirSync(join(release, '.dsh-build'), { recursive: true })
  json(join(release, '.dsh-build/aukora-release.json'), { tipSha: commit })
  mkdirSync(join(seed, 'state/home/become'), { recursive: true })
  json(join(seed, 'config.json'), { release })
  const chain = codeChain(join(seed, 'state'))
  for (let i = 0; i < 6; i += 1) chain.append({ operation: 'scratch.fixture', index: i })
  const leaves = readFileSync(chain.log, 'utf8').trimEnd().split('\n').map(line => Buffer.from(line))
  const retained = { treeSize: 3, root: root(leaves.slice(0, 3)) }
  json(join(seed, retainedRel), retained)
  const realPython = spawnSync('/usr/bin/which', ['python3'], { encoding: 'utf8' }).stdout.trim()
  const shim = (name, script) => {
    const bin = join(scratch, name)
    mkdirSync(bin)
    writeFileSync(join(bin, 'python3'), `#!/bin/sh\n${script}\n`, { mode: 0o700 })
    return `${bin}:${process.env.PATH}`
  }
  const unavailable = shim('unavailable', 'exit 1')
  const noVerdict = shim('no-verdict', "printf 'REASON : POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE\\n'")
  const finalFailure = shim('final-failure', 'if [ -f "$P2_PROBE_SEEN" ]; then exit 1; fi\n: > "$P2_PROBE_SEEN"\nexec "$P2_REAL_PYTHON" "$@"')
  const run = (name, expected, reason, options = {}) => {
    const support = join(scratch, name)
    cpSync(seed, support, { recursive: true })
    if (options.retained === null) rmSync(join(support, retainedRel))
    else if (options.retained) json(join(support, retainedRel), options.retained)
    const before = readFileSync(join(support, chainRel))
    const kept = options.retained === null ? null : readFileSync(join(support, retainedRel))
    const out = spawnSync(process.execPath, [join(repo, 'scripts/aukora/become.mjs'), '--commit', commit, '--plan'], {
      encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, AUKORA_SUPPORT_ROOT: support, AUKORA_RELEASES_ROOT: join(scratch, 'releases'),
        AUKORA_SUPPORT_COPY: join(scratch, 'support-copy'), PATH: options.path ?? process.env.PATH,
        P2_PROBE_SEEN: join(scratch, 'probe-seen'), P2_REAL_PYTHON: realPython },
    })
    console.log(`CASE ${name}: node scripts/aukora/become.mjs --commit ${commit} --plan`)
    process.stdout.write(out.stdout + out.stderr)
    const last = JSON.parse(readFileSync(join(support, 'state/home/become/last.json'), 'utf8'))
    const membrane = last.body.membrane
    console.log(`RECORDED ${membrane.verdict} ${membrane.reason ?? ''} retained=${membrane.retainedSize ?? 'none'} presented=${membrane.presentedSize ?? 'none'}`)
    assert.equal(out.status, expected === 'planned' ? 0 : 1)
    assert.equal(last.outcome, expected)
    assert.equal(membrane.reason, reason)
    if (expected === 'refused') assert.ok(last.note.includes(reason))
    if (options.started !== undefined) assert.equal(out.stdout.includes('STEP start'), options.started)
    assert.deepEqual(readFileSync(join(support, chainRel)), before)
    if (kept) assert.deepEqual(readFileSync(join(support, retainedRel)), kept)
  }
  run('verifier-unavailable', 'refused', 'verifier_unavailable', { path: unavailable, started: false })
  run('honest-append', 'planned', 'valid_append_only_extension')
  const otherRoot = root([Buffer.from('a different retained observation')])
  run('power-of-two', 'planned', 'POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE', {
    retained: { treeSize: 4, root: otherRoot },
  })
  run('no-verdict', 'refused', 'verifier_unavailable', { path: noVerdict, started: false })
  run('invalid-sizes', 'refused', 'invalid_tree_sizes', { retained: { ...retained, treeSize: 7 } })
  run('conflict', 'refused', 'consistency:prefix-mismatch', { retained: { ...retained, root: otherRoot } })
  run('first-retention', 'planned', undefined, { retained: null })
  run('final-verifier-unavailable', 'refused', 'verifier_unavailable', { path: finalFailure, started: true })
  console.log('PASS: 8 scratch membrane cases; copied chain and retained heads unchanged')
} finally { rmSync(scratch, { recursive: true, force: true }) }
