/**
 * Broker aperture proof. Run: node tests/broker-grant.test.mjs
 *
 * No installed app, real signer, or real state is involved. This does not prove
 * same-UID isolation. Primary arms import unchanged modules from the sealed box;
 * guard-removal probes alter loaded text only inside separate test processes.
 *
 * Supplied grants enter brokerDispatch through memory.put (v3), so arms 1–6
 * exercise that real route and its on-disk key projection/content objects.
 * The key-resource arm proves payload binding, not v5's separate resource field.
 * Workspace grants are constructed privately by the v5 proposal flow; arm 7
 * follows that flow with an ephemeral issuer and a test-only review callback.
 * Call paths: broker/broker.mjs -> host-dsh/src/grant{,-v5}.mjs ->
 * host-dsh/src/nonce-book.mjs -> broker/{effect,workspace-patch}.mjs.
 * BROKER_REFUSE membership and grant-aware preflight are required literally;
 * missing support is FAIL/blocked, never a skip or an invented success.
 */
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync,
  lstatSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const names = [
  'no grant (memory.put)', 'expired grant (memory.put)',
  'operation digest mismatch (memory.put)', 'different key resource (memory.put)',
  'replayed grant (memory.put)', 'wrong signing key (memory.put)',
  'authorized workspace.patch with exact before/after hashes',
  'grant-aware preflight without disk writes', 'refusals belong to BROKER_REFUSE',
  'missing @noble fails loudly',
]
let passed = 0
let failed = 0
let checkRemoval = null
const observations = []
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const oneLine = error => String(error?.message ?? error).replace(/\s+/gu, ' ')

async function arm(index, run) {
  try {
    let detail = await run()
    if (checkRemoval !== null && index < 6) {
      checkRemoval(index)
      detail = `${detail}; guard removal -> FAIL ${index + 1}`
    }
    passed++
    console.log(`ok ${index + 1} ${names[index]}${detail ? `: ${detail}` : ''}`)
  } catch (error) {
    failed++
    console.log(`FAIL ${index + 1} ${names[index]}: ${oneLine(error)}`)
  }
}

// Dynamic imports ensure missing crypto produces our loud diagnostic and a
// failing summary, instead of skipping the broker and printing a green count.
const packages = ['@noble/curves/ed25519.js', '@noble/post-quantum/ml-dsa.js']
const dependencies = await Promise.allSettled(packages.map(name => import(name)))
const missing = dependencies.flatMap((result, i) => result.status === 'rejected'
  ? [`${packages[i]} (${result.reason?.code ?? 'import failed'})`] : [])
let modules
let startupFailure = missing.length ? `required crypto dependency unavailable: ${missing.join(', ')}` : null
if (startupFailure === null) {
  try {
    modules = await Promise.all([
      import('../plugins/aukora-box/aukora/broker/broker.mjs'),
      import('../plugins/aukora-box/aukora/host-dsh/src/grant.mjs'),
      import('../plugins/aukora-box/aukora/host-dsh/src/grant-v5.mjs'),
      import('../plugins/aukora-box/aukora/host-dsh/src/nonce-book.mjs'),
      import('../plugins/aukora-box/aukora/broker/operation.mjs'),
      import('../plugins/aukora-box/aukora/broker/effect-definition.mjs'),
      import('../plugins/aukora-box/aukora/broker/confinement.mjs'),
      import('../plugins/aukora-box/aukora/identity/control.mjs'),
      import('../plugins/aukora-box/aukora/identity/genesis.mjs'),
      import('../plugins/aukora-box/aukora/identity/delegation.mjs'),
      import('../plugins/aukora-box/aukora/identity/broker-state.mjs'),
      import('../plugins/aukora-box/aukora/activation/broker-state.mjs'),
    ])
  } catch (error) {
    startupFailure = `real broker import failed: ${oneLine(error)}`
  }
}

if (startupFailure !== null) {
  for (let i = 0; i < names.length; i++) await arm(i, () => { throw new Error(startupFailure) })
} else {
  const [broker, grants, grantsV5, nonces, operations, effects, confinement,
    control, genesis, delegation, identityState, activation] = modules
  const { ml_dsa65 } = dependencies[1].value
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bg-')))
  const refusalCodes = new Set(Object.values(broker.BROKER_REFUSE))

  // Fault injection applies only to module text loaded in separate temporary
  // test processes. No source is copied into this test or written back to the
  // sealed box. The ordinary run above imports the original modules unchanged.
  // Require the PARTICULAR arm to go red: unrelated blocked arms cannot count
  // as a killed mutation merely because they already make the child exit 1.
  const removals = [
    ['broker/broker.mjs',
      "if (grant === undefined || grant === null) return { ok: false, state: 'REFUSED', reason: REFUSE.NO_GRANT }", ''],
    ['host-dsh/src/grant.mjs',
      'if (claims.exp * 1000 <= now) return { ok: false, reason: REFUSE.EXPIRED }', ''],
    ['host-dsh/src/grant.mjs',
      'if (claims.operationDigest !== expectedOperationDigest) {', 'if (false) {'],
    ['host-dsh/src/grant.mjs',
      'if (claims.digest !== digest) return { ok: false, reason: REFUSE.PAYLOAD_MISMATCH }\n' +
      '  if (claims.operationDigest !== expectedOperationDigest) {\n' +
      '    return { ok: false, reason: REFUSE.OPERATION_MISMATCH }\n' +
      '  }', ''], // Both signed bindings cover the destination key.
    ['host-dsh/src/grant.mjs',
      'if (claimResult === false) return { ok: false, reason: REFUSE.REPLAYED }',
      'if (claimResult === false) return verified'], // Disable replay, not uncertainty handling.
    ['host-dsh/src/grant.mjs',
      'if (!ok) return { ok: false, reason: REFUSE.BAD_SIGNATURE }', ''],
  ]
  if (!process.argv.includes('--guard-removal-probe')) {
    checkRemoval = index => {
      const [relative, before, after] = removals[index]
      const target = new URL(`../plugins/aukora-box/aukora/${relative}`, import.meta.url).href
      const hook = `import { registerHooks } from 'node:module';\n` +
        `registerHooks({ load(url, context, nextLoad) {\n` +
        `const loaded = nextLoad(url, context);\n` +
        `if (url !== ${JSON.stringify(target)}) return loaded;\n` +
        `const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');\n` +
        `const before = ${JSON.stringify(before)};\n` +
        `if (source.split(before).length !== 2) throw new Error('guard removal anchor is not unique');\n` +
        `return { ...loaded, source: source.replace(before, ${JSON.stringify(after)}) };\n` +
        `} });\n`
      const hookFile = join(root, `remove-${index + 1}.mjs`)
      writeFileSync(hookFile, hook, { mode: 0o600 })
      const env = { ...process.env }
      delete env.NODE_OPTIONS
      delete env.NODE_PATH
      const child = spawnSync(process.execPath,
        ['--import', hookFile, fileURLToPath(import.meta.url), '--guard-removal-probe'],
        { cwd: root, env, encoding: 'utf8', timeout: 20_000 })
      assert.equal(child.error, undefined, `guard-removal child failed to run: ${child.error?.code}`)
      assert.equal(child.status, 1, 'guard-removal child did not fail')
      assert.match(child.stdout, new RegExp(`^FAIL ${index + 1} `, 'm'),
        `guard removal did not turn arm ${index + 1} red`)
      const failedLine = child.stdout.split('\n').find(line => line.startsWith(`FAIL ${index + 1} `))
      assert.ok(index === 0 ? failedLine.includes("reading 'exp'")
        : failedLine.includes('target or broker state changed'),
      `guard removal did not expose the expected missing refusal/effect in arm ${index + 1}`)
      assert.match(child.stdout, /^ok 10 /mu, 'guard-removal child did not exercise real crypto startup')
      assert.doesNotMatch(child.stdout, /real broker import failed/u)
    }
  }

  function keyPair() {
    const pair = generateKeyPairSync('ed25519')
    return { ...pair, publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
  }

  // Snapshot bytes AND file identities: an unauthorized identical rewrite must
  // not pass merely because its hash stayed the same. Directory mtimes exclude
  // the broker's temporary Aura lock; every persistent entry is still checked.
  function snapshot(directory) {
    const rows = []
    function visit(path, relative = '') {
      for (const name of readdirSync(path).sort()) {
        const file = join(path, name)
        const rel = `${relative}/${name}`
        const stat = lstatSync(file, { bigint: true })
        if (stat.isDirectory()) {
          rows.push([rel, 'directory', String(stat.mode)])
          visit(file, rel)
        } else {
          assert.ok(stat.isFile(), `unexpected non-file in temporary state: ${rel}`)
          rows.push([rel, readFileSync(file).toString('hex'), String(stat.ino),
            String(stat.mtimeNs), String(stat.mode)])
        }
      }
    }
    visit(directory)
    return rows
  }

  function fixture(index, extra = {}) {
    const directory = join(root, String(index))
    mkdirSync(directory, { mode: 0o700 })
    const stateDir = join(directory, 'state')
    mkdirSync(stateDir, { mode: 0o700 })
    const issuerKey = keyPair()
    const brokerKey = keyPair()
    const options = {
      stateDir, rootPublicKeyPem: issuerKey.publicPem, brokerKey,
      confinement: confinement.assertBootConfinement({ stateDir }),
      // Unit entry point: no claim of a measured broker socket or peer isolation.
      routeIsIntact: () => true,
      ...extra,
    }
    const f = { directory, stateDir, issuerKey, brokerKey, options,
      dispatch: broker.brokerDispatch(options) }
    return f
  }

  function mint(f, args, { exp = Math.floor(Date.now() / 1000) + 300,
    overrides = {}, signingKey = f.issuerKey.privateKey } = {}) {
    const operation = operations.buildOperation(args, exp, effects.MEMORY_PUT)
    const claims = {
      toolName: effects.MEMORY_PUT,
      digest: grants.payloadDigest(effects.MEMORY_PUT, args),
      nonce: grants.newNonce(), exp,
      definitionId: effects.definitionDigest(effects.MEMORY_PUT),
      operationDigest: operations.operationDigest(operation),
      receiptKeyId: grants.receiptKeyIdForPublicKey(f.brokerKey.publicPem),
      ...overrides,
    }
    return { ...claims, signature: sign(null, grants.grantPreimage(claims), signingKey).toString('base64') }
  }

  function request(args, grant) {
    return { op: effects.MEMORY_PUT, toolName: effects.MEMORY_PUT, arguments: args,
      ...(grant === undefined ? {} : { grant }) }
  }

  function settled(f, result, args, grant) {
    assert.equal(result?.ok, true, `expected authorized effect; observed ${result?.reason ?? result?.state}`)
    assert.equal(result.state, 'SETTLED')
    const predicted = operations.buildOperation(args, grant.exp, effects.MEMORY_PUT)
    assert.equal(grant.operationDigest, operations.operationDigest(predicted))
    assert.equal(result.evidence.contentSha256, predicted.contentSha256)
    assert.equal(hash(readFileSync(result.evidence.path)), predicted.contentSha256)
    assert.equal(readFileSync(result.evidence.path, 'utf8'), operations.effectBody(args))
    assert.equal(result.receipt.contentSha256, predicted.contentSha256)
    assert.deepEqual(JSON.parse(readFileSync(join(f.stateDir, 'memory', 'keys', `${args.key}.json`))),
      { key: args.key, contentSha256: predicted.contentSha256 })
    assert.ok(nonces.openNonceBook(f.stateDir).set.has(grant.nonce), 'settlement must durably burn nonce')
  }

  async function seed(f) {
    const args = { key: 'target', value: 'before' }
    const grant = mint(f, args)
    settled(f, await f.dispatch(request(args, grant)), args, grant)
  }

  async function refused(f, req, expected, label) {
    const before = snapshot(f.stateDir)
    const result = await f.dispatch(req) // A throw is a failing arm, never a refusal.
    observations.push({ label, result, expected })
    assert.deepEqual(snapshot(f.stateDir), before, `${label}: target or broker state changed`)
    assert.equal(result?.ok, false, `${label}: unauthorized effect admitted`)
    assert.equal(result.state, 'REFUSED', `${label}: not a clean refusal`)
    assert.equal(result.reason, expected, `${label}: wrong gate refused`)
    return result.reason
  }

  async function negative(index, expected, makeGrant) {
    const f = fixture(index + 1)
    await seed(f)
    const args = { key: 'target', value: 'after' }
    const grant = makeGrant(f, args)
    const reason = await refused(f, request(args, grant), expected, names[index])
    // Positive sibling: the identical destination and effect really are usable.
    const valid = mint(f, args)
    settled(f, await f.dispatch(request(args, valid)), args, valid)
    return reason
  }

  try {
    await arm(0, () => negative(0, grants.REFUSE.NO_GRANT, () => undefined))
    await arm(1, () => negative(1, grants.REFUSE.EXPIRED, (f, args) =>
      mint(f, args, { exp: Math.floor(Date.now() / 1000) - 60 })))
    await arm(2, () => negative(2, grants.REFUSE.OPERATION_MISMATCH, (f, args) =>
      mint(f, args, { overrides: { operationDigest: hash('different operation') } })))
    await arm(3, () => negative(3, grants.REFUSE.PAYLOAD_MISMATCH, (f, args) =>
      mint(f, { ...args, key: 'other-resource' })))
    await arm(4, async () => {
      const f = fixture(5)
      const args = { key: 'target', value: 'exactly once' }
      const grant = mint(f, args)
      const req = request(args, grant)
      settled(f, await f.dispatch(req), args, grant)
      assert.equal(broker.readSettlementHead(f.stateDir), 1)
      const reason = await refused(f, req, grants.REFUSE.REPLAYED, names[4])
      // Reopen the real durable book via a new dispatcher: no Set-only proof.
      f.dispatch = broker.brokerDispatch(f.options)
      await refused(f, req, grants.REFUSE.REPLAYED, 'replay after dispatcher restart')
      assert.equal(broker.readSettlementHead(f.stateDir), 1)
      assert.equal(nonces.openNonceBook(f.stateDir).set.size, 1)
      return `${reason} (same dispatcher and reopened durable book)`
    })
    await arm(5, () => negative(5, grants.REFUSE.BAD_SIGNATURE, (f, args) =>
      mint(f, args, { signingKey: keyPair().privateKey })))

    await arm(6, async () => {
      const f = fixture(7)
      const workspace = join(f.directory, 'workspace')
      mkdirSync(workspace, { mode: 0o700 })
      const target = join(workspace, 'target.txt')
      writeFileSync(target, 'before\n', { mode: 0o600 })
      const args = { workspace: 'proof', path: 'target.txt',
        beforeSha256: hash(readFileSync(target)), content: 'authorized replacement\n' }
      const activationDigest = hash('broker-grant test activation')
      const pq = ml_dsa65.keygen(randomBytes(32))
      const publicKeys = {
        ed25519: Buffer.from(f.issuerKey.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex'),
        mlDsa65: Buffer.from(pq.publicKey).toString('hex'),
      }
      pq.secretKey.fill(0)
      const initial = genesis.createIdentityGenesis({
        genesisNonce: randomBytes(32).toString('hex'),
        initialRootKeySetId: control.rootKeySetId(publicKeys),
        amendmentRuleDigest: hash('temporary test rule'),
      })
      const head = control.createInitialIdentityControl(initial, {
        suite: control.AUMLOK_ROOT_CONTROL_SUITE, publicKeys, authorizedAt: Date.now(),
      })
      identityState.bindIdentityControlState(f.stateDir, head)
      activation.bindActivation(f.stateDir, activationDigest)
      const activeControlDigest = control.identityControlDigest(head)
      const common = {
        subject: head.subject, controlDigest: activeControlDigest,
        childKeyId: grants.receiptKeyIdForPublicKey(f.brokerKey.publicPem),
        operations: [effects.WORKSPACE_PATCH], resources: ['workspace:file:proof:target.txt'],
        audiences: ['broker-grant'], activationDigests: [activationDigest],
        budgets: { calls: 2, bytes: 1024, computeMs: 0, costMicrounits: 0 },
        notBefore: Math.floor(Date.now() / 1000) - 1,
        expiresAt: Math.floor(Date.now() / 1000) + 600,
        revocationId: 'temporary-session', nonce: randomBytes(32).toString('hex'),
      }
      const parent = delegation.createDelegationClaim({ ...common, kind: 'session',
        parentDigest: hash('temporary launch-owned session parent') })
      const child = delegation.createDelegationClaim({ ...common, kind: 'agent',
        parentDigest: delegation.delegationClaimDigest(parent),
        budgets: { ...common.budgets, calls: 1 }, nonce: randomBytes(32).toString('hex') })
      let reviewed
      let predicted
      const issuerCalls = []
      const issuerErrors = []
      const socketPath = join(f.directory, 'i.sock')
      const sockets = new Set()
      const server = createServer(socket => {
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
        socket.on('error', error => issuerErrors.push(error))
        let input = ''
        socket.setEncoding('utf8')
        socket.on('data', chunk => {
          input += chunk
          if (!input.endsWith('\n')) return
          try {
            const message = JSON.parse(input)
            issuerCalls.push(message.op)
            assert.equal(message.digest, reviewed.authorizationDigest)
            if (message.op === 'admit.v5') {
              socket.end(`${JSON.stringify({ ok: true })}\n`)
            } else {
              assert.equal(message.op, 'authorize.v5')
              assert.deepEqual(message.artifact, reviewed.artifact)
              assert.equal(message.artifactDigest, reviewed.artifactDigest)
              const signature = sign(null,
                grantsV5.authorizationSignedMessageV5FromHex(message.digest),
                f.issuerKey.privateKey).toString('base64')
              socket.end(`${JSON.stringify({ ok: true, digest: message.digest, signature })}\n`)
            }
          } catch (error) {
            issuerErrors.push(error)
            socket.destroy()
          }
        })
      })
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject)
          server.listen(socketPath, resolve)
        })
        const background = []
        const dispatch = broker.brokerDispatch({ ...f.options,
          expectedActivationDigest: activationDigest, rendererId: hash('temporary renderer'),
          workspaceRoots: { proof: workspace }, issuerSocket: socketPath,
          subjectAuthority: { subject: head.subject, activeControlDigest, activationDigest,
            audience: 'broker-grant', parentDelegationClaim: parent, delegationClaim: child },
          review: async review => {
            reviewed = review
            predicted = operations.buildOperation(args, review.expiresAt, effects.WORKSPACE_PATCH)
            assert.deepEqual(review.artifact.operationArguments, args)
            assert.equal(review.operationDigest, operations.operationDigest(predicted))
            assert.equal(hash(readFileSync(target)), args.beforeSha256)
            return 'approved' // Ephemeral test callback; no claim of a person clicking.
          },
          startBackground: run => { background.push(Promise.resolve().then(run)) },
        })
        const opened = await dispatch({ op: 'proposal.open' })
        assert.equal(opened.ok, true)
        const pending = await dispatch({ op: 'proposal.deposit', proposalNamespace: opened.proposalNamespace,
          callId: 'authorized-workspace', toolName: effects.WORKSPACE_PATCH, arguments: args })
        assert.equal(pending.ok, true)
        await Promise.all(background)
        assert.equal(issuerErrors.length, 0, `temporary issuer failed: ${issuerErrors.map(oneLine).join('; ')}`)
        const result = await dispatch({ op: 'proposal.status', proposalNamespace: opened.proposalNamespace,
          proposalId: pending.proposalId })
        assert.equal(result.ok, true, `workspace settlement: ${result.reason ?? result.state}`)
        assert.equal(result.state, 'SETTLED')
        assert.deepEqual(issuerCalls, ['admit.v5', 'authorize.v5'])
        assert.equal(result.receipt.path, target)
        assert.equal(result.receipt.contentSha256, predicted.contentSha256)
        assert.equal(hash(readFileSync(target)), predicted.contentSha256)
        assert.equal(readFileSync(target, 'utf8'), args.content)
        assert.equal(result.receipt.bytes, Buffer.byteLength(args.content))
        assert.equal(broker.readSettlementHead(f.stateDir), 1)
        assert.equal(nonces.openNonceBook(f.stateDir).set.size, 1)
        return `v5 SETTLED; predicted = receipt = disk SHA-256 ${predicted.contentSha256}`
      } catch (error) {
        if (error?.code === 'EPERM' || error?.code === 'EACCES') {
          throw new Error(`blocked: temporary issuer socket unavailable (${error.code}); real v5 route not verified`)
        }
        throw error
      } finally {
        for (const socket of sockets) socket.destroy()
        if (server.listening) await new Promise(resolve => server.close(resolve))
      }
    })

    await arm(7, async () => {
      const f = fixture(8)
      await seed(f)
      const args = { key: 'target', value: 'preflight-only' }
      const replay = mint(f, args)
      settled(f, await f.dispatch(request(args, replay)), args, replay)
      const candidates = [
        [undefined, grants.REFUSE.NO_GRANT],
        [mint(f, args, { exp: Math.floor(Date.now() / 1000) - 60 }), grants.REFUSE.EXPIRED],
        [mint(f, args, { overrides: { operationDigest: hash('other operation') } }), grants.REFUSE.OPERATION_MISMATCH],
        [mint(f, { ...args, key: 'other-resource' }), grants.REFUSE.PAYLOAD_MISMATCH],
        [replay, grants.REFUSE.REPLAYED],
        [mint(f, args, { signingKey: keyPair().privateKey }), grants.REFUSE.BAD_SIGNATURE],
        [mint(f, args), null], // A blanket unknown-op refusal cannot pass as preflight.
      ]
      const before = snapshot(f.stateDir)
      const replies = []
      for (const [grant, expected] of candidates) {
        const result = await f.dispatch({ ...request(args, grant), op: 'preflight' })
        replies.push({ result, expected })
        if (expected !== null) observations.push({ label: `preflight ${expected}`, result, expected })
        assert.deepEqual(snapshot(f.stateDir), before, 'preflight changed disk')
      }
      assert.ok(replies.every(({ result, expected }) => expected === null
        ? result?.ok === true : result?.ok === false && result.reason === expected),
      `blocked: no grant-aware broker preflight API; observed ${[...new Set(replies.map(x => x.result?.reason))].join(', ')} for invalid AND valid grants`)
      return 'all six refusals and valid control leave disk unchanged'
    })

    await arm(8, () => {
      for (const label of [...names.slice(0, 6), 'replay after dispatcher restart']) {
        assert.ok(observations.some(item => item.label === label), `${label}: broker verdict missing`)
      }
      const outside = []
      for (const { label, result } of observations) {
        assert.equal(typeof result, 'object', `${label}: bare refusal`)
        assert.equal(result?.ok, false, `${label}: not refused`)
        assert.equal(typeof result.reason, 'string', `${label}: unnamed refusal`)
        if (!refusalCodes.has(result.reason)) outside.push(result.reason)
      }
      assert.ok(outside.length === 0,
        `blocked: verifier codes are not exported by BROKER_REFUSE: ${[...new Set(outside)].join(', ')}`)
    })

    await arm(9, () => {
      // Resolver fault injection changes no source file or installed dependency.
      // Each fresh process executes this file's actual startup/failure path.
      for (const packageName of ['@noble/curves', '@noble/post-quantum']) {
        const hook = `import { registerHooks } from 'node:module';\n` +
          `registerHooks({ resolve(specifier, context, nextResolve) {\n` +
          `if (specifier.startsWith(${JSON.stringify(`${packageName}/`)})) {\n` +
          `const error = new Error('simulated missing crypto dependency');\n` +
          `error.code = 'ERR_MODULE_NOT_FOUND'; throw error; }\n` +
          `return nextResolve(specifier, context); } });\n`
        const hookFile = join(root, `missing-${packageName.split('/')[1]}.mjs`)
        writeFileSync(hookFile, hook, { mode: 0o600 })
        const env = { ...process.env }
        delete env.NODE_OPTIONS
        delete env.NODE_PATH
        const child = spawnSync(process.execPath,
          ['--import', hookFile, fileURLToPath(import.meta.url)],
          { cwd: root, env, encoding: 'utf8', timeout: 15_000 })
        assert.equal(child.error, undefined, `dependency probe did not run: ${child.error?.code}`)
        assert.equal(child.status, 1, `${packageName}: missing dependency did not fail`)
        assert.ok(child.stdout.includes(`required crypto dependency unavailable: ${packageName}/`),
          `${packageName}: clear missing-crypto diagnostic absent`)
        assert.match(child.stdout, /broker-grant: 0 passed, 10 failed\n$/u)
        assert.doesNotMatch(child.stdout, /^ok /mu)
      }
      return 'both missing-package subprocesses exit 1, 0 passed / 10 failed'
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

console.log(`broker-grant: ${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
