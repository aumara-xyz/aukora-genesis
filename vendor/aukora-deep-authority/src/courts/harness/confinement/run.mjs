/**
 * courts/harness/confinement — the uid gate: confinement is measured and
 * signed, or the broker does not boot.
 *
 * WHY THIS COURT EXISTS SEPARATELY FROM uid-confinement. That court needs a
 * real second uid, so it exits 77 on a Mac and the boundary logic has never
 * once been exercised on the machine this is written on. This court runs the
 * SAME code path on both platforms and simply measures a truthful answer: on
 * darwin every class is `state-owned`, and the rows that matter — a broker
 * that refuses to boot on a state directory it does not exclusively own, and a
 * verifier that refuses a receipt whose signed class is below what the reader
 * required — run green HERE.
 *
 *   C1  control        a fresh 0700 state dir the process exclusively owns boots and settles
 *   C2  or don't boot  a PRE-EXISTING 0777 state dir refuses by name, in the real spawned broker
 *   C3  foreign uid    a directory owned by another uid refuses state-not-exclusively-owned
 *   C4  root           euid 0 refuses root-euid: root reads every uid's private files
 *   C5  in the bytes   the confinement field is inside the signature; changing it refuses signature-invalid
 *   C6  in the record  the Aura entry carries the identical confinement object
 *   C7  required class require:{class:'peer-separated'} refuses this host's receipt by name
 *   C8  not mintable   a hand-minted `unconfined` receipt refuses with no `require` at all
 *   C9  no self-raise  a client echo cannot raise its class while separation is disproven
 *   C10 peer mechanism broker's own EACCES + correct echo raises; wrong echo does not
 *   C11 the ratchet    a state dir that served the higher class refuses the weaker connection,
 *                      before the grant is spent — no object, no record entry, nonce intact
 *   C12 seal downgrade a sealed directory refuses to BOOT when the launch cannot reach its class
 *   C13 foreign seal   a seal carried into another directory refuses seal-foreign-directory
 *   C14 limitation     what this host does NOT get, recorded rather than implied
 *   C15 false absence  a dangling seal refuses instead of becoming an empty history
 *   C16 fresh denial   a boot-time EACCES cannot be replayed after the broker can read the token
 *   C17 demotion       a configured readable token serves honestly at state-owned
 *   C18 publish error  a post-rename seal flush failure poisons later dispatch
 *   C19 recovery      an explicit device-only repair preserves seal identity and retained bytes
 *
 * --mutate runs three sabotages, each removing one half of the gate, and the
 * court must detect all three: a boot check that skips the measurement, a
 * verifier that ignores the signed class, and a ratchet that ignores the seal.
 *
 *   node courts/harness/confinement/run.mjs
 *   node courts/harness/confinement/run.mjs --mutate
 */
import { generateKeyPairSync, sign as edSign, randomBytes, createHash, createPrivateKey } from 'node:crypto'
import { mkdtempSync, mkdirSync, chmodSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync, symlinkSync, linkSync, lstatSync, realpathSync } from 'node:fs'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createConnection } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { spawnMutantBroker } from '../support/spawn-mutant-broker.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const { payloadDigest, grantPreimage, newNonce } = await import(join(ROOT, 'aukora/host-dsh/src/grant.mjs'))
const { definitionDigest, observe, MEMORY_PUT } = await import(join(ROOT, 'aukora/broker/effect.mjs'))
const { buildOperation, operationDigest } = await import(join(ROOT, 'aukora/broker/operation.mjs'))
const { spawnBroker } = await import(join(ROOT, 'aukora/broker/broker.mjs'))
const { verifyReceipt, receiptPreimage, requestDigest, RECEIPT_REFUSE } = await import(join(ROOT, 'aukora/broker/receipt.mjs'))
const { readEntries } = await import(join(ROOT, 'aukora/aura/record.mjs'))
const {
  CONFINEMENT_CLASS, CONFINEMENT_REFUSE, SEAL_FILENAME, PEER_TOKEN_BYTES,
  measureStateDirectory, readSeal,
} = await import(join(ROOT, 'aukora/broker/confinement.mjs'))

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--mutate')) {
  console.error('usage: node courts/harness/confinement/run.mjs [--mutate]')
  process.exit(2)
}
const MUTATE = args[0] === '--mutate'
const BROKER_ENTRY = join(ROOT, 'aukora/broker/broker.mjs')
const TMP = mkdtempSync(join(tmpdir(), 'aukora-confinement-'))
const DEF = definitionDigest()
const EUID = process.geteuid()

const root = generateKeyPairSync('ed25519')
const rootPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()

const rows = []
const EXPECTED_ROWS = Array.from({ length: 19 }, (_, index) => `C${index + 1}`)
const row = (n, label, observed, expected) => {
  rows.push({ n, label, observed, expected, breach: JSON.stringify(observed) !== JSON.stringify(expected) })
}

/** A sabotage is meaningful only while every ordinary confinement row holds. */
const ordinaryRowsHeld = () => rows.length === EXPECTED_ROWS.length
  && new Set(rows.map(({ n }) => n)).size === rows.length
  && EXPECTED_ROWS.every((name) => rows.some((row) => row.n === name))
  && rows.every(({ breach }) => !breach)

/** One grant for one call. Every field the hardened verifier requires. */
const mintGrant = (args, nonce, receiptKeyId) => {
  const exp = Math.floor(Date.now() / 1000) + 300
  const g = {
    toolName: MEMORY_PUT, digest: payloadDigest(MEMORY_PUT, args), nonce,
    exp, definitionId: DEF, operationDigest: operationDigest(buildOperation(args, exp)), receiptKeyId,
  }
  return { ...g, signature: edSign(null, grantPreimage(g), root.privateKey).toString('base64') }
}

/** A newline-delimited JSON client over one connection. */
const client = (socketPath) => {
  const conn = createConnection(socketPath)
  let buffer = ''
  const pending = new Map()
  let id = 0
  conn.on('error', () => { /* a court that closes mid-frame is not an event this client acts on */ })
  conn.on('data', (chunk) => {
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
  return {
    send: (request) => new Promise((resolve) => {
      const rid = ++id
      pending.set(rid, resolve)
      conn.write(`${JSON.stringify({ id: rid, ...request })}\n`)
    }),
    close: () => conn.destroy(),
  }
}

/**
 * Launch broker.mjs exactly as production does and collect its stderr and exit
 * code. A refusal exits within milliseconds; a broker that BOOTS runs forever,
 * so the wait is bounded and a survivor is reported as `code: 'still-running'`.
 * Without the bound, deleting the gate would hang this court instead of failing
 * it — a court that hangs on sabotage grades nothing.
 */
const bootRaw = ({ stateDir, socketPath, timeoutMs = 10000 }) => new Promise((resolve) => {
  const child = spawn(process.execPath, [BROKER_ENTRY], {
    env: { ...process.env, AUKORA_SOCKET: socketPath, AUKORA_STATE_DIR: stateDir, AUKORA_ROOT_PEM: rootPem },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let err = ''
  let settled = false
  const finish = (result) => { if (!settled) { settled = true; resolve(result) } }
  const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ code: 'still-running', stderr: err.trim() }) }, timeoutMs)
  if (typeof timer.unref === 'function') timer.unref()
  child.stderr.on('data', (d) => { err += d })
  child.on('exit', (code) => { clearTimeout(timer); finish({ code, stderr: err.trim() }) })
})

const objectsIn = (stateDir) => {
  const dir = join(stateDir, 'memory', 'objects')
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).length : 0
}
const entriesIn = (stateDir) => readEntries(join(stateDir, 'aura.jsonl')).length

// ---------------------------------------------------------------------------
// C1, C5, C6, C7, C8 — one real settlement on a directory this process owns.
// ---------------------------------------------------------------------------
const okDir = join(TMP, 'ok', 'state')
const okSock = join(TMP, 'ok', 'b.sock')
mkdirSync(join(TMP, 'ok'), { recursive: true, mode: 0o700 })

const broker1 = await spawnBroker({ socketPath: okSock, stateDir: okDir, rootPublicKeyPem: rootPem })
const cli1 = client(okSock)
const status1 = await cli1.send({ op: 'status' })
const ARGS1 = { key: 'confined', value: { text: 'measured' } }
const put1 = await cli1.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: ARGS1, grant: mintGrant(ARGS1, 'conf-01', status1.receiptKeyId) })
const conf1 = put1.receipt?.confinement

row('C1', 'a state dir this process exclusively owns boots and settles', {
  settled: put1.state === 'SETTLED',
  mode: measureStateDirectory({ stateDir: okDir, euid: EUID }).stateMode,
  class: conf1?.class,
  ceiling: status1.confinement?.ceiling,
  verifies: verifyReceipt({ receipt: put1.receipt, brokerPublicKeyPem: put1.brokerPublicKeyPem, observe }).ok === true,
}, { settled: true, mode: '0700', class: CONFINEMENT_CLASS.STATE_OWNED, ceiling: CONFINEMENT_CLASS.STATE_OWNED, verifies: true })

{
  // The confinement observation is INSIDE the signature, not beside it. Use
  // another semantically valid private mode so malformed-field validation
  // cannot be the thing that catches the forgery.
  const changed = { ...put1.receipt, confinement: { ...conf1, stateMode: '0600' } }
  const v = verifyReceipt({ receipt: changed, brokerPublicKeyPem: put1.brokerPublicKeyPem, observe })
  row('C5', 'the confinement field is inside the signature; changing it refuses', {
    reason: v.reason,
    signedFields: put1.receipt.confinement !== undefined,
  }, { reason: RECEIPT_REFUSE.BAD_SIGNATURE, signedFields: true })
}

{
  const entry = readEntries(join(okDir, 'aura.jsonl')).at(-1)
  row('C6', 'the record entry carries the identical confinement object', {
    same: JSON.stringify(entry?.confinement) === JSON.stringify(conf1),
    class: entry?.confinement?.class,
  }, { same: true, class: CONFINEMENT_CLASS.STATE_OWNED })
}

{
  const v = verifyReceipt({ receipt: put1.receipt, brokerPublicKeyPem: put1.brokerPublicKeyPem, observe, require: { class: CONFINEMENT_CLASS.PEER_SEPARATED } })
  row('C7', 'a reader requiring peer-separated refuses this host\'s receipt by name', {
    reason: v.reason,
  }, { reason: RECEIPT_REFUSE.CONFINEMENT_INSUFFICIENT })
}

// C8 — the same-uid attacker posture the settlement court already assumes: the
// court reads the broker's own signing key, because at one uid it can. Even
// with a VALID signature, `unconfined` is refused with no `require` supplied.
const brokerKey = createPrivateKey(JSON.parse(readFileSync(join(okDir, 'keys', 'broker.json'), 'utf8')).privatePem)
{
  const claims = {
    requestDigest: requestDigest(MEMORY_PUT, ARGS1),
    definitionId: DEF, nonce: 'conf-unconfined', sequence: 99,
    path: put1.evidence.path,
    bytes: put1.evidence.bytes,
    contentSha256: put1.evidence.contentSha256,
    inode: put1.evidence.inode,
    mtimeNs: put1.evidence.mtimeNs,
    confinement: { ...conf1, class: CONFINEMENT_CLASS.UNCONFINED, sealClass: CONFINEMENT_CLASS.UNCONFINED },
  }
  const forged = {
    ...claims,
    signature: edSign(null, receiptPreimage(claims), brokerKey).toString('base64'),
  }
  const v = verifyReceipt({ receipt: forged, brokerPublicKeyPem: put1.brokerPublicKeyPem, observe })
  row('C8', 'a validly signed `unconfined` receipt refuses with no require at all', {
    reason: v.reason,
  }, { reason: RECEIPT_REFUSE.CONFINEMENT_INSUFFICIENT })
}

// C9 — nothing a client SAYS raises its own class.
{
  const bluff = await cli1.send({ op: 'confinement.prove', token: randomBytes(PEER_TOKEN_BYTES).toString('base64') })
  const ARGS2 = { key: 'afterbluff', value: 1 }
  const put2 = await cli1.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: ARGS2, grant: mintGrant(ARGS2, 'conf-02', status1.receiptKeyId) })
  row('C9', 'a client echo cannot raise its own class while separation is disproven', {
    proveRefused: bluff.ok === false,
    reason: bluff.reason,
    classAfter: put2.receipt?.confinement?.class,
  }, { proveRefused: true, reason: CONFINEMENT_REFUSE.PEER_SEPARATION_DISPROVEN, classAfter: CONFINEMENT_CLASS.STATE_OWNED })
}
cli1.close()
broker1.kill()
await delay(50)

// ---------------------------------------------------------------------------
// C2 — the flagship: `or don't boot`, in the real spawned broker, on this Mac.
// ---------------------------------------------------------------------------
const openDir = join(TMP, 'open', 'state')
mkdirSync(openDir, { recursive: true, mode: 0o700 })
chmodSync(openDir, 0o777)
const modeBeforeBoot = measureStateDirectory({ stateDir: openDir, euid: EUID }).stateMode
const openBoot = await bootRaw({ stateDir: openDir, socketPath: join(TMP, 'open', 'b.sock') })
row('C2', 'a pre-existing 0777 state dir refuses to boot, by name', {
  modeBeforeBoot,
  // mkdirSync(…, {mode: 0o700}) does NOT tighten an existing directory: this is
  // the measurement that says the old broker served from a wide-open state dir.
  modeAfterMkdir: measureStateDirectory({ stateDir: openDir, euid: EUID }).stateMode,
  exitCode: openBoot.code,
  named: openBoot.stderr.startsWith(CONFINEMENT_REFUSE.STATE_MODE_OPEN),
  socketCreated: existsSync(join(TMP, 'open', 'b.sock')),
}, { modeBeforeBoot: '0777', modeAfterMkdir: '0777', exitCode: 1, named: true, socketCreated: false })

// ---------------------------------------------------------------------------
// C3, C4 — refusals this host cannot stage with a real second uid, measured
// against facts the kernel reports anyway.
// ---------------------------------------------------------------------------
{
  // A genuinely foreign-owned directory, reported by the kernel, no root needed.
  const foreign = measureStateDirectory({ stateDir: '/usr/bin', euid: EUID })
  row('C3', 'a directory owned by another uid classes unconfined, by name', {
    stateUid: foreign.stateUid,
    isForeign: foreign.stateUid !== EUID,
    class: foreign.class,
    defect: foreign.defect,
  }, { stateUid: 0, isForeign: true, class: CONFINEMENT_CLASS.UNCONFINED, defect: CONFINEMENT_REFUSE.STATE_NOT_OWNED })
}
{
  // euid is an explicit parameter of the measurement so the root refusal is
  // testable where the court cannot become root. serve() takes no such
  // parameter and passes process.geteuid() literally.
  const asRoot = measureStateDirectory({ stateDir: okDir, euid: 0 })
  row('C4', 'euid 0 classes unconfined before anything else is looked at', {
    class: asRoot.class,
    defect: asRoot.defect,
    lookedAtDirectory: asRoot.stateUid !== null,
  }, { class: CONFINEMENT_CLASS.UNCONFINED, defect: CONFINEMENT_REFUSE.ROOT_EUID, lookedAtDirectory: false })
}

// ---------------------------------------------------------------------------
// C10, C11 — the upward path and the ratchet.
//
// HONESTY NOTE, AND IT IS THE WHOLE POINT OF THIS BLOCK. The token below is
// mode 0000, so THIS process suffers a real EACCES reading it, and the raise
// is gated on that real failure. It is NOT a uid split: the court knows the
// bytes because it generated them, and at one uid it could chmod the file
// back. These rows measure that the peer-challenge and ratchet CODE PATHS run
// and refuse correctly — they do not measure that a boundary existed. Row C14
// says so again where a reader cannot miss it.
// ---------------------------------------------------------------------------
const ratchetDir = join(TMP, 'ratchet', 'state')
const ratchetSock = join(TMP, 'ratchet', 'b.sock')
mkdirSync(join(TMP, 'ratchet'), { recursive: true, mode: 0o700 })
const tokenPath = join(TMP, 'ratchet', 'peer-token')
const tokenBytes = randomBytes(PEER_TOKEN_BYTES)
writeFileSync(tokenPath, tokenBytes, { mode: 0o600 })
chmodSync(tokenPath, 0o000)
const tokenSha256 = createHash('sha256').update(tokenBytes).digest('hex')

const broker2 = await spawnBroker({
  socketPath: ratchetSock, stateDir: ratchetDir, rootPublicKeyPem: rootPem,
  peerTokenPath: tokenPath, peerTokenSha256: tokenSha256,
})
const cli2 = client(ratchetSock)
const status2 = await cli2.send({ op: 'status' })
const wrongEcho = await cli2.send({ op: 'confinement.prove', token: randomBytes(PEER_TOKEN_BYTES).toString('base64') })
const rightEcho = await cli2.send({ op: 'confinement.prove', token: tokenBytes.toString('base64') })
const ARGS3 = { key: 'separated', value: { via: 'echo' } }
const put3 = await cli2.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: ARGS3, grant: mintGrant(ARGS3, 'conf-03', status2.receiptKeyId) })

row('C10', 'broker EACCES + correct echo raises; a wrong echo does not', {
  challengeAvailable: status2.confinement?.peerChallengeAvailable,
  wrongEchoOk: wrongEcho.ok,
  wrongReason: wrongEcho.reason,
  rightEchoClass: rightEcho.class,
  settledClass: put3.receipt?.confinement?.class,
  receiptSealClass: put3.receipt?.confinement?.sealClass,
  persistedSealClass: readSeal(ratchetDir).seal?.class,
  proofRecorded: put3.receipt?.confinement?.peerProof?.brokerReadError,
}, {
  challengeAvailable: true,
  wrongEchoOk: false,
  wrongReason: CONFINEMENT_REFUSE.PEER_ECHO_MISMATCH,
  rightEchoClass: CONFINEMENT_CLASS.PEER_SEPARATED,
  settledClass: CONFINEMENT_CLASS.PEER_SEPARATED,
  receiptSealClass: CONFINEMENT_CLASS.PEER_SEPARATED,
  persistedSealClass: CONFINEMENT_CLASS.PEER_SEPARATED,
  proofRecorded: 'EACCES',
})

// C16 — the denial is re-measured at proof and effect time. A cached EACCES
// must not stay stampable after permissions regress and the broker can read
// the launch token itself.
{
  chmodSync(tokenPath, 0o600)
  const readableByBroker = readFileSync(tokenPath).equals(tokenBytes)
  const fresh = client(ratchetSock)
  const reproved = await fresh.send({ op: 'confinement.prove', token: tokenBytes.toString('base64') })
  const args = { key: 'stale-peer-proof', value: 16 }
  const grant = mintGrant(args, 'conf-16', status2.receiptKeyId)
  const stale = await cli2.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: args, grant })
  fresh.close()
  row('C16', 'peer denial is re-measured before proof and settlement', {
    readableByBroker,
    freshProofReason: reproved.reason,
    staleProofReason: stale.reason,
    nonceClaimed: existsSync(join(ratchetDir, 'nonces', grant.nonce)),
  }, {
    readableByBroker: true,
    freshProofReason: CONFINEMENT_REFUSE.PEER_SEPARATION_DISPROVEN,
    staleProofReason: CONFINEMENT_REFUSE.BELOW_SEAL,
    nonceClaimed: false,
  })
  chmodSync(tokenPath, 0o000)
}

// C11 — the ratchet armed itself. A SECOND connection that does not prove is
// refused before the grant is consumed.
{
  const sealAfter = readSeal(ratchetDir)
  const cli3 = client(ratchetSock)
  const objectsBefore = objectsIn(ratchetDir)
  const entriesBefore = entriesIn(ratchetDir)
  const ARGS4 = { key: 'belowseal', value: 2 }
  const weakGrant = mintGrant(ARGS4, 'conf-04', status2.receiptKeyId)
  const refused = await cli3.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: ARGS4, grant: weakGrant })
  const objectsAfter = objectsIn(ratchetDir)
  const entriesAfter = entriesIn(ratchetDir)
  // The nonce must be INTACT: the refusal happened before the grant was spent,
  // so the very same grant settles once the connection reaches the sealed class.
  await cli3.send({ op: 'confinement.prove', token: tokenBytes.toString('base64') })
  const retried = await cli3.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: ARGS4, grant: weakGrant })
  cli3.close()
  row('C11', 'a sealed dir refuses the weaker connection before the grant is spent', {
    sealClass: sealAfter.seal?.class,
    refusedReason: refused.reason,
    leftNoObject: objectsAfter === objectsBefore,
    leftNoEntry: entriesAfter === entriesBefore,
    sameGrantThenSettles: retried.state === 'SETTLED',
  }, {
    sealClass: CONFINEMENT_CLASS.PEER_SEPARATED,
    refusedReason: CONFINEMENT_REFUSE.BELOW_SEAL,
    leftNoObject: true,
    leftNoEntry: true,
    sameGrantThenSettles: true,
  })
}
cli2.close()
broker2.kill()
await delay(50)

// ---------------------------------------------------------------------------
// C12 — the production gate: a sealed directory refuses to BOOT under a launch
// that cannot reach its class. No token this time; nobody configured this.
// ---------------------------------------------------------------------------
{
  const downgrade = await bootRaw({ stateDir: ratchetDir, socketPath: join(TMP, 'ratchet', 'again.sock') })
  row('C12', 'a sealed directory refuses to boot when the launch cannot reach its class', {
    exitCode: downgrade.code,
    named: downgrade.stderr.startsWith(CONFINEMENT_REFUSE.BELOW_SEAL),
  }, { exitCode: 1, named: true })
}

// ---------------------------------------------------------------------------
// C13 — a seal is evidence about ONE directory; it does not travel.
// ---------------------------------------------------------------------------
{
  const carried = join(TMP, 'carried', 'state')
  mkdirSync(carried, { recursive: true, mode: 0o700 })
  cpSync(join(ratchetDir, SEAL_FILENAME), join(carried, SEAL_FILENAME))
  chmodSync(join(carried, SEAL_FILENAME), 0o400)
  const boot = await bootRaw({ stateDir: carried, socketPath: join(TMP, 'carried', 'b.sock') })
  row('C13', 'a seal carried into another directory refuses by name', {
    exitCode: boot.code,
    named: boot.stderr.startsWith(CONFINEMENT_REFUSE.SEAL_FOREIGN_DIRECTORY),
  }, { exitCode: 1, named: true })
}

// ---------------------------------------------------------------------------
// C14 — the limitation, recorded rather than implied.
// ---------------------------------------------------------------------------
row('C14', 'this host mints state-owned only; the upward class is unproven here', {
  platform: process.platform,
  everyProductClassIsStateOwned: conf1?.class === CONFINEMENT_CLASS.STATE_OWNED,
  peerRowIsMechanismOnly: true,
}, { platform: process.platform, everyProductClassIsStateOwned: true, peerRowIsMechanismOnly: true })

// C18 — publication is the point at which the durable and in-memory
// high-water marks can diverge. Inject a directory-fsync failure after the
// atomic rename in a copy of the production source. The attempted stronger
// settlement is indeterminate, and the live dispatcher must then refuse every
// later effect before consuming its grant. Restart is the only recovery path.
{
  // Keep the Unix socket well below Darwin's short sun_path limit even when
  // the repository and primary court scratch paths are long.
  const failureRoot = mkdtempSync(join(tmpdir(), 'acf-'))
  const failureAukora = join(failureRoot, 'aukora')
  cpSync(join(ROOT, 'aukora'), failureAukora, { recursive: true })
  const failureConfinement = join(failureAukora, 'broker', 'confinement.mjs')
  const source = readFileSync(failureConfinement, 'utf8')
  const anchor = '    fsyncSync(directory)\n'
  const injected = `    if (confinementClass === CONFINEMENT_CLASS.PEER_SEPARATED) {\n      throw new Error('court:injected-post-rename-directory-fsync-failure')\n    }\n${anchor}`
  if (!source.includes(anchor)) throw new Error('C18: seal directory-fsync anchor not found')
  writeFileSync(failureConfinement, source.replace(anchor, injected), 'utf8')

  const stateDir = join(failureRoot, 'state')
  const socketPath = join(failureRoot, 'broker.sock')
  const peerTokenPath = join(failureRoot, 'peer-token')
  const peerToken = randomBytes(PEER_TOKEN_BYTES)
  writeFileSync(peerTokenPath, peerToken, { mode: 0o600 })
  chmodSync(peerTokenPath, 0o000)
  const peerTokenSha256 = createHash('sha256').update(peerToken).digest('hex')
  const running = await spawnMutantBroker({
    entry: join(failureAukora, 'broker', 'broker.mjs'),
    socketPath,
    stateDir,
    rootPublicKeyPem: rootPem,
    peerTokenPath,
    peerTokenSha256,
  })
  const strong = client(socketPath)
  const status = await strong.send({ op: 'status' })
  await strong.send({ op: 'confinement.prove', token: peerToken.toString('base64') })
  const strongArgs = { key: 'post-rename-failure', value: 18 }
  const stronger = await strong.send({
    op: 'memory.put', toolName: MEMORY_PUT, arguments: strongArgs,
    grant: mintGrant(strongArgs, 'conf-18-strong', status.receiptKeyId),
  })
  const weak = client(socketPath)
  const weakArgs = { key: 'after-seal-failure', value: 18 }
  const weakGrant = mintGrant(weakArgs, 'conf-18-weak', status.receiptKeyId)
  const refused = await weak.send({
    op: 'memory.put', toolName: MEMORY_PUT, arguments: weakArgs, grant: weakGrant,
  })
  const poisonedStatus = await weak.send({ op: 'status' })
  row('C18', 'a post-rename seal failure poisons later effects until restart', {
    firstState: stronger.state,
    persistedClass: readSeal(stateDir).seal?.class,
    laterState: refused.state,
    laterReason: refused.reason,
    laterNonceClaimed: existsSync(join(stateDir, 'nonces', weakGrant.nonce)),
    laterEffectRan: existsSync(join(stateDir, 'memory', 'keys', `${weakArgs.key}.json`)),
    statusSealClass: poisonedStatus.confinement?.sealClass,
    statusSealReliable: poisonedStatus.confinement?.sealReliable,
  }, {
    firstState: 'INDETERMINATE',
    persistedClass: CONFINEMENT_CLASS.PEER_SEPARATED,
    laterState: 'REFUSED',
    laterReason: 'broker:confinement-state-indeterminate',
    laterNonceClaimed: false,
    laterEffectRan: false,
    statusSealClass: null,
    statusSealReliable: false,
  })
  strong.close()
  weak.close()
  running.kill()
  await delay(50)
  rmSync(failureRoot, { recursive: true, force: true })
}

// C17 — a token that the broker can read disproves only the upward class. The
// configured digest must remain available for later remeasurement without
// turning ordinary state-owned service into an exception.
{
  const stateDir = join(TMP, 'readable-token', 'state')
  const socketPath = join(TMP, 'readable-token', 'broker.sock')
  mkdirSync(join(TMP, 'readable-token'), { recursive: true, mode: 0o700 })
  const readableTokenPath = join(TMP, 'readable-token', 'peer-token')
  const readableToken = randomBytes(PEER_TOKEN_BYTES)
  writeFileSync(readableTokenPath, readableToken, { mode: 0o600 })
  const readableTokenSha256 = createHash('sha256').update(readableToken).digest('hex')
  const running = await spawnBroker({
    socketPath,
    stateDir,
    rootPublicKeyPem: rootPem,
    peerTokenPath: readableTokenPath,
    peerTokenSha256: readableTokenSha256,
  })
  const connection = client(socketPath)
  const status = await connection.send({ op: 'status' })
  const args = { key: 'readable-token-demotion', value: 17 }
  const settled = await connection.send({
    op: 'memory.put',
    toolName: MEMORY_PUT,
    arguments: args,
    grant: mintGrant(args, 'conf-17', status.receiptKeyId),
  })
  connection.close()
  running.kill()
  row('C17', 'a readable configured token demotes without bricking service', {
    challengeAvailable: status.confinement?.peerChallengeAvailable,
    ceiling: status.confinement?.ceiling,
    settledState: settled.state,
    settledClass: settled.receipt?.confinement?.class,
  }, {
    challengeAvailable: false,
    ceiling: CONFINEMENT_CLASS.STATE_OWNED,
    settledState: 'SETTLED',
    settledClass: CONFINEMENT_CLASS.STATE_OWNED,
  })
}

// C15 — a dangling seal is still a state entry. It cannot grade as an absent
// high-water mark and let a weaker launch start over from zero.
{
  const stateDir = join(TMP, 'dangling-seal', 'state')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  symlinkSync(join(stateDir, 'missing-seal-target'), join(stateDir, SEAL_FILENAME))
  const boot = await bootRaw({ stateDir, socketPath: join(TMP, 'dangling-seal', 'b.sock') })
  row('C15', 'a dangling seal refuses instead of grading as absent', {
    exitCode: boot.code,
    named: boot.stderr.startsWith(CONFINEMENT_REFUSE.SEAL_UNREADABLE),
  }, { exitCode: 1, named: true })
}

// C19 uses the actual fixture owner, not a supplied euid or a root impersonation.
// The service repair is distinct from the root/TTY operator gate at its CLI.
{
  const { inspectSealRecovery, recoverSealDevice } = await import(join(ROOT, 'scripts/launchd-seal-recover.mjs'))
  const fixture = join(TMP, 'repair')
  mkdirSync(fixture, { mode: 0o700 })
  const stateDir = join(realpathSync(fixture), 'state')
  const socketPath = join(realpathSync(fixture), 'b.sock')
  const backupDir = join(realpathSync(fixture), 'backups')
  mkdirSync(backupDir, { mode: 0o700 })
  const running = await spawnBroker({ socketPath, stateDir, rootPublicKeyPem: rootPem })
  const connection = client(socketPath)
  const status = await connection.send({ op: 'status' })
  const args = { key: 'recovery-retained', value: { text: 'original retained bytes' } }
  const put = await connection.send({
    op: 'memory.put', toolName: MEMORY_PUT, arguments: args,
    grant: mintGrant(args, 'conf-19', status.receiptKeyId),
  })
  connection.close()
  const exited = once(running, 'exit')
  running.kill('SIGTERM')
  await exited
  const assertStopped = () => {
    assert.ok(running.exitCode !== null || running.signalCode !== null)
    assert.throws(() => process.kill(running.pid, 0), { code: 'ESRCH' })
  }
  const sealPath = join(stateDir, SEAL_FILENAME)
  const leasePath = join(stateDir, '.broker-active.lock')
  const originalSeal = readSeal(stateDir).seal
  const measurement = measureStateDirectory({ stateDir, euid: EUID })
  const fromDev = measurement.stateDev + 1
  const expected = { uid: EUID, ino: measurement.stateIno, fromDev, toDev: measurement.stateDev }
  const staleSeal = { ...originalSeal, stateDev: fromDev }
  const staleBytes = Buffer.from(`${JSON.stringify(staleSeal)}\n`)
  const replaceSeal = (bytes) => {
    chmodSync(sealPath, 0o600)
    writeFileSync(sealPath, bytes)
    chmodSync(sealPath, 0o400)
  }
  const retainedFiles = (directory, relative = '') => readdirSync(directory).sort().flatMap((name) => {
    if (relative === '' && (name === SEAL_FILENAME || name === '.broker-active.lock')) return []
    const absolute = join(directory, name)
    const path = join(relative, name)
    return lstatSync(absolute).isDirectory()
      ? retainedFiles(absolute, path)
      : [{ path, sha256: createHash('sha256').update(readFileSync(absolute)).digest('hex') }]
  })
  const historyBefore = retainedFiles(stateDir)
  replaceSeal(staleBytes)
  const failure = await bootRaw({ stateDir, socketPath })
  const rejected = []
  const refuses = (label, action, message) => {
    assert.throws(action, { message }, label)
    rejected.push(label)
    assert.deepEqual(readFileSync(sealPath), staleBytes)
    assert.deepEqual(retainedFiles(stateDir), historyBefore)
  }
  const inspect = () => inspectSealRecovery(stateDir, expected)
  const recover = (inspection = inspect()) => recoverSealDevice({ inspection, backupDir, assertStopped })
  let restarted
  try {
    assert.equal(put.state, 'SETTLED')
    assert.equal(failure.code, 1)
    assert.ok(failure.stderr.startsWith(CONFINEMENT_REFUSE.SEAL_FOREIGN_DIRECTORY))
    const cliApply = spawnSync(process.execPath, [join(ROOT, 'scripts/launchd-seal-recover-bin.mjs'),
      '--apply', '--uid', String(expected.uid), '--inode', String(expected.ino),
      '--from-device', String(expected.fromDev), '--to-device', String(expected.toDev),
    ], { encoding: 'utf8', timeout: 10000 })
    assert.equal(cliApply.status, 1, cliApply.stderr)
    assert.equal(cliApply.stdout, '')
    assert.deepEqual(JSON.parse(cliApply.stderr), {
      status: 'failed', reason: process.platform === 'darwin' ? 'seal-recovery:root-required' : 'seal-recovery:darwin-required',
      sealRecovery: 'not-applied', broker: 'not-established', kiraChecked: false,
    })
    assert.deepEqual(readFileSync(sealPath), staleBytes)
    assert.deepEqual(retainedFiles(stateDir), historyBefore)
    rejected.push('cli-apply-not-authorized')
    for (const [field, value] of [['uid', EUID + 1], ['ino', expected.ino + 1], ['fromDev', fromDev + 1], ['toDev', expected.toDev + 2]]) {
      refuses(`expected-${field}`, () => inspectSealRecovery(stateDir, { ...expected, [field]: value }),
        field === 'fromDev' ? 'seal-recovery:seal-mismatch' : 'seal-recovery:directory-mismatch')
    }
    chmodSync(stateDir, 0o777)
    refuses('open-state-mode', inspect, 'seal-recovery:directory-mismatch')
    chmodSync(stateDir, 0o700)
    chmodSync(sealPath, 0o600)
    refuses('open-seal-mode', inspect, 'seal-recovery:private-single-link-seal-required')
    chmodSync(sealPath, 0o400)

    for (const [field, value] of [['euid', EUID + 1], ['stateUid', EUID + 1], ['stateMode', '0600']]) {
      replaceSeal(Buffer.from(`${JSON.stringify({ ...staleSeal, [field]: value })}\n`))
      assert.throws(inspect, { message: 'seal-recovery:seal-mismatch' })
      rejected.push(`seal-${field}`)
      replaceSeal(staleBytes)
    }

    const inspection = JSON.parse(JSON.stringify(inspect()))
    refuses('missing-stop-check', () => recoverSealDevice({ inspection, backupDir }), 'seal-recovery:stopped-check-required')
    for (const failAt of [1, 2, 3]) {
      let calls = 0
      refuses(`stop-check-${failAt}-refused`, () => recoverSealDevice({
        inspection, backupDir, assertStopped: () => {
          assertStopped()
          if (++calls === failAt) throw new Error('court:service-running')
        },
      }), 'court:service-running')
      assert.equal(calls, failAt)
      assert.equal(existsSync(leasePath), false)
    }
    assert.equal(existsSync(leasePath), false)
    const occupied = Buffer.from('court-owned active lease\n')
    writeFileSync(leasePath, occupied, { flag: 'wx', mode: 0o600 })
    refuses('occupied-lease', () => recover(inspection), 'broker:state-active')
    assert.deepEqual(readFileSync(leasePath), occupied)
    rmSync(leasePath)

    replaceSeal(Buffer.from(`${JSON.stringify({ ...staleSeal, sealedAt: '2000-01-01T00:00:00.000Z' })}\n`))
    assert.throws(() => recover(inspection), { message: 'seal-recovery:inspection-stale' })
    assert.equal(readSeal(stateDir).seal.sealedAt, '2000-01-01T00:00:00.000Z')
    rejected.push('seal-changed-after-inspection')
    assert.equal(existsSync(leasePath), false)
    replaceSeal(staleBytes)

    const hardlink = join(fixture, 'seal-hardlink')
    linkSync(sealPath, hardlink)
    refuses('hardlinked-seal', inspect, 'seal-recovery:private-single-link-seal-required')
    rmSync(hardlink)
    const movedSeal = join(fixture, 'symlink-target')
    writeFileSync(movedSeal, staleBytes, { mode: 0o400 })
    rmSync(sealPath)
    symlinkSync(movedSeal, sealPath)
    refuses('symlink-seal', inspect, 'seal-recovery:private-single-link-seal-required')
    rmSync(sealPath)
    writeFileSync(sealPath, staleBytes, { mode: 0o400 })

    const foreignDir = join(dirname(stateDir), 'foreign')
    mkdirSync(foreignDir, { mode: 0o700 })
    cpSync(sealPath, join(foreignDir, SEAL_FILENAME))
    const foreignExpected = { ...expected, ino: lstatSync(foreignDir).ino }
    refuses('copied-seal-before-recovery', () => inspectSealRecovery(foreignDir, foreignExpected), 'seal-recovery:seal-mismatch')
    const beforeForeign = await bootRaw({ stateDir: foreignDir, socketPath: join(fixture, 'f.sock') })
    assert.ok(beforeForeign.stderr.startsWith(CONFINEMENT_REFUSE.SEAL_FOREIGN_DIRECTORY))

    chmodSync(backupDir, 0o777)
    refuses('open-backup-parent', recover, 'seal-recovery:private-external-backup-required')
    chmodSync(backupDir, 0o700)
    refuses('backup-inside-state', () => recoverSealDevice({ inspection: inspect(), backupDir: stateDir, assertStopped }),
      'seal-recovery:private-external-backup-required')
    const backupsBefore = readdirSync(backupDir).length
    const result = recover()
    const repaired = readSeal(stateDir).seal
    assert.deepEqual(repaired, { ...staleSeal, stateDev: expected.toDev })
    assert.equal(existsSync(leasePath), false)
    assert.deepEqual(retainedFiles(stateDir), historyBefore)
    assert.equal(readdirSync(backupDir).length, backupsBefore + 1)
    const backup = result.backupDir
    assert.equal(lstatSync(backup).mode & 0o777, 0o700)
    assert.deepEqual(readFileSync(join(backup, 'before.seal')), staleBytes)
    assert.deepEqual(readFileSync(join(backup, 'after.seal')), readFileSync(sealPath))
    assert.equal(result.status, 'seal-recovered')
    const decision = JSON.parse(readFileSync(join(backup, 'decision.json'), 'utf8'))
    assert.equal(decision.actorUid, EUID)
    assert.equal(decision.beforeSha256, createHash('sha256').update(staleBytes).digest('hex'))
    assert.equal(decision.historicalVolumeIdentity, 'unverified')

    chmodSync(join(foreignDir, SEAL_FILENAME), 0o600)
    cpSync(sealPath, join(foreignDir, SEAL_FILENAME))
    chmodSync(join(foreignDir, SEAL_FILENAME), 0o400)
    assert.throws(() => inspectSealRecovery(foreignDir, foreignExpected), { message: 'seal-recovery:seal-mismatch' })
    rejected.push('copied-seal-after-recovery')
    const afterForeign = await bootRaw({ stateDir: foreignDir, socketPath: join(fixture, 'f.sock') })
    assert.ok(afterForeign.stderr.startsWith(CONFINEMENT_REFUSE.SEAL_FOREIGN_DIRECTORY))

    restarted = await spawnBroker({ socketPath, stateDir, rootPublicKeyPem: rootPem })
    const reconnected = client(socketPath)
    const reopenedStatus = await reconnected.send({ op: 'status' })
    reconnected.close()
    assert.equal(reopenedStatus.ok, true)
    assert.equal(reopenedStatus.receiptKeyId, status.receiptKeyId)
    assert.deepEqual(retainedFiles(stateDir), historyBefore)
    const stopped = once(restarted, 'exit')
    restarted.kill('SIGTERM')
    await stopped
    restarted = undefined

    // Faults enter only at the filesystem in disposable child processes. The
    // imported recovery service and broker lease implementation are unchanged.
    const faultResults = []
    for (const fault of ['publication', 'release']) {
      replaceSeal(staleBytes)
      const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
        import fs from 'node:fs';
        import { syncBuiltinESMExports } from 'node:module';
        import assert from 'node:assert/strict';
        const { inspectSealRecovery, recoverSealDevice } = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'scripts/launchd-seal-recover.mjs')).href)});
        const stateDir = ${JSON.stringify(stateDir)};
        const backupDir = ${JSON.stringify(backupDir)};
        const expected = ${JSON.stringify(expected)};
        const sealPath = ${JSON.stringify(sealPath)};
        const leasePath = ${JSON.stringify(leasePath)};
        const fault = ${JSON.stringify(fault)};
        const rename = fs.renameSync, unlink = fs.unlinkSync, sync = fs.fsyncSync;
        let published = false, released = false;
        fs.renameSync = (...args) => {
          const result = rename(...args);
          if (args[1] === sealPath) published = true;
          return result;
        };
        fs.unlinkSync = (...args) => {
          const result = unlink(...args);
          if (args[0] === leasePath) released = true;
          return result;
        };
        fs.fsyncSync = (...args) => {
          if (published && (fault === 'publication' || released)) throw new Error('court:injected-fsync');
          return sync(...args);
        };
        syncBuiltinESMExports();
        try {
          recoverSealDevice({ inspection: inspectSealRecovery(stateDir, expected), backupDir,
            assertStopped: () => assert.throws(() => process.kill(${running.pid}, 0), { code: 'ESRCH' }) });
          process.exitCode = 2;
        } catch (error) {
          console.log(JSON.stringify({ reason: error.message, classification: error.sealRecovery,
            backupDir: error.backupDir, cause: error.cause?.message,
            leasePresent: fs.existsSync(leasePath), pid: process.pid }));
        }
      `], { encoding: 'utf8', timeout: 10000 })
      assert.equal(child.status, 0, child.stderr)
      const outcome = JSON.parse(child.stdout)
      assert.equal(outcome.reason, fault === 'publication'
        ? 'seal-recovery:publication-indeterminate' : 'seal-recovery:lease-release-indeterminate')
      assert.equal(outcome.classification, fault === 'publication' ? 'indeterminate' : 'recovered')
      assert.equal(outcome.cause, 'court:injected-fsync')
      assert.equal(outcome.leasePresent, fault === 'publication')
      assert.deepEqual(readFileSync(join(outcome.backupDir, 'before.seal')), staleBytes)
      assert.deepEqual(readSeal(stateDir).seal, { ...staleSeal, stateDev: expected.toDev })
      assert.deepEqual(retainedFiles(stateDir), historyBefore)
      assert.throws(() => process.kill(outcome.pid, 0), { code: 'ESRCH' })
      if (fault === 'publication') {
        const refusesRestart = await bootRaw({ stateDir, socketPath })
        assert.equal(refusesRestart.code, 1)
        assert.ok(refusesRestart.stderr.startsWith('broker:state-active'))
        // Only this court owns this disposable lease, and its child has exited.
        rmSync(leasePath)
      }
      faultResults.push(`${fault}:${outcome.classification}:lease=${outcome.leasePresent}`)
    }
    row('C19', 'explicit device-only recovery preserves identity and retained bytes', {
      refusal: failure.stderr.split('\n')[0], reopened: reopenedStatus.ok,
      retainedFiles: historyBefore.length, refusals: rejected, backupExact: true, faults: faultResults,
    }, {
      refusal: CONFINEMENT_REFUSE.SEAL_FOREIGN_DIRECTORY, reopened: true,
      retainedFiles: historyBefore.length,
      refusals: ['cli-apply-not-authorized', 'expected-uid', 'expected-ino', 'expected-fromDev', 'expected-toDev', 'open-state-mode', 'open-seal-mode',
        'seal-euid', 'seal-stateUid', 'seal-stateMode', 'missing-stop-check', 'stop-check-1-refused',
        'stop-check-2-refused', 'stop-check-3-refused', 'occupied-lease', 'seal-changed-after-inspection',
        'hardlinked-seal', 'symlink-seal', 'copied-seal-before-recovery', 'open-backup-parent',
        'backup-inside-state', 'copied-seal-after-recovery'],
      backupExact: true,
      faults: ['publication:indeterminate:lease=true', 'release:recovered:lease=false'],
    })
  } catch (error) {
    console.error(`C19 recovery failed: ${error.stack}`)
    row('C19', 'explicit device-only recovery preserves identity and retained bytes', { failure: error.message, refusals: rejected }, { held: true })
  } finally {
    if (restarted !== undefined) {
      const exited = once(restarted, 'exit')
      restarted.kill('SIGTERM')
      await exited
    }
  }
}

console.log('\n  courts/harness/confinement — confinement measured and signed, or no boot\n  ' + '-'.repeat(72))
for (const r of rows) {
  console.log(`  ${r.n.padEnd(4)}${String(r.label).padEnd(62)} ${r.breach ? '*** BREACH ***' : 'held'}  ${JSON.stringify(r.observed).slice(0, 150)}`)
}
console.log(`
  READ C10/C11 EXACTLY: the peer token there is mode 0000, so the broker's
  EACCES is real and the raise is gated on it, but the court knows the bytes
  because it wrote them. Those rows prove the CODE PATH refuses and admits
  correctly. They do NOT prove a uid boundary existed. On ${process.platform} the product
  class is ${CONFINEMENT_CLASS.STATE_OWNED} and every receipt says so in signed bytes; the key is
  still readable at uid ${EUID}, the record is still coherently rewritable at uid ${EUID},
  and this gate claims nothing about either.`)

if (MUTATE) {
  // Three sabotages, one per half of the gate. All three must be detected.
  //
  // Two of them PATCH A COPY OF THE TREE OUTSIDE THE REPOSITORY and boot the
  // real broker entry from it, which is what broker.mjs already says mutation
  // testing does. A sabotage that only reimplements a predicate inside the
  // court proves the court can write `false`; a sabotage that deletes the gate
  // and then serves a request the real gate refused proves the gate was load
  // bearing.
  const mutantRoot = join(TMP, 'mutant')
  cpSync(join(ROOT, 'aukora'), join(mutantRoot, 'aukora'), { recursive: true })
  const mutantConfinement = join(mutantRoot, 'aukora', 'broker', 'confinement.mjs')
  const mutantBroker = join(mutantRoot, 'aukora', 'broker', 'broker.mjs')
  const mutantReceipt = join(mutantRoot, 'aukora', 'broker', 'receipt.mjs')
  const cut = (file, from, to) => {
    const before = readFileSync(file, 'utf8')
    if (!before.includes(from)) throw new Error(`mutation: anchor not found in ${file}: ${from.slice(0, 60)}`)
    writeFileSync(file, before.replace(from, to), 'utf8')
  }
  // Delete the boot refusal.
  cut(mutantConfinement, `  if (measurement.class === CONFINEMENT_CLASS.UNCONFINED) {
    const error = new Error(measurement.defect)
    error.detail = describeDefect(stateDir, measurement)
    throw error
  }`, '  // mutation: the boot refusal is gone')
  // Delete the boot-time seal comparison.
  cut(mutantConfinement, '  if (!classAtLeast(ceiling, seal.class)) {', '  if (false) {')
  // Delete the per-request ratchet.
  cut(mutantBroker, '    if (!classAtLeast(servedClass, seal.class)) {', '    if (false) {')
  // Delete the production receipt verifier's minimum-class refusal.
  cut(mutantReceipt, '  if (!classAtLeast(claims.confinement.class, floor)) {', '  if (false) {')
  const mutantEntry = join(mutantRoot, 'aukora', 'broker', 'broker.mjs')

  // M1 — the gate that refused to boot on a 0777 state dir (row C2, exit 1) is
  // gone. The same directory now serves.
  const wideOpen = join(TMP, 'mutate-open', 'state')
  mkdirSync(wideOpen, { recursive: true, mode: 0o700 })
  chmodSync(wideOpen, 0o777)
  const wideSock = join(TMP, 'mutate-open', 'b.sock')
  let m1 = false
  let m1Class = null
  try {
    const mb = await spawnMutantBroker({ entry: mutantEntry, socketPath: wideSock, stateDir: wideOpen, rootPublicKeyPem: rootPem })
    const mc = client(wideSock)
    const mutantStatus = await mc.send({ op: 'status' })
    m1 = mutantStatus.ok === true
    m1Class = mutantStatus.confinement?.ceiling
    mc.close(); mb.kill(); await delay(50)
  } catch (error) {
    // A mutant that cannot boot is a mutation that did not take; report it as
    // NOT DETECTED rather than crashing the arm.
    console.error(`  mutation M1 could not launch: ${String(error?.message ?? error)}`)
  }

  // M2 — patch the production verifier, then drive the same validly signed
  // unconfined receipt through both the mutant and the live verifier.
  const unconfinedClaims = {
    requestDigest: requestDigest(MEMORY_PUT, ARGS1),
    definitionId: DEF, nonce: 'mutate-unconfined', sequence: 98,
    path: put1.evidence.path,
    bytes: put1.evidence.bytes,
    contentSha256: put1.evidence.contentSha256,
    inode: put1.evidence.inode,
    mtimeNs: put1.evidence.mtimeNs,
    confinement: { ...conf1, class: CONFINEMENT_CLASS.UNCONFINED, sealClass: CONFINEMENT_CLASS.UNCONFINED },
  }
  const unconfinedReceipt = {
    ...unconfinedClaims,
    signature: edSign(null, receiptPreimage(unconfinedClaims), brokerKey).toString('base64'),
  }
  const { verifyReceipt: sabotagedVerifyReceipt } = await import(`${pathToFileURL(mutantReceipt).href}?mutation=class-floor`)
  const m2 = sabotagedVerifyReceipt({ receipt: unconfinedReceipt, brokerPublicKeyPem: put1.brokerPublicKeyPem, observe }).ok === true &&
    verifyReceipt({ receipt: unconfinedReceipt, brokerPublicKeyPem: put1.brokerPublicKeyPem, observe }).reason === RECEIPT_REFUSE.CONFINEMENT_INSUFFICIENT

  // M3 — the ratchet is gone. The state directory row C11 and row C12 showed
  // refusing a weaker connection now boots AND settles one.
  const sealedClass = readSeal(ratchetDir).seal?.class
  const m3Sock = join(TMP, 'ratchet', 'mutant.sock')
  let m3 = false
  let m3Class = null
  try {
    const mb = await spawnMutantBroker({ entry: mutantEntry, socketPath: m3Sock, stateDir: ratchetDir, rootPublicKeyPem: rootPem })
    const mc = client(m3Sock)
    const A = { key: 'belowsealmutant', value: 3 }
    const r = await mc.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: A, grant: mintGrant(A, 'mut-02', status2.receiptKeyId) })
    const effectRan = existsSync(join(ratchetDir, 'memory', 'keys', 'belowsealmutant.json'))
    m3 = r.state === 'INDETERMINATE'
      && effectRan
      && sealedClass === CONFINEMENT_CLASS.PEER_SEPARATED
    m3Class = r.state
    mc.close(); mb.kill(); await delay(50)
  } catch (error) {
    console.error(`  mutation M3 could not launch: ${String(error?.message ?? error)}`)
  }

  const controlsHeld = ordinaryRowsHeld()
  const detected = m1 && m2 && m3 && controlsHeld
  console.log(`\n  MUTATION boot refusal deleted     0777 dir served, stamped ${JSON.stringify(m1Class)}   ${m1 ? 'DETECTED' : 'NOT DETECTED'}`)
  console.log(`  MUTATION class gate deleted       unconfined receipt admitted=${m2}   ${m2 ? 'DETECTED' : 'NOT DETECTED'}`)
  console.log(`  MUTATION seal ratchet deleted     ${JSON.stringify(sealedClass)} dir reached effect with ${JSON.stringify(m3Class)}   ${m3 ? 'DETECTED' : 'NOT DETECTED'}\n`)
  console.log(`  MUTATION ordinary-row oracle      ordinaryRowsHeld=${controlsHeld}\n`)
  rmSync(TMP, { recursive: true, force: true })
  process.exit(detected ? 0 : 1)
}

const anyBreach = rows.some((r) => r.breach)
console.log('\n  observationClass: SELF-REPORTED\n')
rmSync(TMP, { recursive: true, force: true })
process.exit(anyBreach || !ordinaryRowsHeld() ? 1 : 0)
