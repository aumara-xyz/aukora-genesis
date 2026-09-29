/**
 * Run: node scripts/aukora/caged-broker-effect.mjs
 * REAL: the box's unchanged cage generator/verifier, brokerDispatch, v5 grant
 * verifier, durable nonce book and workspace.patch executor. A keyless client
 * runs inside Seatbelt; the broker and ephemeral issuer remain outside it.
 * FIXTURE: every supplied code/home/state path, socket, workspace and target;
 * the socket bridge, review callback and ephemeral signing keys. Setup follows
 * tests/broker-grant.test.mjs arm 7, using its committed noble-map resolver.
 *
 * Workspace grants are PRIVATE to the real proposal flow, not client inputs.
 * GOOD uses unchanged broker code. Negative grant arms inject a fault at its
 * private authorization-to-settlement handoff using a process-local load hook.
 * They exercise real guards, not a public supplied-grant workspace API (none
 * exists). Guard-removal children change loaded text only, never sealed files.
 * Replay uses an exact captured grant and a same-content patch so that the
 * earlier preimage check cannot mask nonce replay; file identity detects even
 * an identical second write. Second authorization means changed arguments
 * under a previously successful callId; identical retries are idempotent.
 *
 * This is not the delegation path and is not called by the app. It does not
 * build the three-service topology or separate same-UID trusted authorities.
 * No real owner state, signer or approval is used. NO_PQ_SIGNATURE stays open.
 * Exit 0: all arms AND their removal probes ran; 1: FAILED; 2: NOT RUN (no proof).
 * CAGED_BROKER_TRACE=1 prints entry/exit of awaited fixture stages. Public
 * --case runs are supervised too: a 20s SIGKILL deadline names CASE_DEADLINE.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import '../../tests/noble-map.mjs'
import { prepareGuestConfinement, verifyGuestConfinement, spawnConfinedGuest } from '../../plugins/aukora-box/aukora/supervisor/guest-confinement.mjs'

const unrestricted = '(version 1)\n(allow default)\n'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const oneLine = error => String(error?.message ?? error).replace(/\s+/gu, ' ').slice(0, 500)
const box = new URL('../../plugins/aukora-box/aukora/', import.meta.url)
const cases = ['GOOD', 'NO_GRANT', 'REPLAYED', 'WRONG_OPERATION', 'SECOND_AUTHORIZATION']
const caseDeadlineMs = 20_000
const fixtureReview = 'FIXTURE_ONLY_AUTO_APPROVE; no person or installed review'
const waiting = new Set()
async function observedAwait(label, run) {
  waiting.add(label)
  const trace = message => { if (process.env.CAGED_BROKER_TRACE === '1') console.log(`CAGED BROKER: TRACE ${message}`) }
  trace(`BEGIN ${label}`)
  try { return await run() }
  catch (error) { trace(`REJECT ${label}: ${oneLine(error)}`); throw error }
  finally { waiting.delete(label); trace(`END ${label}`) }
}
const handoff = 'grant: authorized.grant,'
const removals = {
  NO_GRANT: ['broker/broker.mjs',
    "if (grant === undefined || grant === null) return { ok: false, state: 'REFUSED', reason: REFUSE.NO_GRANT }", ''],
  REPLAYED: ['host-dsh/src/grant-v5.mjs',
    'if (result === false) return refusal(REFUSE.REPLAYED)',
    'if (result === false) return verified'],
  WRONG_OPERATION: ['host-dsh/src/grant-v5.mjs',
    'if (claims.operationDigest !== params.expectedOperationDigest) return refusal(REFUSE.OPERATION_MISMATCH)', ''],
  SECOND_AUTHORIZATION: ['broker/broker.mjs',
    `    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return proposalRefusal(BROKER_REFUSE.PROPOSAL_CALL_ID_REUSED)
      }
      return publicProposal(existing)
    }`, ''],
}

// The fixture hook supplies bad INPUTS to settlement, without removing a guard.
// Separate --remove-guard children remove exactly one protection as kill probes.
function installHook(arm, removeGuard) {
  const edits = []
  if (['NO_GRANT', 'REPLAYED', 'WRONG_OPERATION'].includes(arm)) {
    edits.push(['broker/broker.mjs', handoff,
      'grant: globalThis.__cagedBrokerFixtureGrant(authorized.grant),'])
  }
  if (removeGuard) edits.push(removals[arm])
  const applied = new Set()
  registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context)
    let source
    for (const [index, [relative, before, after]] of edits.entries()) {
      if (url !== new URL(relative, box).href) continue
      source ??= typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8')
      assert.equal(source.split(before).length, 2, `non-unique fixture hook: ${arm}/${index}`)
      source = source.replace(before, after)
      applied.add(index)
    }
    return source === undefined ? loaded : { ...loaded, source }
  } })
  return () => assert.equal(applied.size, edits.length, 'a requested fixture hook never loaded')
}

function admission() {
  if (process.platform !== 'darwin') return 'not macOS'
  const result = spawnSync('/usr/bin/sandbox-exec', ['-p', unrestricted, '--', '/usr/bin/true'],
    { env: { LANG: 'C', LC_ALL: 'C' }, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' })
  if (result.error?.code === 'ETIMEDOUT') throw new Error('ADMISSION_DEADLINE: sandbox-exec exceeded 5000ms; SIGKILL')
  if (!result.error && result.status !== 0
    && result.stderr.trim() === 'sandbox-exec: sandbox_apply: Operation not permitted') {
    return 'nested sandbox: sandbox-exec: sandbox_apply: Operation not permitted'
  }
  assert.ifError(result.error)
  assert.equal(result.status, 0, `sandbox admission failed: ${result.stderr}`)
  return null
}

// Serialized into the fixture's permitted read tree; no key or broker imports.
async function guest() {
  const { readFileSync, writeFileSync } = await import('node:fs')
  const { createConnection } = await import('node:net')
  const [socketPath, target] = process.argv.slice(2)
  const attempt = fn => { try { fn(); return 'ALLOWED' } catch (error) { return error.code } }
  process.send({ ready: true,
    read: attempt(() => readFileSync(target)),
    write: attempt(() => writeFileSync(target, 'UNAUTHORIZED\n')) })
  process.on('message', ({ id, request, shutdown }) => {
    if (shutdown === true) return process.disconnect()
    const socket = createConnection(socketPath)
    let input = ''
    let replied = false
    const reply = message => {
      if (replied) return
      replied = true
      socket.destroy()
      process.send({ id, ...message })
    }
    socket.setEncoding('utf8')
    socket.setTimeout(8000, () => reply({ error: 'broker socket timed out' }))
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'))
    socket.on('data', chunk => {
      input += chunk
      if (!input.includes('\n')) return
      try { reply({ result: JSON.parse(input.slice(0, input.indexOf('\n'))) }) }
      catch (error) { reply({ error: error.message }) }
    })
    socket.on('error', error => reply({ error: error.code }))
    socket.on('end', () => { if (!replied) reply({ error: 'broker ended without a reply' }) })
  })
  process.on('disconnect', () => process.exit(0))
}

async function runCase(arm, removeGuard) {
  const assertHooks = installHook(arm, removeGuard)
  const [broker, grants, v5, nonces, operations, effects, confinement, control, genesis,
    delegation, identity, activation, { ml_dsa65 }] = await observedAwait('imports', () => Promise.all([
    import(new URL('broker/broker.mjs', box)), import(new URL('host-dsh/src/grant.mjs', box)),
    import(new URL('host-dsh/src/grant-v5.mjs', box)), import(new URL('host-dsh/src/nonce-book.mjs', box)),
    import(new URL('broker/operation.mjs', box)), import(new URL('broker/effect-definition.mjs', box)),
    import(new URL('broker/confinement.mjs', box)), import(new URL('identity/control.mjs', box)),
    import(new URL('identity/genesis.mjs', box)), import(new URL('identity/delegation.mjs', box)),
    import(new URL('identity/broker-state.mjs', box)), import(new URL('activation/broker-state.mjs', box)),
    import('@noble/post-quantum/ml-dsa.js'),
  ]))
  assertHooks()
  assert.ok(Object.isFrozen(grants.REFUSE) && Object.isFrozen(broker.BROKER_REFUSE))
  assert.equal(Object.keys(grants.REFUSE).length, 17)
  const expected = { NO_GRANT: grants.REFUSE.NO_GRANT, REPLAYED: grants.REFUSE.REPLAYED,
    WRONG_OPERATION: grants.REFUSE.OPERATION_MISMATCH,
    SECOND_AUTHORIZATION: broker.BROKER_REFUSE.PROPOSAL_CALL_ID_REUSED }
  const temp = realpathSync.native(mkdtempSync('/private/tmp/acbe-'))
  const sockets = new Set(), servers = [], background = [], errors = []
  let child, closed
  try {
    const root = join(temp, 'code'), workspace = join(temp, 'workspace')
    const target = join(workspace, 'target.txt')
    const paths = { guestHome: join(temp, 'guest'), activationHome: join(temp, 'activation'),
      stateDir: join(temp, 'state'), brokerSocket: join(temp, 'b.sock'), issuerSocket: join(temp, 'i.sock') }
    for (const path of [workspace, paths.guestHome, paths.stateDir,
      ...['aukora', 'apps/cli/lib', 'apps/cli/node_modules', 'node_modules', 'packages', 'vendor'].map(p => join(root, p)),
      ...['profiles/8088-inside-out', 'profiles/node_modules'].map(p => join(paths.activationHome, p))]) {
      mkdirSync(path, { recursive: true, mode: 0o700 })
    }
    writeFileSync(join(root, 'package.json'), '{}\n', { mode: 0o600 })
    writeFileSync(target, 'before\n', { mode: 0o600 })
    const marker = join(temp, 'public-canary') // Never a real key.
    writeFileSync(marker, 'public-test-marker-not-a-key\n', { mode: 0o600 })
    const entry = join(root, 'aukora', 'client.mjs')
    writeFileSync(entry, `await (${guest.toString()})()\n`, { mode: 0o600 })
    const keyPair = () => {
      const pair = generateKeyPairSync('ed25519')
      return { ...pair, publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
    }
    const issuerKey = keyPair(), brokerKey = keyPair()
    const args = { workspace: 'proof', path: 'target.txt', beforeSha256: hash(readFileSync(target)),
      content: arm === 'REPLAYED' ? 'before\n' : 'authorized replacement\n' }
    const activationDigest = hash('caged broker fixture activation')
    const pq = ml_dsa65.keygen(randomBytes(32))
    const publicKeys = {
      ed25519: Buffer.from(issuerKey.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex'),
      mlDsa65: Buffer.from(pq.publicKey).toString('hex'),
    }
    pq.secretKey.fill(0)
    const initial = genesis.createIdentityGenesis({ genesisNonce: randomBytes(32).toString('hex'),
      initialRootKeySetId: control.rootKeySetId(publicKeys), amendmentRuleDigest: hash('fixture rule') })
    const head = control.createInitialIdentityControl(initial, {
      suite: control.AUMLOK_ROOT_CONTROL_SUITE, publicKeys, authorizedAt: Date.now() })
    identity.bindIdentityControlState(paths.stateDir, head)
    activation.bindActivation(paths.stateDir, activationDigest)
    const activeControlDigest = control.identityControlDigest(head)
    const common = { subject: head.subject, controlDigest: activeControlDigest,
      childKeyId: grants.receiptKeyIdForPublicKey(brokerKey.publicPem), operations: [effects.WORKSPACE_PATCH],
      resources: ['workspace:file:proof:target.txt'], audiences: ['caged-broker-effect'],
      activationDigests: [activationDigest], budgets: { calls: 2, bytes: 1024, computeMs: 0, costMicrounits: 0 },
      notBefore: Math.floor(Date.now() / 1000) - 1, expiresAt: Math.floor(Date.now() / 1000) + 600,
      revocationId: 'fixture-session', nonce: randomBytes(32).toString('hex') }
    const parent = delegation.createDelegationClaim({ ...common, kind: 'session', parentDigest: hash('fixture parent') })
    const agent = delegation.createDelegationClaim({ ...common, kind: 'agent',
      parentDigest: delegation.delegationClaimDigest(parent), budgets: { ...common.budgets, calls: 1 },
      nonce: randomBytes(32).toString('hex') })
    let reviewed, predicted, captured, handoffs = 0, reviews = 0
    const issuerCalls = []
    globalThis.__cagedBrokerFixtureGrant = grant => {
      handoffs++
      if (arm === 'NO_GRANT') return null
      if (arm === 'REPLAYED') { captured ??= structuredClone(grant); return captured }
      const { signature, ...claims } = grant
      claims.operationDigest = hash('wrong fixture operation')
      return { ...claims, signature: sign(null,
        v5.authorizationSignedMessageV5FromHex(v5.authorizationDigestV5(claims)),
        issuerKey.privateKey).toString('base64') }
    }
    // Disposable transport only: every frame is forwarded to real brokerDispatch.
    const listen = async (path, handle) => {
      const server = createServer(socket => {
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
        socket.on('error', error => errors.push(error))
        socket.setEncoding('utf8')
        let input = '', handled = false
        socket.on('data', chunk => {
          input += chunk
          if (handled || !input.includes('\n')) return
          handled = true
          Promise.resolve().then(() => {
            const message = JSON.parse(input.slice(0, input.indexOf('\n')))
            return observedAwait(`fixture transport ${message.op}`, () => handle(message))
          })
            .then(result => socket.end(JSON.stringify(result) + '\n'))
            .catch(error => { errors.push(error); socket.destroy() })
        })
      })
      servers.push(server)
      await observedAwait(`listen ${path.endsWith('i.sock') ? 'issuer' : 'broker'}`, () =>
        new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve) }))
    }
    await listen(paths.issuerSocket, message => {
      issuerCalls.push(message.op)
      assert.equal(message.digest, reviewed.authorizationDigest)
      if (message.op === 'admit.v5') return { ok: true }
      assert.equal(message.op, 'authorize.v5')
      assert.deepEqual(message.artifact, reviewed.artifact)
      assert.equal(message.artifactDigest, reviewed.artifactDigest)
      return { ok: true, digest: message.digest,
        signature: sign(null, v5.authorizationSignedMessageV5FromHex(message.digest), issuerKey.privateKey).toString('base64') }
    })
    const dispatch = broker.brokerDispatch({ stateDir: paths.stateDir, rootPublicKeyPem: issuerKey.publicPem,
      brokerKey, confinement: confinement.assertBootConfinement({ stateDir: paths.stateDir }),
      routeIsIntact: () => true, // Fixture bridge, not a measured product socket route.
      expectedActivationDigest: activationDigest, rendererId: hash('fixture renderer'),
      workspaceRoots: { proof: workspace }, issuerSocket: paths.issuerSocket,
      subjectAuthority: { subject: head.subject, activeControlDigest, activationDigest,
        audience: 'caged-broker-effect', parentDelegationClaim: parent, delegationClaim: agent },
      review: async function FIXTURE_ONLY_AUTO_APPROVE(review) {
        return observedAwait('FIXTURE_ONLY_AUTO_APPROVE', () => {
          reviews++
          reviewed = review
          predicted = operations.buildOperation(review.artifact.operationArguments, review.expiresAt, effects.WORKSPACE_PATCH)
          assert.equal(review.operationDigest, operations.operationDigest(predicted))
          assert.equal(hash(readFileSync(target)), review.artifact.operationArguments.beforeSha256)
          return 'approved' // FIXTURE ONLY: unconditional synthetic decision, never owner approval.
        })
      },
      startBackground: run => { background.push(observedAwait('fixture background task', () => Promise.resolve().then(run))) },
    })
    await listen(paths.brokerSocket, dispatch)
    const policy = prepareGuestConfinement({ root, paths, issuerKey: marker })
    const env = { DSH_HOME: paths.activationHome, DSH_TELEMETRY_DISABLED: '1',
      HOME: policy.scratch, TMPDIR: policy.scratch, LANG: 'C', LC_ALL: 'C',
      __CF_USER_TEXT_ENCODING: `0x${process.geteuid().toString(16)}:0:0` }
    let workerSpawns = 0
    const start = async candidate => {
      try { await observedAwait(`verify cage ${candidate === policy ? 'confined' : 'unrestricted'}`, () => verifyGuestConfinement(candidate, env)) }
      catch (error) { return { error } }
      workerSpawns++
      return { child: spawnConfinedGuest(candidate, [entry, paths.brokerSocket, target], env) }
    }
    if (arm === 'GOOD') {
      const refused = await start({ ...policy, text: unrestricted })
      assert.equal(refused.error?.reason, 'confined:enforcement-unavailable')
      assert.equal(workerSpawns, 0, 'unverified cage spawned an effect client')
      assert.equal(broker.readSettlementHead(paths.stateDir), 0)
      assert.equal(readFileSync(target, 'utf8'), 'before\n')
      console.log(`CAGED BROKER: CAGE_PROBE ${refused.error.reason}; workerSpawns=${workerSpawns}`)
    }
    const started = await start(policy)
    assert.ifError(started.error)
    child = started.child
    closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
    let stderr = '', stdout = '', serial = 0
    child.stderr.on('data', chunk => { stderr += chunk })
    child.stdout.on('data', chunk => { stdout += chunk })
    const receive = id => new Promise((resolve, reject) => {
      const finish = (error, result) => {
        clearTimeout(timer); child.off('message', onMessage); child.off('error', onError); child.off('exit', onExit)
        if (error) reject(error); else resolve(result)
      }
      const onMessage = message => {
        if (id === null ? message.ready : message.id === id) {
          finish(message.error ? new Error(message.error) : null, id === null ? message : message.result)
        }
      }
      const onError = error => finish(error)
      const onExit = (code, signal) => finish(new Error(`caged client exited ${code}/${signal}: ${stderr}`))
      const timer = setTimeout(() => finish(new Error('caged client response timed out')), 10000)
      child.on('message', onMessage); child.once('error', onError); child.once('exit', onExit)
    })
    const ready = await observedAwait('guest ready', () => receive(null))
    for (const kind of ['read', 'write']) assert.ok(['EPERM', 'EACCES'].includes(ready[kind]), `protected ${kind}: ${ready[kind]}`)
    assert.equal(readFileSync(target, 'utf8'), 'before\n')
    console.log(`CAGED BROKER: ${arm} cage verified; direct read=${ready.read} write=${ready.write}`)
    const call = request => {
      const id = ++serial, reply = receive(id)
      child.send({ id, request })
      return observedAwait(`guest reply ${request.op}`, () => reply)
    }
    const opened = await call({ op: 'proposal.open' })
    assert.equal(opened.ok, true)
    const deposit = (callId, arguments_) => ({ op: 'proposal.deposit', proposalNamespace: opened.proposalNamespace,
      callId, toolName: effects.WORKSPACE_PATCH, arguments: arguments_ })
    const settle = async request => {
      const pending = await call(request)
      if (pending.state !== 'PENDING') return pending
      await observedAwait('broker background', () => Promise.all(background))
      return call({ op: 'proposal.status', proposalNamespace: opened.proposalNamespace, proposalId: pending.proposalId })
    }
    const snapshot = () => {
      const stat = statSync(target, { bigint: true })
      return { bytes: readFileSync(target), inode: stat.ino, mtime: stat.mtimeNs,
        head: broker.readSettlementHead(paths.stateDir), nonces: [...nonces.openNonceBook(paths.stateDir).set].sort() }
    }
    const good = async () => {
      const before = snapshot()
      const result = await settle(deposit('first', args))
      assert.equal(result.ok, true, `GOOD: ${result.reason ?? result.state}`)
      assert.equal(result.state, 'SETTLED')
      assert.equal(result.receipt.path, target)
      assert.equal(result.receipt.contentSha256, predicted.contentSha256)
      assert.equal(hash(readFileSync(target)), predicted.contentSha256)
      assert.deepEqual(readFileSync(target), Buffer.from(args.content))
      assert.equal(result.receipt.bytes, Buffer.byteLength(args.content))
      const after = snapshot()
      assert.notEqual(after.inode, before.inode, 'GOOD never replaced the target')
      assert.equal(after.head, 1)
      assert.equal(after.nonces.length, 1)
      assert.deepEqual(issuerCalls, ['admit.v5', 'authorize.v5'])
      assert.equal(reviews, 1)
      console.log(`CAGED BROKER: ${arm} GOOD SETTLED; predicted=${predicted.contentSha256} disk=${hash(after.bytes)}; effects=1`)
    }
    if (['GOOD', 'REPLAYED', 'SECOND_AUTHORIZATION'].includes(arm)) await good()
    if (arm !== 'GOOD') {
      const before = snapshot(), beforeReviews = reviews, beforeIssuer = issuerCalls.length
      const request = arm === 'SECOND_AUTHORIZATION'
        ? deposit('first', { ...args, beforeSha256: hash(before.bytes), content: 'second unauthorized effect\n' })
        : deposit(arm, args)
      const result = await settle(request)
      const after = snapshot()
      const unchanged = before.bytes.equals(after.bytes) && before.inode === after.inode
        && before.mtime === after.mtime && before.head === after.head
        && JSON.stringify(before.nonces) === JSON.stringify(after.nonces)
      console.log(`CAGED BROKER: ${arm} observed=${result.reason ?? result.state}; state=${result.state}; unchanged=${unchanged}; effects=${after.head}`)
      assert.equal(result.ok, false, `${arm}: unauthorized effect admitted`)
      assert.equal(result.state, 'REFUSED', `${arm}: not a clean refusal`)
      assert.equal(result.reason, expected[arm], `${arm}: wrong refusal code`)
      assert.deepEqual(after, before, `${arm}: target identity, bytes, settlement or nonce book changed`)
      if (arm === 'SECOND_AUTHORIZATION') {
        assert.equal(reviews, beforeReviews, 'second review occurred')
        assert.equal(issuerCalls.length, beforeIssuer, 'second issuer authorization occurred')
      } else assert.equal(handoffs, arm === 'REPLAYED' ? 2 : 1, 'grant fault did not reach settlement')
    }
    assert.deepEqual(errors, [], `fixture socket errors: ${errors.map(oneLine).join('; ')}`)
    // Let guest IPC EOF reach the parent: Node 22 parent-side disconnect can
    // leave the child's close count short even after exit and both pipes close.
    child.send({ shutdown: true })
    const exit = await observedAwait('guest close', () => closed)
    assert.deepEqual(exit, { code: 0, signal: null })
    assert.equal(stderr, '')
    assert.equal(stdout, '')
    console.log(`CAGED BROKER: ${arm} assertions complete`)
  } catch (error) {
    console.log(`CAGED BROKER: ${arm} error before cleanup: ${oneLine(error)}; ${fixtureReview}`)
    throw error
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await observedAwait('cleanup guest close', () => closed) }
    for (const socket of sockets) socket.destroy()
    for (const [index, server] of servers.entries()) if (server.listening) await observedAwait(`cleanup server ${index} close`, () => new Promise(resolve => server.close(resolve)))
    delete globalThis.__cagedBrokerFixtureGrant
    rmSync(temp, { recursive: true, force: true })
  }
}

async function main() {
  const blocked = admission()
  if (blocked !== null) {
    console.log(`CAGED BROKER: NOT RUN (${blocked}; exit 2, no proof)`)
    process.exitCode = 2
    return
  }
  const [, , mode, arm, flag] = process.argv
  if (mode === '--case-worker' || mode === '--case') {
    assert.ok(cases.includes(arm), 'unknown case')
    assert.ok(flag === undefined || (flag === '--remove-guard' && arm !== 'GOOD'), 'unknown probe')
    if (mode === '--case-worker') {
      console.log(`CAGED BROKER: ${arm}${flag ? ' guard-removal' : ''} ${fixtureReview}`)
      // Exit directly: throwing into a stuck finally would recreate the deadlock.
      const timer = setTimeout(() => {
        writeSync(1, `CAGED BROKER: FAIL ${arm}: CASE_DEADLINE; waiting=${[...waiting].join('; ') || 'case body'}; ${fixtureReview}\n`)
        process.exit(1)
      }, caseDeadlineMs - 1000)
      try { await runCase(arm, flag === '--remove-guard') }
      catch (error) { console.log(`CAGED BROKER: FAIL ${arm}: ${oneLine(error)}; ${fixtureReview}`); process.exitCode = 1 }
      finally { clearTimeout(timer) }
      return
    }
  }
  assert.ok(mode === undefined || mode === '--case', 'unexpected argument')
  const env = { ...process.env }
  for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_REPL_EXTERNAL_MODULE', 'ELECTRON_RUN_AS_NODE']) delete env[name]
  const run = (arm, probe = false) => {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--case-worker', arm,
      ...(probe ? ['--remove-guard'] : [])], { env, encoding: 'utf8', timeout: caseDeadlineMs, killSignal: 'SIGKILL' })
    process.stdout.write(result.stdout ?? '')
    if (result.error?.code === 'ETIMEDOUT') {
      throw new Error(`CASE_DEADLINE ${arm}${probe ? ' guard-removal' : ''}: ${caseDeadlineMs}ms; worker SIGKILL; ${fixtureReview}`)
    }
    assert.ifError(result.error)
    assert.equal(result.signal, null)
    assert.equal(result.stderr, '', `${arm}: child stderr: ${result.stderr}`)
    return result
  }
  if (mode === '--case') {
    process.exitCode = run(arm, flag === '--remove-guard').status
    return
  }
  for (const arm of cases) {
    const result = run(arm)
    assert.equal(result.status, 0, `${arm}: primary exited ${result.status}; NOT RUN is not green`)
    assert.ok(result.stdout.includes(`CAGED BROKER: ${arm} assertions complete`))
    if (arm === 'GOOD') continue
    const probe = run(arm, true)
    assert.equal(probe.status, 1, `${arm}: guard removal did not fail`)
    assert.ok(probe.stdout.includes(`CAGED BROKER: FAIL ${arm}: ${arm}:`), `${arm}: unrelated failure cannot kill a mutation: ${probe.stdout}`)
    const observation = probe.stdout.split('\n').find(line => line.startsWith(`CAGED BROKER: ${arm} observed=`))
    assert.ok(observation, `${arm}: mutation never reached the refusal assertion`)
    if (arm === 'NO_GRANT') {
      assert.ok(observation.includes('observed=broker:proposal-internal-failure; state=INDETERMINATE; unchanged=true; effects=0'))
    } else {
      assert.ok(observation.includes('observed=SETTLED; state=SETTLED; unchanged=false;'), `${arm}: removed guard did not admit an effect`)
    }
    console.log(`CAGED BROKER: ${arm} guard removal -> exit ${probe.status}; ${observation}`)
  }
  console.log('CAGED BROKER: 5/5 arms + cage refusal probe + 4/4 guard-removal probes; all ran')
}

try { await main() }
catch (error) { console.log(`CAGED BROKER: FAILED ${oneLine(error)}`); process.exitCode = 1 }
