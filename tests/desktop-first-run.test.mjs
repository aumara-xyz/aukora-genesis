#!/usr/bin/env node
// Resolver-only proof: all installation evidence is synthetic and lives under one scratch root.
// No app, signer, key, live support directory, git command or launcher is used here.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CONFIG_TEMPLATE, resolveTarget } from '../apps/aukora-desktop/resolve.mjs'
import { artifactDigest } from '../plugins/aukora-composition-gate/src/artifact.mjs'
import { pluginSetDigest } from '../plugins/aukora-composition-gate/src/admission-grant.mjs'
import { operationDigestOf, setOperationContent } from '../plugins/aukora-composition-gate/src/plugin-set.mjs'

const FIRST_RUN = 'FIRST RUN: no owner has approved this install yet; link your Aumlok phrase, then approve the plugin set (the app asks) — from then on every launch requires it'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const scratch = await mkdtemp(join(tmpdir(), 'aukora-desktop-first-run-'))
const shell = fileURLToPath(new URL('../apps/aukora-desktop/', import.meta.url))
const templateBefore = structuredClone(CONFIG_TEMPLATE)

function pluginRecord(revision = 'original') {
  const shared = { 'plugins/shared/value.mjs': sha256('shared') }
  // Unequal, unsorted ids exercise ordering/padding; a shared file exercises deduplicated file counts.
  const artifacts = Object.fromEntries([
    ['zeta-long', 'plugins/zeta/index.mjs', revision],
    ['a', 'plugins/a/index.mjs', 'unchanged'],
  ].map(([id, entry, bytes]) => {
    const files = { ...shared, [entry]: sha256(bytes) }
    return [id, { id, entry, files, digest: artifactDigest(files) }]
  }))
  return { formatVersion: 1, kind: 'aukora-plugin-set/v1', count: 2, fileCount: 3,
    setDigest: pluginSetDigest(artifacts), artifacts }
}

const originalSet = pluginRecord()
const changedSet = pluginRecord('changed')
const receipt = {
  domain: 'aukora:approval-receipt:v1', verdict: 'OWNER_KEY_SIGNED',
  operationDigest: operationDigestOf(setOperationContent(originalSet)),
  // Shape-only placeholders, deliberately not valid signatures or actual key material.
  approvalKeyDid: 'fixture-not-a-key', subject: 'fixture-subject', activeControlDigest: 'a'.repeat(64),
  challenge: 'b'.repeat(64), issuedAt: 1, expiresAt: 2, signature: '0'.repeat(128),
  signedBytesDigest: 'c'.repeat(64), approvalClass: 'fixture', keyClass: 'fixture',
}
// Deliberate CRLFs and spacing distinguish hashing original bytes from reserializing parsed JSON.
const artifactBytes = Buffer.from('{\r\n  "producer": { "genesisCommit": "' + '1'.repeat(40) + '" }\r\n}\r\n')
const recordSha = sha256(artifactBytes)
assert.notEqual(recordSha, sha256(JSON.stringify(JSON.parse(artifactBytes))))

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}

async function fixture(name, { config = {}, env = {}, approval, record = originalSet } = {}) {
  const userData = join(scratch, name)
  const release = join(userData, 'release')
  const configPath = join(userData, 'config.json')
  const artifactPath = join(release, '.dsh-build/genesis-artifacts.json')
  const setPath = join(release, '.dsh-build/plugin-set.json')
  const stateRoot = env.AUKORA_DESKTOP_STATE ?? config.stateRoot ?? join(userData, 'state')
  const approvalPath = join(stateRoot, 'gate-state/plugin-set-approval.json')
  await write(configPath, JSON.stringify({ release, checkout: join(userData, 'checkout'), ...config }, null, 2) + '\n')
  await write(artifactPath, artifactBytes)
  await write(setPath, JSON.stringify(record, null, 2) + '\n')
  if (approval !== undefined) await write(approvalPath, typeof approval === 'string' ? approval : JSON.stringify(approval) + '\n')
  const tracked = [configPath, artifactPath, setPath, ...(approval === undefined ? [] : [approvalPath])]
  return { userData, release, stateRoot, approvalPath, setPath, configPath, artifactPath, tracked,
    args: { env, userData, checkoutsDir: join(userData, 'checkouts') } }
}

async function resolveUnchanged(sample, resolver = resolveTarget) {
  const before = await Promise.all(sample.tracked.map(path => readFile(path)))
  const target = await resolver(sample.args)
  const after = await Promise.all(sample.tracked.map(path => readFile(path)))
  assert.deepEqual(after, before, 'resolution must not rewrite installed evidence or config')
  return target
}

function strict(target) {
  assert.equal(target.allowUnapproved, false, 'existing approval must never regain the first-run waiver')
  assert.deepEqual(target.approvedRecordSha, [], 'unmatched evidence must not approve this release record')
  assert.equal(target.why.includes(FIRST_RUN), false)
}

function changedSetOracle(target) {
  strict(target)
  assert.ok(target.why.some(line => line.includes('plugin set changed') && line.includes('must be re-approved')))
}

try {
  const first = await fixture('first-run')
  const firstTarget = await resolveUnchanged(first)
  assert.equal(firstTarget.allowUnapproved, true)
  assert.deepEqual(firstTarget.approvedRecordSha, [])
  assert.ok(firstTarget.why.includes(FIRST_RUN))
  await assert.rejects(lstat(join(first.stateRoot, 'gate-state')), { code: 'ENOENT' })
  console.log('PASS first run: temporary waiver; config and evidence unchanged')

  // Aumlok bound (first-link settings and controller record), restarted before its first plugin-set approval:
  // the waiver must survive, or nothing could start the app to raise that approval.
  const bound = await fixture('bound-never-approved')
  for (const marker of [join(bound.userData, 'kira-deployment-overlay.patch.yml'), join(bound.stateRoot, 'aumlok/local-control.json')]) {
    await write(marker, 'synthetic marker, not key material\n')
    bound.tracked.push(marker)
  }
  const boundTarget = await resolveUnchanged(bound)
  assert.equal(boundTarget.allowUnapproved, true)
  assert.ok(boundTarget.why.includes(FIRST_RUN))
  console.log('PASS bound, never plugin-set approved: waiver kept (no lockout)')

  // Approved once (approver pin left) and the approval gone: refused by name, in every state-root source.
  const lost = []
  for (const [name, options] of [
    ['lost-approval', {}],
    ['lost-approval-config-root', { config: { stateRoot: join(scratch, 'lost-config-state') } }],
    ['lost-approval-env-root', { env: { AUKORA_DESKTOP_STATE: join(scratch, 'lost-env-state') } }],
  ]) {
    const sample = await fixture(name, options)
    const pin = join(sample.stateRoot, 'gate-state/plugin-set-approver.json')
    await write(pin, 'synthetic pin\n')
    sample.tracked.push(pin)
    const before = await Promise.all(sample.tracked.map(path => readFile(path)))
    await assert.rejects(resolveTarget(sample.args), error => error.message.startsWith('existing-install-approval-missing:')
      && error.message.includes(pin) && error.message.includes(sample.configPath))
    assert.deepEqual(await Promise.all(sample.tracked.map(path => readFile(path))), before)
    lost.push(sample)
  }
  const danglingPin = await fixture('dangling-pin')
  await mkdir(join(danglingPin.stateRoot, 'gate-state'), { recursive: true })
  await symlink(join(scratch, 'missing-pin'), join(danglingPin.stateRoot, 'gate-state/plugin-set-approver.json'))
  await assert.rejects(resolveTarget(danglingPin.args), /^Error: existing-install-approval-missing:/u)
  console.log('PASS approver pin without approval (default, configured, environment root; dangling pin): refused, evidence unchanged')

  const approved = await fixture('approved-install', { approval: receipt })
  const approvedTarget = await resolveUnchanged(approved)
  assert.equal(approvedTarget.allowUnapproved, false)
  assert.deepEqual(approvedTarget.approvedRecordSha, [recordSha])
  assert.ok(approvedTarget.why.some(line => line.startsWith('APPROVED BY THE OWNER:')
    && line.includes(approved.approvalPath) && line.includes(originalSet.setDigest)))
  console.log('PASS matching approval: raw-byte record SHA; strict launch; gate helper format matches')

  // Copy only the relevant synthetic installed files. This never reads an owner's installation.
  const copied = await fixture('approved-copy')
  await copyFile(approved.artifactPath, copied.artifactPath)
  await copyFile(approved.setPath, copied.setPath)
  await mkdir(dirname(copied.approvalPath), { recursive: true })
  await copyFile(approved.approvalPath, copied.approvalPath)
  copied.tracked.push(copied.approvalPath)
  const copiedTarget = await resolveUnchanged(copied)
  assert.equal(copiedTarget.allowUnapproved, false)
  assert.deepEqual(copiedTarget.approvedRecordSha, [recordSha])
  console.log('PASS synthetic approved installation scratch copy: approval preserved; files unchanged')

  const changed = await fixture('changed-set', { approval: receipt, record: changedSet })
  changedSetOracle(await resolveUnchanged(changed))
  console.log('PASS changed plugin set: strict; re-approval required')

  const configuredRoot = join(scratch, 'configured-state')
  const configured = await fixture('configured-root', { config: { stateRoot: configuredRoot }, approval: receipt })
  const configuredTarget = await resolveUnchanged(configured)
  assert.equal(configuredTarget.stateRoot, configuredRoot)
  assert.equal(configuredTarget.allowUnapproved, false)
  assert.deepEqual(configuredTarget.approvedRecordSha, [recordSha])
  const envRoot = join(scratch, 'environment-state')
  const environment = await fixture('environment-root', { config: { stateRoot: configuredRoot },
    env: { AUKORA_DESKTOP_STATE: envRoot },
    approval: { ...receipt, operationDigest: operationDigestOf(setOperationContent(changedSet)) } })
  const environmentTarget = await resolveUnchanged(environment)
  assert.equal(environmentTarget.stateRoot, envRoot)
  changedSetOracle(environmentTarget)
  console.log('PASS state root: default, configured and environment precedence')

  const configuredSha = 'f'.repeat(64)
  const explicit = await fixture('explicit-record', { config: { approvedRecordSha: [configuredSha] } })
  const explicitTarget = await resolveUnchanged(explicit)
  assert.equal(explicitTarget.allowUnapproved, false)
  assert.deepEqual(explicitTarget.approvedRecordSha, [configuredSha])
  // Matching installed evidence intentionally appends the current record while retaining every configured entry.
  const append = await fixture('append-record', { config: { approvedRecordSha: [configuredSha] }, approval: receipt })
  const appendTarget = await resolveUnchanged(append)
  assert.equal(appendTarget.allowUnapproved, false)
  assert.deepEqual(appendTarget.approvedRecordSha, [configuredSha, recordSha])
  const duplicate = await fixture('duplicate-record', { config: { approvedRecordSha: [recordSha] }, approval: receipt })
  const duplicateTarget = await resolveUnchanged(duplicate)
  assert.equal(duplicateTarget.allowUnapproved, false)
  assert.deepEqual(duplicateTarget.approvedRecordSha, [recordSha])
  assert.deepEqual(CONFIG_TEMPLATE, templateBefore, 'resolution must not mutate the shipped config template')
  const preview = await fixture('explicit-preview', { config: { allowUnapproved: true, approvedRecordSha: [configuredSha] },
    approval: receipt, record: changedSet })
  const previewTarget = await resolveUnchanged(preview)
  assert.equal(previewTarget.allowUnapproved, true)
  assert.deepEqual(previewTarget.approvedRecordSha, [configuredSha])
  console.log('PASS configured records retained; matching SHA appended once; template unchanged; preview preserved')

  for (const [name, options] of [
    ['malformed-json', { approval: '{' }],
    ['malformed-receipt', { approval: {} }],
    ['truncated-receipt', { approval: {
      domain: receipt.domain, verdict: receipt.verdict, operationDigest: receipt.operationDigest,
    } }],
    ['malformed-record', { approval: receipt, record: {} }],
  ]) strict(await resolveUnchanged(await fixture(name, options)))
  const dangling = await fixture('dangling-approval')
  await mkdir(dirname(dangling.approvalPath), { recursive: true })
  await symlink(join(scratch, 'missing-receipt'), dangling.approvalPath)
  strict(await resolveUnchanged(dangling))
  assert.equal((await lstat(dangling.approvalPath)).isSymbolicLink(), true)
  console.log('PASS malformed evidence and dangling approval symlink remain strict')

  // Match the packaged shell's two-level path to the helper shipped through extraFiles.
  const packagedRoot = join(scratch, 'packaged-shell')
  const isolatedShell = join(packagedRoot, 'Resources', 'app')
  await mkdir(isolatedShell, { recursive: true })
  for (const name of ['url-policy.mjs', 'install-settings.mjs']) {
    await copyFile(join(shell, name), join(isolatedShell, name))
  }
  const desktopPackage = JSON.parse(await readFile(join(shell, 'package.json'), 'utf8'))
  const helper = desktopPackage.build.extraFiles.find(entry =>
    entry.from === '../../plugins/aukora-aumlok/lib' && entry.to === 'plugins/aukora-aumlok/lib')
  assert.ok(helper?.filter.includes('plugin-set-content.mjs'), 'packaged resolver helper must be shipped')
  const helperDirectory = join(packagedRoot, helper.to)
  await mkdir(helperDirectory, { recursive: true })
  await copyFile(join(shell, helper.from, 'plugin-set-content.mjs'), join(helperDirectory, 'plugin-set-content.mjs'))
  const source = await readFile(join(shell, 'resolve.mjs'), 'utf8')
  const comparison = 'receipt.operationDigest === pluginSetOperationDigest(record)'
  assert.equal(source.split(comparison).length, 2, 'red arm must remove exactly the receipt-to-set comparison')
  const mutantPath = join(isolatedShell, 'resolve-mutant.mjs')
  await writeFile(mutantPath, source.replace(comparison, 'true /* receipt-to-set comparison removed */'))
  const mutant = await import(pathToFileURL(mutantPath).href)
  const mutatedTarget = await resolveUnchanged(changed, mutant.resolveTarget)
  assert.throws(() => changedSetOracle(mutatedTarget), error => error.code === 'ERR_ASSERTION'
    && error.message.includes('unmatched evidence must not approve this release record'))
  console.log('RED caught: removing receipt-to-set comparison makes the changed-set oracle fail')
  const guardCall = 'await assertNeverApproved(installStateRoot, configPath)'
  assert.equal(source.split(guardCall).length, 2, 'red arm must remove exactly the never-approved guard')
  const unguardedPath = join(isolatedShell, 'resolve-unguarded.mjs')
  await writeFile(unguardedPath, source.replace(guardCall, '/* never-approved guard removed */'))
  const unguarded = await import(pathToFileURL(unguardedPath).href)
  assert.equal((await unguarded.resolveTarget(lost[0].args)).allowUnapproved, true)
  console.log('RED caught: removing the never-approved guard hands a lost-approval install the waiver')
  console.log(FIRST_RUN)
  console.log('PASS desktop-first-run: resolver evidence only; app launch and signature verification not tested')
} finally {
  await rm(scratch, { recursive: true, force: true })
}
