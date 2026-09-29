import './noble-map.mjs'
import { spawn } from 'node:child_process'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareGuestConfinement, verifyGuestConfinement, spawnConfinedGuest } from '../../aukora-box/aukora/supervisor/guest-confinement.mjs'
import { installIssuerApprovalBridge } from '../../aukora-box/aukora/supervisor/issuer-approval-bridge.mjs'
import { brokerDispatch, BROKER_REFUSE, readSettlementHead } from '../../aukora-box/aukora/broker/broker.mjs'
import { captureWorkspacePatchArgs } from '../../aukora-box/aukora/broker/workspace-patch-args.mjs'
import { preflightWorkspacePatch } from '../../aukora-box/aukora/broker/workspace-patch.mjs'
import { buildOperation, operationDigest } from '../../aukora-box/aukora/broker/operation.mjs'
import { WORKSPACE_PATCH } from '../../aukora-box/aukora/broker/effect-definition.mjs'
import { assertBootConfinement } from '../../aukora-box/aukora/broker/confinement.mjs'
import { receiptKeyIdForPublicKey } from '../../aukora-box/aukora/host-dsh/src/grant.mjs'
import { rootKeySetId, createInitialIdentityControl, identityControlDigest, AUMLOK_ROOT_CONTROL_SUITE } from '../../aukora-box/aukora/identity/control.mjs'
import { createIdentityGenesis } from '../../aukora-box/aukora/identity/genesis.mjs'
import { createDelegationClaim, delegationClaimDigest } from '../../aukora-box/aukora/identity/delegation.mjs'
import { bindIdentityControlState } from '../../aukora-box/aukora/identity/broker-state.mjs'
import { bindActivation } from '../../aukora-box/aukora/activation/broker-state.mjs'
import { renderApprovalArtifact } from '../../aukora-box/aukora/approval/render.mjs'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { ownerReview } from './owner-review.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const box = new URL('../../aukora-box/aukora/', import.meta.url)
const keyPair = () => {
  const pair = generateKeyPairSync('ed25519')
  return { ...pair, publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
}
const errorText = error => String(error?.reason ?? error?.message ?? error).slice(0, 500)
const makeDir = path => { mkdirSync(path, { recursive: true, mode: 0o700 }); return path }

function rpc(path, request, signal) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path)
    let input = '', finished = false
    const finish = (error, result) => {
      if (finished) return
      finished = true; signal?.removeEventListener('abort', abort); socket.destroy()
      if (error) reject(error); else resolve(result)
    }
    const abort = () => finish(new Error('adapter:cancelled'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) return abort()
    socket.setEncoding('utf8')
    socket.setTimeout(35_000, () => finish(new Error('adapter:issuer-timeout')))
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'))
    socket.on('data', chunk => {
      input += chunk
      if (Buffer.byteLength(input) > 512 * 1024) return finish(new Error('adapter:issuer-frame-too-large'))
      if (!input.includes('\n')) return
      try { finish(null, JSON.parse(input.slice(0, input.indexOf('\n')))) }
      catch (error) { finish(error) }
    })
    socket.on('error', error => finish(error))
    socket.on('end', () => finish(new Error('adapter:issuer-ended')))
  })
}

// The transport from caged-broker-effect: one JSON line -> real brokerDispatch.
// Bounds and a closed operation envelope restrict this instance to its one patch.
async function listen(path, handle, servers, sockets) {
  const server = createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.setEncoding('utf8')
    socket.setTimeout(10_000, () => socket.destroy())
    let input = '', handled = false
    socket.on('data', chunk => {
      if (handled) return socket.destroy()
      input += chunk
      if (Buffer.byteLength(input) > 512 * 1024) return socket.destroy()
      const end = input.indexOf('\n')
      if (end < 0) return
      handled = true
      if (input.slice(end + 1) !== '') return socket.destroy()
      socket.setTimeout(330_000, () => socket.destroy())
      Promise.resolve().then(() => handle(JSON.parse(input.slice(0, end))))
        .then(result => socket.end(JSON.stringify(result) + '\n'))
        .catch(error => socket.end(JSON.stringify({ ok: false, reason: errorText(error) }) + '\n'))
    })
  })
  servers.push(server)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve) })
  chmodSync(path, 0o600)
  const identity = lstatSync(path)
  return () => {
    try { const now = lstatSync(path); return server.listening && now.isSocket() && now.ino === identity.ino && now.dev === identity.dev && (now.mode & 0o077) === 0 }
    catch { return false }
  }
}

function receive(child, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      clearTimeout(timer); child.off('message', message); child.off('error', failed); child.off('exit', exited)
      if (error) reject(error); else resolve(value)
    }
    const message = value => { if (predicate(value)) finish(value.error ? new Error(value.error) : null, value) }
    const failed = error => finish(error)
    const exited = () => finish(new Error('adapter:worker-exited'))
    const timer = setTimeout(() => finish(new Error('adapter:worker-timeout')), timeoutMs)
    child.on('message', message); child.once('error', failed); child.once('exit', exited)
  })
}

export async function runPatch(settings, input, signal) {
  const args = captureWorkspacePatchArgs(input)
  if (!args || args.workspace !== 'selected') return { ok: false, state: 'REFUSED', reason: 'adapter:closed-patch-required', workerSpawns: 0 }
  if (signal?.aborted) return { ok: false, state: 'REFUSED', reason: 'adapter:cancelled', workerSpawns: 0 }
  const workspace = realpathSync.native(settings.workspace)
  const roots = { selected: workspace }
  try { preflightWorkspacePatch(roots, args) }
  catch (error) { return { ok: false, state: 'REFUSED', reason: errorText(error), workerSpawns: 0 } }
  const target = join(workspace, args.path)
  const temp = realpathSync.native(mkdtempSync('/private/tmp/aukora-worker-'))
  const stateDir = makeDir(join(settings.stateDir, temp.split('/').pop()))
  const servers = [], sockets = new Set(), children = [], background = []
  const stopping = new AbortController()
  let workerSpawns = 0, cageVerified = false, observations, predicted, reviewReason, bridgeInstalled = false, issuerAnswers = 0
  let approved, issuer, brokerRoute = () => false, issuerRoute = () => false
  const abort = () => {
    stopping.abort('adapter:cancelled')
    for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  signal?.addEventListener('abort', abort, { once: true })
  const expiry = setTimeout(abort, 330_000)
  const launch = child => {
    children.push({ child, closed: new Promise(resolve => { child.once('close', resolve); child.once('error', resolve) }) })
    child.once('error', abort)
    return child
  }
  try {
    const root = makeDir(join(temp, 'code'))
    const paths = { guestHome: makeDir(join(temp, 'guest')), activationHome: makeDir(join(temp, 'activation')),
      stateDir, brokerSocket: join(temp, 'b.sock'), issuerSocket: join(temp, 'i.sock') }
    for (const path of ['aukora', 'apps/cli/lib', 'apps/cli/node_modules', 'node_modules', 'packages', 'vendor']) makeDir(join(root, path))
    for (const path of ['profiles/8088-inside-out', 'profiles/node_modules']) makeDir(join(paths.activationHome, path))
    writeFileSync(join(root, 'package.json'), '{}\n', { mode: 0o600 })
    const entry = join(root, 'aukora', 'worker.mjs')
    const workerBytes = readFileSync(new URL('./worker.mjs', import.meta.url))
    writeFileSync(entry, workerBytes, { mode: 0o400, flag: 'wx' })
    const intake = join(stateDir, 'intake.json')
    const intakeBytes = JSON.stringify(args)
    writeFileSync(intake, intakeBytes, { mode: 0o400, flag: 'wx' })
    const issuerKey = keyPair(), brokerKey = keyPair()
    const keyPath = join(temp, 'issuer.pem')
    const privateBytes = issuerKey.privateKey.export({ format: 'pem', type: 'pkcs8' })
    writeFileSync(keyPath, privateBytes, { mode: 0o600, flag: 'wx' })
    if (Buffer.isBuffer(privateBytes)) privateBytes.fill(0)
    const activationDigest = hash(JSON.stringify({ worker: hash(workerBytes), workspace, intake: hash(intakeBytes) }))
    // Session-local broker identity, as in the proven foundation. It is not the
    // owner's hybrid root delegation; the actual owner authority is the signed
    // Aumlok review below. SAME_UID_AUTHORITIES and NO_PQ_SIGNATURE stay open.
    const pq = ml_dsa65.keygen(randomBytes(32))
    const publicKeys = { ed25519: Buffer.from(issuerKey.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex'),
      mlDsa65: Buffer.from(pq.publicKey).toString('hex') }
    pq.secretKey.fill(0)
    const initial = createIdentityGenesis({ genesisNonce: randomBytes(32).toString('hex'),
      initialRootKeySetId: rootKeySetId(publicKeys), amendmentRuleDigest: hash('aukora caged one-patch session') })
    const head = createInitialIdentityControl(initial, { suite: AUMLOK_ROOT_CONTROL_SUITE, publicKeys, authorizedAt: Date.now() })
    bindIdentityControlState(stateDir, head)
    bindActivation(stateDir, activationDigest)
    const activeControlDigest = identityControlDigest(head)
    const common = { subject: head.subject, controlDigest: activeControlDigest,
      childKeyId: receiptKeyIdForPublicKey(brokerKey.publicPem), operations: [WORKSPACE_PATCH],
      resources: [`workspace:file:selected:${args.path}`], audiences: ['aukora-caged-worker'],
      activationDigests: [activationDigest], budgets: { calls: 2, bytes: Buffer.byteLength(args.content), computeMs: 0, costMicrounits: 0 },
      notBefore: Math.floor(Date.now() / 1000) - 1, expiresAt: Math.floor(Date.now() / 1000) + 600,
      revocationId: 'one-patch-session', nonce: randomBytes(32).toString('hex') }
    const parent = createDelegationClaim({ ...common, kind: 'session', parentDigest: hash('aukora caged session parent') })
    const agent = createDelegationClaim({ ...common, kind: 'agent', parentDigest: delegationClaimDigest(parent),
      budgets: { ...common.budgets, calls: 1 }, nonce: randomBytes(32).toString('hex') })
    const realIssuerSocket = join(temp, 'issuer.sock')
    issuer = launch(spawn(process.execPath, ['--import', fileURLToPath(new URL('./noble-map.mjs', import.meta.url)),
      fileURLToPath(new URL('issuer/issuer.mjs', box))], { cwd: temp,
      env: { AUKORA_ISSUER_SOCKET: realIssuerSocket, AUKORA_ISSUER_KEY_FILE: keyPath,
        AUKORA_EXPECTED_RECEIPT_KEY_ID: common.childKeyId }, stdio: ['pipe', 'ignore', 'pipe', 'ipc'] }))
    for (let i = 0; !existsSync(realIssuerSocket); i++) {
      if (i > 100 || issuer.exitCode !== null || stopping.signal.aborted) throw new Error('adapter:issuer-start-failed')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const reviewOwner = ownerReview(settings.supportRoot, stateDir, target, args)
    let admitted = false, authorized = false
    issuerRoute = await listen(paths.issuerSocket, async message => {
      // brokerDispatch reaches this only AFTER review resolved 'approved'. The
      // closed digest/artifact checks also prevent a different issuer request.
      if (!approved || stopping.signal.aborted || message.digest !== approved.authorizationDigest
        || Date.now() >= approved.expiresAt * 1000) return { ok: false, reason: 'adapter:issuer-unreviewed' }
      if (message.op === 'admit.v5' && !admitted && Object.keys(message).length === 2) {
        admitted = true
        /* The issuer's typed challenge is DERIVED from the person's approval of
         * these same bytes in the existing Aumlok popup. It is NOT an independent
         * second confirmation, and no person typed it. The bridge translates the
         * verified review into issuer wire format; without approved review it is
         * unreachable and stdin remains untouched for the issuer to expire.
         * ISSUER_APPROVAL_CEILING_MS = 25_000. NO_PQ_SIGNATURE remains open.
         */
        installIssuerApprovalBridge(issuer, async (request, approvalSignal) => {
          if (approvalSignal.aborted || stopping.signal.aborted || issuerAnswers !== 0 || !approved
            || Date.now() >= approved.expiresAt * 1000
            || request.prompt !== renderApprovalArtifact(approved.artifact, request.challenge)) return 'unavailable'
          issuerAnswers++
          return 'approved'
        }, () => {}, abort)
        bridgeInstalled = true
      } else if (message.op === 'authorize.v5' && admitted && !authorized && Object.keys(message).length === 4
        && message.artifactDigest === approved.artifactDigest
        && JSON.stringify(message.artifact) === JSON.stringify(approved.artifact)) authorized = true
      else return { ok: false, reason: 'adapter:issuer-envelope-refused' }
      return rpc(realIssuerSocket, message, stopping.signal)
    }, servers, sockets)
    const dispatch = brokerDispatch({ stateDir, rootPublicKeyPem: issuerKey.publicPem, brokerKey,
      confinement: assertBootConfinement({ stateDir }),
      routeIsIntact: () => brokerRoute() && issuerRoute() && !stopping.signal.aborted,
      expectedActivationDigest: activationDigest, rendererId: hash(readFileSync(new URL('./owner-review.mjs', import.meta.url))),
      workspaceRoots: roots, issuerSocket: paths.issuerSocket, stoppingSignal: stopping.signal,
      subjectAuthority: { subject: head.subject, activeControlDigest, activationDigest,
        audience: 'aukora-caged-worker', parentDelegationClaim: parent, delegationClaim: agent },
      review: async (request, brokerSignal) => {
        try {
          predicted = buildOperation(request.artifact.operationArguments, request.expiresAt, WORKSPACE_PATCH)
          if (request.operationDigest !== operationDigest(predicted) || readFileSync(intake, 'utf8') !== intakeBytes) throw new Error('adapter:intake-changed')
          preflightWorkspacePatch(roots, args)
          const decision = await reviewOwner(request, brokerSignal)
          if (decision === 'approved' && !stopping.signal.aborted) approved = structuredClone(request)
          return stopping.signal.aborted ? 'denied' : decision
        } catch (error) { reviewReason = errorText(error); throw error }
      },
      startBackground: run => { background.push(Promise.resolve().then(run)) },
    })
    let namespace, proposalId, deposited = false
    brokerRoute = await listen(paths.brokerSocket, async message => {
      if (stopping.signal.aborted) return { ok: false, reason: BROKER_REFUSE.STOPPING }
      if (message.op === 'proposal.open' && !namespace && Object.keys(message).length === 1) {
        const result = await dispatch(message); namespace = result.proposalNamespace; return result
      }
      if (message.op === 'proposal.deposit' && namespace && message.proposalNamespace === namespace && !deposited
        && message.toolName === WORKSPACE_PATCH && message.callId === 'one-patch' && Object.keys(message).length === 5
        && JSON.stringify(captureWorkspacePatchArgs(message.arguments)) === intakeBytes && readFileSync(intake, 'utf8') === intakeBytes) {
        deposited = true
        const result = await dispatch(message); proposalId = result.proposalId; return result
      }
      if (message.op === 'proposal.status' && proposalId && message.proposalNamespace === namespace
        && message.proposalId === proposalId && Object.keys(message).length === 3) return dispatch(message)
      return { ok: false, state: 'REFUSED', reason: 'adapter:intake-envelope-refused' }
    }, servers, sockets)
    const policy = prepareGuestConfinement({ root, paths, issuerKey: keyPath })
    const env = { DSH_HOME: paths.activationHome, DSH_TELEMETRY_DISABLED: '1', HOME: policy.scratch, TMPDIR: policy.scratch,
      LANG: 'C', LC_ALL: 'C', __CF_USER_TEXT_ENCODING: `0x${process.geteuid().toString(16)}:0:0` }
    await verifyGuestConfinement(policy, env)
    cageVerified = true
    if (stopping.signal.aborted) throw new Error('adapter:cancelled')
    const ownerGit = join(homedir(), 'aukora-genesis', '.git', 'HEAD')
    const worker = launch(spawnConfinedGuest(policy, [entry, paths.brokerSocket, target, ownerGit, workspace], env))
    workerSpawns++
    let output = 0
    for (const stream of [worker.stdout, worker.stderr]) stream.on('data', chunk => { output += chunk.length; if (output > 8192) abort() })
    observations = await receive(worker, value => value.ready === true, 10_000)
    if (['workspace', 'git'].some(key => !['EPERM', 'EACCES'].includes(observations[key]))
      || ['read', 'write'].some(key => !['EPERM', 'EACCES', ...(args.beforeSha256 === null ? ['ENOENT'] : [])].includes(observations[key]))) {
      throw new Error('adapter:owner-path-not-denied')
    }
    const completed = receive(worker, value => Object.hasOwn(value, 'result') || Object.hasOwn(value, 'error'), 320_000)
    worker.send({ arguments: JSON.parse(readFileSync(intake, 'utf8')) })
    const { result } = await completed
    await Promise.all(background)
    const disk = existsSync(target) ? hash(readFileSync(target)) : null
    if (result.state === 'SETTLED' && (!approved || issuerAnswers !== 1 || result.receipt.contentSha256 !== predicted.contentSha256
      || disk !== predicted.contentSha256 || readSettlementHead(stateDir) !== 1)) throw new Error('adapter:settlement-mismatch')
    return { ...result, cageVerified, workerSpawns, observations, bridgeInstalled, issuerAnswers,
      predicted: predicted?.contentSha256, disk, effects: readSettlementHead(stateDir), reviewReason,
      approverDid: approved ? JSON.parse(readFileSync(join(stateDir, 'owner-approval.json'))).approvalKeyDid : undefined,
      stateDir, ceiling: 'MACOS_SEATBELT_GUEST / SAME_UID_AUTHORITIES / NO_PQ_SIGNATURE' }
  } catch (error) {
    return { ok: false, state: approved || readSettlementHead(stateDir) ? 'INDETERMINATE' : 'REFUSED', reason: errorText(error),
      cageVerified, workerSpawns, observations, bridgeInstalled, issuerAnswers, reviewReason, stateDir }
  } finally {
    clearTimeout(expiry); signal?.removeEventListener('abort', abort); stopping.abort('adapter:closed')
    for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    for (const socket of sockets) socket.destroy()
    await Promise.all(children.map(({ closed }) => closed))
    await Promise.all(servers.filter(server => server.listening).map(server => new Promise(resolve => server.close(resolve))))
    rmSync(temp, { recursive: true, force: true })
  }
}
