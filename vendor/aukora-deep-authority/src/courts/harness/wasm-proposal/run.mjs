/**
 * courts/harness/wasm-proposal - an untrusted cell with one function of reach
 * emits an inert proposal, and a real broker owns everything else.
 *
 * WHY THIS COURT EXISTS. courts/harness/wasm-cell measures the membrane in
 * isolation: a cell's reach is enumerable from its bytes and refused before it
 * runs. courts/harness/broker-proposal measures the broker-owned route in
 * isolation: proposal.open, proposal.deposit and proposal.status, with public
 * replies that carry no authority artifact. Neither has met the other. This
 * court joins them, because the interesting claim is not that either half
 * works but that the half holding no authority can still cause a governed
 * effect to be considered.
 *
 * The arrangement under test. The cell imports exactly one function, plus the
 * linear memory the host supplies. It has no socket, no filesystem, no clock,
 * no namespace, and no way to name any of them: WebAssembly gives it no syntax
 * for a host object that was not handed in. It writes an argument object into
 * that memory and calls propose(ptr, len). The host reads those bytes out, and
 * the host alone holds the broker socket and the proposal namespace. The broker
 * alone holds the issuer route.
 *
 * The cell declares no memory of its own. A DEFINED memory appears in no
 * reflection API, so its limits are unreadable and P1's reach enumeration would
 * not see it; courts/harness/wasm-cell measures that blindness at C11 and
 * refuses the shape at C15. Importing the memory puts its ceiling in the host's
 * hands and keeps the cell's whole reach enumerable.
 *
 * What that buys, precisely: the guest cannot address the issuer, cannot forge
 * a namespace it was never given, and receives back only what the broker
 * publishes. What it does not buy is confinement of the HOST, which is the
 * same ceiling wasm-cell prints at C8 and which P6 prints here.
 *
 *   P1  one-function   the cell's total reach is one callable import plus host memory
 *   P2  inert          the cell's payload is data; it names no authority
 *   P3  deposited      that payload reaches a REAL broker and gets a proposal id
 *   P4  public-only    what comes back carries no authority artifact
 *   P5  unnameable     the cell cannot reach the namespace or the broker socket
 *   P6  ceiling        the host is unconfined, and the approval here is SIMULATED
 *
 * The mutation arm hands the cell a second import that leaks the namespace. If
 * the court still says the cell cannot name it, the row was decoration.
 */
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { createConnection, createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitCell } from './emit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const { spawnBroker } = await import(join(ROOT, 'aukora', 'broker', 'broker.mjs'))
const { authorizationSignedMessageFromHex } = await import(join(ROOT, 'aukora', 'host-dsh', 'src', 'grant.mjs'))

const MUTATE = process.argv.includes('--mutate')
const EXIT_INCONCLUSIVE = 78
const rows = []
const row = (n, name, breach, detail, inconclusive = false) => rows.push({ n, name, breach, detail, inconclusive })
const EXPECTED = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']

/**
 * Enumerate a module's reach from its bytes, KIND included, so a memory import
 * is never counted as a callable one.
 * @param {WebAssembly.Module} m Compiled module.
 * @returns {string[]} `module.name:kind` for every declared import.
 */
const reachOf = m => WebAssembly.Module.imports(m).map(i => `${i.module}.${i.name}:${i.kind}`)

/** One line-delimited JSON round trip against a unix socket. */
const ask = (path, frame, ms = 8000) => new Promise(res => {
  const c = createConnection(path)
  let buf = ''
  const done = v => { c.destroy(); res(v) }
  c.once('connect', () => c.write(`${JSON.stringify(frame)}\n`))
  c.on('data', d => { buf += String(d); const cut = buf.indexOf('\n'); if (cut !== -1) { try { done(JSON.parse(buf.slice(0, cut))) } catch { done(null) } } })
  c.on('error', () => done(null))
  setTimeout(() => done(null), ms)
})

const TMP = mkdtempSync(join(tmpdir(), 'aukora-wasm-proposal-'))
let broker = null
let issuerServer = null
const issuerSockets = new Set()

try {
  const root = generateKeyPairSync('ed25519')
  const rootPublicKeyPem = root.publicKey.export({ type: 'spki', format: 'pem' })

  // SIMULATED issuer: signs whatever the broker asks. Stands in for a human.
  const issuerSocket = join(TMP, 'issuer.sock')
  issuerServer = createServer(socket => {
    issuerSockets.add(socket)
    socket.once('close', () => issuerSockets.delete(socket))
    let buf = ''
    socket.on('data', d => {
      buf += String(d)
      const cut = buf.indexOf('\n')
      if (cut === -1) return
      socket.removeAllListeners('data')
      let frame
      try { frame = JSON.parse(buf.slice(0, cut)) } catch { socket.destroy(); return }
      const reply = frame.op === 'admit'
        ? { ok: true }
        : { ok: true, digest: frame.digest,
            signature: edSign(null, authorizationSignedMessageFromHex(frame.digest), root.privateKey).toString('base64') }
      socket.end(`${JSON.stringify(reply)}\n`)
    })
    socket.on('error', () => {})
  })
  await new Promise((res, rej) => { issuerServer.once('error', rej); issuerServer.listen(issuerSocket, () => { issuerServer.removeListener('error', rej); res() }) })

  const brokerSocket = join(TMP, 'broker.sock')
  const stateDir = join(TMP, 'state')
  broker = await spawnBroker({
    socketPath: brokerSocket,
    stateDir,
    rootPublicKeyPem,
    issuerSocket,
    activationDigest: 'ab'.repeat(32),
    rendererId: 'cd'.repeat(32),
    review: async () => 'approved',
  })

  const opened = await ask(brokerSocket, { op: 'proposal.open' })
  const namespace = opened?.proposalNamespace
  if (typeof namespace !== 'string') throw new Error(`broker did not open a namespace: ${JSON.stringify(opened)}`)

  // ---- the cell ------------------------------------------------------------
  // Under mutation the cell is handed the namespace, both as an import and
  // inside the bytes it emits. The subject changes; no predicate below reads
  // the flag to notice.
  const args = MUTATE
    ? { key: 'wasm:cell', value: 'emitted-from-linear-memory', leaked: namespace }
    : { key: 'wasm:cell', value: 'emitted-from-linear-memory' }
  const payload = JSON.stringify(args)
  const imports = MUTATE
    ? [['aukora', 'propose'], ['aukora', 'namespace']]   // arm: leak the namespace
    : [['aukora', 'propose']]
  const bytes = emitCell({ imports, payload })
  const mod = new WebAssembly.Module(bytes)
  const reach = reachOf(mod)

  // The predicate is the same in both modes. The arm widens the cell; if this
  // row does not then breach, it was not reading the reach at all.
  // One CALLABLE import, plus the memory the host supplies. The cell declares no
  // memory of its own: a defined memory's limits are readable through no API,
  // which courts/harness/wasm-cell measures at C11 and refuses at C15.
  const callable = reach.filter(r => r.endsWith(':function'))
  row('P1', 'one-function', callable.length !== 1,
    `cell is ${bytes.length} bytes; total reach = [${reach.join(' ')}]; callable imports = ${callable.length}. ` +
    'The memory is host-supplied and host-capped rather than cell-declared.')

  // ---- run it --------------------------------------------------------------
  let emitted = null
  let inst
  // The host owns the memory object and its ceiling; the cell imports it and
  // exports no `mem`, so guest bytes are read through what the host supplied.
  const table = { aukora: {
    mem: new WebAssembly.Memory({ initial: 1, maximum: 2 }),
    propose: (ptr, len) => { emitted = Buffer.from(table.aukora.mem.buffer, ptr, len).toString('utf8'); return 1 },
    namespace: () => 0,
  } }
  inst = new WebAssembly.Instance(mod, table)
  const rc = inst.exports.main()

  let parsed = null
  try { parsed = JSON.parse(emitted) } catch { /* left null; P2 reports it */ }
  const namesAuthority = emitted !== null && /grant|signature|nonce|proposalNamespace|socket/i.test(emitted)
  row('P2', 'inert', parsed === null || namesAuthority,
    `main()=${rc}; the cell emitted ${emitted?.length ?? 0} bytes: ${emitted}. Names an authority artifact or a namespace: ${namesAuthority}`)

  // ---- host deposits on the cell's behalf ----------------------------------
  const deposit = await ask(brokerSocket, {
    id: 'wasm-cell-deposit', op: 'proposal.deposit',
    proposalNamespace: namespace, callId: 'wasm-cell-1',
    toolName: 'memory.put', arguments: parsed ?? {},
  })
  const proposalId = deposit?.proposalId
  row('P3', 'deposited', typeof proposalId !== 'string',
    `real broker (pid ${broker?.pid ?? '?'}) replied ${JSON.stringify(deposit)?.slice(0, 130)}`)

  const status = typeof proposalId === 'string'
    ? await ask(brokerSocket, { id: 'wasm-cell-status', op: 'proposal.status', proposalNamespace: namespace, proposalId })
    : null
  const serialized = JSON.stringify(status ?? {})
  const leaked = ['grant', 'signature', 'nonce', 'digest', 'claims', 'receipt', 'arguments'].filter(k => serialized.includes(k))
  row('P4', 'public-only', status === null || leaked.length > 0,
    status === null ? 'no status reply to inspect'
      : `status reply keys [${Object.keys(status).sort().join(' ')}]; authority artifacts present: ${leaked.length ? leaked.join(',') : 'none'}`)

  // ---- what the cell could never say --------------------------------------
  const cellSawNamespace = emitted !== null && emitted.includes(namespace)
  const canImportSocket = (() => {
    try {
      const rogue = emitCell({ imports: [['aukora', 'propose'], ['wasi_snapshot_preview1', 'path_open']], payload })
      const rogueMod = new WebAssembly.Module(rogue)
      const excess = reachOf(rogueMod).filter(r => !['aukora.propose:function', 'aukora.mem:memory'].includes(r))
      return { compiled: true, excess }
    } catch (e) { return { compiled: false, error: e.message } }
  })()
  row('P5', 'unnameable', cellSawNamespace,
    `the cell never received the namespace (${namespace.slice(0, 12)}...) and did not emit it: ${!cellSawNamespace}. ` +
    `A cell asking for a filesystem import declares it in the open: excess=[${canImportSocket.excess?.join(' ') ?? canImportSocket.error}], which the wasm-cell court refuses before instantiation.`)

  row('P6', 'ceiling', false,
    'SIMULATED_APPROVAL: the issuer here signs without a human. SAME_UID: broker, issuer and this process share one uid, so the cell is confined and its host is not. ' +
    'NATIVE_CORDIS_CONFINEMENT_NOT_ESTABLISHED: nothing here confines an ordinary Node plugin.')
} catch (e) {
  row('P1', 'one-function', false, `setup failed: ${e.message}`, true)
} finally {
  for (const s of issuerSockets) s.destroy()
  if (issuerServer) await new Promise(res => issuerServer.close(() => res()))
  if (broker?.kill) broker.kill('SIGKILL')
  else if (broker?.child?.kill) broker.child.kill('SIGKILL')
  rmSync(TMP, { recursive: true, force: true })
}

const measured = rows.map(r => r.n)
const complete = EXPECTED.every(n => measured.includes(n))
console.log('\n  courts/harness/wasm-proposal - a one-function guest against a real broker\n')
for (const r of rows) {
  const v = r.inconclusive ? '*** INCONCLUSIVE ***' : r.breach ? '*** BREACH ***' : 'held'
  console.log(`  ${r.n}  ${r.name.padEnd(13)} ${v.padEnd(22)} ${r.detail}`)
}
const breached = rows.filter(r => r.breach).map(r => r.n)
if (MUTATE) {
  const detected = breached.includes('P1')
  console.log(`\n  MUTATION namespace-leaked-to-cell   cell reach widened to include aukora.namespace -> breached=[${breached.join(' ')}]   ${detected ? 'MUTATION CONFIRMED' : 'NOT DETECTED'}\n`)
  // Three outcomes, three codes. Exiting 1 either way computes `detected` and
  // then discards it, so a caller reading exit codes cannot tell a sabotage
  // this court caught from one it missed, which is the whole question an arm
  // exists to answer. 0 stays impossible under an arm.
  if (!complete) process.exit(3)
  process.exit(detected ? 1 : 2)
}
console.log(`\n  ${rows.length} rows, ${rows.filter(r => !r.breach && !r.inconclusive).length} held, ${rows.filter(r => r.inconclusive).length} inconclusive`)
console.log('  observationClass: SELF-REPORTED\n')
if (!complete) { console.log(`  ROW TABLE INCOMPLETE expected=${EXPECTED.join(',')} measured=${measured.join(',')}`); process.exit(1) }
if (rows.some(r => r.inconclusive)) process.exit(EXIT_INCONCLUSIVE)
process.exit(breached.length ? 1 : 0)
