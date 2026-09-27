#!/usr/bin/env node
/** Attended offline upgrade of one retained Web store; never starts or stops services. */
import { randomBytes, sign } from 'node:crypto'
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdtempSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { beginWebActivationUpgrade } from '../aukora/broker/web-activation-upgrade.mjs'
import { loadLocalAumlokControl } from '../aukora/identity/local-control-store.mjs'
import { UPGRADED_BINDING_DOMAIN, WEB_UPGRADE_SIGNATURE_DOMAIN, webUpgradeBytes } from '../aukora/activation/web-upgrade-record.mjs'
import { createWebActivationRollback, verifyWebRollbackBundle, webRollbackBytes, WEB_ROLLBACK_SIGNATURE_DOMAIN, SIGNED_WEB_ROLLBACK_DOMAIN, WEB_ROLLBACK_BUNDLE_DOMAIN } from '../aukora/activation/web-rollback-record.mjs'
import { canonicalJSON } from '../aukora/kernel-seed/canonical-json.mjs'
import { createTerminalLines } from '../aukora/supervisor/developer-terminal.mjs'
import { createDeveloperAumlokAuthority } from '../aukora/supervisor/developer-aumlok.mjs'
import { prepareWebUpgradeStatement, readDeveloperWorkspaceRoots } from '../aukora/supervisor/developer-launch.mjs'
import { readWebReviewConfig, WEB_REVIEW_RENDERER_ID } from '../aukora/supervisor/developer-review.mjs'
import { readWebCapsuleConfig } from '../aukora/supervisor/developer-web-capsule.mjs'

function inspectBundleDestination(path, protectedRoots) {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error('upgrade:rollback-bundle-path-invalid')
  const parent = dirname(path)
  if (realpathSync(parent) !== parent || protectedRoots.some(root => path === root || path.startsWith(`${root}/`))) {
    throw new Error('upgrade:rollback-bundle-location-invalid')
  }
  const state = lstatSync(parent)
  if (!state.isDirectory() || state.isSymbolicLink() || state.uid !== process.geteuid()
    || (state.mode & 0o7777) !== 0o700) throw new Error('upgrade:rollback-bundle-parent-not-private')
  try { lstatSync(path) }
  catch (error) {
    if (error?.code === 'ENOENT') return { path, parent, dev: state.dev, ino: state.ino }
    throw error
  }
  throw new Error('upgrade:rollback-bundle-exists')
}

/** Flush the preauthorized bundle outside retained state before any activation publication. */
function saveRollbackBundle(destination, protectedRoots, bundle) {
  const current = inspectBundleDestination(destination.path, protectedRoots)
  if (current.dev !== destination.dev || current.ino !== destination.ino) throw new Error('upgrade:rollback-bundle-parent-changed')
  const directory = openSync(destination.parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  let file
  try {
    const opened = fstatSync(directory)
    if (opened.dev !== destination.dev || opened.ino !== destination.ino) throw new Error('upgrade:rollback-bundle-parent-changed')
    file = openSync(destination.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    fchmodSync(file, 0o600)
    writeFileSync(file, canonicalJSON(bundle))
    fsyncSync(file)
    closeSync(file)
    file = undefined
    fsyncSync(directory)
  } finally {
    if (file !== undefined) closeSync(file)
    closeSync(directory)
  }
}

function signaturesFor(bytes, domain, control) {
  return {
    ed25519: sign(null, bytes, control.ed25519PrivateKey).toString('hex'),
    mlDsa65: Buffer.from(ml_dsa65.sign(bytes, control.mlDsa65SecretKey, { context: Buffer.from(domain) })).toString('hex'),
  }
}

let session
let terminal
let stagingDir
// Default SIGINT/SIGTERM disposition skips this script's cleanup, so an
// interrupted approval would leak the acquired writer lease.
const interruption = new AbortController()
const interrupted = () => interruption.abort()
process.once('SIGINT', interrupted)
process.once('SIGTERM', interrupted)
try {
  const args = process.argv.slice(2)
  const usage = 'usage: node scripts/aukora-web-upgrade.mjs --data-dir ABSOLUTE_DATA --control-dir ABSOLUTE_CONTROL --review-config ABSOLUTE_CONFIG --port PORT [--workspace NAME=CANONICAL_ABSOLUTE_DIR ...] [--capsule-config ABSOLUTE_CONFIG] [--operator-home CANONICAL_ABSOLUTE_HOME] [--expected-previous-activation SHA256] [--rollback-bundle ABSOLUTE_FILE]'
  if (args.length < 8 || args.length % 2 !== 0 || args[0] !== '--data-dir' || args[2] !== '--control-dir'
    || args[4] !== '--review-config' || args[6] !== '--port'
    || ![args[1], args[3], args[5]].every(isAbsolute)
    || !/^[1-9][0-9]{0,4}$/u.test(args[7]) || Number(args[7]) > 65535) {
    throw new Error(usage)
  }
  const workspaces = Object.create(null)
  let expectedPreviousActivation
  let rollbackBundlePath
  let capsuleConfigPath
  let webOperatorHome
  for (let index = 8; index < args.length; index += 2) {
    if (args[index] === '--operator-home') {
      if (webOperatorHome !== undefined) throw new Error('upgrade:operator-home-duplicate')
      webOperatorHome = args[index + 1]
      if (!isAbsolute(webOperatorHome)) throw new Error('upgrade:operator-home-path-invalid')
      continue
    }
    if (args[index] === '--capsule-config') {
      if (capsuleConfigPath !== undefined) throw new Error('upgrade:capsule-config-duplicate')
      capsuleConfigPath = args[index + 1]
      if (!isAbsolute(capsuleConfigPath)) throw new Error('upgrade:capsule-config-path-invalid')
      continue
    }
    if (args[index] === '--rollback-bundle') {
      if (rollbackBundlePath !== undefined) throw new Error('upgrade:rollback-bundle-duplicate')
      rollbackBundlePath = args[index + 1]
      continue
    }
    if (args[index] === '--expected-previous-activation') {
      if (expectedPreviousActivation !== undefined || !/^[0-9a-f]{64}$/u.test(args[index + 1])) {
        throw new Error('upgrade:previous-activation-pin-invalid')
      }
      expectedPreviousActivation = args[index + 1]
      continue
    }
    if (args[index] !== '--workspace') throw new Error(usage)
    const value = args[index + 1]
    const equals = value.indexOf('=')
    if (equals <= 0 || equals === value.length - 1) throw new Error('upgrade:workspace-argument-invalid')
    const alias = value.slice(0, equals)
    if (Object.hasOwn(workspaces, alias)) throw new Error('upgrade:workspace-alias-duplicate')
    workspaces[alias] = value.slice(equals + 1)
  }
  const workspaceRoots = Object.keys(workspaces).length === 0 ? undefined
    : readDeveloperWorkspaceRoots(workspaces, [args[1], args[3]])
  const webCapsule = capsuleConfigPath === undefined ? undefined : readWebCapsuleConfig(capsuleConfigPath)
  if (webCapsule !== undefined && workspaceRoots === undefined) throw new Error('upgrade:capsule-workspace-required')
  const protectedRoots = [realpathSync(args[1]), realpathSync(args[3])]
  const bundleDestination = rollbackBundlePath === undefined ? undefined : inspectBundleDestination(rollbackBundlePath, protectedRoots)
  if (!process.stdin.isTTY) throw new Error('upgrade:attended-terminal-required')
  const control = loadLocalAumlokControl(args[3])
  const review = readWebReviewConfig(args[5])
  if (review.subject !== control.subject) throw new Error('upgrade:controller-mismatch')
  const authority = createDeveloperAumlokAuthority(control, { audience: 'broker:source-launch' })
  stagingDir = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-upgrade-profile-')))
  const statement = prepareWebUpgradeStatement({ stagingDir, dataDir: args[1],
    rendererId: WEB_REVIEW_RENDERER_ID, reviewConfigurationDigest: review.serverId,
    rootPublicKeyPem: control.ed25519PublicKeyPem, rootControlState: control.activeControl,
    workspaceRoots, webCapsule, webOperatorHome,
    web: { port: Number(args[7]) }, webAumlokProjection: authority.projection,
    selectSubjectAuthority: authority.selectSubjectAuthority, subjectAuthorityExpectation: authority.subjectAuthorityExpectation })
  session = beginWebActivationUpgrade(join(args[1], 'broker-state'), statement, { expectedPreviousActivation })
  if (session.operation.subject !== control.subject || session.operation.controlDigest !== control.activeControlDigest) {
    throw new Error('upgrade:controller-mismatch')
  }
  const rollback = bundleDestination === undefined ? undefined : createWebActivationRollback(session.operation, session.previousBinding)
  const challenge = randomBytes(8).toString('hex')
  terminal = createTerminalLines()
  const rollbackPrompt = rollback === undefined
    ? 'WARNING: no rollback bundle requested; this upgrade has no preauthorized rollback.\n'
    : `PREAUTHORIZED ROLLBACK — valid for 900 seconds from preparation, only to the exact previous activation with unchanged retained state; no service restart is authorized by the bundle.\n${canonicalJSON(rollback)}\n`
  process.stderr.write(`ACTIVATION UPGRADE — same-UID operator approval; no memory rewrite\n${canonicalJSON(session.operation)}\n${rollbackPrompt}Type "upgrade ${challenge}" to authorize ${rollback === undefined ? 'this exact upgrade' : 'both exact operations'}: `)
  const window = AbortSignal.timeout(120_000)
  let answer
  try { answer = await terminal.read(AbortSignal.any([interruption.signal, window])) }
  catch (error) {
    if (interruption.signal.aborted) throw new Error('upgrade:operator-interrupted')
    if (window.aborted) throw new Error('upgrade:approval-expired')
    throw error
  }
  if (interruption.signal.aborted) throw new Error('upgrade:operator-interrupted')
  if (answer !== `upgrade ${challenge}`) throw new Error('upgrade:operator-declined')
  const bytes = webUpgradeBytes(session.operation)
  const record = { domain: UPGRADED_BINDING_DOMAIN, operation: session.operation,
    signatures: signaturesFor(bytes, WEB_UPGRADE_SIGNATURE_DOMAIN, control) }
  if (rollback !== undefined) {
    const bundle = { domain: WEB_ROLLBACK_BUNDLE_DOMAIN, previousBinding: session.previousBinding, upgrade: record,
      rollback: { domain: SIGNED_WEB_ROLLBACK_DOMAIN, operation: rollback,
        signatures: signaturesFor(webRollbackBytes(rollback), WEB_ROLLBACK_SIGNATURE_DOMAIN, control) } }
    saveRollbackBundle(bundleDestination, protectedRoots, verifyWebRollbackBundle(bundle, control.activeControl))
    process.stderr.write(`Preauthorized rollback bundle saved: ${bundleDestination.path}\n`)
  }
  process.stdout.write(`${JSON.stringify(session.commit(record))}\n`)
} catch (error) {
  process.stderr.write(`${String(error?.message ?? error)}\n`)
  process.exitCode = 1
} finally {
  terminal?.close()
  session?.close()
  if (stagingDir !== undefined) rmSync(stagingDir, { recursive: true, force: true })
}
