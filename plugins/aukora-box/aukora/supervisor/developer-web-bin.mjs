#!/usr/bin/env node
/** One-command parent-owned launch for the governed AUKORA Web surface. */
import { chmodSync, lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOrCreateLocalAumlokControl } from '../identity/local-control-store.mjs'
import { createDeveloperAumlokAuthority } from './developer-aumlok.mjs'
import { readWebCapsuleConfig } from './developer-web-capsule.mjs'
import {
  DEVELOPER_OBSERVATION_CLASS,
  WEB_RENDERER_ID,
  launchDeveloperAssembly,
  readDeveloperWorkspaceRoots,
} from './developer-launch.mjs'
import {
  createTerminalLines,
  reviewApprovalArtifact,
  reviewIssuerChallenge,
} from './developer-terminal.mjs'
import { createWebReview, readWebReviewConfig, WEB_REVIEW_RENDERER_ID } from './developer-review.mjs'

/** The one accepted spelling of this command's arguments. */
const USAGE = 'usage: pnpm aukora:web [--port 1..65535] [--control-dir PATH] [--data-dir PATH] [--review-config PATH] [--capsule-config PATH] [--operator-home CANONICAL_ABSOLUTE_HOME] [--workspace NAME=CANONICAL_ABSOLUTE_DIR ...]'

/** This checkout, refused as a home for durable state. */
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

let base
let terminal
let assembly
let ownerReview
let exitCode = 0
try {
  const options = parseOptions(process.argv.slice(2))
  const control = loadOrCreateLocalAumlokControl(options.controlDir)
  const authority = createDeveloperAumlokAuthority(control, {
    audience: 'broker:source-launch',
  })
  base = mkdtempSync(join(tmpdir(), 'aukora-web-'))
  const runtimeDir = join(base, 'assembly')
  const privateKeyFile = join(base, 'issuer-private.pem')
  const publicKeyFile = join(base, 'issuer-public.pem')
  writeFileSync(privateKeyFile, control.record.ed25519PrivateKeyPem, { mode: 0o600, flag: 'wx' })
  writeFileSync(publicKeyFile, control.ed25519PublicKeyPem, { mode: 0o600, flag: 'wx' })
  chmodSync(base, 0o700)
  const reviewConfig = options.reviewConfig === undefined ? undefined : readWebReviewConfig(options.reviewConfig)
  if (reviewConfig === undefined) terminal = createTerminalLines()
  else ownerReview = await createWebReview(reviewConfig, control.subject)
  assembly = await launchDeveloperAssembly({
    runtimeDir,
    rootPrivateKeyFile: privateKeyFile,
    rootPublicKeyFile: publicKeyFile,
    rendererId: ownerReview === undefined ? WEB_RENDERER_ID : WEB_REVIEW_RENDERER_ID,
    rootControlState: control.activeControl,
    dataDir: options.dataDir,
    workspaceRoots: options.workspaceRoots,
    web: { port: options.port },
    webCapsule: options.webCapsule,
    webOperatorHome: options.webOperatorHome,
    webAumlokProjection: authority.projection,
    kiraRecallPolicy: { subject: control.subject, privacy: ['private'] },
    selectSubjectAuthority: authority.selectSubjectAuthority,
    subjectAuthorityExpectation: authority.subjectAuthorityExpectation,
    review: ownerReview?.review ?? ((request, signal) => reviewApprovalArtifact(terminal, request, signal)),
    issuerApproval: ownerReview?.issuerApproval ?? ((request, signal) => reviewIssuerChallenge(terminal, request, signal)),
    ...(ownerReview === undefined ? {} : {
      reviewConfigurationDigest: reviewConfig.serverId,
      // Complete issuer prompts go to the authenticated owner, not the service log.
      issuerStderr: () => {},
    }),
  })
  process.stdout.write(`${JSON.stringify({
    schema: 'aukora:parent-web-ready:v3',
    status: 'READY',
    url: `http://127.0.0.1:${String(options.port)}`,
    observationClass: DEVELOPER_OBSERVATION_CLASS,
    accessMode: options.webOperatorHome === undefined ? 'BROKERED_EFFECT_PRESET' : 'OPERATOR_NATIVE_WITH_BROKERED_EFFECTS',
    pids: {
      broker: assembly.broker.pid,
      issuer: assembly.issuer.pid,
      guest: assembly.guest.pid,
    },
    routes: {
      broker: assembly.paths.brokerSocket,
      issuer: assembly.paths.issuerSocket,
      ...(reviewConfig === undefined ? {} : { review: reviewConfig.socketPath }),
    },
    globalTools: assembly.guestGlobalTools,
    stateDir: assembly.paths.stateDir,
    dataDir: options.dataDir,
    aumlok: authority.projection,
    artifact: assembly.artifact,
    ...(reviewConfig === undefined ? {} : { review: { role: reviewConfig.role, serverId: reviewConfig.serverId } }),
  })}\n`)
  exitCode = await waitForStop(assembly)
} catch (error) {
  process.stderr.write(`${String(error?.message ?? error)}\n`)
  exitCode = 1
} finally {
  const closures = await Promise.allSettled([assembly?.close(), ownerReview?.close()])
  terminal?.close()
  if (base !== undefined) rmSync(base, { recursive: true, force: true })
  for (const result of closures) {
    if (result.status !== 'rejected') continue
    process.stderr.write(`${String(result.reason?.message ?? result.reason)}\n`)
    exitCode = 1
  }
}
process.exitCode = exitCode

/**
 * Parse the public port, the parent-owned controller directory, and the
 * parent-owned durable data root.
 *
 * The controller holds signing material and the data root holds flight state;
 * they are separate directories so neither inherits the other's lifetime, and
 * an overlapping pair is refused rather than silently nested. Both default
 * outside this checkout, because state written inside the source tree would
 * enter the repository's own cleanliness measurements.
 * @param {readonly string[]} args - argv after the script name.
 * @returns {Readonly<{port: number, controlDir: string, dataDir: string, reviewConfig?: string, workspaceRoots?: Readonly<Record<string,string>>, webCapsule?: ReturnType<typeof readWebCapsuleConfig>, webOperatorHome?: string}>} parsed options.
 */
function parseOptions(args) {
  let port = 5173
  let controlDir = join(homedir(), '.aukora', 'local-control-v1')
  let dataDir = join(homedir(), '.aukora', 'web-data-v1')
  let reviewConfig
  let capsuleConfig
  let webOperatorHome
  const workspaces = Object.create(null)
  const seen = new Set()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if ((name !== '--port' && name !== '--control-dir' && name !== '--data-dir' && name !== '--review-config' && name !== '--capsule-config' && name !== '--workspace' && name !== '--operator-home')
      || value === undefined
      || (name !== '--workspace' && seen.has(name))) {
      throw new Error(USAGE)
    }
    seen.add(name)
    if (name === '--workspace') {
      const equals = value.indexOf('=')
      if (equals <= 0 || equals === value.length - 1) throw new Error('aukora:web:workspace-argument-invalid')
      const alias = value.slice(0, equals)
      if (Object.hasOwn(workspaces, alias)) throw new Error('aukora:web:workspace-alias-duplicate')
      workspaces[alias] = value.slice(equals + 1)
      continue
    }
    if (name === '--port') {
      if (!/^[1-9][0-9]{0,4}$/u.test(value) || Number(value) > 65535) throw new Error(USAGE)
      port = Number(value)
      continue
    }
    if (value.length === 0) throw new Error(USAGE)
    if (name === '--control-dir') controlDir = resolve(value)
    else if (name === '--review-config') reviewConfig = resolve(value)
    else if (name === '--capsule-config') capsuleConfig = resolve(value)
    else if (name === '--operator-home') webOperatorHome = value
    else dataDir = resolve(value)
  }
  const workspaceRoots = seen.has('--workspace') ? readDeveloperWorkspaceRoots(workspaces, [controlDir, dataDir]) : undefined
  assertSeparateDurableRoots(controlDir, dataDir)
  const webCapsule = capsuleConfig === undefined ? undefined : readWebCapsuleConfig(capsuleConfig)
  if (webCapsule !== undefined && (workspaceRoots === undefined || Object.keys(workspaceRoots).length === 0)) {
    throw new Error('aukora:web:capsule-workspace-required')
  }
  return Object.freeze({ port, controlDir, dataDir, webCapsule, webOperatorHome, ...(reviewConfig === undefined ? {} : { reviewConfig }), ...(workspaceRoots === undefined ? {} : { workspaceRoots }) })
}

/**
 * @param {string} outer - candidate containing directory.
 * @param {string} inner - candidate contained path.
 * @returns {boolean} whether inner is outer or sits beneath it.
 */
function contains(outer, inner) {
  return inner === outer || inner.startsWith(`${outer}${sep}`)
}

/**
 * Refuse a controller/data pair that cannot own its own lifetime.
 * @param {string} controlDir - parent-owned controller directory.
 * @param {string} dataDir - parent-owned durable data root.
 * @throws when either overlaps the other, sits in this checkout, or is not a private directory of this uid.
 */
function assertSeparateDurableRoots(controlDir, dataDir) {
  if (contains(controlDir, dataDir) || contains(dataDir, controlDir)) {
    throw new Error(`aukora:web: --control-dir and --data-dir must not overlap (${controlDir}, ${dataDir})`)
  }
  for (const directory of [controlDir, dataDir]) {
    if (contains(SOURCE_ROOT, directory)) {
      throw new Error(`aukora:web: ${directory} is inside this checkout; durable state belongs outside the source tree`)
    }
    let state
    try {
      state = lstatSync(directory)
    } catch {
      continue
    }
    if (state.isSymbolicLink() || !state.isDirectory()) {
      throw new Error(`aukora:web: ${directory} must be a directory, not a link`)
    }
    if (state.uid !== process.geteuid?.() || (state.mode & 0o777) !== 0o700) {
      throw new Error(`aukora:web: ${directory} must be owned by this uid with mode 0700`)
    }
  }
}

/** Resolve on one stop signal; SIGUSR1 restarts only the Web child. */
function waitForStop(activeAssembly) {
  return new Promise((resolve) => {
    let restarting = false
    const finish = (code) => {
      process.removeListener('SIGINT', onInterrupt)
      process.removeListener('SIGTERM', onTerminate)
      process.removeListener('SIGUSR1', onRestart)
      resolve(code)
    }
    const onInterrupt = () => finish(130)
    const onTerminate = () => finish(0)
    const onRestart = () => {
      if (restarting) return
      restarting = true
      void activeAssembly.restartGuest().then(
        () => {
          process.stdout.write(`${JSON.stringify({
            schema: 'aukora:parent-web-restart:v2',
            status: 'RESTARTED',
            pids: {
              broker: activeAssembly.broker.pid,
              issuer: activeAssembly.issuer.pid,
              guest: activeAssembly.guest.pid,
            },
          })}\n`)
        },
        (error) => {
          process.stderr.write(`${String(error?.message ?? error)}\n`)
          finish(1)
        },
      ).finally(() => { restarting = false })
    }
    process.once('SIGINT', onInterrupt)
    process.once('SIGTERM', onTerminate)
    process.on('SIGUSR1', onRestart)
    void activeAssembly.failure.then(() => finish(1), (error) => {
      process.stderr.write(`${String(error?.message ?? error)}\n`)
      finish(1)
    })
  })
}
