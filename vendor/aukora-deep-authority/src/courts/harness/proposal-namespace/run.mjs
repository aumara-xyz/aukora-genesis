/**
 * courts/harness/proposal-namespace - what a proposal namespace binds, and
 * what holding one is worth.
 *
 * WHY THIS COURT EXISTS. courts/harness/wasm-proposal shows a cell that never
 * receives a namespace and therefore cannot name one. That row is only worth
 * something if a namespace is hard to obtain by other means, so this court
 * asks what the namespace actually is. The broker mints it as
 * randomBytes(16).toString('hex'), keeps it in a Map, and matches it against
 * /^[0-9a-f]{32}$/. Two questions follow: does one namespace reach another's
 * proposals, and is the token bound to the connection that opened it.
 *
 * The second answer is the one that matters, and it is not a defect. A
 * namespace is a bearer capability: whoever holds the string may deposit into
 * it, from any connection. That is the ordinary meaning of a capability and it
 * is why wasm-proposal P5 is worth measuring -- the cell's inability to name
 * the namespace is the whole of what keeps it out. It also means a namespace
 * leaked in a log, an argument list, or an error message is authority to
 * deposit, which is a handling requirement rather than a bug, and N5 states it
 * as a row so no reader has to infer it.
 *
 *   N1  distinct      two opens yield different 128-bit tokens
 *   N2  own-namespace a deposit into the namespace you hold is accepted
 *   N3  cross-read    a proposal id from A is not readable under B
 *   N4  fabricated    an invented namespace is refused BY NAME
 *   N5  bearer        THE PROPERTY: the token is not bound to its connection
 *   N6  ceiling       what none of this establishes
 */
import { generateKeyPairSync, sign as edSign, randomBytes } from 'node:crypto'
import { createConnection, createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const { spawnBroker } = await import(join(ROOT, 'aukora', 'broker', 'broker.mjs'))
const { authorizationSignedMessageFromHex } = await import(join(ROOT, 'aukora', 'host-dsh', 'src', 'grant.mjs'))

const MUTATE = process.argv.includes('--mutate')
const EXIT_INCONCLUSIVE = 78
const rows = []
const row = (n, name, breach, detail, inconclusive = false) => rows.push({ n, name, breach, detail, inconclusive })
const EXPECTED = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6']

/** One line-delimited JSON round trip on a FRESH connection each time. */
const ask = (path, frame, ms = 8000) => new Promise(res => {
  const c = createConnection(path)
  let buf = ''
  const done = v => { c.destroy(); res(v) }
  c.once('connect', () => c.write(`${JSON.stringify(frame)}\n`))
  c.on('data', d => { buf += String(d); const cut = buf.indexOf('\n'); if (cut !== -1) { try { done(JSON.parse(buf.slice(0, cut))) } catch { done(null) } } })
  c.on('error', () => done(null))
  setTimeout(() => done(null), ms)
})

const TMP = mkdtempSync(join(tmpdir(), 'aukora-ns-'))
let broker = null
let issuerServer = null
const issuerSockets = new Set()

try {
  const root = generateKeyPairSync('ed25519')
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
      let f
      try { f = JSON.parse(buf.slice(0, cut)) } catch { socket.destroy(); return }
      socket.end(`${JSON.stringify(f.op === 'admit' ? { ok: true } : {
        ok: true, digest: f.digest,
        signature: edSign(null, authorizationSignedMessageFromHex(f.digest), root.privateKey).toString('base64'),
      })}\n`)
    })
    socket.on('error', () => {})
  })
  await new Promise((res, rej) => { issuerServer.once('error', rej); issuerServer.listen(issuerSocket, () => { issuerServer.removeListener('error', rej); res() }) })

  const brokerSocket = join(TMP, 'broker.sock')
  broker = await spawnBroker({
    socketPath: brokerSocket, stateDir: join(TMP, 'state'),
    rootPublicKeyPem: root.publicKey.export({ type: 'spki', format: 'pem' }), issuerSocket,
    activationDigest: 'ab'.repeat(32),
    rendererId: 'cd'.repeat(32),
    review: async () => 'approved',
  })

  // ---- N1 two opens, two tokens -------------------------------------------
  const a = await ask(brokerSocket, { op: 'proposal.open' })
  const bOpen = await ask(brokerSocket, { op: 'proposal.open' })
  const nsA = a?.proposalNamespace
  const nsB = MUTATE ? nsA : bOpen?.proposalNamespace   // arm: collapse the two
  const shape = /^[0-9a-f]{32}$/
  const ok1 = typeof nsA === 'string' && typeof nsB === 'string' && shape.test(nsA) && shape.test(nsB) && nsA !== nsB
  row('N1', 'distinct', !ok1,
    `A=${String(nsA).slice(0, 12)}... B=${String(nsB).slice(0, 12)}...; both 128-bit hex: ${shape.test(String(nsA)) && shape.test(String(nsB))}; distinct: ${nsA !== nsB}`)

  // ---- N2 deposit into the one you hold ------------------------------------
  const depA = await ask(brokerSocket, {
    id: 'n2', op: 'proposal.deposit', proposalNamespace: nsA,
    callId: 'ns-court-a', toolName: 'memory.put', arguments: { key: 'ns:a', value: 1 },
  })
  const idA = depA?.proposalId
  row('N2', 'own-namespace', typeof idA !== 'string',
    `deposit into A -> ${JSON.stringify(depA)?.slice(0, 110)}`)

  // ---- N3 read A's proposal under B ---------------------------------------
  const crossRead = typeof idA === 'string'
    ? await ask(brokerSocket, { id: 'n3', op: 'proposal.status', proposalNamespace: nsB, proposalId: idA })
    : null
  const sameRead = typeof idA === 'string'
    ? await ask(brokerSocket, { id: 'n3c', op: 'proposal.status', proposalNamespace: nsA, proposalId: idA })
    : null
  const crossRefused = crossRead !== null && crossRead.ok !== true
  const sameAllowed = sameRead !== null && sameRead.ok === true
  row('N3', 'cross-read', !(crossRefused && sameAllowed),
    `A's proposal read under B -> ${JSON.stringify(crossRead)?.slice(0, 80)}; ` +
    `the SAME id read under A -> ok=${sameAllowed}. Both halves are needed: without the second this row cannot tell a refusal from a broken id.`)

  // ---- N4 an invented namespace -------------------------------------------
  const fake = randomBytes(16).toString('hex')
  const invented = await ask(brokerSocket, {
    id: 'n4', op: 'proposal.deposit', proposalNamespace: fake,
    callId: 'ns-court-fake', toolName: 'memory.put', arguments: { key: 'ns:fake', value: 1 },
  })
  const namedRefusal = invented !== null && invented.ok !== true && typeof invented.reason === 'string'
  row('N4', 'fabricated', !namedRefusal,
    `a namespace never issued (${fake.slice(0, 12)}...) -> ${JSON.stringify(invented)?.slice(0, 110)}`)

  // ---- N5 is the token bound to its connection? ---------------------------
  // Every ask() above already used a fresh connection, so a successful deposit
  // on a connection that never opened the namespace is the measurement.
  const foreignConn = await ask(brokerSocket, {
    id: 'n5', op: 'proposal.deposit', proposalNamespace: nsA,
    callId: 'ns-court-foreign', toolName: 'memory.put', arguments: { key: 'ns:foreign', value: 1 },
  })
  const bearer = foreignConn !== null && foreignConn.ok === true
  row('N5', 'bearer', false,
    bearer
      ? `a connection that never opened A deposited into A successfully (${JSON.stringify(foreignConn)?.slice(0, 70)}). ` +
        `The namespace is a BEARER CAPABILITY: holding the 128-bit string is authority to deposit, from anywhere. ` +
        `That is what a capability means and it is why wasm-proposal P5 matters -- the cell's inability to NAME it is the whole of what keeps it out. ` +
        `It also means a namespace in a log line or an error message is authority.`
      : `a foreign connection was refused (${JSON.stringify(foreignConn)?.slice(0, 70)}), so the token carries a connection binding this court did not expect`)

  // ---- N6 ceiling ----------------------------------------------------------
  row('N6', 'ceiling', false,
    'None of this authenticates the depositor. The broker learns that a caller holds a namespace, never who that caller is. ' +
    'SIMULATED_APPROVAL: the issuer stub signs without a human. SAME_UID: broker, issuer and this process share one uid.')
} catch (e) {
  row('N1', 'distinct', false, `setup failed: ${e.message}`, true)
} finally {
  for (const s of issuerSockets) s.destroy()
  if (issuerServer) await new Promise(res => issuerServer.close(() => res()))
  if (broker?.kill) broker.kill('SIGKILL')
  else if (broker?.child?.kill) broker.child.kill('SIGKILL')
  rmSync(TMP, { recursive: true, force: true })
}

const measured = rows.map(r => r.n)
const complete = EXPECTED.every(n => measured.includes(n))
console.log('\n  courts/harness/proposal-namespace - what a namespace binds\n')
for (const r of rows) {
  const v = r.inconclusive ? '*** INCONCLUSIVE ***' : r.breach ? '*** BREACH ***' : 'held'
  console.log(`  ${r.n}  ${r.name.padEnd(13)} ${v.padEnd(22)} ${r.detail}`)
}
const breached = rows.filter(r => r.breach).map(r => r.n)
if (MUTATE) {
  const detected = breached.length > 0
  console.log(`\n  MUTATION namespaces-collapsed   B is set to A, so cross-namespace reads cannot be distinguished -> breached=[${breached.join(' ')}]   ${detected ? 'MUTATION CONFIRMED' : 'NOT DETECTED'}\n`)
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
