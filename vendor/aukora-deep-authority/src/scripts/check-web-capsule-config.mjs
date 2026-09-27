/** Owner configuration parser regressions; only temporary state and the Node executable. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseWebCapsuleConfig, readWebCapsuleConfig, WEB_CAPSULE_DOMAIN } from '../aukora/supervisor/developer-web-capsule.mjs'
const roots = []
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const config = () => ({ domain: WEB_CAPSULE_DOMAIN,
  worker: { kind: 'opencode', executable: process.execPath, defaultModel: 'fixture/local',
    maxOutputBytes: 65536, maxSpillBytes: 1048576, disposeGraceMs: 1000 },
  protectedChecks: [{ id: 'file-check', program: "import { readFileSync } from 'node:fs'; readFileSync(process.env.CAPSULE_CANDIDATE_ROOT + '/note.txt')", timeoutMs: 5000 }],
})
function temp() { const dir = mkdtempSync(join(tmpdir(), 'aukora-capsule-config-')); roots.push(dir); return dir }
test('complete owner selection is immutable and does not carry a route or approval', () => {
  const value = parseWebCapsuleConfig(config())
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.worker) && Object.isFrozen(value.protectedChecks[0]))
  assert.deepEqual(Object.keys(value).sort(), ['protectedChecks', 'worker'])
})
test('missing checks, placeholder, duplicate checks and foreign fields fail closed', () => {
  const bad = [ {}, { ...config(), broker: {} }, { ...config(), protectedChecks: [] },
    { ...config(), protectedChecks: [{ ...config().protectedChecks[0], id: 'operator-check-required' }] },
    { ...config(), protectedChecks: [...config().protectedChecks, ...config().protectedChecks] },
    { ...config(), protectedChecks: [{ ...config().protectedChecks[0], program: '' }] },
    { ...config(), protectedChecks: [{ ...config().protectedChecks[0], timeoutMs: 1.5 }] },
  ]
  for (const value of bad) assert.throws(() => parseWebCapsuleConfig(value), /capsule-config-invalid/)
})
test('worker cannot select ambient fallback, relative executable, routes or unbounded output', () => {
  for (const worker of [ {}, { ...config().worker, kind: 'shell' }, { ...config().worker, executable: 'opencode' },
    { ...config().worker, restrictedWorkspace: '/' }, { ...config().worker, maxSpillBytes: 1 },
    { ...config().worker, disposeGraceMs: Infinity }, { ...config().worker, defaultModel: '' } ]) {
    assert.throws(() => parseWebCapsuleConfig({ ...config(), worker }), /capsule-config-invalid/)
  }
})
test('an OpenCode worker must name a provider and a model; crush is unaffected', () => {
  // The isolated runtime composes the CLI's whole configuration from this one value and the
  // Capsule never supplies one per request, so an absent or provider-less model can never
  // dispatch. Refusing here names the operator's own file rather than the plugin tree.
  for (const defaultModel of [undefined, 'local', 'fixture/', '/local', 'pro vider/model']) {
    const worker = { ...config().worker }
    if (defaultModel === undefined) delete worker.defaultModel
    else worker.defaultModel = defaultModel
    assert.throws(() => parseWebCapsuleConfig({ ...config(), worker }), /capsule-config-invalid/,
      `expected refusal for defaultModel=${String(defaultModel)}`)
  }
  assert.ok(parseWebCapsuleConfig({ ...config(), worker: { ...config().worker, defaultModel: 'provider/model' } }))
  // A crush worker never reaches the isolated runtime, so it carries no such requirement.
  const crush = { ...config().worker, kind: 'crush' }
  delete crush.defaultModel
  assert.ok(parseWebCapsuleConfig({ ...config(), worker: crush }))
})

test('private file loads; missing, public, symlinked, hardlinked and oversized files refuse untouched', () => {
  const dir = temp(), path = join(dir, 'capsule.json')
  writeFileSync(path, JSON.stringify(config()), { mode: 0o600 })
  assert.equal(readWebCapsuleConfig(path).protectedChecks.length, 1)
  assert.throws(() => readWebCapsuleConfig(join(dir, 'absent')), /capsule-config-invalid/)
  chmodSync(path, 0o644)
  assert.throws(() => readWebCapsuleConfig(path), /capsule-config-invalid/)
  chmodSync(path, 0o600)
  symlinkSync(path, join(dir, 'link'))
  assert.throws(() => readWebCapsuleConfig(join(dir, 'link')), /capsule-config-invalid/)
  linkSync(path, join(dir, 'hardlink'))
  assert.throws(() => readWebCapsuleConfig(path), /capsule-config-invalid/)
  assert.ok(existsSync(path) && existsSync(join(dir, 'hardlink')))
  writeFileSync(join(dir, 'large'), ' '.repeat(65537), { mode: 0o600 })
  assert.throws(() => readWebCapsuleConfig(join(dir, 'large')), /capsule-config-invalid/)
  mkdirSync(join(dir, 'directory'))
  assert.throws(() => readWebCapsuleConfig(join(dir, 'directory')), /capsule-config-invalid/)
})
test('nonexecutable and malformed owner files refuse before a child or controller exists', () => {
  const dir = temp(), path = join(dir, 'capsule.json'), exe = join(dir, 'not-executable')
  writeFileSync(exe, 'not executable', { mode: 0o600 })
  writeFileSync(path, JSON.stringify({ ...config(), worker: { ...config().worker, executable: exe } }), { mode: 0o600 })
  assert.throws(() => readWebCapsuleConfig(path), /capsule-config-invalid/)
  writeFileSync(path, '{')
  assert.throws(() => readWebCapsuleConfig(path), /capsule-config-invalid/)
})
