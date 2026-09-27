/**
 * courts/harness/broker — the capability lives in a second process.
 *
 * The thesis, measured: an in-process check is owned by whoever loaded first,
 * so environment poison (NODE_OPTIONS / --import) that patches node:crypto
 * before the verifier's ESM binding exists owns that binding. The broker is a
 * separate OS process whose environment the parent scrubs BEFORE spawn, so
 * the poison that owns the caller never reaches it.
 *
 *   B1.launch      the broker reports preload and linker-path inputs absent and its own crypto honest
 *   B2.bounds      an oversize frame refuses broker:frame-oversize
 *   B3.admit       valid grant -> memory.put executes, evidence returns
 *   B4.nogrant     no grant -> grant:absent
 *   B5.forged      bogus signature -> grant:signature-invalid
 *   B6.replay      the same grant twice -> grant:replayed
 *   B7.swapped     swapped arguments -> grant:payload-mismatch
 *   B8.shadowed    grant bound to another definition -> grant:definition-mismatch
 *   B9.omitted     coherently signed missing value -> broker:arguments-not-exact
 *   B10.rider      coherently signed rider key -> broker:arguments-not-exact
 *   B11.bad-key    raw exact path-like key -> broker:key-not-a-name before state
 *   B12.authority  a grant pinned to broker A refuses at broker B, then settles at A
 *   B13.rider      an unsigned grant field refuses malformed
 *   B14.key-pair   a mismatched persisted public/private key pair refuses load
 *   B15.first-run  concurrent provisioning publishes one complete identity
 *   B16.history    dangling history entries cannot grade as absent and mint a key
 *   B17.state      dangling Aura and sequence entries refuse before grant claim
 *   B18.singleton  a second or stale writer lease refuses before socket rebind
 *   B19.sequence   concurrent settlements receive one contiguous Aura order
 *   B20.after-effect a production-path throw after an effect is INDETERMINATE
 *   B21.paths      linked state, key, and nonce directories refuse
 *   B22.order      truncation and noncontiguous Aura sequence refuse before nonce
 *   B23.endpoint   a second broker refuses a live socket instead of unlinking it
 *   B24.shutdown   an idle client cannot hold graceful broker shutdown open
 *   B25.restart    the production nonce book refuses after a fresh process opens it
 *   B26.concurrent exactly one independent process wins one production nonce claim
 *   B27.identity   expiry cannot create a second claim identity for one nonce
 *   B28.public-key private root material cannot cross the broker launch boundary
 *   B29.nonce-file a malformed durable claim blocks startup rather than disappearing
 *   B30.dispatcher caller-selected dispatch refuses before broker startup
 *   B31.persisted-public private PEM cannot occupy the persisted public-key field
 *   B32.entry     caller-selected Node entry refuses before child spawn
 *   B33.readiness a pre-bound foreign socket refuses before child spawn
 *   B34.snapshot  the nonce reserved is the signed snapshot's nonce
 *   B35.scrub      a legacy unsafe launch option cannot preserve preloads
 *   B36.clock      an expired burn survives a fresh process and clock rollback
 *   B37.ipc        a direct listening child without the expected IPC message stops and refuses
 *   B38.route-dir  a group/other-writable socket directory refuses before bind
 *   B39.route-live an already connected caller refuses after path replacement
 *   B40.node-path  a caller cannot replace the launch helper's Node executable
 *   B41.route-queue a queued effect refuses if its route changes before admission
 *   B42.route-bind a post-bind route swap cannot return or delete a foreign endpoint
 *   B43.nonce-publish a concurrent opener never reads a partial published burn
 *   B44.nonce-link a fresh opener accepts the completed two-link publication transition
 *   B45.nonce-sync a post-publication directory-sync failure burns but does not admit
 *   B46.stop-queue a queued request cannot begin after graceful shutdown starts
 *   P1.differential  the poison admits a forged grant IN-PROCESS (control)
 *                    and the SAME grant refuses through the broker
 *
 * --mutate: the sabotage is launching the broker WITHOUT the scrub, so the
 * poison reaches its crypto and the forged grant admits. The court detects it
 * exactly when it observes that admit.
 *
 *   node courts/harness/broker/run.mjs
 *   node courts/harness/broker/run.mjs --mutate
 */
import { createHash, generateKeyPairSync, sign as edSign } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createConnection, createServer } from 'node:net'
import { copyMutantAukora } from '../support/mutant-aukora.mjs'
import { buildOperation, operationDigest } from '../../../aukora/broker/operation.mjs'
import { canonicalJSON } from '../../../aukora/kernel-seed/chain.mjs'
import { spawnMutantBroker } from '../support/spawn-mutant-broker.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const grantMod = await import(join(HERE, '../../../aukora/host-dsh/src/grant.mjs'))
const { verifyGrant, payloadDigest, grantPreimage, newNonce, REFUSE } = grantMod
const { definitionDigest, observe, MEMORY_PUT } = await import(join(HERE, '../../../aukora/broker/effect.mjs'))
const { provisionBrokerIdentity, serve, spawnBroker, MAX_FRAME_BYTES } = await import(join(HERE, '../../../aukora/broker/broker.mjs'))
const { appendEntry, readEntries } = await import(join(HERE, '../../../aukora/aura/record.mjs'))
const BROKER_ENTRY = join(HERE, '../../../aukora/broker/broker.mjs')
const NONCE_BOOK_ENTRY = join(HERE, '../../../aukora/host-dsh/src/nonce-book.mjs')

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--mutate')) {
  console.error('usage: node courts/harness/broker/run.mjs [--mutate]')
  process.exit(2)
}
const MUTATE = args[0] === '--mutate'
const TMP = mkdtempSync(join(tmpdir(), 'aukora-broker-court-'))
const socketPath = join(TMP, 'broker.sock')
const stateDir = join(TMP, 'state')
const DEF = definitionDigest()
const RECEIPT_KEY_ID = provisionBrokerIdentity(stateDir).receiptKeyId

// ── fixtures ─────────────────────────────────────────────────────────────────
const root = generateKeyPairSync('ed25519')
const rootPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const ARGS = { key: 'greeting', value: { text: 'owned' } }
const mint = (toolName, args, over = {}) => {
  const exp = Math.floor(Date.now() / 1000) + 300
  const g = { toolName, digest: payloadDigest(toolName, args), nonce: newNonce(), exp, definitionId: DEF, operationDigest: operationDigest(buildOperation(args, exp)), receiptKeyId: RECEIPT_KEY_ID, ...over }
  return { ...g, signature: edSign(null, grantPreimage(g), root.privateKey).toString('base64') }
}

// Construct a coherently signed adversarial payload whose fixed operation
// covers only the content body produced from key/value. The live broker must
// reject the unrepresentable request before touching state.
const mintUncheckedMemoryPut = (args) => {
  const exp = Math.floor(Date.now() / 1000) + 300
  const body = `${canonicalJSON({ key: args.key, value: args.value })}\n`
  const operation = {
    tool: MEMORY_PUT,
    key: args.key,
    bytes: Buffer.byteLength(body, 'utf8'),
    contentSha256: createHash('sha256').update(body, 'utf8').digest('hex'),
    definitionId: DEF,
    exp,
    oneUse: true,
  }
  const claims = {
    toolName: MEMORY_PUT,
    digest: payloadDigest(MEMORY_PUT, args),
    nonce: newNonce(),
    exp,
    definitionId: DEF,
    operationDigest: operationDigest(operation),
    receiptKeyId: RECEIPT_KEY_ID,
  }
  return {
    body,
    grant: { ...claims, signature: edSign(null, grantPreimage(claims), root.privateKey).toString('base64') },
  }
}

// The poison: patches node:crypto.verify before the verifier's ESM binding
// exists, then syncs the builtin namespace so the named import sees it.
const poisonFile = join(TMP, 'poison.mjs')
writeFileSync(poisonFile, [
  "import { createRequire, syncBuiltinESMExports } from 'node:module'",
  "const require = createRequire(import.meta.url)",
  "require('node:crypto').verify = () => true",
  "syncBuiltinESMExports()",
  '',
].join('\n'))

// ── client ───────────────────────────────────────────────────────────────────
const client = (path = socketPath) => {
  const socket = createConnection(path)
  let buffer = ''
  const pending = new Map()
  socket.on('data', (chunk) => {
    buffer += chunk
    let cut
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      if (line.trim() === '') continue
      const reply = JSON.parse(line)
      const waiter = pending.get(reply.id)
      if (waiter) { pending.delete(reply.id); waiter(reply) }
    }
  })
  let id = 0
  return {
    send: (request) => new Promise((resolve) => {
      const rid = ++id
      pending.set(rid, resolve)
      socket.write(`${JSON.stringify({ id: rid, ...request })}\n`)
    }),
    close: () => socket.destroy(),
  }
}

/** Start one nonce claim through a fresh Node process importing an exact book source. */
const startNonceClaimInProcess = (claimStateDir, nonce, exp, { entry = NONCE_BOOK_ENTRY, env: sourceEnv = process.env } = {}) => {
  const program = [
    `const { openNonceBook } = await import(${JSON.stringify(pathToFileURL(entry).href)})`,
    `const book = openNonceBook(${JSON.stringify(claimStateDir)})`,
    `const result = book.claim(${JSON.stringify(nonce)}, ${exp})`,
    `console.log(JSON.stringify({ result, seeded: book.set.has(${JSON.stringify(nonce)}) }))`,
  ].join('\n')
  const env = { ...sourceEnv }
  delete env.NODE_OPTIONS
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], { env })
  const result = new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => resolve({ status: null, result: null, seeded: null, stderr: String(error?.message ?? error) }))
    child.once('close', (status) => {
      let parsed = null
      try {
        parsed = JSON.parse(stdout.trim())
      } catch {
        // Malformed or missing child output remains a failed row through nulls.
      }
      resolve({ status, result: parsed?.result ?? null, seeded: parsed?.seeded ?? null, stderr })
    })
  })
  return { child, result }
}

/** Claim one nonce through a fresh Node process importing the production book. */
const claimNonceInProcess = async (claimStateDir, nonce, exp) => startNonceClaimInProcess(claimStateDir, nonce, exp).result

/** Wait only for a court-controlled marker written by a copied test broker. */
const waitForMarker = async (path, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return false
}

const rows = []
// The verdict is DERIVED from observed-vs-expected — a mismatched row always
// fails the court, and no manual flag can turn red green.
const row = (n, label, observed, expected) => {
  const breach = JSON.stringify(observed) !== JSON.stringify(expected)
  rows.push({ n, label, observed, expected, breach })
}

// Poison THIS court's own env so the scrub has something to remove; the court
// process itself is already past startup, so this cannot affect it.
process.env.NODE_OPTIONS = `--import=${poisonFile}`
process.env.LD_LIBRARY_PATH = '/court-controlled'

const broker = MUTATE
  ? await spawnMutantBroker({ entry: BROKER_ENTRY, socketPath, stateDir, rootPublicKeyPem: rootPem, skipScrub: true })
  : await spawnBroker({ socketPath, stateDir, rootPublicKeyPem: rootPem })
const cli = client()

// B1 — the launch scrub, reported by the process that received it. The parent
// supplies both a Node preload and a Linux dynamic-library search path; neither
// may reach the broker before its first JavaScript line.
{
  const status = await cli.send({ op: 'status' })
  row('B1', 'broker reports preload and linker-path inputs absent and honest crypto', {
    nodeOptionsAbsent: status.env.NODE_OPTIONS === null,
    linkerPathAbsent: status.env.LD_LIBRARY_PATH === null,
    cryptoHonest: status.cryptoHonest === true,
    expectedDefinitionId: status.expectedDefinitionId,
  }, { nodeOptionsAbsent: true, linkerPathAbsent: true, cryptoHonest: true, expectedDefinitionId: DEF }, status.env.NODE_OPTIONS !== null || status.env.LD_LIBRARY_PATH !== null || status.cryptoHonest !== true)
}

// B2 — an oversize frame is terminal. A refusal that leaves the same socket
// able to dispatch its next frame is a cosmetic message, not enforcement.
{
  const socket = createConnection(socketPath)
  const reply = await new Promise((resolve, reject) => {
    let output = ''
    socket.on('error', reject)
    socket.on('data', (chunk) => {
      output += String(chunk)
      if (output.includes('\n')) resolve(output)
    })
    socket.write(`${JSON.stringify({ id: 1, op: 'status', pad: 'x'.repeat(MAX_FRAME_BYTES) })}\n`)
  })
  const socketClosed = await Promise.race([
    new Promise((resolve) => socket.once('close', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 750)),
  ])
  socket.destroy()

  const followUpArgs = { key: 'oversize-follow-up', value: { terminal: true } }
  const followUpGrant = mint(MEMORY_PUT, followUpArgs)
  const followUp = await cli.send({
    op: 'memory.put', toolName: MEMORY_PUT, arguments: followUpArgs, grant: followUpGrant,
  })
  row('B2', 'an oversize frame refuses by name and terminates the connection', {
    oversize: reply.includes('broker:frame-oversize'),
    socketClosed,
    followUpState: followUp.state,
  }, {
    oversize: true,
    socketClosed: true,
    followUpState: 'SETTLED',
  })
}

// B3 — the control: a valid grant executes the effect.
const g3 = mint(MEMORY_PUT, ARGS)
{
  const r = await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: ARGS, grant: g3 })
  const onDisk = existsSync(r.evidence?.path) && observe(r.evidence.path)?.contentSha256 === r.evidence.contentSha256
  row('B3', 'valid grant — memory.put executes with post-write evidence', { ok: r.ok, evidenceMatchesDisk: onDisk }, { ok: true, evidenceMatchesDisk: true }, !r.ok || !onDisk)
}

// B4–B8 — the refusals, each by name.
row('B4', 'no grant offered', { reason: (await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: ARGS })).reason }, { reason: REFUSE.NO_GRANT })
{
  const forged = { ...mint(MEMORY_PUT, ARGS), signature: Buffer.alloc(64).toString('base64') }
  row('B5', 'forged signature', { reason: (await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: ARGS, grant: forged })).reason }, { reason: REFUSE.BAD_SIGNATURE })
}
row('B6', 'the same grant replayed', { reason: (await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: ARGS, grant: g3 })).reason }, { reason: REFUSE.REPLAYED })
{
  const other = mint(MEMORY_PUT, ARGS)
  row('B7', 'swapped arguments', { reason: (await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: { key: 'greeting', value: { text: 'evil' } }, grant: other })).reason }, { reason: REFUSE.PAYLOAD_MISMATCH })
}
{
  const shadowed = mint(MEMORY_PUT, ARGS, { definitionId: 'd'.repeat(64) })
  row('B8', 'grant bound to a shadow definition', { reason: (await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: ARGS, grant: shadowed })).reason }, { reason: REFUSE.DEFINITION_MISMATCH })
}

// B9-B10 — full-payload signatures do not authorize an argument object the
// fixed operation and effect cannot represent exactly. Refusal precedes nonce,
// intent and object writes.
const exactArgumentRefusal = async (n, label, invalidArgs) => {
  const { body, grant } = mintUncheckedMemoryPut(invalidArgs)
  const locallyVerified = verifyGrant({
    grant,
    toolName: MEMORY_PUT,
    args: invalidArgs,
    rootPublicKeyPem: rootPem,
    seenNonces: new Set(),
    now: Date.now(),
    expectedDefinitionId: DEF,
    expectedOperationDigest: grant.operationDigest,
    expectedReceiptKeyId: RECEIPT_KEY_ID,
  })
  const reply = await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: invalidArgs, grant })
  const bodySha256 = createHash('sha256').update(body, 'utf8').digest('hex')
  row(n, label, {
    grantVerifies: locallyVerified.ok === true,
    state: reply.state,
    reason: reply.reason,
    nonceClaimed: existsSync(join(stateDir, 'nonces', grant.nonce)),
    intentWritten: existsSync(join(stateDir, 'intents', `${grant.nonce}.json`)),
    objectWritten: existsSync(join(stateDir, 'memory', 'objects', `${bodySha256}.json`)),
  }, {
    grantVerifies: true,
    state: 'REFUSED',
    reason: 'broker:arguments-not-exact',
    nonceClaimed: false,
    intentWritten: false,
    objectWritten: false,
  })
}

await exactArgumentRefusal('B9', 'signed request with omitted value refuses before state', { key: 'broker-omitted' })
await exactArgumentRefusal('B10', 'signed request with rider key refuses before state', { key: 'broker-rider', value: null, hidden: 'rider' })

// B11 — key grammar is a broker-owned pre-grant decision, not a property of
// the package caller. A non-null malformed grant must remain untouched.
{
  const badKeyArgs = { key: '../escape', value: 1 }
  const exp = Math.floor(Date.now() / 1000) + 300
  const grant = { nonce: 'broker-bad-key', exp }
  const body = `${canonicalJSON(badKeyArgs)}\n`
  const bodySha256 = createHash('sha256').update(body, 'utf8').digest('hex')
  const reply = await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: badKeyArgs, grant })
  row('B11', 'path-like key refuses before grant and effect state', {
    state: reply.state,
    reason: reply.reason,
    nonceClaimed: existsSync(join(stateDir, 'nonces', grant.nonce)),
    intentWritten: existsSync(join(stateDir, 'intents', `${grant.nonce}.json`)),
    objectWritten: existsSync(join(stateDir, 'memory', 'objects', `${bodySha256}.json`)),
  }, {
    state: 'REFUSED',
    reason: 'broker:key-not-a-name',
    nonceClaimed: false,
    intentWritten: false,
    objectWritten: false,
  })
}

// B12 — a foreign broker key refuses before its nonce book changes. The same
// signed grant then settles at the broker whose receipt key it names.
{
  const foreignDir = join(TMP, 'foreign-state')
  const foreignSocket = join(TMP, 'foreign.sock')
  const foreignIdentity = provisionBrokerIdentity(foreignDir)
  const foreignBroker = await spawnBroker({
    socketPath: foreignSocket,
    stateDir: foreignDir,
    rootPublicKeyPem: rootPem,
  })
  const foreignClient = client(foreignSocket)
  const args = { key: 'authority-bound', value: 12 }
  const grant = mint(MEMORY_PUT, args)
  const refused = await foreignClient.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: args, grant })
  const foreignNonceClaimed = existsSync(join(foreignDir, 'nonces', grant.nonce))
  const settled = await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: args, grant })
  row('B12', 'a grant names the only receipt key allowed to settle it', {
    keysDiffer: foreignIdentity.receiptKeyId !== RECEIPT_KEY_ID,
    foreignReason: refused.reason,
    foreignNonceClaimed,
    namedBrokerSettled: settled.state === 'SETTLED',
  }, {
    keysDiffer: true,
    foreignReason: REFUSE.RECEIPT_KEY_MISMATCH,
    foreignNonceClaimed: false,
    namedBrokerSettled: true,
  })
  foreignClient.close()
  foreignBroker.kill()
}

{
  const args = { key: 'grant-rider', value: 13 }
  const base = mint(MEMORY_PUT, args)
  const withRider = { ...base, role: 'admin' }
  const hiddenRider = { ...base }
  Object.defineProperty(hiddenRider, 'role', { value: 'admin', enumerable: false })
  const symbolRider = { ...base, [Symbol('role')]: 'admin' }
  const inheritedRider = Object.assign(Object.create({ role: 'admin' }), base)
  let getterCalls = 0
  const accessorClaim = { ...base }
  Object.defineProperty(accessorClaim, 'signature', {
    enumerable: true,
    get() {
      getterCalls++
      return base.signature
    },
  })
  const directReason = (grant) => verifyGrant({
    grant,
    toolName: MEMORY_PUT,
    args,
    rootPublicKeyPem: rootPem,
    seenNonces: new Set(),
    now: Date.now(),
    expectedDefinitionId: DEF,
    expectedOperationDigest: base.operationDigest,
    expectedReceiptKeyId: RECEIPT_KEY_ID,
  }).reason
  const reply = await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: args, grant: withRider })
  const reasons = {
    enumerable: reply.reason,
    nonEnumerable: directReason(hiddenRider),
    symbol: directReason(symbolRider),
    inherited: directReason(inheritedRider),
    accessor: directReason(accessorClaim),
  }
  row('B13', 'every unsigned or executable grant extension refuses malformed', {
    reasons,
    getterCalls,
  }, {
    reasons: {
      enumerable: REFUSE.MALFORMED,
      nonEnumerable: REFUSE.MALFORMED,
      symbol: REFUSE.MALFORMED,
      inherited: REFUSE.MALFORMED,
      accessor: REFUSE.MALFORMED,
    },
    getterCalls: 0,
  })
}

// B14 — the receipt-key identity and signer must be the two halves of one key
// pair. Otherwise the broker can admit for the advertised public key and mint
// an unverifiable receipt with an unrelated private key.
{
  const mismatchedDir = join(TMP, 'mismatched-key-state')
  provisionBrokerIdentity(mismatchedDir)
  const keyFile = join(mismatchedDir, 'keys', 'broker.json')
  const saved = JSON.parse(readFileSync(keyFile, 'utf8'))
  const foreign = generateKeyPairSync('ed25519')
  saved.publicPem = foreign.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  writeFileSync(keyFile, `${JSON.stringify(saved)}\n`, { mode: 0o600 })
  let reason = null
  try {
    provisionBrokerIdentity(mismatchedDir)
  } catch (error) {
    reason = String(error?.message ?? error)
  }
  row('B14', 'mismatched persisted key halves refuse before serving', {
    reason,
  }, { reason: 'broker:key-pair-mismatch' })
}

// B15 — first-run provisioning is one atomic publication. Every process is
// loaded before the barrier drops, so this is a real race over an absent key,
// not twelve sequential reads of a key one child already created.
{
  const concurrentDir = join(TMP, 'concurrent-key-state')
  const barrier = join(TMP, 'provisioning-barrier')
  const childCode = [
    `import { existsSync } from 'node:fs'`,
    `import { setTimeout as delay } from 'node:timers/promises'`,
    `import { provisionBrokerIdentity } from ${JSON.stringify(new URL('../../../aukora/broker/broker.mjs', import.meta.url).href)}`,
    `process.stdout.write('READY\\n')`,
    `while (!existsSync(process.argv[2])) await delay(1)`,
    `process.stdout.write(provisionBrokerIdentity(process.argv[1]).receiptKeyId + '\\n')`,
  ].join('\n')
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_OPTIONS'))
  const children = Array.from({ length: 12 }, () => spawn(process.execPath, [
    '--input-type=module', '-e', childCode, concurrentDir, barrier,
  ], { env: cleanEnv, stdio: ['ignore', 'pipe', 'pipe'] }))
  const observations = children.map((child) => {
    let stdout = ''
    let stderr = ''
    let readyResolved = false
    let resolveReady
    let rejectReady
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
      if (!readyResolved && stdout.split('\n').includes('READY')) {
        readyResolved = true
        resolveReady()
      }
    })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    const done = new Promise((resolve) => child.on('close', (status) => {
      if (!readyResolved) rejectReady(new Error(`provisioning child exited ${status} before READY: ${stderr}`))
      resolve({ status, stdout, stderr })
    }))
    return { ready, done }
  })
  await Promise.all(observations.map(({ ready }) => ready))
  writeFileSync(barrier, 'go\n')
  const results = await Promise.all(observations.map(({ done }) => done))
  const identities = new Set(results.flatMap(({ stdout }) => stdout.split('\n').filter((line) => line !== '' && line !== 'READY')))
  row('B15', 'concurrent first-run provisioning publishes one complete key', {
    statuses: [...new Set(results.map(({ status }) => status))],
    stderrBytes: results.reduce((total, result) => total + Buffer.byteLength(result.stderr), 0),
    identityCount: identities.size,
    keyFiles: readdirSync(join(concurrentDir, 'keys')).sort(),
  }, {
    statuses: [0],
    stderrBytes: 0,
    identityCount: 1,
    keyFiles: ['broker.json'],
  })
}

// B16 — `existsSync` follows a dangling symlink and reports false. Historical
// state is an entry-presence fact, so a dangling Aura or sequence entry must
// refuse identity creation rather than mint a fresh signer over apparent absence.
{
  const reasons = {}
  const keyFiles = {}
  for (const name of ['aura.jsonl', 'seq']) {
    const dir = join(TMP, `dangling-history-${name.replace('.', '-')}`)
    mkdirSync(dir, { recursive: true })
    symlinkSync(join(dir, 'missing-history-target'), join(dir, name))
    try {
      provisionBrokerIdentity(dir)
    } catch (error) {
      reasons[name] = String(error?.message ?? error)
    }
    keyFiles[name] = readdirSync(join(dir, 'keys')).sort()
  }
  row('B16', 'dangling history entries refuse fresh receipt-key creation', {
    reasons,
    keyFiles,
  }, {
    reasons: { 'aura.jsonl': 'broker:key-downgrade-refused', seq: 'broker:key-downgrade-refused' },
    keyFiles: { 'aura.jsonl': [], seq: [] },
  })
}

// B17 — even with an existing valid key, dangling settlement state must refuse
// before the grant is claimed or an object/redirect target is written.
{
  const observed = {}
  for (const subject of ['aura.jsonl', 'seq']) {
    const dir = join(TMP, `dangling-settlement-${subject.replace('.', '-')}`)
    const identity = provisionBrokerIdentity(dir)
    const redirect = join(TMP, `redirected-${subject.replace('.', '-')}`)
    symlinkSync(redirect, join(dir, subject))
    const isolatedSocket = join(TMP, `broker-${subject.replace('.', '-')}.sock`)
    const isolatedBroker = await spawnBroker({
      socketPath: isolatedSocket,
      stateDir: dir,
      rootPublicKeyPem: rootPem,
    })
    const isolatedClient = client(isolatedSocket)
    const grant = mint(MEMORY_PUT, ARGS, { receiptKeyId: identity.receiptKeyId })
    const reply = await isolatedClient.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: ARGS, grant })
    isolatedClient.close()
    isolatedBroker.kill?.()
    observed[subject] = {
      reason: reply.reason,
      redirectCreated: existsSync(redirect),
      objectDirectoryCreated: existsSync(join(dir, 'memory', 'objects')),
      nonceEntries: existsSync(join(dir, 'nonces')) ? readdirSync(join(dir, 'nonces')).sort() : [],
    }
  }
  row('B17', 'dangling settlement state refuses before nonce and effect', observed, {
    'aura.jsonl': {
      reason: 'broker:aura-preflight (record:unavailable)',
      redirectCreated: false,
      objectDirectoryCreated: false,
      nonceEntries: [],
    },
    seq: {
      reason: 'broker:sequence-state-malformed',
      redirectCreated: false,
      objectDirectoryCreated: false,
      nonceEntries: [],
    },
  })
}

// B18 — the socket is secondary to the state writer lease. A second launch
// over the same state and socket must fail before unlinking the live broker's
// socket. A planted crash residue receives the same fail-closed treatment;
// only an operator can establish that the old process is gone.
{
  let secondReason = null
  try {
    await serve({ socketPath, stateDir, rootPublicKeyPem: rootPem })
  } catch (error) {
    secondReason = String(error?.message ?? error)
  }
  const primaryAfterRefusal = await cli.send({ op: 'status' })

  const staleDir = join(TMP, 'crashed-writer-state')
  const staleSocket = join(TMP, 'crashed-writer.sock')
  provisionBrokerIdentity(staleDir)
  const crashedBroker = await spawnBroker({
    socketPath: staleSocket,
    stateDir: staleDir,
    rootPublicKeyPem: rootPem,
  })
  const staleLock = join(staleDir, '.broker-active.lock')
  const crashed = new Promise((resolve) => crashedBroker.once('exit', resolve))
  crashedBroker.kill('SIGKILL')
  await crashed
  let staleReason = null
  try {
    await serve({ socketPath: staleSocket, stateDir: staleDir, rootPublicKeyPem: rootPem })
  } catch (error) {
    staleReason = String(error?.message ?? error)
  }
  row('B18', 'one state writer lives from socket bind through graceful close', {
    secondReason,
    primaryStillServes: primaryAfterRefusal.ok === true,
    staleReason,
    staleLockPreserved: existsSync(staleLock),
    crashedSocketPreserved: existsSync(staleSocket),
  }, {
    secondReason: 'broker:state-active',
    primaryStillServes: true,
    staleReason: 'broker:state-active',
    staleLockPreserved: true,
    crashedSocketPreserved: true,
  })
}

// B19 — separate connections force overlapping dispatch. Sequence allocation
// occurs only after the Aura writer lock is held, so every settlement receives
// one unique, contiguous place in the same verified order.
{
  const before = readEntries(join(stateDir, 'aura.jsonl')).length
  const parallel = Array.from({ length: 8 }, (_, index) => {
    const argumentsValue = { key: `parallel-${index}`, value: { index } }
    return {
      connection: client(),
      request: {
        op: 'memory.put',
        toolName: MEMORY_PUT,
        arguments: argumentsValue,
        grant: mint(MEMORY_PUT, argumentsValue),
      },
    }
  })
  const replies = await Promise.all(parallel.map(({ connection, request }) => connection.send(request)))
  for (const { connection } of parallel) connection.close()
  const sequences = replies.map((reply) => reply.receipt?.sequence).sort((a, b) => a - b)
  const expectedSequences = Array.from({ length: parallel.length }, (_, index) => before + index + 1)
  const entries = readEntries(join(stateDir, 'aura.jsonl'))
  row('B19', 'concurrent settlements allocate one contiguous Aura sequence', {
    states: [...new Set(replies.map((reply) => reply.state))],
    sequences,
    auraTail: entries.slice(-parallel.length).map((entry) => entry.sequence),
    sequenceWitness: readFileSync(join(stateDir, 'seq'), 'utf8'),
  }, {
    states: ['SETTLED'],
    sequences: expectedSequences,
    auraTail: expectedSequences,
    sequenceWitness: String(before + parallel.length),
  })
}

// B20 — mutate a temporary copy of the real effect after it has published the
// object and projection. The production dispatcher must preserve uncertainty;
// a pre-effect REFUSED would be a false story about an already-written object.
{
  const afterEffectAukora = join(TMP, 'after-effect-aukora')
  const afterEffectEntry = join(afterEffectAukora, 'broker/broker.mjs')
  const afterEffectSource = join(afterEffectAukora, 'broker/effect.mjs')
  const afterEffectState = join(TMP, 'after-effect-state')
  const afterEffectSocket = join(TMP, 'after-effect.sock')
  const afterEffectReceiptKeyId = provisionBrokerIdentity(afterEffectState).receiptKeyId
  copyMutantAukora(afterEffectAukora)
  const original = readFileSync(afterEffectSource, 'utf8')
  const anchor = "  const stat = lstatSync(path, { bigint: true })"
  const changed = original.replace(anchor, "  if (process.env.AUKORA_B20_THROW_AFTER_EFFECT === '1') throw new Error('fixture: threw after effect')\n" + anchor)
  if (changed === original) throw new Error('B20 could not mutate the post-effect source anchor')
  writeFileSync(afterEffectSource, changed, 'utf8')
  const afterEffectBroker = await spawnMutantBroker({
    entry: afterEffectEntry,
    socketPath: afterEffectSocket,
    stateDir: afterEffectState,
    rootPublicKeyPem: rootPem,
    env: { ...process.env, AUKORA_B20_THROW_AFTER_EFFECT: '1' },
  })
  const afterEffectArgs = { key: 'after-effect', value: { mutation: true } }
  const afterEffectExp = Math.floor(Date.now() / 1000) + 300
  const afterEffectClaims = {
    toolName: MEMORY_PUT,
    digest: payloadDigest(MEMORY_PUT, afterEffectArgs),
    nonce: newNonce(),
    exp: afterEffectExp,
    definitionId: DEF,
    operationDigest: operationDigest(buildOperation(afterEffectArgs, afterEffectExp)),
    receiptKeyId: afterEffectReceiptKeyId,
  }
  const afterEffectClient = client(afterEffectSocket)
  const reply = await afterEffectClient.send({
    op: 'memory.put',
    toolName: MEMORY_PUT,
    arguments: afterEffectArgs,
    grant: { ...afterEffectClaims, signature: edSign(null, grantPreimage(afterEffectClaims), root.privateKey).toString('base64') },
  })
  afterEffectClient.close()
  afterEffectBroker.kill()
  row('B20', 'production after-effect throw is indeterminate', {
    state: reply.state,
    reason: reply.reason,
    effectRan: existsSync(join(afterEffectState, 'memory', 'keys', 'after-effect.json')),
  }, {
    state: 'INDETERMINATE',
    reason: 'broker:effect-outcome-indeterminate',
    effectRan: true,
  })
}

// B21 — directory entries are identity, not reachability. A symlink to a
// usable directory must not grade as the broker's state, key store, or nonce
// book, and refusal must not write through the link.
{
  const stateTarget = join(TMP, 'linked-state-target')
  const stateLink = join(TMP, 'linked-state')
  mkdirSync(stateTarget, { mode: 0o700 })
  symlinkSync(stateTarget, stateLink)
  let stateReason = null
  try { provisionBrokerIdentity(stateLink) } catch (error) { stateReason = String(error?.message ?? error) }

  const keyState = join(TMP, 'linked-key-state')
  const keyTarget = join(TMP, 'linked-key-target')
  mkdirSync(keyState, { mode: 0o700 })
  mkdirSync(keyTarget, { mode: 0o700 })
  symlinkSync(keyTarget, join(keyState, 'keys'))
  let keyReason = null
  try { provisionBrokerIdentity(keyState) } catch (error) { keyReason = String(error?.message ?? error) }

  const nonceState = join(TMP, 'linked-nonce-state')
  const nonceTarget = join(TMP, 'linked-nonce-target')
  provisionBrokerIdentity(nonceState)
  mkdirSync(nonceTarget, { mode: 0o700 })
  symlinkSync(nonceTarget, join(nonceState, 'nonces'))
  let nonceReason = null
  try {
    await serve({ socketPath: join(TMP, 'linked-nonce.sock'), stateDir: nonceState, rootPublicKeyPem: rootPem })
  } catch (error) {
    nonceReason = String(error?.message ?? error)
  }
  row('B21', 'linked state, key, and nonce directories refuse before writes', {
    stateReason,
    keyReason,
    nonceReason,
    keyTargetEntries: readdirSync(keyTarget).sort(),
    nonceTargetEntries: readdirSync(nonceTarget).sort(),
    failedServeLeaseReleased: !existsSync(join(nonceState, '.broker-active.lock')),
  }, {
    stateReason: 'broker:state-path-malformed',
    keyReason: 'broker:key-directory-malformed',
    nonceReason: 'broker:nonce-directory-malformed',
    keyTargetEntries: [],
    nonceTargetEntries: [],
    failedServeLeaseReleased: true,
  })
}

// B22 — a hash chain cannot detect deletion of a valid suffix by itself. The
// separate sequence file is the local head witness: shortening the chain to a
// valid prefix or to zero entries must disagree with it before grant claim.
{
  const observed = {}
  for (const truncation of ['suffix', 'zero', 'sequence-gap']) {
    const dir = join(TMP, `${truncation}-truncation-state`)
    const identity = provisionBrokerIdentity(dir)
    const auraFile = join(dir, 'aura.jsonl')
    appendEntry({ file: auraFile, fields: { sequence: 1 } })
    appendEntry({ file: auraFile, fields: { sequence: truncation === 'sequence-gap' ? 3 : 2 } })
    writeFileSync(join(dir, 'seq'), '2', { mode: 0o600 })
    const lines = readFileSync(auraFile, 'utf8').split('\n').filter(Boolean)
    if (truncation === 'suffix') writeFileSync(auraFile, `${lines[0]}\n`, 'utf8')
    if (truncation === 'zero') writeFileSync(auraFile, '', 'utf8')

    const isolatedSocket = join(TMP, `${truncation}-truncation.sock`)
    const isolatedBroker = await spawnBroker({
      socketPath: isolatedSocket,
      stateDir: dir,
      rootPublicKeyPem: rootPem,
    })
    const isolatedClient = client(isolatedSocket)
    const argumentsValue = { key: `truncation-${truncation}`, value: truncation }
    const grant = mint(MEMORY_PUT, argumentsValue, { receiptKeyId: identity.receiptKeyId })
    const reply = await isolatedClient.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: argumentsValue, grant })
    isolatedClient.close()
    isolatedBroker.kill?.()
    observed[truncation] = {
      state: reply.state,
      reason: reply.reason,
      nonceEntries: readdirSync(join(dir, 'nonces')).sort(),
      effectStarted: existsSync(join(dir, 'memory', 'objects')),
    }
  }
  row('B22', 'truncation and noncontiguous Aura order refuse before nonce', observed, {
    suffix: {
      state: 'REFUSED',
      reason: 'broker:aura-sequence-mismatch',
      nonceEntries: [],
      effectStarted: false,
    },
    zero: {
      state: 'REFUSED',
      reason: 'broker:aura-sequence-mismatch',
      nonceEntries: [],
      effectStarted: false,
    },
    'sequence-gap': {
      state: 'REFUSED',
      reason: 'broker:aura-sequence-mismatch',
      nonceEntries: [],
      effectStarted: false,
    },
  })
}

// B23 — state ownership and endpoint ownership are different invariants. A
// broker for another valid state directory must not unlink the live socket it
// finds at boot and become the process reached by new clients.
{
  const primaryBefore = await cli.send({ op: 'status' })
  const alternateState = join(TMP, 'alternate-endpoint-state')
  let endpointReason = null
  let replacement = null
  try {
    replacement = await serve({ socketPath, stateDir: alternateState, rootPublicKeyPem: rootPem })
  } catch (error) {
    endpointReason = String(error?.message ?? error)
  }
  const freshClient = client()
  const primaryAfter = await freshClient.send({ op: 'status' })
  freshClient.close()
  if (replacement !== null) await replacement.close()
  row('B23', 'a second broker refuses a live socket at boot', {
    endpointReason,
    endpointUnchanged: primaryAfter.pid === primaryBefore.pid,
    alternateLeaseReleased: !existsSync(join(alternateState, '.broker-active.lock')),
  }, {
    endpointReason: 'broker:socket-path-occupied',
    endpointUnchanged: true,
    alternateLeaseReleased: true,
  })
}

// B24 — an accepted client that sends no request has no authority to retain
// the listener, state lease, or activation. Graceful close destroys idle
// connections and completes without requiring cooperation from that client.
{
  const idleState = join(TMP, 'idle-shutdown-state')
  const idleSocketPath = join(TMP, 'idle-shutdown.sock')
  const idleBroker = await serve({ socketPath: idleSocketPath, stateDir: idleState, rootPublicKeyPem: rootPem })
  const idle = createConnection(idleSocketPath)
  await new Promise((resolve, reject) => {
    idle.once('connect', resolve)
    idle.once('error', reject)
  })
  const closePromise = idleBroker.close()
  const closedWithoutClient = await Promise.race([
    closePromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 750)),
  ])
  idle.destroy()
  await closePromise
  row('B24', 'an idle client cannot block graceful broker shutdown', {
    closedWithoutClient,
    socketRemoved: !existsSync(idleSocketPath),
    leaseReleased: !existsSync(join(idleState, '.broker-active.lock')),
  }, {
    closedWithoutClient: true,
    socketRemoved: true,
    leaseReleased: true,
  })
}

// B25 — restart persistence is exercised through two fresh processes, not a
// court-owned Set. The second book seeds the winner and its atomic create loses.
{
  const claimStateDir = join(TMP, 'nonce-restart-state')
  mkdirSync(claimStateDir, { mode: 0o700 })
  const exp = Math.floor(Date.now() / 1000) + 300
  const first = await claimNonceInProcess(claimStateDir, 'restart-claim', exp)
  const restarted = await claimNonceInProcess(claimStateDir, 'restart-claim', exp)
  row('B25', 'the production nonce claim survives a fresh process', {
    first: { status: first.status, result: first.result, seeded: first.seeded, stderr: first.stderr },
    restarted: { status: restarted.status, result: restarted.result, seeded: restarted.seeded, stderr: restarted.stderr },
    claimFiles: readdirSync(join(claimStateDir, 'nonces')).sort(),
  }, {
    first: { status: 0, result: true, seeded: true, stderr: '' },
    restarted: { status: 0, result: false, seeded: true, stderr: '' },
    claimFiles: ['restart-claim'],
  })
}

// B26 — independent processes race the production `openSync(..., 'wx')`
// claim. Exact cardinality matters: one winner and every other caller refused.
{
  const claimStateDir = join(TMP, 'nonce-concurrent-state')
  mkdirSync(claimStateDir, { mode: 0o700 })
  const exp = Math.floor(Date.now() / 1000) + 300
  const contenders = await Promise.all(Array.from(
    { length: 12 },
    () => claimNonceInProcess(claimStateDir, 'concurrent-claim', exp),
  ))
  row('B26', 'exactly one process wins the production nonce claim', {
    statuses: contenders.map(({ status }) => status),
    winners: contenders.filter(({ result }) => result === true).length,
    refusals: contenders.filter(({ result }) => result === false).length,
    seeded: [...new Set(contenders.map(({ seeded }) => seeded))].sort(),
    stderr: contenders.map(({ stderr }) => stderr).filter(Boolean),
    claimFiles: readdirSync(join(claimStateDir, 'nonces')).sort(),
    stagingResidue: readdirSync(claimStateDir).filter((name) => name.startsWith('.nonce-candidate-')).sort(),
  }, {
    statuses: Array(12).fill(0),
    winners: 1,
    refusals: 11,
    seeded: [true],
    stderr: [],
    claimFiles: ['concurrent-claim'],
    stagingResidue: [],
  })
}

// B27 — nonce identity is independent of a grant's expiry. Each claim runs
// in a new process, so a false result cannot be explained by the first
// process's in-memory Set.
{
  const claimStateDir = join(TMP, 'nonce-expiry-identity-state')
  mkdirSync(claimStateDir, { mode: 0o700 })
  const now = Math.floor(Date.now() / 1000)
  const first = await claimNonceInProcess(claimStateDir, 'expiry-independent-claim', now + 300)
  const differentExpiry = await claimNonceInProcess(claimStateDir, 'expiry-independent-claim', now + 600)
  row('B27', 'one nonce cannot be claimed again with another expiry', {
    first: { status: first.status, result: first.result, seeded: first.seeded, stderr: first.stderr },
    differentExpiry: { status: differentExpiry.status, result: differentExpiry.result, seeded: differentExpiry.seeded, stderr: differentExpiry.stderr },
    claimFiles: readdirSync(join(claimStateDir, 'nonces')).sort(),
  }, {
    first: { status: 0, result: true, seeded: true, stderr: '' },
    differentExpiry: { status: 0, result: false, seeded: true, stderr: '' },
    claimFiles: ['expiry-independent-claim'],
  })
}

// B36 — expiry makes a grant invalid; it never makes its previous use
// forgettable. A fresh process must retain a burn whose recorded expiry is in
// the past, otherwise a wall-clock rollback can revive the signed artifact.
{
  const rollbackState = join(TMP, 'nonce-clock-rollback-state')
  mkdirSync(rollbackState, { mode: 0o700 })
  const now = Math.floor(Date.now() / 1000)
  const first = await claimNonceInProcess(rollbackState, 'clock-rollback-claim', now - 1)
  const afterRollback = await claimNonceInProcess(rollbackState, 'clock-rollback-claim', now + 300)
  row('B36', 'an expired durable burn survives a fresh process', {
    first: { status: first.status, result: first.result, seeded: first.seeded, stderr: first.stderr },
    afterRollback: { status: afterRollback.status, result: afterRollback.result, seeded: afterRollback.seeded, stderr: afterRollback.stderr },
    claimFiles: readdirSync(join(rollbackState, 'nonces')).sort(),
  }, {
    first: { status: 0, result: true, seeded: true, stderr: '' },
    afterRollback: { status: 0, result: false, seeded: true, stderr: '' },
    claimFiles: ['clock-rollback-claim'],
  })
}

// B28 — the spawn boundary consumes a canonical public root only. Node's
// createPublicKey() would otherwise derive a public half from private PEM and
// pass the caller's root secret through AUKORA_ROOT_PEM into the child.
{
  const privateRootState = join(TMP, 'private-root-state')
  const privateRootSocket = join(TMP, 'private-root.sock')
  let reason = null
  try {
    await spawnBroker({
      socketPath: privateRootSocket,
      stateDir: privateRootState,
      rootPublicKeyPem: root.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    })
  } catch (error) {
    reason = String(error?.message ?? error)
  }
  row('B28', 'a private root PEM refuses before broker spawn', {
    reason,
    stateCreated: existsSync(privateRootState),
    socketCreated: existsSync(privateRootSocket),
  }, {
    reason: 'broker:root-public-key-invalid',
    stateCreated: false,
    socketCreated: false,
  })
}

// B29 — a truncated claim is not absence. A restart after a crash between
// create and durable write must block service, not quietly forget the burn.
{
  const malformedState = join(TMP, 'malformed-nonce-state')
  const malformedSocket = join(TMP, 'malformed-nonce.sock')
  provisionBrokerIdentity(malformedState)
  const nonceDirectory = join(malformedState, 'nonces')
  mkdirSync(nonceDirectory, { mode: 0o700 })
  writeFileSync(join(nonceDirectory, 'truncated-claim'), '{', 'utf8')
  let reason = null
  try {
    await serve({ socketPath: malformedSocket, stateDir: malformedState, rootPublicKeyPem: rootPem })
  } catch (error) {
    reason = String(error?.message ?? error)
  }
  row('B29', 'a malformed durable nonce claim blocks broker startup', {
    reason,
    socketCreated: existsSync(malformedSocket),
    leaseReleased: !existsSync(join(malformedState, '.broker-active.lock')),
  }, {
    reason: 'nonce-book: malformed claim record: truncated-claim',
    socketCreated: false,
    leaseReleased: true,
  })
}

// B30 — a caller-selected dispatcher used to turn the socket into an
// unauthenticated effect path. Refuse the option before creating state, a
// socket, or a lease; production serving has exactly one grant-verifying path.
{
  const customState = join(TMP, 'custom-dispatch-state')
  const customSocket = join(TMP, 'custom-dispatch.sock')
  let reason = null
  try {
    await serve({
      socketPath: customSocket,
      stateDir: customState,
      rootPublicKeyPem: rootPem,
      handle: () => ({ ok: true }),
    })
  } catch (error) {
    reason = String(error?.message ?? error)
  }
  row('B30', 'a caller-selected dispatcher refuses before broker startup', {
    reason,
    stateCreated: existsSync(customState),
    socketCreated: existsSync(customSocket),
  }, {
    reason: 'broker:custom-dispatch-forbidden',
    stateCreated: false,
    socketCreated: false,
  })
}

// B31 — the persisted public field is a public-key boundary too. Node can
// derive a public half from this private PEM, but the key record must reject
// that role confusion instead of normalizing a leaked secret as public state.
{
  const privatePublicState = join(TMP, 'private-public-state')
  const privatePublicSocket = join(TMP, 'private-public.sock')
  provisionBrokerIdentity(privatePublicState)
  const keyPath = join(privatePublicState, 'keys', 'broker.json')
  const saved = JSON.parse(readFileSync(keyPath, 'utf8'))
  writeFileSync(keyPath, `${JSON.stringify({ ...saved, publicPem: saved.privatePem })}\n`, 'utf8')
  let reason = null
  try {
    await serve({ socketPath: privatePublicSocket, stateDir: privatePublicState, rootPublicKeyPem: rootPem })
  } catch (error) {
    reason = String(error?.message ?? error)
  }
  row('B31', 'a private PEM cannot occupy persisted public key state', {
    reason,
    socketCreated: existsSync(privatePublicSocket),
    leaseReleased: !existsSync(join(privatePublicState, '.broker-active.lock')),
  }, {
    reason: 'broker:key-state-malformed',
    socketCreated: false,
    leaseReleased: true,
  })
}

// B32 — the launcher owns its module entry. A caller-selected Node option used
// to execute before broker code; reject this object before any child, state, or
// socket exists instead of relying only on Node's `--` separator.
{
  const customEntryState = join(TMP, 'custom-entry-state')
  const customEntrySocket = join(TMP, 'custom-entry.sock')
  let reason = null
  try {
    await spawnBroker({
      entry: '--eval=process.exit(23)',
      socketPath: customEntrySocket,
      stateDir: customEntryState,
      rootPublicKeyPem: rootPem,
    })
  } catch (error) {
    reason = String(error?.message ?? error)
  }
  row('B32', 'a caller-selected broker entry refuses before child spawn', {
    reason,
    stateCreated: existsSync(customEntryState),
    socketCreated: existsSync(customEntrySocket),
  }, {
    reason: 'broker:custom-entry-forbidden',
    stateCreated: false,
    socketCreated: false,
  })
}

// B33 — readiness belongs to the child, not to whoever happened to bind the
// pathname first. The parent sees an occupied endpoint before it can create a
// child or state directory; the old socket-connect loop returned a child here.
{
  const occupiedState = join(TMP, 'occupied-readiness-state')
  const occupiedSocket = join(TMP, 'occupied-readiness.sock')
  const squatter = createServer()
  await new Promise((resolve, reject) => {
    squatter.once('error', reject)
    squatter.listen(occupiedSocket, () => {
      squatter.removeListener('error', reject)
      resolve()
    })
  })
  let reason = null
  let returnedChild = null
  try {
    const child = await spawnBroker({ socketPath: occupiedSocket, stateDir: occupiedState, rootPublicKeyPem: rootPem })
    returnedChild = child.pid ?? null
    child.kill()
  } catch (error) {
    reason = String(error?.message ?? error)
  }
  const foreignSocketStillPresent = existsSync(occupiedSocket)
  await new Promise((resolve) => squatter.close(resolve))
  row('B33', 'a foreign listener cannot satisfy broker launch readiness', {
    reason,
    returnedChild,
    stateCreated: existsSync(occupiedState),
    foreignSocketStillPresent,
  }, {
    reason: 'broker:socket-path-occupied',
    returnedChild: null,
    stateCreated: false,
    foreignSocketStillPresent: true,
  })
}

// B34 — verifier signature and reservation must consume one snapshot. A hostile
// direct-JavaScript Proxy can change its nonce between observations; the socket
// path parses JSON first, but the exported verifier itself must still burn the
// nonce whose signature it verified.
{
  const signedNonce = 'snapshot-signed-nonce'
  const mutableArtifact = mint(MEMORY_PUT, ARGS, { nonce: signedNonce })
  let observations = 0
  const alternatingArtifact = new Proxy(mutableArtifact, {
    ownKeys: (target) => {
      observations++
      return Reflect.ownKeys(target)
    },
    getOwnPropertyDescriptor: (target, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (key !== 'nonce' || descriptor === undefined) return descriptor
      return { ...descriptor, value: observations % 2 === 1 ? signedNonce : `reservation-${observations}` }
    },
    get: (target, key, receiver) => key === 'nonce'
      ? 'raw-post-snapshot-nonce'
      : Reflect.get(target, key, receiver),
  })
  const spent = new Set()
  const verifySnapshot = (grant) => verifyGrant({
    grant,
    toolName: MEMORY_PUT,
    args: ARGS,
    rootPublicKeyPem: rootPem,
    seenNonces: spent,
    now: Date.now(),
    expectedDefinitionId: DEF,
    expectedOperationDigest: mutableArtifact.operationDigest,
    expectedReceiptKeyId: RECEIPT_KEY_ID,
  })
  const first = verifySnapshot(alternatingArtifact)
  const second = verifySnapshot(mutableArtifact)
  row('B34', 'the verified snapshot nonce is the nonce reserved', {
    firstOk: first.ok === true,
    secondReason: second.reason ?? null,
    spent: [...spent].sort(),
    observations,
  }, {
    firstOk: true,
    secondReason: REFUSE.REPLAYED,
    spent: [signedNonce],
    observations: 1,
  })
}

// B37 — the parent must require its child's readiness message after the child
// has bound a socket. A copied broker with only that message changed still
// listens; a connection-polling launcher would incorrectly return it.
{
  const readinessAukora = join(TMP, 'readiness-aukora')
  const readinessEntry = join(readinessAukora, 'broker', 'broker.mjs')
  const readinessState = join(TMP, 'readiness-state')
  const readinessSocket = join(TMP, 'readiness.sock')
  copyMutantAukora(readinessAukora)
  const original = readFileSync(readinessEntry, 'utf8')
  const sigtermImmune = original.replace("process.on('SIGTERM', stop)", "process.on('SIGTERM', () => {})")
  if (sigtermImmune === original) throw new Error('B37 could not make the copied broker ignore SIGTERM')
  const changed = sigtermImmune.replace(
    "process.send({ type: BROKER_READY }",
    "process.send({ type: 'court:wrong-ready' }",
  )
  if (changed === sigtermImmune) throw new Error('B37 could not mutate the broker readiness message')
  writeFileSync(readinessEntry, changed, 'utf8')
  const { spawnBroker: spawnCopiedBroker } = await import(`${pathToFileURL(readinessEntry).href}?court=wrong-ready`)
  let reason = null
  try {
    await spawnCopiedBroker({ socketPath: readinessSocket, stateDir: readinessState, rootPublicKeyPem: rootPem })
  } catch (error) {
    reason = String(error?.message ?? error)
  }
  const listenerStopped = await new Promise((resolve) => {
    const probe = createConnection(readinessSocket)
    const timeout = setTimeout(() => {
      probe.destroy()
      resolve(false)
    }, 500)
    probe.once('connect', () => {
      clearTimeout(timeout)
      probe.destroy()
      resolve(false)
    })
    probe.once('error', () => {
      clearTimeout(timeout)
      resolve(true)
    })
  })
  row('B37', 'a direct child with a wrong IPC readiness message is stopped before refusal', {
    reason,
    listenerStopped,
  }, {
    reason: 'broker:launch-readiness-malformed',
    listenerStopped: true,
  })
}

// B38 — the pathname is an authority surface, independent of the broker's
// state directory. A guest that can write its parent can unlink the broker and
// bind a replacement, so serving refuses before bind instead of relying on a
// stale startup-only absence check.
{
  const writableRouteDir = join(TMP, 'writable-route-dir')
  const writableRouteState = join(TMP, 'writable-route-state')
  const writableRouteSocket = join(writableRouteDir, 'broker.sock')
  mkdirSync(writableRouteDir, { mode: 0o700 })
  chmodSync(writableRouteDir, 0o733)
  let reason = null
  try {
    await serve({ socketPath: writableRouteSocket, stateDir: writableRouteState, rootPublicKeyPem: rootPem })
  } catch (error) {
    reason = String(error?.message ?? error)
  }
  row('B38', 'a writable socket directory refuses before bind', {
    reason,
    socketCreated: existsSync(writableRouteSocket),
    leaseReleased: !existsSync(join(writableRouteState, '.broker-active.lock')),
  }, {
    reason: 'broker:socket-directory-untrusted',
    socketCreated: false,
    leaseReleased: true,
  })
}

// B39 — directory custody prevents a different uid from replacing the route.
// This same-uid reenactment retains a client already connected to the original
// broker, swaps the name for a foreign listener, and proves the original will
// not dispatch further requests once its bound inode is no longer named.
{
  const routeState = join(TMP, 'route-live-state')
  const routeSocket = join(TMP, 'route-live.sock')
  const routeBroker = await serve({ socketPath: routeSocket, stateDir: routeState, rootPublicKeyPem: rootPem })
  const retainedClient = client(routeSocket)
  await retainedClient.send({ op: 'status' })
  const foreign = createServer((socket) => socket.end('SQUATTER\n'))
  unlinkSync(routeSocket)
  await new Promise((resolve, reject) => {
    foreign.once('error', reject)
    foreign.listen(routeSocket, () => {
      foreign.removeListener('error', reject)
      resolve()
    })
  })
  const reply = await retainedClient.send({ op: 'status' })
  retainedClient.close()
  let closeReason = null
  try {
    await routeBroker.close()
  } catch (error) {
    closeReason = String(error?.message ?? error)
  }
  const leaseRetained = existsSync(join(routeState, '.broker-active.lock'))
  const foreignReply = await new Promise((resolve, reject) => {
    const socket = createConnection(routeSocket)
    let output = ''
    socket.on('data', (chunk) => { output += chunk })
    socket.once('end', () => resolve(output.trim()))
    socket.once('error', reject)
  })
  await new Promise((resolve) => foreign.close(resolve))
  row('B39', 'a connected client refuses after its route inode changes', {
    foreignBound: true,
    reply: { ok: reply.ok, state: reply.state, reason: reply.reason },
    closeReason,
    leaseRetained,
    foreignReply,
  }, {
    foreignBound: true,
    reply: { ok: false, state: 'REFUSED', reason: 'broker:socket-route-lost' },
    closeReason: 'broker:socket-route-lost',
    leaseRetained: true,
    foreignReply: 'SQUATTER',
  })
}

// B41 — the transport sees a route before dispatch, but memory.put later waits
// behind the serialized settlement turn. A copied broker pauses the first
// completed effect and marks the second request after it has entered that
// queue. Replacing the route then must refuse the queued request before its
// nonce, intent, or projection exists.
{
  const queueAukora = join(TMP, 'route-queue-aukora')
  const queueEntry = join(queueAukora, 'broker', 'broker.mjs')
  const queueState = join(TMP, 'route-queue-state')
  const queueSocket = join(TMP, 'route-queue.sock')
  const firstMarker = join(TMP, 'route-queue-first')
  const queuedMarker = join(TMP, 'route-queue-entered')
  copyMutantAukora(queueAukora)
  const original = readFileSync(queueEntry, 'utf8')
  const afterEffectAnchor = '    const evidence = request.toolName === WORKSPACE_PATCH\n      ? workspacePatch(roots, request.arguments)\n      : memoryPut(stateDir, request.arguments)'
  const queueAnchor = '    const previousTurn = settlementTurn\n    settlementTurn = new Promise((resolve) => { releaseTurn = resolve })'
  const delayed = original.replace(afterEffectAnchor, `${afterEffectAnchor}\n    writeFileSync(process.env.AUKORA_B41_FIRST, 'effect-started')\n    await new Promise((resolve) => setTimeout(resolve, 250))`)
  const changed = delayed.replace(queueAnchor, `    const previousTurn = settlementTurn\n    if (request.arguments?.key === 'route-queue-second') writeFileSync(process.env.AUKORA_B41_QUEUED, 'queued')\n    settlementTurn = new Promise((resolve) => { releaseTurn = resolve })`)
  if (delayed === original || changed === delayed) throw new Error('B41 could not mutate the serialized route queue anchors')
  writeFileSync(queueEntry, changed, 'utf8')
  const queueChild = await spawnMutantBroker({
    entry: queueEntry,
    socketPath: queueSocket,
    stateDir: queueState,
    rootPublicKeyPem: rootPem,
    env: { ...process.env, AUKORA_B41_FIRST: firstMarker, AUKORA_B41_QUEUED: queuedMarker },
  })
  const queueClient = client(queueSocket)
  const queueStatus = await queueClient.send({ op: 'status' })
  const firstArgs = { key: 'route-queue-first', value: { text: 'first' } }
  const secondArgs = { key: 'route-queue-second', value: { text: 'second' } }
  const firstGrant = mint(MEMORY_PUT, firstArgs, { receiptKeyId: queueStatus.receiptKeyId })
  const secondGrant = mint(MEMORY_PUT, secondArgs, { receiptKeyId: queueStatus.receiptKeyId })
  const firstReply = queueClient.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: firstArgs, grant: firstGrant })
  const firstReached = await waitForMarker(firstMarker)
  const secondReply = queueClient.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: secondArgs, grant: secondGrant })
  const queuedReached = await waitForMarker(queuedMarker)
  const foreign = createServer()
  let foreignBound = false
  if (queuedReached) {
    unlinkSync(queueSocket)
    await new Promise((resolve, reject) => {
      foreign.once('error', reject)
      foreign.listen(queueSocket, () => {
        foreign.removeListener('error', reject)
        foreignBound = true
        resolve()
      })
    })
  }
  const [first, second] = await Promise.all([firstReply, secondReply])
  queueClient.close()
  const queueExited = new Promise((resolve) => queueChild.once('exit', resolve))
  queueChild.kill('SIGKILL')
  await queueExited
  if (foreignBound) await new Promise((resolve) => foreign.close(resolve))
  row('B41', 'a queued request refuses after route loss before nonce claim', {
    firstReached,
    queuedReached,
    foreignBound,
    firstSettled: first.ok === true,
    second: { state: second.state, reason: second.reason },
    secondNonceClaimed: existsSync(join(queueState, 'nonces', secondGrant.nonce)),
    secondIntentWritten: existsSync(join(queueState, 'intents', `${secondGrant.nonce}.json`)),
    secondProjectionWritten: existsSync(join(queueState, 'memory', 'keys', 'route-queue-second.json')),
  }, {
    firstReached: true,
    queuedReached: true,
    foreignBound: true,
    firstSettled: true,
    second: { state: 'REFUSED', reason: 'broker:socket-route-lost' },
    secondNonceClaimed: false,
    secondIntentWritten: false,
    secondProjectionWritten: false,
  })
}

// B46 — graceful stop aborts accepted pre-effect work. A copied broker pauses
// the first effect while a second request waits behind the settlement turn.
// SIGTERM must let the first settle but refuse the queued request before its
// nonce, intent, projection, or Aura entry exists.
{
  const stopAukora = join(TMP, 'shutdown-queue-aukora')
  const stopEntry = join(stopAukora, 'broker', 'broker.mjs')
  const stopState = join(TMP, 'shutdown-queue-state')
  const stopSocket = join(TMP, 'shutdown-queue.sock')
  const firstMarker = join(TMP, 'shutdown-queue-first')
  const queuedMarker = join(TMP, 'shutdown-queue-second')
  copyMutantAukora(stopAukora)
  const original = readFileSync(stopEntry, 'utf8')
  const effectAnchor = '    const evidence = request.toolName === WORKSPACE_PATCH\n      ? workspacePatch(roots, request.arguments)\n      : memoryPut(stateDir, request.arguments)'
  const queueAnchor = '    const previousTurn = settlementTurn\n    settlementTurn = new Promise((resolve) => { releaseTurn = resolve })'
  const delayed = original.replace(effectAnchor, `${effectAnchor}
    if (request.arguments?.key === 'shutdown-queue-first') {
      writeFileSync(process.env.AUKORA_B46_FIRST, 'effect-started')
      await new Promise((resolve) => setTimeout(resolve, 250))
    }`)
  const changed = delayed.replace(queueAnchor, `    const previousTurn = settlementTurn
    if (request.arguments?.key === 'shutdown-queue-second') writeFileSync(process.env.AUKORA_B46_QUEUED, 'queued')
    settlementTurn = new Promise((resolve) => { releaseTurn = resolve })`)
  if (delayed === original || changed === delayed) {
    throw new Error('B46 could not install the effect and settlement-queue controls')
  }
  writeFileSync(stopEntry, changed, 'utf8')
  const stopChild = await spawnMutantBroker({
    entry: stopEntry,
    socketPath: stopSocket,
    stateDir: stopState,
    rootPublicKeyPem: rootPem,
    env: {
      ...process.env,
      AUKORA_B46_FIRST: firstMarker,
      AUKORA_B46_QUEUED: queuedMarker,
    },
  })
  const stopClient = client(stopSocket)
  const status = await stopClient.send({ op: 'status' })
  const firstArgs = { key: 'shutdown-queue-first', value: { text: 'first' } }
  const secondArgs = { key: 'shutdown-queue-second', value: { text: 'second' } }
  const firstGrant = mint(MEMORY_PUT, firstArgs, { receiptKeyId: status.receiptKeyId })
  const secondGrant = mint(MEMORY_PUT, secondArgs, { receiptKeyId: status.receiptKeyId })
  void stopClient.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: firstArgs, grant: firstGrant })
  const firstReached = await waitForMarker(firstMarker)
  void stopClient.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: secondArgs, grant: secondGrant })
  const queuedReached = await waitForMarker(queuedMarker)
  const exit = new Promise((resolve) => stopChild.once('exit', (code, signal) => resolve({ code, signal })))
  stopChild.kill('SIGTERM')
  const exited = await exit
  stopClient.close()
  const auraPath = join(stopState, 'aura.jsonl')
  const auraRows = existsSync(auraPath)
    ? readFileSync(auraPath, 'utf8').trim().split('\n').filter(Boolean).length
    : 0
  row('B46', 'graceful stop refuses a queued request before nonce claim', {
    firstReached,
    queuedReached,
    exited,
    firstNonceClaimed: existsSync(join(stopState, 'nonces', firstGrant.nonce)),
    firstProjectionWritten: existsSync(join(stopState, 'memory', 'keys', 'shutdown-queue-first.json')),
    secondNonceClaimed: existsSync(join(stopState, 'nonces', secondGrant.nonce)),
    secondIntentWritten: existsSync(join(stopState, 'intents', `${secondGrant.nonce}.json`)),
    secondProjectionWritten: existsSync(join(stopState, 'memory', 'keys', 'shutdown-queue-second.json')),
    auraRows,
    socketReleased: !existsSync(stopSocket),
    leaseReleased: !existsSync(join(stopState, '.broker-active.lock')),
  }, {
    firstReached: true,
    queuedReached: true,
    exited: { code: 0, signal: null },
    firstNonceClaimed: true,
    firstProjectionWritten: true,
    secondNonceClaimed: false,
    secondIntentWritten: false,
    secondProjectionWritten: false,
    auraRows: 1,
    socketReleased: true,
    leaseReleased: true,
  })
}

// B42 — the startup callback must not mistake a replacement socket for the
// listener that just bound. The copied source pauses only after `listen()` has
// succeeded. The court then swaps the pathname for both a foreign socket and a
// regular file, so the production path must reject without `server.close()`
// unlinking either replacement.
{
  const runSwap = async (kind) => {
    const raceAukora = join(TMP, `route-bind-${kind}-aukora`)
    const raceEntry = join(raceAukora, 'broker', 'broker.mjs')
    const raceState = join(TMP, `route-bind-${kind}-state`)
    const raceSocket = join(TMP, `route-bind-${kind}.sock`)
    const raceMarker = join(TMP, `route-bind-${kind}-marker`)
    copyMutantAukora(raceAukora)
    const original = readFileSync(raceEntry, 'utf8')
    const anchor = "server.listen(socketPath, () => {\n        if (listenSettled) return"
    const changed = original.replace(anchor, `server.listen(socketPath, async () => {
        if (process.env.AUKORA_B42_BIND_MARKER) {
          writeFileSync(process.env.AUKORA_B42_BIND_MARKER, 'bound')
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
        if (listenSettled) return`)
    if (changed === original) throw new Error(`B42 could not install the ${kind} post-bind pause`)
    writeFileSync(raceEntry, changed, 'utf8')
    const { serve: serveCopied } = await import(`${pathToFileURL(raceEntry).href}?court=route-bind-${kind}`)
    const priorMarker = process.env.AUKORA_B42_BIND_MARKER
    process.env.AUKORA_B42_BIND_MARKER = raceMarker
    let outcome
    let foreign = null
    const foreignSockets = new Set()
    try {
      const launch = serveCopied({ socketPath: raceSocket, stateDir: raceState, rootPublicKeyPem: rootPem })
        .then(() => ({ reason: null }))
        .catch((error) => ({ reason: String(error?.message ?? error) }))
      const bound = await waitForMarker(raceMarker)
      if (!bound) throw new Error(`B42 ${kind} copied listener did not reach the post-bind pause`)
      unlinkSync(raceSocket)
      if (kind === 'socket') {
        foreign = createServer((socket) => {
          foreignSockets.add(socket)
          socket.once('close', () => foreignSockets.delete(socket))
          let input = ''
          socket.on('data', (chunk) => {
            input += chunk
            const newline = input.indexOf('\n')
            if (newline === -1) return
            let request
            try {
              request = JSON.parse(input.slice(0, newline))
            } catch {
              socket.end('SQUATTER\n')
              return
            }
            if (request?.op === 'broker:route-probe') {
              // The challenge is visible to the substituted listener. Echoing
              // it as a putative signature must not satisfy the broker-key
              // verification that distinguishes this endpoint from the real one.
              socket.end(`${JSON.stringify({ id: request.id, ok: true, signature: request.challenge })}\n`)
              return
            }
            socket.end('SQUATTER\n')
          })
        })
        await new Promise((resolve, reject) => {
          foreign.once('error', reject)
          foreign.listen(raceSocket, () => {
            foreign.removeListener('error', reject)
            resolve()
          })
        })
      } else {
        writeFileSync(raceSocket, 'FOREIGN\n', 'utf8')
      }
      outcome = await launch
      const leaseRetained = existsSync(join(raceState, '.broker-active.lock'))
      if (kind === 'socket') {
        const foreignReply = await new Promise((resolve, reject) => {
          const socket = createConnection(raceSocket)
          let output = ''
          socket.on('data', (chunk) => { output += chunk })
          socket.once('connect', () => socket.write('{"op":"outside"}\n'))
          socket.once('end', () => resolve(output.trim()))
          socket.once('error', reject)
        })
        return { reason: outcome.reason, foreignReply, leaseRetained }
      }
      return { reason: outcome.reason, fileBytes: readFileSync(raceSocket, 'utf8'), leaseRetained }
    } finally {
      if (priorMarker === undefined) delete process.env.AUKORA_B42_BIND_MARKER
      else process.env.AUKORA_B42_BIND_MARKER = priorMarker
      if (foreign !== null) {
        for (const socket of foreignSockets) socket.destroy()
        await new Promise((resolve) => foreign.close(resolve))
      }
    }
  }
  const socket = await runSwap('socket')
  const file = await runSwap('file')
  row('B42', 'a post-bind route swap neither returns nor removes the foreign endpoint', { socket, file }, {
    socket: { reason: 'broker:socket-route-lost', foreignReply: 'SQUATTER', leaseRetained: true },
    file: { reason: 'broker:socket-path-occupied', fileBytes: 'FOREIGN\n', leaseRetained: true },
  })
}

// B43 — a final nonce filename is evidence read by fresh processes, so it must
// become visible only after the record is complete. A copied book pauses after
// its candidate is durable but before link publication. A normal claimant then
// wins the final name; the paused and later claimants must both refuse cleanly.
{
  const stagedAukora = join(TMP, 'nonce-staged-aukora')
  const stagedEntry = join(stagedAukora, 'host-dsh', 'src', 'nonce-book.mjs')
  const stagedState = join(TMP, 'nonce-staged-state')
  const ready = join(TMP, 'nonce-staged-ready')
  const release = join(TMP, 'nonce-staged-release')
  const nonce = 'staged-publication-claim'
  const exp = Math.floor(Date.now() / 1000) + 300
  mkdirSync(stagedState, { mode: 0o700 })
  copyMutantAukora(stagedAukora)
  const original = readFileSync(stagedEntry, 'utf8')
  const anchor = '        fsyncSync(fd)\n        closeSync(fd)'
  const changed = original.replace(anchor, `        fsyncSync(fd)
        writeFileSync(process.env.AUKORA_B43_READY, 'candidate-durable')
        while (!existsSync(process.env.AUKORA_B43_RELEASE)) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
        }
        closeSync(fd)`)
  if (changed === original) throw new Error('B43 could not pause the durable candidate before publication')
  writeFileSync(stagedEntry, changed, 'utf8')
  const paused = startNonceClaimInProcess(stagedState, nonce, exp, {
    entry: stagedEntry,
    env: { ...process.env, AUKORA_B43_READY: ready, AUKORA_B43_RELEASE: release },
  })
  let pausedResult
  try {
    const candidateDurable = await waitForMarker(ready)
    if (!candidateDurable) throw new Error('B43 copied claimant did not durably stage its record')
    const publishedBeforeWinner = readdirSync(join(stagedState, 'nonces')).sort()
    const winning = await claimNonceInProcess(stagedState, nonce, exp)
    writeFileSync(release, 'release', 'utf8')
    pausedResult = await paused.result
    const afterWinner = await claimNonceInProcess(stagedState, nonce, exp)
    row('B43', 'a durable candidate is invisible until atomic nonce publication', {
      publishedBeforeWinner,
      winning,
      paused: pausedResult,
      afterWinner,
      claimFiles: readdirSync(join(stagedState, 'nonces')).sort(),
      stagingResidue: readdirSync(stagedState).filter((name) => name.startsWith('.nonce-candidate-')).sort(),
    }, {
      publishedBeforeWinner: [],
      winning: { status: 0, result: true, seeded: true, stderr: '' },
      paused: { status: 0, result: false, seeded: true, stderr: '' },
      afterWinner: { status: 0, result: false, seeded: true, stderr: '' },
      claimFiles: [nonce],
      stagingResidue: [],
    })
  } finally {
    if (!existsSync(release)) writeFileSync(release, 'release', 'utf8')
    if (pausedResult === undefined) await paused.result
  }
}

// B44 — link publication temporarily gives the complete final record two
// names. A fresh opener must accept that exact transient rather than confusing
// it with an incomplete record or a second authorization.
{
  const linkedAukora = join(TMP, 'nonce-linked-aukora')
  const linkedEntry = join(linkedAukora, 'host-dsh', 'src', 'nonce-book.mjs')
  const linkedState = join(TMP, 'nonce-linked-state')
  const ready = join(TMP, 'nonce-linked-ready')
  const release = join(TMP, 'nonce-linked-release')
  const nonce = 'two-link-publication-claim'
  const exp = Math.floor(Date.now() / 1000) + 300
  mkdirSync(linkedState, { mode: 0o700 })
  copyMutantAukora(linkedAukora)
  const original = readFileSync(linkedEntry, 'utf8')
  const anchor = '        linkSync(candidate, path)\n        published = true'
  const changed = original.replace(anchor, `        linkSync(candidate, path)
        writeFileSync(process.env.AUKORA_B44_READY, 'published')
        while (!existsSync(process.env.AUKORA_B44_RELEASE)) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
        }
        published = true`)
  if (changed === original) throw new Error('B44 could not pause the linked record before staging cleanup')
  writeFileSync(linkedEntry, changed, 'utf8')
  const paused = startNonceClaimInProcess(linkedState, nonce, exp, {
    entry: linkedEntry,
    env: { ...process.env, AUKORA_B44_READY: ready, AUKORA_B44_RELEASE: release },
  })
  let pausedResult
  try {
    const published = await waitForMarker(ready)
    if (!published) throw new Error('B44 copied claimant did not publish its linked record')
    const linkCountDuringPublication = lstatSync(join(linkedState, 'nonces', nonce)).nlink
    const fresh = await claimNonceInProcess(linkedState, nonce, exp)
    writeFileSync(release, 'release', 'utf8')
    pausedResult = await paused.result
    row('B44', 'a fresh opener accepts the complete two-link nonce publication', {
      linkCountDuringPublication,
      fresh,
      paused: pausedResult,
      finalLinkCount: lstatSync(join(linkedState, 'nonces', nonce)).nlink,
      claimFiles: readdirSync(join(linkedState, 'nonces')).sort(),
      stagingResidue: readdirSync(linkedState).filter((name) => name.startsWith('.nonce-candidate-')).sort(),
    }, {
      linkCountDuringPublication: 2,
      fresh: { status: 0, result: false, seeded: true, stderr: '' },
      paused: { status: 0, result: true, seeded: true, stderr: '' },
      finalLinkCount: 1,
      claimFiles: [nonce],
      stagingResidue: [],
    })
  } finally {
    if (!existsSync(release)) writeFileSync(release, 'release', 'utf8')
    if (pausedResult === undefined) await paused.result
  }
}

// B45 — a directory-sync failure after a final name links must never return
// authority. The copied source faults only that post-publication fsync; a fresh
// production opener sees the complete visible burn and still refuses.
{
  const syncAukora = join(TMP, 'nonce-sync-fault-aukora')
  const syncEntry = join(syncAukora, 'host-dsh', 'src', 'nonce-book.mjs')
  const syncState = join(TMP, 'nonce-sync-fault-state')
  const nonce = 'directory-sync-fault-claim'
  const exp = Math.floor(Date.now() / 1000) + 300
  mkdirSync(syncState, { mode: 0o700 })
  copyMutantAukora(syncAukora)
  const original = readFileSync(syncEntry, 'utf8')
  const anchor = '          fsyncSync(directoryDescriptor)'
  const changed = original.replace(anchor, "          throw new Error('court: directory sync fault')")
  if (changed === original) throw new Error('B45 could not fault the post-publication directory sync')
  writeFileSync(syncEntry, changed, 'utf8')
  const faulted = await startNonceClaimInProcess(syncState, nonce, exp, { entry: syncEntry }).result
  const fresh = await claimNonceInProcess(syncState, nonce, exp)
  row('B45', 'post-publication directory-sync uncertainty burns without admission', {
    faulted,
    fresh,
    claimFiles: readdirSync(join(syncState, 'nonces')).sort(),
    stagingResidue: readdirSync(syncState).filter((name) => name.startsWith('.nonce-candidate-')).sort(),
  }, {
    faulted: { status: 0, result: 'uncertain', seeded: true, stderr: '' },
    fresh: { status: 0, result: false, seeded: true, stderr: '' },
    claimFiles: [nonce],
    stagingResidue: [],
  })
}

// B40 — the helper's interpreter is captured when this module initializes.
// A caller can modify process.execPath afterward and supply an executable that
// sends the expected IPC frame, but it must not become the child this helper
// launches. Pre-import mutation remains an open parent-custody problem.
{
  const fakeNode = join(TMP, 'fake-node')
  const fakeMarker = join(TMP, 'fake-node-ran')
  const canonicalNode = process.execPath
  const executableState = join(TMP, 'fixed-executable-state')
  const executableSocket = join(TMP, 'fixed-executable.sock')
  writeFileSync(fakeNode, [
    '#!/bin/sh',
    `printf invoked > ${JSON.stringify(fakeMarker)}`,
    `exec ${JSON.stringify(canonicalNode)} --input-type=module -e ${JSON.stringify("process.send({ type: 'aukora:broker-ready' }); setInterval(() => {}, 1000)")}`,
    '',
  ].join('\n'), { mode: 0o700 })
  chmodSync(fakeNode, 0o700)
  let child = null
  let overrideApplied = false
  try {
    process.execPath = fakeNode
    overrideApplied = process.execPath === fakeNode
    child = await spawnBroker({ socketPath: executableSocket, stateDir: executableState, rootPublicKeyPem: rootPem })
  } finally {
    process.execPath = canonicalNode
  }
  const fakeInvoked = existsSync(fakeMarker)
  const socketCreated = existsSync(executableSocket)
  if (child !== null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill()
    await exited
  }
  row('B40', 'a post-import executable override cannot launch the broker child', {
    overrideApplied,
    fakeInvoked,
    socketCreated,
  }, {
    overrideApplied: true,
    fakeInvoked: false,
    socketCreated: true,
  })
}

// B35 — legacy callers may still present the old mutation option as untyped
// JavaScript. It must be ignored: the canonical product launcher always strips
// preload state, while the test-only helper owns the deliberate mutation arm.
{
  const legacyState = join(TMP, 'legacy-skip-scrub-state')
  const legacySocket = join(TMP, 'legacy-skip-scrub.sock')
  const legacyBroker = await spawnBroker({
    socketPath: legacySocket,
    stateDir: legacyState,
    rootPublicKeyPem: rootPem,
    skipScrub: true,
  })
  const legacyClient = client(legacySocket)
  const status = await legacyClient.send({ op: 'status' })
  legacyClient.close()
  const legacyExited = new Promise((resolve) => legacyBroker.once('exit', resolve))
  legacyBroker.kill()
  await legacyExited
  row('B35', 'a legacy unsafe launch option cannot disable the scrub', {
    nodeOptionsAbsent: status.env.NODE_OPTIONS === null,
    linkerPathAbsent: status.env.LD_LIBRARY_PATH === null,
    cryptoHonest: status.cryptoHonest === true,
  }, {
    nodeOptionsAbsent: true,
    linkerPathAbsent: true,
    cryptoHonest: true,
  })
}

// P1 — the differential. A poisoned child verifies the forged grant IN-PROCESS
// (the control: the poison works) and the same grant refuses through the broker.
{
  const forged = { ...mint(MEMORY_PUT, ARGS), signature: Buffer.alloc(64).toString('base64') }
  const childCode = [
    "const { verifyGrant } = await import(" + JSON.stringify(join(HERE, '../../../aukora/host-dsh/src/grant.mjs')) + ")",
    "const { definitionDigest } = await import(" + JSON.stringify(join(HERE, '../../../aukora/broker/effect.mjs')) + ")",
    "const { buildOperation, operationDigest } = await import(" + JSON.stringify(join(HERE, '../../../aukora/broker/operation.mjs')) + ")",
    `const forged = ${JSON.stringify(forged)}`,
    "const args = { key: 'greeting', value: { text: 'owned' } }",
    `const inProcess = verifyGrant({ grant: forged, toolName: 'memory.put', args, rootPublicKeyPem: ${JSON.stringify(rootPem)}, seenNonces: new Set(), now: Date.now(), expectedDefinitionId: definitionDigest(), expectedOperationDigest: forged.operationDigest, expectedReceiptKeyId: forged.receiptKeyId })`,
    "console.log(JSON.stringify({ inProcessAdmits: inProcess.ok, reason: inProcess.reason }))",
  ].join('\n')
  const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], {
    env: { ...process.env, NODE_OPTIONS: `--import=${poisonFile}` },
  })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  const childResult = await new Promise((resolve) => child.on('close', () => resolve(JSON.parse(out || '{}'))))
  const brokerResult = await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: ARGS, grant: forged })
  row('P1', 'poison admits in-process and the broker refuses the same grant', {
    inProcessAdmits: childResult.inProcessAdmits === true,
    brokerRefuses: brokerResult.reason === REFUSE.BAD_SIGNATURE,
  }, { inProcessAdmits: true, brokerRefuses: true }, childResult.inProcessAdmits !== true || brokerResult.reason !== REFUSE.BAD_SIGNATURE)
}

await cli.close()
if (broker !== null) {
  const brokerExited = new Promise((resolve) => broker.once('exit', resolve))
  broker.kill()
  await brokerExited
}

console.log('\n  courts/harness/broker — the capability lives in a second process\n  ' + '-'.repeat(72))
for (const r of rows) {
  console.log(`  ${r.n}  ${String(r.label).padEnd(56)} ${JSON.stringify(r.observed) === JSON.stringify(r.expected) ? 'held' : '*** BREACH ***'}  ${JSON.stringify(r.observed).slice(0, 80)}`)
}
if (MUTATE) {
  const rowByName = new Map(rows.map((entry) => [entry.n, entry]))
  const discriminators = ['B1', 'B5', 'P1']
  const controls = ['B2', 'B3', 'B4', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17', 'B18', 'B19', 'B20', 'B21', 'B22', 'B23', 'B24', 'B25', 'B26', 'B27', 'B28', 'B29', 'B30', 'B31', 'B32', 'B33', 'B34', 'B35', 'B36', 'B37', 'B38', 'B39', 'B40', 'B41', 'B42', 'B43', 'B44', 'B45', 'B46']
  const expectedRows = [...discriminators, ...controls]
  const rowsComplete = rows.length === expectedRows.length
    && rowByName.size === rows.length
    && expectedRows.every((name) => rowByName.has(name))
  const discriminatorsBreached = discriminators.every((name) => rowByName.get(name)?.breach === true)
  const controlsHeld = controls.every((name) => rowByName.get(name)?.breach === false)
  const detected = rowsComplete && discriminatorsBreached && controlsHeld
  const breached = rows.filter((entry) => entry.breach).map((entry) => entry.n)
  console.log(`\n  MUTATION unscrubbed broker`)
  console.log(`  discriminatorsBreached=${discriminatorsBreached} rows=[${discriminators.join(' ')}]`)
  console.log(`  controlsHeld=${controlsHeld} rows=[${controls.join(' ')}]`)
  console.log(`  rowsComplete=${rowsComplete} expected=${expectedRows.length} observed=${rows.length}`)
  console.log(`  breached=[${breached.join(' ')}]  ${detected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  rmSync(TMP, { recursive: true, force: true })
  process.exit(detected ? 0 : 1)
}
const expectedRows = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17', 'B18', 'B19', 'B20', 'B21', 'B22', 'B23', 'B24', 'B25', 'B26', 'B27', 'B28', 'B29', 'B30', 'B31', 'B32', 'B33', 'B34', 'B35', 'B36', 'B37', 'B38', 'B39', 'B40', 'B41', 'B42', 'B43', 'B44', 'B45', 'B46', 'P1']
const exactRows = rows.length === expectedRows.length
  && new Set(rows.map((entry) => entry.n)).size === rows.length
  && expectedRows.every((name) => rows.some((entry) => entry.n === name))
const anyBreach = rows.some((r) => r.breach)
console.log('\n  observationClass: SELF-REPORTED\n')
rmSync(TMP, { recursive: true, force: true })
process.exit(anyBreach || !exactRows ? 1 : 0)
