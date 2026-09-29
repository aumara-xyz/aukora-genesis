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
 * WHAT THIS COURT DOES NOT CLAIM. An earlier draft of this file required `BROKER_REFUSE`
 * membership and a grant-aware `preflight` op "literally". Both requirements were WRONG, and
 * the arms that asserted them were red for a day because of it, not because the broker was
 * broken. The grant layer's refusals come from the separately exported frozen `REFUSE` in
 * host-dsh/src/grant.mjs - a different vocabulary from the broker's own - and this broker
 * offers no dry run at all. Arm 8 now proves the ABSENCE of that oracle instead of demanding
 * it, and arm 9 asserts both vocabularies rather than one it never promised.
 *
 * A missing dependency is still FAIL, never a skip or an invented success.
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
import './noble-map.mjs' // resolves the box's @noble/* to this repository's committed closure

const names = [
  'no grant (memory.put)', 'expired grant (memory.put)',
  'operation digest mismatch (memory.put)', 'different key resource (memory.put)',
  'replayed grant (memory.put)', 'wrong signing key (memory.put)',
  'authorized workspace.patch with exact before/after hashes',
  'no authorization oracle (unknown op refused before the grant is read)',
  'refusal codes are named, frozen and layer-separated',
  'missing @noble fails loudly',
]
let passed = 0
let failed = 0
let checkRemoval = null
let oracleReason = null
// Arm indices that have a kill-proof. Populated where the probes are declared, read by the
// top-level `arm()` so that adding a probe cannot silently stop being exercised.
const armsWithProbe = new Set([0, 1, 2, 3, 4, 5])
const observations = []
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const oneLine = error => String(error?.message ?? error).replace(/\s+/gu, ' ')

async function arm(index, run) {
  try {
    let detail = await run()
    if (checkRemoval !== null && armsWithProbe.has(index)) {
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
  // THE VOCABULARY THAT ACTUALLY PRODUCES THESE CODES. The brief for this court first asserted
  // membership in `BROKER_REFUSE`, and arms 1-6 returned codes that are not in it. That was the
  // BRIEF's error, not a defect: the grant layer's refusals come from the separately exported,
  // frozen `REFUSE` in host-dsh/src/grant.mjs, which broker.mjs imports as `REFUSE`. Two
  // vocabularies exist; `BROKER_REFUSE` is the broker's own, and the grant-layer codes are the
  // grant layer's. Asserting the wrong one tested the test, not the broker.
  const refusalCodes = new Set(Object.values(grants.REFUSE))

  // Fault injection applies only to module text loaded in separate temporary
  // test processes. No source is copied into this test or written back to the
  // sealed box. The ordinary run above imports the original modules unchanged.
  // Require the PARTICULAR arm to go red: unrelated blocked arms cannot count
  // as a killed mutation merely because they already make the child exit 1.
  const nobleMap = fileURLToPath(new URL('./noble-map.mjs', import.meta.url))
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
  // PROBES ARE KEYED BY ARM, NOT BY POSITION: arm N is index N-1, and arms 1-6 above are indices
  // 0-5. An earlier edit appended these two and gated on `index < 8`, which made arm 7 (index 6)
  // run the arm-8 probe and fail for the wrong reason. Keyed, that cannot happen again.
  armsWithProbe.add(7); armsWithProbe.add(8)
  const extraRemovals = new Map([
    // ARM 8 (index 7): let an unknown op actually LEAK a verdict. An empty replacement would
    // change nothing and the probe would prove nothing.
    [7, ['broker/broker.mjs',
      "if (request?.op !== 'memory.put') return { ok: false, reason: BROKER_REFUSE.UNKNOWN_OP }",
      "if (request?.op === 'preflight') return { ok: true, leaked: true }"]],
    // ARM 9 (index 8): answer a grant refusal with a code that is not in the exported vocabulary.
    [8, ['host-dsh/src/grant.mjs',
      'reason: REFUSE.EXPIRED', "reason: 'grant:invented-at-runtime'"]],
  ])
  if (!process.argv.includes('--guard-removal-probe')) {
    checkRemoval = index => {
      const [relative, before, after] = removals[index] ?? extraRemovals.get(index)
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
        ['--import', nobleMap, '--import', hookFile, fileURLToPath(import.meta.url), '--guard-removal-probe'],
        { cwd: root, env, encoding: 'utf8', timeout: 20_000 })
      assert.equal(child.error, undefined, `guard-removal child failed to run: ${child.error?.code}`)
      assert.equal(child.status, 1, 'guard-removal child did not fail')
      assert.match(child.stdout, new RegExp(`^FAIL ${index + 1} `, 'm'),
        `guard removal did not turn arm ${index + 1} red`)
      const failedLine = child.stdout.split('\n').find(line => line.startsWith(`FAIL ${index + 1} `))
      // Each probe must fail for ITS OWN reason, not merely because the child exited 1 for an
      // unrelated blocked arm. Indices 6 and 7 exist so arms 8 and 9 have a kill-proof at all.
      const expected = index === 0 ? "reading 'exp'"
        : index <= 5 ? 'target or broker state changed'
          : index === 7 ? 'an unknown op' : 'not members of the exported grant vocabulary'
      assert.ok(failedLine.includes(expected),
        `guard removal did not expose the expected missing refusal/effect in arm ${index + 1} (wanted "${expected}")`)
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
      // NO AUTHORIZATION ORACLE. A dry run would let a caller ask "would this be allowed?"
      // without ever spending the grant - a free probing surface, and a verdict that could be
      // mistaken for permission. This broker offers no such op, and the arm proves the absence
      // rather than assuming it: an unknown op is REFUSED, and it is refused for BOTH a valid
      // grant and an invalid one, so the refusal cannot be read as an answer about the grant.
      const f = fixture(8)
      await seed(f)
      const args = { key: 'target', value: 'must-not-land' }
      const before = snapshot(f.stateDir)
      // THE GRANT IS WRAPPED IN A PROXY THAT RECORDS EVERY PROPERTY READ. Without this the arm
      // would be true by construction: the broker refuses on the op name before it looks at the
      // grant, so a refusal would say nothing about whether the grant was consulted. With it, a
      // refusal that touched the grant is Visible, and the arm asserts the record is EMPTY.
      const reads = []
      const watched = grant => new Proxy(grant, {
        get(target, property, receiver) {
          reads.push(String(property))
          return Reflect.get(target, property, receiver)
        },
        has(target, property) { reads.push(`has:${String(property)}`); return Reflect.has(target, property) },
      })
      const probes = [
        ['valid grant', watched(mint(f, args))],
        ['no grant', undefined],
        ['expired grant', watched(mint(f, args, { exp: Math.floor(Date.now() / 1000) - 60 }))],
        ['wrong signer', watched(mint(f, args, { signingKey: keyPair().privateKey }))],
      ]
      const replies = []
      // More than one unknown token: otherwise the arm cannot tell a rule about `preflight` from a
      // rule about every unrecognised op, and it would keep passing if a real `preflight` appeared.
      for (const op of ['preflight', 'dry-run', 'would-this-be-allowed', 'memory.put.preview']) {
        for (const [label, grant] of probes) {
          const result = await f.dispatch({ ...request(args, grant), op })
          replies.push({ label: `${op} / ${label}`, result })
          assert.deepEqual(snapshot(f.stateDir), before, `${op} / ${label}: an unknown op touched disk`)
          assert.equal(result?.ok, false, `${op} / ${label}: an unknown op returned success`)
          assert.equal(typeof result?.reason, 'string', `${op} / ${label}: refused without a reason`)
          // broker.mjs:1019 returns before `state` is set; asserting its absence pins the exact
          // short-circuit rather than accepting any refusal shape.
          assert.equal(result.state, undefined, `${op} / ${label}: a refusal before the grant must carry no state`)
        }
      }
      assert.deepEqual(reads, [],
        `an unknown op READ the grant (${[...new Set(reads)].join(', ')}), so a refusal here is not proof the grant was ignored`)
      // Identical refusal for a valid and an invalid grant: the reply carries no verdict about
      // the grant, so it cannot be mined for one.
      const reasons = new Set(replies.map(r => r.result.reason))
      assert.equal(reasons.size, 1,
        `an unknown op answered differently per grant (${[...reasons].join(', ')}), so it leaks a verdict`)
      // And the refusal is not a grant-layer verdict: nothing was consumed, nothing settled.
      assert.equal(broker.readSettlementHead(f.stateDir), 1, 'a probe must not settle anything')
      assert.ok(!refusalCodes.has([...reasons][0]),
        'an unknown op must not answer with a grant-layer refusal code, which would read as a verdict')
      // NOT pushed into `observations`: this is a BROKER-layer code, and arm 9 asserts the two
      // layers are separate. Mixing them is what made this arm red the first time.
      oracleReason = replies[0].result.reason
      return `no dry run across ${replies.length} probes: ${[...reasons][0]}, grant never read, disk untouched`
    })

    await arm(8, () => {
      for (const label of [...names.slice(0, 6), 'replay after dispatcher restart']) {
        assert.ok(observations.some(item => item.label === label), `${label}: broker verdict missing`)
      }
      const brokerCodes = new Set(Object.values(broker.BROKER_REFUSE))
      const outside = []
      for (const { label, result } of observations) {
        assert.equal(typeof result, 'object', `${label}: bare refusal`)
        assert.equal(result?.ok, false, `${label}: not refused`)
        assert.equal(typeof result.reason, 'string', `${label}: unnamed refusal`)
        if (!refusalCodes.has(result.reason)) outside.push(result.reason)
        assert.ok(!brokerCodes.has(result.reason),
          `${label}: a grant-layer refusal answered with a broker-layer code (${result.reason})`)
      }
      assert.ok(outside.length === 0,
        `refusal codes are not members of the exported grant vocabulary: ${[...new Set(outside)].join(', ')}`)
      // The vocabulary is FROZEN and NAMED: a code cannot be invented at runtime, and every
      // refusal above is one of its members. That is the auditable contract the grant layer
      // actually offers, and it is what this arm asserts.
      assert.ok(Object.isFrozen(grants.REFUSE), 'the grant refusal vocabulary must be frozen')
      assert.equal(refusalCodes.size, 17, 'the grant refusal vocabulary changed size')
      // TWO LAYERS, TWO NAMED VOCABULARIES, AND THEY DO NOT OVERLAP. The broker's own refusals (an
      // unknown op, for one) are not grant refusals, and the grant layer's are not the broker's.
      // Both are frozen and enumerable, so every refusal on this path can be named from a declared
      // set rather than read off a message. That is the contract the broker actually offers.
      assert.ok(Object.isFrozen(broker.BROKER_REFUSE), 'the broker refusal vocabulary must be frozen')
      assert.equal(brokerCodes.size, 68, 'the broker refusal vocabulary changed size')
      assert.ok(oracleReason !== null, 'arm 8 must have recorded the unknown-op code')
      // SET-LEVEL DISJOINTNESS, not a word in a message. Reviewing this court, a hostile read made
      // the fair point that checking eight individual codes does not establish that two vocabularies
      // do not overlap - the returned text claimed more than it proved. This asserts the property
      // itself, so it would catch a future code that crossed the layer boundary.
      const bothLayers = [...refusalCodes].filter(code => brokerCodes.has(code))
      assert.deepEqual(bothLayers, [], `a code belongs to both vocabularies: ${bothLayers.join(', ')}`)
      assert.ok(!refusalCodes.has(oracleReason),
        'a broker-layer code must not also be a grant-layer code; the vocabularies must stay disjoint')
      return `grant: ${refusalCodes.size} named codes, broker: ${brokerCodes.size}, disjoint; unknown op = ${oracleReason}`
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
          ['--import', nobleMap, '--import', hookFile, fileURLToPath(import.meta.url)],
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
